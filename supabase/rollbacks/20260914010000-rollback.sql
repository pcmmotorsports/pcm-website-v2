-- 20260914010000-rollback.sql —— 退回 20260914010000_m4b_order_item_costs.sql
--
-- 🔴 先確認沒有呼叫端:
--     grep -rn "admin_set_order_item_costs\|order_item_costs" apps packages
--   有呼叫端還 DROP ⇒ 後台「老闆:成本」模式會炸(第二發讀 42P01 / RPC 42883)。
-- 🔴 DROP TABLE 會連已填的成本一起丟(稽核列只有 before/after 摘要, 不等於原表)。
--    `SELECT count(*) FROM public.order_item_costs` = 0 才直接退;有列 ⇒ 先另存一份再退, 而那是另一次有人簽名的動作。
-- 🛑 已寫下的 admin_audit_log 列(action = orders.item.costs.set)不刪 —— append-only。本檔零 DELETE。

BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_set_order_item_costs(text,jsonb,text);
DROP TABLE IF EXISTS public.order_item_costs;
COMMIT;
