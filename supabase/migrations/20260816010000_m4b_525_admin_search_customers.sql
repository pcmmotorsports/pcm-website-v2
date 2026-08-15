-- ════════════════════════════════════════════════════════════════════════════
-- M-4b `#525`:後台客戶搜尋 — `public.admin_search_customers(text, integer)`
--
-- Sean 2026-08-16 逐字:「客戶搜尋要建一支查詢 = 你自己看好就做」。
-- plan:`docs/specs/2026-08-16-525-customer-search-plan.md`(`Q-525-1` 裁【甲】= 建 RPC)。
--
-- ── 🔴🔴 為什麼是 RPC 而不是 PostgREST `.or()` —— 這是本片承重的那個決定 ──────
-- `.or()` 是**把值內插進 GET query string** ⇒ 值裡的 `,` `.` `(` `)` `"` 會**改變 filter 的結構**。
-- 訂單側的關鍵字搜尋之所以**不需要**字元集守門,理由只有一個且寫在
-- `packages/domain/src/order/keyword-search.ts:20-28`:**它走 `.rpc()` = POST + JSON body**
-- ⇒ 搜尋詞不進 URL、不進 filter 語法、不參與任何字串拼接。
-- 🔴 該檔同段逐字記著:原本另有兩個維度**各自有字元集守門**,而它們**連同威脅面一起被刪除**
--    (`Q-347-B1=B`)⇒ **改用 `.or()` = 把威脅面裝回來,而守門已經不在了。**
-- ⚠️ 而字元集守門在本軸**不能補**:員工要搜的正是**中文姓名** ——
--    那個檔逐字「照抄字元集守門 = 把功能廢掉一半」。
-- ⇒ **走 RPC 是唯一同時滿足「安全」與「中文可搜」的路。**
--
-- ── 🔴 搜尋詞是 PII,不得落 log ──────────────────────────────────────────
-- 對齊 `20260809180000` 檔頭 `:50-74` 的同一條:**本函式無任何 `RAISE`**(連註解裡都不放搜尋詞)。
-- 無效輸入一律**回空清單**,不擲例外 —— 錯誤訊息會含輸入原文。
--
-- ── 回傳形狀 ────────────────────────────────────────────────────────────
-- `{"ids": uuid[], "truncated": bool}`(逐字對齊 `admin_search_orders` 的形狀,呼叫端可共用讀法)。
-- 🔴 **只回 id,不回任何 PII** —— 姓名/電話/email 只在 SQL 內比對,不進讀模型、不進 RSC payload。
--    (同 `admin_search_orders` 的 `COMMENT` 逐字理由。)
-- 🔴 回的是 **`customers.user_id`**(該表 PK,`20260523034911:15`),不是 `customers.id` —— 那個欄不存在。
--
-- ── 🔴 為什麼不能走 orders(本片存在的理由)────────────────────────────
-- 訂單搜尋的形狀是 `SELECT o.id FROM orders o JOIN customers c ON c.user_id = o.customer_user_id`
-- ⇒ **零訂單的客人在那條路上完全不存在 —— 不是排後面,是 `JOIN` 就掉了。**
-- 正式庫 2026-08-16 實查:11 位客戶中 **7 位零訂單**(主視窗查)⇒ 繞道對多數客人無效。
-- **本函式從 `customers` 出發,零訂單的客人一定在候選集裡。**
--
-- ⚠️ **apply 是 Sean 的獨立停點。寫檔 ≠ 上庫。**
-- ⚠️ **本檔的 SQL 未經執行** —— 本窗無 DB access(不碰 `.env`)⇒ 語法與行為由 apply 時的
--    DO 區塊自我斷言把關;**在 apply 成功之前,不得宣稱本片「已驗證」。**
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_search_customers(
  p_query text,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_txt       text;
  v_txt_like  text;
  v_num       text;
  v_num_like  text;
  v_limit     integer;
  v_ids       uuid[];
  v_truncated boolean;
BEGIN
  -- ① 修剪:字元集**顯式**含 tab / U+3000 / NBSP / U+202F / U+200B / BOM
  --    (逐字對齊 `admin_search_orders`;`btrim` 預設只吃 ASCII 空白,中文輸入法常帶全形空白)。
  v_txt := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(p_query, ''), E' \t\n\r　  ​﻿')
  );

  -- ② 空 / 過長 → 回空清單,**不擲例外**(錯誤訊息會含輸入原文 = PII)。
  --    120 與 `MAX_ORDER_KEYWORD_LENGTH` 同值,刻意:兩軸的 UI 上限一致,員工不用記兩套。
  IF v_txt = '' OR pg_catalog.length(v_txt) > 120 THEN
    RETURN jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ③ 上限:NULL / <=0 → 100;硬夾 100(對齊下游 `.in()` 的 URL 長度上限)。
  v_limit := LEAST(COALESCE(NULLIF(p_limit, 0), 100), 100);
  IF v_limit <= 0 THEN v_limit := 100; END IF;

  -- ④ 逃逸:`LIKE` 的萬用字元。**這是在 SQL 內對 literal 做逃逸,與 `.or()` 的結構性風險無關**
  --    —— 值永遠是參數、永遠不參與語法。
  v_txt_like := pg_catalog.replace(
                  pg_catalog.replace(
                    pg_catalog.replace(v_txt, '\', '\\'),
                  '%', '\%'),
                '_', '\_');

  -- ⑤ 數字類 needle(電話):去掉所有非數字後比對 ⇒ `0912-345-678` 與 `0912345678` 互相搜得到。
  v_num := pg_catalog.regexp_replace(v_txt, '[^0-9]', '', 'g');
  v_num_like := v_num;  -- 純數字,無 LIKE 元字元可逃

  -- ⑥ 三軸 UNION(**不是一大坨 OR**)—— 逐字對齊 `admin_search_orders` 的形狀理由:
  --    OR 形狀下規劃器拿不到各軸的索引。`UNION`(非 `UNION ALL`)天然去重,
  --    一位客人同時命中兩軸只算一筆,不吃掉別人的名額。
  --    🔴 **各軸各自檢查 needle 非空**:搜 `-` 時數字類變空字串 ⇒ 該軸整組跳過,
  --       否則 `LIKE '%%'` 會**撈回全部客人**(fail-open)。
  WITH hits AS (
    -- #1 姓名(文字)
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_txt <> ''
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name, ''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
    UNION
    -- #2 Email(文字)
    -- 🔴 **LINE 合成位址刻意【搜得到】**(C 窗 2026-08-16 判、主視窗核):
    --    那串仍是該客人的登入帳號;後台把它藏起來是為了**畫面不顯示雜訊**,不是讓紀錄找不到。
    --    員工手上有那串的唯一來源是**後台以外**(Supabase 後台 / 錯誤紀錄 / LINE 客服),
    --    而那種時候他正需要用它反查是誰。⇒ 本軸不排除 `@line.pcmmotorsports.local`。
    --    ⚠️ 代價:搜到之後畫面 Email 欄顯示「LINE 帳號登入,無 Email」⇒ **搜 X 卻看不到 X**。
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_txt <> ''
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(c.email, ''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
    UNION
    -- #3 電話(數字;正規化後子字串)
    -- 🔴 **`lower()` 不可省(codex R1 must-fix 5)**:既有索引 `idx_customers_phone_trgm` 的表達式是
    --    `regexp_replace(pg_catalog.lower(COALESCE(phone,'')), '[^0-9]', '', 'g')`
    --    (`20260812130000:436-438` 逐字)。電話只有數字,**加不加 `lower()` 結果完全相同** ——
    --    但 **expression index 比對的是【表達式樹】不是【結果】** ⇒ 少一個 `lower()` 規劃器就用不到它,
    --    症狀是**功能完全正常、只是全表掃**,而**沒有任何測試會紅**。
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_num <> ''
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(c.phone, '')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
  ),
  ranked AS (
    -- 多撈一筆:用來分辨「剛好觸頂」與「超過」。UI 不得改用 `ids.length >= 上限` 的啟發式。
    -- 🔴 `user_id` 是**穩定的第二排序鍵**(codex R1 nit):只用 `created_at DESC` 時,
    --    兩位客人時間相同又剛好卡在上限邊界 ⇒ 回誰隨執行計畫改變 = 不可重現。
    SELECT user_id, created_at FROM hits ORDER BY created_at DESC, user_id LIMIT v_limit + 1
  )
  -- 🔴 **`array_agg` 必須自帶 `ORDER BY`(codex R2 must-fix 6)**:
  --    子查詢的 `ORDER BY` **不會**傳遞到聚合的輸入順序(PG 明文:aggregate 的輸入順序未指定)
  --    ⇒ 下面 `v_ids[1:v_limit]` 切掉的**可能不是第 101 筆**,邊界那一位隨執行計畫改變。
  --    症狀:同一組資料、同一個搜尋詞,兩次回不同的人 —— 而**兩次都「看起來正常」**。
  SELECT pg_catalog.array_agg(user_id ORDER BY created_at DESC, user_id) INTO v_ids FROM ranked;

  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  v_truncated := pg_catalog.array_length(v_ids, 1) > v_limit;
  IF v_truncated THEN
    v_ids := v_ids[1:v_limit];
  END IF;

  RETURN jsonb_build_object(
    'ids', COALESCE(pg_catalog.to_jsonb(v_ids), '[]'::jsonb),
    'truncated', COALESCE(v_truncated, false)
  );
END;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- Email 軸的 trigram 索引(codex R1 must-fix 5)
--
-- 🔴 **三軸裡只有 Email 沒有索引**(2026-08-16 全樹實查):
--    · 姓名 → `idx_customers_name_trgm`(`20260812130000:432-434`)表達式
--      `lower(btrim(COALESCE(name,'')))` ⇒ **與本函式逐字同形,對得上**
--    · 電話 → `idx_customers_phone_trgm`(同檔 `:436-438`)⇒ 本片已補上 `lower()` 讓它對得上
--    · Email → 只有 `customers_email_idx ON customers(email)` = **原欄位 B-tree**,
--      **撐不起 `lower(btrim(email)) LIKE '%…%'`**(前後都有萬用字元,B-tree 完全用不到)
--    ⇒ 不補的話 Email 軸**每次搜尋全表掃**,而**功能完全正常、沒有任何測試會紅**。
-- ⚠️ **表達式必須與函式內逐字同形** —— expression index 比對的是**表達式樹**不是結果。
-- ⚠️ `IF NOT EXISTS`:本檔可能被重跑(`CREATE OR REPLACE` 語意),索引已在時不得炸。
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON public.customers USING gin
  ((pg_catalog.lower(pg_catalog.btrim(COALESCE(email, '')))) extensions.gin_trgm_ops);

-- ── 權限:只有 service_role(後台走 service_role;anon / authenticated 一律不得執行)──
REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_customers(text, integer) TO service_role;

COMMENT ON FUNCTION public.admin_search_customers(text, integer) IS
  'M-4b #525:後台客戶搜尋。**三維度**(會員姓名 / Email / 會員電話),回 {"ids": uuid[], "truncated": bool}，ids = customers.user_id（該表 PK）。'
  '🔴 只回 id —— PII 只在 SQL 內比對，不進讀模型、不進 RSC payload。'
  '🔴 **走 RPC(POST body)而不是 PostgREST `.or()`**：`.or()` 把值內插進 GET query string ⇒ 值裡的字元會改變 filter 結構；'
  '訂單側不需要字元集守門正是因為它走 `.rpc()`（理由全文 packages/domain/src/order/keyword-search.ts:20-28），'
  '而那兩支有守門的維度已連同威脅面一起刪除 ⇒ 用 `.or()` 等於把威脅面裝回來而守門不在。'
  '字元集守門在本軸不能補：員工要搜的正是中文姓名。'
  '🔴 **從 customers 出發、不 join orders**：orders join 會讓零訂單的客人整個消失（2026-08-16 實查 11 位中 7 位零訂單），那正是本函式存在的理由。'
  '🔴 三軸 UNION（非一大坨 OR，非 UNION ALL）：OR 形狀下規劃器拿不到各軸索引；UNION 去重讓同時命中兩軸的客人只算一筆。'
  '🔴 各軸各自檢查 needle 非空：搜「-」時數字類變空字串 ⇒ 該軸跳過，否則 LIKE ''%%'' 會撈回全部客人（fail-open）。'
  '🔴 LINE 合成位址**刻意搜得到**（C 窗判、主視窗核）：那串仍是登入帳號，藏是為了畫面不顯示雜訊、不是讓紀錄找不到。'
  '🔴 本函式無任何 RAISE —— 搜尋詞是 PII、不得落 server log；空／全空白／長度 >120 一律回空清單，不擲例外（錯誤訊息會含輸入原文）。'
  '長度上限 120 與 MAX_ORDER_KEYWORD_LENGTH 同值（兩軸 UI 上限一致）。p_limit：NULL/<=0 → 100，硬夾 100；命中超過時只回前 p_limit 筆並 truncated=true（UI 必須顯示「結果太多請更精確」；不得改用 ids.length >= 上限 的啟發式）。'
  '除 owner 與 superuser 外，僅 service_role 可執行。';
-- ════════════════════════════════════════════════════════════════════════════
-- apply 守門(**刻意精簡** —— 只留「建不起來就不該上線」的結構性 fail-fast)
--
-- 🔴🔴 **這一段曾經有 200+ 行,而那是錯的設計。**(codex R3 `gpt-5.6-terra` 逐字)
--    「200 多行 DO 將**部署、資料探針、行為測試**混為一體,卻**仍只跑一次**,
--      **測試價值反而低於獨立腳本**。」
--    「真正應擋的是『**把 migration DO 宣稱為唯一驗證**』這個框架。」
--
-- ⚠️ **它是怎麼長成 200 行的**:R1 說「斷言不夠嚴」⇒ 加;R2 說「還是不夠嚴」⇒ 再加。
--    **兩輪都在同一個方向上加碼,而 R3(換模型)說那個方向從一開始就不對。**
--    🔴 判別句(給下一個折 finding 的人):
--    **我這輪的修改,是在回答【上一輪的問題】,還是在回答【原本的問題】?**
--
-- ⇒ **行為驗證全部搬到 `scripts/525-verify.sh`** —— 可重跑、fixture 驅動、非作者跑得動。
--    **本段只留四類**:①函式在 ②權限收斂 ③安全屬性沒漂 ④一次無 PII 的 smoke call。
--    🔴 **搬過去的不是「同一段程式碼換個地方」** —— migration 版只跑一次、
--       script 版每次都能跑,兩者的設計前提不同(R3 明文警告不要原封搬)。
--
-- ⚠️ **本檔的 SQL 仍未經執行**(本窗無 DB access)⇒ apply 成功之前不得宣稱「已驗證」。
-- ════════════════════════════════════════════════════════════════════════════
DO $mig$
DECLARE
  v_acl text;
  v_cnt integer;
  v_res jsonb;
BEGIN
  -- ① 函式存在且簽章正確(簽章錯的症狀是呼叫端 PGRST202,而那要到執行期才看得到)
  IF pg_catalog.to_regprocedure('public.admin_search_customers(text, integer)') IS NULL THEN
    RAISE EXCEPTION '#525:admin_search_customers(text, integer) 不存在;拒繼續';
  END IF;

  -- ② 權限閉世界:非 owner 的授權**恰好**是 service_role:EXECUTE,多一列少一列都紅。
  --    ⚠️ 這裡只看 `proacl` 的字面;**角色繼承造成的有效權限看不到**
  --       ⇒ 那一條在 `scripts/525-verify.sh`(逐角色問 `has_function_privilege`)。
  SELECT pg_catalog.string_agg(
           a.grantee::regrole::text || ':' || a.privilege_type
             || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
           ',' ORDER BY a.grantee::regrole::text, a.privilege_type)
    INTO v_acl
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = 'public.admin_search_customers(text, integer)'::regprocedure
     AND a.grantee <> p.proowner;
  IF COALESCE(v_acl, '') <> 'service_role:EXECUTE' THEN
    RAISE EXCEPTION '#525:acl 形狀是 [%],期望 service_role:EXECUTE;拒繼續', COALESCE(v_acl, '(空)');
  END IF;

  -- ③ 安全屬性沒漂:SECURITY DEFINER + 釘死的 search_path + STABLE。
  --    🔴 這三個是**建立當下就該對**的東西;漂掉的話這支函式的信任模型整個變了。
  SELECT pg_catalog.count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_search_customers(text, integer)'::regprocedure
     AND p.prosecdef
     -- 🔴 **實跑才發現的**:PG 實際存的是 `search_path=""`(帶跳脫的空字串),不是 `search_path=`。
     --    R1/R2 兩輪審查都沒抓到這條 —— **它不是推理錯,是【儲存格式】這種只有跑過才知道的事實。**
     --
     --    🔴🔴 **證據強度逐字寫清楚(E 窗 2026-08-16 獨立實測後改寫)**:
     --    **PG 17.10 實存 `search_path=""`,本斷言接受它(該分支已實測為 true);
     --      第二個分支 `search_path=` 未被觸發,其存在理由(其他 PG 版本)【未經驗證】。**
     --    E 窗在 17.10 上試了三種寫法:`SET search_path = ''` / `SET search_path TO ''`
     --    **兩種都產生 `search_path=""`**;正向對照 `SET search_path = pg_catalog`
     --    ⇒ `{search_path=pg_catalog}`(證明它改得動這個欄位、不是量具壞掉)。
     --    ⇒ **在 17.10 上第二分支是死碼。**
     --    ⚠️ **不得寫成「兩種編碼都驗過了」** —— 只驗過一種,另一種是**防禦性**的。
     --    ⚠️ **也不得因此把第二分支刪掉** —— **防禦性的東西本來就該恆綠**;
     --       要改的是【描述】,不是【程式碼】。
     AND p.proconfig::text[] && ARRAY['search_path=""', 'search_path=']
     AND p.provolatile = 's';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '#525:函式安全屬性不對(期望 SECURITY DEFINER + 釘死 search_path + STABLE);拒繼續';
  END IF;

  -- ④ smoke call:**空輸入**(無 PII)必須回 {ids:[], truncated:boolean}。
  --    🔴 這是「建起來但根本跑不動」與「跑得動但行為錯」的分界 ——
  --       **本段只負責前者**;行為對不對由 verify script 管。
  v_res := public.admin_search_customers('', 100);
  IF pg_catalog.jsonb_typeof(v_res) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(v_res -> 'ids') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(v_res -> 'truncated') IS DISTINCT FROM 'boolean'
     OR v_res -> 'ids' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION '#525:smoke call(空輸入)回傳不是 {ids:[], truncated:boolean};拒繼續';
  END IF;

  -- ⚠️ **這裡刻意【沒有】的東西,逐條寫出來,免得被讀成「驗過了」**:
  --    · 逃逸(% _ 反斜線)與數字軸空 needle 的 fail-open   → verify script
  --    · 排序穩定性與 truncated 的截斷語意                 → verify script
  --    · 正向對照(函式不是恆回空)                         → verify script(fixture 驅動)
  --    · 三支 trigram 索引的表達式形狀                      → verify script
  --    · anon / authenticated 的【有效】權限(含角色繼承)   → verify script
  --    · 函式體不得含 RAISE(PII 不落 log)                 → verify script(靜態掃描,不必等 apply)
  --    🔴 **這份清單本身就是「本段【不】保證什麼」的宣告。**
END
$mig$;
