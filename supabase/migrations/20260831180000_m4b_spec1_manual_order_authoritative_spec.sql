-- 🛑🛑 這是【第 2 支】—— 先貼 `貼這個-1-手動建單稅額.sql`(20260829140000), 再貼這一支。
-- 🔴 反了的話:這一支會把那一支的稅額改動【整個蓋掉】, 而畫面上不會有任何錯誤。
--
-- ⟦b4-SPEC1⟧ · 手動建單的品項規格:**DB 那一側沒有守** —— 本片補上
-- ─────────────────────────────────────────────────────────────────────────────
-- 做什麼:`admin_create_manual_order` 在 `variant_id` 非 NULL 時,
--         **從 `public.product_variants.spec` 取權威規格, 覆蓋呼叫端送的那一份**。
--         其餘一個字都沒動(逐字抄自 20260829140000:97-580)。
--
-- 為什麼:那份規格會被寫進 `product_snapshot` —— 而快照是**不可變**的。
--         應用層 `284ee4cf` 已經修過, 而**那顆 commit 動的檔在 `supabase/` 底下是 0 支**
--         ⇒ 修法整個在應用層 ⇒ 任何不走那支 repository 的 `service_role` 呼叫端仍然繞得過。
--
-- 🔴 抄自哪一代(本片最危險的一步):
--    `scripts/latest-definition-of.sh admin_create_manual_order` ⇒
--      newest = **20260829140000**(repo 最後一代)· live = 20260824020000(帳本最後一支已記的)
--    ⇒ **newest ≠ live** ⇒ 本檔逐字抄 **20260829140000**, 不是帳本上那一支。
--    📌 而板子 `⟦b4-SPEC1⟧` 的證據句引的是【第 1 代】—— 兩代那一行**逐字相同**
--       ⇒ **指錯代與指對代印同一個答案**, 只有這支工具分得出來。
--
-- ⚠️ 順序約束(再講一次, 因為它決定成敗):
--    20260824020000(已 apply)⇒ **20260829140000(尚未 apply)** ⇒ 本檔
--    ⇒ 本檔的前置閘會擋:庫裡那支若不是 20260829140000 那一版, 它會 RAISE 並告訴你先貼哪一支。
--
-- ══ 🛑🛑 本片的【前提】—— 它證明不了自己, 寫在這裡不要讓它變成無條件的 ═══════
--   codex R3 逐字:「fixture 自己放進正確的紅色, probe 只證明它被**成功複製** ——
--   **零證據證明正式資料的語意／來源／新鮮度正確;證明的是「忠實抄寫」, 不是「抄到真相」。**」
--
--   ⇒ 本片把「員工送什麼寫什麼」換成「一定寫 `public.product_variants.spec` 那一份」。
--     那份若是錯的, 一個【偶爾錯】就被換成【一定錯】, 而快照不可變、補不回來。
--   🔴 2026-08-31 正式庫實量(主視窗唯讀跑):54,000 列 / 空規格 **13,112(24%)** /
--     其中**有貨的 10,786** / a4 非字串值 **0** / a5 價格欄名 **0** / 涉及 15 家供應商(共 18)。
--     ⇒ ✅ 「格式壞掉導致建不了單」今天**不存在**;
--     ⇒ 🔴 而「目錄是空的 ⇒ 員工手打的規格被 `{}` 無聲蓋掉」**今天就會發生, 且涵蓋 24%**。
--   🛑🛑 **而 2026-08-31 15:0x 前提又垮了一層 —— 本片的觸發條件【今天是零】。**
--     Sean 問「商品編號怎麼用」, 主視窗去查, 線DB 逐格複量:
--       · 表單那格是一個**純文字 input**(`manual-order-lines.tsx:153-160`, `autoComplete='off'`),
--         而它解析成 **UUID**(`manual-order-form.ts:217` `UUID_RE`, `:387` 逐列檢查)
--         ⇒ **員工必須【手打一串 UUID】** 才會有 `variant_id`。
--       · 而目錄搜尋 `searchManualOrderCatalog`(`manual-order-catalog.ts:139`)
--         **非測試呼叫端 = 0** —— 那 2 處命中都在它自己那支檔(宣告 + 錯誤訊息字串)。
--         🔵 正對照 同尺查 `createManualOrder` ⇒ **9** 處 · 🔵 負對照 現造名 ⇒ **0**
--       · 後台訂單那一區 `datalist` / `list=` / `onSearch` / `autocomplete=` / `useSWR` ⇒ **各 0 處**
--         🔵 正對照 同範圍查 `input` ⇒ **58** 支檔有 ⇒ 尺是活的
--       · 而畫面自己寫著(`:74` 逐字):「網站上沒有的東西(代購)就把『商品編號』留白」
--     ⇒ 📌 **實務上每一列都會留白 ⇒ 每一列都走 `pv.id IS NULL` ⇒ 員工那份被保留**
--     ⇒ ⇒ **那 13,112 / 10,786 兩個數是【挑得到的】, 而今天沒有人挑得到。**
--   🔴 **而這不是好消息** —— 它的意思是:**本片修的那條路今天沒有人走得到,**
--     **而真正壞掉的是【那條路根本沒有入口】。**
--   📌 **⇒ 而我、codex 三輪、主視窗, 沒有一個問過「員工怎麼填那一格」** ——
--     我們驗了這段碼【收到一個 variant_id 時】做得對不對, 而沒有問【那個 id 從哪裡來】。
--     ⇒ codex R3 那條(probe 只證明忠實抄寫)講的是同一件事的下半;**這一格更前面:**
--       **抄寫的那個輸入, 現實中不存在。**
--
--   🛑 **apply 前必須有人明文接受這個前提** —— 而那是 Sean 的, 不是寫這支檔的人的。
--   📎 目錄本身的上游風險見板 `⟦供應商同步半寫入⟧`:同步失敗留下的是**半寫入的中間態**,
--      不是整批回捲 ⇒ 目錄可能處於部分更新狀態, **而沒有人記錄過它造成 spec 錯誤**。
--
-- ⚠️ **本檔尚未 apply。apply 是 Sean 的手。**
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 前置閘:抄的那一代必須就是庫裡現在那一支 ────────────────────────────────
DO $pre$
DECLARE
  v_fp text;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 前置閘:admin_create_manual_order 不存在 ⇒ 先 apply 20260824020000';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.regexp_replace(pg_catalog.regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_fp
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)'::regprocedure;
  -- 🔴🔴 codex R1 must-fix(2026-09-01):**指紋相同 ≠ 這支裝好了。**
  --   `prosrc` 只是函式本體 ⇒ `SECURITY DEFINER` 掉了、`search_path` 掉了、ACL 被改寬,
  --   這三種**指紋一個字都不會變** ⇒ 舊版在這裡直接 `RAISE` 走人
  --   ⇒ **後置 ④ / ④b / ④c 那三道永遠跑不到。**
  --   ⚠️ **而它們能抓到什麼要講準(codex R2 nit)**:本檔中間那句 `CREATE OR REPLACE`
  --      會**順手把 SECDEF 與 search_path 修回來** ⇒ 等 ④ 跑的時候異常已經不在了。
  --      ⇒ 📌 **結果是安全的, 而那不是 ④ 抓到的** —— 是 `CREATE OR REPLACE` 蓋掉的。
  --      ⇒ ⇒ 所以不早退真正買到的是【ACL 那一道(④c)】與【下次有人加新檢查時它跑得到】,
  --         不是「偵測到 SECDEF 掉了」。**不要把這道閘寫得比它做得到的寬。**
  --   📌 一個「已經做過了, 不用再檢查」的早退, 它跳過的是【檢查】不是【工作】。
  --   ⇒ 改法:指紋相同時**不早退**, 先把安全屬性那幾道跑完, 再在最後面才說「已套用」。
  --      ⚠️ 代價明寫:重跑會多花那幾道的時間 —— 而那是幾個 catalog 查詢, 便宜得多。
  IF v_fp = 'e387b096263c72e858575a33be248239' THEN
    RAISE NOTICE '⟦b4-SPEC1⟧ 前置閘:指紋已是改後那一版 ⇒ 本體不會有變化;'
                 '**仍然往下跑, 因為安全屬性(SECDEF / search_path / ACL)不進指紋。**';
  ELSIF v_fp <> '244d944d629497fd20c48814d0f491ec' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 前置閘:庫裡那支的正規化指紋是 %, 而我抄的那一版是 % '
                    '⇒ 🔴 最可能的原因:**你還沒貼第 1 支(20260829140000 稅額那支)**。'
                    '先貼它, 再回來貼這一支。若你確定貼過了, 停下來人工核對, 不要 force。',
                    v_fp, '244d944d629497fd20c48814d0f491ec';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_create_manual_order(
  p_customer_user_id uuid,
  p_manual_request_id uuid,
  -- 🔴 F1(R3):**誰建的這張單。** 位置鏡像 `20260820021000:144`(退款登記那支)。
  --    ⚠️ 它**不進指紋**,理由見 G6.5 那段。
  p_actor            text,
  p_order_source     text,
  p_payment_channel  text,
  p_shipping_method  text,
  p_ship_to          jsonb,
  p_invoice          jsonb,
  p_shipping_fee     integer,
  p_lines            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $fn$
DECLARE
  v_line        jsonb;
  v_qty         integer;
  v_unit_price  integer;
  v_sku         text;
  v_title       text;
  v_spec        jsonb;
  v_variant_id  uuid;
  v_line_total  bigint;
  v_subtotal    bigint := 0;
  v_total       bigint;
  v_items       jsonb := '[]'::jsonb;
  v_ship_to     jsonb;
  v_invoice     jsonb;
  v_tier        public.member_tier;
  v_display_id  text;
  v_order_id    uuid;
  v_existing    record;
  v_attempt     integer;
  v_cname       text;
  v_n           integer;
  -- codex R1 `:186`:跨列去重的累積器(形狀照 `create_order` `20260730120100:322-325`)
  v_seen        text[] := ARRAY[]::text[];
  v_key         text;
  -- codex R1 `:143`/`:248`:正規化後的整包輸入 + 它的指紋
  v_canonical   jsonb;
  v_payload_sha text;
  -- codex R1 `:138`:兩個**業務上限**。
  -- 🔴 **這兩個數字是我挑的,Sean 沒有拍過。** 挑法=比實務用量大一個數量級、
  --    又小到擋得住「一發打爆」:電話單實務上個位數筆、單筆數量兩位數。
  --    ⇒ 撞到它們的時候要**改這裡並問 Sean**,不要在呼叫端拆單繞過去。
  c_max_lines   constant integer := 50;
  c_max_qty     constant integer := 9999;
BEGIN
  -- ── G1 輸入:每一格各自一道,訊息講【哪一格】不講「輸入有誤」 ──────────────
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定客人(customer_user_id 是 NULL);拒絕建出無主單';
  END IF;
  IF p_manual_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 缺冪等鍵(manual_request_id);沒有它,重送會建出第二張單';
  END IF;
  -- 🔴🔴 F1(R3 f5):**憑空建單卻記不住是誰做的** —— 而「憑空建單」正是本片新增的能力。
  --    對照:退款登記那支(`20260820021000`)提到 actor **29 次**;本檔上一版**零次**。
  --    f5 的框架句(收下,不改寫):兩片一起上線之後,能力邊界變成
  --    「**有後台密碼的人可以造出一條完整的假金流鏈,而鏈上第一環查不出是誰做的**」
  --    (建單 → 灌假收款 → 退款,三片各自都說「那不歸我管」,而沒有一片說錯)。
  --    ⇒ 走 `admin_audit_log`,**不在 `orders` 加欄**(那張表本來就沒有 actor 欄,
  --      而 audit 是這個 repo 既有的、對的載體)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定經手人(actor);'
                    '手動單是憑空建出來的,**不知道是誰建的單不准建**';
  END IF;
  -- 🔴 FK 只擋「不存在」,**擋不到已停用的** ⇒ 這一道查 is_active(逐字同 `20260820021000:198-199`)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = pg_catalog.btrim(p_actor, E' \t\r\n') AND s.is_active) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 經手人 [%] 不是啟用中的員工 ⇒ 拒絕建單。'
                    '🔴 手動建單的失敗模式是【人】,而 actor 是唯一的線索 —— '
                    '拿一個查不到的名字建單,等於這張單沒有來源。', p_actor;
  END IF;
  IF p_order_source IS NULL OR p_order_source NOT IN ('manual_phone', 'manual_line', 'manual_other') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 來源 [%] 不是手動三值之一', p_order_source;
  END IF;
  -- 🔴 具名拒 tappay:刷卡那條路由 TapPay 那一側寫,人工建單不得宣稱一筆卡片交易。
  IF p_payment_channel = 'tappay' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 手動單不得標記為線上刷卡(tappay);那條路由付款確認寫入';
  END IF;
  IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金流管道 [%] 不是 bank_transfer 或 cash', p_payment_channel;
  END IF;
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 運費必須是 0 或正整數(收到 %)', p_shipping_fee;
  END IF;
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有品項;一張單至少要有一個品項';
  END IF;
  -- 🔴 codex R1 `:138`:**沒有上限的迴圈**。舊版靠「總額 > integer 上限」兜底,而那道
  --    對 `unit_price = 0` 的品項**零判別力** ⇒ 幾萬筆零元品項可以整包穿過去。
  IF pg_catalog.jsonb_array_length(p_lines) > c_max_lines THEN
    RAISE EXCEPTION 'admin_create_manual_order: 一張單最多 % 個品項(收到 %);超過請拆單,'
                    '或這個上限要調整 ⇒ 找系統維護(它是保守預設值、未經拍板)',
                    c_max_lines, pg_catalog.jsonb_array_length(p_lines);
  END IF;

  -- 🔴🔴 **冪等格搬到 G6 之後了**(codex R1 `:143`)。
  --    原本它在這裡 = 「鍵在就回成功」,**完全不看內容** ⇒ 同鍵裝不同內容時,
  --    員工以為新單建好了,實際拿到的是**舊那張單**。
  --    ⇒ 要比對內容,就必須**先把內容正規化完**(G4/G5/G6 做那件事)⇒ 冪等格只能排在它們之後。
  --    ⚠️ 排序安全性:重送同一包輸入時,G3-G6 全部是**決定性**的(同輸入同結果)
  --       ⇒ 不存在「完全相同的重試被前面某道閘誤擋」那個坑
  --       (退款 RPC `20260820021000:238-242` 踩過的正是那個坑,方向相反)。

  -- ── G3 客人必須存在(FK 也會擋,而這裡先擋是為了給員工看得懂的訊息) ────────
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = p_customer_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_create_manual_order: 找不到這位客人(user_id=%);請先建立客人資料',
                    p_customer_user_id;
  END IF;

  -- ── G4 收件快照:逐鍵白名單重組,**不收員工原樣的 jsonb** ───────────────────
  -- 🔴 表上有 exact-key CHECK(`20260604120000` orders_ship_addr_whitelist)
  --    ⇒ 多一個鍵就整筆回滾。這裡自己組,壞掉的輸入在這裡就講清楚。
  IF p_ship_to IS NULL OR pg_catalog.jsonb_typeof(p_ship_to) <> 'object'
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'name', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'phone', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'line', '')) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 收件資料要有收件人 / 電話 / 地址三格,不得留空';
  END IF;
  v_ship_to := pg_catalog.jsonb_build_object(
    'name',  pg_catalog.btrim(p_ship_to ->> 'name'),
    'phone', pg_catalog.btrim(p_ship_to ->> 'phone'),
    'line',  pg_catalog.btrim(p_ship_to ->> 'line'));

  -- ── G5 發票:同樣逐鍵白名單 ────────────────────────────────────────────────
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR COALESCE(p_invoice ->> 'type', '') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 發票類型要是 personal / company / donate 之一';
  END IF;
  -- 🔴 codex R2 `N1`:上一版這裡**沒有 trim** ⇒ 載具打成 `" ABC "` 與 `"ABC"` 會被算成
  --    兩包不同的內容 ⇒ 合法重送被拒。`NULLIF(btrim(…), '')` 讓「只打了空白」與「沒填」歸位到同一個值。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,那不是漏掉的,是唯一寫得對的寫法。**
  --    本函式其他每一個呼叫都寫成 `pg_catalog.xxx(...)`(因為 `SET search_path = ''`)
  --    ⇒ 照著那個風格會很自然地把這裡寫成 `pg_catalog.nullif(...)` —— **我自己就是這樣寫的。**
  --    而 `NULLIF` / `COALESCE` / `CASE` 是 **SQL 的語法構造,不是 `pg_catalog` 裡的函式**
  --    ⇒ `pg_catalog.nullif(...)` 會在**執行期**炸「function does not exist」。
  --    🔴 **那一發:靜態閘四道 + typecheck + lint + build + 本檔的 apply 斷言 —— 全綠。**
  --       plpgsql 的函式本體到**被呼叫**那一刻才解析名稱 ⇒ 上面每一道對它都是零判別力。
  --    ⚠️ ⇒ 誰要「統一風格」把前綴加回去:**請先跑一次真的呼叫**,不要只看它有沒有 apply 成功。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       pg_catalog.btrim(p_invoice ->> 'type'),
    'carrier',    NULLIF(pg_catalog.btrim(p_invoice ->> 'carrier'), ''),
    'title',      NULLIF(pg_catalog.btrim(p_invoice ->> 'title'), ''),
    'taxId',      NULLIF(pg_catalog.btrim(p_invoice ->> 'taxId'), ''),
    'donateCode', NULLIF(pg_catalog.btrim(p_invoice ->> 'donateCode'), '')));

  -- ── G6 品項:逐筆驗 + 自算金額(**價錢不信 client 送的合計**) ──────────────
  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    v_sku   := pg_catalog.btrim(COALESCE(v_line ->> 'sku', ''));
    v_title := pg_catalog.btrim(COALESCE(v_line ->> 'title', ''));
    IF v_sku = '' OR v_title = '' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 每個品項都要有料號與品名(收到 sku=[%] title=[%])',
                      v_sku, v_title;
    END IF;
    v_qty := NULLIF(v_line ->> 'qty', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量要是正整數', v_sku;
    END IF;
    -- 🔴 codex R1 `:138`:`qty = 2147483647` 配 `unit_price = 0` ⇒ 金額守門**不會紅**
    --    (0 × 任何數還是 0)⇒ 一張「兩億件、零元」的單會真的建出來。
    IF v_qty > c_max_qty THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量 % 超過單筆上限 %;'
                      '真的要這個量 ⇒ 找系統維護(這個上限是保守預設值、未經拍板)',
                      v_sku, v_qty, c_max_qty;
    END IF;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::integer;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的單價要是 0 或正整數', v_sku;
    END IF;
    -- 🔴 代購品項:`variant_id` 允許 NULL(`20260604120000:143`)⇒ 網站上沒有的商品也建得起來。
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::uuid;
    -- 🔵 ⟦b4-SPEC1⟧ 的權威 spec **不在這裡取** —— 見下方 G8 的 INSERT。
    --    🔴 **本檔第一版取在這裡, 而 codex R1 must-fix 1 打穿它**:
    --       這裡在 G6.5 冪等比對【之前】⇒ `v_items` 進指紋 ⇒ 指紋會跟著
    --       `product_variants.spec` 這個**可變的外部狀態**跑。
    --       ⇒ 首次成功之後那個變體的 spec 被改過 ⇒ **同鍵同內容的合法重送算出不同指紋**
    --          ⇒ 被判成「同鍵不同內容」而拒絕;變體被刪掉 ⇒ 直接 RAISE, **連既有那張單都回不了**。
    --    📌 而本函式檔頭 `:207` 自己寫著「重送同一包輸入時 G3-G6 全部是**決定性**的」——
    --       **我那一版把那句話變成假的, 而三綠 / 四個世界 / 四發突變全部沒有紅。**
    --    ⇒ ✅ 分成兩個問題:**指紋回答「這是不是同一個請求」(看呼叫端送什麼);
    --       快照回答「真相是什麼」(看權威)。** 兩者不該共用同一份值。
    -- 🔴 `spec` 只收物件,而且**每個值都必須是字串**(表上 CHECK 會擋,這裡先講清楚)。
    v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb);
    IF pg_catalog.jsonb_typeof(v_spec) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格要是物件', v_sku;
    END IF;
    -- 🔴🔴 codex R1 `:203`:舊版**只驗到這裡為止**,底下三句話是靠
    --    `order_items_snapshot_whitelist` 這道表上的 CHECK 幫我擋的。
    --    ⇒ 那是**別人家的守門**:正式庫若缺它或它漂移了,**本檔的 apply 斷言不會紅**,
    --      而經銷價 / cost 會直接寫進快照裡。⇒ **自己驗一遍**(判準逐字對齊 `20260604120000:157-165`)。
    --    ⚠️ 這不是重複勞動:表上那道是**縱深**,這一道是**訊息** —— CHECK 紅的時候
    --       員工看到的是一串約束名,這裡紅的時候他看得到是哪一個品項的哪一種問題。
    IF NOT public.m3_jsonb_values_all_string(v_spec) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格裡有不是字串的值(數字 / 巢狀物件 / 陣列);'
                      '規格只收「字串對字串」,那是為了擋價格欄藏在巢狀值裡', v_sku;
    END IF;
    IF v_spec ?| ARRAY['price_store', 'price_by_tier', 'cost'] THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格出現價格欄名(price_store / price_by_tier / cost);'
                      '訂單快照**絕不放經銷價與成本**', v_sku;
    END IF;
    -- 🔴 codex R2 `N1`:規格的鍵與值也要 trim —— 它們**進指紋**,而空白差異會讓合法重送被拒。
    --    ⚠️ 順序有意義:**先驗全值皆字串**(上面那道)**才能** `jsonb_each_text`,
    --       否則數字會被靜靜轉成字串、把該紅的那一發變綠。
    v_spec := COALESCE((SELECT pg_catalog.jsonb_object_agg(pg_catalog.btrim(k), pg_catalog.btrim(val))
                          FROM pg_catalog.jsonb_each_text(v_spec) AS t(k, val)), '{}'::jsonb);

    -- 🔴🔴 codex R1 `:186`:舊版**沒有任何跨列比對** ⇒ 員工手滑送兩列同一個變體,
    --    兩列各自計價 ⇒ `subtotal` / `total` **與退款分母**直接加倍。
    --    既有 `create_order` 明文要求同變體合併數量(`20260730120100:323` 逐字:「同變體應合併 qty」)。
    --    ⚠️ **代購品項(`variant_id` 是 NULL)怎麼去重**:它沒有變體可比 ⇒ 退而用 `料號 + 品名` 當鍵。
    --       兩列**料號與品名都一樣**幾乎只會是重送;真的是兩個不同東西 ⇒ 品名寫得出差別。
    -- 🔴🔴 codex R2 `N3`:上一版的代購鍵**只有 sku + 品名** ⇒ 兩個病一起犯:
    --    ① **太窄**:同料號同品名、但**規格或單價不同**的兩個代購品 ⇒ 被錯誤拒絕。
    --       ⚠️ 這一格的後果是**擋到合法的**(這裡是拒絕、不是合併)
    --       ⇒ 修的方向必須是**讓鍵更寬**,不是更嚴。
    --    ② **太鬆**:把品名中間的空白改一下 ⇒ 換一把鑰匙 ⇒ 真正的重複列繞過去。
    --    ⇒ 兩個方向一起修:**加進規格與單價**(變寬)+ **內部連續空白壓成一個**(變嚴)。
    v_key := COALESCE('variant:' || v_variant_id::text,
                      'custom:' || pg_catalog.lower(pg_catalog.regexp_replace(v_sku,   '\s+', ' ', 'g'))
                        || '|' || pg_catalog.lower(pg_catalog.regexp_replace(v_title, '\s+', ' ', 'g'))
                        || '|' || v_unit_price::text
                        || '|' || v_spec::text);
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 重複品項 [%];同一個東西請**合併數量**寫成一列,'
                      '不要送兩列 —— 送兩列會讓總額與**可退金額**都變成兩倍', v_sku;
    END IF;
    v_seen := v_seen || v_key;

    v_line_total := v_unit_price::bigint * v_qty::bigint;
    v_subtotal := v_subtotal + v_line_total;
    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id', v_variant_id,
      'variant_sku', v_sku,
      -- 🔴 exact-key 白名單:title / sku / spec 三鍵,**不得把員工輸入原樣塞進去**
      --    (`order_items_snapshot_whitelist`:多一鍵整筆回滾)。
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_title, 'sku', v_sku, 'spec', v_spec),
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'line_total', v_line_total);
  END LOOP;

  v_total := v_subtotal + p_shipping_fee;
  IF v_total > 2147483647 OR v_subtotal > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;

  -- ── G6.5 冪等格(codex R1 `:143`;形狀照退款 RPC `20260820021000:245-270`)─────
  -- 🔴🔴 **這一段的上一版是一句假話,而它讀起來像一句保證**(codex R2 `N1` 抓到):
  --    ~~「多打一個空白、鍵的順序不同、發票欄位給了 NULL,都不會被誤判成不同內容」~~
  --    R1 當下的實情是:**發票與規格根本沒有 trim,品項也照原順序進指紋**
  --    ⇒ 那三件事**每一件都會**讓合法重送被拒。
  --    ⚠️ 這句話的危害不只是錯:**它會讓下一個人不去測那三件事** —— 我自己就沒測。
  --    ⇒ R2 把碼補齊之後,下面這句話**現在才成立**,而它成立是因為有三件事真的做了:
  --      ① 收件 / 發票 / 規格的鍵與值**全部 btrim**(空白只打了空白 ⇒ 等於沒填)
  --      ② 品項**排序後**才進指紋(順序不再影響指紋)
  --      ③ `jsonb` 本身把鍵排序、重複鍵消掉(這一件是 PG 給的,不是我做的)
  --    ⇒ 多打一個空白、品項換順序、鍵的順序不同、發票欄位給了 NULL,**都不會**被誤判成「不同內容」。
  --    📌 三件事各有一格負測釘著(`docs/probes/2026-08-24-858-manual-order-rpc-r2-negatives.sql` 的 R2-1b/1c/1e),不是只有這段話。
  -- ⚠️ **上限(誠實揭示)**:比的是**指紋**,所以只答得出「一樣 / 不一樣」,
  --    答不出**哪一欄**不一樣 —— 退款 RPC 那支比得出來,因為它比的是欄位。
  --    這裡的輸入是一整包(含品項陣列),逐欄比會隨著欄位增加而**靜靜漏掉新欄**;
  --    指紋不會漏,代價就是訊息比較鈍。**這是選擇,不是疏忽。**
  -- ⚠️ 另一格上限:`jsonb::text` 的輸出在**同一個 PG 大版本內**是決定性的(鍵已排序、
  --    重複鍵已消)。跨大版本若渲染改變 ⇒ 舊指紋對不上 ⇒ 會被判成「內容不同」而**拒絕**
  --    ⇒ 方向是 fail-closed(擋下來、不是放行)。
  -- 🔴 **`p_actor` 刻意【不進指紋】** —— 這是與 `20260820021000` 的**有意分歧**,不是漏掉:
  --    那支把 actor 放進逐欄比對,結果它必須為此寫一整段訊息教人怎麼辦
  --    (`:262-264` 逐字:「若你是在重送同一筆(**例如原經手人已停用而你換了人**)
  --     ⇒ 不要用新的 request_id」)。
  --    ⇒ 指紋要回答的問題是「**這是不是同一張單**」,而**誰按下送出不會改變那張單**。
  --      同事幫忙重送同一包內容 ⇒ 應該拿到 idempotent,不該被判成「內容不同」。
  --    ⇒ 「**誰建的**」由 `admin_audit_log` 那一列回答,那才是它該住的地方。
  --    ⚠️ **代價講明(2026-08-24 擴寫:我原本只寫了併發那一半,而它比那寬)**:
  --       **任何重送**,audit 都只會有**最初建單那一位**。
  --       · 併發:後到那發拿 `P858A`、不落 audit(它什麼都沒建)。
  --       · **非併發**:A 建單、B 一小時後拿同一顆 id 重送 ⇒ 回 `idempotent` ⇒ **B 這次操作零紀錄**。
  --    🔴 而**後者正是本設計自己舉的主要使用情境**(「原經手人已停用而你換了人」)
  --       ⇒ 它是**常態,不是邊角**。~~原本寫「併發時」~~ 那個限定把常態寫成了例外。
  --    ✅ 而這**不是缺陷**:B 沒有建單。`admin_audit_log` 記的是「**建單**」事件,不是「**請求**」事件
  --       ⇒ 不記 B 是**一致的**。⚠️ 但「誰碰過這張單」這條線索**確實不在系統裡** —— 要就得另立事件。
  v_canonical := pg_catalog.jsonb_build_object(
    'customer_user_id', p_customer_user_id,
    'order_source',     p_order_source,
    'payment_channel',  p_payment_channel,
    'shipping_method',  p_shipping_method,
    'shipping_fee',     p_shipping_fee,
    'ship_to',          v_ship_to,
    'invoice',          v_invoice,
    -- 🔴🔴 codex R2 `N1`:上一版直接把 `v_items` **照員工送來的順序**丟進指紋
    --    ⇒ 同樣的品項換個順序 ⇒ 指紋不同 ⇒ **合法重放被判成「內容不同」而拒絕**。
    --    ⇒ 排序後再算。排序鍵用 `x::text`:jsonb 轉文字時鍵已排序、重複鍵已消
    --      ⇒ 同一個 jsonb 值恆得同一個字串 ⇒ 是個穩定的鍵。
    --    ⚠️ **只有指紋排序,落表的 `order_items` 仍照員工原順序** —— 那是他要看的順序。
    'items',            (SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x::text), '[]'::jsonb)
                           FROM pg_catalog.jsonb_array_elements(v_items) AS x));
  v_payload_sha := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8')), 'hex');

  SELECT o.id, o.display_id, o.manual_request_payload_sha256 INTO v_existing
    FROM public.orders o
   WHERE o.manual_request_id = p_manual_request_id;
  IF FOUND THEN
    IF v_existing.manual_request_payload_sha256 IS NOT DISTINCT FROM v_payload_sha THEN
      -- 同一顆鍵、同一包內容 ⇒ 這就是重送。回既有那張單。
      RETURN pg_catalog.jsonb_build_object(
        'order_id', v_existing.id, 'display_id', v_existing.display_id, 'idempotent', true);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**(合約逐字對齊 `20260820021000:257`)
    -- 🔴 codex R2 `N2` 連帶:這一條與上面那條的**下一步完全相反**
    --    (那條要「原樣重送」,這條是「**不准重送**」)⇒ 呼叫端必須分得出來
    --    ⇒ 兩條都給代碼,不能只給一條。
    RAISE EXCEPTION 'admin_create_manual_order: 這個建單請求的編號已經用過了,而**內容不一樣** ⇒ 拒絕。'
                    '🔴 **呼叫端合約**:SQLSTATE P858B / constraint pcm_858_manual_order_payload_mismatch ⇒ '
                    '**不要重送**(重送幾次都會是同一個答案)。'
                    '🔴 這不是「重複建單」的警告 —— 系統裡那張單(%)與你這次送來的至少有一處不同'
                    '(客人 / 品項 / 數量 / 單價 / 運費 / 收件資料 / 發票 / 來源 / 付款方式)。'
                    '⚠️ **先確認你要的是哪一件事**:'
                    '① 要**改**那張既有的單 ⇒ 去那張單上改,不要用建單重送(這裡不會幫你覆蓋它);'
                    '② 這是**另一張**單 ⇒ 請重新開一張建單表單(它會產一顆新編號),'
                    '   不要把舊表單改一改再送 —— 那顆編號綁的是**上一次那包內容**。',
                    v_existing.display_id
                    USING ERRCODE = 'P858B',
                          CONSTRAINT = 'pcm_858_manual_order_payload_mismatch';
  END IF;

  -- ── G7 建單(display_id 有界重試;形狀照 create_order `:432-463`) ───────────
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();
      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
        -- 🔴 **`tax_total` 顯式寫 0(片 B2丙, 2026-08-29)** —— 不是「忘了寫所以走 DEFAULT」。
        --
        -- 🔴🔴 **而這個 0 是一個【假設】, 不是一個保證。codex 2026-08-29 must-fix, 它是對的。**
        --    ~~我原本寫「為什麼 0 是對的:單價來自 `price_general`, 而它含稅」~~ **那句話太寬**:
        --    **那是【今天唯一那個呼叫端】的性質, 不是【本函式的契約】。**
        --    本函式**直接收** `p_lines.unit_price`, 而它:
        --      · **不查也不驗** `price_general`
        --      · 代購品項(`variant_id` 是 NULL)的單價是**員工自己打的**
        --      · `p_shipping_fee` 同樣沒有任何「已含稅」的保證
        --      · 其他 service_role 呼叫端可以送任意合法非負單價
        --    ⇒ **有人送未稅價進來時, `tax_total = 0` 會少收稅。**
        --
        --    **⇒ 所以這一行的正確講法是**:
        --      「**假設**送進來的每一筆單價與運費都是【含稅】的 ⇒ 稅已內含在 `total` 裡 ⇒ `tax_total = 0`。
        --        而**本函式不強制那個假設**。」
        --    ✅ **今天那個假設成立**, 因為唯一的呼叫端是後台建單, 而它的目錄
        --       **只讀 `price_general`**(`apps/admin/src/lib/orders/manual-order-catalog.ts:84` 欄位表逐字),
        --       而 `price_general` 是含稅的(Sean 2026-08-29 逐字:
        --       「網站售價都含稅沒問題, 但是經銷價都是未稅。」)
        --    ⚠️ **而代購品項那一格【今天就已經沒有保證】** —— 它的單價是人打的。
        --       本片**沒有**擋它, 也沒有替它算稅 ⇒ **那是一個已知缺口, 寫在這裡而不是被靜靜帶過。**
        --
        -- 🔴 **⇒ 契約落地之前, 不得無條件宣稱這個 0 是對的。**
        --    要讓它變成保證, 需要下面「下一片」清單裡的第 1、2 項(價格基礎欄位 + 參數)。
        --    🔴 **而【那一天】要改這裡**:後台建單那顆兩段切換([定價][經銷])一旦做出來,
        --       經銷價(**未稅**)就會第一次變成訂單金額
        --       ⇒ 那一刻本行要開始**真的算稅**
        --       (進位依據:營業稅法 §14 第一項「尾數不滿通用貨幣一元者, 按四捨五入計算」)
        --    ⚠️ **而【不要】把它讀成 `ROUND(未稅小計 × 0.05)` 就好**(codex 2026-08-29 consider):
        --       那個式子**沒有處理**:應稅運費(營業稅法 §16:價額外收取的一切費用都進銷售額)、
        --       折扣怎麼分攤、代購品項的稅制、免稅品項。
        --       ⇒ **真正的算式要等【價格基礎與稅基契約】落地之後才寫得出來**
        --       ⇒ **這段註解不是規格。**
        --    ⚠️ **而本函式今天沒有任何參數說得出「這張是定價單還是經銷單」** ——
        --       那顆切換要加參數 ⇒ 而 `CREATE OR REPLACE` 加不了參數 ⇒ 要 `DROP + CREATE`。
        tax_total,
        order_source, payment_channel, manual_request_id, manual_request_payload_sha256
      ) VALUES (
        v_display_id, p_customer_user_id, NULL, v_ship_to, v_tier,
        v_subtotal::integer, p_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice,
        0,  -- tax_total:見上方欄位表那段。**顯式的 0,不是預設的 0。**
        -- 🔴 這兩欄顯式寫。不寫的後果見檔頭 §2。
        p_order_source, p_payment_channel, p_manual_request_id, v_payload_sha
      )
      RETURNING id INTO v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴🔴 codex R1 `:248`:**這條路不得回 `idempotent: true`。**
      --    舊版在這裡直接把既有那張單回出去 —— 而**它從來沒有比對過對方寫了什麼**
      --    ⇒ 上面 G6.5 那道逐內容比對,在「兩發並行」這條路上等於不存在。
      --    ⇒ 處置逐字沿用退款 RPC 對同一條路的定位(`20260820021000:311-316`):
      --      **拒絕本次、請呼叫端重試一次** —— 重試時 G6.5 就看得到那一列,也就會比對內容。
      --    ⚠️ 走到這裡只有一種情況:兩發並行、兩發都在 G6.5 查無、其中一發先寫進去。
      IF v_cname = 'orders_manual_request_id_uniq' THEN
        -- 🔴🔴 codex R2 `N2`:**上一版這裡是一顆沒有代碼的 RAISE,而它對呼叫端說「請重送」。**
        --    那句話有一個致命前提:**重送的人要用同一顆 request id。**
        --    而**今天 repo 裡沒有任何呼叫端實作那件事** ⇒ 前端最可能的行為是
        --    「這次失敗了 ⇒ 開新表單 ⇒ 產一顆新 id ⇒ 再送」
        --    ⇒ 🔴 **第一張單其實已經建好了,於是變成兩張真訂單、要出兩次貨。**
        --    ⇒ 病灶不是訊息寫得不夠清楚:**是我把一個決定交給了一個還沒被寫出來的呼叫端**,
        --      而它的預設行為剛好是錯的那一邊。
        --    ⇒ 修法=給它**機器讀得懂的把手**(SQLSTATE + CONSTRAINT token,體例照 repo 既有
        --      `P2B02` 那族),而不是只給人看的字。
        RAISE EXCEPTION 'admin_create_manual_order: 同一個建單請求正在被並行送出 ⇒ 拒絕本次。'
                        '🔴 **呼叫端合約(這一句是給程式看的,不是給人看的)**:'
                        '收到 SQLSTATE P858A / constraint pcm_858_manual_order_concurrent_request ⇒ '
                        '**保留同一顆 manual_request_id 原樣重送**,'
                        '⚠️ **絕對不要產生新的 manual_request_id** —— '
                        '這一刻另一發很可能已經成功建好那張單了,換新 id 會建出【第二張真訂單】。'
                        '重送時會走內容比對:內容相同 ⇒ 回那張已建好的單(idempotent:true);'
                        '內容不同 ⇒ 回 P858B。'
                        USING ERRCODE = 'P858A',
                              CONSTRAINT = 'pcm_858_manual_order_concurrent_request';
      END IF;
      -- 🔴 只吞 display_id 的碰撞;其他 unique violation 原樣上拋(重試會把語意訊號吃掉)。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        RAISE EXCEPTION 'admin_create_manual_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 建單迴圈離開時沒有訂單 id;拒絕繼續';
  END IF;

  -- ── G8 品項落表 + 筆數守 ───────────────────────────────────────────────────
  -- ══ 🔴🔴 ⟦b4-SPEC1⟧ codex R2 MF1:**真正落表的是 `pv.spec`, 而上面三道驗證驗的是呼叫端那一份** ══
  --   G6 那三道(值全字串 / 不得含價格欄 / 是物件)跑在迴圈裡, 吃的是 `v_line -> 'spec'`。
  --   而本片把落表的值換成了 `pv.spec` ⇒ **被驗的與被寫的不再是同一個東西。**
  --   📌 這正是本片自己製造的:改之前它們是同一份, 所以那三道涵蓋得到;改之後就不是了,
  --      **而那三道一個字都不用改就會繼續全綠。**
  --   ⚠️ 今天 `order_items_snapshot_whitelist` 那道表上的 CHECK 仍會擋 ⇒ 不是立即可利用;
  --      🔴 而那是**別人家的守門** —— 正式庫若缺它或它漂移了, 經銷價 / cost 會直接寫進快照。
  --      (本函式檔頭 codex R1 `:203` 講過同一句話, 而本片讓它重新成立。)
  --   ⇒ 自己驗一遍, 判準逐字對齊上面那兩道。
  --
  --   🛑🛑 **codex R3:這一道【不是原子的】, 而我原本沒有講。**
  --      這個 `EXISTS` 與下面那個 `INSERT` 是**兩個 statement**;本函式跑在 READ COMMITTED
  --      ⇒ 兩者各自取一次快照 ⇒ **供應商同步若剛好夾在中間, 會「驗 A 而寫 B」。**
  --      📌 ⇒ 所以這一道的正確定位是**訊息**, 不是防線 —— 它讓員工看得懂哪裡不對,
  --         而**原子的保證來自 `order_items_snapshot_whitelist` 那道表上的 CHECK**
  --         (同一句 INSERT 裡求值 ⇒ 沒有中間狀態)。
  --      ⚠️ **而那正好是本函式檔頭 codex R1 `:203` 說的「別人家的守門」** ——
  --         ⇒ 兩句話一起讀才是完整的:**它是別人家的, 而它是這裡唯一原子的那一道。**
  --      🔴 **我沒有把這道合進 INSERT** —— 那要嘛用 CTE 重寫整段、要嘛在 SQL 裡想辦法 RAISE,
  --         兩條都會把一支「只加一個覆蓋」的 migration 變成重寫 G8。**那是另一片。**
  --         ⇒ 已明寫, 不假裝這裡是原子的。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_items) AS it
      JOIN public.product_variants AS pv
        ON pv.id = NULLIF(it ->> 'variant_id', '')::uuid
     WHERE NOT public.m3_jsonb_values_all_string(pv.spec)
        OR pv.spec ?| ARRAY['price_store', 'price_by_tier', 'cost']
  ) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 權威規格本身不合格(有非字串值, 或出現價格欄名)'
                    ' —— 這不是員工送錯, 是 product_variants.spec 那一列要先修好';
  END IF;

  INSERT INTO public.order_items (
    order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT v_order_id,
         NULLIF(it ->> 'variant_id', '')::uuid,
         it ->> 'variant_sku',
         -- ══ 🔴🔴 ⟦b4-SPEC1⟧:規格【不信呼叫端】—— 在這裡用權威那一份覆蓋 ═══════════
         --   病:這份快照是**不可變**的 ⇒ 送錯一次就永遠錯, 客人訂單明細上的顏色/尺寸補不回來。
         --   🔴 應用層 `284ee4cf`(2026-08-24)已修, 而**那顆 commit 動的檔在 `supabase/` 底下是 0 支**
         --      ⇒ 修法整個在應用層 ⇒ **任何不走那支 repository 的 `service_role` 呼叫端仍然繞得過。**
         --   ⇒ 本片是 DB 那一半。
         --   🔴 **為什麼取在這裡而不是迴圈裡**(codex R1 MF1):這裡在冪等比對【之後】
         --      ⇒ 指紋仍然只吃呼叫端送的東西 ⇒ 檔頭 `:207` 那句「決定性」保住;
         --      而重送時走的是上面那條 early return, **根本不會跑到這一行**
         --      ⇒ 變體事後被改被刪都不影響既有那張單。
         --   🛑 代購品項(`variant_id` 是 NULL)⇒ `LEFT JOIN` 不命中 ⇒ 走 `it -> 'product_snapshot'` 原樣,
         --      它恆 `{}` 是**既有的刻意限制**(`manual-order-repository.ts:265` 同款判斷), 不是本片要解的。
         --   ⚠️ 變體不存在(被刪)而 `variant_id` 非 NULL ⇒ `pv.spec` 是 NULL ⇒ `COALESCE` 成 `{}`;
         --      **而那一列的 FK 會在同一句 INSERT 裡擋下整筆** ⇒ 不會留下空規格的真訂單。
         --   ⚠️ `SET search_path = ''` ⇒ 表名寫全 `public.product_variants`。
         --   📎 權威來源:`20260531142533_init_product_variants.sql:43`(`spec jsonb NOT NULL DEFAULT '{}'`)
         --      · `:62` CHECK 只保證 object · `:40` `id uuid PRIMARY KEY` ⇒ 一個 variant 恰一份 spec。
         -- ══ 🔴🔴 Sean 2026-09-01 12:0x 拍【甲】—— 原話一個字:「甲」 ══════════════
         --   題目逐字:「員工手動建單選了網站上有的商品, 而那個商品在我們目錄裡沒有填規格。
         --             員工自己打了規格。訂單上要留哪一份?」
         --     甲 留員工打的(目錄有填才用目錄的)  ← **他選這個**
         --     乙 一律用目錄的(目錄空的就寫空的)  ← ⛔ **本檔原本的行為, 已被推翻**
         --     丙 擋下來, 叫員工先去補目錄
         --   落點 `~/pcm-mailbox/決策-手動建單目錄沒填規格時用誰的-20260901.md`
         --
         --   🔴 **為什麼**(端題時給他的那一句):目錄是空的時候, 它**不是一個更可信的真相,
         --      它是【沒有值】** ⇒ 拿沒有值去蓋掉有值, 不是取權威, 是**把資料弄丟**,
         --      而且丟得很安靜 —— 員工打了字、按了送出、單子成立了, 而那格是空的, 畫面零訊號。
         --   🔴 **而它踩得到多少**:`product_variants` 54,000 列 / 空規格 **13,112(24%)**
         --      (2026-08-31 主視窗唯讀跑正式庫, 數字與範圍見本檔 `:31`)。
         --
         --   ══ 「空」的定義:三種都處理, 而只有第三種在今天可達 ═══════════════════
         --     ① `pv.spec IS NULL`  ⇒ 🔵 **今天不可達**:欄位是 `NOT NULL DEFAULT '{}'`
         --        (`20260531142533_init_product_variants.sql:43`)。仍然寫進條件, 理由是
         --        **它今天不可達的依據是【另一支檔的欄位定義】** —— 那支哪天放寬了,
         --        這裡會安靜地把 NULL 當成「有值」丟進 `jsonb_set` ⇒ 整格變 NULL。
         --     ② 空字串 `''` ⇒ 🔵 **結構上不可達**:`pv_spec_is_object` CHECK 要求
         --        `jsonb_typeof(spec) = 'object'`(同檔 `:62`)⇒ 字串進不了這一欄。
         --        ⇒ 所以**不為它寫條件** —— 寫了會是一句永遠為假的死碼, 而死碼讀起來像防護。
         --     ③ `pv.spec = '{}'::jsonb` ⇒ 🔴 **這才是那 13,112 列** ⇒ 本片真正要擋的那一種。
         --   ⛔ ~~我原本寫「`{"a": null}` 算有值, 會贏過員工那份, 那是刻意的」~~ **作廢**
         --      (codex R1 抓的):`{"a": null}` **根本走不到這裡** ——
         --      上面 `m3_jsonb_values_all_string` 那道(`:549` 一族)要求值全部是字串,
         --      `null` 不是 ⇒ **整張單直接 RAISE**。⇒ 我描述了一個不存在的行為。
         --      📌 而它讀起來完全合理, 因為它在講一個**看起來會發生**的情境。
         --
         --   ══ 🔴🔴 **「空」在這一格有【兩個意思】, 而 Sean 分開答了兩次** ══════════
         --      ① **空的 jsonb `{}`**(整個規格沒有任何鍵)⇒ **留員工打的**
         --         依據:Sean 2026-09-01 12:0x 原話一個字「甲」。
         --      ② **鍵在、而值是空字串**(`{"color": ""}`)⇒ 🔴 **用目錄的那個空白**
         --         依據:Sean 2026-09-01 12:1x 原話逐字「**算有填(用目錄的空白)**」。
         --      ⇒ ✅ 所以本 CASE 只判 `{}`, 是**對的**, 不是漏掉 ②。
         --
         --      🔵 **這一格的來歷寫下來, 因為它差一點被我自己決定掉**:
         --      codex R1 舉了 `{"color": ""}` 當 must-fix 反例(「用空字串蓋掉員工打的紅」)。
         --      🛑 而我判它**不是 bug, 是一格沒有被問到的業務規則** ⇒ 沒有自行擴張拍板, 端上去問。
         --      ⇒ 他花一行答完, 而答案是 ②(與我原本猜的方向相反 —— 我以為他會想保住員工那份)。
         --      📌 **⇒ 我猜錯了, 而因為我沒有把猜的東西寫成碼, 那個錯不需要任何人來修。**
         --      ⇒ ⇒ 若當時自己決定, 他永遠不會知道有這一格,
         --         而它會變成一個沒有人記得為什麼的行為。
         CASE WHEN pv.id IS NULL
                OR pv.spec IS NULL
                OR pv.spec = '{}'::jsonb
              THEN it -> 'product_snapshot'
              ELSE pg_catalog.jsonb_set(it -> 'product_snapshot', '{spec}', pv.spec)
         END,
         (it ->> 'quantity')::integer,
         (it ->> 'unit_price')::integer,
         (it ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) AS it
    LEFT JOIN public.product_variants AS pv
           ON pv.id = NULLIF(it ->> 'variant_id', '')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 品項落 % 列、期望 %;整筆回滾',
                    v_n, pg_catalog.jsonb_array_length(v_items);
  END IF;

  -- ── G9 稽核落列(F1;形狀逐字對齊 `20260804180000:251-260`)────────────────
  -- 🔴 `before` 是 NULL 而不是 `{}` —— **這張單建立之前不存在**,那不是「空的狀態」是「沒有狀態」。
  -- 🔴 `after` 只放**訂單層**的欄與**筆數**,不逐品項展開:
  --    ① 品項細節在 `order_items`,`target` 指得到那張單 ⇒ 查得到,不必抄一份
  --    ② 稽核表是 append-only、永久留存 ⇒ **少抄一份 = 少一個會過期、會外洩的副本**
  --    ⚠️ 零經銷價、零 cost(本函式從頭到尾不查價,見檔頭 §4)。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (pg_catalog.btrim(p_actor, E' \t\r\n'), 'order.manual_create',
          -- ⚠️ **`request_id` 這一欄的語意在這裡與別的 admin 操作不同源**(f5 R3 nit,記一筆):
          --    建表註解(`20260712210000:51`)說它是「correlation id(貫穿 admin 寫入→audit→DB→外部服務 log)」,
          --    而本函式填的是**本片自己的冪等鍵** `manual_request_id`。
          --    ✅ 它**串得回那一次操作**(那正是 correlation 要的),所以合理、不改。
          --    ⚠️ 但**它不是別處那個 request_id 的同一條血脈** ⇒ 拿它跨操作做關聯查詢時要知道這件事。
          'order:' || v_order_id::text, p_manual_request_id::text,
          NULL,
          pg_catalog.jsonb_build_object(
            'display_id',       v_display_id,
            'customer_user_id', p_customer_user_id,
            'order_source',     p_order_source,
            'payment_channel',  p_payment_channel,
            'shipping_method',  p_shipping_method,
            'subtotal',         v_subtotal,
            'shipping_fee',     p_shipping_fee,
            'total',            v_total,
            'item_count',       pg_catalog.jsonb_array_length(v_items)),
          NULL, 'admin');
  -- 🔴 筆數守:trigger 抑制 / FORCE RLS ⇒ **零稽核的成功建單**,而那正是 F1 要擋的東西
  --    ⇒ 落不進去就整筆回滾,**不接受「單建好了但沒人知道是誰建的」**。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稽核落 % 列(期望恰 1)⇒ 整筆回滾;'
                    '這張單不准在沒有經手人紀錄的情況下存在', v_n;
  END IF;

  -- ⚠️ **重送(idempotent)那條路【不落 audit】** —— 它在 G6.5 就 return 了。
  --    理由:那一發**什麼都沒建**,而 audit 記的是「發生了什麼」不是「誰按過按鈕」。
  --    ⇒ 一張單 = 恰一列 `order.manual_create`。查「誰建的」不會查到兩個人。

  -- 🔴 **刻意不寫 `order_legal_consents`** —— 手動單沒有客人的同意動作,偽造它是錯的。
  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order_id, 'display_id', v_display_id, 'idempotent', false);
END;
$fn$;
-- ── 後置斷言 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src    text;
  v_src_nc text;   -- 🔴 剝掉整行註解之後的碼(見下面那段)
  v_fp     text;
  v_n      int;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)'::regprocedure;

  -- ══ 🔴🔴 codex R1 must-fix(2026-09-01):**下面那些 `LIKE` 全都在讀【含註解的】原始碼** ══
  --   `prosrc` 是函式本體, 而函式本體裡有它自己的註解 ——
  --   ⇒ 一個字面只要出現在**任何一行註解**裡, 那道閘就命中 ⇒ **把真的碼刪掉也照樣全過。**
  --   🔴 而這一格是我自己造的:我剛加的 ⑥c/⑥d 找的是 `pv.spec = '{}'::jsonb` 與 `pv.spec IS NULL`,
  --      **而我在同一次改動裡把這兩個字面寫進了註解** ⇒ 兩道新閘出廠就是假綠。
  --   📌 一把讀字面的尺, 它的分母包含【所有在講這件事的字】—— 而作者自己的註解最會講那件事。
  --      (同族第三次:`20260901020000` 的負對照命中我自己寫的負對照;鐵則 11 那條的文字層版本。)
  --   ⇒ 修法沿用本檔 ① 已經在用的那個做法(逐行、丟掉 `^\s*--`), 不另發明。
  --   🔴🔴 **codex R2 must-fix:只剝【整行】不夠。**
  --      ⛔ ~~我原本寫「本檔註解全是整行式, 這個粒度足夠」~~ **作廢** ——
  --      那句話描述的是**今天的檔**, 而這幾道閘防的是**未來有人改它**。
  --      反例(codex 現造):把條件改成 `OR FALSE -- pv.spec = '{}'::jsonb`
  --      ⇒ 行為退回【乙】, 而 ⑥c 命中那個**行尾註解** ⇒ 假綠。
  --      📌 **⇒ 「現況足夠」與「防得住改動」是兩件事, 而一道閘的用途是後者。**
  --   ⇒ 改法:整行 + 行尾一起剝(`--` 到行末)。
  --   ⚠️ **代價寫明:字串常數裡若出現 `--`, 它會被誤剝** ⇒ 那個方向是**漏檢**(把碼變短),
  --      而漏檢會讓閘紅得比該紅的多(fail-closed), 不會讓它假綠。
  --      🟢 **而它今天不會誤傷**:本函式本體實掃 ⇒ **零個字串常數含 `--`**(2026-09-01 量)。
  SELECT pg_catalog.string_agg(pg_catalog.regexp_replace(l, '--.*$', ''), E'\n')
    INTO v_src_nc
    FROM pg_catalog.regexp_split_to_table(v_src, E'\n') AS l;

  -- ── ① 權威查詢真的在裡面(而它先跑 ⇒ 它給的是【哪裡不一樣】)──────────────
  -- 🔴 右界一定要釘:`LIKE '%public.product_variants%'` **也會命中 `public.product_variants_ZZQ`**
  --    ⇒ 改名成別張表時它照樣過, 而該紅的那一發會掉到 ⑤(指紋)去 —— 那就少了「哪裡不一樣」。
  --    (同族:`latest-definition-of.sh` 檔頭記的 `..._display_ids_v2` 那一格。)
  --    實測:本檔第一版就是 LIKE, 突變 M1(改名)⇒ ① 放行、⑤ 開火 ⇒ 已改成釘右界的正規式。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.regexp_split_to_table(v_src, E'\n') AS l
   WHERE l !~ '^\s*--' AND l ~ 'public[.]product_variants(?![a-zA-Z0-9_])';
  IF v_n < 1 THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置①:非註解行找不到 public.product_variants ⇒ 權威查詢沒進去';
  END IF;

  -- ── ② 代購那條路還在(不得把 variant_id IS NULL 也拖去查)────────────────
  IF v_src_nc NOT LIKE '%v_spec := COALESCE(v_line -> ''spec''%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置②:代購品項(variant_id IS NULL)那條 fallback 不見了 ⇒ 它會建不了單';
  END IF;

  -- ── ③ 三道既有驗證都還在(它們現在驗的是權威那一份)──────────────────────
  IF v_src_nc NOT LIKE '%m3_jsonb_values_all_string%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置③:值全字串那道驗證不見了';
  END IF;
  IF v_src_nc NOT LIKE '%price_by_tier%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置③b:價格欄名那道驗證不見了 ⇒ 經銷價可能進快照';
  END IF;

  -- ── ④ 安全屬性沒掉 ──────────────────────────────────────────────────────
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p
           WHERE p.oid = 'public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置④:SECURITY DEFINER 掉了';
  END IF;

  -- ── ④b 🔴 `search_path` 沒掉(codex R1 MF2)────────────────────────────────
  --    指紋只比 `prosrc` ⇒ **`SET search_path = ''` 被拿掉時它一個字都不會變** ——
  --    而那一格掉了, 函式裡每一個沒加 `pg_catalog.` 前綴的名字都會走呼叫端的 search_path。
  --    📌 一個 SECURITY DEFINER 函式失去 search_path 釘選 = 提權路徑, 而指紋對它零判別力。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)'::regprocedure
       -- 🔴 實測:`SET search_path = ''` 存進 proconfig 是 `search_path=""`(帶兩個引號),
       --    **不是** `search_path=` ⇒ 用 `@> ARRAY['search_path=']` 比會**恆假**。
       --    而它恆假的後果不是漏報是**誤報**:第一發 apply 就被自己的斷言擋下、整筆回滾
       --    ⇒ 函式從來沒被換掉 ⇒ 而世界 A/B 的紅看起來像「覆蓋沒生效」。
       --    📌 **一個寫錯的斷言, 它的紅會指向被測物, 不會指向它自己。**
       -- 🔴 codex R2:`LIKE 'search_path=%'` **太寬** —— `search_path=public, pg_temp` 也會過,
       --    而那正是這道斷言要擋的東西。⇒ 釘死成空字串那一種(實測 proconfig 存的是 `search_path=""`)。
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置④b:search_path 釘選掉了(proconfig 裡沒有 search_path=)';
  END IF;

  -- ── ④c 🔴 anon / authenticated 不得可 EXECUTE(codex R1 MF2)──────────────
  --    `CREATE OR REPLACE` **不會**改 ACL ⇒ 本檔理論上動不到它;
  --    而正式庫的 ACL 會漂移(路由表那條「新物件出生就自帶 anon 權限」),
  --    ⇒ 這一道不是為了防本檔, 是為了**在這一刻順手量一次**。
  IF pg_catalog.has_function_privilege('anon',
       'public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置④c:anon 或 authenticated 可以 EXECUTE 這支函式';
  END IF;

  -- ── ⑥ 🔴 G8 的權威覆蓋真的在(codex R2 nit:②的名字比它的能力寬)────────────
  --    ② 找的是【舊迴圈裡那個賦值】, ③ 找的是函式名與欄名字面 ——
  --    **兩者對「G8 那個 CASE 被拿掉 / 被改成只在空值時覆蓋」零判別力**(M2/M3 實測都是⑤殺的)。
  --    ⑤ 指紋擋得住 ⇒ 不是安全缺口;而**⑤ 只說「不一樣」, 說不出「哪裡不一樣」**
  --    ⇒ 這一道補的是【訊息】, 不是防線。
  IF v_src_nc NOT LIKE '%jsonb_set(it -> ''product_snapshot'', ''{spec}'', pv.spec)%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置⑥:G8 的權威覆蓋(jsonb_set … pv.spec)不見了 ⇒ 快照會用呼叫端送的那一份';
  END IF;
  -- ⛔ ~~原本比對 `CASE WHEN pv.id IS NULL THEN it -> 'product_snapshot'`(單行形狀)~~
  --    **作廢**:Sean 2026-09-01 拍【甲】之後那個 CASE 變成三條件多行 ⇒ 舊字面必然不匹配。
  --    🔴 **而它會【炸在 apply 當下】, 不是安靜地過** —— 那是對的方向(fail-closed),
  --       但它炸的訊息會說「代購那條分支不見了」, 而真相是「我改了它而忘了改這道閘」
  --       ⇒ 📌 **一道閘的訊息若指向錯的原因, 修的人會往錯的地方找。**
  IF v_src_nc NOT LIKE '%CASE WHEN pv.id IS NULL%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置⑥b:代購那條分支(pv.id IS NULL ⇒ 原樣)不見了 ⇒ 代購品項會被拖去查權威';
  END IF;

  -- ── ⑥c 🔴 Sean 拍【甲】那一格:目錄空的時候不覆蓋 ────────────────────────
  --    🛑 **這一道是新的, 而它存在的理由是 ⑥ 與 ⑥b 對它零判別力**:
  --       ⑥ 只確認 `jsonb_set(… pv.spec)` 那個字面在;⑥b 只確認代購那條分支在。
  --       ⇒ **把「目錄空就留員工的」那兩個條件拿掉, 上面兩道照樣全過** ——
  --         而那正好把行為改回 Sean 剛推翻的【乙】。
  --    📌 一道守門守得住它列出來的那幾種, 而【剛剛才決定的那一種】不會自己出現在舊清單裡。
  IF v_src_nc NOT LIKE '%pv.spec = ''{}''::jsonb%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置⑥c:目錄空就不覆蓋那個條件(pv.spec = ''{}'')不見了 ⇒ 行為退回【乙】, 而 Sean 2026-09-01 拍的是【甲】';
  END IF;
  IF v_src_nc NOT LIKE '%pv.spec IS NULL%' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置⑥d:pv.spec IS NULL 那個條件不見了 ⇒ 欄位哪天放寬成可 NULL 時, jsonb_set 會把整格寫成 NULL';
  END IF;

  -- ── ⑤ 🔴 指紋:總簽收, 刻意排最後 ────────────────────────────────────────
  --    🛑 **而它擋不住的那一格, codex R1 MF2 講明了, 寫在這裡不要讓下一個人以為它是全包的**:
  --       本檔的後置斷言只在**本檔 apply 的那一刻**跑一次 ⇒ 它擋得住「有人竄改本檔」,
  --       **擋不住「日後另寫一支 migration 把它改回去」** —— 那支會有它自己的指紋, 而本檔早就跑完了。
  --       ⇒ 那需要的是**常設守門**(CI / 定期稽核), 不是一支 migration 裡的斷言。**本片沒有做那件事。**
  --    ②〜④ 先跑, 給的是【哪裡不一樣】;指紋最後跑, 答【還有沒有別的地方不一樣】。
  --    (慣例對齊 20260810170000 / 20260831010000 那幾支 —— 指紋放最後。)
  v_fp := pg_catalog.md5(pg_catalog.regexp_replace(pg_catalog.regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'));
  IF v_fp <> 'e387b096263c72e858575a33be248239' THEN
    RAISE EXCEPTION '⟦b4-SPEC1⟧ 後置⑤:換上去的那一版指紋是 %, 而本檔預期的是 % ⇒ 我裝上去的不是我寫的那一支', v_fp, 'e387b096263c72e858575a33be248239';
  END IF;
END
$post$;

COMMIT;

-- ══ rollback —— 🔴 而【退版不會退資料】, 那句話是這一節的重點 ═══════════════════
--
-- 🛑 **步驟 0(先讀完再動)**:退版**只換回函式**。已經用新版建過的單, 它們的
--    `order_items.product_snapshot` **不會跟著回去** —— 那是不可變快照, 沒有東西會去改它。
--    ⇒ 📌 **退完之後庫裡會同時存在三種世代的快照**:
--         ① apply 之前建的(spec = 員工送的)
--         ② apply 之後建的(spec = 目錄那一份)   ← **退版之後這些留在原地**
--         ③ 退版之後建的(spec = 員工送的, 回到 ①)
--    ⇒ **而它們在同一張表裡長得一模一樣, 沒有任何欄位分得出來。**
--
-- ── 步驟 1:撈出受影響的訂單(退版【之前】先跑, 退完就分不出來了)──────────
--    判準用時間窗:apply 的時刻 ~ 退版的時刻之間建立的手動單。
--    🔴 **`orders` 沒有「這張單是哪一版建的」這種欄** ⇒ 只能用時間, 而時間要自己記下來。
--    ⇒ **apply 的當下就把時刻記進 `APPLIED.tsv` 那一列**(本檔要求, 見下面步驟 3)。
--
--    SELECT o.display_id, o.created_at, oi.variant_id, oi.variant_sku,
--           oi.product_snapshot -> 'spec' AS 快照規格,
--           pv.spec                        AS 目錄現值,
--           (oi.product_snapshot -> 'spec') IS DISTINCT FROM pv.spec AS 兩者不同
--      FROM public.orders o
--      JOIN public.order_items oi ON oi.order_id = o.id
--      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
--     WHERE o.manual_request_id IS NOT NULL          -- 只有手動單走這支 RPC
--       AND o.created_at >= '<APPLY 的時刻>'::timestamptz
--       AND o.created_at <  '<退版的時刻>'::timestamptz
--     ORDER BY o.created_at;
--    🔵 正對照:把時間窗改成 apply 之前的一段 ⇒ 應該撈到 0 列(那時還沒有第②代)
--    🔵 負對照:`manual_request_id IS NULL` ⇒ 應該撈到 0 列(那些不是手動單)
--
-- ── 步驟 2:人工核對要核什麼 ────────────────────────────────────────────
--    對步驟 1 撈到的每一列, 看 `兩者不同`:
--      · `false` ⇒ 快照與目錄一致 ⇒ **不必動**(第②代與第③代在這裡沒有差別)
--      · `true`  ⇒ 🔴 兩種可能, **而它們要分開處理**:
--          (a) 目錄那一列在期間被改過 ⇒ 快照是【當時】的真相 ⇒ **不必動**(快照本來就該凍住)
--          (b) 目錄當時是 `{}` 而員工手打了規格 ⇒ **員工那份被吃掉了** ⇒ 要人工補
--        🛑 **(a) 與 (b) 在這張表上分不出來** —— 要看 `admin_audit_log` 那一列的 `after`,
--           或問建那張單的人。⇒ **這一步沒有自動化的路, 照實寫。**
--
-- ── 步驟 3:退版本身要進帳本 ────────────────────────────────────────────
--    退版是一次 apply ⇒ `supabase/APPLIED.tsv` 要加一列, 而那一列必須寫死兩句:
--      · **「本次為退版:把 admin_create_manual_order 換回 20260829140000 那一版」**
--      · 🔴 **「退版不會退資料 —— 期間建立的單, 其快照維持第②代」** + 步驟 1 撈到的訂單編號
--    ⇒ 📌 少了第二句, 下一個人讀帳本會以為「退版了 ⇒ 一切回到 apply 之前」。
--
-- ── 步驟 4:真正的退版指令 ──────────────────────────────────────────────
-- 🛑 沒有「一行還原」—— CREATE OR REPLACE 換掉整個本體。要還原就是把
--    20260829140000_m4b_b2c_manual_order_explicit_tax_total.sql:97-580 那一段原樣
--    CREATE OR REPLACE 回去。⇒ 從那支檔抄, 不要憑記憶重打。
--    ⚠️ 而**本檔的前置閘會擋住重新 apply**(它認得改後那一版的指紋)
--       ⇒ 退版之後若要再 apply 一次, 前置閘會放行(因為庫裡又變回 gen2 了)。
--
-- ✅ **而以上不是「我想過了」—— 步驟 1/2/4 已在拋棄式 PG 上真的演過一次**
--    (`scripts/spec1-apply-probe.sh` 的 `rollback` 那一格:apply ⇒ 建一單 ⇒ 退版 ⇒
--     撈受影響訂單 ⇒ 確認那張單的快照【沒有】跟著回去)。
