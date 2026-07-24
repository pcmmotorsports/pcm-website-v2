# PRD — 後台「取消訂單 = 自動退款」線(2026-07-24 草稿)

> ⚠️ **Claude 過夜自主起草;Sean 2026-07-24 拍 Q4=B 授權方向(退款線提前啟動第二段、真 1 元刷測)。**
> 這是**一條線、非一片**(估 5-7 片),命中**鐵則 12 錢+權限+DB**、每片需 plan + codex 對抗審 + 交易模擬。
> **只規劃,未實作**;每片實作前需 Sean ①批 plan ②db push(新 RPC)③設 admin Vercel TapPay env。
> 背景拍板 = memory `project_refund-line-two-stage`(2026-07-24 段)+ `project_sean-real-payment-verify-via-1nt-product`。
> refund 規格 = `docs/reference/tappay-reference.md` §2.3。

## 0. 2026-07-25 Sean 拍板定案(D1-D4 + 新增運費重算議題)

> 🔴 **D1 改採「部分退款」(推翻 PRD 原推薦「只全額」)** — 本線範圍與複雜度顯著擴張,§4 拆片估 5-7 片需下個 session 重定(見下「拆片影響」)。下個 session 起(Q=A、乾淨 session 續作),須一併考量**訂單管理系統的操作方式與顯示方式**。

- **D1 = B 部分退款(依品項)**。理由(Sean):後台一張訂單多筆品項是**分開顯示**,退款也按**該品項**退。
  - ✅ **TapPay 支援部分退款(更正 PRD §5 D1 原文的不精確)**:一般信用卡透過 refund API 帶 `amount` 即部分退(不帶=全額);record_status 有 `2 PARTIALREFUNDED`(`docs/reference/tappay-reference.md` §2.3)。**唯分期付款 / T2P 不支援部分退** → 但 PCM 不做信用卡分期(memory `project_installment-not-doing`),故 PCM 每筆 3DS 卡刷都可部分退。
  - 🔴 **運費重算(Sean 明述、必落系統紀錄)**:退品項後對「**剩餘保留品項**」重算運費;若因退款使剩餘小計跨過免運門檻(由免運→須收運費),運費差額須從退款金額**扣回**。
    - 權威門檻 = `home → subtotal >= 5000 ? 0 : 100`(`packages/domain/src/order/shipping.ts:42-53` + create_order RPC §7,兩處同步);`store`(自取)恆 0、無重算。
    - 公式:**退款額 = 退品項金額 − (新運費 − 舊運費)**。
    - Sean 範例:品項 A 2500 + 品項 B 3000 = 5500(原免運、舊運費 0)。退品項 B(3000)→ 剩餘 2500 < 5000 → 新運費 100 → 退款 = 3000 − (100 − 0) = **2900**(保留 100 補收運費)。淨:客付 5500、退 2900、保留 A 2500 + 運費 100 = 2600。✓
  - 🔴 **新增議題 D5(顯示,Sean 未拍、下個 session 依 design 真權威定)**:目前後台訂單頁**只顯示品項金額、不顯示運費**(Sean 原話「不知怎麼放好」);部分退款重算的前提是運費要在訂單頁可見。下個 session 先 grep design-reference 訂單/明細如何呈現運費,再轉成 demo 需求給 Sean 挑(鐵則 1、品味題不用文字讓 Sean 想像)。
  - ⚠️ **未拍的邊界問題(下個 session 一次批次問 Sean,勿自行假設)**:①多次連續部分退,運費以「當下剩餘」還是「原始」為基準重算 ②退到剩最後一件 / 全退時,先前扣的 100 是否回退(或全退走「整單取消」另一路) ③已出貨品項(workflow shipped_done)可否退 ④「保留 100」是記成訂單一筆運費 charge 還是只是減少退款額(Sean 要求落紀錄 → 傾向前者、需 audit/ledger 欄) ⑤金額整數規則(禁 number 處理錢、鐵則 server 端)。
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

1. **`settle-charge.ts:124-131` 的 refund_anomaly**(recon 抓到、最隱藏):sweeper/settle 現在把 TapPay `record_status ∈ {2,3}`(退款態)判成 `refund_anomaly` → 回 pending + `console.error`「Phase 1 無退款流程」。**退款一上線但沒改這段** → 退掉的單只要還有 active charge_attempt,**每次 sweep 都被判異常、永久假告警、不收斂**。→ 本線**必須**同步改這段(退款是合法終態、不再當異常)。
2. **隔日生效 vs 本地狀態**(§2.3):TapPay 退款**隔日才真生效**。本地一按就標 `refunded`,若銀行端最終退款失敗,本地與 TapPay 會不同步一段時間 → 需覆核機制(見 D4)。

## 4. 拆片(估;順序可調,實作前逐片再定 plan)

| 片 | 內容 | 卡手動 |
|---|---|---|
| **R1** | 新 owner SECURITY DEFINER RPC `admin_cancel_refund_order`(樂觀鎖 version + 同交易寫 `cancelled_at/reason` + `payment_status='refunded'` + `admin_audit_log`;EXECUTE 僅 service_role + fail-closed 斷言;冪等閘見 D2)。**先不含真退款、回傳「待退款」**,讓 RPC/audit/UI 骨架先過審 | migration=**Sean db push** |
| **R2** | `TapPayChargeAdapter.refund()` 實作(既有 fetch pattern、新 `refundUrl` config 欄、partner_key + rec_trade_id、`bank_refund_id` 唯一)+ 單元測試。🔴 **D1=B**:須支援帶 `amount`(部分退)、全額退才不帶;呼叫端傳入重算後金額 | — |
| **R3** | admin order-repository 接 `payment_charge_attempts` 取該單 `rec_trade_id`(退款要用)| 純讀取、無 migration |
| **R4** | admin TapPay composition root(server-only、金鑰不進 client)+ Sean 在 admin Vercel 設 `TAPPAY_PARTNER_KEY`(prod)/`TAPPAY_MERCHANT_ID`/`TAPPAY_ENV` | Sean 設 Vercel env |
| **R5** | 串接:取消按鈕 → 先呼 refund()(成功才)→ R1 的 RPC 落 refunded + audit;冪等(防連點雙退)+ 失敗態(refund 失敗→單不動、顯錯)| — |
| **R6** 🔴 | 改 `settle-charge.ts` refund_anomaly:退款為合法終態、不再永久告警(§3-1)| — |
| **R7** | 隔日生效覆核 / 對帳(D4)+ 後台顯示態「退款處理中→已退款」+ SOP | 視 D4 |

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
