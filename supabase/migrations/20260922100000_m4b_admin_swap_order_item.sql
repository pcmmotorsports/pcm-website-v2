-- 20260922100000_m4b_admin_swap_order_item.sql —— 後台訂單「換商品」:同一交易刪掉 A 品項列、新增 B 品項列
--
-- 🛑 未貼(寫好不貼;貼板由主視窗在 Sean 點名後負責)。
-- plan `docs/plans/2026-09-22-admin-order-item-swap-plan.md`(Sean 2026-09-22 批准;Q1–Q5 全甲;Codex 計畫審 R1 修完、R2 PASS)。
-- pcm:idempotent: no
--   理由:裸 CREATE FUNCTION(新物件)⇒ 重跑會撞「已存在」;前置閘①先擋, 訊息講清楚。
--
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- 新 RPC `admin_swap_order_item(p_actor, p_request_id, p_order_id, p_item_id, p_expected_order_version, p_new_variant_id)`:
--   · 只有「完全還沒處理」的品項能換(plan §4):沒有採購 / 出貨 / 取消 / 退款 / 改價申請的列, 數量摘要沒有列或全 0,
--     而且整張單沒有任何退款。
--   · A、B 目前的目錄價依 orders.tier_at_checkout 算(store ⇒ coalesce(price_store, price_general);其他 ⇒ price_general,
--     與 create_order 20260915100000:372-379 同一套)必須相等;B 的單價 / 數量 / 金額照抄 A ⇒ 訂單金額一分不動。
--   · 刪 A:數量摘要、成本 CASCADE 跟著刪;刪除稽核 trigger(20260907070000:183,229)會把 A 整列寫進 orders_deleted_log。
--   · 新增 B(新品項 id)⇒ 開著舊畫面的採購 / 成本 / 部分取消 / 出貨送出時, 指向的 A 已不存在 ⇒ 被擋, 不必改既有 RPC。
--   · 訂單 version +1 ⇒ 舊的改價 / 申請畫面也被擋。
--   · 操作紀錄 action `order.item.swap`、target `order:<訂單 id>`;before 記 A 的料號 / 品名 / 成本, after 記 B 與請求指紋。
--
-- ══ 回傳(jsonb)══════════════════════════════════════════════════════
--   {result:'swapped',  new_item_id}            換好了
--   {result:'idempotent', new_item_id}          同一個 request id、同樣內容重送 ⇒ 回上次結果, 不再動
--   {result:'conflict'}                         訂單 version 對不上(別人改過)
--   {result:'noop'}                             B 與 A 是同一個規格
--   {result:'rejected', reason:'<代碼>'}        業務條件不過;這之前什麼都沒寫
--     🔴 回代碼不回中文:畫面由 TS 把代碼換成固定的中文提示(白名單), 不把 DB 的字放進網址 ——
--        放進網址等於讓任何人改網址就能在後台畫面上顯示任意文字。
--     代碼:request_reused / item_not_found / order_cancelled / item_processed / item_in_shipment /
--           item_cancelled / item_amount_requested / order_refunded / source_variant_missing /
--           target_not_found / target_delisted / price_missing / price_mismatch / item_has_relations /
--           catalog_busy(商品資料正在同步, 請稍後再試)
--   參數錯 / 無權 ⇒ RAISE(程式錯或權限問題, 不是員工能修的)。
--
-- ══ 鎖序(plan §4)════════════════════════════════════════════════════
--   ① advisory `order_item_swap:<request id>`(同請求序列化;在「確認 A 存在」之前, 否則成功後的重送必然失敗)
--   ② orders FOR NO KEY UPDATE(同 admin_update_order_item_amount 20260915060000:1694)
--   ③ advisory `order_item_costs:<A id>`(同 admin_set_order_item_costs 20260914010000:174 那把, 同樣「先這把、再碰品項」)
--   ④ product_variants A、B 與母商品 FOR SHARE NOWAIT(與商品同步同方向:規格在前、品項在後;鎖住才讀價格)
--   ⑤ order_items A FOR UPDATE(接著要刪, 刪除本來就要這個強度)
--   🔴 不是對 orders 用 FOR UPDATE —— 那會與 order_items 的外鍵 KEY SHARE 死結(20260915060000:1690-1691 那段註解)。
--
-- ══ ROLLBACK ══════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
--   🔴 那一行不是裝飾:rollback 是人貼進 psql 跑的, 而 psql 預設沒有 lock_timeout ⇒ 卡鎖時會無限等。
-- supabase/rollbacks/20260922100000-rollback.sql = DROP FUNCTION。新函式, 拿掉不影響任何既有功能。
--   🔴 順序:先 revert 程式(換商品入口)再跑 rollback, 否則畫面按下去會 PGRST202。
--   已經換過的品項不會換回來(那是資料, 不是結構);要換回用同一個功能, 或照現有流程取消重建。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:admin_swap_order_item 已存在 ⇒ 本支貼過了, 停下';
  END IF;
  IF pg_catalog.to_regclass('public.order_items') IS NULL OR pg_catalog.to_regclass('public.orders') IS NULL
     OR pg_catalog.to_regclass('public.product_variants') IS NULL OR pg_catalog.to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 orders / order_items / product_variants / products';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL OR pg_catalog.to_regclass('public.staff') IS NULL
     OR pg_catalog.to_regclass('public.orders_deleted_log') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 admin_audit_log / staff / orders_deleted_log';
  END IF;
  -- 🔴 下面每一張都是本函式要檢查「有沒有 A 的列」的表;少一張 ⇒ 檢查會漏 ⇒ 停下。
  IF pg_catalog.to_regclass('public.order_item_procurement') IS NULL OR pg_catalog.to_regclass('public.shipment_items') IS NULL
     OR pg_catalog.to_regclass('public.order_cancellation_items') IS NULL OR pg_catalog.to_regclass('public.order_refund_items') IS NULL
     OR pg_catalog.to_regclass('public.order_refund_job_items') IS NULL OR pg_catalog.to_regclass('public.order_amount_requests') IS NULL
     OR pg_catalog.to_regclass('public.order_item_quantity_summary') IS NULL OR pg_catalog.to_regclass('public.order_item_costs') IS NULL
     OR pg_catalog.to_regclass('public.order_refunds') IS NULL OR pg_catalog.to_regclass('public.order_refund_jobs') IS NULL
     OR pg_catalog.to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '前置閘④:本函式要檢查的關聯表少了一張 ⇒ 停下';
  END IF;
  IF (SELECT c.data_type FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'staff' AND c.column_name = 'id') <> 'text' THEN
    RAISE EXCEPTION '前置閘⑤:public.staff.id 不是 text ⇒ 本支簽章要重寫, 停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'member_tier' AND e.enumlabel = 'store') THEN
    RAISE EXCEPTION '前置閘⑥:member_tier 沒有 store ⇒ 取價分支要重寫, 停下';
  END IF;
END
$pre$;

-- ── 函式 ────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_swap_order_item(
  p_actor                  text,
  p_request_id             text,
  p_order_id               uuid,
  p_item_id                uuid,
  p_expected_order_version integer,
  p_new_variant_id         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_fingerprint jsonb;
  v_prev        jsonb;
  v_ord         public.orders%ROWTYPE;
  v_item        public.order_items%ROWTYPE;
  v_a           record;
  v_b           record;
  v_a_price     integer;
  v_b_price     integer;
  v_cost        jsonb;
  v_new_id      uuid;
  v_rows        integer;
  v_a_variant   uuid;
BEGIN
  -- ① 參數與操作者
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_swap_order_item: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_swap_order_item: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_item_id IS NULL OR p_new_variant_id IS NULL OR p_expected_order_version IS NULL THEN
    RAISE EXCEPTION 'admin_swap_order_item: 缺 order_id / item_id / new_variant_id / expected_order_version';
  END IF;
  IF p_expected_order_version < 1 OR p_expected_order_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_swap_order_item: expected_order_version 越界';
  END IF;
  -- 🔴 執行期斷言隔離級別(Codex 實作審 R2 must-fix):防重送靠「拿到 advisory lock 之後查稽核看得到上一筆」,
  --    而那只在 read committed 成立 —— repeatable read / serializable 的快照在等鎖之前就定了,
  --    拿到鎖之後仍看不到別人剛提交的那一筆 ⇒ 同一個 request id 會成功兩次。
  --    形狀抄 repo 既有慣例(pcm_order_refund_cap_guard 20260902010000 那一段)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_swap_order_item: 交易隔離級別必須是 read committed(目前 %)',
      pg_catalog.current_setting('transaction_isolation');
  END IF;
  -- Sean Q2 甲:所有在職員工都可以換(金額不變、每次都有紀錄)⇒ 不加管理者閘。
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- ② 防重送:同請求序列化 → 查上次結果(🔴 必須在「確認 A 存在」之前 —— 成功後 A 已被刪)
  v_fingerprint := pg_catalog.jsonb_build_object(
    'order_id', p_order_id, 'item_id', p_item_id,
    'new_variant_id', p_new_variant_id, 'expected_order_version', p_expected_order_version);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('order_item_swap:' || p_request_id));
  SELECT l.after INTO v_prev
    FROM public.admin_audit_log l
   WHERE l.action = 'order.item.swap' AND l.request_id = p_request_id
   LIMIT 1;
  IF FOUND THEN
    IF v_prev -> 'request' = v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('result', 'idempotent', 'new_item_id', v_prev ->> 'item_id');
    END IF;
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'request_reused');
  END IF;

  -- ③ 鎖訂單(同修改單價那支)
  SELECT * INTO v_ord FROM public.orders o WHERE o.id = p_order_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_swap_order_item: 訂單不存在';
  END IF;

  -- ④ 成本那把鎖(與 admin_set_order_item_costs 同名、同順序)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('order_item_costs:' || p_item_id::text));

  -- ⑤ 先鎖 A、B 兩個規格與母商品, 再碰品項(Codex 實作審 R1 must-fix 1、2):
  --   · 價格要在鎖住之後才讀 —— 否則兩次讀之間商品批次同步可能把 A、B 的價格對調, 誤判同價。
  --   · 商品同步 `sync_product_variant_group` 是「先鎖規格、再刪規格 ⇒ 外鍵 SET NULL 碰品項」;
  --     換商品若先鎖品項再碰規格就是反向 ⇒ 會死結。這裡改成同方向:規格在前、品項在後。
  --   · NOWAIT:商品正在同步就直接回「請稍後再試」, 不排隊等(排隊等才會產生等待環)。
  SELECT i.variant_id INTO v_a_variant FROM public.order_items i
   WHERE i.id = p_item_id AND i.order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_not_found');
  END IF;
  BEGIN
    PERFORM 1
       FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id IN (v_a_variant, p_new_variant_id)
      ORDER BY pv.id
        FOR SHARE OF pv, p NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'catalog_busy');
  END;

  -- ⑥ 鎖 A;🔴 同時限定 order_id ⇒ 不能用甲單的鎖改乙單的品項
  SELECT * INTO v_item FROM public.order_items i
   WHERE i.id = p_item_id AND i.order_id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_not_found');
  END IF;
  -- 上一步讀規格到這一步上鎖之間, A 的規格被改掉(例如商品同步把它設成 NULL)⇒ 剛才鎖的不是它 ⇒ 請重試。
  IF v_item.variant_id IS DISTINCT FROM v_a_variant THEN
    RETURN pg_catalog.jsonb_build_object('result', 'conflict');
  END IF;

  -- ── 全部鎖到之後才檢查 ──
  IF v_ord.cancelled_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'order_cancelled');
  END IF;
  IF v_ord.version <> p_expected_order_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'conflict');
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_item_procurement x WHERE x.order_item_id = p_item_id)
     OR EXISTS (SELECT 1 FROM public.order_item_quantity_summary q
                 WHERE q.order_item_id = p_item_id
                   AND (q.ordered_quantity <> 0 OR q.instock_quantity <> 0
                        OR q.cancelled_quantity <> 0 OR q.shipped_quantity <> 0)) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_processed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.shipment_items x WHERE x.order_item_id = p_item_id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_in_shipment');
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_cancellation_items x WHERE x.order_item_id = p_item_id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_cancelled');
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_amount_requests x WHERE x.order_item_id = p_item_id) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_amount_requested');
  END IF;
  -- 整張單沒有任何退款(plan §4 條件 4;品項層的退款明細也由這裡一併擋掉)
  IF v_ord.payment_status::text IN ('refunded', 'partiallyRefunded')
     OR EXISTS (SELECT 1 FROM public.order_refunds r WHERE r.order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM public.order_refund_jobs j WHERE j.order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM public.order_refund_items ri WHERE ri.order_item_id = p_item_id)
     OR EXISTS (SELECT 1 FROM public.order_refund_job_items ji WHERE ji.order_item_id = p_item_id)
     OR EXISTS (SELECT 1 FROM public.order_manual_refunds m WHERE m.order_id = p_order_id AND m.voided_at IS NULL) THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'order_refunded');
  END IF;

  -- 同價(A、B 目前的目錄價;與 create_order 同一套取價)
  IF v_item.variant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'source_variant_missing');
  END IF;
  IF v_item.variant_id = p_new_variant_id THEN
    RETURN pg_catalog.jsonb_build_object('result', 'noop');
  END IF;
  SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
         p.title, p.delisted_at, p.availability AS product_availability
    INTO v_a
    FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
   WHERE pv.id = v_item.variant_id;
  SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.price_store, pv.availability AS variant_availability,
         p.title, p.delisted_at, p.availability AS product_availability
    INTO v_b
    FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
   WHERE pv.id = p_new_variant_id;
  IF v_b.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'target_not_found');
  END IF;
  IF v_b.delisted_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'target_delisted');
  END IF;
  IF v_a.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'source_variant_missing');
  END IF;
  -- 🔴 照等級代碼判斷:store 在後台顯示「車行」、premiumStore 顯示「經銷」(order-list-view.ts:303)——不能照中文名稱。
  IF v_ord.tier_at_checkout = 'store'::public.member_tier THEN
    v_a_price := coalesce(v_a.price_store, v_a.price_general);
    v_b_price := coalesce(v_b.price_store, v_b.price_general);
  ELSE
    v_a_price := v_a.price_general;
    v_b_price := v_b.price_general;
  END IF;
  IF v_a_price IS NULL OR v_b_price IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'price_missing');
  END IF;
  IF v_a_price <> v_b_price THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'price_mismatch', 'source_price', v_a_price, 'target_price', v_b_price);
  END IF;

  -- ── 寫入 ──
  SELECT pg_catalog.to_jsonb(c) - 'order_item_id' INTO v_cost
    FROM public.order_item_costs c WHERE c.order_item_id = p_item_id;

  -- 刪 A(數量摘要、成本 CASCADE;刪除稽核 trigger 寫 orders_deleted_log)。
  -- 🔴 上面已逐表檢查;萬一還有漏掉的關聯, 外鍵會擋下 ⇒ 轉成員工看得懂的一句話, 整筆不動。
  BEGIN
    DELETE FROM public.order_items i WHERE i.id = p_item_id AND i.order_id = p_order_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN pg_catalog.jsonb_build_object('result', 'rejected',
      'reason', 'item_has_relations');
  END;

  INSERT INTO public.order_items (
    order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total,
    availability_at_checkout, vehicle_snapshot, workflow_status
  ) VALUES (
    v_item.order_id, v_b.id, v_b.sku,
    pg_catalog.jsonb_build_object('title', v_b.title, 'sku', v_b.sku, 'spec', v_b.spec),
    v_item.quantity, v_item.unit_price, v_item.line_total,
    CASE WHEN v_b.variant_availability = 'in-stock' AND v_b.product_availability = 'in-stock'
         THEN 'in-stock' ELSE 'out-of-stock' END,
    v_item.vehicle_snapshot, v_item.workflow_status
  )
  RETURNING id INTO v_new_id;

  -- 訂單 version +1;小計 / 總額不動(各品項金額加總沒變, 交易結束時 pcm_e13_items_subtotal_guard 會確認)。
  UPDATE public.orders o
     SET version = v_ord.version + 1,
         updated_at = pg_catalog.now()
   WHERE o.id = p_order_id AND o.version = p_expected_order_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_swap_order_item: 訂單更新列數異常(%)', v_rows;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.item.swap',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'order_id',     p_order_id,
      'item_id',      v_item.id,
      'variant_id',   v_item.variant_id,
      'sku',          v_item.variant_sku,
      'title',        v_item.product_snapshot ->> 'title',
      'spec',         v_item.product_snapshot -> 'spec',
      'quantity',     v_item.quantity,
      'unit_price',   v_item.unit_price,
      'availability', v_item.availability_at_checkout,
      'item_cost',    v_cost
    ),
    pg_catalog.jsonb_build_object(
      'order_id',     p_order_id,
      'item_id',      v_new_id,
      'variant_id',   v_b.id,
      'sku',          v_b.sku,
      'title',        v_b.title,
      'spec',         v_b.spec,
      'catalog_price', v_b_price,
      'request',      v_fingerprint
    ),
    p_request_id,
    'admin'
  );

  RETURN pg_catalog.jsonb_build_object('result', 'swapped', 'new_item_id', v_new_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid) TO service_role;

COMMENT ON FUNCTION public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid) IS
  '後台換商品(20260922100000;plan 2026-09-22-admin-order-item-swap-plan.md)。同一交易刪 A 品項列、新增 B 品項列;'
  '只准完全還沒處理的品項、整張單無退款、A 與 B 目前目錄價相同。單價 / 數量 / 訂單金額不動。'
  '在職員工即可(Sean Q2 甲)。稽核 action order.item.swap、target order:<id>;同 request id 同內容重送回上次結果。';

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態檢查 ③ 數這個陣列;可授權物件 1 = 1 新函式)
  v_functions text[] := ARRAY['public.admin_swap_order_item(text,text,uuid,uuid,integer,uuid)']::text[];
  r      text := v_functions[1];
  v_bad  text := NULL;
  v_fks  text;
BEGIN
  IF pg_catalog.to_regprocedure(r) IS NULL THEN
    RAISE EXCEPTION '事後閘:admin_swap_order_item 沒建起來';
  END IF;
  IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'anon/authenticated 還有 EXECUTE');
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'service_role 沒有 EXECUTE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r)
                  AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
                  AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, '不是 SECURITY DEFINER / search_path 空字串 / owner postgres');
  END IF;
  -- 🔴 指向 order_items 的外鍵必須正好是函式裡檢查過的那一組 —— 逐條比完整表名、來源 / 目標欄位與刪除動作
  --    (Codex 實作審 R1 should-fix 3:只比表名會漏掉「同一張表多一條外鍵」或「刪除動作被改成 CASCADE」)。
  --    多一條、少一條或任一格不同 ⇒ 函式的檢查可能漏 ⇒ 停下重寫。confdeltype:a=NO ACTION r=RESTRICT c=CASCADE。
  SELECT pg_catalog.string_agg(x, ' ' ORDER BY x) INTO v_fks FROM (
    SELECT n.nspname || '.' || t.relname || '('
           || (SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY k.ord)
                 FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
           || ')->('
           || (SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY k.ord)
                 FROM pg_catalog.unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum)
           || '):' || c.confdeltype::text AS x
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE c.contype = 'f' AND c.confrelid = 'public.order_items'::regclass) s;
  IF v_fks IS DISTINCT FROM
     'public.order_amount_requests(order_item_id)->(id):a '
     'public.order_cancellation_items(order_id,order_item_id)->(order_id,id):r '
     'public.order_item_costs(order_item_id)->(id):c '
     'public.order_item_procurement(order_item_id)->(id):r '
     'public.order_item_quantity_summary(order_item_id,quantity)->(id,quantity):c '
     'public.order_refund_items(order_id,order_item_id)->(order_id,id):r '
     'public.order_refund_job_items(order_id,order_item_id)->(order_id,id):r '
     'public.shipment_items(order_item_id)->(id):r' THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, '指向 order_items 的外鍵與預期不同:' || coalesce(v_fks, '(無)'));
  END IF;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:%', v_bad;
  END IF;
  RAISE NOTICE '20260922100000 貼好了:admin_swap_order_item。';
END
$post$;

COMMIT;
