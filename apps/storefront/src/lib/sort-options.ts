// sort-options.ts — 商品排序選項的單一定義點。
//
// 存在理由:ADR-0007 手機決定 7 把排序拆成獨立入口(面板式),桌機仍是 SortBar 的
// <select>。兩處各寫一份清單 = 日後加一個排序只加在一邊,而兩邊測試都是綠的
// (沒有任何一條會比較兩份清單)。value 字面同時是 `?sort=` 的 URL 契約,
// 不可為了顯示好看而改(products-url-state 讀寫同一組字面)。

export type SortOption = { value: string; label: string };

export const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'recommend', label: '推薦排序' },
  { value: 'new', label: '最新上架' },
  { value: 'price-asc', label: '價格低到高' },
  { value: 'price-desc', label: '價格高到低' },
  { value: 'sale', label: '折扣優先' },
];

/** 目前排序的顯示字面;未知值(手改 URL)→ 回第一項字面、不顯示原始 value。 */
export function sortLabel(value: string): string {
  return SORT_OPTIONS.find((option) => option.value === value)?.label
    ?? SORT_OPTIONS[0]?.label
    ?? '';
}
