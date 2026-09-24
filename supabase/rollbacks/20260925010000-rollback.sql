SET LOCAL lock_timeout = '5s';
-- 20260925010000 退回:拿掉經銷商申請表與四支函式。
-- 🔴 已經有客人送出申請之後, 這支會把那些申請【一起刪掉】(DROP TABLE)。
--    上線後要退回, 先把前台入口拿掉、匯出申請資料, 再決定要不要跑這支(計畫 §7 那一列)。
-- 核准過的帳號等級【不會】跟著退回(那是 customers.tier, 有 admin_audit_log 可查), 要改回請走後台改等級。
-- 貼完手動跑 NOTIFY pgrst, 'reload schema'; 並跑 pcm_acl_approve_latest(p_note 帶 20260925010000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_n bigint;
BEGIN
  IF pg_catalog.to_regclass('public.dealer_applications') IS NULL THEN
    RAISE EXCEPTION '退回前置閘:dealer_applications 不存在 ⇒ 可能沒貼過或已退過, 停。';
  END IF;
  SELECT count(*) INTO v_n FROM public.dealer_applications;
  RAISE NOTICE '即將刪除 dealer_applications, 目前 % 筆申請。', v_n;
END
$pre$;

DROP FUNCTION public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz);
DROP FUNCTION public.dealer_application_mine();
DROP FUNCTION public.dealer_application_update_mine(uuid, text, text, text, text, text, text, text, text);
DROP FUNCTION public.dealer_application_submit(text, text, text, text, text, text, text, text);
DROP TABLE public.dealer_applications;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.dealer_applications') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.dealer_application_mine()') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後閘:表或函式還在 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ 20260925010000 已退回。';
END
$post$;

COMMIT;
