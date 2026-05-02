# Medusa Schema Design — Domain ↔ Wire 落地對應

> **狀態:** 🟢 拍板 / Part 1 落地 2026-05-02 / Part 2 待 M-0-06
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
| **Part 2** | order state machine + Medusa vs Supabase 責任分割 | M-0-06 | ⏳ placeholder(本檔末段) |

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

### 2.4 Fitment 字面落地(對齊 ADR-0003 §4 第 3 條)

`Product.fitments: FitmentSpec[]` 是 domain 結構化字面、Medusa 端落 `metadata.fits` 自由字串陣列、由 adapter 邊界雙向斷詞:

- domain → wire:`fitmentToWireString({ motoBrand: 'Yamaha', modelCode: 'CBR600RR' })` → `'Yamaha CBR600RR'`
- wire → domain:`parseWireFitment('Yamaha CBR600RR')` → `{ motoBrand: 'Yamaha', modelCode: 'CBR600RR' }`

斷詞 helper M-1-02 落地、本檔僅規範 wire 字面位置(`metadata.fits[]`)。

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

## §8 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-02 | 初始化 medusa-schema-design.md(M-0-05 / Part 1 / product / brand / category / tier price 四 entity 三節結構 + tier 命名對照表 + Security Checks §C4 落地 + Part 2 placeholder) | Claude Code(M-0-05) |

— END —
