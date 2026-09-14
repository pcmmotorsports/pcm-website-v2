-- 20260914100000-rollback.sql —— 退回 20260914100000_m4b_pcm_incident_kind_add_line_forward_failed.sql
--
-- 🔴 pcm_incident 若已有 line_forward_failed 的列 ⇒ CHECK 縮不回去 ⇒ 拒退(先處理那些列, 而那是另一次有人簽名的動作)。
-- ⚠️ 退回後 www 那支 route 呼叫窄門會拿到 42883 ⇒ 轉發失敗只剩 console.error(route 已吞、不影響回 LINE 的 200)。

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.pcm_incident IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  v_def text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.pcm_incident WHERE kind = 'line_forward_failed') THEN
    RAISE EXCEPTION '退回前置閘一:pcm_incident 已有 line_forward_failed 的列 ⇒ CHECK 縮不回去, 先處理那些列';
  END IF;
  -- 🔴 codex R1 must-fix:CHECK 必須逐字 = 本片貼完那一代(五種);更晚的 migration 若又加了 kind, 本檔縮回四種會砍掉它 ⇒ 拒退。
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''pending_refund_open_failed''::text, ''refund_over_total''::text, ''auto_cancel_skipped''::text, ''auto_cancel_failed''::text, ''line_forward_failed''::text])))' THEN
    RAISE EXCEPTION USING MESSAGE = '退回前置閘二:CHECK 不是 20260914100000 那一代逐字(實得 ' || COALESCE(v_def, '<null>') || ')⇒ 不是本檔知道怎麼退的版本';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.pcm_incident_log_line_forward_failed(text);

ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
  CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed'));

COMMIT;
