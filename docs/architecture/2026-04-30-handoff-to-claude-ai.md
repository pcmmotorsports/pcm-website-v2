# 交接文件 — 給 Claude.ai 看的 brainstorming session 對接報告

> **讀者:** Claude.ai(Sean 的規劃夥伴、有完整對話記憶)
> **作者:** Claude Code(本次 brainstorming session 執行者)
> **日期:** 2026-04-30
> **session 範圍:** Sean 在 Claude Code 啟動 `/architecture-patterns` + `/brainstorming` 兩 skill、產出 PCM 後台 + 自動化系統 spec
>
> **本檔目的:** Sean 要把 brainstorming 結果交接給 Claude.ai 繼續討論、本檔提供「兩份 spec 之外」的所有狀態(對話軌跡 / 拍板紀錄 / 待辦 / 未來進度 / Sean 要你幫忙的事)、避免 Sean 重述。

---

## 0. 必讀前置(三份檔案、按順序)

Sean 已單獨上傳兩份 spec、本檔是第三份。請按順序讀:

1. **`docs/architecture/proposed-architecture-2026-04-30.md`** — 架構提案(用 Clean Architecture + Hexagonal + DDD 三模式重新看 PCM、把 Medusa 從 framework 降級為 adapter)
2. **`docs/architecture/2026-04-30-backend-and-automation-design.md`** — 後台 + 自動化 pipeline 完整 spec(700 行、17 章節、本對話的最終結晶)
3. **本檔** — 交接報告(spec 之外的對話軌跡 + 待辦 + 未來進度)

**配合閱讀(Claude.ai 應該已熟):**
- `STATUS.md` / `docs/PHASE-1-NORTHSTAR.md` / `docs/lessons-learned.md` / `docs/working-style.md`
- `docs/decisions/0001-rewrite-decision.md`(本對話部分推翻)
- `docs/PROJECT-OVERVIEW.md` / `docs/PHASE-2-VISION.md`
- `docs/recon/design-reference-recon-2026-04-30.md`(design 偵察報告 1024 行)

---

## 1. 本次 brainstorming session 軌跡(時間順)

### 1.1 開場
Sean 第一句:**「依照我目前網站架構、建議用什麼方式架構最好、跳脫原本思考、並且生成對應的文件與架構給我、白話文用比喻」**

我做的:讀完所有 docs/*.md、起手檢查綠、給 4 個方向 multi-select(維持現狀 / 拿掉 Medusa / 換 Payload / Medusa-as-API 混合)、推薦 D Medusa-as-API。

### 1.2 啟動 architecture-patterns skill
Sean 啟動 `/architecture-patterns` 後、我用 Clean Arch + Hexagonal + DDD 三模式重看 PCM、寫 `proposed-architecture-2026-04-30.md`。

關鍵洞察:**Medusa 不是 PCM 的家、是 PCM 用的家具**。Medusa 應視為 adapter、不是 framework。9 大藍圖中 Vehicle / Wallet / Booking / Shop / Sync 完全不需要 Medusa(Medusa 蓋 0%)、應各自獨立 bounded context。

### 1.3 啟動 brainstorming skill
Sean 進一步啟動 `/brainstorming`、補大量需求(後台訂單管理 / 商品管理 + Google Sheets 自動化 / 員工不寫程式 / 出貨 / 預約 / 編輯前端工具等)、要求「跳脫原本思考」+「給最好的建議」。

我按 brainstorming skill 規範執行:
1. 範圍分解(5 子系統:🏬 前台 / 🛠️ 後台 / 🤖 自動化 / 🚚 業務流程 / 🧰 工作工具)
2. clarifying questions(一次一題、multi-select、白話比喻)
3. 13 題拍板累積出最終設計
4. 寫 spec doc + self-review

### 1.4 拍板紀錄(Q1-Q15、本對話的核心)

| # | 題目 | Sean 拍板 | 含義 |
|---|---|---|---|
| Q1 | brainstorming 範圍 | A:後台 + 自動化(綁一起) | 其他 3 子系統獨立另開 |
| Q2 | 工作流模式 | A:故事 A 機器主、員工審核 | 自動化是核心、員工輕量 |
| Q3 | 資料層核心 | C:Medusa-as-API + Next.js 自家倉庫 | 推翻「Medusa 為主」思路 |
| Q4 | Phase 1 上線階段 | D:漸進式階段 1 MVP、之後加 2/3 | milestone-driven |
| Q5 | Section 1 整體架構 | A:OK、含 decision 0001 §4 推翻 | admin 改 Next.js 自寫 |
| Q6 | 後台主畫面 | 三合一(紅綠燈 + 收件匣 + 數據)| 三 tab 並存 |
| Q7 | 權限分工 | 員工透明型、唯一紅線 = 不能改金額 | **Sean 風格洞察** |
| Q8 | 商品 / 訂單流程 | OK、補訂單狀態機 | Sean 主動補概念 |
| Q9 | 訂單狀態機初稿 | 用 Sean 完整 8 狀態定義 | **Sean 主動給設計** |
| Q10 | 訂單狀態機修訂 | A:雙維度交叉、完全對 | PCM 特殊 B2B 月結邏輯 |
| Q11 | AI 機器語言 | A:Node.js + node-cron | 跟 monorepo 同源 |
| Q12 | Sheets 整合 | A:Service Account | 不過期、最穩 |
| Q13 | 工具清單 | A:OK | spec §10 |
| Q14 | spec 審核 | **未拍板**(本檔寫作時) | 等 Sean 看完 spec |
| Q15 | setup 順序 | **未拍板** | Sean 想先跟 Claude.ai 討論 |

### 1.5 Sean 主動給的兩個關鍵設計(非我提案、Sean 自己腦中已有)

**a) 員工權限「透明型」(Q7)**
> 「老闆可以做的事情要包含員工部分、出貨、客服等等。員工可以看到經銷價、報表、系統設定等等、唯獨無法修改金額」

Sean 的管理哲學 = **不分商業機密、員工視為夥伴、唯一紅線是金額**。這簡化權限設計成「1 條紅線、其他全開」。

**b) 訂單狀態機「8 狀態雙維度」(Q9-10)**
> 8 個狀態定義 = 客人付款 ✕ PCM 進貨/出貨 交叉
> 含 B2B 月結客戶賒帳分支(未收已定 / 未收出貨 等)

Sean 自己提出這個結構、我做的是把它整理成「雙維度獨立欄位實作」+ 流轉圖。**這個邏輯就是 Q3=C 選擇的證明**:Medusa 內建蓋不到「Sean 跟廠商訂貨」這維度。

---

## 2. 目前狀態 snapshot

### 2.1 整體架構(5 大組件、6 個系統位置)

```
                    🏬 客人(瀏覽器)
                          ↓
            ┌──────────────────────────────────┐
            │   apps/storefront(Next.js 16)    │   ← design 直接搬
            └─────────────┬────────────────────┘
                          │
              ┌───────────┴────────────┐
              ↓                          ↓
   ┌──────────────────┐         ┌──────────────────┐
   │ 🏪 medusa         │         │ 🗄️ supabase       │
   │ (結帳櫃台 API only)│         │ (自家倉庫)         │
   └──────────────────┘         └────────┬─────────┘
                                          ↑
                              ┌───────────┴──────────┐
                              │ 🛠️ apps/admin         │
                              │ (Next.js 後台)        │
                              └───────────┬──────────┘
                                          ↑
                              ┌───────────┴──────────┐
                              │ 🤖 apps/sync-engine   │
                              │ (本機 Node.js daemon)  │
                              └───────────┬──────────┘
                                          ↑
                              📊 Google Sheets(廠商)
```

### 2.2 monorepo 結構演進(對應 architecture-patterns 提案)

```
新增 4 packages + 2 apps:
  packages/domain/      🆕 9 個 bounded contexts
  packages/use-cases/   🆕 跨 entity 業務流程
  packages/ports/       🆕 抽象介面
  packages/adapters/    🆕 Medusa / Supabase / Sheets / TapPay 實作
  apps/admin/           🆕 後台、跟前台同 design 風格
  apps/sync-engine/     🆕 本機 AI 機器
```

### 2.3 5 子系統 Phase 1 規劃進度

| # | 子系統 | 規劃狀態 |
|---|---|---|
| 1 | 🏬 前台展示層 | ✅ 完整(decision 0001 + NORTHSTAR + 偵察報告)|
| 2 | 🛠️ 後台管理層 | ✅ **本對話完成**(spec §1-§7 + §13)|
| 3 | 🤖 自動化 pipeline | ✅ **本對話完成 階段 1 MVP**(spec §8-§9)|
| 4 | 🚚 業務流程 | 🟡 Phase 1 schema 預留、Phase 2 才落地(`vehicle-service-ecosystem.md` 已存在)|
| 5 | 🧰 工作工具 | ✅ **本對話完成 清單**(spec §10)|

### 2.4 階段化路線

```
階段 1 MVP(Phase 1 上線)
  - 8-10 週上線估算
  - 範圍 = spec §3
  - 自動化只做 Sheets ↔ 候選清單
  - 訂單 / 物流 / LINE 通知 都手動

階段 2(上線後 1-2 個月)
  - AI 寫商品內文
  - 圖片自動處理
  - 廠商爬蟲

階段 3(階段 2 穩定後)
  - 訂單自動分流
  - LINE OA 通知
  - 物流 API 串接

Phase 2(獨立 brainstorming)
  - 車輛履歷 + 移轉
  - 詢價 + 預約 + 店家行事曆
  - 三層折扣疊加
  - 詳見 vehicle-service-ecosystem.md
```

### 2.5 與 decision 0001 衝突處理

衝突點 = 1 個:**§4「Phase 1 不寫客製 admin」推翻**(Q5 + Q3=C 已隱含)。
其他 8 條都是補充、不衝突。

---

## 3. 待辦清單

### 3.1 🔴 Sean 待拍板(本對話結束時)

```
Q14: spec 內容是否 OK
Q15: setup 與 writing-plans 的順序
Q16: design file 處理(既有 / Claude Design 補 / 後台 design)
```

詳見本檔 §6 「Sean 應該跟 Claude.ai 討論什麼」。

### 3.2 🟠 Sean 待做(進實作前的 setup)

按 spec 推薦,有 4 件「立即」+ 6 件「途中 / 之後」:

**立即(進 writing-plans 前 30 分鐘):**
1. Supabase 新 project(SG region、免費 tier)
2. Google Cloud Console + Service Account JSON(sync-engine 必須)
3. Vercel project(連 GitHub repo)
4. Railway project(Medusa template)

**途中(milestone 到了才做):**
5. TapPay sandbox 帳號(M-3 訂單時)
6. Google Sheets 範本準備(M-5 sync-engine 時)

**之後 / 階段 3:**
7. LINE OA 帳號
8. 黑貓 / 7-11 物流 API
9. Cloudinary(階段 2 圖片)
10. Anthropic API key(階段 2 AI 寫內文)

### 3.3 🟡 Claude Code 待寫的文件(spec §14)

拍板進 writing-plans 後、實作過程要寫:

```
1. docs/decisions/0002-architecture-pivot.md         (正式記錄推翻 §4)
2. docs/architecture/bounded-contexts.md             (9 contexts 詳細邊界)
3. docs/architecture/ports-and-adapters.md           (interface 簽名)
4. docs/architecture/dependency-rules.md             (ESLint 設定)
5. docs/features/PRD-rewrite.md                      (Phase 1 完整 PRD)
6. docs/PHASE-1-MILESTONES.md                        (M-0 ~ M-6 排程)
7. docs/architecture/testing-strategy.md             (測試方針)
```

### 3.4 🟡 Claude Design 待補(前台 design 缺的 3 頁 + 1 微調)

按 design 偵察報告 + Sean 04-30 親自驗證:

```
1. 結帳後段(運送 / 付款 / 確認下單)— M-3 訂單前要補
2. 訂單詳情頁(從訂單列表點進去)— M-3
3. 經銷申請頁(三級會員申請)— M-2 Identity 前
4. Vehicle Finder 加「我的車」按鈕(微調)— M-1 Catalog
```

→ Sean 在 Claude Design 做、push pcm-website-design repo、Claude Code `git submodule update --remote` 拿。

### 3.5 🟢 提案中、未拍板事項(待 Claude.ai 幫忙釐清)

- 後台 admin 是否也要 Claude Design 做精緻 design(Q16-B)、還是用 @pcm/ui tokens 自組(Q16-A、推薦)
- 階段 1 MVP 預估 8-10 週是否能對齊 Sean 的時程預期
- 員工數量 / 角色細分(目前 spec §4.2 只分 Sean / 員工兩級、未來會否加「會計 / 客服」獨立)

---

## 4. 未來進度架構(預估 milestones)

### 4.1 Writing-plans skill 將產出的 milestone 結構

按 spec §3 範圍 + bounded contexts、預估 7 個 milestone(每個 1-2 週):

```
M-0:骨架就位(1 週)
  ├── 0.1 packages/{domain,use-cases,ports,adapters} 空殼
  ├── 0.2 apps/{admin,sync-engine} 空殼
  ├── 0.3 ESLint 依賴規則守門
  └── 0.4 ports 抽象介面定義(spec §6)

M-1:Catalog bounded context spike(1-2 週)
  ├── 1.1 domain/catalog entities(Product / Brand / Category / VehicleModel)
  ├── 1.2 ports + Medusa adapter(IProductRepository)
  ├── 1.3 storefront 顯示商品(直接搬 design ProductsPage / ProductPage)
  └── 1.4 hardcode mock data 通

M-2:Identity + Pricing(1-2 週)
  ├── 2.1 customer / tier 三級會員
  ├── 2.2 經銷申請流程(待 Claude Design 補頁)
  └── 2.3 兩 tier 價格(retail / wholesale)

M-3:Order + 訂單狀態機(2 週)
  ├── 3.1 cart / order 接 Medusa
  ├── 3.2 訂單狀態機 8 狀態(domain/order)
  ├── 3.3 TapPay sandbox 整合
  └── 3.4 訂單詳情頁前台 + 結帳後段(待 Claude Design 補頁)

M-4:後台 admin UI(2 週)
  ├── 4.1 主畫面三合一(儀表板 / 收件匣 / 數據)
  ├── 4.2 商品 CRUD + 待審核清單
  ├── 4.3 訂單列表 + 8 狀態流轉
  └── 4.4 員工權限 + 改金額紅線

M-5:sync-engine + Sheets(1-2 週)
  ├── 5.1 Node.js daemon + node-cron
  ├── 5.2 Google Sheets API + Service Account
  ├── 5.3 商品候選同步邏輯
  └── 5.4 後台機器狀態看板

M-6:整合測試 + 部署(1-2 週)
  ├── 6.1 E2E 流程跑通(瀏覽 → 加購 → 結帳 → 後台出貨)
  ├── 6.2 SEO + structured data 全頁
  ├── 6.3 部署 Vercel + Railway
  └── 6.4 上線驗收
```

**估算總時程:8-12 週**(對齊 spec §0 TL;DR 的「8-10 週上線」)。

### 4.2 階段 2 / 3 預估(上線後)

```
階段 2(2-3 個月):
  - AI 寫內文(claude-api adapter)
  - 圖片處理(image-processor adapter)
  - 廠商爬蟲(vendor-crawler adapter)

階段 3(階段 2 穩定後):
  - 訂單分流 use case
  - LINE OA adapter
  - 物流 API adapter

每個新增都是 packages/adapters/ 加新 adapter、不動既有 code。
```

### 4.3 Phase 2 預估

```
Phase 2 全套 25-30 週(約 12-14 個月)
  - 車輛履歷(vehicle-service-ecosystem.md §5-§7)
  - 預約 + 店家(§4)
  - 詢價(§4.2-4.3)
  - 三層折扣(§5.6)
  - Excel 大量上架(Phase 2 PRD 待寫)

Phase 2 啟動條件 = Phase 1 階段 3 穩定運行 1 個月以上
```

---

## 5. Claude.ai 應該幫忙確認的事

### 5.1 短期(本週決定)

```
A. spec 內容是否符合 Sean 真實需求?
   - Sean 在 brainstorming 時可能因為 multi-select 限制、漏選某些選項
   - 跟 Claude.ai 重新 review、看有沒有遺漏的子系統 / 功能

B. setup 順序選 A / B / C / D?(spec §14、本檔 §3.2)
   - A:先做 4 件 setup、再進 writing-plans(我推薦)
   - B:直接進 writing-plans、setup 過程做
   - C:Sean 自己排
   - D:挑最少最簡方案(可能改 Supabase → Vercel Postgres 等)

C. design file 選 A / B / C?(本檔 §3.4 + spec §3.1)
   - A:後台用 @pcm/ui tokens 自組(我推薦)
   - B:後台也做精緻 design(Claude Design 排期)
   - C:先動工、design 遇到再說
```

### 5.2 中期(進 writing-plans 前)

```
D. milestone 順序是否合理?
   - 我 §4.1 預估 M-0 → M-6 順序
   - Claude.ai 看是否要調整(例:M-2 Identity 可能要在 M-1 之前?)

E. 階段 2 / 3 的觸發條件?
   - 「上線後 1-2 個月」太籠統
   - Claude.ai 幫定義「什麼指標達到、就觸發階段 2 啟動」

F. 後台 admin 的 「改金額紅線」具體 UI?
   - 員工點到變灰、提示「需 Sean 權限」
   - 但 Sean 何時通知?LINE 推?Email?後台 inbox?
```

### 5.3 Sean 一直擱置、可能要 Claude.ai 介入的點

```
G. PRD-rewrite.md 內容
   - decision 0001 §3.8 拍板要寫
   - 本對話沒寫(進 writing-plans 才寫)
   - Claude.ai 幫 outline 內容?

H. 三級會員「premium_store 自動升級」邏輯
   - 累積儲值 ≥ NT$100,000(PROJECT-OVERVIEW §1.2)
   - 「累積」是何時起算、退款影不影響?
   - spec 沒涵蓋、Claude.ai 幫拍板

I. PCM 不碰工資 vs 預約安裝抽成
   - PROJECT-OVERVIEW §1.3 寫「PCM 只賺零件差價、店家賺工資」
   - 但 Phase 2 預約系統若涉及金流、PCM 抽不抽?(目前說不抽)
   - Claude.ai 幫 Sean 想清楚商業模式邊界

J. Sync engine 機器當機處理
   - 後台「暫停超過 2 小時」紅燈警告
   - 階段 1 MVP 還沒 LINE 通知、紅燈警告 Sean 可能沒看到
   - 怎麼確保 Sean 24 小時內知道?
```

---

## 6. Claude.ai 不需要重做的事

避免 Sean 跟 Claude.ai 重新討論已拍板:

```
✅ 已拍板、不要推翻:
- Q1-Q13 全部 13 題拍板(本檔 §1.4)
- Sean 主動給的訂單狀態機(雙維度、8 狀態)
- Sean 主動給的權限分工(透明型 + 改金額紅線)
- Medusa-as-API + Next.js 自家倉庫(Q3=C)
- 漸進式階段 1 MVP(Q4=D)
- 5 大組件 + monorepo 結構(spec §2)
- 階段 1 MVP 範圍(spec §3)

❌ 已被 brainstorming 否決、不要復活:
- Medusa 為主的 schema 哲學(Q3=A 否決)
- 純 Supabase 全自寫(Q3=B 否決)
- Payload CMS(Q3=D 否決)
- 全套一次到位(Q4=A/B/C 否決)
- 故事 B 員工主、機器輔(Q2=A 故事 A 否決 B)
```

---

## 7. Sean 在 Claude.ai 對話可能會出現的歷史包袱

Claude.ai 跟 Sean 累積大量舊對話、可能有:

```
- 第一輪 PCM 專案(2025-04 至 2026-04-29、舊 repo)的所有討論
- editorial 全站方向(v1 北極星、已退役)
- 既有 Medusa schema 設計討論(decision 0001 §3.1 全清空)
- OrdersClient TDZ 事故(已棄用、Orchestrator 永久禁用)
- Supabase RLS 警告事件(2026-04-23、已處理)
- 04-29 整個重做拍板過程
- 04-30 design-reference 偵察報告(這個還算新、有用)
```

**重要:** 本對話的決策(本檔 §1.4 Q1-Q13)是**最新狀態**、優先於 Claude.ai 任何更早的對話記憶。若衝突 → 以本檔為準、以 spec 為準。

---

## 8. 本對話結束後 Sean 的下一步建議路徑

### 8.1 若 Claude.ai 認可所有拍板

```
Sean 回 Claude Code:「Q14: A、Q15: A、Q16: A」
       ↓
Claude Code commit 兩份 spec + 本交接檔(精準 add)
       ↓
Sean 手動 push(review checkpoint)
       ↓
Sean 做 4 件 setup(Supabase / Google Cloud / Vercel / Railway)
       ↓
Sean 開新 Claude Code session
       ↓
Sean 啟動 /writing-plans skill
       ↓
產出 docs/PHASE-1-MILESTONES.md(M-0 ~ M-6)
       ↓
M-0 第一個 slice 動工
```

### 8.2 若 Claude.ai 想推翻某些拍板

```
Sean 回 Claude Code:「Q14: B、要改 §X 段」
       ↓
Claude Code 重新 brainstorming 對應段
       ↓
新拍板紀錄補進 spec
       ↓
循環直到 spec 收斂
```

### 8.3 若 Claude.ai 想加新討論

```
Sean 跟 Claude.ai 討論完
       ↓
Claude.ai 寫新 multi-select 問題給 Sean
       ↓
Sean 在新 Claude Code session 把新拍板貼進來
       ↓
Claude Code 把新拍板加進 spec / 寫新 decision
```

---

## 9. 一句話總結給 Claude.ai

> **本對話用 brainstorming + architecture-patterns 兩 skill、把 Sean 卡關 6 週的「後台 + 自動化」釐清成可執行 spec。架構大方向 = Medusa-as-API + Next.js 自家倉庫、漸進式階段 1 MVP 上線、AI 機器在本機跑 Node.js + Sheets 同步。13 題拍板已收斂、待 Sean 與你 review 後進 writing-plans skill 拆 milestone。**

---

## 10. 後續更新(2026-04-30 setup 完成)

> **新增於本對話末段、4 件 setup 全部完成後寫入。**

### 10.1 4 件 setup 結果

| Setup | 結果 | 細節 |
|---|---|---|
| ✅ Supabase | 完成 | Project URL + anon + service_role key、Region SG、**RLS auto enable 已啟用**(治第一輪 RLS 警告事件根因) |
| ✅ Vercel | 完成、deploy fail | Project `pcm-website-v2`、Production URL = `pcm-website-v2-git-main-pcm-motorsports.vercel.app`、Root Directory = `apps/storefront`、**deploy fail = pnpm 6.35.1 vs ≥9.15.0**(M-1 解) |
| ✅ Railway | 完成、deploy fail | Service URL = `pcmmedusa-production.up.railway.app`、port 8080、**deploy fail = Medusa env vars 沒設**(M-3 解) |
| ✅ GCP | 完成 | Project = `pcm-sync-engine`、SA email = `pcm-sync-engine@pcm-sync-engine.iam.gserviceaccount.com`、JSON key = `~/Documents/pcm-credentials/gcp-sync-engine.json`、Sheets API + Drive API enabled |

### 10.2 setup 途中事件(經驗、寫進 lessons-learned 候選)

**a) dev merge main 是 Phase 1 baseline**
- Vercel import 預設讀 main、但 main 是空的、看不到 apps/
- Sean 在 Terminal 跑 `git merge dev --ff-only && git push origin main` 解
- 9f609b0 已 push 到 main、main 與 dev 同步

**b) GCP 組織政策 `iam.disableServiceAccountKeyCreation` 預設啟用**
- 新 Google Workspace organization 預設禁止建 SA key(Google 推 OAuth/WIF)
- Sean 是組織擁有者、但缺 `roles/orgpolicy.policyAdmin` role
- 解法:給自己加 `Organization Policy Administrator` role → 改政策「未強制執行」 → 等 propagate 1-2 分鐘 → 重建 SA key
- **教訓:未來 lessons-learned 可寫「GCP 新 org 預設 SA key 政策、setup 流程必含改 policy 步驟」**

**c) Vercel monorepo Root Directory 必改**
- Vercel 預設 Root Directory = `./`、但 PCM 是 monorepo、storefront 在 `apps/storefront/`
- 必須在 import 階段點 [Edit] 改 Root Directory(setup 流程必含)

**d) Railway 自動偵測兩個 service**
- Railway 看到 monorepo 兩個 app、自動建議建兩個 service(@pcm/medusa + @pcm/storefront)
- PCM 設計 storefront 用 Vercel、Railway 只跑 medusa
- Sean 刪掉 @pcm/storefront、只留 medusa(setup 流程必含「刪多餘 service」步驟)

### 10.3 兩個失敗預期、M-1/M-3 解

| 失敗 | 根因 | 何時解 |
|---|---|---|
| Vercel deploy fail | pnpm 6.35.1 vs decision 0001 拍板 ≥9.15.0 | M-1:加 `vercel.json` + 環境變數 `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Railway deploy fail | Medusa 沒 DATABASE_URL / JWT_SECRET / COOKIE_SECRET 等 env | M-3:補 env vars(從 Setup 1 Supabase 拿 connection string) |

### 10.4 setup-wizard slice 經驗(寫進 lessons-learned 候選)

Claude.ai feedback Q15-A 寫「GCP 用 setup-wizard slice、Sean 不摸 IAM」。實際執行:
- Claude Code 在同一個 session 內 step-by-step 引導、Sean 跟著點
- 中文 dashboard 對應英文官方文件、Claude Code 自動翻譯按鈕名
- 卡點(組織政策 + 無 orgpolicy.policyAdmin role)Claude Code 即時診斷 + 給解
- **結論:setup-wizard slice 不一定要新 session 跑、現場引導也行、但要備好「常見卡點」清單**

### 10.5 安全紅線維持(setup 過程嚴守)

- ❌ Supabase service_role key 沒貼對話、沒 push
- ❌ GCP JSON key 內容沒貼對話、移到 `~/Documents/pcm-credentials/`
- ❌ Vercel team token / Railway service token 沒碰
- ✅ Public URL / SA email / Project URL 可貼(原本就公開)
- ✅ JSON key 路徑可貼(內容才敏感)

### 10.6 下一步(取代 §8.1)

```
1. ✅ Claude Code commit 兩份 spec + 交接檔 + feedback 檔(已完成、9f609b0)
2. ✅ Sean push GitHub(已完成、9f609b0 在 dev + main)
3. ✅ Sean 做 4 件 setup(已完成、本 §10 紀錄)
4. ⏳ Sean 開新 Claude Code session
5. ⏳ Sean 啟動 /writing-plans skill
6. ⏳ Claude Code 產出 docs/PHASE-1-MILESTONES.md(納入 feedback §4 修訂版)
7. ⏳ Claude Code 寫 docs/decisions/0002-architecture-pivot.md
8. ⏳ M-0 第一個 slice 動工
```

— 後續更新結束 —

---

— 交接結束 —
