SET LOCAL lock_timeout = '5s';
-- 20260925020000 退回:拿掉兩支函式與 dealer_applications.source 欄。
-- 🔴 已經有員工在後台建立過經銷帳號(source='staff')⇒ 這支【拒絕執行】(Codex R1):
--    刪掉 source 欄之後再貼回來, 那些紀錄會全部變成 customer ⇒ 同一個帳號按「重新完成設定」會再建一筆、
--    等級被員工降回去的也會再被升上來。真的要退, 先把那幾筆的 user_id 匯出, 再決定怎麼處理。
-- 退之前先把後台「新增經銷帳號」與「寄送重設密碼信」兩顆按鈕拿掉, 否則按下去會失敗。
-- 貼完手動跑 NOTIFY pgrst, 'reload schema'; 並跑 pcm_acl_approve_latest(p_note 帶 20260925020000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 🔴 先鎖整張表再檢查(Codex R2):不鎖的話, 一筆還沒提交的「員工建帳號」在檢查時看不到,
--    等它提交後 DROP COLUMN 照樣成功 ⇒ 那一筆的 source 還是會不見。鎖到交易結束。
LOCK TABLE public.dealer_applications IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  v_n bigint;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_password_reset_claim(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION '退回前置閘:admin_password_reset_claim 不存在 ⇒ 可能沒貼過或已退過, 停。';
  END IF;
  SELECT count(*) INTO v_n FROM public.dealer_applications WHERE source = 'staff';
  IF v_n > 0 THEN
    RAISE EXCEPTION '退回前置閘:已有 % 筆員工建立的經銷帳號紀錄, 刪掉 source 欄會讓重貼後的冪等判斷失效 ⇒ 停。', v_n;
  END IF;
END
$pre$;

DROP FUNCTION public.admin_password_reset_claim(uuid, text, text);
DROP FUNCTION public.admin_dealer_account_create(uuid, text, text, text, text, text, text, text, text, text, text);
ALTER TABLE public.dealer_applications DROP COLUMN source;

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_password_reset_claim(uuid, text, text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'public.dealer_applications'::regclass AND attname = 'source' AND NOT attisdropped) THEN
    RAISE EXCEPTION '退回事後閘:函式或欄位還在 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ 20260925020000 已退回。';
END
$post$;

COMMIT;
