-- 20260913050000 · M-4b 發票金額月統計 **P2(RPC 那一半)**:`admin_update_order_workflow` 收 `invoice_issued_at`。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
-- 🔴 **順序:P1a(`20260913040000`, 加欄)→ 本支 + 表單 TS 一起上 → P1b(CHECK)。**
--    前置閘② 釘「欄要在」—— **不靠人記順序**。
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼(plan `docs/plans/2026-09-13-invoice-issued-at-monthly-stats-plan.md` §3 P2, Sean 批)
-- ══════════════════════════════════════════════════════════════════
-- 發票登記多一格「開立日期」(員工手填, Sean Q1 乙)。三層必填的**第二層**在本支:
-- 表單擋不住直接打 API 的路, 所以 RPC 要自己擋。第三層(DB CHECK)是 P1b。
--
-- 🔴 **本支的規則(每一條都有一個專屬 SQLSTATE, TS 那側靠碼分流, 不比對訊息字串)**:
-- ```
-- P9I01  最終狀態是 issued 而沒有日期          ⇒「開立日期沒填, 發票登記沒存進去」
-- P9I02  日期早於訂單成立日(台北日)           ⇒「開立日期比訂單成立日(MM/DD)還早, 沒存進去」
-- P9I03  日期是未來(台北日)                   ⇒「開立日期填到未來了, 沒存進去」
-- ```
-- 🔴🔴 **「變成 issued」那一次必須【明確】帶日期, 不能拿列上既有的值代替**(codex 2026-09-13 must-fix):
--    9/28 開 → 作廢而日期留著 → 10/5 重開只改狀態號碼金額 ⇒ 日期仍是 9/28 ⇒ 重開的金額回到 9 月。
--    CHECK 擋不到這一格(列上有值), **只有本支擋得到**。
--    ⇒ 判準:`v_cur.invoice_status <> 'issued' AND v_invoice_status = 'issued'` 而 patch **沒帶** `invoice_issued_at`
--      ⇒ P9I01。⚠️ 同日重開合法 —— **不要求新舊日期不同**。
-- 🔴 **兩個範圍檢查都用【台北日】**(codex R2 must-fix):
--    · 上界 `d > (now() AT TIME ZONE 'Asia/Taipei')::date` —— Supabase session 預設 UTC,
--      台北 10/1 00:30 登記 10/1 時 `current_date` 還是 9/30 ⇒ 合法日期會被判成未來。
--    · 下界 `d < (created_at AT TIME ZONE 'Asia/Taipei')::date` —— `created_at` 是 timestamptz,
--      同日上午建單、當天開票, 直接比會錯擋。
-- 🔵 **離開 issued(→ voided / not_issued)時日期留著不動** —— Q2 甲:作廢不計入統計 ⇒ 那個日期不影響數字;
--    而清掉它會讓「作廢一張的稽核」少一個事實。重開時會被 P9I01 逼著重填 ⇒ 覆蓋(Q6 甲)。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴 CREATE OR REPLACE 的三件事(照 `docs/patterns/revoking-function-execute-in-supabase.md` 與
--    memory `reference_create-or-replace-resets-set-clause`)
-- ══════════════════════════════════════════════════════════════════
-- ① **`SET search_path = ''` 要跟著寫** —— OR REPLACE 會把 SET 子句整組換掉。
--    ⛔ ~~上一代是 `public, pg_temp`~~ ⇒ 🔴 `scripts/definer-search-path-gate.py` 擋下:
--       DEFINER + 可寫 schema 排在前面 = 提權的標準路徑(repo 零處 REVOKE CREATE ON SCHEMA public
--       ⇒ 任何人都建得出同名函式)。⇒ 本代改成空字串, body 裡的物件一律全名(pg_catalog.x / public.y)。
--       📌 這是**上一代就有的洞**, 本支順手關;事後閘② 逐字釘「空字串」(照 20260904200000 ⑤b)。
-- ② **ACL 由 REPLACE 保留**(不重 GRANT / REVOKE);事後閘① 用 aclexplode 複核, 形狀逐字照
--    `20260716130000:373-399`(它就是上一代的斷言)。
-- ③ 簽章不變 `(uuid, integer, jsonb, text, text)` ⇒ 呼叫端零改。
--
-- ══════════════════════════════════════════════════════════════════
-- 冪等:本支【沒有頂層 DML】⇒ 冪等宣告閘不叫。重跑 = 再 REPLACE 一次同一個定義 ⇒ **語意冪等**,
-- 而前置閘① 不擋重跑(它只驗欄與上一代都在)。
--
-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行)
-- ══════════════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- 貼回上一代:`20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:217-371` 那段 CREATE OR REPLACE
-- (含 SET search_path)。🔴 **P1b 貼了之後不可以先退本支** —— 舊 RPC 不寫日期 ⇒ 每一次登記撞 CHECK。
-- 順序:退 P1b 的 CHECK → 退本支 → 欄留著。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE v_cnt int;
BEGIN
  -- 🔴 前置閘①:欄要在(P1a 已貼)—— 本支的 UPDATE 寫它, 欄不在整支炸在第一次呼叫, 而不是貼的時候。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname = 'invoice_issued_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:orders.invoice_issued_at 不在 ⇒ 先貼 20260913040000(P1a), 順序不能反';
  END IF;

  -- 前置閘②:上一代要在(本支是 REPLACE, 不是 CREATE)—— 而且簽章要對
  IF pg_catalog.to_regprocedure('public.admin_update_order_workflow(uuid, integer, jsonb, text, text)') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 admin_update_order_workflow(uuid, integer, jsonb, text, text) ⇒ 本支是 REPLACE, 停';
  END IF;

  -- 前置閘③:三個 SQLSTATE 沒被別支用過(它們是 TS 那側分流的鍵)
  --    ⚠️ 誠實標:pg 不記「誰用過哪個 ERRCODE」, 這一格只能靠 grep 本 repo(2026-09-13:0 命中)。
  --    寫在這裡是讓下一個人知道那三個碼是【被佔用的】。
END
$precondition$;

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
  -- 🔴 2026-09-13 P2:加 `invoice_issued_at`(第五欄)。
  v_allowed_keys constant text[] := ARRAY[
    'shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status', 'invoice_issued_at'
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

  IF v_shipping_method     IS NOT DISTINCT FROM v_cur.shipping_method
     AND v_invoice_number    IS NOT DISTINCT FROM v_cur.invoice_number
     AND v_invoice_amount    IS NOT DISTINCT FROM v_cur.invoice_amount
     AND v_invoice_status    IS NOT DISTINCT FROM v_cur.invoice_status
     AND v_invoice_issued_at IS NOT DISTINCT FROM v_cur.invoice_issued_at THEN
    RETURN 'NOOP';
  END IF;

  -- SET 字面恰 5 業務欄+version+updated_at(🔴 workflow_status 與金流欄一律不在此清單)。
  UPDATE public.orders SET
    shipping_method   = v_shipping_method,
    invoice_number    = v_invoice_number,
    invoice_amount    = v_invoice_amount,
    invoice_status    = v_invoice_status,
    invoice_issued_at = v_invoice_issued_at,
    version           = v_cur.version + 1,
    updated_at        = pg_catalog.now()
  WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 更新列數異常(%)', v_rows;
  END IF;

  -- 🔴 稽核 before/after 都帶 `invoice_issued_at` —— 覆蓋之後舊日期只剩這裡有(plan §2-b-ii)。
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
      'invoice_issued_at', v_cur.invoice_issued_at
    ),
    pg_catalog.jsonb_build_object(
      'shipping_method',   v_shipping_method,
      'invoice_number',    v_invoice_number,
      'invoice_amount',    v_invoice_amount,
      'invoice_status',    v_invoice_status,
      'invoice_issued_at', v_invoice_issued_at
    ),
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text) IS
  'M-4a Slice C 後台改單;D-2(20260716130000)起收窄為 4 業務欄;2026-09-13 P2(20260913050000)加第 5 欄 invoice_issued_at(date, YYYY-MM-DD 字串進)。規則:變成 issued 那一次必須明確帶日期(P9I01)、issued 最終一定要有日期(P9I01)、不得早於訂單成立台北日(P9I02)、不得是未來台北日(P9I03);離開 issued 時日期留著。SECURITY DEFINER owner RPC、樂觀鎖 version、同交易 admin_audit_log(before/after 含 invoice_issued_at)。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role(REPLACE 保留 ACL、事後閘複核)。';

-- ── 事後閘①:REPLACE 後 EXECUTE ACL 維持終態(逐字照 20260716130000:373-399 那段, 它就是上一代的斷言)──
DO $postcheck$
DECLARE
  v_bad text;
  v_src text;
BEGIN
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc
       WHERE oid = 'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure) THEN
    RAISE EXCEPTION '事後閘①:admin_update_order_workflow ACL 異常 — proacl 為預設(隱含 PUBLIC EXECUTE);拒繼續';
  END IF;
  SELECT string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
   WHERE p.oid = 'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure
     AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①:admin_update_order_workflow ACL 異常 — 非白名單 grantee:%;拒繼續', v_bad;
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',
      'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘①:admin_update_order_workflow ACL 異常 — service_role 應可 EXECUTE;拒繼續';
  END IF;

  -- 🔴🔴 事後閘②:**SET search_path 是【空字串】**, 不只是「有釘」(照 20260904200000 ⑤b 那格的理由:
  --    只問有沒有釘 ⇒ 有人改成 `public` 照樣綠, 而那正是 DEFINER 提權的標準路徑)。
  --    ⚠️ PG 存的字面有兩種形狀:`search_path=` 與 `search_path=""`(實測 PG 17 存後者)⇒ 兩個都收, 其餘不收。
  SELECT pg_catalog.array_to_string(p.proconfig, ',') INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure;
  IF coalesce(v_src, '') NOT IN ('search_path=', 'search_path=""') THEN
    RAISE EXCEPTION '事後閘②:DEFINER 的 search_path 不是【空字串】⇒ 提權面。proconfig=%', coalesce(v_src, '(NULL)');
  END IF;

  -- 🔴 事後閘③:新定義真的含那三個 SQLSTATE 與那個欄名(**字面鎖**:REPLACE 貼錯版本會在這裡叫)。
  SELECT pg_catalog.pg_get_functiondef('public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure)
    INTO v_src;
  IF pg_catalog.strpos(v_src, 'P9I01') = 0 OR pg_catalog.strpos(v_src, 'P9I02') = 0
     OR pg_catalog.strpos(v_src, 'P9I03') = 0 OR pg_catalog.strpos(v_src, 'invoice_issued_at') = 0 THEN
    RAISE EXCEPTION '事後閘③:貼上去的定義不含 P9I01/02/03 或 invoice_issued_at ⇒ 貼到舊版了';
  END IF;
  -- 🟢 事後閘③b(負對照):同一把尺對一個現造的碼要答【不含】—— 否則上面那格對任何字串都回 true。
  IF pg_catalog.strpos(v_src, 'P9I99') <> 0 THEN
    RAISE EXCEPTION '事後閘③b(負對照):現造的 P9I99 居然在定義裡 ⇒ 這把尺壞了';
  END IF;
END
$postcheck$;

COMMIT;
