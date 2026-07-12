import type { AdminCustomerFilter } from '@pcm/domain';
import { SelectFilter } from '../shared/select-filter';
import { TIER_OPTIONS, TIER_PARAM } from '../../lib/customers/customer-list-view';

// M-4a 客戶管理第一片:tier 下拉篩選(server-render、native form GET;無 client JS)。
// 送出 → 瀏覽器組 query string 導回 /customers → server 重讀 searchParams 重查(page 天然回 1)。

export function CustomerFilterBar({ filter }: { filter: AdminCustomerFilter }) {
  return (
    <form
      method='get'
      action='/customers'
      className='flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 text-card-foreground'
    >
      <SelectFilter
        name={TIER_PARAM}
        label='會員等級'
        value={filter.tier}
        options={TIER_OPTIONS}
      />
      <div className='flex items-center gap-2'>
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
        >
          篩選
        </button>
        <a
          href='/customers'
          className='border-input text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md border px-4 text-sm'
        >
          清除
        </a>
      </div>
    </form>
  );
}
