# PRD — 後台「取消訂單 = 自動退款」線(2026-07-24 草稿)

> ⚠️ **Claude 過夜自主起草;Sean 2026-07-24 拍 Q4=B 授權方向(退款線提前啟動第二段、真 1 元刷測)。**
> 這是**一條線、非一片**(估 5-7 片),命中**鐵則 12 錢+權限+DB**、每片需 plan + codex 對抗審 + 交易模擬。
> **只規劃,未實作**;每片實作前需 Sean ①批 plan ②db push(新 RPC)③設 admin Vercel TapPay env。
> 背景拍板 = memory `project_refund-line-two-stage`(2026-07-24 段)+ `project_sean-real-payment-verify-via-1nt-product`。
> refund 規格 = `docs/reference/tappay-reference.md` §2.3。

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
| **R2** | `TapPayChargeAdapter.refund()` 實作(既有 fetch pattern、新 `refundUrl` config 欄、partner_key + rec_trade_id、`bank_refund_id` 唯一、amount 不帶=全額)+ 單元測試 | — |
| **R3** | admin order-repository 接 `payment_charge_attempts` 取該單 `rec_trade_id`(退款要用)| 純讀取、無 migration |
| **R4** | admin TapPay composition root(server-only、金鑰不進 client)+ Sean 在 admin Vercel 設 `TAPPAY_PARTNER_KEY`(prod)/`TAPPAY_MERCHANT_ID`/`TAPPAY_ENV` | Sean 設 Vercel env |
| **R5** | 串接:取消按鈕 → 先呼 refund()(成功才)→ R1 的 RPC 落 refunded + audit;冪等(防連點雙退)+ 失敗態(refund 失敗→單不動、顯錯)| — |
| **R6** 🔴 | 改 `settle-charge.ts` refund_anomaly:退款為合法終態、不再永久告警(§3-1)| — |
| **R7** | 隔日生效覆核 / 對帳(D4)+ 後台顯示態「退款處理中→已退款」+ SOP | 視 D4 |

## 5. 🔴 Sean 須拍的設計決策

- **D1 全額 vs 部分退款**:Phase 1 **只做全額退款**(amount 不帶)?(推薦——部分退款不可逆、分期/T2P 不支援、複雜度高;1 元測也用不到部分)。A=只全額 / B=要支援部分。
- **D2 冪等(防重複退款)**:連點兩次「取消」不能打兩次 refund。做法=RPC 內 CAS(`WHERE payment_status='paid'`,已 refunded 就 no-op)+ `bank_refund_id` 用訂單 id 衍生的唯一鍵。A=採此(推薦)/ B=你有別的想法。
- **D3 admin 首次持 TapPay prod partner_key**:退款要在 admin 端呼 TapPay → admin 首次引入正式 partner_key(server-only、不進 client)。A=可接受(推薦、admin 本就特權)/ B=改由 storefront 端 server 代呼(多一層、但金鑰集中)。
- **D4 隔日生效怎麼標**:按下取消後,本地馬上標什麼?A=馬上標 `refunded`+背景用 Record API 覆核(簡單、但銀行拒退時會短暫不一致)/ B=標「退款處理中」、隔日 Record 確認才轉 `refunded`(準確、多一道覆核)。**推薦 B**(錢的事寧可準)。

## 6. 風險 / 審查

- **鐵則 12 命中**:錢(寫 payment_status 紅線欄 + 呼真金退款)+ 權限(新 RPC ACL + admin 首持 partner_key)+ DB(新 migration)。
- 每片:plan → codex 關卡1(高風險)→ 實作 → 三綠 → code-reviewer → codex 關卡2 → Fable(金流配 codex 背書)、**不降級** + 交易模擬(RPC 片)。
- **測試**:真 1 元刷 → 後台取消 → 看 TapPay Portal 隔日確認退款 → 對帳。⚠️ 真金,每次測完確認退款到位。
- **rollback**:R1-R7 各自 commit;RPC 片 rollback = forward-only migration(不貼 SQL Editor);refund() 已送出的退款**不可回收**(→ D1 只全額 + D2 冪等 是硬防線)。

## 7. 與「開真刷卡」的關係

退款線與「開正式站真刷卡」(S4 手動 + #291 法律頁)**可並行**:refund 現況手動 Portal 可用 → Sean 開始真刷測試**不必等**本線做完。本線做好前,退款走手動;做好後升級成自動。
