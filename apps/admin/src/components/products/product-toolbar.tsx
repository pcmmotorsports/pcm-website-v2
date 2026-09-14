import { ProductFilterChips } from './product-filter-chips';
import { ProductKeywordSearch } from './product-keyword-search';
import { ProductSkuFilter } from './product-sku-filter';
import { ProductTaxonomyFilter } from './product-taxonomy-filter';
import type { AdminProductFilter } from '../../lib/products/product-list-view';
import type { BrandOptionRow, CategoryOption } from '../../lib/products/product-taxonomy-options';

// product-toolbar.tsx — 商品頁工具列(2026-09-14 設計窗;Sean 09-14 逐字「重新幫我設計一個比較好用的版本,目前很不直覺並且上方篩選欄位太佔空間」)。
// 照訂單頁那條工具列的樣子:**一列** = 「商品」16px · 搜尋框 · 全部 / 手動 / 自動 chips · 品牌 combobox · 分類下拉 · 右側「共 N 件」;
// 料號批次收進「更多 ▾」。🔴 零改資料層:四支既有元件原封(GET 表單 / 參數名 / hidden 欄位都沒動),只換排法與字級(`.pcm-plist` 那層)。

export function ProductToolbar({
  filter,
  size,
  brands,
  categories,
  total,
  loadFailed,
}: {
  filter: AdminProductFilter;
  size: number;
  brands: readonly BrandOptionRow[];
  categories: readonly CategoryOption[];
  total: number;
  loadFailed: boolean;
}) {
  const skuCount = filter.skus?.length ?? 0;
  return (
    <div data-od-prodfilters className='pcm-head pcm-ptoolbar' data-testid='product-toolbar'>
      <h1>商品</h1>
      <div className='pcm-search'>
        <ProductKeywordSearch filter={filter} size={size} />
      </div>
      {!loadFailed && <ProductFilterChips filter={filter} size={size} />}
      {!loadFailed && (brands.length > 0 || categories.length > 0) && (
        <ProductTaxonomyFilter filter={filter} size={size} brands={brands} categories={categories} />
      )}
      {!loadFailed && (
        <details className='pcm-more' open={skuCount > 0}>
          <summary className='pcm-more-btn' title='料號批次'>更多 ▾{skuCount > 0 ? ` · 料號批次 ${skuCount}` : ''}</summary>
          <div className='pcm-more-panel'>
            <p className='text-muted-foreground mb-1 text-[12px] leading-[1.4]'>料號批次</p>
            <ProductSkuFilter filter={filter} size={size} />
          </div>
        </details>
      )}
      <span className='pcm-sp' />
      {!loadFailed && <span className='pcm-count'>共 {total.toLocaleString('zh-TW')} 件</span>}
    </div>
  );
}
