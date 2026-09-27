// 商品列表顯示方式(商品頁乙 E1):清單(表格)或卡片。存在 cookie, 理由見 components/products/product-view-toggle.tsx。
export const PRODUCTS_VIEW_COOKIE = 'pcm_products_view';
export type ProductsViewMode = 'table' | 'cards';

/** 認不得的值(含沒有 cookie)一律當清單。 */
export function parseProductsViewMode(value: string | undefined): ProductsViewMode {
  return value === 'cards' ? 'cards' : 'table';
}
