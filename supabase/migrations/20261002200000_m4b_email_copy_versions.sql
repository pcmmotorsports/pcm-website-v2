-- 20261002200000_m4b_email_copy_versions.sql —— 信件文字第 2 片(2a):員工改的信件文字存在這裡
-- PRD ~/pcm-mailbox/PRD-員工自己改交易信文案-20261002.md;計畫 ~/pcm-mailbox/計畫-信件文字第2片-資料庫與寄信接線-20261002.md
-- (Sean 10-02 批 Q1 甲;Fable R1/R2 審過)。
--
-- 改什麼(只新增, 不動既有的表):
--   ① 表 public.email_copy_versions:每次存檔新增一列, 只新增不修改不刪除(service_role 只給 SELECT、INSERT)。
--      · copy_key = 程式清單 email-copy-catalog.ts 的代號;text NULL = 還原成程式預設;'' 不合法。
--      · saved_at 用 clock_timestamp()(存檔那一刻, 不是交易開始)⇒ 寄信「用排隊那一刻生效的版本」的縫最小。
--      · 同一代號同一時間兩列:用 id 決定先後(寄信端固定照 saved_at, id 排)。
--   ② 函式 public.admin_save_email_copy(代號, 文字, 員工, request_id):同一個交易新增一列 + 寫一筆操作紀錄(改前、改後)。
--      SECURITY INVOKER:以呼叫者 service_role 身分跑 ⇒ 受「只給 SELECT、INSERT」約束;service_role 本來就能 INSERT 操作紀錄。
--   代號是否認得、必填 {代號}、不能含「加入官方 LINE @pcmmoto」由程式檢查(清單只在程式裡);
--   這裡只擋格式:代號只能英數、文字 1–300 字、不能換行、不能有 < >(第二道保險)。
-- 影響:沒有任何程式讀它之前, 客人與員工都看不到差別。先貼本支, 再推寄信接線(2b)與存檔動作(2c)。
-- 還原:supabase/rollbacks/20261002200000-rollback.sql(要先 revert 2b, 否則寄信端會持續讀不到表而告警)。
-- 驗證:scripts/20261002200000-verify.sh

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.email_copy_versions') IS NOT NULL THEN
    RAISE EXCEPTION '信件文字前置閘:email_copy_versions 已經存在(貼過了?)';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_save_email_copy(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '信件文字前置閘:admin_save_email_copy 已經存在(貼過了?)';
  END IF;
END
$pre$;

CREATE TABLE public.email_copy_versions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_key   text        NOT NULL,
  text       text,                                   -- NULL = 還原成程式預設
  saved_at   timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  saved_by   text        NOT NULL,
  CONSTRAINT email_copy_versions_key_format CHECK (copy_key ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'),
  CONSTRAINT email_copy_versions_text_format CHECK (
    text IS NULL OR (
      pg_catalog.char_length(text) BETWEEN 1 AND 300
      AND text !~ '[\r\n<>]'
    )
  ),
  CONSTRAINT email_copy_versions_saved_by_nonempty CHECK (saved_by <> '')
);
CREATE INDEX email_copy_versions_key_saved_idx ON public.email_copy_versions (copy_key, saved_at DESC, id DESC);

COMMENT ON TABLE public.email_copy_versions IS
  '信件文字第 2 片:員工在後台改的交易信固定句子。每次存檔新增一列(只新增不修改不刪除);每個 copy_key 最新一列生效, text NULL = 用程式預設。寄信時用「那封信排進佇列那一刻生效的版本」, 同一封信重試文字不變(Resend 冪等鍵要求)。';

ALTER TABLE public.email_copy_versions ENABLE ROW LEVEL SECURITY;
-- service_role 的讀與新增寫成明確的政策, 不只靠它的 BYPASSRLS(docs/patterns/revoking-function-execute-in-supabase.md 開頭那段)。
CREATE POLICY email_copy_versions_service_role_select ON public.email_copy_versions
  FOR SELECT TO service_role USING (true);
CREATE POLICY email_copy_versions_service_role_insert ON public.email_copy_versions
  FOR INSERT TO service_role WITH CHECK (true);
REVOKE ALL ON TABLE public.email_copy_versions FROM PUBLIC, anon, authenticated, service_role;
-- 🔴 只給讀與新增:不給 UPDATE / DELETE / TRUNCATE ⇒ 連後台程式也改不掉、刪不掉舊版本。
GRANT SELECT, INSERT ON TABLE public.email_copy_versions TO service_role;

CREATE FUNCTION public.admin_save_email_copy(p_key text, p_text text, p_actor text, p_request_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_before text;
  v_had    boolean;
  v_id     uuid;
BEGIN
  SELECT v.text, true INTO v_before, v_had
    FROM public.email_copy_versions v
   WHERE v.copy_key = p_key
   ORDER BY v.saved_at DESC, v.id DESC
   LIMIT 1;

  INSERT INTO public.email_copy_versions (copy_key, text, saved_by)
  VALUES (p_key, p_text, p_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'email_copy.save',
    'email_copy:' || p_key,
    pg_catalog.jsonb_build_object('text', CASE WHEN COALESCE(v_had, false) THEN pg_catalog.to_jsonb(v_before) ELSE 'null'::jsonb END,
                                  'is_default', NOT COALESCE(v_had, false) OR v_before IS NULL),
    pg_catalog.jsonb_build_object('text', pg_catalog.to_jsonb(p_text), 'is_default', p_text IS NULL),
    p_request_id,
    'admin'
  );
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_save_email_copy(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_email_copy(text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_email_copy(text, text, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_save_email_copy(text,text,text,text)'];
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 不該開給 anon / authenticated', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:service_role 叫不到 %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure AND p.prosecdef) THEN
      RAISE EXCEPTION '收權斷言:% 應該是 SECURITY INVOKER', v_fn;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('anon', 'public.email_copy_versions', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.email_copy_versions', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.email_copy_versions', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.email_copy_versions', 'INSERT') THEN
    RAISE EXCEPTION '收權斷言:email_copy_versions 不該開給 anon / authenticated';
  END IF;
  IF pg_catalog.has_table_privilege('service_role', 'public.email_copy_versions', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.email_copy_versions', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.email_copy_versions', 'TRUNCATE') THEN
    RAISE EXCEPTION '收權斷言:service_role 不該能改、刪、清空 email_copy_versions';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.email_copy_versions', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.email_copy_versions', 'INSERT') THEN
    RAISE EXCEPTION '收權斷言:service_role 讀不到或寫不進 email_copy_versions';
  END IF;
END
$post$;

COMMIT;
