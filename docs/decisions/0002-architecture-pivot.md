# 0002 — 架構 Pivot:Medusa-as-API + Bounded Contexts、推翻 0001 §4

> **狀態:** 已拍板 / 2026-04-30
> **拍板人:** Sean(brainstorming Q1-Q13 + Claude.ai review Q14-Q16 + writing-plans Q1-Q5)
> **影響範圍:** 全 Phase 1 + Phase 2 架構基礎
> **本檔角色:** 重大架構 Pivot 記錄、推翻 0001 §4、不可改、後續若推翻必開 0003 指向本檔
>
> 配合閱讀:
> - `docs/decisions/0001-rewrite-decision.md`(本檔推翻其 §4)
> - `docs/architecture/2026-04-30-backend-and-automation-design.md`(主 spec、本檔承接)
> - `docs/architecture/2026-04-30-claude-ai-feedback.md`(7 大組補建議)
> - `docs/architecture/2026-04-30-handoff-to-claude-ai.md`(brainstorming 對接報告)
> - `docs/PHASE-1-MILESTONES.md`(本檔架構落地排程)
> - `docs/architecture/scaling-triggers.md`(階段 2/3 觸發指標)

---

## 1. 決策摘要

PCM Phase 1 採「Medusa-as-API + Next.js 自家倉庫」混合架構、推翻 0001 §4「Phase 1 不寫客製 admin」、新增 4 packages + 2 apps,共 3 條 Pivot:

### 1.1 Pivot 1:推翻 0001 §4「Phase 1 不寫客製 admin」

**舊(0001 §4):** Medusa Admin UI 直接用、不客製、員工切換到 Medusa 內建後台工作。

**新(本檔):** 後台 admin 用 Next.js 自寫(`apps/admin`)、跟前台同 design 風格(@pcm/ui tokens 自組)、Medusa Admin 完全不用。

### 1.2 Pivot 2:採 Medusa-as-API + Next.js 自家倉庫(brainstorming Q3=C)

**舊心態:** Medusa 是 PCM 的家、所有資料丟 Medusa 就對了。

**新心態:** **Medusa 不是 PCM 的家、是 PCM 用的家具**。Medusa 只當「結帳櫃台」(cart / order / payment / 多 tier 價格)、其他 9 大 bounded contexts 用 Next.js + Supabase 自家管。

### 1.3 Pivot 3:monorepo 新增 4 packages + 2 apps

**新增:**
- `packages/domain/`(9 個 bounded contexts 純邏輯 / framework-free)
- `packages/use-cases/`(跨 entity 業務流程)
- `packages/ports/`(抽象介面)
- `packages/adapters/`(Medusa / Supabase / Sheets / TapPay 實作)
- `apps/admin/`(後台 Next.js)
- `apps/sync-engine/`(本機 AI 機器 Node.js daemon)

依賴規則由 ESLint 守門(domain ← ports ← use-cases ← adapters / apps)。

---

## 2. 為什麼這個決策

### 2.1 0001 §4 卡在哪

0001 §4 拍板「Phase 1 不寫客製 admin、用 Medusa 內建」是基於「降低 Phase 1 工作量」的成本考量。但 brainstorming Q1-Q13 暴露 Medusa Admin 蓋不到 PCM 業務:

| PCM 業務需求 | Medusa Admin 是否覆蓋 | 卡點 |
|---|---|---|
| 8 狀態雙維度訂單(payment × fulfillment) | ❌ 只有 payment_status、fulfillment 4 階段缺 | Medusa 不知道 Sean 跟廠商訂貨 |
| 三級會員 + 經銷申請審核 | 部分(Medusa Customer Group) | 經銷申請流程缺 |
| 商品候選審核(sync-engine 產) | ❌ Medusa Admin 沒有 candidate 概念 | 員工無法在 Medusa Admin 審 |
| 客服 inbox(LINE / Email / 電話) | ❌ 完全沒有 | 員工要自己在外面處理 |
| 機器狀態看板(sync-engine) | ❌ 完全沒有 | Sean 看不到機器跑沒跑 |
| 改金額紅線權限 | ❌ Medusa 權限沒這麼細 | 員工可能誤改金額 |
| @pcm/ui design 風格 | ❌ Medusa Admin 是自家 UI | 跟前台 design 風格不一致 |

7 條缺位 / 部分覆蓋、其中 6 條是核心業務需求。**繼續用 Medusa Admin = 員工天天切換兩個系統工作**(Medusa Admin + Excel / 紙本)、不可行。

### 2.2 brainstorming Q1-Q13 累積拍板過程

詳見 `docs/architecture/2026-04-30-handoff-to-claude-ai.md` §1.4 13 題拍板紀錄。關鍵:

- Q3 = C(Medusa-as-API + Next.js 自家倉庫)— 推翻「Medusa 為主」思路
- Q5 = A(認可整體架構含 0001 §4 推翻)
- Q6 = 三合一主畫面(儀表板 / 收件匣 / 數據 tab)— 自家 admin 才做得到
- Q7 = 員工透明型、唯一紅線改金額 — 自家 admin 才能精準控
- Q9-10 = 8 狀態雙維度訂單 — Medusa 內建蓋不到
- Q11 = sync-engine Node.js + node-cron — 跟 monorepo 同源

### 2.3 訂單 8 狀態雙維度 = Medusa 蓋不到的鐵證

```
                    PCM 進貨/出貨狀態
                ┌──────┬──────┬──────┬──────┐
                │ 未定  │ 已定  │ 現貨  │ 出貨  │
客人付款狀態     │(未訂)│(訂貨中)│(在庫)│(完成)│
┌─────┬───────┼──────┼──────┼──────┼──────┤
│  ❌ │ 未收  │未收   │未收   │未收   │未收  │
│  未 │       │未定  │已定   │現貨   │出貨  │
│  付 │       │ (1)  │ (2)   │ (3)  │ (4)  │
├─────┼───────┼──────┼──────┼──────┼──────┤
│  ✅ │ 已收  │已收   │已收   │現貨   │出貨  │
│  已 │       │未定  │已定   │在庫   │完成  │
│  付 │       │ (5)  │ (6)   │ (7)  │ (8)  │
└─────┴───────┴──────┴──────┴──────┴──────┘
```

Medusa 內建 `payment_status`(已收 / 未收)、但 `fulfillment_status` 只有 ordered / shipped / delivered 等貨物流向、**完全沒有「Sean 跟廠商訂貨」這維度**(2 / 6 狀態)、也沒有「賒帳 B2B 月結」分支(4 狀態)。

這證明 Medusa 是給「一般 B2C 賣家」設計、不是給 PCM「跟廠商訂貨 + 月結 B2B」這種雙進貨來源 + 雙付款模式設計。**Medusa 必須降級為 cart/payment adapter、不能當 fulfillment 主**。

### 2.4 9 大 bounded contexts 自然落地

PCM 9 大藍圖(PROJECT-OVERVIEW + PHASE-2-VISION)= 9 個 bounded contexts:

1. **Catalog**(商品 / 品牌 / 分類 / 車型)— Phase 1 主
2. **Identity**(會員 / 三級 tier / 經銷申請)— Phase 1 主
3. **Order**(訂單 / 8 狀態 / 結帳)— Phase 1 主
4. **Pricing**(雙 tier / 折扣)— Phase 1 主
5. **Vehicle**(車輛履歷 / 移轉)— Phase 2 主、Phase 1 schema 預留
6. **Booking**(預約 / 店家行事曆)— Phase 2 主
7. **Wallet**(儲值金 ledger)— Phase 2 主、Phase 1 schema 預留
8. **Shop**(店家 / 員工)— Phase 2 主、Phase 1 schema 預留
9. **Sync**(sync-engine / Sheets / 廠商爬蟲)— Phase 1 主(階段 1)

**其中 Vehicle / Booking / Wallet / Shop 4 個 contexts 完全不需要 Medusa**(Medusa 蓋 0%)、應各自獨立。Catalog / Identity / Order / Pricing 4 個跟 Medusa 有交集、但只用 Medusa 的 cart/order/payment/Price List 能力、metadata 自家管。Sync 完全不碰 Medusa。

**Medusa 只覆蓋約 10-15% PCM 業務**、無法當主框架。

---

## 3. 推翻 0001 §4 細節

| 項目 | 0001 §4(舊) | 本檔(新) |
|---|---|---|
| Admin UI | Medusa 內建 Admin UI | Next.js 自寫 `apps/admin/` |
| 員工工作介面 | Medusa Admin + Excel / 紙本(分散) | 自家 admin 三合一(集中) |
| 商品 CRUD | Medusa Product 模組 | apps/admin + adapters/MedusaProductAdapter |
| 訂單管理 | Medusa Order 模組 | apps/admin + 自家 8 狀態雙維度 + adapter |
| 三級會員 | Medusa Customer Group | apps/admin + domain/identity tier + adapter |
| 客服 inbox | 無(員工自己處理) | apps/admin/inbox |
| 機器看板 | 無 | apps/admin/dashboard 機器狀態看板 |
| 改金額紅線 | Medusa 權限粗(role-based) | apps/admin + server-side use-case enforce |
| Design 風格 | Medusa Admin 自家風格 | @pcm/ui tokens 自組(同前台) |
| 工作量 | 估「降低」 | 實際:Medusa Admin 覆蓋率太低、自寫反而短 |

**結論:** 0001 §4 假設「用 Medusa Admin 省工」、實際上 Medusa Admin 蓋不到 PCM 業務、員工要切兩個系統 + Excel、總工作量(設計 + 實作 + 員工日常)反而更高。本檔推翻 §4 不是「擴張 Phase 1 範圍」、是「修正 0001 §4 的錯誤工作量假設」。

其他 0001 條目(§3.1 / §3.2 / §3.5 / §3.6 / §3.7 / §3.8 / §4 之外的部分)**全部維持**、本檔不推翻。

---

## 4. 新增 monorepo 結構

### 4.1 monorepo 結構演進

```
pcm-website-v2/
├── apps/
│   ├── storefront/          ✅ 已建(decision 0001)
│   ├── medusa/              ✅ 已建(decision 0001、本檔降級為 API only)
│   ├── admin/               🆕 後台、同 design 風格
│   └── sync-engine/         🆕 本機 AI 機器 Node.js daemon
│
├── packages/
│   ├── ui/                  ✅ 已建(decision 0001、@pcm/ui tokens、admin 共用)
│   ├── schemas/             ✅ 已建(decision 0001、Zod 型別)
│   ├── domain/              🆕 9 個 bounded contexts 純邏輯(framework-free)
│   ├── use-cases/           🆕 跨 entity 業務流程
│   ├── ports/               🆕 抽象介面
│   └── adapters/            🆕 Medusa / Supabase / Sheets / TapPay 實作
│
└── design-reference/        ✅ submodule(decision 0001、視覺真權威)
```

新增 4 packages + 2 apps、共 6 個目錄。

### 4.2 依賴規則(由 ESLint 守門)

```
domain      ← 不可 import 任何其他 package
ports       ← 只可 import domain
use-cases   ← 只可 import domain + ports
adapters    ← 可 import domain + ports + 外部 SDK(Medusa / Supabase / Sheets / TapPay)
apps/*      ← 可 import 任何 packages/*
ui          ← 不可 import domain / use-cases / adapters / ports
schemas     ← 不可 import domain / use-cases / adapters / ports
```

落地由 `docs/architecture/dependency-rules.md`(待寫、M-0-03 slice 產出)的 ESLint 規則執行。

### 4.3 9 個 bounded contexts 範圍

| Context | Phase 1 範圍 | Phase 2 範圍 |
|---|---|---|
| Catalog | 商品 / 品牌 / 分類 / 車型(篩選用) | — |
| Identity | 會員 / 三級 tier / 經銷申請 / 個人資料 | 多店員工 / 角色細分 |
| Order | 訂單 / 8 狀態 / 結帳 | 詢價單 / 退換 |
| Pricing | 雙 tier(retail / wholesale) | 三層折扣疊加(廠牌 / VIP) |
| Vehicle | schema 預留(customer.metadata.vehicles) | 獨立 entity / 履歷 / 移轉 |
| Booking | schema 預留 | 預約 / 店家行事曆 |
| Wallet | schema 預留 | 儲值金 ledger |
| Shop | schema 預留(stores.json 靜態) | 店家 entity / 員工 entity |
| Sync | sync-engine + Sheets candidate / 報價變動 / 庫存自動 | AI 寫內文 / 圖片 / 廠商爬蟲 / 訂單分流 / LINE / 物流 |

---

## 5. 三視角分析

### 5.1 擴充性

- **9 大 bounded contexts** 各自獨立、Phase 2 啟動時不影響 Phase 1 已完成 context
- **新增 adapter** 不動 domain(階段 2 加 claude-api / image-processor / vendor-crawler 都是純加 adapter)
- **port 介面穩定**、實作可換(Medusa 將來換掉只動 adapter)
- **Bounded context 隔離**、Phase 2 加 Booking / Shop entity 不污染 Catalog

### 5.2 可維護性

- **domain 不依賴 framework**、看 code 就懂業務(JS 可讀 = 業務可讀)
- **Medusa 升級或換掉只動 adapter**、不動 domain / use-cases
- **packages/ui tokens 共用**、storefront 改字級 admin 也跟著改、不重複設定
- **依賴規則 ESLint 守門**、新進 dev 不會誤 import 違反方向

### 5.3 bug 可追蹤性

- **業務邏輯錯找 use case**(集中在 packages/use-cases/)
- **資料錯找 repository adapter**(集中在 packages/adapters/)
- **UI 錯找 storefront / admin**(明確分層)
- **權限錯找 Supabase RLS + use-case 驗證**(雙層檢查、容易 grep)

---

## 6. Rollback 訊號清單

> **Rollback 不綁時間、看訊號驅動。對齊 working-style.md「milestone-driven 不是 calendar-driven」。**

若以下任一訊號觸發、暫停當前 milestone、重新評估架構是否 rollback。

### 6.1 強訊號(任一觸發即重新評估)

| # | 訊號 | 解讀 |
|---|---|---|
| 1 | M-1 spike 出現 Medusa schema 完全無法對應 PCM 業務的 case(連 metadata 都套不上) | Medusa-as-API 假設破產、需考慮全 Supabase 自寫 |
| 2 | packages/ui tokens 編譯錯誤率 > 30%(CSS variable 鏈路爆) | 過度抽象、tokens 設計需重做 |
| 3 | M-0-04 ports 抽象介面定義時、發現有 use-case 無法 mappable 到任何 adapter | bounded context 切錯、需重劃 |
| 4 | sync-engine + Medusa 雙寫導致 data race condition、超過 1 週無解 | 同步策略錯、需考慮事件驅動 |

### 6.2 弱訊號(累計觸發即觀察)

| # | 訊號 | 解讀 |
|---|---|---|
| 5 | 連續 3 個 slice 因 ports 介面定義不夠補修改 | 介面設計需重 review |
| 6 | adapters 的單元測試大量用 mock(超過 50% 行) | adapter 過度 wrap、可考慮直接 SDK |
| 7 | M-4a apps/admin 第一週開發、@pcm/ui tokens 不夠用、頻繁 inline style | M-1-04 design tokens 補強需重做 |

### 6.3 Rollback 路徑

若決定 rollback、預期成本:

- packages/domain 程式碼**保留**(domain 邏輯本身正確、與架構無關)
- packages/adapters 改回**直接 Medusa SDK 呼叫**(廢 ports 抽象層)
- packages/use-cases **降級**為純 helper functions
- monorepo 結構**回到 0001 §3.5 原版**(只剩 ui + schemas)
- apps/admin 是否保留視 0001 §4 是否再次推翻
- 預期回退成本:約 1 週

---

## 7. 與其他文件交叉引用

> **以下檔案部分為「待寫」狀態、不要假設已存在。**

| 檔案 | 狀態 | 內容 |
|---|---|---|
| `docs/decisions/0001-rewrite-decision.md` | ✅ 已存在 | 整個重做拍板、本檔推翻其 §4 |
| `docs/architecture/2026-04-30-backend-and-automation-design.md` | ✅ 已存在 | 主 spec、本檔承接 |
| `docs/architecture/2026-04-30-claude-ai-feedback.md` | ✅ 已存在 | Claude.ai review feedback |
| `docs/architecture/2026-04-30-handoff-to-claude-ai.md` | ✅ 已存在 | brainstorming 對接報告 |
| `docs/architecture/proposed-architecture-2026-04-30.md` | ✅ 已存在 | 架構提案(Clean Arch + Hexagonal + DDD) |
| `docs/PHASE-1-MILESTONES.md` | ✅ 已存在 | 本檔架構落地排程(M-0 ~ M-6) |
| `docs/architecture/scaling-triggers.md` | ✅ 已存在 | 階段 2/3 觸發指標 |
| `docs/architecture/medusa-schema-design.md` | 🟡 **待寫** — M-0-05/06 | product / brand / category mapping + tier price + order state machine + ports + responsibility split |
| `docs/architecture/bounded-contexts.md` | 🟡 **待寫** — writing-plans 進度產出 | 9 個 context 詳細邊界 + ubiquitous language |
| `docs/architecture/ports-and-adapters.md` | 🟡 **待寫** — writing-plans 進度產出 | 完整 port / adapter 對應表 + interface 簽名 |
| `docs/architecture/dependency-rules.md` | 🟡 **待寫** — M-0-03 | ESLint 規則設定 + lint script |
| `docs/architecture/testing-strategy.md` | 🟡 **待寫** — M-6 / G2 拍板後 | in-memory adapter / use-case 單元測試方針 |
| `docs/features/PRD-rewrite.md` | 🟡 **待寫** — 0001 §3.8 + brainstorming 補章節 | Phase 1 完整 PRD(含三級會員 / SEO / structured data) |

---

## 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-04-30 | 初始化 0002 architecture pivot ADR、推翻 0001 §4 | Claude Code(/writing-plans) |

— END —
