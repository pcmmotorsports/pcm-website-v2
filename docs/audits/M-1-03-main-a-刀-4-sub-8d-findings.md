# M-1-03-main-a 刀 4 sub 8d 雙 audit findings

> **狀態:** 純 findings 報告、本 sub 不處置、留 sub 8e 教訓批次落地階段拍板
>
> **產出於:** 2026-05-12 / M-1-03-main-a 刀 4 sub 8d
> **HEAD:** `6be3287` (sub 8c amend 後)
> **執行順序:** engineering:code-review → simplify(Q2=A1 拍板、對齊 M-0-04 先例)

---

## 範圍

- **11 檔、約 1077 行**(刀 4 sub 1/3/4a/4b/6/7/8a 落地檔)
- sub 0 PRD docs 不入 audit、sub 8b env 位置變更 Q3=A3 拍板排除、sub 8c backlog 條目化 Q3=A3 排除

| 檔 | 行數 | 來源 sub |
|---|---|---|
| `packages/domain/src/catalog/pricing.ts` | 58 | sub 1 |
| `packages/domain/src/catalog/pricing.test.ts` | 161 | sub 1 |
| `apps/storefront/src/app/page.tsx` | 77 | sub 3 / 4b |
| `apps/storefront/src/data/mock-products.ts` | 48 | sub 4a |
| `apps/storefront/src/lib/products.ts` | 139 | sub 4b |
| `apps/storefront/src/components/Price.tsx` | 70 | sub 6 |
| `apps/storefront/src/styles/pricing.css` | 60 | sub 6 |
| `apps/storefront/src/app/layout.tsx` | 37 | sub 6 |
| `apps/storefront/src/components/ProductCard.tsx` | 174 | sub 7 |
| `apps/storefront/src/styles/product-card.css` | 195 | sub 7 |
| `packages/adapters/src/supabase/mappers/product.ts` | 181 | sub 8a(wire narrow 後) |

---

## engineering:code-review 議題(13 條)

### eng-1: id cast trade-off (string ProductId → number)
- **檔案:** `apps/storefront/src/lib/products.ts:77`
- **嚴重程度:** 🟡 低
- **視角:** correctness
- **描述:** `id: product.id as unknown as number` 把 string ProductId cast 成 number(MockProduct.id 字面 number);`ProductImage seed: number` 算術運算(`seed * 7 / seed % n`)若 cast 結果非 number runtime NaN
- **建議處置:** 留 backlog #117 anchor(本對話揭示缺號)、後續 slice 修 `ProductCardProps.p.id` 接 string + `ProductImage seed` 改 hash 函式
- **三視角:** 擴 - / 維 ✅(commit body 已記)/ bug ✅(NaN 路徑)

### eng-2: ?tier= override security guard ✅
- **檔案:** `apps/storefront/src/app/page.tsx:46-49`
- **嚴重程度:** 🟡 低(已正確處理、屬「looks good」)
- **視角:** security
- **描述:** `process.env.PCM_DEV_TIER_OVERRIDE === '1'` env-guarded 防 production 訪客 URL 加 ?tier= 取得 dealer 價、對齊 PRD §3.1 Q1=B 拍板
- **建議處置:** 現實作正確、M-1-14 真 auth 落地後 flag 可廢除
- **三視角:** 全綠

### eng-3: designTierToSchema try/catch fallback ✅
- **檔案:** `apps/storefront/src/app/page.tsx:54-58`
- **嚴重程度:** 🟡 低
- **視角:** correctness
- **描述:** `try/catch` 包 `designTierToSchema`、corrupt cookie / 攻擊 URL fallback `'general'`、防 server 端 throw
- **建議處置:** 現實作 correctness 全綠、可考慮 log fallback case 便於 admin debug
- **三視角:** bug ✅ 增加 log 可加分

### eng-4: server-only runtime guard 替代 npm package
- **檔案:** `apps/storefront/src/lib/products.ts:28-32`
- **嚴重程度:** 🟡 低(已記 commit body)
- **視角:** security
- **描述:** `typeof window !== 'undefined'` runtime guard 替代 `server-only` npm package(對齊 d2 Sean 拍板「範圍紀律不擴張 deps」)、runtime guard 在 build time 不阻擋 client component import
- **建議處置:** 現實作可接受;storefront 規模擴張可考慮加 `server-only` package(對齊 Next.js 13+ 推薦)
- **三視角:** 擴 ✅(規模擴張)/ 維 ✅ / bug -

### eng-5: badge corner 浮點除法邊界
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:114`
- **嚴重程度:** 🟡 低
- **視角:** correctness
- **描述:** `Math.round((1 - p.price / p.origPrice) * 100)` 若 `p.origPrice === 0` 撞除零 → -Infinity → `-Infinity%`;但 `if (... && p.origPrice)` truthy check 已過濾 0/null/undefined、edge case 不 hit
- **建議處置:** 現實作 truthy check 已防、可接受;若改為 explicit `p.origPrice && p.origPrice > 0` 更明確 TypeScript narrow
- **三視角:** 全綠(truthy 已防)

### eng-6: 'NT$' hardcode 5 處(Phase 2 多幣別)
- **檔案:** `apps/storefront/src/components/Price.tsx:43, 45, 56, 58, 67`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** `NT$ ${...toLocaleString()}` 5 處 hardcode、未來多幣別需散修
- **建議處置:** 留新 backlog 條目(對齊 PRD §7.2 預估「'NT$' currency → symbol helper Phase 2 多幣別」、本對話 sub 8c #125 已被 git push 處置佔用、需 sub 8e 評估新編號)
- **三視角:** 擴 ✅(多幣別)/ 維 ✅ / bug -

### eng-7: hasRetailDiscount 邏輯複雜度
- **檔案:** `apps/storefront/src/components/Price.tsx:36`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** `!isMember && originalPrice !== null && originalPrice > price` 三條件混合、可讀性中等
- **建議處置:** 可考慮拆 helper 或加 JSDoc 說明三條件互斥關係
- **三視角:** 微小

### eng-8: productGallery NaN propagation
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:34-42`
- **嚴重程度:** 🟠 中
- **視角:** correctness
- **描述:** `PRODUCT_IMG_POOL[seed % n] ?? ''` 若 `seed === NaN`(對應 eng-1 id cast 失敗) → `NaN % n = NaN` → array index NaN → undefined → '' → broken URL;`onError` fallback 觸發、UI 變 gradient 純色
- **建議處置:** 與 eng-1 連動、留 backlog #117 anchor 修 hash 函式
- **三視角:** 擴 - / 維 - / bug ✅(NaN 故障鏈)

### eng-9: test corrupt data 用 type assertion
- **檔案:** `packages/domain/src/catalog/pricing.test.ts:113-148`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** test 用 `null as unknown as number` / `'abc' as unknown as number` 偽造 corrupt data 驗證 runtime fallback、繞過 type system
- **建議處置:** 現實作可接受(test 用為了驗 runtime guard)、可加註解說明「為何用 type assertion」
- **三視角:** 維 ✅(註解可加分)

### eng-10: className template literal trailing space
- **檔案:** `apps/storefront/src/components/Price.tsx:41, 54, 66`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** `className={`price-wrap price-${size} price-${layout} ${className}`}` 若 `className === ''`、結尾留 trailing space(不影響 CSS)
- **建議處置:** 引入 clsx / classnames helper、或現實作可接受(無 perf 影響)
- **三視角:** 微小

### eng-11: Google Fonts render-blocking
- **檔案:** `apps/storefront/src/app/layout.tsx:29-32`
- **嚴重程度:** 🟡 低
- **視角:** 性能
- **描述:** Google Fonts CSS 走 `<link rel="stylesheet">` render-blocking、Next.js 16 推薦 `next/font` self-host + preload
- **建議處置:** layout.tsx commit body 已揭示「對齊 design 字面、避免 next/font 隱式包裝偏離 design」、trade-off 維持 design 對齊;留 M-6 上線前 checklist 切 next/font
- **三視角:** 性能 🟡

### eng-12: mapper inline placeholder Money 註解充分
- **檔案:** `packages/adapters/src/supabase/mappers/product.ts:117`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** `premiumStore: { amount: toMoneyAmount(0), currency: row.price_by_tier.store.currency }` inline placeholder、依賴 storefront computeEffectivePrice dispatch 覆蓋
- **建議處置:** 現實作有 4 行註解(L109-113)解釋設計意圖、可接受;backlog #123 已 closed 確認不抽 helper
- **三視角:** 全綠(註解充分)

### eng-13: badge IIFE 邏輯散落
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:105-118`
- **嚴重程度:** 🟡 低
- **視角:** 維護性
- **描述:** badge IIFE 內 4 條件分支(none / isNew × 3 style / isSale × 3 style)、邏輯散落
- **建議處置:** 對齊 design 字面直接搬、保留;未來 badge 樣式累積時抽 lookup map
- **三視角:** 微小

---

## simplify 議題(19 條)

### simp-1: CSS import 順序對齊 design
- **檔案:** `apps/storefront/src/app/layout.tsx:12-16`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** 5 條 CSS import 對齊 design-reference/index.html 字面、無 utility 收斂、新檔加 CSS 需散修
- **建議處置:** 現實作可接受(直接搬精神)、未來規模擴張可考慮 CSS module / atomic class
- **三視角:** 維 ✅(註解明示)

### simp-2: pricing.css 顏色字面散落
- **檔案:** `apps/storefront/src/styles/pricing.css:11, 15, 19, 28, 35, 46, 57, 60`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** CSS variable `var(--c-text, #0a0a0a)` 等已用 fallback、但 `--c-red` / `--c-accent` 兩個 CSS variable 字面混用、可能對應 design tokens drift
- **建議處置:** 留 backlog anchor(若 design tokens 集中化、本檔字面集中替換)
- **三視角:** 微小

### simp-3: .is-red 重複定義
- **檔案:** `apps/storefront/src/styles/pricing.css:46, 57, 60`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** `.price-wrap.is-dealer .price-main` (L46) + `.pcard-price-row .price-wrap.is-red .price-main` (L57) + `.price-wrap.is-red .price-main` (L60) 三條規則重複設定 `color: var(--c-red)`
- **建議處置:** L60 一條足夠覆蓋所有 `.is-red`、L57 嵌套規則可移除(被 L60 覆蓋)
- **三視角:** 維 - 微小

### simp-4: className template literal 三處重複
- **檔案:** `apps/storefront/src/components/Price.tsx:41, 54, 66`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** `price-wrap price-${size} price-${layout} ${className}` 三條分支重複拼接(僅 isMember 分支多 `is-dealer`)
- **建議處置:** 抽 helper `buildPriceClassName({ size, layout, isMember, extra })`;現實作分支字面差異小可接受
- **三視角:** 微小

### simp-5: 三分支 fall-through 結構
- **檔案:** `apps/storefront/src/components/Price.tsx:39, 52, 64`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** 三 `if return` early return、是 React 元件常見 idiom
- **建議處置:** 不必過度抽象、保留
- **三視角:** 全綠

### simp-6: productGallery 推導公式 hardcode
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:34-42`
- **嚴重程度:** 🟡 低
- **視角:** reuse / quality
- **描述:** 三個 hardcode 公式 `seed % n / (seed*7+3) % n / (seed*13+5) % n`、無 helper、未來改圖數量需散修
- **建議處置:** 可抽 `pickFromPool(pool, seed, count)`;對齊 design 直接搬、留現狀
- **三視角:** bug ✅(NaN propagation 與 eng-1/eng-8 連動)

### simp-7: palettes inline 每次 render 重建
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:56-63`
- **嚴重程度:** 🟡 低
- **視角:** efficiency
- **描述:** `palettes: Record<Tone, [string, string]>` inline 定義在 `ProductImage` 內、每次 render 重建 6-entry object
- **建議處置:** 抽到 module-level `const PALETTES`、避免 render 重建;微小性能改善
- **三視角:** efficiency 🟡(微小)

### simp-8: palettes lookup fallback
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:64`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** `palettes[tone as Tone] ?? palettes.neutral` 雙重防護(cast + fallback)
- **建議處置:** 現實作可接受
- **三視角:** 擴 ✅

### simp-9: toUIProduct hardcode UI 字面
- **檔案:** `apps/storefront/src/lib/products.ts:62-92`
- **嚴重程度:** 🟡 低
- **視角:** reuse / quality
- **描述:** `origPrice: null` / `isNew: false` / `isSale: false` / `color: 'silver'` / `imgTone: 'neutral'` 5 個 hardcode、對應 d2 commit body 揭示「promo 概念 Phase 1 未做」
- **建議處置:** 現實作有 JSDoc L51-54 + commit body 揭示、可接受;Phase 2 promo / variant 落地時抽
- **三視角:** 擴 ✅(Phase 2)/ 維 ✅

### simp-10: tier resolution 邏輯散落 trigger
- **檔案:** `apps/storefront/src/app/page.tsx:42-58`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** `tierOverride / cookie / 'general'` priority + `designTierToSchema` guard、未來 ProductPage / CheckoutPage 各 page 自己 resolve tier
- **建議處置:** 留 backlog anchor(第 3 處撞抽 helper `resolveTierFromRequest(searchParams, cookies)`、對齊 lessons §84/§85 Defer 模式)
- **三視角:** 擴 ✅(M-1-XX ProductPage)

### simp-11: toMoney helper 私有
- **檔案:** `packages/adapters/src/supabase/mappers/product.ts:171-175`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** `toMoney` helper 私有 module-level、僅 mapper 內使用;若其他 mapper 也需 wire → Money 轉換會重複
- **建議處置:** 第 3 處撞、抽到 `packages/adapters/src/supabase/helpers/money.ts`(對齊 lessons §85)
- **三視角:** 擴 ✅

### simp-12: id NaN 故障鏈三處字面散落
- **檔案:** `apps/storefront/src/app/page.tsx:65` + `apps/storefront/src/components/ProductCard.tsx:129` + `apps/storefront/src/lib/products.ts:77`
- **嚴重程度:** 🟠 中
- **視角:** quality
- **描述:** `data-tier={tier}` + `seed={p.id}` + `id: product.id as unknown as number` cast、三處字面互關、debug 鏈未明示
- **建議處置:** 留 backlog #117 anchor、後續 slice 修(與 eng-1 連動)
- **三視角:** bug ✅(NaN 故障鏈)

### simp-13: createFakeProduct 兩處重複(第 2 次撞)
- **檔案:** `packages/domain/src/catalog/pricing.test.ts:14-37` + `packages/adapters/src/in-memory/InMemoryProductRepository.test.ts:12-35`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** `createFakeProduct` helper 在兩個 test file 重複定義、欄位完全相同、對齊 lessons §85「第 3 處撞才抽 fixture」目前 2 處未抽
- **建議處置:** 留 backlog #85 anchor 觸發、第 3 處撞時抽 fixture
- **三視角:** 擴 ✅

### simp-14: TierLabel union 三處重複(可抽 type alias)
- **檔案:** `apps/storefront/src/components/Price.tsx:19` + `apps/storefront/src/lib/products.ts:73` + `apps/storefront/src/data/mock-products.ts:24`
- **嚴重程度:** 🟠 中
- **視角:** reuse / quality
- **描述:** `'P價' | '店價' | null` union 字面三處重複定義、未抽 type alias、若新增 tier label 需散修
- **建議處置:** 抽 type alias `TierLabel = 'P價' | '店價' | null` 到 `@/data/mock-products.ts` 或 `@pcm/domain`、三處 import;對齊 ADR-0003 §3.2「string literal union ≥ 2 個 consumer 必抽 type alias」規範
- **三視角:** 擴 ✅ / 維 ✅

### simp-15: badge IIFE 多重 if
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:105-118`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** badge IIFE 內 4 條件分支、可改 lookup table `{ style → JSX }` 模式
- **建議處置:** 對齊 design 字面、保留現狀;未來 badge 樣式累積抽 lookup map(eng-13 重疊)
- **三視角:** 微小

### simp-16: 補貨中 i18n 字面 hardcode
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:133`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** UI 字面 '補貨中' hardcode、與 lib/products.ts L85 `availability === 'in-stock'` 對應、未來 i18n 啟動需抽 string table
- **建議處置:** 對齊 design 字面、現實作可接受
- **三視角:** 擴 - i18n

### simp-17: premium_extra_pct 雙重 type+runtime 防護 ✅
- **檔案:** `packages/domain/src/catalog/pricing.ts:49-52`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** `typeof product.brand.premium_extra_pct === 'number'` runtime guard + Brand.premium_extra_pct: number 強制必填、雙重防護
- **建議處置:** 現實作有 commit body + test L111-149 三 case 驗證 + Brand JSDoc 對齊 schema、可接受
- **三視角:** 全綠

### simp-18: PRODUCT_IMG_POOL hardcode pool
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:17-32`
- **嚴重程度:** 🟡 低
- **視角:** quality
- **描述:** 15 個 Unsplash image id 字面 hardcode pool、純展示 mock 用途、無實際 product image fetch
- **建議處置:** 對齊 design 直接搬精神;未來 ProductImage 接真實 image URL 時(M-1-13 / M-1-16)swap
- **三視角:** 擴 - / 維 ✅

### simp-19: PRODUCT_IMG_POOL 重複圖片 id
- **檔案:** `apps/storefront/src/components/ProductCard.tsx:19, 30`
- **嚴重程度:** 🟡 低
- **視角:** reuse
- **描述:** `photo-1449426468159-d96dbf08f19f` 在 pool 中出現 2 次(L19 + L30、註解略不同)
- **建議處置:** 對齊 design 字面驗證(可能 design 真重複、純 mock 用途無實際影響);若 design 無重複、修正
- **三視角:** 微小

---

## 雙 audit 命中(議題重疊清單)

對齊 M-0-04 實測「engineering 抓 5 / simplify 抓 12 / 互不重疊」、本 sub 實測:

| eng | simp | 重疊主題 | 說明 |
|---|---|---|---|
| eng-1 | simp-12 | id NaN 故障鏈 | 兩 audit 都點出 string→number cast trade-off、NaN propagation;留 backlog #117 |
| eng-5 | (無) | badge corner 浮點 | eng 角度防 -Infinity%、simp 未點 |
| eng-6 | (無) | 'NT$' hardcode | eng 角度多幣別、simp 未點 |
| eng-8 | simp-6 | productGallery NaN | 兩 audit 重疊、NaN 路徑 |
| eng-13 | simp-15 | badge IIFE 散落 | 重疊、留 design 對齊 |
| (無) | simp-14 | TierLabel union 三處 | simp 抓出 type alias 缺、eng 未點 |
| (無) | simp-13 | createFakeProduct 兩處 | simp 抓出 fixture Defer、eng 未點 |
| (無) | simp-7 | palettes render 重建 | simp efficiency 微小、eng 未點 |

**4 對重疊 + 各自獨立議題(eng 9 / simp 15)、總獨立 24 條議題、雙 audit 互補性對齊 M-0-04 實證(本 sub 重疊度約 17%、M-0-04 0%、原因:本 sub 11 檔 vs M-0-04 範圍較窄;但仍保留高互補性、無大量重疊浪費)。**

---

## 議題分類預估

### 立即修候選(命名 / JSDoc / 低風險、可直接落地、sub 8e 拍板或留後續 slice)
- **eng-7** Price.tsx hasRetailDiscount 加 JSDoc(微小、可即修)
- **eng-9** pricing.test.ts type assertion 加註解(微小、可即修)
- **simp-3** pricing.css .is-red L57 嵌套規則移除(微小、可即修)
- **simp-7** ProductCard palettes 抽 module-level(微小、可即修)

**4 條候選立即修、若 sub 8e 決議跑 follow-up audit 修正 slice、批次落地估時 15-20 min**

### backlog 候選(預抽 generic / 跨 entity 模式、留 trigger 觸發)
- **eng-1 / eng-8 / simp-6 / simp-12** id NaN 故障鏈 → 留 backlog #117 anchor(本對話揭示缺號、可考慮用 #117 補)
- **eng-6** 'NT$' currency → symbol helper(對齊 PRD §7.2 預估、sub 8c #125 已被 git push 處置佔用、需新編號 #129+)
- **simp-10** tier resolution helper(第 3 處撞抽、對齊 lessons §85)
- **simp-11** toMoney helper 集中(第 3 處撞抽、對齊 lessons §85)
- **simp-13** createFakeProduct fixture(第 2 處撞、第 3 處撞抽、對齊 lessons §85 / backlog #85)
- **simp-14** TierLabel union type alias(對齊 ADR-0003 §3.2 規範類)

**6 條 backlog 候選、sub 8e 拍板新編號 + #117 利用率**

### working-style 合併候選(規範類 / JSDoc tag / 命名規則)
- **simp-14** ADR-0003 §3.2「string literal union ≥ 2 個 consumer 必抽 type alias」規範類、可合併進 working-style §6.3 自檢清單
- **simp-17** premium_extra_pct 雙重防護模式(type 強制 + runtime guard)為 corruption defense pattern、可寫進 working-style 或 lessons

**2 條 working-style 合併候選**

### 全綠 / looks good(無需處置)
- eng-2 / eng-3 / eng-12 / simp-5 / simp-8 / simp-17 / simp-18 / simp-19

---

## sub 8e 處置建議

1. **立即修 4 條(eng-7 / eng-9 / simp-3 / simp-7):** 純註解 + CSS 重複 + module-level const、估時 15-20 min、可併進 sub 8e 教訓批次 commit
2. **backlog 6 條:** 對齊 PRD §7.2 預估清單 + 本對話累積教訓、開新編號 #129+;**#117 缺號可考慮用為 id NaN 故障鏈 anchor**(eng-1 / eng-8 / simp-6 / simp-12 收斂、4 條重疊 finding 收一個 anchor 條目)
3. **working-style 2 條:** simp-14 / simp-17 加進 §6.3 自檢清單第 22+ 條(對齊 lessons §12-12+)
4. **全綠 8 條:** 無需處置、僅紀錄正向觀察

**雙 audit 互補性實證:** 重疊度 17% (4/24)、對齊 M-0-04 教訓「engineering + simplify 視角互補」原則、本 sub 雙跑非冗餘、值得保留 PRD §5.3 雙 audit 紀律。

**估時對齊:** sub 8e 教訓批次 PRD §6.3「量 ≥ 3 條開獨立 docs commit」、本 sub 8d 產出立即修 4 條 + backlog 6 條 + working-style 2 條 + lessons §12-N 3-5 條(sub 8 PRD §6 預留)、sub 8e 總工作量約 60-90 min。

---

**Audit 結束、未修任何 source code、純 findings 報告交付。**
