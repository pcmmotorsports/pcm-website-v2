\pset pager off
\set ON_ERROR_STOP on
-- 🔴 **`ON_ERROR_STOP` 不可省** —— `psql -f` 的 rc 在【有 ERROR】與【全對】兩個世界都是 **0**
--    (2026-09-05 實測:餵一句 `SELECT * FROM 不存在的表` ⇒ rc 仍然 `0`, 只有輸出裡多一行 ERROR)
--    ⇒ 少了它, 中間某格炸掉之後【後面每一格照樣跑照樣印】⇒ 一份看起來完整的報告裡埋著一個 ERROR。
--    來源:codex 2026-09-05 finding 3(原本只修在 `130000-after.sql` 一支)。
-- 🔴 唯讀。20260905100000 貼後對帳。
-- 🛑 **【函式存在】對本片零判別力** —— 本片不建函式, 只改 proconfig 的 search_path。
--    ⇒ 判準是【那幾支的 search_path 是不是空字串】, 不是【它們在不在】。
-- 🔴 PG 把空字串存成 search_path="" (帶跳脫的雙引號), 不是 search_path=
--    ⇒ 判準字面寫錯會讓 78 支已鎖的被判成沒鎖(2026-09-05 線 -db 實際踩過)。

\echo '=== ① 那幾支在不在(前提;不在 ⇒ 下面每一格都無意義)==='
\echo '    預期:3'
SELECT count(*) AS 找得到幾支
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('admin_list_saved_order_views','pcm_manual_refund_rail_cap','pcm_order_refundable_remaining');

\echo '=== ② 🔴 判準:其中幾支的 search_path 已鎖成空字串 ==='
\echo '    預期:貼【前】0 · 貼【後】3'
SELECT count(*) AS 已鎖成空
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('admin_list_saved_order_views','pcm_manual_refund_rail_cap','pcm_order_refundable_remaining')
   AND (SELECT c FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%') = 'search_path=""';

\echo '=== ③ 回滾表在不在(rollback 唯一的依據;它不在 ⇒ 這一片沒有退路)==='
\echo '    預期:貼【前】0 · 貼【後】1'
SELECT count(*) AS 回滾表
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='pcm_definer_searchpath_rollback_20260905100000';

\echo '=== 🟢 正對照:同一把尺對【全庫已鎖成空的 DEFINER】要印非 0 ==='
\echo '    預期:非 0(它證明這把尺會動;若它是 0, 上面那個 0 沒有意義)'
SELECT count(*) AS 全庫已鎖成空_該非0
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
   AND (SELECT c FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%') = 'search_path=""';

\echo '=== 🔵 負對照:同一把尺問一支【本片不動】的函式 ⇒ 該 0 ==='
\echo '    預期:0(rls_auto_enable 是 pg_catalog 系, plan §1 列為緩做)'
SELECT count(*) AS 負對照_該0
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='rls_auto_enable'
   AND (SELECT c FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%') = 'search_path=""';

\echo '=== 🛑 這一發證不到什麼 ==='
\echo '    · 它證【proconfig 那一格的字面對了】, 不證【那幾支函式還跑得動】'
\echo '    · 🔴 拋棄式 PG 實測:ALTER FUNCTION SET search_path 在下的當下【零警告零錯誤】,'
\echo '      body 裡若有裸引用要等到【有人真的呼叫】才炸'
\echo '      ⇒ 貼板包 §A3 的閘 B(行為)要另外跑一輪, 這一發不替它背書'
\echo '    · 它只看這幾支;同批別支沒進來這把尺不會叫'
