import Link from 'next/link';
import {
  AdminDataTable,
  type AdminColumn,
} from '../shared/admin-data-table';
import {
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

const COLUMNS: ReadonlyArray<AdminColumn<AdminProductListRow>> = [
  {
    key: 'title',
    header: '商品名稱',
    // 片1b-1:名稱點進詳情頁。做法沿用 components/customers/customers-table.tsx:18
    // (`AdminDataTable` 沒有整列連結的 API ⇒ 連結包在名稱欄,不去改共用表格元件)。
    cell: (row) => (
      <Link href={`/products/${row.id}`} className='hover:underline'>
        {row.title}
      </Link>
    ),
    mobile: 'title',
  },
  { key: 'external_id', header: '料號', cell: (row) => row.external_id, mobile: 'sub' },
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
        <span>{resolveListingState(row) === 'listed' ? '上架中' : '已下架'}</span>
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

export function ProductsTable({
  rows,
  emptyText = '目前沒有商品。',
}: {
  rows: readonly AdminProductListRow[];
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
    <AdminDataTable rows={rows} columns={COLUMNS} getRowKey={(row) => row.id} emptyText={emptyText} />
  );
}
