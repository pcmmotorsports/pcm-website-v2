'use client';

// 客人明細列印頁的列印鈕。
//
// 🔴 **為什麼要有這顆鈕、而不是叫客人自己按 Ctrl+P**:一張專門用來印的頁面上沒有列印鈕,
//    就是把「你現在該做什麼」丟給客人自己猜 —— 而這一頁的客人裡有不熟電腦的。
//
// 🔴 **class 不照抄後台那顆** —— 後台用 Tailwind(`rounded-md border px-3 py-1.5 print:hidden`),
//    而 storefront 沒有 Tailwind ⇒ 照抄過來的話那顆鈕沒有樣式,而且 `print:hidden` 是死的
//    ⇒ **它會被印在紙上**。這裡用顧客站既有的 `.acc-btn-ghost`(`styles/account.css:691`,
//    也正是 OD 稿那顆鈕的 class),藏紙由外層 `.stmt-actions` 的 `@media print` 負責。
export function StatementPrintButton() {
  // `data-slot` 是守門的**前提**不是裝飾:沒有它,「某某狀態下這顆鈕不在」那條斷言選不到東西
  // ⇒ 永遠通過 ⇒ 恆真。
  return (
    <button
      type='button'
      data-slot='statement-print-button'
      onClick={() => window.print()}
      className='acc-btn-ghost'
    >
      列印 / 儲存成 PDF
    </button>
  );
}
