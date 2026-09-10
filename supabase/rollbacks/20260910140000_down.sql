-- 回退 20260910140000_m4b_503_shipment_recipient_name_not_blank.sql
-- `#503` 丙 —— 拿掉「收件人姓名不得空白」那條 CHECK。
--
-- 🔵 **退回去的後果**:DB 那一層不再守姓名 ⇒ 回到應用層兩處單獨守
--    (`shipment-dialog.tsx:267` + `shipment-actions.ts:164`,兩處叫同一支 `recipient.ts`)。
--    ⇒ 📌 **繞過應用層的寫入路徑(未來的 RPC / 手動 SQL / 別的窗)又沒有東西會紅。**
-- 🛑 **而它【不會】讓任何一列資料改變** —— forward 不 UPDATE 舊列,本檔也不會。
--    純新增約束 / 純移除約束 ⇒ 退完之後與貼之前**逐位元組相同**。
--
-- ══ 🔴 為什麼本支【不釘 md5】,而 `20260910090000_down` 釘 ═══════════════════
--    那一支的判準逐字:「**判準不是『rollback 能不能釘 md5』,是『這一發【蓋掉】什麼』**
--    —— 蓋掉本體的,就必須先確認本體是它認得的那一版。」
--    ⇒ 🎯 **本支【什麼本體都不蓋】** —— 它只 DROP 一條約束,而那條約束是 forward 自己加的。
--      拿 `pcm_b2_is_blank` 的 md5 當閘會是**用一個無關的東西擋住逃生門**(那正是那份檔
--      在 GRANT 那一支上記下的反例)。
--
-- ══ ✅ 而本支仍然有一道閘:它要確認自己 DROP 的是【它自己加的那一條】═════════
--    有人可能把同名約束換成別的定義(例:順手把 phone / line 一起收嚴)。
--    ⇒ 那樣的話本支【拒絕】,而訊息叫人先去看那是誰改的。
--    📌 **拒絕比亂 DROP 安全** —— DROP 掉別人的守門是靜悄悄的,而拒絕只是要人多做一步。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $gate$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'shipments'
     AND con.conname = 'shipments_recipient_name_not_blank';

  -- 🔵 不在 ⇒ 已經退過了。這是冪等,不是失敗。
  IF v_def IS NULL THEN
    RAISE NOTICE '約束 shipments_recipient_name_not_blank 不存在 ⇒ 已經退過了, 本支不做事。';
    RETURN;
  END IF;

  -- 🔴🔴 **肯定式全等,不是「含某些字串」**(2026-09-10 codex 唯讀審 must-fix)。
  --    ⛔ ~~第一版:四個 strpos(要有 pcm_b2_is_blank / name, 不可有 phone / line)~~
  --    🔴 codex 的反例逐字:別人若把它**加強**成
  --         `CHECK (NOT pcm_b2_is_blank(...->>'name') AND char_length(...->>'name') >= 2)`
  --       ⇒ **四個 strpos 全部放行 ⇒ 本支直接 DROP ⇒ 那條額外的姓名長度限制一起消失。**
  --    📌 **而那正是這一支存在的理由**:不要讓這支檔靜悄悄地把別人的守門拿掉。
  --    ⚠️ 而 ⑩ 那一格的驗證原本抓不到它 —— 我造的反例是「含 phone」那一種,
  --       而「只加強 name」那一種**四個 strpos 都綠**。⇒ 一個反例只證得了它打到的那一格。
  IF v_def <> 'CHECK ((NOT pcm_b2_is_blank((recipient_snapshot ->> ''name''::text))))' THEN
    RAISE EXCEPTION
      '前置閘:同名約束存在, 而它的定義【不是】20260910140000 加的那一條(逐字全等比對)⇒ 本支拒絕 DROP。'
      ' 現行定義:%  ⇒ 先查是誰換掉它的。'
      ' 📌 它可能是【被加強過】而不是被換掉 —— 那更不該由這支檔拿掉。',
      v_def;
  END IF;

  EXECUTE 'ALTER TABLE public.shipments DROP CONSTRAINT shipments_recipient_name_not_blank';
END
$gate$;

-- ══ 斷言:真的沒了 ═════════════════════════════════════════════════════════
DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'shipments'
       AND con.conname = 'shipments_recipient_name_not_blank'
  ) THEN
    RAISE EXCEPTION '斷言失敗:約束還在 ⇒ DROP 沒有生效。';
  END IF;

  -- 🟢 正對照:同一把尺要找得到【別的】約束 —— 否則「找不到」可能是尺壞了不是真的沒了。
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'shipments'
       AND con.conname = 'shipments_recipient_snapshot_shape'
  ) THEN
    RAISE EXCEPTION '正對照失敗:連 shipments_recipient_snapshot_shape 都找不到 ⇒ 這把尺讀不到東西, 上面那個「沒了」不算數。';
  END IF;
END
$assert$;

COMMIT;
