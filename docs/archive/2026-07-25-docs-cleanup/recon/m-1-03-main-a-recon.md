# M-1-03-main-a Recon:Supabase Pricing / Brand / Dealer Label 字面偵察報告

> **產出時機:** 2026-05-12(Sub-slice 0b ✅ 已落地 schema doc 二 key + brands.premium_extra_pct 之後、main-a Pricing 元件 / brand migration / 修「· 經銷」硬編碼之前)
>
> **真權威來源:** ADR-0005(Medusa deprecated、改 Supabase 直寫)+ supabase-schema-design.md + 既有 code + design-reference @ 25d3a2a
>
> **本檔性質:** 純偵察事實記錄、不預判落地方案、不寫「建議用 X」。Claude.ai 讀本檔組裝後續 slice 指令字面。
>
> **HEAD:** `f951c63` / STATUS L29 = `d100244`(1 步 amend drift、Sean Q1=A2 放行、留更後 slice 修)

---

## 目標 1:Supabase Pricing 五層字面對齊

### 1.1 schema doc 層(真權威)

**字面來源:** `docs/architecture/supabase-schema-design.md`

| 行號 | 字面 |
|---|---|
| L50 | `price_by_tier   jsonb NOT NULL,              -- 對齊 ADR-0003 §4 #6 + §5 priceByTier 不洩漏鐵則` |
| L63-67 | `CONSTRAINT price_by_tier_keys CHECK ( price_by_tier ? 'general' AND price_by_tier ? 'store' )` — **二 key** |
| L71 | 設計理由:「`price_by_tier` 僅 seed `general` + `store` 兩 key、`premiumStore` tier 由 storefront 用 `brands.premium_extra_pct` 動態算(`store × (1 - premium_extra_pct / 100)`)、不在 jsonb 內寫死;tier 列舉仍維持三級(`general` / `store` / `premiumStore`、§5.2 + §5.3 字面)」 |
| L165-167 | `premium_extra_pct integer NOT NULL DEFAULT 0 CHECK (premium_extra_pct >= 0 AND premium_extra_pct <= 30),` — brands 第 8 欄位 |
| L257 | (舊註解、與 L63-67 二 key 衝突)「CHECK constraint(`price_by_tier ? 'general' AND ...`)強制三 tier 全部存在」 — `<待 0b 後續清理:此註解未同步二 key>` |
| L308 | (舊註解、與當前架構衝突)「wire 端從 Medusa Price List × customer_group 改 Supabase products.price_by_tier jsonb」 — `<提及 Medusa、為架構轉折歷史註腳;非待修>` |

**字面來源:** `docs/specs/M-1-03-products-schema-prd-v3.md`

| 行號 | 字面 |
|---|---|
| L82-86 | CHECK 二 key(同 schema-design L63-67 字面) |
| L93-96 | jsonb 範例二 key(`general` + `store`) |
| L98-103 | 設計理由含 `premiumStore` tier 不在 jsonb 內 seed |
| L108 | `### 2.4 Pricing 公式(三 tier 顯示計算、對齊 M-1-03-post-supplement)` |

---

### 1.2 migration 落地層

**字面來源:** `supabase/migrations/`

5 個 migration 檔已落地:
- `20260505130758_init_brands_categories.sql`
- `20260507004826_init_products.sql`
- `20260507012301_init_products_rls.sql`
- `20260507222633_products_brand_category_not_null.sql`
- `20260510134708_products_public_view.sql`

**`20260507004826_init_products.sql` L43-47:**
```sql
CONSTRAINT price_by_tier_keys CHECK (
    price_by_tier ? 'general' AND
    price_by_tier ? 'store' AND
    price_by_tier ? 'premiumStore'
)
```
→ **CHECK 仍三 key**、與 schema doc L63-67 二 key **不一致**。

**`20260505130758_init_brands_categories.sql` L22-30:**
```sql
CREATE TABLE brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  description text,
  logo_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```
→ **brands 7 欄位、無 `premium_extra_pct`**、與 schema doc L159-167 第 8 欄位 **不一致**。

**`20260510134708_products_public_view.sql` L17-23:**
```sql
  description,
  handle,
  -- price_by_tier 排除(經銷價敏感欄位)
  fitments,
  images,
  availability,
  brand_id,
```
→ products_public view 排除 `price_by_tier`(對齊 M-1-03-audit Slice A 議題 1+6 修)。

**結論:** migration 層尚未實作 schema doc 0b 字面修(price_by_tier 二 key + brands.premium_extra_pct)、需新 migration 補。

---

### 1.3 domain 層

**字面來源:** `packages/domain/src/`

| 檔案 | 行號 | 字面 |
|---|---|---|
| `shared/types.ts` | L70 | `export type MemberTier = 'general' \| 'store' \| 'premiumStore';` — 三 key 列舉 |
| `catalog/types.ts` | L1 | `import type { Money, MemberTier } from '../shared/types';` |
| `catalog/types.ts` | L102 | `export type PriceByTier = Record<MemberTier, Money>;` — Record 三 key |
| `catalog/types.ts` | L116 | `@see docs/decisions/0003-domain-entity-naming.md §4 #1 brand / #2 category / #3 fits / #6 priceByTier` |
| `catalog/types.ts` | L127 | `priceByTier: PriceByTier;` — Product entity 欄位 |
| `catalog/types.ts` | L99 | `註:ADR §4 #6 字面是 Map<MemberTier, Money>、本實作為 Record(JSON 序列化友善、…)` |

**結論:** domain 層維持三 key Record、對應 schema doc「tier 列舉維持三 key、僅 jsonb 二 key seed、第三由公式算」設計、無 drift。

---

### 1.4 adapter 層

**字面來源:** `packages/adapters/src/supabase/`

**`SupabaseProductAdapter.ts` L25:**
```ts
const PRODUCT_SELECT =
  'id, title, subtitle, description, handle, price_by_tier, fitments, images, availability, created_at, updated_at, brands(id, name, slug), categories(raw_path, segments)';
```
→ SELECT 字面含 `price_by_tier` raw column(走 products 表、未走 products_public view、對齊 backlog #118 anchor「adapter 切換 view 待 M-1-16 種子前」);brands JOIN 字面只取 `id, name, slug` 三欄位、**未取 `premium_extra_pct`**。

**`mappers/product.ts` L52:**
```ts
price_by_tier: Record<MemberTier, { amount: number; currency: Currency }>;
```
→ wire row 型別宣告為 Record<MemberTier, ...> = 三 key 期待。

**`mappers/product.ts` L103-105:**
```ts
priceByTier: {
  general: toMoney(row.price_by_tier.general),
  store: toMoney(row.price_by_tier.store),
  premiumStore: toMoney(row.price_by_tier.premiumStore),
},
```
→ mapper 字面期待 `row.price_by_tier.premiumStore` **存在**。若 migration 改二 key 後、row 無此 key、`toMoney(undefined)` 行為 `<待確認:toMoney guard 對 undefined 拋 throw 還是回 fallback>`。

**`mappers/product.ts` L73:**
```ts
* - `price_by_tier` amount(integer)→ `MoneyAmount` brand type(過 `toMoneyAmount` guard)
```

**結論:** adapter 層字面與 migration 三 key 對齊,**但**:
- 若公式落地 + migration 改二 key、mapper L105 字面需動(改為公式算 premiumStore、不直接讀 row)
- SELECT 字面未取 `brands.premium_extra_pct`、需擴 SELECT 字面才能取得

---

### 1.5 storefront 層

**字面來源:** `apps/storefront/src/lib/products.ts`

| 行號 | 字面 |
|---|---|
| L4-5 | `// 對齊 docs/specs/M-1-03-main-b-PRD.md §6.1 priceByTier 三層責任: //   - adapter 層回完整 priceByTier(三 tier)` |
| L38 | `import type { CategoryPath, MemberTier, Product } from '@pcm/domain';` |
| L44-46 | `* priceByTier server-side strip(對齊 main-b PRD §6.1): *   - 取 product.priceByTier[tier].amount(單一 number) *   - 整個 priceByTier jsonb 不送 client` |
| L61 | `export function toUIProduct(product: Product, tier: MemberTier): MockProduct {` |
| L69 | `brand: product.brand.name,` |
| L72 | `price: product.priceByTier[tier].amount,` |

**結論:** storefront `toUIProduct` 字面**未實作公式**:
- 直接取 `product.priceByTier[tier].amount`(單一 number)
- 若 tier=`premiumStore` 且 row 改二 key、`priceByTier.premiumStore` undefined、`.amount` throw
- 公式 落地需:
  - dispatch tier:general / store 直取、premiumStore 算 `Math.round(priceByTier.store.amount × (1 - brand.premium_extra_pct / 100))`
  - 需要 `product.brand.premium_extra_pct` — 但 domain Brand 型別 L16 只 `id / name / slug` 三欄位、**無 premium_extra_pct**
- `<待確認:Brand value-object 是否加第 4 欄位 premium_extra_pct、或 storefront 另抓 brands 表>`

---

### 1.6 design 層(視覺真權威、HEAD `25d3a2a`)

**字面來源:** `design-reference/components/`

**`Pricing.jsx` L1-19 業務字面註解(snake_case `premium_store`):**
```
// 業務字面(v2.1):
//   每個商品後台只填兩個價:
//     - product.priceByTier.general  一般售價
//     - product.priceByTier.store    店家經銷價
//   每個廠牌後台填一個欄位:
//     - brand.premium_extra_pct      premium_store 在 store 價上再打的折扣 %(0-30、預設 0)
//
//   getPriceForTier(product, brand, tier):
//     general       → priceByTier.general
//     store         → priceByTier.store
//     premium_store → round(priceByTier.store * (1 - premium_extra_pct/100))
//
//   絕對不寫 0.85 / 0.95 等任何硬編碼折扣率。
```

**`Pricing.jsx` L29-41 公式實作:**
```js
function getPriceForTier(product, brand, tier) {
  if (!product) return 0;
  const pbt = product.priceByTier;
  if (!pbt) return product.price || 0; // legacy fallback
  if (tier === 'general') return pbt.general;
  if (tier === 'store') return pbt.store;
  if (tier === 'premium_store') {
    const base = pbt.store;
    const extra = (brand && typeof brand.premium_extra_pct === 'number')
      ? brand.premium_extra_pct
      : 0;
    return Math.round(base * (1 - extra / 100));
  }
  return pbt.general;
}
```

**`Pricing.jsx` L66 memberLabel:**
```js
const memberLabel = tier === 'premium_store' ? 'P價' : '店價';
```

**`TierComponents.jsx` L8-26 TIER_META(snake_case `premium_store`):**
```js
const TIER_META = {
  general: { zh: '一般會員', en: 'GENERAL', cls: 'tier-badge-general' },
  store:   { zh: '店家會員', en: 'STORE MEMBER', cls: 'tier-badge-store' },
  premium_store: { zh: 'PREMIUM STORE', en: 'PREMIUM STORE', cls: 'tier-badge-premium' },
};
```

**`TierComponents.jsx` L28 註解:**
```
// 三 tier 並非自動升級、純後台手動標記。UI 不提示「累計消費 X 自動升級」任何條件。
```

**`WalletTab.jsx` L5 + L26-31:**
```js
const tier = tweaks?.memberTier || 'general';
...
const tierMeta = {
  general: { line: '您目前是一般會員' },
  store: { line: '您目前是店家會員' },
  premium_store: { line: '✓ 您是 PREMIUM STORE 會員' }
};
```

**結論:** design 視覺真權威**已落公式邏輯**;tier 字面用 **snake_case `premium_store`**、與 schema/domain camelCase `premiumStore` 不同(M-1-03-post-supplement §12-5 + 第 15 條已記三層字面對應教訓);Pricing.jsx Legacy fallback 處理「無 priceByTier 退化用 product.price 當三 tier 同價」。

---

## 目標 2:Supabase Brands 表 + storefront brand 取用路徑

### 2.1 schema doc 層

**字面來源:** `docs/architecture/supabase-schema-design.md`

| 行號 | 字面 |
|---|---|
| L54 | `brand_id        uuid REFERENCES brands(id) ON DELETE RESTRICT,` — products FK |
| L101 | `findById(id)` adapter 行為 `.from('products').select('*, brands(*), categories(*)').eq('id', id).single()` |
| L159-167 | `CREATE TABLE brands` 8 欄位含 `premium_extra_pct integer NOT NULL DEFAULT 0 CHECK (0-30)` |
| L192 | `mapSupabaseProductToDomain` 走 Supabase JOIN(`select(*, brands(*))`)、單次 query 取 product + brand 還原 value-object |

§3.2「對應 domain entity」表只列 `id / name / slug` 三欄位、**未列 `premium_extra_pct`**(M-1-03-post-supplement 0b commit body 揭示:留 storefront Pricing 公式落地 slice 一起動)。

---

### 2.2 migration 落地層

**字面來源:** `supabase/migrations/20260505130758_init_brands_categories.sql`

L22-30:
```sql
CREATE TABLE brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  description text,
  logo_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

→ **brands 7 欄位、無 `premium_extra_pct`**;migration 補丁需新檔加 `ALTER TABLE brands ADD COLUMN premium_extra_pct integer NOT NULL DEFAULT 0 CHECK (premium_extra_pct >= 0 AND premium_extra_pct <= 30);`(`<待確認:ALTER TABLE 字面是否對齊 schema doc 行內 CHECK 寫法、或拆 ADD CONSTRAINT 子句>`)。

---

### 2.3 domain 層

**字面來源:** `packages/domain/src/catalog/types.ts` L5-22

```ts
/**
 * Brand: 商品所屬廠牌(value-object)。
 *
 * 對齊 ADR-0003 §4 #1:
 * - design 字面是 string('CNC RACING')
 * - Medusa wire 是 brand collection FK(brand_id)
 * - domain 用 value-object;adapter 邊界雙向 resolve FK ↔ name
 *
 * 範例:Brembo / CNC RACING / Öhlins / Akrapovič / RIZOMA / Kineo / Materya
 * (歐洲改裝零件廠商;非車輛廠牌、車輛廠牌見 FitmentSpec.motoBrand)
 */
export type Brand = {
  id: string;
  /** 對外顯示名稱、design 字面、例:'CNC RACING' */
  name: string;
  /** URL slug、例:'cnc-racing' */
  slug: string;
};
```

→ Brand value-object **3 欄位、無 `premium_extra_pct`**;若 Pricing 公式落地、需:
- 加第 4 欄位 `premium_extra_pct: number`(對齊 schema brands 第 8 欄位),或
- 另抓 brands 表(storefront server-side lookup)
- `<待確認:Brand 是否加 premium_extra_pct 欄位 / storefront 公式 dispatch 邏輯位置(toUIProduct vs 新元件 vs Pricing 元件直譯)>`

註:註解 L9 提及「Medusa wire 是 brand collection FK」屬架構轉折歷史註腳、非待修。

---

### 2.4 adapter 層

**字面來源:** `packages/adapters/src/supabase/`

**SELECT 字面(SupabaseProductAdapter.ts L25):**
```ts
'... brands(id, name, slug), categories(raw_path, segments)'
```
→ JOIN 只取 `id, name, slug`、未取 `premium_extra_pct`。

**mappers/product.ts L60-89 brand resolve:**
```ts
  brands: SupabaseBrandRow | null;
  ...
  if (!row.brands) {
    throw new Error(`Product ${row.id} missing brand JOIN`);
  }
  ...
  const brand: Brand = {
    id: row.brands.id,
    name: row.brands.name,
    slug: row.brands.slug,
  };
```
→ adapter resolve **3 欄位、無 cache**(對齊 schema doc §3.3「Mapping 規則」的「cache 名稱→ID」描述、但實作端目前無 cache 字面、`<待確認:cache 是後續 milestone 才實作、或既有未實作>`)。

`SupabaseBrandRow` 型別宣告字面 `<待確認:packages/adapters/src/supabase/mappers/product.ts 內具體欄位、本次偵察未 grep 該型別完整定義>`。

---

### 2.5 storefront 層

**字面來源:** `apps/storefront/src/lib/products.ts` L69

```ts
brand: product.brand.name,
```

→ toUIProduct **只取 brand.name**(string 顯示用)、未取其他 brand 欄位。若 Pricing 公式落地、需擴成取 brand.premium_extra_pct(或另獨立 fetcher / Pricing 元件 server-side 算)。

---

### 2.6 design 層

**字面來源:** `design-reference/components/Pricing.jsx`

| 行號 | 字面 |
|---|---|
| L7 | `//     - product.priceByTier.store    店家經銷價` |
| L10 | `//     - brand.premium_extra_pct      premium_store 在 store 價上再打的折扣 %(0-30、預設 0)` |
| L21-26 | `getBrandFor(product)` 從 `window.PCM_DATA.brands` 用 `product.brand` string 大寫比對找 brand obj |
| L37-42 | `getPriceForTier` 內 `extra = (brand && typeof brand.premium_extra_pct === 'number') ? brand.premium_extra_pct : 0;` |

→ design 端 brand 用 `window.PCM_DATA.brands` 全域陣列 + string 比對(prototype 用)、實作落地需另設計取用方式(adapter JOIN 擴 / 新 brand fetcher)。

---

## 目標 3:design-reference 內「· 經銷」字面位置 + 上下文

### 3.1 嚴格「· 經銷」字面命中(2 筆)

**字面來源:** `design-reference @ 25d3a2a`

#### 命中 #1:`components/ProductPage.jsx` L529

**上下文 L524-534:**
```jsx
          </svg>
        </button>
        <div className="pd-mbb-price-col">
          <div className="pd-mbb-price">NT$ {window.getPriceForTier(product, brandObj, tweaks?.memberTier || 'general').toLocaleString()}</div>
          {(tweaks?.memberTier === 'store' || tweaks?.memberTier === 'premium_store') ? (
            <div className="pd-mbb-orig">原價 NT$ {(hasDiscount ? product.origPrice : product.price).toLocaleString()} · 經銷</div>
          ) : hasDiscount && (
            <div className="pd-mbb-orig">NT$ {product.origPrice.toLocaleString()}</div>
          )}
        </div>
        <button className="pd-mbb-cart" onClick={addToCart} disabled={!product.inStock}
```

**語境:** mobile bottom bar 價格列、tier === 'store' 或 'premium_store' 顯示「原價 X · 經銷」、其餘 fall-back 顯示促銷 origPrice。

**className:** `pd-mbb-orig`(product detail mobile bottom bar、original price)

---

#### 命中 #2:`components/AccountPages.jsx` L120

**上下文 L115-125:**
```jsx
                  </div>
                </div>
                <div className="cart-item-price">
                  <div className="cart-item-price-main">NT$ {(unitPrice(line.product) * line.qty).toLocaleString()}</div>
                  {tier === 'premium_store' && (
                    <div className="cart-item-price-unit"><s>NT$ {(line.product.price * line.qty).toLocaleString()}</s> · 經銷</div>
                  )}
                  {tier !== 'premium_store' && line.qty > 1 && <div className="cart-item-price-unit">單價 NT$ {line.product.price.toLocaleString()}</div>}
                </div>
              </div>
            ))}
```

**語境:** cart 行單價列、tier === 'premium_store' 顯示劃線 product.price + 「· 經銷」、其餘 tier(qty > 1)顯示「單價 NT$ X」。

**className:** `cart-item-price-unit`

---

### 3.2 design-handoff 明示處置方向

**字面來源:** `design-reference/design-handoff/HANDOFF-v2.1.md` L160-170

```
### 5.5 ProductPage 「經銷」標 label
**字面**:`memberLabel = tier === 'premium_store' ? 'PREMIUM' : '經銷'`
**實際**:落地 `<Price>` 元件依此切換。但 ProductPage / CheckoutPage 還有獨立的「· 經銷」字串(`pd-mbb-orig` / co-review 區塊)硬編碼 `經銷` 二字。premium_store 看到的也是「經銷」、不是 PREMIUM。
**處置**:**留待 Phase 3**(或 Claude Code 落地時統一改 `<Price>` 元件渲染、停用獨立字串)。本補單未動是因為改動會牽涉樣式重排、不在 §2 改動清單內。
```

**HANDOFF 字面 vs 實況 Pricing.jsx 字面偏離:**
- HANDOFF L162:`memberLabel = tier === 'premium_store' ? 'PREMIUM' : '經銷'`
- Pricing.jsx L66 實況:`const memberLabel = tier === 'premium_store' ? 'P價' : '店價';`
→ HANDOFF v2.1 字面與 Pricing.jsx 實況**不一致**;`<待確認:HANDOFF 字面是規劃稿、Pricing.jsx 實況是後續調整、或 HANDOFF 是真權威 Pricing.jsx 為 drift>`。

---

### 3.3 廣義「經銷」字面命中(5 筆、含 3.1 兩筆嚴格命中)

| # | 檔案 | 行號 | 字面 | 性質 |
|---|---|---|---|---|
| a | `components/ProductPage.jsx` | L295 | `<span className="pd-price-tag-dealer ap-mono">經銷價</span>` | tier-aware label tag |
| b | `components/ProductPage.jsx` | **L529** | `... · 經銷</div>` | **硬編碼 #1** |
| c | `components/Pricing.jsx` | L6 | `//     - product.priceByTier.store    店家經銷價` | 註解、不渲染 |
| d | `components/App.jsx` | L290 | `<div className="tweaks-hint">店家會員顯示經銷價(8.5 折,可由後台設定)</div>` | dev tweaks hint、`<待確認:App.jsx 是否生產代碼或 dev only>` — 註:8.5 折字面與 v2.1「絕對不寫 0.85 / 0.95 等任何硬編碼折扣率」自我矛盾、可能屬 dev-only 過期文案 |
| e | `components/AccountPages.jsx` | **L120** | `... · 經銷</div>` | **硬編碼 #2** |
| f | `components/AccountPages.jsx` | L478-479 | `if (t === 'premium_store') return '已享 PREMIUM 經銷折扣'; if (t === 'store') return '已享店家經銷價';` | tier-aware return string、非硬編碼 |

**className 相關字面彙整:**
- `pd-mbb-orig`(ProductPage mobile bottom bar、嚴格命中 #1 載體)
- `cart-item-price-unit`(AccountPages cart 單價、嚴格命中 #2 載體)
- `pd-price-tag-dealer` + `ap-mono`(ProductPage L295 label tag、tier-aware)
- `price-tag-dealer` + `ap-mono`(Pricing.jsx L75 `<span className="price-tag-dealer ap-mono">{memberLabel}</span>`、`<Price>` 元件內、memberLabel = 'P價' / '店價')
- `tweaks-hint`(App.jsx L290、tweaks dev panel)
- `acc-stat-sub`(AccountPages L475 區、tier statement)

---

## Meta

### M.1 grep 指令清單(供 Claude.ai 驗證偵察完整度)

```bash
# 目標 1 偵察
grep -n "price_by_tier" docs/architecture/supabase-schema-design.md
grep -n "premium_extra_pct" docs/architecture/supabase-schema-design.md
grep -n "Pricing 公式" docs/architecture/supabase-schema-design.md docs/specs/M-1-03-products-schema-prd-v3.md
grep -rn "priceByTier" packages/domain/src/catalog/types.ts packages/domain/src/shared/types.ts
grep -rn "MemberTier" packages/domain/src/catalog/types.ts packages/domain/src/shared/types.ts
grep -rn "price_by_tier|premium_extra_pct|MemberTier" packages/adapters/src/supabase/
grep -rn "price_by_tier|premium_extra_pct|MemberTier|priceByTier" apps/storefront/src/lib/
ls supabase/migrations/*.sql
find supabase/migrations -name "*.sql" -exec grep -l "price_by_tier|premium_extra_pct" {} \;
grep -n -A 8 "price_by_tier|premium_extra_pct" supabase/migrations/20260507004826_init_products.sql
grep -n -A 12 "CREATE TABLE brands|premium_extra_pct" supabase/migrations/20260505130758_init_brands_categories.sql
grep -n -B 2 -A 4 "price_by_tier|premium_extra_pct" supabase/migrations/20260510134708_products_public_view.sql

# 目標 1 design 層
head -100 design-reference/components/Pricing.jsx
head -100 design-reference/components/TierComponents.jsx
head -50 design-reference/components/WalletTab.jsx

# 目標 2 偵察
grep -n "CREATE TABLE brands|brands(" docs/architecture/supabase-schema-design.md
find supabase/migrations -name "*.sql" -exec grep -l "brands" {} \;
sed -n '5,25p' packages/domain/src/catalog/types.ts  # Brand value-object
sed -n '60,115p' packages/adapters/src/supabase/mappers/product.ts  # brand resolve + priceByTier mapping
sed -n '20,35p' packages/adapters/src/supabase/SupabaseProductAdapter.ts  # PRODUCT_SELECT
grep -n "brand" apps/storefront/src/lib/products.ts

# 目標 3 偵察
grep -rn "· 經銷" design-reference --include="*.jsx" --include="*.tsx" --include="*.css" --include="*.md"
grep -rn "經銷" design-reference --include="*.jsx" --include="*.tsx"
sed -n '524,534p' design-reference/components/ProductPage.jsx
sed -n '115,125p' design-reference/components/AccountPages.jsx
sed -n '473,484p' design-reference/components/AccountPages.jsx
sed -n '160,170p' design-reference/design-handoff/HANDOFF-v2.1.md

# 補偵察(2026-05-12 sub-slice、Q-A2a + Q-A3a)
 grep -rn "function toMoney|const toMoney|export.*toMoney" packages/
 grep -rn "SupabaseBrandRow|type SupabaseBrandRow" packages/
```

---

### M.2 字面對齊矩陣

#### 目標 1(Supabase Pricing 五層 + design 一層 = 6 層)

| 層 | 真權威 / 落地字面 | 對齊狀態 | 對齊基準 |
|---|---|---|---|
| schema doc | supabase-schema-design.md §2.1 CHECK 二 key + §3.1 brands.premium_extra_pct CHECK(0-30) | ✅ | M-1-03-post-supplement 0b 已落 |
| migration | `init_products.sql` L43-47 CHECK **三 key** + `init_brands_categories.sql` brands **無 premium_extra_pct** | ⏳ | 待 migration 補丁(新 .sql 加 ALTER + DROP CHECK + ADD CHECK 二 key + brands ADD COLUMN) |
| domain | `MemberTier` 三 key + `PriceByTier` Record + `Brand` 3 欄位 | ✅(MemberTier / PriceByTier) ⏳(Brand 無 premium_extra_pct) | Pricing 公式落地時、Brand 需擴 4 欄位 |
| adapter | SELECT 含 `price_by_tier` + brands(id, name, slug)、mapper 三 key 期待 row.priceByTier.premiumStore | ✅(三 key 路徑) ⏳(公式落地需改 mapper + 擴 SELECT brands.premium_extra_pct) | 與 migration 二 key + Brand 擴欄位連動 |
| storefront | toUIProduct 直取 priceByTier[tier].amount、**未實作公式** | ❌(無公式) | 公式落地需 dispatch / 算 premiumStore |
| design | Pricing.jsx 公式落地 + TierComponents.jsx + WalletTab.jsx snake_case `premium_store` | ✅(視覺真權威已落) | (儲存方為真權威、無需對齊其他) |

**對齊狀態彙總:** ✅ 3 項 / ⏳ 2 項 / ❌ 1 項 / 三層字面分歧 1 處(camelCase vs snake_case、§12-5 + 第 15 條教訓已記)。

---

#### 目標 2(Supabase Brands 五層 + design 一層 = 6 層)

| 層 | 真權威 / 落地字面 | 對齊狀態 | 對齊基準 |
|---|---|---|---|
| schema doc | brands 8 欄位含 premium_extra_pct + products.brand_id FK ON DELETE RESTRICT | ✅ | 0b 已落 |
| migration | brands **7 欄位、無 premium_extra_pct** | ⏳ | 待 migration 補丁加第 8 欄位 |
| domain | `Brand` 3 欄位(id / name / slug) | ⏳ | 公式落地時擴 4 欄位 / 或另抓 |
| adapter | SELECT JOIN 取 `brands(id, name, slug)`、未取 premium_extra_pct;resolve 三欄位、無 cache 字面 | ⏳ | 擴 SELECT + 擴 mapper |
| storefront | `brand: product.brand.name`(僅 name string) | ⏳ | 公式落地時擴或另抓 |
| design | Pricing.jsx `getBrandFor` 用 `window.PCM_DATA.brands` 全域陣列(prototype) | ✅(視覺真權威) | (儲存方為真權威) |

**對齊狀態彙總:** ✅ 2 項 / ⏳ 4 項 / ❌ 0 項。

---

#### 目標 3(「· 經銷」硬編碼字面)

| 命中 | 檔案 + 行號 | 處置基準 |
|---|---|---|
| #1 | ProductPage.jsx L529(pd-mbb-orig) | HANDOFF-v2.1 §5.5「留待 Phase 3、或落地時統一改 `<Price>` 元件渲染、停用獨立字串」 |
| #2 | AccountPages.jsx L120(cart-item-price-unit) | 同上 |

廣義「經銷」5 筆中 2 筆嚴格硬編碼、3 筆 tier-aware(可保留)、1 筆註解(可保留)。

---

### M.3 偵察未涵蓋但相關的疑點(供 Claude.ai 決定是否補偵察)

1. **`supabase-schema-design.md` L257 + L308 舊註解未同步二 key + 提及 Medusa**
   - L257:CHECK 註解仍寫「強制三 tier 全部存在」、與 0b L63-67 二 key 衝突
   - L308:「wire 端從 Medusa Price List × customer_group 改 Supabase」屬架構轉折歷史註腳、可能誤導後續 Claude.ai
   - `<待確認:是否要本 main-a slice 順手清理 / 留更後 slice 統一清理>`

2. **`toMoney()` guard 對 undefined 行為**
   - mappers/product.ts L105 `toMoney(row.price_by_tier.premiumStore)`
   - 若 migration 改二 key 後、row.price_by_tier.premiumStore = undefined
   - `<待確認:toMoney 是否 throw / 回 null / 回 fallback>` — 影響 mapper 是否需先重構才能安全改 migration

   **補偵察結果(2026-05-12 sub-slice、Q-A2a):**

   **`toMoney` 定義位置:** `packages/adapters/src/supabase/mappers/product.ts` L163-168

   ```ts
   function toMoney(wire: { amount: number; currency: Currency }): Money {
     return {
       amount: toMoneyAmount(wire.amount),
       currency: wire.currency,
     };
   }
   ```

   **`toMoneyAmount` 定義位置:** `packages/domain/src/shared/types.ts` L44-52

   ```ts
   export function toMoneyAmount(n: number): MoneyAmount {
     if (!Number.isInteger(n)) {
       throw new Error(`MoneyAmount must be integer, got ${n}`);
     }
     if (n < 0) {
       throw new Error(`MoneyAmount must be non-negative, got ${n}`);
     }
     return n as MoneyAmount;
   }
   ```

   **undefined 行為結論:** 不 fallback / 不回 null、**兩段式 throw**(具體):
   - 路徑 A:若 `wire` 本身 = `undefined`(call 點傳 `toMoney(undefined)`)→ runtime 執行 `wire.amount` → **JS 原生 `TypeError: Cannot read properties of undefined (reading 'amount')`**(不是 explicit throw new Error、是 V8 引擎拋)
   - 路徑 B:若 `wire = { amount: undefined, currency: 'TWD' }`(amount key 缺)→ 進 `toMoneyAmount(undefined)` → `Number.isInteger(undefined)` = false → **`throw new Error('MoneyAmount must be integer, got undefined')`**(explicit throw)
   - 實況 mapper L105 `toMoney(row.price_by_tier.premiumStore)`:若 jsonb 二 key、`row.price_by_tier.premiumStore` 是 `undefined`(整個 wire 物件 undefined)、走路徑 A、TypeError

3. **`SupabaseBrandRow` 型別完整定義**
   - mappers/product.ts L61 引用 `SupabaseBrandRow`(本次偵察未 grep 該 type 字面)
   - 若 brands 加 `premium_extra_pct`、需擴此 type
   - `<待確認:SupabaseBrandRow 字面位置 + 既有欄位>`

   **補偵察結果(2026-05-12 sub-slice、Q-A3a):**

   **`SupabaseBrandRow` 定義位置:** `packages/adapters/src/supabase/mappers/product.ts` L24-32

   ```ts
   export type SupabaseBrandRow = {
     id: string;
     name: string;
     slug: string;
     description: string | null;
     logo_url: string | null;
     created_at: string;
     updated_at: string;
   };
   ```

   **既有欄位列表:** 7 欄位 — `id` / `name` / `slug` / `description` / `logo_url` / `created_at` / `updated_at`、**無 `premium_extra_pct`**。

   對齊狀態:與 migration `init_brands_categories.sql` L22-30 brands 表 7 欄位字面一致、與 schema doc supabase-schema-design.md L159-167 brands 8 欄位(含 `premium_extra_pct`)drift。

   附註:L20-22 type 區段 header 字面「對齊 ADR-0003 §3.4 wire 字串紀律:本 type 是 wire 字面、只在 mapper 邊界出現、不 leak 至 domain / ports / use-case。」

4. **`App.jsx` L290 dev tweaks-hint「8.5 折」字面**
   - 與 v2.1「絕對不寫硬編碼折扣率」自我矛盾
   - `<待確認:App.jsx 是生產 build 或 dev-only panel、是否需修>`

5. **`HANDOFF-v2.1.md` L162 memberLabel 字面 vs Pricing.jsx L66 實況偏離**
   - HANDOFF:`'PREMIUM' : '經銷'`、Pricing.jsx:`'P價' : '店價'`
   - `<待確認:HANDOFF 字面是規劃稿(Pricing.jsx 為實況真權威)、或 HANDOFF 為真權威(Pricing.jsx drift)>`

6. **adapter brand cache 字面**
   - schema doc §3.3 Mapping 規則描述「adapter 雙向 resolve FK ↔ name string;cache 名稱→ID」
   - 但實作端 mappers/product.ts L80-89 brand resolve 無 cache 字面
   - `<待確認:cache 是 PRD 階段預留 / 未實作、或既有實作位置在他處>`

7. **adapter SELECT 字面 vs products_public view 衝突**
   - SupabaseProductAdapter.ts L25 SELECT 字面用 raw `products` 表(不走 products_public view)
   - products_public view 排除 price_by_tier(audit Slice A 落地)
   - 對齊 backlog #118 anchor「adapter 切換 view」未動
   - `<待確認:main-a slice 是否含此切換、或留後續 slice>`

8. **公式 落地位置選擇**
   - storefront toUIProduct(server-side、現有路徑)
   - 新獨立 Pricing 元件直譯(對齊 design Pricing.jsx 拆元件)
   - adapter mapper(server-side、最早攔截但破壞 priceByTier 三 key Record 純粹性)
   - `<待確認:公式 dispatch 位置 = 哪一層、Pricing 元件直譯範圍 = 拆 design Pricing.jsx 多少>`

9. **`window.PCM_DATA.brands` design prototype 路徑 vs 落地路徑**
   - design Pricing.jsx L21-26 用 `window.PCM_DATA.brands` 找 brand
   - 落地不可能用 window 全域、需 server-side fetcher / context provider / adapter JOIN 擴
   - `<待確認:storefront brand lookup 路徑 = adapter SELECT 擴(同 query 取) / 獨立 server fetcher / context / 其他>`

10. **三層字面對應實作端統一**
    - schema:`premiumStore`(camelCase)
    - design:`premium_store`(snake_case)
    - storefront tier value 取用時、需 mapping(`schemaToDesign(tier)` / `designToSchema(tier)`)
    - `<待確認:mapping 函數位置 = packages/domain 或 apps/storefront utils 或 packages/adapters mapper>`

---

### M.4 三個最關鍵的「字面 vs Claude.ai 可能誤判」風險點

#### 風險 #1:**migration 三 key vs schema doc 二 key 衝突未解**
- 0b 已修 schema doc 字面、但 migration 仍三 key、brands 仍 7 欄位
- Claude.ai 可能誤以為 0b 已完成全部、實況 migration 補丁未寫
- 證據:`init_products.sql` L43-47 CHECK 仍三 key、`init_brands_categories.sql` brands 7 欄位

#### 風險 #2:**三層字面拼法分歧(`premiumStore` vs `premium_store`)+ storefront 公式 dispatch 缺**
- schema/domain/adapter:`premiumStore`(camelCase)
- design:`premium_store`(snake_case)
- storefront toUIProduct L72 直取 `priceByTier[tier].amount`、無 dispatch、無 brand.premium_extra_pct 取用
- Claude.ai 寫落地指令字面易混用三層拼法、需明示 mapping 表 + 公式 dispatch 位置
- 證據:lessons §12-5 + working-style 第 15 條已記、本檔 M.3 #10 列為疑點

#### 風險 #3:**Brand value-object 缺第 4 欄位 + adapter SELECT 缺 premium_extra_pct + design 用 window.PCM_DATA**
- 公式 落地需 storefront 取得 brand.premium_extra_pct、但:
  - Brand 型別只 3 欄位
  - adapter SELECT 只 `brands(id, name, slug)`
  - design prototype 用 window 全域(不可用於落地)
- Claude.ai 可能省略「brand premium_extra_pct 取用路徑」討論、直接寫公式落地、但實況無從取得
- 證據:catalog/types.ts L16 / SupabaseProductAdapter.ts L25 / Pricing.jsx L21-26

---

— END —
