-- 20260912030000-rollback.sql —— 退回 20260912030000_m4b_legal_terms_v6_copy_rewrite.sql
--
-- 退回之後 = legal_terms_versions 少掉 '2026-09-13' 那一列(最新回到 '2026-09-12')。
-- 🔴 只在兩件事都成立時可跑:
--   ① 應用層常數還沒 bump 到 '2026-09-13'(或已經退回 '2026-09-12' 並部署完)——
--      否則每筆結帳 FK 違反。
--   ② 沒有任何訂單簽過 '2026-09-13' —— 有人簽過 ⇒ 那一列是他同意紀錄的根據,不可刪;
--      下面 DO 區塊會 RAISE(FK 也會擋,這裡先講清楚為什麼)。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_signed bigint;
BEGIN
  SELECT count(*) INTO v_signed FROM public.order_legal_consents WHERE terms_version = '2026-09-13';
  IF v_signed > 0 THEN
    RAISE EXCEPTION
      '20260912030000 rollback:已有 % 筆訂單簽過 2026-09-13 —— 不可刪,改用新版本鍵往前修', v_signed;
  END IF;
END $$;

DELETE FROM public.legal_terms_versions WHERE version = '2026-09-13';

COMMIT;
