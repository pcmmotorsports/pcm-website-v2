import Link from 'next/link';
import type { AdminCustomerSummary } from '@pcm/domain';
import { TIER_LABEL, formatCustomerDate } from '../../lib/customers/customer-list-view';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
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
    cell: (c) => c.email,
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
  // ── 客戶頁三欄(Sean 2026-08-16 指定的標籤字面)────────────────────────────
  //
  // 🔴 三欄共用一條口徑:**已取消的訂單不算**、不扣退款(主視窗 2026-08-16 兩次裁定)。
  //    ⚠️ 標籤旁**沒有**寫「不含已取消」—— 那是文案題,本片沒做;
  //       口徑寫在 view 的 `COMMENT` 與 `AdminCustomerSummary` 的 docstring 裡。
  {
    key: 'activeOrderCount',
    header: '訂單數',
    className: 'text-right tabular-nums',
    mobile: 'meta',
    cell: (c) => c.activeOrderCount,
  },
  {
    key: 'activeSpendTotal',
    header: '消費金額',
    className: 'text-right tabular-nums',
    mobile: 'meta',
    // 整數元位(禁浮點)—— 沿用訂單線既有的格式化,不自己拼字串。
    cell: (c) => formatOrderAmount(c.activeSpendTotal),
  },
  {
    key: 'lastActiveOrderedAt',
    header: '最後下單',
    className: 'text-muted-foreground',
    mobile: 'meta',
    // 🔴 **零訂單是 `null`,必須顯示成「從未下單」,不得留白** ——
    //    留白在畫面上與「載入失敗」長得一模一樣(`AdminCustomerSummary` docstring 逐字)。
    cell: (c) =>
      c.lastActiveOrderedAt === null ? '從未下單' : formatCustomerDate(c.lastActiveOrderedAt),
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
