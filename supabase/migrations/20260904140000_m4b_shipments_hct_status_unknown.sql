-- M-4b · `shipments.hct_status` 值域加一個 `unknown`
-- ⟦ship-HCTAPI⟧ 片 C 的前置 · 2026-09-04 · 線【後台·列印與出貨文件】`-ship`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🟢 **本支可以【獨立貼】, 不依賴任何其他 SQL。**
-- ══════════════════════════════════════════════════════════════════════════
--    今天另有一支要貼的 SQL(線【前台】的搜尋那批)—— 🔴 **兩支之間【沒有順序關係】**,
--    先貼哪一支都可以, 貼一支不貼另一支也不會壞。
--    ⇒ 📌 **寫這一句是為了讓貼的人不必回頭問我們。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🎯 它在解什麼:一個【只有兩個世界】的值域, 而真實有三個
-- ══════════════════════════════════════════════════════════════════════════
--    現況 `CHECK (hct_status IN ('draft','submitted','failed'))`(`20260805170000:130-131`)
--    ⇒ 而新竹接線有第三個世界:**我們送出去了, 而我們沒收到回應**
--      (逾時 / 斷線 / HTTP 5xx / 回應不是 JSON / 認不得的 success 值)。
--
--    🛑 **把它記成 `failed` 是一句假話** —— 而那句假話會引導出一個破壞性動作:
--       規格(`新竹物流API服務說明 V1` 第 8 頁)逐字
--       「新竹貨號+訂單編號 -> 當日重複上傳, **視同更正資料內容**」
--       ⇒ 🔴 **重送不是重送。** 而更正要帶新竹貨號, 那只有第一次送成功才拿得到。
--
--    🔵 **而這個形狀不是新發明的** —— 金流那條路已經上線在用:
--       `packages/adapters/src/tappay/TapPayChargeAdapter.ts:132-135` 逐字
--       「HTTP 層失敗(auth/infra)= **扣款狀態未知** → throw(`charge_unknown`、**不誤判未扣款**)」
--       ⇒ 📌 **這一支只是把同一個已被接受的形狀, 帶到出貨這條路上。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🟢 另外兩條 CHECK 【都不必動】—— 而理由是從【語意】推的, 不是「跑起來沒紅」
-- ══════════════════════════════════════════════════════════════════════════
--  · **X4** `shipments_hct_submitted_evidence`(`20260805170000:138-139`):
--       `CHECK (hct_status <> 'submitted' OR NOT pcm_b2_is_blank(hct_request_id))`
--    ⇒ 🎯 `unknown` **不受它管, 而那正是對的** ——
--      **`unknown` 的意思就是我們【沒拿到】識別值**;要求它有, 等於要求我們知道一件我們不知道的事。
--  · **X5** `shipments_hct_status_carrier`(`:142-143`):
--       `CHECK (hct_status = 'draft' OR carrier_code = 'hct')`
--    ⇒ ✅ `unknown` 落進「carrier 必須是 hct」那半 ⇒ **本來就對**(只有新竹這條路產得出 unknown)。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 回滾:**要另一支, 而且它可能【應該】失敗**
-- ══════════════════════════════════════════════════════════════════════════
--    縮回舊值域時, **若已經有 `unknown` 的列, 那支會被 CHECK 擋下來。**
--    🛑 **那不是 bug, 是正確行為** —— 回滾腳本要先答「**那些列怎麼辦**」
--    (它們代表「我們不知道那張單有沒有進去」, 而把它們改成 `failed` 或 `draft` 都是**編一個答案**)。
--    ⇒ 📌 **而那個答案不該由腳本自己猜。** 所以本支**不附自動回滾**;
--      真的要退, 先跑 `SELECT count(*) FROM public.shipments WHERE hct_status = 'unknown';`
--      ⇒ 是 0 才可以直接把 CHECK 換回去;不是 0 ⇒ **停下來問人**。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔵 既有列不受影響:新值域是舊值域的【超集】⇒ 每一列都仍然合法。
--    ⚠️ 而**超集不等於安全** —— 它安全是因為**沒有任何應用碼會寫 `unknown`**(片 C 還沒開工),
--    不是因為 `IN (...)` 加一個值本身安全。
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  -- 前置閘①:那條 CHECK 必須存在, 而且是我抽取時看到的那一個。
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'shipments_hct_status_domain'
     AND conrelid = 'public.shipments'::regclass;

  IF v_def IS NULL THEN
    RAISE EXCEPTION
      '前置閘①:找不到 shipments_hct_status_domain ⇒ 這不是我以為的那個世界, 拒繼續';
  END IF;

  -- 前置閘②:已經有 unknown ⇒ 本檔已套用過, forward-only 拒重跑。
  --   🔵 這個訊息比 Postgres 自己的錯誤好 —— 它說得出「為什麼不讓你跑」。
  IF pg_catalog.strpos(v_def, 'unknown') > 0 THEN
    RAISE EXCEPTION
      '前置閘②:值域裡已經有 unknown ⇒ 本檔已套用過, forward-only 拒重跑。現況 = %', v_def;
  END IF;

  -- 前置閘③:舊值域必須逐字是那三個。
  --   🔴 不是「包含那三個」而是「就是那三個」—— 若有人先加過別的值,
  --      我的 DROP+ADD 會【安靜地把它拿掉】, 而那在 diff 上看不見。
  IF pg_catalog.strpos(v_def, '''draft''') = 0
     OR pg_catalog.strpos(v_def, '''submitted''') = 0
     OR pg_catalog.strpos(v_def, '''failed''') = 0 THEN
    RAISE EXCEPTION
      '前置閘③:舊值域不是我抽取時的那三個(draft/submitted/failed)⇒ 有人動過它, 而我的 DROP+ADD 會蓋掉那次改動 ⇒ 拒繼續。現況 = %', v_def;
  END IF;
END
$pre$;

-- ── 2. 換掉那條 CHECK ────────────────────────────────────────────────────
ALTER TABLE public.shipments
  DROP CONSTRAINT shipments_hct_status_domain;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_hct_status_domain
  CHECK (hct_status IN ('draft', 'submitted', 'failed', 'unknown'));

COMMENT ON CONSTRAINT shipments_hct_status_domain ON public.shipments IS
  '新竹出貨狀態值域。unknown = 我們送出去了而沒收到回應(逾時/斷線/5xx)——'
  ' 它【不是】failed:記成 failed 會讓人重送, 而新竹把同日重送視同【更正】,'
  ' 而更正要帶只有送成功才拿得到的貨號。形狀抄自金流的 charge_unknown。'
  ' 🔴 沒有 delivered —— 我們拿不到「已送達」的可靠訊號(U7 原拍板, 本支不動它)。';

-- ── 3. 後置閘 ────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_def text;
  v_bad int;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'shipments_hct_status_domain'
     AND conrelid = 'public.shipments'::regclass;

  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'unknown') = 0 THEN
    RAISE EXCEPTION '後置閘①:換完之後值域裡沒有 unknown ⇒ 這一支沒有做到它宣稱的事。現況 = %', v_def;
  END IF;

  -- 🔴 後置閘②:另外三個值**一個都不能掉**。
  --    DROP+ADD 打錯一個字的症狀是「某個既有狀態突然寫不進去」, 而那要等到有人出貨才顯形。
  IF pg_catalog.strpos(v_def, '''draft''') = 0
     OR pg_catalog.strpos(v_def, '''submitted''') = 0
     OR pg_catalog.strpos(v_def, '''failed''') = 0 THEN
    RAISE EXCEPTION '後置閘②:換完之後少了原本的值 ⇒ 既有狀態會寫不進去。現況 = %', v_def;
  END IF;

  -- 🔴 後置閘③:**沒有 delivered**(U7 拍板)。
  --    加值這種改動最容易「順手多加一個看起來會用到的」, 而那一個會讓後台顯示一個永遠不會變綠的狀態。
  IF pg_catalog.strpos(v_def, 'delivered') > 0 THEN
    RAISE EXCEPTION '後置閘③:值域裡出現 delivered ⇒ U7 明文拍板沒有它(我們拿不到可靠訊號)。現況 = %', v_def;
  END IF;

  -- 🟢 後置閘④:既有列全部仍然合法(超集本來就該如此;這一格證明它真的如此)。
  SELECT count(*) INTO v_bad
    FROM public.shipments
   WHERE hct_status NOT IN ('draft', 'submitted', 'failed', 'unknown');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '後置閘④:有 % 列的 hct_status 不在新值域裡 ⇒ 而 CHECK 竟然過了 ⇒ 停下來看', v_bad;
  END IF;
END
$post$;

COMMIT;
