# M-1-03 main-a 刀 4 PRD: storefront 公式 dispatch + memberLabel 落地

> **Status:** 🟢 拍板 / 2026-05-12 / Sean R 階段 Q1=A / Q2=C / Q3=B / Q4=C / Q5=A + R 階段內子拍 Q1=B 安全 guard / Q2=A 4+5 合併再拆 4a/4b / Q3=A 元件簽名基本型 props / Q4=A 不預拆 / Q5a=A PRD 寫入 docs/specs / Q5b=B STATUS drift 併入 PRD 落地 commit + R1=A 8 commit / R2=A Claude.ai 逐刀指令 Code 執行(非 Code Auto Mode)
> **拍板人:** Sean
> **層級:** docs/specs/、衝突仲裁次於 STATUS.md / NORTHSTAR / 0001-0005 ADR / supabase-schema-design.md
> **本檔角色:** M-1-03-main-a 刀 4 完整實作規格、8 sub-slice 拆法、字面 vs 事實揭示預留
>
> **HEAD:** `1707e41`(刀 4 偵察)/ ahead origin/dev = 0(sub 0 commit 後 = 1)
> **真權威字面源:**
> - design-reference @ `25d3a2a` `components/Pricing.jsx` L56-114(Price / LinePrice 元件 + memberLabel 字面)
> - `packages/domain/src/shared/types.ts` L1-70(Money / Currency / MoneyAmount / MemberTier)
> - `packages/domain/src/catalog/types.ts` L114(PriceByTier = Record<MemberTier, Money>)
> - `packages/domain/src/shared/utils.ts` L43(designTierToSchema helper)
> - `apps/storefront/src/lib/products.ts`(toUIProduct + fetchFeaturedProducts)
> - `apps/storefront/src/data/mock-products.ts` L8-21(MockProduct shape 12 欄位)
> - `design-reference/design-handoff/HANDOFF-v2.1.md` L162-167(§5.5 已過時、以 .jsx 為準)
>
> **配合閱讀:**
> - `docs/specs/M-1-03-main-b-PRD.md`(SupabaseProductAdapter 對齊)
> - `docs/decisions/0005-custom-supabase-direct.md` §8.1
> - `docs/architecture/supabase-schema-design.md` §2.4 Pricing 公式 + §5.1 jsonb 二 key
> - `design-reference/components/Pricing.jsx`(真權威字面、HANDOFF v2.1 §5.5 已過時、以 .jsx 為準)
> - `docs/phase-1-backlog.md` #115 / #118 / #119 / #123(刀 4 連動 backlog)
> - `docs/lessons-learned.md` §12-3 維度 B(STATUS L29 滾動修正模式)

---

## §1 範圍與目標

### §1.1 包含(A-C-B-C-A 拍板字面)

**Q1=A:tier 來源 cookie 路徑**
- `apps/storefront/src/app/page.tsx` server-side `cookies()` 讀 `pcm-tier`、預設 `'general'`
- dev 階段 `?tier=store` query 可覆寫 cookie 值(server-side searchParams 處理)
- **R 階段 Q1=B 修訂:** production 安全 guard 採 `PCM_DEV_TIER_OVERRIDE` env flag、`process.env.PCM_DEV_TIER_OVERRIDE === '1'` 才允許 `?tier=` 覆寫、production 預設關
- tier 值經 `designTierToSchema()` helper 已存在不需新建(`packages/domain/src/shared/utils.ts:43`)
- M-1-14 真登入落地後 cookie 改由 auth 設、page.tsx 不動

**Q2=C:公式抽 packages/domain pure function**
- 新建 `packages/domain/src/catalog/pricing.ts`
- export `computeEffectivePrice(product: Product, tier: MemberTier): Money`
- 公式對齊 Pricing.jsx L27-42 + supabase-schema-design.md §2.4
- premium_store 算式:`Math.round(store.amount × (1 - brand.premium_extra_pct / 100))`
- 配 unit test(三 tier 全測 + edge case:`premium_extra_pct = 0` / `null` / `undefined`)

**Q3=B:拆 `<Price>` / `<LinePrice>` 元件**
- 新建 `apps/storefront/src/components/Price.tsx`
- 對齊 Pricing.jsx L56-95 字面(`isMember` 分支 + memberLabel + `price-tag-dealer` className)
- ES export(非 design 端 `Object.assign(window)` prototype 路徑)
- LinePrice 元件:Phase 1 暫不落地(cart 流程尚未啟動)、本刀只落 `<Price>`
- **R 階段 Q3=A 修訂:** 元件簽名採基本型 props(選項 B)、不接 Product 物件
  - `<Price price={number} originalPrice={number|null} tierLabel={'P價'|'店價'|null} showSavedTag={boolean} size={string} className={string} />`
  - 內部依 `tierLabel` 是否 null 判斷 isMember 分支
  - 與 MockProduct shape 解耦(`<Price>` 可重用其他資料源)

**Q4=C:MockProduct shape 扁平 + tierLabel**
- MockProduct 加兩欄:`originalPrice: number | null` + `tierLabel: 'P價' | '店價' | null`
- toUIProduct 內 server-side dispatch:
  - 算 `computeEffectivePrice(tier)` → price
  - 算 `computeEffectivePrice('general')` → originalPrice(若 tier ≠ 'general')
  - 算 tierLabel(`'P價'` / `'店價'` / null)
- ProductCard 仍不接 tier、純顯示 MockProduct.price + originalPrice + tierLabel(三 tier 物件不進 client bundle、防經銷價洩漏)

**Q5=A:刀 3 placeholder 同 commit 全清**
- 刪除 `mappers/product.ts` L67-68 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4` const
- wire type narrow:`SupabaseProductRow.price_by_tier` 三 key → 二 key(`'general' | 'store'`)
- backlog #123 zeroMoney helper 重評(placeholder 移除後 trigger 可能消失、條目可關)

### §1.2 不包含(本刀邊界 + 推遲)

| 項 | 推遲到 | 拍板源 |
|---|---|---|
| LinePrice 元件落地 | Phase 1 cart milestone(M-1-XX、未排) | Q3=B 範圍縮、cart 未啟動不過早 |
| ProductPage.jsx L529 + AccountPages.jsx L120 design 端硬編碼修 | Phase 3(HANDOFF v2.1 §5.5 明示) | design submodule 不在 storefront 修 |
| storefront ProductPage / Cart 元件落地 | M-1-XX | 本刀只動 HomePage 路徑、ProductPage 未啟動 |
| Money → 'NT$' currency formatter | Phase 2 多幣別 trigger | Phase 1 只 TWD、hardcode 對齊 design 字面 |
| 真實 auth tier 寫入 cookie | M-1-14 customers + auth | Phase 1 dev 用 cookie 預設 + ?tier= 覆寫(env flag 守門) |
| toUIProduct → `<Price>` 元件直接接 Product 物件路徑 | 不採、對齊 Q4=C 防洩漏 | 三 tier 物件不進 client bundle |
| 統一 design 端 ProductPage / CheckoutPage 改 `<Price>` 元件 | Phase 3 | HANDOFF v2.1 §5.5 |
| HANDOFF v2.1 §5.5 字面與 Pricing.jsx 字面同步修 | 獨立 docs slice / 留 backlog | 字面 drift 揭示、不在刀 4 主 commit |

### §1.3 拍板字面對應原則 10 自檢(寫 PRD 前 grep 完成)

| 字面 | 來源 | 偵察確認 |
|---|---|---|
| memberLabel `'P價'` / `'店價'` | Pricing.jsx L62 + L103 | ✅ 偵察區塊 1 |
| MemberTier enum `'general' / 'store' / 'premiumStore'` | shared/types.ts L70 | ✅ 偵察區塊 2 |
| designTierToSchema() helper | shared/utils.ts:43 | ✅ 偵察區塊 1 + 2 |
| Money brand type `{ amount: MoneyAmount, currency: 'TWD' }` | shared/types.ts L29-33 | ✅ 偵察區塊 3 |
| toMoneyAmount guard(integer + 非負) | shared/types.ts L44-52 | ✅ 偵察區塊 3 |
| MemberTier enum tier key 字面 | shared/types.ts L70 | ✅ 偵察區塊 2 |
| PriceByTier = Record<MemberTier, Money> | catalog/types.ts L114 | ✅ 偵察區塊 2 |
| MockProduct shape 12 欄位 | mock-products.ts L8-21 | ✅ 偵察區塊 4 |
| HANDOFF §5.5 過時字面 揭示 | design-handoff/HANDOFF-v2.1.md L162-167 | ✅ 偵察區塊 5 |
| design tier 字面 `'store'` / `'premium_store'` snake_case | Pricing.jsx L59 + L62 + L102 + L103 | ✅ 偵察區塊 1 |

---

## §2 8 sub-slice 拆法

> 每 sub-slice 15-45 min、含 commit 邊界 + 驗收 + 連動檔。
> 順序依「下層先穩、上層才接」原則(L1 → L5)+ R 階段 Q2=A 拆 4a/4b 修矛盾。
> R 階段 R1=A 拍板 8 commit / R2=A Claude.ai 逐刀指令、Code 執行、非 Code Auto Mode。

### sub 0:PRD docs 落地 + STATUS drift 補(本 sub)

- **層級:** L0(docs、無 code)
- **改動檔(2):**
  - 新建 `docs/specs/M-1-03-main-a-刀-4-PRD.md`(本檔、~300 行)
  - `STATUS.md` 更新 4 處:當前 slice / 最後更新 / 最近 3 commit L29-L31 / 下一步
- **依賴:** 無、本 sub 是最底層 docs
- **驗收:**
  - PRD 行數 280-350、§0-§8 全章節
  - STATUS L29 = 本 sub commit hash(busboy-end amend 補)
  - 累積 drift 3 commit(刀 1b / 刀 2 / 刀 3 / 刀 4 偵察)補進 STATUS L30-L31
- **估時:** 30-40 min

### sub 1:packages/domain pricing.ts pure function + unit test(原 sub 1+2 合併)

- **層級:** L2
- **改動檔(3):**
  - 新建 `packages/domain/src/catalog/pricing.ts`(~40 行、export `computeEffectivePrice`)
  - 新建 `packages/domain/src/catalog/pricing.test.ts`(~80 行、三 tier × 邊界 case 8-12 test)
  - `packages/domain/src/catalog/index.ts` 加 `export { computeEffectivePrice } from './pricing'`
- **依賴:** 無、本 sub 與 sub 0 平行(順序不互鎖)
- **驗收:** typecheck 7/7 + lint 10/10 + `pnpm --filter @pcm/domain test` 全綠
- **估時:** 40-50 min(原 sub 1+2 合併、不超 45 min 上限、低風險)

### sub 3:apps/storefront page.tsx + 引入 tier cookie 路徑 + env guard

- **層級:** L1(Q1=A + R 階段 Q1=B 修訂)
- **改動檔(1):**
  - `apps/storefront/src/app/page.tsx`:
    - 加 `cookies()` 讀取 `pcm-tier`(預設 `'general'`)
    - 加 `?tier=` searchParams 處理(僅 `process.env.PCM_DEV_TIER_OVERRIDE === '1'` 時生效)
    - `designTierToSchema()` 轉換(若需 design ↔ domain 命名邊界)
    - 傳給 `fetchFeaturedProducts(tier)` 參數(sub 4b 後落地)
- **依賴:** 無(Code 邏輯獨立)
- **驗收:**
  - typecheck + lint 全綠
  - dev server `PCM_DEV_TIER_OVERRIDE=1 ?tier=store` 拿到 store 價
  - dev server 預設(無 env flag)`?tier=store` 不生效、回 `'general'`
- **估時:** 30-40 min

### sub 4a:MockProduct shape 加兩欄 + mock 補 null(Q2=A 拆兩 commit 第一刀)

- **層級:** L4
- **改動檔(1):**
  - `apps/storefront/src/data/mock-products.ts`:
    - type `MockProduct` 加 `originalPrice: number | null` + `tierLabel: 'P價' | '店價' | null`
    - 20 筆既有 mock 補 `originalPrice: null` + `tierLabel: null`(general tier 預設)
- **依賴:** 無
- **驗收:** typecheck + lint 全綠、mock 仍可作 fallback / storybook
- **估時:** 20-25 min

### sub 4b:lib/products.ts fetcher tier 參數 + toUIProduct 公式 dispatch(Q2=A 拆兩 commit 第二刀)

- **層級:** L1 + L2 + L4 接合
- **改動檔(1):**
  - `apps/storefront/src/lib/products.ts`:
    - `fetchFeaturedProducts(tier: MemberTier)` 簽名加參數
    - toUIProduct 內接 `computeEffectivePrice(tier)` → `price`
    - 新算 `originalPrice`(若 tier ≠ 'general')+ `tierLabel`
- **依賴:** sub 1(pricing 公式)+ sub 3(page.tsx 傳 tier)+ sub 4a(MockProduct shape)
- **驗收:**
  - typecheck + lint + dev server `?tier=general` / `?tier=store` 拿到不同 price
  - server-side dispatch、三 tier 物件不進 client bundle
- **估時:** 30-40 min

### sub 6:apps/storefront `<Price>` 元件 + pricing.css + layout 引入(R 階段 Q4=A 不預拆)

- **層級:** L3(Q3=B + R 階段 Q3=A 基本型 props)
- **改動檔(3):**
  - 新建 `apps/storefront/src/components/Price.tsx`(~50 行)
    - 簽名:`{ price, originalPrice, tierLabel, showSavedTag, size, className }`
    - 對齊 Pricing.jsx L56-95 isMember 分支(`tierLabel` 非 null = isMember)
  - 新建 `apps/storefront/src/styles/pricing.css`(對齊 design pricing 字面、含 `.price-tag-dealer` + `.price-strike` + `.ap-mono`)
  - `apps/storefront/src/app/layout.tsx`(或對應引入點):CSS 引入
- **依賴:** sub 4a(`<Price>` 接 MockProduct.tierLabel)
- **驗收:**
  - typecheck + lint 全綠
  - dev server 三 tier 視覺驗(general 純價 / store 劃線+店價 / premiumStore 劃線+P價)
- **估時:** 40-45 min(R 階段 Q4=A 不預拆、實作中 30 min 一檢查、真超 45 min Code 主動 raise)

### sub 7:ProductCard.tsx 改接 `<Price>` 元件

- **層級:** L3(Q3=B 配套)
- **改動檔(1):**
  - `apps/storefront/src/components/ProductCard.tsx`:既有 `<span className="pcard-price">NT$ ...</span>` 改為 `<Price price={...} originalPrice={...} tierLabel={...} />`
  - ProductCard 不接 tier、純顯示 MockProduct 的 price / originalPrice / tierLabel
- **依賴:** sub 6(Price 元件)
- **驗收:**
  - typecheck + lint 全綠
  - dev server hover / discount badge / oos 三狀態仍正常
  - 三 tier 切換(`PCM_DEV_TIER_OVERRIDE=1 ?tier=store|premiumStore`)顯示對
- **估時:** 25-35 min

### sub 8:刀 3 placeholder 清理 + wire type narrow + backlog #123 重評(刀 4 收工)

- **層級:** L5(Q5=A)
- **改動檔(2-4):**
  - `packages/adapters/src/supabase/mappers/product.ts`:刪 L67-68 `PREMIUM_STORE_PLACEHOLDER_AMOUNT_DEFERRED_TO_SLICE_4` const + 對應 mapper 邏輯
  - `packages/adapters/src/supabase/types.ts`(或 wire type 所在處):`price_by_tier` 三 key → 二 key
  - `docs/phase-1-backlog.md` #123 zeroMoney helper 條目重評(可能改 ✅ 關閉)
  - 可能補 `docs/lessons-learned.md` §12-N3(A mode PRD 寫作 5 維度 self-check)
- **依賴:** sub 1-7 全完(最後收口)
- **驗收:**
  - typecheck + lint 全綠 + adapter test 全綠
  - backlog #123 處置明確(關閉 / 縮 / 留 anchor)
  - lessons §12-N3 教訓落地(若 sub 7 收工後仍有未吸收教訓)
- **估時:** 30-40 min

---

### §2.1 sub-slice 總估時 + commit 邊界

| sub | 估時 | commit |
|---|---|---|
| 0 | 30-40 min | ✅ 獨立 docs commit(本 sub) |
| 1 | 40-50 min | ✅ 獨立 commit(原 sub 1+2 合併) |
| 3 | 30-40 min | ✅ 獨立 commit |
| 4a | 20-25 min | ✅ 獨立 commit |
| 4b | 30-40 min | ✅ 獨立 commit |
| 6 | 40-45 min | ✅ 獨立 commit(R 階段 Q4=A 不預拆) |
| 7 | 25-35 min | ✅ 獨立 commit |
| 8 | 30-40 min | ✅ 獨立 commit(刀 4 收工) |

**總估時:** 3.5-4.5 小時(8 commit、R 階段 R1=A 拍板)
**A mode 跑法:** R 階段 R2=A 拍板、Claude.ai 端 Sean 寫每 sub-slice slice 指令、Claude Code 執行、非 Code Auto Mode
**push 策略:** ahead origin/dev 累積到刀 4 全收工後 Sean 一次手動 push(8 commit 一批)
**雙 audit 時機:** 刀 4 全 8 sub 收工後跑 engineering:code-review + simplify(對齊 working-style §6.3 第 10 條)

---

## §3 風險策略

### §3.1 ?tier= production 安全 guard(R 階段 Q1=B 拍板)

**風險:** server-side searchParams 沒有 env guard、production 部署後任何訪客 URL 加 `?tier=store` 就能讓 server-rendered HTML 把 dealer 價送進瀏覽器(違背 CLAUDE.md「Server 端鐵則」)。

**處置:**
- 採 `PCM_DEV_TIER_OVERRIDE` env flag、`process.env.PCM_DEV_TIER_OVERRIDE === '1'` 才允許 `?tier=` 覆寫
- production 預設關(env 不設、生效不到)
- M-1-14 真 auth 落地後此 flag 可廢除、cookie 由 auth 寫
- 本刀 sub 3 落地時 commit body 揭示「dev-only override、不可信任 client」

### §3.2 HANDOFF v2.1 §5.5 字面 drift

**風險:** HANDOFF v2.1 §5.5 字面寫 `'PREMIUM' : '經銷'`、但實際 Pricing.jsx L62/L103 字面是 `'P價' : '店價'`。若有人讀 HANDOFF 不讀 .jsx、會落地錯字面。

**處置:**
- 本檔 §0 metadata 明示「HANDOFF v2.1 §5.5 已過時、以 .jsx 為準」
- 不在刀 4 主 commit 修 HANDOFF(對齊 §1.2 不包含)
- 留 backlog 條目(新增 #126-#127、實際 # 待 sub 8 grep 確認)
- design submodule 不在 storefront 修(Sean / Claude Design 在 pcm-website-design repo 修)

### §3.3 MockProduct 沒 priceByTier 欄位

**風險:** design Pricing.jsx 引用 `product.priceByTier.general` / `product.priceByTier.store`、storefront MockProduct shape 只有單一 `price: number`。直接搬 Pricing.jsx 會 runtime 錯。

**處置:**
- 本刀 Q4=C 採 server-side dispatch:toUIProduct 在 server 算好 effective price + originalPrice + tierLabel、`<Price>` 元件接基本型 props、不接 product 物件
- 三 tier 物件不進 client bundle(防經銷價洩漏)
- 真資料路徑(sub 4b)從 `priceByTier: PriceByTier` 算、mock 路徑從單一 price 算(general tier degraded)

### §3.4 'NT$' hardcode 與 Currency map 對應

**風險:** design Pricing.jsx hardcode `'NT$ '` prefix、未從 `Money.currency` ('TWD') 推。Phase 2 加幣別時需補 currency → symbol mapping helper。

**處置:**
- 本刀 §1.2 拍板 'NT$' hardcode 對齊 design 字面、不抽 helper
- 留 backlog anchor:「Phase 2 多幣別 trigger 抽 currency → symbol helper」
- `<Price>` 元件內 hardcode `'NT$ '`、未來改一處(rule of three)

### §3.5 元件簽名與 Q4=C 防洩漏精神拆解

**風險:** design Pricing.jsx `<Price>` 簽名接 `product / tier / brand`、與本刀 Q4=C 不傳 tier、防三 tier 物件進 client bundle 衝突。

**處置:**
- R 階段 Q3=A 拍板基本型 props(`price + originalPrice + tierLabel + ...`、不接 product / tier / brand)
- 與 Pricing.jsx 字面偏離、commit body 揭示「對齊 Q4=C 防洩漏精神、非直接搬」
- `<Price>` 元件可重用其他資料源、testability + 防洩漏雙贏

### §3.6 STATUS.md drift 重覆機率

**風險:** STATUS.md L29-L31 累積 3 commit drift(刀 1b / 刀 2 / 刀 3 / 刀 4 偵察未補)、若 sub 0 不修、刀 4 8 sub 收工後 drift 累積 11 commit。

**處置:**
- 本 sub 0 一次清(對齊 Q5b=B、PRD + STATUS 一個 docs commit)
- 後續每 sub commit 用 amend 流程補 STATUS L29(對齊 lessons §12-3 維度 B 滾動修正模式)
- 累積 §12-N 教訓:STATUS drift 由 sub-slice 內 amend 解、不留累積債

---

## §4 字面 vs 事實揭示預留

### §4.1 sub 0(本 sub)揭示方向

- PRD §3.1 安全 guard 採 `PCM_DEV_TIER_OVERRIDE` env flag、與 Claude.ai PRD v1 原寫「?tier= 無 guard」偏離、Code R 階段抗住、Sean Q1=B 拍板修訂
- PRD §2 sub 4 拆 4a/4b、原 Claude.ai PRD v1 為 sub 4+5 兩個 sub(typecheck 中途紅違反鐵則 11)、Code R 階段 raise、Sean Q2=A 拍板合併再拆
- PRD §2 sub 6 不預拆、實作中 30 min 一檢查
- STATUS L29 累積 drift 3 commit 本 sub 一次清、刀 4 code commits 從乾淨基準點起跑
- PRD §6.3 §12-N3 教訓 anchor 預留(A mode PRD 寫作 5 維度 self-check)

### §4.2 sub 1-8 揭示方向(預留)

- sub 3:`PCM_DEV_TIER_OVERRIDE` env flag dev-only、不可信任 client、production 預設關
- sub 4b:server-side dispatch 防三 tier 物件進 client bundle(對齊 Q4=C 防洩漏)
- sub 6:`<Price>` 元件簽名與 design Pricing.jsx 偏離(基本型 props、不接 product/tier/brand)、commit body 揭示對齊 Q4=C
- sub 7:ProductCard.tsx 接 `<Price>` 後、三 tier 視覺驗 commit body 揭示「三 tier 切換 dev override 驗過」
- sub 8:placeholder 清理 + wire type 二 key narrow、backlog #123 處置揭示(關 / 縮 / 留 anchor)

### §4.3 STATUS L29 累積 drift 收口

- 本 sub 0 用 amend 流程一次清 3 commit drift(刀 1b 已在 STATUS 之外、刀 2 / 刀 3 / 刀 4 偵察)
- 後續每 sub commit 走 busboy-end + amend 流程同步 STATUS L29(對齊 lessons §12-3 維度 B)
- 刀 4 全 8 sub 收工後、STATUS L29 = sub 8 hash、L30-L31 = sub 7 / sub 6 hash

---

## §5 驗收條件

### §5.1 三綠 checkpoint(對齊鐵則 11)

每 sub commit 前:
- `pnpm typecheck`(7 packages、全綠)
- `pnpm lint`(10 packages、全綠)
- 動 `.ts/.tsx` 加 `pnpm build`(全綠)
- 任一紅停下修紅再 commit、不繞道、不 disable / skip / ignore

### §5.2 視覺三 tier 驗(sub 6+7 後)

- `PCM_DEV_TIER_OVERRIDE=1 pnpm dev` 啟動
- `http://localhost:3000/` 預設 = general(純價)
- `http://localhost:3000/?tier=store` = store(劃線 general + store 價 + `'店價'` 標)
- `http://localhost:3000/?tier=premiumStore` = premium_store(劃線 general + premium 價 + `'P價'` 標)
- 無 env flag 時:`?tier=` 不生效、回 general

### §5.3 雙 audit(sub 8 收工後)

- `engineering:code-review`:全 8 commit diff 對齊 PRD §1.1 + §3 風險策略
- `simplify`:checks for over-engineering、若有 raise + 處置

### §5.4 backlog 影響面

- 關閉:#123 zeroMoney helper(若 sub 8 拍板關)
- 新增預估:#124-#127(實際 # 待 sub 8 grep 確認、含 HANDOFF §5.5 同步 / `'NT$'` Phase 2 多幣別 / LinePrice 落地 / Phase 3 ProductPage 統一)
- STATUS L29 = sub 8 hash + 不漏條目

---

## §6 教訓預留

### §6.1 已知觸發

**§12-N1:STATUS.md drift 累積 3 commit 重複機率**
- 教訓字面預留:每 sub commit 走 amend 流程同步 STATUS L29、不留累積債
- 對齊 lessons §12-3 維度 B 滾動修正模式
- 落地時機:刀 4 sub 8 收工 batch 進 lessons §12

**§12-N2:HANDOFF v2.1 §5.5 與 .jsx 字面 drift 揭示模式**
- 教訓字面預留:design 補單字面 vs 真權威 .jsx 字面不一致時、以 .jsx 為準、PRD §0 metadata 明示
- 落地時機:刀 4 sub 8 收工 batch

### §6.2 可能觸發

**§12-N3(anchor):A mode PRD 寫作 5 維度 self-check**
- 教訓字面預留:Claude.ai 寫 PRD 時、Code R 階段需檢查 5 維度(安全 / 順序 / 簽名 / 估時 / drift)、發現偏離用 multi-select 回報、不直接執行
- 觸發背景:本 PRD v1 由 Claude.ai 寫、Code R 階段 raise 5 處(安全 guard / sub 4-5 順序 / 元件簽名 / sub 6 估時 / 落地流程)、Sean R 階段拍板修訂
- 落地時機:刀 4 sub 8 收工後、視 sub 1-7 過程是否再觸發新 R 階段(若是、§12-N3 字面擴充)

### §6.3 教訓批次落地策略

- 本 sub 0 不寫 lessons §12-N(避免擴大 scope、本 sub 純 PRD docs)
- 刀 4 sub 8 收工後 batch 落地(若量 ≥ 3 條、開獨立 docs commit;若量 < 3、併 sub 8 commit)

---

## §7 backlog 影響面

### §7.1 刀 4 關閉預估

- **#123 zeroMoney helper**:placeholder 移除後 trigger 可能消失、sub 8 重評拍板「關 / 縮 / 留 anchor」

### §7.2 刀 4 新增預估(實際 # 待 sub 8 grep 確認)

| 預估 # | 條目 | 觸發 |
|---|---|---|
| #124 | HANDOFF v2.1 §5.5 字面與 .jsx 同步修(Phase 3) | §3.2 |
| #125 | 'NT$' currency → symbol helper(Phase 2 多幣別) | §3.4 |
| #126 | LinePrice 元件落地(Phase 1 cart milestone) | §1.2 |
| #127 | ProductPage / CheckoutPage 統一 `<Price>` 元件渲染(Phase 3) | §1.2 + HANDOFF §5.5 |

### §7.3 刀 4 連動 backlog(已開、本刀吸收)

- #115:storefront 公式 dispatch + memberLabel 落地(本刀核心)
- #118:Pricing.jsx 直譯(本刀 sub 6+7 吸收)
- #119:tier 來源 cookie 路徑(本刀 sub 3 吸收)
- #123:zeroMoney helper(本刀 sub 8 重評)

---

## §8 變更紀錄

| 版本 | 日期 | 變更 | 拍板 |
|---|---|---|---|
| v1 | 2026-05-12 | 初始落地、A-C-B-C-A 拍板 + R 階段 5 子拍 + R1=A 8 commit + R2=A Claude.ai 逐刀指令 Code 執行 | Sean |

---

— END —
