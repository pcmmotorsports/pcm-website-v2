-- ⟦板 931 客人刷不出卡, 我們這邊不會響⟧ —— Sean 2026-09-06 Q7 答**乙**(做最簡單的一條),
-- 主視窗 `-f1` 批 plan 走**甲**(掛既有告警線, 不加套件、不加排程、不接外部服務)。
-- plan:`~/pcm-mailbox/plan-mail-每日刷卡統計信-20260906.md`
--
-- ══ 這一支在解什麼 ═════════════════════════════════════════════════════
-- 客人刷不出卡 ⇒ 他只能自己打 LINE 來罵。板列量到三個同向分母:零監控套件、無 ingest 端點、
-- ErrorBoundary 只寫 state 不外送。⇒ 📌 **今天的替代品是【零】。**
-- 本支只做一件事:**把「昨天有幾個人刷不過」變成一個查得到的數字。**
--
-- ══ 🔬 兩個數字的來源(開檔核過, 同一張表)═══════════════════════════════
--   刷卡失敗  `status = 'failed'`
--   3DS 失敗  `failure_observed_at IS NOT NULL`
--             (`20260624120000:54` 逐字「released 首次觀察 Record status(僅 -1 或 5;write-once)」,
--              `:71` CHECK `failure_observed_status IS NULL OR … IN (-1, 5)`)
-- ⛔ ~~plan 第 1 節寫「`status` CHECK 逐字 `IN ('pending','charged','failed')`(`20260612150000:92`)」~~
-- 🔴🔴 **那句【現在是錯的】, 而它當時逐字正確** —— `20260624120000:41-46` 把那道 CHECK
--    `DROP → ADD 同名`, 白名單變成 **四個值**:`('pending','charged','failed','released')`。
--    ⇒ 📌 **一個帶行號的逐字引用, 只在【那一行】為真;而後來的 migration 可以把它整條換掉,
--      _換掉的那一支不會回頭去改引用它的人_。**(`latest-definition-of.sh` 就是為這件事寫的。)
--    ⇒ 🛑 本支**不靠那個白名單**:它只問 `= 'failed'`, 白名單再長也不影響。
--
-- ══ 🛑 時間窗:兩個數字**共用 `created_at`**, 而那是取捨不是疏漏 ══════════
-- `status='failed'` 這一格**沒有「什麼時候失敗的」那個時刻**(只有會被任何更新推動的 `updated_at`)。
-- ⇒ 若刷卡失敗用 `created_at`、3DS 失敗用 `failure_observed_at`, **兩個數字就不共用分母、不可比**。
-- ✅ 選擇:**三個數字全部窗在 `created_at`** ⇒ 它們是同一批 attempt 的三種下場, 加得起來、比得了。
-- 🔴 **代價(要寫進信裡, 不是藏在這裡)**:**25 小時前建立、1 小時前才失敗的那一筆, 今天不算。**
--    ⇒ 它會出現在**前一天**的信裡(如果那天它已經是 failed)或**誰的信裡都沒有**。
--    📌 **這封信答的是「昨天進來的人裡有幾個沒刷過」, 不是「昨天發生了幾次失敗」。**

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'payment_charge_attempts')
  THEN
    RAISE EXCEPTION '前置閘:找不到 public.payment_charge_attempts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.payment_charge_attempts'::pg_catalog.regclass
       AND a.attname = 'failure_observed_at' AND NOT a.attisdropped)
  THEN
    RAISE EXCEPTION '前置閘:找不到欄 failure_observed_at ⇒ 20260624120000 還沒貼 ⇒ 3DS 那一格會恆 0 而看起來正常';
  END IF;
END
$gate$;

CREATE FUNCTION public.get_daily_charge_failure_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_since  pg_catalog.timestamptz := pg_catalog.now() - pg_catalog.make_interval(hours => 24);
  v_result pg_catalog.jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    -- 🔴 告警的主詞:昨天進來而刷不過的人數。
    'card_failed_count',
      pg_catalog.count(*) FILTER (WHERE a.status = 'failed'),
    -- 🔵 3DS 那一格與上面**不互斥** —— 一筆可以同時是 failed 又被觀察到 -1/5。
    --    ⇒ 兩個數字**不可以相加**;信裡要分開講。
    'three_ds_failed_count',
      pg_catalog.count(*) FILTER (WHERE a.failure_observed_at IS NOT NULL),
    -- 🔵 分母。**一個計數沒有分母, 讀的人會自己補一個**, 而他補的多半是「全部」。
    -- 🔵 每個 key 【自己一行】, 值放下一行 —— 那不是排版偏好:
    --    `anomaly-alert-key-contract.test.ts` 用 `^\s*'key',\s*(\(|$)` 從這支檔抽 key 去比對兩端。
    --    ⛔ 我第一版把值寫在同一行 ⇒ **那把尺不認得三個 key** ⇒ 它們會【完全沒有契約測試保護】。
    --    📌 而那支測試會把不認得的行印出來說「有 3 行看起來是 key 而這把尺不認」—— 它救了我。
    'attempts_total_count',
      pg_catalog.count(*),
    -- 🔴 數字要帶著它的範圍走(表會被複製, 前後文不會)。
    'window_hours',
      24,
    'since',
      v_since
  )
  INTO v_result
  FROM public.payment_charge_attempts a
 WHERE a.created_at >= v_since;
  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.get_daily_charge_failure_counts() IS
$c$回 jsonb{card_failed_count, three_ds_failed_count, attempts_total_count, window_hours, since}。
🔴 主詞 = card_failed_count:過去 24 小時【建立】的刷卡 attempt 裡, 現在是 failed 的幾筆。
🛑 它答的是「昨天進來的人裡有幾個沒刷過」, **不是**「昨天發生了幾次失敗」——
   三個數字共用 created_at 窗(status='failed' 沒有失敗時刻可用, updated_at 會被任何更新推動)
   ⇒ 25 小時前建立、1 小時前才失敗的那一筆, 今天不算。
🔴 card_failed_count 與 three_ds_failed_count **不互斥、不可相加**(同一筆可以兩者皆是)。
🔵 3DS 那一格的定義是 failure_observed_at IS NOT NULL(20260624120000:54, 僅 -1/5、write-once)。
🛑 它答不出「客人為什麼刷不過」, 也答不出「他有沒有換一張卡成功」。$c$;

-- 🔵 兩道 REVOKE 是必要基線(新物件出生自帶 PUBLIC 的 EXECUTE)。
REVOKE ALL ON FUNCTION public.get_daily_charge_failure_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_daily_charge_failure_counts()
  FROM anon, authenticated, service_role;
-- 🔴 給 payment_confirmer, **不是 service_role** —— 那正是今晚 42501 那件事的教訓
--    (`20260906970000` 檔頭:告警讀取器持 PAYMENT_CONFIRMER_DB_URL, 從來不是 service_role)。
GRANT EXECUTE ON FUNCTION public.get_daily_charge_failure_counts() TO payment_confirmer;

-- ── 事後斷言 ──────────────────────────────────────────────────
DO $assert$
DECLARE
  -- 🔵 清單寫成宣告式 `ARRAY[...]` 是 `scripts/migration-static-checks.sh` 第③道要的形狀 ——
  --    它比對「本檔建了幾個可授權物件」與「你列了幾個」⇒ **它防的是「忘記列」, 不是「忘記收權」。**
  v_functions text[] := ARRAY['public.get_daily_charge_failure_counts()']::text[];
  r       text;
  v_acl   text;
  v_shape jsonb;
  v_role  text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT pg_catalog.array_to_string(p.proacl, ',') INTO v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '收權斷言:% 的 proacl 是 NULL(= 沿用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '收權斷言:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警端讀不到', r, v_acl;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, r, 'EXECUTE') THEN
        RAISE EXCEPTION '收權斷言:% 竟然叫得動 % ⇒ 兩道 REVOKE 沒有生效, 拒繼續', v_role, r;
      END IF;
    END LOOP;
  END LOOP;

  -- 🔴 形狀斷言:五個鍵一個都不能少(先驗它是 object —— `?` 對陣列也成立)。
  v_shape := public.get_daily_charge_failure_counts();
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'card_failed_count')
     OR NOT (v_shape ? 'three_ds_failed_count')
     OR NOT (v_shape ? 'attempts_total_count')
     OR NOT (v_shape ? 'window_hours')
     OR NOT (v_shape ? 'since') THEN
    RAISE EXCEPTION '形狀斷言:回傳缺鍵(收到 %)⇒ 讀的那側會拿到 undefined 而恆不叫', v_shape;
  END IF;
END
$assert$;

COMMIT;

-- ⚠️ 本支證不到什麼:
--   ① **它不寄信** —— 寄那一半在 route,而 route 今天每一發都 503(42501, 修法 `20260906970000` = 貼板 64)
--      ⇒ 🔴 **順序是 64 → 65 → 明天 01:00 UTC 那一發**;65 貼完【收不到信】是預期的, 不是這支沒生效。
--   ② 它答不出「客人為什麼刷不過」(卡片問題 / 3DS / 我們的 bug 在這裡長得一樣)。
--   ③ 貼進去的那一刻兩個數字很可能是 **0** —— 全站訂單今天只有 2 張
--      ⇒ 📌 **那個 0 的成因是分母, 不得讀成「沒有人刷不過」。**
