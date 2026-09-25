-- ============================================================
-- 登入限次:依 Email 記錄登入嘗試(資安修正片 3)
-- ============================================================
-- plan:~/pcm-mailbox/計畫-片3-登入限次-migration-20260926.md 第 2 版(Fable R1 PASS;Sean 2026-09-26 Q26 甲批准)
-- 上層計畫:~/pcm-mailbox/計畫-資安修正-註冊登入-20260926.md 第五節「第一道」
-- 退回檔:supabase/rollbacks/20260926110000-rollback.sql
--
-- 規則:同一個 Email 15 分鐘內登入失敗 10 次 ⇒ 先擋, 不再把密碼送去 Supabase。
-- 網站的登入 action 每次登入分三步:
--   ① 佔一格(auth_login_attempt_reserve):數「15 分鐘內 failed」+「2 分鐘內 reserved」, 到 10 就回 allowed=false。
--   ② 結算(auth_login_attempt_settle):密碼錯 ⇒ failed;登入成功 ⇒ 這個 Email 全部清掉;其他錯誤 ⇒ 刪掉這一格。
--   ③ 伺服器沒結算就當掉 ⇒ 那一格 2 分鐘後不再算。
-- 設定新密碼成功後, 網站用登入狀態裡的 Email 呼叫 auth_login_attempt_clear 解除。
--
-- ══ 形狀 ═══════════════════════════════════════════════════════
-- · 不存 Email 原文、不存 IP;只存「統一後 Email」的 sha256(去前後空白、轉小寫)。統一只在這裡做一次, 網站傳原始輸入。
--   ponytail: 沒加鹽, 拿到表的人可用已知 Email 反查;表只有 service_role 讀得到。要更嚴改 HMAC(金鑰放伺服器環境變數)。
-- · 表 ⇒ anon / authenticated 零權限;service_role 只有 SELECT(給 rls-service-role-policy-gate 與人工查詢), 寫入只能經三支函式。
-- · 三支函式 SECURITY DEFINER、search_path 空字串、只給 service_role。不開給 anon:否則外人不經人機驗證就能一直佔格,
--   讓任何客人登不進去(計畫 4-1)。
-- · 清理不另開 pg_cron:每次佔格時順手刪全表 1 天以前的紀錄(每次最多 200 筆, SKIP LOCKED 避免兩個登入互等)。
--   只要有人登入, 舊紀錄就會慢慢清掉;外人亂打 Email 也只能讓表停在大約一天的量。
-- · 同一個 Email 的並發用交易鎖排隊(pg_advisory_xact_lock), 同一個 Email 第一次登入、表裡還沒紀錄時也會排隊。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.auth_login_attempts') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.auth_login_attempts 已存在 ⇒ 停(可能已貼過)。';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'auth\_login\_attempt\_%') THEN
    RAISE EXCEPTION '前置閘②:已有 auth_login_attempt_* 函式 ⇒ 停(可能已貼過)。';
  END IF;
END
$pre$;

-- ── 1. 表 ─────────────────────────────────────────────────────
CREATE TABLE public.auth_login_attempts (
  id          uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email_hash  bytea       NOT NULL,
  -- 約束寫具名形式:apps/admin 的 refund-recovery-read.test.ts 會把任何「status text NOT NULL CHECK (status IN」當成退款狀態值域
  status      text        NOT NULL CONSTRAINT auth_login_attempts_status_check CHECK (status IN ('reserved', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX auth_login_attempts_hash_time_idx ON public.auth_login_attempts (email_hash, created_at);
CREATE INDEX auth_login_attempts_time_idx      ON public.auth_login_attempts (created_at);

COMMENT ON TABLE public.auth_login_attempts IS
  '登入限次(20260926110000;資安修正片 3)。一次登入嘗試一列:統一後 Email 的 sha256、狀態(reserved 佔位中 / failed 密碼錯)、時間。不存 Email 原文與 IP。anon / authenticated 零權限;寫入只經 auth_login_attempt_reserve / _settle / _clear(僅 service_role)。';

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
-- service_role 帶 BYPASSRLS;這條政策是給哪天拿掉它時用的(rls-service-role-policy-gate)
CREATE POLICY auth_login_attempts_service_role_select ON public.auth_login_attempts
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.auth_login_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.auth_login_attempts TO service_role;

-- ── 2. 佔一格 ─────────────────────────────────────────────────
CREATE FUNCTION public.auth_login_attempt_reserve(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hash  bytea := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), 'UTF8'));
  v_count integer;
  v_id    uuid;
BEGIN
  -- 同一個 Email 排隊(第一次、表裡還沒紀錄時也一樣), 交易結束才放
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.encode(v_hash, 'hex'), 0));

  DELETE FROM public.auth_login_attempts
   WHERE email_hash = v_hash AND created_at < pg_catalog.now() - interval '15 minutes';
  -- 全表清理:別人正在處理的列跳過, 不互等
  DELETE FROM public.auth_login_attempts
   WHERE id IN (SELECT a.id FROM public.auth_login_attempts a
                 WHERE a.created_at < pg_catalog.now() - interval '1 day'
                 LIMIT 200 FOR UPDATE SKIP LOCKED);

  SELECT pg_catalog.count(*) INTO v_count
    FROM public.auth_login_attempts
   WHERE email_hash = v_hash
     AND ((status = 'failed'   AND created_at >= pg_catalog.now() - interval '15 minutes')
       OR (status = 'reserved' AND created_at >= pg_catalog.now() - interval '2 minutes'));

  IF v_count >= 10 THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false);
  END IF;

  INSERT INTO public.auth_login_attempts (email_hash, status) VALUES (v_hash, 'reserved') RETURNING id INTO v_id;
  RETURN pg_catalog.jsonb_build_object('allowed', true, 'id', v_id);
END;
$fn$;

-- ── 3. 結算 ───────────────────────────────────────────────────
CREATE FUNCTION public.auth_login_attempt_settle(p_id uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hash bytea;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('failed', 'success', 'release') THEN
    RAISE EXCEPTION 'auth_login_attempt_settle:不認得的結果 %', p_outcome USING ERRCODE = '22023';
  END IF;
  SELECT email_hash INTO v_hash FROM public.auth_login_attempts WHERE id = p_id;
  IF v_hash IS NULL THEN
    RETURN; -- 重複呼叫、或已被清掉 ⇒ 不做事
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.encode(v_hash, 'hex'), 0));

  IF p_outcome = 'failed' THEN
    -- 已逾時(超過 2 分鐘)才收到結果也照改:那確實是一次密碼錯誤
    UPDATE public.auth_login_attempts SET status = 'failed' WHERE id = p_id AND status = 'reserved';
  ELSIF p_outcome = 'success' THEN
    DELETE FROM public.auth_login_attempts WHERE email_hash = v_hash;
  ELSE
    DELETE FROM public.auth_login_attempts WHERE id = p_id AND status = 'reserved';
  END IF;
END;
$fn$;

-- ── 4. 依 Email 清除(設定新密碼成功後)────────────────────────
CREATE FUNCTION public.auth_login_attempt_clear(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_hash bytea := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), 'UTF8'));
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.encode(v_hash, 'hex'), 0));
  DELETE FROM public.auth_login_attempts WHERE email_hash = v_hash;
END;
$fn$;

-- ── 5. 權限 ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.auth_login_attempt_reserve(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auth_login_attempt_settle(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auth_login_attempt_clear(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_login_attempt_reserve(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_login_attempt_settle(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_login_attempt_clear(text) TO service_role;

COMMENT ON FUNCTION public.auth_login_attempt_reserve(text) IS
  '登入前佔一格(20260926110000)。回 {allowed:false} 或 {allowed:true, id}。15 分鐘內 failed + 2 分鐘內 reserved 達 10 就擋。僅 service_role 可執行。';
COMMENT ON FUNCTION public.auth_login_attempt_settle(uuid, text) IS
  '登入結算(20260926110000)。failed = 密碼錯;success = 清掉這個 Email 全部紀錄;release = 刪掉這一格。重複呼叫不出錯。僅 service_role 可執行。';
COMMENT ON FUNCTION public.auth_login_attempt_clear(text) IS
  '依 Email 清掉登入限次紀錄(20260926110000;設定新密碼成功後、或人工解鎖)。僅 service_role 可執行。';

-- ── 6. 事後閘 ─────────────────────────────────────────────────
DO $post$
DECLARE
  r      text;
  v_cfg  text;
  v_res  jsonb;
  v_id   uuid;
  i      integer;
  -- 🔴 收權斷言清單:本檔建出來的【可授權物件】全部列在這裡(migration-static-checks ③ 會數)
  v_relations text[] := ARRAY['public.auth_login_attempts']::text[];
  v_functions text[] := ARRAY['public.auth_login_attempt_reserve(text)', 'public.auth_login_attempt_settle(uuid, text)', 'public.auth_login_attempt_clear(text)']::text[];
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:斷言清單裡的 % 不存在 ⇒ 停。', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:斷言清單裡的 % 不存在 ⇒ 停。', r;
    END IF;
  END LOOP;
  -- 表:anon / authenticated 零權限;service_role 只有 SELECT
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    IF has_table_privilege(r, 'public.auth_login_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r, 'public.auth_login_attempts', 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION '事後閘①:% 對 auth_login_attempts 有權限 ⇒ 停。', r;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.auth_login_attempts', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION '事後閘②:service_role 能直接寫 auth_login_attempts ⇒ 停。';
  END IF;
  -- 三支函式:只給 service_role
  FOREACH r IN ARRAY v_functions LOOP
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘③:% 的 EXECUTE 不對(只該給 service_role)⇒ 停。', r;
    END IF;
  END LOOP;
  -- 三支都是 DEFINER 而且 search_path 空字串
  FOR r, v_cfg IN
    SELECT p.oid::regprocedure::text, pg_catalog.array_to_string(p.proconfig, ',') || CASE WHEN p.prosecdef THEN '' ELSE '|NOT-DEFINER' END
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('auth_login_attempt_reserve', 'auth_login_attempt_settle', 'auth_login_attempt_clear')
  LOOP
    IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後閘④:% 的 search_path 設定是 %(期望空字串)⇒ 停。', r, v_cfg;
    END IF;
  END LOOP;

  -- 真的跑一輪(用不會撞到真客人的 Email, 最後清掉;整支 migration 在同一個交易裡)
  FOR i IN 1..10 LOOP
    v_res := public.auth_login_attempt_reserve('  Migration-SelfTest@Example.INVALID ');
    IF (v_res->>'allowed')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION '事後閘⑤:第 % 次佔格就被擋 ⇒ 停。', i;
    END IF;
    PERFORM public.auth_login_attempt_settle((v_res->>'id')::uuid, 'failed');
  END LOOP;
  -- 第 11 次:大小寫與空白不同, 仍是同一個 Email ⇒ 擋
  IF (public.auth_login_attempt_reserve('migration-selftest@example.invalid')->>'allowed')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '事後閘⑥:失敗 10 次後第 11 次沒被擋(或大小寫沒統一)⇒ 停。';
  END IF;
  PERFORM public.auth_login_attempt_clear('MIGRATION-SELFTEST@example.invalid');
  v_res := public.auth_login_attempt_reserve('migration-selftest@example.invalid');
  IF (v_res->>'allowed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '事後閘⑦:清除後仍被擋 ⇒ 停。';
  END IF;
  v_id := (v_res->>'id')::uuid;
  PERFORM public.auth_login_attempt_settle(v_id, 'success');
  PERFORM public.auth_login_attempt_settle(v_id, 'success'); -- 重複呼叫不出錯
  IF EXISTS (SELECT 1 FROM public.auth_login_attempts
              WHERE email_hash = pg_catalog.sha256(pg_catalog.convert_to('migration-selftest@example.invalid', 'UTF8'))) THEN
    RAISE EXCEPTION '事後閘⑧:登入成功後紀錄沒清掉 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ auth_login_attempts 與三支函式建好, 自我測試通過。';
END
$post$;

COMMIT;
