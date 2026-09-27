# 計畫片段：經銷會員累積滿 10 萬通知 Sean；不做高級店家（2026-09-27，窗「進度 a0」）

> Sean 2026-09-27 早上答 E1–E3 甲（經主視窗轉達）。上層兩份計畫：`~/pcm-mailbox/計畫-高級店家價格-20260927.md`（報價單窗 58）、`~/pcm-mailbox/計畫-高級店家自動升級-20260927.md`（報價單窗 14）。
> 碰會員等級與金額計算 ⇒ 實作後送審（鐵則 12）。不動資料庫、不動價格、不自動改任何人的等級。

## 決定（Sean 甲）

- E1：**不做高級店家**。比經銷價更好的價格，用已上線的「會員個人品牌折扣」（後台客戶頁設定）。
- E2：累積金額 = **已出貨訂單的商品金額（小計減折扣，不含運費和稅）扣掉已確認的退款**；取消的訂單、儲值都不算。滿 10 萬時**只通知 Sean**，由他替那位會員設品牌折扣。
- E3：後台改等級的選單拿掉「高級店家」（後台畫面叫「經銷」）。

## 名稱對照（避免混淆）

| 資料庫 tier | 後台畫面名稱（Sean 09-13） | 這份計畫說的 |
|---|---|---|
| `general` | 會員 | 一般會員 |
| `store` | 車行 | **經銷會員**（能在經銷站看經銷價、下經銷單的那一級） |
| `premiumStore` | 經銷 | 高級店家（不做；正式庫 09-27 查為 0 人） |

## E3：已經做好，不用改程式（09-27 查證）

- `apps/admin/src/lib/customers/tier-form.ts:31` `TIER_SETTABLE_VALUES = ['general', 'store']`，送出時 `:78` 只接受這兩個值，其他一律擋下。
- 選單 `tier-edit-form.tsx` 只有「現值本來就是 premiumStore」的舊資料才顯示一格反灰「經銷（不能再設定）」，不能選。
- 正式庫唯讀查詢（09-27）：general 17、store 1、premiumStore 0。

## E2：怎麼做

1. **算法**（`packages/adapters/src/supabase/dealer-spend-milestone-read.ts`，經 `@pcm/adapters/server` 匯出、顧客站只經 `lib/payment/composition.ts` 轉出使用）：
   - 為什麼放在 adapters（主視窗 09-27 裁 Q1 甲）：要用退款兩本帳的作廢欄過濾，而 `scripts/storefront-projection-leak-guard.test.ts` 禁止 storefront 原始碼出現那個欄名（防前台讀到採購作廢欄）。這支讀的是退款表、只在排程伺服器端跑；那道守門不動。
   - 對象：`customers.tier = 'store'` 而且沒有停用（`disabled_at IS NULL`）。
   - 訂單：這些會員的 `orders`，`fulfillment_status = 'shipped'` 而且 `cancelled_at IS NULL`；每筆金額 = `subtotal − discount_total`（整數元，不含運費 `shipping_fee`、稅 `tax_total`）。
   - 扣退款：這些訂單的 `order_refunds`（`status = 'confirmed'` 且 `voided_at IS NULL`）與 `order_manual_refunds`（`voided_at IS NULL`）的 `refund_amount`。
   - 每位會員加總 ≥ 100,000 元就算一位。只讀不寫。
2. **通知**：每日兩班 LINE 摘要（顧客站 `/api/cron/anomaly-alert`，台北 09:00／21:00）在刷卡那一行後面加「／有 N 位經銷會員累積滿 10 萬」；0 位不印；讀不到時列進「這一輪讀不到：經銷會員累積金額」，不當成 0。不進告警判斷（不是出事）。接法照 `60abc6ab3`（經銷商申請待審件數）。
3. **不做的**：不自動升級、不動價格、不寄信給客人、不在後台加畫面。

## 已知限制

- 只要有人累積 ≥ 10 萬，每一班摘要都會印這一行，直到他的累積掉到 10 萬以下；Sean 設好品牌折扣後，這一行不會自己消失。要改成「設過品牌折扣就不算」再請 Sean 決定。
- 「已出貨」用整張訂單的 `fulfillment_status = 'shipped'`；部分出貨的訂單在全部出貨前不算。
- 一次讀取上限：訂單或退款列數到 PostgREST 單次上限（1000）時，當成讀不到，不給一個偏少的數字。

## 影響與退回

- 只多一行 LINE 摘要文字；不寫資料庫、不改任何人的等級或價格。
- 退回 = revert 這一顆 commit。
