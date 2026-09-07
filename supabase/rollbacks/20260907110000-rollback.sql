-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 災難還原:**只有在 80 貼下去之後、決定要把那道讓路收回時才跑。**
-- 🛑 它做的事只有一件:**把那一句 `IF` 的條件改回去**(補登列超額 ⇒ 恢復成擋)。
--    它【不動】任何一列帳, 也不動 79 那支補登 RPC。
-- ⚠️ 收回之後:**補登一筆超過可退餘額的款會再度被 `PCM04` 擋下** ——
--    而那正是 Sean 2026-09-07 q33 甲說的「擋 = 從帳上消失」。收回前想清楚。
-- ══════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;
DO $undo$
DECLARE v_def text; v_hits integer;
  v_new text := 'IF NEW.refund_amount > v_cap AND NEW.backfilled_source IS NULL THEN';
  v_old text := 'IF NEW.refund_amount > v_cap THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_refund_cap_guard';
  v_hits := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_new, '')))
            / pg_catalog.length(v_new);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '80r:讓路那一句在定義裡命中 % 次(期望恰 1)⇒ 拒改', v_hits;
  END IF;
  EXECUTE pg_catalog.replace(v_def, v_new, v_old);
END
$undo$;

\echo '--- 回核:讓路不在了 = f, 而六個特徵仍全在 = 6 ---'
SELECT (prosrc LIKE '%NEW.backfilled_source IS NULL%') AS letpass_should_be_f
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='pcm_order_refund_cap_guard';
SELECT count(*) AS features_should_be_6
  FROM unnest(ARRAY['PCM04','PCM05','PCM06','PCM07','FOR NO KEY UPDATE','transaction_isolation']) AS c
 WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname='pcm_order_refund_cap_guard'
                  AND p.prosrc LIKE '%'||c||'%');
\echo '🔴 兩項對得上才 COMMIT;對不上打 ROLLBACK;(本檔【不】自動 COMMIT)'
