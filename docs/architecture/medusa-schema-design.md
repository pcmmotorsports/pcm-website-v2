# Medusa Schema Design — Domain ↔ Wire 落地對應

> ⚠️ **Status: SUPERSEDED**
> 廢於:2026-05-04 / M-1-03-pre0b / ADR-0005「Custom + Supabase 直寫架構」採用
> 取代於:`docs/decisions/0005-custom-supabase-direct.md`
> 字面內容**保留**作歷史紀錄(ADR-0003 §4 9 條 wire ↔ domain mapping 仍可參考、wire 端從 Medusa schema 換為 Supabase 表 schema、由 `docs/architecture/supabase-schema-design.md` 重寫於 M-1-03-pre0c)
> 不刪除、不改本檔字面、只加本標記
>
> ---
>
> **狀態(原):** 🟢 拍板 / Part 1 落地 2026-05-02 / Part 2 待 M-0-06
> **拍板人:** Sean(C3 ADR-0003 已拍板 A2 獨立命名、本檔僅落地對應、不重新設計)
> **層級:** docs/architecture/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0002-0003 ADR
> **本檔角色:** ADR-0003 §4 9 條衝突處置的工程落地對應、不重述 ADR、只展開 schema 字面與 mapping 規則
>
> 配合閱讀:
> - `docs/decisions/0003-domain-entity-naming.md`(命名規則 strict、9 衝突處置表、本檔依此落地)
> - `docs/decisions/0002-architecture-pivot.md`(Medusa-as-API + Ports & Adapters、本檔在此架構下展開)
> - `docs/architecture/security-timeline.md` §3 #C4(本檔 Part 1 必滿足)
> - `docs/recon/design-reference-recon-2026-04-30.md` §7(9 條 design vs Medusa 衝突清單、ADR §4 處置表來源)
> - `packages/domain/src/{shared,catalog,identity}/types.ts`(domain 字面真權威)
> - `packages/ports/src/IProductRepository.ts`(ports 簽名只出現 domain 命名、本檔 mapper 對齊)

---

## §1 範圍與本文結構

### 1.1 本文結構

| Part | 範圍 | 落地 milestone | 狀態 |
|---|---|---|---|
| **Part 1** | product / brand / category / tier price | M-0-05 | 🟢 本檔本次落地 |
| **Part 2** | order state machine + 責任分割 | M-0-06 | 🟢 本檔本次落地 |

本文不展開 M-0 milestone 計畫之外的 Part 3。

### 1.2 本檔的事與不做的事

**做:**
- 把 ADR-0003 §4 9 條衝突處置的 **工程落地** 寫成 schema mapping 規則
- 列出 domain 字面(camelCase)/ Medusa wire 字面(snake_case)/ mapping 規則三節
- 引用 ADR-0003 § 編號做來源、避免字面 drift

**不做:**
- 不重新設計 ADR-0003 已拍事(A2 獨立命名 + 9 衝突處置)
- 不重新拍板 security-timeline §C4(priceByTier 不直接 expose 鐵則)
- 不展開 mapper 函數實作(M-1-02 / M-1-03 落地)
- 不展開 Medusa custom module 細節(M-1-03 落地時依 Medusa v2 文件補)

### 1.3 命名規則速查(對齊 ADR-0003 §3.1)

| 區 | 風格 | 本檔字面落點 |
|---|---|---|
| `packages/domain/*` | camelCase | §2 / §3 / §4 / §5 「domain 字面」節 |
| `packages/adapters/medusa/*`(邊界) | wire snake_case → domain camelCase | §2 / §3 / §4 / §5 「mapping 規則」節 |
| Medusa 內建 schema | wire snake_case | §2 / §3 / §4 / §5 「Medusa 字面」節 |

**鐵則:** wire 字面只在「Medusa 字面」與「mapping 規則」兩節出現、不在 domain 節出現。

---

## §2 Product

### 2.1 domain 字面(來自 `packages/domain/src/catalog/types.ts`)

```typescript
export type ProductId = string;

export type Product = {
  id: ProductId;
  name: string;
  brand: Brand;
  category: CategoryPath;
  fitments: FitmentSpec[];
  priceByTier: PriceByTier;
};
```

**欄位推延**(對齊 `catalog/types.ts:80-86` JSDoc):
- `description` / `images` / `inventory` / `variants` → M-1-02 補
- `createdAt` / `updatedAt` → M-1-02 entity 補
- SEO metadata → M-1-09 補

### 2.2 Medusa wire 字面(Medusa v2 product table 主欄位)

| Medusa wire 欄位 | 型 | 對應 domain | 備註 |
|---|---|---|---|
| `id` | string | `Product.id` | Medusa 自動產生(`prod_xxxx`) |
| `title` | string | `Product.name` | wire 用 `title`、domain 用 `name`(語意對齊、字面不同、必過 mapper) |
| `subtitle` | string \| null | (推延) | M-1-02 補時對應 description 子段 |
| `handle` | string | (推延) | URL slug、M-1-02 補 |
| `description` | string \| null | (推延) | M-1-02 補 |
| `images` | image[](url) | (推延) | 走 URL string、M-1-02 補(對齊 `catalog/types.ts:83`) |
| `categories` | product_category[] | `Product.category` | Medusa 內建多分類、PCM 取首條對應 CategoryPath(見 §4) |
| `collection_id` | string \| null | `Product.brand.id` | Medusa collection 充當 brand FK(見 §3) |
| `metadata` | jsonb | `Product.fitments`(json 字串陣列) | Medusa 自由 metadata、PCM 用 `metadata.fits` 存 fitment(見 §2.4) |
| `prices`(透過 price list) | money_amount[] | `Product.priceByTier` | tier 多價、見 §5 |

**PDF / 規格文件預留**:本檔不擴張、走 `metadata.spec_pdf_url` 字串、M-1-02 補時對齊 catalog `description / images` 推延欄位群。

### 2.3 Mapping 規則 + 來源 ADR § 編號

| domain 操作 | adapter 邊界 mapper | 來源 |
|---|---|---|
| `Product` ← Medusa wire | `mapMedusaProductToDomain(wire): Product` | ADR-0003 §3.4 |
| `Product` → Medusa wire | `mapDomainProductToWire(domain): MedusaProductWire` | ADR-0003 §3.4 |
| `findById(id: ProductId)` | adapter 內 `sdk.products.retrieve(id)` + map wire→domain | ADR-0003 §3.3、`packages/ports/src/IProductRepository.ts` |
| `listByCategory(category: CategoryPath)` | adapter 內 `sdk.products.list({ category_id: ... })` + map | ADR-0003 §3.3 + §4 #2 |
| `listByBrand(brandId: string)` | adapter 內 `sdk.products.list({ collection_id: brandId })` + map | ADR-0003 §3.3 + §4 #1 |
| `listByFitment(spec: FitmentSpec)` | adapter 內 `sdk.products.list({ metadata_filters: { fits: ... } })` + map | ADR-0003 §3.3 + §4 #3 |

### 2.4 Fitment 字面落地(對齊 ADR-0003 §4 第 3 條 + ADR-0004 wrs Q1=A1)

`Product.fitments: FitmentSpec[]` 是 domain 結構化字面、Medusa 端落 `metadata.fits` 自由字串陣列、由 adapter 邊界雙向斷詞:

**單年 / 無年份:**
- domain → wire:`fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'CBR600RR' })` → `'Yamaha CBR600RR'`
- wire → domain:`parseWireFitment('Yamaha CBR600RR')` → `{ motoBrand: 'Yamaha', modelCode: 'CBR600RR' }`

**年份範圍(對齊 ADR-0004 wrs Q1=A1、wrs.it IA 報告 §5 報價單格式):**
- domain → wire:`fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2018, yearEnd: 2024 })` → `'Yamaha CBR600RR 2018-2024'`
- wire → domain:`parseWireFitment('Yamaha CBR600RR 2018-2024')` → `{ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2018, yearEnd: 2024 }`

**開放式範圍(yearEnd null = "2025+"):**
- domain → wire:`fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2025, yearEnd: null })` → `'Yamaha CBR600RR 2025+'`
- wire → domain:`parseWireFitment('Yamaha CBR600RR 2025+')` → `{ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2025, yearEnd: null }`

**單年(yearEnd 同 yearStart):**
- domain → wire:`fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2024, yearEnd: 2024 })` → `'Yamaha CBR600RR 2024'`
- wire → domain:`parseWireFitment('Yamaha CBR600RR 2024')` → `{ motoBrand: 'Yamaha', modelCode: 'CBR600RR', yearStart: 2024, yearEnd: 2024 }`

斷詞 helper M-1-02 落地、本檔僅規範 wire 字面位置(`metadata.fits[]`)。

### 2.5 Search query 兩階段實作(對齊 ADR-0004 Q3=A1)

product 全文檢索(對 product.title / metadata.fits / 其他文字欄位)分兩階段落地:

| 階段 | Owner Milestone | 實作方式 | 性能預期 | 觸發條件 |
|---|---|---|---|---|
| dev 期 | M-1-03(MedusaProductAdapter 落地) | PG `ILIKE '%query%'`(`unaccent` extension 可選) | p99 1-3s @ 200 SKU | 即可、free tier 內可跑 |
| production 切換 | M-6-08(上線前 checklist) | PG `tsvector` + `GIN` index + `pg_jieba`(中文分詞) | p99 < 100ms @ 5w SKU | 需 Supabase 升 Pro(`pg_jieba` extension Pro plan only、對應 ADR-0004 Q1=A2 + #F6 security-timeline) |

**M-1-03 實作要點:**
- adapter 內 `searchByKeyword` 用 `medusa_search_v2 ILIKE` 暫代
- JSDoc 註明「M-6 切 tsvector」(對齊 packages/ports/src/IProductRepository.ts 註記)
- 不預先建 GIN index、避免 free tier extension 衝突

**M-6 切換要點:**
- Supabase Pro 升完(M-6-08 checklist)、跑 migration 加 tsvector 欄位 + GIN index + pg_jieba 配置
- adapter 內 `searchByKeyword` 改 `to_tsquery` + `ts_rank` 排序
- 上線前回測「中文搜尋 / 英文搜尋 / 數字 SKU」三類 query 各 5 條、p99 達標再切

---

## §3 Brand(對齊 ADR-0003 §4 第 1 條)

### 3.1 domain 字面

```typescript
export type Brand = {
  id: string;
  name: string;  // 對外顯示、design 字面、例:'CNC RACING'
  slug: string;  // URL slug、例:'cnc-racing'
};
```

### 3.2 Medusa wire 字面

PCM 用 Medusa **collection** 機制充當 brand:

| Medusa wire 欄位 | 型 | 對應 domain | 備註 |
|---|---|---|---|
| `product_collection.id` | string(`pcol_xxxx`) | `Brand.id` | FK 落 product.collection_id |
| `product_collection.title` | string | `Brand.name` | design 字面(`'CNC RACING'`)直接放這 |
| `product_collection.handle` | string | `Brand.slug` | URL slug、kebab-case |

### 3.3 Mapping 規則 + 來源

引用 **ADR-0003 §4 第 1 條**(brand 處置):

> design `product.brand` 是字串 `'CNC RACING'`、Medusa 期待 brand collection FK
> → domain `product.brand: Brand`(value-object: id + name + slug)
> → adapter 雙向 resolve FK ↔ name string;cache 名稱→ID

**adapter 行為:**
- 從 design 字面建商品時、adapter 先查 `product_collection.title === 'CNC RACING'` 是否存在、存在取 id、不存在則建立(M-1-16 種子資料 import 時觸發)
- 名稱→ID 快取由 adapter 內部維護、避免重複 round-trip

---

## §4 Category(對齊 ADR-0003 §4 第 2 條)

### 4.1 domain 字面

```typescript
export type CategoryPath = {
  raw: string;       // 例:'引擎部品 · 排氣管'
  segments: string[]; // 例:['引擎部品', '排氣管']
};
```

### 4.2 Medusa wire 字面

PCM 用 Medusa **product_category** 樹(`parent_category_id` 巢狀):

| Medusa wire 欄位 | 型 | 對應 domain | 備註 |
|---|---|---|---|
| `product_category.id` | string(`pcat_xxxx`) | (內部 FK、不外洩 domain) | adapter 取葉節點 id 落 product.categories |
| `product_category.name` | string | `CategoryPath.segments[i]` | 每節點對應一個 segment |
| `product_category.parent_category_id` | string \| null | (隱含父子關係) | adapter 由葉往上回溯組 segments |
| `product_category.handle` | string | (URL slug、可選) | M-1-09 SEO 補 |

### 4.3 Mapping 規則 + 來源

引用 **ADR-0003 §4 第 2 條**(category 處置):

> design `product.category` 是字串 `「引擎部品 · 排氣管」`、Medusa 期待 category 樹
> → domain `product.category: CategoryPath`(字串 path + 解析陣列)
> → adapter parse 字串 ↔ 樹節點;mapper 處理多語空格分隔

**adapter 行為:**
- domain → wire(寫入):`parseCategoryPath('引擎部品 · 排氣管')` → `['引擎部品', '排氣管']` → 由根往下找 / 建 product_category 節點 → 取葉 id 寫進 product.categories
- wire → domain(讀出):從 product.categories 取葉 → 由葉往根回溯 → 用 `' · '` join → 組 `CategoryPath.raw`
- 分隔字元字面以 design `' · '`(全形圓點 + 兩側半形空格)為準、mapper helper M-1-02 落地

---

## §5 Tier Price(對齊 ADR-0003 §4 第 6 條 + 第 8 條)

### 5.1 domain 字面(來自 `packages/domain/src/{shared,catalog}/types.ts`)

```typescript
// shared/types.ts:43
export type MemberTier = 'general' | 'store' | 'premiumStore';

// shared/types.ts:21-25
export type Money = {
  amount: number;     // 整數、最小貨幣單位(TWD 元位)
  currency: 'TWD';
};

// catalog/types.ts:76
export type PriceByTier = Record<MemberTier, Money>;
```

`Customer.tier: MemberTier`(來自 `identity/types.ts:16`)。

### 5.2 Medusa wire 字面

PCM 用 Medusa **price_list + customer_group** 機制做 tier price:

| Medusa wire 概念 | 型 / 字面 | 對應 domain | 備註 |
|---|---|---|---|
| `customer_group.name` | string | `Customer.tier` | wire 用 string、domain 用 enum、邊界 mapper(見 §5.4) |
| `price_list.id` | string(`plist_xxxx`) | (內部、不外洩) | 每 tier 一份 price list |
| `price_list.customer_groups[]` | customer_group[] | (掛 tier) | price list 綁哪些 customer group |
| `money_amount.amount` | int(integer cents) | `Money.amount` | TWD 為元位整數(NT$ 4,000 → 4000) |
| `money_amount.currency_code` | string('twd') | `Money.currency`('TWD') | 邊界 case mapper |
| `money_amount.price_list_id` | FK | (隱含 tier) | 由 price_list_id 反查 customer_group → tier |

### 5.3 Mapping 規則 + 來源

引用 **ADR-0003 §4 第 6 條**(三層價格)+ **第 8 條**(tier UI / customer_group):

> 第 6 條:design 只一個 `price` 欄位、Medusa 是 Price List(多 tier)
> → domain `product.priceByTier: Record<MemberTier, Money>`
> → adapter 取 customer.tier 對應 price;**storefront server-side render 後傳 client**
>
> 第 8 條:design 無「會員等級」UI 標示、Medusa 是 customer_group
> → domain `customer.tier: MemberTier`(enum)
> → adapter 雙向 customer_group ↔ MemberTier

### 5.4 Tier 命名對照表(必含)

字面真權威:`packages/domain/src/shared/types.ts:43`(`'general' | 'store' | 'premiumStore'`)。

| domain(camelCase) | Medusa customer_group.name(wire) | Medusa price_list 命名(PCM 慣例) | 業務語意 |
|---|---|---|---|
| `general` | `general` | `pcm_retail` | 一般會員、零售價 |
| `store` | `store` | `pcm_wholesale` | 經銷商、經銷價 |
| `premiumStore` | `premium_store` | `pcm_premium_wholesale` | 高級店家、經銷價 -3~5%(累積儲值 ≥ NT$ 100,000) |

**對照表規則**:
1. `general` / `store` 兩 tier domain 字面已是 snake-friendly、wire 直接同字面、無 case 轉換
2. `premiumStore` 是唯一需 case 轉換的 tier:domain camelCase ↔ wire snake_case 必過 adapter mapper
3. price_list 命名 prefix `pcm_` 避免與 Medusa 預設 / 第三方 module 名稱衝撞(M-1-03 落地時於 Medusa Admin 建)

**邊界 mapper 命名**(M-1-03 / M-2-08 落地):
- `mapTierToCustomerGroupName(tier: MemberTier): string`(`'premiumStore' → 'premium_store'`)
- `mapCustomerGroupNameToTier(name: string): MemberTier`(`'premium_store' → 'premiumStore'`)

---

## §6 Security Checks(對應 `security-timeline.md` §3)

### 6.1 本 slice 階段 M-0-05 對應條目

| Sec ID | 檢查項 | 本 slice 階段 | 落地細節 |
|---|---|---|---|
| **C4** | product 經銷價欄位設計(`product.priceByTier: Map<MemberTier, Money>`、不直接 expose 給一般客人) | **「M-0-05/06 schema design 含」階段** | ✅ 本檔 §5 已含 priceByTier 完整設計、§5.5 鐵則記錄(下) |

### 6.2 priceByTier 不洩漏鐵則(於 §5 落地、本節集中記錄)

對齊 `CLAUDE.md`「Server 端鐵則(會員與價格)」+ ADR-0003 §4 第 6 條 + security-timeline §3 #C4:

1. **`Product.priceByTier` 整個 record 絕不直接出現在 client wire response**
   - storefront server-side render 才解 `priceByTier[customer.tier]` → 單一 `Money`、傳到 client
   - 一般客人 client bundle 永遠看不到 store / premiumStore 經銷價

2. **`Customer.tier` server-side 重查**(M-2-02 / M-2-03 落地)
   - client 送 tier header / cookie 一律 ignore、server 從 DB(Medusa customer_group)重查
   - 對應 security-timeline §3 #A3

3. **cart line item 加價時 server-side 從 `Product.priceByTier × Customer.tier` 重算**(M-3 落地)
   - client 送 price 一律 ignore
   - 對應 security-timeline §3 #B2

4. **金額型別整數 / Decimal、禁 `number`**
   - `Money.amount` 為 TWD 元位整數(`Number.isInteger` guard 在 use-case 層、M-1-02 落地)
   - 對應 security-timeline §3 #B3

### 6.3 後續 milestone 接力

| milestone | slice | 接力動作 |
|---|---|---|
| M-1-02 | domain entity 落地 | `Money` 整數 guard / `priceByTier` Record 實作 |
| M-1-03 | MedusaProductAdapter 落地 | `mapMedusaProductToDomain` 不洩 priceByTier 給 client |
| M-2-08 | Pricing Price List 落地 | Medusa price_list × customer_group 三 tier 設定、adapter mapper 落地 |
| M-2-09 | tier-aware price 顯示 | storefront server-side render 後傳 tier-only price |
| M-6-08 | 上線前 checklist | client bundle grep `priceByTier` 字面 = 0 筆(security-timeline §3 #C3 同類驗) |

---

## §7 Part 2 placeholder(M-0-06)

**Part 2 預定 scope**(本檔本次不展開):

- order entity 雙維度 8 狀態機(`Order.paymentStatus × Order.fulfillmentStatus`)
- Medusa `payment_status` × `fulfillment_status` ↔ domain enum 對照表(對齊 ADR-0003 §3.2 + §4 第 9 條)
- Medusa vs Supabase 責任分割表(Catalog / Identity / Order / Pricing / Vehicle / Booking / Wallet / Shop / Sync 9 contexts)
- 訂單狀態機 use-case 邊界(`packages/use-cases/order-state-machine.ts` 介面、不含實作)
- Security Checks 對應(security-timeline §3 #A4 / #B4 / #C7 等)

落地 milestone:M-0-06、估時 45 min、本檔末尾 placeholder 不取代該 slice 文件產出。

---

## §8 Part 2:訂單狀態機 + 責任分割

> **狀態:** 🟢 本檔本次落地(M-0-06)
> **本節角色:** Part 1 §1.1 結構表「Part 2 = order state machine + 責任分割」之工程落地
> **承接:** ADR-0003 §4 第 9 條(雙欄業務語意 enum、共 8 狀態)+ §7 placeholder 預定 scope 5 條

### §8.1 訂單狀態機 — 雙維度 8 狀態(雙軸獨立、4 + 4)

**真權威字面位置**(本節不重述 enum 字面、避免 drift)

- `PaymentStatus` 4 個 enum 值:見 `packages/domain/src/order/types.ts:20`
- `FulfillmentStatus` 4 個 enum 值:見 `packages/domain/src/order/types.ts:34`

**為何雙欄、非 single status enum**

對齊 ADR-0003 §4 第 9 條拍板:一筆訂單同時持有「金流狀態」與「履約狀態」、Medusa 內建 schema 即雙欄(`payment_status` × `fulfillment_status`)、PCM 沿用此模型、進 domain 為 `Order.paymentStatus` × `Order.fulfillmentStatus`(camelCase)。

ADR-0003 §3.2 補充:Medusa `fulfillment_status` 不夠用、PCM 自家 4 階段 enum 走 metadata、不退化為 Medusa 內建 4 階段(`notOrdered` / `ordered` / `inStock` 三條 Medusa 無對應 wire 字面)。

**8 狀態 = 兩軸獨立合計、不是笛卡兒積 16 組合**

- PaymentStatus 4 個 enum 值
- FulfillmentStatus 4 個 enum 值
- **合計 8 個 enum 值(4 + 4)**、屬於兩個獨立欄位
- 笛卡兒積 16 種組合是 *理論上* valid 狀態空間、實務上多數組合不存在或屬例外

**實務常見組合**(典型 7 個業務場景、非全 16 組合)

| paymentStatus | fulfillmentStatus | 業務語意 | 典型觸發點 |
|---|---|---|---|
| `unpaid` | `notOrdered` | 客人剛下單、未付款、未跟廠商訂貨 | 結帳完 TapPay redirect 中 |
| `paid` | `notOrdered` | 客人已付款、PCM 待跟廠商下訂貨 | 結帳成功、員工待 admin 觸發訂貨 |
| `paid` | `ordered` | 客人已付款、PCM 已下訂貨、待現貨 | 廠商交期 7-14 天 |
| `paid` | `inStock` | 客人已付款、商品已到 PCM 倉庫(或合作店家)、待出貨 | 倉庫待打包 |
| `paid` | `shipped` | 客人已付款、商品已出貨、訂單接近結束 | 出貨單號開後 |
| `partiallyPaid` | `inStock` | 月結店家、部分付款、商品已現貨 | B2B 月結場景 |
| `refunded` | `shipped` | 商品已出貨後退款(瑕疵 / 客人退貨成功) | M-3 後段 / 客服處理 |

合法 transition 由 §8.4 use-case 邊界規範、本節僅說明 enum 結構與業務意圖。

---

### §8.2 Medusa wire ↔ domain enum 對照(引用、不重述)

**對照表真權威**

完整 PaymentStatus 4 條 + FulfillmentStatus 4 條 wire ↔ domain 對照、見 ADR-0003 §3.2 line 86-104(`docs/decisions/0003-domain-entity-naming.md`)。

本節**不重述**對照表內容、避免字面 drift、ADR 字面為單一 source of truth、未來 Medusa 升級或 enum 字面調整、改 ADR § 即可、本檔指向 ADR § 編號不變。

**Mapper 落地點**

`packages/adapters-medusa/src/order-mapper.ts`(M-3-04 落地);本 slice 不展開 mapper 函數實作、對齊 §1.2「不展開 mapper 函數實作」字面。

**澄清:`ChargeStatus` ≠ `PaymentStatus`**

| 名稱 | 真權威字面位置 | 屬於 | 業務意義 |
|---|---|---|---|
| `PaymentStatus` | `packages/domain/src/order/types.ts:20` | Order context | 訂單付款狀態 4 級(`paid` / `unpaid` / `partiallyPaid` / `refunded`) |
| `ChargeStatus` | `packages/domain/src/payment/types.ts:18` | Payment context(TapPay-specific) | 單次金流交易結果 2 級(`succeeded` / `failed`) |

**兩者不混用**

- `ChargeStatus` 是「TapPay charge / refund 此次呼叫成功與否」、TapPay-specific 字面
- `PaymentStatus` 是「Order entity 整體付款狀態」、PCM 業務語意
- 一筆 charge `succeeded` 可能讓 order 從 `unpaid` 進 `paid`(全額)或 `partiallyPaid`(部分)
- 一筆 refund `succeeded` 可能讓 order 進 `refunded`
- charge / refund 結果 → order PaymentStatus 推進、由 charge / refund use-case 處理(M-3-08 落地)

**命名空間規約**(嚴格區分、對齊 ADR-0003 §3.1)

| 層 | 命名風格 | 字面位置 |
|---|---|---|
| domain(`packages/domain/*` / `packages/use-cases/*` / `packages/ports/*` / apps) | camelCase | `paymentStatus` / `fulfillmentStatus` / `chargeStatus` / `partiallyPaid` / `notOrdered` / `inStock` |
| Medusa wire(進入 adapter 邊界內部) | snake_case | `payment_status` / `fulfillment_status` / `partially_captured` |
| TapPay wire(進入 adapter 邊界內部) | TapPay 自家字串 | `rec_trade_id` 等 |

wire 字面只在 adapter 邊界內部出現、不外洩 use-case 與 storefront、對齊 ADR-0003 §3.4。

---

### §8.3 責任分割表 — Medusa-as-API context vs PCM 自家 context

**二分軸定義**

- **Medusa-as-API context**:Medusa v2 schema 蓋面足夠(走 Prisma 連 Supabase PG)、PCM 直接吃 Medusa entity、adapter 做 wire ↔ domain mapping
- **PCM 自家 context**:Medusa 蓋不到、PCM 走 sync-engine 直連 Postgres / Supabase auth 備用、自家 schema 設計

⚠️ 注:Supabase **不是與 Medusa 並列的主存系統**(見 PROJECT-OVERVIEW §3.2)— Supabase 是 Medusa 的底層 PG;「PCM 自家 context」走的是同一個 PG、但繞過 Medusa Service 直接 query 或寫入。

**9 contexts 分配**

| context | 屬類 | 一句說明 | 落地 milestone |
|---|---|---|---|
| **Catalog** | Medusa-as-API | Medusa product / collection / category 蓋面 100%、design 衝突 8 條由 adapter 邊界 mapper 處理 | M-0-05(schema design)/ M-1-02(domain entity)/ M-1-03(adapter)/ M-1-09(SEO)/ M-1-16(種子) |
| **Identity** | Medusa-as-API | Medusa customer + customer_group 蓋會員與三級制度、`tier` 透過 customer_group enum 對齊 ADR-0003 §4 #8 | M-1-14(Customer adapter)/ M-2-01(tier 落地)/ M-2-02(server-side 驗證) |
| **Order** | Medusa-as-API | Medusa order + payment_status × fulfillment_status 雙欄蓋雙維度狀態機、PCM 4 階段 enum 走 metadata 補強 Medusa 不夠用部分(對齊 ADR-0003 §4 #9) | M-3-02(entity guard)/ M-3-04(Order adapter)/ M-3-09(訂單詳情) |
| **Pricing** | Medusa-as-API | Medusa Price List + customer_group 機制蓋三層折扣、`priceByTier` Record 由 adapter 對應 customer.tier 計算、對齊 ADR-0003 §4 #6 | M-2-08(Pricing Price List)/ M-2-09(tier-aware price 顯示) |
| **Vehicle** | PCM 自家(Phase 2) | Medusa 無 Vehicle entity、Phase 1 暫存 customer.metadata.vehicles(對齊 ADR-0003 §4 #5)、Phase 2 走 sync-engine + 自家表 | Phase 1 customer metadata field / Phase 2 SupabaseVehicleAdapter |
| **Booking** | PCM 自家(Phase 2) | Medusa 無 booking entity、Phase 1 不做(NORTHSTAR §1.2 不做清單)、Phase 2 走自家表 + LINE OA 通訊 | Phase 2(本檔不展開) |
| **Wallet** | PCM 自家(Phase 2) | Phase 1 schema 預留 customer.tier + 累積金額欄位、不啟用業務邏輯;ledger 表結構 + 折扣交互完整功能 Phase 2 落地 | Phase 1 schema 預留 / Phase 2 ledger + 自動升級 |
| **Shop** | PCM 自家(混合) | Phase 1 直讀 design `data/stores.json` submodule(StaticJsonShopAdapter)、Phase 2 SaaS 走 SupabaseShopAdapter(對齊 ADR-0003 §4 #4) | Phase 1 storefront 直讀 / Phase 2 SaaS |
| **Sync** | PCM 自家 | apps/sync-engine workspace 獨立執行、走 GCP SA + Google Sheets API + 寫 Medusa 的 import flow | M-5-01(sync-engine 骨架)/ M-5-02(sheets-api adapter) |

**三視角檢查**

| 視角 | 理由 |
|---|---|
| **擴充性** | Phase 2 Vehicle / Booking / Wallet 三個 PCM 自家 context 啟動時、不影響 Medusa-as-API 4 個 context 的 schema、可在自家表獨立 migration;新 PCM 自家 context 加進來時、9 條表新增 row 即可、不重整現有結構 |
| **可維護性** | 9 contexts 邊界由「主存系統」自然分割、code review 看 context 名即知資料源、不混淆;Medusa SDK 升級僅影響 4 個 Medusa-as-API context、不波及 5 個 PCM 自家 context |
| **bug 可追蹤性** | 資料異常時、Medusa-as-API context 查 Medusa Admin / SDK log、PCM 自家 context 查 Supabase Dashboard / sync-engine log、故障定位範圍可預測;9 條表 + milestone 指針讓 oncall 一查就知道責任歸屬 |

---

### §8.4 訂單狀態機 use-case 邊界(介面字面、不含實作)

**File path 提案**

`packages/use-cases/src/order-state-machine.ts`(M-3-02 落地實作);本 slice 不動 `packages/use-cases/src/`(目前僅殼)、僅在本檔規範介面字面草案。

⚠️ 注:Part 1 §7 placeholder 字面為「`packages/use-cases/order-state-machine.ts`」、屬 M-0-05 寫入時的 early proposal;本節取最終路徑 `packages/use-cases/src/order-state-machine.ts`(對齊 `packages/domain/src/order/` 子目錄結構、未來 Order context 多 use-case 擴展友善)、§7 字面不修、保留歷史脈絡。

**雙軸獨立、分兩組**

PaymentStatus 軸與 FulfillmentStatus 軸**獨立 transition**、不耦合:

- PaymentStatus 軸 transition 不影響 FulfillmentStatus(`markPaid` 不會自動 `markOrdered`)
- FulfillmentStatus 軸 transition 不影響 PaymentStatus(`markShipped` 不會自動 `markPaid`)
- 業務組合(如「客人付款後員工觸發訂貨」)由呼叫端 use-case 串接兩軸 transition、不在本介面內隱含

**PaymentStatus 軸 transitions**(3 條基本)

```typescript
import type { Order } from '@pcm/domain/order/types';

/**
 * 標記訂單為部分付款(月結 B2B 場景、客人先付一部分)。
 *
 * @invariant order.paymentStatus 必為 'unpaid'
 *            (只能從 unpaid 進、不可從 paid 退回 partiallyPaid)
 * @throws InvalidTransitionError 當 paymentStatus 非 'unpaid'
 */
export function markPartiallyPaid(order: Order): Order;

/**
 * 標記訂單為全額付款。
 *
 * @invariant order.paymentStatus 必為 'unpaid' 或 'partiallyPaid'
 *            (不可從 paid 重複 markPaid、不可從 refunded 退回)
 * @throws InvalidTransitionError 當 paymentStatus 為 'paid' 或 'refunded'
 */
export function markPaid(order: Order): Order;

/**
 * 標記訂單為全額退款。
 *
 * @invariant order.paymentStatus 必為 'paid' 或 'partiallyPaid'
 *            (必過收款階段、不可從 unpaid 直接 refunded)
 * @throws InvalidTransitionError 當 paymentStatus 為 'unpaid' 或 'refunded'
 */
export function markRefunded(order: Order): Order;
```

**FulfillmentStatus 軸 transitions**(3 條基本、線性前進)

```typescript
/**
 * 標記訂單已跟廠商下訂貨(員工在 admin 觸發)。
 *
 * @invariant order.fulfillmentStatus 必為 'notOrdered'
 *            (只能從 notOrdered 進、不可從更後面狀態退回)
 * @throws InvalidTransitionError 當 fulfillmentStatus 非 'notOrdered'
 */
export function markOrdered(order: Order): Order;

/**
 * 標記訂單商品已現貨(到 PCM 倉庫或合作店家)。
 *
 * @invariant order.fulfillmentStatus 必為 'ordered' 或 'notOrdered'
 *            (PCM 自家庫存場景跳過 ordered:notOrdered → inStock;
 *             廠商訂貨場景線性前進:notOrdered → ordered → inStock;
 *             不可從 inStock 重複、不可從 shipped 退回)
 * @throws InvalidTransitionError 當 fulfillmentStatus 為 'inStock' 或 'shipped'
 */
export function markInStock(order: Order): Order;

/**
 * 標記訂單已出貨給客人。
 *
 * @invariant order.fulfillmentStatus 必為 'inStock'
 *            (不可從 ordered 跳過 inStock)
 * @throws InvalidTransitionError 當 fulfillmentStatus 非 'inStock'
 */
export function markShipped(order: Order): Order;
```

**為何 6 條 transition、非全 4 × 4 = 16 矩陣**

PaymentStatus 軸實際只 3 條(`unpaid` 為初始狀態、構造 Order 時即為 unpaid、不需 transition function 進入):

- `markPartiallyPaid`:`unpaid` → `partiallyPaid`
- `markPaid`:`unpaid` | `partiallyPaid` → `paid`
- `markRefunded`:`paid` | `partiallyPaid` → `refunded`

FulfillmentStatus 軸實際只 3 條(`notOrdered` 為初始狀態、線性前進):

- `markOrdered`:`notOrdered` → `ordered`
- `markInStock`:`ordered` → `inStock` | `notOrdered` → `inStock`(PCM 自家庫存跳階)
- `markShipped`:`inStock` → `shipped`

**未列 transitions**(留 backlog 或 Phase 2)

- **部分退款**:目前 PaymentStatus 無 `partiallyRefunded` 字面、部分退款結果保留 `paid`(僅退一部分);完整 partial refund 邏輯由 M-3-08 落地時依 TapPay 實況評估(backlog #26)
- **B2B 月結 markPartiallyPaid 多次累積**:目前 `markPartiallyPaid` invariant 只支援 `unpaid → partiallyPaid` 單次進入、無法表達「分多次部分付款」;月結客戶累積邏輯由 M-3-02 Order entity 落地時加 amount 參數評估(backlog #27)
- **split shipment(line-item-level fulfillment)**:目前 `fulfillmentStatus` 是 order-level、Phase 1 簡化、Phase 2 評估 line-item-level(backlog #28)
- **`Order.paymentMethod` 欄位**:目前 PaymentStatus 不分支付方式(信用卡 / 儲值金 / 月結)、Phase 2 Wallet 啟用前評估補欄位(backlog #29)

**Phase 1 邊界與 Phase 2 接力**(本 slice 不規範、客服流程 / Phase 2 補)

- **取消未付款訂單**(`unpaid` 訂單客人 / 員工 / 系統超時取消):本 slice 不在系統 transition 處理、走客服人工流程記錄;Phase 1 進客服 ticket、Phase 2 客服 inbox 落地時評估擴 `cancelled` enum 或 `Order.cancelledAt` 欄位
- **付款失敗多次**(TapPay charge 連續失敗):`ChargeStatus failed` 不影響 `PaymentStatus`(order 維持 `unpaid`)、admin 查 M-3-08 TapPay charge logs;不擴 `paymentFailed` enum、用 audit log 區分「未嘗試付款 vs 失敗多次」
- **客人簽收 / 超商取貨完成**(`shipped` → 實際送達):Phase 1 不追蹤、`shipped` 為終態;Phase 2 評估 `delivered` enum(對應 `vehicle-service-ecosystem.md` §4.6 儲值金回饋觸發點)
- **廠商缺貨 / 已出貨退貨 / 超商 7 天未取**(reverse logistics):本 slice 不規範、Phase 1 走客服人工流程;Phase 2 設計 reverse logistics 狀態機(對應 `vehicle-service-ecosystem.md` §4.8)

**實作說明**

- 本 slice 不寫 function body、`packages/use-cases/src/order-state-machine.ts` 落地點 M-3-02
- M-3-02 entity guard 同時實作 `OrderItem.quantity` invariant(對齊 `packages/domain/src/order/types.ts:46` JSDoc)
- transition function 純函數、不副作用、回傳新 `Order`、原 `Order` 不可變(immutable update)
- `InvalidTransitionError` 自家 error class、落地 M-3-02、訊息含當前 status / 嘗試 transition 名

---

### §8.5 Security Checks 對應(規劃接力、本 slice 不落地)

本 §8 訂單狀態機 + 責任分割涉及的安全檢查項目、依 `docs/architecture/security-timeline.md` §3 主表規劃、**本 slice 為規劃接力、不落地任何 check**:

| Sec ID | 主題 | 真權威字面位置 | Owner Milestone | 落地 slice |
|---|---|---|---|---|
| **#A4** | cart / order 認證 server-side(客人不能改別人的 order) | `security-timeline.md` line 93 | M-3 | M-3-04(Order adapter)/ M-3-06(CartPage) |
| **#B4** | cart 金額 server-side 重算(client 送的小計不信、server 從 line items 重算) | `security-timeline.md` line 94 | M-3 | M-3-05(calculate-shipping use-case)/ M-3-06(CartPage) |
| **#C7** | 訂單號 / 客人手機 / 地址 PII server-side 才能查全、列表頁部分遮蔽 | `security-timeline.md` line 97 | M-3 | M-3-04(Order adapter)/ M-3-09(訂單詳情) |

**規劃接力意涵**

本檔 §8 把訂單狀態機 + 責任分割的 schema / use-case 介面字面落地;**訂單行為層的 server-side 守門**(認證 / 金額重算 / PII 遮蔽)由 M-3 各 slice 落地時對應 #A4 / #B4 / #C7 條目進驗收條件。

對齊 `security-timeline.md` §1「規劃集中(本檔安全規劃)/ 執行分散(各 milestone 驗收)/ 整合收網(M-6-08 上線前 checklist)」三權分立精神。

**M-6-08 上線前 checklist 回查**

#A4 / #B4 / #C7 三條最終由 M-6-08(上線前 checklist 全項回查)收網、確保訂單流程 server-side 守門上線前 100% 落地、不依賴各 slice 自驗。

---

## §9 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-02 | 初始化 medusa-schema-design.md(M-0-05 / Part 1 / product / brand / category / tier price 四 entity 三節結構 + tier 命名對照表 + Security Checks §C4 落地 + Part 2 placeholder) | Claude Code(M-0-05) |
| 2026-05-02 | M-0-06 / Part 2 落地(§8 + §8.1 雙維度 8 狀態機 + §8.2 wire ↔ domain 對照引用 + §8.3 9 contexts 責任分割 + §8.4 use-case 邊界 6 transitions(含 deep audit 4 修法 / Phase 1 邊界 4 條)+ §8.5 Security Checks 規劃接力 #A4 / #B4 / #C7 + §1.1 結構表 Part 2 狀態欄更新)+ phase-1-backlog.md 加 6 條(#26-#31) | Claude Code(M-0-06) |

— END —
