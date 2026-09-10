-- rollback of supabase/migrations/20260908090000_m4b_fitsync1_get_fitment_sync_freshness.sql
-- ⟦b4-FITSYNC1⟧③ 車款同步新鮮度 RPC。
--
-- 🔵 **2026-09-10 主視窗裁:那支 migration 原樣貼。**
--    族內兩種慣例並存(`20260906620000` 只授 payment_confirmer ·
--    `20260905060000:206-208` 授 service_role + payment_confirmer, 並逐字寫「service_role 保留 ——
--    它是平台角色, 而拿掉它不是本片的範圍」)⇒ **通則另議, 已端 Sean。本片不改那支草稿一個字。**
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **收回的順序與貼的順序【相反】。反了會每天噴一次。**
--
--    貼:① 貼 migration ⇒ ② 把 `route.ts:420` 的 `null` 換成 `'get_fitment_sync_freshness'`
--    收:① **先**把 `route.ts:420` 改回 `fitmentFreshnessRpcName: null` 並**部署完成**
--        ② **再**跑本檔
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🛑 為什麼順序不能反:route 一旦帶著那個名字, 每天 01:00 UTC 會去叫它。
--    函式先被 DROP 而 app 還指著它 ⇒ 每天一發 `42883 undefined_function`。
--    🔴 **[codex R1 nit① 訂正]** ⛔ ~~它不會炸, 它會每天安靜地多一格未知~~
--    ⇒ 實際是 `fitmentUnknown = true` ⇒ **記一次失敗心跳 + 回 503 + 那天的正常心跳信不寄**。
--    ⇒ 📌 **我原本把一個【會叫的】失敗寫成【安靜的】失敗 —— 那個方向的錯
--       會讓下一個人以為次序搞錯了也沒關係。**
--
-- 🔴 **而「部署完成」的定義要收窄(codex R1 ⑤)**:不是「我改了檔」也不是「另一個站部署好了」,
--    是 **① cron 實際命中的那個部署已經帶著 `null`** 且 **② 正在跑的舊版請求都結束了**。
--    ⇒ 舊請求可能還沒走到那一發 RPC 查詢, 而函式在它走到之前被 DROP 掉。
--
-- 🟢 本檔只 DROP 函式, **不碰 `public.product_fitments_effective_sync_log`**
--    —— 那張表是資料來源, 不是那支 migration 建的。

BEGIN;

DO $gate$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_fitment_sync_freshness()') IS NULL THEN
    RAISE NOTICE 'rollback:函式本來就不在 ⇒ 本發是 no-op(這【不是】失敗)。';
  END IF;
END
$gate$;

DROP FUNCTION IF EXISTS public.get_fitment_sync_freshness();

DO $assert$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_fitment_sync_freshness()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 斷言:DROP 之後它還在 ⇒ 拒繼續';
  END IF;
  RAISE NOTICE 'rollback ✅ 函式已移除。🔴 而請先確認 route.ts:420 已改回 null 並部署過 —— 否則從現在起每天一發 42883。';
END
$assert$;

COMMIT;

-- ⚠️ 本檔答不出什麼:
--   · 它**證不到 app 那一側已經改回 null** —— 那是部署狀態, DB 看不到。
--     🛑 上面那句 NOTICE 是**提醒**, 不是**閘**。要它變成閘只有一條路:
--        跑之前有人去讀 `route.ts:420` 的當下值, 而那不是 SQL 做得到的事。
--   · 它不還原任何資料 —— 那支函式是唯讀的, 沒有寫入可還原。
