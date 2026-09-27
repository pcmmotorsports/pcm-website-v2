import Link from 'next/link';
import { ProductSelectAllOnPage } from './product-batch-bar';
import { ProductQuickListing } from './product-quick-listing';
import { productDetailHref } from '../../lib/products/product-list-view';
import {
  AdminDataTable,
  type AdminColumn,
} from '../shared/admin-data-table';
import {
  displayTitle,
  isSourceMissing,
  resolveListingSetBy,
  resolveListingState,
  resolvePrice,
  type AdminProductListRow,
} from '../../lib/products/product-repository';

// M-4b #20 片1a:商品列表表格。相對 import(非 `@/`)—— 根 vitest.config 的 `@` alias 指向 storefront,
// admin 檔案用 `@/` 在測試裡 resolve 不到(先例逐字見 app/settings/suppliers/page.tsx:14-19)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
//
// 🔴 **本檔不得直接讀 `row.price_general` / `row.delisted_at` / `row.listing_set_by` /
//    `row.source_missing_at`** —— 一律經 `resolvePrice` / `resolveListingState` /
//    `resolveListingSetBy` / `isSourceMissing`(plan §3 設計約束)。
//    這條由 products-table 的來源掃描測試釘住,不是靠這段註解。

/**
 * 「誰決定的」標記(`#20` 片2c;文案為 Sean 2026-08-15 拍板字面,**不得自行改寫**)。
 *
 * 🔴 **每一列都必須顯示其一。** 這不是排版偏好 —— Sean 把文案從「員工設定」改成「手動/自動」,
 *    理由就是**兩種狀態都要有名字**:只有一種有標記時,「空白」會同時代表「自動」與「資料壞了」。
 * ⇒ 值不在白名單時顯示「⚠ 資料異常」,**不得靜靜落回「自動」**(負測釘住)。
 *
 * ⚠️ **上線初期會全部是「自動」、「手動」chip 篩出 0 筆** —— 因為寫入 `staff` 的員工入口
 *    在後續片才做(plan §5 `Q3=乙`)。**那不是壞掉**,空狀態文案要講清楚。
 */
const SET_BY_LABEL = { staff: '手動', sync: '自動', unknown: '⚠ 資料異常' } as const;

/** 售價顯示:`null` 回 null ⇒ AdminDataTable 自己渲染「—」,不在這裡編一個假的 0。 */
function priceCell(row: AdminProductListRow) {
  const price = resolvePrice(row);
  return price === null ? null : `NT$ ${price.toLocaleString('zh-TW')}`;
}

/** 商品頁乙 A4:縮圖。代表圖待補(佔位圖或沒有圖)就畫空框寫「待補」,一眼看得出哪件沒照片。 */
function thumbCell(row: AdminProductListRow) {
  if (row.image_missing !== false || !row.thumb) {
    return (
      <span className='border-border text-muted-foreground inline-flex h-9 w-9 items-center justify-center rounded-md border border-dashed text-[10px]'>
        待補
      </span>
    );
  }
  return <img src={row.thumb} alt='' loading='lazy' className='bg-muted h-9 w-9 rounded-md object-contain' />;
}

function buildColumns(
  openId: string | undefined,
  openHref: (id: string | undefined) => string,
  listHref: string | undefined,
): ReadonlyArray<AdminColumn<AdminProductListRow>> {
  return [
  {
    key: 'select',
    // 商品頁乙 A6:勾選框。一般 <input>,批次按鈕列(ProductBatchBar)讀 DOM 算已選幾件。
    header: <ProductSelectAllOnPage />,
    cell: (row) => (
      <input type='checkbox' data-product-select value={row.id} data-title={displayTitle(row)} aria-label={`選取 ${displayTitle(row)}`} />
    ),
  },
  { key: 'thumb', header: '圖', cell: thumbCell },
  {
    key: 'title',
    header: '商品名稱',
    // 片1b-1:名稱點進詳情頁。做法沿用 components/customers/customers-table.tsx:18
    // (`AdminDataTable` 沒有整列連結的 API ⇒ 連結包在名稱欄,不去改共用表格元件)。
    cell: (row) => (
      <div id={`p-${row.id}`}>
        {/* 商品頁乙 A9:▸ 展開這一列的摘要(網址帶 ?open=,篩選照舊);名稱照舊連到完整頁 */}
        <Link
          href={openHref(openId === row.id ? undefined : row.id)}
          aria-expanded={openId === row.id}
          aria-label={openId === row.id ? '收合摘要' : '展開摘要'}
          className='text-muted-foreground mr-1.5 inline-block w-4 no-underline'
          scroll={false}
        >
          {/* 用圖示不用字元:名稱欄的文字只放商品名稱(測試與複製都讀它) */}
          <svg viewBox='0 0 16 16' width='12' height='12' aria-hidden='true' className={openId === row.id ? 'rotate-90' : undefined}>
            <path d='M6 3l5 5-5 5' fill='none' stroke='currentColor' strokeWidth='2' />
          </svg>
        </Link>
        <Link href={productDetailHref(row.id, listHref)} className='text-foreground font-bold hover:underline'>
          {displayTitle(row)}
        </Link>
        {openId === row.id && <ProductRowSummary row={row} closeHref={openHref(undefined)} detailHref={productDetailHref(row.id, listHref)} />}
      </div>
    ),
    mobile: 'title',
  },
  { key: 'external_id', header: '料號', cell: (row) => <span className='font-mono'>{row.external_id}</span>, mobile: 'sub' },
  {
    key: 'brand',
    header: '品牌',
    // 🔴 `null` 回 `null` ⇒ `AdminDataTable` 自己渲染「—」(同 `priceCell` 的紀律)。
    //    **不在這裡編一個空字串** —— 空白格與「這一欄還沒載入」在畫面上分不開。
    //    (`brand_id` 在 DB 上是 NOT NULL,而**正式庫量到填充率 100%**
    //     ⇒ 這條路今天走不到;留著是因為 wire 型別允許 `null`,而型別是下一個人的依據。)
    cell: (row) => row.brands?.name ?? null,
    mobile: 'meta',
  },
  {
    key: 'category',
    header: '分類',
    // 顯示完整路徑(`'引擎部品 · 排氣管'`)而不是只顯示子類名 ——
    // 子類名單獨看常常認不出是哪一塊(例「卡鉗」屬煞車還是屬避震)。
    cell: (row) => row.categories?.raw_path ?? null,
    mobile: 'meta',
  },
  {
    key: 'price',
    header: '售價',
    cell: priceCell,
    alignRight: true,
    mobile: 'trailing',
  },
  {
    key: 'listing',
    header: '狀態',
    // 🔴 「已下架」要看得出來 —— 後台存在的理由之一就是把下架的那批找回來上架。
    cell: (row) => (
      <span className='flex flex-wrap items-center gap-1.5'>
        {/* 2026-09-14:方角 cap(稿 .cap);上架中 綠 / 已下架 灰,顏色走 token */}
        {resolveListingState(row) === 'listed' ? (
          <span className='pcm-cap pcm-cap--on'>上架中</span>
        ) : (
          <span className='pcm-cap'>已下架</span>
        )}
        {/* 商品頁乙 A4:缺貨另外標,不跟「已下架」「原廠已無此品」合併 —— 缺貨的可能還在架上。 */}
        {resolveListingState(row) === 'listed' && row.availability === 'out-of-stock' && (
          <span className='pcm-cap'>缺貨</span>
        )}
        <span className='text-muted-foreground text-xs'>
          {SET_BY_LABEL[resolveListingSetBy(row)]}
        </span>
        {/* 🔴 「原廠已無此品」≠「已停產、不能賣」——
            Sean 的規則正好相反:原廠停產但他有現貨時,商品要繼續賣。
            文案只陳述來源端的事實,不暗示能不能賣(migration 20260815030000 欄位註解同字面)。 */}
        {isSourceMissing(row) && (
          <span className='text-muted-foreground text-xs'>原廠已無此品</span>
        )}
      </span>
    ),
    mobile: 'meta',
  },
];
}


/** 商品頁乙 A9:展開後的摘要。只顯示與做最常用的事;其他去完整頁。 */
function ProductRowSummary({ row, closeHref, detailHref }: { row: AdminProductListRow; closeHref: string; detailHref: string }) {
  const listed = resolveListingState(row) === 'listed';
  const price = resolvePrice(row);
  return (
    <div className='bg-muted/40 mt-2 space-y-2 rounded-md border p-3 text-sm whitespace-normal' data-product-row-summary>
      <div className='flex flex-wrap gap-x-4 gap-y-1'>
        <span>售價 {price === null ? '未設定' : `NT$ ${price.toLocaleString('zh-TW')}`}</span>
        <span>分類 {row.categories?.raw_path ?? '未設定'}</span>
        <span>{listed ? '上架中' : '已下架'}</span>
        <span>{row.availability === 'out-of-stock' ? '缺貨' : '有庫存'}</span>
        {isSourceMissing(row) && <span>原廠已無此品</span>}
        {row.image_missing !== false && <span>代表圖待補</span>}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <ProductQuickListing productId={row.id} listed={listed} />
        <Link href={detailHref} className='border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm'>
          打開完整頁
        </Link>
        <Link href={closeHref} scroll={false} className='text-muted-foreground text-sm underline'>
          收合
        </Link>
      </div>
    </div>
  );
}

export function ProductsTable({
  rows,
  emptyText = '目前沒有商品。',
  openId,
  openHref = () => '/products',
  listHref,
}: {
  rows: readonly AdminProductListRow[];
  /** 商品頁乙 A9:展開摘要的那一件;沒給 = 都收合。 */
  openId?: string;
  /** 商品頁乙 A9:展開 / 收合某一件的網址(保留目前的篩選與頁碼);`undefined` = 收合。 */
  openHref?: (id: string | undefined) => string;
  /** 商品頁乙 A11:目前的列表網址;點進商品頁時帶著,才回得去。 */
  listHref?: string;
  /**
   * 空狀態文案。**預設是「這一頁真的沒有東西」那一句。**
   *
   * 🔴 `#661`:有搜尋詞而零命中時,呼叫端要換成「找不到符合的商品」——
   *    兩者**在畫面上是同一個空框**,而它們對員工的意思相反:
   *    「目前沒有商品」讀起來像**系統壞了或還沒進貨**;
   *    「找不到符合的商品」讀起來像**我打的詞不對,再試一次**。
   *    ⇒ 用錯那一句,員工會停止嘗試 —— 而那是這個功能唯一的用途。
   */
  emptyText?: string;
}) {
  return (
    <AdminDataTable rows={rows} columns={buildColumns(openId, openHref, listHref)} getRowKey={(row) => row.id} emptyText={emptyText} />
  );
}
