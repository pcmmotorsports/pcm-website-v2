-- 反向:把 admin_audit_log.source_app 的 CHECK 收回兩值,並還原它的 COMMENT
--
-- 🔴🔴 **這一支【不保證跑得過】—— 而那正是它要示範的事。**
--   來源 migration `supabase/migrations/20260829190000_m4b_d1restore_audit_source_ops.sql:22` 逐字:
--     「反向(把 CHECK 改回兩值)只在**一列 `source_app='ops'` 都還沒寫進去**時成立;」
--   ⇒ 📌 **回滾的正確與否, 取決於正式庫【現在有沒有那種資料】** ——
--     而 `scripts/rollback-drill.sh` 在空庫上跑它會全綠, 在餵了一列 'ops' 的世界裡會炸。
--     那個「會炸」就是 DATA-DEPENDENT, 它是【正確的結果】, 不是這支寫壞了。
--
-- 🔴🔴 **整支包在一個交易裡, 而那不是形式** —— psql 預設 autocommit:
--   少了 BEGIN/COMMIT, `DROP CONSTRAINT` 會**先獨立 commit**, 隨後 `ADD CONSTRAINT` 被既有
--   'ops' 列擋下 ⇒ **正式庫留下一張完全沒有 CHECK 的 `admin_audit_log`** ——
--   那比回滾前、回滾後**任何一個狀態都糟**。(2026-09-06 code-reviewer 抓的。)
--
-- 🔵 前置閘寫成 `RAISE EXCEPTION` 而不是「請你先手動 SELECT 一下」——
--   ⛔ ~~原本這裡寫「貼之前一定要先問一句(唯讀)」~~ ⇒ **要人記得的檢查, 在半夜三點不會發生。**

BEGIN;

DO $rbgate$
DECLARE
  v_ops bigint;
BEGIN
  SELECT count(*) INTO v_ops FROM public.admin_audit_log WHERE source_app = 'ops';
  IF v_ops > 0 THEN
    RAISE EXCEPTION '回退前置閘:已經有 % 列 source_app=''ops'' ⇒ 收回 CHECK 會擋掉它們。'
                    '先決定那些列怎麼辦(改值 / 保留並放棄這次回滾), 不要拿掉這道閘。', v_ops;
  END IF;
END
$rbgate$;

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_source_app_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_source_app_check
  CHECK (source_app IN ('admin', 'quote'));

-- 🔴 COMMENT 也要退 —— 來源 migration `:36` 覆蓋掉了一份舊註解,
--   而「反向只退 CHECK」會留下一句寫著 'ops' 的說明, 掛在一個不收 'ops' 的欄位上。
--   下面這段逐字抄自 `supabase/migrations/20260712210000_m4a_admin_audit_log.sql:67-68`。
COMMENT ON COLUMN public.admin_audit_log.source_app IS
  '事件發起來源;寫入者恆為 admin server(service_role)。quote=從報價單入口(SSO)發起的 admin 事件;quote 側 server 連報價單庫、不持本庫金鑰(兩庫分離)、不直寫本表。系統自動化 / cron 事件不寫本表(各有自己的表)。';

COMMIT;
