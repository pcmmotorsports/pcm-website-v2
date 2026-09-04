\pset pager off
-- 🔴 唯讀。040000b 貼後對帳。
-- 判別字面「bank_pending」取自那支 migration 自己(10 次命中, 貼前先數過)
-- 🛑 而【函式存在】對 CREATE OR REPLACE 零判別力 ⇒ 判準是【函式體含不含那個字面】。

\echo '=== ① 那支函式在不在(前提;不在 ⇒ 下面每一格都無意義)==='
\echo '    預期:1(或多載數)'
SELECT count(*) AS 幾個多載
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname||'.'||p.proname = 'public.find_active_sibling_own';

\echo '=== ② 🔴 判準:函式體含不含「bank_pending」==='
\echo '    預期:貼【前】f · 貼【後】t'
SELECT COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%bank_pending%'), false) AS 含判別字面
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname||'.'||p.proname = 'public.find_active_sibling_own';

\echo '=== 🟢 正對照:同一把尺問【同一支函式】一個一定在的字面 ⇒ 該 t ==='
\echo '    預期:t(它證明這把尺在這支函式上會動;若它是 f, 上面那個 f 沒有意義)'
SELECT COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%RETURNS%'), false) AS 正對照_該t
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname||'.'||p.proname = 'public.find_active_sibling_own';

\echo '=== 🔵 負對照:同一把尺問一個現造的字面 ⇒ 該 f ==='
\echo '    預期:f(它證明這把尺不是對什麼都印 t)'
SELECT COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%zzq_bogus_literal_20260905%'), false) AS 負對照_該f
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname||'.'||p.proname = 'public.find_active_sibling_own';

\echo '=== 🛑 這一發證不到什麼 ==='
\echo '    · 它證【正式庫那支函式體裡有那串字】, 不證【它的行為對】'
\echo '    · 字面被改名 / 被搬到別支函式 ⇒ 這把尺印 f, 而那不一定是「沒貼」'
\echo '    · 它只看那一支函式;同批的別支沒進來這把尺不會叫'
