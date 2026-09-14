-- ⟦b4-CARDFAILNOALERT⟧ 第 2 代:刷卡失敗摘要帶「第一筆單號」(2026-09-14, 主視窗 ef 批, 裁甲一行)
-- plan:docs/plans/2026-09-14-charge-failure-first-order-plan.md
--
-- ══ 這一支在解什麼 ═════════════════════════════════════════════════════
-- 第 1 代(`20260906980000`, 貼板 65)只回計數 ⇒ Sean 在 LINE 看到「刷卡失敗 2 筆」而不知道是哪張單, 要進後台翻。
-- 本支只多一個 key `first_failed_display_id`:窗內 `status='failed'` 依 `created_at` 最早那一筆 join orders 的 `display_id`;
-- 沒有 ⇒ null。**只回單號**, 不回金額 / 客人 / rec_trade_id。
-- 🔴 舊 5 key 一字不改(值與定義都照第 1 代;契約測試 `anomaly-alert-key-contract.test.ts` pin 5 → 6)。
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉(`reference_create-or-replace-resets-set-clause`)⇒ 下面重寫
--    SECURITY DEFINER / STABLE / SET search_path = '';ACL 由 OR REPLACE 保留, 事後斷言照第 1 代那組再驗一次。
-- 🛑 時間窗與第 1 代同一把尺(`created_at` 24h)⇒ 「第一筆」= 昨天進來的人裡最早刷不過的那張, 不是最早失敗的時刻。
-- 回滾:supabase/rollbacks/20260914120000_down.sql = 貼回第 1 代函式體(逐字自 20260906980000:51-91)。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $gate$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_daily_charge_failure_counts()') IS NULL THEN
    RAISE EXCEPTION '前置閘①:第 1 代 get_daily_charge_failure_counts 不在 ⇒ 20260906980000(貼板 65)還沒貼';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.orders'::pg_catalog.regclass AND a.attname = 'display_id' AND NOT a.attisdropped)
  THEN
    RAISE EXCEPTION '前置閘②:orders.display_id 不在';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260914d()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END
$gate$;

CREATE OR REPLACE FUNCTION public.get_daily_charge_failure_counts()
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
    -- 🔴 告警的主詞:昨天進來而刷不過的人數。(第 1 代逐字, 下同)
    'card_failed_count',
      pg_catalog.count(*) FILTER (WHERE a.status = 'failed'),
    -- 🔵 3DS 那一格與上面**不互斥** —— 一筆可以同時是 failed 又被觀察到 -1/5。⇒ 不可相加。
    'three_ds_failed_count',
      pg_catalog.count(*) FILTER (WHERE a.failure_observed_at IS NOT NULL),
    -- 🔵 分母。每個 key 【自己一行】, 值放下一行(契約測試用 `^\s*'key',\s*(\(|$)` 抽 key)。
    'attempts_total_count',
      pg_catalog.count(*),
    'window_hours',
      24,
    'since',
      v_since,
    -- 🆕 第 2 代:窗內最早那一筆 failed 的單號(人看的 display_id);沒有 ⇒ null。
    --    子查詢自己再套一次同一個窗(外層 WHERE 不會傳進子查詢), 兩邊同一個 v_since。
    'first_failed_display_id',
      (SELECT o.display_id
         FROM public.payment_charge_attempts f
         JOIN public.orders o ON o.id = f.order_id
        WHERE f.created_at >= v_since AND f.status = 'failed'
        ORDER BY f.created_at, f.id
        LIMIT 1)
  )
  INTO v_result
  FROM public.payment_charge_attempts a
 WHERE a.created_at >= v_since;
  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.get_daily_charge_failure_counts() IS
$c$回 jsonb{card_failed_count, three_ds_failed_count, attempts_total_count, window_hours, since, first_failed_display_id}。
🔴 主詞 = card_failed_count:過去 24 小時【建立】的刷卡 attempt 裡, 現在是 failed 的幾筆。
🛑 它答的是「昨天進來的人裡有幾個沒刷過」, **不是**「昨天發生了幾次失敗」(三個數字共用 created_at 窗)。
🔴 card_failed_count 與 three_ds_failed_count **不互斥、不可相加**。
🆕 first_failed_display_id(20260914120000):同一個窗裡 created_at 最早那筆 failed 的 orders.display_id;沒有 ⇒ null。只回單號。
🛑 它答不出「客人為什麼刷不過」, 也答不出「他有沒有換一張卡成功」。$c$;

-- 🔴 ACL 基線照第 1 代重貼一次(OR REPLACE 保留舊 ACL, 而「舊 ACL 是不是第 1 代那組」在每台庫上不一定 ——
--    探針庫上 default ACL 給了 service_role EXECUTE, 第 1 代的斷言在那台已經不成立)。這三句與 20260906980000:93-99 逐字同義, 冪等。
REVOKE ALL ON FUNCTION public.get_daily_charge_failure_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_daily_charge_failure_counts()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_charge_failure_counts() TO payment_confirmer;

-- ── 事後斷言(照第 1 代那組 + 新 key)──────────────────────────────
DO $assert$
DECLARE
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
    -- SET 子句還在(OR REPLACE 會清;這一格就是抓那件事)
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = pg_catalog.to_regprocedure(r) AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '定義斷言:% 不是 SECURITY DEFINER + search_path 空字串', r;
    END IF;
  END LOOP;

  v_shape := public.get_daily_charge_failure_counts();
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'card_failed_count')
     OR NOT (v_shape ? 'three_ds_failed_count')
     OR NOT (v_shape ? 'attempts_total_count')
     OR NOT (v_shape ? 'window_hours')
     OR NOT (v_shape ? 'since')
     OR NOT (v_shape ? 'first_failed_display_id') THEN
    RAISE EXCEPTION '形狀斷言:回傳缺鍵(收到 %)⇒ 讀的那側會拿到 undefined', v_shape;
  END IF;
  IF pg_catalog.jsonb_typeof(v_shape -> 'first_failed_display_id') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION '形狀斷言:first_failed_display_id 不是 string / null(收到 %)', v_shape -> 'first_failed_display_id';
  END IF;
  RAISE NOTICE 'get_daily_charge_failure_counts 第 2 代貼好了(多 first_failed_display_id)。';
END
$assert$;

COMMIT;
