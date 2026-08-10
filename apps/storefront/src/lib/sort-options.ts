// sort-options.ts — 商品排序選項的單一定義點。
//
// 存在理由:ADR-0007 手機決定 7 把排序拆成獨立入口(面板式),桌機仍是 SortBar 的
// <select>。兩處各寫一份清單 = 日後加一個排序只加在一邊,而兩邊測試都是綠的
// (沒有任何一條會比較兩份清單)。value 字面同時是 `?sort=` 的 URL 契約,
// 不可為了顯示好看而改(products-url-state 讀寫同一組字面)。

export type SortOption = { value: string; label: string };

// 🔴 **這份清單與 `catalog-query.ts` 的 `CATALOG_SORT_VALUES` 是兩份、而且不相等。**
//    後者(server 端白名單)只認 `recommend / price-asc / price-desc`;不在白名單裡的
//    `?sort=` 值會被 `parseCatalogQuery` **靜默回退成 recommend**
//    ⇒ 列在這裡、卻不在白名單裡的選項 = **客人選了排序完全沒變的假選項**。
//    ⚠️ 兩份清單之間**沒有任何守門在比對**(檔頭那段講的是「手機/桌機各寫一份」那個問題,
//    不是這個)。2026-08-11 #269-a 發現時,五個選項裡有兩個是假的。
export const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'recommend', label: '推薦排序' },
  // ⚠️ **今天是假的**:`new` 不在 `CATALOG_SORT_VALUES` 裡 ⇒ 選了等於推薦排序。
  //    刻意留著 —— #269-b(RPC 投影帶 `created_at`)就是要把它做成真的,
  //    那片落地時把 `new` 加進白名單即可、不必重接 UI。
  //    🔴 若 #269-b 被取消或無限期延後,這一行要跟著拿掉(理由同下面被移除的「折扣優先」)。
  { value: 'new', label: '最新上架' },
  { value: 'price-asc', label: '價格低到高' },
  { value: 'price-desc', label: '價格高到低' },
  // 🔴 `{ value: 'sale', label: '折扣優先' }` 2026-08-11 移除(#269-a)。
  //    它同樣不在 `CATALOG_SORT_VALUES` 裡 ⇒ 客人選「折扣優先」排序完全沒變、靜默回退,
  //    而它在**桌機商品頁排序下拉**(`ProductsPage.tsx`)**與手機排序面板**
  //    (`ProductsMobileControls.tsx`)**都 render**。
  //    與「特價」導覽鈕是同一個決策的同一面(Sean:特價概念還不存在、假入口在騙客人);
  //    主視窗 2026-08-11 裁「一併拿掉,留它=修一半」。恢復條件見 backlog #390。
];

/** 目前排序的顯示字面;未知值(手改 URL)→ 回第一項字面、不顯示原始 value。 */
export function sortLabel(value: string): string {
  return SORT_OPTIONS.find((option) => option.value === value)?.label
    ?? SORT_OPTIONS[0]?.label
    ?? '';
}
