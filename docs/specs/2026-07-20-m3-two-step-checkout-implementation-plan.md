# M-3 兩步結帳 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. 每片完成後停在 review／commit checkpoint，不得跨片合併施工。

**Goal:** 把三步結帳改成 Sean 已批准的兩步單欄流程，讓客人在第二步完成發票、TapPay 安全卡欄、商品確認、條款與付款，同時保留既有金流、3DS、雙扣防線與 server 權威。

**Architecture:** `CheckoutView` 保留跨步驟 state 與付款 orchestrator；第二步以小元件排列收件摘要、發票、付款、商品與條款。非卡片錯誤存具名 map；TapPay 錯誤由 `submitAttempted + live fieldStatus` 衍生，status 轉 0 時自然只清該欄。法律頁內容／版本／hash 是獨立的**上線前人工 release checkpoint**（🔴 2026-07-21 L0 誠實化更正：原字面「硬閘」不成立——目前無任何 CI／deploy preflight／flag 條件會機械擋下，機械守門本身是 L1 交付項；詳 backlog #291），不與 UI 重構混在同一片。

**Tech Stack:** Next.js App Router、React、TypeScript、Zod、Vitest + Testing Library、TapPay Web SDK iframe fields、Playwright／`agent-browser`、YAML design manifest、Supabase forward-only migration（僅正式法律內容獲核准後另片建立）。

---

## 全線前置與不變量

依序讀 `AGENTS.md`、`STATUS.md`、`docs/ops/AI_CONTRACT.md`、`docs/handoff/CURRENT.md`、`docs/specs/2026-07-20-m3-two-step-checkout-design.md`、`docs/patterns/slice-checkpoint.md`、`docs/patterns/cowork-review-chain.md`。

共同 preflight：

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --short --branch && git log --oneline -5
```

共同不變量：

- Step 1＝收件／配送／通知 Email；Step 2＝收件摘要／發票／TapPay／商品／條款／付款。
- PAN、有效期、CVV 只存在 TapPay iframe，不進 React state、我方 input、server、log 或 DB。
- `confirmProceedIfInflight → getPrime → charge.submit`、`primeBusyRef` 同步鎖與終態不釋放策略不變。
- `paid / processing / unknown / redirect / error / wait / in_flight` 與 3DS callback／polling 契約不變。
- `agreed === true` server guard、server 金額重算、tier、RLS、cart session、create-order 與 B-3／B-4 邊界不變。
- `CheckoutView.tsx` 目前 383 行；每片結束必須 `<400`，U1 起應低於 383。
- 每片若動 `CheckoutPage` 相關 TSX/CSS/schema，必同步 `docs/design-storefront-manifest.yaml` 的 related paths、受影響 override、open drift、`last_modified_commit`（填該片開工時可達父 commit）與 `last_modified_date`（本片日期／內容），再跑 validate。
- 每片收工都要在**同一 commit**更新 `STATUS.md` 七欄與 `docs/handoff/CURRENT.md`；各片「Commit」列出的精準實作檔之外，這兩份 SSoT 是固定必加檔，不得因片內清單未重複列出而省略。
- 正式法律 route/version/hash 未全綠前，只能稱「兩步 UI 已實作／已測試」，不得稱 production checkout 完成。

依賴順序：`L0` 可先做；產品線依序 `U1 → U2a → U2b → U3a → U3b → U4a → U4b → U5`；`L1` 等正式法律內容，可與產品線平行；`V1a` 同時等待 `U5 + L1`，`V1b` 再等待 `V1a`。

---

## Slice L0：校正法律 SSoT 與內容輸入 gate（20–30 分鐘）

````markdown
① 任務目標
- 內容分級：L1（法律版本／路由低頻變更）。
- 新增 backlog #291「正式服務條款／隱私政策 route + version/hash」，修正 #241 對 live #235 的錯誤依賴。
- 同步 active `apps/storefront/src/lib/legal/terms-version.ts` 註解與 manifest `checkoutLegalPagesDeferred`；已 apply 的 migration 歷史註解不回改。

② 前置檢查
- 跑共同 preflight。
- `rg -n "#241|#235|LegalPage|checkoutLegalPagesDeferred" docs/phase-1-backlog.md apps/storefront/src/lib/legal/terms-version.ts docs/design-storefront-manifest.yaml`

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（法律同意版本與 production gate）。

④ Manifest Impact + Review 觸發
- `CheckoutPage.open_drifts.checkoutLegalPagesDeferred` 改成「正式來源待核准〔🔴 核准矩陣＝Sean 必要、法律顧問選配加簽，非二擇一；核准對象＝渲染後完整 payload〕；#291；不得複製 design 草稿；為上線前人工 release checkpoint〔非機械守門〕」。（🔴 2026-07-21 L0 更正：原字面「待 Sean／法律核准」語意含糊，可能被讀成兩者擇一。）
- 同步 `last_modified_commit/date`；保留其他 open drifts。
- review_triggers: prd_review / code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- RED：搜尋證明 active comment／manifest 仍誤稱 #235 或「Phase 1 不做」。
- GREEN：#291 明列 `/terms`、`/privacy`、正式來源、真聯絡資訊 SSoT、canonical hash、新版本、forward-only migration、Sean `db push` checkpoint、新分頁 noopener。
- GREEN：`terms-version.ts` 只校正 active 註解，不改 `CURRENT_TERMS_VERSION` 值。
- 驗證：
  `pnpm typecheck && pnpm lint && pnpm build && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`docs(storefront): 建立正式法律頁上線 checkpoint [m-3]`（🔴 2026-07-21 更正：原指定字面為「上線硬閘」，經 codex R3 判定與實際能力不符、Sean 授權改為 checkpoint）；精準 add 三個任務檔案 + `STATUS.md` + `docs/handoff/CURRENT.md`（🔴 **實際收檔 7 個**：原文列的 5 檔 + `apps/storefront/src/components/CheckoutStep3.tsx`〔其 active 註解同屬本片要消滅的舊字面〕+ **本 plan 檔自身**〔:7／:56／:66 三處誠實化更正〕）。

⑥ Yes/No 驗收 + 禁止清單
- #241／active comment／manifest 是否不再把 live #235 說成法律頁？
- 是否完全沒有假電話、假 Email、七日退貨或自創法律文案？
- 是否明寫 migration apply 由 Sean 批准？
- 禁止：不新增 route、不建 migration、不 bump version、不讀 `.env*`、不 apply DB、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U1：兩步骨架 + TapPay active 原子切換（35–45 分鐘）

````markdown
① 任務目標
- 內容分級：L1（結帳資訊架構低頻變更）。
- step domain 原子收斂為 `1 | 2`；同片將 `useTapPayCard(step === 2)`，不得留下中間斷裂 commit。
- 暫時在 Step 2 依序掛現有 `CheckoutStep2` + `CheckoutStep3`，移除「下一步：確認訂單」；U2 再抽元件與移除重複假卡欄。

② 前置檢查
- 跑共同 preflight。
- `wc -l apps/storefront/src/components/CheckoutView.tsx`
- `rg -n "step === 3|Math.min\(3|step < 3|gotoStep3|useTapPayCard" apps/storefront/src/components/CheckoutView* apps/storefront/src/hooks/useTapPayCard*`

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（支付 iframe mount point）。

④ Manifest Impact + Review 觸發
- 新增 `checkoutTwoStepFlow` business override；`checkoutStepsWipPlaceholder` 只記骨架已兩步、U2 仍待退役假卡欄／Step3 shell。
- 同步 related paths、open drift、`last_modified_commit/date`。
- review_triggers: slice_review / code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- RED：`CheckoutView.test.tsx` 先斷言步驟列只有兩步、CTA「下一步：發票與付款」、不存在第三步入口。
- RED：讓 `useTapPayCard` mock 接收 `active`，驗證序列 `false → true → false → true`；現有忽略參數的 mock 必改，避免假綠。
- GREEN：新增 `CheckoutStepIndicator.tsx/.test.tsx`，export `type CheckoutStep = 1 | 2`；只有已完成步驟可回點。
- GREEN：`goNext` 只 1→2，`goBack` 只 2→1；Step 2 直接顯示現有真 TapPay slot／terms／pay action；active 同片改 2。
- GREEN：保留 hook generation guard、false cleanup、重入 setup 與 getPrime timeout。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/components/CheckoutStepIndicator.test.tsx apps/storefront/src/components/CheckoutView.test.tsx apps/storefront/src/hooks/useTapPayCard.test.tsx`
- 全驗證：
  `pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- 行數：`wc -l apps/storefront/src/components/CheckoutView.tsx`，必須 `<383`。
- Commit：`refactor(storefront): 原子收斂結帳為兩步 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 任何 checkout state／comparison 是否只剩 1/2？TapPay 是否只在 2 active？往返是否 cleanup/re-setup？
- 真 SDK mount 是否沒有因 mock 忽略 active 而假綠？
- 禁止：不改 getPrime/charge 順序、不刪 Step3 檔、不改法律連結、不碰 B-4、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U2a：抽第二步 presentational review sections（25–40 分鐘）

````markdown
① 任務目標
- 內容分級：L1。
- 把現有 Step3 的收件摘要、付款 body、商品清單與條款抽到單一小元件檔；Step3 先改為 compose，畫面與行為不變。

② 前置檢查
- 共同 preflight；讀完 `CheckoutStep3.tsx/.test.tsx` 與 `cart-vehicle-format.ts`。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 不觸發（純 presentational extraction，不改付款行為）。

④ Manifest Impact + Review 觸發
- related paths 加 `CheckoutStep2ReviewSections.tsx/.test.tsx`；`checkoutStep3ReviewAdaptations` 記「已抽、shell 尚在」。
- 同步 open drift、`last_modified_commit/date`。
- review_triggers: slice_review / code_review。

⑤ 執行步驟
- RED：新 test 鎖姓名＋**完整現況地址字面**、修改鈕、TapPay slot、商品品牌/規格/qty/車款/lineTotal、terms checkbox 與 edit cart；本片不得先引入截短行為。
- GREEN：新增 `CheckoutStep2ReviewSections.tsx`，export `CheckoutShippingSummary`、`CheckoutPaymentSection`、`CheckoutOrderReview`；總檔維持 `<300` 行。
- GREEN：`CheckoutStep3.tsx` 只 compose 新 exports，props/畫面/handler 不變。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/components/CheckoutStep2ReviewSections.test.tsx apps/storefront/src/components/CheckoutStep3.test.tsx apps/storefront/src/components/CheckoutView.test.tsx`
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`refactor(storefront): 抽出結帳複查區塊 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 抽取前後 DOM 語意與付款 handler 是否不變？商品仍為 server-resolved lines？
- 禁止：不改 step、validation、CSS 視覺、不刪 Step3、不改 links、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U2b：組成單欄 Step 2 並退役 Step 3（30–45 分鐘）

````markdown
① 任務目標
- 內容分級：L1。
- `CheckoutStep2` 排列：精簡收件摘要→發票→唯一信用卡/TapPay slot→商品→條款；刪 disabled 假卡 inputs 與 Step3 shell/test。

② 前置檢查
- 共同 preflight。
- `rg -n "disabled|aria-hidden|最後一步|CheckoutStep3|paymentSlot" apps/storefront/src/components/CheckoutStep{2,3}* apps/storefront/src/components/CheckoutView*`

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（真 TapPay UI surface relocation）。

④ Manifest Impact + Review 觸發
- `checkoutStepsWipPlaceholder` 改為兩步內容完成；`checkoutStep3ReviewAdaptations` 明寫退役；`checkoutCardUiOnlyNoTapPay` 清「Step3／最後一步」舊字面；保留法律 open drift。
- 同步 related paths、`last_modified_commit/date`。
- review_triggers: slice_review / code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- RED：`CheckoutStep2.test.tsx` 斷言同頁可見摘要、發票、真 slot、商品、terms；disabled 原生卡號/expiry/CVV inputs 不存在。
- GREEN：擴充 Step2 props；View 只掛 Step2；刪 `CheckoutStep3.tsx/.test.tsx`；CSS 調整單欄結構。
- GREEN：收件摘要仍保留完整地址文字，只以 `.co-shipping-summary-address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }` 做單行視覺截短，不能以 JS slice 丟失地址；component test 驗完整文字仍在 DOM，CSS test 鎖三條規則。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/components/CheckoutStep2.test.tsx apps/storefront/src/components/CheckoutStep2ReviewSections.test.tsx apps/storefront/src/components/CheckoutView.test.tsx apps/storefront/src/styles/checkout.test.ts`
- 搜尋 gate：`rg -n "CheckoutStep3|最後一步輸入|下一步:確認訂單" apps/storefront/src` 必須零 active 命中。
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`refactor(storefront): 合併發票付款與訂單確認 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 是否只剩一個真卡輸入 surface？是否沒有 hidden 第三步？
- 禁止：不新增 ATM/COD、不改 validation、不把 `#` 換成不存在 route、不動 server action、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U3a：建立 canonical invoice schema（25–40 分鐘）

````markdown
① 任務目標
- 內容分級：L1（invoice 規則低頻、client/server 共用）。
- 拍定唯一做法：export `CheckoutInvoiceInput`，AddressInput 與 CheckoutInputBase 都 compose 同一 schema，不手抄 regex。

② 前置檢查
- 共同 preflight；讀 `packages/schemas/src/index.ts`、`address.test.ts`、`checkout.test.ts`。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（client/server canonical validation）。

④ Manifest Impact + Review 觸發
- related paths 加 schemas tests；`checkoutAllErrorsAtOnce` 只記 canonical 地基，UI 尚未接。
- 同步 open drift、`last_modified_commit/date`。
- review_triggers: code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- RED：Address 與 Checkout tests 先同時鎖 company title/taxId、donate code 的 message 與完整 issue path `invoice.title|taxId|donateCode`。
- GREEN：export：
  `export const CheckoutInvoiceInput = z.object({...defaults...}).superRefine(...)`
  `export type CheckoutInvoiceInput = z.input<typeof CheckoutInvoiceInput>`
  `export type CheckoutInvoice = z.output<typeof CheckoutInvoiceInput>`
- `superRefine` 內 path 只用 `['title']`／`['taxId']`／`['donateCode']`；nested compose 後 tests 必證明外層 path 自動成 `['invoice', ...]`。
- AddressInput 改 `invoice: CheckoutInvoiceInput` 並移除重複 invoice superRefine；CheckoutInputBase 同樣 compose。
- 精確測試：`pnpm exec vitest run packages/schemas/src/address.test.ts packages/schemas/src/checkout.test.ts`
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`refactor(schemas): 統一結帳與地址發票驗證 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- address／checkout parsed defaults、message、issue path 是否 byte-for-byte 等價？
- 禁止：不改驗證規則、不改 Email schema、不改 DB/create_order、不手抄第二套 regex、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U3b：非卡片全錯誤 state 與 ARIA（30–45 分鐘）

````markdown
① 任務目標
- 內容分級：L2（錯誤文案／呈現偶爾調整）。
- 一次產生 shipping address、通知 Email、active invoice、terms errors；逐欄紅字，修一欄只清自己，切 invoice type 清 hidden errors。

② 前置檢查
- 共同 preflight；讀 `createCheckoutInputSchema` 與 Step1 Email canonical 行為。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（consent 與 server schema 鏡像）。

④ Manifest Impact + Review 觸發
- `checkoutAllErrorsAtOnce` 記 non-card error map 與單一 alert；同步 `last_modified_commit/date`、open drifts。
- review_triggers: code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- 新 `lib/checkout/validate-checkout-payment.ts`：
  `CheckoutPaymentErrors` keys 固定為 `shipping.address | notificationEmail | invoice.title | invoice.taxId | invoice.donateCode | card.module | card.number | card.expiry | card.ccv | terms`。
- `validateNonCardFields` 直接用 `createCheckoutInputSchema(notificationEmailEnabled).safeParse` 真實 `addressId/shippingMethod:'home'/invoice/notificationEmail`，再加 terms；不得重寫 invoice/Email 規則。
- RED：company submit 產 title+taxId→切 personal→兩 state keys、DOM 紅字、ARIA links 全消失且不阻付款；donate→personal 同樣測一案。
- RED：shipping/email 錯顯於摘要附近，「修改」focus target 可回 Step1；每欄 change 只清自己；整區只有一個 `role="alert"` summary。
- GREEN：inputs/checkbox 加穩定 id、`aria-invalid`、`aria-describedby`；View 維護 non-card errors 與 `submitAttempted`。
- GREEN：本片同時把 `payDisabled` 的 `!agreed` 移除；按下後先跑 non-card validation，有錯才 early return。Card mock valid 且 non-card 全合法時仍沿原 handler 進 getPrime/submit，確保中間 commit 不斷付款。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/lib/checkout/validate-checkout-payment.test.ts apps/storefront/src/components/CheckoutStep2.test.tsx apps/storefront/src/components/CheckoutView.test.tsx`
- 突變：停用 type-change cleanup，指定 View test 必紅；還原後綠。
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`feat(storefront): 一次顯示結帳非卡片錯誤 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- hidden invoice error 是否從 state、DOM、ARIA、付款阻塞全消失？其他 errors 是否保留？
- 禁止：不只取第一個 issue、不以 disabled 按鈕代替導引；**validation 有錯時**不呼 getPrime/action；不阻斷全合法既有付款路徑；不改 server guard、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U4a：TapPay 1/2/3 全紅與逐欄自清（25–40 分鐘）

````markdown
① 任務目標
- 內容分級：L2。
- submit 後 status 1(empty)／2(invalid)／3(typing) 各欄紅；status 0 時只清該欄顯示，其他 card/terms errors 保留。

② 前置檢查
- 共同 preflight；讀 `TapPayCardFields.tsx`、`useTapPayCard.tsx` 與 tests。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（支付 iframe error contract）。

④ Manifest Impact + Review 觸發
- 更新 `checkoutCardUiOnlyNoTapPay` 與 `checkoutAllErrorsAtOnce`；保留 `checkoutCardFieldFontSize16`。
- 同步 related paths、open drift、`last_modified_commit/date`。
- review_triggers: code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- RED：submitAttempted=false 不提早紅；true 時 number/expiry/ccv 的 1/2/3 各自紅，0 不紅。
- RED：number 由 2→0 後只移除 `card.number`；expiry/ccv/terms 仍顯示。
- GREEN：`validateTapPayFields(fieldStatus, ready, submitAttempted)` 每 render 衍生 card errors，不把 card errors永久存 state；ready=error 另產 `card.module`，loading/1/3 不得通過。
- GREEN：本片同時把 `payDisabled` 的 `!tappay.canGetPrime` 移除；按下後合併 live card errors，有錯才 early return。卡片與 non-card 全合法時仍沿既有 handler 付款。
- `TapPayCardFields` 收 `submitAttempted` 與衍生 errors；每欄 `aria-invalid/describedby`，但本片不做 focus registry。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/components/TapPayCardFields.test.tsx apps/storefront/src/lib/checkout/validate-checkout-payment.test.ts apps/storefront/src/components/CheckoutView.test.tsx`
- 突變：status 1 當 valid，指定 test 必紅；還原後綠。
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`feat(storefront): 顯示 TapPay 全欄錯誤 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 1/2/3 是否全紅？0 是否只清自己？status 3 是否絕不視為 valid？
- 禁止：不把卡值進 state、不 query iframe 內 DOM、不移除 timeout/generation guard、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U4b：第一錯誤 focus/scroll + lifecycle 回歸（25–40 分鐘）

````markdown
① 任務目標
- 內容分級：L1。
- 固定 DOM 順序聚焦第一錯誤、其餘紅字保留；補 Step 2→1 cleanup→2 setup 回歸。

② 前置檢查
- 共同 preflight；確認 SDK mount ids 仍來自 `TAPPAY_FIELD_IDS`。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發（iframe a11y + lifecycle）。

④ Manifest Impact + Review 觸發
- `checkoutAllErrorsAtOnce` 補 focus order；`checkoutCardUiOnlyNoTapPay` 補雙層 DOM 契約。
- 同步 `last_modified_commit/date`、open drifts。
- review_triggers: code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- DOM 契約：付款模組外層 id=`checkout-payment-module`、`role="group" tabIndex={-1}`，作 `card.module` target；各卡欄外層 focus wrapper id=`checkout-card-number|expiry|ccv`，`role="group" tabIndex={-1}` + ref + ARIA；內層 SDK mount div **保留** `TAPPAY_FIELD_IDS.number|expirationDate|ccv`，hook selector/setup/cleanup 不改。
- fixed order：`shipping.address → notificationEmail → invoice.title → invoice.taxId → invoice.donateCode → card.module → card.number → card.expiry → card.ccv → terms`。
- RED：spy `focus()`、`scrollIntoView({block:'center'})`；同時 invoice/card/terms error 時只第一 target 各被呼一次，全部紅字仍存在，只有一個 `role=alert`。
- RED：ready=error + terms error 時先 focus/scroll `checkout-payment-module`，terms 紅字仍保留，不得跳過 `card.module`。
- RED：View/hook test 鎖 active `false→true→false→true`、舊 callback generation 被棄、重入 state 回 empty。
- GREEN：建立 target registry 與 `focusFirstPaymentError`；不得 query iframe document。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/components/CheckoutView.test.tsx apps/storefront/src/components/TapPayCardFields.test.tsx apps/storefront/src/hooks/useTapPayCard.test.tsx`
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`feat(storefront): 聚焦結帳第一個錯誤 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 是否只 focus/scroll 第一個、全部錯誤保留？外層與 SDK mount id 是否無衝突？
- 禁止：不改 `TAPPAY_FIELD_IDS`、不碰 iframe 內部、不另寫 mobile focus、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice U5：validate-then-pay、七態回歸與 mobile（35–45 分鐘）

````markdown
① 任務目標
- 內容分級：L1。
- 桌機/mobile 共用單一 handler；按鈕只在 submitting/prime busy/終態鎖 disabled；合法才進既有金流。

② 前置檢查
- 共同 preflight；讀 `useChargePayment.test.tsx`、`charge-actions.test.ts`、inflight tests。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發，fresh Sol High。

④ Manifest Impact + Review 觸發
- 完成 `checkoutTwoStepFlow`、`checkoutAllErrorsAtOnce`；清三步 active 舊字面；同步 all related paths、open drifts、`last_modified_commit/date`。
- review_triggers: code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- RED：無效 non-card+card 時 desktop/mobile 都讓 confirm/getPrime/submit=0；合法時順序固定；雙擊 getPrime=1。
- RED：七態 UI 契約；processing 再分兩案：有 displayId 的已建立單路徑清 cart；無 displayId 的 preflight hold 不清 cart但維持終態鎖，不能只驗文字。
- GREEN：`handleSubmit` 先合併 non-card state + live card errors，set submitAttempted，errors 非空 focus 後 return；再走原 `confirmProceedIfInflight → primeBusyRef → getPrime → charge.submit → terminal finally`。
- `payDisabled` 只含 submitting/prime busy/終態鎖；不再用 `!agreed || !canGetPrime` 永久擋點擊。
- desktop 與 `.co-mobile-buybar` 只呼同一 handler；底部 padding 不遮 terms/錯誤。
- `charge-actions.test.ts` 證明 agreed=false 時所有副作用 0；本片預設不改 `charge-actions.ts`。
- 精確測試：
  `pnpm exec vitest run apps/storefront/src/components/CheckoutView.test.tsx apps/storefront/src/hooks/useChargePayment.test.tsx apps/storefront/src/app/checkout/charge-actions.test.ts apps/storefront/src/styles/checkout.test.ts`
- 突變：移除 `primeBusyRef.current` guard，雙擊 test 必紅；還原後綠。
- 全驗證：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`
- Commit：`feat(storefront): 在第二步安全完成付款 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 有錯是否完全不碰 inflight/getPrime/server？unknown/redirect/processing 子契約與雙擊鎖是否不變？
- 禁止：不改付款狀態名稱、不鬆 agreed guard、不刪 ref 鎖、不做第二套 mobile 流程、不刷真卡、不 push/deploy。
— 禁止清單結束 —
````

---

## Slice L1：正式法律 route/version/hash（BLOCKED，需新高風險 plan）

````markdown
① 任務目標
- 內容分級：L1。
- 只有 Sean 提供／指定已核准服務條款、隱私政策與聯絡資訊 SSoT 後，才另寫可執行 plan。

② 前置檢查
- 必須有可引用的正式內容來源與核准人／日期；缺任一即維持 BLOCKED，不開始施工。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) + fresh Sol High plan review / fix_attempt_max: 2。

④ Manifest Impact + Review 觸發
- 新 legal components/routes/visual source/content source 分開登記；同步 CheckoutPage legal drift、`last_modified_commit/date`。
- review_triggers: prd_review / code_review / security_review_required / codex_review_required。

⑤ 未來 plan 必含
- `/terms`、`/privacy` anonymous-readable routes/tests；design 只搬視覺，逐段標正式內容來源。
- canonicalization + SHA-256 腳本/tests；兩份內容的 hash 合成規則唯一。
- 新 `CURRENT_TERMS_VERSION`；forward-only migration 只新增 version row，不改舊 consent。
- checkout links `target="_blank" rel="noopener noreferrer"`。
- 本機 rollback transaction 證據；production `db push` 仍由 Sean checkpoint。

⑥ Yes/No 驗收 + 禁止清單
- 正式來源、route 顯示、version、hash、DB row 是否一致？
- 禁止：不複製 design 草稿、不杜撰聯絡資訊、不沿用舊 hash、不改歷史 consent、不自行 apply。
— 禁止清單結束 —
````

---

## Slice V1a：自動驗證與桌機／手機瀏覽器（30–45 分鐘）

````markdown
① 任務目標
- 內容分級：L1。
- 僅在 U5+L1 都完成後跑全套自動驗證與桌機／390px UI 流程；驗出 bug 回責任片修，本片不順手擴 scope。

② 前置檢查
- 共同 preflight；確認 local process-only flag 已授權；不得輸出 secret。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發。

④ Manifest Impact + Review 觸發
- CheckoutPage overrides、related paths、open drifts、`last_modified_commit/date` 同步瀏覽器驗收狀態；不得提前標 3DS／法律收口完成。
- review_triggers: slice_review / code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- 自動：`pnpm typecheck && pnpm lint && pnpm build && pnpm test && node scripts/design-mirror.mjs --validate && git diff --check`。
- 桌機：Step1→2、修改地址→1→2、同時全部紅、逐欄清、法律新分頁、商品／金額；只驗 UI 與 SDK sandbox field setup，不在本片送出 3DS 付款。
- 390px：`scrollWidth===innerWidth`、TapPay font 16px、focus/scroll、buybar 不遮錯誤/terms。
- 保存不含 PII／卡資料／secret 的測試計數與截圖；Review Packet 先標 V1a PASS、V1b 待執行。
- Commit：`test(storefront): 驗證兩步結帳桌機與手機 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- 自動測試、桌機、390px 是否各有獨立證據？是否明寫 3DS 終驗尚待 V1b？
- 禁止：不跑 production 真卡、不做 3DS 真流程、不自動 push/deploy、不改 production env/flag、不 apply migration、不把 mock 寫成 runtime PASS。
— 禁止清單結束 —
````

---

## Slice V1b：sandbox 3DS、Sol High 終審與 SSoT 收口（30–45 分鐘）

````markdown
① 任務目標
- 內容分級：L1。
- 在 V1a PASS 後完成 sandbox 3DS、安全終審與文件收口；不在本片修產品 bug，finding 回責任片修後重跑受影響驗證。

② 前置檢查
- 共同 preflight；確認 sandbox 測試資格與 Sean 對該次測試的授權；不得讀出或記錄 TapPay credential／卡資料。

③ 執行模式 + Subagent 模式
- mode B / conductor: main session / subagent_chain: code-reviewer(commit 前必跑) + fresh Sol High 唯讀終審 / fix_attempt_max: 2。
- `/slice-checkpoint`: 跑；`/codex-review`: 觸發。

④ Manifest Impact + Review 觸發
- CheckoutPage overrides、related paths、open drifts、`last_modified_commit/date` 全同步最終狀態。
- review_triggers: slice_review / code_review / security_review_required / codex_review_required。

⑤ 執行步驟
- sandbox：驗 redirect→callback→processing/poll→paid；不得用重複真刷製造 unknown/error/wait/in_flight，這四態沿用 U5 controlled mocks 證據。
- 回歸：重跑 `pnpm exec vitest run apps/storefront/src/components/CheckoutView.test.tsx apps/storefront/src/hooks/useChargePayment.test.tsx apps/storefront/src/app/checkout/charge-actions.test.ts`。
- 終審：fresh Sol High 對付款、3DS、法律 route/version/hash、double-charge、PII/卡資料做唯讀 review；0 must-fix 才收口。
- 文件：同 commit 更新 `STATUS.md` 七欄、`docs/handoff/CURRENT.md`、`docs/phase-1-backlog.md` #291、manifest、Review Packet；逐欄分清已驗證／未 deploy／需要 Sean。
- Commit：`docs(storefront): 收錄兩步結帳安全驗收 [m-3]`。

⑥ Yes/No 驗收 + 禁止清單
- version/hash、sandbox 3DS、七態 mocks、V1a 瀏覽器證據是否齊全？Sol High 是否 0 must-fix？
- 禁止：不用 production 真卡、不自動 push/deploy、不改 production env/flag、不自行 apply migration、不把 sandbox 寫成 production PASS。
— 禁止清單結束 —
````

---

## 完成條件與 rollback

只有 `L0 + U1 + U2a + U2b + U3a + U3b + U4a + U4b + U5 + L1 + V1a + V1b` 全部完成，才可稱「兩步結帳完成」。只完成產品線時，固定寫：「兩步 UI／validation 已完成；正式法律 route/version/hash 與 production checkpoint 未完成」。

- UI rollback：正常 revert commits；不用 `git reset --hard`。
- 法律 rollback：新增 forward-only version；不刪舊 row、不改歷史 consent。
- 付款 rollback：不得移除 server consent guard、TapPay iframe、server 金額重算、3DS ownership、cart session 去重或 double-click lock。

全線不自動 push、merge、deploy、改 production env、開 flag 或 apply DB，全部保留 Sean checkpoint。

— END —
