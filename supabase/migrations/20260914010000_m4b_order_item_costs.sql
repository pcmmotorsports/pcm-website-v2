-- 20260914010000_m4b_order_item_costs.sql
-- 訂單品項成本(「老闆:成本」模式)的資料表 + 唯一寫入口。plan `docs/plans/2026-09-14-order-item-cost-columns-plan.md` §1-a / §1-b, 切片 B1。
-- Sean 2026-09-14 拍「Q3 都做好」;09-13 拍板(memory `project_0913-admin-order-ux-redesign-rulings`):
--   成本三欄都是外幣, 乘匯率才是台幣;原價 / 運費 整列一個數、稅金 × 數量;成本欄老闆才看;改匯率不回頭重算。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。版本號 20260914010000(主視窗 2026-09-14 00:5x 全 branch + 五個 worktree 掃過零撞號;貼的當天重掃)。
--
-- ── 一句 ─────────────────────────────────────────────────────────────────────
--   每個品項最多一列成本(外幣三欄 + 幣別 + 寫入當下抄的匯率)。台幣總計 / 利潤**不存**, 讀時算。
--
-- ── 🔴 為什麼是新表不是 `order_items` 加欄(plan §1-a)──────────────────────
--   `order_items` 對 `authenticated` 有 GRANT SELECT + RLS「客人讀自己的單」(`20260604120000:190-196`)
--   ⇒ 加在那張表 = 成本直接落到一般會員讀得到的列。新表零 anon / authenticated 權, 寫只走 RPC。
--   同形先例:`order_item_quantity_summary`(`20260730150000:79`)。
--
-- ── 形狀(逐條抄 20260913070000 fx_rates)─────────────────────────────────────
--   · 裸 `CREATE`(不 OR REPLACE):新物件撞名要當場紅。不宣告 `pcm:idempotent`;本支零頂層 DML。
--   · RPC `SECURITY DEFINER` + `SET search_path = ''`, body 物件全帶 schema 全名。
--   · 身分閘只准 `SELECT … INTO` + `IF NOT FOUND` + `coalesce(…, false)`(actor 不存在 / 停用 ⇒ 擋)。
--   · 稽核與寫入同一筆交易 + 筆數守(每列一筆);`p_request_id` 空 ⇒ RAISE。
--   · service_role 表權只給 SELECT;寫一律走 RPC。序列零(本表沒序列)。
--
-- ── 匯率快照(plan §1-a、R2)─────────────────────────────────────────────────
--   RPC 內查該幣別 `fx_rates` `effective_from <= clock_timestamp()` 最新一列, 把 `rate_to_twd` 與 `id` 一起抄進本表。
--   查無 ⇒ RAISE「這個幣別還沒設過匯率, 先到 設定 › 匯率 填」—— 不默默寫 0。TWD 固定 1、`fx_rate_id` NULL(CHECK)。
--   🔴 改匯率**不回頭重算**:本表存的是寫入當下那一筆的抄本。要重算 = 老闆再按一次確認(同一支 RPC 會重抄現在的匯率)。
--
-- ── 台幣算式(讀時算, 住 TS `apps/admin/src/lib/orders/cost-view.ts`, 本檔不存)───────────
--   cost_twd = round((cost_price + cost_shipping + cost_tax * qty) * fx_rate)(只在最後 round 一次, 四捨五入到整數元)
--   profit_twd = order_items.line_total − cost_twd
--
-- ── ROLLBACK ═══════════════════════════════════════════════════════════════
--   `supabase/rollbacks/20260914010000-rollback.sql`:DROP 一支 RPC + 一張表。
--   🔴 表 DROP 會連已填的成本一起丟。空表可直接退;已有列 ⇒ 先另存一份再退。稽核列不刪(append-only)。
--
-- ── 實測(2026-09-14, 拋棄式 PG 17.10, 整條鏈從零重播;見 commit body)────────────
--   正:manager 寫兩列(EUR 有匯率 / TWD)⇒ 2 列 + 2 筆稽核, 匯率抄進去;再寫同一列 ⇒ UPDATE + before 有值。
--   負:非 manager / 停用 staff ⇒ 無權;空陣列 ⇒ RAISE;幣別無匯率 ⇒ RAISE 那句人話;負數 / NaN ⇒ RAISE;
--       TWD 帶 fx_rate_id ⇒ CHECK;不在白名單的幣別 ⇒ RAISE;p_request_id 空 ⇒ RAISE;
--       authenticated 直讀表 ⇒ 42501;service_role 直寫 ⇒ 42501;同批重複 id ⇒ 2 筆稽核 before/after 串接(500→1→2)。
--   退回檔(supabase/rollbacks 那支)套完 ⇒ 表與 RPC 都不在;再套本支 ⇒ 綠。
--   codex R1 兩條 must-fix 已修:① 稽核頁對非 manager 遮成本 before/after(`app/settings/audit/page.tsx`)
--   ② 匯率查詢搬到拿鎖之後(等鎖期間別人存的新快照不會被舊匯率蓋回去);nit:整批先照固定順序拿鎖(防死結)。

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.order_item_costs') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.order_item_costs 已存在 ⇒ 本支貼過了或撞名,停下';
  END IF;
  IF pg_catalog.to_regclass('public.order_items') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.order_items';
  END IF;
  IF pg_catalog.to_regclass('public.fx_rates') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.fx_rates ⇒ 20260913070000 沒貼;本支要抄它的匯率';
  END IF;
  IF pg_catalog.to_regclass('public.staff') IS NULL OR pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 public.staff 或 public.admin_audit_log';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='staff' AND column_name='id') <> 'text' THEN
    RAISE EXCEPTION '前置閘⑤:public.staff.id 不是 text ⇒ 本支簽章要重寫,停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='public.admin_audit_log'::regclass
                    AND conname='admin_audit_log_request_id_nonempty') THEN
    RAISE EXCEPTION '前置閘⑥:admin_audit_log_request_id_nonempty 不見了 ⇒ 本支對 request_id 的假設要重讀';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='fx_rates' AND column_name='id') <> 'bigint' THEN
    RAISE EXCEPTION '前置閘⑦:public.fx_rates.id 不是 bigint ⇒ fx_rate_id 型別要跟著改,停下';
  END IF;
END $$;

-- ── 1. 表 ───────────────────────────────────────────────────────────────────
CREATE TABLE public.order_item_costs (
  order_item_id  uuid           PRIMARY KEY REFERENCES public.order_items(id) ON DELETE CASCADE,
  -- 三欄都是【外幣】(Sean 09-13);numeric 不用 float(CLAUDE.md 硬線)。numeric 收得下 NaN / Infinity, NaN 比任何數都大 ⇒ 兩邊都夾。
  cost_price     numeric(14,4)  NOT NULL DEFAULT 0,
  cost_shipping  numeric(14,4)  NOT NULL DEFAULT 0,
  cost_tax       numeric(14,4)  NOT NULL DEFAULT 0,
  currency       text           NOT NULL,
  -- 寫入當下從 fx_rates 抄的匯率(1 單位外幣 = 多少台幣)與那一列的 id;TWD 固定 1 / NULL。
  fx_rate        numeric        NOT NULL,
  fx_rate_id     bigint         REFERENCES public.fx_rates(id),
  updated_by     text           NOT NULL REFERENCES public.staff(id),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT order_item_costs_price_nonneg    CHECK (cost_price    >= 0 AND cost_price    < 'Infinity'::numeric),
  CONSTRAINT order_item_costs_shipping_nonneg CHECK (cost_shipping >= 0 AND cost_shipping < 'Infinity'::numeric),
  CONSTRAINT order_item_costs_tax_nonneg      CHECK (cost_tax      >= 0 AND cost_tax      < 'Infinity'::numeric),
  -- 白名單 = `apps/admin/src/lib/fx/fx-rate-view.ts` FX_CURRENCIES 那十個(fx-rate-view.test 釘著順序);兩邊要一起改。
  CONSTRAINT order_item_costs_currency_domain CHECK (currency IN ('EUR','IDR','GBP','THB','AUD','USD','TWD','JPY','CNY','SGD')),
  CONSTRAINT order_item_costs_fx_positive     CHECK (fx_rate > 0 AND fx_rate < 'Infinity'::numeric),
  CONSTRAINT order_item_costs_twd_is_one      CHECK (currency <> 'TWD' OR (fx_rate = 1 AND fx_rate_id IS NULL)),
  CONSTRAINT order_item_costs_foreign_has_ref CHECK (currency = 'TWD' OR fx_rate_id IS NOT NULL)
);
COMMENT ON TABLE public.order_item_costs IS
  '訂單品項成本(老闆:成本模式;20260914010000)。三欄外幣 + 幣別 + 寫入當下抄的匯率(改匯率不回頭重算)。'
  '台幣總計 / 利潤不存, 讀時算(cost-view.ts)。零 anon/authenticated 權;寫只走 admin_set_order_item_costs(is_manager 才能)。';
COMMENT ON COLUMN public.order_item_costs.cost_tax IS '外幣、【每件】;台幣算式乘數量(原價 / 運費是整列一個數, 不乘)。';
COMMENT ON COLUMN public.order_item_costs.fx_rate IS '寫入當下 fx_rates 生效列的 rate_to_twd 抄本;TWD = 1。';

-- ── 2. 表級 ACL + RLS ───────────────────────────────────────────────────────
-- 🔴 REVOKE 先、含 service_role:空庫世界的 shim 用 ALTER DEFAULT PRIVILEGES 讓新表出生就帶
--    service_role 全權(20260907070000 拋棄式 PG 抓到的), 明文 REVOKE 讓兩個世界終態一致。
REVOKE ALL ON TABLE public.order_item_costs FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT SELECT ON TABLE public.order_item_costs TO service_role;
GRANT SELECT ON TABLE public.order_item_costs TO pcm_readonly;

ALTER TABLE public.order_item_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_item_costs_select_service_role ON public.order_item_costs
  FOR SELECT TO service_role USING (true);
-- anon / authenticated 刻意零政策 + 零表權, 兩層都在(成本不到一般會員瀏覽器:CLAUDE.md Server 端鐵則)。

-- ── 3. 唯一寫入口 ───────────────────────────────────────────────────────────
-- p_rows = jsonb 陣列, 每個元素 {order_item_id, cost_price, cost_shipping, cost_tax, currency}(金額字串, 這裡 ::numeric)。
-- 批次一發、同一交易:任一列失敗整批回滾(老闆按「確認全部」不會存到一半)。回 jsonb {result:'ok', written:N}。
CREATE FUNCTION public.admin_set_order_item_costs(
  p_actor       text,
  p_rows        jsonb,
  p_request_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_row        jsonb;
  v_item_id    uuid;
  v_currency   text;
  v_price      numeric;
  v_shipping   numeric;
  v_tax        numeric;
  v_fx_rate    numeric;
  v_fx_id      bigint;
  v_now        timestamptz;
  v_before     public.order_item_costs%ROWTYPE;
  v_after      public.order_item_costs%ROWTYPE;
  v_written    integer := 0;
  v_audited    integer := 0;
  v_n          integer;
BEGIN
  SET LOCAL lock_timeout = '3s';
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_set_order_item_costs: p_request_id 不可為空(稽核那一欄 NOT NULL + CHECK)';
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

  IF p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array' OR pg_catalog.jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'admin_set_order_item_costs: p_rows 要是非空陣列';
  END IF;

  -- 🔴 先照【固定順序】把整批品項的鎖全部拿到, 再照原陣列處理(codex nit:兩批 [X,Y] / [Y,X] 交錯會死結;
  --    死結整批失敗不會留半套, 但老闆會看到一句看不懂的 40P01)。排序 = uuid 文字序, 重複的 id 鎖一次就夠(同交易可重入)。
  FOR v_item_id IN
    SELECT DISTINCT (e ->> 'order_item_id')::uuid
      FROM pg_catalog.jsonb_array_elements(p_rows) e
     WHERE pg_catalog.jsonb_typeof(e) = 'object' AND (e ->> 'order_item_id') ~ '^[0-9a-fA-F-]{36}$'
     ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('order_item_costs:' || v_item_id::text));
  END LOOP;

  FOR v_row IN SELECT * FROM pg_catalog.jsonb_array_elements(p_rows) LOOP
    IF pg_catalog.jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'admin_set_order_item_costs: p_rows 的元素要是物件';
    END IF;
    BEGIN
      v_item_id := (v_row ->> 'order_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'admin_set_order_item_costs: order_item_id 不是 uuid(收到「%」)', v_row ->> 'order_item_id';
    END;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'admin_set_order_item_costs: 缺 order_item_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.id = v_item_id) THEN
      RAISE EXCEPTION 'admin_set_order_item_costs: 找不到品項 %', v_item_id;
    END IF;

    v_currency := pg_catalog.upper(pg_catalog.btrim(coalesce(v_row ->> 'currency', '')));
    IF v_currency NOT IN ('EUR','IDR','GBP','THB','AUD','USD','TWD','JPY','CNY','SGD') THEN
      RAISE EXCEPTION '幣別「%」不在清單裡(設定 › 匯率 那十個)', v_row ->> 'currency';
    END IF;

    -- 三個金額:字串 ⇒ numeric;缺 = 0;NaN / 負 / Infinity 擋(CHECK 也擋, 這裡先給人話)
    -- ⚠️ `nullif` / `coalesce` 是語法構造不是 pg_catalog 函式:寫成 `pg_catalog.nullif(...)` 會 42883、被下面的 WHEN OTHERS
    --    吃掉變成「成本要是數字」—— 拋棄式 PG 正對照第一發就是這樣紅的, 不要再加前綴。
    BEGIN
      v_price    := coalesce(nullif(pg_catalog.btrim(v_row ->> 'cost_price'), ''), '0')::numeric;
      v_shipping := coalesce(nullif(pg_catalog.btrim(v_row ->> 'cost_shipping'), ''), '0')::numeric;
      v_tax      := coalesce(nullif(pg_catalog.btrim(v_row ->> 'cost_tax'), ''), '0')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '成本要是數字(品項 %:原價「%」運費「%」稅金「%」)', v_item_id,
        v_row ->> 'cost_price', v_row ->> 'cost_shipping', v_row ->> 'cost_tax';
    END;
    IF NOT (v_price >= 0 AND v_price < 'Infinity'::numeric)
       OR NOT (v_shipping >= 0 AND v_shipping < 'Infinity'::numeric)
       OR NOT (v_tax >= 0 AND v_tax < 'Infinity'::numeric) THEN
      RAISE EXCEPTION '成本要是 0 或正數(品項 %)', v_item_id;
    END IF;

    -- 🔴 拿到鎖【之後】才取時間、才查匯率(codex 2026-09-14 must-fix ②):等鎖期間別人可能存了較新的匯率快照,
    --    鎖前查到的舊匯率會把它覆蓋回去。clock_timestamp 不用 now():now() 釘在交易開始那一刻(070000 那條理由)。
    v_now := pg_catalog.clock_timestamp();
    -- 匯率快照:TWD 固定 1 / NULL;外幣抄現在生效的那一列, 查無 ⇒ RAISE 人話(不默默寫 0)
    IF v_currency = 'TWD' THEN
      v_fx_rate := 1; v_fx_id := NULL;
    ELSE
      SELECT f.rate_to_twd, f.id INTO v_fx_rate, v_fx_id
        FROM public.fx_rates f
       WHERE f.currency_code = v_currency AND f.effective_from <= v_now
       ORDER BY f.effective_from DESC
       LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION '% 還沒設過匯率,先到 設定 › 匯率 填', v_currency;
      END IF;
    END IF;

    -- 這一列的鎖在上面那一圈已拿到(同交易可重入;這裡再拿一次是為了「id 沒過那道正規式篩子」的路也被鎖住)
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('order_item_costs:' || v_item_id::text));
    SELECT * INTO v_before FROM public.order_item_costs c WHERE c.order_item_id = v_item_id;

    INSERT INTO public.order_item_costs
      (order_item_id, cost_price, cost_shipping, cost_tax, currency, fx_rate, fx_rate_id, updated_by, updated_at)
    VALUES (v_item_id, v_price, v_shipping, v_tax, v_currency, v_fx_rate, v_fx_id, p_actor, v_now)
    ON CONFLICT (order_item_id) DO UPDATE
      SET cost_price = EXCLUDED.cost_price, cost_shipping = EXCLUDED.cost_shipping, cost_tax = EXCLUDED.cost_tax,
          currency = EXCLUDED.currency, fx_rate = EXCLUDED.fx_rate, fx_rate_id = EXCLUDED.fx_rate_id,
          updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_after;
    v_written := v_written + 1;

    INSERT INTO public.admin_audit_log
      (actor, action, target, request_id, before, after, reason, source_app)
    VALUES
      (p_actor, 'orders.item.costs.set', 'order_item:' || v_item_id::text,
       p_request_id,
       CASE WHEN v_before.order_item_id IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object('cost_price', v_before.cost_price, 'cost_shipping', v_before.cost_shipping,
                   'cost_tax', v_before.cost_tax, 'currency', v_before.currency, 'fx_rate', v_before.fx_rate,
                   'fx_rate_id', v_before.fx_rate_id) END,
       pg_catalog.jsonb_build_object('cost_price', v_after.cost_price, 'cost_shipping', v_after.cost_shipping,
         'cost_tax', v_after.cost_tax, 'currency', v_after.currency, 'fx_rate', v_after.fx_rate,
         'fx_rate_id', v_after.fx_rate_id),
       NULL, 'admin');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_audited := v_audited + v_n;
  END LOOP;

  IF v_audited <> v_written THEN
    RAISE EXCEPTION 'admin_set_order_item_costs: 稽核落 % 列、寫入 % 列 ⇒ 改成本與留紀錄必須同生共死', v_audited, v_written;
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok', 'written', v_written);
END;
$fn$;

-- 三道 REVOKE 一道都不省(⟦auth-HALFREVOKEDTRIGGERS⟧), GRANT 只給 service_role。
REVOKE ALL ON FUNCTION public.admin_set_order_item_costs(text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_order_item_costs(text,jsonb,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_order_item_costs(text,jsonb,text) TO service_role;

-- ── 4. 事後斷言(貼的當下就叫)──────────────────────────────────────────────
-- 🔴 清單寫成 `v_relations` / `v_functions` 是靜態檢查③認得的形狀:它防「忘記收權」, 不防「忘記列」
--    ⇒ 兩個陣列要涵蓋本檔建的每一個可授權物件(1 表 + 1 函式)。
DO $assert$
DECLARE
  v_relations text[] := ARRAY['public.order_item_costs']::text[];
  v_functions text[] := ARRAY['public.admin_set_order_item_costs(text,jsonb,text)']::text[];
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
       'public.admin_set_order_item_costs(text,jsonb,text)', 'EXECUTE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'admin_set_order_item_costs:service_role 沒有 EXECUTE');
  END IF;
  -- SECURITY DEFINER + 空 search_path 真的存進去了(definer-search-path-gate 看檔面, 這裡看 catalog)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.admin_set_order_item_costs(text,jsonb,text)'::regprocedure
                    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'admin_set_order_item_costs:不是 SECURITY DEFINER 或 search_path 不是空字串');
  END IF;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:%', v_bad;
  END IF;
END $assert$;

COMMIT;
