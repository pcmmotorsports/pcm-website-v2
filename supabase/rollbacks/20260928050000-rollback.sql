-- 20260928050000-rollback.sql —— 退 20260928050000_m4b_admin_set_product_category.sql
-- 🔴 順序:先 git revert 後台呼叫這支 RPC 的碼(商品頁乙 C3–C5),再跑本檔。
--    反過來 ⇒ 後台按儲存會看到「儲存失敗」(RPC 不存在),不會寫壞資料,但員工會以為壞了。
-- 🔵 只拆函式:已經鎖住的分類留著(20260928040000 的 trigger 照樣保護)。要連鎖一起放掉,是 20260928040000-rollback.sql。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_set_product_category(uuid[], uuid, boolean, text, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_product_category(uuid[], uuid, boolean, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback:admin_set_product_category 仍在';
  END IF;
  RAISE NOTICE '✅ rollback 20260928050000:admin_set_product_category 已移除(已鎖的分類刻意留著)';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
