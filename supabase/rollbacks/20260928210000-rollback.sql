-- 20260928210000-rollback.sql —— 退 20260928210000_m4b_admin_create_manual_product.sql
-- 🔴 順序:先 git revert 後台「新增商品」的碼(商品頁乙 P5、P6),再跑本檔。
--    反過來 ⇒ 員工按建立會看到「沒有建立」(RPC 不存在),不會寫壞資料。
-- 🔵 只拆函式:已經建立的手動商品(supplier_slug = 'pcm')留著;它們建立時都是已下架,要不要刪另外決定。
-- 🔵 本支順帶修好的 sync_product_fitments()(寫明 schema、search_path 空字串)刻意保留:執行內容與原版相同,退回它沒有好處。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_create_manual_product(uuid, uuid, text, text, text, jsonb, text, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_create_manual_product(uuid, uuid, text, text, text, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback:admin_create_manual_product 仍在';
  END IF;
  RAISE NOTICE '✅ rollback 20260928210000:admin_create_manual_product 已移除(已建立的手動商品刻意留著)';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
