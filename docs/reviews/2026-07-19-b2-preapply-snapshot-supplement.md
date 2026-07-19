# B-2 apply 前凍結 snapshot —— **補充檔**(codex 關卡2 M-4 / round2 #1#2)

> **本檔補足 `docs/reviews/2026-07-19-b2-preapply-snapshot.md` 的缺口,與該檔合起來才是完整的 rollback 權威。**
> ⚠️ 本檔同為**凍結副本**,產出後不得再編輯;prod 若再變動,另產新檔而非改本檔。
> **取樣/驗證時間**:2026-07-19。來源 = production `bmpnplmnldofgaohnaok`(PG 17.6)唯讀查詢
> + 本機拋棄式 PostgreSQL 17.10 實跑重建驗證。

## 0. 為什麼需要本檔 —— codex 關卡2 M-4 的三條指控與逐條回應

| codex 指控 | 回應 |
|---|---|
| snapshot 只存 `prosrc` 本體、**不是**完整 `pg_get_functiondef` | ✅ 本檔 §3 補上完整 `pg_get_functiondef` 全文,且已證明與 prod **逐位元組相同**(§4 驗證紀錄) |
| snapshot 自身未明列 `proretset=false` | ✅ 本檔 §1 補上 E11 **全欄**,含 `proretset` / `prosupport` / `pronargs` / `pronargdefaults` / `proargnames` |
| repo 內**沒有可直接執行的 rollback migration**,事故時得臨場組 header | ✅ 本檔 §5 收錄**預先產生、已 parse 驗證且已實跑驗證**的完整 rollback SQL,含守門與專屬斷言 |

🔴 **指紋取代關係(已歷兩次更正,前兩代皆作廢)**:

| 代 | 8-param 值 | 作廢原因 |
|---|---|---|
| 初代 | `2b898129e49d194c30ab8039b857c0be` | 公式漏 `proretset` / `prosupport` / security-label(關卡2 **M-2**)。原 snapshot §2 末列與 §5 第 1 項用的就是此值 |
| 二代 | `beca7444c4c29251940509d889fe0c74` | security-label 只比 `objoid`(缺 `classoid`/`objsubid`)且誤查 `pg_shseclabel`(關卡2 **round2 #2**) |
| **現行** | **`77945871ed5d9f5dcac7f8d53c9f192c`** | — |

原 snapshot 因自訂「產出後不得再編輯」而保持原狀,不回頭改寫;**引用時一律以本檔為準**。

## 1. E11 完整 catalog(8-param 基線,prod 實查)

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
| **`proretset`** | **`false`** ← snapshot 未明列,本檔補 |
| `lanname` | `plpgsql` |
| `provolatile` / `proparallel` | `v` / `u` |
| `proisstrict` / `proleakproof` | `false` / `false` |
| `procost` / `prorows` | `100` / `0` |
| **`prosupport`** | **`-`** ← snapshot 併在「cost/rows/support」列,本檔獨立明列 |
| security label(`pg_seclabel`,`classoid='pg_proc'` 且 `objsubid=0`) | *(無)* |
| COMMENT md5 / 長度 | `7aec7ae7dbf52af683586a360ccde641` / `584`(全文見原 snapshot §3) |
| `pg_get_functiondef` md5 / octets | `62c1a8898c010eeec3393370dbc1ce78` / `12527`(全文見本檔 §3) |

⚠️ **`pg_shseclabel` 已從指紋與斷言中移除**(關卡2 round2 #2):該表依定義只存 cluster-shared
物件(role / database / tablespace),函式**不可能**出現在其中;原本以 `objoid` 單鍵查它,
反而可能誤配到**同一 OID 數值的角色標籤**。原 snapshot §2「seclabel / shseclabel = 0 / 0」
的後半項屬無效查詢,**不再作為斷言依據**。

## 2. 完整指紋(現行公式)

| 對象 | 指紋 |
|---|---|
| 8-param 基線(prod 現況) | **`77945871ed5d9f5dcac7f8d53c9f192c`** |
| 9-param 預期產出(B-2 apply 後) | **`850e2e3cf5f503391df5fe6fe0067cce`** |

🔴 **公式只有一份定義**(關卡2 round2 #1):migration 內的
`pg_temp.b2_create_order_fp(oid)`,段 2.5 守門與檔尾斷言⑧**共用同一個 helper**。
原設計把公式抄兩份並宣稱「不一致就 fail-closed」——**該宣稱不成立**(斷言⑧只驗自己的公式
對自己的常數,從不與段 2.5 比對),已改為結構性單一來源。本檔 §5 的 rollback SQL 因屬
獨立檔案/獨立 session,自帶一份同義公式,其正確性由 §4 第 9 條的實跑結果背書。

涵蓋 20 個輸入 = plan E11 全欄(`pronargs` / `pronargdefaults` 由 args 字串與 default
運算式字面涵蓋)。重取方式:對目標 oid 呼叫該 helper。

## 3. `pg_get_functiondef` 全文(8-param;md5 `62c1a8898c010eeec3393370dbc1ce78`)

> 🔴 零手動轉錄:本段由本機以凍結副本重建 8-param 後,以 `pg_get_functiondef` 輸出,
> 再與 prod 的 md5/octets 對帳確認**逐位元組相同**(見 §4 第 2 條)。
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

**本機環境**:`initdb` 全新 cluster、PostgreSQL 17.10、port 55432、僅建 `anon` /
`authenticated` / `service_role` / `payment_confirmer` / `authenticator` 五個角色,跑完即銷毀。
**prod 環境**:所有 prod 查詢皆唯讀,或以「交易內建物 → 結尾無條件 `RAISE`」自動回滾;跑後已複查零留痕。

| # | 驗證項 | 環境 | 結果 |
|---|---|---|---|
| 1 | 自凍結 snapshot §3/§4 抽出 COMMENT 與函式體,md5 比對 | 本機 | ✅ `7aec7ae7…`/584 與 `a60944ed…`/12225 **精確相符** |
| 2 | 以該副本重建 8-param,取 `pg_get_functiondef` 與 prod 對帳 | 本機+prod | ✅ md5 `62c1a889…`、12527 octets **逐位元組相同** |
| 3 | 重建後算完整指紋,與 prod 8-param 對帳 | 本機+prod | ✅ 皆為 `77945871…`(含 `proacl` 精確相同)→ **證明凍結副本足以重建基線** |
| 4 | 🔴 **語法預檢**:對 migration 檔**原文**(未做任何剔除)整份執行 | 本機 | ✅ `BEGIN` / `SET LOCAL` / `pg_advisory_xact_lock` / `CREATE FUNCTION pg_temp…` / 守門 DO / `DROP`×2 / `CREATE` / `REVOKE` / `GRANT` / `ALTER OWNER` / `COMMENT ON FUNCTION` / `NOTIFY` / 斷言 DO / `DROP FUNCTION pg_temp…` / `COMMIT` **全數解析並執行,零語法錯** |
| 5 | 狀態 A 正向:8-param 基線 → apply | 本機 | ✅ 斷言矩陣全過並 `COMMIT` |
| 6 | 狀態 B 正向:僅 9-param(模擬 history 裂縫)→ 重跑 | 本機 | ✅ 守門放行、斷言全過、`COMMIT`(可重跑成立) |
| 7 | 🔴 狀態 A 負向:偷偷 `GRANT EXECUTE … TO anon` 後 apply | 本機 | ✅ 守門**擋下**,整批回滾 |
| 8 | 🔴 狀態 B 負向:竄改 9-param 的 COMMENT 後重跑 | 本機 | ✅ 守門**擋下** → **M-3 修法實證有效**(舊設計會靜默覆寫) |
| 9 | rollback SQL(§5)實跑 | 本機 | ✅ 斷言全過並 `COMMIT`,指紋回到 `77945871…` = **精確還原基線** |
| 10 | `pg_temp` helper 是否殘留 | 本機 | ✅ apply 後查 `pg_temp*` schema 內同名函式 = **0** |
| 11 | 9-param 預期產出指紋 | **prod** | ✅ 以**異名複製品**(`b2_fp_probe`,指紋公式不含函式名)在交易內建出後求值 = `850e2e3c…`,**與本機/檔內常數相符**;結尾 `RAISE` 回滾 |
| 12 | 9-param 函式體推導 | **prod** | ✅ 由 prod **自身 `prosrc`** 套 1 處 delta 推導,md5 = `0bc0d256…` **等於 migration 檔內本體**(零轉錄) |
| 13 | 環境相依屬性(ACL / owner / `DEFAULT NULL` 呈現 / argnames / retset / support / cost / rows / config / vol / par / strict / leak / secdef) | **prod** | ✅ 逐項與本機相同;特別是 `pg_get_function_arguments` 對第 9 參呈現為 `p_notification_email text DEFAULT NULL::text`、`pg_get_expr(proargdefaults,0)` = `NULL::text` |
| 14 | prod 零留痕複查 | **prod** | ✅ 探針殘留 0、`create_order` 仍 1 個 8-param 簽章、`prosrc` md5 未變、`orders` 筆數未變、migration 水位未變 |

⚠️ **仍未涵蓋的面**(誠實界定,勿當已驗):
1. `supabase db push` 這支 CLI 的**交易邊界行為**(= migration 檔頭 SOP 所處理的 history 裂縫)——
   Sean 拍 Q3=A 明示**不做** disposable DB failure-injection,故此項**至今未驗**。
2. **PostgREST schema cache 重載**(plan §6-B 第 9 項的 smoke)—— 屬 apply 後路徑②,尚未執行。
3. **security label 的偵測效果**:`classoid`/`objsubid` 過濾是**結構性修正**,但本機無 label provider
   可裝、**未做正向注入測試**;現況兩邊皆為「無 label」,只證明公式在無 label 時正確。
4. 本機 PG 17.10 vs prod 17.6 的版本差:第 2/3/11/12/13 條的 byte-level 與指紋相符已大幅降低風險,但非證明。

## 5. rollback SQL(預先產生、已 parse 驗證、已實跑驗證)

> 🔴 **刻意不放在 `supabase/migrations/`** —— 放進去會被下一次 `db push` 自動套用。
> 需要 rollback 時:由 Sean 複製本段到 Supabase SQL Editor 執行,或另存為新時戳 migration。
> 本段由程式自凍結副本組裝(零手動轉錄),已於本機完整執行通過(§4 第 9 條)。

```sql
-- ============================================================
-- B-2 ROLLBACK:9-param create_order → 還原 8-param 基線
--
-- 🔴 本檔是「預先產生並經 PG 實際 parse 驗證」的 rollback SQL(codex 關卡2 M-4)。
--    來源 = docs/reviews/2026-07-19-b2-preapply-snapshot.md 的凍結副本,以程式抽出、零手動轉錄:
--      · 函式體 = snapshot §4 code block,md5 a60944edb678064c468ba517391cc311(12225 octets)
--      · COMMENT = snapshot §3 code block,md5 7aec7ae7dbf52af683586a360ccde641(584 字元)
--    ⚠️ **刻意不放在 supabase/migrations/**:放進去會被下一次 db push 自動套用。
--       需要 rollback 時,由 Sean 複製本段到 Supabase SQL Editor 執行,或另存為新時戳 migration。
--
-- 前置:僅在「B-2 已 apply(9-param 生效)且確定要退回」時執行。執行前先讀 plan §9。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 與 B-2 migration 共用同一把 object-scoped 鎖(常數即約定,勿改)
SELECT pg_advisory_xact_lock(1201033732);

-- ── 守門:現況必須恰為「B-2 所建的 9-param」,否則中止 ──
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
  ) INTO v_fp
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = v_oid9;
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
  ), coalesce(p.proacl::text,''), pg_get_userbyid(p.proowner)::text,
         p.prosecdef, coalesce(p.proconfig::text,''),
         md5(coalesce(obj_description(p.oid,'pg_proc'),'')), md5(p.prosrc)
    INTO v_fp, v_acl, v_owner, v_secdef, v_cfg, v_cmt_md5, v_src
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
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

  -- 🔴 完整指紋 == 凍結基線(涵蓋 proretset / prosupport / seclabel,與 B-2 段 2.5 同一公式)
  IF v_fp <> '77945871ed5d9f5dcac7f8d53c9f192c' THEN
    RAISE EXCEPTION 'rollback 斷言失敗:8-param 完整指紋=%(預期 77945871ed5d9f5dcac7f8d53c9f192c)', v_fp; END IF;

  RAISE NOTICE 'B-2 rollback 斷言全數通過(已精確還原 8-param 基線)';
END
$assert$;

COMMIT;
```

— END —
