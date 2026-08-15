-- ============================================================
-- M-4b `#20` 片2a:`products` 加兩欄 —— `listing_set_by` / `source_missing_at`
-- ============================================================
-- 規格權威 = `docs/specs/2026-08-15-products-manual-listing-override-plan.md` **v5**
--            (§2 反向盤點 / §2a 欄位角色 / §2b 變體層例外 / §3 片界 / §4 驗收 / §7 誠實缺口)
-- 拍板:Sean 2026-08-15 —— `Q-B-1=甲`(鎖做在我們這側)/ `Q-B-2=甲`(把自動下架關掉、改成只標記)/
--       `Q-B-資料=乙`(加「誰設的」欄)/ `Q1=甲`(多存「來源消失」欄)/ `Q3=乙`(員工寫入入口在下一片)/
--       `Q-關哪一條=乙`(W1 鏡射與 W2 對賬**兩條都關**)/ `Q-空窗=甲`(接受空窗期)。
-- 關卡1:codex R1 = FAIL(30 條,篩 8 條已折)、R2 = 3 條已折、主視窗自核 PASS。
--
-- ── 這支做什麼 ─────────────────────────────────────────────────────────────
-- 只加兩個欄位,**不改任何既有欄、不改 RLS、不改任何函式**。
-- 行為改變全部在片2b 的 TypeScript(`rpm-transform` / `rpm-reconcile` / `rpm-import`),不在這支。
--
-- 🔴 **這支不改變任何「同步下架的業務行為」** —— apply 完,同步仍照舊下架、畫面仍照舊顯示。
--    **如果 apply 後上下架行為變了,那是異常,不是預期**(照 `project_484a-view-pending-sean-apply`)。
-- ⚠️ **但這句不是全稱句(關卡2 R2 nit)**:加欄本身當然會改變一些東西 ——
--    `SELECT *` 與 PostgREST 的 payload 會多兩欄,新插入的列會拿到預設值 `sync`。
--    **講「完全沒有任何變化」是過強的字面,不要那樣寫。**
--
-- ── 🔴 為什麼「業務規則」要進 COLUMN COMMENT 而不只是留在 plan ─────────────────
-- `information_schema` 查得到欄位型別,查不到「這一欄代表什麼、不代表什麼」。
-- 而下一個接手的人多半是先看資料庫、後看文件(甚至不看文件)。
-- 特別是 `source_missing_at`:**它最容易被誤讀成「已停產 ⇒ 不能賣」,而 Sean 的規則正好相反。**
-- 誤讀的後果是有人把它接到「自動下架」上,那會把本片整個做的事推翻。
-- ============================================================

-- ── 🔴 鎖等待 fail-fast(關卡2 R1 F1)────────────────────────────────────────
-- `ALTER TABLE` 必然取 ACCESS EXCLUSIVE。**風險不在持鎖多久,在「等鎖」等多久** ——
-- 若正好有長交易壓著 `products`,這支會**無限等待**,而它後面排隊的讀寫會一起卡住。
-- ⚠️ 那是 **Sean 親手 apply 的那一刻** —— 卡住時他只會看到終端機不動,而網站在後面排隊。
-- ⇒ 等不到就**快速失敗、讓他重跑**,不要把站卡在那裡。
--
-- 🔴 **用 `SET LOCAL` 而不是 `SET`(關卡2 R2 must-fix)**:`SET` 是 session 級 ——
--    若 migration runner 重用連線(或本支因 timeout 失敗),**那 5 秒限制會外洩給後續 migration**,
--    造成別人身上莫名其妙的失敗。`SET LOCAL` 綁在交易上,`COMMIT`/`ROLLBACK` 後自動還原。
--    ⇒ 因此本支**自己包一層 `BEGIN; … COMMIT;`**(`SET LOCAL` 在交易外只會發 WARNING、不生效)。
--    **照本 repo 慣例**,逐字同 `20260814190000_m4b_e10_473b1_refund_manual_corrections.sql:42-48`。
BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 為什麼保留 inline CHECK,而不是 NOT VALID 兩段式 ────────────────────────
-- codex 指出 inline CHECK 會驗證既有列。**我實測確認它是對的**(拋棄式 PG 17.10、200,000 列、
-- 用 `pg_stat_user_tables.seq_scan` 計數,不是用計時 —— 計時在這個量級沒有鑑別力):
--     ADD COLUMN + DEFAULT(無 CHECK)      → seq_scan +0   ← 負向對照
--     ADD COLUMN + DEFAULT + inline CHECK  → seq_scan +1   ← 掃了
--     ADD COLUMN 後另掛 CONSTRAINT NOT VALID → seq_scan +0   ← 確實可避開
-- **仍然保留 inline CHECK**,理由:本表 20,334 列,那次掃描是毫秒級;
-- 而 `NOT VALID` 要拆成「ADD COLUMN → ADD CONSTRAINT NOT VALID → VALIDATE CONSTRAINT」三步、
-- 多一個「約束存在但沒驗過」的中間狀態要有人記得收尾。**這個規模不值得。**
-- 🔴 **真正的風險是「等鎖」,那由上面的 `lock_timeout` 處理,與 CHECK 用哪種寫法無關。**
-- ⇒ **改判門檻**:若本表成長到百萬列以上、或 apply 時實測這支超過 1 秒,**改走 NOT VALID 兩段式**。
-- (附:`ADD COLUMN ... CHECK (...) NOT VALID` 是**語法錯誤**,實測過 —— `NOT VALID` 只能掛在
--  `ADD CONSTRAINT` 上,所以那條路一定是兩段式,不是把 NOT VALID 加在原句尾。)

ALTER TABLE public.products
  ADD COLUMN listing_set_by text NOT NULL DEFAULT 'sync'
    CHECK (listing_set_by IN ('sync', 'staff')),
  ADD COLUMN source_missing_at timestamptz;

COMMENT ON COLUMN public.products.listing_set_by IS
  '這一列目前的上下架狀態(delisted_at)是誰決定的。sync=每日同步管線;staff=後台員工手動設定。'
  '⚠️ **時序**:同步管線「完全不寫 delisted_at」是**片2b 部署後**才生效;**本支單獨 apply 不改變任何行為**。'
  '本欄為顯示用、**不承載正確性**,不要拿它當任何守門條件。'
  '寫入 staff 的後台入口在後續片,在那之前本欄實際只會有 sync 一個值。'
  '⚠️ 日後若要新增合法來源(例如 admin / import),**現有 CHECK 會讓那些寫入直接失敗** ⇒ 需另開 migration 改 CHECK。'
  '本片明示推翻合約 §10「下架權威=來源側單一裁判」(原文 docs/phase-1-backlog.md:5562)。';

COMMENT ON COLUMN public.products.source_missing_at IS
  '來源(報價單 view)第一次不再吐這筆的時間;來源重新出現時清回 NULL。'
  '⚠️ **時序**:**片2b 部署後**才由 rpm-reconcile 開始維護;**本支單獨 apply 不會填任何值**,全表維持 NULL。'
  '🔴 這一欄只描述「來源端還有沒有這筆」,**不代表能不能賣** —— 員工可能有現貨仍要繼續賣'
  '(Sean 2026-08-15 逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」)。'
  '⚠️ 因此本欄**不得**被接到任何自動下架 / 自動隱藏邏輯上,那會推翻 #20 片2 整片的目的。'
  '畫面文案用「原廠已無此品」,**不得寫成「已停產」**(會讓員工以為不能賣)。'
  '2026-08-15 #20 片2 加入,取代 rpm-reconcile 原本直接寫 delisted_at 的行為。';

-- ── 既有資料 ────────────────────────────────────────────────────────────────
-- `listing_set_by` NOT NULL DEFAULT 'sync' ⇒ 既有 20,334 列全部視為「自動」,**不需回填**。
-- 🔴 **這句的前提是 PG 11+ 的「常數 DEFAULT 不重寫表」**。我實測的是 **PostgreSQL 17.10**,
--    **而正式庫是哪一版我沒查過** —— apply 前值得跑一次 `SELECT version();` 確認 ≥ 11。
--    (Supabase 現行皆 ≥ 15,但**「應該是」不是來源**,所以寫成待確認。)
-- `source_missing_at` 可為 NULL ⇒ 既有列全部 NULL。
-- 🔴 **正式庫現有 560 筆 delisted_at 非空的商品,不會被追認成「原廠已無此品」** ——
--    系統從來沒記過那 560 筆是誰下架的,**分不出來,也分不回來**(plan §7-1;Sean 已決定不撈清單)。
--    ⇒ 本片的效果**從 apply 那天起算**,不能回頭盤。

-- ── rollback ────────────────────────────────────────────────────────────────
-- `scripts/20260815030000-down.sql`(同 commit)。**不是「刪檔就好」**:
--   1. 🔴 `source_missing_at` 是只存在於我方、來源端**重建不回來**的資料;
--   2. 🔴 **必須先退應用層(片2b/2c 的 code)才能 drop 欄位** —— 反過來做會讓 repository 的
--      select projection 指向不存在的欄 ⇒ PostgREST 回錯 ⇒ **商品後台整頁掛掉**;
--   3. rollback **不會**自動恢復同步的下架能力(那由片2b 的 code 決定,要連它一起 revert);
--   4. 🔴 `listing_set_by` 的 `'staff'` 標記同樣**永久遺失**、且沒有第二個地方記過 ——
--      down 腳本 §2b 附了「先撈出來存檔」的 SQL。

COMMIT;
