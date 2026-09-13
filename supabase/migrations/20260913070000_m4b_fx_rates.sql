-- 20260913070000_m4b_fx_rates.sql
-- 後台「設定 › 匯率」的資料表 + 唯一寫入口。plan `docs/plans/2026-09-13-fx-rate-settings-plan.md`。
-- 主視窗 2026-09-13 裁:§1-a **乙(append-only 留痕)**、§3 **乙(獨立一頁 /settings/fx)**、§1-b 只有 is_manager 能寫。
--
-- ── 一句 ─────────────────────────────────────────────────────────────────────
--   每次改匯率 = **新增一列**(誰、何時、哪個幣別、多少、從何時生效)。舊列不改不刪。
--   「現在的匯率」= 每個幣別 `effective_from <= now()` 之中最新的那一列。
--
-- ── 🔴 今天零消費端(plan §1-c 實測:匯率 / exchange_rate / fx_rate 三個字全 repo 0 命中)──
--   本支不動 orders / order_items / 任何既有金額欄位。貼了之後**沒有任何訂單的數字會變**。
--   「成本 × 匯率」那條線是另一個 plan(memory `project_0913-admin-order-ux-redesign-rulings.md`)。
--
-- ── 形狀(抄 20260912050000 mgr0 三支)───────────────────────────────────────
--   · 裸 `CREATE`(不 OR REPLACE):新物件撞名要當場紅。⇒ 不宣告 `pcm:idempotent`;本支零頂層 DML。
--   · RPC `SECURITY DEFINER` + `SET search_path = ''`,body 物件全帶 schema 全名。
--   · 身分閘只准 `SELECT … INTO` + `IF NOT FOUND` + `coalesce(…, false)`(actor 不存在 ⇒ 擋,不是放)。
--   · 稽核與寫入同一筆交易 + 筆數守;`p_request_id` 空 ⇒ RAISE。
--   · 後台走 service_role ⇒ `p_actor` 由應用層傳;本支解不掉「金鑰外流後冒名」,那是另一件事。
--   · service_role 表權只給 SELECT;寫一律走 RPC(同 suppliers 20260801140000 §4)。
--
-- ── TWD 固定 1(memory 同上)────────────────────────────────────────────────
--   做在 CHECK,不做在頁面:`currency_code = 'TWD'` 的列 `rate_to_twd` 只能是 1。
--   本支**不塞種子列**(稿上那十個數字是假資料,不是真匯率;TWD 由頁面顯示固定 1,不需要一列)。
--
-- ── ROLLBACK ═══════════════════════════════════════════════════════════════
--   `supabase/rollbacks/20260913070000-rollback.sql`:DROP 一支 RPC + 一張表。
--   🔴 表 DROP 會連匯率歷史一起丟。空表可直接退;已有列 ⇒ 先另存一份再退(不管有沒有消費端)。

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.fx_rates') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.fx_rates 已存在 ⇒ 本支貼過了或撞名,停下';
  END IF;
  IF pg_catalog.to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.staff';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.admin_audit_log';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='staff' AND column_name='id') <> 'text' THEN
    RAISE EXCEPTION '前置閘④:public.staff.id 不是 text ⇒ 本支簽章要重寫,停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='public.admin_audit_log'::regclass
                    AND conname='admin_audit_log_request_id_nonempty') THEN
    RAISE EXCEPTION '前置閘⑤:admin_audit_log_request_id_nonempty 不見了 ⇒ 本支對 request_id 的假設要重讀';
  END IF;
END $$;

-- ── 1. 表 ───────────────────────────────────────────────────────────────────
CREATE TABLE public.fx_rates (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency_code  text        NOT NULL,
  rate_to_twd    numeric     NOT NULL,                       -- 1 單位外幣 = 多少台幣;numeric 不用 float(CLAUDE.md 硬線)
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by     text        NOT NULL REFERENCES public.staff(id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fx_rates_currency_code_format CHECK (currency_code ~ '^[A-Z]{3}$'),
  -- numeric 收得下 NaN / Infinity,而 NaN 比任何數都大 ⇒ 光寫 > 0 擋不住(codex R1 must-fix 1)。
  CONSTRAINT fx_rates_rate_positive        CHECK (rate_to_twd > 0 AND rate_to_twd < 'Infinity'::numeric),
  CONSTRAINT fx_rates_twd_is_one           CHECK (currency_code <> 'TWD' OR rate_to_twd = 1),
  -- 同幣別同一生效時刻兩列 ⇒ 「現在的匯率」會二選一 ⇒ 不准。
  CONSTRAINT fx_rates_one_per_effective    UNIQUE (currency_code, effective_from)
);

COMMENT ON TABLE public.fx_rates IS
  'append-only:每次改匯率新增一列,舊列不改不刪(trigger 擋 UPDATE/DELETE/TRUNCATE)。'
  '現在的匯率 = 每幣別 effective_from <= now() 中最新一列。TWD 固定 1(CHECK)。'
  '寫入只走 admin_fx_rate_set(is_manager 才能)。20260913070000。';

-- ── 2. append-only:owner 也不能 UPDATE / DELETE / TRUNCATE ───────────────
-- 🔵 ACL 只擋得住應用角色;SQL Editor 是 postgres。留痕表要靠 trigger 才是真的留痕。
CREATE FUNCTION public.pcm_fx_rates_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'fx_rates 是 append-only:改匯率請新增一列(admin_fx_rate_set),不 % 舊列', TG_OP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pcm_fx_rates_append_only() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER fx_rates_append_only_row
  BEFORE UPDATE OR DELETE ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION public.pcm_fx_rates_append_only();
CREATE TRIGGER fx_rates_append_only_stmt
  BEFORE TRUNCATE ON public.fx_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_fx_rates_append_only();

-- ── 3. 表級 ACL + RLS ───────────────────────────────────────────────────────
-- 🔴 REVOKE 先、含 service_role:空庫世界的 shim 用 ALTER DEFAULT PRIVILEGES 讓新表出生就帶
--    service_role 全權(20260907070000 拋棄式 PG 抓到的),明文 REVOKE 讓兩個世界終態一致。
REVOKE ALL ON TABLE public.fx_rates FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
REVOKE ALL ON SEQUENCE public.fx_rates_id_seq FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT SELECT ON TABLE public.fx_rates TO service_role;
GRANT SELECT ON TABLE public.fx_rates TO pcm_readonly;
-- 🔵 序列零 GRANT:取號由 SECURITY DEFINER 的 RPC 以 owner 身分做(同 20260907070000 那條 must-fix)。

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
-- 政策明寫,不依賴 service_role 的 BYPASSRLS 屬性(20260906340000 §5 那段)。
CREATE POLICY fx_rates_select_service_role ON public.fx_rates
  FOR SELECT TO service_role USING (true);
-- anon / authenticated 刻意零政策 + 零表權,兩層都在。

-- ── 4. 唯一寫入口 ───────────────────────────────────────────────────────────
-- p_effective_from NULL ⇒ now()。回 jsonb:{result:'ok', row:{…}}。
-- 無權 / 幣別格式錯 / TWD / 非正數 ⇒ RAISE(呼叫端顯示訊息即可,沒有「可預期結果」那一類)。
CREATE FUNCTION public.admin_fx_rate_set(
  p_actor          text,
  p_currency_code  text,
  p_rate_to_twd    numeric,
  p_effective_from timestamptz,
  p_request_id     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_code       text;
  v_before     public.fx_rates%ROWTYPE;
  v_row        public.fx_rates%ROWTYPE;
  v_n          integer;
  v_now        timestamptz;
BEGIN
  SET LOCAL lock_timeout = '3s';
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_fx_rate_set: p_request_id 不可為空(稽核那一欄 NOT NULL + CHECK)';
  END IF;

  -- 身分閘(mgr0 §12-3 的形狀;actor 不存在 / 停用 ⇒ NOT FOUND ⇒ 擋)
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT coalesce(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  v_code := pg_catalog.upper(pg_catalog.btrim(coalesce(p_currency_code, '')));
  IF v_code !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION '幣別要三個英文字母(例 USD),收到「%」', p_currency_code;
  END IF;
  IF v_code = 'TWD' THEN
    RAISE EXCEPTION 'TWD 固定 1,不可改';
  END IF;
  -- NaN 比所有非 NaN 的數都大 ⇒ 光寫 <= 0 擋不住,同表上那條 CHECK 的式子(codex R1 must-fix 1)
  IF p_rate_to_twd IS NULL OR NOT (p_rate_to_twd > 0 AND p_rate_to_twd < 'Infinity'::numeric) THEN
    RAISE EXCEPTION '匯率要大於 0 的數字,收到「%」', p_rate_to_twd;
  END IF;

  -- 同幣別序列化:兩個老闆同時改同一幣別 ⇒ 第二個要等第一個 commit 才讀 before,
  -- 否則兩筆稽核都寫「32.5→…」而其中一筆是假的(codex R1 must-fix 2)。交易結束自動放。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('fx_rates:' || v_code));
  -- 🔴 拿到鎖之後才取時間,而且用 clock_timestamp 不用 now():now() 釘在交易開始那一刻,
  --    等鎖等了多久它都不動 ⇒ 別人在我等鎖期間 commit 的列會被「<= now()」漏掉(codex R2 must-fix)。
  v_now := pg_catalog.clock_timestamp();

  -- before = 這個幣別「現在」生效的那一列(可 NULL = 第一次設)
  SELECT * INTO v_before
    FROM public.fx_rates f
   WHERE f.currency_code = v_code AND f.effective_from <= v_now
   ORDER BY f.effective_from DESC
   LIMIT 1;

  INSERT INTO public.fx_rates (currency_code, rate_to_twd, effective_from, created_by)
  VALUES (v_code, p_rate_to_twd, coalesce(p_effective_from, v_now), p_actor)
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (p_actor, 'settings.fx.set', 'fx_rates:' || v_code,
     p_request_id,
     CASE WHEN v_before.id IS NULL THEN NULL
          ELSE pg_catalog.jsonb_build_object('id', v_before.id, 'rate_to_twd', v_before.rate_to_twd,
                 'effective_from', v_before.effective_from) END,
     pg_catalog.jsonb_build_object('id', v_row.id, 'rate_to_twd', v_row.rate_to_twd,
       'effective_from', v_row.effective_from),
     NULL, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_fx_rate_set: 稽核落 % 列(期望恰 1)⇒ 改匯率與留紀錄必須同生共死', v_n;
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok',
    'row', pg_catalog.jsonb_build_object('id', v_row.id, 'currency_code', v_row.currency_code,
      'rate_to_twd', v_row.rate_to_twd, 'effective_from', v_row.effective_from,
      'created_by', v_row.created_by, 'created_at', v_row.created_at));
END;
$fn$;

-- 三道 REVOKE 一道都不省(⟦auth-HALFREVOKEDTRIGGERS⟧),GRANT 只給 service_role。
REVOKE ALL ON FUNCTION public.admin_fx_rate_set(text,text,numeric,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_fx_rate_set(text,text,numeric,timestamptz,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fx_rate_set(text,text,numeric,timestamptz,text) TO service_role;

-- ── 5. 事後斷言(貼的當下就叫)──────────────────────────────────────────────
-- 🔴 清單寫成 `v_relations` / `v_functions` 是靜態檢查③認得的形狀:它防「忘記收權」,不防「忘記列」
--    ⇒ 兩個陣列要涵蓋本檔建的每一個可授權物件(1 表 + 2 函式)。
DO $assert$
DECLARE
  v_relations text[] := ARRAY['public.fx_rates']::text[];
  v_functions text[] := ARRAY[
    'public.admin_fx_rate_set(text,text,numeric,timestamptz,text)',
    'public.pcm_fx_rates_append_only()'
  ]::text[];
  r text;
  v_bad text := NULL;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT')
       OR pg_catalog.has_table_privilege('anon', r, 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', r, 'INSERT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon/authenticated 還有權限');
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 應該要有 SELECT');
    END IF;
    -- 寫只走 RPC(SECURITY DEFINER 以 owner 身分寫)⇒ service_role 不該有任何寫權
    IF pg_catalog.has_table_privilege('service_role', r, 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', r, 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', r, 'DELETE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':service_role 不該有寫權');
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname = pg_catalog.split_part(r, '.', 2)) THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':RLS 沒開');
    END IF;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':anon/authenticated 還有 EXECUTE');
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.admin_fx_rate_set(text,text,numeric,timestamptz,text)', 'EXECUTE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'admin_fx_rate_set:service_role 沒有 EXECUTE');
  END IF;

  -- 兩支 trigger:存在 · 啟用(tgenabled='O')· 指向本檔那支函式
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.fx_rates'::regclass AND NOT t.tgisinternal
         AND t.tgenabled = 'O'
         AND t.tgfoid = 'public.pcm_fx_rates_append_only()'::regprocedure
         AND t.tgname IN ('fx_rates_append_only_row', 'fx_rates_append_only_stmt')) <> 2 THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'fx_rates:append-only 兩支 trigger 不齊 / 沒啟用 / 指錯函式');
  END IF;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:%', v_bad;
  END IF;
END $assert$;

COMMIT;
