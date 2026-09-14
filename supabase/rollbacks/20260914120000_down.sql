-- ⟦b4-CARDFAILNOALERT⟧ 第 2 代 回滾:貼回第 1 代函式體(逐字自 20260906980000:51-88, 只把 CREATE 改成 CREATE OR REPLACE)。
-- 先回滾 app(adapter 少讀一個 key 不會炸, 但契約測試 pin 要一起回 5), 再跑本檔。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF NOT (public.get_daily_charge_failure_counts() ? 'first_failed_display_id') THEN
    RAISE EXCEPTION '回滾前置閘:這台庫上不是第 2 代, 沒有東西可回滾';
  END IF;
END
$pre$;
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
DO $post$
DECLARE v_role text;
BEGIN
  IF public.get_daily_charge_failure_counts() ? 'first_failed_display_id' THEN
    RAISE EXCEPTION '回滾後置閘:還是第 2 代';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role, 'public.get_daily_charge_failure_counts()', 'EXECUTE') THEN
      RAISE EXCEPTION '回滾後置閘:% 叫得動', v_role;
    END IF;
  END LOOP;
END
$post$;
COMMIT;
