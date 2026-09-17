-- 🔬 貼完 20260917010000 之後【必跑】的那一步。🟢 唯讀 —— 只讀, 不改任何東西。
--   bash scripts/readonly-prod-sql.sh docs/evidence/2026-09-17-pcm-readonly-four-tables-after.sql
--
-- 🔴 **為什麼不能只印 count** —— 判讀規則見檔尾, 先把三樣東西一起印出來。
\pset pager off

\echo '=== ① 我是誰 + BYPASSRLS 還在不在(這一格決定下面的 0 怎麼讀)==='
SELECT current_user AS 我是誰,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls,
       now() AS 撈的時間;

\echo '=== ② 四張各自的 policy 數(零 policy + 沒 BYPASSRLS = 必定零列)==='
SELECT c.relname AS 表, c.relrowsecurity AS rls開著,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy數
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('home_banners','supplier_inbound_emails',
                     'pcm_net_exposure_snapshot','shipment_order_ship_clearances')
 ORDER BY 1;

\echo '=== ③ 四張各撈一次 count(*) —— 撈不到會是 ERROR 不是 0 ==='
SELECT 'home_banners'                   AS 表, count(*) AS 列數 FROM public.home_banners
UNION ALL SELECT 'supplier_inbound_emails',        count(*) FROM public.supplier_inbound_emails
UNION ALL SELECT 'pcm_net_exposure_snapshot',      count(*) FROM public.pcm_net_exposure_snapshot
UNION ALL SELECT 'shipment_order_ship_clearances', count(*) FROM public.shipment_order_ship_clearances;

\echo ''
\echo '━━━ 判讀規則(🔴 不要只看 ③)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
\echo '  ③ 出現 permission denied  ⇒ GRANT【沒生效】。這不是 RLS 問題, 是授權問題。'
\echo '  ③ 回得出任何數字(含 0)  ⇒ GRANT【生效了】—— 權限那一關過了。'
\echo '  ③ 數字 > 0                ⇒ ✅ 真的讀得到列。這一步過。'
\echo '  ③ 數字 = 0 而 ① 是 t      ⇒ 那張表【真的空】(BYPASSRLS 還在, 沒有東西擋得住它)。'
\echo '  🔴 ③ 數字 = 0 而 ① 是 f   ⇒ **這就是那個坑**:policy 全 TO service_role,'
\echo '      零列是【被擋】不是【表空】, 而 has_table_privilege 照樣回 t、沒有一道尺會叫。'
\echo '      ⇒ 📌 空比 denied 更難認出是壞的。此時要去看 ② 的 policy 數。'
\echo '  ⚠️ ② policy 數 = 0 而 ① 是 f ⇒ 那張表對這個角色【必定】零列, 不必再猜。'
