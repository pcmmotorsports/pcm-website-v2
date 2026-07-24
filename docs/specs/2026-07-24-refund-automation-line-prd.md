# PRD — 後台「取消訂單 = 自動退款」線(2026-07-24 草稿)

> ⚠️ **Claude 過夜自主起草;Sean 2026-07-24 拍 Q4=B 授權方向(退款線提前啟動第二段、真 1 元刷測)。**
> 這是**一條線、非一片**(估 5-7 片),命中**鐵則 12 錢+權限+DB**、每片需 plan + codex 對抗審 + 交易模擬。
> **只規劃,未實作**;每片實作前需 Sean ①批 plan ②db push(新 RPC)③設 admin Vercel TapPay env。
> 背景拍板 = memory `project_refund-line-two-stage`(2026-07-24 段)+ `project_sean-real-payment-verify-via-1nt-product`。
> refund 規格 = `docs/reference/tappay-reference.md` §2.3。

## 0. 2026-07-25 Sean 拍板定案(D1-D4 + 新增運費重算議題)

### 0b. 🆕 2026-07-25 第二批拍板(偵察 pass 後 Q1-Q4;§4 拆片已依此重定)

- **Q1=A**:payment_status **加 `partiallyRefunded` enum 值**(第 5 值;backlog #26 收案。影響面=所有讀此欄的消費端須逐一過:email ineligible gate、admin workflow-select-options paymentStatus 過濾、admin 顯示、zod/wire mapper)。
- **Q2=A**:退款 RPC **同交易把 orders `subtotal/shipping_fee/total` 三欄更新為「剩餘有效值」**(維持 `orders_total_balances` CHECK=`20260604120000:112`;原始金額完整留退款帳本+audit 可追溯)。
- **Q3=B** 🔴:**支援部分數量退**(同品項量 3 可只退 1;推翻 Claude 推薦的整行退)→ 引擎輸入含退數量、冪等鍵改 per-退款請求(非 per-品項)、RPC 驗「剩餘可退數量 ≥ 本次退數量」、UI 加數量選擇。複雜度升一階、Sean 知情選 B。
- **Q4=A**:**不 step-up**、原因必填+完整 audit(沿 tier 片 07-16 慣例;`2026-07-12-m4a-admin-phase1-prd.md:44` 的取消訂單 step-up 字面由本拍板取代)。
- **D5 定案:不轉 Claude Design demo、Sean 拍「我們自己處理就好」**——後台退款 UI 由執行 session 直接做、收工 Sean 肉眼驗。🔴 **前提更正(2026-07-25 偵察實查)**:訂單**明細頁已有**「小計/運費/折扣/總計」四行 summary(`apps/admin/src/components/orders/order-detail.tsx:104-143`、shippingFee L119),訂單**列表**無運費欄;D5 縮為「退款操作 UI + 退款態顯示」、非從零補運費顯示。
- **delay_capture 事實(Sean 提出、已查證)**:PCM **不送 `delay_capture_in_days`=預設 0 當日請款**(`TapPayChargeAdapter.ts:147,176`、測試守門 `:384`)→ 每筆交易請款成功後即可部分退款(TapPay 規則:未請款交易只能全額 void、請款後才可部分退)。

### 0c. 🆕 2026-07-25 第三批拍板(Q5/Q6;RF1 plan v3 + 新增 RF2a-0)

- **Q5=A(D4=B 維持)+ 新增失敗路徑要求**:按下退款當下顯示「退款處理中」;**系統隔日仍必須向 TapPay 覆核一次**;覆核發現**沒退成** → ①**跳通知**(掛既有 anomaly-alert 管道 Email+LINE、S2 已備 flag 待 S4)②**款項狀態回復**(`payment_status` 由 processing 態回 `paid`;品項 `workflow_status` 回「已收未定」`received_unconfirmed`)。⇒ RF8 範圍擴張:不只「覆核成功轉 refunded」,還要**失敗回滾 + 告警**。
  - ⚠️ 字面理解待確認(不擋工):Sean 原句「當下顯示A」解讀為「當下顯示走 A 口徑=退款處理中」;若實為「當下就顯示已退款、背後隔天複查」,RF6 顯示文案改一處即可、其餘設計不變。
- **Q6=B 下單凍結運費規則**(推翻 Claude 推薦的 A=當下表)。⇒ 新增 **RF2a-0** 片:`orders` 加凍結欄 + `create_order` 寫入 + 既有訂單 backfill。RF1 引擎改收 `shippingRule` 參數(不再直讀模組常數)。
- 🆕 **Sean 提問:免運門檻/運費金額改成後台可管理?** → **答:方向對、但不進本線**(理由見 backlog 新條目)。本線走 Q6=B 的最小正確實作(凍結數字欄);後台管理另立 backlog、退刷線收工後評估。**關鍵理由**:後台管理必須讓 `create_order`(654 行金流 RPC、9 參)改成讀表,而「避免動 create_order」正是 07-24 補差額免運片 Sean 拍 A 案的原因;在最高風險的退刷線中途再塞一個動建單 RPC 的擴張=兩個高風險疊加。RF2a-0 的凍結欄與未來規則表**不衝突**(凍結欄是歷史快照、規則表是當前設定,兩者並存)。

> 🔴 **D1 改採「部分退款」(推翻 PRD 原推薦「只全額」)** — 本線範圍與複雜度顯著擴張,§4 拆片估 5-7 片需下個 session 重定(見下「拆片影響」)。下個 session 起(Q=A、乾淨 session 續作),須一併考量**訂單管理系統的操作方式與顯示方式**。

- **D1 = B 部分退款(依品項)**。理由(Sean):後台一張訂單多筆品項是**分開顯示**,退款也按**該品項**退。
  - ✅ **TapPay 支援部分退款(更正 PRD §5 D1 原文的不精確)**:一般信用卡透過 refund API 帶 `amount` 即部分退(不帶=全額);record_status 有 `2 PARTIALREFUNDED`(`docs/reference/tappay-reference.md` §2.3)。**唯分期付款 / T2P 不支援部分退** → 但 PCM 不做信用卡分期(memory `project_installment-not-doing`),故 PCM 每筆 3DS 卡刷都可部分退。
  - 🔴 **運費重算(Sean 明述、必落系統紀錄)**:退品項後對「**剩餘保留品項**」重算運費;若因退款使剩餘小計跨過免運門檻(由免運→須收運費),運費差額須從退款金額**扣回**。
    - 權威門檻 = `home → subtotal >= 5000 ? 0 : 100`(`packages/domain/src/order/shipping.ts:42-53` + create_order RPC §7,兩處同步);`store`(自取)恆 0、無重算。
    - 公式:**退款額 = 退品項金額 − (新運費 − 舊運費)**。
    - Sean 範例:品項 A 2500 + 品項 B 3000 = 5500(原免運、舊運費 0)。退品項 B(3000)→ 剩餘 2500 < 5000 → 新運費 100 → 退款 = 3000 − (100 − 0) = **2900**(保留 100 補收運費)。淨:客付 5500、退 2900、保留 A 2500 + 運費 100 = 2600。✓
  - 🔴 **議題 D5(運費顯示,2026-07-25 Sean 導正方向、細節未拍)**:目前後台訂單頁**只顯示品項金額、不顯示運費**。🔴 **運費是「訂單層級」單一數字、不是每品項各一欄**(Sean:「訂單多品項就變很多運費欄位太麻煩」明確否決 per-item 運費欄);重算後也只更新這一個訂單層級運費值。下個 session 先 grep design-reference 訂單/明細如何呈現(有無運費列 / 一列訂單怎麼顯示運費),轉成 demo 給 Sean 挑(鐵則 1、品味題不用文字讓 Sean 想像)。
  - ✅ **邊界問題(2026-07-25 Sean 已答)**:
    - ①**多次連續部分退的重算基準 = 當下剩餘餘額**(每次退款以「退款當下剩餘保留品項」重算運費,非原始訂單)。
    - ②**全退時先前扣的運費要回退**(退到剩餘為 0 → 運費歸 0、把之前為補運費保留的金額退還);**另設「整單取消」功能**=一次退全部(品項 + 運費全退)。
    - ③**已出貨品項(workflow shipped_done)可以退**(不擋出貨態)。
    - ④**否決 per-item 運費 ledger**:運費記在訂單層級單一欄、重算只更新這一個值(併入 D5,不做每品項運費紀錄)。
    - ⑤(原「金額整數」= 既有鐵則、非決策題,已從清單移除:錢一律整數存、禁 number 浮點。)
- **D2 = A**(冪等 = RPC 內 CAS + `bank_refund_id` 唯一鍵;部分退需擴為「每品項一筆退款鍵」防同品項重退)。
- **D3 = A**(admin 首次持 TapPay prod partner_key、server-only)。
- **D4 = B**(按下先標「退款處理中」、隔日 Record API 確認才轉 `refunded`;部分退需per-品項或per-退款交易追蹤處理中態)。

**拆片影響(下個 session 重定)**:D1=B 使原 R2(refund 帶 amount 按品項算)、R5(per-item refund + 運費重算引擎 + 冪等按品項)、R7(部分退狀態顯示)顯著擴張,並新增「訂單頁運費顯示 + 部分退 UI」片(D5)。原「5-7 片」估需上修;實作前逐片重定 plan,運費重算引擎建議獨立成純函式片(可測、對齊 calculateShippingFee 鏡像)。

## 1. 目標(Sean 拍板)

後台訂單頁「取消訂單」按下去 = **同時自動打 TapPay refund 退款**(不再是提醒 Sean 手動去 Portal 退)。
用正式站 1 元商品 + 真信用卡實測(不走 sandbox)。

## 2. 現況(2026-07-24 recon 實查)

- `TapPayChargeAdapter.refund()` = **stub throw**(`TapPayChargeAdapter.ts:211-214`);port 簽章/型別已備(`ITapPayAdapter.ts:33`、`domain/payment/types.ts:116-129`)。
- 後台**無「取消訂單」按鈕**;`cancelled_at/cancelled_reason` 欄已存在、明細頁只顯示不寫入(`order-detail.tsx:157,172`)。
- 改單 RPC `admin_update_order_workflow` 白名單**只 5 欄、明文排除 `payment_status`**(金流紅線)→ **退款必須另開新 RPC**。
- `payment_status` enum **已含 `refunded`**(`20260604120000:50`)、狀態機支援 `paid→refunded`(終態)→ **免加 enum 值**。
- 退款要的 `rec_trade_id` 存在 `payment_charge_attempts`(`20260612150000`、`status='charged'` 才有);admin repo **目前沒 query 這表** → 要接。
- **admin app 目前零 TapPay wiring**(TapPay adapter 只在 storefront)→ admin 要呼 refund 需新 composition root + Sean 在 admin Vercel 專案設 TapPay env。

## 3. 🔴 兩個最容易漏、會出事的耦合

1. **`settle-charge.ts:124-132` 的 refund_anomaly**(recon 抓到、最隱藏;行號 2026-07-25 複核為 124-132):sweeper/settle 現在把 TapPay `record_status ∈ {2,3}`(退款態)判成 `refund_anomaly` → 回 pending + `console.error`「Phase 1 無退款流程」。**退款一上線但沒改這段** → 退掉的單只要還有 active charge_attempt,**每次 sweep 都被判異常、永久假告警、不收斂**。→ 本線**必須**同步改這段(退款是合法終態、不再當異常)。
2. **隔日生效 vs 本地狀態**(§2.3):TapPay 退款**隔日才真生效**。本地一按就標 `refunded`,若銀行端最終退款失敗,本地與 TapPay 會不同步一段時間 → 需覆核機制(見 D4)。

## 4. 拆片(🔴 2026-07-25 依 D1=B + Q1-Q4 重定,取代原 R1-R7;估 9 片;全線鐵則 12 高風險、每片 plan→codex 關卡1→實作→三綠→code-reviewer→codex 關卡2 不降級,RPC 片加交易模擬)

| 片 | 內容 | 卡手動 |
| --- | --- | --- |
| **RF1** | **退款金額+運費重算引擎**(`packages/domain` 純函式;含 `calculateShippingFee` 加選填 `rule` 參數、預設=現行常數、唯一呼叫端 `useResolvedCart.tsx:118` 零行為變更)。輸入=**訂單凍結運費規則**(Q6=B)+ 當下剩餘品項(含各品項剩餘可退數量)+要退品項與數量(Q3=B)+配送方式+目前運費 → 輸出=退款額、新運費、明細。規則:`退款額=退品項金額−(新運費−舊運費)`;全退→運費歸 0 連同回退;`store` 恆 0 不重算;**退款額 ≤0 組合直接拒**(負退款擋下、提示改整單取消或加退品項)。鏡像 `calculateShippingFee`(`shipping.ts:26-53`、對齊 #216 drift gate)。窮舉測試含 Sean 5500 退 3000→2900 範例、多次連續部分退(基準=當下餘額)、部分數量退 | — |
| **RF2a-0** 🆕 | **凍結運費規則**(Q6=B):`orders` 加 `shipping_free_threshold`/`shipping_home_fee` 兩欄(NOT NULL DEFAULT 對齊現值)+ `create_order` CREATE OR REPLACE 於 §7 一併寫入(**只加欄位寫入、不動運費邏輯**)+ 既有訂單 backfill(唯一歷史規則 5000/100)。🔴 **動 654 行金流 RPC=本線最高風險 migration 片**、交易模擬必跑 | migration=**Sean db push** + 交易模擬 |
| **RF2a** | **退款帳本 schema + enum**(migration):新表 `order_refunds`(order_id、品項+數量、退款額、運費差、`bank_refund_id` 唯一鍵〔≤20 字元〕、TapPay refund_id、狀態 processing/confirmed/failed、原因、操作者)+ per-退款請求冪等鍵(Q3=B 非 per-品項)+ `partiallyRefunded` enum 值(Q1=A)。ACL 鏡像 audit append-only 慣例 | migration=**Sean db push** |
| **RF2b** | **退款 RPC**(`admin_refund_order_items` + `admin_cancel_order` 整單取消):SECURITY DEFINER、`FOR UPDATE`+CAS、RPC 內 SQL 重算驗證呼叫端退款額(不符 reject;SQL 版只驗證不做權威、防三處公式漂移)、驗剩餘可退數量、同交易寫 ledger(processing)+ orders 三金額欄更新為剩餘有效值(Q2=A)+ `cancelled_at/reason`(整單)+ audit;鏡像 `admin_set_customer_tier`/`admin_adjust_wallet`(EXECUTE 僅 service_role + fail-closed 斷言) | migration=**Sean db push** + 交易模擬 |
| **RF3** | **`TapPayChargeAdapter.refund()` 實作**(現 stub throw `:211-214`):新 `refundUrl` config 欄(現無)、帶 `amount`=部分退/不帶=全額(參考 §2.3)、`bank_refund_id` 格式、timeout 30s + 單元測試。🔴 併驗「同一 rec_trade_id 多次部分退」官方口徑(未確認項①) | — |
| **RF4** | **admin TapPay 基建**:order-repository 接 `payment_charge_attempts` 取 `rec_trade_id`(純讀取)+ admin 首個 TapPay composition root(server-only、D3=A) | Sean 設 admin Vercel env(`TAPPAY_PARTNER_KEY`/`TAPPAY_MERCHANT_ID`/`TAPPAY_ENV`) |
| **RF5** | **串接 server action**:退款操作 → RF1 算額 → `refund()` 成功才 → RF2b RPC 落帳(processing);refund 失敗→單不動、顯錯;防連點冪等 | — |
| **RF6** | **後台 UI**(D5=自行處理、不等 demo):明細頁品項退款操作(數量選擇、Q3=B)+ 運費重算預覽 + 整單取消(原因必填、Q4=A 不 step-up)+ 「退款處理中/已退款」顯示 | 收工 Sean 肉眼驗 |
| **RF7** 🔴 | **settle-charge 退款態重分類**:record_status ∈ {2,3} 現判 `refund_anomaly` 永久假告警(`settle-charge.ts:124-132`)→ 改對 `order_refunds` 帳本對帳=合法終態;改分類層、全部 caller 自動繼承。**排序硬約束:必須在第一筆真退款測試前落地** | — |
| **RF8** | **D4 隔日覆核 + 失敗回滾 + 收尾**(Q5=A 定案):sweeper/settle 遇 record_status 2/3 → confirm 帳本 → 翻 `payment_status`(refunded/partiallyRefunded);🔴 **覆核發現沒退成 → ①掛 anomaly-alert 跳通知(Email+LINE)②回滾:`payment_status` 回 `paid`、品項 `workflow_status` 回 `received_unconfirmed`(已收未定)、帳本列標 failed**。另含後台狀態顯示 + 客服退款 SOP runbook(收 #62)+ 0072/0073 雙扣 NT$17,300 正規收口路徑 | 視 flag(S4) |

## 5. Sean 設計決策(2026-07-25 已定案,詳 §0)

> ✅ D1-D4 已拍板,原文保留供背景;**權威決定與更正見 §0**。

- **D1 全額 vs 部分退款**:✅ **拍 B = 部分退款(依品項)+ 運費重算**(§0)。⚠️ 原文「部分退款…分期/T2P 不支援」不精確 → 一般卡支援部分退、PCM 不做分期故可用(§0 更正)。
- **D2 冪等(防重複退款)**:✅ **拍 A** = RPC 內 CAS(`WHERE payment_status='paid'`,已 refunded 就 no-op)+ `bank_refund_id` 唯一鍵;部分退擴為每品項一筆退款鍵。
- **D3 admin 首次持 TapPay prod partner_key**:✅ **拍 A**(server-only、admin 本就特權)。
- **D4 隔日生效怎麼標**:✅ **拍 B** = 按下先標「退款處理中」、隔日 Record 確認才轉 `refunded`。
- **D5 訂單頁運費顯示(新增,未拍)**:見 §0 — 下個 session 依 design 真權威轉 demo 給 Sean 挑。

## 6. 風險 / 審查

- **鐵則 12 命中**:錢(寫 payment_status 紅線欄 + 呼真金退款)+ 權限(新 RPC ACL + admin 首持 partner_key)+ DB(新 migration)。
- 每片:plan → codex 關卡1(高風險)→ 實作 → 三綠 → code-reviewer → codex 關卡2 → Fable(金流配 codex 背書)、**不降級** + 交易模擬(RPC 片)。
- **測試**:真 1 元刷 → 後台取消 → 看 TapPay Portal 隔日確認退款 → 對帳。⚠️ 真金,每次測完確認退款到位。
- **rollback**:R1-R7 各自 commit;RPC 片 rollback = forward-only migration(不貼 SQL Editor);refund() 已送出的退款**不可回收**(→ D1 只全額 + D2 冪等 是硬防線)。

## 7. 與「開真刷卡」的關係

退款線與「開正式站真刷卡」(S4 手動 + #291 法律頁)**可並行**:refund 現況手動 Portal 可用 → Sean 開始真刷測試**不必等**本線做完。本線做好前,退款走手動;做好後升級成自動。
