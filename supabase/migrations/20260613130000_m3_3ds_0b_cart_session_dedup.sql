-- ============================================================
-- M-3 3DS-0b:cross-tab 雙扣 DB 契約 — orders.cart_session_id + begin dedup(D4 needs_settle)+ create_order 5-param
-- ============================================================
-- 真權威:docs/specs/2026-06-13-m3-cross-tab-double-charge-fix-plan.md §3.1/§4.1(cart-instance idempotency)
--   + docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §4 / §1(d)(🔴 Sean D4 override:orphan-pending
--     改「begin 回 needs_settle → action 層 lock 外 settleCharge 即時裁決」、非永久擋)
--   + 審查側 3DS-0b plan 關卡1 3 fixes(2026-06-13、Sean 拍 Q1=B/Q2=A/Q3=A)。
-- 依賴:20260604120000(orders 表 + payment_status enum)、20260604130000(create_order 4-param)、
--       20260612150000(payment_charge_attempts 表 + begin/mark RPC + charge_attempt_token_hash helper)。
-- 鐵則 8(新欄 + 改 begin/create_order RPC + GRANT 矩陣)+ 鐵則 12(payment / dedup race / 經銷價零外洩)。
--
-- 🔴 設計(plan §2/§3/§4 + 關卡1 fix):
--   ① orders.cart_session_id uuid(nullable=相容;非 null 由 5-param create_order 入口強制)+ dedup index。
--   ② begin cart-instance dedup(D4):同 user + 同 cart_session_id + 異單,三態證據
--        (charged〔支1 已實扣〕/ order-paid〔支2 已 confirm、attempt 可能 pending〕/ pending-未-paid〔支3 orphan〕):
--      - sibling 已 paid = DB 確定完成 → 回 duplicate(existing_display_id, existing_paid:true、D2 照實顯既有單)。
--      - charged-未-paid / pending-未-paid = DB 無法確定錢扣了沒 → 回 needs_settle(existing_order_id/display/rec)
--        → action 層(lock 外、不可在 advisory lock 內打 Record HTTP)跑 settleCharge〔3DS-1b〕Record 裁決
--          (paid→duplicate / 明確失敗→markFailed 放行立即重刷 / 模糊→短 hold;§1(d) 三裁決)。
--      - 🔴 關卡1 fix-1:dedup 移到 user_in_flight 閘「**之前**」—— D4 即時裁決下,放閘後會讓同 cart orphan
--        在 10 分鐘內先撞 user_in_flight 回「處理中」、到不了 needs_settle(延遲 D4「馬上重結帳」最多 10 分)。
--        移閘前:同 advisory lock 內 race-safe;同 cart→duplicate/needs_settle 即時;異 cart→照舊落 user_in_flight
--        (per-user 閘只「移到 dedup 後」、沒拿掉 → 硬約束② 守);genuinely-in-flight 同 cart→settleCharge
--        Record 查 pending→hold,仍零雙扣。
--      - 無時間窗(同 key 永久去重直到清車換新 key);race-free:advisory xact lock 序列化同會員 begin
--        → 後到 begin 必見先到 begin 已 commit 之 order+attempt(cross-tab §3 T1/T6、結構不變)。
--   ③ begin 簽名不變(cart_session_id 從 orders 讀、非 client 傳 begin → 無 NULL 軟繞過面);
--      新增 fail-closed:IF v_order.cart_session_id IS NULL THEN 通用 RAISE(新流程訂單必有 key)。
--   ④ create_order:DROP 舊 4-param + CREATE 5-param(加 p_cart_session_id):
--      - 🔴 null fail-closed 於任何 nextval/INSERT 之前 RAISE(防舊/惡意 client 製無 key unpaid 垃圾單 + 燒序號)。
--      - INSERT 寫 orders.cart_session_id;其餘建單邏輯(server 取價/運費/快照/逐項 fail-closed)逐字不動。
--      - 🔴 GRANT 硬化(memory supabase-service-role-execute-default-grant):新函式預設給 service_role EXECUTE、
--        只 REVOKE PUBLIC/anon 不夠 → 顯式 REVOKE PUBLIC,anon,service_role,payment_confirmer + GRANT authenticated;
--        **同時補掉現有 4-param 沒 REVOKE service_role 的 over-grant 洞**(MCP 實查 service_role 4-param EXECUTE=true)。
--      - 末 DO assert:authenticated=true / anon=service_role=payment_confirmer=false
--        + to_regprocedure('public.create_order(jsonb,uuid,text,jsonb)') IS NULL(斷言舊 4-param 已 DROP、無後門)。
--   ⑤ 不動:per-user 閘 predicate / not_unpaid / per-order 佔鎖 / 備軌 token / charge_attempt_token_hash helper
--      / mark_charge_attempt_*(本片零改);begin 既有 outcome not_unpaid/user_in_flight/order_locked/acquired 保留。
--
-- ⚠️ 中間態 / 部署紀律(關卡1 fix-2;master plan v5 §2 中間態誠實):
--   - DROP 4-param 會讓現有建單 adapter(仍呼 4-param)斷掉;begin fail-closed 要求 order.cart_session_id 非 null。
--   - 故本 0b migration **必與 cart_session_id 前端 + adapter(create_order 5-param 傳 key)+ mapper 同一次 db push、
--     勿分開**;結帳對外未開(Phase I 中間態誠實、prod 0 流量〔MCP 實查 orders/attempts 0 row〕)→ 斷層無害。
--   - 0c(bank_transaction_id + 待開票表)時戳在 0b 後 → 被同一 push 閘連帶卡(0b 不可推則 0c 不可推、migrations 按序套用);
--     3DS-0a(20260613120000、webhook_events)時戳 < 0b、無 adapter 依賴 → 可獨立先 push 不受本閘影響
--     (若要先單推 0a,宜在本檔 commit 進 supabase/migrations/ 前做,否則 `supabase db push` 會連帶 pending 的 0b/0c)。
--
-- ⚠️ TS 同步閘(關卡1 fix-3):begin 新 outcome duplicate/needs_settle → 現有 PgChargeAttemptAdapter.parseBeginResult()
--   對未列 reason **會 throw**(實查 packages/adapters/.../PgChargeAttemptAdapter.ts L117)、charge-actions mapOutcome
--   無分支。cross-tab §4.2 列 3 TS 改項(adapter parse / use-case outcome / mapOutcome 分支,needs_settle 分支需
--   3DS-1b settleCharge)= **同 bundle 部署阻擋項**,隨 1b + client plumb 落地。本 0b 純 DB、不折 TS(避製造 1b
--   要重寫的暫態);begin RPC 不單獨上 prod = 上述新 outcome 在 bundle 前 dormant(且無 cart_session_id 時 begin
--   根本不 emit 新 outcome)→ 零 live 破口。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + 本 migration DDL + synthetic 雙單同 cart_session_id + DO 斷言
--   + ROLLBACK;project bmpnplmnldofgaohnaok PG17、2026-06-13;斷言 = DO 內不符即 RAISE 炸整段交易、整段零錯
--   跑完 = 全過;每次跑後 pg_class/pg_proc/pg_attribute/orders 複查零留痕):
--   PASS(2026-06-13、單交易套全 DDL + migration 自帶 GRANT asserts + 行為斷言 9 情境 + ROLLBACK):
--   ① DDL 套用無誤(ALTER orders + index + DROP 4-param + CREATE create_order 5-param + REVOKE/GRANT + CREATE OR
--      REPLACE begin);migration 自帶 4 條 DO assert 全靜默通過(create_order 5-param 唯 authenticated /
--      anon·service_role·payment_confirmer 全 false / 舊 4-param to_regprocedure IS NULL / begin 唯 payment_confirmer /
--      payment_confirmer 不可呼 create_order)。
--   ② begin 行為斷言(synthetic 多用戶隔離、避 per-user 閘跨情境污染):
--      S1 同 cart 已 paid sibling → duplicate(existing_paid=true、existing_display_id 正確);
--      S2 同 cart charged-未-paid → needs_settle(existing_order_id 正確、existing_rec_trade_id='REC-A2');
--      S3 同 cart pending orphan → needs_settle(existing_rec_trade_id JSON null);
--      🔴 S4 **異 cart** in-flight → user_in_flight(dedup 移閘前未弱化保護、異 cart 仍落閘);
--      S5 無 sibling → acquired:true + attempt_id + fallback_token;
--      S6 order.cart_session_id NULL → begin fail-closed RAISE;
--      S7 自身 active attempt → order_locked(per-order 鎖、dedup/閘排除同單);
--      S8 同 cart 多 sibling(charged + pending)→ needs_settle 選 charged(最強證據、codex #3 ORDER BY 修後 re-run 驗);
--   ③ create_order:C-null(p_cart_session_id=NULL → RAISE「缺 cart_session_id」、guard0 先於 auth);
--      C-happy(真變體 729faa80 + jwt claims;寫入 orders.cart_session_id 正確;nextval 後 setval 還原 seq)。
--   ④ ROLLBACK 後唯讀複查零留痕:create_order 僅剩 4-param(5-param/DROP 回滾)、cart_session_id 欄/index absent、
--      orders/attempts/synthetic auth.users 全 0、order_display_seq last_value 還原=1(net-zero);
--      service_role 4-param EXECUTE 仍 true(= 待本 migration db push 才修掉 over-grant、誠實揭示)。
--   ⚠️ 並發序列化(advisory xact lock)為單 session 不可模擬之屬性:dedup race-free 靠「lock 內 + 後到 begin
--      必見先到 commit 之 order/attempt」(cross-tab §3 T1/T6 論證);本模擬驗 dedup 查詢「邏輯」(同交易見自身寫入)。
--
-- 審查鏈(鐵則 12):code-reviewer PASS 零 must-fix(獨立重跑 create_order 零漂移 diff、dedup 多 sibling 邏輯、
--   GRANT 矩陣、3 fixes 全落地)→ codex 關卡2(gpt-5.5、read-only、零留痕)PASS + 3 🟡 consider:
--   #3〔本片已修〕多 sibling 非 paid 排序加證據強度:charged(已實扣最強)優先於 pending → ORDER BY 補 (a.status='charged') DESC;
--   #1〔0c 追蹤〕needs_settle 未帶 bank_transaction_id(欄 0c 才加)→ 0c CREATE OR REPLACE begin 補 existing_bank_transaction_id
--     + 3DS-1b settleCharge 須 by existing_order_id 重查 attempt(rec/bank 來源優先序);本片回 existing_order_id 已足夠 by-orderId 接手;
--   #2〔退款片 backlog〕refunded/partiallyPaid + active attempt sibling 現走 needs_settle —— Phase 1 不做退款(S2=B)、
--     且成交清車/換新 key 後同 cart_session_id 不重用故當前 moot;退款上線前補狀態矩陣(refunded sibling=duplicate/final/專門 outcome)+ 測。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):見檔尾。
-- ============================================================


-- ── 1. orders.cart_session_id 欄 + dedup index ──
ALTER TABLE public.orders ADD COLUMN cart_session_id uuid;

COMMENT ON COLUMN public.orders.cart_session_id IS
  'M-3 3DS-0b cross-tab 雙扣判別子(cart-instance idempotency key)。client 空車→第一件生 UUID、clear/成交 regenerate(TTL 24h);create_order 5-param 必寫(入口 null fail-closed);begin advisory lock 內以此 dedup(同 user 同 key 異單三態 → duplicate/needs_settle)。nullable=相容、非 null 由 RPC 入口強制。非價/非 PII、RLS 中性(客人只讀自己單)。';

-- dedup 查詢用(同 user + 同 cart_session_id;partial 排除 null = 舊/無 key 單不進 index)
CREATE INDEX orders_customer_cart_session_idx
  ON public.orders (customer_user_id, cart_session_id) WHERE cart_session_id IS NOT NULL;


-- ── 2. create_order:DROP 舊 4-param + CREATE 5-param(加 p_cart_session_id;防無 key 後門)──
-- 舊 4-param 必 DROP(非 overload):殘留 = 不寫 key 的建單後門 → 繞過 cross-tab dedup + 製無 key unpaid 垃圾單。
DROP FUNCTION public.create_order(jsonb, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_order(
  p_lines           jsonb,   -- [{variant_id uuid} 或 {supplier_slug text, sku text}, qty int]
  p_address_id      uuid,
  p_shipping_method text,
  p_invoice         jsonb,    -- {type:'personal'|'company'|'donate', carrier?, title?, taxId?, donateCode?}
  p_cart_session_id uuid      -- 🔴 3DS-0b cart-instance key(client 送、空車首件生;入口 null fail-closed)
)
RETURNS jsonb                 -- {order_id uuid, display_id text}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid            uuid := (select auth.uid());
  v_addr           record;
  v_line           jsonb;
  v_variant        record;
  v_qty            integer;
  v_variant_id     uuid;
  v_supplier_slug  text;
  v_sku            text;
  v_unit_price     integer;
  v_line_total     bigint;            -- bigint 中間值防 integer*integer 溢位(codex k2 consider);存表前驗 <= int max
  v_subtotal       bigint := 0;
  v_shipping_fee   integer;
  v_total          bigint;
  v_seen_variants  uuid[] := '{}';
  v_items          jsonb := '[]'::jsonb;
  v_invoice        jsonb;
  v_addr_snapshot  jsonb;
  v_display_id     text;
  v_seq_text       text;
  v_order_id       uuid;
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed(於任何 nextval/INSERT 之前;防舊/惡意 client 製無 key 垃圾單 + 燒序號)──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 1. 身分 + customer profile(fail-closed)──
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_order: 未登入(auth.uid NULL)';
  END IF;
  PERFORM 1 FROM public.customers WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 查無 customer profile(uid=%)', v_uid;
  END IF;

  -- ── 2. 地址歸屬(必為本人、否則 raise;快照凍結履約地址)──
  SELECT id, name, phone, line
    INTO v_addr
    FROM public.customer_addresses
   WHERE id = p_address_id AND customer_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 地址非本人或不存在(address_id=%)', p_address_id;
  END IF;
  -- 🔴 codex k2 r2 must-fix:customer_addresses.phone 可為 NULL → jsonb_build_object 產 JSON null →
  --    S2-a orders_ship_addr_whitelist 在 nextval 後才拒(燒序號 + 訂單永敗)。coalesce '' 收乾淨(空電話業務允許、欄 DEFAULT '')。
  --    name/line 為 NOT NULL、不需 coalesce。
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(Sean 拍 A:home/store;運費 step 7 算)──
  --    NULL 顯式擋(codex k2 consider:NULL NOT IN 為 NULL 非 true、不擋 → 會燒號才被 NOT NULL 擋;早 raise)
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型(完整欄位驗在 schema/use-case 層;DB 收乾淨白名單 jsonb)──
  --    NULL / 非 object / 缺 type 顯式擋(codex k2 consider:全在 nextval 前 fail-closed、不燒號於被拒單)
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  -- RPC jsonb_build_object 主控:逐欄 ->> 取為 text(任何巢狀值被序列化為字串、無法注入物件)+ strip_nulls 去缺欄。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限(codex k2 consider:防巨量 line DoS / 累加溢位面)──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line:解析變體 → fail-closed 驗 → server 取價 → 累計 subtotal + 累積 items 快照 ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN  -- 上限 10000(codex k2 consider:防巨量 qty 溢位 / DoS)
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;  -- NULLIF 為 SQL 構造、非 catalog 函式、search_path='' 下仍解析
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

    -- 解析變體(優先 variant_id;否則 (supplier_slug,sku) 複合鍵、S3a 後 sku 非全域唯一防撞);
    -- 取 variant 自己的價 + variant 層 availability + parent 下架/群層 availability/標題(codex k2 must-fix:群層 availability 也驗)
    IF v_variant_id IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.supplier_slug = v_supplier_slug AND pv.sku = v_sku;
    ELSE
      RAISE EXCEPTION 'create_order: line 缺 variant_id 或 (supplier_slug,sku)';
    END IF;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'create_order: 找不到 variant(variant_id=%, supplier_slug=%, sku=%)', v_variant_id, v_supplier_slug, v_sku;
    END IF;

    -- 重複 variant(同一變體跨多 line)→ raise(防前台重複加購未合併造成快照分裂)
    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    -- 下架 / 群層缺貨 / 變體缺貨(防舊 cart 送已下架/缺貨;群層 + 變體層雙驗、codex k2 must-fix)
    -- ⚠️ availability 現為二值 'in-stock'/'out-of-stock'、`<> 'in-stock'` fail-closed;若未來加第三態(如預購)須回看(backlog #214)
    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;
    IF v_variant.product_availability <> 'in-stock' THEN
      RAISE EXCEPTION 'create_order: 商品群層缺貨(variant=%, product_availability=%)', v_variant.id, v_variant.product_availability;
    END IF;
    IF v_variant.variant_availability <> 'in-stock' THEN
      RAISE EXCEPTION 'create_order: 變體缺貨(variant=%, availability=%)', v_variant.id, v_variant.variant_availability;
    END IF;

    -- 🔴 server 取價(D3=B general-only:取 variant 自己的 price_general;零 price_store path);價 NULL/<=0 → raise
    v_unit_price := v_variant.price_general;
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    -- spec 預驗(codex k2 r2 consider:對齊 S2-a order_items_snapshot_whitelist、fail-closed 於 nextval 前;
    --   catalog 髒 spec〔非 object/含非字串值/含敏感鍵 #213〕早 raise、不燒號 + 不在 INSERT 才爆;spec 非 client 可控、屬資料品質縱深)
    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    -- 金額用 bigint 中間值算 + 存表前驗 <= int max(codex k2 consider:防 integer*integer 溢位)
    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- 凍結快照(product_snapshot 主控:title 取 product、sku/spec 取 variant;spec 全 string、配 S2-a backstop)
    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total
    );
  END LOOP;

  -- ── 7. 運費(Sean 拍 B):store→0 自取免運;home→subtotal>=5000?0:100。RPC 自算、不信 client ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE  -- home(已白名單、僅餘此分支)
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  v_total := v_subtotal + v_shipping_fee;  -- discount_total Phase 1 = 0
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;

  -- ── 8. 產號(fail-closed 全過後才 nextval、不燒號於被拒單)+ 寫 order(unpaid/notOrdered)──
  -- 🔴 codex k2 r2 must-fix:lpad(s,4) 對 >4 位字串會「截斷」(seq=10000→'1000' 撞號)→ 改 CASE:
  --    <4 位才補零到 4、>=4 位原樣輸出(對齊 S2-a regex ^PCM-YYYY-[0-9]{4,}$ 不跨年重置成長)。
  v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
  v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
                  CASE WHEN pg_catalog.length(v_seq_text) < 4 THEN pg_catalog.lpad(v_seq_text, 4, '0') ELSE v_seq_text END;

  -- v_subtotal/v_total 為 bigint、已驗 <= int max → ::integer 安全(欄為 integer)
  -- 🔴 3DS-0b:INSERT 寫 cart_session_id(cross-tab dedup 鍵;begin 後續以此判同 cart 重複)
  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id
  )
  RETURNING id INTO v_order_id;

  -- ── 9. 寫 items(快照已備、逐筆 insert;order_items CHECK 為縱深底線)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer
    );
  END LOOP;

  -- ── 10. return DTO 只 {order_id, display_id}(禁回原 row / 禁帶價結構)──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

COMMENT ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid) IS
  'M-3-S2-b1 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id。client 送 variant+qty+address+method+invoice+cart_session_id、永不送價/tier;server 權威取 variant.price_general(D3=B general-only、零 price_store path)、自算 subtotal/運費/total;cart_session_id null fail-closed(防無 key 垃圾單);fail-closed 逐項 raise;product_snapshot RPC 主控配 S2-a backstop;return 只 {order_id,display_id}。';

-- ── 權限硬化(GRANT 矩陣;memory supabase-service-role-execute-default-grant)──
-- 新函式預設 GRANT EXECUTE TO PUBLIC + Supabase ALTER DEFAULT PRIVILEGES 給 service_role → 顯式四方 REVOKE。
-- 🔴 同時關掉舊 4-param 的 service_role over-grant 洞(舊檔僅 REVOKE PUBLIC,anon;MCP 實查 service_role 4-param EXECUTE=true)。
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid) TO authenticated;


-- ── 3. begin_charge_attempt:加讀 cart_session_id + dedup(D4 needs_settle、移 user_in_flight 閘前)──
-- 簽名不變(CREATE OR REPLACE 保留既有 ACL = 唯 payment_confirmer EXECUTE);cart_session_id 從 orders 讀、非 client 傳。
CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- {acquired bool, attempt_id?, fallback_token?, reason?: user_in_flight|order_locked|not_unpaid|duplicate|needs_settle, existing_*?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order        record;
  v_attempt_id   uuid;
  v_token        uuid;
  v_dup_order_id uuid;
  v_dup_display  text;
  v_dup_paid     boolean;
  v_dup_rec      text;
  v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';  -- PF-E 通用訊息
BEGIN
  -- 訂單存在 + 取歸屬 + cart_session_id(customer_user_id/cart_session_id 從 orders 讀、零信任參數)
  SELECT id, customer_user_id, payment_status, cart_session_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 3DS-0b fail-closed:cart_session_id 必有(5-param create_order 入口強制寫;舊 4-param 已 DROP → 無無 key 單)
  IF v_order.cart_session_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 已 paid / refunded / partiallyPaid → 不開新 charge(與撞鎖同層級回覆、不洩具體狀態)
  -- 此讀無 row lock:與並發 confirm 有理論 race(檢查後翻 paid → 為已 paid 單插 pending row),
  -- 後果僅該單持 per-order 鎖(fail-closed、②-⑥ 對帳可解)、閘 join orders 已 paid 放行不誤卡、
  -- 零雙扣路徑;②-③c 編排層知悉(code-reviewer 2026-06-12 觀察)。
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
  END IF;

  -- 🔴 per-user 序列化(Q2=A):advisory xact lock(交易結束自動釋放、不跨外部 HTTP)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));

  -- 🔴 3DS-0b cart-instance dedup(D4 override;關卡1 fix-1:移到 user_in_flight 閘「前」)──
  -- 同 user + 同 cart_session_id + 異單,三態已扣款/扣款中證據(無時間窗、advisory lock 內 race-safe):
  --   支1 a.status='charged'(已實扣、rec 必存)/ 支2 o.payment_status='paid'(已 confirm、attempt 可能 pending)
  --   / 支3 a.status='pending' AND o 未 paid(orphan、錢可能扣)。
  -- LEFT JOIN 僅 active(pending|charged)attempt(per-order unique 保證至多一筆);ORDER BY paid 優先 → 已 paid sibling
  --   先被選為 duplicate、否則取最近 orphan 為 needs_settle。
  SELECT o.id, o.display_id, (o.payment_status = 'paid'::public.payment_status), a.rec_trade_id
    INTO v_dup_order_id, v_dup_display, v_dup_paid, v_dup_rec
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_order.customer_user_id
     AND o.id              <> p_order_id
     AND o.cart_session_id  = v_order.cart_session_id
     AND (
          a.status = 'charged'
       OR o.payment_status = 'paid'::public.payment_status
       OR (a.status = 'pending' AND o.payment_status <> 'paid'::public.payment_status)
     )
   -- 排序:paid sibling 優先(→duplicate);非 paid 間 charged(已實扣、最強證據)優先於 pending,再最近(codex 關卡2 #3)
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC, (a.status = 'charged') DESC, o.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_dup_paid THEN
      -- sibling 已 paid = DB 確定完成 → 照實顯既有單(D2)
      RETURN pg_catalog.jsonb_build_object(
        'acquired', false, 'reason', 'duplicate',
        'existing_display_id', v_dup_display, 'existing_paid', true
      );
    END IF;
    -- charged-未-paid / pending-未-paid = DB 無法確定扣款與否 → 交上層 settleCharge〔3DS-1b〕Record 即時裁決(D4)
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'needs_settle',
      'existing_order_id', v_dup_order_id,
      'existing_display_id', v_dup_display,
      'existing_rec_trade_id', v_dup_rec
    );
  END IF;

  -- 🔴 per-user 閘(Q2=A;round2 MF1 + round3 MF 統一 predicate;原封不動、僅移到 dedup 後 → 硬約束② 守):
  -- 「未解決付款」= 10 分鐘內、異單、active(pending|charged)、且該單尚未 paid(join orders:
  --   charged-未-paid 也擋〔雙扣視窗〕;pending-但-已-paid 放行〔不誤卡〕)。異 cart 走此擋(同 cart 已被 dedup 攔)。
  IF EXISTS (
    SELECT 1
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
  ) THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'user_in_flight');
  END IF;

  -- 🔴 per-order 佔鎖(原子;撞 active attempt → DO NOTHING → order_locked)+ 備軌 token 發放(round4 MF2)
  v_token := pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
  VALUES (p_order_id, v_order.customer_user_id, public.charge_attempt_token_hash(v_token))
  ON CONFLICT (order_id) WHERE status IN ('pending', 'charged') DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'order_locked');
  END IF;

  -- token 明文只在此回傳值(server 呼叫端記憶體);DB 只有 hash、絕不入 log
  RETURN pg_catalog.jsonb_build_object(
    'acquired', true,
    'attempt_id', v_attempt_id,
    'fallback_token', v_token
  );
END;
$fn$;

COMMENT ON FUNCTION public.begin_charge_attempt(uuid) IS
  'M-3-S2-d 佔 per-order charge 鎖 + per-user 10 分鐘閘 + 發備軌 token(DB 只存 hash)+ 3DS-0b cart-instance dedup(D4)。begin 序:讀 order(+cart_session_id、null fail-closed)→ not_unpaid → advisory xact lock → cart dedup(同 user 同 key 異單三態 → paid:duplicate / 其餘有扣款跡象:needs_settle〔交 settleCharge 裁決〕、移到 user_in_flight 閘前) → user_in_flight(異 cart)→ 佔鎖/order_locked。只 payment_confirmer 可呼;p_order_id 為 server action 自產。';


-- ── 4. fail-closed assert(擋 db push;create_order 5-param 矩陣 + 舊 4-param DROP + begin 矩陣回歸)──
DO $$
BEGIN
  -- create_order 5-param:唯 authenticated(補掉舊 4-param service_role over-grant)
  IF NOT has_function_privilege('authenticated', 'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',             'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',     'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_order 5-param EXECUTE 權限矩陣異常 — 應唯 authenticated;拒繼續';
  END IF;

  -- 🔴 舊 4-param 已 DROP(無不寫 key 後門 + 順帶清掉 service_role over-grant 的舊目標)
  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'create_order 舊 4-param 未 DROP — 殘留 = 繞 cross-tab dedup 後門;拒繼續';
  END IF;

  -- begin_charge_attempt CREATE OR REPLACE 保留 ACL = 唯 payment_confirmer(回歸 assert;S2-d 紀律不破)
  IF NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'begin_charge_attempt EXECUTE 權限矩陣異常(CREATE OR REPLACE 後);拒繼續';
  END IF;

  -- payment_confirmer 仍不可呼 create_order(S2-c/S2-d 攻擊面收斂回歸、5-param 版)
  IF has_function_privilege('payment_confirmer', 'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'payment_confirmer 不應可呼 create_order(攻擊面收斂回歸);拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   -- begin 還原回 20260612150000 版(無 cart dedup;手動貼該檔 begin_charge_attempt 全文 CREATE OR REPLACE)
--   DROP FUNCTION IF EXISTS public.create_order(jsonb, uuid, text, jsonb, uuid);
--   -- create_order 還原回 20260604130000 版 4-param(手動貼該檔全文 + REVOKE PUBLIC,anon + GRANT authenticated)
--   DROP INDEX IF EXISTS public.orders_customer_cart_session_idx;
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS cart_session_id;
-- ============================================================
