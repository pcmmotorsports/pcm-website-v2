-- 20261001130000 回滾:撤掉 pcm-new-product-drafts 這一支排程, 其他 job 不動。
-- 只撤排程;要立刻停, 先在 Vercel 拿掉 NEW_PRODUCT_DRAFTS_ENABLED 並重新部署。
-- 🔴 正式回滾要另開一支 migration(內容同本檔), 程式同一顆拿掉白名單那列並讓閘與測試認得 unschedule(見 migration 檔頭「回滾」)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_cnt int; v_before int;
BEGIN
  SELECT count(*) INTO v_cnt FROM cron.job WHERE jobname = 'pcm-new-product-drafts';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘:pcm-new-product-drafts 應該剛好 1 支, 實際 % 支 ⇒ 沒貼過或已經撤過, 停下', v_cnt;
  END IF;
  SELECT count(*) INTO v_before FROM cron.job WHERE jobname IS DISTINCT FROM 'pcm-new-product-drafts';
  PERFORM cron.unschedule('pcm-new-product-drafts');
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-new-product-drafts') THEN
    RAISE EXCEPTION '後置閘:pcm-new-product-drafts 沒有撤掉';
  END IF;
  IF (SELECT count(*) FROM cron.job) <> v_before THEN
    RAISE EXCEPTION '後置閘:其他 job 的數量變了(應為 %)', v_before;
  END IF;
  RAISE NOTICE '[20261001130000 回滾] pcm-new-product-drafts 已撤, 其他 % 支 job 不動', v_before;
END $$;

COMMIT;
