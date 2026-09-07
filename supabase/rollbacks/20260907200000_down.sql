-- 還原 · ⟦b9-REFUNDNUM1⟧ `20260907200000_m4b_b9_pending_manual_verdict_amount.sql`
--
-- 🔵 **這一支為什麼便宜**:那支 migration 只【新建】一個唯讀函式 ——
--    零 DML、零 schema 變更、不動任何既有物件 ⇒ **丟掉它就回到貼之前。**
-- 🛑 **而它不是「什麼都不用想」**:
--    · `DROP` 之前先確認**只有一支**(多載時 `DROP FUNCTION <名>` 會因為歧義而失敗, 那是好事)。
--    · 具名簽章 `(uuid)` **不可省** —— ⛔ ~~省了就變成「把叫這個名字的都丟掉」~~
--      🔴 **那句是錯的**(codex 2026-09-07 訂正, 附官方 `DROP FUNCTION` 規則):
--      省略簽章時, **多載 ⇒ 因為名稱不唯一而【失敗】**(不是全刪);**唯一 ⇒ 才刪掉那一支**。
--      ✅ **具名 DROP 仍然是對的做法**, 只是理由要改成「**讓它指名道姓, 不依賴當下只有一支**」。
-- ⚠️ 跑之前先看:有沒有呼叫端還在用它(前端片若已上線, 先退前端再退這支)。

BEGIN;

DO $r0$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_pending_manual_verdict_amount';
  IF v_n = 0 THEN
    RAISE EXCEPTION '還原:那支函式不在 ⇒ 已經退過了, 或從來沒貼成 —— 停下來看一眼, 不要當成成功';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION '還原:找到 %支同名函式 ⇒ 有人加了多載, 停下人工判斷要丟哪一支', v_n;
  END IF;
END
$r0$;

DROP FUNCTION public.pcm_order_pending_manual_verdict_amount(uuid);

-- 事後斷言:真的不在了(而「本來就不在」在上面那道閘已經被擋掉)
DO $r1$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_pending_manual_verdict_amount';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '還原事後閘:丟完還有 %支', v_n;
  END IF;
  RAISE NOTICE '還原過:pcm_order_pending_manual_verdict_amount 已移除。';
END
$r1$;

COMMIT;
