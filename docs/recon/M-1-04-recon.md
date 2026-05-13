# M-1-04-recon — storefront wire-up 偵察報告

> **角色:** M-1-04 拆刀前的全景偵察、純讀零實作、字面照搬不解讀
> **不寫:** 拆刀推薦 / 估時 / 三視角分析(留 Sean 看完 + Claude.ai 後續寫拆刀分析)

## 1. 範圍

- backlog #116 next/link refactor(純展示 sections server + Link 化)
- backlog #87 in-memory dev singleton lifecycle(Map.clear + HMR)
- storefront wire-up 全景(onNav stub → 真路由、server-client boundary、cross-layer 串接)

**偵察日期:** 2026-05-13
**偵察人:** Claude Code(M-1-04-recon slice)
**repo HEAD:** `bf9bbfd`(branch dev、ahead origin/dev = 0)
**design-reference HEAD:** `25d3a2a`(submodule pointer、git log -1 確認字面 `25d3a2a feat(v2.0 + v2.1): 6 頁補設計 + 三 tier 完整 + 廠牌加碼公式 + brand-logos 架構重組`)

---

## 2. Backlog 真權威字面

### 2.1 #116(原文照貼)

```
### #116. ⏳ server-client boundary 優化:純展示 sections 改用 next/link

- **狀態:** ⏳ 待 trigger
- **優先級:** 🟡 中(Phase 1 Polish)
- **問題:**
  - main-d-d1 階段 design 真權威字面**全 8 sections 都含 onNav callback prop**(L25 HomeHero / L131 FeatureEditorial / L174 CategoryGrid / L210 HomeSelect / L245 HomeStatement / L277 BrandIndex / L311+ HomeFooter)
  - Next.js 16 RSC 規矩**不可從 server component 傳 function prop 給 client component**(server-client boundary 字面限制)
  - 本 slice 維持全 'use client'(對齊 d1 指令 Step 4.1「className / onClick / onNav 字面維持」精神 + lessons §1.1「直接搬」)
  - hydration 成本:8 sections + Header + ProductCard 都 client、Phase 1 ~200 SKU 規模可接受、未來規模擴張可能撞 first-load JS budget
- **觸發事件:**
  - 2026-05-08 / M-1-03-main-d-d1 commit body 註記 8 揭示偏離 + Sean Q2=B1+B3 拍板留 backlog
- **預期解法(M-1-04 trigger 順手評估):**
  - **候選分流:** 純展示 sections(無 onClick / 無 useState 互動)→ 改 server component + `<Link href>` 取代 onNav callback
    - HomeHero / FeatureEditorial / HomeStatement / HomeFooter / CategoryGrid / BrandIndex(純展示、僅 onNav)→ 改 Link
    - VehicleFinder / Header / ProductCard(含互動 useState / window dispatchEvent / hover state)→ 維持 'use client'
  - 配 `Link.prefetch`、降首頁 hydration 成本 + 提升路由切換速度
  - 拆「server with Link」vs「client with onNav」雙路徑、需 boundary 文件化(可能加 ADR-0006 / docs/architecture/server-client-boundary.md)
- **不修會痛在(三視角):**
  - 擴充性:M-1-04+ 接 next/navigation router 後 onNav callback → router.push、保留全 client 浪費 RSC 機會、規模擴張後 first-load JS 上升
  - 可維護性:全 client 簡單一致、改混合模式增加 boundary 認知負擔、需文件化 + e2e 驗 hydration mismatch
  - bug 可追蹤性:hydration mismatch 風險、改 Link 後需配 e2e test 驗 router 行為
- **估時:** M-1-04 接 next/navigation router 時順手評估、實際遷移 30-60 min(6 sections × ~5-10 min + 配 Link.prefetch + e2e 驗)
- **依賴:** M-1-04 接 next/navigation 真 router(目前 onNav 是 console.log stub)
- **發現於:** 2026-05-08 / M-1-03-main-d-d1(commit body 註記 8、Sean Q2=B1+B3 拍板)
- **相關:** `apps/storefront/src/components/{HomeHero,FeatureEditorial,HomeStatement,HomeFooter,CategoryGrid,BrandIndex}.tsx`(候選改 Link)、`{VehicleFinder,Header,ProductCard}.tsx`(維持 client)、d1 指令 Step 4.1 字面維持精神 + lessons §1.1 直接搬精神 + Next.js 16 RSC server-client boundary
```

### 2.2 #87(原文照貼)

```
### #87. ⏳ in-memory adapter dev singleton lifecycle(Map.clear / HMR / dev wire-up)

- **狀態:** ⏳ 待執行
- **優先級:** 🟢 觀察(test scope 內 test isolated 無問題、dev singleton wire-up 才浮現)
- **問題:**
  - InMemoryProductRepository.ts 的 Map 無 `clear()` method、無 dev singleton lifecycle 規範
  - 對 vitest test scope 不是問題(每個 describe `new InMemoryProductRepository()`、test 完 GC)
  - 但 class doc 字面寫「dev 期 spike:M-1-02 商品瀏覽流程不接 Medusa 也能 round-trip」
  - 若 dev server 把 InMemoryProductRepository 當 singleton inject、HMR / 多 request 跨 process boundary 就會累積
- **觸發事件:**
  - 2026-05-04 / M-1-02-audit efficiency E4
- **預期解法:**
  - storefront wire-up slice(M-1-02 後續 / M-1-13 / 視 storefront 第一個用 InMemoryProductRepository 的 slice)啟動前:
    - 加 `clear(): void` method 到 InMemoryProductRepository(`this.products.clear()`)
    - 加 dev singleton lifecycle 規範文件(HMR 觸發 reset / multi-request 同 instance 處置)
    - 對齊 testing-strategy.md §3.3 補「in-memory adapter dev wire-up 紀律」段
- **不修會痛在:**
  - 擴充性:Phase 2 多 adapter 進 dev wire-up、無一致 lifecycle 規範、各 adapter 自由心證
  - 可維護性:HMR 跨 reload 累積資料、dev 期看不出 bug、上線後 (Medusa 真實 adapter) 才發現邏輯靠 stale state
  - bug 可追蹤性:本條目為錨點、storefront wire-up 撞時 grep 找
- **估時:** storefront wire-up slice 加 15-20 min(clear method + 規範 1 段)
- **依賴:** storefront 第一次用 InMemoryProductRepository wire-up(對齊 dev spike 假設)
- **發現於:** 2026-05-04 / M-1-02-audit efficiency E4
- **相關:** `packages/adapters/src/in-memory/InMemoryProductRepository.ts`、`docs/architecture/testing-strategy.md` §3.3 / §3.4
```

---

## 3. Storefront 現況

### 3.1 Component 清單(11 個 .tsx)

| Component | 'use client'? | 互動 hit 數 | 推測類別 |
|---|---|---|---|
| BrandIndex.tsx | ✅ (L5) | 3 | 純展示 + onNav(無 useState) |
| CategoryGrid.tsx | ✅ (L3) | 2 | 純展示 + onNav(無 useState) |
| FeatureEditorial.tsx | ✅ (L3) | 1 | 純展示 + onNav(無 useState) |
| Header.tsx | ✅ (L10) | 18 | 含互動(useState / useEffect / dispatchEvent) |
| HomeFooter.tsx | ✅ (L3) | 7 | 純展示 + onNav(無 useState、僅多 onNav 連結) |
| HomeHero.tsx | ✅ (L2) | 1 | 純展示 + onNav(無 useState) |
| HomeSelect.tsx | ✅ (L8 註解 + 字面 use client) | 4 | 半互動(傳 onClick 給 ProductCard、收 featured props) |
| HomeStatement.tsx | ✅ (L3) | 2 | 純展示 + onNav(無 useState) |
| Price.tsx | ❌ (無 use client) | 0 | 純展示 server-compatible(M-1-03 main-a 刀 4 sub 6 落地) |
| ProductCard.tsx | ✅ (L10) | 11 | 含互動(useState hover / liked、onClick) |
| VehicleFinder.tsx | ✅ (L7) | 8 | 含互動(useState sel、3 select onChange) |

**互動 hit grep pattern:** `onClick\|useState\|useEffect\|onChange\|onSubmit\|dispatchEvent\|window.`

**onNav 現況字面(grep `onNav\|console.log`):**
- BrandIndex / CategoryGrid / FeatureEditorial / HomeHero / HomeStatement / HomeSelect / VehicleFinder 皆有 `const onNav = useCallback((target: string, ctx?: object) => { console.log('[onNav]', target, ctx); ... `
- Header.tsx L20 `onNav?: (target: string, ctx?: object) => void` props + L30 onNavLocal 內走 onNav(若 caller 傳)否則 console.log fallback
- 所有 onNav stub 註解皆寫「d1 階段 stub、M-1-04 加 next/navigation router 後改 router.push」

**重要:** 全 11 component 目前 `next/link` 與 `next/navigation` 皆 **0 命中**(grep 確認)

### 3.2 page.tsx async server component 結構

完整字面節錄(/Users/sean_1/pcm-website-v2/apps/storefront/src/app/page.tsx):

```typescript
// L7-L10 註記:
// page.tsx 本身為 server component(無 'use client'、不傳 callback prop);8 sections + Header + ProductCard
// 各自 'use client'(因 design 字面全含 onClick callback、Next.js server component 不可傳 function)。
// 此偏離 d1 指令 Step 4.2 字面「HomeHero / FeatureEditorial / HomeStatement / HomeFooter Server Component」
// 是 design 字面 vs Next.js 16 server-client boundary 衝突的 trade-off、commit body 揭示。

// L35
export const dynamic = 'force-dynamic';

// L37-L77 主結構:
export default async function HomePage({
  searchParams,
}: { searchParams: Promise<...> }) {
  const params = await searchParams;
  const cookieStore = await cookies();
  // tier resolution: ?tier= override (PCM_DEV_TIER_OVERRIDE=1) → cookie pcm-tier → 'general'
  const featured = await fetchFeaturedProducts(tier);

  return (
    <div data-screen-label="Home" data-tier={tier} className="ed-page">
      <Header cartCount={4} currentPage="home" />
      <HomeHero />
      <VehicleFinder />
      <FeatureEditorial />
      <CategoryGrid />
      <HomeSelect featured={featured} />
      <HomeStatement />
      <BrandIndex />
      <HomeFooter />
    </div>
  );
}
```

**重點:** page.tsx 沒傳 onNav 給任何 section、各 section 自管 local onNav stub(console.log)。

### 3.3 lib/products.ts fetcher + mapper + strip 結構

完整字面節錄(/Users/sean_1/pcm-website-v2/apps/storefront/src/lib/products.ts):

```typescript
// L22-L26 server-only 紀律(註解):
//   - 本檔含 createSupabaseAnonClient + adapter 構造、絕不該進 client bundle
//   - 不裝 'server-only' npm package(範圍紀律不擴張 deps、對齊 Sean d2 例外條款只覆蓋
//     @pcm/adapters + @pcm/domain)、用 module load 時 runtime window guard 替代
//   - 未來 storefront 規模擴張可考慮加 'server-only' package(對齊 Next.js 13+ 推薦)

// L28-L32 runtime guard:
if (typeof window !== 'undefined') {
  throw new Error(
    '@/lib/products is server-only — must not be imported from client component bundle',
  );
}

// L34-L37 imports:
import { SupabaseProductAdapter, createSupabaseAnonClient } from '@pcm/adapters';
import { computeEffectivePrice } from '@pcm/domain';
import type { CategoryPath, MemberTier, Product } from '@pcm/domain';

// L69-L73 hashIdToNumber helper (M-1-03 slice-C NaN 源頭修):
function hashIdToNumber(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// L75-L105 toUIProduct: domain Product + tier → MockProduct
// - priceByTier server-side strip(取 effectivePrice、tier-only column)
// - originalPrice = (tier === 'general') ? null : computeEffectivePrice(p, 'general').amount
// - tierLabel = 'P價' | '店價' | null

// L132-L152 fetchFeaturedProducts:
//   - createSupabaseAnonClient + new SupabaseProductAdapter
//   - listByCategory({raw:'操控部品', segments:['操控部品']})
//   - slice(0, 4).map(toUIProduct)
//   - try/catch → error flag
```

**重點:** lib/products.ts 直接 wire `new SupabaseProductAdapter(client)`、**不經 InMemoryProductRepository**。

---

## 4. Design-reference 真權威

### 4.1 design HEAD

`25d3a2a feat(v2.0 + v2.1): 6 頁補設計 + 三 tier 完整 + 廠牌加碼公式 + brand-logos 架構重組`

(對齊 STATUS L12 字面 `design @ 25d3a2a 升`)

### 4.2 onNav 字面命中(HomePage.jsx)

grep `onNav` /design-reference/components/HomePage.jsx 命中 24 條(摘錄關鍵):

| 行號 | 字面 |
|---|---|
| 5 | `function HomeHero({ onNav }) {` |
| 25 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('new'); }} className="ed-link">` |
| 45 | `function VehicleFinder({ onNav }) {` |
| 88 | `onClick={() => onNav('products', { vehicle: { brand: sel.brand, model: sel.model, year: sel.year } })}>` |
| 99 | `function FeatureEditorial({ onNav }) {` |
| 131 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('brand-detail', { brandId: 'rizoma' }); }} ...>` |
| 149 | `function CategoryGrid({ onNav }) {` |
| 167 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('catalog'); }} ...>` |
| 175 | `onClick={(e) => { e.preventDefault(); onNav('products', { category: c.id }); }}>` |
| 194 | `function HomeSelect({ tweaks, onNav }) {` |
| 210 | `<ProductCard ... onClick={() => onNav('product', { productId: p.id, source: 'home', sourceLabel: '首頁' })} />` |
| 218 | `function HomeStatement({ onNav }) {` |
| 245 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('install'); }} ...>` |
| 249 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('stores'); }} ...>` |
| 260 | `function BrandIndex({ onNav }) {` |
| 269 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('brands'); }} ...>` |
| 277 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('brand-detail', { brandId: b.id }); }}>` |
| 292 | `function HomeFooter({ onNav }) {` |
| 311 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('catalog'); }}>商品目錄</a>` |
| 312 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('brands'); }}>品牌專區</a>` |
| 313 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('new'); }}>新品上架</a>` |
| 314 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('sale'); }}>特價專區</a>` |
| 318 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('install'); }}>安裝預約</a>` |
| 319 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('stores'); }}>合作店家</a>` |
| 320 | `<a href="#" onClick={(e) => { e.preventDefault(); onNav('shipping'); }}>配送 & 退貨</a>` |

**onNav target 字面合集(全 design 出現過):**
`'new'` / `'products'` / `'brand-detail'` / `'catalog'` / `'product'` / `'install'` / `'stores'` / `'brands'` / `'sale'` / `'shipping'`

Header.jsx onNav 命中(grep):

| 行號 | 字面 |
|---|---|
| 3 | `function Header({ cartCount = 4, onMenuClick, isMobile: isMobileProp, currentPage = 'products', onNav = () => {} }) {` |
| 36 | `const handleNav = (e, id) => { e.preventDefault(); onNav(id); };` |

ProductCard.jsx onNav 命中(grep):**0 命中**(ProductCard 字面用 `onClick` prop 接、不直接收 onNav)。

### 4.3 互動字面命中

HomePage.jsx 互動 grep(`useState\|useEffect\|onClick\|onChange`):
- L34 `const [failedIdx, setFailedIdx] = React.useState({});`(ProductImage 內部 state)
- L47 `const [sel, setSel] = React.useState({ brand: '', model: '', year: '' });`(VehicleFinder 內 state)
- L66 / L73 / L80 三個 `select onChange`(VehicleFinder)
- L88 button onClick(VehicleFinder 跳轉)
- 多個 a href onClick(各 section 的 onNav 包裝、見 §4.2 表)

Header.jsx 互動 grep(`useState\|useEffect\|dispatchEvent`):
- L4 `const [searchQuery, setSearchQuery] = React.useState('');`
- L6 `window.dispatchEvent(new CustomEvent('pcm-open-search', { detail: { query: q } }));`
- L8 `const [autoMobile, setAutoMobile] = React.useState(() => { ... });`
- L14 `React.useEffect(() => { ... });`

ProductCard.jsx 互動 grep(`useState\|useEffect\|onClick`):
- L34 `const [failedIdx, setFailedIdx] = React.useState({});`
- L70 `const [hover, setHover] = React.useState(false);`
- L71 `const [liked, setLiked] = React.useState(false);`
- L95 `onClick={onClick}`(根 div、收外傳 onClick prop)
- L108 `onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}`(愛心按鈕)
- L122 `<button className="pcard-quick-btn" onClick={(e) => e.stopPropagation()}>`

### 4.4 父組件如何傳 onNav(HomePage.jsx L340-L354 字面照貼)

```javascript
function HomePage({ tweaks, onNav = () => {} }) {
  return (
    <div data-screen-label="Home" className="ed-page">
      <Header cartCount={4} currentPage="home" onNav={onNav} />
      <HomeHero onNav={onNav} />
      <VehicleFinder onNav={onNav} />
      <FeatureEditorial onNav={onNav} />
      <CategoryGrid onNav={onNav} />
      <HomeSelect tweaks={tweaks} onNav={onNav} />
      <HomeStatement onNav={onNav} />
      <BrandIndex onNav={onNav} />
      <HomeFooter onNav={onNav} />
    </div>
  );
}

window.HomePage = HomePage;
```

**design 字面:** HomePage 父組件**統一接 onNav callback**,**全 9 個子組件**(Header + 8 sections)**皆收 onNav prop**。

---

## 5. InMemoryProductRepository 現況

### 5.1 完整字面結構

檔案:`packages/adapters/src/in-memory/InMemoryProductRepository.ts`(123 行)

關鍵字面節錄:

```typescript
// L12-L23 JSDoc 真權威字面:
/**
 * 真實作 in-memory ProductRepository。
 *
 * 用途:
 * - use-case test:不接 Medusa 也能跑 placeOrder / etc 的單元測試
 * - dev 期 spike:M-1-02 商品瀏覽流程不接 Medusa 也能 round-trip
 *
 * 對齊 ADR-0002 §4.1(in-memory 是真實作、非 mock)+ docs/architecture/testing-strategy.md §3.3
 */

// L24-L31 class 結構:
export class InMemoryProductRepository implements IProductRepository {
  private products: Map<ProductId, Product> = new Map();

  constructor(seed: Product[] = []) {
    for (const p of seed) {
      this.products.set(p.id, p);
    }
  }

// L33-L86 方法:findById / save / listByCategory / listByBrand / listByFitment / searchByKeyword
// L108-L122 private matchFitment(actual, spec)
```

**關鍵字 grep(`Map\|clear\|singleton\|HMR`):**
- L25 `private products: Map<ProductId, Product> = new Map();`(Map 宣告)
- **0 命中:** `clear` / `singleton` / `HMR` 字面皆不存在

### 5.2 dev wire-up 現況

grep `InMemoryProductRepository\|new InMemory` 結果(全 repo):

| 檔案 | 用途 |
|---|---|
| packages/adapters/src/in-memory/InMemoryProductRepository.ts | class 定義 |
| packages/adapters/src/in-memory/InMemoryProductRepository.test.ts | test 內 `new InMemoryProductRepository()` x 多次 |
| packages/adapters/src/supabase/SupabaseProductAdapter.ts | 註解引用(對齊行為) |
| packages/adapters/src/supabase/helpers/fitment.ts | 註解引用(對齊行為) |
| packages/ports/src/IProductRepository.ts | JSDoc 提及 |
| packages/ports/src/IProductRepository.contract.ts | 註解提及 |
| packages/domain/src/catalog/pricing.test.ts | 註解提及 createFakeProduct 慣例 |
| packages/domain/src/catalog/year-range.ts | 註解提及 |

**事實:** apps/storefront/* **零命中**。storefront 目前透過 `lib/products.ts` 直接 wire `new SupabaseProductAdapter(client)`、**未使用 InMemoryProductRepository**。

### 5.3 testing-strategy.md §3.3 / §3.4 規範字面

§3.3(L82-L92):

```
### 3.3 InMemory adapter 不算 mock

InMemoryProductRepository 是**真實作**(對齊 ADR-0002 §4.1)、不算 mock:

// ✅ 正確:use-case test 用 InMemory adapter
const repo = new InMemoryProductRepository([fakeProduct1, fakeProduct2]);
const result = await placeOrder(input, { productRepo: repo });

理由:InMemory adapter 跟 Medusa adapter 共用同一個 `IProductRepository` 介面、test 過 = 介面合約過、不需 mock。
```

§3.4(L94-L107):

```
### 3.4 in-memory 樣板不搬到真實 adapter(M-1-02-audit Q2/E2/E5 規範類落地)

InMemory adapter 內部慣用 `Array.from(this.products.values()).filter(predicate)` 樣板(O(n) 記憶體 filter)、合理對 in-memory + test scope。

**禁止把此樣板搬到 Medusa / Supabase 等真實 adapter:** ...

理由:in-memory + test scope 用 O(n) 樣板無問題;但 production adapter 必走 wire-level filter(SDK / SQL / 索引),否則效能災難 + 違反 ADR 拍板路徑。

教訓來源:M-1-02-audit simplify 視角抓出 4 個 list method 樣板若 leak 進 MedusaProductAdapter 必踩 anti-pattern;規範化防 M-1-03 開發者照 InMemory 樣板抄。
```

**§3.3 / §3.4 兩節皆無 dev wire-up / HMR / Map.clear / singleton lifecycle 字面**,#87 預期解法第三點「對齊 testing-strategy.md §3.3 補『in-memory adapter dev wire-up 紀律』段」目前未落地。

---

## 6. 跨層串接檢查

### 6.1 ports / domain / use-cases 是否需動

**ports:** `packages/ports/src/IProductRepository.ts` 完整介面字面確認(節錄):

```typescript
export interface IProductRepository {
  findById(id: ProductId): Promise<Product | null>;
  listByCategory(category: CategoryPath): Promise<Product[]>;
  listByBrand(brandId: string): Promise<Product[]>;
  listByFitment(spec: FitmentSpec): Promise<Product[]>;
  searchByKeyword(query: string, params: PaginationParams): Promise<Paginated<Product>>;
  save(product: Product): Promise<Product>;
}
```

`clear()` method **不在 contract 字面**。#87 預期加 clear 是 InMemoryProductRepository 實作特有(不擴 port contract、合 hexagonal 邊界)、grep `clear()` 全 repo 0 命中確認。

**domain:** `packages/domain/src/` 子目錄字面:`catalog` / `identity` / `index.ts` / `order` / `payment` / `shared` / `sync`。
M-1-04 範圍(#116 + #87)**不動 domain entity 字面**(Product / CategoryPath / FitmentSpec 等);hashIdToNumber 已落地 lib/products.ts(slice-C NaN 修)。

**use-cases:** `packages/use-cases/src/index.ts` 完整字面:

```typescript
// @pcm/use-cases — business logic 編排、跨 domain context 流程, 殼、M-1 期間隨 entity 演進、第一個 use-case 落地時填
export {};
```

**目前 use-cases 仍是空殼**、M-1-04 範圍不需動。

### 6.2 Next.js 16 RSC server-client boundary 字面驗證

Next.js 版本:`16.2.6`(apps/storefront/package.json L17 字面 `"next": "16.2.6"`)

React 版本:`19.2.6`(apps/storefront/package.json L18 字面 `"react": "19.2.6"`)

server-client boundary 規矩字面權威:
- 本 repo 內無 ADR / docs 字面記載「不可從 server component 傳 function prop 給 client component」原文(僅 #116 / page.tsx 註解 / commit body 提及)
- Next.js 官方文件(13+ App Router)規矩同步:Server Component 不可傳 function prop 給 Client Component(function 不 serializable)
- page.tsx L7-L10 註解字面確認此規矩

### 6.3 Next.js 版本 / next.config 現況

`apps/storefront/next.config.ts` 完整字面:

```typescript
import type { NextConfig } from 'next';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {};

export default withBundleAnalyzer(nextConfig);
```

**重點:**
- `nextConfig = {}` 空、無 Link.prefetch / experimental.* / serverActions 等配置
- bundleAnalyzer wrap(ANALYZE env 觸發)
- M-1-04 若需配 prefetch(預設行為 + opt-out)、改 component-level `<Link prefetch={...}>` 即可、無需動 next.config

---

## 7. 拆刀候選(待 Sean 拍板、不寫推薦 / 估時 / 三視角)

- **候選刀 1:** #87 InMemoryProductRepository.clear() + 規範文件
  - 範圍:`packages/adapters/src/in-memory/InMemoryProductRepository.ts` 加 `clear(): void` method、`docs/architecture/testing-strategy.md` §3.3 / §3.4 補 dev wire-up 段(或開新節 §3.5)
  - 觸發必要性:storefront 目前**未使用** InMemoryProductRepository(走 SupabaseProductAdapter)、#87 預期解法依賴條件「storefront 第一次用 InMemoryProductRepository wire-up」**尚未發生**(見 §9 字面 vs 事實揭示)

- **候選刀 2:** #116 純展示 sections server + Link 化
  - 候選 sections(對齊 §3.1 表「純展示 + onNav」分類):
    - **強候選(僅 onNav、無 useState):** HomeHero / FeatureEditorial / CategoryGrid / HomeStatement / BrandIndex / HomeFooter(6 sections)
    - **不可改 server:** Header(useState searchQuery / autoMobile + useEffect + window.dispatchEvent)、VehicleFinder(useState sel + 3 select onChange)、ProductCard(useState hover / liked)、HomeSelect(收 featured props + 傳 onClick 給 ProductCard、半互動)
  - 範圍:6 個 .tsx 拿掉 'use client' + onNav stub 移除 + a href onClick 改 `<Link href>`

- **候選刀 3:** 互動 sections 維持 'use client' + onNav → next/navigation router.push 接
  - 候選 components:Header / VehicleFinder / ProductCard / HomeSelect 4 個 client component
  - 範圍:onNav stub 改 `const router = useRouter(); router.push(...)` + onNav target 字面對應 route 表(`'new'` / `'products'` / `'product'` / `'brand-detail'` / `'catalog'` / `'install'` / `'stores'` / `'brands'` / `'sale'` / `'shipping'`)
  - 配套:需 PRD 拍板「target → route path 對映表」(目前 design 字面僅 onNav target、未定 route convention)

- **候選刀 4:** 配套 `docs/architecture/server-client-boundary.md` 規範(若需)
  - 內容:何時拆 server vs client、function prop 不可傳邊界、Link vs router.push 選擇樹、e2e 驗 hydration 紀律
  - 可能加 ADR-0006(對齊 #116 預期解法字面「可能加 ADR-0006」)

- **候選刀 5(本 recon 偵察期間發現):** apps/storefront 9 個 onNav stub 整理
  - 現況:9 個 component 各自定義 `const onNav = useCallback(...)` console.log stub、樣板化但散落
  - 候選作法:抽 `lib/nav.ts` 集中 onNav target → route 對映 + 共用 `useNav()` hook、或改後直接 inline `<Link href>` / `router.push` 不再需要 stub
  - 待 Sean 拍板拆刀策略時決定

---

## 8. 風險 anchor(偵察期間發現但本 slice 不處置)

### 8.1 InMemoryProductRepository dev wire-up 假設條件未到

- backlog #87 預期解法「storefront wire-up slice(M-1-02 後續 / M-1-13 / **視 storefront 第一個用 InMemoryProductRepository 的 slice**)啟動前」
- 事實:M-1-03-main-d-d2 已落地 SupabaseProductAdapter 直接 wire-up、未走 InMemoryProductRepository
- M-1-04 是否仍按 #87 預期解法時機處理?或 #87 順延到「真有 dev wire-up 走 InMemoryProductRepository 的 slice」再處理?待 Sean 拍板

### 8.2 onNav target → route convention 未定

- design 字面 onNav target 集合:`'new'` / `'products'` / `'brand-detail'` / `'catalog'` / `'product'` / `'install'` / `'stores'` / `'brands'` / `'sale'` / `'shipping'`
- target 到 Next.js route path 對映**尚未拍板**(目前 stub console.log)
- M-1-04 改 router.push 或 `<Link href>` 必先有對映表

### 8.3 server-only npm package 已裝、但 lib/products.ts 註解寫「不裝」

- 見 §9 揭示

### 8.4 HomeSelect 的 'use client' 字面位置(已確認、非風險)

- HomeSelect.tsx L8 為註解「`'use client' 因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client`」
- L9 為實際 directive `'use client';`
- L1-L8 全 `//` 註解、Next.js parser 容許註解後 directive(directive 需在 import 前、不需在檔案絕對首行)
- **判定:無 runtime 風險、僅本 recon 初次 head -1 grep 漏命中、後補 Read L1-L15 已確認**

### 8.5 docs/recon/M-1-03-audit-disposition-slice-C-recon.md 持續 untracked

- 前 slice 收尾遺留檔(M-1-03 slice-C 偵察報告)
- 本 slice 不處置(維持 untracked、留 Sean 後續拍板或自然 commit 進來)

---

## 9. 字面 vs 事實揭示

### 9.1 server-only npm package 已裝、註解寫「不裝」(drift)

- **註解字面:** `apps/storefront/src/lib/products.ts` L24-L26 寫「**不裝** 'server-only' npm package(範圍紀律不擴張 deps...)」
- **事實:** `apps/storefront/package.json` L20 已有 `"server-only": "^0.0.1"` 依賴(`packages/adapters/package.json` L26 同樣已裝)
- **影響:** lib/products.ts 仍走 runtime `if (typeof window !== 'undefined') throw` guard、未 import 'server-only'
- **判定:** 註解字面 stale、應更新或加 `import 'server-only';` directive、或評估改走 server-only package import

### 9.2 design @ d5ea3aa 字面 vs submodule @ 25d3a2a 事實(stale 註解 / 歷史 anchor)

- **submodule 事實 HEAD:** `25d3a2a`(對齊 STATUS L12 `design @ 25d3a2a 升`)
- **stale 字面命中位置:**
  - `apps/storefront/src/app/page.tsx` L3 註解:`對齊 design-reference/components/HomePage.jsx @ d5ea3aa 字面`(歷史 anchor、d1 階段)
  - `apps/storefront/src/components/Header.tsx` L3 註解:`字面從 design-reference/components/Header.jsx @ d5ea3aa 直接搬`(歷史 anchor、d1 階段)
- **判定:** 這些 anchor 屬「字面源 at that commit」歷史紀錄、不算錯誤、但若 d5ea3aa → 25d3a2a 之間 design 字面有變、需重新對齊
- **backlog #116 字面同帶 `M-1-03-main-d-d1 ... design @ d5ea3aa`**(歷史 anchor、同上)

### 9.3 backlog #87 預期解法依賴條件未到(time mismatch)

- **#87 字面:** 預期解法「storefront wire-up slice(視 storefront **第一個用 InMemoryProductRepository** 的 slice)啟動前」
- **事實:** M-1-03-main-d-d2 已 wire-up storefront、走 SupabaseProductAdapter、未走 InMemoryProductRepository
- **判定:** #87 觸發條件「第一個用 InMemoryProductRepository wire-up」**尚未發生**、#87 是否在 M-1-04 處理或順延待 Sean 拍板

### 9.4 STATUS L17 / L29 hash drift(已知、本 slice 不處置)

- STATUS L17 / L29 hash 字面 `6f4ffeb`、事實 HEAD = `bf9bbfd`(差 1 步)
- STATUS L17 自述「ahead origin/dev = 2 待 push」、事實 `git rev-list --count origin/dev..HEAD` = 0(已 push)
- STATUS L17 自己揭示「本 sub 走預設 amend 模式、新 hash 1 步 drift 接受由下個 slice 修」
- **本 slice 收尾將順手修**(對齊 lessons §12-3 維度 B 滾動修正先例十七)

### 9.5 HomeSelect.tsx 'use client' 字面位置非常規(風險 anchor §8.4)

- 見 §8.4

---

— END —
