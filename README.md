# PCM Motorsports — pcm-website-v2

> **PCM Motorsports 高階機車零件 B2B/B2C 電商 + 車輛服務生態平台**
>
> Phase 1 重做專案、新 repo 從零、design-reference 直接搬 + 後台對應重建。

---

## 快速開始

### 環境需求

- Node v22(用 [Hermes Node](https://github.com/hermes-platform/hermes-node) 管理)
- pnpm 9.15
- Git + SSH(SSH only、不用 HTTPS)
- macOS(Sean 主機 M1 Mac)

### Clone

```bash
git clone --recurse-submodules git@github.com:pcmmotorsports/pcm-website-v2.git
cd pcm-website-v2
```

`--recurse-submodules` 會自動初始化 `design-reference/` submodule。

若忘記加參數、補:
```bash
git submodule update --init --recursive
```

### 安裝套件

```bash
pnpm install
```

### 開發

```bash
# 跑全部 app
pnpm dev

# 跑特定 workspace
pnpm --filter storefront dev
pnpm --filter medusa dev
pnpm --filter @pcm/ui storybook
```

---

## 專案結構

```
pcm-website-v2/
├── apps/
│   ├── storefront/          ← Next.js 16 前台
│   └── medusa/              ← Medusa v2 後台 + Admin UI
├── packages/
│   ├── ui/                  ← @pcm/ui 共用元件 + design tokens
│   └── schemas/             ← @pcm/schemas 共用型別 / Zod
├── design-reference/        ← submodule(視覺真權威)
├── docs/                    ← 文件
│   ├── decisions/           ← 重大決策記錄
│   ├── features/            ← PRD
│   ├── patterns/            ← 通用 + PCM 規矩
│   ├── lessons-learned.md   ← 舊專案教訓
│   ├── working-style.md     ← Sean 工作風格
│   ├── tools-and-skills.md  ← 工具與流程
│   ├── PROJECT-OVERVIEW.md  ← 專案總覽
│   ├── PHASE-1-NORTHSTAR.md ← Phase 1 範圍
│   ├── PHASE-2-VISION.md    ← Phase 2 9 點藍圖
│   └── PHASE-1-MILESTONES.md ← milestone 排程
├── CLAUDE.md                ← Claude Code 工作規則
├── STATUS.md                ← 當前狀態(每次更新)
├── PROGRESS.md              ← 歷史紀錄
└── README.md                ← 本檔
```

---

## 技術棧

| 層級 | 技術 |
|---|---|
| 套件管理 | pnpm 9.15 + Turborepo |
| 前台 | Next.js 16 + TypeScript + Tailwind v4 |
| 後台 | Medusa.js v2 + Prisma |
| 資料庫 | Supabase PostgreSQL(Singapore) |
| 前台部署 | Vercel(Pro) |
| 後台部署 | Railway |
| 金流 | TapPay sandbox(Phase 1)/ production(上線) |

---

## 文件閱讀順序(新 Claude Code 進來第一天)

1. `STATUS.md` — 當前狀態
2. `docs/PHASE-1-NORTHSTAR.md` — Phase 1 範圍與真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `docs/working-style.md` — Sean 工作風格
5. `CLAUDE.md` — 工作規則總覽
6. `docs/PROJECT-OVERVIEW.md` — 整體 PCM 介紹
7. `docs/PHASE-2-VISION.md` — 9 點業務藍圖
8. `docs/features/vehicle-service-ecosystem.md` — Phase 2 完整 PRD
9. `docs/tools-and-skills.md` — 工具與流程

---

## Phase 規劃

- **Phase 1(當前)**:design 直接搬 + Medusa schema 對應 design 重建。範圍見 `docs/PHASE-1-NORTHSTAR.md`
- **Phase 2**:9 點業務藍圖落地(車輛履歷 / 店家端 / 預約 / 保養提醒 / 二手車履歷)。範圍見 `docs/PHASE-2-VISION.md` + `docs/features/vehicle-service-ecosystem.md`
- **Phase 3+**:平台延伸(車型對應表開放 / 香港東南亞市場等)

---

## 重要規則速查

- **design-reference 是視覺真權威**、storefront 對齊 design、不反向遷就
- **直接搬、不翻譯**(slice 指令禁用「翻譯 / 對齊 / 重寫」字眼)
- **後台對應 design**(Medusa schema 對應 design 已定義的資料結構)
- **前後台同步**(每個 slice 動前台 → 補後台、不分階段)
- **檔案大小**:元件 >400 必拆、>300 警戒
- **L1/L2/L3 內容分級**:slice 前強制標記、發現 L3 → 停下寫 PRD
- **Orchestrator 永久禁用**(2269 行 TDZ 事故教訓)
- **SSH only**、絕不貼 token
- **不自動 push**、Sean 手動推當 review checkpoint

詳見 `CLAUDE.md` 與 `docs/patterns/`。

---

## 第一輪舊 repo

舊 repo:`pcmmotorsports/pcm-website`(2026-04-29 起凍結保留)

舊 repo 沿用的東西:design-reference 內容、vehicle-service-ecosystem PRD、Busboy 腳本、SSH 設定、Vercel/Railway/Supabase/TapPay 帳號。

舊 repo 不繼承的東西:程式碼、commit history、backlog 編號、4 元件抽出、OrdersClient、Tailwind grid。

詳見 `docs/decisions/0001-rewrite-decision.md`。

---

## 授權

Private、未授權使用。

— END —
