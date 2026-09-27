-- 20260928010000-rollback.sql —— 撤掉「重新叫車」(計畫 ~/pcm-mailbox/計畫-後台出貨流程乙-20260927.md 第六節)
--
-- 🔴 順序:先撤程式(revert 用到重新叫車的那幾片、推 dev), 確認沒有正在跑的重新叫車, 再貼本檔。
-- 🔴 只刪兩支新函式。刻意【不動】的:
--   · shipment_hct_dispatch_attempts 這張表與它的觸發器 —— 裡面是已經發生過的叫車紀錄, 保留。
--   · admin_claim_hct_dispatch 補上的「還沒出貨」—— 退掉會把 Codex R1 抓到的漏洞放回去, 保留。
--   · 不對 admin_claim_hct_dispatch 做 DROP(DROP 重建會掉權限)。
-- 已經叫過的車、已經標記的出貨、已經寄出的信, 本檔都不會收回。

BEGIN;

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.shipment_hct_dispatch_attempts') IS NULL THEN
    RAISE EXCEPTION '前置閘:shipment_hct_dispatch_attempts 不存在 ⇒ 20260928010000 沒貼過, 不需要退';
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.admin_claim_hct_redispatch(text, text, integer, text);
DROP FUNCTION IF EXISTS public.admin_record_hct_redispatch(uuid, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_claim_hct_redispatch(text,text,integer,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_record_hct_redispatch(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION '後置閘:新函式還在';
  END IF;
  IF pg_catalog.to_regclass('public.shipment_hct_dispatch_attempts') IS NULL THEN
    RAISE EXCEPTION '後置閘:紀錄表不見了(不該刪)';
  END IF;
  RAISE NOTICE '✅ 20260928010000 退回完成(紀錄表與「還沒出貨」條件保留)';
END
$post$;

COMMIT;
