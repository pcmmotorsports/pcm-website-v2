import type { SupplierRow } from '../../lib/supplier-repository';
import {
  AdminDataTable,
  type AdminColumn,
} from '../shared/admin-data-table';
import { SupplierEditRow } from './supplier-edit-row';

// supplier-table.tsx — M-4b E10 S3b-3:供應商名單(**含已停用**)。
// 🔴 刻意**沒有** id 欄:staff 表列出 id 是因為員工代碼是人挑的、有意義;
//    供應商 id 是 `gen_random_uuid()`,對員工零意義,列出來只是噪音
//    (它仍以 hidden input 的形式存在於每一列的表單裡)。
// 🔴 刻意**沒有**刪除鈕:供應商不可刪除(Sean 2026-08-01 拍板 2),
//    S1a 有三道 DB 守門擋 DELETE ⇒ 畫一顆按鈕出來只會讓員工按了拿到錯誤。
//
// ponytail: `SupplierEditRow` 同時放進 `cell` 與 `renderMobileActions`
//   ⇒ 每一列的兩張 form 各渲染兩次(26 家 = DOM 裡 104 張 `<form>`)。
//   `admin-data-table.tsx:14-18` 的檔頭正好警告過這個組合。**維持現狀的理由**:
//   桌機/手機容器互斥(`hidden md:block` / `md:hidden`)⇒ a11y 樹乾淨、提交不會雙送,
//   而 `staff-table.tsx:49/60` 是逐字相同的做法(偏離樣板要有更好的理由,這裡沒有)。
//   代價只有 DOM 體積。名單長到需要分頁時,連同 `<ListPagination>` 一起處理。

function SupplierStatus({ active }: { active: boolean }) {
  return active ? (
    <span className='font-medium'>啟用中</span>
  ) : (
    <span className='text-muted-foreground font-medium'>已停用</span>
  );
}

const COLUMNS: ReadonlyArray<AdminColumn<SupplierRow>> = [
  {
    key: 'label',
    header: '供應商名稱',
    mobile: 'title',
    cell: (row) => (
      <span className={row.is_active ? undefined : 'line-through opacity-70'}>
        {row.label}
      </span>
    ),
  },
  {
    key: 'status',
    header: '狀態',
    mobile: 'trailing',
    // 🔴 停用狀態同時用**刪節線**與**文字**表示:只靠刪節線 = 只靠視覺,
    //    列印、色弱、螢幕閱讀器都讀不出來(對齊 staff-table 的同一條)。
    cell: (row) => <SupplierStatus active={row.is_active} />,
  },
  {
    key: 'actions',
    header: '操作',
    cell: (row) => <SupplierEditRow supplier={row} />,
  },
];

export function SupplierTable({ rows }: { rows: readonly SupplierRow[] }) {
  return (
    <AdminDataTable
      rows={rows}
      columns={COLUMNS}
      getRowKey={(row) => row.id}
      emptyText='目前沒有供應商。用下方表單新增。'
      renderMobileActions={(row) => <SupplierEditRow supplier={row} />}
    />
  );
}
