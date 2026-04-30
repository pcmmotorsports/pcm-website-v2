# PCM 目標架構提案 v0.1

> **狀態:** 🟡 提案中、**未拍板**、不取代 decision 0001
> **作者:** Claude Code(套用 `/architecture-patterns` skill)
> **日期:** 2026-04-30
> **觸發:** Sean 04-30「跳脫原本思考」+ skill 啟動
> **拍板後動作:** 若 Sean 採用、開 `decision 0002-architecture-pivot.md` 正式生效、本檔保留為提案附件
>
> 配合閱讀:`docs/decisions/0001-rewrite-decision.md`、`docs/PHASE-1-NORTHSTAR.md`、`docs/lessons-learned.md`、`docs/recon/design-reference-recon-2026-04-30.md` §7

---

## 0. TL;DR(一段話)

PCM 目前架構(monorepo + Medusa + Next.js)走「以 framework 為中心」思路。本提案套用 **Clean Architecture + Hexagonal Architecture + DDD Bounded Contexts** 三個模式、把 **Medusa 從「framework」降級為「adapter」**、讓 PCM 9 大藍圖各自獨立 bounded context、減少 framework 鎖死。**結構從「兩棟房 + 共用倉」演進為「一個 domain 核心 + 多個插頭式 adapter」**。

---

## 1. 為什麼重新評估架構

### 1.1 偵察報告暴露的兩個張力

**張力 1:Medusa schema 哲學 ↔ design 字面結構不對齊**

偵察報告 §7 列 9 個衝突點:
- design `brand: 'CNC RACING'` 字串 vs Medusa 期待 brand collection FK
- design `category: '引擎部品 · 排氣管'` 字串 vs Medusa 期待 category 樹
- design `fits: 'CBR600RR'` 自由字串 vs HANDOFF 建議 `vehicleIds: string[]`
- design 無 customer / order schema vs 三級會員 + 儲值金需求
- 共 9 處對不上、每處要做「翻譯」、跟「直接搬 design」鐵則衝突

**張力 2:Medusa 內建只覆蓋 PCM 9 大藍圖的 30%**

| 藍圖 | Medusa 蓋到? |
|---|---|
| Catalog(商品)| 70% |
| Identity(會員)| 60% |
| Order(訂單)| 80% |
| Pricing(定價)| 60% |
| Vehicle(車輛履歷)| 0% |
| Booking(預約)| 0% |
| Wallet(儲值金)| 0% |
| Shop(店家)| 0% |
| Sync(廠商同步)| 0% |

剩 70% 自己寫 Medusa module、寫到後來 Medusa 變成「拖累的殼」。

### 1.2 Skill 提供的新視角

`/architecture-patterns` skill 核心訊息:**framework 應該在最外圈、business logic 在圓心、依賴方向永遠向內**。

對應 PCM:**Medusa 應該是「adapter」、不是「framework」**。我們的 domain core(9 大藍圖的業務邏輯)應該獨立於 Medusa、Medusa 只是執行端。

---

## 2. 三大架構模式(白話比喻)

### 2.1 Clean Architecture = 廚房四圈規則

```
最內圈  食材(Entities)        ← Product / Order / Vehicle 純 domain object
        ↑ 不認識外圈
第二圈  菜單規則(Use Cases)   ← PlaceOrder / RegisterVehicle / ApplyTierPricing
        ↑ 不認識外圈
第三圈  廚具(Adapters)        ← Postgres / TapPay / LINE OA / Medusa SDK
        ↑ 不認識最外圈
最外圈  外送平台(Frameworks)  ← Next.js / Medusa / Vercel / Railway
```

**規則:依賴方向永遠向內**。食材不認識廚具、廚具不認識外送平台。換廚具不需要動食材。

### 2.2 Hexagonal Architecture = 主機板 + 插頭

```
                ┌──────────────┐
       金流插頭 →│              │← 通知插頭
                │  PCM Domain  │
       資料插頭 →│   (六邊形)    │← 認證插頭
                │              │
       UI 插頭 →│              │← 同步插頭
                └──────────────┘
```

主機板 = PCM domain core。每邊一個插頭(port)。
- 金流插頭可以接 TapPay 或 Stripe(adapter 不同、port 一樣)
- 資料插頭可以接 Postgres 或 In-Memory(test 用)
- 通知插頭可以接 LINE OA 或 Email

**換 TapPay 換 Stripe 不該動 domain core**。

### 2.3 DDD Bounded Contexts = 醫院分科

PCM **不是「一個大商店」、是「9 個專科診所共用一個掛號處(會員系統)」**:

| 科別 | 管什麼 |
|---|---|
| 目錄科(Catalog)| 商品 / 品牌 / 分類 / 車型 |
| 身分科(Identity)| customer / tier / 地址 |
| 訂單科(Order)| cart / order / 出貨方式 |
| 定價科(Pricing)| 三層折扣疊加 |
| 車輛科(Vehicle)| 履歷 / 移轉 / 防偽(Phase 2) |
| 預約科(Booking)| install / 店家行事曆(Phase 2) |
| 儲值科(Wallet)| 加值 / 扣款 / 餘額 |
| 店家科(Shop)| shops / staff(Phase 2) |
| 同步科(Sync)| 廠商爬蟲 / API(Phase 2) |

**每科自己的 model、自己的 use cases、不交叉污染**。

---

## 3. PCM 9 個 Bounded Contexts 對照表

| Context | Phase 1 範圍 | Phase 2 擴展 | 主要 Adapter |
|---|---|---|---|
| Catalog | products / brands / categories / motoBrands | 廠商同步 pipeline | Medusa |
| Identity | customer / tier / addresses | LINE OA 綁定 / 經銷申請 | Medusa + Supabase |
| Order | cart / order / fulfillment_method | 詢價流程 / 寄店家 | Medusa |
| Pricing | retail / wholesale 兩 tier | 三層折扣疊加 | Medusa Price List |
| Vehicle | schema 預留(獨立 entity)| 完整履歷 / 移轉 / 防偽 | Supabase 直連 |
| Booking | 暫無 | install / store calendar / QR | Supabase 直連 |
| Wallet | schema 預留 | 加值 / 扣款 / 退款 ledger | Supabase 直連 |
| Shop | 靜態 stores.json | shops + staff + region | Supabase 直連 |
| Sync | 暫無 | 廠商爬蟲 / API 同步 | Supabase + 外部 API |

**關鍵發現:Vehicle / Booking / Wallet / Shop / Sync 完全不需要 Medusa**。把它們塞進 Medusa metadata 是錯的、應該各自獨立 bounded context、用 Supabase 直連。

---

## 4. 關鍵洞察:Medusa 是 Adapter、不是 Framework

### 4.1 視角轉換

**舊視角(decision 0001 隱含):**
```
Medusa = framework
PCM 業務邏輯 = 寫在 Medusa module / metadata / extension
→ Medusa schema 怎麼長、PCM 跟著長
```

**新視角(本提案):**
```
PCM Domain Core = 圓心(我們寫、我們的)
  ↓ 透過 Port (IPaymentGateway / IOrderRepository / IPricingPolicy)
  ↓
Medusa Adapter = 我們寫的薄殼、包 Medusa SDK
  ↓
Medusa.js v2 = framework 角色、最外圈
```

### 4.2 好處

1. **Vehicle / Wallet / Booking domain 完全不認識 Medusa**、不被 schema 鎖死
2. **未來 Medusa 退役 / 升 v3 / 換 Saleor**、只換 adapter、domain 不動
3. **三級會員 Pricing policy 寫在 domain core**、Medusa 只是「執行端」、policy 變更不依賴 Medusa Price List
4. **測試**:in-memory adapter 取代 Medusa、單元測試不需要起 Medusa 服務

---

## 5. 目標 monorepo 結構

```
pcm-website-v2/
├── apps/
│   ├── storefront/              ← Next.js 16(前台 + admin、admin 由此寫)
│   └── medusa/                  ← Medusa v2(只當 adapter、不當 framework)
├── packages/
│   ├── domain/                  ← 🆕 PCM business logic core(framework-free)
│   │   ├── catalog/
│   │   │   ├── entities/        ← Product / Brand / Category / VehicleModel
│   │   │   ├── value-objects/   ← Sku / Price / FitmentSpec
│   │   │   └── events/          ← ProductPublished / PriceChanged
│   │   ├── identity/            ← Customer / Tier / Address
│   │   ├── order/               ← Cart / Order / FulfillmentMethod
│   │   ├── pricing/             ← TierPricingPolicy / DiscountPolicy
│   │   ├── vehicle/             ← Vehicle / ServiceRecord / Transfer (Phase 2)
│   │   ├── booking/             ← Booking / StoreCalendar (Phase 2)
│   │   ├── wallet/              ← Balance / Ledger
│   │   ├── shop/                ← Shop / Staff (Phase 2)
│   │   └── shared/              ← Money / Email / PhoneNumber 跨 context
│   ├── use-cases/               ← 🆕 Application business rules
│   │   ├── place-order.ts
│   │   ├── apply-tier-pricing.ts
│   │   ├── register-vehicle.ts  ← Phase 2
│   │   ├── transfer-vehicle.ts  ← Phase 2
│   │   ├── topup-wallet.ts
│   │   └── ...
│   ├── ports/                   ← 🆕 Abstract interfaces(domain 與 adapter 合約)
│   │   ├── IProductRepository.ts
│   │   ├── IOrderRepository.ts
│   │   ├── ICustomerRepository.ts
│   │   ├── IVehicleRepository.ts
│   │   ├── IPaymentGateway.ts
│   │   ├── INotificationGateway.ts
│   │   ├── IPricingPolicy.ts
│   │   └── IWalletLedger.ts
│   ├── adapters/                ← 🆕 Concrete implementations
│   │   ├── medusa/              ← Medusa adapter(只在這裡接觸 Medusa SDK)
│   │   │   ├── MedusaProductRepository.ts
│   │   │   ├── MedusaOrderRepository.ts
│   │   │   └── MedusaCartRepository.ts
│   │   ├── supabase/            ← Postgres via Supabase
│   │   │   ├── SupabaseVehicleRepository.ts
│   │   │   ├── SupabaseWalletLedger.ts
│   │   │   └── SupabaseShopRepository.ts
│   │   ├── tappay/              ← TapPay payment adapter
│   │   │   └── TapPayPaymentGateway.ts
│   │   ├── line-oa/             ← LINE OA notification(Phase 2)
│   │   └── memory/              ← In-memory adapter(test 用、無 Docker)
│   ├── ui/                      ← @pcm/ui design system(原既有)
│   └── schemas/                 ← Zod 型別合約(原既有)
└── design-reference/            ← submodule(原既有)
```

### 5.1 跟 decision 0001 §3.5 比、新增 4 個 packages

| 新增 | 角色 |
|---|---|
| `packages/domain/` | 9 個 bounded context 的純 domain object(無 framework 依賴)|
| `packages/use-cases/` | 跨 entity 編排業務流程 |
| `packages/ports/` | 抽象介面、domain 與 adapter 合約 |
| `packages/adapters/` | 具體實作、所有 framework / 外部服務的接觸點 |

### 5.2 依賴規則(必須由 lint 守門)

```
domain    ← 不可 import 任何其他 package
ports     ← 只可 import domain
use-cases ← 只可 import domain + ports
adapters  ← 可 import domain + ports + 外部 SDK
apps/*    ← 可 import 任何 packages/*
ui        ← 不可 import domain / use-cases / adapters / ports
schemas   ← 不可 import domain / use-cases / adapters / ports
```

實作:`eslint-plugin-import` + `no-restricted-imports` 規則 / 或 dependency-cruiser 工具。

---

## 6. Ports & Adapters 對應表(Phase 1 範圍)

| Port(抽象介面)| Phase 1 Adapter | Phase 2 變化 |
|---|---|---|
| IProductRepository | MedusaProductRepository | 不變、加 Sync adapter 餵料 |
| IOrderRepository | MedusaOrderRepository | 加詢價狀態 |
| ICartRepository | MedusaCartRepository | 不變 |
| ICustomerRepository | MedusaCustomerRepository | 加 line_oa_id 同步 |
| IVehicleRepository | SupabaseVehicleRepository(schema 預留)| 完整實作 |
| IWalletLedger | SupabaseWalletLedger | 加 LINE 通知 hook |
| IShopRepository | StaticJsonShopRepository(讀 stores.json)| 換 Supabase + admin CRUD |
| IPaymentGateway | TapPaySandboxGateway | 換 TapPayProductionGateway |
| INotificationGateway | (Phase 1 無)| LineOaNotificationGateway |
| IPricingPolicy | TwoTierPricingPolicy | ThreeLayerPricingPolicy |

**Phase 1 寫的 IProductRepository 在 Phase 2 不換實作、只加新 context、不重寫**。

---

## 7. 與 decision 0001 的衝突點

| decision 0001 條目 | 本提案影響 | 處理 |
|---|---|---|
| §3.1 Medusa 資料清空 | ✅ 不衝突 | 維持 |
| §3.2 新 repo 從零 | ✅ 不衝突 | 維持 |
| §3.5 monorepo apps + packages/ui + schemas | 🟡 **補充** | 新增 4 個 packages(domain / use-cases / ports / adapters) |
| §3.6 design-reference submodule | ✅ 不衝突 | 維持 |
| §3.7 Phase 1 schema 預留 9 點 | ✅ **完美對齊** | 透過 bounded contexts 自然落地 |
| §3.8 PRD-rewrite → milestones → slice | 🟡 **補充** | PRD-rewrite.md 加 bounded contexts + ports/adapters 章節 |
| §4「不寫客製 admin」 | 🔴 **可能推翻** | 若採本提案、admin 由 Next.js 寫(domain 不依賴 Medusa Admin) |
| §4「不繼承舊 OrdersClient」 | ✅ 不衝突 | 即使新寫 admin、也不繼承舊 code |

**只有 1 個衝突點**:`§4「不寫客製 admin」`。其他都是補充、不是推翻。

### 7.1 為什麼 admin 改成 Next.js 寫

- **複用 design 風格**(@pcm/ui design tokens、跟前台同源)
- **不依賴 Medusa Admin UI**(避免 framework 鎖死)
- **權限與會員 Pricing policy 在 domain core**(admin 只是另一個 use case 入口)
- **Phase 2 #7 員工 Excel UI 客製**自然落地、不需要從 Medusa Admin extension 起

但這是有代價的:**初期工作量比用 Medusa Admin 大**(約多 1-2 週)、要評估是否值得。

---

## 8. 需要 Sean 拍板的 Q(multi-select)

```
Q1: 採用本提案的「Clean Arch + Hexagonal + DDD」骨架?
A1-A: 是、完整採用
A1-B: 部分採用(指出哪些不要、例:不要 admin 改 Next.js、其他都要)
A1-C: 否、維持 decision 0001 原狀
A1-D: 等 Sean 跟 Claude.ai 討論後再決定

Q2: §4「不寫客製 admin」是否推翻?
A2-A: 是、admin 由 Next.js 寫
A2-B: 否、繼續用 Medusa Admin、本提案的 domain core 仍寫但 admin 用 Medusa 內建
A2-C: Phase 1 用 Medusa Admin、Phase 2 才轉 Next.js admin

Q3: 寫進 decision 0002 正式生效?
A3-A: 是、現在寫
A3-B: 否、先擱置、本提案保留為候選
A3-C: 等 PRD-rewrite 寫完一起決定

Q4: 文件位置?
A4-A: docs/architecture/(新資料夾、本檔已在此)
A4-B: docs/decisions/(現有資料夾、把本檔搬過去)
A4-C: 兩處都有(decision 在 decisions/、其他細節在 architecture/)

Q5: 下一步順序?
A5-A: 寫 decision 0002 → 改 monorepo 結構 → 寫 PRD-rewrite
A5-B: 寫 PRD-rewrite(含 bounded contexts) → 再決定要不要 decision 0002
A5-C: 先 spike 一個 bounded context(例 Catalog)驗證可行性 → 再放大
A5-D: 先把本提案丟給 Claude.ai 討論再回來
```

---

## 9. 若拍板、後續文件清單

| # | 檔案 | 內容 |
|---|---|---|
| 1 | `docs/decisions/0002-architecture-pivot.md` | 正式決策(若 Q1=A + Q3=A) |
| 2 | `docs/architecture/bounded-contexts.md` | 9 個 context 詳細邊界 + ubiquitous language |
| 3 | `docs/architecture/ports-and-adapters.md` | 完整 port / adapter 對應表 + interface 簽名 |
| 4 | `docs/architecture/dependency-rules.md` | 依賴規則 + ESLint 設定 + lint script |
| 5 | `docs/features/PRD-rewrite.md` | 加入 bounded contexts 章節 |
| 6 | `docs/PHASE-1-MILESTONES.md` | 重排、按 bounded context 切 milestone |
| 7 | `docs/architecture/testing-strategy.md` | in-memory adapter / use-case 單元測試方針 |

---

## 10. 三視角檢查(本提案是否值得)

| 視角 | 理由 |
|---|---|
| **擴充性** | 9 大藍圖每個是獨立 bounded context、Phase 2 啟動時不影響 Phase 1 已完成的 context、新增 adapter 不動 domain |
| **可維護性** | domain 不依賴 framework、Medusa 升級 / 換掉只動 adapter、domain 邏輯永遠是 PCM 自己的、看 code 就懂業務 |
| **bug 可追蹤性** | 出 bug 時責任清楚 — 業務邏輯錯找 use case、資料錯找 repository adapter、UI 錯找 storefront、權限錯找 Supabase RLS 設定 |

---

## 11. 風險與 rollback

### 11.1 風險

1. **初期工作量增加**:寫 ports + adapters 比直接呼叫 Medusa SDK 多 20-30% code。**緩解:**只在跨 framework / 跨 context 邊界寫 port、不為了寫而寫。
2. **學習曲線**:Sean 沒寫過 DDD 風格的 code、第一次 slice 預期較慢。**緩解:**先 spike 一個 context(Catalog)驗證、跑通才放大。
3. **過度抽象**:port / adapter 拆太細、變成 framework 噪音。**緩解:**只為「實際會換實作」的 dependency 抽 port、其他直接呼叫。

### 11.2 Rollback 方案

若提案實作後發現走不通:
- `packages/domain/` 程式碼可保留(domain 邏輯本身沒錯)
- `packages/adapters/` 可改回直接 Medusa SDK 呼叫(去掉抽象層)
- monorepo 結構回到 decision 0001 §3.5 原版(刪除 4 個新 packages、把內容塞回 storefront / medusa)
- 預期回退成本:約 1 週

---

## 12. 一句話總結

> **Medusa 不是 PCM 的家、是 PCM 用的家具。把 Medusa 從「框架」降級為「適配器」、PCM 9 大藍圖才能真正擴展、不被一個電商框架定型。**

— 提案結束 —
