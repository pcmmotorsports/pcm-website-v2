-- 20260927060000-rollback.sql —— 退 20260927060000_m4b_admin_set_product_override.sql
-- 🔴 順序:先 git revert 後台呼叫這支 RPC 的那顆碼(product-overrides-actions.ts),再跑本檔。
--    反過來 ⇒ 後台按儲存會看到「儲存失敗」(RPC 不存在),不會寫壞資料,但員工會以為壞了。
-- 🔵 只拆函式:員工已經存進 staff_overrides 的值留著(客人照樣看得到;片 1 的 view 在讀它)。
--    要連值一起清掉,是片 1 的回滾(20260927040000-rollback.sql 讓 view 不再讀它),不在這裡。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_set_product_override(uuid, text, jsonb, text, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_product_override(uuid, text, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback:admin_set_product_override 仍在';
  END IF;
  RAISE NOTICE '✅ rollback 20260927060000:admin_set_product_override 已移除(staff_overrides 的值刻意留著)';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
