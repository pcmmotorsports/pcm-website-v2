-- 20260912050000-rollback.sql —— 退回 20260912050000_m4b_mgr0_staff_write_rpcs.sql
--
-- 🔵 **預設不要跑。** plan §12-5 逐字:回退是**應用層**的事(把 `staff-actions.ts` 改回呼三支
--    repository 函式),而**三支 RPC 沒有呼叫端時留著是零風險 —— DROP 掉再建才是風險**。
-- 🔴 只有在【確定沒有任何呼叫端】時才跑本檔:
--      grep -rn "admin_staff_create\|admin_staff_update_profile\|admin_staff_set_active" apps packages
--    期望 0(測試檔裡的命中要逐一開檔判, 不能只看數字)。
-- 🛑 **已經寫下的稽核列不刪** —— append-only;那些列記的是真的發生過的事。本檔零 DELETE。
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_staff_create(text,text,text,boolean,text);
DROP FUNCTION IF EXISTS public.admin_staff_update_profile(text,text,text,boolean,text);
DROP FUNCTION IF EXISTS public.admin_staff_set_active(text,text,boolean,text);
COMMIT;
