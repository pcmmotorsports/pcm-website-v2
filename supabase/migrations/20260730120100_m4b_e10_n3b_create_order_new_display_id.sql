-- ============================================================
-- M-4b E10 · N3b:create_order 改用 pcm_generate_display_id() + 有界重試
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.4a / §5.4b(N3b 列)
--       docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md §3 / §4.1d
-- 拍板:Sean 2026-07-30 Q1=A —— 只換產號器,既有舊格式訂單完全不動、兩格式永久並存。
-- 片型 R(改既有 RPC)。🔴 高風險片(鐵則 12 ③ DB 結構)。
--
-- ── 唯一的行為 delta ────────────────────────────────────────────
-- 段 8「產號 + 寫 order」:
--   舊:nextval(order_display_seq) → 'PCM-YYYY-NNNN' → 單次 INSERT
--   新:pcm_generate_display_id() → INSERT,包在**上限 5 次**的重試迴圈裡
-- 連帶 DECLARE:移除已無用的 v_seq_text,新增 v_attempt / v_cname。
-- **其餘每一行逐字不動**(consent / items / vehicle_snapshot / notification_email /
-- 運費 CASE / 溢位守門 / return DTO 全在迴圈之外)。
--
-- 🔴 為什麼用 CREATE OR REPLACE、不用 DROP + CREATE:
--   本片**不改簽章**(仍是 9-param)⇒ OR REPLACE 可用,且**保留 ACL 與 owner**,
--   不必重下 REVOKE/GRANT ⇒ 少一個「權限被洗掉」的失敗面。
--   ⚠️ OR REPLACE 對未顯式指定的屬性會取預設值 ⇒ 屬性清單必須完整照抄(已照抄),
--      並由檔尾斷言逐項精確驗證。
--   (20260719120000 用 DROP + CREATE 是因為它把 8-param 改成 9-param,PG 不允許
--    用 OR REPLACE 改參數數量。本片沒有那個需求。)
--
-- 🔴 為什麼重試迴圈在這一層、不在 helper 裡(v2 §5.4a、關卡1 R3 點名):
--   helper 只回候選值;它不可能捕捉呼叫端 INSERT 的 unique violation。
--
-- 🔴 order_display_seq 保留不 DROP:
--   ①回滾要靠它 ②沒人呼它就不前進、完全無害。
--   正式站實查(2026-07-30):last_value=105、is_called=true,而 orders 內舊格式最大
--   序號也是 105 ⇒ 萬一回滾,下一號 = 106,不會與任何舊號相撞。
--   ⚠️ 這個前提**會過期**(將來若有人手動動過 seq)⇒ 回滾前請當場重驗、不要照抄本註解。
--
-- ── 前置 ────────────────────────────────────────────────────────
-- N3a(20260730120000)必須先套用。本片檔頭有硬斷言,沒有它就中止。
--
-- ── 回滾 ────────────────────────────────────────────────────────
-- Supabase forward-only,不要手動改 —— 另立版本號更大的 migration,把段 8 換回
-- nextval 版本(其餘照抄本檔)。🔴 回滾**不會、也不該**把已產生的 6 碼單號改回去:
-- 那些號碼已經在客人手上。
--
-- ── 對抗審查 ────────────────────────────────────────────────────
-- 關卡1 = Fable(codex 兩次未產出結論、Sean 拍板換路)R1 NO-GO 4 must-fix + 5 nit
--   → 全數折入 → R2 GO、剩餘 must-fix 0。本檔直接承接兩條:
--   · F4:狀態判別**不得**照抄 20260719120000 的「overload 存在性」——
--     本片不改簽章、前後都是「只有 9-param」⇒ 照抄會讓首次 apply 就中止。
--     ⇒ 改成【指紋決定狀態】(見段 2)。
--   · R2 指出的最大裸露面:「其餘 653 行逐字不動」零機制在守 ⇒
--     驗收加一道 pg_get_functiondef 前後機械比對(scripts/n3-verify.sh n3b-verbatim)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 段 1:前置閘 —— N3a 必須就位 ───────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION 'N3b 前置閘失敗 — public.pcm_generate_display_id() 不存在。'
                    ' 請先套用 20260730120000(N3a);db push 應會自動依版本號排序';
  END IF;
  -- 不只確認存在,還要確認它真的產得出合約值(N3a 若被人改壞,這裡當場擋下)
  IF public.pcm_generate_display_id() !~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$' THEN
    RAISE EXCEPTION 'N3b 前置閘失敗 — pcm_generate_display_id() 的產出不符 §5.4a 合約';
  END IF;

  -- 🔴 **N8(關卡2-A nit)**:D0(20260729010000)必須已把 `orders_display_id_format`
  --    放寬成收 6 碼。少了這一條,N3b apply 會**全綠**,然後**第一筆真結帳**才死在
  --    `check_violation` —— 而 check_violation 不在段 8 的 `WHEN unique_violation` 內
  --    ⇒ 不重試、直接上拋、對客一般結帳失敗。那是「上線後才炸」的形狀,必須擋在 apply。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname  = 'orders_display_id_format'
       AND pg_get_constraintdef(oid) LIKE '%[23456789BCDFGHJKMNPQRSTVWXYZ]{6}%'
  ) THEN
    RAISE EXCEPTION 'N3b 前置閘失敗 — orders_display_id_format 沒有接受新 6 碼格式的分支。'
                    ' 請先套用 20260729010000(D0);否則本片 apply 會全綠、'
                    ' 但第一筆真結帳會死在 check_violation(不重試、對客一般失敗)';
  END IF;
END
$$;

-- ── 段 2:指紋公式(單一來源;守門與檔尾斷言共用)───────────────
-- 逐字沿用 20260719120000:106-138 的公式(含 proretset / prosupport / security label
-- 三項 —— 那是該檔關卡2 M-2 補齊的,不可精簡)。
CREATE FUNCTION pg_temp.n3b_create_order_fp(p_oid oid) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $fp$
  SELECT md5(
    coalesce(p.prosrc,'')                        || '|' ||
    pg_get_function_arguments(p.oid)             || '|' ||
    coalesce(pg_get_expr(p.proargdefaults,0),'') || '|' ||
    coalesce(p.proargnames::text,'')             || '|' ||
    p.prosecdef::text                            || '|' ||
    coalesce(p.proconfig::text,'')               || '|' ||
    coalesce(p.proacl::text,'')                  || '|' ||
    pg_get_userbyid(p.proowner)::text            || '|' ||
    p.prorettype::regtype::text                  || '|' ||
    p.proretset::text                            || '|' ||
    l.lanname::text                              || '|' ||
    p.provolatile::text                          || '|' ||
    p.proparallel::text                          || '|' ||
    p.proisstrict::text                          || '|' ||
    p.proleakproof::text                         || '|' ||
    p.procost::text                              || '|' ||
    p.prorows::text                              || '|' ||
    p.prosupport::text                           || '|' ||
    coalesce((SELECT string_agg(s.provider || '=' || s.label, ',' ORDER BY s.provider, s.label)
                FROM pg_seclabel s
               WHERE s.objoid = p.oid
                 AND s.classoid = 'pg_proc'::regclass
                 AND s.objsubid = 0), '')        || '|' ||
    coalesce(obj_description(p.oid,'pg_proc'),'')
  )
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = p_oid
$fp$;

-- ── 段 3:apply-time 基線守門 —— 絕不覆寫未知版本 ──────────────
-- 🔴 **F4(Fable 關卡1 must-fix)**:20260719120000 用「8-param 存在 vs 9-param 存在」
--    選狀態,因為它改了參數數量。**本片不改簽章** ⇒ 套用前後都是「只有 9-param」
--    ⇒ 逐字沿用會落進「狀態 B(重跑)」分支、拿本檔的自指常數去比對舊版指紋、
--    **必然不符** ⇒ 正式站首次 db push 即中止。故改成【指紋決定狀態】。
--
-- ⚠️ 狀態 B 的常數是**自指常數**(其輸入含本檔下方的 COMMENT 與函式體)。
--    代償控制:檔尾斷言以**同一個 helper**重算並比對**同一個常數** ⇒
--    有人改了函式體 / COMMENT 卻忘了同步常數,**首次 apply 就會在斷言階段整批回滾並吵**。
DO $guard$
DECLARE
  c_fp_before constant text := '850e2e3cf5f503391df5fe6fe0067cce';  -- 07-19 版(2026-07-30 正式站唯讀實查)
  -- 🔴 **n4(關卡2-B)誠實界定**:本常數在檔內出現**兩份**(段 3 這裡 + 段 6.4),兩份之間
  --    **沒有機械互證**。分岔時的行為:首次 apply(狀態 A)走的是 c_fp_before,
  --    段 3 這份過期**不會被發現**;要到 history 裂縫後重跑(狀態 B)才會炸。
  --    ⇒ fail-closed、不會誤放行,但診斷會延遲。改函式體 / COMMENT 時**兩份都要同步更新**。
  c_fp_after  constant text := '5a04e67df5d7cd1c18c5ae2a634e544a';                    -- 本檔自身產出(自指;與段 6.4 必須同值)
  v_oid8 oid := to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  v_oid9 oid := to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
  v_fp    text;
  v_state text;
  v_dump  text;
BEGIN
  IF v_oid9 IS NULL THEN
    RAISE EXCEPTION 'N3b 守門:9-param create_order 不存在 ⇒ 現況非預期。'
                    ' 本片是「取代既有 RPC」,不負責從零建立它;中止,交人工判斷。';
  END IF;
  IF v_oid8 IS NOT NULL THEN
    RAISE EXCEPTION 'N3b 守門:偵測到 8-param overload 仍存在 ⇒ 現況與兩個已知狀態都不同。'
                    ' 中止,絕不覆寫未知版本。';
  END IF;

  v_fp := pg_temp.n3b_create_order_fp(v_oid9);

  IF v_fp = c_fp_before THEN
    v_state := 'A(首次 apply;現況 = 20260719120000 版)';
  ELSIF v_fp = c_fp_after THEN
    v_state := 'B(history 裂縫後重跑;現況 = 本檔產出)';
  ELSE
    SELECT format('｜實際屬性:args=%s｜argnames=%s｜secdef=%s｜config=%s｜acl=%s｜owner=%s｜ret=%s｜retset=%s｜lang=%s｜vol=%s｜par=%s｜strict=%s｜leak=%s｜cost=%s｜rows=%s｜support=%s｜prosrc_md5=%s｜comment_md5=%s',
        pg_get_function_arguments(p.oid), coalesce(p.proargnames::text,''), p.prosecdef,
        coalesce(p.proconfig::text,''), coalesce(p.proacl::text,''), pg_get_userbyid(p.proowner),
        p.prorettype::regtype::text, p.proretset, l.lanname, p.provolatile, p.proparallel,
        p.proisstrict, p.proleakproof, p.procost, p.prorows, p.prosupport::text,
        md5(coalesce(p.prosrc,'')), md5(coalesce(obj_description(p.oid,'pg_proc'),'')))
      INTO v_dump
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid9;
    RAISE EXCEPTION 'N3b 守門:現行 create_order 的指紋(%)不在兩個已知狀態內'
                    '(A=% / B=%)⇒ 它已被本 migration 之外的變更動過。'
                    ' 中止,絕不覆寫未知版本。%', v_fp, c_fp_before, c_fp_after, v_dump;
  END IF;

  RAISE NOTICE 'N3b 守門通過:狀態 %', v_state;
END
$guard$;

-- ── 段 4:取代函式本體(僅段 8 與 DECLARE 有 delta)─────────────
CREATE OR REPLACE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text,
  p_notification_email text DEFAULT NULL   -- 🔴 B-2 過渡期 DEFAULT;B-6 移除
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
CALLED ON NULL INPUT
NOT LEAKPROOF
COST 100
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
  v_line_total     bigint;
  v_subtotal       bigint := 0;
  v_shipping_fee   integer;
  v_total          bigint;
  v_seen_variants  uuid[] := '{}';
  v_items          jsonb := '[]'::jsonb;
  v_invoice        jsonb;
  v_addr_snapshot  jsonb;
  v_display_id     text;
  -- N3b delta:v_seq_text 移除(不再用序號產號);新增有界重試所需兩個變數。
  v_attempt        integer;
  v_cname          text;
  v_order_id       uuid;
  -- 🔴 V-3a delta:vehicle 白名單重組工作變數(其餘 DECLARE 逐字同 20260630120000)
  v_veh            jsonb;
  v_veh_ok         boolean;
  v_veh_year       integer;
  v_vehicle        jsonb;
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0b. 🔴 #241 同意條款 guard(create_order 路徑「無 consent 不生 order」;codex H4 空字串、B2 限縮為本路徑)──
  IF p_terms_version IS NULL OR pg_catalog.btrim(p_terms_version) = '' THEN
    RAISE EXCEPTION 'create_order: 缺同意條款版本(consent)';
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
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(home/store)──
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型 ──
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限 ──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

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

    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;

    v_unit_price := v_variant.price_general;
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- ── 6v. 🔴 V-3a delta:optional vehicle 白名單重組(鏡像 §4 p_invoice 手法;禁 v_line->'vehicle' 直存)──
    --   逐 kind 隔離(verdict REQUIRED-3):dict 只收 brand/model/year/source(不收 raw)、
    --   free 只收 raw/year/source(不收 brand/model);非空 text ≤200;year=JSON number 4 位整數
    --   1900-2100(regex 先驗防 ::integer 溢位 RAISE)。任何不合 → 該 line v_vehicle=NULL、
    --   不 RAISE 不擋單(選填;與 @pcm/schemas .catch(undefined) 同構)。車種鐵律:零正規化、字面凍結。
    v_vehicle := NULL;
    v_veh := v_line->'vehicle';
    IF v_veh IS NOT NULL AND pg_catalog.jsonb_typeof(v_veh) = 'object' THEN
      v_veh_ok := true;
      v_veh_year := NULL;
      IF v_veh ? 'year' THEN
        -- 🔴 cast 與驗證分離(reviewer Important):::integer 只在 regex 4 位通過「之後」的獨立
        --   statement 執行=可證明無溢位 RAISE(不依賴 AND 短路順序=PG 官方不保證求值順序);
        --   typeof/regex 本身無異常面(->> 回 text/NULL、NULL~pattern=NULL)。
        IF pg_catalog.jsonb_typeof(v_veh->'year') = 'number'
           AND (v_veh->>'year') ~ '^[0-9]{4}$' THEN
          v_veh_year := (v_veh->>'year')::integer; -- regex 已限 4 位、cast 恆安全
          IF v_veh_year < 1900 OR v_veh_year > 2100 THEN
            v_veh_ok := false; -- 超界=整顆作廢(兩層同構;非法不擋單)
          END IF;
        ELSE
          v_veh_ok := false; -- year 形狀不合=整顆作廢(兩層同構;非法不擋單)
        END IF;
      END IF;
      IF v_veh_ok AND v_veh->>'kind' = 'dict' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'brand') = 'string'
           AND pg_catalog.jsonb_typeof(v_veh->'model') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'brand'), '') <> '' AND pg_catalog.length(v_veh->>'brand') <= 200
           AND coalesce(pg_catalog.btrim(v_veh->>'model'), '') <> '' AND pg_catalog.length(v_veh->>'model') <= 200
           AND (v_veh->>'source') IN ('search', 'garage', 'picker') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'dict', 'brand', v_veh->>'brand', 'model', v_veh->>'model',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      ELSIF v_veh_ok AND v_veh->>'kind' = 'free' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'raw') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'raw'), '') <> '' AND pg_catalog.length(v_veh->>'raw') <= 200
           AND (v_veh->>'source') IN ('garage', 'freetext') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'free', 'raw', v_veh->>'raw',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      END IF;
    END IF;

    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total,
      'availability_at_checkout',
        CASE WHEN v_variant.variant_availability = 'in-stock'
              AND v_variant.product_availability = 'in-stock'
             THEN 'in-stock' ELSE 'out-of-stock' END,
      -- 🔴 V-3a delta:白名單重組後快照(NULL → JSON null → §9 NULLIF 轉回 SQL NULL)
      'vehicle',          v_vehicle
    );
  END LOOP;

  -- ── 7. 運費 ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  v_total := v_subtotal + v_shipping_fee;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;

  -- ── 8. 產號 + 寫 order(N3b:6 碼亂碼 + 有界重試)──
  -- 🔴 唯一 delta 就在這一段。重試迴圈**只包 orders 的 INSERT**:
  --    plpgsql 的 BEGIN…EXCEPTION 是子交易,捕捉後只回滾這一次 INSERT;
  --    8b 的 consent 與 9 的 items 都排在迴圈之後 ⇒ 不會被重複寫入。
  -- 🔴 重試迴圈刻意寫在這一層、不在 helper 裡(v2 §5.4a / R3):
  --    helper 只回候選值,它不可能捕捉 INSERT 的 unique violation。
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();

      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id,
        notification_email
      ) VALUES (
        v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
        v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
        p_notification_email
      )
      RETURNING id INTO v_order_id;

      EXIT;   -- 成功寫入 ⇒ 離開重試迴圈
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴 只吞 display_id 的碰撞。其他 unique violation(例如 cart_session_id 去重、
      --    tappay_rec_trade_id)**原樣上拋** —— 那些是語意訊號,重試會把它們吃掉。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        -- 明確報錯、不靜默、不降級。token 供 app 層 catch 後告警(N3b-app、backlog #300)。
        RAISE EXCEPTION 'create_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)'
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- 迴圈理論上不可能在未設值的情況下離開(成功才 EXIT、用盡必 RAISE),
  -- 但「理論上不可能」也是一條沒被測的斷言 ⇒ 明寫出來、fail-closed。
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 重試迴圈結束但 v_order_id 未設值(不該發生)'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 8b. 🔴 #241 同 transaction 原子寫同意紀錄(Gemini 否決拆 RPC 的幽靈訂單;create_order 路徑無 consent 不生 order)──
  --    IP/UA left() 截斷(codex M8;NULL 輸入 left 回 NULL、容忍 best-effort 缺值)。
  INSERT INTO public.order_legal_consents (order_id, terms_version, consented_at, client_ip, client_user_agent)
  VALUES (v_order_id, p_terms_version, pg_catalog.now(),
          pg_catalog.left(p_client_ip, 128), pg_catalog.left(p_client_ua, 1024));

  -- ── 9. 寫 items(V-3a delta:多寫 vehicle_snapshot;NULLIF 把 JSON null 轉回 SQL NULL)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout, vehicle_snapshot
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer,
      v_line->>'availability_at_checkout',
      NULLIF(v_line->'vehicle', 'null'::jsonb)
    );
  END LOOP;

  -- ── 10. return DTO ──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

-- ── 段 5:COMMENT ───────────────────────────────────────────────
COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄 + M-4a V-3a vehicle_snapshot + M-4a B-2 notification_email(9-param)。🆕 **E10 N3b(2026-07-30)**:段 8 產號改呼 public.pcm_generate_display_id()(v2 §5.4a 合約、6 碼亂碼、無前綴),INSERT 包在上限 5 次的有界重試迴圈內;只捕捉 constraint_name = orders_display_id_key 的 unique_violation,其他 unique violation 原樣上拋;用盡則 RAISE(SQLSTATE P0001、message 含 token pcm_display_id_exhausted,供 app 層 catch 後告警 —— 該片延後,見 backlog #300)。order_display_seq 保留但不再被呼叫。🔴 display_id 新舊兩種格式永久並存(Sean 2026-07-30 拍 Q1=A,舊單不改號);orders_display_id_format CHECK 維持兩收、不再收緊(N3c 已取消)。其餘 executable 逐字同 20260719120000(prosrc delta 僅段 8 與 DECLARE)。return 只 {order_id,display_id}。';

-- ── 段 6:收工驗收(fail-closed;任一條不成立 = 整片回滾)────────
DO $$
DECLARE
  v_cnt integer;
  v_txt text;
  v_fp  text;
  c_fp_after constant text := '5a04e67df5d7cd1c18c5ae2a634e544a';
BEGIN
  -- 6.1 屬性逐項精確斷言(OR REPLACE 對未指定屬性取預設值 ⇒ 這裡是唯一保證)
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure
     AND p.prorettype = 'pg_catalog.jsonb'::regtype
     AND p.proretset = false
     AND l.lanname = 'plpgsql'
     AND p.prosecdef = true
     AND p.provolatile = 'v'
     AND p.proparallel = 'u'
     AND p.proisstrict = false
     AND p.proleakproof = false
     AND p.procost = 100
     AND p.pronargs = 9
     AND p.proconfig = ARRAY['search_path=""']
     AND pg_get_userbyid(p.proowner) = 'postgres';
  IF v_cnt <> 1 THEN
    SELECT format('secdef=%s vol=%s par=%s strict=%s leak=%s cost=%s nargs=%s config=%s owner=%s ret=%s',
             p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proleakproof, p.procost,
             p.pronargs, coalesce(p.proconfig::text,'(null)'), pg_get_userbyid(p.proowner),
             p.prorettype::regtype::text)
      INTO v_txt FROM pg_proc p WHERE p.oid = 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure;
    RAISE EXCEPTION 'N3b 驗收失敗 — 屬性不符預期;實際:%', coalesce(v_txt,'(函式不存在)');
  END IF;

  -- 6.2 ACL 未被動到(OR REPLACE 應保留;正式站基線 = postgres + authenticated 各一個 EXECUTE)
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — authenticated 對 create_order 的 EXECUTE 不見了(結帳會全斷)';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('service_role'), ('payment_confirmer')) AS r(role_name)
   WHERE pg_catalog.has_function_privilege(r.role_name, 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure, 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — anon/service_role/payment_confirmer 竟可 EXECUTE create_order(實 % 個)', v_cnt;
  END IF;

  -- 6.3 新產號器已接線、舊產號器已完全離線(prosrc 字面雙向檢查)
  SELECT prosrc INTO v_txt FROM pg_proc WHERE oid = 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure;
  IF pg_catalog.strpos(v_txt, 'public.pcm_generate_display_id()') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 函式體內找不到 pcm_generate_display_id() 呼叫';
  END IF;
  IF pg_catalog.strpos(v_txt, 'order_display_seq') > 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 函式體內仍有 order_display_seq(舊產號器未離線)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'orders_display_id_key') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 重試迴圈未核對 constraint_name(會吞掉其他 unique violation)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'pcm_display_id_exhausted') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 用盡路徑缺 token pcm_display_id_exhausted(app 層無從 catch)';
  END IF;
  -- 🔴 既有行為必須還在(654 行逐字重抄的最小字面守門;完整保證見
  --    scripts/n3-verify.sh n3b-verbatim 的 pg_get_functiondef 機械比對)
  IF pg_catalog.strpos(v_txt, 'v_subtotal >= 5000 THEN 0 ELSE 100') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 段 7 運費 CASE 不見了(#216 drift gate 的對照目標)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'order_legal_consents') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 段 8b 同意紀錄寫入不見了(#241:無 consent 不生 order)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'vehicle_snapshot') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 段 9 vehicle_snapshot 不見了(V-3a)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'availability_at_checkout') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 段 9 availability 快照不見了(#214a)';
  END IF;
  IF pg_catalog.strpos(v_txt, '訂單總額溢位') = 0 THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 段 7 溢位守門不見了';
  END IF;

  -- 6.4 自指指紋:證明「常數 == 本檔實際產出」。
  --     🔴 誠實界定(承接 20260719120000 的教訓):本條只證明常數與檔案內容一致,
  --        **證不了「654 行抄對了」** —— 抄漏一行它照樣綠。那一面由
  --        scripts/n3-verify.sh n3b-verbatim(pg_get_functiondef 前後機械 diff)負責。
  v_fp := pg_temp.n3b_create_order_fp('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure);
  IF v_fp IS DISTINCT FROM c_fp_after THEN
    RAISE EXCEPTION 'N3b 驗收失敗 — 自指指紋不符:實際 %,常數 %。'
                    ' 意思是本檔的函式體 / COMMENT / ACL 改過但兩處常數沒同步更新'
                    '(段 3 的 c_fp_after 與段 6 的 c_fp_after)。'
                    ' 修法:把實際值填進那兩處常數後重跑。', v_fp, c_fp_after;
  END IF;

  RAISE NOTICE 'N3b 驗收全數通過(屬性 + ACL + 產號器雙向接線 + 5 項既有行為字面 + 自指指紋 %)', v_fp;
END
$$;

COMMIT;
