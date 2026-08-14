import {
  AdminDataTable,
  type AdminColumn,
} from '../shared/admin-data-table';
import {
  resolveListingState,
  resolvePrice,
  type AdminProductRow,
} from '../../lib/products/product-repository';

// M-4b #20 片1a:商品列表表格。相對 import(非 `@/`)—— 根 vitest.config 的 `@` alias 指向 storefront,
// admin 檔案用 `@/` 在測試裡 resolve 不到(先例逐字見 app/settings/suppliers/page.tsx:14-19)。
//
// 🔴 **本檔不得直接讀 `row.price_general` / `row.delisted_at`** —— 一律經 `resolvePrice` /
//    `resolveListingState`(plan §3 設計約束;Q-B1 拍 B 案時那兩支是唯一要改的落點)。
//    這條由 products-table 的來源掃描測試釘住,不是靠這段註解。

/** 售價顯示:`null` 回 null ⇒ AdminDataTable 自己渲染「—」,不在這裡編一個假的 0。 */
function priceCell(row: AdminProductRow) {
  const price = resolvePrice(row);
  return price === null ? null : `NT$ ${price.toLocaleString('zh-TW')}`;
}

const COLUMNS: ReadonlyArray<AdminColumn<AdminProductRow>> = [
  { key: 'title', header: '商品名稱', cell: (row) => row.title, mobile: 'title' },
  { key: 'external_id', header: '料號', cell: (row) => row.external_id, mobile: 'sub' },
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
    cell: (row) =>
      resolveListingState(row) === 'listed' ? '上架中' : '已下架',
    mobile: 'meta',
  },
];

export function ProductsTable({ rows }: { rows: readonly AdminProductRow[] }) {
  return (
    <AdminDataTable
      rows={rows}
      columns={COLUMNS}
      getRowKey={(row) => row.id}
      emptyText='目前沒有商品。'
    />
  );
}
