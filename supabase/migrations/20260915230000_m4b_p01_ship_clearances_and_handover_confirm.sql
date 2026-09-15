-- 20260915230000_m4b_p01_ship_clearances_and_handover_confirm.sql
-- M-4b · P0-1 片 1a:出貨資格證明表 + 回填 + 管理者「確認已交貨」(plan docs/plans/2026-09-15-card-refund-cancel-blocks-shipping-plan.md §3.3 §3.4)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- 刷卡全退自動取消後, 出貨路徑不看訂單狀態(plan §1)。寄信要判「出貨在先 / 取消在先」, 而 cancelled_at / shipped_at
-- 都是 now() = 交易開始時間, 拿來比會顛倒(codex R2 ⑥)。⇒ 改在出貨持訂單鎖、判準通過那一刻寫一列「這一箱當時可以出這張單」。
-- 本片只建表、回填舊資料、建人工確認交貨的 RPC;寫入端(claim / mark_shipped)在片 1b, 讀取端(view / 寄送端)在片 3 / 片 4。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 表 shipment_order_ship_clearances(shipment_id, order_id) PK;cleared_at 只給人看, 任何判準都不讀。
--    append-only(UPDATE / DELETE / TRUNCATE 一律 RAISE, ENABLE ALWAYS);RLS 零 policy;service_role 只有 SELECT。
-- ② 回填:shipped_at 或 hct_dispatch_attempted_at 有值的箱子(含已作廢)× 箱內每張訂單。
--    唯一用時間戳的地方(舊資料沒有鎖可證先後):取消時間早於交出時間的組合不回填, 而且只要有一組就整支停下。
--    🔴 codex 片 1a R1 must-fix 1:檢查與回填必須看【同一份】集合 ⇒ 鎖 shipments + shipment_items(SHARE, 擋寫不擋讀),
--       集合只算一次存進暫存表, 停止判斷與 INSERT 都從那一份來。
--    🔴 片 3 改 view 之前會再跑同一段回填(ON CONFLICT DO NOTHING):本片到片 1b 之間出貨的箱子還沒有寫入端。
-- ③ admin_confirm_hct_handover:叫過車、結果不明而貨確實交出 ⇒ 管理者填理由寫 hct_dispatched_at, 同交易寫 admin_audit_log。
--    plan §3.4 寫三個參數;admin_audit_log.request_id NOT NULL ⇒ 多一個 p_request_id(同 admin 其他寫入)。
--    理由的空白判定走 pcm_js_trim_whitespace()(codex 片 1a R1 must-fix 2:btrim 預設只剝半形空格, 換行 / Tab / 全形空白會過)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260915230000-rollback.sql:DROP ③;表與回填列保留(plan §9:事實紀錄, 舊函式不讀不寫)。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 回填集合要凍住:shipments(出貨 / 叫車 / 作廢)與 shipment_items(裝箱)都擋寫入。SHARE 與 ROW EXCLUSIVE 互斥, 不擋讀。
-- 取消只改 orders;本片沒有顯式鎖 orders(結帳熱表), 但下面建外鍵的 DDL 會對 orders 取 SHARE ROW EXCLUSIVE 表鎖到交易結束
-- (codex 片 1a R2 nit)⇒ 從建表那一刻起, orders 的寫入(結帳 / 取消)會等本交易提交;回填讀集合時取消也被擋住。
-- 在那之前發生的取消 cancelled_at = 當時 ≥ 過去的交出時間 ⇒ 不會落進排除條件。
LOCK TABLE public.shipments IN SHARE MODE;
LOCK TABLE public.shipment_items IN SHARE MODE;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_n bigint;
BEGIN
  IF pg_catalog.to_regclass('public.shipment_order_ship_clearances') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:shipment_order_ship_clearances 已經在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_confirm_hct_handover(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘二:admin_confirm_hct_handover 已經在 ⇒ 貼過了, 拒重貼';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.shipments'::regclass AND NOT a.attisdropped
     AND a.attname IN ('hct_dispatch_attempted_at', 'hct_dispatched_at', 'shipped_at', 'deleted_at', 'shipment_reference');
  IF v_n <> 5 THEN
    RAISE EXCEPTION '前置閘三:shipments 少了派遣 / 出貨欄(找到 % / 5)⇒ 20260910130000 還沒貼', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.staff'::regclass AND a.attname = 'is_manager' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '前置閘四:staff.is_manager 不在 ⇒ 管理者閘無從判';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipments_hct_dispatched_at_write_once()') IS NULL THEN
    RAISE EXCEPTION '前置閘五:hct_dispatched_at 的 write-once trigger 不在 ⇒ 本片對它的假設不成立';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘六:pcm_js_trim_whitespace() 不在 ⇒ 理由空白判定沒有單一來源可用';
  END IF;
END
$pre$;

-- ── ① 表 ──────────────────────────────────────────────────────
CREATE TABLE public.shipment_order_ship_clearances (
  shipment_id uuid        NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  order_id    uuid        NOT NULL REFERENCES public.orders(id)    ON DELETE RESTRICT,
  cleared_via text        NOT NULL,
  cleared_at  timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT shipment_order_ship_clearances_pkey PRIMARY KEY (shipment_id, order_id),
  CONSTRAINT shipment_order_ship_clearances_via_check CHECK (cleared_via IN ('claim', 'mark_shipped', 'backfill'))
);
CREATE INDEX shipment_order_ship_clearances_order_id_idx ON public.shipment_order_ship_clearances (order_id);

COMMENT ON TABLE public.shipment_order_ship_clearances IS
  'P0-1 出貨資格證明(20260915230000)。一列 = 這一箱在持訂單鎖、pcm_order_ship_blocked 判準通過那一刻, 這張單可以出。'
  '寫入只經 admin_claim_hct_dispatch / admin_mark_shipment_shipped(片 1b)與本檔回填。'
  '讀者:出貨信 / 改單號信的掃描 view(片 3)與寄送端 adapter(片 4)——「有這一列 ⇒ 照寄」, 不比時間戳。'
  'append-only;RLS 零 policy;service_role 只有 SELECT。';
COMMENT ON COLUMN public.shipment_order_ship_clearances.cleared_at IS
  '只給人看(回填列 = 當年的叫車或出貨時間)。🔴 任何判準都不讀這一欄:它與 orders.cancelled_at 都不是提交順序。';

CREATE FUNCTION public.pcm_ship_clearances_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION '出貨資格證明 append-only:寫下之後不可改也不可刪(TG_OP=%)。它記的是當時可以出, 事後改掉等於改寫事實', TG_OP
    USING ERRCODE = 'P0001', CONSTRAINT = 'shipment_order_ship_clearances_append_only';
END;
$fn$;
ALTER FUNCTION public.pcm_ship_clearances_append_only() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_ship_clearances_append_only() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shipment_order_ship_clearances_block_update_bu
  BEFORE UPDATE ON public.shipment_order_ship_clearances
  FOR EACH ROW EXECUTE FUNCTION public.pcm_ship_clearances_append_only();
CREATE TRIGGER shipment_order_ship_clearances_block_delete_bd
  BEFORE DELETE ON public.shipment_order_ship_clearances
  FOR EACH ROW EXECUTE FUNCTION public.pcm_ship_clearances_append_only();
CREATE TRIGGER shipment_order_ship_clearances_block_truncate_bt
  BEFORE TRUNCATE ON public.shipment_order_ship_clearances
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_ship_clearances_append_only();
-- 不 ENABLE ALWAYS 的話 session_replication_role='replica' 一句就繞過(W0b F5 同理)。
ALTER TABLE public.shipment_order_ship_clearances ENABLE ALWAYS TRIGGER shipment_order_ship_clearances_block_update_bu;
ALTER TABLE public.shipment_order_ship_clearances ENABLE ALWAYS TRIGGER shipment_order_ship_clearances_block_delete_bd;
ALTER TABLE public.shipment_order_ship_clearances ENABLE ALWAYS TRIGGER shipment_order_ship_clearances_block_truncate_bt;

ALTER TABLE public.shipment_order_ship_clearances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipment_order_ship_clearances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shipment_order_ship_clearances TO service_role;
-- service_role 今天帶 BYPASSRLS(平台屬性), 而寄送端 adapter 讀這張表時讀不到 ⇒ 每封出貨信都會被判沒有證明而跳過(靜默)。
-- ⇒ 明寫一條 SELECT 政策, 不靠平台特權活著(scripts/rls-service-role-policy-gate.py 的理由)。只給讀, 不給寫。
CREATE POLICY shipment_order_ship_clearances_service_role_select
  ON public.shipment_order_ship_clearances
  FOR SELECT TO service_role
  USING (true);

-- ── ② 回填(集合只算一次)──────────────────────────────────────
CREATE TEMPORARY TABLE p01_backfill_pairs ON COMMIT DROP AS
SELECT DISTINCT s.id AS shipment_id, oi.order_id,
       COALESCE(s.hct_dispatch_attempted_at, s.shipped_at) AS handed_at,
       o.cancelled_at
  FROM public.shipments s
  JOIN public.shipment_items si ON si.shipment_id = s.id
  JOIN public.order_items oi ON oi.id = si.order_item_id
  JOIN public.orders o ON o.id = oi.order_id
 WHERE s.shipped_at IS NOT NULL OR s.hct_dispatch_attempted_at IS NOT NULL;

DO $backfill_gate$
DECLARE
  v_bad bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_bad
    FROM p01_backfill_pairs p
   WHERE p.cancelled_at IS NOT NULL AND p.cancelled_at < p.handed_at;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '回填閘:有 % 組(箱, 單)的取消時間早於交出時間 ⇒ 不知道該不該寄出貨信, 停下人工看(plan §3.3)', v_bad;
  END IF;
END
$backfill_gate$;

INSERT INTO public.shipment_order_ship_clearances (shipment_id, order_id, cleared_via, cleared_at)
SELECT p.shipment_id, p.order_id, 'backfill', p.handed_at
  FROM p01_backfill_pairs p
ON CONFLICT (shipment_id, order_id) DO NOTHING;

-- ── ③ 管理者確認已交貨 ────────────────────────────────────────
CREATE FUNCTION public.admin_confirm_hct_handover(
  p_shipment_reference text,
  p_actor              text,
  p_reason             text,
  p_request_id         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_is_manager boolean;
  v_ship       record;
  v_reason     text;
  v_now        timestamptz := pg_catalog.now();
  v_n          int;
BEGIN
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_confirm_hct_handover:缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_confirm_hct_handover:缺 request_id';
  END IF;
  -- 權限閘形狀照 admin_requeue_dead_email(20260915040000):在職且是管理者, 否則一句話不透露原因。
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND OR NOT coalesce(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  -- 空白定義走單一來源 pcm_js_trim_whitespace()(與寄信 view 同一份), 不用裸 btrim:換行 / Tab / 全形空白都算空白。
  v_reason := nullif(pg_catalog.btrim(p_reason, public.pcm_js_trim_whitespace()), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION '確認已交貨:一定要填理由(例如司機簽收單號、跟新竹確認的人與時間), 這是留給查帳看的';
  END IF;

  SELECT s.id, s.shipment_reference, s.deleted_at, s.hct_dispatch_attempted_at, s.hct_dispatched_at
    INTO v_ship
    FROM public.shipments s
   WHERE s.shipment_reference = p_shipment_reference
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '確認已交貨:查無這張出貨單(%)', p_shipment_reference;
  END IF;
  IF v_ship.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '確認已交貨:出貨單 % 已作廢, 不能確認交貨', v_ship.shipment_reference;
  END IF;
  IF v_ship.hct_dispatch_attempted_at IS NULL THEN
    RAISE EXCEPTION '確認已交貨:出貨單 % 沒有叫過新竹, 這顆按鈕只給「叫過車、結果不明」的箱子', v_ship.shipment_reference;
  END IF;
  IF v_ship.hct_dispatched_at IS NOT NULL THEN
    RAISE EXCEPTION '確認已交貨:出貨單 % 已經有派遣成功的紀錄, 不需要再確認', v_ship.shipment_reference;
  END IF;

  -- 條件全寫進 WHERE:鎖後只有這一句會被重驗(20260910130000 claim 段同理)。
  UPDATE public.shipments
     SET hct_dispatched_at = v_now
   WHERE id = v_ship.id
     AND deleted_at IS NULL
     AND hct_dispatch_attempted_at IS NOT NULL
     AND hct_dispatched_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '確認已交貨:出貨單 % 的狀態剛剛被別人改過, 這次沒有寫入。請重新整理畫面', v_ship.shipment_reference;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (p_actor, 'shipment.hct_handover_confirmed', 'shipment:' || v_ship.id::text,
          pg_catalog.jsonb_build_object('hct_dispatched_at', NULL),
          pg_catalog.jsonb_build_object('hct_dispatched_at', v_now),
          v_reason, p_request_id, 'admin');
END
$fn$;
COMMENT ON FUNCTION public.admin_confirm_hct_handover(text,text,text,text) IS
  'P0-1 §3.4(20260915230000):叫過新竹、派遣結果不明而貨確實交出 ⇒ 管理者填理由, 寫 hct_dispatched_at 並同交易寫 admin_audit_log(shipment.hct_handover_confirmed)。'
  '之後 admin_mark_shipment_shipped 走補記路(片 1b)。被拒 / 沒送出而貨沒交的箱子不走這條:作廢後按標記已取消。';
ALTER FUNCTION public.admin_confirm_hct_handover(text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_confirm_hct_handover(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_confirm_hct_handover(text,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_hct_handover(text,text,text,text) TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列)
  v_functions text[] := ARRAY[
    'public.admin_confirm_hct_handover(text,text,text,text)',
    'public.pcm_ship_clearances_append_only()'
  ]::text[];
  v_relations text[] := ARRAY[
    'public.shipment_order_ship_clearances'
  ]::text[];
  v_bad text := '';
  v_cfg text[];
  r text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '後置閘:% 不存在', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      v_bad := v_bad || r || ' 對 anon/authenticated 開著 EXECUTE;';
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_confirm_hct_handover(text,text,text,text)', 'EXECUTE') THEN
    v_bad := v_bad || 'service_role 不能執行 admin_confirm_hct_handover;';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', 'public.pcm_ship_clearances_append_only()', 'EXECUTE') THEN
    v_bad := v_bad || 'append-only trigger 函式對 service_role 開著;';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_confirm_hct_handover(text,text,text,text)'::regprocedure;
  IF NOT (v_cfg @> ARRAY['search_path=""']) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = 'public.admin_confirm_hct_handover(text,text,text,text)'::regprocedure AND p.prosecdef) THEN
    v_bad := v_bad || 'admin_confirm_hct_handover 不是 SECURITY DEFINER + search_path=空(實得 ' || coalesce(pg_catalog.array_to_string(v_cfg, ','), 'NULL') || ');';
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = r::regclass) THEN
      v_bad := v_bad || r || ' 沒開 RLS;';
    END IF;
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT,INSERT,UPDATE,DELETE')
       OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT,INSERT,UPDATE,DELETE') THEN
      v_bad := v_bad || r || ' 對 anon/authenticated 有權限;';
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', r, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
      v_bad := v_bad || r || ' service_role 應只有 SELECT;';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy pol
       WHERE pol.polrelid = 'public.shipment_order_ship_clearances'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol
                     WHERE pol.polrelid = 'public.shipment_order_ship_clearances'::regclass
                       AND pol.polcmd = 'r' AND pol.polpermissive
                       AND pol.polroles = ARRAY['service_role'::regrole::oid]) THEN
    v_bad := v_bad || '政策不是恰好一條 service_role 的 permissive SELECT;';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = 'public.shipment_order_ship_clearances'::regclass
         AND NOT t.tgisinternal AND t.tgenabled = 'A') <> 3 THEN
    v_bad := v_bad || 'append-only trigger 不是 3 支 ENABLE ALWAYS;';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.shipment_order_ship_clearances)
     <> (SELECT pg_catalog.count(*) FROM p01_backfill_pairs) THEN
    v_bad := v_bad || '回填列數與回填集合不相等;';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION '後置閘失敗:%', v_bad;
  END IF;
  RAISE NOTICE '✅ 20260915230000 後置閘全過:clearance 表 % 列(回填)', (SELECT pg_catalog.count(*) FROM public.shipment_order_ship_clearances);
END
$post$;

COMMIT;
