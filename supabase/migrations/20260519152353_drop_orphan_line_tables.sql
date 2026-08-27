-- ============================================================
-- A 庫 line_* 清理:DROP 5 張孤兒 line_* 表
-- ============================================================
-- 背景:
--   LINE bot(原 pcm-line-bot)曾與官網共用本 Supabase 專案(A 庫、
--   ref bmpnplmnldofgaohnaok)、借住 5 張 line_* 表。2026-05-19 LINE bot
--   已併入 pcm-quote-v2、line_* 結構與資料已複製至 pcm-quote-v2 的 Supabase
--   (ref dllwkkfanaebrsuyuedy)。A 庫 這 5 張表自此為孤兒表(含客戶個資、
--   官網從不使用)。
--
-- 安全驗證(2026-05-19 實測 A 庫):
--   - line_* 與官網表(products / brands / categories)零 FK、零交叉相依
--   - line_* 唯一 FK 為內部:line_messages.conversation_id → line_conversations
--   - 無任何非 line_* 物件(view 等)相依於 line_*
--   → DROP ... CASCADE 只影響 line_* 內部、碰不到官網任何物件
--
-- DROP 採 schema-qualified + 預設 RESTRICT(對齊 Codex review P1):
--   不用 CASCADE —— 既已查無外部相依,RESTRICT 可讓任何漏查的相依物件
--   直接擋下報錯,而非被 CASCADE 靜默掃掉。
-- DROP 順序:先 line_messages(FK 指向 line_conversations)、line_conversations 最後;
--   RESTRICT 下此順序為必要(line_messages 的 FK 須先隨表移除)。
--
-- 對齊:docs/SUPABASE-LINE-BOT-MOVED.md、docs/phase-1-backlog.md #149、Codex review
--
-- 注意:migration ledger 內 7 筆孤兒 line_* 版本紀錄之清除為本 slice 另一步驟
--   (見 slice plan / Codex Review Packet),不在本 migration body 內。
--
-- Rollback(僅供參考、勿執行;Supabase migration 為 forward-only):
--   line_* 表的權威副本在 pcm-quote-v2 的 Supabase;若需還原 A 庫,
--   從 pcm-quote-v2 或 DROP 前的本地備份 dump 重建。
-- ============================================================

DROP TABLE IF EXISTS public.line_messages;
DROP TABLE IF EXISTS public.line_pending_reply;
DROP TABLE IF EXISTS public.line_faq;
DROP TABLE IF EXISTS public.line_settings;
DROP TABLE IF EXISTS public.line_conversations;
