# M-1-03-main-a 刀 4 Recon:storefront 公式 dispatch + 修「· 經銷」硬編碼字面偵察報告

> **產出時機:** 2026-05-12(刀 3 audit amend ✅ 落地後、刀 4 PRD 寫作前)
>
> **真權威來源:** design-reference @ `25d3a2a` + lib/products.ts 既有路徑 + Pricing.jsx 公式 + storefront 既有元件
>
> **本檔性質:** 純偵察事實記錄、不預判落地方案、不寫「建議用 X」、候選 A/B/C 純列舉。Claude.ai 讀本檔組裝刀 4 PRD 字面。
>
> **HEAD:** `2234f5e` / STATUS L29 累積 drift / ahead origin/dev = 0
>
> **延續:** `docs/recon/m-1-03-main-a-recon.md` 既有偵察(§1.6 / §2.6 / §3 部分涵蓋)、本檔聚焦刀 4 PRD 前置 + 補周邊上下文

---

## 目標 1:design Pricing.jsx 公式完整字面 + 連動元件

### 1.1 Pricing.jsx 完整字面(114 行、補 §1.6 L66+ 未涵蓋部分)

**字面來源:** `design-reference/components/Pricing.jsx`

**5 個 function exports:**

| 行號 | Function | 簽名 |
|---|---|---|
| L20 | `getBrandFor(product)` | 從 `window.PCM_DATA.brands` 找對應 brand 物件(name 字串 → brand object) |
| L27 | `getPriceForTier(product, brand, tier)` | 公式 dispatch:general/store 直讀 / premium_store 算 `round(store × (1 - extra/100))` |
| L44 | `getEffectivePrice(product, tier, brand?)` | wrapper、brand 可省略(自動 getBrandFor)、回單一 number |
| L56 | `<Price>` 元件 | tier 切換顯示(劃線 generalPrice + tier price + memberLabel tag) |
| L96 | `<LinePrice>` 元件 | 行內小計、qty × unit、tier 切換劃線 |

**export 機制(L114):**
```js
Object.assign(window, { getBrandFor, getPriceForTier, getEffectivePrice, Price, LinePrice });
```
→ prototype window 路徑、storefront 落地不可用此模式、需重新設計 export(對齊 §M.3 風險 #1)

**Price 元件 memberLabel(L66):**
```js
const memberLabel = tier === 'premium_store' ? 'P價' : '店價';
```

**Price 元件 3 分支(L70-95):**
- **店家 / premium_store** tier:`<span className="price-wrap price-${size} price-${layout} is-dealer">` + 劃線 general + price-main tier price + `<span className="price-tag-dealer ap-mono">{memberLabel}</span>`
- **一般會員 + 站上促銷**:劃線 origPrice + is-sale priceMain + 可選「省 NT$ X」save tag
- **一般會員 + 無促銷**:純 price-main

**LinePrice 元件 memberLabel(L102、同 Price):**
```js
const memberLabel = tier === 'premium_store' ? 'P價' : '店價';
```
→ 兩處重複硬編碼(L66 + L102)、刀 4 落地候選方案之一可抽 const

### 1.2 CSS class 對應表

**字面來源:** `design-reference/styles/pricing.css`(L3-60)+ `account.css`(L150)+ `product-page.css`(L761)

| className | CSS file | 行號 | 用途 |
|---|---|---|---|
| `.price-wrap` | pricing.css | L3-7 | base flex container |
| `.price-wrap .price-main` | pricing.css | L10-13 | 主價字面樣式 |
| `.price-wrap .price-main.is-sale` | pricing.css | L14-16 | 促銷主價 |
| `.price-wrap .price-orig` | pricing.css | L17-21 | 原價字面 |
| `.price-wrap .price-strike` | pricing.css | L22 | 劃線樣式 |
| `.price-wrap .price-tag-dealer` | pricing.css | L23-32 | 經銷 tag 樣式(member label 容器)|
| `.price-wrap .price-tag-save` | pricing.css | L33-39 | 省 NT$ tag |
| `.price-wrap.is-dealer .price-main` | pricing.css | L46 | dealer tier 主價紅色(`var(--c-accent)`)|
| `.price-wrap.is-dealer .price-orig` | pricing.css | L50 | 小螢幕 dealer orig 隱藏 |
| `.cart-item-price-unit` | account.css | L150 | cart 單價字面(`· 經銷` 硬編碼 #2 載體)|
| `.pd-mbb-orig` | product-page.css | L761 | ProductPage mobile bottom bar(`· 經銷` 硬編碼 #1 載體)|

### 1.3 公式邏輯 + legacy fallback(L27-42)

```js
function getPriceForTier(product, brand, tier) {
  if (!product) return 0;
  const pbt = product.priceByTier;
  if (!pbt) return product.price || 0;  // legacy fallback
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

**設計揭示:**
- design 端 `product.priceByTier.general/store` 是 number(非 Money 物件)、與 storefront domain Product.priceByTier 三 tier Money 物件 drift
- legacy fallback:無 priceByTier → 退化用 `product.price` 當所有 tier 同價、僅 prototype 階段用
- brand 字面期待 `{ premium_extra_pct: number }` 物件(設計對齊刀 1b 落地 Brand 第 4 欄位)
- premium_extra_pct 缺/非 number → fallback 0%、安全行為

### 1.4 getBrandFor 邏輯(L20-25、prototype window 路徑)

```js
function getBrandFor(product) {
  if (!product || !product.brand) return null;
  const list = (window.PCM_DATA && window.PCM_DATA.brands) || [];
  const key = String(product.brand).toUpperCase();
  return list.find(b => String(b.name).toUpperCase() === key) || null;
}
```

→ `product.brand` 在 design 是字串、用大寫比對找 brand 物件;storefront 落地 `product.brand` 已是 Brand value-object(id + name + slug + premium_extra_pct)、不需 lookup、可直接取 `product.brand.premium_extra_pct`(候選之一)

---

## 目標 2:storefront 既有路徑

### 2.1 `apps/storefront/src/lib/products.ts`(完整 122 行)

**檔頭 server-only guard(L29-33):**
```ts
if (typeof window !== 'undefined') {
  throw new Error(
    '@/lib/products is server-only — must not be imported from client component bundle',
  );
}
```

**toUIProduct(L60-77):**
```ts
export function toUIProduct(product: Product, tier: MemberTier): MockProduct {
  const firstFitment = product.fitments[0];
  const fits = firstFitment
    ? `${firstFitment.motoBrand} ${firstFitment.modelCode}`
    : '通用款';
  return {
    id: product.id as unknown as number,
    brand: product.brand.name,
    name: product.name,
    fits,
    price: product.priceByTier[tier].amount,  // ← L72:tier dispatch 點、刀 4 公式落地點
    origPrice: null,
    isNew: false,
    isSale: false,
    inStock: product.availability === 'in-stock',
    category: product.category.raw,
    color: 'silver',
    imgTone: 'neutral',
  };
}
```

**fetchFeaturedProducts(L97-122):**
```ts
export async function fetchFeaturedProducts(): Promise<FeaturedResult> {
  const client = createSupabaseAnonClient();
  const adapter = new SupabaseProductAdapter(client);
  const category: CategoryPath = { raw: '操控部品', segments: ['操控部品'] };
  try {
    const products = await adapter.listByCategory(category);
    return {
      products: products.slice(0, 4).map((p) => toUIProduct(p, 'general')),  // ← L115:tier hardcoded 'general'
      error: false,
    };
  } catch (err) {
    console.error('[fetchFeaturedProducts] adapter.listByCategory failed:', err);
    return { products: [], error: true };
  }
}
```

### 2.2 page.tsx(完整、L37 force-dynamic + L39 await fetch)

**字面來源:** `apps/storefront/src/app/page.tsx`

```ts
export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const featured = await fetchFeaturedProducts();
  return (
    <div data-screen-label="Home" className="ed-page">
      <Header cartCount={4} currentPage="home" />
      ...
      <HomeSelect featured={featured} />
      ...
    </div>
  );
}
```

→ tier 取得路徑 **完全不存在**(page.tsx 不傳 tier、fetchFeaturedProducts 內 hardcoded 'general')

### 2.3 HomeSelect.tsx(完整)

**字面來源:** `apps/storefront/src/components/HomeSelect.tsx`

- L13 `'use client'`(因 ProductCard 用 onClick callback)
- L16-18 import FeaturedResult + ProductCard
- L24 接 `featured: FeaturedResult` prop、**無 tier prop**
- L43-44 三條 UI 分支(error / empty / 正常)
- L65 `<ProductCard key={p.id} p={p} ... />` — `p` 是 MockProduct、**無 tier prop**

### 2.4 MemberTier 字面命中(僅 lib/products.ts L38 + L61)

```
apps/storefront/src/lib/products.ts:38:import type { CategoryPath, MemberTier, Product } from '@pcm/domain';
apps/storefront/src/lib/products.ts:61:export function toUIProduct(product: Product, tier: MemberTier): MockProduct {
```

→ storefront 內 tier 字面取用點 **僅 1 處 caller**(`fetchFeaturedProducts` 內 hardcoded 'general')、其他元件不接 tier

### 2.5 既有 utils 引用(刀 1a designTierToSchema / schemaTierToDesign)

```bash
grep -rn "designTierToSchema\|schemaTierToDesign" apps/
# → 0 命中(刀 4 才整合)
```

### 2.6 storefront 公式落地需擴的 anchor 點(純事實列舉)

- **toUIProduct 簽名:** `(product: Product, tier: MemberTier)` 已含 tier 參數、但 L72 直接 `product.priceByTier[tier].amount`、未走公式(刀 3 已 placeholder 化 premiumStore)
- **fetchFeaturedProducts 內 tier:** L115 hardcoded `'general'`、需動態從 session / context / prop 取
- **page.tsx tier:** 完全不存在、需新引入(可能 cookie / session / context)
- **HomeSelect / ProductCard / 其他元件:** 無 tier prop、需考慮 prop drilling vs context vs SWR / hook
- **business 字面 vs schema 字面 mapping:** 刀 1a utils `designTierToSchema` / `schemaTierToDesign` 已落地、刀 4 整合點待設計
- **brand 取用路徑:** toUIProduct 內 `product.brand` 是 Brand value-object(id + name + slug + premium_extra_pct)、直接取 `product.brand.premium_extra_pct` 即可、不需 design 端 getBrandFor lookup

---

## 目標 3:「· 經銷」兩處硬編碼 + 周邊 tier-aware 字面

### 3.1 ProductPage.jsx L529(硬編碼 #1)上下文 30 行

**字面來源:** `design-reference/components/ProductPage.jsx` L510-545

```jsx
        }} aria-label="返回上一頁">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m15 18-6-6 6-6"/>
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
          aria-label="加入購物車">
          ...
        </button>
        <button className="pd-mbb-buynow" onClick={addToCart} disabled={!product.inStock}>
          立即購買
        </button>
      </div>
```

**揭示:**
- L527 `pd-mbb-price` 已用 `window.getPriceForTier`(公式落地)
- L529 `pd-mbb-orig` 字面「· 經銷」**硬編碼**(tier=store 或 premium_store 顯示)
- design 端內部不一致:同一檔 L527 用公式、L529 硬編碼

### 3.2 AccountPages.jsx L120(硬編碼 #2)上下文 30 行

**字面來源:** `design-reference/components/AccountPages.jsx` L105-135

```jsx
                <div className="cart-item-price">
                  <div className="cart-item-price-main">NT$ {(unitPrice(line.product) * line.qty).toLocaleString()}</div>
                  {tier === 'premium_store' && (
                    <div className="cart-item-price-unit"><s>NT$ {(line.product.price * line.qty).toLocaleString()}</s> · 經銷</div>
                  )}
                  {tier !== 'premium_store' && line.qty > 1 && <div className="cart-item-price-unit">單價 NT$ {line.product.price.toLocaleString()}</div>}
                </div>
```

**揭示:**
- L120 字面「· 經銷」**硬編碼**(tier === 'premium_store' 時顯示)
- `unitPrice(line.product)` 在 CheckoutPage.jsx L82 揭示為 `(p) => window.getEffectivePrice(p, memberTier)`(走 Pricing 公式)
- design 端同樣不一致:cart-item-price-main 用 unitPrice(公式)、cart-item-price-unit 硬編碼

### 3.3 design 端 `<Price>` / `<LinePrice>` 元件用法(0 + 1 命中)

```bash
grep -rn "<Price\b\|<LinePrice\b\|from.*Pricing" design-reference/components/
# → 0 命中(無 import + 0 jsx 用法)

grep -rn "window\.Price\b" design-reference/components/
# → ProductCard.jsx:134:<window.Price product={p} brand={...} tier={memberTier} size="md" ... />
```

**揭示:**
- `<Price>` 元件在 design 全部 components 內 **僅 1 處用法**(ProductCard.jsx L134)
- 其他元件(ProductPage.jsx / AccountPages.jsx / CheckoutPage.jsx)用 `window.getPriceForTier` 直接取 number、不用 `<Price>` 元件
- HANDOFF-v2.1 §5.5 提的「統一改 `<Price>` 元件渲染」是 design 端**未完成的設計目標**、刀 4 storefront 落地時可一併執行(候選 B)

### 3.4 candidate 落地方案(純列舉、不偏推薦)

```
候選 A:storefront 不拆元件、直接 inline memberLabel 邏輯
  - toUIProduct 加 originalPrice (general tier) + tierLabel ('P價' / '店價' / undefined)
  - ProductCard / cart / ProductPage 各自 inline 顯示 tier label
  - 對齊 design 端 ProductPage L529 / AccountPages L120 風格(雖然字面是硬編碼「· 經銷」、刀 4 改為 memberLabel 變數)
  - 改動範圍:lib/products.ts + ProductCard.tsx + 未來 ProductPage / Cart 元件(尚未落地)
  - 風險:多處重複 tier 判斷邏輯、可維護性下降

候選 B:storefront 拆獨立 <Price> / <LinePrice> 元件(對齊 HANDOFF-v2.1 §5.5)
  - 新建 `apps/storefront/src/components/Price.tsx` + `LinePrice.tsx`
  - 對齊 design Pricing.jsx L56-95 + L96-114 字面
  - ProductCard / cart / ProductPage 改用 <Price> 元件、不直接顯示 price
  - 改動範圍:lib/products.ts(toUIProduct 改回 priceByTier 三 tier、不 strip 單一 price)+ 新 Price.tsx + ProductCard.tsx
  - 風險:toUIProduct 簽名變(MockProduct.price 改 priceByTier?)、shape drift、刀 d2 真資料接入點重做

候選 C:storefront server-side 公式 dispatch、UI 仍接 MockProduct shape
  - toUIProduct 改為 server-side 算公式、UI shape 多加 `originalPrice` + `tierLabel` 欄位
  - ProductCard 不接 tier、直接顯示 MockProduct.price + tierLabel(若有)
  - 對齊既有 MockProduct shape、最少 shape drift
  - 風險:tierLabel 字面散落 server fetcher、UI 端難 grep 追蹤
```

---

## 目標 4:storefront 其他 tier 顯示元件

### 4.1 storefront components 清單(10 元件)

**字面來源:** `apps/storefront/src/components/`

| 元件 | 含 tier prop / 字面? |
|---|---|
| BrandIndex.tsx | `<待確認>`(未 grep 內部、tier 字面 0 命中本檔 grep 結果) |
| CategoryGrid.tsx | `<待確認>` 同上 |
| HomeHero.tsx | `<待確認>` 同上 |
| VehicleFinder.tsx | `<待確認>` 同上 |
| HomeStatement.tsx | `<待確認>` 同上 |
| FeatureEditorial.tsx | `<待確認>` 同上 |
| **ProductCard.tsx** | **無 tier prop**(實況、與 design 端 ProductCard.jsx L74 接 tier 字面 drift) |
| **HomeSelect.tsx** | **無 tier prop**(實況、僅接 featured: FeaturedResult) |
| Header.tsx | 搜尋邏輯有(L75/L107 openSearch)、無 tier 字面 |
| HomeFooter.tsx | `<待確認>` 同上 |

**完整 grep:**
```bash
grep -rn "MemberTier\|memberTier\|tier=\|tier:" apps/storefront/src/
# → 僅 lib/products.ts:38 + 61 命中(2 處)、其他元件 0 命中
```

**結論:** storefront 內 tier 字面取用 **僅 1 點**(lib/products.ts 內 toUIProduct + fetchFeaturedProducts 內 hardcoded 'general')。

### 4.2 design 端對應元件 tier 顯示邏輯

| design 元件 | tier 使用模式 |
|---|---|
| Pricing.jsx | 公式定義(`getPriceForTier`)+ `<Price>` `<LinePrice>` 元件 + `Object.assign(window)` export |
| ProductCard.jsx L74 + L134 | 接 tier prop + 用 `<window.Price>` 元件 |
| ProductPage.jsx L291 + L527 | `window.getPriceForTier(product, brandObj, tweaks?.memberTier)` 直接取 |
| ProductPage.jsx L529 | 硬編碼「· 經銷」(tier=store/premium_store)|
| AccountPages.jsx L120 | 硬編碼「· 經銷」(tier === 'premium_store')|
| AccountPages.jsx L478-479 | tier-aware return string「已享 PREMIUM 經銷折扣」/「已享店家經銷價」|
| CheckoutPage.jsx L82 | `unitPrice = (p) => window.getEffectivePrice(p, memberTier)` |

### 4.3 ProductCard.tsx vs design ProductCard.jsx drift

**storefront L107(無 tier prop):**
```ts
export function ProductCard({ p, showRedPrice, badgeStyle, compact, onClick }: ProductCardProps) {
```

**design L74(接 tier prop):**
```js
function ProductCard({ p, showRedPrice, badgeStyle = 'minimal', compact = false, onClick, tier }) {
  ...
  const memberTier = tier || (typeof window !== 'undefined' && window.__pcmTier) || 'general';
```

**drift:**
- storefront ProductCard.tsx 沒接 tier prop、沒走 design ProductCard.jsx L134 `<window.Price>` 元件路徑
- 刀 d1 直接搬 design 字面時、可能因為 design 端 `window.Price` 屬於 prototype 全域、ts 端不能用同模式、所以 ProductCard.tsx 改用 MockProduct.price 直接顯示
- 刀 4 落地需配合公式 dispatch、決定要不要把 tier prop / Price 元件加回 ProductCard.tsx

### 4.4 連動改的檔清單(純事實、不預判候選)

| 檔 | 改動原因 |
|---|---|
| `apps/storefront/src/lib/products.ts` | toUIProduct 公式 dispatch / fetchFeaturedProducts tier 動態取 / MockProduct shape 處置 |
| `apps/storefront/src/app/page.tsx` | tier 路徑取得(session / cookie / context)、傳入 fetchFeaturedProducts |
| `apps/storefront/src/components/HomeSelect.tsx` | 可能需接 tier prop(若 ProductCard 改接 tier)|
| `apps/storefront/src/components/ProductCard.tsx` | 可能需接 tier prop + 切換顯示邏輯(候選 A/B/C 決定) |
| `apps/storefront/src/components/Price.tsx`(新建)| 候選 B 才新建 |
| `apps/storefront/src/components/LinePrice.tsx`(新建)| 候選 B 才新建(若 cart 流程 Phase 1 啟動) |
| `packages/adapters/src/supabase/mappers/product.ts` | premiumStore placeholder 移除 / wire type narrow 為二 key(配合 toUIProduct dispatch) |
| `packages/adapters/src/supabase/mappers/product.ts`(L67-68 const) | 刀 3 加的 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4` const 刪除 |
| design 端 ProductPage.jsx L529 + AccountPages.jsx L120 | **不改**(design submodule、由 Claude Design 改 / 或刀 4 storefront 對應 ProductPage / Cart 元件落地時對應改)|

---

## Meta

### M.1 grep 指令清單(供 Claude.ai 驗證偵察完整度)

```bash
# 目標 1: design Pricing.jsx 完整 + exports + CSS
wc -l design-reference/components/Pricing.jsx
sed -n '66,200p' design-reference/components/Pricing.jsx
grep -n "^function|^const.*=|Object.assign.*window" design-reference/components/Pricing.jsx
grep -rn "price-tag-dealer|pd-price-tag-dealer|pd-mbb-orig|cart-item-price-unit|.price-wrap|.price-main" design-reference/styles/

# 目標 2: storefront 既有路徑
cat apps/storefront/src/lib/products.ts
cat apps/storefront/src/app/page.tsx
cat apps/storefront/src/components/HomeSelect.tsx
grep -rn "MemberTier|memberTier|tier=|tier:" apps/storefront/src/
grep -rn "designTierToSchema|schemaTierToDesign" apps/
find apps/storefront/src/components -name "*.tsx" -type f

# 目標 3: 「· 經銷」上下文 + Price 元件用法
sed -n '510,545p' design-reference/components/ProductPage.jsx
sed -n '105,135p' design-reference/components/AccountPages.jsx
grep -rn "<Price\b|<LinePrice\b|from.*Pricing" design-reference/components/
grep -rn "getPriceForTier|getEffectivePrice|getBrandFor" design-reference/components/

# 目標 4: storefront tier 顯示元件 + design 對應
cat apps/storefront/src/components/ProductCard.tsx
grep -n "tier|memberTier|search|Search|price" apps/storefront/src/components/Header.tsx
wc -l design-reference/components/ProductCard.jsx
head -80 design-reference/components/ProductCard.jsx
grep -rln "priceByTier" design-reference/components/
grep -rln "getPriceForTier|window.getPriceForTier|window.Price" design-reference/components/
```

### M.2 字面對齊矩陣

#### 目標 1 (Pricing.jsx 5 個 function + 公式)

| 來源 | 字面 | 對齊狀態 |
|---|---|---|
| Pricing.jsx L27-42 公式 | dispatch 3 分支 + legacy fallback | ✅ design 端落地完整 |
| Pricing.jsx L66 + L102 memberLabel | `'P價' / '店價'` 重複硬編碼 | ⏳ 兩處字面、刀 4 落地候選抽 const |
| Pricing.jsx L114 export | `Object.assign(window)` prototype 路徑 | ❌ storefront 落地不可用、需重設計 |
| pricing.css 60 行 + product-page.css L761 + account.css L150 | CSS class 對應 | ✅ design 端完整、storefront 落地需引入 CSS file |

#### 目標 2 (storefront 既有路徑)

| 層 | 落地狀態 | 對齊狀態 |
|---|---|---|
| toUIProduct 簽名 | `(product: Product, tier: MemberTier)` 已含 tier | ✅ |
| toUIProduct L72 | `product.priceByTier[tier].amount` 直接取、未走公式 | ❌ 公式 dispatch 未落地 |
| fetchFeaturedProducts L115 | tier hardcoded 'general' | ⏳ 動態 tier 取得未落地 |
| page.tsx | 無 tier 路徑 | ⏳ 需引入(session / cookie / context) |
| HomeSelect.tsx + ProductCard.tsx | 無 tier prop | ⏳ 視候選 A/B/C 決定 |
| utils import | 0 命中(designTierToSchema / schemaTierToDesign) | ⏳ 刀 4 整合點 |

#### 目標 3 (「· 經銷」硬編碼)

| 命中 | 檔 + 行 | 處置基準 |
|---|---|---|
| #1 | ProductPage.jsx L529 | HANDOFF-v2.1 §5.5「Phase 3 或落地時統一改 `<Price>` 元件」 |
| #2 | AccountPages.jsx L120 | 同上 |

→ design 端 design submodule 本刀不改、storefront 對應 ProductPage / Cart 元件 Phase 1 尚未落地(目前僅 HomePage 8 sections)、刀 4 落地若引入 cart / ProductPage、需配合決定字面源

#### 目標 4 (storefront tier 顯示元件)

| 元件 | tier 字面命中 | 對齊狀態 |
|---|---|---|
| lib/products.ts | 2 處(L38 + L61) | ✅ 唯一取用點 |
| ProductCard.tsx | 0 | ⏳ 與 design ProductCard.jsx L74 drift |
| HomeSelect.tsx | 0 | ⏳ 視 ProductCard 是否接 tier |
| 其他 8 元件 | 0 | ✅(無 tier 需求)|

### M.3 風險揭示(Claude.ai 寫 PRD 可能誤判點)

#### 風險 #1:design 端 `Object.assign(window)` 模式不可直接搬

- Pricing.jsx L114 用 `Object.assign(window, { getBrandFor, getPriceForTier, ... })` prototype 全域 export
- storefront ts 環境不可用 window 全域(server-side 無 window、client 也應避免污染 global)
- design 端 ProductCard.jsx L134 `<window.Price>` / ProductPage.jsx L291 `window.getPriceForTier` 字面直搬會 throw `window is undefined`(server-side render)
- Claude.ai 寫 PRD 字面若直接照搬 design 字面、會踩此地雷
- 證據:Pricing.jsx L114 + ProductCard.jsx L134 + ProductPage.jsx L291 / L527

#### 風險 #2:design Pricing.jsx 期待 `product.priceByTier.general/store` 是 number、storefront 是 Money 物件

- design L27-42 `getPriceForTier` 取 `pbt.general / pbt.store` 直接當 number(L40 `Math.round(base * (1 - extra / 100))`)
- storefront domain Product.priceByTier 是 `Record<MemberTier, Money>`、Money 是 `{ amount: MoneyAmount; currency: Currency }`
- Claude.ai 寫 PRD 公式時若直接搬 design 字面、會把 Money 物件當 number 算數、type 不過或 NaN
- storefront 落地需先把 Money.amount 抽出再算、或改公式接 Money 物件
- 證據:Pricing.jsx L40 + packages/domain/src/catalog/types.ts L102 + shared/types.ts L31

#### 風險 #3:storefront ProductCard.tsx 完全沒接 tier、改動 ripple 可能擴張

- ProductCard.tsx L107 不接 tier、L156-170 直接 `p.price.toLocaleString()` 顯示(無 tier 切換)
- 若公式落地要 tier-aware 顯示(P價 / 店價 / 劃線)、必須加 tier prop、ripple 到 HomeSelect.tsx(prop drilling)+ page.tsx(取 tier)
- 候選 A 維持 ProductCard 不接 tier(toUIProduct 內 tier dispatch)、UI shape 帶 originalPrice / tierLabel — 影響面最小
- 候選 B 拆 `<Price>` 元件 — 影響面最大、shape drift 大
- Claude.ai 寫 PRD 若選 B、需配套處理 MockProduct shape 改造 + d2 真資料接入點重做
- 證據:apps/storefront/src/components/ProductCard.tsx L107-170 + design/components/ProductCard.jsx L74 + L134

#### 補充風險 #4:刀 3 placeholder const 刀 4 需移除

- 刀 3 落地 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4 = 0`(mappers/product.ts L67-68)
- 刀 4 公式 dispatch 落地後、premiumStore placeholder 不再用、const 必移除(對齊 const 名稱 lifecycle marker)
- backlog #123 zeroMoney helper 候選同步重評(若 placeholder Money 自然消失、條目可關)
- Claude.ai 寫 PRD 需明示「刀 4 完成 placeholder const 移除 + #123 條目重評」步驟

#### 補充風險 #5:mapper wire type narrow 為二 key 連動

- 刀 3 揭示「wire type SupabaseProductRow.price_by_tier 仍 Record<MemberTier, ...> 三 key 期待、與實況二 key drift、留刀 4 連動修」
- 刀 4 storefront 公式 dispatch 落地後、premiumStore 不從 wire 取、可 narrow wire type 為 `Record<'general' | 'store', { amount: number; currency: Currency }>`
- 但若 narrow、mapper L113 `row.price_by_tier.store.currency` 不變、TypeScript type 收緊不影響 runtime
- Claude.ai 寫 PRD 需考慮 type narrow 是否同 commit / 分 commit

---

— END —
