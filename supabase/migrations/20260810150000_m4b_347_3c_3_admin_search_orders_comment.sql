-- M-4b #347-3c-3:修正 `admin_search_orders` 的 `COMMENT ON FUNCTION` —— **只改註解,不動函式**。
--
-- ── 為什麼要有這一支 ─────────────────────────────────────────────────────────
-- #347-3a 的 COMMENT 逐字寫著「『近半年』預設與台北曆面換算都在 adapter(#347-3b)」。
-- 那句在 3a apply 的當下是計畫,但 **#347-3b 實作時被推翻**(plan §1-1 有推翻框、主視窗核):
-- 預設改由**篩選列的下拉**承擔(#347-3c-2 已上線),adapter 沒給日期就是不限期間。
-- ⇒ 正式站 catalog 上掛著一句**不成立的合約**,而 `COMMENT` 是下一個人查函式語意時
--    最先讀到的東西(比 migration 檔更容易被當成現況)。
--
-- 🔴 **本檔零行為變更**:不 DROP、不 CREATE、不 ALTER、不動 GRANT、不動函式本體。
--    **實跑證據**(本機 vanilla PG17 拋棄庫):把 COMMENT 還原成 3a 版 → 跑本檔 →
--    舊字面消失、新字面出現。
--    ⚠️ 我原本還舉「`md5(pg_proc.prosrc)` 前後相同」當證據 —— **那是恆真的**(R2 指出):
--    `COMMENT` 在構造上改不到 `prosrc`。真正證「零行為變更」的是**全檔沒有任何
--    CREATE / ALTER / DROP / GRANT 敘述**,那是讀得出來的。
--
-- ── 🔴 為什麼是「整份逐字相等」才覆蓋,而不是「含那句就改」(codex 關卡2 must-fix)──
-- `COMMENT ON` 是**整份取代**。只驗「舊句還在」的話,別人改了註解的**其他段落**、
-- 而那一句剛好沒動 ⇒ 守門放行 ⇒ 我把他的修改整段清掉。
-- ⇒ 前置改成**與 pre-image 逐字相等**才動。fail-closed 的方向是「不覆蓋」——
--    覆蓋掉別人的修正,比留著我這句舊帳糟得多。
-- ⚠️ 代價誠實寫:catalog 上只要有**任何**人工微調,本檔就會停下來要人處理。那是刻意的。
--
-- ── 🔴 為什麼用 regprocedure 而不是 proname + proargnames(同上,must-fix)──────
-- `COMMENT ON FUNCTION` 是靠**型別簽章**選目標,而用參數名去找可能命中**別的 overload**
-- ⇒ 驗了一個 OID、寫到另一個。改成 `'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure`
--    = 守門與寫入**指同一個東西**(找不到就直接 42883、不會靜默跑掉)。
--
-- ── 🔴 `v_expected` 是 **catalog 快照**,不是 3a 原始碼的副本 ────────────────────
-- 它記的是 **3a apply 當下寫進正式站的那份字**。3a 的原始碼日後若有人修 typo,
-- **不得**把改動同步進來 —— 原始碼改動不會回寫 catalog,同步了這支就對正式站**永遠**比不過。
-- (repo 內確實因此有同一段長文兩份;替代做法是只存 md5,但那樣擋下來時看不到原文。
--  取捨已評估:留原文、並用這段字擋住「順手同步」那個直覺。)
--
-- ── rollback ────────────────────────────────────────────────────────────────
-- 🔴 **revert commit 不會還原 DB**(apply 之後)。要回滾請下一支 guarded `COMMENT ON FUNCTION`
--    把 catalog 寫回 3a 的完整字面(pre-image 就是本檔 `v_expected` 的內容);
--    不要手改 catalog —— 那會讓下一支的 pre-image 比對失效。
-- 🔴 **本檔刻意不可重跑**(與 3a 同性質):跑第二次會被前置擋下並 RAISE。**實跑驗過**。

-- ── ⚠️ 兩條誠實邊界 ──────────────────────────────────────────────────────────
-- ① **逐字相等是同交易內的檢查,不含跨交易競態**:讀 `obj_description` 不持物件鎖,
--    `COMMENT ON` 才拿 ShareUpdateExclusive ⇒ 理論上有 TOCTOU 窗。apply 是單一操作者 ⇒ 不可達,
--    但別把這道守門說成「任何情況下都不會蓋掉別人的修改」。
-- ② **`supabase db push` 選不了單一檔案** ⇒ 推這支會連帶推同批 pending 的其他 migration。
--    送批准時**必須逐支列名**,不能說成「只是一支改註解的」。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_oid oid;
  v_current text;
  v_expected text := 'M-4b #347-3a:後台訂單搜尋。八維度(訂單編號 / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 品牌 / 供應商單號)子字串比對,回 {"ids": uuid[], "truncated": bool}。🔴 只回 order id —— PII 只在 SQL 內比對,不進讀模型、不進 RSC payload(這是本片存在的理由:shipping_address_snapshot 在鐵則 12 的 forbidden 清單裡,擴投影等於拆守門)。🔴 用 strpos() 不用 ILIKE:輸入一律當字面字串,`%` 與 `_` 不是萬用字元(否則搜一個 % 會撈出全部訂單)。🔴 本函式無任何 RAISE —— 搜尋詞本身是 PII,不得落進 server log。空字串/全空白 → 回空清單、不發查詢(不是回全部)。p_limit:NULL 或 <=0 → 100,硬夾上限 100(對齊下游 .in() 的 URL 長度上限 SUPPLIER_ORDER_NO_MATCH_CAP=100);命中超過上限時只回前 p_limit 筆並 truncated=true(UI 必須顯示「結果太多請更精確」——靜默截斷會讓員工以為就這幾筆)。不做全表 count(那是每次搜尋多掃一次全表)。join 欄名注意:orders.customer_user_id 參照的是 customers.user_id,不是 customers.id。⚠️ 效能:逐列子字串掃描、索引幫不上忙;訂單量每月 100-300 筆下是毫秒級,orders 破約 5 萬列或員工回報變慢時改掛 pg_trgm GIN。p_from/p_to:**半開區間 [p_from, p_to)**、皆 timestamptz、皆可為 NULL(NULL=該側不限)。兩者皆 NULL 時兩條述詞恆真 ⇒ 篩選結果與 #347-1 相同(harness `scripts/347-3a-verify.sh` 第 1 組用「與省略參數的回傳逐字比對」釘住)。🔴 日期述詞在 LIMIT 之前生效 ⇒ 取樣窗口是「這段期間內最新 p_limit 筆」而不是「全歷史最新 p_limit 筆」——這正是 #347-3 存在的理由(見 docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md:135)。🔴 時區解釋權在呼叫端:本函式只認絕對時刻,「近半年」預設與台北曆面換算都在 adapter(#347-3b)。🔴 p_from > p_to ⇒ 自然回零筆、不擲例外(使用者打得出這種輸入,而本函式擲任何例外都可能把 PII 帶進 log)。除 owner(postgres)與 superuser 外,僅 service_role 可執行(owner/superuser 本來就無視 ACL,斷言 C-3 也明文排除它們——寫「僅 service_role」會比實際 ACL 邊界大)。';
BEGIN
  -- 🔴 與 `COMMENT ON FUNCTION` 同一種選法(型別簽章)。不存在 ⇒ 直接擲,不靜默。
  v_oid := 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure;

  SELECT obj_description(v_oid, 'pg_proc') INTO v_current;

  IF v_current IS NULL THEN
    RAISE EXCEPTION '#347-3c-3:目標函式沒有 COMMENT —— 現況與 pre-image 不符,拒覆蓋';
  END IF;

  IF v_current IS DISTINCT FROM v_expected THEN
    -- 🔴 帶 md5 指紋(R2 consider):逐字相等的閘越嚴,被擋下的機率越高;
    --    只說「不一樣」的話,操作者當天還要另開 session 才知道差在哪。註解非 PII,可安全印。
    RAISE EXCEPTION '#347-3c-3:catalog 上的 COMMENT 與 pre-image 不是逐字相同 —— 有人改過(或本檔已跑過),拒覆蓋。current md5=% expected md5=%',
      md5(v_current), md5(v_expected);
  END IF;
END
$$;

COMMENT ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) IS
  'M-4b #347-3a:後台訂單搜尋。八維度(訂單編號 / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 品牌 / 供應商單號)子字串比對,回 {"ids": uuid[], "truncated": bool}。🔴 只回 order id —— PII 只在 SQL 內比對,不進讀模型、不進 RSC payload(這是本片存在的理由:shipping_address_snapshot 在鐵則 12 的 forbidden 清單裡,擴投影等於拆守門)。🔴 用 strpos() 不用 ILIKE:輸入一律當字面字串,`%` 與 `_` 不是萬用字元(否則搜一個 % 會撈出全部訂單)。🔴 本函式無任何 RAISE —— 搜尋詞本身是 PII,不得落進 server log。空字串/全空白 → 回空清單、不發查詢(不是回全部)。p_limit:NULL 或 <=0 → 100,硬夾上限 100(對齊下游 .in() 的 URL 長度上限 SUPPLIER_ORDER_NO_MATCH_CAP=100);命中超過上限時只回前 p_limit 筆並 truncated=true(UI 必須顯示「結果太多請更精確」——靜默截斷會讓員工以為就這幾筆)。不做全表 count(那是每次搜尋多掃一次全表)。join 欄名注意:orders.customer_user_id 參照的是 customers.user_id,不是 customers.id。⚠️ 效能:逐列子字串掃描、索引幫不上忙;訂單量每月 100-300 筆下是毫秒級,orders 破約 5 萬列或員工回報變慢時改掛 pg_trgm GIN。p_from/p_to:**半開區間 [p_from, p_to)**、皆 timestamptz、皆可為 NULL(NULL=該側不限)。兩者皆 NULL 時兩條述詞恆真 ⇒ 篩選結果與 #347-1 相同(harness `scripts/347-3a-verify.sh` 第 1 組用「與省略參數的回傳逐字比對」釘住)。🔴 日期述詞在 LIMIT 之前生效 ⇒ 取樣窗口是「這段期間內最新 p_limit 筆」而不是「全歷史最新 p_limit 筆」——這正是 #347-3 存在的理由(見 docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md:135)。🔴 時區解釋權在呼叫端:本函式只認絕對時刻。台北曆面換算在 domain 的 date-range.ts(#347-3b);「近半年」**預設**由 admin 的頁層套用(`order-list-view.ts` 的 `resolveOrderDateRange`,#347-3c-2;篩選列的下拉只是把它**顯示**成選中)、**不在 adapter** —— adapter 沒給日期就是不限期間,不會自己補一段。(原字面說預設在 adapter,#347-3b 實作時已改由 UI 承擔:預設要是看得見、改得動的選單狀態,不是隱形過濾。)🔴 p_from > p_to ⇒ 自然回零筆、不擲例外(使用者打得出這種輸入,而本函式擲任何例外都可能把 PII 帶進 log)。除 owner(postgres)與 superuser 外,僅 service_role 可執行(owner/superuser 本來就無視 ACL,斷言 C-3 也明文排除它們——寫「僅 service_role」會比實際 ACL 邊界大)。';

-- ── 事後斷言:換過去了、而且舊字面真的不在 ────────────────────────────────────
DO $$
DECLARE
  v_after text;
BEGIN
  SELECT obj_description('public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure, 'pg_proc') INTO v_after;

  -- 🔴 先擋 NULL(codex nit):`position(… IN NULL)` 回 NULL ⇒ 兩個 IF 都不會觸發 = 守門靜默失效。
  IF v_after IS NULL THEN
    RAISE EXCEPTION '#347-3c-3:覆蓋後讀不到 COMMENT;拒繼續';
  END IF;
  IF position('🔴 時區解釋權在呼叫端:本函式只認絕對時刻,「近半年」預設與台北曆面換算都在 adapter(#347-3b)。' IN v_after) > 0 THEN
    RAISE EXCEPTION '#347-3c-3:過期字面還在,COMMENT 沒被換掉';
  END IF;
  IF position('🔴 時區解釋權在呼叫端:本函式只認絕對時刻。台北曆面換算在 domain 的 date-range.ts(#347-3b);「近半年」**預設**由 admin 的頁層套用(`order-list-view.ts` 的 `resolveOrderDateRange`,#347-3c-2;篩選列的下拉只是把它**顯示**成選中)、**不在 adapter** —— adapter 沒給日期就是不限期間,不會自己補一段。(原字面說預設在 adapter,#347-3b 實作時已改由 UI 承擔:預設要是看得見、改得動的選單狀態,不是隱形過濾。)' IN v_after) = 0 THEN
    RAISE EXCEPTION '#347-3c-3:新字面不在 COMMENT 裡,覆蓋沒生效';
  END IF;
END
$$;

COMMIT;
