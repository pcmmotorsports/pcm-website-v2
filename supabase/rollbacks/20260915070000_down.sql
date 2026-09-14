-- 後台改單第 5 代 回滾:貼回第 4 代本體(逐字自 20260913060000:96-385)+ 它的 COMMENT。ACL 由 REPLACE 保留。
-- 🔴 已改過的 shipping_address_snapshot 留著(那是員工真的改的);先 revert TS(表單三格會送三鍵 ⇒ 第 4 代拒「非白名單欄」)再跑本檔。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_update_order_workflow(uuid, integer, jsonb, text, text)');
  IF v_src IS NULL OR v_src NOT LIKE '%''ship_to_name''%' THEN
    RAISE EXCEPTION '回滾前置閘:這台庫上不是第 5 代, 沒有東西可回滾';
  END IF;
END
$pre$;
CREATE OR REPLACE FUNCTION public.admin_update_order_workflow(
  p_order_id         uuid,
  p_expected_version integer,
  p_patch            jsonb,
  p_actor            text,
  p_request_id       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- 🔴 D-2:workflow_status 已自白名單移除(orders 層停寫;狀態唯一寫入面=admin_update_order_item_workflow)。
  -- 🔴 2026-09-13 P2(第 3 代 050000):加 `invoice_issued_at`(第五欄)。
  -- 🔴 2026-09-13 第 4 代(本支):加 `invoice_title` / `invoice_tax_id`(orders.invoice jsonb 的 title / taxId)。
  v_allowed_keys constant text[] := ARRAY[
    'shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status', 'invoice_issued_at',
    'invoice_title', 'invoice_tax_id'
  ];
  v_key   text;
  v_cur   public.orders%ROWTYPE;
  v_shipping_method   text;
  v_invoice_number    text;
  v_invoice_amount    integer;
  v_invoice_status    text;
  v_invoice_issued_at date;
  v_issued_raw        text;
  v_today_tpe         date;
  v_created_tpe       date;
  -- 第 4 代:抬頭 / 統編
  v_invoice           jsonb;
  v_title             text;
  v_tax_id            text;
  -- 零寬字元(同 20260913020000 那支的 v_zw):U+200B/C/D、U+2060、U+FEFF。
  v_zw constant text := pg_catalog.chr(8203) || pg_catalog.chr(8204) || pg_catalog.chr(8205)
                     || pg_catalog.chr(8288) || pg_catalog.chr(65279);
  v_rows  integer;
BEGIN
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 order_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: expected_version 越界';
  END IF;

  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: patch 非 object';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: patch 含非白名單欄';
    END IF;
  END LOOP;
  IF p_patch = '{}'::jsonb THEN
    RETURN 'NOOP';
  END IF;

  SELECT * INTO v_cur FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'CONFLICT';
  END IF;
  IF v_cur.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  v_shipping_method   := v_cur.shipping_method;
  v_invoice_number    := v_cur.invoice_number;
  v_invoice_amount    := v_cur.invoice_amount;
  v_invoice_status    := v_cur.invoice_status;
  v_invoice_issued_at := v_cur.invoice_issued_at;
  v_invoice           := v_cur.invoice;

  IF p_patch ? 'shipping_method' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'shipping_method') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 不可為空';
    END IF;
    v_shipping_method := pg_catalog.btrim(p_patch ->> 'shipping_method');
    IF v_shipping_method = '' OR pg_catalog.char_length(v_shipping_method) > 64 THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 長度不符';
    END IF;
  END IF;

  IF p_patch ? 'invoice_number' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_number') = 'null' THEN
      v_invoice_number := NULL;
    ELSE
      v_invoice_number := pg_catalog.btrim(p_patch ->> 'invoice_number');
      IF v_invoice_number = '' OR pg_catalog.char_length(v_invoice_number) > 64
         OR v_invoice_number ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_number 非法';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_amount' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') = 'null' THEN
      v_invoice_amount := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') <> 'number' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 非數字';
      END IF;
      v_invoice_amount := (p_patch ->> 'invoice_amount')::integer;
      IF v_invoice_amount < 0 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 為負';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_status') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 不可為空';
    END IF;
    v_invoice_status := p_patch ->> 'invoice_status';
    IF v_invoice_status NOT IN ('not_issued', 'issued', 'voided') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 非三值之一';
    END IF;
  END IF;

  -- ── 2026-09-13 P2:invoice_issued_at ──────────────────────────────────────
  -- 🔴 形狀:jsonb 字串 `YYYY-MM-DD`(TS 那側 `<input type="date">` 的原生值);null = 清空。
  --    先用正規式擋形狀, 再 cast —— cast 自己會擋 2026-02-30 這種假日期(22008), 那走一般錯誤。
  IF p_patch ? 'invoice_issued_at' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_issued_at') = 'null' THEN
      v_invoice_issued_at := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_issued_at') <> 'string' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_issued_at 非字串';
      END IF;
      v_issued_raw := pg_catalog.btrim(p_patch ->> 'invoice_issued_at');
      IF v_issued_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_issued_at 形狀不是 YYYY-MM-DD';
      END IF;
      v_invoice_issued_at := v_issued_raw::date;
    END IF;
  END IF;

  -- 🔴🔴 **變成 issued 的那一次必須【明確】帶日期**(理由見檔頭)。
  --    判準是「patch 有沒有那個鍵」, 不是「列上有沒有值」—— 列上的舊值正是要防的東西。
  IF v_cur.invoice_status <> 'issued' AND v_invoice_status = 'issued'
     AND NOT (p_patch ? 'invoice_issued_at') THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 變成已開立時必須帶開立日期'
      USING ERRCODE = 'P9I01';
  END IF;
  -- 🔴 最終狀態是 issued ⇒ 一定要有日期(涵蓋:帶了 null、或列上本來就 NULL 而只改別欄)。
  --    📌 後者會【逼著】把 P1b 之前留下的「已開立而無日期」舊列補齊 —— 那是對的方向。
  IF v_invoice_status = 'issued' AND v_invoice_issued_at IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 已開立的單必須有開立日期'
      USING ERRCODE = 'P9I01';
  END IF;
  -- 🔴 範圍檢查(只在有日期時跑;兩端都用台北日)
  IF v_invoice_issued_at IS NOT NULL THEN
    v_today_tpe   := (pg_catalog.now() AT TIME ZONE 'Asia/Taipei')::date;
    v_created_tpe := (v_cur.created_at AT TIME ZONE 'Asia/Taipei')::date;
    IF v_invoice_issued_at > v_today_tpe THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 開立日期不得是未來(台北日 %)', v_today_tpe
        USING ERRCODE = 'P9I03';
    END IF;
    IF v_invoice_issued_at < v_created_tpe THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 開立日期不得早於訂單成立日(台北日 %)', v_created_tpe
        USING ERRCODE = 'P9I02';
    END IF;
  END IF;

  -- ══ 第 4 代:抬頭 / 統編(兩個 key 一起看, 因為 type 是由兩格一起推的)══════════
  --    plan docs/plans/2026-09-13-invoice-title-taxid-editable-plan.md(Sean 答 Q1 甲, 主視窗裁 Q2-Q4 甲)。
  IF (p_patch ? 'invoice_title') OR (p_patch ? 'invoice_tax_id') THEN

    -- 🔴 捐贈發票沒有抬頭統編這回事(Sean 答甲):碰到就拒, 不靜默改 type。
    IF (v_invoice ->> 'type') = 'donate' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 捐贈發票不可改抬頭 / 統編';
    END IF;

    -- 🔴 codex must-fix 3:只准 string / null。`->>` 會把 {} / 12345678 / true 轉成文字,
    --    CHECK 看到的已經全是字串 ⇒ 擋不住「抬頭 = "{}"」。在轉文字之前拒。
    IF p_patch ? 'invoice_title'
       AND pg_catalog.jsonb_typeof(p_patch -> 'invoice_title') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_title 須為字串';
    END IF;
    IF p_patch ? 'invoice_tax_id'
       AND pg_catalog.jsonb_typeof(p_patch -> 'invoice_tax_id') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_tax_id 須為字串';
    END IF;

    -- 沒送的那一格 ⇒ 沿用現值;送了 ⇒ 用送的(null 也算送了)。
    v_title  := CASE WHEN p_patch ? 'invoice_title'  THEN p_patch ->> 'invoice_title'  ELSE v_invoice ->> 'title' END;
    v_tax_id := CASE WHEN p_patch ? 'invoice_tax_id' THEN p_patch ->> 'invoice_tax_id' ELSE v_invoice ->> 'taxId' END;

    -- 🔴 codex must-fix 1 + 2:**合併之後**再正規化, 兩格走同一條, 不管值是送來的還是沿用的。
    --    · MF1:沿用的舊值可能是 "" 或 7 碼(歷史髒資料)—— 只正規化送來的那一格, 半填判斷會漏。
    --    · MF2:全形空白 U+3000 不會被 btrim() 清掉 ⇒ 「　」會被當成有抬頭 ⇒ 變 company。
    --      ⇒ 先去零寬字元(同 138 那支 v_zw 的做法), 再用 [[:space:]] + U+3000 修邊。
    v_title := pg_catalog.regexp_replace(
                 pg_catalog.translate(v_title, v_zw, ''),
                 E'^[[:space:]\u3000]+|[[:space:]\u3000]+$', '', 'g');
    v_tax_id := pg_catalog.regexp_replace(
                 pg_catalog.translate(v_tax_id, v_zw, ''),
                 E'^[[:space:]\u3000]+|[[:space:]\u3000]+$', '', 'g');
    IF v_title  = '' THEN v_title  := NULL; END IF;
    IF v_tax_id = '' THEN v_tax_id := NULL; END IF;

    -- 驗證也是對【合併後】的值:沿用的舊值一樣要過關(歷史 7 碼統編在這裡會被擋下, 而不是被抄走)。
    IF v_title IS NOT NULL
       AND (pg_catalog.char_length(v_title) > 100 OR v_title ~ '[[:cntrl:]]') THEN
      -- 上限 100 碼位:抄 invoice_number 那格的形狀(64), 公司全名比發票號碼長 ⇒ 放寬到 100。
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_title 非法';
    END IF;
    IF v_tax_id IS NOT NULL AND v_tax_id !~ '^[0-9]{8}$' THEN
      -- 同 apps/admin/src/lib/orders/invoice-title-lookup.ts:27 那條 TAX_ID_RE。
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_tax_id 須為 8 碼數字';
    END IF;

    -- 🔴 半填 ⇒ 拒(公司發票兩格缺一不可;fail-closed, 不替他猜另一格)。
    IF (v_title IS NULL) <> (v_tax_id IS NULL) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 抬頭與統編要一起填、或一起清空';
    END IF;

    -- 🔴 type 隨兩格推(Sean 答甲)。carrier / donateCode 原樣不動。
    IF v_title IS NULL THEN
      v_invoice := (v_invoice - 'title' - 'taxId') || pg_catalog.jsonb_build_object('type', 'personal');
    ELSE
      v_invoice := v_invoice || pg_catalog.jsonb_build_object('type', 'company', 'title', v_title, 'taxId', v_tax_id);
    END IF;
  END IF;

  IF v_shipping_method     IS NOT DISTINCT FROM v_cur.shipping_method
     AND v_invoice_number    IS NOT DISTINCT FROM v_cur.invoice_number
     AND v_invoice_amount    IS NOT DISTINCT FROM v_cur.invoice_amount
     AND v_invoice_status    IS NOT DISTINCT FROM v_cur.invoice_status
     AND v_invoice_issued_at IS NOT DISTINCT FROM v_cur.invoice_issued_at
     AND v_invoice           IS NOT DISTINCT FROM v_cur.invoice THEN
    RETURN 'NOOP';
  END IF;

  -- SET 字面恰 6 業務欄+version+updated_at(🔴 workflow_status 與金流欄一律不在此清單)。
  UPDATE public.orders SET
    shipping_method   = v_shipping_method,
    invoice_number    = v_invoice_number,
    invoice_amount    = v_invoice_amount,
    invoice_status    = v_invoice_status,
    invoice_issued_at = v_invoice_issued_at,
    invoice           = v_invoice,
    version           = v_cur.version + 1,
    updated_at        = pg_catalog.now()
  WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 更新列數異常(%)', v_rows;
  END IF;

  -- 🔴 稽核 before/after 都帶 `invoice_issued_at` —— 覆蓋之後舊日期只剩這裡有(plan §2-b-ii)。
  -- 🔴 第 4 代:再帶 'invoice' = 【整包】jsonb, 不只 title / taxId(規格 §2「客人原本填的永遠還原得出來」)。
  --    沒碰 invoice 的那一發也照樣寫整包 —— before = after, diff 頁會略過它, 而 audit 列的形狀恆定。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.workflow.update',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'shipping_method',   v_cur.shipping_method,
      'invoice_number',    v_cur.invoice_number,
      'invoice_amount',    v_cur.invoice_amount,
      'invoice_status',    v_cur.invoice_status,
      'invoice_issued_at', v_cur.invoice_issued_at,
      'invoice',           v_cur.invoice
    ),
    pg_catalog.jsonb_build_object(
      'shipping_method',   v_shipping_method,
      'invoice_number',    v_invoice_number,
      'invoice_amount',    v_invoice_amount,
      'invoice_status',    v_invoice_status,
      'invoice_issued_at', v_invoice_issued_at,
      'invoice',           v_invoice
    ),
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text) IS
  'M-4a Slice C 後台改單;D-2(20260716130000)收窄為 4 業務欄;第 3 代 2026-09-13 P2(20260913050000)加第 5 欄 invoice_issued_at(date, YYYY-MM-DD 字串進;規則:變成 issued 那一次必須明確帶日期 P9I01、issued 最終一定要有日期 P9I01、不得早於訂單成立台北日 P9I02、不得是未來台北日 P9I03;離開 issued 時日期留著);第 4 代(20260913060000)加發票抬頭 / 統編(orders.invoice jsonb 的 title / taxId, type 隨兩格推:都有值=company、都清空=personal、半填 RAISE、donate RAISE)。SECURITY DEFINER、search_path 空字串、樂觀鎖 version、同交易 admin_audit_log(before/after 含 invoice_issued_at 與整包 invoice)。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role(REPLACE 保留 ACL、事後閘斷言)。';
DO $post$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_update_order_workflow(uuid, integer, jsonb, text, text)');
  IF v_src LIKE '%''ship_to_name''%' OR v_src NOT LIKE '%''invoice_title''%' THEN
    RAISE EXCEPTION '回滾後置閘:貼回的不是第 4 代';
  END IF;
END
$post$;
COMMIT;
