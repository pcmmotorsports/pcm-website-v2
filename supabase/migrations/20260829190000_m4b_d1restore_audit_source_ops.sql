-- M-4b · 災難還原留痕:admin_audit_log.source_app 開放 'ops'
--
-- 為什麼:`scripts/d1-restore.ts` 跑完會把 26 張訂單 + 2 個客戶寫回正式庫,
-- 而它【零留痕】(2026-08-29 線D 量:該支檔 `admin_audit_log` 命中 0;
-- 正對照 `20260804180000_*_admin_cancel_order.sql` 命中 5 ⇒ 尺是活的)。
-- ⇒ 那是一次沒有作者、沒有時間、沒有理由的寫入,而它的門檻是 postgres 超級使用者
--   ⇒ 📌 **能做任何事的人,正是最需要留下紀錄的那個。**
--
-- ── ⚠️ 這支【看起來】撞到一條既有拍板,而它沒有。留著這段,因為下一個人會撞到同一份前例 ──
-- `20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql:51-52` 逐字:
--   「`admin_audit_log`:`source_app` CHECK 只收 ('admin','quote')…
--     為了一支排程去放寬共用稽核表的 CHECK,代價大於收益。」
-- 而本表的 COMMENT(`20260712210000_*`)逐字:「系統自動化 / cron 事件不寫本表(各有自己的表)」
--
-- 🔴 **那句排除的射程,是「系統自動化 / cron」——**
--   L3a      = pg_cron 排程            ⇒ 命中 ⇒ 排除句適用,那片的裁定沒有錯
--   d1-restore = 人拿 postgres 憑證手動跑 ⇒ **兩個都不是** ⇒ 排除句不適用
-- 📌 而分野不是名詞遊戲:**排程有 `cron.job_run_details` 當觀測點**,
--   而一次手動還原**沒有任何其他觀測點** —— 它的問題本體就是「沒有人知道是誰做的」。
--
-- ── 🔴 rollback:本支【不是可逆的】,不要照 migration 慣例假設它退得回去 ──
-- 反向(把 CHECK 改回兩值)只在**一列 `source_app='ops'` 都還沒寫進去**時成立;
-- 已經有 'ops' 列之後,反向的 ADD CONSTRAINT 會被既有資料擋下而失敗。
-- ⇒ 要退,得先決定那些列怎麼辦(刪不掉:本表 append-only、service_role 無 DELETE)。
-- 📌 **「rollback 那一欄寫了」與「退得回去」是兩件事。**

BEGIN;

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_source_app_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_source_app_check
  CHECK (source_app IN ('admin', 'quote', 'ops'));

COMMENT ON COLUMN public.admin_audit_log.source_app IS
  '事件發起來源;寫入者為 admin server(service_role)或維運人員(psql)。'
  'quote=從報價單入口(SSO)發起的 admin 事件;quote 側 server 連報價單庫、不持本庫金鑰(兩庫分離)、不直寫本表。'
  'ops=人工執行的維運動作(例 scripts/d1-restore.ts 的災難還原),預期由 psql 以 postgres 身分寫入;'
  'actor 記的是 session_user(DB 自己講的那一格),不是自填的人名。'
  '🔴 而【CHECK 只限制值、不限制寫入角色】(codex 2026-08-29 R1 指正):'
  'service_role 既有的 INSERT 權同樣寫得動 source_app=''ops'' ⇒ 上面那句「由 psql 以 postgres 寫入」'
  '是【約定】不是【機制】。要它成為機制得另加欄級或 policy 層的限制,本片沒有做。'
  '⇒ 讀這一欄的人:它答得出「這筆自稱是什麼來源」,答不出「它真的是那個來源」。'
  '🔴 ~~原句「真正偽造不了的那一格是 after->>db_session_user」~~ **那句是錯的**'
  '(codex 2026-08-29 R2 指正):after 是【呼叫端自填的 JSON】—— 只有本 repo 那支腳本'
  '會把 session_user 的真值填進去;任何持 service_role 的程式都填得出一個假的。'
  '⇒ **本表沒有任何一欄是偽造不了的。**它是【紀錄】不是【證據】,'
  '而這句話留著,是因為我原本寫了一個它給不起的保證。'
  '⚠️ ~~原字面「系統自動化 / cron 事件不寫本表(各有自己的表)」~~ 2026-08-29 收窄射程:'
  '**排程 / 自動化仍然不寫本表**(它們有 cron.job_run_details 當觀測點);'
  '**人工執行的維運動作走 ops** —— 它沒有任何其他觀測點。舊字面留著,讓下一個人看得出它被改過。';

-- ── 斷言:兩個世界都要演,不是只確認「新值進得去」──────────────────────────
-- 🔴 兩段都在子區塊裡跑完就回滾 ⇒ **本表不會多出任何一列**(它是 append-only)。
DO $$
DECLARE
  v_constraint text;
  v_val text;
BEGIN
  -- 世界①(該過):三個值【每一個】都要插得進去。
  -- 🔴🔴 **不能只驗 'ops'**(codex/R3 2026-08-29 抓到,全片最高嚴重度):
  --    本片是 DROP + ADD 同一個約束名 ⇒ 打成 IN ('admin','ops') 而漏了 'quote' 的話,
  --    只驗 'ops' 的世界①【照樣過】、世界②(zzz)【照樣被擋】
  --    ⇒ 兩個世界都印綠、印「兩個世界都演過」、然後 COMMIT。
  -- 🔴 而後果超出本片:之後 admin / quote 側【每一筆】稽核 INSERT 撞 CHECK,
  --    而那些是 RPC 同交易 fail-closed(858 G9:稽核落不進去 ⇒ 整筆回滾)
  --    ⇒ **退款 / tier / 取消 / 手動建單全炸** —— 而我們的測試是綠的。
  -- 📌 **一個「新增一個值」的改動,它的風險【不在新的那個值】,在【舊的那些還在不在】。**
  FOREACH v_val IN ARRAY ARRAY['admin', 'quote', 'ops'] LOOP
    BEGIN
      INSERT INTO public.admin_audit_log (actor, action, request_id, source_app)
      VALUES ('migration-selftest', 'selftest', 'selftest', v_val);
      RAISE EXCEPTION 'D1AUDIT_SELFTEST_INSERTED_OK';
    EXCEPTION
      WHEN check_violation THEN
        RAISE EXCEPTION 'D1AUDIT:source_app=% 被 CHECK 擋下 ⇒ 這個值不在約束裡了', v_val;
      WHEN OTHERS THEN
        IF SQLERRM <> 'D1AUDIT_SELFTEST_INSERTED_OK' THEN RAISE; END IF;
    END;
  END LOOP;

  -- 世界②(該擋):負對照。一個不在名單上的值必須被擋 ——
  -- 🔴 少了這一段,一個【CHECK 被整個刪掉】的世界會跟成功的世界印同一個綠。
  BEGIN
    INSERT INTO public.admin_audit_log (actor, action, request_id, source_app)
    VALUES ('migration-selftest', 'selftest', 'selftest', 'zzz_not_allowed');
    RAISE EXCEPTION 'D1AUDIT:source_app=''zzz_not_allowed'' 竟然插得進去 ⇒ CHECK 沒生效';
  EXCEPTION
    WHEN check_violation THEN
      -- 🔴 **要驗【是哪一道 CHECK 擋的】**(codex R1 MF3):本表另有三道 nonempty CHECK,
      --    而上面那筆的 actor/action/request_id 都非空 ⇒ 今天不會撞到它們。
      --    ⚠️ 但只要有人未來加一道別的 CHECK、或**目標 CHECK 整個消失而別道先擋**,
      --    這一格就會【假綠】—— 而它印的字會是「負對照通過」。
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint <> 'admin_audit_log_source_app_check' THEN
        RAISE EXCEPTION 'D1AUDIT:負對照被【另一道】CHECK 擋下(%),不是 source_app 那道 ⇒ 本斷言沒有判別力', v_constraint;
      END IF;
  END;

  RAISE NOTICE '✅ admin_audit_log.source_app:admin/quote/ops 三值皆可寫、未授權值被【source_app 那道】擋(四個世界都演過)';
END $$;

COMMIT;
