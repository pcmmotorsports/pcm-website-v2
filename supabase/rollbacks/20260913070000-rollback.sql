-- 20260913070000-rollback.sql —— 退回 20260913070000_m4b_fx_rates.sql
--
-- 🔴 先確認沒有呼叫端:
--     grep -rn "admin_fx_rate_set\|fx_rates" apps packages
--   有呼叫端還 DROP ⇒ 後台「設定 › 匯率」頁會炸。
-- 🔴 DROP TABLE 會連匯率歷史一起丟(稽核列只有 before/after 摘要,不等於原表)。
--    `SELECT count(*) FROM public.fx_rates` = 0 才直接退;有列 ⇒ 先另存一份再退,而那是另一次有人簽名的動作。
--    「零消費端」只代表訂單數字不會變,不代表那些列不值錢。
-- 🛑 已寫下的 admin_audit_log 列(action = settings.fx.set)不刪 —— append-only。本檔零 DELETE。

BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_fx_rate_set(text,text,numeric,timestamptz,text);
DROP TABLE IF EXISTS public.fx_rates;
DROP FUNCTION IF EXISTS public.pcm_fx_rates_append_only();
COMMIT;
