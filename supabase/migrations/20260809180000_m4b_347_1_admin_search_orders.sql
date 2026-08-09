-- ============================================================
-- M-4b #347-1:後台訂單搜尋 — `public.admin_search_orders(text, integer)`
-- ============================================================
-- 真權威:`docs/specs/2026-07-25-search-engine-options-recon.md` 的 recon + 主視窗 D-371-A / D-373-A 的施工要點。
-- 批准:Sean 拍板 **Q1=A**(RPC 只回 order id 清單、列表再 `.in('id', ids)` 取資料)
--       + **Q2=A**(八個搜尋維度全上,含 PII 維度),經主視窗轉達。
--       回傳形狀 `{ids, truncated}` + `LIMIT p_limit + 1` 技法(不做全表 count)= D-373-A 核准。
--
-- 鐵則 12 ②(權限:SECURITY DEFINER + GRANT)。**本片只建函式,零 schema 變更、零資料寫入。**
--
-- ── 🔴🔴 為什麼是 RPC,而不是把欄位加進列表投影 ─────────────────────────────
-- ① `shipping_address_snapshot` **就在鐵則 12 的 forbidden 清單裡**
--    (`packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts` 的 forbidden 陣列)。
--    把它加進 `ADMIN_ORDER_LIST_SELECT` 去做前端過濾 = **親手拆掉那道守門**。
-- ② 八個維度裡有三個在**內嵌層**(品項、品牌、採購),而內嵌層 filter 的語意押在
--    **本專案無法實測**的 PostgREST 行為上 —— `SupabaseOrderAdapter.ts:542-546` 的註解逐字說明過(#347-2a 推移後重量)
--    (本機是裸 PG、沒有 PostgREST)。
-- ⇒ 走 RPC 之後,**PII 只在 SQL 內被比對,一個字都不進讀模型、不進 RSC payload**。
--    函式只吐 `orders.id` 的陣列 —— id 本身不是 PII。
--
-- ── 🔴 為什麼八個維度全上(Q2=A 的三條理由,主視窗要求逐字寫進檔頭)────────────
-- ① Sean 的原話**逐字列了電話與地址** ⇒ 這是既有拍板,不重問。
-- ② 走 RPC 時 PII 只在 SQL 內比對、不進讀模型不進 payload(見上)⇒ 加維度不等於加曝露面。
-- ③ 日後要拿掉只是刪兩個 OR 分支 —— 可逆、成本低。
--
-- ── 八個維度與它們的落點(**逐欄對實庫查證過**,非憑記憶)────────────────────
--   ① `orders.display_id`                              訂單編號
--   ② `customers.name`                                 會員姓名
--   ③ `customers.phone`                                會員電話
--   ④ `orders.shipping_address_snapshot`               收件快照 jsonb:`{name, phone, line}`
--   ⑤ `order_items.variant_sku`                        料號(員工第一優先)
--   ⑥ `order_items.product_snapshot ->> 'title'`       品名(快照 = `{sku, spec, title}`)
--   ⑦ `brands.name`                                    品牌(經 `order_items.variant_id → product_variants
--                                                       → products.brand_id → brands`)
--       🔴 **已知缺口(codex R1,無法在本層修)**:`order_items.variant_id` 的 FK 是
--       `ON DELETE SET NULL` ⇒ 商品變體被刪掉之後,那張歷史訂單**再也連不到品牌**,
--       用品牌搜就是漏單。`product_snapshot` 只存 `{sku, spec, title}`、**不含品牌**,
--       所以沒有可以退而求其次的來源。要根治得在下單時把品牌寫進快照(改 create_order = 另一片)。
--       ⚠️ 這是**已測的**限制,不是未知數:harness B19 用 `variant_id = NULL` 明確釘住這個行為,
--       將來有人改快照結構時那格會提醒他這裡可以一起修好。
--   ⑧ `order_item_procurement.supplier_order_no`       供應商單號
--
-- 🔴 **join 欄名逐條驗自 `packages/adapters/src/supabase/database.types.ts` 的 Relationships 段**:
--    `order_items.order_id → orders.id` / `order_items.variant_id → product_variants.id` /
--    `product_variants.product_id → products.id` / `products.brand_id → brands.id` /
--    **`orders.customer_user_id → customers.user_id`**。
--    ⚠️ 最後一條與直覺不同 —— `customers` 在這個 FK 上的被參照欄是 **`user_id`,不是 `id`**
--    (`orders_customer_user_id_fkey`)。寫成 `c.id = o.customer_user_id` 會直接 42703 或永遠零命中。
--
-- ── 🔴 搜尋詞不落 log(施工要點,硬線)──────────────────────────────────────
-- 本函式**沒有任何 `RAISE`**。理由:員工搜尋的內容本身就是 PII(客人姓名、電話、地址),
-- 而 `RAISE` 的訊息會進 PostgreSQL 的 server log、也會進 Supabase 的 log 介面
-- ⇒ 一旦把輸入原文放進訊息,就等於**把 PII 從「只在 SQL 內比對」變成「持久落在 log 裡」**,
--    本片最主要的設計理由當場失效。連 `RAISE NOTICE`(除錯用)都不留。
-- ⚠️ 任何人日後想加錯誤訊息:**訊息裡不得含 `p_query` 或由它衍生的值**(長度、前綴都不行)。
-- ⚠️ **斷言 E 的實力邊界**(R3 nit):它掃的是函式體裡有沒有 `RAISE` —— 擋不住
--    `INSERT INTO 某張表`、`pg_notify()`、寫進暫存表這類外洩路徑。它是「最常見那條路的守門」,
--    不是「搜尋詞不可能外流」的證明。
--
-- 🔴🔴 **這條防護擋得住什麼、擋不住什麼(誠實寫死,不要讓名字大於實力)**:
--   擋得住 —— **本函式自己**不會把搜尋詞寫進任何 log。
--   ⚠️ **擋不住** —— 呼叫端那一行本來就含參數。若 Supabase 開了
--     `log_min_duration_statement` / `auto_explain` / `pgaudit`,PostgREST 打過來的
--     `SELECT public.admin_search_orders('王小明', 200)` **會整句進 log,參數就在裡面**。
--     那不是這支函式控制得了的面。
--   ⇒ 想要「搜尋詞真的不落 log」,**必須另外確認那三個設定是關的** —— 這片沒有驗過它們
--     (本機是裸 PG、不是 Supabase)。**不得**把本片的斷言 E 當成「搜尋詞不會外流」的證據:
--     它證明的只有「函式體零 RAISE」。
--   🔴 **347-2 接線時的硬要求(這條是可執行的,不是免責聲明)**:呼叫端**必須用 POST**。
--     PostgREST 的 RPC 也吃 `GET /rpc/admin_search_orders?p_query=王小明` ——
--     那會讓搜尋詞進**網址**,而網址會落進 access log、CDN log、瀏覽器歷史與 Referer。
--     `supabase-js` 的 `.rpc()` 預設就是 POST ⇒ 照常用即可;**不得**為了快取或好 debug 改成 GET。
--   ⚠️ 另一面反而是安全的:`v_needle` 在函式內是 plpgsql 變數、以參數送進查詢計畫
--     ⇒ **不會**出現在 `pg_stat_statements` 的 query text 裡(那裡看到的是 `$1`)。
--
-- ── 🔴 為什麼用 `strpos()` 而不是 `ILIKE`(這是行為決定,不是風格)────────────
-- `ILIKE '%' || p_query || '%'` 會讓輸入裡的 `%` 與 `_` **變成萬用字元**:
-- 員工搜「A_B」會意外命中「AxB」,而搜單一個 `%` 會命中**全部訂單**(等於把整份 PII 一次撈出來)。
-- 要修得逃脫三個字元、還要記得配 `ESCAPE`,漏一個就是上面那個洞。
-- `strpos(haystack, needle) > 0` **沒有萬用字元語意** ⇒ 輸入一律當字面字串,不需要逃脫。
-- ⚠️ 用 `strpos()` 而不是 `position(needle IN haystack)`:後者是 **SQL 語法不是函式**,
--    在 `search_path = ''` 下沒辦法加 `pg_catalog.` 前綴(實測 42601)。兩者語意相同、**參數順序相反**。
-- ⇒ 代價:不支援萬用字元搜尋。這是刻意的 —— 員工要的是「把料號貼進去」,不是寫 pattern。
--
-- ── ⚠️ 比對語意的三條已知限制(R3 nit,寫進合約免得被當 bug)────────────────
-- · **大小寫折疊只對 ASCII 有效**:`lower()` 依 collation,而排練環境是 `LC_ALL=C`
--   ⇒ harness 的 B6 只證了 ASCII 那半;非 ASCII 的大小寫(如全形英文)未驗。
-- · **不做任何正規化**:全形/半形不互通、`0912-345-678` 與 `0912345678` **互相搜不到**、
--   空白位置不同也搜不到。要不要正規化是**產品題**,連同搜尋 UX 一起在 347-3 評。
-- · **OAuth 註冊的會員 `customers.phone` 常常是空字串** ⇒ 維度③對他們**恆不命中**。
--   這不是 bug,是資料面事實;員工找這種客人要用姓名、或收件快照的電話(維度④)。
--
-- ── 🔴🔴 執行時間**沒有**被本片限住(R3-M1 實測,原本這裡宣稱有)───────────────
-- 第一版在函式上掛了 `SET statement_timeout = '10s'` 並宣稱「病態輸入會明確失敗」。**那是假的。**
-- PG 的 statement timer 在**語句開始時**依當下 GUC arm,函式內 SET **不會重新 arm**
-- ⇒ 呼叫端 session 的 `statement_timeout = 0` 時,這支照樣可以無限期跑。
-- 🔴 **可判定 probe(任何人都能重跑)**:建一支帶 `SET statement_timeout='100ms'`、
--    body 裡 `pg_sleep(1)` 的函式,`SET statement_timeout=0` 之後呼叫它 ——
--    **正常回傳**(睡滿一秒)就證明函式層那個 SET 對當句無效。本片實跑過,結論就是這樣。
-- ⇒ 那行已移除(留著等於掛一個名字大於實力的防護)。**真正要綁時間上限只有兩條路**:
--      ① `ALTER ROLE service_role SET statement_timeout = …`(同 repo 前例:
--         `20260611120000…:73` 對 payment_confirmer 就是這樣做)。
--      ② 由呼叫端(347-2)自己設 session GUC。
-- 🔴 **裁決(主視窗 D-380-A,流程層決定、未上 Sean)**:**不做 ①** ——
--    `ALTER ROLE service_role` 會動到**service_role 的每一句查詢**,是平台級改動,
--    為一支唯讀搜尋函式付這個代價不值得。
-- ✅ **已補的事實(2026-08-09,Sean 於 Supabase Studio 實跑 `select rolname, rolconfig
--    from pg_roles`,截圖+全文轉貼主視窗)**:
--      · `service_role`  → `statement_timeout=300s`(本函式的實際天花板;非 0,有上限)
--      · `authenticator` → `statement_timeout=8s` + `lock_timeout=8s`(anon/authenticated 走
--        PostgREST 的上限;本函式是 admin service_role 專用,不受這條管,但記著它)
--      · `postgres`      → 只設 search_path,無 timeout 覆寫
--    量測面=role 級 GUC(語句開始時依此 arm),非 session `SHOW`;若未來有 db 級或
--    connection-string 覆寫,以更近的那層為準。300s 非 0 ⇒ 免另立鐵則 12④ 小片。
-- 🔴 本片能做、也做了的那半 = **限制輸入長度**(見下方長度閘):它擋的是「超長字串讓每列的
--    strpos 變貴」,**不等於**擋住整體執行時間。兩者不要混為一談。
--
-- ── ⚠️ 效能天花板(誠實標註,不用「量小」帶過)───────────────────────────────
-- 這是逐列掃描:`orders` 全表 + 每列的四個 EXISTS 子查詢,**沒有任何索引幫得上忙**
-- (`%x%` 形式的子字串比對 btree 用不到)。訂單量 = 每月 100-300 筆
-- (memory `project_m4b-admin-preview-decisions`)⇒ 一年約 1200-3600 列,現階段一次搜尋是毫秒級。
-- 🔴 **重估觸發**:`orders` 超過約 5 萬列、或員工回報搜尋變慢 ⇒ 改掛 `pg_trgm` 的 GIN 索引
--    (Supabase 有 pg_trgm;`pg_jieba` 沒有,中文分詞要走 PGroonga ——
--     memory `reference_supabase-no-pg-jieba-use-pgroonga`)。**現在不預先做**。
--
-- ── 回傳形狀與超限行為(合約)────────────────────────────────────────────────
-- 回 `jsonb`:`{"ids": [uuid…], "truncated": bool}`。
-- · `ids` 依 **`created_at DESC, id DESC`** 排序。
--   🔴 **次鍵方向必須與列表那層一致**:`SupabaseOrderAdapter.ts:503-504` 是
--   `.order('created_at',{ascending:false}).order('id',{ascending:false})`。
--   第一版這裡寫升冪 ⇒ 同一秒建立的單超過上限時,**兩層選出來的集合不同**
--   (RPC 砍掉的那幾張,正是列表想排前面的那幾張)——codex R2 抓到。
-- · 取 `LIMIT v_limit + 1`:拿到 `v_limit + 1` 筆就把最後一筆丟掉、`truncated = true`。
--   🔴 **刻意不做全表 count** —— 那是每次搜尋多掃一次全表,只為了顯示一個數字。
-- · `truncated = true` 時 UI 要顯示「結果太多,請輸入更精確的關鍵字」。
--   🔴 **靜默截斷是不可接受的**:員工會以為「就這幾筆」而漏掉真正要找的那張單。
-- · 空字串 / 全空白 → 直接回 `{"ids": [], "truncated": false}`,**不發任何查詢**。
--   (不是回「全部」——那會在員工清空搜尋框的瞬間把整份 PII 撈出來。)
-- · `p_limit`:NULL 或 <= 0 → 100;**上限硬夾在 100**,傳 5000 也只給 100。
--   🔴 **100 不是隨手挑的,是對齊下游已經釘死的那個數**:列表拿到 ids 之後走
--   `.in('id', ids)`,而那條路徑的上限是 `SUPPLIER_ORDER_NO_MATCH_CAP = 100`
--   (`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:160`;#347-2a 起它由同檔的
--    `ADMIN_ORDER_ID_IN_CAP` 導出 —— 兩個搜尋維度共用同一個數字,值仍是 100)——理由是 **PostgREST 的
--   query string 長度**:200 個 UUID 加上 select 投影已經 8,361 bytes、越過 8KB 線。
--   ⇒ 這裡若給 200,347-2 接上去會**先 HTTP 失敗**,員工連 truncated 提示都看不到(codex R2)。
-- ============================================================

BEGIN;

-- 🔴 **apply 當下的等待要有界**(codex R2):正式站 db push 若撞上 catalog 鎖競爭,
--    沒有 timeout 就是**無限期等待**,不是一個可控的失敗。
--    ⚠️ `SET LOCAL` 只在**交易內**有效 —— 本檔自包 `BEGIN…COMMIT`(檔尾斷言那段也靠它),
--    所以這兩行是真的生效;哪天有人把 BEGIN/COMMIT 拿掉,它們會靜默變成 no-op
--    (memory `reference_supabase-migration-set-local-is-noop` 記的就是那個坑)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.admin_search_orders(
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
  --    (那個本片綁不住,見檔頭 §執行時間沒有被本片限住)。
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
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(text, integer) TO service_role;

COMMENT ON FUNCTION public.admin_search_orders(text, integer) IS
  'M-4b #347-1:後台訂單搜尋。八維度(訂單編號 / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 品牌 / 供應商單號)子字串比對,回 {"ids": uuid[], "truncated": bool}。🔴 只回 order id —— PII 只在 SQL 內比對,不進讀模型、不進 RSC payload(這是本片存在的理由:shipping_address_snapshot 在鐵則 12 的 forbidden 清單裡,擴投影等於拆守門)。🔴 用 strpos() 不用 ILIKE:輸入一律當字面字串,`%` 與 `_` 不是萬用字元(否則搜一個 % 會撈出全部訂單)。🔴 本函式無任何 RAISE —— 搜尋詞本身是 PII,不得落進 server log。空字串/全空白 → 回空清單、不發查詢(不是回全部)。p_limit:NULL 或 <=0 → 100,硬夾上限 100(對齊下游 .in() 的 URL 長度上限 SUPPLIER_ORDER_NO_MATCH_CAP=100);命中超過上限時只回前 p_limit 筆並 truncated=true(UI 必須顯示「結果太多請更精確」——靜默截斷會讓員工以為就這幾筆)。不做全表 count(那是每次搜尋多掃一次全表)。join 欄名注意:orders.customer_user_id 參照的是 customers.user_id,不是 customers.id。⚠️ 效能:逐列子字串掃描、索引幫不上忙;訂單量每月 100-300 筆下是毫秒級,orders 破約 5 萬列或員工回報變慢時改掛 pg_trgm GIN。僅 service_role 可執行。';


-- ── fail-closed 斷言(任一異常 → 整檔 ROLLBACK)───────────────────────────────
-- 🔴 本檔自包 BEGIN…COMMIT:沒有它的話 `psql -f` 會逐句 autocommit,
--    函式與 ACL 早就留在 DB 上了,斷言擋不住任何東西。
DO $$
BEGIN
  -- A. 單一 signature:overload 會讓 PostgREST 選到別支,而兩支的 ACL 各自獨立。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_search_orders') <> 1 THEN
    RAISE EXCEPTION '#347-1:admin_search_orders 不是恰好一支(overload?);拒繼續';
  END IF;

  -- B. owner=postgres、SECURITY DEFINER、search_path 固定空。
  -- 🔴 字面注意:`SET search_path = ''` 在 proconfig 存成 `search_path=""`(含兩個雙引號),
  --    不是 `search_path=`。寫錯這個字面 ⇒ 斷言恆假、apply 被自己的守門擋下
  --    (對齊 `20260809160000` 的 2a 與 `20260723120000` 的 3a,兩片都實測踩過)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '#347-1:admin_search_orders 的 owner/SECDEF/search_path 不符;拒繼續';
  END IF;

  -- C. ACL:**allowlist 而非黑名單**。只列舉已知的壞角色的話,
  --    「未被列舉的新角色」拿到 EXECUTE 不會被任何人發現。
  --    ⇒ 條件寫成「owner 與 service_role 以外零 grantee」。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p,
           LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'public.admin_search_orders(text, integer)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.grantee <> 0                                   -- 0 = PUBLIC,下一條單獨擋(訊息才分得出來)
       AND a.grantee <> 'service_role'::regrole
  ) THEN
    RAISE EXCEPTION '#347-1:admin_search_orders 有 service_role 以外的 grantee;拒繼續';
  END IF;
  IF has_function_privilege('public', 'public.admin_search_orders(text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '#347-1:admin_search_orders 對 PUBLIC 可執行(REVOKE 沒生效?);拒繼續';
  END IF;

  -- C-2. 🔴 **`WITH GRANT OPTION` 收不回來**(codex R1):若這支函式先前存在、且有人給過
  --      `GRANT EXECUTE … TO service_role WITH GRANT OPTION`,`CREATE OR REPLACE` 保留舊 ACL,
  --      而上面那條把 service_role 整個排除掉 ⇒ 看不見。有 grant option 的角色可以把 EXECUTE
  --      再轉發給任何人,等於 ACL allowlist 從此不再是真相。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p,
           LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'public.admin_search_orders(text, integer)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.is_grantable
  ) THEN
    RAISE EXCEPTION '#347-1:admin_search_orders 有帶 GRANT OPTION 的 grantee(可再轉發);拒繼續';
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
     WHERE p.oid = 'public.admin_search_orders(text, integer)'::regprocedure
       AND NOT r.rolsuper
       AND r.oid <> p.proowner
       AND r.rolname <> 'service_role'
       AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
     LIMIT 1;
    IF v_role IS NOT NULL THEN
      RAISE EXCEPTION '#347-1:角色 % 有效可執行 admin_search_orders(直接 GRANT 或角色繼承);拒繼續', v_role;
    END IF;
  END;

  -- D. 正向:service_role **必須**執行得了。
  --    🔴 少了這條,把 GRANT 整行刪掉時 A-C 全綠(零 grantee 更「安全」)而功能全死。
  IF NOT has_function_privilege('service_role', 'public.admin_search_orders(text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '#347-1:service_role 執行不了 admin_search_orders(GRANT 漏了?);拒繼續';
  END IF;

  -- E. 搜尋詞不落 log:函式本體不得出現任何 RAISE。
  --    🔴 這條是**字面守門**,擋的是「日後有人加一句 RAISE NOTICE 除錯」——
  --    那會把員工搜的客人姓名/電話/地址寫進 server log,本片最主要的設計理由當場失效。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer)'::regprocedure
       AND p.prosrc ~* '\mRAISE\M'
  ) THEN
    RAISE EXCEPTION '#347-1:admin_search_orders 函式體出現 RAISE(搜尋詞可能落進 log);拒繼續';
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
    RAISE EXCEPTION '#347-1:搜尋讀到的表有人開了 FORCE ROW LEVEL SECURITY(definer 會被自己擋死、搜尋靜默漏單);拒繼續';
  END IF;

  RAISE NOTICE '#347-1 斷言通過:單一 signature + SECDEF/search_path + ACL allowlist(僅 service_role)+ 函式體零 RAISE + 七張讀取表無 FORCE RLS';
END $$;

COMMIT;
