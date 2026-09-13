-- 20260913020000-rollback.sql —— 退回 20260913020000_m4b_order_notes_soft_delete.sql
--
-- 🔴🔴 **這一份分成兩段,而它們的可逆程度【不一樣】。跑之前先讀懂你要哪一段。**
--    plan `docs/plans/2026-09-13-order-notes-edit-delete-plan.md` §7.2 逐字寫過這件事。
--
-- ── §A 完整退回(DROP 函式)—— 預設就跑這一段 ──────────────────────────────
--    🔵 **先確認沒有呼叫端**:
--        grep -rn "admin_soft_delete_order_note" apps packages
--      期望 0(測試檔裡的命中要逐一開檔判,不能只看數字)。
--      有呼叫端還 DROP ⇒ 後台按刪除會炸在 RPC 不存在。
--
-- ── §B 只放寬「理由必填」(Sean 若改答選填)——**不是退版,是改規格** ─────────
--    只跑 §B 那一段(**DROP + ADD 兩句,不是一句**),函式與欄位都留著。
--    🔴 只 DROP 不 ADD 會讓 `(deleted_at, NULL, NULL)` 變合法 = 一筆查不到責任的刪除。
--    (必填是主視窗 2026-09-13 裁的暫定值,Sean 本人尚未答;檔頭記著「必填會製造假理由」那個副作用。)
--
-- ── 🛑 §C 三個欄位【不 DROP】,而這不是懶 ────────────────────────────────
--    退版時若已經有列被軟刪過,`DROP COLUMN` 會**真的刪掉「誰在何時為什麼把它收起來」這份紀錄**
--    —— 那正是軟刪除當初要保住的東西。
--    ⇒ 退版 = 停用寫入路徑(§A)+ 讀取端當它不存在,**欄位留著**。
--    ⚠️ 已知後果,要先告訴執行的人:退版之後那幾則**會重新出現在時間軸上**(因為讀取端不再看 deleted_at)。
--       那是退版的預期結果,不是 bug。
--    🔵 真的非 DROP 不可(例如整個功能廢棄)⇒ 先把那些列另存一份再說,而那是另一次有人簽名的動作。
--
-- 🛑 **已經寫下的稽核列不刪** —— append-only;那些列記的是真的發生過的事。本檔零 DELETE。
--
-- ── 🔴 §D 跑完 §A 之後【要再上線】不能重貼 forward 檔(Fable 2026-09-13 審 consider 4)──
--    forward 的前置閘② 看到三欄還在就 RAISE「本支貼過了, 不要重貼」——
--    而那時**函式已經不在了**,所以那句話是**假的**:真正的狀態是「欄在、函式不在」。
--    📌 一個把兩種世界印成同一句話的閘, 會讓下一個人以為不必做事。
--    ⇒ 要 roll-forward:另寫一支 **function-only** 的 migration(只 `CREATE FUNCTION` + REVOKE/GRANT +
--      事後閘③④⑤),**不要**把 forward 檔再貼一次、也不要為了讓它過而去 DROP 那三欄
--      (DROP 欄 = §C 明文禁止的那件事)。

-- ══ §A 完整退回 ════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_soft_delete_order_note(uuid,uuid,text,text,text);

COMMIT;

-- ══ §B 只放寬「理由必填」(要跑就把下面這段的註解拿掉;與 §A 互不相干)═══════
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- -- 放寬成「有刪除就要有人,理由可空」:同生同滅只留 deleted_at / deleted_by 兩欄。
-- ALTER TABLE public.order_notes DROP CONSTRAINT order_notes_deleted_triple_together;
-- ALTER TABLE public.order_notes
--   ADD CONSTRAINT order_notes_deleted_triple_together CHECK (
--     (deleted_at IS NULL AND deleted_by IS NULL)
--     OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
--   );
-- -- 🔴 `order_notes_deleted_reason_shape` **留著** —— 它管的是「有寫的話不可以是全空白、不可以超過 500」,
-- --    那一條在選填的世界仍然成立。拿掉它等於連「亂填一堆空白」都收。
-- COMMIT;
-- 🔴 跑完 §B 還要改碼:RPC 的 `INVALID_REASON` 那一格與呼叫端那張碼表(否則 DB 收了而應用層照樣擋)。
