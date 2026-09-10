-- 回捲 · `20260901020500_m4b_coupon_revert_on_full_refund.sql`
--
-- 🟢 **今天安全**:本支只建一個函式, 而**零呼叫端**(接線在另一支 migration)
--    ⇒ 移除它不會弄壞任何正在跑的東西。
-- 🔴 **而它會讓 `20260901021000` / `20260901030000` 重新變成貼不下去** —— 那兩支的
--    第一道前置閘查的就是這個函式。⇒ 回捲之前先確認那兩支還沒貼。
-- 🔴 **單向的那一格**:已經被寫上 `reverted_at` 的那些 redemption **不會**自己變回來。
--    回捲只拿掉「以後還能不能退」, 拿不掉「已經退過的那些」。
--    ⇒ 回捲前先量一次:`SELECT count(*) FROM public.coupon_redemptions WHERE reverted_at IS NOT NULL;`
--
-- 🔵 `lock_timeout`:與正向那支同形, 鎖等不到就放棄, 不要卡住別人。
SET lock_timeout = '3s';

BEGIN;

DROP FUNCTION IF EXISTS public.coupon_revert_on_full_refund(pg_catalog.uuid);

-- 🔴 事後斷言:**問「它現在還在不在」, 不問「rc 是多少」。**
DO $rb$
BEGIN
  IF pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '回捲 fail-closed:DROP 跑完了而那支函式還在';
  END IF;
  -- 🟢 負對照:同一把尺問一支我們知道還在的函式 ⇒ 必須非 NULL, 否則它是恆 NULL 的假綠。
  IF pg_catalog.to_regprocedure('public.pcm_order_refundable_remaining(pg_catalog.uuid)') IS NULL THEN
    RAISE EXCEPTION '回捲 自檢:負對照失敗 —— 這把尺對什麼都回 NULL ⇒ 上面那句證不到任何事';
  END IF;
END $rb$;

COMMIT;
