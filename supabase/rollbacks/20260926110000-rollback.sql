-- 20260926110000 退回:刪掉登入限次的表與三支函式。
-- 🔴 前置:網站程式已拿掉登入限次的接線(或兩站 LOGIN_THROTTLE_ENABLED 已不是 true 並重新部署),
--          否則開關開著時登入會呼叫不存在的函式(程式會放行並記錄 [login-throttle] fail-open, 不會擋登入)。
-- 平常要停用不用跑這支, 改環境變數就好(計畫第六節)。

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.auth_login_attempt_clear(text);
DROP FUNCTION IF EXISTS public.auth_login_attempt_settle(uuid, text);
DROP FUNCTION IF EXISTS public.auth_login_attempt_reserve(text);
DROP TABLE IF EXISTS public.auth_login_attempts;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.auth_login_attempts') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後閘:auth_login_attempts 還在 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ 登入限次的表與函式已刪除。';
END
$post$;

COMMIT;
