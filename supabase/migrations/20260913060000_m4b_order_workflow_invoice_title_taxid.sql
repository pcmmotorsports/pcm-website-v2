-- 20260913060000_m4b_order_workflow_invoice_title_taxid.sql
-- admin_update_order_workflow 第 3 代:多兩個白名單 key(發票抬頭 / 統編)+ SET invoice + audit 多一個 key。
-- plan:docs/plans/2026-09-13-invoice-title-taxid-editable-plan.md(Sean 2026-09-13 答 Q1 甲, 主視窗裁 Q2-Q4 甲)
--
-- ══ 🔴🔴 第一段就寫這件, 因為它是本檔最容易【全綠而線上炸】的一格 ═══════════════════
--
--   本函式第 2 代(20260716130000:227)是 `SET search_path = public, pg_temp`。
--   本檔改成 `SET search_path = ''` —— 不是風格, 是 `scripts/definer-search-path-gate.py` 對【新檔】判紅
--   (SECURITY DEFINER 而 search_path 含可寫 schema = 提權路徑, 該閘檔頭寫了理由)。
--
--   🛑 而 **`CREATE OR REPLACE` 會把 SET 子句【整組換掉】**(memory `reference_create-or-replace-resets-set-clause`)
--   ⇒ 第 2 代那個 `public, pg_temp` **不會自己留下來** ⇒ 函式體裡任何**沒加 schema 前綴**的引用,
--      typecheck / lint / 全套測試**一格都不會紅**(它們不跑 plpgsql), 而執行期會 `relation does not exist`。
--   ⇒ 📌 **本檔每一個表 / 函式 / 型別引用都有 `public.` 或 `pg_catalog.` 前綴, 而那是逐行核的, 不是「應該都有」。**
--   ⇒ 🔴 **唯一的守門是拋棄式 PG 真的呼叫一次**。下面「事後閘 ⑤」用不存在的 uuid 呼叫 ⇒
--      它證得**參數檢查 / 白名單 / 鎖列 SELECT** 的名稱解析是通的;**證不了** version 比對之後那一段
--      (發票分支 / UPDATE / audit INSERT)—— 那一段由拋棄式 PG 的正向案例證(2026-09-13 十格全跑)。
--   ⇒ 🔬 **負對照(實跑過, 寫對方向)**:**保留** `search_path = ''`、拿掉一個 `public.` 前綴
--      ⇒ 事後閘⑤ 當場 `relation "orders" does not exist`。
--      (⛔ 不是「拿掉 search_path 那行」—— 拿掉之後函式繼承 session 的 search_path, 反而會過。)
--
-- ══ 改什麼 ══════════════════════════════════════════════════════════════════════
--   · 白名單多 'invoice_title' / 'invoice_tax_id'(patch key 用底線名, 與 TS 常數
--     MANUAL_ORDER_INVOICE_TITLE_FIELD / _TAX_ID_FIELD 同字面, manual-order-form.ts:121-122)
--   · 讀 before:整包 orders.invoice jsonb;套 patch 到 title / taxId 兩個 key;
--     🔴 type 隨兩格推(Sean 答甲):兩格都有值 ⇒ 'company';兩格都清空 ⇒ 'personal';
--        只填一格 ⇒ RAISE(公司發票兩格缺一不可, 半填是矛盾;fail-closed);
--        type='donate' 的單碰這兩格 ⇒ RAISE(捐贈發票沒有抬頭統編這回事)。
--   · 空字串 ⇒ 【移除】那個 key, 不是存 ""(CHECK orders_invoice_whitelist 只管鍵名與值型別,
--     "" 合法但語意是「沒填」;存 "" 會讓「沒填」與「填了空白」在資料上分不出來)。
--   · SET 多一行 invoice = v_invoice;其餘凍結欄一個字不動(第 2 代 :334 那條紀律)。
--   · NOOP 判斷併入 v_invoice IS NOT DISTINCT FROM v_cur.invoice。
--   · audit before / after 各多一個 key 'invoice' = 整包 jsonb(規格 §2:客人原本填的永遠還原得出來)。
--
-- ══ 🔴 「API 回應不落庫」那一拍與本檔的邊界(Sean 2026-09-10)═══════════════════════
--   那一拍的受詞是 GCIS 回來的那串字。本檔存的是**員工按確認時輸入框裡的字** = 這張單本來就有的
--   資料(orders.invoice 客人結帳時就填了)。本檔**不存** API 原始回應、**不存**「查來的」來源標記。
--
-- ══ ACL(照第 1 代的形狀, 主視窗 2026-09-13 裁成規矩)═══════════════════════════════
--   ACL 由第 1 代 20260714130000:254-256 設、CREATE OR REPLACE 保留、後代只用事後閘斷言, 不重宣告 GRANT。
--
-- ══ 冪等 ══════════════════════════════════════════════════════════════════════════
--   CREATE OR REPLACE 本身可重跑;本檔零頂層 DML。
--
-- ══ Rollback(Supabase forward-only;人現場寫, runbook §0-b ②)════════════════════
-- SET LOCAL lock_timeout = '5s';
--   ↑ 人把這一段貼進 psql 跑, 而 psql 預設沒有 lock_timeout ⇒ CREATE OR REPLACE 等函式鎖會【無限等】,
--     而「很慢」與「卡在鎖上」在那個畫面是同一個不動的游標(rollback-locktimeout-gate 的理由)。
--   把本函式用第 2 代的定義 CREATE OR REPLACE 回去:20260716130000:217-371 全文,
--   含它的 SET search_path = public, pg_temp;ACL 不用動。
--   資料不用回(第 3 代寫進 orders.invoice 的值 CHECK 過);audit 不用回(多的 key 在舊 diff 頁顯示原代碼)。
--   ⚠️ 回退之後彈窗那兩格要一起回 readOnly —— 否則變成「按了什麼都沒發生」的鈕。
-- ============================================================

-- 🔴 整檔包交易:事後閘紅了 ⇒ 連 CREATE OR REPLACE 一起退。
--    2026-09-13 拋棄式 PG 實撞:第一版事後閘① 字面寫錯 ⇒ 它紅了, **而第 3 代已經套上去**;
--    沒有交易的話正式庫就會停在「新函式 + 閘說它壞了」這個狀態。
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── ⓪ 前置閘:第 2 代必須在, 而且是 public, pg_temp(不是的話代表有人動過, 停下來看)──
DO $$
DECLARE
  v_oid oid;
  v_cfg text[];
  v_src text;
BEGIN
  -- 🔵 to_regprocedure 不存在時回 NULL(直接 ::regprocedure 會先丟錯, NOT FOUND 走不到 —— codex nit)。
  v_oid := pg_catalog.to_regprocedure('public.admin_update_order_workflow(uuid, integer, jsonb, text, text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:admin_update_order_workflow 不在 ⇒ 第 2 代(20260716130000)沒套過, 拒繼續';
  END IF;
  SELECT p.proconfig, p.prosrc INTO v_cfg, v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  -- 🔴 真的認基線:第 2 代 = 白名單恰四個 key(沒有 invoice_title)+ search_path 是 public, pg_temp;
  --    第 3 代重跑 = 已有 invoice_title + search_path 空字串。兩者以外一律停 —— 那代表有人動過。
  IF v_src LIKE '%''invoice_title''%' THEN
    IF v_cfg IS NOT NULL AND 'search_path=""' = ANY (v_cfg) THEN
      RAISE NOTICE '前置閘⓪:已是第 3 代 ⇒ CREATE OR REPLACE 照樣重跑(冪等)';
    ELSE
      RAISE EXCEPTION '前置閘⓪:函式體有 invoice_title 而 search_path 不是空字串(%)⇒ 不認得的一代, 拒繼續', v_cfg;
    END IF;
  ELSE
    IF v_cfg IS NULL OR NOT ('search_path=public, pg_temp' = ANY (v_cfg)) THEN
      RAISE EXCEPTION '前置閘⓪:不是第 2 代的形狀(proconfig=%)⇒ 有人動過, 停下來看', v_cfg;
    END IF;
    IF v_src NOT LIKE '%''invoice_status''%' THEN
      RAISE EXCEPTION '前置閘⓪:函式體沒有 invoice_status ⇒ 比第 2 代還舊, 拒繼續';
    END IF;
  END IF;
END
$$;

-- ── ① 第 3 代 ────────────────────────────────────────────────────────────────
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
  -- 🔴 D-2:workflow_status 已自白名單移除(orders 層停寫);第 3 代加抬頭 / 統編兩個 key。
  v_allowed_keys constant text[] := ARRAY[
    'shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status',
    'invoice_title', 'invoice_tax_id'
  ];
  v_key   text;
  v_cur   public.orders%ROWTYPE;
  v_shipping_method text;
  v_invoice_number  text;
  v_invoice_amount  integer;
  v_invoice_status  text;
  v_invoice         jsonb;
  v_title           text;
  v_tax_id          text;
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
      -- workflow_status(D-2 起)與金流欄一律落此:送到=拒。
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

  v_shipping_method := v_cur.shipping_method;
  v_invoice_number  := v_cur.invoice_number;
  v_invoice_amount  := v_cur.invoice_amount;
  v_invoice_status  := v_cur.invoice_status;
  v_invoice         := v_cur.invoice;

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

  -- ══ 第 3 代:抬頭 / 統編(兩個 key 一起看, 因為 type 是由兩格一起推的)══════════
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

  IF v_shipping_method IS NOT DISTINCT FROM v_cur.shipping_method
     AND v_invoice_number  IS NOT DISTINCT FROM v_cur.invoice_number
     AND v_invoice_amount  IS NOT DISTINCT FROM v_cur.invoice_amount
     AND v_invoice_status  IS NOT DISTINCT FROM v_cur.invoice_status
     AND v_invoice         IS NOT DISTINCT FROM v_cur.invoice THEN
    RETURN 'NOOP';
  END IF;

  -- SET 字面恰 5 業務欄+version+updated_at(🔴 workflow_status 與金流欄一律不在此清單)。
  UPDATE public.orders SET
    shipping_method = v_shipping_method,
    invoice_number  = v_invoice_number,
    invoice_amount  = v_invoice_amount,
    invoice_status  = v_invoice_status,
    invoice         = v_invoice,
    version         = v_cur.version + 1,
    updated_at      = pg_catalog.now()
  WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 更新列數異常(%)', v_rows;
  END IF;

  -- 🔴 audit 的 'invoice' 是【整包】jsonb, 不只 title / taxId:規格 §2「客人原本填的永遠還原得出來」。
  --    沒碰 invoice 的那一發也照樣寫整包 —— before = after, diff 頁會略過它, 而 audit 列的形狀恆定。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.workflow.update',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'shipping_method', v_cur.shipping_method,
      'invoice_number',  v_cur.invoice_number,
      'invoice_amount',  v_cur.invoice_amount,
      'invoice_status',  v_cur.invoice_status,
      'invoice',         v_cur.invoice
    ),
    pg_catalog.jsonb_build_object(
      'shipping_method', v_shipping_method,
      'invoice_number',  v_invoice_number,
      'invoice_amount',  v_invoice_amount,
      'invoice_status',  v_invoice_status,
      'invoice',         v_invoice
    ),
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text) IS
  'M-4a Slice C 後台改單;D-2(20260716130000)收窄為 4 業務欄;第 3 代(20260913060000)加發票抬頭 / 統編(orders.invoice jsonb 的 title / taxId, type 隨兩格推:都有值=company、都清空=personal、半填 RAISE、donate RAISE)。SECURITY DEFINER、search_path 空字串、樂觀鎖 version、同交易 admin_audit_log(before/after 含整包 invoice)。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role(REPLACE 保留 ACL、事後閘斷言)。';

-- ── ② 事後閘 ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
  v_cfg text[];
  v_oid oid := 'public.admin_update_order_workflow(uuid, integer, jsonb, text, text)'::regprocedure;
  v_res text;
BEGIN
  -- ①  search_path 真的是空字串(proconfig 字面)
  --    🔬 字面是 search_path="" —— 帶兩個雙引號。2026-09-13 拋棄式 PG 實測:
  --       我第一版比的是 search_path= (沒引號) ⇒ 這一格自己紅了, 而 CREATE OR REPLACE 已經套上去。
  --       📌 一道閘寫錯字面, 紅的樣子跟「函式真的沒改對」一模一樣 —— 所以這一行的字面是量出來的。
  SELECT p.proconfig INTO v_cfg FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT ('search_path=""' = ANY (v_cfg)) THEN
    RAISE EXCEPTION '事後閘①:search_path 不是空字串 ⇒ %', v_cfg;
  END IF;

  -- ②  SECURITY DEFINER 仍在
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION '事後閘②:不是 SECURITY DEFINER';
  END IF;

  -- ③  ACL 照第 1 代終態(抄 20260716130000:378-390)
  IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION '事後閘③:proacl 為預設(隱含 PUBLIC EXECUTE);拒繼續';
  END IF;
  SELECT pg_catalog.string_agg(COALESCE(r.rolname, 'PUBLIC'), ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
   WHERE p.oid = v_oid
     AND COALESCE(r.rolname, 'PUBLIC') NOT IN ('postgres', 'service_role');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘③:非白名單 grantee:%;拒繼續', v_bad;
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘③:service_role 應可 EXECUTE;拒繼續';
  END IF;

  -- ④  白名單真的有那兩個 key(prosrc 字面;擋「檔案貼錯一代」)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
                   AND p.prosrc LIKE '%''invoice_title''%' AND p.prosrc LIKE '%''invoice_tax_id''%') THEN
    RAISE EXCEPTION '事後閘④:函式體沒有 invoice_title / invoice_tax_id ⇒ 貼到的不是第 3 代';
  END IF;

  -- ⑤ 🔴 真的呼叫一次(不只看字面):search_path='' 之後任何漏前綴的引用會在這裡炸。
  --    用一個不存在的 order_id ⇒ 走到 SELECT … FROM public.orders ⇒ 回 'CONFLICT' ⇒ 表引用是通的。
  --    ⚠️ 這一格只證「走到鎖列那一步之前的引用都通」;UPDATE / INSERT 那幾行由拋棄式 PG 的正向案例證。
  v_res := public.admin_update_order_workflow(
    '00000000-0000-4000-8000-000000000000'::uuid, 1,
    '{"invoice_title":"x","invoice_tax_id":"12345678"}'::jsonb, 'postgate', 'postgate');
  IF v_res <> 'CONFLICT' THEN
    RAISE EXCEPTION '事後閘⑤:不存在的單應回 CONFLICT, 回了 %', v_res;
  END IF;
END
$$;

COMMIT;
