-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback:20260905290000_m4b_pending_refund_open_failure_incident
-- ═══════════════════════════════════════════════════════════════════════════
-- 🛑 **不可整段跑**(§0 是可執行的攔截器, 會 RAISE)。
--    這一片動了兩種東西, 而它們的還原代價完全不同:
--    ① 新建的表與兩支函式 ⇒ 刪掉是可逆的(而**表裡的列會一起沒了**)
--    ② `pcm_noncard_settle_recompute` 是 **CREATE OR REPLACE 整支覆蓋** ⇒
--       🔴 **還原它 = 再貼一次 20260905070000 那一代的完整本體**, 不是刪掉什麼東西。
--       ⇒ 📌 **沒有「REVOKE 一下就回去了」這種形狀** —— 這是本檔最容易被誤讀的一格。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §0 攔截器(可執行)──────────────────────────────────────────────────
DO $$
BEGIN
  RAISE EXCEPTION '20260905290000 的 rollback 不可自動執行。函式那一半要【重貼 20260905070000 的完整本體】(不是刪東西), 而表那一半會連同已寫入的事故列一起消失。讀完 §R 每一行再手動改註解狀態。';
END $$;

-- ── §R 還原(全部註解)──────────────────────────────────────────────────
--
-- 【第一步 · 函式】把 `pcm_noncard_settle_recompute` 貼回 20260905070000 那一代:
--   ⇒ 直接執行 `supabase/migrations/20260905070000_m4b_pending_refund_on_late_payment.sql`
--     裡 `CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute` 那一整段
--     (該檔 :314 起, 到 `$fn$;` 為止)。
--   🔴 **驗法**:貼完之後 `md5(prosrc)` 必須回到 `8353cf70f0121ea3d361ee2d5031dba5`
--      —— 那是 2026-09-05 從正式庫量到的、本片覆蓋之前的值。
--      ⇒ 📌 **拿 md5 驗, 不要用眼睛比** —— 這一片存在的理由之一就是「用眼睛比會漏」。
--   ⚠️ **順序**:先還原函式再刪表。反過來的話, 中間那段時間裡 handler 會呼叫一個
--      **不存在的函式** ⇒ 而它被內層 `EXCEPTION WHEN OTHERS` 吞掉 ⇒ 🔴 **你不會看到任何錯**。
--
-- 【第二步 · 表與函式】(⚠️ 表裡若已經有事故列, 刪掉就沒了 —— 先自己撈出來看)
-- DROP FUNCTION IF EXISTS public.get_pcm_incident_health();
-- DROP FUNCTION IF EXISTS public.pcm_incident_log(text, uuid, text);
-- DROP TABLE    IF EXISTS public.pcm_incident;
--
-- 🔵 `DROP TABLE` 會一起帶走 `pcm_incident_id_seq` 與那個部分索引 ⇒ 不必另外刪。

-- ── §V 量現況(唯讀, 零副作用)────────────────────────────────────────────
-- 🔴 codex must-fix:原版把 `(SELECT count(*) FROM public.pcm_incident)` 包在 CASE 裡,
--    以為「表不存在就走 NULL 那一支」。**那是錯的** —— `FROM public.pcm_incident` 在
--    【解析階段】就要解出那個 relation, CASE 還沒開始判就已經
--    `ERROR: relation "public.pcm_incident" does not exist`。
--    ⇒ 📌 而那正是本檔最需要它跑得動的那個世界(第二步做完之後)。
--    ⇒ 拆成兩句:第一句永遠跑得動(全部走 catalog 函式), 第二句只在表還在時才跑。

-- §V-1(永遠跑得動)
SELECT
  to_regclass('public.pcm_incident')                          IS NOT NULL AS 表在,
  to_regprocedure('public.pcm_incident_log(text, uuid, text)') IS NOT NULL AS 寫入口在,
  to_regprocedure('public.get_pcm_incident_health()')          IS NOT NULL AS 讀出口在,
  (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('public.pcm_noncard_settle_recompute(uuid)'))  AS 現行函式md5,
  '8353cf70f0121ea3d361ee2d5031dba5'                                            AS 本片覆蓋前的md5;
-- ⚠️ 讀法:`現行函式md5` 等於 `本片覆蓋前的md5` ⇒ 函式那一半**已還原**(或本片沒貼過);
--    不等於 ⇒ 現在跑的是本片這一代(或第三代)。**NULL 是問不到, 不是 false。**

-- §V-2(🔴 **只有在 §V-1 的「表在」= t 時才跑這一句**;表不在時它會報
--       relation does not exist —— 那是**預期**, 不是壞掉)
-- SELECT count(*) AS 事故列數, min(created_at) AS 最早一列 FROM public.pcm_incident;
