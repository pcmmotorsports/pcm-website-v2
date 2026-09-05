-- ⟦b4-RETRYGAVEUPNOWATCHER⟧:讓「試到上限仍然沒好」的匯款單有人看得到
-- 前置:`20260905220000`(⟦b4-SETTLERETRYNEVER⟧ 甲 —— 那張 attempts 表與那支 sweep)
--
-- ## 為什麼要這一支
--   `20260905220000` 一張單試 5 次仍不好 ⇒ `gave_up_at` 蓋章、**安靜停下**。
--   而那張表對四個應用角色**四道 REVOKE 全收** ⇒ 🔴 **告警端(`service_role`)讀不到它**
--   ⇒ 全 repo 只有那支 sweep 讀它 ⇒ **今天沒有任何人在看放棄清單**。
--   (那一列是我做 220000 時當場開的, codex R1 也獨立指出。)
--
-- ## 為什麼是【函式】不是【開表的 SELECT】
--   開表 = 把整張表給 service_role(含 order_id 與 last_error 全文)。
--   而告警只需要**幾個數 + 幾個 id** ⇒ 一支 definer 函式把投影釘死, 比開表窄得多。
--   🔵 照 `20260905060000_m4b_stuck_bank_orders_health.sql` 的形狀(同一族的最近一支)。
--
-- ## 🛑 這一支證不到什麼
--   · 它只答「有幾張被放棄、最舊那張多久了」—— **不答那些單為什麼壞**(那在 Postgres log 裡)。
--   · 🔴 `gave_up_at` 在 220000 裡是【24 小時冷卻】不是永久 ⇒ 一張單會**反覆進出**這個計數。
--     ⇒ 信裡那一行要說「目前有幾張」, 不能說「累計壞了幾張」。
--   · 它讀的是 attempts 表, 而**那張表只在 sweep 跑過之後才有列** ⇒ sweep 從沒跑過時它回 0,
--     而那個 0 與「沒有壞單」印同一個東西。⇒ 心跳那條路答「sweep 有沒有在跑」, 兩者互補。

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.pcm_settle_retry_attempts') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:pcm_settle_retry_attempts 不存在 ⇒ 20260905220000 還沒貼';
  END IF;
  IF to_regprocedure('public.get_settle_retry_gaveup_health()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⓪:這支貼過了, 不要重貼';
  END IF;
END $$;

CREATE FUNCTION public.get_settle_retry_gaveup_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **每個 key 獨佔一行, 逗號結尾** —— 那不是排版偏好:
    --    `anomaly-alert-key-contract.test.ts` 那把尺用 `^\s*'key',\s*$` 抽 key
    --    ⇒ 寫成 `'key', (SELECT …)` 同一行, 它一個都抽不到 ⇒ 那道對帳閘變成恆綠。
    --    (2026-09-05 實測:第一版就是同一行 ⇒ 閘紅並說「SQL 側只抽到 0 個 key」。)
    'gave_up_count',
    -- 🔴 只數【目前】還掛著放棄章的:24 小時冷卻過了就不算(它會再被試一次)。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts
      WHERE gave_up_at IS NOT NULL),
    'oldest_gave_up',
    (SELECT pg_catalog.min(gave_up_at) FROM public.pcm_settle_retry_attempts
      WHERE gave_up_at IS NOT NULL),
    'sample_order_ids',
    -- 🔵 最多列 5 個 id 讓收信的人查得動;不列 last_error(可能很長, 而它在 log 裡)。
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT order_id FROM public.pcm_settle_retry_attempts
              WHERE gave_up_at IS NOT NULL
              ORDER BY gave_up_at LIMIT 5) x),
    'tracked_total',
    -- 🔵 分母:一個「0 張放棄」在【表是空的】時沒有意義 ⇒ 把總列數也帶出去。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts)
  );
$fn$;

REVOKE ALL ON FUNCTION public.get_settle_retry_gaveup_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_settle_retry_gaveup_health() FROM anon;
REVOKE ALL ON FUNCTION public.get_settle_retry_gaveup_health() FROM authenticated;
REVOKE ALL ON FUNCTION public.get_settle_retry_gaveup_health() FROM service_role, payment_confirmer;
-- 🔵 收乾淨之後【具名】給告警端 —— 只給它, 而且只給這一支投影。
GRANT EXECUTE ON FUNCTION public.get_settle_retry_gaveup_health() TO service_role;

COMMENT ON FUNCTION public.get_settle_retry_gaveup_health() IS
  '⟦b4-RETRYGAVEUPNOWATCHER⟧:目前有幾張匯款單被 settle-retry 放棄。'
  '🔴 `gave_up_at` 是 24 小時冷卻不是永久 ⇒ 這個數字會【上下跳】, 它答的是「此刻」不是「累計」。'
  '🛑 它不答那些單為什麼壞 —— 那在 Postgres log 的 [pcm_noncard_settle] 那幾行。';

-- ── 事後斷言 ────────────────────────────────────────────────
DO $$
DECLARE
  v_relations text[] := ARRAY['public.get_settle_retry_gaveup_health()']::text[];
  v_r    text;
  v_leak text[] := ARRAY[]::text[];
  v_j    jsonb;
BEGIN
  IF to_regprocedure('public.get_settle_retry_gaveup_health()') IS NULL THEN
    RAISE EXCEPTION '斷言a:函式沒建出來';
  END IF;

  -- 🔴 proacl 為 NULL = 預設(PUBLIC 可執行)⇒ 四道 REVOKE 沒生效。
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc
       WHERE oid = 'public.get_settle_retry_gaveup_health()'::regprocedure) THEN
    RAISE EXCEPTION '斷言b0:proacl 是 NULL ⇒ 預設 PUBLIC 可執行';
  END IF;

  -- 三個【不該有】的角色
  FOREACH v_r IN ARRAY ARRAY['anon','authenticated','payment_confirmer'] LOOP
    IF has_function_privilege(v_r, 'public.get_settle_retry_gaveup_health()', 'EXECUTE') THEN
      v_leak := v_leak || v_r;
    END IF;
  END LOOP;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION '斷言b:這些角色不該叫得動 ⇒ %', array_to_string(v_leak, ', ');
  END IF;

  -- 🟢 負對照:service_role **必須**叫得動。少了這一格, 一支恆回 false 的
  --    has_function_privilege 會讓上面那格永遠通過 —— 而告警端拿不到訊號。
  IF NOT has_function_privilege('service_role', 'public.get_settle_retry_gaveup_health()', 'EXECUTE') THEN
    RAISE EXCEPTION '斷言c:service_role 叫不動 ⇒ 告警端拿不到訊號, 而 b 的綠沒有意義';
  END IF;

  -- 真的叫一次, 而且四個 key 都在
  SELECT public.get_settle_retry_gaveup_health() INTO v_j;
  IF v_j IS NULL
     OR NOT (v_j ? 'gave_up_count' AND v_j ? 'oldest_gave_up'
             AND v_j ? 'sample_order_ids' AND v_j ? 'tracked_total') THEN
    RAISE EXCEPTION '斷言d:回傳少了 key ⇒ %', COALESCE(v_j::text, '(NULL)');
  END IF;
END $$;

COMMIT;
