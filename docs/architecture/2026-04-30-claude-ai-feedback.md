# Claude.ai review 補充建議與後續執行紀錄

> **狀態:** 🟢 Sean 已收 Claude.ai feedback、回貼到 Claude Code 確認
> **日期:** 2026-04-30
> **作者:** Claude Code(紀錄 Claude.ai 回饋 + 待納入項目)
> **觸發:** Sean 把三份 spec 上傳 Claude.ai review、Claude.ai 認可大方向 + 回 Q14/15/16 + 7 大組補充建議
>
> **本檔角色:** brainstorming session 的後續 review 紀錄、進 writing-plans 時必讀。
>
> 配合閱讀:
> - `proposed-architecture-2026-04-30.md`(架構提案)
> - `2026-04-30-backend-and-automation-design.md`(主 spec)
> - `2026-04-30-handoff-to-claude-ai.md`(送 Claude.ai 的對接報告)

---

## 0. Claude.ai review 結果

### 0.1 三份檔審核

| 檔 | 結果 |
|---|---|
| `proposed-architecture-2026-04-30.md` | ✅ 認可 |
| `2026-04-30-backend-and-automation-design.md` | ✅ 認可 13 題拍板 |
| `2026-04-30-handoff-to-claude-ai.md` | ✅ 認可、§5 10 個 Q 部分採用 |

### 0.2 Q14 / Q15 / Q16 拍板

| Q | 答 | 附加注意 |
|---|---|---|
| Q14 | **A** — spec 內容 OK、認可 13 題拍板 | 無 |
| Q15 | **A** — 先做 4 件 setup、再進 writing-plans | Service Account JSON 那步用 **setup-wizard slice**、Sean 不自己摸 GCP IAM |
| Q16 | **A** — 後台 admin 用 @pcm/ui tokens 自組 | **前提:M-1 Catalog spike 必須交付完整 packages/ui design tokens、否則 M-4a 會土法煉鋼** |

---

## 1. 7 大組補充建議(A-G)

### A. 漏掉的子系統 — 補進 spec / PRD-rewrite

#### A1. 客服流程 🔴 階段 1 MVP 必含

- **問題:** PROJECT-OVERVIEW §1.4 鐵則「退貨走人工客服」、但 spec 沒對應後台 UI
- **要做:** 階段 1 MVP 至少要有「客服 inbox」(收 LINE / Email / 電話紀錄、員工處理)
- **不做後果:** Sean 用紙筆 / Excel、不可行
- **落點:** 寫進 spec §3.2 後台 admin、列階段 1 MVP

#### A2. 運費計算 use-case 🔴 階段 1 MVP 必含

- **問題:** spec / image 7 截圖看到「滿 NT$ 4,000 免運」、但運費規則沒進 spec
- **要處理:**
  - 基本門檻(NT$ 4,000 免運)
  - 偏遠地區加價
  - 兩種運送方式運費差(宅配 / 超商)
  - 經銷商免運門檻
- **落點:** `packages/use-cases/calculate-shipping.ts`
- **Phase 1 階段 1:** hardcode(滿 4000 免運 / 離島加 200 / 寄店家固定 100)
- **Phase 2:** 後台可調

#### A3. 發票 / 統編處理 🟡 待 Sean 拍板

- **問題:** 台灣電商法定、spec 沒涵蓋
- **涵蓋:**
  - 電子發票 vs 紙本
  - 統編必填
  - vendor 選擇(綠界 / 藍新 / 國稅局)
  - 折讓單
- **待拍板:** Phase 1 階段 1 是否自動化、還是手動開
- **不阻擋進 writing-plans、進去後第一個 backlog 條目**

#### A4. SEO / structured data 細節

- **問題:** spec §3.1 寫「day 1 起」但沒展開
- **待補:**
  - 每個 page type 對應 schema.org type(Product / Brand / BreadcrumbList / Organization)
  - sitemap 產法(SSG / SSR / 動態)
- **落點:** PRD-rewrite.md 寫時補

#### A5. 商品「報價變動」告警 UI 細節

- **問題:** spec §8.2 寫「報價變動進後台告警」、但沒 UI 規格
- **待補:** 徽章?Email?後台 inbox?
- **落點:** M-5 sync-engine 時 spec 補

#### A6. 全部商品首批種子資料策略 🔴 影響 M-1

- **問題:** sync-engine 階段 1 才開始跑、但 Phase 1 上線當天客人要看到滿滿商品
- **抉擇:** 先匯入既有 5,000+ SKU?還是 sync-engine 跑一段時間累積?
- **影響:** M-1 Catalog 的 mock data 策略
- **落點:** writing-plans M-1 設計時拍板

#### A7. 行動裝置後台

- **問題:** 員工出貨可能在倉庫、用手機看訂單
- **抉擇:** admin 是 desktop-only 還是 responsive?spec 沒明寫
- **建議:** Phase 1 階段 1 = responsive 但不做 mobile-first(降低工作量)

### B. milestone 順序調整

#### B1. M-2 Identity 拆兩段

```
原版:M-1 Catalog → M-2 Identity → M-3 Order

調整:M-1 Catalog + 基本 Customer (login / register only)
     M-2 Identity 完整 (tier / 經銷申請 / 我的車)
     M-3 Order
```

**理由:**
- M-1 完成商品瀏覽但客人沒帳號、無法測「加購」流程
- 基本 Customer 提前到 M-1 末跟 Catalog spike 一起驗 ports 抽象
- 避免 M-3 才發現 leaky abstraction

#### B2. M-4 後台 admin 拆兩段

```
原版:M-4 後台 admin (一次做完)

調整:M-4a 商品 + 訂單管理 (M-3 完成後立刻、Sean 才能處理訂單)
     M-4b 機器狀態看板 + 員工權限 (M-5 sync-engine 後)
```

**理由:**
- Phase 1 上線前 Sean 至少要能處理客人訂單、不能等所有 admin 功能做完
- M-4a 先給 Sean 處理訂單能力、M-4b 是進階功能、跟 sync-engine 配對

#### B3. 修訂後 milestone 順序

```
M-0  骨架就位
M-1  Catalog spike + 基本 Customer (login/register)
M-2  Identity 完整 (tier / 經銷申請 / 我的車) + Pricing
M-3  Order + 訂單狀態機 + TapPay
M-4a 後台 admin 商品 + 訂單管理
M-5  sync-engine + Sheets
M-4b 機器狀態看板 + 員工權限細節
M-6  整合測試 + 部署
```

### C. 階段 2 / 3 觸發條件具體化

#### C1. 階段 2 觸發指標(任一達成即啟動)

- 商品數量 ≥ 3,000(Sean 一個人寫內文跟不上)
- 月訂單 ≥ 200(寫內文佔 Sean 50% 以上時間)
- Sean 親自說「我不想再寫內文了」(主觀痛點 = 客觀指標的領先指標)

#### C2. 階段 3 觸發指標

- 月訂單 ≥ 500(LINE / 物流自動化 ROI 浮現)
- 員工數 ≥ 3 人(權限 / 通知變複雜)
- 訂單分流錯誤率 ≥ 5%(手動處理出包)

**落點:** 寫進 `docs/architecture/scaling-triggers.md`、跟主 spec 同 commit。

### D. 三級會員 premium_store 升級邏輯

#### D1. 累積規則

- **累積 =** 客人在 PCM 已付款 + 已出貨的訂單金額總和
- **起算:** 客人帳號建立後第一筆已出貨訂單
- **退款影響:**
  - 整筆退款 → 從累積扣除
  - 部分退款 → 按退款金額扣
- **升級時機:** 每筆已出貨訂單後立刻檢查、過 NT$ 100,000 立刻升級
- **降級:** 不降級(累積永久、客人感覺被獎勵不被剝奪)
- **通知:** 升級當下 admin/inbox 紅徽章、員工手動 LINE 通知客人(階段 3 自動)

#### D2. 邊界

- 賒帳訂單(8 狀態的 4 / 6)**不算入累積**
- 要「已收已出」(狀態 8)才算
- 因為賒帳訂單可能拖延、不算入避免操弄

**落點:** 寫進 PRD-rewrite §3 三級會員段。

### E. 後台「改金額紅線」UI

#### E1. Phase 1 階段 1 MVP 推薦

- 員工點「改金額」按鈕 → 按鈕變灰、tooltip「需 Sean 權限、已通知」
- 同步:寫進 admin/inbox(Sean 收件匣、上方紅色徽章)
- **不接 LINE**(階段 3 才接、LINE 整合不該為這個小功能提前)

#### E2. 階段 3 升級

- LINE OA 即時推給 Sean
- 或 Telegram bot(Sean 已有 Telegram bot 經驗、可選)

### F. sync-engine 當機保險強化

#### F1. 階段 1 MVP 兩層保險

- **第一層(被動、spec 已寫):** 機器 2 小時沒同步 → admin 主畫面紅燈
- **第二層(主動、新增):** 每天早上 9 AM 自動寄 daily summary email 給 Sean
  - 內容:昨日同步幾次 / 失敗幾次 / 候選新增幾件
  - 失敗超過 3 次的紅字標
  - Sean 開信箱就看到、不必登入後台

#### F2. 階段 3 升級

- LINE OA 即時推

**落點:** 寫進主 spec §8.3 機器當機處理段(進 writing-plans 時 spec 補)。

### G. 測試 / QA 策略待 Sean 拍板

#### G1. 主 spec §15.1 提「in-memory adapter / use-case 單元測試」、但缺

- 誰寫測試?(Sean 不寫 code、Claude Code 寫)
- 覆蓋率目標?(critical path 100%?整體 60%?)
- E2E 測試是否做?(NORTHSTAR 寫不做、但「只靠 unit test + 肉眼驗收」風險高)

#### G2. 待 Sean 拍板:風險 vs 工作量

- 進 writing-plans 第一個 backlog 條目

---

## 2. 待 Sean 後續拍板(2 項)

| # | 待拍板 | 觸發時機 |
|---|---|---|
| A3 | Phase 1 階段 1 是否做發票自動化 | writing-plans 時拍 |
| G2 | 測試覆蓋率目標 + E2E 是否做 | writing-plans 時拍 |

---

## 3. 對既有 spec 的影響(納入順序)

### 3.1 進 writing-plans 時直接落地(不改 spec)

```
A1 客服 inbox          → milestone 設計時拆 slice
A2 運費計算            → packages/use-cases/calculate-shipping.ts(M-3)
A6 種子資料策略        → M-1 Catalog 設計時拍
A7 responsive admin    → M-4a / M-4b 設計時併入
B1 / B2 milestone 順序 → 直接照修訂版排
```

### 3.2 進 writing-plans 前要寫的新檔(同 commit)

```
docs/architecture/scaling-triggers.md  → C1 / C2 階段觸發指標
```

### 3.3 進 writing-plans 寫 PRD-rewrite 時納入

```
A4 SEO / structured data 細節
D 三級會員 premium_store 升級邏輯
G1 / G2 測試策略段
```

### 3.4 主 spec 細節補充(M-5 sync-engine 設計時)

```
A5 報價變動告警 UI
F1 / F2 sync-engine 兩層保險
```

---

## 4. 對 milestone 順序的影響

修訂版 milestone 排程(取代主 spec §14 + handoff §4.1):

```
M-0  骨架就位                      (1 週)
     ├ 0.1 packages/{domain,use-cases,ports,adapters} 空殼
     ├ 0.2 apps/{admin,sync-engine} 空殼
     ├ 0.3 ESLint 依賴規則守門
     └ 0.4 ports 抽象介面定義

M-1  Catalog spike + 基本 Customer  (1-2 週)
     ├ 1.1 domain/catalog entities
     ├ 1.2 ports + Medusa adapter
     ├ 1.3 storefront 顯示商品
     ├ 1.4 基本 Customer (login / register)
     ├ 1.5 packages/ui design tokens 完整交付 ⭐ (M-4a 前提)
     └ 1.6 種子資料策略決定 (A6)

M-2  Identity + Pricing             (1-2 週)
     ├ 2.1 customer / tier 三級會員
     ├ 2.2 經銷申請流程
     ├ 2.3 我的車 (vehicle schema 預留)
     └ 2.4 兩 tier 價格

M-3  Order + 訂單狀態機             (2 週)
     ├ 3.1 cart / order 接 Medusa
     ├ 3.2 訂單狀態機 8 狀態
     ├ 3.3 TapPay sandbox 整合
     ├ 3.4 calculate-shipping use-case (A2)
     └ 3.5 訂單詳情頁前台 (待 Claude Design 補)

M-4a 後台 admin 商品 + 訂單管理     (1.5 週)
     ├ 4a.1 主畫面三合一 (儀表板 / 收件匣 / 數據)
     ├ 4a.2 商品 CRUD + 待審核清單
     ├ 4a.3 訂單列表 + 8 狀態流轉
     ├ 4a.4 客服 inbox 基本版 (A1)
     └ 4a.5 改金額紅線 UI (E1)

M-5  sync-engine + Sheets           (1-2 週)
     ├ 5.1 Node.js daemon + node-cron
     ├ 5.2 Google Sheets API + Service Account (setup-wizard slice 引導 Sean 不摸 GCP IAM)
     ├ 5.3 商品候選同步邏輯
     ├ 5.4 機器狀態看板
     ├ 5.5 報價變動告警 UI (A5)
     └ 5.6 daily summary email 保險 (F1)

M-4b 後台進階(權限 / 員工分工)    (0.5 週)
     ├ 4b.1 員工權限細節
     ├ 4b.2 機器狀態看板深化
     └ 4b.3 改金額審核流程完整版

M-6  整合測試 + 部署                (1-2 週)
     ├ 6.1 E2E 流程跑通 (G2 拍板後)
     ├ 6.2 SEO + structured data 全頁 (A4)
     ├ 6.3 部署 Vercel + Railway
     └ 6.4 上線驗收
```

**估算總時程:9-12 週**(原 8-10 週 + B 拆分增加 1-2 週)。

---

## 5. 下一步執行順序

```
1. Claude Code commit 三份 spec + 交接檔 + 本檔(精準 add)
       ↓
2. Claude Code 不 push、提示 Sean
       ↓
3. Sean 手動 push GitHub(review checkpoint)
       ↓
4. Sean 做 4 件 setup
   ├ Supabase 新 project (Sean 自己、5 分鐘)
   ├ Google Cloud + Service Account (用 setup-wizard slice 引導、不摸 IAM)
   ├ Vercel project (Sean 自己、5 分鐘)
   └ Railway project (Sean 自己、5 分鐘)
       ↓
5. Sean 開新 Claude Code session
       ↓
6. Sean 啟動 /writing-plans skill
       ↓
7. Claude Code 產出 docs/PHASE-1-MILESTONES.md(納入本檔 §4 修訂版 milestone)
       ↓
8. Claude Code 寫 docs/decisions/0002-architecture-pivot.md(正式記錄推翻 §4)
       ↓
9. M-0 第一個 slice 動工
```

---

## 6. 一句話總結

> **Claude.ai 認可 13 題拍板大方向 + 加 7 大組補建議(客服 / 運費 / 發票 / SEO / 報價告警 / 種子資料 / 行動後台 / milestone 拆分 / 階段觸發 / 升級規則 / 改金額 UI / 機器保險 / 測試策略)。修訂版 milestone 9-12 週上線、setup-wizard slice 引導 GCP、M-4 拆 a/b 兩段、M-1 必須交付完整 packages/ui design tokens 為 M-4a 前提。**

— review 紀錄結束 —
