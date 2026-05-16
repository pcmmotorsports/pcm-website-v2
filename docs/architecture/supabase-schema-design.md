# Supabase Schema Design

> **Status:** 🟢 拍板 / 2026-05-04 / ADR-0005 採用後落地
> **拍板人:** Sean(ADR-0005「Custom + Supabase 直寫架構」採用)
> **層級:** docs/architecture/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0001-0005 ADR
> **本檔角色:** 9 contexts 完整 Supabase 表 schema + RLS policy + 索引策略 + 9 大藍圖預留
>
> **取代:** `docs/architecture/medusa-schema-design.md`(2026-05-04 / M-1-03-pre0b Superseded)
>
> 配合閱讀:
> - `docs/decisions/0003-domain-entity-naming.md` §4(9 條 wire ↔ domain mapping、wire 端改 Supabase)
> - `docs/decisions/0004-m1-pre-launch-decisions.md`(Q1 Pro / Q2 Storage / Q3 search 兩階段 / Q4 Money brand type)
> - `docs/decisions/0005-custom-supabase-direct.md`(本檔上位 ADR)
> - `docs/architecture/security-timeline.md` §3(31 條安全項、本檔 §6 + §9 對應)
> - `docs/PHASE-2-VISION.md` §3(9 大藍圖預留、本檔 Part 3 對應)
> - `docs/phase-1-backlog.md` #30 / #35 / #43 / #57 / #81(scale + variants 議題、本檔 §10 索引策略對應)
> - `packages/domain/src/catalog/types.ts`(M-1-02 落地 Product 7 欄位、本檔 §2 wire 對應)
> - `packages/domain/src/shared/types.ts`(MoneyAmount brand type、Money、MemberTier、本檔 §5 對應)

---

# Part 1:Catalog 核心 schema

## §1 結構導引(Part 1)

本 Part 1 涵蓋 Catalog 4 條核心 schema(對齊 ADR-0005 §2.1「Catalog / Identity / Order / Pricing 4 contexts 改走 Supabase 自家表」):

| § | 內容 | 對應 ADR-0003 §4 衝突點 |
|---|---|---|
| §2 | Product 表(7 欄位 + fitments + priceByTier + images) | #3 fits / #6 priceByTier / #7 SKU / #5 vehicles(透過 customer 而非 product) |
| §3 | Brand 表(value-object FK 引用) | #1 brand collection FK |
| §4 | Category 表(parent_id 樹結構) | #2 category 樹 |
| §5 | Tier Price 設計(三 customer_group + jsonb) | #6 Price List / #8 customer_group |
| §6 | Security Checks(對應 security-timeline §3) | C4 priceByTier 不洩漏 |

---

## §2 Product 表

### 2.1 表 schema(Supabase PG)

```sql
CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     text UNIQUE NOT NULL,        -- SKU 命名規則、對齊 ADR-0003 §4 #7、backlog #78 商品名硬規範
  title           text NOT NULL,
  subtitle        text,                        -- M-1-13 ProductPage 顯示、對齊 catalog/types.ts:Product.subtitle
  description     text,
  handle          text UNIQUE NOT NULL,        -- SEO URL slug、kebab-case、對齊 catalog/types.ts:Product.handle
  price_by_tier   jsonb NOT NULL,              -- 對齊 ADR-0003 §4 #6 + §5 priceByTier 不洩漏鐵則
  fitments        jsonb NOT NULL DEFAULT '[]', -- structured array(motoBrand / modelCode / yearStart / yearEnd)、對齊 ADR-0004 wrs Q1=A1
  images          jsonb NOT NULL DEFAULT '[]', -- URL string array、對齊 ADR-0004 Q2=A2 Supabase Storage
  availability    text NOT NULL DEFAULT 'in-stock', -- 對齊 M-1-02 Q4=A1 訂貨型業務、ProductAvailability type alias
  brand_id        uuid REFERENCES brands(id) ON DELETE RESTRICT,
  category_id     uuid REFERENCES categories(id) ON DELETE RESTRICT,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT availability_valid CHECK (
    availability IN ('in-stock', 'out-of-stock')
  ),
  CONSTRAINT price_by_tier_keys CHECK (
    price_by_tier ? 'general' AND
    price_by_tier ? 'store'
  )
);
```

**CHECK 二 key 設計理由(對齊 M-1-03-post-supplement Pricing 公式):**
`price_by_tier` 僅 seed `general` + `store` 兩 key、`premiumStore` tier 由 storefront 用 `brands.premium_extra_pct` 動態算(`store × (1 - premium_extra_pct / 100)`)、不在 jsonb 內寫死;tier 列舉仍維持三級(`general` / `store` / `premiumStore`、§5.2 + §5.3 字面)、僅 pricing 表達方式由「三 key 全 seed」改為「二 key seed + 公式算第三」。

索引策略見 §10。

**M-1-05 刀 2 Sub-slice 2-1 新增雙欄(雙寫過渡期):**

```sql
ALTER TABLE products ADD COLUMN price_general integer;
ALTER TABLE products ADD COLUMN price_store integer;
ALTER TABLE products ADD CONSTRAINT price_general_non_negative CHECK (price_general IS NULL OR price_general >= 0);
ALTER TABLE products ADD CONSTRAINT price_store_non_negative CHECK (price_store IS NULL OR price_store >= 0);
```

雙寫過渡期紀律:
- source of truth 仍是 `price_by_tier` jsonb(本表 CHECK 二 key 維持不變)
- save 路徑 application 層雙寫(`price_by_tier` jsonb + `price_general` + `price_store`、Sub-slice 2-3 落地)
- view 投射用 `price_general`(`products_public` + `products_list_public` 皆含)、`price_store` 永不投射
- NOT NULL 加上推遲(雙寫穩定後另開 migration、防 save 漏雙寫即炸)
- 退場路徑:M-2-08 IPricingService 落地後評估退場 `price_by_tier` jsonb、改 price_general / price_store 為 source of truth

### 2.2 對應 domain entity(packages/domain/src/catalog/types.ts、M-1-02 落地)

| Supabase 欄位 | 型 | 對應 domain | 備註 |
|---|---|---|---|
| `id` | uuid | `Product.id: ProductId` | UUID v4、application 層用 string |
| `external_id` | text | (推延、Phase 2 vendor crawler 用) | SKU 唯一性鐵則 |
| `title` | text | `Product.name` | wire 用 `title`、domain 用 `name`(對齊 medusa-schema-design 既有 mapper convention、語意對齊) |
| `subtitle` | text | `Product.subtitle` | M-1-13 ProductPage 顯示 |
| `description` | text | `Product.description` | 純文字 / Markdown 後續決定 |
| `handle` | text | `Product.handle` | SEO URL slug |
| `price_by_tier` | jsonb | `Product.priceByTier: PriceByTier` | Record<MemberTier, Money>、§5 詳述 |
| `fitments` | jsonb | `Product.fitments: FitmentSpec[]` | §2.4 結構化字面 |
| `images` | jsonb | `Product.images: string[]` | URL string array |
| `availability` | text | `Product.availability: ProductAvailability` | enum: 'in-stock' \| 'out-of-stock' |
| `brand_id` | uuid FK | `Product.brand: Brand` | adapter 邊界 join brands 表還原 value-object(§3) |
| `category_id` | uuid FK | `Product.category: CategoryPath` | adapter 邊界 join categories 表 + 路徑解析(§4) |
| `metadata` | jsonb | (推延) | Phase 2 vendor crawler / sync-engine 用 |
| `created_at` | timestamptz | `Product.createdAt: Date` | 對齊 catalog/types.ts |
| `updated_at` | timestamptz | `Product.updatedAt: Date` | 樂觀鎖比對基礎、對齊 backlog #86 contract test |

### 2.3 Mapping 規則(wire ↔ domain)

| domain 操作 | adapter 邊界 mapper | 來源 |
|---|---|---|
| `Product` ← Supabase wire | `mapSupabaseProductToDomain(row): Product` | 對齊 ADR-0003 §3.4 命名規則 |
| `Product` → Supabase wire | `mapDomainProductToSupabase(domain): SupabaseProductRow` | 對齊 ADR-0003 §3.4 |
| `findById(id: ProductId)` | `supabase.from('products').select('*, brands(*), categories(*)').eq('id', id).single()` + map wire→domain | M-1-03 SupabaseProductAdapter 落地 |
| `listByCategory(category)` | `.from('products').select(...).eq('category_id', category.id)` + map | 同 |
| `listByBrand(brandId)` | `.from('products').select(...).eq('brand_id', brandId)` + map | 同 |
| `listByFitment(spec)` | `.from('products').select(...).contains('fitments', [{ motoBrand, modelCode }])` + map(jsonb 操作)| §2.4 + §10 索引策略 |
| `searchByKeyword(query)` | M-1-03 dev 期 `ILIKE`、M-6 切 tsvector + GIN + pg_jieba | §2.5 兩階段 |
| `save(product)` | upsert: `.from('products').upsert(row).select().single()` + map;updated_at 比對(M-1-03 落地時實作) | 對齊 packages/ports/src/IProductRepository.ts:save |

### 2.4 fitments 結構化(對齊 ADR-0004 wrs Q1=A1 + ADR-0003 §4 #3 + medusa-schema-design.md §2.4 邏輯保留)

`products.fitments` jsonb 字面範例:

```json
[
  { "motoBrand": "Yamaha", "modelCode": "CBR600RR", "yearStart": 2018, "yearEnd": 2024 },
  { "motoBrand": "Yamaha", "modelCode": "MT-09", "yearStart": 2025, "yearEnd": null }
]
```

四種狀態(對齊 catalog/types.ts:FitmentSpec yearStart / yearEnd | null + ADR-0004 wrs Q1=A1):

| 情況 | yearStart | yearEnd | 語意 |
|---|---|---|---|
| 無年份限制 | undefined | undefined | 此車型全年式適用 |
| 年份範圍 | 2018 | 2024 | 2018 ~ 2024 適用 |
| 開放式範圍 | 2025 | null | "2025+"(2025 含以後皆適用) |
| 單年 | 2024 | 2024(或 undefined) | 僅 2024 |

mapper helper(M-1-03 落地):
- `fitmentToWireString(spec): string` — domain → wire string for display(例:`'Yamaha CBR600RR 2018-2024'`)
- `parseWireFitment(str): FitmentSpec` — wire string → domain(對應 sync-engine 解析廠商輸入)
- 配對邏輯 `matchFitment(actual, spec)` 在 InMemoryProductRepository.ts(M-1-02 簡化版、年份範圍重疊邏輯 M-1-03 補、對齊 backlog #83)

### 2.5 search query 兩階段實作(對齊 ADR-0004 Q3=A1)

product 全文檢索分兩階段落地:

| 階段 | Owner Milestone | 實作方式 | 性能預期 | 觸發條件 |
|---|---|---|---|---|
| dev 期 | M-1-03(SupabaseProductAdapter 落地) | PG `ILIKE '%query%'` 對 title / description / fitments 字面 | p99 1-3s @ 200 SKU | 即可、free tier 內可跑 |
| production 切換 | M-6-08(上線前 checklist) | tsvector + GIN index + pg_jieba(中文分詞)| p99 < 100ms @ 5w SKU | 需 Supabase Pro(對齊 #F6 + ADR-0004 Q1=A2 + Q3=A1)|

**M-1-03 實作要點:**
- adapter `searchByKeyword` 用 `.from('products').or('title.ilike.%query%,description.ilike.%query%')` 暫代
- JSDoc 註明「M-6 切 tsvector」(對齊 packages/ports/src/IProductRepository.ts:searchByKeyword JSDoc 兩階段註記)
- 不預先建 GIN index、避免 free tier extension 衝突

**M-6 切換要點:**
- Supabase Pro 升完(M-6-08 checklist + security-timeline #F6)、跑 migration:加 `search_tsv tsvector` generated column + GIN index + 啟用 `pg_jieba` extension
- adapter `searchByKeyword` 改 `.from('products').textSearch('search_tsv', query, { config: 'jiebacfg' })` + ts_rank 排序
- 上線前回測「中文搜尋 / 英文搜尋 / 數字 SKU」三類 query 各 5 條、p99 達標再切

---

## §3 Brand 表(對齊 ADR-0003 §4 #1)

### 3.1 表 schema

```sql
CREATE TABLE brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,         -- design 字面、例:'CNC RACING'(對齊 ADR-0003 §4 #1)
  slug        text NOT NULL UNIQUE,         -- URL slug、kebab-case、例:'cnc-racing'
  description text,
  logo_url    text,                          -- Supabase Storage URL(對齊 ADR-0004 Q2=A2)
  premium_extra_pct integer NOT NULL DEFAULT 0
    CHECK (premium_extra_pct >= 0 AND premium_extra_pct <= 30),
                                              -- premium tier 加碼 %(0-30、預設 0 = 不加碼);對齊 M-1-03-post-supplement Pricing 公式、storefront 算 `store × (1 - premium_extra_pct / 100)`
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 對應 domain entity

| Supabase 欄位 | 型 | 對應 domain |
|---|---|---|
| `id` | uuid | `Brand.id: string` |
| `name` | text | `Brand.name` |
| `slug` | text | `Brand.slug` |

### 3.3 Mapping 規則

引用 ADR-0003 §4 第 1 條(brand 處置):

> design `product.brand` 是字串 `'CNC RACING'`(原 Medusa 期待 brand collection FK)
> → domain `product.brand: Brand`(value-object: id + name + slug)
> → adapter 雙向 resolve FK ↔ name string;cache 名稱→ID

**adapter 行為(M-1-03 SupabaseProductAdapter 落地):**
- 從 design 字面建商品時、adapter 先查 `brands.name === 'CNC RACING'`、存在取 id、不存在則 INSERT(M-1-16 種子資料 import 時觸發)
- 名稱→ID 快取由 adapter 內部維護、避免重複 round-trip
- `mapSupabaseProductToDomain` 走 Supabase JOIN(`select(*, brands(*))`)、單次 query 取 product + brand 還原 value-object

---

## §4 Category 表(對齊 ADR-0003 §4 #2)

### 4.1 表 schema

```sql
CREATE TABLE categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_category_id  uuid REFERENCES categories(id) ON DELETE RESTRICT,
  name                text NOT NULL,        -- 例:'排氣管'(葉節點)
  raw_path            text NOT NULL UNIQUE, -- 例:'引擎部品 · 排氣管'(根→葉路徑、design 字面字面)
  segments            jsonb NOT NULL,        -- 例:["引擎部品", "排氣管"](解析陣列)
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

### 4.2 對應 domain entity

| Supabase 欄位 | 型 | 對應 domain |
|---|---|---|
| `id` | uuid | (內部 FK、不外洩 domain) |
| `raw_path` | text | `CategoryPath.raw` |
| `segments` | jsonb | `CategoryPath.segments: string[]` |

### 4.3 Mapping 規則

引用 ADR-0003 §4 第 2 條(category 處置):

> design `product.category` 是字串 `「引擎部品 · 排氣管」`(原 Medusa 期待 category 樹)
> → domain `product.category: CategoryPath`(字串 path + 解析陣列)
> → adapter parse 字串 ↔ 樹節點;mapper 處理多語空格分隔

**adapter 行為(M-1-03 SupabaseProductAdapter 落地):**
- 從 design 字面建商品時、adapter 用 `raw_path` UNIQUE 查 categories 表、存在取葉節點 id、不存在則新建路徑全段(parent_category_id 鏈)
- 解析 helper `parseCategoryPath(raw): { name, segments, parent_id_chain }`(M-1-03 補)、處理「·」與全形空格分隔

---

## §5 Tier Price 設計(三 customer_group 策略、對齊 ADR-0003 §4 #6 + #8)

### 5.1 設計選擇

PCM 三 tier 對齊 packages/domain/src/shared/types.ts:MemberTier:

```typescript
export type MemberTier = 'general' | 'store' | 'premiumStore';
```

商品價格走 `products.price_by_tier` jsonb 內聯(非另開 product_price_tier 表):

```json
{
  "general":      { "amount": 4500, "currency": "TWD" },
  "store":        { "amount": 4000, "currency": "TWD" },
  "premiumStore": { "amount": 3800, "currency": "TWD" }
}
```

理由(對齊 medusa-schema-design.md §5.1 設計選擇精神 + 簡化):
- jsonb 內聯:5w SKU × 3 tier = 15w row vs 5w row、節省 join cost
- CHECK constraint(`price_by_tier ? 'general' AND price_by_tier ? 'store'`)強制 general + store 兩 key 全部存在;`premiumStore` tier 不在 jsonb 內、由 storefront 用 `brands.premium_extra_pct` 公式算(對齊 §2.1 CHECK 二 key + M-1-03-post-supplement Pricing 公式)
- amount 是 integer(分位、TWD 元位)、對齊 packages/domain/src/shared/types.ts:MoneyAmount brand type + security-timeline #B3

**雙寫過渡期(M-1-05 刀 2 完工):**
本節 jsonb 字面 source of truth 仍存在、雙欄 `price_general` / `price_store` 為 view 投射來源(§2.1 雙寫紀律詳述)。M-2-08 IPricingService 落地後評估退場 jsonb、改雙欄為 source of truth。

### 5.2 customer_groups 表(對齊 ADR-0003 §4 #8)

```sql
CREATE TABLE customer_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,        -- 'general' | 'store' | 'premiumStore'
  display_name text NOT NULL,              -- '一般會員' | '經銷商' | '高級店家'
  rule         jsonb NOT NULL DEFAULT '{}', -- M-2 自動升級規則(累積儲值門檻)
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO customer_groups (name, display_name, rule) VALUES
  ('general', '一般會員', '{}'),
  ('store', '經銷商', '{"trigger": "manual_review"}'),
  ('premiumStore', '高級店家', '{"trigger": "auto", "threshold": 100000, "currency": "TWD"}');
```

### 5.3 customer.tier 欄位(對齊 ADR-0003 §4 #8 + security-timeline #A3)

```sql
ALTER TABLE customers ADD COLUMN tier text NOT NULL DEFAULT 'general';
ALTER TABLE customers ADD CONSTRAINT customer_tier_valid CHECK (
  tier IN ('general', 'store', 'premiumStore')
);
ALTER TABLE customers ADD CONSTRAINT customer_tier_fk FOREIGN KEY (tier)
  REFERENCES customer_groups(name) ON UPDATE CASCADE;
```

**rule:** `customer.tier` 由 server-side 重查、不信 client 送的(對齊 security-timeline #A3 + #B2)。

### 5.4 Mapping 規則(對齊 ADR-0003 §4 #6)

| domain 操作 | adapter 行為 |
|---|---|
| `product.priceByTier[customer.tier]` | server-side render 取 `products.price_by_tier->>customer.tier` 解單一 Money、傳 client(對齊 §6.1 priceByTier 不洩漏) |
| `placeOrder` 時計算 line item 小計 | server-side 從 `products.price_by_tier->>customer.tier × qty` 重算(對齊 security-timeline #B2、不信 client price)|

---

## §6 Security Checks(對應 security-timeline §3 + ADR-0005 §7)

### 6.1 priceByTier 不洩漏鐵則(對齊 security-timeline §3 #C4)

對齊 `CLAUDE.md`「Server 端鐵則(會員與價格)」+ ADR-0003 §4 #6 + security-timeline §3 #C4:

1. **`products.price_by_tier` 整個 jsonb 絕不直接出現在 client wire response**
   - storefront server-side render 才解 `price_by_tier->>customer.tier` → 單一 `Money`、傳 client
   - 一般客人 client bundle 永遠看不到 store / premiumStore 經銷價
   - wire 端為 Supabase `products.price_by_tier` jsonb(`general` + `store` 二 key、`premiumStore` 由公式算)
   - **DB 層第二道防線:** `products_public` view 排除 `price_by_tier` 整欄(M-1-03-audit-slice-A 落地、migration `20260510134708_products_public_view.sql`、adapter 切換 trigger backlog #118)

2. **`Customer.tier` server-side 重查**(M-2-02 / M-2-03 落地、對齊 security-timeline #A3)
   - client 送的 tier header / cookie 一律 ignore
   - server 從 customers 表 SELECT tier WHERE id=auth.uid()
   - 改 tier 走 customer_tier_history 表記錄(M-2-01 落地、對齊自動升級)

3. **RLS policy 限制**(對齊 §9 + security-timeline #C5):
   - `customer_groups` 表全 SELECT 限 service role(防一般 customer 看到 group rule)
   - `customers` 表 SELECT 限 `auth.uid() = id`(對齊 §9.2)

### 6.2 後續 milestone 接力

| Milestone | 必驗條 | 對應 security-timeline |
|---|---|---|
| **M-1-02** | catalog/types.ts:Money.amount = MoneyAmount brand type(已落地) | #B3 整數 / Decimal |
| **M-1-03** | SupabaseProductAdapter `mapSupabaseProductToDomain` 不 leak price_by_tier 全 jsonb 給 client | #C4 |
| **M-2-08** | Pricing use-case server-side 解 priceByTier × tier | #B2 |
| **M-2-09** | tier-aware price 顯示驗 client 改 tier 不影響 server 回價 | #A3 |
| **M-6-08** | 上線前 checklist:RLS policy 全項勾、server-side rules 重新驗 | #A1 + #A4 + #C4 + #C5 |

---

# Part 2:Order 狀態機 + 9 contexts 責任分割 + RLS + 索引

## §7 Order 雙維度狀態機(對齊 ADR-0003 §4 #9 + medusa-schema-design.md §8 邏輯保留)

### 7.1 表 schema

```sql
CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id          text UNIQUE NOT NULL,            -- 對齊 PHASE-2-VISION #8 預約 QR
  customer_id         uuid NOT NULL REFERENCES customers(id),
  payment_status      text NOT NULL DEFAULT 'unpaid',  -- 4 enum 對齊 ADR-0003 §4 #9
  fulfillment_status  text NOT NULL DEFAULT 'notOrdered', -- 4 enum 對齊 ADR-0003 §4 #9
  fulfillment_method  text NOT NULL,                   -- enum: home / convenience / partner_shop、對齊 PHASE-2-VISION #4
  subtotal            integer NOT NULL,                -- Money 整數分位、對齊 security-timeline #B3
  shipping_fee        integer NOT NULL DEFAULT 0,
  discount            integer NOT NULL DEFAULT 0,
  total               integer NOT NULL,
  shipping_address    jsonb,                           -- snapshot、避免 customer 改地址影響歷史訂單
  discounts_applied   jsonb NOT NULL DEFAULT '[]',     -- 預留、對齊 backlog #47 三層折扣疊加
  payment_method      text,                            -- 對齊 backlog #29 預留
  metadata            jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_status_valid CHECK (
    payment_status IN ('unpaid', 'partiallyPaid', 'paid', 'refunded', 'partiallyRefunded')
  ),
  CONSTRAINT fulfillment_status_valid CHECK (
    fulfillment_status IN ('notOrdered', 'ordered', 'shipped', 'delivered')
  ),
  CONSTRAINT fulfillment_method_valid CHECK (
    fulfillment_method IN ('home', 'convenience', 'partner_shop')
  )
);

CREATE TABLE order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES products(id),
  product_snapshot jsonb NOT NULL,    -- snapshot Product 7 欄位、避免 product 改後影響歷史訂單
  quantity        integer NOT NULL,
  unit_price      integer NOT NULL,    -- snapshot 下單時的 priceByTier × tier 結果
  subtotal        integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quantity_positive CHECK (quantity > 0)
);
```

### 7.2 雙軸獨立 transitions(對齊 medusa-schema-design.md §8.4 邏輯保留)

PaymentStatus 軸 transitions(M-3-02 packages/use-cases/src/order-state-machine.ts 落地):

```
unpaid → paid              (TapPay capture 成功)
unpaid → partiallyPaid     (B2B 月結部分付款、對齊 backlog #27)
paid → refunded            (全退款)
paid → partiallyRefunded   (部分退款、對齊 backlog #26)
```

FulfillmentStatus 軸 transitions(獨立、跟 payment 不耦合):

```
notOrdered → ordered       (Sean 跟廠商訂貨)
ordered → shipped          (廠商出貨給客人 / PCM 倉)
shipped → delivered        (客人收件)
```

**雙軸獨立**(對齊 ADR-0003 §4 #9):任一軸 transition 不影響另一軸、共 4 × 4 = 16 矩陣狀態(實際業務有 8 主要狀態 + 中間態)。

### 7.3 取消處置(對齊 backlog #28 split shipment)

**取消不是 enum、是 transitions 的 reject**:

| 取消時機 | 處置 |
|---|---|
| payment 已收 + fulfillment 未訂貨 | refund payment + fulfillment 維持 notOrdered |
| payment 已收 + fulfillment 已訂貨 | 客服協調(廠商可否退單)、複雜流程進 backlog #28 |
| payment 未收 + 任意 fulfillment | 直接刪除 order(M-3-02 落地刪除規則) |

---

## §8 9 contexts 全 Supabase 責任分割

### 8.1 二分軸定義(對齊 ADR-0005 §2 後)

**廢 ADR-0005 前的二分軸:**「Medusa-as-API context vs PCM 自家 context」(對齊 medusa-schema-design.md §8.3、已 Superseded)。

**ADR-0005 採用後:** 9 contexts **全部走 Supabase 自家表 + 自家 use-cases**(`packages/adapters/src/supabase/`)、無 Medusa、無雙系統、無 wire 端二分。

### 8.2 9 contexts 對應 Supabase 表清單

| Context | Supabase 表(主要)| 落地 milestone | Phase 1 範圍 | Phase 2 擴展 |
|---|---|---|---|---|
| **Catalog** | products / brands / categories | M-1-03 / M-1-09 / M-1-16 | 7 欄位 + fitments + priceByTier + images | variants(backlog #81)/ 大量上架 / 廠商爬蟲 |
| **Identity** | customers / customer_groups / addresses | M-1-14 / M-2-01 / M-2-02 | tier + line_oa_id + addresses + 經銷申請 | 多店員工 / 角色細分 |
| **Order** | orders / order_items | M-3-02 / M-3-04 / M-3-09 | 雙欄狀態機 + 三種收件 + line item snapshot | 詢價單 / 退換 / split shipment(backlog #28)|
| **Pricing** | products.price_by_tier(jsonb)/ customer_groups | M-2-08 / M-2-09 | 三 tier + priceByTier 不洩漏鐵則 | 三層折扣疊加(backlog #47)|
| **Vehicle** | vehicles / vehicle_service_records(空、Phase 1 schema 預留)| Phase 2 | customer.metadata.vehicles 簡欄位 | 完整履歷 / 移轉 / 防偽 / 跨 admin 查詢 |
| **Booking** | bookings / shop_calendar(空、Phase 1 不啟用)| Phase 2 | 暫無 | 預約 / LINE OA 通知 / 店家行事曆 |
| **Wallet** | wallet_ledger / member_discount_overrides(空、Phase 1 schema 預留 FK 欄位)| Phase 2 | customer.tier 累積金額欄位 預留 | 加值 / 扣款 / 退款 / 折扣交互 |
| **Shop** | shops / shop_staff(Phase 1 直讀 design `data/stores.json` submodule)| M-1-12(直讀靜態)/ Phase 2(SaaS)| StaticJsonShopAdapter 直讀 stores.json | shops 表 + shop_staff 表 + region |
| **Sync** | sync_logs / sync_results(`apps/sync-engine/` 自家)| M-5-01 / M-5-02 | 暫無 | 廠商爬蟲 / Sheets 雙寫 / event log |

### 8.3 三視角檢查(對齊 ADR-0005 §5 + ADR-0002 §6.3 主動採用 rollback)

| 視角 | 9 contexts 統一 Supabase | 對比廢的 Medusa-as-API 雙系統 |
|---|---|---|
| 擴充性 | Phase 2 加 vehicle / booking / wallet / sync 直接加 Supabase 表 + 自家 use-case、零 framework 鎖 | 廢:Medusa schema vs 自家 schema 雙軌維護、Phase 2 vehicle 跨 Medusa-as-API entity 複雜 |
| 可維護性 | 純 TypeScript + Supabase client、無 framework 升級風險、無 active blocker 追 | 廢:Medusa monorepo + Zod v4 hoisting bug + GitHub issue OPEN |
| bug 可追蹤性 | 自家代碼單 source debug、Supabase log + Vercel Analytics + Sentry 整合 | 廢:Medusa SDK 黑盒 + 自家 mapper 兩層 debug |

---

## §9 RLS policy 規劃(對齊 ADR-0005 後責任變化、security-timeline #A1 + #A4 + #C5)

### 9.1 ADR-0005 後 RLS 策略變化

**廢 ADR-0005 前(舊、對齊 security-timeline #A1):**「開 RLS 不寫 policy + Medusa service role bypass」

**ADR-0005 採用後(新):** **M-1 起「開 RLS + 寫 policy」、無 Medusa service role bypass**。

**理由:** 無 Medusa 後、`apps/api/`(自寫 backend、apps/medusa/ rename)直接連 Supabase。若用 service role key 等於繞 RLS、安全風險高;若用 anon key + RLS policy、可借用 Supabase RLS 自動驗證 customer ownership(對齊 security-timeline #A4)、reduce 自寫 ownership check 重複代碼。

### 9.2 RLS policy 規劃表

| 表 | RLS policy(讀)| RLS policy(寫)| 對應 security-timeline | 落地 milestone |
|---|---|---|---|---|
| **products** | 全 SELECT 公開(server-side filter price_by_tier 解 tier、對齊 §6.1) | INSERT / UPDATE / DELETE 限 service role(admin / sync-engine 用)| #C4 priceByTier 不洩漏需 server-side 過濾 + **DB 層 `products_public` view 第二道防線(M-1-03-audit-slice-A、backlog #118 trigger)** | M-1-03 |
| **brands** | 全 SELECT 公開 | service role only | — | M-1-03 |
| **categories** | 全 SELECT 公開 | service role only | — | M-1-03 |
| **customers** | SELECT 限 `auth.uid() = id`(自己看自己)| UPDATE 限自己(限欄位:不可改 tier);DELETE service role only | #A2 + #A3 + #C5 | M-1-14 + M-2-01 |
| **customer_groups** | SELECT 限 service role(防 group rule 洩漏)| 全 service role | #C5 customer_group 不洩漏 | M-2-01 |
| **orders** | SELECT 限 `customer_id = auth.uid()` | INSERT 走 server-side service role(經 use-case 驗 ownership)| #A4 cart / order 認證 | M-3-04 |
| **order_items** | SELECT 限 `order_id IN (SELECT id FROM orders WHERE customer_id = auth.uid())` | INSERT / UPDATE 走 service role | #A4 + #C7 PII 部分遮蔽 | M-3-04 |

### 9.3 service role key 紀律(對齊 security-timeline §3 #C1 + #C6)

- **service role key 只在 `apps/api/` server runtime**(M-1-03-pre0c+ 設定、apps/medusa/ rename)
- **storefront(`apps/storefront/`)不可 import** service role key、只用 anon key + RLS
- **env 不入 git**:`.env.local` only、Vercel / Railway dashboard 設定
- 對齊 dependency-rules.md §1 字面「ui / schemas 不 import domain」精神、storefront 不 import server-only module(security-timeline #C3)
- **M-1-03-audit-slice-B 三層防實作**(對齊本 §9.3 紀律):
  - **第一層(編譯期)**:`packages/adapters/src/supabase/client.ts` 檔頭 `import 'server-only'`、client component import 即時 fail
  - **第二層(import 路徑)**:`@pcm/adapters/server` subpath exports 隔離(`packages/adapters/package.json` exports field 拆 `.` + `./server`)
  - **第三層(ESLint rule)**:`eslint.config.js` `no-restricted-imports` 擋 `apps/storefront/**/*.{ts,tsx}` import `@pcm/adapters/server`

---

## §10 索引策略(對齊 5w SKU 規模 + backlog #30 + #35 + #43)

### 10.1 Phase 1 階段 1(M-1-16 種子 200 SKU)

基本索引、Supabase free tier 內可建:

```sql
-- products
CREATE INDEX idx_products_brand_id ON products(brand_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_external_id ON products(external_id);
CREATE INDEX idx_products_handle ON products(handle);
CREATE INDEX idx_products_availability ON products(availability) WHERE availability = 'in-stock';

-- orders
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_fulfillment_status ON orders(fulfillment_status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- order_items
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- customers
CREATE INDEX idx_customers_tier ON customers(tier);
```

### 10.2 Phase 1 階段 2(上線後 1k-5k SKU、對齊 backlog #30)

加 GIN index on products.fitments(fitment 篩選頻繁、5k SKU 起 ILIKE 慢):

```sql
CREATE INDEX idx_products_fitments_gin ON products USING GIN (fitments jsonb_path_ops);
```

`listByFitment(spec)` 用:

```sql
SELECT * FROM products
WHERE fitments @> jsonb_build_array(jsonb_build_object('motoBrand', 'Yamaha', 'modelCode', 'CBR600RR'));
```

GIN + jsonb_path_ops 對 contains 操作 O(log n)、對 5k SKU 性能達標。

### 10.3 Phase 1 階段 3 / Phase 2(5k-50k SKU、對齊 backlog #35 + ADR-0004 Q3=A1 兩階段)

需 Supabase Pro(對齊 #F6 / ADR-0004 Q1=A2):

```sql
-- 1. 啟用 pg_jieba extension(中文分詞、Pro plan only)
CREATE EXTENSION IF NOT EXISTS pg_jieba;

-- 2. 加 search_tsv generated column
ALTER TABLE products ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('jiebacfg',
      coalesce(title, '') || ' ' ||
      coalesce(subtitle, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

-- 3. 加 GIN index
CREATE INDEX idx_products_search_tsv ON products USING GIN (search_tsv);
```

`searchByKeyword(query)` 用:

```sql
SELECT *, ts_rank(search_tsv, websearch_to_tsquery('jiebacfg', $1)) AS rank
FROM products
WHERE search_tsv @@ websearch_to_tsquery('jiebacfg', $1)
ORDER BY rank DESC
LIMIT 20;
```

p99 < 100ms @ 5w SKU(對齊 ADR-0004 Q3=A1 性能字面)。

### 10.4 image storage(對齊 ADR-0004 Q2=A2 + backlog #43)

- `products.images` jsonb 只存 URL string array、不存 BLOB(對齊 PHASE-2-VISION #2)
- M-1-13 / M-1-16 起 image upload 走 Supabase Storage(對齊 ADR-0004 Q2=A2、上線時同步升 Pro)
- CDN cache:Supabase Storage 內建 CDN(免另外接 Cloudflare R2、對齊 backlog #43 Supersede)

---

# Part 3:9 大藍圖 schema 預留 checklist

> **本 Part 角色:** 對齊 PHASE-2-VISION §3 9 條預留 + Audit-F47 三層折扣疊加;Phase 1 schema 必過所有預留檢查、Phase 2 啟動時零 migration。

## §11 客人端預留(Phase 1 啟用)

對齊 PHASE-2-VISION §3 預留 checklist 客人端 8 條:

| 預留項目 | 影響藍圖 | 落地位置(Supabase 表)| 對應 Phase 1 milestone |
|---|---|---|---|
| product 圖片 / PDF 用 URL string | #2 | `products.images: jsonb`(URL array)| M-1-02 type / M-1-13 ProductPage / M-1-16 種子 |
| product 多 price tier | #6 | `products.price_by_tier: jsonb`(三 tier、§5)| M-1-02 type / M-2-08 / M-2-09 |
| customer.tier 欄位 | #6 | `customers.tier: text`(enum: general / store / premiumStore)| M-1-14 / M-2-01 / M-2-02 |
| customer.line_oa_id 欄位 | #3 | `customers.line_oa_id: text NULL`(預留 Phase 2 LINE OA 通知)| M-1-14(schema 預留)/ Phase 2 啟用 |
| customer_groups 機制 | #6 | `customer_groups` 表(§5.2)| M-2-01 |
| order.fulfillment_method 三選一 | #4 | `orders.fulfillment_method: text`(home / convenience / partner_shop、§7.1 CHECK constraint)| M-3-02 / M-3-09 |
| order.display_id QR 唯一識別 | #8 | `orders.display_id: text UNIQUE`(§7.1)| M-3-02 |
| 每頁 Metadata + structured data | #9 | (非 schema、屬 storefront SEO 設定)| M-1-13 / M-6-01 |

## §12 店家端預留(Phase 2 啟用、Phase 1 schema 預留)

對齊 PHASE-2-VISION §3 + #5 vehicle / #8 booking / vehicle-service-ecosystem.md v0.2 §5-§8:

| 預留項目 | 影響藍圖 | Phase 1 處置 | Phase 2 落地位置 |
|---|---|---|---|
| **vehicle 為獨立 entity(不嵌 customer)** | #5 | Phase 1 用 `customers.metadata->vehicles` 簡欄位(對齊 ADR-0003 §4 #5);Phase 2 migrate 到獨立 vehicles 表 | `vehicles` 表(獨立、含 owner_customer_id、可移轉)、`vehicle_service_records` 表 |
| shops 表 | (店家端整體) | Phase 1 直讀 `design-reference/data/stores.json` 36 筆靜態(StaticJsonShopAdapter、對齊 ADR-0003 §4 #4)| `shops` 表 + `shop_staff` 表 + 切換 SupabaseShopAdapter |
| bookings 表 | #3 客戶 ↔ 店家預約 | Phase 1 不啟用、不預留 schema(NORTHSTAR §1.2 不做清單) | `bookings` 表 + `shop_calendar` 表 |
| order 多 fulfillment 模式深化 | #4 下單後到貨再預約 | Phase 1 三選一 enum 已預留(§7.1)| order metadata 擴展 + bookings 表 join |

**Phase 2 vehicle 獨立 entity migration plan(M-2 / Phase 2 落地):**
1. 新建 `vehicles` 表(獨立 PK、owner_customer_id FK)
2. 從 `customers.metadata->vehicles` 抽取資料、INSERT 到 vehicles 表
3. UPDATE customers.metadata - 'vehicles' 移除舊欄位
4. domain entity `Customer.vehicles` 改為 `vehicleRepository.listByOwner(customerId)` 動態查詢

## §13 員工後台預留(Phase 2 啟用、Phase 1 schema 預留 FK)

對齊 PHASE-2-VISION §3 + #6 店家價錢分級 / Audit-F24 backlog #47 三層折扣疊加:

| 預留項目 | 影響藍圖 | Phase 1 處置 | Phase 2 落地位置 |
|---|---|---|---|
| **wallet_ledger 表** | #7 加值 / 扣款 | Phase 1 不啟用、不預留 schema(NORTHSTAR §1.2 不做);只在 `customers.metadata.wallet_balance: integer` 預留總額欄位、不做 ledger | `wallet_ledger` 表(append-only、含 transaction_type / amount / balance_after) |
| **member_discount_overrides 表** | #6 店家價錢分級 | Phase 1 不啟用 | `member_discount_overrides` 表(customer_id × brand_id × extra_discount_pct)|
| **discounts_applied jsonb on Order** | Audit-F24 / backlog #47 | Phase 1 已預留(§7.1 `orders.discounts_applied jsonb`)、空 array、不啟用業務邏輯 | M-3 結帳 use-case 啟用 + 三層折扣疊加(廠牌 / VIP / 個別 customer override) |

**重要:** Phase 1 不為 Phase 2 預設 wallet_ledger / member_discount_overrides schema(對齊 PHASE-2-VISION §3 末段「Sean 拍板:Phase 1 不預設、等 Phase 2 PRD 一起想」),只預留 customer.metadata 內的 placeholder 欄位 + Order.discounts_applied jsonb 空 array。

---

## §14 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-04 | 初版落地、取代 medusa-schema-design.md(2026-05-04 / M-1-03-pre0b 廢);Part 1 Catalog 4 條核心 + Security Checks(對齊 ADR-0003 §4 #1-#3 + #6-#8 + ADR-0004 + security-timeline #C4)+ Part 2 Order 雙維度狀態機 + 9 contexts 全 Supabase + RLS policy 4 表(對齊 ADR-0005 後策略)+ 索引策略 3 階段(對齊 backlog #30 / #35 / #43 + ADR-0004 Q3=A1 兩階段)+ Part 3 9 大藍圖 schema 預留 checklist 客人端 8 條 / 店家端 4 條 / 員工後台 3 條(對齊 PHASE-2-VISION §3) | Sean 拍板 ADR-0005 + #5=i / Claude Code(M-1-03-pre0c)落地 |

— END —
