-- ============================================================
-- M-3 3DS 乙路 R1a1:payment_charge_attempts 加 'released' 狀態 + 7 生命週期欄 + per-order 鎖含 released + 4 一致性 constraint
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1a1(逐字)+ §2.2 released 生命週期 + §9 第 1 片 + §14 步 8。
-- canonical 經 Codex round4→round11 共 8 輪對抗審查、round11 PASS;本片 = §14 唯一 45 步序之步 8(R1 migration bundle 第一片)。
-- 依賴:20260612150000(payment_charge_attempts 表 + status CHECK + order_lock_idx + user_active_idx)。
-- 鐵則 8(動 schema)由 canonical plan 滿足、無需新 plan;鐵則 12(payment / migration)→ codex K2 + Codex Packet。
--
-- 🔴 設計(canonical §2.2 / §4 R1a1):
--   ① 新狀態 'released' = 客人放棄這次付款、且 Record 確認當下 auth_or_pending(4) 時,由 server-only CAS 從 pending 轉入;
--      語意 = 退出「去重 / in-flight 鎖」讓立即重刷、真失敗未定、留「對帳集」+「per-order 唯一」直到 terminal。
--      ⚠️ 本片只開「狀態 + 欄 + 約束」地基。release CAS RPC = R1a3 / find_sibling = R1a2 / failure observation RPC = R1b3 /
--         markCharged released→charged + anomaly = R1b1c / 人工結案 close = R1c3;🔴 begin 主體本片不改(canonical §4 結尾)。
--   ② per-order UNIQUE index 改含 released(守「同單一次一筆」硬不變式;active 集對此消費者 = {pending,charged,released})。
--      🔴 begin ON CONFLICT (order_id) WHERE status IN ('pending','charged') 不改:窄 predicate implies 寬 index predicate、
--         ON CONFLICT inference 成功(narrow ⟹ wide);同單已 released 再 begin → 優雅 order_locked(非硬 unique_violation)。
--      cart dedup / user_active 維持 (pending,charged):released 不被 dedup / in-flight → 重刷不撞不卡(本 migration 不動 user_active_idx)。
--   ③ 7 生命週期欄(canonical §4 R1a1 #2、全 nullable):
--      released_at(release CAS 首次寫、COALESCE 不覆蓋;12h + anomaly 用)/ released_manual_review_at(12h 後仍非 paid 標記、≠ 停止對帳)/
--      failure_observed_at + failure_observed_status(released 遇 Record -1/5 首次觀察 write-once 雙鍵;R1b3 寫)/
--      released_closed_at + released_closed_by + released_close_resolution(人工結案三欄成組;R1c3 寫)。
--   ④ 4 資料一致性 CHECK(canonical §4 R1a1 #4):
--      - failure_observed_status ∈ {NULL, -1, 5};
--      - (failure_observed_at, failure_observed_status) 雙鍵成對(同時 NULL 或同時非 NULL);
--      - (released_closed_at, released_closed_by, released_close_resolution) 整組 NULL 或整組非 NULL;
--      - released_closed_at 非 NULL ⇒ status = 'failed'(close 終局與狀態一致)。
--
-- ⚠️ 安全 / 守線(canonical §11 + 本片守線):
--   - 本片只寫 migration 檔 + MCP DDL 模擬(BEGIN…ROLLBACK 零留痕);不 db push(= §14 步 21 Sean 操作 R1 bundle)、不 push、不 merge、不開 flag。
--   - 既有列(status ∈ pending/charged/failed、7 新欄全 NULL)對新 status CHECK + 4 一致性 CHECK 全 pass(無回填、ADD CONSTRAINT 不炸現存資料)。
--   - 7 新欄皆 nullable(無 NOT NULL、無 DEFAULT)→ ADD COLUMN 不掃表回填、不長鎖。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + 本 migration DDL + 合成資料行為斷言 + ROLLBACK;
--   project bmpnplmnldofgaohnaok PG17、2026-06-24;斷言不符即 RAISE 炸整段交易、整段零錯跑完 = 全過;
--   跑後 information_schema / pg_constraint / pg_indexes 複查零留痕):結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):見檔尾。
-- ============================================================


-- ── 1. status CHECK 加 'released'(原 inline auto-named constraint payment_charge_attempts_status_check;DROP → ADD 同名)──
ALTER TABLE public.payment_charge_attempts
  DROP CONSTRAINT payment_charge_attempts_status_check;
ALTER TABLE public.payment_charge_attempts
  ADD CONSTRAINT payment_charge_attempts_status_check
  CHECK (status IN ('pending', 'charged', 'failed', 'released'));


-- ── 2. 7 生命週期欄(全 nullable、不回填、不長鎖)──
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN released_at               timestamptz,   -- release CAS 首次寫、COALESCE 不覆蓋;12h + anomaly 用(R1a3 寫)
  ADD COLUMN released_manual_review_at timestamptz,   -- released 達 12h 仍非 paid 標記進人工 queue(獨立欄、≠ 停止對帳;R1c1 寫)
  ADD COLUMN failure_observed_at       timestamptz,   -- released 遇 Record -1/5 首次觀察時間(write-once、與 status 雙鍵成對;R1b3 寫)
  ADD COLUMN failure_observed_status   integer,       -- released 首次觀察 Record status(僅 -1 或 5;write-once;R1b3 寫)
  ADD COLUMN released_closed_at        timestamptz,   -- 人工結案(owner-only close_released_attempt、R1c3)時間
  ADD COLUMN released_closed_by        text,          -- 人工結案者(寫 session_user、記 DB session role 非人類 staff id;R1c3)
  ADD COLUMN released_close_resolution text;          -- 人工結案理由(R1c3);與 at/by 三欄整組 NULL 或整組非 NULL


-- ── 3. per-order 鎖 index 改含 released(DROP → CREATE 同名;begin ON CONFLICT 不改、narrow ⟹ wide inference)──
DROP INDEX public.payment_charge_attempts_order_lock_idx;
CREATE UNIQUE INDEX payment_charge_attempts_order_lock_idx
  ON public.payment_charge_attempts (order_id)
  WHERE status IN ('pending', 'charged', 'released');


-- ── 4. 4 資料一致性 CHECK(canonical §4 R1a1 #4)──
ALTER TABLE public.payment_charge_attempts
  -- failure_observed_status 僅 -1 / 5(或 NULL)
  ADD CONSTRAINT payment_charge_attempts_failure_observed_status_chk
    CHECK (failure_observed_status IS NULL OR failure_observed_status IN (-1, 5)),
  -- failure observation 雙鍵成對:failure_observed_at 與 failure_observed_status 同時 NULL 或同時非 NULL
  ADD CONSTRAINT payment_charge_attempts_failure_observed_pair_chk
    CHECK (
      (failure_observed_at IS NULL AND failure_observed_status IS NULL)
      OR
      (failure_observed_at IS NOT NULL AND failure_observed_status IS NOT NULL)
    ),
  -- 人工結案三欄整組:released_closed_at / released_closed_by / released_close_resolution 整組 NULL 或整組非 NULL
  ADD CONSTRAINT payment_charge_attempts_released_closed_group_chk
    CHECK (
      (released_closed_at IS NULL AND released_closed_by IS NULL AND released_close_resolution IS NULL)
      OR
      (released_closed_at IS NOT NULL AND released_closed_by IS NOT NULL AND released_close_resolution IS NOT NULL)
    ),
  -- close 終局與狀態一致:released_closed_at 非 NULL ⇒ status = 'failed'
  ADD CONSTRAINT payment_charge_attempts_released_closed_status_chk
    CHECK (released_closed_at IS NULL OR status = 'failed');


COMMENT ON COLUMN public.payment_charge_attempts.released_at IS
  'M-3 3DS R1a1:release CAS 首次寫入時間(COALESCE 不覆蓋);客人放棄這次付款、Record=4 時 server-only CAS pending→released。12h 孤兒 + anomaly 用。';
COMMENT ON COLUMN public.payment_charge_attempts.released_manual_review_at IS
  'M-3 3DS R1a1:released 達 12h 仍非 paid 時標記進人工 queue(獨立欄、≠ 停止對帳;sweeper 仍持續低頻對帳)。';
COMMENT ON COLUMN public.payment_charge_attempts.failure_observed_at IS
  'M-3 3DS R1a1:released 遇 Record -1/5 首次觀察時間(write-once、與 failure_observed_status 雙鍵成對;R1b3 RPC 寫)。';
COMMENT ON COLUMN public.payment_charge_attempts.failure_observed_status IS
  'M-3 3DS R1a1:released 首次觀察的 Record status(僅 -1 或 5;write-once;R1b3 RPC 寫)。observation ≠ terminal:attempt 仍 released、持續對帳。';
COMMENT ON COLUMN public.payment_charge_attempts.released_closed_at IS
  'M-3 3DS R1a1:人工結案(owner-only close_released_attempt、R1c3)時間;非 NULL ⇒ status=failed。';
COMMENT ON COLUMN public.payment_charge_attempts.released_closed_by IS
  'M-3 3DS R1a1:人工結案者(寫 session_user、記 DB session role 非人類 staff id;R1c3)。';
COMMENT ON COLUMN public.payment_charge_attempts.released_close_resolution IS
  'M-3 3DS R1a1:人工結案理由(R1c3)。與 released_closed_at / released_closed_by 三欄整組 NULL 或整組非 NULL。';


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP INDEX IF EXISTS public.payment_charge_attempts_order_lock_idx;
--   CREATE UNIQUE INDEX payment_charge_attempts_order_lock_idx
--     ON public.payment_charge_attempts (order_id) WHERE status IN ('pending', 'charged');
--   ALTER TABLE public.payment_charge_attempts
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_released_closed_status_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_released_closed_group_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_failure_observed_pair_chk,
--     DROP CONSTRAINT IF EXISTS payment_charge_attempts_failure_observed_status_chk;
--   ALTER TABLE public.payment_charge_attempts
--     DROP COLUMN IF EXISTS released_close_resolution,
--     DROP COLUMN IF EXISTS released_closed_by,
--     DROP COLUMN IF EXISTS released_closed_at,
--     DROP COLUMN IF EXISTS failure_observed_status,
--     DROP COLUMN IF EXISTS failure_observed_at,
--     DROP COLUMN IF EXISTS released_manual_review_at,
--     DROP COLUMN IF EXISTS released_at;
--   ALTER TABLE public.payment_charge_attempts DROP CONSTRAINT IF EXISTS payment_charge_attempts_status_check;
--   ALTER TABLE public.payment_charge_attempts ADD CONSTRAINT payment_charge_attempts_status_check
--     CHECK (status IN ('pending', 'charged', 'failed'));
--   -- 注意:若 rollback 時已有 released 列,需先收斂(無此狀態列)才可重建原 status CHECK。
-- ============================================================
