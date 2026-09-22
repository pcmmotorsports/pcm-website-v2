-- 20260922110000 回滾:DROP get_webhook_manual_review_health()。函式只讀不寫, 刪除不影響任何資料。
-- 🔴 順序 = 先 revert 程式(告警器那一段 + 後台首頁那一行)再跑本檔;
--    反過來的話告警器會落 Unknown(不會失敗), 後台那一行會顯示「無法載入」。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_webhook_manual_review_health()') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:get_webhook_manual_review_health 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP FUNCTION public.get_webhook_manual_review_health();
COMMIT;
