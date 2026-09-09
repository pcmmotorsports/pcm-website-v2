-- 🔴 20260909070000 的核准回復件 —— **僅供核准回復時執行**。
-- 內容 = 2026-09-09 14:5x UTC 從正式庫唯讀取的現行定義(pg_get_functiondef)。
-- 🛑 它只還原【函式定義】,還原不了已經寫進 admin_audit_log 的那些列(而那些是純新增,無害)。
-- ⚪ 進版控前掃 vault/decrypted_secret/password/token/bearer ⇒ 0 命中。

BEGIN;
SET LOCAL lock_timeout = '5s';   -- CREATE OR REPLACE FUNCTION 拿 ACCESS EXCLUSIVE LOCK

CREATE OR REPLACE FUNCTION public.admin_update_order_item_amount(p_order_id uuid, p_order_item_id uuid, p_unit_price integer, p_expected_version integer, p_actor text, p_request_id text, p_zero_price_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ord        public.orders%ROWTYPE;
  v_item       public.order_items%ROWTYPE;
  v_line_total bigint;
  v_subtotal   bigint;
  v_total      bigint;
  v_payments   integer;
  v_rows       integer;
BEGIN
  -- 4a. server 供參數 fail-closed(形狀抄 20260714130000:84-96)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_order_item_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 order_id / order_item_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: expected_version 越界';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: unit_price 必須是非負整數';
  END IF;

  -- 4b. 🔴 零元防呆(本層只保證 API 契約,不保證員工沒手滑 —— 見檔頭 §3)。
  IF p_unit_price = 0 AND (p_zero_price_reason IS NULL OR pg_catalog.btrim(p_zero_price_reason) = '') THEN
    RAISE EXCEPTION '單價改為 0 需要填原因(例:贈品 / 換貨補寄)'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_zero_price_needs_reason',
            DETAIL = 'pcm_e13_zero_price_needs_reason';
  END IF;
  -- 🔴 反向:>0 卻帶原因 ⇒ 拒。防它退化成「前端恆填一個樣板字」。
  IF p_unit_price > 0 AND p_zero_price_reason IS NOT NULL THEN
    RAISE EXCEPTION '單價不是 0 時不得帶「零元原因」(收到:%)', p_zero_price_reason
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_reason_only_for_zero',
            DETAIL = 'pcm_e13_reason_only_for_zero';
  END IF;

  -- 4c. 鎖父列。🔴 FOR NO KEY UPDATE(不是 FOR UPDATE)——
  --     FOR UPDATE 與 order_items 的 FK RI 取的 KEY SHARE 會死結(40P01,2026-08-03 A2b1 實測)。
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 訂單不存在';
  END IF;
  IF v_ord.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  -- 4d. 🔴 金額閘:這張單有【任何一列】收款 ⇒ 拒(見檔頭 §2;不使用任何金額口徑)。
  SELECT count(*) INTO v_payments FROM public.order_payments p WHERE p.order_id = p_order_id;
  IF v_payments > 0 THEN
    RAISE EXCEPTION
      '這張單已經有收款紀錄(% 筆),目前不開放改金額 —— 因為「已收多少」的算法還沒定案。需要調整請走退款流程,或告知系統維護。',
      v_payments
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_no_edit_after_payment',
            DETAIL = 'pcm_e13_no_edit_after_payment';
  END IF;


  -- 4e. 🔴 折扣閘(plan §6a L2 的「會自己響」那半):本片未處理折扣單的改價。
  --     若 subtotal 被改小而 discount_total > subtotal + shipping_fee ⇒ total 算成負數 ⇒ 撞 CHECK (total >= 0),
  --     而員工會看到 23514 技術碼。⇒ 折扣一上線,第一張折扣單改價就會撞到這裡,訊息說得出為什麼。
  IF v_ord.discount_total <> 0 THEN
    RAISE EXCEPTION
      '這張單有折扣(%),而本功能尚未處理折扣單的改價(#13 片1 已知限制 L2)。請告知系統維護。',
      v_ord.discount_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_discount_not_supported',
            DETAIL = 'pcm_e13_discount_not_supported';
  END IF;

  -- 4f. 取品項,並確認它屬於這張單(防跨單誤改)。
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 品項不存在';
  END IF;
  IF v_item.order_id <> p_order_id THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 品項不屬於這張訂單';
  END IF;

  -- 4g. no-op 拒(不 bump version、不寫稽核;形狀抄 20260714130000:196-203)。
  IF v_item.unit_price = p_unit_price THEN
    RETURN 'NOOP';
  END IF;

  -- 4h. 🔴 同交易改兩處:line_total 必須跟著 unit_price 走,否則撞 order_items_line_balances。
  --     ⚠️ 我們是【設計上】同時改,不是靠撞 CHECK 才發現 —— 驗收要有一格證明這件事。
  v_line_total := p_unit_price::bigint * v_item.quantity::bigint;
  IF v_line_total > 2147483647 THEN
    RAISE EXCEPTION '改後的 line_total(%)超出 integer 上限', v_line_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_line_total_overflow',
            DETAIL = 'pcm_e13_line_total_overflow';
  END IF;

  UPDATE public.order_items
     SET unit_price = p_unit_price,
         line_total = v_line_total::integer
   WHERE id = p_order_item_id;


  -- ══ 4g-2 未稅價的單不開放改價(2026-09-05 · ⟦b4-PRICECOPYTAX⟧ 片二)═══════════════
  -- 🔴 **判準是 `price_tax_mode`, 不是 `tax_total`**(codex 2026-09-05 must-fix #10, 它對):
  --    ⛔ ~~`tax_total <> 0`~~ —— 一張 `exclusive` 的單若**稅基是 0**(全部品項 0 元 + 免運),
  --       或**小額四捨五入成 0**(稅基 ≤ 9 ⇒ ROUND(0.45)=0)⇒ `tax_total = 0`
  --       ⇒ **它會穿過那道擋**, 而之後改成高單價 ⇒ 留下一張**未稅價而稅額 0** 的單。
  --    ⇒ 📌 **我用「結果」當判準, 而該用「這張單是哪一種」。**
  --    ✅ 主判準 `price_tax_mode = 'exclusive'`;`OR tax_total <> 0` 留著當**第二道**
  --       —— 它涵蓋「欄位不知怎麼變成 inclusive 而稅額還在」那種不一致。
  -- 🔴 **為什麼要擋**:下面 `4i` 的重算式是 `v_total := v_subtotal + shipping_fee - discount_total;`
  --    —— **它沒有稅** ⇒ 一張有稅的單一改價, `total` 會少掉稅
  --    ⇒ **撞 `orders_total_balances`**(它自 `20260828100000` 起把 `tax_total` 納入等式)
  --    ⇒ 員工看到的是一個**約束名**, 而他不知道發生了什麼事。
  -- 🔴 **位置在 4g 之後、寫入之前**(codex nit #11):放在品項存在/歸屬/NOOP 檢查**之前**的話,
  --    一個**根本不存在的品項**或**純 NOOP** 會被說成「稅的問題」⇒ 訊息把人導向錯的地方。
  -- 🛑 **這是刻意的功能缺口, 不是修好了** —— 要真正支援, `4i` 那條算式要跟著重算稅,
  --    而那是另一片、要另一輪審查。
  -- 🔬 **今天未稅價的單是 0 張**(`price_tax_mode` 這一欄本檔才加)⇒ **影響從零開始長。**
  IF v_ord.price_tax_mode = 'exclusive' OR COALESCE(v_ord.tax_total, 0) <> 0 THEN
    RAISE EXCEPTION
      '這張單的單價是【未稅】的(稅另計), 而改金額這個功能還不會重算稅 —— 目前不開放改。'
      '需要調整請告知系統維護。'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_no_edit_when_taxed',
            DETAIL = 'pcm_e13_no_edit_when_taxed';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════════

  -- 4i. 重算訂單層。subtotal = Σ line_total;total 依 orders_total_balances 的等式。
  SELECT COALESCE(SUM(i.line_total), 0) INTO v_subtotal
    FROM public.order_items i WHERE i.order_id = p_order_id;
  v_total := v_subtotal + v_ord.shipping_fee::bigint - v_ord.discount_total::bigint;
  IF v_total < 0 THEN
    RAISE EXCEPTION '改後的訂單總額會變成負數(%),本功能不處理', v_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_total_negative',
            DETAIL = 'pcm_e13_total_negative';
  END IF;
  IF v_subtotal > 2147483647 OR v_total > 2147483647 THEN
    RAISE EXCEPTION '改後的 subtotal/total 超出 integer 上限'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_order_amount_overflow',
            DETAIL = 'pcm_e13_order_amount_overflow';
  END IF;

  UPDATE public.orders
     SET subtotal   = v_subtotal::integer,
         total      = v_total::integer,
         version    = v_ord.version + 1,
         updated_at = pg_catalog.now()
   WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 更新列數異常(%)', v_rows;
  END IF;

  -- 4j. 同交易寫稽核。🔴 逐欄列舉 —— 新增可編欄位時**必須**同時加在這裡,
  --     否則它不會進操作紀錄,而且不會有任何東西紅(#13 片0a §4 的 must)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.item.amount.update',
    'order_item:' || p_order_item_id::text,
    pg_catalog.jsonb_build_object(
      'order_id',   p_order_id,
      'unit_price', v_item.unit_price,
      'line_total', v_item.line_total,
      'subtotal',   v_ord.subtotal,
      'total',      v_ord.total
    ),
    pg_catalog.jsonb_build_object(
      'order_id',          p_order_id,
      'unit_price',        p_unit_price,
      'line_total',        v_line_total::integer,
      'subtotal',          v_subtotal::integer,
      'total',             v_total::integer,
      'zero_price_reason', p_zero_price_reason
    ),
    p_request_id,
    'admin'
  );

  RETURN 'OK';
END;
$function$;


COMMIT;
