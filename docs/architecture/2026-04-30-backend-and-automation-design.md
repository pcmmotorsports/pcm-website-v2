# PCM 後台 + 自動化 pipeline 設計 spec(Phase 1 階段 1 MVP)

> **狀態:** 🟢 設計拍板、待 Sean 審 spec、之後啟動 writing-plans
> **作者:** Claude Code(`/brainstorming` + `/architecture-patterns` 兩 skill 合作)
> **日期:** 2026-04-30
> **前置文件:** `docs/architecture/proposed-architecture-2026-04-30.md`(架構提案、本檔承接)
> **拍板過程:** Q1-Q13 共 13 題 multi-select 累積拍板
> **Phase 1 範圍:** 階段 1 MVP(漸進式、上線後加階段 2 / 3)
>
> 配合閱讀:
> - `docs/decisions/0001-rewrite-decision.md`(本檔推翻 §4「不寫客製 admin」)
> - `docs/PHASE-1-NORTHSTAR.md`(Phase 1 範圍)
> - `docs/features/vehicle-service-ecosystem.md`(Phase 2 業務流程 PRD、本檔不重複)
> - `docs/recon/design-reference-recon-2026-04-30.md`(design 字面)

---

## 0. TL;DR(一段話)

PCM 後台採「Medusa-as-API + Next.js 自家倉庫」混合架構。Medusa 只當「結帳櫃台」(cart / order / payment / 多 tier 價格),其他 9 大 bounded contexts 用 Next.js + Supabase 自家管。後台 UI 用 Next.js 自寫、跟前台同 design 風格(推翻 decision 0001 §4)。AI 自動化機器跑在本機專屬電腦(Node.js + node-cron),Phase 1 階段 1 MVP 只做「Google Sheets ↔ 後台候選清單同步」,階段 2/3 後續加(AI 寫內文 / 訂單分流 / LINE)。

---

## 1. 拍板紀錄(Q1-Q13)

| # | 題目 | 拍板 |
|---|---|---|
| Q1 | brainstorming 範圍 | A:🛠️ 後台 + 🤖 自動化 pipeline(綁一起) |
| Q2 | 工作流模式 | A:故事 A 機器主、員工審核 |
| Q3 | 資料層核心 | C:Medusa-as-API + Next.js 自家倉庫 |
| Q4 | Phase 1 上線階段 | D:漸進式(階段 1 MVP、上線後加 2/3) |
| Q5 | Section 1 整體架構 | A:OK、含 decision 0001 §4 推翻 |
| Q6 | 後台主畫面 | 三合一(A 紅綠燈為主 + B 收件匣 + C 數據儀表板 tab) |
| Q7 | 權限分工 | 員工透明型、唯一紅線 = 不能改金額 |
| Q8 | 商品 / 訂單流程 | OK、補訂單狀態機 |
| Q9 | 訂單狀態機初稿 | 用 Sean 完整 8 狀態定義 |
| Q10 | 訂單狀態機修訂(雙維度)| A:完全對 |
| Q11 | AI 機器語言 | A:Node.js + node-cron |
| Q12 | Sheets 整合 | A:Service Account |
| Q13 | 工具清單 | A:OK |

---

## 2. 整體架構

### 2.1 5 大組件

```
                    🏬 客人(瀏覽器)
                          ↓
            ┌──────────────────────────────────┐
            │   apps/storefront(Next.js 16)    │   ← design 直接搬
            │   首頁/商品/結帳/會員/預約/車輛履歷  │
            └─────────────┬────────────────────┘
                          │
              ┌───────────┴────────────┐
              ↓                          ↓
   ┌──────────────────┐         ┌──────────────────┐
   │ 🏪 medusa         │         │ 🗄️ supabase       │
   │ (結帳櫃台 API only)│         │ (自家倉庫)         │
   │ cart / order /    │         │ 商品 / 會員 / 地址 │
   │ payment /         │         │ 車輛 / 儲值 / 店家 │
   │ 多 tier 價格      │         │ 預約 / 訂單狀態    │
   │                  │         │ 候選清單 / RLS    │
   └──────────────────┘         └────────┬─────────┘
                                          ↑
                                          │
                              ┌───────────┴──────────┐
                              │ 🛠️ apps/admin         │
                              │ (Next.js 後台)        │
                              │ 同 design 風格        │
                              └───────────┬──────────┘
                                          ↑
                                          │
                              ┌───────────┴──────────┐
                              │ 🤖 apps/sync-engine   │
                              │ (本機 Node.js daemon)  │
                              │ Sheets ↔ 倉庫同步      │
                              └───────────┬──────────┘
                                          ↑
                                          │
                              📊 Google Sheets(廠商報價)
                              (Service Account 整合)
```

### 2.2 monorepo 結構

```
pcm-website-v2/
├── apps/
│   ├── storefront/          ✅ 已建(前台)
│   ├── admin/               🆕 後台、同 design 風格(推翻 decision 0001 §4)
│   ├── medusa/              ✅ 已建(只當 API、不用 Medusa Admin)
│   └── sync-engine/         🆕 本機 AI 機器、Node.js + node-cron
│
├── packages/
│   ├── ui/                  ✅ 已建(@pcm/ui design tokens、admin 共用)
│   ├── schemas/             ✅ 已建(Zod 型別)
│   ├── domain/              🆕 9 個 bounded contexts 純邏輯(framework-free)
│   │   ├── catalog/
│   │   ├── identity/
│   │   ├── order/
│   │   ├── pricing/
│   │   ├── vehicle/        (Phase 2 主、Phase 1 schema 預留)
│   │   ├── booking/        (Phase 2)
│   │   ├── wallet/         (Phase 2 主、Phase 1 schema 預留)
│   │   ├── shop/           (Phase 2 主)
│   │   └── shared/         (Money / Email / PhoneNumber 跨 context)
│   ├── use-cases/           🆕 跨 entity 業務流程
│   ├── ports/               🆕 抽象介面
│   └── adapters/            🆕 Medusa / Supabase / Sheets / TapPay 實作
│
└── design-reference/        ✅ submodule(視覺真權威)
```

### 2.3 依賴規則(由 ESLint 守門)

```
domain      ← 不可 import 任何其他 package
ports       ← 只可 import domain
use-cases   ← 只可 import domain + ports
adapters    ← 可 import domain + ports + 外部 SDK
apps/*      ← 可 import 任何 packages/*
ui          ← 不可 import domain / use-cases / adapters / ports
schemas     ← 不可 import domain / use-cases / adapters / ports
```

---

## 3. Phase 1 階段 1 MVP 範圍

### 3.1 前台(storefront)

- design 直接搬(13 jsx + 15 css)
- 路由對齊 design SPA(13 個 page id)
- SEO + structured data + sitemap day 1 起
- 客人下單流程跑通(瀏覽 / 加購物車 / 結帳)
- 會員中心 6 tab(總覽 / 訂單 / 收藏 / 我的車 / 地址 / 個人資料)
- 待 Claude Design 補:結帳後段 / 訂單詳情 / 經銷申請 3 頁

### 3.2 後台(admin)

- 商品「待審核」清單(AI 機器產的候選)
- 商品列表 + 編輯(內文 / 圖片 / 售價 + 經銷價)
- 訂單列表 + 8 狀態流轉 + 加物流單號
- 會員列表 + tier 改(general / store / premium_store)
- 店家列表(stores.json 改編 admin CRUD)
- 經銷申請審核

### 3.3 結帳(medusa)

- Cart / Order / Payment 用 Medusa 內建
- TapPay sandbox 整合
- 兩 tier 價格(retail / wholesale)
- 三級會員 tier 由 storefront 認證、Medusa 套對應 Price List

### 3.4 自家倉庫(supabase)

- 商品 / 會員 / 地址 / 訂單延伸 metadata 自家管
- 訂單狀態機 8 狀態(雙維度)
- 車輛 / 儲值 schema **預留**(Phase 2 落地)
- 店家 / 預約 schema **預留**
- Row Level Security(RLS)做權限

### 3.5 自動化機器(sync-engine)

- 每小時讀 Google Sheets 報價
- 自動產生「商品候選」進後台「待審核」清單
- 偵測既有商品「報價變動」、進後台告警
- 後台「機器狀態」看板(上次同步 / 錯誤日誌 / 立即同步按鈕)

### 3.6 階段 1 MVP **不做**(階段 2/3 才做)

- AI 寫商品內文
- 圖片自動處理(壓縮 / WebP / OG image)
- 廠商網站爬蟲
- 訂單自動分流(寄家 / 寄店家)
- LINE OA 通知
- 庫存低於閾值告警
- 物流商 API 串接

---

## 4. 後台 UI 設計

### 4.1 主畫面三合一(三 tab)

```
┌──────────────────────────────────────────────────┐
│ 🏠 PCM 後台   [儀表板 收件匣 數據]  🔔 ⚙️  Sean ▼ │
├──────────────────────────────────────────────────┤
│ tab 1:儀表板(預設首頁)                          │
│   🔴 12 待審核   🟡 8 待出貨   🟢 42 機器跑中     │
│                                                    │
│ tab 2:收件匣(時間流活動歷史)                    │
│   14:32  AI 新增 5 件候選                          │
│   13:15  訂單 PCM-2026-0042 已付款                 │
│                                                    │
│ tab 3:數據(銷售 / 庫存 / 排行)                  │
│   今日 NT$23,400 ↑12% / 待出貨 8 / 缺貨 12        │
└──────────────────────────────────────────────────┘
```

### 4.2 權限分工

```
【唯一紅線】= 修改金額(售價 / 經銷價 / 折扣)

👤 Sean(老闆)           👥 員工
  ✅ 全部看 + 全部做         ✅ 全部看(經銷價 / 報表 / 設定 都看得到)
  含出貨 / 客服 / 內文        ✅ 全部做(出貨 / 客服 / 補內文 / 改訂單狀態)
  含三級會員審核 / 經銷申請    ❌ 唯獨「改金額」按鈕變灰、提示「需 Sean」
  含 AI 機器設定
  含金額調整(retail / wholesale / 折扣)
```

員工點到「改金額」按鈕 → 提示「需 Sean 權限」、可發 LINE 通知 Sean 處理。

### 4.3 機器狀態看板(🟢 方塊點開)

```
┌──────────────────────────────┐
│ 🟢 AI 機器狀態                  │
│ 上次同步:2026-04-30 14:32      │
│ 下次同步:2026-04-30 15:32      │
│ 今日讀取:8 次成功 / 0 次失敗     │
│ 本週新增候選:42 件              │
│ [立即同步] [暫停] [日誌]        │
└──────────────────────────────┘
```

機器當機處理:後台「暫停超過 2 小時」→ 紅燈警告 + LINE 通知 Sean(階段 3)。

---

## 5. 商品上架審核工作流

### 5.1 階段 1 MVP 流程

```
廠商給 Sheets(品名 / 售價 / 庫存)
       ↓
🤖 機器每小時讀(本機 cron)
       ↓
🤖 比對 Supabase 既有商品(by SKU)
       ↓
🤖 寫入「商品候選」表(status=pending)
       ↓
🔴 後台「待審核」+1
       ↓
👤 Sean 點開候選 → 看品名 / 價格 / 庫存
       ↓
   ┌──[👍 通過]──→ status=approved → 進「待補內文」
   ├──[✏️ 編輯]──→ Sean 改完再 [👍 通過]
   └──[❌ 拒絕]──→ status=rejected
       ↓
👥 員工補內文 / 圖片 / 分類
       ↓
👥 員工 [✅ 發布] → status=published
       ↓
✅ 商品上架到前台
```

### 5.2 階段 2 進化

- AI 自動補「內文 / 圖片」初稿
- 員工只審不寫
- Sean 一鍵發布(跳過員工補內文步驟)

### 5.3 階段 3 進化

- Sean 點「通過」即發布(AI 已補完內容、無需員工)

---

## 6. 訂單狀態機

### 6.1 8 個狀態(雙維度交叉)

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

| # | 狀態 | 場景 |
|---|---|---|
| 1 | 未收未定 | 剛下單、Sean 還沒處理 |
| 2 | 未收已定 | 月結客戶、Sean 先跟廠商訂貨 |
| 3 | 未收現貨 | 月結客戶、現貨待出 |
| 4 | 未收出貨 | 月結客戶、賒帳已出貨(B2B 店家) |
| 5 | 已收未定 | 收款後 Sean 還沒跟廠商訂貨 |
| 6 | 已收已定 | 一般訂單、等廠商出貨給 PCM |
| 7 | 現貨在庫 | 已付款、貨在 PCM、可出貨 |
| 8 | 出貨完成 | 終態 |

### 6.2 狀態流轉

```
                    [客人下單]
                         ↓
                  ━━━━ 1 未收未定 ━━━━
                         │
            ┌────────────┼────────────┐
            ↓            ↓            ↓
    [Sean 訂貨給廠商] [客人付款]  [SKU 本來現貨]
            ↓            ↓            ↓
       2 未收已定    5 已收未定    3 未收現貨
            │            │            │
       [廠商到貨]    [Sean 訂貨]    [客人付款]
            ↓            ↓            ↓
       3 未收現貨    6 已收已定    7 現貨在庫
            │            │            │
       [客人付款]    [廠商到貨]    [員工出貨]
            ↓            ↓            ↓
       7 現貨在庫    7 現貨在庫    8 出貨完成

賒帳分支(B2B 月結客戶):
  3 未收現貨 → [員工出貨] → 4 未收出貨 → [客人付款] → 8 出貨完成
```

### 6.3 系統實作:雙維度獨立欄位

```typescript
// packages/domain/order/Order.ts
type Order = {
  id: string;
  payment_status: 'unpaid' | 'paid';
  fulfillment_status:
    | 'no_supplier_order'   // 未定
    | 'supplier_ordered'    // 已定
    | 'in_stock'            // 現貨
    | 'shipped';            // 出貨
}

// 顯示名稱由兩維度組合自動算
displayStatus(order):
  '未收未定' / '未收已定' / '未收現貨' / '未收出貨' /
  '已收未定' / '已收已定' / '現貨在庫' / '出貨完成'
```

### 6.4 Medusa-as-API 影響

- Medusa 內建 `payment_status`(已收 / 未收)
- `fulfillment_status` 4 階段 = **PCM 自家 domain**(Medusa 內建沒有)
- 流轉觸發點:`packages/use-cases/`(MarkSupplierOrdered / MarkInStock / MarkShipped)
- 這個邏輯就是 Q3=C 選擇的證明:Medusa 蓋不到「Sean 跟廠商訂貨」這維度

### 6.5 訂單列表 UI 篩選

```
┌─────────────────────────────────────────────────┐
│ 訂單列表                                         │
│ 付款: [全部▼] [已收] [未收]                      │
│ 進貨: [全部▼] [未定] [已定] [現貨] [出貨]        │
├─────────────────────────────────────────────────┤
│ #PCM-2026-0042  已收已定  NT$3,400  Sean 訂貨中  │
│ #PCM-2026-0041  未收已定  NT$8,200  店家月結     │
│ #PCM-2026-0040  現貨在庫  NT$2,150  待出貨       │
└─────────────────────────────────────────────────┘
```

---

## 7. 訂單處理工作流(階段 1 MVP)

```
🛒 客人在前台下單
       ↓
🏪 Medusa 處理結帳(cart → order → TapPay)
       ↓
🤖 sync-engine 鏡射訂單到 Supabase + 設定初始狀態
       ↓
🟡 後台「待出貨」+1
       ↓
👥 員工點訂單 → 看商品 / 收件人 / 地址 / 出貨方式
       ↓
   ┌──[列印託運單]──→ 階段 1:手動列印 PDF
   │                  階段 3:串黑貓 / 7-11 物流 API
   ├──[填物流單號]
   ├──[改訂單狀態]──→ 8 狀態流轉
   └──[✅ 標記已出貨]
       ↓
🟢 訂單狀態 = shipped(對應 4 / 8)
       ↓
階段 1:員工手動傳訊息給客人
階段 3:自動 LINE 通知客人「已出貨」
```

---

## 8. AI 自動化機器(sync-engine)

### 8.1 技術棧

- **語言:** Node.js + TypeScript(跟 storefront / admin 同源)
- **排程:** node-cron(npm package)
- **位置:** 本機專屬電腦(放公司、24/7 開機)
- **依賴:** 共用 monorepo `packages/domain` + `packages/use-cases` + `packages/adapters`

### 8.2 觸發機制

```
🕐 排程觸發
   - 每小時:讀 Sheets、產生 / 更新「候選清單」
   - 每 6 小時:做完整 diff(catch missed updates)

🖱️ 手動觸發
   - Sean / 員工在後台點「立即同步」
   - 後台呼叫 sync-engine HTTP endpoint(localhost API)

🔔 報價變動偵測
   - 對 Sheets 內容算 hash
   - 變動 → 進後台「報價變動」告警
```

### 8.3 維護(Sean / 員工不寫程式)

- 後台「🟢 機器跑中」方塊 = 機器狀態看板
- 「立即同步」按鈕 = 員工排除小問題
- 「暫停」按鈕 = 機器異常時阻止繼續壞掉
- 「日誌」按鈕 = 員工 / Sean 看跑了什麼、出什麼錯

當機處理:暫停超過 2 小時 → 後台紅燈 + 階段 3 LINE 通知 Sean。

### 8.4 階段 1 MVP 不寫的功能

- AI 寫內文(階段 2)
- 圖片自動處理(階段 2)
- 廠商網站爬蟲(階段 2)
- 訂單分流(階段 3)
- LINE 通知(階段 3)
- 庫存監控告警(階段 3)

---

## 9. Google Sheets 整合

### 9.1 整合方式:Service Account

```
1. Google Cloud Console 建 project(PCM Sync Engine)
2. 啟用 Sheets API + Drive API
3. 建 Service Account、下載 JSON 金鑰
4. Sean 把要同步的 Sheets 共享給 SA email(viewer 或 editor)
5. sync-engine 用 JSON 金鑰呼叫 API(.env 存、不進 git)
```

**好處:** 不過期、不用 Sean 重複授權、多 Sheets 共享給同一 SA、批次處理。

### 9.2 Sheets 結構建議

廠商每月一份 Sheets、結構固定:

| SKU | 品名 | 廠商 | 售價 | 經銷價 | 庫存 | 狀態 |
|---|---|---|---|---|---|---|
| BR-001 | Brembo 卡鉗 | BREMBO | 12000 | 10800 | 5 | active |
| AK-002 | Akrapovic 排氣 | AKRAPOVIC | 98000 | 88200 | 0 | preorder |

或多廠商一份 Sheets、用「廠商」欄位區分。

### 9.3 機器讀取邏輯

```
1. 對照 Supabase 既有商品(by SKU)
2. 新 SKU → 進「商品候選」表(status=pending)
3. 既有 SKU 但價格變動 → 進「報價變動」告警
4. 既有 SKU 但庫存變動 → 自動更新 inventory_quantity(無需審核)
```

### 9.4 真權威定義

```
真權威 = PCM 後台(Supabase)
Sheets = 「來源」、進入 PCM 後變成 PCM 的資料

理由:
- 廠商 Sheets 格式可能變、PCM 後台統一格式
- PCM 加的內文 / 圖片 / SEO 不在 Sheets
- 三級會員價、分類、車型、報價歷史在 PCM
- Sheets 改 → 進 PCM 才生效(經 Sean 審核)
```

---

## 10. 工作工具清單(Sean 日常)

### 10.1 設計階段

| 場景 | 工具 |
|---|---|
| 改設計、加新頁 | Claude Design → push pcm-website-design |
| 同步 design 到 dev | `git submodule update --remote` |
| 視覺風格指南審查 | `web-design-guidelines` skill |
| 設計批評 | `design-critique` skill |
| Accessibility 檢查 | `accessibility-review` skill |

### 10.2 開發階段

| 場景 | 工具 |
|---|---|
| 寫 code、跑命令 | Claude Code |
| 截圖驗 UI | `chrome-devtools` MCP |
| 互動測試 | `webapp-testing` skill |
| 設計系統一致性 | `design-system` skill |

### 10.3 內容階段(階段 2 起)

| 場景 | 工具 |
|---|---|
| AI 寫商品內文 | `content-generation` skill / `claude-api` skill |
| AI 寫 SEO 描述 | 同上 |
| 圖片自動處理 | sharp(Node)|

### 10.4 SEO / 監控

| 場景 | 工具 |
|---|---|
| SEO 全站審查 | `audit-website` skill(squirrelscan)|
| performance | `chrome-devtools` MCP performance_analyze_insight |
| Lighthouse | `chrome-devtools` MCP lighthouse_audit |

### 10.5 後台 / 業務

| 場景 | 工具 |
|---|---|
| 訂單批次處理 | 自家後台(本 design) |
| 報表分析 | 後台 + `data:analyze` skill(SQL 查詢) |
| 客服 | LINE OA(階段 3) |

### 10.6 不需要的 skill(避免分散)

- `/loop` `/schedule`(已用 sync-engine)
- `/pdf` `/docx` `/xlsx`(沒用)
- third-party MCP(slack / hubspot / clickup)
- `/pencil`(用 Claude Design)

---

## 11. 整體部署規劃

```
🌐 Vercel              storefront + admin(同 monorepo、不同 app)
🚂 Railway             medusa(只當 API)
🗄️ Supabase            Postgres + RLS(資料層)
🤖 本機專屬電腦         sync-engine(Node.js daemon)
📊 Google Cloud        Sheets API(Service Account)
💳 TapPay              金流(Phase 1 sandbox、上線時切 production)
📱 LINE OA             通知(階段 3 才開)
```

---

## 12. 階段 2 / 3 演進路線

### 12.1 階段 2(上線後 1-2 個月)

- AI 寫商品內文 → 加 `packages/adapters/claude-api/`
- 圖片自動處理 → 加 `packages/adapters/image-processor/`
- 廠商網站爬蟲 → 加 `packages/adapters/vendor-crawler/`
- 後台 UI 加「AI 寫內文預覽」按鈕

**新增工作不動既有 code**、純加 adapter + use-case。

### 12.2 階段 3(階段 2 穩定後)

- 訂單自動分流 → `packages/use-cases/auto-fulfillment-route.ts`
- LINE OA 通知 → `packages/adapters/line-oa/`
- 庫存監控告警 → `packages/use-cases/inventory-alert.ts`
- 物流 API 串接 → `packages/adapters/logistics/{black-cat,7-11}/`

### 12.3 Phase 2(獨立 brainstorming)

- 車輛履歷 + 移轉
- 詢價 + 預約 + 店家行事曆
- 三層折扣疊加(廠牌 / VIP)
- Excel 大量上架 UI

→ 各自獨立 spec → plan → impl,本檔不細化。

---

## 13. 與 decision 0001 衝突 / 補充

| decision 0001 條目 | 本設計影響 | 處理 |
|---|---|---|
| §3.1 Medusa 資料清空 | ✅ 不衝突 | 維持 |
| §3.2 新 repo 從零 | ✅ 不衝突 | 維持 |
| §3.5 monorepo apps + ui + schemas | 🟡 補充 | 新增 4 packages + 2 apps(admin / sync-engine) |
| §3.6 design submodule | ✅ 不衝突 | 維持 |
| §3.7 Phase 1 schema 預留 9 點 | ✅ 完美對齊 | 透過 bounded contexts 自然落地 |
| §3.8 PRD-rewrite → milestones → slice | 🟡 補充 | PRD-rewrite 加 bounded contexts + ports/adapters 章節 |
| **§4「Phase 1 不寫客製 admin」** | 🔴 **推翻** | 後台 admin 由 Next.js 寫(複用 design 風格)|

衝突點 1 個(§4)、其他都是補充。

---

## 14. 後續文件清單

拍板 → writing-plans 階段時要寫 / 改:

| # | 檔案 | 內容 |
|---|---|---|
| 1 | `docs/decisions/0002-architecture-pivot.md` | 正式記錄推翻 §4「不寫客製 admin」+ 採用 Medusa-as-API + Bounded Contexts 骨架 |
| 2 | `docs/architecture/bounded-contexts.md` | 9 個 context 詳細邊界 + ubiquitous language |
| 3 | `docs/architecture/ports-and-adapters.md` | 完整 port / adapter 對應表 + interface 簽名 |
| 4 | `docs/architecture/dependency-rules.md` | ESLint 規則設定 + lint script |
| 5 | `docs/features/PRD-rewrite.md` | Phase 1 PRD 整合本檔 + decision 0001 + 偵察報告 |
| 6 | `docs/PHASE-1-MILESTONES.md` | 拆 milestone(每個 1-2 週、按 bounded context 切) |
| 7 | `docs/architecture/testing-strategy.md` | in-memory adapter / use-case 單元測試方針 |

---

## 15. 三視角檢查

| 視角 | 理由 |
|---|---|
| **擴充性** | 9 大藍圖每個獨立 bounded context、Phase 2 啟動時不影響 Phase 1 已完成 context、新增 adapter 不動 domain |
| **可維護性** | domain 不依賴 framework、Medusa 升級 / 換掉只動 adapter、看 code 就懂業務 |
| **bug 可追蹤性** | 業務邏輯錯找 use case、資料錯找 repository adapter、UI 錯找 storefront / admin、權限錯找 Supabase RLS |

---

## 16. 風險與 rollback

### 16.1 風險

1. **初期工作量增加 20-30%**(寫 ports + adapters)
2. **Sean 沒寫過 DDD code**、第一個 slice 預期慢
3. **Medusa Admin 不用、員工初期可能想念內建 admin UI**(無)
4. **sync-engine 在本機、電腦壞了會停**(階段 3 加 LINE 告警 + 雲端備援)

### 16.2 緩解

- 先 spike 一個 bounded context(Catalog)驗證可行性 → 再放大
- 每個 slice 15-45 分鐘可中斷(對齊 NORTHSTAR §3.4)
- in-memory adapter 讓單元測試不需要 Docker

### 16.3 Rollback

若提案實作後發現走不通:
- `packages/domain/` 程式碼可保留(domain 邏輯本身沒錯)
- `packages/adapters/` 改回直接 Medusa SDK 呼叫
- monorepo 結構回到 decision 0001 §3.5 原版
- 預期回退成本:約 1 週

---

## 17. 一句話總結

> **PCM 後台 = Medusa 結帳 + Next.js 自家倉庫 + 本機 AI 機器同步 Sheets。員工透明型權限、紅線只有「改金額」。階段 1 MVP 8-10 週上線、之後漸進加 AI 寫內文 / 訂單自動分流 / LINE 通知。**

— spec 結束 —
