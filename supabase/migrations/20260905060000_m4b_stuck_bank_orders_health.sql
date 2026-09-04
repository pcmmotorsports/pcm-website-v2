-- M-4b · ⟦b4-NEEDSHUMANNOWATCHER⟧ 一張「系統算不清楚」的匯款單, 現在沒有人會知道它存在
-- ==========================================================================
-- ── 這一片在補什麼洞 ──────────────────────────────────────────────────────
--   `20260904230000` 讓收到錢的匯款單自己翻成 paid / partiallyPaid ——
--   而 verdict = `overpaid`(客人多匯)或 `needs_human`(算不清)那兩種**刻意不翻**。
--   🔬 理由寫在該檔碼裡:`payment_status` 的五個值裡**沒有**對應「溢收」的值
--     ⇒ 不猜一個最接近的;而 `needs_human` 是它自己宣告算不清 ⇒ 不該由它決定終態。
--   🔵 那張單**不會被逾期取消**(該片的淨額腿涵蓋這兩種)⇒ **錢不會丟。**
--   🛑 **而沒有人會去看它。**
--     🔬 2026-09-05 實測:`grep -rl needs_human apps/admin/src` ⇒ **2 支, 而兩支都是物流(hct)**
--     ⇒ 🔴 **後台零面在顯示這件事。**
--   ⇒ 🎯 **而客人那端看到的是:錢匯出去了, 而訂單頁還寫著「請於 5 天內匯款」+ 銀行帳號**
--     (`OrderDetailView.tsx:598` 的顯示條件逐字 `paymentStatus === 'unpaid'`)
--     ⇒ ⇒ 🔴 **他會再匯一次。**
--
-- ── 本片做什麼(一件)──────────────────────────────────────────────────────
--   一支唯讀 RPC `public.get_stuck_bank_orders_health()`,給每天早上那封 anomaly-alert 用。
--   命中時信裡多一行;**不命中零字**。
--
-- ── 🔴 形狀照 `20260904240000_m4b_search_log_health.sql`(線【資料】`-db` 的模子)────
--   裸 `CREATE`(新物件撞名要當場紅)· `SECURITY DEFINER` · `SET search_path = ''`
--   · 四道 REVOKE 再單一 `GRANT … TO service_role` · 回傳 jsonb
--   🔵 **刻意不自己發明一套** —— 📌 兩支長得不一樣的同類 RPC, 下一個人要讀兩遍。
--
-- ── ⚠️ 模子的那個缺口, 與【本片的實際情況】────────────────────────────────
--   🔬 `-db` 2026-09-05 主動告知:模子(`20260904240000`)的 ACL **只給 `service_role`**
--     ⇒ 唯讀連線叫不動它 ⇒ **「它跑得動嗎」在那支上到今天沒有人驗過。**
--   ⛔ ~~而本片同樣繼承這個缺口~~ **那句話作廢**(adversarial-reviewer R3 F1)——
--     🔴 **本片的真正問題不是「驗不到」, 是【授錯角色】**:呼叫者是 `payment_confirmer`,
--       而我照模子只授了 `service_role` ⇒ **上線即壞**(見上面 GRANT 那段)。
--     ⇒ 🎯 **⇒ 我從模子繼承的不只是形狀, 還有一句【替它辯護的話】** ——
--       而那句話會讓下一個人把這個 bug 讀成「已知代價」。
--   ✅ 現況:已補 `TO payment_confirmer`(與 12 支姊妹一致), 事後閘②白名單同步放行。
--   ⚠️ **而「它真的跑得動嗎」仍然沒有被驗過** —— 那一格的成因是唯讀連線的權限,
--     與授錯角色無關。**交件不得寫成「已驗」。**
--     ✅ 行為驗證掛在:anomaly cron 下一輪真的跑一發。
--
-- ── 🛑 這一版證不到什麼 ──────────────────────────────────────────────────
--   · **本函式跑不跑得動沒有被驗過**(見上)—— 只驗到它建得起來、ACL 對、簽名對
--   · verdict 是**算出來的不是欄位** ⇒ 本片逐列呼叫 OP6a(它是 `LANGUAGE sql STABLE`, 呼叫得動)
--     ⇒ ⚠️ **而分母大時它會慢** —— 本片先用四個條件把分母收窄, 而**沒有量過真實資料的耗時**
--   · 沒有驗「這一行真的會出現在客人收到的那封信裡」—— 那是 TS 那半 + cron 的事
--   · 🔵 **codex R1 ① 我判【在本片上不成立】, 而它指出的缺口是真的、住在別處**:
--     它說「收款當時重算暫時失敗 ⇒ `20260904230000` 吞例外留 `unpaid` ⇒ 隔天重算得到
--     `settled/underpaid` 時狀態沒有被修正」。
--     🔬 而本片的濾網是**逐列【重新】算 verdict**(不是讀一個存下來的欄位)
--       ⇒ 那種單今天會算出 `settled` ⇒ **`WHERE verdict IN ('overpaid','needs_human')` 濾掉它**
--       ⇒ 📌 **⇒ 本片不會把它誤報成「卡住」。**
--     🔴 **而那個缺口本身是真的**:一張「錢收了、重算當時失敗、狀態停在 unpaid」的單,
--       **今天沒有任何東西會回頭修它** —— `20260904230000` 的重算只在 INSERT 那一刻跑一次。
--       ⇒ 🛑 **而它會被逾期 cron 的淨額腿保住(不被取消), 然後永遠停在 unpaid。**
--       ⇒ 🎯 **⇒ 客人的訂單頁會一直顯示「請匯款」** —— 與本片要解的那個病同一個後果, 而**成因不同**。
--       ⇒ 📎 已開板列 `⟦b4-SETTLERETRYNEVER⟧`;本片**看不到它**(它的 verdict 是 settled)。
--   · ⛔ ~~🔴🔴 只數 `payment_status = 'unpaid'` ⇒ 【已付款的單被多匯】今天零觀眾~~
--     ⛔ ~~🔵 維持 unpaid 是刻意的:信的文案講「訂單頁顯示請匯款 + 銀行帳號」…擴分母會讓一封信
--        同時講兩種不同的世界, 而那段文案還沒有人寫(客服稿 Q6 也只涵蓋 unpaid)。~~
--     🔴🔴 **以上兩句 2026-09-05 夜【作廢】** —— 那個缺口**已經補掉了, 而這一節沒跟著改**
--       (code-reviewer must-fix:檔頭與 `WHERE` 子句、`COMMENT`、板列**四處互相矛盾**)。
--       📌 **⇒ 而它比一個錯的註解糟**:這一節叫「這一版證不到什麼」——
--         **讀的人來這裡就是為了知道還缺什麼**, 而它會叫他去做一件已經做完的事。
--       🛑 **舊字面留刪除線不刪** —— 搜「已付款被多匯 零觀眾」的人要同一發撞到訂正。
--     ✅ **現況(2026-09-05 夜, 主視窗 `Q1=乙` / `Q2=甲`)**:分母是**三態**
--       (`unpaid` / `paid` / `partiallyPaid`), 而信裡**兩個世界各講各的話**;
--       客服稿 §⑤ Q6 已補 **⑵b**(「已經顯示付款完成了, 而他又匯了一次」)。
--     🔴 **而【仍然證不到】的那一半換了形狀, 不是消失了** ——
--       B 世界用 `已收淨額 > orders.total` 預篩(純算術, 為了不讓每輪 cron 對
--       **每一張已付款匯款單**叫一次 OP6a)⇒ **會漏掉「`total` 對不上而 OP6a 判 overpaid」的單**
--       (有退款的單 `total` 不會變而應收會變)。
--     ⇒ 📎 板列 `⟦b4-PAIDTHENOVERPAID⟧` **仍然開著**, 而它現在記的是**預篩的代價**,
--       不是原本那個缺口。裁決逐字:**先做甲, 量到漏的那種再改乙(不預篩)。**
--   · 🔴 **只數 `bank_transfer`** ⇒ **`cash` 那一類卡住時本片看不到**(codex R1 ② 逼出來的收窄)。
--     🔵 理由是文案:信裡講「訂單頁顯示銀行帳號」, 而現金單的客人看不到那個畫面。
--     ⇒ 📌 **現金單卡住是【真的缺口】, 只是它需要另一段文案 —— 而那段文案還沒有人寫。**
-- ==========================================================================

BEGIN;

CREATE FUNCTION public.get_stuck_bank_orders_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- 🔴 `''` 而不是 `public, pg_catalog` —— 後者把可寫的 schema 排在 pg_catalog 前面,
--    而那是 SECURITY DEFINER 提權的標準路徑(模子檔 :43-49 逐字記著這條 must-fix)。
SET search_path = ''
AS $fn$
DECLARE
  v_cnt      integer := 0;     -- 世界 A:仍 unpaid(客人的訂單頁還在說「請匯款」)
  v_first    timestamptz;
  v_cnt_op   integer := 0;     -- 世界 B:已付款/部分付款而多收(畫面正常, 而錢多了)
  v_first_op timestamptz;
BEGIN
  -- 🔴 **分母先收窄, 再逐列算 verdict** —— OP6a 是 STABLE 呼叫得動, 而它不便宜。
  --    四個條件全部來自 `20260904230000` 那兩種 verdict 停下來的地方:
  --      ① ⛔ ~~非卡片軌~~ **只有 `bank_transfer`**(codex R1 ② 收窄;現金/none 見下方「證不到什麼」)
  --      ② 未取消
  --      ③ 狀態仍 unpaid —— overpaid / needs_human 就是【停在這裡】的那兩種
  --      ④ 已收淨額 > 0 —— 沒收到錢的單不是本片要找的東西
  --    ⇒ 📌 ④ 同時排掉「客人根本沒匯」那一大類, 那是逾期 cron 的事不是本片的。
  WITH candidate AS (
    SELECT o.id, o.created_at, o.payment_status, o.total,
           (SELECT coalesce(pg_catalog.sum(p.amount), 0)
              FROM public.order_payments p WHERE p.order_id = o.id) AS received
      FROM public.orders o
     -- 🔴 ⛔ ~~`payment_channel <> 'tappay'`~~ **作廢**(codex R1 must-fix ②):
     --    🔬 值域實測是四個:`('tappay', 'bank_transfer', 'cash', 'none')`
     --    ⇒ 那個否定式把 **`cash` 與 `none`** 也算進來,
     --      而**信裡的文案宣稱「那些客人的訂單頁仍然顯示【請匯款】+ 銀行帳號」**
     --      🔬 而顯示條件逐字是 `paymentChannel === 'bank_transfer'`
     --        (`OrderDetailView.tsx:598`)⇒ **`cash` / `none` 的客人看不到那個畫面。**
     --    ⇒ 🎯 **分母比文案寬 ⇒ 信會把不適用的單算進那個數字, 而客服照著去聯絡會撲空。**
     --    ✅ 收窄成**只有 `bank_transfer`** —— 那與文案、與客人看到的畫面**同一個集合**。
     --    ⚠️ **而 `cash` 那一類【也可能卡住】** —— 它只是不該用這封信的文案講。
     --      ⇒ 那是另一格, 已寫進本檔「這一版證不到什麼」。
     WHERE o.payment_channel = 'bank_transfer'
       AND o.cancelled_at IS NULL
       -- 🔴🔴 **三態, 不是一態**(主視窗 2026-09-05 `Q1-分母態=乙`;R4 F6 的板列
       --    ⟦b4-PAIDTHENOVERPAID⟧ 逐字寫著另外兩態被濾掉)。
       --    🔬 路徑:客人第一次匯剛好 ⇒ 翻 `paid`;**他再匯一次** ⇒ verdict `overpaid`
       --      ⇒ 而 230000 對 overpaid **刻意不翻狀態** ⇒ 停在 `paid` ⇒ 舊分母看不到。
       --      `partiallyPaid` 同型(先短匯 ⇒ 補匯補過頭)。
       --    ⚠️ `refunded` 【不在】三態裡 —— 那條路的錢已經退了, 不是本片要找的東西。
       AND o.payment_status = ANY (
             ARRAY['unpaid', 'paid', 'partiallyPaid']::public.payment_status[])
  ),
  -- 🔴🔴 **預篩分兩個世界, 而它是【效能】不是口味**(主視窗 2026-09-05 `Q2=甲`):
  --    🔬 舊分母只有 `unpaid` ⇒ 那個集合本來就小(卡住的才留在 unpaid)。
  --    🛑 而加上 `paid` 之後, 「淨額 > 0」對**每一張成功付款的匯款單**都成立
  --      ⇒ candidate = 史上所有已付款匯款單 ⇒ **每張叫一次 OP6a(七條前提的重函式)**
  --      ⇒ 📌 這支 RPC 的成本會從 O(卡住的單) 變成 O(所有訂單), 而它掛在每輪 cron 上。
  --    ✅ 所以已付款那半改用**純算術**預篩:`received > total`(overpaid 的定義就是收得比該收的多)。
  -- ⚠️⚠️ **這個預篩的代價, 逐字寫出來不藏**:
  --    它用的是 `orders.total`, 而 OP6a 算的是**它自己那一套**(含退款四面 / 帳本覆蓋 / 品項快照)
  --    ⇒ 🔴 **兩者可能不一致** ⇒ 會漏掉一種「`total` 對不上, 而 OP6a 判 overpaid」的單。
  --    ⇒ 📌 **那不是理論** —— 有退款的單 `total` 不會變, 而 OP6a 的應收會變。
  --    🔵 而主視窗裁的是:**先做甲, 量到漏的那種再改乙(不預篩)** ⇒ 板列 ⟦b4-PAIDTHENOVERPAID⟧ 留了那一句。
  prefiltered AS (
    SELECT c.* FROM candidate c
     WHERE (c.payment_status = 'unpaid'::public.payment_status AND c.received > 0)
        OR (c.payment_status <> 'unpaid'::public.payment_status AND c.received > c.total)
  ),
  judged AS (
    SELECT c.id, c.created_at, c.payment_status,
           public.admin_compute_order_settlement(c.id) ->> 'verdict' AS verdict
      FROM prefiltered c
  )
  -- 🔵 **兩個世界各自數, 因為信裡要各講各的話** ——
  --    A:客人的訂單頁還在說「請匯款」⇒ **他會再匯一次** ⇒ 急。
  --    B:畫面正常, 而錢多收了 ⇒ 不急, 而要退給他。
  --    📌 合成一個數字的話, 讀信的人分不出該打哪一種電話。
  SELECT
    count(*) FILTER (
      WHERE payment_status = 'unpaid'::public.payment_status)::integer,
    min(created_at) FILTER (
      WHERE payment_status = 'unpaid'::public.payment_status),
    count(*) FILTER (
      WHERE payment_status <> 'unpaid'::public.payment_status)::integer,
    min(created_at) FILTER (
      WHERE payment_status <> 'unpaid'::public.payment_status)
    INTO v_cnt, v_first, v_cnt_op, v_first_op
    FROM judged
   WHERE verdict IN ('overpaid', 'needs_human');

  RETURN pg_catalog.jsonb_build_object(
    'stuck_count',    v_cnt,
    -- 🔵 最早那一張的建立時刻 —— 讓讀信的人知道「這件事積了多久」, 而不只是「有幾張」。
    'oldest_created', v_first,
    -- 🔴 **第三鍵回 boolean 不回 NULL**(`-db` 2026-09-05 明示的那一格):
    --    NULL 會被下游讀成「沒問題」。⇒ 算得出來就是 true, 而算不出來的世界在上面已經 RAISE 了。
    -- 🔴 世界 B(已付款/部分付款而多收)—— **新鍵**(R4 F6 + 主視窗 2026-09-05)。
    --    🛑 鍵名不重用 `stuck_*` —— 兩個世界要打不同的電話, 合成一個數字就分不出來了。
    'overpaid_count',   v_cnt_op,
    'overpaid_oldest',  v_first_op,
    'measured',       true
  );
END
$fn$;

COMMENT ON FUNCTION public.get_stuck_bank_orders_health() IS
  'M-4b ⟦b4-NEEDSHUMANNOWATCHER⟧ + ⟦b4-PAIDTHENOVERPAID⟧:數【兩個世界】的匯款單(皆 bank_transfer + 未取消 + OP6a 判 overpaid/needs_human)。A=仍 unpaid 且已收淨額>0(客人的訂單頁還在說請匯款 ⇒ 他會再匯一次);B=已 paid/partiallyPaid 且已收淨額 > orders.total(畫面正常而錢多收了 ⇒ 要退給他)。'
  '🔴 那兩種是 20260904230000 【刻意不翻狀態】的 —— 錢在庫裡而狀態停在 unpaid ⇒ 客人的訂單頁仍顯示「請匯款」⇒ 他會再匯一次。'
  '回 jsonb 三鍵:stuck_count(整數)· oldest_created(最早那張的建立時刻, 可為 NULL 當 count=0)· measured(恆 true, 不回 NULL —— NULL 會被下游讀成沒問題)。'
  '🔵 零 PII、零金額;**帶不帶單號照 2026-08-19 Sean 本人那次的口徑**(他為了查得到而打開了單號)—— 本函式目前不帶, 要帶要再問他一次。'
  '🛑 可執行的是 service_role 與 payment_confirmer 兩個角色(anomaly cron 走的是後者);唯讀角色叫不動它 ⇒ 「它跑得動嗎」由 anomaly cron 下一輪實跑驗, 本片的事後閘驗不到。';

-- 🔴 **明寫 owner**(adversarial-reviewer R4 consider;姊妹片 `20260901060000` 有, 而
--    我抄的模子 `20260904240000` 沒有 ⇒ 📌 **我從模子繼承了兩個缺陷, F1 只修掉一個。**)
--    ⇒ 本函式是 `SECURITY DEFINER` ⇒ **它的權限就是 owner 的權限** ——
--      owner 是誰不寫下來, 就取決於「是誰貼的這支 migration」。
ALTER FUNCTION public.get_stuck_bank_orders_health() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_stuck_bank_orders_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_stuck_bank_orders_health() FROM anon;
REVOKE ALL ON FUNCTION public.get_stuck_bank_orders_health() FROM authenticated;
REVOKE ALL ON FUNCTION public.get_stuck_bank_orders_health() FROM service_role;

-- 🔴🔴 **`payment_confirmer` 才是真正的呼叫者**(adversarial-reviewer R3 must-fix F1)。
--    ⛔ ~~只 GRANT TO service_role(照模子 20260904240000 抄的)~~ ⇒ **上線即壞**:
--    🔬 `apps/storefront/src/lib/payment/composition.ts:215` 逐字
--      `new PgAnomalyAlertReaderAdapter(requireEnv('PAYMENT_CONFIRMER_DB_URL'), …)`
--    🔬 而 12 支姊妹 RPC 一致授 `payment_confirmer`(例:`20260901060000:145-146` ·
--      `20260903070000:185-186`, 兩支還帶「沒授給它 ⇒ 呼叫端叫不動」的 apply 期斷言)
--    ⇒ 🎯 **只授 service_role ⇒ 每一輪 cron 拿 `42501`(權限, 不是 42883)⇒ adapter throw
--      ⇒ `stuckBankFailed` ⇒ route 每天 503 + `recordHeartbeatFailure`
--      ⇒ ⇒ 隔天心跳訊號把 anomaly-alert **自己**報成不正常 = 自我維持的每日假警報。**
-- 🔵 `service_role` 保留 —— 它是平台角色, 而拿掉它不是本片的範圍。
GRANT EXECUTE ON FUNCTION public.get_stuck_bank_orders_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_stuck_bank_orders_health() TO payment_confirmer;

-- ══ 事後閘 ════════════════════════════════════════════════════════════════
DO $gate$
DECLARE
  v_functions text[] := ARRAY['public.get_stuck_bank_orders_health()']::text[];
  v_fn        text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    -- ① 形狀:SECURITY DEFINER + search_path 空字串
    --    🔵 兩種形狀都收 —— PG 實際存的是 `search_path=""`, 而寫死單一形狀會在乾淨庫當場紅
    --      (模子檔 20260904200000 的 codex must-fix 記過這一格)。
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = v_fn::regprocedure
         AND p.prosecdef
         AND (p.proconfig @> ARRAY['search_path=""'] OR p.proconfig @> ARRAY['search_path='])
    ) THEN
      RAISE EXCEPTION '事後①失敗:% 不是 SECURITY DEFINER + search_path='''' ⇒ 隔離沒生效。', v_fn;
    END IF;

    -- ② ACL:除了 owner 與 service_role, 不得有別人
    --    🔴 用 aclexplode 白名單, 不列舉角色名 —— 列舉是黑名單, 它跟下一個沒想到的角色賽跑。
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
           LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
       WHERE p.oid = v_fn::regprocedure
         AND a.grantee <> p.proowner
         AND a.grantee <> 'service_role'::regrole::oid
         -- 🔴 **白名單要含 `payment_confirmer`** —— 否則上面那道正確的 GRANT 一補,
         --    這一格會**當場紅**(R3 F1 逐字:「migration 的事後閘②會把正確的修法擋下來」)。
         --    ⇒ 📌 **一道閘擋住它自己要保護的那個修法, 而它印的是「有多餘的 grantee」。**
         AND a.grantee <> 'payment_confirmer'::regrole::oid
    ) THEN
      RAISE EXCEPTION '事後②失敗:% 有 owner / service_role / payment_confirmer 以外的 grantee。', v_fn;
    END IF;

    -- ③ 🟢 **正對照:service_role 【真的】拿得到**
    --    🛑 少了這一格, 一支「四道 REVOKE 而 GRANT 打錯字」的版本會讓 ② 全綠,
    --       而那封信永遠叫不動它 ⇒ 📌 **「沒有別人拿到」與「該拿到的人拿得到」是兩個宣稱。**
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '事後③失敗:service_role 拿不到 % 的 EXECUTE ⇒ 告警信叫不動它。', v_fn;
    END IF;

    -- 🔴🔴 ③b **真正的呼叫者是 `payment_confirmer`, 而它【原本沒有正對照】**
    --    (adversarial-reviewer R4:「F1 講的那個角色, 三道閘一格都沒問它」)。
    --    ⇒ 📌 **我補了 GRANT、補了白名單, 而【證明它拿得到】那一格沒補** ——
    --      ②只問「有沒有多餘的人」, 白名單放行 `payment_confirmer` 之後,
    --      **GRANT 那一行整個消失也照樣全綠。**
    --    ⇒ 🎯 這正是③自己註解裡那句話的第二個實例:
    --      **「沒有別人拿到」與「該拿到的人拿得到」是兩個宣稱。**
    --    🔵 形狀照姊妹片 `20260901060000` 的同一格。
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '事後③b失敗:payment_confirmer 拿不到 % 的 EXECUTE ⇒ anomaly cron 每輪拿 42501 ⇒ 每天一封假警報。', v_fn;
    END IF;
  END LOOP;

  -- 🔴🔴 ④ **直接 grantee 之外, 還要問「誰【變得成】 service_role」**(codex R1 must-fix ⑥)。
  --    ⇒ 上面②只看 `aclexplode` 的直接 grantee ⇒ 若 `anon` / `authenticated` 是
  --      `service_role` 的成員(可 `SET ROLE`), **三格全綠而門是開的**。
  --    ⇒ 📌 **「誰在 ACL 上」與「誰到得了那個角色」是兩個宣稱。**
  --    ✅ 形狀照 repo 既有成例 `20260611120000_m3_s2c_confirm_payment_rpc.sql:104-106`
  --      (它用 `pg_has_role(…, 'MEMBER')` 問同一件事)—— 不是我新發明的問法。
  IF pg_catalog.pg_has_role('anon', 'service_role', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'service_role', 'MEMBER') THEN
    RAISE EXCEPTION '事後④失敗:anon 或 authenticated 是 service_role 的成員 ⇒ 它們 SET ROLE 就能執行本函式, 而②那格看不到。';
  END IF;

  -- 🔴 ⑤ **還有一條路:切成 owner**(codex R2 must-fix ④)。
  --    ⇒ `MEMBER` 那一格問的是「能不能變成 service_role」, 而**函式的 owner 本來就執行得了**
  --      ⇒ 📌 **能變成 owner = 能執行 ⇒ 而④那格看不到這條路。**
  --    🔵 owner 是誰不寫死 —— 問 catalog(它可能不是 postgres, 而那本身是另一個問題)。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.get_stuck_bank_orders_health()'::regprocedure
       AND (pg_catalog.pg_has_role('anon',          p.proowner, 'MEMBER')
         OR pg_catalog.pg_has_role('authenticated', p.proowner, 'MEMBER'))
  ) THEN
    RAISE EXCEPTION '事後⑤失敗:anon 或 authenticated 可以切成本函式的 owner ⇒ 它們執行得了, 而②④兩格都看不到。';
  END IF;

  RAISE NOTICE '[20260905060000] 五組事後斷言全數通過。';
END
$gate$;

COMMIT;

-- ══ 還原 ══════════════════════════════════════════════════════════════════
-- ⚠️ **下面是註解, 不是可執行的 SQL** —— 要用請自己把 `-- ` 拿掉再貼。
-- DROP FUNCTION public.get_stuck_bank_orders_health();
