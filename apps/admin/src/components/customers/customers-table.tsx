import Link from 'next/link';
import type { AdminCustomerSummary } from '@pcm/domain';
import { TIER_LABEL, formatCustomerDate } from '../../lib/customers/customer-list-view';

// M-4a 客戶管理第一片:輕量客戶列表 table(server-render);明細-a 起姓名連 /customers/[id]。
// 🔴 列表不顯 wallet/儲值(儲值金顯示在明細頁=Sean 07-16 拍板 admin 可顯);tier=會員等級標籤(非價格)。phone 可 null → '—'。

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap';

function CustomerRow({ customer }: { customer: AdminCustomerSummary }) {
  return (
    <tr className='border-t'>
      <td className={`${TD} font-medium`}>
        <Link href={`/customers/${customer.id}`} className='hover:underline'>
          {customer.name}
        </Link>
      </td>
      <td className={`${TD} text-muted-foreground`}>{customer.email}</td>
      <td className={`${TD} text-muted-foreground`}>{customer.phone ?? '—'}</td>
      <td className={TD}>
        <span className='bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
          {TIER_LABEL[customer.tier]}
        </span>
      </td>
      <td className={`${TD} text-muted-foreground`}>{formatCustomerDate(customer.createdAt)}</td>
    </tr>
  );
}

export function CustomersTable({ customers }: { customers: AdminCustomerSummary[] }) {
  if (customers.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
        目前沒有符合條件的客戶。
      </div>
    );
  }

  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>姓名</th>
            <th className={TH}>Email</th>
            <th className={TH}>電話</th>
            <th className={TH}>會員等級</th>
            <th className={TH}>註冊日期</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <CustomerRow key={customer.id} customer={customer} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
