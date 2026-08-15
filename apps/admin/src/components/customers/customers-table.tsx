import Link from 'next/link';
import type { AdminCustomerSummary } from '@pcm/domain';
import { TIER_LABEL, formatCustomerDate, customerEmailDisplay } from '../../lib/customers/customer-list-view';
import { AdminDataTable, type AdminColumn } from '../shared/admin-data-table';

// M-4a 客戶管理第一片:輕量客戶列表 table(server-render);明細-a 起姓名連 /customers/[id]。
// 🔴 列表不顯 wallet/儲值(儲值金顯示在明細頁=Sean 07-16 拍板 admin 可顯);tier=會員等級標籤(非價格)。phone 可 null → '—'。
// E11-1:改用共用 <AdminDataTable>(積木第一片的驗證對象)。桌機欄位/樣式/連結行為與改前逐欄等價;
//   新增的是手機版卡片(§4-1 規範,改前手機只能橫捲 5 欄表格)。

const COLUMNS: ReadonlyArray<AdminColumn<AdminCustomerSummary>> = [
  {
    key: 'name',
    header: '姓名',
    className: 'font-medium',
    mobile: 'title',
    cell: (c) => (
      <Link href={`/customers/${c.id}`} className='hover:underline'>
        {c.name}
      </Link>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    className: 'text-muted-foreground',
    mobile: 'sub',
    cell: (c) => customerEmailDisplay(c.email),
  },
  {
    key: 'phone',
    header: '電話',
    className: 'text-muted-foreground',
    mobile: 'sub',
    // null → 桌機 td 顯「—」(與改前 `phone ?? '—'` 等價)、手機卡片略過該欄。
    cell: (c) => c.phone,
  },
  {
    key: 'tier',
    header: '會員等級',
    mobile: 'trailing',
    cell: (c) => (
      <span className='bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
        {TIER_LABEL[c.tier]}
      </span>
    ),
  },
  {
    key: 'createdAt',
    header: '註冊日期',
    className: 'text-muted-foreground',
    mobile: 'meta',
    cell: (c) => formatCustomerDate(c.createdAt),
  },
];

export function CustomersTable({ customers }: { customers: AdminCustomerSummary[] }) {
  return (
    <AdminDataTable
      rows={customers}
      columns={COLUMNS}
      getRowKey={(c) => c.id}
      emptyText='目前沒有符合條件的客戶。'
    />
  );
}
