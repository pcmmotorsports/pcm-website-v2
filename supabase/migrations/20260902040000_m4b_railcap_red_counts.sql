-- ⟦b4-RAILCAPAUDIENCE⟧ · 那個紅要有【觀眾】—— 數出「現在有幾張單是紅的」
--
-- ══ 為什麼要它(而它不是「順手加個 view」)═══════════════════════════════════════
--   `20260902020000` 把人工退款上限閘從【擋住】改成【記下來 + 警告】(Sean 拍板)。
--   🔴 而 `-5b` 的 codex R3 問了兩題, 兩題的答案是這一支存在的理由:
--     **①「紅【沒有出口】:`cap < 0` 是永久衍生態」**
--     **②「沒有任何機制會把它送到人面前:全 repo 零 cron / 零對帳 / 零報表讀 `rail_cap`**
--        **⇒ 唯一觀眾是『有人主動打開那張單的退款面板』, 而超收單的下一個動作就是關掉它」**
--   ⇒ 📌 **事前閘的觀眾【一定在現場】(他被擋了);事後紅的觀眾【可能永遠不來】。**
--
-- ══ ✅ Sean 2026-09-02 01:2x 拍【甲】 ═════════════════════════════════════════════
--   題目:那個紅要不要有【出口】與【觀眾】
--   甲(他選)= **加一個地方讓他看得到「現在有幾張單是紅的」**
--   乙        = 先上, 那一格單獨開一列
--   🔵 而他的字面是「讓【你】看得到」⇒ 那個「你」是他 ⇒ 落點是**他會打開的畫面**,
--     不是一個沒有人讀的 view。本支只做【數字】那一半;畫面那一半在 app 層。
--
-- ══ 🔴 兩種紅是【兩個數字】, 不是一個 ═══════════════════════════════════════════
--   `over_cap`   = 超額(`cap < 0`)      ⇒ 員工的下一步:**確認金額**
--   `cap_unknown`= 算不出上限(`cap IS NULL`)⇒ 員工的下一步:**找工程**
--   🛑 **合成一個數字 = 把「該找工程的」與「該改金額的」混在一起** ——
--     而那正是 `⟦b4-PCM05SPLIT⟧` 那一條(一碼兩義而下一步相反)。
--   ⇒ 所以本支回**兩欄**, 而不是一個 total。
--
-- ══ 🔵 分母為什麼可以這樣收窄(不是為了快, 是為了它答得準)═══════════════════════
--   `pcm_manual_refund_rail_cap` = 兩軌淨實收 − 未作廢的人工退款。
--   ⇒ **一張沒有任何未作廢人工退款的單, 它的 cap 不可能是負的**(被減數是 0)。
--   ⇒ 所以只掃「有未作廢人工退款」的那些單就夠了 —— 而那是【等價】不是【抽樣】。
--   ⚠️ 而 `cap IS NULL` 那一半**不吃這個推論**:算式回 NULL 是算式本身出狀況,
--     那與有沒有退款無關 ⇒ 🛑 **所以 `cap_unknown` 這個數字【只涵蓋有退款的那些單】,**
--     **它不是全站的**。⇒ 這個限制寫在函式的 COMMENT 裡, 而不是只寫在這裡。

-- 🔴 **裸 `CREATE`, 不是 `OR REPLACE`**(`migration-new-file-static-checks` ①)——
--   這是一個【新物件】⇒ 撞名要當場紅。
--   `OR REPLACE` 會把撞名**靜靜蓋掉**, 而 REVOKE 與後置斷言【照樣綠】
--   ⇒ 📌 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
CREATE FUNCTION public.pcm_manual_refund_red_counts()
RETURNS TABLE (over_cap bigint, cap_unknown bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH candidate AS (
    SELECT DISTINCT m.order_id
      FROM public.order_manual_refunds m
     WHERE m.voided_at IS NULL
  ),
  capped AS (
    SELECT c.order_id, public.pcm_manual_refund_rail_cap(c.order_id) AS cap
      FROM candidate c
  )
  SELECT
    COALESCE(SUM(CASE WHEN k.cap < 0 THEN 1 ELSE 0 END), 0)::bigint     AS over_cap,
    COALESCE(SUM(CASE WHEN k.cap IS NULL THEN 1 ELSE 0 END), 0)::bigint AS cap_unknown
    FROM capped k;
$fn$;

COMMENT ON FUNCTION public.pcm_manual_refund_red_counts() IS
  '⟦b4-RAILCAPAUDIENCE⟧「現在有幾張單是紅的」——後台首頁用(Sean 2026-09-02 拍甲:要有觀眾)。'
  '🔴 回【兩個】數字而不是一個:over_cap(超額 ⇒ 確認金額)與 cap_unknown(算不出上限 ⇒ 找工程),'
  '兩者的下一步相反,合成一個數字就是 ⟦b4-PCM05SPLIT⟧ 那個病。'
  '🔵 分母 = 有【未作廢人工退款】的單。cap = 兩軌淨實收 − 未作廢退款 ⇒ 沒有退款的單不可能為負,'
  '所以那個收窄對 over_cap 是【等價】不是抽樣。'
  '🛑 而 cap_unknown 不吃那個推論(算式回 NULL 與有沒有退款無關)'
  '⇒ **這個數字只涵蓋有退款的那些單,它不是全站的**。'
  '⚠️ 它是即時算的(STABLE,無快取):單數變多時要回來看它的成本。';

-- 🔵 權限:與 `pcm_manual_refund_rail_cap`(`20260824010000:149-151`)同一個形狀 ——
--    先 REVOKE 乾淨, 再只開給 `service_role`。
--    🔴 新物件**出生就自帶 PUBLIC/anon 的 EXECUTE**, 而 repo 內零 GRANT 字面可掃、三綠不紅。
REVOKE ALL ON FUNCTION public.pcm_manual_refund_red_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_red_counts() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_red_counts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_manual_refund_red_counts() TO service_role;
-- ── 新物件收權斷言(`scripts/migration-new-file-static-checks.sh` ③ 要這份清單可被數)──
-- 🔴 **它防的不是「忘記收權」, 是「忘記列」** —— 下面那個迴圈只檢查你列出來的物件。
--   ⇒ 📌 `REVOKE` 是【我做的動作】;這份清單是【下一個在這支檔加新物件的人會撞到的東西】。
-- 🔴 簽章逐字從上面的 `CREATE FUNCTION` 抄 —— `to_regprocedure` 對參數型別逐字比對,
--   打錯會**回 NULL**, 而第一道 IF 就是讓那件事 fail-loud、不靜默通過。
-- 🔴 結尾的 `::text[]` 不能拿掉(清單清空時 `ARRAY[]` 無法推斷型別)。
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.pcm_manual_refund_red_counts()'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 service_role 沒有 EXECUTE(收太多)⇒ 呼叫端會被 42501 擋掉', r;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 收權斷言過:% 支函式 —— anon/authenticated 零 EXECUTE、service_role 有',
    cardinality(v_functions);
END
$grant_assert$;


-- ── 後置斷言:三個世界, 而其中兩個是【對照組】 ────────────────────────────────
-- 🔴 它【真的算】, 不是數字面 —— 造假資料、跑那支函式、然後回滾。
DO $post$
DECLARE
  v_a uuid := '00000000-0000-0000-0000-00000000cab1';
  v_b uuid := '00000000-0000-0000-0000-00000000cab2';
  v_over int; v_unk int;
BEGIN
  SELECT r.over_cap, r.cap_unknown INTO v_over, v_unk FROM public.pcm_manual_refund_red_counts() r;
  IF v_over IS NULL OR v_unk IS NULL THEN
    RAISE EXCEPTION '後置斷言:函式回了 NULL ⇒ 呼叫端會把它當成 0, 而那是「不知道」不是「沒有」';
  END IF;

  INSERT INTO public.orders(id) VALUES (v_a), (v_b) ON CONFLICT DO NOTHING;
  -- 世界A:收 1000 而退 1500 ⇒ cap = −500 ⇒ 應該被數進 over_cap
  INSERT INTO public.order_payments(order_id, rail, amount) VALUES (v_a, 'bank_transfer', 1000);
  INSERT INTO public.order_manual_refunds(order_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES (v_a, 'bank_transfer', 1500, '後置斷言', 'assert', pg_catalog.now());
  -- 🟢 世界B 對照組:收 1000 而退 300 ⇒ cap = 700 ⇒ **不准**被數進去
  INSERT INTO public.order_payments(order_id, rail, amount) VALUES (v_b, 'cash', 1000);
  INSERT INTO public.order_manual_refunds(order_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES (v_b, 'cash', 300, '後置斷言', 'assert', pg_catalog.now());

  SELECT r.over_cap INTO v_over FROM public.pcm_manual_refund_red_counts() r;
  IF v_over <> 1 THEN
    RAISE EXCEPTION
      '世界A/B:over_cap 應為 1(只有超額那一張), 實得 % ⇒ 它把沒超額的也數進去了, 或漏了超額那張',
      v_over;
  END IF;

  -- 🟢 世界C 對照組:把超額那筆作廢 ⇒ 額度還回來 ⇒ over_cap 要變回 0
  --    ⇒ 少了這一格, 一個「永遠回 1」的實作也會通過上面那格。
  UPDATE public.order_manual_refunds SET voided_at = pg_catalog.now() WHERE order_id = v_a;
  SELECT r.over_cap INTO v_over FROM public.pcm_manual_refund_red_counts() r;
  IF v_over <> 0 THEN
    RAISE EXCEPTION '世界C(作廢後):over_cap 應為 0, 實得 % ⇒ 這把尺不會動', v_over;
  END IF;

  RAISE NOTICE '✅ 三個世界都對:超額 1 張(而沒超額的那張沒被數進去)· 作廢後 0 張';
  RAISE EXCEPTION '後置斷言跑完 —— 刻意回滾這段測試資料(這不是失敗)' USING ERRCODE = 'P0001';
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM NOT LIKE '後置斷言跑完%' THEN
    RAISE;
  END IF;
  RAISE NOTICE '🔵 測試資料已回滾(那一發 EXCEPTION 是刻意的)';
END
$post$;
