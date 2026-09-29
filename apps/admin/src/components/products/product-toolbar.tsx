import { ProductSortSelect } from './product-filter-chips';
import { ProductKeywordSearch } from './product-keyword-search';
import { ProductSkuFilter } from './product-sku-filter';
import { DEFAULT_PAGE_SIZE, buildProductListHref, type AdminProductFilter } from '../../lib/products/product-list-view';
import { PRODUCT_EXPORT_CAP, productExportHref } from '../../lib/products/product-export';

// product-toolbar.tsx — 商品頁工具列(2026-09-14 設計窗;Sean 09-14 逐字「重新幫我設計一個比較好用的版本,目前很不直覺並且上方篩選欄位太佔空間」)。
// 照訂單頁那條工具列的樣子:**一列** = 「商品」16px · 搜尋框 · 全部 / 手動 / 自動 chips · 品牌 combobox · 分類下拉 · 右側「共 N 件」;
// 料號批次收進「更多 ▾」。🔴 零改資料層:四支既有元件原封(GET 表單 / 參數名 / hidden 欄位都沒動),只換排法與字級(`.pcm-plist` 那層)。

export function ProductToolbar({
  filter,
  size,
  total,
  loadFailed,
}: {
  filter: AdminProductFilter;
  size: number;
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
      {!loadFailed && (
        <details className='pcm-more' open={skuCount > 0}>
          <summary className='pcm-more-btn' title='料號批次'>更多 ▾{skuCount > 0 ? ` · 料號批次 ${skuCount}` : ''}</summary>
          <div className='pcm-more-panel'>
            <p className='text-muted-foreground mb-1 text-[12px] leading-[1.4]'>料號批次</p>
            <ProductSkuFilter filter={filter} size={size} />
          </div>
        </details>
      )}
      {/* 商品頁乙 P6:新增手動商品(報價單沒有、網站自己賣的) */}
      <a href='/products/new' className='inline-flex h-8 items-center rounded-md border px-3 text-sm' data-product-new>
        新增商品
      </a>
      {/* 2026-09-29 價格變動清單(地圖 M-5-08):側欄維持 6 項, 入口放在商品工具列。 */}
      <a href='/products/price-changes' className='inline-flex h-8 items-center rounded-md border px-3 text-sm' data-product-price-changes>
        查看價格變動
      </a>
      {/* 2026-09-29 新上架清單(地圖 M-5-03):與價格變動同一排入口。 */}
      <a href='/products/new-listings' className='inline-flex h-8 items-center rounded-md border px-3 text-sm' data-product-new-listings>
        查看新上架
      </a>
      <span className='pcm-sp' />
      {!loadFailed && <ProductSortSelect filter={filter} size={size} />}
      {!loadFailed && <span className='pcm-count'>共 {total.toLocaleString('zh-TW')} 件</span>}
      {/* 2026-09-27 商品清單匯出(M-4a-24 第二片):一般連結,檔案由 `/products/export` 在 server 端組。
          🔴 文字不用「全部」(訂單工具列 Sean 09-16 拍甲那條,商品頁也避開)。超過上限就不給連結,直接說怎麼做。 */}
      {!loadFailed && total > 0 && total <= PRODUCT_EXPORT_CAP && (
        <a
          href={productExportHref(buildProductListHref(filter, { page: 1, size: DEFAULT_PAGE_SIZE }))}
          data-product-export
          className='inline-flex h-8 items-center rounded-md border px-3 text-sm'
        >
          {`匯出商品清單(${total.toLocaleString('zh-TW')} 件)`}
        </a>
      )}
      {!loadFailed && total > PRODUCT_EXPORT_CAP && (
        <span className='text-muted-foreground max-w-xs text-xs' data-product-export-blocked>
          {`超過一次匯出的上限 ${PRODUCT_EXPORT_CAP.toLocaleString('zh-TW')} 件,請先用品牌或分類縮小範圍再匯出。`}
        </span>
      )}
    </div>
  );
}
