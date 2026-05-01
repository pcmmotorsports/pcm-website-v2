# PCM Phase 1 Milestones(階段 1 MVP)

> **狀態:** 🟢 已拍板、待 M-0 第一個 slice 動工
> **作者:** Claude Code(`/writing-plans` skill 產出、依 Claude.ai feedback §4 修訂版)
> **日期:** 2026-04-30
> **拍板過程:** brainstorming Q1-Q13 + Claude.ai review Q14-Q16 + 7 大組補建議 + writing-plans Q1-Q5
>
> **本檔角色:** Phase 1 階段 1 MVP 主排程、待 M-0 ~ M-6 全部完成才結束 Phase 1
>
> 衝突仲裁:STATUS.md > docs/PHASE-1-NORTHSTAR.md > 本檔 > 其他 md > 對話歷史
>
> 配合閱讀:
> - `docs/PHASE-1-NORTHSTAR.md`(Phase 1 範圍真權威)
> - `docs/architecture/2026-04-30-backend-and-automation-design.md`(主 spec)
> - `docs/architecture/2026-04-30-claude-ai-feedback.md`(修訂版 milestone 來源)
> - `docs/decisions/0002-architecture-pivot.md`(本檔依此架構執行)
> - `docs/architecture/scaling-triggers.md`(階段 2/3 觸發指標)
> - `docs/recon/design-reference-recon-2026-04-30.md`(design 字面)

---

## 0. TL;DR

PCM Phase 1 階段 1 MVP 拆 8 個 milestone(M-0 / M-1 / M-2 / M-3 / M-4a / M-5 / M-4b / M-6),約 75 個 slice、9-12 週上線。執行順序按 Claude.ai feedback §4 修訂版:M-4 拆 4a + 4b 兩段、4a 在 M-5 前(讓 Sean 上線時就能處理訂單)、4b 在 M-5 後(機器看板與權限深化)。

---

## 1. 整體 milestone 一覽表

| Milestone | 目標 | Slice 數 | 估時(工時) | 估時(週)| 主要阻塞 |
|---|---|---|---|---|---|
| M-0 | 骨架就位 + medusa-schema-design.md ⭐ | 6 | 4-5 hr | 1 週 | 無 |
| M-1 | Catalog spike + 基本 Customer + 種子資料 | 16 | 12-14 hr | 1.5-2 週 | Vehicle Finder 微調(部分) |
| M-2 | Identity 完整(三級會員)+ Pricing 雙 tier | 9 | 7-9 hr | 1-1.5 週 | 經銷申請頁 |
| M-3 | Order + 8 狀態機 + TapPay + 結帳 | 11 | 10-12 hr | 2 週 | 結帳後段、訂單詳情、TapPay 拍板 |
| M-4a | 後台 admin 商品 + 訂單 + 客服 inbox | 13 | 12-14 hr | 1.5-2 週 | 無 |
| M-5 | sync-engine + Google Sheets + 機器看板 | 9 | 7-8 hr | 1-1.5 週 | 無 |
| M-4b | 後台進階(權限細節 + 機器深化) | 3 | 2-3 hr | 0.5 週 | 無 |
| M-6 | SEO + 整合測試 + 部署上線 | 8 | 7-9 hr | 1.5-2 週 | G2 拍板、Vercel 拍板 |
| **總計** | | **~75 slice** | **~70 hr** | **9-12 週** | |

---

## 2. 估時與依賴圖

```
M-0 骨架就位
  │
  ├── packages/{domain,use-cases,ports,adapters} 空殼
  ├── apps/{admin,sync-engine} 空殼
  ├── ESLint 依賴規則守門
  ├── ports 抽象介面定義
  └── medusa-schema-design.md(Part 1 + Part 2)
                │
                ▼
M-1 Catalog spike + 基本 Customer
  │
  ├── domain/catalog + adapters/MedusaProductAdapter
  ├── packages/ui design tokens
  ├── storefront 直接搬 8 元件(Header/ProductCard/HomePage/4 篩選/ProductsPage/ProductPage)
  ├── domain/identity Customer 基本 login/register
  └── 種子資料 200 SKU 手動 import(混合策略)
                │
                ▼
M-2 Identity 完整 + Pricing
  │
  ├── 三級會員 tier(general/store/premium_store)
  ├── server-side tier 驗證(鐵則:不信任 client)
  ├── 經銷申請流程 + Pricing 雙 tier
  └── storefront AccountPage 6 tab + tier-aware price
                │
                ▼
M-3 Order + 8 狀態機 + TapPay
  │
  ├── domain/order(雙維度 8 狀態)
  ├── 訂單狀態機 use-cases
  ├── calculate-shipping use-case
  ├── storefront CartPage / 結帳 / 訂單詳情
  └── premium_store 自動升級
                │
                ▼
M-4a 後台 admin 商品 + 訂單管理
  │
  ├── apps/admin Next.js 骨架 + @pcm/ui tokens
  ├── 三合一主畫面(儀表板/收件匣/數據)
  ├── 商品 CRUD + 待審核
  ├── 訂單列表 + 8 狀態流轉
  ├── 客服 inbox
  └── 改金額紅線 UI
                │
                ▼
M-5 sync-engine + Sheets
  │
  ├── apps/sync-engine + node-cron
  ├── adapters/sheets-api(Service Account)
  ├── 商品候選同步 + 報價變動 + 庫存自動
  └── 機器狀態看板 + daily summary email
                │
                ▼
M-4b 後台進階
  │
  ├── 員工權限細節
  ├── 機器看板深化
  └── 改金額審核 workflow
                │
                ▼
M-6 SEO + 整合測試 + 部署
  │
  ├── SEO meta + structured data + sitemap
  ├── E2E 主流程
  └── Vercel + Railway production
```

---

## 3. M-0 骨架就位

### 3.1 目標

建立 monorepo 4 packages + 2 apps 空殼、寫 ESLint 依賴規則守門、定義 ports 抽象介面、產出 medusa-schema-design.md + ADR-0003(domain entity 命名)+ slice-checkpoint 規範 + busboy-end L2 pre-flight + security-timeline 安全時序統一表(架構決策支撐文件)。讓 M-1 之後所有 milestone 在這基礎上走、不必反覆改 schema。

### 3.2 範圍

**做:**
- packages/{domain, use-cases, ports, adapters} 4 個空殼(只含 package.json + index.ts)
- apps/{admin, sync-engine} 2 個 Next.js / Node.js 空殼
- ESLint 規則守門依賴方向(domain ← ports ← use-cases ← adapters / apps)
- ports 抽象介面定義(IProductRepository / ICustomerRepository / IOrderRepository / ISheetsAdapter / ITapPayAdapter)
- ⭐ docs/architecture/medusa-schema-design.md(product 全欄位對應 / tier price 存法 / 訂單狀態機對應 Medusa / ports 介面簽名 / Medusa vs Supabase 責任分割表)
- ⭐ docs/decisions/0003-domain-entity-naming.md(C3 拍板 A2 Domain 獨立命名 + 9 衝突處置表 + 三視角 Rationale + Rollback 訊號)
- ⭐ docs/patterns/slice-checkpoint.md + CLAUDE.md L1 補強(C5 拍板 L1+L2 的 L1 規則層、鐵則 11 + 自檢清單外掛)
- ⭐ docs/architecture/security-timeline.md(C4 拍板 C 三權分立、Phase 1 安全時序統一表)
- ⭐ pcm-tools/scripts/busboy-end.js L2 pre-flight 三綠檢查(C5 L2 工具層、跨 repo)

**不做:**
- domain entities 實作(M-1 起逐 context 做)
- adapters 實作(M-1 起依需求補)
- 任何 storefront / admin UI(M-1 起)

### 3.3 依賴

- 前置:setup 4 件已完成(Supabase / Vercel / Railway / GCP)
- 阻塞:無
- 待 Sean 拍板:無

### 3.4 估時

7-9 工時、約 1.5 週(含 C3 / C4 / C5 拍板落地)。

### 3.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-0-01 | packages/{domain, use-cases, ports, adapters} 4 個空殼 + tsconfig | 30 min | 無 | — |
| M-0-02 | apps/{admin, sync-engine} 2 個空殼 + tsconfig | 30 min | 無 | M-0-01 |
| M-0-03 | ESLint 依賴規則守門設定(eslint-plugin-boundaries) | 45 min | 無 | M-0-01 |
| M-0-04 | ports 抽象介面定義(I*Repository / I*Adapter 簽名) | 45 min | 無 | M-0-01 |
| M-0-05 | medusa-schema-design.md Part 1: product / brand / category mapping + tier price | 45 min | 無 | M-0-04 |
| M-0-06 | medusa-schema-design.md Part 2: order state machine + ports + responsibility split | 45 min | 無 | M-0-05 |
| M-0-07 | C3 ADR-0003 + C5 L1 規則 + NORTHSTAR §1.1 補敘 + backlog #6.1/#7 + M-0 排程 patch | 90-120 min | 無 | M-0-01b |
| M-0-08 | C4 三權分立 — security-timeline.md(Phase 1 安全時序統一表) | 60-90 min | 無 | M-0-07 |
| M-0-09 | C5 L2 工具層 — busboy-end.js pre-flight 三綠檢查(跨 repo pcm-tools) | 45-60 min | 無 | M-0-07 |

### 3.6 驗收條件

- [ ] `pnpm install` 全綠、no warnings
- [ ] `pnpm lint` 跑 ESLint 依賴規則、刻意違規 import 跳錯
- [ ] `pnpm typecheck` 全綠
- [ ] `docs/architecture/medusa-schema-design.md` 兩個 Part 寫完、引用 9 條 design vs Medusa 衝突(來自 design-reference-recon §7)、含 ports 介面簽名
- [ ] `docs/decisions/0003-domain-entity-naming.md` 完整(含 9 衝突處置表 + 三視角 Rationale + Rollback 訊號)
- [ ] `docs/patterns/slice-checkpoint.md` 完整(L1 / L2 / L3 三層關係明確、字面 vs 事實守則完整)
- [ ] `docs/architecture/security-timeline.md` 完整(對應每項到 milestone + 驗收條件)
- [ ] `busboy-end.js` 跑「typecheck 紅」狀態 → 拒絕 amend STATUS、提示 Code 修紅

### 3.7 風險與緩解

- **風險:** medusa-schema-design.md 估時 1-2 hr、超 45 min 上限。寫到一半發現新衝突會卡。
- **緩解:** 拆 Part 1 / Part 2 兩 slice。Part 1 先處理 product / brand / category(已有 design 9 條衝突清單)、Part 2 處理訂單狀態機(已有 brainstorming 拍板)。新衝突進 backlog、不擴張本 slice。
- **三視角帶到:** 擴充性 — 9 contexts 邊界先定 / 可維護性 — 介面簽名先定 ; bug 可追蹤性 — 責任分割表清楚每個錯找誰。

- **風險:** M-0-07 / 08 / 09 文件層集中規劃、若拍板出新衝突會卡。
- **緩解:** Sean 已拍 C3=A2 / C4=C / C5=L1+L2、無新衝突可能。新衝突進 backlog #8+ 不擴張本三 slice。

---

## 4. M-1 Catalog spike + 基本 Customer

### 4.1 目標

直接搬 design 8 個前台元件(Header / ProductCard / HomePage / FilterSide / FilterTop / FilterDrawer / ProductsPage / ProductPage)+ LoginPage / RegisterPage、後端建 domain/catalog + domain/identity 基本實作、種子資料 200 個熱門 SKU 手動 import。客人能瀏覽商品、登入、加購物車(僅前端 cart state、結帳 M-3 才接)。

### 4.2 範圍

**做:**
- packages/ui design tokens 直接搬 tokens.css
- packages/ui useCascadeFilter hook(三 Filter 共用、避免複製貼上、對齊 Q2 拍板)
- domain/catalog entities + ports + InMemoryProductRepository(test) + MedusaProductAdapter(real)
- domain/identity Customer + ports + MedusaCustomerAdapter(login / register)
- storefront 8 元件直接搬 + 對應 css
- Vercel deploy fix(vercel.json + ENABLE_EXPERIMENTAL_COREPACK=1、解 setup §10.3 deploy fail)
- 種子資料:Sean 手動精選 200 個熱門 SKU + Sheets 一次性 import 腳本(Q5 拍板混合策略)

**不做:**
- 三級會員 tier 機制(M-2)
- 加購物車後的結帳流程(M-3)
- AccountPage(M-2)
- Vehicle Finder 改良「我的車」按鈕(待 Claude Design 微調、HomePage 部分阻塞、不阻 milestone)

### 4.3 依賴

- 前置:M-0 完成
- 阻塞:Vehicle Finder 「我的車」按鈕微調 → HomePage 部分功能延後(不阻 M-1 整體)
- 待 Sean 拍板:無

### 4.4 估時

12-14 工時、約 1.5-2 週。

### 4.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-1-01 | Vercel deploy fix(vercel.json + ENABLE_EXPERIMENTAL_COREPACK=1) | 30 min | 無 | M-0 完成 |
| M-1-02 | domain/catalog entities + InMemoryProductRepository + tests | 45 min | 無 | M-0-04 |
| M-1-03 | adapters/MedusaProductAdapter + storefront 連通 | 45 min | 無 | M-1-02 |
| M-1-04 | packages/ui design tokens 直接搬 tokens.css | 30 min | 無 | M-0-01 |
| M-1-05 | storefront: Header.tsx 直接搬 + header.css | 45 min | 無 | M-1-04 |
| M-1-06 | storefront: ProductCard.tsx 直接搬 + product-card.css | 45 min | 無 | M-1-04 |
| M-1-07 | storefront: HomePage.tsx 直接搬 + home.css | 45 min | Vehicle Finder 「我的車」按鈕(部分、不阻 commit) | M-1-05 / 06 |
| M-1-08 | packages/ui useCascadeFilter hook 抽出(三 Filter 共用邏輯) | 30 min | 無 | M-1-04 |
| M-1-09 | storefront: FilterSide.tsx 直接搬 + filter-side.css | 45 min | 無 | M-1-08 |
| M-1-10 | storefront: FilterTop.tsx 直接搬(含 CascadeFilterTop)+ filter-top.css | 45 min | 無 | M-1-08 |
| M-1-11 | storefront: FilterDrawer.tsx 直接搬 + filter-drawer.css | 45 min | 無 | M-1-08 |
| M-1-12 | storefront: ProductsPage.tsx 整合 4 篩選 + products-page.css | 45 min | 無 | M-1-09 / 10 / 11 |
| M-1-13 | storefront: ProductPage.tsx 直接搬(584 行最大檔)+ product-page.css | 60 min | 無 | M-1-06 |
| M-1-14 | domain/identity Customer + ports + MedusaCustomerAdapter(login / register API) | 45 min | 無 | M-0-04 |
| M-1-15 | storefront: LoginPage + RegisterPage 直接搬 + auth.css | 45 min | 無 | M-1-14 |
| M-1-16 | 種子資料 import:200 SKU 手動精選 + Sheets 一次性 import 腳本 | 45 min | 無 | M-1-03 |

### 4.6 驗收條件

- [ ] Vercel deploy 綠(pnpm 9.15+ 識別)
- [ ] storefront 啟動、首頁 / 商品列表 / 商品詳情 / 登入 / 註冊 5 頁可瀏覽
- [ ] 4 種 filterStyle(top / side / drawer / cascade)桌機 + 手機都能跑
- [ ] 200 個 SKU 在前台正確顯示(品名 / 價格 / 圖片 / 篩選)
- [ ] storefront 任一檔 < 400 行(FilterTop 471 行需檢查、必要時拆 sub-component)
- [ ] `pnpm typecheck + lint` 全綠

### 4.7 風險與緩解

- **風險 1:** ProductsPage 連同 4 篩選共 ~1,600 行 TSX、單檔過大。
- **緩解:** Q2 已拍板拆 4 slice + cascade hook 抽 packages/ui、每檔 < 400 行對齊鐵則 6。
- **風險 2:** design 9 條衝突(brand 字串 vs ID / category 巢狀 vs 字串 / fits 自由字串 vs vehicleIds 等、recon §7)。
- **緩解:** medusa-schema-design.md 已先決定處置(M-0-05/06)、M-1 直接套用。
- **風險 3:** 種子資料 200 SKU 手動精選費時(Sean 在外)。
- **緩解:** import 腳本先寫好、Sean 在 Sheets 排好之後一鍵 import。
- **三視角帶到:** 擴充性 — useCascadeFilter hook 之後 admin filter 也可用 / 可維護性 — Filter 三檔獨立 < 400 行 / bug 可追蹤性 — domain test 用 InMemory adapter、不需 Medusa 啟動。

---

## 5. M-2 Identity 完整 + Pricing

### 5.1 目標

完整實作三級會員 tier(general / store / premium_store)+ server-side tier 驗證(鐵則:不信任 client)+ 經銷申請流程 + 雙 tier 價格(Medusa Price List)+ 前台 AccountPage 6 tab。

### 5.2 範圍

**做:**
- domain/identity tier 三級會員
- server-side tier 驗證 use-case(Sean 手動改 tier 場景)
- 經銷申請流程 backend(申請 entity + admin 審核 → tier 升級)
- vehicle schema 預留(Phase 1 customer.metadata.vehicles + Phase 2 獨立 entity 介面預留)
- Medusa Price List 雙 tier(retail / wholesale)
- storefront AccountPage 6 tab 直接搬
- storefront tier-aware price 顯示(server-side render)
- storefront 經銷申請頁(BLOCKED:等 Claude Design)

**不做:**
- premium_store 自動升級邏輯(依賴 Order entity、移到 M-3-11)
- 三級客人在後台 admin 看到的 UI 區分(M-4a)

### 5.3 依賴

- 前置:M-1 完成
- 阻塞:M-2-07 經銷申請頁等 Claude Design
- 待 Sean 拍板:無

### 5.4 估時

7-9 工時、約 1-1.5 週。

### 5.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-2-01 | domain/identity tier(general / store / premium_store)+ Customer.tier 欄位 | 45 min | 無 | M-1-14 |
| M-2-02 | server-side tier 驗證 use-case(client 不信任、不洩經銷價) | 45 min | 無 | M-2-01 |
| M-2-03 | storefront: AccountPage 直接搬 (overview / orders / favorites 3 tab) | 60 min | 無 | M-1-15 |
| M-2-04 | storefront: AccountPage 剩 3 tab(vehicles / address / profile) | 45 min | 無 | M-2-03 |
| M-2-05 | vehicle schema 預留(Phase 1 customer.metadata.vehicles + Phase 2 獨立 entity 介面預留) | 45 min | 無 | M-2-01 |
| M-2-06 | 經銷申請流程 backend(申請 entity + admin 審核 → tier 升級) | 45 min | 無 | M-2-02 |
| M-2-07 | storefront: 經銷申請頁直接搬 | 45 min | **[BLOCKED:等 Claude Design 補經銷申請頁]**<br>unblock 條件:design-reference/dealer-apply/ 出現對應 .jsx + .css<br>阻塞時可平行:M-2-08 / M-2-09 | M-2-06 |
| M-2-08 | Pricing:Medusa Price List 雙 tier(retail / wholesale) | 45 min | 無 | M-2-01 |
| M-2-09 | storefront: tier-aware price 顯示(server-side render、按 customer.tier 顯示對應價) | 45 min | 無 | M-2-08 |

### 5.6 驗收條件

- [ ] 一般會員看到 retail 價、店家會員看到 wholesale 價
- [ ] client devtools 改 tier 不影響後端驗證(server 重新檢查)
- [ ] AccountPage 6 tab 全部可瀏覽、地址 / 車輛持久化 localStorage
- [ ] 經銷申請流程 backend 可跑(M-2-07 因 Claude Design 阻塞、前台不可申請、但 backend API 可手動測)
- [ ] `pnpm typecheck + lint` 全綠

### 5.7 風險與緩解

- **風險:** server-side tier 驗證若漏一處、經銷價可能洩漏到一般會員瀏覽器(CLAUDE.md 鐵則 Server 端)。
- **緩解:** ESLint 規則(M-0-03)禁止 client component import @/lib/prisma。tier 驗證 use-case 集中、admin / storefront 都呼叫同一個。
- **三視角帶到:** 擴充性 — premium_store 升級邏輯切到 M-3-11、不卡 M-2 / 可維護性 — 雙 tier Price List 是 Medusa 內建、無需自寫 / bug 可追蹤性 — server log tier 切換時機。

---

## 6. M-3 Order + 8 狀態機 + TapPay

### 6.1 目標

實作訂單 8 狀態雙維度狀態機(payment_status × fulfillment_status、brainstorming Q9-10 拍板)、calculate-shipping use-case、TapPay sandbox 整合、storefront 結帳 / 訂單詳情頁(BLOCKED 兩頁)、premium_store 自動升級。

### 6.2 範圍

**做:**
- Railway deploy fix(Medusa env vars、解 setup §10.3 deploy fail)
- domain/order(雙維度 8 狀態)+ 訂單狀態機 use-cases
- ports/IOrderRepository + Medusa cart/order adapter
- calculate-shipping use-case(滿 NT$4,000 免運 + 偏遠 + 兩種運送)
- storefront CartPage 直接搬 + 接 Medusa cart API
- storefront 結帳前段(填地址 / 選運送 / 填發票)
- storefront 結帳後段(運送 / 付款 / 確認)— **BLOCKED**
- storefront 訂單詳情頁 — **BLOCKED**
- TapPay sandbox 整合
- premium_store 自動升級(從 M-2-10 移過來、依賴 Order entity)

**不做:**
- 發票自動化(綠界 / 藍新 / 國稅局)— A3 待拍板、Phase 1 階段 1 是否做未定
- LINE 通知客人(階段 3)

### 6.3 依賴

- 前置:M-2 完成
- 阻塞:M-3-07(結帳後段)、M-3-09(訂單詳情頁)等 Claude Design
- **待 Sean 拍板**:啟動前需拍 A3(發票自動化)+ TapPay(sandbox 沿用 / 重申請)

### 6.4 估時

10-12 工時、約 2 週。

### 6.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-3-01 | Railway deploy fix(Medusa env vars: DATABASE_URL / JWT_SECRET / COOKIE_SECRET) | 30 min | 無 | M-2 完成 |
| M-3-02 | domain/order entity(8 狀態雙維度: payment_status × fulfillment_status)+ tests | 60 min | 無 | M-0-04 |
| M-3-03 | 訂單狀態機 use-cases(MarkSupplierOrdered / MarkInStock / MarkShipped) | 45 min | 無 | M-3-02 |
| M-3-04 | ports/IOrderRepository + Medusa cart/order adapter | 45 min | 無 | M-3-02 |
| M-3-05 | calculate-shipping use-case(滿 4000 免運 + 偏遠加 200 + 寄店家固定 100) | 45 min | 無 | M-3-02 |
| M-3-06 | storefront: CartPage 直接搬 + 接 Medusa cart API | 60 min | 無 | M-3-04 |
| M-3-07 | storefront: 結帳後段(運送 / 付款 / 確認下單) | 45 min | **[BLOCKED:等 Claude Design 補結帳後段頁]**<br>unblock 條件:design-reference/checkout-success/ 出現對應 .jsx + .css<br>阻塞時可平行:M-3-08 / M-3-10 | M-3-06 |
| M-3-08 | storefront: TapPay sandbox 整合 | 45 min | 啟動前需拍板 TapPay(sandbox 沿用 / 重申請) | M-3-06 |
| M-3-09 | storefront: 訂單詳情頁 | 45 min | **[BLOCKED:等 Claude Design 補訂單詳情頁]**<br>unblock 條件:design-reference/order-detail/ 出現對應 .jsx + .css<br>阻塞時可平行:M-3-10 / M-3-11 | M-3-04 |
| M-3-10 | storefront: account/orders tab 接真資料(從 M-2-04 hardcode 改 dynamic) | 30 min | 無 | M-3-04, M-2-04 |
| M-3-11 | premium_store 自動升級邏輯(累積已出貨 ≥ NT$ 100,000、退款扣回) | 45 min | 無 | M-3-02 |

### 6.6 驗收條件

- [ ] Railway deploy 綠
- [ ] domain/order test 8 狀態流轉跑通(in-memory)
- [ ] 客人下單 → TapPay sandbox 付款 → 訂單建立 → admin 看到(M-4a 才能看)
- [ ] calculate-shipping 算 4 種情境(滿 / 不滿 / 偏遠 / 寄店家)正確
- [ ] CartPage / 結帳前段可瀏覽(後段 BLOCKED 標記清楚)
- [ ] account/orders 顯示客人真實訂單

### 6.7 風險與緩解

- **風險 1:** 訂單 8 狀態雙維度 Medusa 內建只覆蓋 payment_status、fulfillment_status 4 階段是 PCM 自家(brainstorming Q3=C 拍板)。
- **緩解:** Medusa 內建 fulfillment_status 不用、PCM 自家 domain Order.fulfillment_status 寫 4 階段 enum、UI 顯示由兩維度組合算。
- **風險 2:** TapPay sandbox 沿用舊環境 vs 重申請未拍板、可能阻 M-3-08。
- **緩解:** 啟動 M-3 前拍板。若沿用 → M-3-08 走 30 min;若重申請 → M-3-08 走 60 min(申請 + 等審核)、不阻其他 slice。
- **風險 3:** 兩個 BLOCKED slice(M-3-07 / M-3-09)、若 Claude Design 一直沒補、M-3 milestone 無法完整收尾。
- **緩解:** 平行推進 M-3-08 / M-3-10 / M-3-11、3 個 slice 不阻塞。BLOCKED slice 進「Claude Design 阻塞清單」(本檔 §12)。
- **三視角帶到:** 擴充性 — 8 狀態 enum 之後加新狀態(階段 3 物流 API)只動 enum / 可維護性 — 雙維度比單維度更直覺對 Sean 的 B2B 月結邏輯 / bug 可追蹤性 — 狀態流轉每次寫 audit log。

---

## 7. M-4a 後台 admin 商品 + 訂單管理

### 7.1 目標

apps/admin Next.js 後台上線、Sean 上線時就能處理客人訂單。三合一主畫面(儀表板 + 收件匣 + 數據)、商品 CRUD、訂單管理 8 狀態流轉、客服 inbox、改金額紅線 UI。

### 7.2 範圍

**做:**
- apps/admin Next.js 骨架 + @pcm/ui design tokens 接通(M-1-04 前提)
- admin layout(sidebar + topbar + 三 tab 主畫面)
- 三 tab 主畫面(儀表板紅綠燈 / 收件匣時間流 / 數據今日銷售)
- 商品列表 + 編輯(內文 / 圖片 / 售價 + 經銷價)
- 商品待審核 + approve / reject(M-5 sync-engine 才有候選、M-4a 先做框)
- 訂單列表 + 8 狀態雙維度篩選 + 詳情 + 狀態流轉 + 物流單號
- 會員列表 + tier 改 + 經銷申請審核
- 客服 inbox 基本版(LINE / Email / 電話紀錄、員工處理)
- 改金額紅線 UI(員工 disabled + 通知 Sean inbox)

**不做:**
- 員工權限細節 server-side enforce(M-4b)
- 機器狀態看板(M-5)
- 改金額審核 workflow 完整版(M-4b)

### 7.3 依賴

- 前置:M-3 完成、M-1-04 packages/ui design tokens 完整交付(Q16-A 前提)
- 阻塞:無
- 待 Sean 拍板:無

### 7.4 估時

12-14 工時、約 1.5-2 週。

### 7.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-4a-01 | apps/admin Next.js 骨架 + @pcm/ui tokens 接通 | 45 min | 無 | M-1-04 |
| M-4a-02 | admin layout(sidebar + topbar + 三 tab 主畫面 frame) | 45 min | 無 | M-4a-01 |
| M-4a-03 | admin/dashboard 紅綠燈 tab(待審核 / 待出貨 / 機器跑中) | 45 min | 無 | M-4a-02 |
| M-4a-04 | admin/inbox 收件匣 tab(時間流活動歷史) | 45 min | 無 | M-4a-02 |
| M-4a-05 | admin/dashboard 數據 tab(今日銷售 / 待出貨 / 缺貨) | 45 min | 無 | M-4a-03 |
| M-4a-06 | admin/products 列表 + 編輯(內文 / 圖片 / 售價 / 經銷價) | 60 min | 無 | M-1-04 |
| M-4a-07 | admin/products 待審核 + approve / reject(候選表結構) | 45 min | 無 | M-4a-06 |
| M-4a-08 | admin/orders 列表 + 8 狀態雙維度篩選 | 45 min | 無 | M-3-04 |
| M-4a-09 | admin/orders 詳情 + 狀態流轉 + 物流單號 | 60 min | 無 | M-4a-08 |
| M-4a-10 | admin/customers 列表 + tier 改 | 45 min | 無 | M-2-02 |
| M-4a-11 | admin/customers 經銷申請審核 | 45 min | 無 | M-2-06 |
| M-4a-12 | admin/inbox 客服分頁(LINE / Email / 電話紀錄) | 60 min | 無 | M-4a-04 |
| M-4a-13 | admin: 改金額紅線 UI(員工 disabled + 通知 Sean inbox) | 45 min | 無 | M-4a-06, M-4a-04 |

### 7.6 驗收條件

- [ ] Sean 登入 admin、看到三 tab 主畫面、紅綠燈正確
- [ ] 商品 CRUD 跑通(新增 / 編輯 / 刪除)
- [ ] 訂單從 M-3 客人下單後 → admin 列表看到 → 8 狀態流轉跑通 → 加物流單號
- [ ] 員工帳號(權限低)登入、改金額按鈕變灰、提示「需 Sean 權限」
- [ ] 客服 inbox 員工可寫紀錄

### 7.7 風險與緩解

- **風險:** Q16-A 拍板 admin 用 @pcm/ui tokens 自組、不用 Claude Design 精緻 design。tokens 是否夠用看 M-1-04 完整度。
- **緩解:** M-1-04 必須完整交付 packages/ui design tokens(設計 review checkpoint)。如不完整、M-4a-01 卡住、必須先回頭補 M-1-04。
- **三視角帶到:** 擴充性 — admin 加新頁只組 tokens / 可維護性 — admin 跟 storefront 共用 packages/ui、token 改一處同步 / bug 可追蹤性 — admin URL 對應 page 邏輯一目了然。

---

## 8. M-5 sync-engine + Sheets

### 8.1 目標

apps/sync-engine Node.js daemon 上線(本機專屬電腦 24/7)、每小時讀 Google Sheets 報價、自動產生「商品候選」進後台「待審核」清單、報價變動告警、庫存自動更新、機器狀態看板、daily summary email。

### 8.2 範圍

**做:**
- apps/sync-engine 骨架(Node.js daemon + node-cron + .env)
- adapters/sheets-api(Service Account JSON、setup §10.1 已完成)
- use-cases/sync-product-candidates(對照既有 SKU + 寫候選表)
- use-cases/detect-price-changes(hash diff + 告警 inbox)
- use-cases/auto-update-inventory(僅 stock 變動 auto、無需審核)
- sync-engine HTTP endpoint(localhost API:立即同步 / 暫停 / 日誌)
- admin/dashboard 機器狀態看板
- 報價變動告警 UI(admin/inbox)
- daily summary email(cron 每天 9 AM 寄 Sean、F1 兩層保險之第二層)

**不做:**
- AI 寫商品內文(階段 2)
- 圖片自動處理(階段 2)
- 廠商網站爬蟲(階段 2)
- LINE OA 通知(階段 3)

### 8.3 依賴

- 前置:M-4a 完成、GCP Service Account JSON 已就位(setup §10.1)
- 阻塞:無
- 待 Sean 拍板:無

### 8.4 估時

7-8 工時、約 1-1.5 週。

### 8.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-5-01 | apps/sync-engine 骨架(Node.js daemon + node-cron + .env) | 45 min | 無 | M-0-02 |
| M-5-02 | adapters/sheets-api(Service Account JSON 讀 Sheets、用 setup §10.1 已就位的 key) | 45 min | 無 | M-5-01 |
| M-5-03 | use-cases/sync-product-candidates(對照既有 SKU + 寫候選表) | 45 min | 無 | M-5-02, M-4a-07 |
| M-5-04 | use-cases/detect-price-changes(hash diff + 告警 inbox) | 45 min | 無 | M-5-03 |
| M-5-05 | use-cases/auto-update-inventory(僅 stock 變動 auto、無需審核) | 45 min | 無 | M-5-03 |
| M-5-06 | sync-engine HTTP endpoint(localhost API:立即同步 / 暫停 / 日誌) | 45 min | 無 | M-5-01 |
| M-5-07 | admin/dashboard 機器狀態看板(上次 / 下次 / 立即 / 暫停 button) | 45 min | 無 | M-5-06, M-4a-03 |
| M-5-08 | 報價變動告警 UI(admin/inbox 內) | 30 min | 無 | M-5-04, M-4a-04 |
| M-5-09 | daily summary email(cron 每天 9 AM 寄 Sean、含失敗 3 次紅字標) | 45 min | 無 | M-5-03 |

### 8.6 驗收條件

- [ ] sync-engine 在本機跑、每小時自動讀 Sheets
- [ ] Sheets 加新 SKU → admin/products 待審核出現
- [ ] Sheets 改價 → admin/inbox 出現報價變動告警
- [ ] Sheets 改庫存 → 商品 inventory 自動更新(無需審核)
- [ ] admin/dashboard 機器狀態看板正確顯示上次同步 / 下次 / 跑成功
- [ ] daily summary email 09:00 收到、內容正確

### 8.7 風險與緩解

- **風險 1:** sync-engine 在本機、電腦壞了會停。setup §10.1 已寫到「2 小時沒同步紅燈」+ 「daily email」兩層保險(F1 拍板)。
- **緩解:** F1 兩層保險覆蓋(被動紅燈 + 主動 email)、Sean 不必登入後台也能知道機器狀態。
- **風險 2:** Sheets 結構若廠商改、parser 會壞。
- **緩解:** Sheets 結構固定(brainstorming spec §9.2、Sean 跟廠商談好)、變動先進 admin/inbox 告警不直接寫 candidate。
- **三視角帶到:** 擴充性 — adapters/sheets-api 將來可換成 vendor-crawler(階段 2)同 ports / 可維護性 — sync-engine 完全獨立 process、不影響 storefront / admin / bug 可追蹤性 — 每次 sync 寫 audit log、Sean 可看跑了什麼。

---

## 9. M-4b 後台進階(權限 / 機器深化)

### 9.1 目標

員工權限細節 server-side enforce(M-4a-13 只是 UI disabled、後端必須再驗一次)、機器狀態看板深化(錯誤日誌 / 跑了什麼 / 暫停按鈕完整)、改金額審核 workflow 完整版。

### 9.2 範圍

**做:**
- admin 員工權限細節(透明型 + 改金額紅線 server-side enforce)
- admin/machine 機器狀態深化(錯誤日誌 / 跑了什麼 / 暫停按鈕)
- admin/inbox 改金額審核 workflow(員工提案 → Sean 批准 → 改價)

**不做:**
- LINE OA 通知 Sean(階段 3)
- 員工角色細分(會計 / 客服)— Phase 1 階段 1 只分 Sean / 員工兩級

### 9.3 依賴

- 前置:M-5 完成
- 阻塞:無
- 待 Sean 拍板:無

### 9.4 估時

2-3 工時、約 0.5 週。

### 9.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-4b-01 | admin 員工權限細節(透明型 + 改金額紅線 server-side enforce) | 45 min | 無 | M-4a-13 |
| M-4b-02 | admin/machine 機器狀態深化(錯誤日誌 / 跑了什麼 / 暫停按鈕完整) | 45 min | 無 | M-5-07 |
| M-4b-03 | admin/inbox 改金額審核 workflow(員工提案 → Sean 批准 → 改價) | 45 min | 無 | M-4b-01 |

### 9.6 驗收條件

- [ ] 員工 API 直接打改金額 endpoint(繞過 UI)、server 拒絕並 log
- [ ] 機器掛了、admin/machine 看得到錯誤日誌、能 restart
- [ ] 員工提改金額提案 → Sean inbox 收 → 批准後實際改價

### 9.7 風險與緩解

- **風險:** server-side enforce 漏一條、員工可繞過 UI 改金額。
- **緩解:** 集中 use-case(`packages/use-cases/update-product-price.ts`)、admin 任何路徑都呼叫同一個、use-case 內驗 customer.role === 'sean'。
- **三視角帶到:** 擴充性 — Phase 2 加會計 / 客服角色、只動 role enum / 可維護性 — server-side enforce 是 single source of truth / bug 可追蹤性 — 改金額有 audit log。

---

## 10. M-6 SEO + 整合測試 + 部署

### 10.1 目標

SEO meta + structured data + sitemap 全頁 day 1 起(NORTHSTAR §1.1)、E2E 主流程跑通、Vercel + Railway production 部署、上線驗收。

### 10.2 範圍

**做:**
- SEO meta tags 各 page type(Product / Brand / Category / Order)
- structured data schema.org(Product / BreadcrumbList / Organization)
- sitemap.xml 動態
- robots.txt + OG image
- E2E 主流程 happy path:瀏覽 → 加購 → 結帳 → 後台出貨
- Vercel production env vars + production build
- Railway production env vars + production build
- 上線前 checklist 走完

**不做:**
- TapPay production 切換(NORTHSTAR §1.2:Phase 1 用 sandbox 即可、上線時切 production 是 Phase 1 收尾事件、非 milestone slice)
- LINE OA 通知(階段 3)
- 自訂網域綁定(NORTHSTAR §1.2:Phase 1 跑 Vercel preview URL 即可)

### 10.3 依賴

- 前置:M-4b 完成
- 阻塞:無
- **待 Sean 拍板**:啟動前需拍 G2(測試覆蓋率 + E2E 範圍)+ Vercel(新建 / 沿用)

### 10.4 估時

7-9 工時、約 1.5-2 週。

### 10.5 Slice 列表

| Slice ID | 任務名 | 估時 | blocker | 依賴 |
|---|---|---|---|---|
| M-6-01 | SEO meta tags 各 page type(Product / Brand / Category / Order) | 45 min | 無 | M-1-13 |
| M-6-02 | structured data schema.org(Product / BreadcrumbList / Organization) | 45 min | 無 | M-6-01 |
| M-6-03 | sitemap.xml 動態 | 30 min | 無 | M-6-01 |
| M-6-04 | robots.txt + OG image | 30 min | 無 | M-6-03 |
| M-6-05 | E2E 主流程 happy path(瀏覽 → 加購 → 結帳 → 後台出貨) | 60 min | 啟動前需拍板 G2(覆蓋率 / E2E 範圍) | M-4a 完成 |
| M-6-06 | Vercel production env vars + production build | 30 min | 啟動前需拍板 Vercel(新建 / 沿用) | M-1-01 |
| M-6-07 | Railway production env vars + production build | 30 min | 無 | M-3-01 |
| M-6-08 | 上線前 checklist 走完(lessons-learned 規範 + 連續一週 lint / typecheck / build 三綠) | 60 min | 無 | M-6-05 / 06 / 07 |

### 10.6 驗收條件

- [ ] 所有頁面有正確 meta + OG + structured data(用 Google Rich Results Test 驗)
- [ ] sitemap.xml 含所有 page、robots.txt 正確
- [ ] E2E happy path 自動化測試跑綠
- [ ] Vercel production deploy 綠
- [ ] Railway production deploy 綠
- [ ] 連續一週 lint / typecheck / build 三綠

### 10.7 風險與緩解

- **風險 1:** G2 覆蓋率拍板若選 high(critical path 100%)、E2E 工作量爆炸。
- **緩解:** Sean 啟動前拍板。建議 happy path 100% + critical bug regression、不追求整體 60%。
- **風險 2:** Vercel / Railway production env vars 若漏一條、上線當天才發現。
- **緩解:** M-6-08 上線前 checklist 含 env vars 全檢、不只測 build。
- **三視角帶到:** 擴充性 — SEO 設定集中(next-seo plugin)、新頁複製規則 / 可維護性 — sitemap 動態、不寫死 / bug 可追蹤性 — Vercel / Railway log 集中、發生問題第一時間看 log。

---

## 11. 各 milestone 內嵌拍板點清單

> **本檔不負責拍板、僅列出每個 milestone 啟動前 Sean 要拍的事項。** 拍板由 Sean 在啟動該 milestone 前處理、不擴張到 writing-plans 本 slice。

| 拍板項目 | 對應 milestone | 啟動前必拍? | 說明 |
|---|---|---|---|
| **A3** 發票自動化(綠界 / 藍新 / 國稅局) | M-3 | 否(可延 M-3 中途拍) | 階段 1 是否做 / 還是手動開、影響 M-3 結帳設計 |
| **A6** 種子資料策略(已拍 Q5=C) | M-1 | 已拍 ✅ | 混合策略:200 SKU 手動 + sync-engine 接手 |
| **G2** 測試覆蓋率 + E2E 範圍 | M-6 | **是** | 影響 M-6-05 工作量、不拍會卡 |
| **TapPay** sandbox 沿用 / 重申請 | M-3 | **是** | 影響 M-3-08 估時(沿用 30 min / 重申請 60 min + 等審核) |
| **Vercel** production 新建 / 沿用 | M-6 | **是** | 影響 M-6-06 deploy 流程 |

**M-3 啟動前必拍:** A3 + TapPay
**M-6 啟動前必拍:** G2 + Vercel
**M-1 / M-2 / M-4a / M-5 / M-4b 無需 Sean 拍板**

---

## 11.5 Slice 切分原則速查

> **此節為通用規則、後續 slice 指令套用、不再 case-by-case 回問。**

### 規則 1:45 min 硬上限例外

- design 文件類(schema / ADR / spec / PRD)允許單 slice 1-2 hr、前提是「文件 coherent 不可拆」
- 例:`docs/architecture/medusa-schema-design.md`、`docs/decisions/0002-architecture-pivot.md`
- 例外不適用程式碼 slice(程式碼 slice 嚴守 45 min)

### 規則 2:TSX + CSS 雙檔聯動必合一 slice(覆述 CLAUDE.md 鐵則 5)

- design 元件 .jsx + 對應 .css 永遠一起搬、不拆兩 slice
- 例:`Header.tsx + header.css` = 一個 slice

### 規則 3:大 page 拆分原則

- 先拆「子元件」slice、最後「整合」slice
- 例:M-1 ProductsPage 拆 4 slice = FilterSide / FilterTop / FilterDrawer / ProductsPage 整合
- 共用邏輯抽 packages/ui hook(避免複製貼上、對齊 lessons-learned)
- 每個檔 < 400 行(對齊鐵則 6)

### 規則 4:slice 順序原則

- 後端 domain / ports / adapter 先做、後端 API 後做、前台直接搬最後做
- 但**每個 slice 內部**順序按鐵則 3:動前台 → 補對應後台 → 肉眼驗 → 修連動 → commit
- M-0 / M-1 早期 slice 是純後端骨架、無前台對應、不違反鐵則 3

### 規則 5:BLOCKED slice 標記格式

```
Slice M-X-NN: 任務名
狀態: [BLOCKED: 等 <阻塞原因>]
unblock 條件: <具體可驗證條件>
阻塞時可平行推進:M-X-NN / M-X-NN
```

阻塞時 milestone 不停、其他 slice 平行跑、BLOCKED slice 進本檔 §12「Claude Design 阻塞清單」。

---

## 12. Claude Design 阻塞清單

> **Sean 在 Claude Design 補哪頁、Claude Code 跑 `git submodule update --remote design-reference/`、對應 BLOCKED slice 即 unblock。**

| 阻塞項目 | 對應 BLOCKED slice | unblock 條件 | 阻塞影響 |
|---|---|---|---|
| 結帳後段(運送 / 付款 / 確認下單) | M-3-07 | `design-reference/checkout-success/` 出現對應 .jsx + .css | M-3 部分功能、不阻 M-3 整體(可平行 M-3-08 / M-3-10 / M-3-11) |
| 訂單詳情頁(從訂單列表點進去) | M-3-09 | `design-reference/order-detail/` 出現對應 .jsx + .css | M-3 部分功能、不阻 M-3 整體 |
| 經銷申請頁(三級會員申請) | M-2-07 | `design-reference/dealer-apply/` 出現對應 .jsx + .css | M-2 部分功能、不阻 M-2 整體(可平行 M-2-08 / M-2-09) |
| Vehicle Finder 「我的車」按鈕(微調) | M-1-07 部分 | design-reference HomePage VehicleFinder 區塊加按鈕 | M-1 部分功能、不阻 M-1-07 commit(按鈕補完再 follow-up) |

**進度追蹤建議:** 每次 M-2 / M-3 啟動前、Sean 確認 Claude Design 是否補到、若未補、列入啟動前 blocker、Sean 在 Claude Design 開新對話補頁、push pcm-website-design repo。

---

## 13. 風險與 rollback(整體層面)

### 13.1 整體風險

| # | 風險 | 影響 milestone | 緩解 |
|---|---|---|---|
| 1 | medusa-schema-design.md 寫到一半發現新衝突 | M-0 → 全部 | 拆 Part 1 / Part 2 + 新衝突進 backlog 不擴張 slice |
| 2 | M-1 packages/ui tokens 不完整、M-4a 卡住 | M-4a | M-1-04 必須完整交付為 review checkpoint |
| 3 | Claude Design 補頁進度慢、3 個 BLOCKED slice 拖整個 Phase 1 上線 | M-2 / M-3 | 平行推進 + 阻塞清單追蹤 |
| 4 | TapPay sandbox 沿用 / 重申請未拍板、M-3-08 卡住 | M-3 | M-3 啟動前拍板 |
| 5 | sync-engine 本機電腦壞了、機器停 | 上線後 | F1 兩層保險(被動紅燈 + 主動 email) |
| 6 | Sean 寫過程中拋新需求 / 推翻舊拍板 | 任何 | 重新對齊、不質疑(working-style 規範) |

### 13.2 整體 rollback

若 Phase 1 階段 1 MVP 上線後發現走不通:

- packages/domain 程式碼可保留(domain 邏輯本身正確)
- packages/adapters 改回直接 Medusa SDK 呼叫
- monorepo 結構回到 decision 0001 §3.5 原版
- 預期回退成本:約 1 週

詳見 `docs/decisions/0002-architecture-pivot.md` §6「Rollback 訊號清單」。

---

## 14. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-04-30 | 初始化 PHASE-1-MILESTONES.md(M-0 ~ M-6 共 75 slice) | Claude Code(/writing-plans) |

— END —
