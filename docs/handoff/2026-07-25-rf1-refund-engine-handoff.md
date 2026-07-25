# 交接包 — RF1 退款引擎 + 退刷線後續 + 全站規劃(2026-07-25)

> **給接手 session**:本檔是「接著做什麼、以及什麼還沒收」的唯一入口。
> 起手照 `CLAUDE.md` 開工儀式;真權威仲裁序 = 可驗證事實 > `STATUS.md` > `docs/handoff/CURRENT.md` > 本檔 > 歷史。
> 🔴 **零 migration、零 DB、零 flag、未動 `.env*`**(本線至今)。

---

## 🆕 2026-07-25 後續更新(§1/§2 已被事實取代,先讀本節)

**§1 的決策已由 Sean 裁示 (B)、且 RF1 已 commit 並推上 `origin/dev`。**

1. **Sean 拍 (B)** = 授權破例跑 codex 關卡2 **R3**。R3 判 **FAIL、共 5 must-fix**:
   - **R3-1~R3-4** 折入 **`ccad329`**(退款引擎本體 commit;plan §10g 銷案表)。
   - **R3-5** = **#216 drift gate 的 anchor 錯**,折入**後續 commit**(見下)。
2. 🔴 **R3 實際被跑了兩次**——Sean 同一句「再跑第三輪審查」貼進兩個並行 Claude 視窗,兩邊各跑一次 codex(白付一次)。
   兩邊唯一的差異來自**問題不同**:一邊只問「找新問題」,另一邊多問「**前兩輪的修法是否真的成立**」→ 後者才抓到 **R3-5**。
   ⇒ 教訓已落 memory `feedback_single-review-session-avoid-parallel`(**重疊審查線唯一有價值的情況是問不同的問題**)。
3. **R3-5 的內容(RF2a-0 必讀)**:`shipping-rpc-drift.test.ts` 原本挑「最新一支**命中運費 CASE regex** 的 migration」當對照基準,
   而不是「最新一支**定義 `create_order`** 的 migration」。實查 7 支 migration 定義 `create_order` 且當時 7 支全命中 regex
   ⇒ 最新那支一旦把 CASE 寫成 regex 抓不到的形狀(**RF2a-0/RF2b 改讀凍結欄位就是這個形狀**),
   gate 會**靜默退回已作廢的舊 migration**、永遠綠,而真正生效的運費已漂走。
   **修法**=anchor 改成「最新一支**定義** `create_order` 的檔」+ **抓不到 CASE 直接紅**(附指示訊息)+ 斷言對照檔就是那支。
   **負向實測**:放一支「最新且用變數寫 CASE」的臨時 migration → **新版 4 紅 / 舊版 6 綠**(舊版假綠是實測、不是推論);臨時檔跑完即刪、`git status` 零留痕。
4. **現況**:`dev` = `origin/dev`(已推)。RF1 相關 commit:`ccad329`(引擎)→ `33e1a40`(STATUS/CURRENT)→ 之後一支 gate 修正 commit。
5. **下一片仍是 RF2a-0**(§5),**卡 Sean db push**;另 E0 搜尋線的 `pg_jieba` 前置未驗仍成立(§6)。

---

## 2. ⚠️ 工作區現況(**歷史快照、已被上方「後續更新」取代**:6 檔已 commit 進 `ccad329` 並推上 `origin/dev`;`/tmp/rf1-*` 備份與基準 shasum 已失效——並行視窗在 R3 期間改檔時連 `/tmp/rf1-base.sha` 一起改寫了)

```bash
git -C /Users/sean_1/pcm-website-v2 status --porcelain
```
預期恰為以下 6 檔(`M` 3 個 / `??` 2 個 / plan 1 個):

| 檔案 | 狀態 | 內容 |
| --- | --- | --- |
| `packages/domain/src/order/refund.ts` | **新增(untracked)** | 退款引擎本體 388 行 |
| `packages/domain/src/order/refund.test.ts` | **新增(untracked)** | 窮舉測試 ~800 行 |
| `packages/domain/src/order/shipping.ts` | 修改 | `ShippingRule` 型別 + 模組私有 frozen 預設規則 + `calculateShippingFee` 選填第三參數 |
| `packages/domain/src/order/shipping-rpc-drift.test.ts` | 修改 | #216 gate 擴為三方(改**行為驗證**) |
| `packages/domain/src/index.ts` | 修改 | barrel 加 refund 匯出;🔴 **刻意不匯出預設規則** |
| `docs/specs/2026-07-25-m3-rf1-refund-engine-plan.md` | 修改 | plan v6(四輪 findings 銷案 + §10e 19 組突變實測) |

🔴 **保護措施**:兩個 untracked 檔的備份在 `/tmp/rf1-refund-backup.ts`、`/tmp/rf1-shipping-backup.ts`;
基準 shasum 在 `/tmp/rf1-base.sha`(重開機會消失 → **接手若要離開工作區,先 commit 或另存備份**)。
背景:2026-07-19 與 07-24 各發生一次並行 session `git stash` 誤丟檔案(memory `project_parallel-sessions-shared-git-index-collision`)。

**驗證現況仍完好**:
```bash
cd /Users/sean_1/pcm-website-v2 && npx vitest run packages/domain/src/order/refund.test.ts packages/domain/src/order/shipping.test.ts packages/domain/src/order/shipping-rpc-drift.test.ts
```
預期 `3 passed / 60 passed`(⚠️ **已過期**:R3 補測 14h + gate 加強後為 **3 passed / 62 passed**;full test = **252 檔 2926 passed + 1 todo**)。

**最後一次完整驗證(本 session 實跑)**:typecheck 8/8、lint 10/10、build 2/2、full test **252 檔 2924 passed + 1 todo**。

### commit 時的紀律(🔴 本 session 已踩過一次)

```bash
git add packages/domain/src/order/refund.ts packages/domain/src/order/refund.test.ts \
        packages/domain/src/order/shipping.ts packages/domain/src/order/shipping-rpc-drift.test.ts \
        packages/domain/src/index.ts docs/specs/2026-07-25-m3-rf1-refund-engine-plan.md
git diff --staged --stat   # 🔴 必須恰好 6 檔才 commit
```
**踩坑實錄**:本 session 為給 code-reviewer 看 diff 而先 stage 了 5 個程式檔,之後 `git add docs/...` + `git commit`(**未帶 pathspec**)→ 那個 commit 把 RF1 程式碼一起吞了、訊息只寫「搜尋偵察落檔」= 字面 vs 事實不一致。已 `reset --soft` 拆開重做。**commit 一律帶 pathspec + 複驗 `--staged --stat`**。

commit body 必須揭示(來自審查要求):
1. `refund.ts` **388 行**過鐵則 6 的 300 硬警戒(仍 <400)、不拆理由 + 下次動先評估外移。
2. **kind 分類與 plan 草稿字面不同**:非安全整數/負數 → `invalid_amount`;合法整數超 DB 上限 → `amount_overflow`。依據=對齊 sibling `errors.ts:20` 慣例優先於 plan 草稿。🔴 **RF2b 以 SQL 鏡像 kind 時必須依此**。
3. 三次「突變初版 0 紅」的假綠發現(M5 / M14 / M15),其中兩次是**遮蔽**形狀。
4. `codex 關卡2 R2 判 FAIL、6 findings 全折入但未再複審`(依 2 輪上限停下)。

---

## 3. RF1 做了什麼(接手不必重讀 plan 也能接上)

`packages/domain/src/order/refund.ts` 匯出純函式 `computeRefundQuote(input) → { ok:true, quote } | { ok:false, kind }`。

- **公式**(Sean D1=B):`退款額 = 退品項金額 −(新運費 − 舊運費)`;`refundAmount + newTotal === currentTotal` 恆等(路徑無關:同張單怎麼拆退,總額都等於原付)。
- **全退回退運費**(邊界②):`fullRefund → 新運費 0`。🔴 `fullRefund` 定義 = **每個剩餘品項都退光**,**不是**金額歸零(零元品項會誤判 → 少收運費)。
- **Q3=B 部分數量退**:輸出 `refundedLines[]` 含 `remainingQuantityAfter`。
- **Q6=B 凍結規則**:`shippingRule` 為**必填輸入**,引擎**不 fallback**。
- **對外零 throw**:最外層 `try/catch` 兜住任何病態輸入 → `invalid_field`。
- 16 種 rejection kind;幣別強制 `TWD`;整數與 DB `2147483647` 上限全鏈守門。

**RF1 尚未被任何地方呼叫**(純 domain 層,消費端在 RF5/RF6)。

---

## 4. 本 session 四輪審查的關鍵教訓(接手請沿用)

1. 🔴 **偵察 subagent 對「某函式實際做什麼」的轉述,主對話必須親自開檔驗證才能引用** ——
   本 session 因此把錯誤前提寫進給 Sean 的決策題(誤稱首頁「最新商品」是寫死撈分類,實為 `created_desc`)。
   memory 已落 `feedback_verify-subagent-function-behavior-before-decision-question`。
2. 🔴 **突變測試是唯一能證明「防線有效」的手段**:三次「防線存在但移除後測試全綠」都只有突變抓到。
   特別注意**遮蔽**:兩道守門並存時,要讓壞值**只**觸發被測那道,否則永遠測不到。
3. 🔴 **註解不是機制**:codex 指出「用註解防 RF5 誤用預設規則」擋不住任何事 → 改為**模組私有 + freeze**。
   R1 只從 barrel 移除仍不夠(deep import 可繞),R2 才收斂到私有。
4. **codex 也會錯**:它指「`STATUS.md:149` 未寫『未排』」,實查該行逐字含「獨立線(未排):…搜尋 S2…」⇒ 已駁回。**findings 一律先核對再折入**。

---

## 5. 退刷線接下來的片(順序固定;真權威 = PRD `docs/specs/2026-07-24-refund-automation-line-prd.md` §4)

| 片 | 內容 | 卡手動 |
| --- | --- | --- |
| ~~RF1~~ | ✅ code-complete、待 §1 裁示後 commit | — |
| **RF2a-0** ← **下一片** | 凍結運費規則:`orders` 加 `shipping_free_threshold` / `shipping_home_fee` 兩欄、`NOT NULL DEFAULT` = 當前值(5000/100)。🔴 **走 B3:靠欄位 DEFAULT 凍結、零 `create_order` 改動**(實證:當前生效 RPC `20260719120000_...:471-477` 的 INSERT 是具名欄位列 ⇒ 新欄不在列內);PG11+ 加帶 DEFAULT 欄位會同時回填既有列 ⇒ **backfill 免寫**。同片把 #216 drift gate 擴成「TS 常數 ↔ RPC CASE ↔ 欄位 DEFAULT」三方。🔴 **擴充時必須沿用 R3-5 的 anchor 語意**(對照「最新一支**定義** `create_order` 的檔」、抓不到 CASE 就**紅**),**不得退回「掃到哪支算哪支」**——那正是會靜默對照已作廢定義的假綠形狀 | **Sean db push** + 交易模擬 |
| RF2a | 退款帳本 schema:`order_refunds` 表 + `bank_refund_id` 唯一鍵(≤20 字元)+ 狀態 + **`partiallyRefunded` enum**(Q1=A、收 backlog #26) | **Sean db push** |
| RF2b | 退款 RPC(`admin_refund_order_items` + `admin_cancel_order`):SECURITY DEFINER + `FOR UPDATE` + CAS + SQL 側重算驗證 + 同交易更新 orders 三金額欄(Q2=A)+ audit。🔴 **kind 分類須鏡像 RF1 的 §3.3-10b** | **Sean db push** + 交易模擬 |
| RF3 | `TapPayChargeAdapter.refund()`(現 stub throw `:211-214`)+ 新 `refundUrl` config 欄 + timeout 30s | — |
| RF4 | admin 接 `payment_charge_attempts` 取 `rec_trade_id` + admin 首個 TapPay composition root | **Sean 設 admin Vercel env** |
| RF5 | 串接 server action。🔴 **硬 gate**:`shippingRule` **只能**讀 orders 兩個凍結欄、**嚴禁 fallback 預設規則**(否則 Q6=B 拍板失效);須負向測試 | — |
| RF6 | 後台退款 UI(D5 = Sean 自行處理、不轉 demo)。明細頁**已有**運費 summary(`order-detail.tsx:104-143`) | 收工 Sean 肉眼驗 |
| RF7 | 🔴 `settle-charge.ts:124-132` 的 `refund_anomaly` 改為合法終態 —— **必須在第一筆真退款測試前落地**,否則每次 sweep 都永久假告警 | — |
| RF8 | D4 隔日覆核 + **失敗回滾**(Q5=A:覆核發現沒退成 → 跳通知 + `payment_status` 回 `paid` + 品項 `workflow_status` 回 `received_unconfirmed`)+ 客服 SOP(收 #62)+ 0072/0073 雙扣 NT$17,300 收口 | 視 flag(S4) |

---

## 6. 另一條線:全站規劃(Sean 已拍 7 題、E0 搜尋排第一)

- 規劃真權威 = `docs/specs/2026-07-25-site-wide-gap-and-admin-platform-plan.md` **v3**(§0b = Sean 拍板表)。
- 搜尋事實底稿 = `docs/specs/2026-07-25-search-engine-options-recon.md`(**E0 開工前必讀**)。
- 🔴 **搜尋不是被鎖、是半成品**:`Header.tsx:50-52` dispatch `pcm-open-search` → `apps/storefront` 零 listener(`design-reference/components/App.jsx:346` 有);`SearchOverlay.jsx`(205 行)未搬進正式站;`search-overlay.css` 不存在;`searchByKeyword()` 零呼叫端。
- 🔴 **Sean 追加需求把 E0 範圍撐大了**:要模糊搜尋涵蓋**內文/標題/料號/車款/年份/類似關鍵字** → 現有 ILIKE 三欄達不到。
- 🔴 **E0 開工前必答四題 + 必驗一件事**(詳偵察檔 §5/§7):最關鍵 = **`pg_jieba` 在 Supabase 到底能不能啟用從未實測**,而 ADR-0004 整條 tsvector 路線建立在它之上。
- Sean 拍板重點:Q2=A 先修搜尋 / Q3=A 沿用 **Supabase Storage**(ADR-0004,不推翻)/ Q5=A 內容走**草稿→預覽→發布→可回滾** / **Q6=B 完整手動商品**(範圍擴張、Sean 知情)/ Q7-1=A 價格走後台專屬表單+完整紀錄 / Q7-2=B 首頁內容一季 1-3 次 = **L2**(⇒ 內容管理非鐵則 9 強制、讓位給搜尋與商品)。
- 首頁大圖:**已有連結**(`HomeHero.tsx:29-32`);**影片可行**(`<img>` → `<video muted autoplay loop playsinline poster>`,版面與 tint 不動)。四項注意 = iOS 需 muted+playsinline / LCP / Storage 頻寬計費 / `prefers-reduced-motion`。

---

## 7. 本 session 已 commit 的內容(全部 docs、未 push)

`git log --oneline` 由新到舊(本 session 產出):

| 內容 |
| --- |
| 搜尋引擎方案偵察成果落檔 |
| Sean 七拍板落檔(Q1=A 開工 / 搜尋優先+模糊多欄 / Supabase Storage / 草稿發布模型 / Q5=B 完整手動商品)|
| 進度地圖刷新至 07-25 + 全站規劃補 M-4a 藍圖交叉證據 |
| STATUS 7 欄 + CURRENT 交接更新 |
| 全站規劃 v3(codex 兩輪、19 折入 1 駁回)|
| 全站規劃 v2 / v1 凍結送審 |
| RF1 plan v4 / v2 / 凍結送關卡1 |
| 退刷線第二批拍板 + 邊界四答 + Q5/Q6 + RF2a-0 改 B3 |

🔴 **push 是 Sean 的手動動作,任何 session 不得代推或主動提議。**
⚠️ **本節「未 push」已過期**:Sean 2026-07-25 已推,`dev` = `origin/dev`(含 `ccad329` RF1 引擎 + `33e1a40` STATUS/CURRENT)。
