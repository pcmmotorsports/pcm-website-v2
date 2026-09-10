\set ON_ERROR_STOP on
\pset pager off
-- 逐字取自 pcm-quote-v2 supabase/migrations/20260730000000_baseline_schema.sql:4764 + :5728
CREATE TABLE public.sso_codes (
    code_hash text NOT NULL,
    state_hash text NOT NULL,
    amr text[] NOT NULL,
    auth_time bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.sso_codes ADD CONSTRAINT sso_codes_pkey PRIMARY KEY (code_hash);

INSERT INTO public.sso_codes(code_hash,state_hash,amr,auth_time,expires_at) VALUES
 ('hash_live','st_live', ARRAY['pwd'], 1757000000, now()+interval '60 seconds'),
 ('hash_other','st_other',ARRAY['pwd'], 1757000000, now()+interval '60 seconds'),
 ('hash_exp',  'st_exp',  ARRAY['pwd'], 1757000000, now()-interval '1 second');

\echo '=== A 第一發:真的消耗(預期 1 列)==='
WITH u AS (UPDATE public.sso_codes SET used_at=now()
  WHERE code_hash='hash_live' AND state_hash='st_live' AND used_at IS NULL AND expires_at>now()
  RETURNING 1) SELECT count(*) AS rows_returned FROM u;

\echo '=== B 第二發:同一顆碼再來一次(🔴 這就是 #5,預期 0 列)==='
WITH u AS (UPDATE public.sso_codes SET used_at=now()
  WHERE code_hash='hash_live' AND state_hash='st_live' AND used_at IS NULL AND expires_at>now()
  RETURNING 1) SELECT count(*) AS rows_returned FROM u;

\echo '=== 🟢 正對照:另一顆【沒用過】的碼(預期 1 列 ⇒ 證明上面那個 0 不是恆 0)==='
WITH u AS (UPDATE public.sso_codes SET used_at=now()
  WHERE code_hash='hash_other' AND state_hash='st_other' AND used_at IS NULL AND expires_at>now()
  RETURNING 1) SELECT count(*) AS rows_returned FROM u;

\echo '=== ⚪ 負對照:已過期的碼(預期 0 列)==='
WITH u AS (UPDATE public.sso_codes SET used_at=now()
  WHERE code_hash='hash_exp' AND state_hash='st_exp' AND used_at IS NULL AND expires_at>now()
  RETURNING 1) SELECT count(*) AS rows_returned FROM u;

\echo '=== ⚪ 負對照:state 不符(預期 0 列)==='
INSERT INTO public.sso_codes(code_hash,state_hash,amr,auth_time,expires_at)
 VALUES ('hash_s','st_right',ARRAY['pwd'],1757000000, now()+interval '60 seconds');
WITH u AS (UPDATE public.sso_codes SET used_at=now()
  WHERE code_hash='hash_s' AND state_hash='st_wrong' AND used_at IS NULL AND expires_at>now()
  RETURNING 1) SELECT count(*) AS rows_returned FROM u;

\echo '=== 🔴 而【沒把 used_at 寫進去】會怎樣 —— 那就是 columns= 那個繞過的 DB 後果 ==='
INSERT INTO public.sso_codes(code_hash,state_hash,amr,auth_time,expires_at)
 VALUES ('hash_col','st_col',ARRAY['pwd'],1757000000, now()+interval '60 seconds');
\echo '--- 第一發:改的是 amr 不是 used_at(模擬 columns=amr)---'
WITH u AS (UPDATE public.sso_codes SET amr=ARRAY['pwd','x']
  WHERE code_hash='hash_col' AND used_at IS NULL AND expires_at>now() RETURNING 1)
SELECT count(*) AS rows_returned FROM u;
\echo '--- 第二發:同一顆碼(🔴 預期【1 列】= 重放成功)---'
WITH u AS (UPDATE public.sso_codes SET amr=ARRAY['pwd','y']
  WHERE code_hash='hash_col' AND used_at IS NULL AND expires_at>now() RETURNING 1)
SELECT count(*) AS rows_returned FROM u;

\echo '=== 收尾:used_at 現況 ==='
SELECT code_hash, used_at IS NOT NULL AS consumed FROM public.sso_codes ORDER BY 1;
\set ON_ERROR_STOP on
\timing on
BEGIN;
WITH u AS (UPDATE public.sso_codes SET used_at=now()
  WHERE code_hash='hash_race2' AND state_hash='st_race' AND used_at IS NULL AND expires_at>now()
  RETURNING 1) SELECT :'who' AS who, count(*) AS rows_won FROM u;
SELECT pg_sleep(:hold);
COMMIT;
