-- 20260928220000-rollback.sql —— 退 20260928220000_m4b_admin_set_variant_prices.sql
-- 🔴 順序:先 git revert 後台改價與特價的入口(商品頁乙 P8、P9、P14),再跑本檔。
--    反過來 ⇒ 主管按儲存會看到「沒有儲存」(RPC 不存在),不會寫壞資料。
-- 🔵 只拆函式:已經改過的價格與特價留著。要清特價,照計畫第八節退回順序跑 20260928200000-rollback.sql。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_set_variant_prices(uuid, jsonb, text, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_variant_prices(uuid, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback:admin_set_variant_prices 仍在';
  END IF;
  RAISE NOTICE '✅ rollback 20260928220000:admin_set_variant_prices 已移除(已改的價格刻意留著)';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
