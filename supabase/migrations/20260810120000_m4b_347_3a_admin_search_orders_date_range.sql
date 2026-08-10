-- M-4b #347-3a:`admin_search_orders` 加日期範圍(`p_from` / `p_to`)。
--
-- 承 #347-1(`20260809180000_m4b_347_1_admin_search_orders.sql`)。Sean Q14=A 拍板:
-- 「搜尋加日期範圍、未選預設近半年」;主視窗 2026-08-10 核 plan
-- `docs/specs/2026-08-10-347-3-search-date-range-plan.md`(切片 3a/3b/3c,本檔=3a)。
--
-- ── 🔴 這片不是「多一個篩選器」 ────────────────────────────────────────────────
-- #347-1 的取樣方式是「**先**取全域最新 100 筆命中,**才**與其他篩選取交集」
-- ⇒ `truncated=true` 時,真正要找的單可能整張落在那 100 筆之外、畫面顯示 0 筆。
-- `docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md:135` 當時明寫「不能靠把其他篩選下推進 RPC 解決 —— 那要動 RPC 簽章,
-- 而 Q14 已拍板日期參數隨 347-3」。**本檔就是那個下推**:日期述詞在 `LIMIT` 之前生效,
-- 取樣窗口因此從「全歷史最新 100」變成「這段期間內最新 100」。
--
-- ── 🔴 為什麼是 DROP + CREATE,不是 CREATE OR REPLACE ─────────────────────────
-- `CREATE OR REPLACE FUNCTION` **改不了參數個數** —— 多兩個帶預設值的參數會建出**第二支 overload**,
-- 而 PostgREST 是靠簽章挑函式的:挑錯就是 404 / 42501,錯誤長得像「搜尋壞了」而不是「挑錯 overload」。
-- 且 **GRANT 綁精確簽章** ⇒ 舊簽章會帶著自己那份 ACL 留在庫裡。
-- ⇒ 照 A8a2 既有前例(`DROP 5 參 + CREATE 6 參`):先 DROP 舊的,再建新的,斷言「恰好一支」。
--
-- ── 🔴 為什麼參數是 timestamptz 而不是 date ──────────────────────────────────
-- `orders.created_at` 是 timestamptz。若參數收 `date`,函式就得自己決定「8/10 是哪個時區的 8/10」——
-- 而台灣是 UTC+8,用 UTC 解釋會把台北時間 8/10 早上 8 點前的單算成 8/9。
-- 那個決定屬於**呼叫端**,不屬於 DB 函式。⇒ 本函式只認**絕對時刻**;
-- 時區換算與「近半年」預設都在 adapter(3b,plan §1-1 已核)。
--
-- 🔴🔴 **給 3b 的硬約束(codex 關卡1 2026-08-10 抓到,不照做就會差一天)**:
--   列表的日期欄是**固定 Asia/Taipei** 曆面(`order-list-view.ts` 的 `formatOrderListDate`,
--   它用 `Intl.DateTimeFormat` 釘死 `timeZone: 'Asia/Taipei'`)——**不是**瀏覽器時區、也不是 UTC。
--   ⇒ 3b 算邊界時**必須用台北午夜**:`2026-08-09T16:30Z` 在畫面上顯示 `08/10`,
--   若用 UTC 的 `08/10T00:00Z` 當起點,那張單會被**排除在外**,而員工看到的日期明明是 08/10。
--   「篩選與畫面是同一個量」是 plan §1-2 的整個理由,用錯時區就當場失效。
--
-- ── 🔴 半開區間 [p_from, p_to) ────────────────────────────────────────────────
-- `>= p_from` 且 `< p_to`。用 `<=` 配「當天 23:59:59」會在毫秒級漏單(timestamptz 有微秒精度);
-- 🔴 **UI 的「結束日」是含當天的**(員工選 8/10 就是要看到 8/10 的單)⇒ 3b 必須送
--    **下一個台北午夜**:選 8/10 ⇒ `p_to = 2026-08-11T00:00+08:00`。
--    plan v1 §3-5 原本寫「`p_to` 含當天」與本檔的 `<` 矛盾(codex 關卡1 抓到),plan 已改齊。
--    這條寫死在這裡,3b/3c 照著算,不要各自解釋。
--
-- ── 相容性 ────────────────────────────────────────────────────────────────────
-- 兩個新參數都有 `DEFAULT NULL`,且皆 NULL 時兩條述詞恆真 ⇒ **篩選結果與 #347-1 相同**
-- (不是「檔案逐字相同」——本檔多了日期述詞與括號;等價性由 harness 第 1 組實測釘住)。
-- ⚠️ 但 **PostgREST 是靠參數名挑 overload 的**,而舊簽章已被 DROP ⇒
--    **本檔 apply 之前,3b 的 adapter 不得上線**(未 apply 就送新參數 = 404 = 整個訂單列表進錯誤態,
--    與 A10c1 / D0 同族)。主視窗已把這個 apply 停點記入晨報批次定序。
--
-- 🔴 **本檔今晚不 apply**(夜跑規則④:migration 留 pending,早上 Sean 批)。
-- statement_timeout:引用 `20260809180000` 檔頭的實量值(service_role=300s / authenticator=8s),不重量。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 先 DROP 舊簽章 ────────────────────────────────────────────────────────
-- 🔴 不用 `IF EXISTS`:它**必須**存在(#347-1 已 apply 在正式站)。不存在就是前提被推翻,
--    那時候該停下來看清楚,而不是靜默往下建一支新的。
DROP FUNCTION public.admin_search_orders(text, integer);

-- ── 2. 建新簽章 ──────────────────────────────────────────────────────────────
-- 函式體 = #347-1 的函式體,**除了兩個 diff hunk 之外連空白都相同**(codex 關卡1 逐行比對確認):
--   ① 簽章多兩個參數;② WHERE 開頭插入日期述詞 + 把原本八個 OR 包進 `AND ( … )`。
-- 🔴 我是用程式抽出舊函式體再轉寫的,**不是手抄** —— 這片最容易出的錯就是
--    「宣稱逐字複製、其實漏一行」,而那種錯在測試層完全隱形。
CREATE FUNCTION public.admin_search_orders(
  p_query text,
  p_limit integer DEFAULT 100,
  p_from  timestamptz DEFAULT NULL,
  p_to    timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_needle text;
  v_limit  integer;
  v_ids    uuid[];
  v_found  integer;
BEGIN
  -- ── 0. 空輸入短路 ──────────────────────────────────────────────
  -- 🔴 全空白也算空(員工按了空白鍵)。回空清單、**不發查詢**。
  -- 🔴 `btrim(x)` 預設**只清 ASCII 空格** —— tab 與**全形空白 U+3000** 會整個穿過去
  --    (實測:`btrim(E'\t') <> ''` 為 true)。穿過去之後 v_needle 非空 ⇒ 不但白掃全表,
  --    還可能命中「地址裡剛好有 tab」的那幾張單。⇒ 修剪字元集必須顯式列出。
  --    ⚠️ 全形空白是台灣使用者輸入法下**很容易按到**的那顆,不是理論邊界(codex R1)。
  --    ⚠️ 還要清掉**貼上來的**那幾顆看不見的字元:U+00A0 不斷行空格(從網頁複製最常見)、
  --    U+202F 窄不斷行空格、U+200B 零寬空格、U+FEFF BOM。它們全都「看起來是空白」
  --    但 btrim 預設一顆都不清 ⇒ 使用者以為清空了,實際仍在掃全表(codex R2)。
  v_needle := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(p_query, ''), E' \t\r\n\u3000\u00a0\u202f\u200b\ufeff'));
  IF v_needle = '' THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 🔴 **長度閘**:超過 120 字元一律當作沒有結果。
  --    ⚠️ 它擋的是「超長輸入讓每一列的 strpos 變貴」,**不是**整體執行時間
  --    (那個本片綁不住;完整理由在 #347-1 檔頭「執行時間沒有被本片限住」那段)。
  --    120 的來源:料號、單號、姓名、電話、地址全部遠短於它 ⇒ 對真實使用者不可觸及。
  --    回空清單而不是丟錯:錯誤訊息**不得**含輸入原文,而「長度是 N」本身也是輸入的資訊。
  IF pg_catalog.length(v_needle) > 120 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ── 1. 上限:NULL 或 <= 0 → 100;超過 100 一律夾到 100 ────────────────
  -- 🔴 第一版寫成 `LEAST(GREATEST(COALESCE(p_limit,200),1),200)`,那會讓 `p_limit = 0` 回**一筆**,
  --    與檔頭合約寫的「<=0 → 200」矛盾(codex R1 抓到:註解說謊)。
  --    兩邊擇一時選**對齊已寫下的合約** —— 傳 0 多半是呼叫端的 bug 或「不想限制」的手勢,
  --    回一筆會讓人以為「只有一張單」,比回預設值糟。
  v_limit := CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN 100 ELSE LEAST(p_limit, 100) END;

  -- ── 2. 八維度比對(多取一筆用來判斷有沒有被截斷)──────────────────
  SELECT pg_catalog.array_agg(x.id ORDER BY x.created_at DESC, x.id DESC)
    INTO v_ids
    FROM (
      SELECT o.id, o.created_at
        FROM public.orders o
       WHERE
         -- ── #347-3a 日期範圍(半開區間 [p_from, p_to))────────────────────
         -- 🔴 **這兩行是本片存在的理由**,不是多一個篩選器:它們在 `LIMIT` **之前**生效
         --    ⇒ 取樣窗口從「全歷史最新 100 筆命中」變成「這段期間內最新 100 筆命中」。
         --    `docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md:135` 記過那個病:命中被全域前 100 截斷時,要找的單可能整張落在窗口外、
         --    畫面顯示 0 筆。下推日期是唯一能真的縮小那個窗口的辦法。
         -- 🔴 **半開區間**:`>= p_from` 且 `< p_to`。用 `<=` 配「當天 23:59:59」會在毫秒級漏單
         --    (timestamptz 有微秒精度);呼叫端要「含 8/10 整天」就送 `p_to = 8/11 00:00`。
         --    ⚠️ 時區的解釋權在**呼叫端**:本函式只認絕對時刻。理由見檔頭。
         -- 🔴 兩者皆 NULL ⇒ 兩條述詞都恆真 ⇒ 行為與 #347-1 **逐字相同**(向後相容)。
         -- 🔴 `p_from > p_to` ⇒ 條件無法同時成立 ⇒ 自然回零筆,**不擲例外**
         --    (使用者打得出這種輸入;而本函式擲任何例外都可能把 PII 帶進 log)。
         -- ⚠️ 這段註解**刻意避開那五個字母**:斷言 E 是對 `prosrc` 的**文字掃描**,
         --    連註解都算 —— 我第一版在這裡寫了那個詞,apply 當場被自己的守門擋下(實測)。
         (p_from IS NULL OR o.created_at >= p_from)
         AND (p_to IS NULL OR o.created_at < p_to)
         AND (
         -- ① 訂單編號
         pg_catalog.strpos(pg_catalog.lower(COALESCE(o.display_id, '')), v_needle) > 0

         -- ②③ 會員姓名 / 電話(🔴 join 欄是 customers.user_id,不是 customers.id)
         OR EXISTS (
              SELECT 1
                FROM public.customers c
               WHERE c.user_id = o.customer_user_id
                 AND (pg_catalog.strpos(pg_catalog.lower(COALESCE(c.name, '')), v_needle) > 0
                   OR pg_catalog.strpos(pg_catalog.lower(COALESCE(c.phone, '')), v_needle) > 0))

         -- ④ 收件快照三個子鍵。
         --    🔴 **三個分開比,不得先用 `||` 串起來再比**:串接會製造**跨欄假命中** ——
         --    姓名結尾 + 電話開頭剛好拼出搜尋詞時,那張單會被撈出來而兩個欄位其實都不含它。
         OR pg_catalog.strpos(pg_catalog.lower(COALESCE(o.shipping_address_snapshot ->> 'name', '')), v_needle) > 0
         OR pg_catalog.strpos(pg_catalog.lower(COALESCE(o.shipping_address_snapshot ->> 'phone', '')), v_needle) > 0
         OR pg_catalog.strpos(pg_catalog.lower(COALESCE(o.shipping_address_snapshot ->> 'line', '')), v_needle) > 0

         -- ⑤⑥⑦⑧ 品項層四維度。整包放進**一個** EXISTS:
         --    orders 一列只要有任一品項命中就算,而 EXISTS 不會讓 orders 出現重複列
         --    (改寫成 JOIN 的話,一張三品項的單會回三次、`array_agg` 就吐出重複 id)。
         OR EXISTS (
              SELECT 1
                FROM public.order_items oi
               WHERE oi.order_id = o.id
                 AND (
                   -- ⑤ 料號
                   pg_catalog.strpos(pg_catalog.lower(COALESCE(oi.variant_sku, '')), v_needle) > 0
                   -- ⑥ 品名(快照 {sku, spec, title})
                   OR pg_catalog.strpos(pg_catalog.lower(COALESCE(oi.product_snapshot ->> 'title', '')), v_needle) > 0
                   -- ⑦ 品牌:variant → product → brand 三跳
                   OR EXISTS (
                        SELECT 1
                          FROM public.product_variants pv
                          JOIN public.products pr ON pr.id = pv.product_id
                          JOIN public.brands    br ON br.id = pr.brand_id
                         WHERE pv.id = oi.variant_id
                           AND pg_catalog.strpos(pg_catalog.lower(COALESCE(br.name, '')), v_needle) > 0)
                   -- ⑧ 供應商單號
                   OR EXISTS (
                        SELECT 1
                          FROM public.order_item_procurement pc
                         WHERE pc.order_item_id = oi.id
                           AND pg_catalog.strpos(pg_catalog.lower(COALESCE(pc.supplier_order_no, '')), v_needle) > 0)))
         )
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT v_limit + 1
    ) AS x;

  -- ── 3. 組回傳 ────────────────────────────────────────────────────
  -- 🔴 `array_length(NULL, 1)` 與空陣列都回 NULL ⇒ 零命中走這一條,不是掉進下面的比較。
  v_found := COALESCE(pg_catalog.array_length(v_ids, 1), 0);
  IF v_found = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  IF v_found > v_limit THEN
    -- 多撈到的那一筆只用來證明「還有更多」,**不回給呼叫端**。
    RETURN pg_catalog.jsonb_build_object(
      'ids', pg_catalog.to_jsonb(v_ids[1:v_limit]),
      'truncated', true);
  END IF;

  RETURN pg_catalog.jsonb_build_object('ids', pg_catalog.to_jsonb(v_ids), 'truncated', false);
END;
$fn$;
-- ── ACL:只有 service_role(admin server)可執行 ─────────────────────────────
-- 🔴 這支能跨**全部**訂單比對 PII ⇒ 任何 client 端角色拿到 EXECUTE 都是把整份客戶資料開放查詢。
--    admin 走 `createSupabaseServiceClient()`(service_role)⇒ 只給它,其餘一律 REVOKE。
-- 🔴 **GRANT 綁精確簽章**:PostgREST 靠簽章找 overload,參數名/型別漂一個字就 404/42501,
--    而 migration 本身照樣全綠(對齊 `20260807150000_…w1_shipping_rpc_skeletons.sql` 的同一課)。
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) IS
  'M-4b #347-3a:後台訂單搜尋。八維度(訂單編號 / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 品牌 / 供應商單號)子字串比對,回 {"ids": uuid[], "truncated": bool}。🔴 只回 order id —— PII 只在 SQL 內比對,不進讀模型、不進 RSC payload(這是本片存在的理由:shipping_address_snapshot 在鐵則 12 的 forbidden 清單裡,擴投影等於拆守門)。🔴 用 strpos() 不用 ILIKE:輸入一律當字面字串,`%` 與 `_` 不是萬用字元(否則搜一個 % 會撈出全部訂單)。🔴 本函式無任何 RAISE —— 搜尋詞本身是 PII,不得落進 server log。空字串/全空白 → 回空清單、不發查詢(不是回全部)。p_limit:NULL 或 <=0 → 100,硬夾上限 100(對齊下游 .in() 的 URL 長度上限 SUPPLIER_ORDER_NO_MATCH_CAP=100);命中超過上限時只回前 p_limit 筆並 truncated=true(UI 必須顯示「結果太多請更精確」——靜默截斷會讓員工以為就這幾筆)。不做全表 count(那是每次搜尋多掃一次全表)。join 欄名注意:orders.customer_user_id 參照的是 customers.user_id,不是 customers.id。⚠️ 效能:逐列子字串掃描、索引幫不上忙;訂單量每月 100-300 筆下是毫秒級,orders 破約 5 萬列或員工回報變慢時改掛 pg_trgm GIN。p_from/p_to:**半開區間 [p_from, p_to)**、皆 timestamptz、皆可為 NULL(NULL=該側不限)。兩者皆 NULL 時兩條述詞恆真 ⇒ 篩選結果與 #347-1 相同(harness `scripts/347-3a-verify.sh` 第 1 組用「與省略參數的回傳逐字比對」釘住)。🔴 日期述詞在 LIMIT 之前生效 ⇒ 取樣窗口是「這段期間內最新 p_limit 筆」而不是「全歷史最新 p_limit 筆」——這正是 #347-3 存在的理由(見 docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md:135)。🔴 時區解釋權在呼叫端:本函式只認絕對時刻,「近半年」預設與台北曆面換算都在 adapter(#347-3b)。🔴 p_from > p_to ⇒ 自然回零筆、不擲例外(使用者打得出這種輸入,而本函式擲任何例外都可能把 PII 帶進 log)。除 owner(postgres)與 superuser 外,僅 service_role 可執行(owner/superuser 本來就無視 ACL,斷言 C-3 也明文排除它們——寫「僅 service_role」會比實際 ACL 邊界大)。';


-- ── fail-closed 斷言(任一異常 → 整檔 ROLLBACK)───────────────────────────────
-- 🔴 本檔自包 BEGIN…COMMIT:沒有它的話 `psql -f` 會逐句 autocommit,
--    函式與 ACL 早就留在 DB 上了,斷言擋不住任何東西。
DO $$
BEGIN
  -- A. 單一 signature:overload 會讓 PostgREST 選到別支,而兩支的 ACL 各自獨立。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_search_orders') <> 1 THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 不是恰好一支(overload?);拒繼續';
  END IF;

  -- A-2. 🔴 **#347-3a 專屬:參數真的是四個、名字也對**。
  --      只驗「恰好一支」擋不住「DROP 之後又建回兩參數那支」——那樣 count 仍是 1,
  --      而 3b 送 `p_from` 會 404。PostgREST 是**靠參數名**挑 overload 的,
  --      所以名字漂一個字與少一個參數是同一種故障(#347-1 檔頭 ACL 段記過同一課)。
  -- ⚠️ `pronargs = 4` 被上面那個精確 `regprocedure` **嚴格蘊含**、零獨立判別力
  --    (codex 關卡1 指出)⇒ 拿掉。真正缺的是**預設值**那一軸,補在下面 A-3。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.proargnames = ARRAY['p_query','p_limit','p_from','p_to']
  ) THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 的參數名稱不符(PostgREST 靠名字挑,3b 會 404);拒繼續';
  END IF;

  -- A-3. 🔴 **三個參數都要有預設值,而且 p_from/p_to 的預設必須是 NULL**(codex 關卡1 must-fix)。
  --      這條擋兩種都不會有任何執行期訊號的改法:
  --      ① 拿掉 `DEFAULT NULL` ⇒ 舊 adapter(只送 p_query/p_limit)當場 **404**
  --         —— PostgREST 只有在參數有預設值時才允許省略;
  --      ② 改成 `DEFAULT now()` 之類 ⇒ 舊 adapter **沉默地被套上日期範圍**,
  --         畫面少單而沒有任何錯誤,是這片最貴的失敗模式。
  --      `pronargdefaults` 是「帶預設的參數個數」,`pg_get_expr(proargdefaults,…)` 是預設值的字面。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.pronargdefaults = 3
       -- 🔴 用 `pg_get_function_arg_default(oid, n)`,**不是** `pg_get_expr(proargdefaults, oid)`:
       --    後者對函式預設值回**空字串**(它的第二參數要的是 relation OID,函式沒有)。
       --    我第一版寫的正是後者 ⇒ 本斷言當場擋下 apply(2026-08-10 本機 PG17 實測),
       --    下面三個字面也是同一次實測抄回來的,不是憑印象寫的。
       AND pg_catalog.pg_get_function_arg_default(p.oid, 2) = '100'
       AND pg_catalog.pg_get_function_arg_default(p.oid, 3) = 'NULL::timestamp with time zone'
       AND pg_catalog.pg_get_function_arg_default(p.oid, 4) = 'NULL::timestamp with time zone'
  ) THEN
    RAISE EXCEPTION '#347-3a:預設參數不符(p_limit=100 且 p_from/p_to 必須 DEFAULT NULL);拒繼續';
  END IF;

  -- B. owner=postgres、SECURITY DEFINER、search_path 固定空。
  -- 🔴 字面注意:`SET search_path = ''` 在 proconfig 存成 `search_path=""`(含兩個雙引號),
  --    不是 `search_path=`。寫錯這個字面 ⇒ 斷言恆假、apply 被自己的守門擋下
  --    (對齊 `20260809160000` 的 2a 與 `20260723120000` 的 3a,兩片都實測踩過)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 的 owner/SECDEF/search_path 不符;拒繼續';
  END IF;

  -- C. ACL:**allowlist 而非黑名單**。只列舉已知的壞角色的話,
  --    「未被列舉的新角色」拿到 EXECUTE 不會被任何人發現。
  --    ⇒ 條件寫成「owner 與 service_role 以外零 grantee」。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p,
           LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.grantee <> 0                                   -- 0 = PUBLIC,下一條單獨擋(訊息才分得出來)
       AND a.grantee <> 'service_role'::regrole
  ) THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 有 service_role 以外的 grantee;拒繼續';
  END IF;
  IF has_function_privilege('public', 'public.admin_search_orders(text, integer, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 對 PUBLIC 可執行(REVOKE 沒生效?);拒繼續';
  END IF;

  -- C-2. 🔴 **`WITH GRANT OPTION` 收不回來**(codex R1)。
  --      ⚠️ #347-3a 更正(codex 關卡1 2026-08-10):本檔是 **DROP + CREATE**,新函式一開始 ACL 是空的
  --      ⇒ 原本那條「`CREATE OR REPLACE` 保留舊 ACL」的路徑在本檔**不存在**。
  --      本條現在守的是**別的東西**:default privileges、或本檔 GRANT 之後有人再加 grant option。
  --      留著它不是形式主義 —— 它是這支函式日後被 `CREATE OR REPLACE` 改寫時的唯一防線。
  --      (舊註解原文:若這支函式先前存在、且有人給過
  --      `GRANT EXECUTE … TO service_role WITH GRANT OPTION`,`CREATE OR REPLACE` 保留舊 ACL,
  --      而上面那條把 service_role 整個排除掉 ⇒ 看不見。有 grant option 的角色可以把 EXECUTE
  --      再轉發給任何人,等於 ACL allowlist 從此不再是真相。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p,
           LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.is_grantable
  ) THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 有帶 GRANT OPTION 的 grantee(可再轉發);拒繼續';
  END IF;

  -- C-3. 🔴 **有效權限,不是 ACL 字面**(codex R1):`GRANT service_role TO anon` 這種**角色繼承**
  --      會讓 anon 拿到 service_role 的全部權限,而上面兩條看 `proacl` **完全看不到** ——
  --      acl 裡只有 service_role 一列,一切正常。
  --      `has_function_privilege` 算的是**繼承後的有效權限** ⇒ 這條才擋得住。
  --      ⚠️ 這也是「守門畫在哪個面」的例子:前兩條守的是 ACL 字面,這條守的是**真正能不能執行**。
  -- 🔴 **不列舉角色名**(codex R2):第一版只檢查 anon / authenticated ——
  --    `authenticator`、或任何日後新增而繼承了 service_role 的角色,都會整個穿過去。
  --    改成掃**所有角色**:除了 owner、service_role 與超級使用者(superuser 無視 ACL,
  --    列進來只會讓斷言恆假),任何角色的**有效**權限都不得是可執行。
  DECLARE
    v_role text;
  BEGIN
    SELECT r.rolname INTO v_role
      FROM pg_catalog.pg_roles r, pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND NOT r.rolsuper
       AND r.oid <> p.proowner
       AND r.rolname <> 'service_role'
       AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
     LIMIT 1;
    IF v_role IS NOT NULL THEN
      RAISE EXCEPTION '#347-3a:角色 % 有效可執行 admin_search_orders(直接 GRANT 或角色繼承);拒繼續', v_role;
    END IF;
  END;

  -- D. 正向:service_role **必須**執行得了。
  --    🔴 少了這條,把 GRANT 整行刪掉時 A-C 全綠(零 grantee 更「安全」)而功能全死。
  IF NOT has_function_privilege('service_role', 'public.admin_search_orders(text, integer, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '#347-3a:service_role 執行不了 admin_search_orders(GRANT 漏了?);拒繼續';
  END IF;

  -- E. 搜尋詞不落 log:函式本體不得出現任何 RAISE。
  --    🔴 這條是**字面守門**,擋的是「日後有人加一句 RAISE NOTICE 除錯」——
  --    那會把員工搜的客人姓名/電話/地址寫進 server log,本片最主要的設計理由當場失效。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.prosrc ~* '\mRAISE\M'
  ) THEN
    RAISE EXCEPTION '#347-3a:admin_search_orders 函式體出現 RAISE(搜尋詞可能落進 log);拒繼續';
  END IF;

  -- F. 🔴 **FORCE ROW LEVEL SECURITY 會把 SECDEF 自己擋死**(同族 a2b1:298 / a5a:580 / a4a:566
  --    都有這一道,本片 R3 才補上)。本函式以 definer 身分讀 7 張表;任何一張日後開了 FORCE,
  --    連 owner 都會被自己的 policy 過濾 ⇒ **搜尋靜默漏單**,而且
  --    **superuser 跑的 harness 永遠看不到**(superuser 不受 RLS 影響)⇒ 只有這道斷言擋得住。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid IN ('public.orders'::regclass,
                   'public.customers'::regclass,
                   'public.order_items'::regclass,
                   'public.product_variants'::regclass,
                   'public.products'::regclass,
                   'public.brands'::regclass,
                   'public.order_item_procurement'::regclass)
       AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION '#347-3a:搜尋讀到的表有人開了 FORCE ROW LEVEL SECURITY(definer 會被自己擋死、搜尋靜默漏單);拒繼續';
  END IF;

  RAISE NOTICE '#347-3a 斷言通過:單一 signature(四參數) + SECDEF/search_path + ACL allowlist(僅 service_role)+ 函式體零 RAISE + 七張讀取表無 FORCE RLS';
END $$;

COMMIT;
