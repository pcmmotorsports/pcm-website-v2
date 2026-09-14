-- ⟦ship-HCTLABEL⟧ 重取標籤窄門 回滾:DROP 窄門函式 + 蓋章 trigger / 函式 + hct_submitted_at 欄。
-- 換過的 hct_raw_response 留著(那是新竹真的回過的東西);hct_submitted_at 是本支才加的欄, 丟掉不傷既有資料。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_record_hct_label_raw(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:admin_record_hct_label_raw 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP FUNCTION public.admin_record_hct_label_raw(text,text,jsonb);
DROP TRIGGER IF EXISTS shipments_hct_submitted_at_stamp_bu ON public.shipments;
DROP FUNCTION IF EXISTS public.pcm_b2_shipments_hct_submitted_at_stamp();
ALTER TABLE public.shipments DROP COLUMN IF EXISTS hct_submitted_at;
COMMIT;
