# Scaling Triggers — Phase 1 階段 2 / 3 與 Phase 2 觸發指標

> **狀態:** 🟢 已拍板 / 2026-04-30
> **作者:** Claude Code(`/writing-plans` skill 產出、依 Claude.ai feedback §C 拍板)
> **讀者:** Sean(每月看一次、決定是否觸發升級)+ 任何 Claude Code session(評估是否啟動下階段)
> **何時讀:**
> - Phase 1 階段 1 上線後、每月 review 機器看板數據
> - 商品 / 訂單 / 員工數量出現變化時
> - 想啟動階段 2 / 3 / Phase 2 前
>
> 配合閱讀:
> - `docs/architecture/2026-04-30-claude-ai-feedback.md` §C(本檔來源)
> - `docs/PHASE-1-MILESTONES.md`(階段 1 範圍)
> - `docs/architecture/2026-04-30-backend-and-automation-design.md` §12(階段 2 / 3 演進路線)
> - `docs/PHASE-2-VISION.md`(Phase 2 範圍)
> - `docs/decisions/0002-architecture-pivot.md`(架構支撐階段 2 / 3 演進)

---

## 0. 為什麼需要這份檔

主 spec §12 寫「階段 2 上線後 1-2 個月觸發、階段 3 階段 2 穩定後觸發」**太籠統**:

- 「上線後 1-2 個月」不是觸發條件、是時間想像
- 真正的觸發是「業務狀態到了某個點、不升級會痛」
- Sean 一個人記不住何時該升級、需要客觀指標

本檔把模糊時間轉成**客觀指標 + 主觀痛點**,Sean 看後台 dashboard 就知道該升級。對齊 working-style.md「milestone-driven 不是 calendar-driven」精神。

---

## 1. 階段 2 觸發指標

> **任一達成即啟動。** 不必三條全中。

### 1.1 商品數量 ≥ 3,000

**為什麼:** Sean 一個人寫商品內文跟不上、3,000 件之後寫內文佔 Sean 50% 以上時間。

**監控位置:** `apps/admin/dashboard` 數據 tab、商品總數計數器(M-4a-05 slice 含)。

**觸發後做什麼:** 啟動階段 2 packages/adapters/claude-api(AI 寫商品內文)、員工只審不寫。

### 1.2 月訂單 ≥ 200

**為什麼:** 寫內文佔 Sean 50% 以上時間的另一個切角。月訂單 200 表示客人量起來、Sean 注意力應在客戶服務 + 訂單處理、不在寫內文。

**監控位置:** `apps/admin/dashboard` 數據 tab、月訂單計數器。

**觸發後做什麼:** 同 1.1。

### 1.3 Sean 主觀痛點:「我不想再寫內文了」

**為什麼:** 主觀痛點是客觀指標的領先指標。Sean 還沒到 3,000 件就先煩、表示心理閾值已過、應該升級。

**監控位置:** Sean 自己。一說出「不想再寫內文了」就觸發。

**觸發後做什麼:** 同 1.1。

### 1.4 階段 2 範圍速查

階段 2 觸發後、按主 spec §12.1:

- AI 寫商品內文 → 加 `packages/adapters/claude-api/`
- 圖片自動處理(壓縮 / WebP / OG image)→ 加 `packages/adapters/image-processor/`
- 廠商網站爬蟲 → 加 `packages/adapters/vendor-crawler/`
- 後台 UI 加「AI 寫內文預覽」按鈕

**新增工作不動既有 code、純加 adapter + use-case**(架構支撐、見 0002 §5.1 擴充性)。

---

## 2. 階段 3 觸發指標

> **任一達成即啟動。** 階段 2 完成後再評估。

### 2.1 月訂單 ≥ 500

**為什麼:** 訂單量到 500 / 月 ≈ 20 / 天、員工處理已吃緊。LINE 通知 / 物流 API 自動化 ROI 浮現(節省員工每天 2-3 小時手動處理)。

**監控位置:** `apps/admin/dashboard` 數據 tab、月訂單計數器。

**觸發後做什麼:** 啟動 LINE OA adapter + 物流 API adapter + 訂單分流 use-case。

### 2.2 員工數 ≥ 3 人

**為什麼:** 員工 1-2 人時、Sean 直接管理、權限分工簡單(透明型 + 改金額紅線)。員工 3 人以上、需要角色細分(會計 / 客服 / 出貨)、權限變複雜。LINE 通知不能再依賴口頭交代。

**監控位置:** `apps/admin/customers` 員工列表。

**觸發後做什麼:** 員工角色細分 + LINE OA adapter(員工互通)+ 改金額審核 workflow 強化。

### 2.3 訂單分流錯誤率 ≥ 5%

**為什麼:** 員工手動分流(寄家 / 寄店家)出包率 5% 表示流程已超出人腦負擔、自動化能省錯誤成本。

**監控位置:** admin/orders 月度 audit log、錯誤分流回收計數。

**觸發後做什麼:** 啟動訂單自動分流 use-case(`packages/use-cases/auto-fulfillment-route.ts`)。

### 2.4 階段 3 範圍速查

階段 3 觸發後、按主 spec §12.2:

- 訂單自動分流 → `packages/use-cases/auto-fulfillment-route.ts`
- LINE OA 通知 → `packages/adapters/line-oa/`
- 庫存監控告警 → `packages/use-cases/inventory-alert.ts`
- 物流 API 串接 → `packages/adapters/logistics/{black-cat,7-11}/`

---

## 3. Phase 2 觸發指標

> **不是任一達成即啟動、Phase 2 是「重大 brainstorming + 新 PRD」、需要兩個前提同時滿足。**

### 3.1 前提 A:Phase 1 階段 3 穩定運行 ≥ 1 個月

**為什麼:** 階段 3 LINE / 物流自動化跑穩定、表示基礎建設牢、可投入新 context 開發(Vehicle / Booking / Shop / Wallet)。若階段 3 還在出包、不應分散注意力到 Phase 2。

**監控位置:** `apps/admin/dashboard` 機器看板、階段 3 出包計數連續 1 個月 = 0。

### 3.2 前提 B:商業層觸發(任一達成)

**B-1 店家端需求:** 合作店家(36 家)中、≥ 5 家主動詢問「能不能在你後台看自己店訂單」。

**B-2 預約量:** install booking(目前是 design InstallPage 4 步 wizard、不存 DB)累積詢問 ≥ 50 次 / 月、員工手動回覆吃力。

**B-3 車輛履歷詢問度:** 客人在 LINE / 電話詢問「我前年改的東西還在保固嗎」≥ 10 次 / 月、員工查不到。

**B-4 三層折扣需求:** 廠商開始給 PCM 三層折扣(廠牌 / VIP / 季度)、Sean 手動算折扣超過 30 分鐘 / 訂單。

**監控位置:** Sean 自己 + 客服 inbox(M-4a-12 含 LINE / Email 紀錄)。

**觸發後做什麼:** 啟動 Phase 2 brainstorming(獨立 / 重新拍板 / 寫新 PRD)、不是純加 adapter。

### 3.3 Phase 2 範圍速查(僅參考、實際以新 PRD 為準)

按 `docs/PHASE-2-VISION.md` + `docs/features/vehicle-service-ecosystem.md`:

- 車輛履歷 + 移轉(獨立 entity / 跟車不跟人)
- 詢價 + 預約 + 店家行事曆
- 三層折扣疊加(廠牌 / VIP / 季度)
- Excel 大量上架 UI
- 多店員工 + 角色細分

---

## 4. 觸發後執行流程

### 4.1 階段 2 / 3 = 直接加 adapter + use-case(不重新 brainstorm)

階段 2 / 3 是**架構演進、不是商業 pivot**:

```
觸發指標達成
  ↓
Sean 跟 Claude.ai 確認(15 分鐘對話)
  ↓
Claude.ai 開新 milestone(M-7 / M-8)、寫 slice 指令
  ↓
Claude Code 動工(純加 adapter + use-case、不動 domain)
  ↓
完成 → 上線
```

**不需要重新 brainstorm、不需要新 decision ADR。** 0002 架構已支撐階段 2 / 3 演進(見 0002 §5.1 擴充性分析)。

### 4.2 Phase 2 = 獨立 brainstorming + 新 PRD

Phase 2 是**新商業範圍**(Vehicle / Booking / Shop / Wallet 4 個 contexts 落地)、不是純加 adapter:

```
前提 A + B 觸發
  ↓
Sean 在 Claude Code 啟動 /brainstorming + /architecture-patterns(類似 2026-04-30 對話)
  ↓
Claude Code 寫 Phase 2 對接報告 + 新 PRD
  ↓
Sean 跟 Claude.ai review(類似本次)
  ↓
產出 docs/PHASE-2-MILESTONES.md + decision 0003(新增 contexts)
  ↓
M-7 ~ M-N 動工
```

需要新 brainstorming 是因為 Vehicle 履歷規則、Booking 店家行事曆排程、Wallet ledger 退款邏輯都是**新業務**、不是「現有 context 加 adapter」。

---

## 5. 不應觸發的 false positive 警告

> **以下情境**看似達標、實際不應觸發階段升級。** Sean 看到不要被誤導。

### 5.1 單月特賣導致訂單暴衝 ≠ 階段 3 trigger

例:雙十一活動單月訂單衝 600 件、回到平日 150 件 / 月。

**不應觸發階段 3。** 看 6 個月平均、不看單月峰值。

### 5.2 員工短期招聘期 3 人 ≠ 階段 3 trigger

例:過年前臨時雇 1 人幫出貨、過完年回 2 人。

**不應觸發階段 3。** 看穩定編制、不看尖峰人力。

### 5.3 商品「上架但未上線」≠ 商品數量

例:sync-engine 候選清單有 5,000 件、但 admin 已發布只有 800 件。

**不算階段 2 trigger 的「商品數量」**。商品數量 = 已 published 在前台可見的、不含 candidate / draft。

### 5.4 Sean 心情低落「不想做」≠ 主觀痛點觸發

例:某天家裡有事 / 身體不適 / 無關因素導致暫時不想寫內文。

**主觀痛點觸發要有持續性**、Sean 連續 1-2 週都覺得寫內文卡、才算。一兩天的「不想做」不算。

### 5.5 客人「想要」≠ Phase 2 商業層觸發

例:1 個客人 LINE 問能不能查歷史保養紀錄、店家沒主動要求。

**Phase 2 觸發要有規模性**(≥ 5 家 / ≥ 50 次 / ≥ 10 次 / ≥ 30 分鐘 等量化指標)、單例不算。

---

## 6. 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-04-30 | 初始化 scaling-triggers.md(階段 2 / 3 + Phase 2 觸發指標) | Claude Code(/writing-plans) |

— END —
