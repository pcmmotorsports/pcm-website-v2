\pset pager off
-- 🔴🔴 `psql -f` 的 rc 在【中間某格 ERROR】與【全對】兩個世界都是 0 ⇒ 沒有這行, 那個 rc 對兩個世界印同一個東西。
\set ON_ERROR_STOP on
-- 🔴 唯讀。20260905180000(匯款兜底掃描器 腿 A)貼後對帳。
-- 🛑 而【函式存在】對 CREATE OR REPLACE 零判別力 ⇒ 判準是**函式體含不含那三個字面**。
-- 🔵 每一格都印【預期值】—— 預期值是貼之前寫下的, 不是照著讀數抄的。

\echo '=== ① 前提:那支函式在不在(不在 ⇒ 下面每一格都無意義)==='
\echo '    預期:貼【前】0 · 貼【後】1'
SELECT pg_catalog.count(*) AS 幾個多載
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pcm_cron' AND p.proname = 'late_payment_pending_refund_sweep';

\echo ''
\echo '=== ② 🔴 判準:函式體含不含那三個承重字面 ==='
\echo '    預期:貼【前】五個皆 f · 貼【後】五個皆 t'
\echo '    (r.voided_at / r.settled_at = 它與部分唯一索引的謂語同一組;false = 兜底不覆寫已開好的金額)'
SELECT
  COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%r.voided_at  IS NULL%'), false)  AS 有未作廢判準,
  COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%r.settled_at IS NULL%'), false)  AS 有未結清判準,
  COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%open_for(r_row.order_id, false)%'), false) AS 用false不覆寫,
  COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%WHERE v.order_id = o.id AND v.voided_at IS NOT NULL%'), false)   AS 作廢就整張跳過,
  COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%INTO v_scanned, v_short, v_void%'), false)    AS 有數金額少那族
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pcm_cron' AND p.proname = 'late_payment_pending_refund_sweep';

\echo ''
\echo '=== 🟢 正對照:同一把尺問【同一支函式】一個一定在的字面 ⇒ 該 t ==='
\echo '    預期:t(它證明這把尺在這支函式上會動;若它是 f, 上面那三個沒有意義)'
SELECT COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%RETURNS jsonb%'), false) AS 正對照_RETURNS
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pcm_cron' AND p.proname = 'late_payment_pending_refund_sweep';

\echo ''
\echo '=== 🔵 負對照:同一把尺問一個現造的字面 ⇒ 該 f ==='
\echo '    預期:f(它證明這把尺不是對什麼字面都印 t)'
SELECT COALESCE(bool_or(pg_catalog.pg_get_functiondef(p.oid) LIKE '%zzz_never_in_this_function%'), false) AS 負對照
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'pcm_cron' AND p.proname = 'late_payment_pending_refund_sweep';

\echo ''
\echo '=== ③ 排程逐格 ==='
\echo '    預期:一列, active=t, schedule=*/10 * * * *'
SELECT jobname, schedule, active, username, command
  FROM cron.job WHERE jobname = 'pcm-late-payment-sweep';

\echo ''
\echo '=== ④ 🔴 而「我的在」與「別人的沒被動到」是兩個宣稱 ==='
\echo '    預期:那六條既有的都還在且 active(數字會隨新增排程長, 看的是【它們在不在】不是總數)'
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;

\echo ''
\echo '=== ⑤ ACL:三個應用角色都不得叫得動它 ==='
\echo '    預期:三列皆 f;而 postgres 那一列該 t(否則上面的 f 是尺沒動)'
SELECT r.n AS 角色,
       pg_catalog.has_function_privilege(
         r.n, 'pcm_cron.late_payment_pending_refund_sweep(integer)'::regprocedure, 'EXECUTE') AS 叫得動
  FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres')) AS r(n) ORDER BY 1;

\echo ''
\echo '=== ⑥ 🔵 它今天補了幾列(看, 不當驗收)==='
\echo '    🛑 Sean 拍板時看到的那句:【不要用「補了幾筆」當它的驗收】——'
\echo '       上線後一個月補 0 筆是它該有的樣子。這一格是拿來看的, 不是拿來判成敗的。'
-- 🔴🔴 R1-F4:⛔ ~~用 `cancellation_id IS NULL` 當「兜底開的列」~~ —— **那個判準是錯的**:
--    `open_for` 在有 1 筆取消單時【會填】cancellation_id(20260905070000:187-199)
--    ⇒ 正常世界恆印約 0, 而讀的人會讀成「兜底沒開過」。
-- ✅ 改成用【時間】:上線時刻之後開的列。⚠️ 而下面那個時刻是**手填的** ——
--    貼板當天把它改成實際的 apply 時刻, 否則這一格答的是另一個問題。
SELECT pg_catalog.count(*) AS 上線後開的待退款列
  FROM public.order_pending_refunds r
 WHERE r.opened_at >= TIMESTAMPTZ '2026-09-05 00:00:00+08'
   AND r.voided_at IS NULL;
-- 🔴 R4-N1:上面那個時刻是**手填的** —— 忘了改就會把 070000 的 trigger 開的列
--    一起數進來(多報), 而**沒有任何東西會紅**。
--    ⇒ 📌 一個要人記得改的常數, 與一個沒有人維護的數字是同一個東西。
--    ✅ 用之前先問一句:這個時刻是不是本支真正 apply 的那一刻?不是 ⇒ 這一格的數字沒有意義。

\echo ''
\echo ''
\echo '=== 7 心跳:它有沒有在跑, 而且失敗有沒有留下痕跡(R3-3)==='
\echo '    期待值 = 貼完還沒跑過會查無 0 列, 跑過之後 1 列'
\echo '    consecutive_failures 大於 0 = 它每輪都在炸, 而 cron 那邊照樣記 success'
SELECT job_name, last_success_at, last_failure_at, consecutive_failures
  FROM public.sweeper_heartbeat WHERE job_name = 'pcm-late-payment-sweep';

\echo ''
\echo '=== 🛑 這一份【證不到】什麼 ==='
\echo '    · 它證函式體有那三個字面, 不證它在真資料上篩對了;strpos 擋不住有人加 OR TRUE'
\echo '    · 它不證排程【真的每 10 分鐘跑起來】—— 那要看 cron.job_run_details'
\echo '    · ⑥ 那個數不是它的驗收 —— 一個正確的 0 會被讀成失敗, 而那會讓人把它關掉'
\echo '    · 它不看 ALTER DATABASE / ALTER ROLE ... SET 那一層'
\echo '    · 🔴 它完全不看【腿 B】(已收匯款而狀態仍 unpaid)—— 那個世界今天仍然沒有人接'
\echo '    - R3-5:上面那幾格 strpos/LIKE 比的是【含註解的整段函式體】'
\echo '      所以命中的有可能是註解裡的字, 不是會執行的碼 —— 而這一份分不出來'
\echo '    - 心跳那一格看得到它炸過, 看不到炸在哪一張單 —— 那在 server log 裡'
