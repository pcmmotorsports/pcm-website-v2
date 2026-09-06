-- 反向:把 admin_audit_log.source_app 的 CHECK 收回兩值,並還原它的 COMMENT
--
-- 🔴🔴 **這一支【不保證跑得過】—— 而那正是它要示範的事。**
--   來源 migration `supabase/migrations/20260829190000_m4b_d1restore_audit_source_ops.sql:22` 逐字:
--     「反向(把 CHECK 改回兩值)只在**一列 `source_app='ops'` 都還沒寫進去**時成立;」
--   ⇒ 📌 **回滾的正確與否, 取決於正式庫【現在有沒有那種資料】。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **為什麼整段 DDL 擠在【一個】DO 區塊裡 —— 這是量到的, 不是風格**
-- ══════════════════════════════════════════════════════════════════════════
--   ⛔ ~~上一版:`BEGIN;` + 獨立的 DO 閘 + 獨立的 DROP / ADD / COMMENT + `COMMIT;`~~
--   我以為包了交易就安全了。**codex(gpt-6-astra)2026-09-06 說不安全, 我當場量了一發, 它是對的:**
--
--   拋棄式 PG、表裡先放一列 `source_app='ops'`,把上一版餵給
--   `psql -v ON_ERROR_ROLLBACK=on`(而 `ON_ERROR_STOP` 沒開)⇒
-- ```
-- psql rc = 0                      ⇐ 🔴 它說成功
-- 約束還在嗎(1=在 / 0=不在) ⇒ 0    ⇐ 🔴 而那張表【沒有 CHECK 了】
-- 逐句:BEGIN → 閘 ERROR → ALTER TABLE(DROP 成功!)→ ADD ERROR → COMMENT → COMMIT
-- ```
--   🟢 正對照(同一支檔, `ON_ERROR_STOP=on`)⇒ rc=3、約束還在 = **1**(整筆回滾, 正確)。
--   🔴 負對照(問一個現造的約束名)⇒ **0** ⇒ 那把尺會動, 上面那個 0 算數。
--
--   🎯 **成因**:`ON_ERROR_ROLLBACK=on` 讓 psql 在**每一句前面**開一個隱含 savepoint
--     ⇒ 閘的 `RAISE EXCEPTION` 只退到它自己那一句, **後面照跑** ⇒ DROP 生效、ADD 被資料擋下、
--     而 `COMMIT` 把「已經 DROP 掉」這件事**提交了**。
--   📌 **⇒ 一個交易包不包得住, 不只取決於我寫不寫 BEGIN, 還取決於【跑它的人的 psql 設定】** ——
--     而那個設定不在這支檔裡, 我也管不到。
--   🛑 **最毒的一格是 `rc=0`**:「跑成功了」與「它拆掉了那張表的保護」在 rc 上是同一個值。
--
--   ✅ **修法不是叫人記得加旗標(要人記得的檢查在半夜三點不會發生), 是把整段 DDL 變成【一句】**
--     —— 一句 SQL 沒有中間點可以被 savepoint 切開。

BEGIN;

DO $rbdown$
DECLARE
  v_def  text;
  v_ops  bigint;
  -- 逐字抄自 `supabase/migrations/20260712210000_m4a_admin_audit_log.sql:67-68`
  -- (codex 2026-09-06 逐字比對過:與原 migration 完全一致)
  v_note constant text :=
    '事件發起來源;寫入者恆為 admin server(service_role)。quote=從報價單入口(SSO)發起的 admin 事件;quote 側 server 連報價單庫、不持本庫金鑰(兩庫分離)、不直寫本表。系統自動化 / cron 事件不寫本表(各有自己的表)。';
BEGIN
  -- 🔵 `lock_timeout` 只管【等鎖】那一段;拿到鎖之後的掃描要另一個上界。
  --    慣例對照:`supabase/migrations/20260905380000_m4b_customers_email_not_blank.sql`
  --    逐字 `SET LOCAL lock_timeout = '5s';` / `SET LOCAL statement_timeout = '30s';`
  --    🛑 撞到 `lock_not_available` **不是這支寫錯**, 是當下有人握著鎖 ⇒ 等他結束再跑, 不要拿掉這兩行。
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '30s', true);

  -- 🔴 **先鎖表, 再查資料** —— 反過來寫就有 TOCTOU(codex nit):
  --   閘過了之後、DROP 拿到排他鎖之前, 還有人插得進一列 'ops'。
  --   `ACCESS EXCLUSIVE` 反正 DROP/ADD CONSTRAINT 本來就會拿, 提早拿不多付代價。
  LOCK TABLE public.admin_audit_log IN ACCESS EXCLUSIVE MODE;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'admin_audit_log_source_app_check'
     AND conrelid = 'public.admin_audit_log'::regclass;

  -- ── 狀態核對:分得出【沒升級過】/【已經退掉了】/【認不得】三種, 而不是一律往下衝
  IF v_def IS NULL THEN
    RAISE EXCEPTION '回退中止:找不到 admin_audit_log_source_app_check ⇒ 這張表現在的樣子我認不得, 不動它。';
  END IF;
  IF v_def NOT LIKE '%''ops''%' THEN
    RAISE NOTICE '略過:現行 CHECK 已經不收 ''ops'' ⇒ 已經是退掉的狀態(或從來沒升級過)。定義 = %', v_def;
    RETURN;
  END IF;

  SELECT count(*) INTO v_ops FROM public.admin_audit_log WHERE source_app = 'ops';
  IF v_ops > 0 THEN
    RAISE EXCEPTION '回退前置閘:已經有 % 列 source_app=''ops'' ⇒ 收回 CHECK 會擋掉它們。'
                    '先決定那些列怎麼辦(改值 / 保留並放棄這次回滾), 不要拿掉這道閘。', v_ops;
  END IF;

  EXECUTE 'ALTER TABLE public.admin_audit_log DROP CONSTRAINT admin_audit_log_source_app_check';
  EXECUTE 'ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_source_app_check '
          'CHECK (source_app IN (''admin'', ''quote''))';

  -- 🔴 COMMENT 也要退 —— 來源 migration `:36` 覆蓋掉了一份舊註解,
  --   而「反向只退 CHECK」會留下一句寫著 'ops' 的說明, 掛在一個不收 'ops' 的欄位上。
  EXECUTE format('COMMENT ON COLUMN public.admin_audit_log.source_app IS %L', v_note);

  -- 🔵 提交前自核:讀回 DB 自己講的那一格, 而不是相信我上面寫了什麼(codex nit)。
  IF col_description('public.admin_audit_log'::regclass,
       (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.admin_audit_log'::regclass AND attname = 'source_app'))
     IS DISTINCT FROM v_note THEN
    RAISE EXCEPTION '回退自核失敗:COMMENT 寫進去之後讀回來與預期不符 ⇒ 整筆退掉。';
  END IF;
END
$rbdown$;

COMMIT;
