\pset pager off
\set ON_ERROR_STOP on
-- 🔴 **`ON_ERROR_STOP` 不可省** —— `psql -f` 的 rc 在【有 ERROR】與【全對】兩個世界都是 0。
-- 🟢 本檔唯讀。對象:`supabase/migrations/20260905170000_m4b_acl_drift_status_and_approve.sql`
-- 🔴 前置:片一 `20260905140000` 必須先貼。

\echo '=== 🟢 正對照:這條連線活著嗎(該非 0) ==='
SELECT count(*) AS 全庫policy數_該非0 FROM pg_catalog.pg_policy;

\echo '=== ① 兩個新物件在不在(該各 1) ==='
SELECT count(*) FILTER (WHERE c.relname = 'pcm_acl_drift_status') AS view_該1
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public';
SELECT count(*) AS approve函式_該1
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'pcm_acl_approve_latest';

\echo '=== ② 🔴 判準:那支 view 回得出一列, 而且欄位是我們要的 ==='
SELECT * FROM public.pcm_acl_drift_status;

\echo '=== ③ 收權:四個應用角色對 approve 函式該【全部 f】 ==='
SELECT r.rolname AS 角色,
       pg_catalog.has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS 叫得動嗎_該f
  FROM pg_catalog.pg_roles r
  CROSS JOIN (SELECT oid FROM pg_catalog.pg_proc WHERE proname = 'pcm_acl_approve_latest' LIMIT 1) p
 WHERE r.rolname IN ('anon','authenticated','service_role','payment_confirmer')
 ORDER BY r.rolname;

\echo '=== ④ 而 view 只有 service_role 讀得到(三個 f + 一個 t) ==='
SELECT r.rolname AS 角色,
       pg_catalog.has_table_privilege(r.rolname, c.oid, 'SELECT') AS 讀得到嗎
  FROM pg_catalog.pg_roles r
  CROSS JOIN (SELECT c.oid FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status') c
 WHERE r.rolname IN ('anon','authenticated','service_role','payment_confirmer')
 ORDER BY r.rolname;

\echo '=== 🟢 正對照:同一把尺問一個【一定讀得到】的東西 ==='
SELECT pg_catalog.has_table_privilege('service_role', 'public.pcm_acl_drift_status', 'SELECT') AS 該t;

\echo '=== 🔵 負對照:同一把尺問一支現造的函式名 ⇒ 該 0 ==='
SELECT count(*) AS 現造名_該0
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'pcm_acl_zzq_nonce_0905';

\echo '=== ⑤ view 是 security_invoker 嗎(該 true) ==='
SELECT (SELECT o FROM unnest(c.reloptions) o WHERE o LIKE 'security_invoker=%') AS 該security_invoker_true
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_drift_status';

\echo '=== 🔴🔴 ⑥ 最重要的一格:【真的用 service_role 的身分讀一次】 ==='
\echo '    為什麼:has_table_privilege(view) 印 t 而【讀底表】仍可能被擋 ——'
\echo '    definer/invoker 的差別在這一格才顯形。第一版 view 寫成 security_invoker=true,'
\echo '    那時本檔每一格都綠, 而 service_role 實際讀會 permission denied(codex R1 抓到)。'
DO $$
DECLARE v_n integer;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM public.pcm_acl_drift_status;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '⑥ service_role 讀到 % 列 —— 該恰好 1 列', v_n;
  END IF;
  RAISE NOTICE '✅ ⑥ service_role 真的讀得到(1 列)';
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RAISE EXCEPTION '🔴 ⑥ service_role 讀不到 ⇒ 告警端拿不到訊號。%', SQLERRM;
END $$;

\echo '=== 🔵 而負對照:anon 讀同一支 view ⇒ 【必須】被擋 ==='
DO $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM 1 FROM public.pcm_acl_drift_status;
  RESET ROLE;
  RAISE EXCEPTION '🔴 anon 竟然讀得到 ⇒ 這扇窗開太大';
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  RAISE NOTICE '✅ anon 被擋(這才是對的)';
END $$;

\echo '=== 🛑 這一發證不到什麼 ==='
\echo '    · 🔴 ①〜⑤ 那幾格【只是印出來給人看】—— 它們不會讓 rc 變非 0。'
\echo '      會紅的只有 ⑥ 與負對照那兩格(它們是 DO 區塊、會 RAISE)。'
\echo '      ⇒ 讀的人要【自己看數字】, 不要因為 rc=0 就當作全部通過。'
\echo '    · 它證【物件建出來了、權限收乾淨了】, 不證【它以後會叫】——'
\echo '      那要等真的有人改權限, 或手動造一次漂移(見 migration 檔頭的實測段)。'
\echo '    · ② 那一列若 有漂移=t 而【今天貼了板】⇒ 那是我們自己做的, 正確處置是'
\echo '      SELECT public.pcm_acl_approve_latest(''貼了 <版本號>, 那些差是它造成的'');'
\echo '      🔴 而【批准不是消音】—— 有漂移 仍然是 t, 只是多了一個人的簽名。'
