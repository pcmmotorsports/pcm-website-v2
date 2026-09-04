\pset pager off
-- 🔴 唯讀。20260905110000 貼後對帳。
-- 🛑 **【函式存在】對本片零判別力** —— 本片不建函式, 只改 proconfig 的 search_path。
--    ⇒ 判準是【那幾支的 search_path 是不是空字串】, 不是【它們在不在】。
-- 🔴 PG 把空字串存成 search_path="" (帶跳脫的雙引號), 不是 search_path=
--    ⇒ 判準字面寫錯會讓 78 支已鎖的被判成沒鎖(2026-09-05 線 -db 實際踩過)。

\echo '=== ① 那幾支在不在(前提;不在 ⇒ 下面每一格都無意義)==='
\echo '    預期:17'
SELECT count(*) AS 找得到幾支
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('admin_adjust_wallet','admin_append_order_note','admin_create_saved_order_view','admin_delete_item_receipt','admin_delete_saved_order_view','admin_finalize_order_refund','admin_initiate_order_refund','admin_record_item_receipt','admin_set_customer_tier','admin_set_product_listing','admin_update_order_workflow','admin_update_saved_order_view','admin_upsert_item_procurement','admin_upsert_supplier','admin_void_item_procurement','admin_void_manual_refund','redeem_coupon');

\echo '=== ② 🔴 判準:其中幾支的 search_path 已鎖成空字串 ==='
\echo '    預期:貼【前】0 · 貼【後】17'
SELECT count(*) AS 已鎖成空
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('admin_adjust_wallet','admin_append_order_note','admin_create_saved_order_view','admin_delete_item_receipt','admin_delete_saved_order_view','admin_finalize_order_refund','admin_initiate_order_refund','admin_record_item_receipt','admin_set_customer_tier','admin_set_product_listing','admin_update_order_workflow','admin_update_saved_order_view','admin_upsert_item_procurement','admin_upsert_supplier','admin_void_item_procurement','admin_void_manual_refund','redeem_coupon')
   AND (SELECT c FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%') = 'search_path=""';

\echo '=== ③ 回滾表在不在(rollback 唯一的依據;它不在 ⇒ 這一片沒有退路)==='
\echo '    預期:貼【前】0 · 貼【後】1'
SELECT count(*) AS 回滾表
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='pcm_definer_searchpath_rollback_20260905110000';

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
