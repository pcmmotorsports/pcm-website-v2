# B-2 apply 前凍結 snapshot —— **補充檔**

> 補足 `docs/reviews/2026-07-19-b2-preapply-snapshot.md` 的缺口,與該檔合起來才是完整的 rollback 權威。
> **取樣/驗證時間**:2026-07-19。來源 = production `bmpnplmnldofgaohnaok`(PG 17.6)唯讀查詢
> + 本機拋棄式 PostgreSQL 17.10 實跑驗證。

## 0. 檔案性質與修訂紀錄(🔴 web Codex 審後更正)

⚠️ **本檔初版把整份宣告為「產出後不得再編輯」,那是過早的宣稱** —— 它在**尚未通過任何一輪審查**
時就自稱凍結,而審查 findings 本來就會改到它。現改為**分層**:

| 段 | 性質 | 可否修訂 |
|---|---|---|
| §1 E11 完整 catalog、§3 `pg_get_functiondef` 全文 | **凍結基線資料**(取自 prod 的事實) | ❌ 不得修改。prod 若再變動 → 另產新檔 |
| §2 指紋常數 | 隨公式版本更新 | ⚠️ 僅在公式更正時重取,須註明世代 |
| §4 驗證紀錄、§5 rollback SQL | 審查期間的工作產物 | ✅ 隨 findings 修訂,並記於下表 |

| 修訂 | 觸發 | 改了什麼 |
|---|---|---|
| r1 | codex 關卡2 round1 M-4 | 建檔:補完整 functiondef + E11 全欄 + rollback SQL |
| r2 | codex 關卡2 round2 #1/#2 | 指紋公式改單一 helper、security label 精確化 → 常數三代 |
| r3 | **web Codex must-fix #1/#2、nit #6** | rollback 改用共用 `pg_temp` helper(原本守門與斷言**各抄一份**、本檔卻稱「自帶一份同義公式」= 假的單一來源);rollback **交付模式改 forward-only migration**;清掉殘留的過強用詞;補三個負向測試 |

### 為什麼需要本檔 —— codex 關卡2 M-4 的三條指控與回應

| codex 指控 | 回應 |
|---|---|
| snapshot 只存 `prosrc` 本體、**不是**完整 `pg_get_functiondef` | ✅ §3 補上完整全文,且已證明與 prod **逐位元組相同**(§4 第 2 條) |
| snapshot 自身未明列 `proretset=false` | ✅ §1 補上 E11 **全欄** |
| repo 內**沒有可直接執行的 rollback**,事故時得臨場組 header | ✅ §5 收錄**預先產生、已 parse 且已正/負向實跑驗證**的 rollback SQL |

🔴 **指紋世代(前兩代皆作廢,勿再引用)**:

| 代 | 8-param 值 | 作廢原因 |
|---|---|---|
| 初代 | `2b898129e49d194c30ab8039b857c0be` | 漏 `proretset` / `prosupport` / security-label(關卡2 M-2)。原 snapshot §2 用的是此值 |
| 二代 | `beca7444c4c29251940509d889fe0c74` | security-label 只比 `objoid`、且誤查 `pg_shseclabel`(round2 #2) |
| **現行** | **`77945871ed5d9f5dcac7f8d53c9f192c`** | — |

## 1. E11 完整 catalog(8-param 基線,prod 實查)【凍結】

| 欄位 | 值 |
|---|---|
| 簽章 | `create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)` |
| `prosrc` md5 / octets | `a60944edb678064c468ba517391cc311` / `12225` |
| `pg_get_function_arguments` | `p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text` |
| `pg_get_expr(proargdefaults,0)` | *(空 —— 無 default)* |
| `proargnames` | `{p_lines,p_address_id,p_shipping_method,p_invoice,p_cart_session_id,p_terms_version,p_client_ip,p_client_ua}` |
| `pronargs` / `pronargdefaults` | `8` / `0` |
| `prosecdef` | `true` |
| `proconfig` | `{"search_path=\"\""}` |
| `proacl` | `{postgres=X/postgres,authenticated=X/postgres}` |
| owner | `postgres` |
| `prorettype` | `jsonb` |
| `proretset` | `false` |
| `lanname` | `plpgsql` |
| `provolatile` / `proparallel` | `v` / `u` |
| `proisstrict` / `proleakproof` | `false` / `false` |
| `procost` / `prorows` | `100` / `0` |
| `prosupport` | `-` |
| security label(`pg_seclabel`,`classoid='pg_proc'` 且 `objsubid=0`) | *(無)* |
| COMMENT md5 / 長度 | `7aec7ae7dbf52af683586a360ccde641` / `584`(全文見原 snapshot §3) |
| `pg_get_functiondef` md5 / octets | `62c1a8898c010eeec3393370dbc1ce78` / `12527`(全文見本檔 §3) |

⚠️ **`pg_shseclabel` 已從指紋與斷言移除**(round2 #2):該表依定義只存 cluster-shared 物件
(role/database/tablespace),函式不可能在其中;原本以 `objoid` 單鍵查它反而可能誤配同值 OID 的角色標籤。
原 snapshot §2「seclabel / shseclabel = 0 / 0」的後半項屬無效查詢,**不再作為斷言依據**。

## 2. 完整指紋(現行公式)

| 對象 | 指紋 |
|---|---|
| 8-param 基線(prod 現況) | **`77945871ed5d9f5dcac7f8d53c9f192c`** |
| 9-param 預期產出(B-2 apply 後) | **`850e2e3cf5f503391df5fe6fe0067cce`** |

🔴 **公式在每個檔案內都只有一份定義**:B-2 migration 用 `pg_temp.b2_create_order_fp(oid)`
(段 2.5 守門 + 檔尾斷言⑧共用);§5 rollback SQL 用 `pg_temp.b2_rollback_fp(oid)`
(守門 + 事後斷言共用)。兩支 helper 的公式逐字同義。

⚠️ **誠實界定**:「同義」由**人工比對 + 兩邊實跑對同一物件得出相同指紋**支持,
**不是**由程式強制;**跨檔案沒有機制保證兩支 helper 永遠一致**(單檔內則是結構性保證)。

涵蓋 20 個輸入 = plan E11 全欄(`pronargs`/`pronargdefaults` 由 args 字串與 default 運算式涵蓋)。

## 3. `pg_get_functiondef` 全文(8-param;md5 `62c1a8898c010eeec3393370dbc1ce78`)【凍結】

> 🔴 零手動轉錄:本機以凍結副本重建 8-param 後由 `pg_get_functiondef` 輸出,
> 再與 prod 的 md5/octets 對帳確認**逐位元組相同**(§4 第 2 條)。
> 驗證法:抽出下列 code block 內容(不含前後 fence,含結尾換行)取 md5,應等於上列值。

```sql
CREATE OR REPLACE FUNCTION public.create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_seq_text       text;
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

  -- ── 8. 產號 + 寫 order ──
  v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
  v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
                  CASE WHEN pg_catalog.length(v_seq_text) < 4 THEN pg_catalog.lpad(v_seq_text, 4, '0') ELSE v_seq_text END;

  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id
  )
  RETURNING id INTO v_order_id;

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
$function$
```

## 4. 驗證紀錄(實跑,非推論)

**本機**:`initdb` 全新 cluster、PostgreSQL **17.10**、僅建 `anon`/`authenticated`/`service_role`/
`payment_confirmer`/`authenticator` 五角色,跑完即銷毀。
**prod**(PG **17.6**):唯讀查詢,或「交易內建物 → 結尾無條件 `RAISE`」自動回滾;跑後已複查零留痕。

| # | 驗證項 | 環境 | 結果 |
|---|---|---|---|
| 1 | 自凍結 snapshot 抽出 COMMENT 與函式體並比 md5 | 本機 | ✅ `7aec7ae7…`/584、`a60944ed…`/12225 **精確相符** |
| 2 | 以該副本重建 8-param,`pg_get_functiondef` 與 prod 對帳 | 本機+prod | ✅ md5 `62c1a889…`、12527 octets **逐位元組相同** |
| 3 | 重建後完整指紋 vs prod 8-param | 本機+prod | ✅ 皆 `77945871…`(含 `proacl` 相同)→ **凍結副本足以重建基線** |
| 4 | 🔴 **語法預檢**:對 migration **檔案原文**(零剔除)整份執行 | 本機 | ✅ 全部語句解析並執行,**零語法錯** |
| 5 | 狀態 A 正向(8-param 基線 → apply) | 本機 | ✅ 斷言矩陣全過並 `COMMIT` |
| 6 | 狀態 B 正向(僅 9-param,模擬 history 裂縫 → 重跑) | 本機 | ✅ 守門放行、斷言全過、`COMMIT` |
| 7 | 🔴 狀態 A 負向:偷偷 `GRANT EXECUTE … TO anon` 後 apply | 本機 | ✅ 守門**擋下**,整批回滾 |
| 8 | 🔴 狀態 B 負向:竄改 9-param 的 COMMENT 後重跑 | 本機 | ✅ 守門**擋下**(關卡2 M-3 修法實證有效) |
| 9 | rollback SQL 正向實跑 | 本機 | ✅ 斷言全過並 `COMMIT`,指紋回到 `77945871…` = **精確還原基線** |
| 10 | `pg_temp` helper 殘留檢查(兩支) | 本機 | ✅ 跑完 `pg_temp*` schema 內同名函式 = **0** |
| 11 | 9-param 預期產出指紋 | **prod** | ✅ 異名複製品(公式不含函式名)交易內求值 = `850e2e3c…`,**與檔內常數相符**;`RAISE` 回滾 |
| 12 | 9-param 函式體推導 | **prod** | ✅ 由 prod **自身 `prosrc`** 套 1 處 delta 推導,md5 = `0bc0d256…` **等於檔內本體**(零轉錄) |
| 13 | 環境相依屬性逐項比對 | **prod** | ✅ ACL / owner / `DEFAULT NULL::text` / argnames / retset / support / cost / rows / config / vol / par / strict / leak / secdef 全部與本機相同 |
| 14 | prod 零留痕複查 | **prod** | ✅ 探針殘留 0、`create_order` 仍 1 個 8-param、`prosrc` md5 未變、`orders` 筆數未變、水位未變 |
| **15** | 🔴 **rollback 守門負向 A:竄改既存 9-param 的 COMMENT 後跑 rollback**(web Codex #1 要求) | 本機 | ✅ **在 `DROP` 之前**失敗;複查:9-param 仍在(`t`)、8-param 未被誤建(`f`) |
| **16** | 🔴 **rollback 守門負向 B:對既存 9-param `GRANT EXECUTE … TO anon` 後跑 rollback** | 本機 | ✅ 同樣被擋,9-param 仍在 |
| **17** | 🔴 **斷言⑧ 負向:改 migration 產物(COMMENT)但常數保持舊值**(web Codex #3 要求) | 本機 | ✅ 明確觸發「斷言⑧失敗」;複查:整批回滾(9-param 不存在)、8-param 基線完好且指紋未被動過 |
| **18** | `CALLED ON NULL INPUT` / `NOT LEAKPROOF` 顯式化後指紋是否改變 | 本機 | ✅ 兩個指紋**皆未改變**(catalog 值本就相同)→ 常數不需重取 |

⚠️ **仍未涵蓋的面**(誠實界定,勿當已驗):

1. `supabase db push` 這支 CLI 的**交易邊界行為**(= migration 檔頭 SOP 所處理的 history 裂縫)——
   Sean 拍 Q3=A 明示**不做** disposable DB failure-injection,故**至今未驗**。
2. **PostgREST schema cache 重載**(plan §6-B 第 9 項的 smoke)—— 屬 apply 後路徑②,尚未執行。
3. **security label 的偵測效果**:`classoid`/`objsubid` 過濾是**結構性修正**,本機無 label provider
   可裝、**未做正向注入測試**;現況兩端皆「無 label」,只證明無 label 時公式正確。
4. **跨檔案的公式一致性**無程式強制(見 §2 界定);單檔內為結構性保證。
5. 本機 PG **17.10** vs prod **17.6**:第 2/3/11/12/13 條的 byte-level 與指紋相符已大幅降低風險,**非證明**。
6. **apply 當下的 in-flight 呼叫與 PostgREST 舊 OID cached plan 行為**(Fable nit-2 補列):
   `DROP FUNCTION` 取的是函式 object 的 `AccessExclusiveLock`,執行中的呼叫通常不持衝突鎖;
   DROP+CREATE 會換 OID、清函式統計。**此面向未做並發實測**。
   現況可接受的理由:prod checkout 尚未開放(3DS flag 全 false)、`create_order` 已逾三週零呼叫
   → 實質零並發流量。⚠️ **flag 開啟後若還要動同一函式,本項必須重新評估、不可沿用此免驗理由。**

## 5. rollback SQL(預先產生、已 parse 驗證、已正/負向實跑驗證)

### 5.1 🔴🔴 步驟 0(**交付模式無關**的硬前置;Fable F2)——「先退 app,再退 DB」

B-4 上線後,已部署的 storefront 會送**第 9 參**。此時**不論走哪種交付模式**,只要先把 DB 退回
8-param,呼叫端就會撞 `42883` / PostgREST `PGRST202 no matching function` → **結帳 100% 全斷**,
直到 app 退版重新部署為止。

⚠️ **這不是「貼 SQL Editor」才會有的後果** —— 走正常 forward-only migration 一樣會發生。
本檔前一版把它寫在「❌ 不要貼 SQL Editor」段落裡當作該模式的罪狀,**等於暗示走 migration 路徑就沒這問題,
不誠實**(Fable 判定為「後果歸因錯位」),已更正。

rollback 前必須先做:

1. 實查已部署的呼叫端是否送第 9 參(= **B-4 是否已上線**)。
2. 若是 → **先把 storefront 退回送 8 參的版本、確認部署已生效**,才准跑 §5.2。
3. 若否(B-4 尚未上線,如 2026-07-19 當下)→ 可直接進下方交付模式。

### 5.2 🔴 交付模式(web Codex must-fix #2;原「貼進 SQL Editor」寫法已作廢)

需要 rollback 時,把 §5.3 另存為**新時戳的 forward-only migration**
(例:`supabase/migrations/<新時戳>_m4a_b2_rollback_create_order_9param.sql`)再走正常 `db push`。

❌ **不要直接貼進 Supabase SQL Editor** —— 那會把 schema 退回 8-param,但
`supabase_migrations.schema_migrations` 仍記載 `20260719120000` 已套用 → 下一次 `db push`
**會跳過 B-2 不再重套**,形成「history 說已套、schema 卻是舊版」的裂縫(正是 B-2 檔頭 SOP
費力防範的那一種);且 B-4 之後的呼叫端仍送 9 參 → 對 8-param 會撞 `42883` 全面失敗。

⚠️ **break-glass**(prod 當機、來不及走 migration 流程)才可用 SQL Editor,且**必須同時**:

1. 手動 reconcile history:`delete from supabase_migrations.schema_migrations where version='20260719120000';`
2. app 端回滾:見 **§5.1 步驟 0**(該項為**交付模式無關**的硬前置,非 break-glass 專屬)。
3. 事後補跑 B-2 檔頭的「查 history → 查簽章 → 查完整指紋」三查 SOP 才算收斂。

🔴 **本段刻意不放進 `supabase/migrations/`** —— 放進去會被下一次 `db push` **自動套用**,
等於把訂單 RPC 無預警退版。

### 5.3 SQL 全文

> 由程式自凍結副本組裝(零手動轉錄),已於本機完整執行通過(§4 第 9/15/16 條)。

```sql
-- ============================================================
-- B-2 ROLLBACK:9-param create_order → 還原 8-param 基線
--
-- 🔴🔴 **步驟 0(交付模式無關的硬前置;Fable F2)——「先退 app,再退 DB」**
--   B-4 上線後,已部署的 storefront 會送**第 9 參**。此時**不論**走哪種交付模式,
--   只要先把 DB 退回 8-param,呼叫端就會撞 `42883` / PostgREST `PGRST202 no matching function`
--   → **結帳 100% 全斷**,直到 app 退版重新部署為止。
--   ⚠️ 這**不是**「貼 SQL Editor」才會有的後果 —— 走正常 forward-only migration 一樣會發生。
--   故 rollback 前必須先做:
--     ① 實查已部署的呼叫端是否送第 9 參(= B-4 是否已上線)。
--     ② 若是 → **先把 storefront 退回送 8 參的版本、確認部署已生效**,才准跑本檔。
--     ③ 若否(B-4 尚未上線,如 2026-07-19 當下)→ 可直接進交付模式。
--
-- 🔴 **交付模式(web Codex must-fix #2 更正;原「貼進 SQL Editor」寫法已作廢)**
--   需要 rollback 時,把本檔**另存為新時戳的 forward-only migration**
--   (例:supabase/migrations/<新時戳>_m4a_b2_rollback_create_order_9param.sql)
--   再走正常 `supabase db push`。
--   ❌ **不要直接貼進 Supabase SQL Editor 執行** —— 那會把 schema 退回 8-param,但
--      `supabase_migrations.schema_migrations` 仍記載 `20260719120000` 已套用 →
--      下一次 `db push` 會**跳過 B-2 不再重套**,形成「history 說已套、schema 卻是舊版」的裂縫
--      (正是 B-2 檔頭 SOP 費力防範的那一種),且 B-4 之後的呼叫端仍送 9 參 → 全面失敗。
--   ⚠️ break-glass(prod 當機、來不及走 migration 流程)才可用 SQL Editor,且**必須同時**:
--      ① 手動 reconcile history:delete from supabase_migrations.schema_migrations
--         where version='20260719120000';(否則裂縫留存)
--      ② app 端回滾:見上方**步驟 0**(該項為交付模式無關的硬前置,非 break-glass 專屬)。
--      ③ 事後補跑 B-2 檔頭的「查 history → 查簽章 → 查完整指紋」三查 SOP 才算收斂。
--
-- 🔴 本檔是「預先產生並經 PG 實際 parse + 實跑驗證」的 rollback SQL(codex 關卡2 M-4)。
--    來源 = docs/reviews/2026-07-19-b2-preapply-snapshot.md 的凍結副本,以程式抽出、零手動轉錄:
--      · 函式體 = snapshot §4 code block,md5 a60944edb678064c468ba517391cc311(12225 octets)
--      · COMMENT = snapshot §3 code block,md5 7aec7ae7dbf52af683586a360ccde641(584 字元)
--
-- 前置:僅在「B-2 已 apply(9-param 生效)且確定要退回」時執行。執行前先讀 plan §9。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- application-defined「create_order DDL 約定鎖」(web Codex nit #6:原用詞把它講成綁定 pg_proc
-- 物件,過強、已改;PG 並未把 advisory key 綁到任何物件)。
-- 與 B-2 migration 共用同一常數 —— 常數即約定,勿改。只互斥同樣寫死此常數的 migration,
-- 對不遵守此約定的外部 DDL 無效。
SELECT pg_advisory_xact_lock(1201033732);

-- ── 指紋函式:**單一定義來源**(web Codex must-fix #1)──────────────────────
--   🔴 原本守門與事後斷言**各抄一份公式**,補充檔卻稱「自帶一份同義公式」——
--      那正是 B-2 主檔 round2 修掉的同一個病(假的單一來源)在 rollback 檔復發。
--      現改為共用 helper,兩處在結構上不可能漂移。公式與 B-2 主檔逐字同義。
CREATE FUNCTION pg_temp.b2_rollback_fp(p_oid oid) RETURNS text
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

-- ── 守門:現況必須恰為「B-2 所建的 9-param」,否則中止(在任何 DROP 之前)──
DO $guard$
DECLARE
  v_oid8 oid := to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  v_oid9 oid := to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
  v_fp   text;
BEGIN
  IF v_oid9 IS NULL THEN
    RAISE EXCEPTION 'rollback 守門:9-param create_order 不存在 → 沒有東西可回退,中止。';
  END IF;
  IF v_oid8 IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 守門:8-param 與 9-param 並存(非 B-2 產出的狀態)→ 中止,交人工判斷。';
  END IF;
  v_fp := pg_temp.b2_rollback_fp(v_oid9);
  IF v_fp IS DISTINCT FROM '850e2e3cf5f503391df5fe6fe0067cce' THEN
    RAISE EXCEPTION 'rollback 守門:現存 9-param 完整指紋=%,非 B-2 的預期產出 % → 已被他人改過,中止,不覆寫未知版本。', v_fp, '850e2e3cf5f503391df5fe6fe0067cce';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);

CREATE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text
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
  v_seq_text       text;
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

  -- ── 8. 產號 + 寫 order ──
  v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
  v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
                  CASE WHEN pg_catalog.length(v_seq_text) < 4 THEN pg_catalog.lpad(v_seq_text, 4, '0') ELSE v_seq_text END;

  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id
  )
  RETURNING id INTO v_order_id;

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

REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text) TO authenticated;
ALTER FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text) OWNER TO postgres;

COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text) IS $cmt$M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄(8-param)+ M-4a V-3a vehicle_snapshot。client 送 variant+qty+address+method+invoice+cart_session_id、每 line 可帶 optional vehicle(給哪台車用;白名單重組逐 kind 隔離、非法=NULL 不擋單、字面凍結零猜)、永不送價/tier;server 注入 terms_version(CURRENT_TERMS_VERSION)+ best-effort client_ip/ua。p_terms_version NULL/空 fail-closed;同 transaction 原子 INSERT order_legal_consents(IP/UA left 截斷)。其餘(取價/防撞/IDOR/溢位/快照/運費)executable 逐字同 20260630120000(行內 rationale 註解精簡、完整見 20260614130000);return 只 {order_id,display_id}。$cmt$;

NOTIFY pgrst, 'reload schema';

-- ── rollback 專屬斷言(snapshot §5;任一不符即 RAISE、不靜默停在半途)──
DO $assert$
DECLARE
  v_fp text; v_sigs int; v_acl text; v_owner text; v_secdef boolean;
  v_cfg text; v_cmt_md5 text; v_src text;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_sigs <> 1 THEN RAISE EXCEPTION 'rollback 斷言失敗:create_order 簽章總數=%(必須恰為 1)', v_sigs; END IF;

  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 斷言失敗:9-param 仍存在'; END IF;

  SELECT coalesce(p.proacl::text,''), pg_get_userbyid(p.proowner)::text,
         p.prosecdef, coalesce(p.proconfig::text,''),
         md5(coalesce(obj_description(p.oid,'pg_proc'),'')), md5(p.prosrc)
    INTO v_acl, v_owner, v_secdef, v_cfg, v_cmt_md5, v_src
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  IF NOT FOUND THEN RAISE EXCEPTION 'rollback 斷言失敗:8-param 未建成'; END IF;

  IF v_src <> 'a60944edb678064c468ba517391cc311' THEN
    RAISE EXCEPTION 'rollback 斷言失敗:prosrc md5=%(預期 a60944edb678064c468ba517391cc311)', v_src; END IF;
  IF v_cmt_md5 <> '7aec7ae7dbf52af683586a360ccde641' THEN
    RAISE EXCEPTION 'rollback 斷言失敗:COMMENT md5=%(預期 7aec7ae7dbf52af683586a360ccde641)', v_cmt_md5; END IF;
  IF v_acl <> '{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'rollback 斷言失敗:proacl=%', v_acl; END IF;
  IF v_owner <> 'postgres' THEN RAISE EXCEPTION 'rollback 斷言失敗:owner=%', v_owner; END IF;
  IF NOT v_secdef THEN RAISE EXCEPTION 'rollback 斷言失敗:prosecdef 非 true'; END IF;
  IF v_cfg <> '{"search_path=\"\""}' THEN RAISE EXCEPTION 'rollback 斷言失敗:proconfig=%', v_cfg; END IF;

  IF NOT has_function_privilege('authenticated','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback 斷言失敗:authenticated 無 EXECUTE'; END IF;
  IF has_function_privilege('anon','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback 斷言失敗:anon 可執行'; END IF;
  IF has_function_privilege('service_role','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback 斷言失敗:service_role 可執行'; END IF;
  IF has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback 斷言失敗:payment_confirmer 可執行'; END IF;
  IF has_function_privilege('authenticator','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback 斷言失敗:authenticator 可執行'; END IF;
  IF has_function_privilege('public','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'rollback 斷言失敗:PUBLIC 可執行'; END IF;

  -- 🔴 完整指紋 == 凍結基線(**與守門共用同一個 helper**,非另抄一份公式)
  v_fp := pg_temp.b2_rollback_fp(to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'));
  IF v_fp <> '77945871ed5d9f5dcac7f8d53c9f192c' THEN
    RAISE EXCEPTION 'rollback 斷言失敗:8-param 完整指紋=%(預期 77945871ed5d9f5dcac7f8d53c9f192c)', v_fp; END IF;

  RAISE NOTICE 'B-2 rollback 斷言全數通過(已精確還原 8-param 基線)';
END
$assert$;

DROP FUNCTION pg_temp.b2_rollback_fp(oid);

COMMIT;
```

— END —
