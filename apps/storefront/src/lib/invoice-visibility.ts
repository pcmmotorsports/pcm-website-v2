// invoice-visibility.ts — 發票欄位「先隱藏」的單一總開關。
//
// Sean 2026-08-08 深夜拍板(逐字):「順便先幫我把發票這個欄位在會員與結帳區域先隱藏」
// —— **隱藏、不是刪除**,之後會再開。
//
// 重開 = 把下面這顆常數改成 `false`,不需要動任何元件、不需要找回被刪的 JSX。
//
// 🔴 藏的是**顯示層**,資料路徑一律不動:
//   · `orders.invoice` 是 NOT NULL Json ⇒ 建單照常送發票 payload(隱藏期間一律 `DEFAULT_INVOICE`
//     = 個人發票、無載具),不會 23502。
//   · 既有地址已存的發票設定**留在 DB、一字未動**,重開時直接回來。
//
// 🔴 隱藏期間**連帶關掉「地址 → 結帳發票」自動帶入**(`useInvoiceAutofill`)。這條是刻意的,
//    不是順手:自動帶入會把地址上存的發票搬進結帳草稿,而 company 型別在 server 端是
//    fail-closed 驗證(`CheckoutInvoiceInput` superRefine:title 必填 + 統編 8 碼)。
//    欄位藏起來之後,那些錯誤**沒有任何可見欄位能修** ⇒ 客人會卡在付款鍵前面、無路可走。
//    所以隱藏期間一律走預設個人發票;地址上的資料仍原封不動留著。
export const INVOICE_FIELDS_HIDDEN = true;
