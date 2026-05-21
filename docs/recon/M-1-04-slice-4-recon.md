# M-1-04 候選刀 4 偵察報告(ADR-0006 + docs/architecture/server-client-boundary.md)

> **產出時間:** 2026-05-14
> **產出者:** Claude Code(純偵察、不寫推薦、不替 Claude.ai 寫 PRD)
> **任務目標:** 為 ADR-0006(server-client 邊界決策)+ `docs/architecture/server-client-boundary.md`(規範書)寫 PRD 草稿提供事實字面
> **本檔範圍:** 9 章節純事實列表、不歸納規則、不寫「應該 / 建議」、不預判 ADR 內容
> **字面 vs 事實守則(對齊 lessons §12-3 維度 A):** 每章引用字面均標檔名 + 行號;偵察過程使用 grep / cat / git show 一手取得、不憑記憶

---

## §1 既有 ADR 慣例摘要

### 1.1 檔名格式(`docs/decisions/`)

```
0001-rewrite-decision.md           182 行
0002-architecture-pivot.md         285 行
0003-domain-entity-naming.md       330 行
0004-m1-pre-launch-decisions.md    118 行
0005-custom-supabase-direct.md     268 行
```

- 格式:`NNNN-kebab-case-title.md`、四位數編號
- 下一個編號 = `0006-*`
- 字數量級:118 - 330 行(中位數約 268 行)

### 1.2 Status 欄位字面變體

| 檔 | 字面 |
|---|---|
| 0001 | `> **狀態:** 已拍板 / 2026-04-29`(無 emoji) |
| 0005 | `> **Status:** 🟢 拍板 / 2026-05-04`(有 emoji + 英文 key) |

### 1.3 metadata block 結構(0001 vs 0005)

**0001 起手 7 行 metadata:**
```
> **狀態:** 已拍板 / 2026-04-29
> **拍板人:** Sean
> **影響範圍:** 全 Phase 1
> **本檔角色:** 重大決策記錄、不可改、後續若推翻必開新 decision 檔指向本檔
```

**0005 起手 10 行 metadata(更完整):**
```
> **Status:** 🟢 拍板 / 2026-05-04
> **拍板人:** Sean(2026-05-04 Q1=A1 拍板:...)
> **影響範圍:** Phase 1 全 9 個 bounded contexts...
> **本檔角色:** 重大架構轉向、廢 ADR-0002 §1.2 Pivot 2「Medusa-as-API」、9 contexts 統一架構走 Supabase
> **層級:** docs/decisions/、衝突仲裁僅次 STATUS.md / NORTHSTAR / ADR-0001
>
> 配合閱讀:
> - `docs/decisions/0001-rewrite-decision.md`...
> - `docs/decisions/0002-architecture-pivot.md`...
```

### 1.4 章節結構(0001 vs 0005 同骨架)

| § | 名稱 |
|---|---|
| §1 | 決策摘要 / Context(背景) |
| §2 | 為什麼這個決策 / Decision(決策內容) |
| §3 | 三視角分析(擴充性 / 可維護性 / bug 可追蹤性) |
| §4-§n | 影響清單 / Rollback 訊號 / 後續 milestone 字面變更 / 變更紀錄 |

兩檔均含「三視角分析表」格式([0001:46-50](docs/decisions/0001-rewrite-decision.md#L46-L50)、0005 §5 三視角)。

---

## §2 既有 architecture docs 慣例摘要

### 2.1 檔名 + 行數(`docs/architecture/`)

```
2026-04-30-backend-and-automation-design.md   664 行
2026-04-30-claude-ai-feedback.md               360 行
2026-04-30-handoff-to-claude-ai.md             553 行
bounded-contexts.md                             81 行
dependency-rules.md                            224 行
medusa-monorepo-integration-plan.md            360 行
medusa-schema-design.md                        610 行(Superseded)
medusa-spike-verification-checklist.md         146 行(Superseded)
proposed-architecture-2026-04-30.md            363 行
scaling-triggers.md                            232 行
security-timeline.md                           204 行
supabase-schema-design.md                      625 行
testing-strategy.md                            151 行
```

格式:無數字編號、檔名 kebab-case 描述性。

### 2.2 檔頭格式(以 [supabase-schema-design.md:1-19](docs/architecture/supabase-schema-design.md#L1-L19) 為樣本)

```markdown
# Supabase Schema Design

> **Status:** 🟢 拍板 / 2026-05-04 / ADR-0005 採用後落地
> **拍板人:** Sean(ADR-0005「Custom + Supabase 直寫架構」採用)
> **層級:** docs/architecture/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0001-0005 ADR
> **本檔角色:** 9 contexts 完整 Supabase 表 schema + RLS policy + 索引策略 + 9 大藍圖預留
>
> **取代:** `docs/architecture/medusa-schema-design.md`(2026-05-04 / M-1-03-pre0b Superseded)
>
> 配合閱讀:
> - `docs/decisions/0003-domain-entity-naming.md` §4(...)
> - ... 共 9 條交叉引用
```

### 2.3 章節層級(supabase-schema-design.md 樣本)

```
# Part 1:Catalog 核心 schema
  ## §1 結構導引(Part 1)
  ## §2 Product 表
    ### 2.1 表 schema(Supabase PG)
    ### 2.2 對應 domain entity(...)
```

層級:`Part N` → `## §N` → `### N.M`、含 SQL / Markdown 表格 / inline 字面引用。

### 2.4 風格

- supabase-schema-design.md:**規範書**(具體 SQL DDL + 表格映射 + 鐵則陳述)
- bounded-contexts.md / dependency-rules.md:**規範書**(規則清單 + 違反訊號)
- 2026-04-30-*.md:**討論記錄**(早期 brainstorm)
- testing-strategy.md / scaling-triggers.md:**規範書 + 教學混合**

---

## §3 刀 1 三 commit 變更實況

### 3.1 [`0549e71`](https://github.com/pcmmotorsports/pcm-website-v2/commit/0549e71) — M-1-04-slice-1b1

```
範圍:刀 1a + 1b1 合併
變更:5 檔 +40 / -61 net -21
- apps/storefront/next-env.d.ts                       |  2 +-
- apps/storefront/src/components/FeatureEditorial.tsx | 21 ++++++--------
- apps/storefront/src/components/HomeFooter.tsx       | 33 ++++++++++------------
- apps/storefront/src/components/HomeHero.tsx         | 21 +++++---------
- apps/storefront/src/components/HomeStatement.tsx    | 24 ++++++----------
```

變更性質:
- 移除 `'use client'` + `useCallback` + `onNav` stub + `handle` wrapper
- 加 `import Link from 'next/link'`
- `<a href="#" onClick={handle}>` → `<Link href="...">`
- design 字面(className / 文字 / JSX 結構)100% 保留
- href 對映 11 條(HomeHero 1 / HomeStatement 2 / HomeFooter 6 / FeatureEditorial 1 brand-detail → /brands/rizoma)

### 3.2 [`477f249`](https://github.com/pcmmotorsports/pcm-website-v2/commit/477f249) — M-1-04-slice-1b2

```
範圍:刀 1 收口 + audit 處置 a1-a3
變更:6 檔 +193 / -43
- STATUS.md                                          |  24 ++--
- apps/storefront/src/components/BrandIndex.tsx      |  26 ++--
- apps/storefront/src/components/CategoryGrid.tsx    |  25 ++--
- apps/storefront/src/components/FeatureEditorial.tsx |   2 +-
- apps/storefront/src/data/mock-brands.ts            |   1 +
- docs/phase-1-backlog.md                            | 158 ++++
```

變更性質:
- CategoryGrid / BrandIndex 套 server + Link 範本(map dynamic template literal href)
- MOCK_BRANDS 補 RIZOMA(audit a1)
- FeatureEditorial.tsx / BrandIndex.tsx comment 修(audit a2 + a3)
- STATUS.md L12-L17 / L22-L23 / L29-L31 / L35 大幅重寫
- backlog #133-#138 開 6 條
- map dynamic href:CategoryGrid 8 cats + BrandIndex 17 brands

### 3.3 [`db978de`](https://github.com/pcmmotorsports/pcm-website-v2/commit/db978de) — Header mini-slice(刀 1 真完工)

```
範圍:Header 9 a → Link
變更:2 檔 +29 / -24 net +5
- STATUS.md                                 | 16 ++++++-------
- apps/storefront/src/components/Header.tsx | 37 +++++++++++++++++--
```

變更性質:
- Header.tsx 9 個 a 改 Link(2 logo + 7 navItems map)
- navItems array 補 href 欄位 7 條 inline
- L8 / L35-L36 註解 stale 修
- Header **保留** 'use client'(useState searchQuery/autoMobile + useEffect matchMedia + dispatchEvent + handleNav wrapper + 3 button stub + MouseEvent type)

### 3.4 三 commit 加總

- 13 檔 +262 / -128(包含 STATUS / backlog 文件)
- 純元件檔變更:HomeHero / HomeStatement / HomeFooter / FeatureEditorial / CategoryGrid / BrandIndex(6 純展示)+ Header(client 保留、9 a → Link)
- 共 14 處 `<a>` → `<Link>`(刀 1a + 1b1 11 處 + Header mini-slice 9 處 — 但 Header 2 處是同元件內 logo + 7 處 navItems,合計刀 1 範圍 14 處對應 STATUS L23 字面)

---

## §4 storefront 現存 server / client 元件清單

### 4.1 grep `'use client'` 字面命中(`apps/storefront/src/components/`)

| 檔 | 字面位置 | 註解原因(本檔內 grep) |
|---|---|---|
| [HomeHero.tsx](apps/storefront/src/components/HomeHero.tsx) | L3-L5 | 「`'use client'` 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示」 |
| [HomeStatement.tsx](apps/storefront/src/components/HomeStatement.tsx) | L4-L6 | 同上 |
| [HomeFooter.tsx](apps/storefront/src/components/HomeFooter.tsx) | L4-L9 | 同上 |
| [FeatureEditorial.tsx](apps/storefront/src/components/FeatureEditorial.tsx) | L4-L7 | 同上 |
| [BrandIndex.tsx](apps/storefront/src/components/BrandIndex.tsx) | L6-L8 | 同上 |
| [CategoryGrid.tsx](apps/storefront/src/components/CategoryGrid.tsx) | L4-L6 | 同上 |
| [VehicleFinder.tsx](apps/storefront/src/components/VehicleFinder.tsx) | L7 `'use client';` | — |
| [ProductCard.tsx](apps/storefront/src/components/ProductCard.tsx) | L10 `'use client';` | — |
| [HomeSelect.tsx](apps/storefront/src/components/HomeSelect.tsx) | L8-L9 | 「`'use client'` 因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client」 |
| [Header.tsx](apps/storefront/src/components/Header.tsx) | L14 `'use client';` | L9-L12「Header mini-slice:Header 維持 client(useState searchQuery/autoMobile + useEffect + dispatchEvent)、9 a 標籤改 `<Link href>`、3 button onClick stub 留候選刀 3」 |

### 4.2 server / client 二分

**Server components(6):**
- HomeHero / HomeStatement / HomeFooter / FeatureEditorial / BrandIndex / CategoryGrid

**Client components(4):**
- VehicleFinder / ProductCard / HomeSelect / Header

### 4.3 各 client 元件 client API 字面用途(grep `useState|useEffect|window.|useCallback|useRef`)

| 元件 | useState | useEffect | window | useCallback | useMemo | useRef | 其他 |
|---|---|---|---|---|---|---|---|
| Header | searchQuery / autoMobile | matchMedia + setInterval(autoMobile) | window.innerWidth / window.matchMedia / window.dispatchEvent('pcm-open-search') | onNavLocal | — | — | MouseEvent type, document.querySelector |
| VehicleFinder | sel(brand/model/year) | — | — | onNav | — | — | select onChange / button onClick |
| ProductCard | hover / liked / failedIdx | — | — | — | productGallery(seed) | — | onMouseEnter/Leave, onClick(props), onError |
| HomeSelect | — | — | — | onNav | — | — | MouseEvent type, onClick prop callback |

---

## §5 候選刀 3 範圍元件實況

### 5.1 [VehicleFinder.tsx](apps/storefront/src/components/VehicleFinder.tsx)(68 行)

- 'use client':L7 ✓
- client API:`useState({ brand, model, year })`(L14)+ `useCallback`(L20)
- nav 機制:button onClick(L60)`onClick={() => onNav('products', { vehicle: { brand, model, year } })}`
- `onNav` 字面 L20-L23:**d1 階段 stub、console.log**
- design 端字面:`window.PCM_DATA.motoBrands` → 改 `import { MOCK_MOTO_BRANDS }`(L1-L5 註解)
- 對外傳遞型別:`onNav(target: string, ctx?: object)`、傳 `'products'` + vehicle ctx

### 5.2 [Header.tsx](apps/storefront/src/components/Header.tsx)(144 行)

- 'use client':L14 ✓
- client API:
  - `useState`(L34 searchQuery + L50 autoMobile)
  - `useEffect`(L51-L62、matchMedia + setInterval 500ms autoMobile 偵測)
  - `useCallback`(L35 onNavLocal)
  - `window.dispatchEvent`(L47、CustomEvent 'pcm-open-search')
  - `window.innerWidth` + `window.matchMedia`(L54 / L57)
  - `document.querySelector`(L53)
- nav 機制:
  - 9 a → `<Link href>`(2 logo L86/L100 + 7 navItems L102-L108 map)✓ 已完工
  - **3 button 仍走 onClick stub**:
    - search button(mobile L81)→ `openSearch()` → window.dispatchEvent('pcm-open-search')
    - cart button(mobile L88 / desktop L131)→ `handleNav(e, 'cart')` → onNavLocal('cart')
    - account button(desktop L125)→ `handleNav(e, 'account')` → onNavLocal('account')
- onNav 傳入 props 或 fallback console.log(L36-L42)

### 5.3 [ProductCard.tsx](apps/storefront/src/components/ProductCard.tsx)(177 行)

- 'use client':L10 ✓
- client API:
  - `useState`(L66 failedIdx、L105 hover、L106 liked)
  - `useMemo`(L65 productGallery)
- nav 機制:
  - 卡片本體 onClick(L128)`onClick={onClick}` — `onClick` 由 props 傳入
  - 心形按鈕 onClick(L141)`setLiked(!liked)`(stopPropagation)
  - 加入購物車按鈕 onClick(L155)`(e) => e.stopPropagation()`(無實質動作)
  - hover swap 對 ProductImage `hover` prop 傳遞
- props 型別(L96-L102):`onClick?: () => void`(無參數型 callback)

### 5.4 [HomeSelect.tsx](apps/storefront/src/components/HomeSelect.tsx)(95 行)

- 'use client':L9 ✓(原因 L8 註解:「因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client」)
- client API:`useCallback`(L23 onNav)
- nav 機制:
  - `<a href="#" onClick={handle}>` L49(查看所有新品)— **未改 Link**(刀 1 範圍未含 HomeSelect)
  - ProductCard onClick(L88)`() => onNav('product', { productId, source, sourceLabel })`
- onNav 字面 L23-L25:**console.log stub**

### 5.5 候選刀 3 字面 nav 機制摘要

| 元件 | 待改處 | 字面 |
|---|---|---|
| VehicleFinder | L60 button | `onClick={() => onNav('products', { vehicle: {...} })}` |
| Header | L81 search button | `onClick={() => openSearch()}`(走 dispatchEvent 而非 onNav) |
| Header | L88 / L131 cart button | `onClick={(e) => handleNav(e, 'cart')}` |
| Header | L125 account button | `onClick={(e) => handleNav(e, 'account')}` |
| ProductCard | L128 article onClick + L155 加入購物車 | onClick 從 props 傳入 / e.stopPropagation 無 nav |
| HomeSelect | L49 「查看所有新品」 a | `onClick={(e) => handle(e, 'new')}`(尚未 Link) |
| HomeSelect | L88 ProductCard onClick | `() => onNav('product', { productId, ... })` |

---

## §6 design-reference 邊界提示有無

### 6.1 design-reference 實際結構(2026-05-14 偵察)

```
design-reference/
├── HANDOFF.md                       (13257 bytes、單檔)
├── README.md
├── index.html
├── assets/
│   ├── logos/
│   └── brand-logos/
├── components/                      (22 entries)
├── data/                            (8 entries)
├── design-handoff/                  (5 entries)
├── design-reference/                (12 entries、嵌套子目錄)
├── screenshots/                     (91 entries)
└── styles/                          (25 entries)
```

註:`design-handoff/` 是真實存在的子目錄(STATUS / NORTHSTAR 提到的 "9 份 HANDOFF docs" 對應 `design-reference/` 嵌套子目錄、非本目錄)。

### 6.2 grep 命中

```bash
grep -rlnE "use client|server component|client component" design-reference/
```

**結果:無命中**(0 行)。

design-reference 不涉及 server / client 邊界字面、邊界判定由 storefront 自決(對齊 STATUS / NORTHSTAR 字面「design 是視覺與 jsx 結構真權威、技術實作邊界屬 storefront 工程範圍」)。

### 6.3 design jsx 原始端字面慣例(間接證據)

storefront 元件註解多次寫:
- 「design `window.PCM_DATA.motoBrands` → 改 `import { MOCK_MOTO_BRANDS }`」([VehicleFinder.tsx:5](apps/storefront/src/components/VehicleFinder.tsx#L5))
- 「`window.Header` UMD 註冊移除(改 ES export)」([Header.tsx:6](apps/storefront/src/components/Header.tsx#L6))
- 「`window.ProductCard` / `window.ProductImage` UMD 註冊移除」([ProductCard.tsx:7](apps/storefront/src/components/ProductCard.tsx#L7))

→ design jsx 用 window UMD pattern(SPA 一檔到底)、不分 server / client。

---

## §7 Next.js 16 / React 19 版本實況

[`apps/storefront/package.json`](apps/storefront/package.json) grep 命中:

```json
"next": "16.2.6",
"react": "19.2.6",
"@types/react": "^19.2.14"
```

— 版本字面、Next 官方文件 / React 19 RSC 規範字面留 Claude.ai 寫 PRD 時自查。

---

## §8 audit 報告邊界議題索引

### 8.1 [docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md](docs/audits/M-1-03-main-a-刀-4-sub-8d-findings.md)

| 行 | 字面節錄 |
|---|---|
| L54 | `try/catch` 包 `designTierToSchema`、corrupt cookie / 攻擊 URL fallback `'general'`、防 server 端 throw |
| L58 | `eng-4: server-only runtime guard 替代 npm package` |
| L62 | `typeof window !== 'undefined'` runtime guard 替代 `server-only` npm package(對齊 d2 Sean 拍板「範圍紀律不擴張 deps」)、runtime guard 在 build time 不阻擋 client component import |
| L63 | 建議處置:現實作可接受;storefront 規模擴張可考慮加 `server-only` package(對齊 Next.js 13+ 推薦) |

### 8.2 [docs/audits/2026-05-02-full-audit.md](docs/audits/2026-05-02-full-audit.md)

| 行 | 字面節錄 |
|---|---|
| L437 | 規劃 Pricing 走 Medusa price_list + customer_group、但無對應 port。storefront server-side render 時讀 `priceByTier[customer.tier]` 直接從 Product 對象、邏輯散在 storefront / use-case / adapter、無集中 PricingService |
| L439 | 擴充性:Phase 2「廠牌折扣 + VIP + tier」三層 stack、無 IPricingService = storefront 直 import use-case 算、storefront server bundle 含計算邏輯 |
| L491 | 結帳必填 phoneNumber + address、訂單通知簡訊 / LINE 必用、Customer entity 字面無。security-timeline §C7 寫客人手機 / 地址 PII server-side 才查全 |
| L773 | T1 IPricingRepository:Phase 2 三層折扣疊加上線、無 service 抽象、storefront server bundle 含計算邏輯 |

### 8.3 [docs/reviews/](docs/reviews/)

```bash
grep -rlnE "server|client|use client" docs/reviews/
```

**結果:無命中**(0 行)。

docs/reviews/ 內僅 `M-1-03-prep-audit-2026-05-05.md` + `README.md` 兩檔、無 server / client 邊界相關字面。

### 8.4 其他可能相關文件(本偵察未檢、留 Claude.ai 寫 PRD 時自查)

- [docs/decisions/0003-domain-entity-naming.md](docs/decisions/0003-domain-entity-naming.md)(330 行、§4 9 條 wire ↔ domain mapping)
- [docs/architecture/dependency-rules.md](docs/architecture/dependency-rules.md)(224 行、邊界守門規則層級)
- [docs/architecture/security-timeline.md](docs/architecture/security-timeline.md)(204 行、#C4 priceByTier 不洩漏)

---

## §9 偵察過程觀察(純事實、不寫推薦)

### 9.1 偵察範圍

- 11 個 storefront component 檔(全部 read)
- 5 個 ADR 檔(0001 + 0005 read head -50、其餘僅 wc -l)
- 13 個 architecture 檔(supabase-schema-design.md read head -80、其餘僅 wc -l)
- 3 個刀 1 commit(`git show --stat` + commit body 全讀)
- design-reference 結構 ls + find -maxdepth 2 + grep
- 2 個 audit 檔(grep 命中 line refs)
- 2 個 reviews 檔(grep 無命中)
- 1 個 package.json(grep 版本)

### 9.2 偵察當下發現的字面差異

- **ADR Status 欄位 emoji 不一致:** 0001「狀態」無 emoji / 0005「Status」🟢 — ADR-0006 寫哪種需 Claude.ai 拍板
- **design-handoff 目錄結構與 NORTHSTAR 字面差異:** NORTHSTAR §2.1 寫「`design-reference/` 嵌套子目錄 HANDOFF docs(9 份)」、實況 `design-handoff/` 5 entries、`design-reference/design-reference/` 12 entries、`HANDOFF.md` 單檔置根、3 處 HANDOFF 字面分佈未統一(本偵察不擴張處置)
- **'use client' 註解風格不一致:** 6 server 元件 + HomeSelect 在註解內標「移除原因」/「保留原因」(自我說明)、VehicleFinder / ProductCard / Header 無對應自我說明字面(僅 design 端 UMD 改寫註解)
- **HomeSelect L49 「查看所有新品」 a 未 Link:** 刀 1 範圍未含、屬遺留待改(對應 audit 範圍未明列、本偵察不歸納)
- **audit findings sub-8d L58-63 既有「server-only runtime guard」討論:** 字面已存在於 M-1-03 audit 內、ADR-0006 不寫進去亦需引用對齊

### 9.3 偵察過程零檔案修改

- 0 git add / commit / push
- 0 dev server / typecheck / lint / test
- 1 新增 untracked:本檔(`docs/recon/M-1-04-slice-4-recon.md`)
- 0 修改既有檔案
- 0 design-reference submodule pointer 異動

### 9.4 留給 Claude.ai 寫 PRD 時自查的字面

- Next.js 16 官方對 server / client component 的字面規範(version=16.2.6)
- React 19 RSC payload / Server Actions 邊界字面
- 'server-only' npm package 引入時機(對齊 audit sub-8d L63)
- ADR-0003 §4 9 條 wire ↔ domain mapping 與 client API 邊界的交集
- security-timeline §C4 priceByTier 不洩漏 server-only 守則

— END —
