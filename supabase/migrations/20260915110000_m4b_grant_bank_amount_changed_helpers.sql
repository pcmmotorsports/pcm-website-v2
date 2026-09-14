-- 20260915110000_m4b_grant_bank_amount_changed_helpers.sql
-- 🔴🔴 正式站現在就在壞的:`/api/cron/email-sweep` **每一輪回 503**, 錯碼 42501(permission denied)。
-- pcm:idempotent: yes
--   理由:只有兩句 GRANT EXECUTE。重跑等冪等(已經有權限再 GRANT 一次不變動任何東西)。
--
-- ══ 病灶(唯讀量到的, 不是推的)═══════════════════════════════════════════
-- 2026-09-14 22:4x Vercel production runtime log 逐字(dpl_HH2UoUJ6…, 每 5 分鐘一次):
--   `[email-sweep] 🔴 ... enqueue 整段失敗 { reason: 'bank_order_amount_changed_enqueue_scan_throw',
--     stage: 'cancellations', code: '42501' }` ⇒ 該輪最後回 503。
-- 同時唯讀查正式庫(`scripts/readonly-prod-sql.sh`):
--   `pcm_bank_amount_changed_email_floor()`                 service_role EXECUTE = **f**
--   `pcm_bank_amount_changed_email_dedup_key(uuid,uuid)`    service_role EXECUTE = **f**
--   而 `pcm_bank_order_amount_changed_email_pending` 的 SELECT = t、它引到的其他 view 也全 t
--   ⇒ 卡的就是這兩支函式。`email_outbox` 裡 `bank_order_amount_changed` 的列 = **0**(那封信一封都沒排到過)。
--
-- ══ 🔴 成因寫清楚:一句在 PG 上不成立的話 ════════════════════════════════
-- `20260913010000_m4b_bank_order_amount_changed_pending.sql:229-234` 與 `:268-271` 逐字:
--   「🔵 唯一呼叫端是下面那張 `security_invoker = false` 的 view ⇒ 它以 owner 身分讀 ⇒ 不需要 GRANT。」
-- 🛑 **那句話對【表】成立, 對【函式】不成立。** `security_invoker = false` 只讓 view 用 owner 的身分讀**底層表**;
--    view 定義裡呼叫的**函式**, PostgreSQL 仍用【查詢者】的身分檢查 EXECUTE。
--    ⇒ service_role 讀那張 view ⇒ 讀表過、呼函式當場 42501。
-- 🔬 而這不是推論:2026-09-14 在拋棄式 PG 上實測過同一個形狀(我自己那支 20260915080000 一模一樣撞了一次,
--    那支已在檔內明寫並 GRANT)。📌 **同一句話已經讓兩支 migration 踩同一顆** —— 下一個寫 view + 自製函式的人看這裡。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- 兩句 GRANT EXECUTE 給 service_role。**零 schema 改動、零資料改動。**
-- ⚠️ 而**不是「零行為改動」**(codex nit):它恢復的正是「掃得到 ⇒ 排得進去 ⇒ 寄得出去」那條能力 —— 那就是行為。
-- 🔵 anon / authenticated 照舊收著(那兩支的 REVOKE 不動)—— 本檔只補漏掉的那一個角色。
--
-- ══ 貼了之後會不會一次噴一堆信 ══════════════════════════════════════════
-- 🟢 **量測當下不會。** 兩道各自獨立的閘擋著(⚠️ 它們擋的是【舊的】那些;之後【新發生】的合格取消照樣會寄 —— 那是這封信本來就該做的事):
--   ① `pcm_bank_amount_changed_email_floor()` 回 `2026-09-13 00:00:00+08` ⇒ 比這更早的取消掃不到。
--   ② 那張 view 繼承 `pcm_bank_order_still_mailable`(未付款 + 沒整單取消 + 網站單 + 有信箱)。
-- 🔬 正式庫現況(2026-09-14 唯讀):有品項明細的取消 **4 筆**(09-06 / 09-09 ×2 / 09-11), 而**四張單都已經整單取消**
--    (`orders.cancelled_at` 非空)⇒ 全部被 ② 擋掉 ⇒ **貼的那一刻待寄 0 封**(不是「以後都 0 封」)。⇒ 不需要另設 cutoff。
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260915110000-rollback.sql`:兩句 REVOKE(退回今天這個壞掉的狀態 —— 只在
-- 「發現 GRANT 本身造成別的問題」時才退;那會讓 email-sweep 回到每輪 503)。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_bank_amount_changed_email_floor()') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘一:那兩支函式不在 ⇒ 20260913010000 還沒貼, 本檔沒有對象';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_bank_order_amount_changed_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘二:pcm_bank_order_amount_changed_email_pending 不在 ⇒ 這台庫不是我以為的形狀';
  END IF;
  -- 🔵 **不擋「已經有權限」** —— 本檔冪等, 重跑只是再 GRANT 一次。
END
$pre$;

GRANT EXECUTE ON FUNCTION public.pcm_bank_amount_changed_email_floor() TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid) TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數這個陣列;本檔零 CREATE ⇒ 可授權物件 0, 列出來是多驗不是漏列)
  v_functions text[] := ARRAY[
    'public.pcm_bank_amount_changed_email_floor()',
    'public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)'
  ]::text[];
  r text; v_n integer;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘一:% service_role 仍然 EXECUTE 不到 ⇒ GRANT 沒生效', r;
    END IF;
    -- 🔴 只補 service_role, 其他兩個角色必須還是關著(本檔不得順手放寬)
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘二:% 對 anon/authenticated 開著 EXECUTE ⇒ 本檔放寬過頭', r;
    END IF;
  END LOOP;
  -- 尺是活的:以 service_role 身分真的讀一次那張 view(這正是 sweeper 在做的事)⇒ 不再 42501。
  -- 🔵 `SET LOCAL` ⇒ 交易結束自動還原;**刻意不寫 `RESET ROLE`**(codex nit:它是「回連線預設角色」,
  --    不是「還原進入前的角色」—— 呼叫端先前若 SET 過 ROLE, 那一句會把它換掉)。
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_bank_order_amount_changed_email_pending;
  RAISE NOTICE '[20260915110000] 後置閘全過;以 service_role 讀掃描面 ⇒ % 列待寄(0 = 沒有積壓, 不是壞掉)', v_n;
END
$post$;

COMMIT;
