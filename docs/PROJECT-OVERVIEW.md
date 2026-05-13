# PCM 重做專案 — 專案總覽

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **作者:** Claude.ai(基於 Sean 第一輪規劃 + 2026-04-29 重做拍板)
> **目的:** 讓你讀完就理解 PCM 是什麼、要做什麼、商業模式、技術方向
> **狀態:** v1 / 2026-04-29
>
> 配合閱讀:`docs/PHASE-2-VISION.md`(9 點業務藍圖)、`docs/PHASE-1-NORTHSTAR.md`(Phase 1 範圍)、`docs/features/vehicle-service-ecosystem.md`(Phase 2 完整 PRD)

---

## 0. 一句話介紹

**PCM Motorsports = 台灣高階機車零件 B2B/B2C 電商 + 車輛服務生態平台。**

從「賣零件」起步、終局是「車輛買賣 → 改裝 → 安裝 → 履歷 → 保養 → 二手交接」全閉環平台。

---

## 1. 商業模式

### 1.1 雙 channel 同一系統

PCM 同時服務兩種客戶、**用同一個會員系統、同一個前台**:

| Channel | 對象 | 看到的價格 | 差別 |
|---|---|---|---|
| **B2C** | 一般車主、改裝玩家 | 零售價 | 直接買回家自己裝、或寄合作店家裝 |
| **B2B** | 機車店、改裝店、經銷商 | 經銷價(再 -3~5% 給高級店家) | 進貨補庫存、或代客結帳 |

**關鍵設計:** 不分兩個系統、不分兩個 app。一個會員有 `tier` 欄位決定看到什麼價格。Sean 第一輪確認:同一個人可能既是消費者又是店家、兩套系統資料不通會出大問題。

### 1.2 三級會員等級

| 等級 | 英文代號 | 審核方式 | 看到的價格 | 儲值金 |
|---|---|---|---|---|
| 一般會員 | `general` | 註冊即開通 | 零售價 | 可用 |
| 店家(經銷商) | `store` | 管理員手動審核 | 經銷價 | 可用 |
| 高級店家 | `premium_store` | 自動升級(累積儲值 ≥ NT$100,000) | 經銷價再 -3~5% | 可用 |

### 1.3 PCM 不碰工資

**核心商業原則:**
- **PCM 只賺零件差價**(進貨價 vs 零售/經銷價之間的 margin)
- **店家只賺服務費**(工資 + 額外施工項目)
- **雙方利益不衝突**、不爭奪同一筆錢

這是 Phase 2 車輛服務生態系能成立的關鍵。如果 PCM 抽店家工資、店家會跑去別的平台。

### 1.4 飛輪效應(終局願景)

```
客人多 → 店家看到機會 → 店家加入多
       ↓
店家多 → 商品頁有真實安裝案例 → 客人看到後更願意買零件
       ↓
零件賣得多 → PCM 商品豐富 → 更多客人加入
       ↓
履歷只開放店家查 → 店家有獨家資訊價值 → 店家更願意深度合作
```

---

## 2. 目標市場

### 2.1 地區

**台灣**(主要)、未來可能擴香港 / 東南亞改裝市場(Phase 3+ 才考慮)。

### 2.2 客戶輪廓

**B2C 客戶:**
- 改裝玩家(主力)、騎重機 / 大型黃牌、追求性能 + 外觀
- 一般車主想升級保養配件
- 賽道日 / 道路日玩家

**B2B 客戶:**
- 機車店(車行)
- 改裝店
- 重機保養專業店

### 2.3 商品定位

**高階改裝零件**(非便宜量產品):
- Brembo(義大利剎車系統)
- Öhlins(瑞典懸吊)
- RIZOMA(義大利造型件)
- Akrapovič(斯洛維尼亞排氣)
- Kineo(義大利輪框)
- Materya(義大利車身件)
- 其他歐洲設計品牌

**不做** / 不主打:
- 原廠耗材(機油、輪胎、剎車片基本款)
- 改裝廢鐵 / 雜牌品

---

## 3. 技術架構(Phase 1 重做版)

### 3.1 monorepo 結構

```
pcm-website-v2/
├── apps/
│   ├── storefront/      ← Next.js 16 前台(B2B/B2C 同一個前台)
│   └── medusa/          ← Medusa v2 後台 + Admin UI
├── packages/
│   ├── ui/              ← @pcm/ui 共用元件 + design tokens
│   └── schemas/         ← 共用 TypeScript / Zod 型別(前後台合約)
├── design-reference/    ← submodule(視覺真權威)
└── docs/                ← 本文件所在
```

### 3.2 技術棧速查

| 層級 | 技術 |
|---|---|
| 套件管理 | pnpm 9.15 + Turborepo |
| 前台 | Next.js 16 + TypeScript + Tailwind v4(CSS-first @theme) |
| 後台 | Medusa.js v2 + Prisma |
| 資料庫 | Supabase PostgreSQL(SG region) |
| 前台部署 | Vercel(Pro 方案) |
| 後台部署 | Railway |
| 金流 | TapPay sandbox(Phase 1)/ TapPay production(上線時切換) |
| Node | v22 |
| Git 認證 | SSH only |

### 3.3 為什麼選這套

**Medusa v2:** 開源 commerce 框架、product / order / cart / customer 內建、metadata + custom modules 支援深度客製化。第一輪驗證可用。

**Next.js 16:** SSR / SSG / ISR 對 SEO 重要(見 9 點業務藍圖第 9 項)、App Router 天然支援多語系與 i18n、Vercel 部署無縫。

**Tailwind v4 + packages/ui:** design-reference 用 plain CSS、storefront 配 Tailwind 處理布局、packages/ui 抽共用元件 + design tokens。

**Supabase:** PostgreSQL + Row Level Security + 內建 auth(備用)、Singapore region 接近台灣低延遲。

### 3.4 視覺真權威

PCM 視覺與前台結構**唯一基準** = `design-reference/` submodule(來自 `pcmmotorsports/pcm-website-design` repo)。

**流程:**
```
Sean 在 Claude Design 改 → Sean 從 Claude Design 取出設計檔 → Sean 本地 commit + push pcm-website-design GitHub(Claude Design 對 GitHub 唯讀、不 push;對齊 lessons §12-21)
                       ↓
本地 git submodule update 拉 design-reference/
                       ↓
新 Claude Code 直接搬 design 的 .jsx + .css 進 apps/storefront 用
                       ↓
後台(Medusa)對應 design 已定義的資料結構重建
```

**鐵則:** storefront 與真權威衝突時、storefront 對齊真權威、不反向遷就。詳見 `docs/PHASE-1-NORTHSTAR.md` 與 `docs/lessons-learned.md` §1。

---

## 4. 重要規則速查

### 4.1 直接搬、不翻譯

design-reference 是成品、不是參考稿。前台直接搬 design 的 .jsx + .css 來用、不重寫。第一輪在「翻譯 design」上卡了好幾週、新 project 嚴禁。

### 4.2 後台對應 design、不是 design 配合後台

Medusa schema 重新規劃、對應 design 已定義的資料結構(products mock、cart 結構、user 結構等)。design 是合約、後台實作合約。

### 4.3 內容分級 L1 / L2 / L3

| 級別 | 變更頻率 | 處置 |
|---|---|---|
| L1 | 每年 0-1 次 | hardcode 可接受 |
| L2 | 每季 1-3 次 | hardcode + TODO + backlog |
| L3 | 每週多次 | **必須**後台 CRUD + 排程、強制停 slice 寫 PRD |

任何 slice 前先標記內容分級、發現 L3 → 立即停寫 PRD。

### 4.4 檔案大小硬上限

| 規則 | 上限 |
|---|---|
| 元件檔 | >400 行 必須拆 / >300 行 硬警戒 |
| Hook 檔 | >200 行 注意 |

第一輪 OrdersClient 因 Orchestrator 跑出 2269 行 TDZ 事故、Orchestrator 永久禁用。

### 4.5 SSH only、不貼 token

兩 repo SSH only、`git@github.com:...` 格式、不在對話貼任何 ghp_ token。涉及 credential 命令必加 redaction(`grep -v ghp_` 等)。

---

## 5. Phase 規劃

### 5.1 Phase 1(當前):重做、上架完整前台

**範圍:**
- 前台:`apps/storefront` 整個重做、design 直接搬
- 後台:`apps/api` 重新規劃 schema 對應 design 資料結構
- 共用:`packages/ui` + `packages/schemas`
- 部署:Vercel + Railway

**不做:** 9 大藍圖功能(車輛履歷、店家端、預約、保養提醒等)、留 Phase 2

**狀態:** 規劃中、`docs/PHASE-1-NORTHSTAR.md` v2 + `docs/PHASE-1-MILESTONES.md` 待寫

詳見:`docs/PHASE-1-NORTHSTAR.md`

### 5.2 Phase 2:車輛服務生態系

**範圍:** 9 大業務藍圖落地。詳見 `docs/PHASE-2-VISION.md`。完整 PRD 在 `docs/features/vehicle-service-ecosystem.md` v0.2。

**估時(務實):** 25-30 週(約 12-14 個月)

### 5.3 Phase 3+:平台延伸

可能方向(尚未拍板):
- 車型對應表開放給其他業者(B2B SaaS 延伸)
- 車型原廠建議保養週期資料庫
- 香港 / 東南亞市場
- 其他

---

## 6. 重要參考文件(順序)

1. `STATUS.md` — 當前狀態(每次新對話先讀)
2. `docs/PHASE-1-NORTHSTAR.md` — Phase 1 真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `docs/working-style.md` — Sean 風格詳解
5. `CLAUDE.md` — Claude Code 工作規則
6. **本檔** `docs/PROJECT-OVERVIEW.md` — 你正在讀
7. `docs/PHASE-2-VISION.md` — 9 點業務藍圖輪廓
8. `docs/features/vehicle-service-ecosystem.md` — Phase 2 完整 PRD
9. `docs/PHASE-1-MILESTONES.md` — milestone 排程
10. `docs/decisions/` — 重大決策記錄
11. `docs/patterns/` — 通用 + PCM 規矩
12. `design-reference/` — 視覺真權威字面(submodule)

— END —
