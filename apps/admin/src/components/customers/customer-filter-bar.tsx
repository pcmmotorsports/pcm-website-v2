import type { AdminCustomerFilter, AdminCustomerSort } from '@pcm/domain';
import { AutoApplySubmit } from '../shared/auto-apply-submit';
import { SelectFilter } from '../shared/select-filter';
import {
  TIER_OPTIONS,
  TIER_PARAM,
  customerSortHiddenFields,
} from '../../lib/customers/customer-list-view';

// M-4a 客戶管理第一片:tier 下拉篩選(server-render、native form GET;無 client JS)。
// 送出 → 瀏覽器組 query string 導回 /customers → server 重讀 searchParams 重查(page 天然回 1)。
// 🔴 送出的**時機**由 `AutoApplySubmit` 接手(Sean 2026-08-19:「點選會員等級後,下方列表沒自動跳,
//    還要按篩選」)—— 表單本身一個字沒改,商品頁那張表單套的是同一顆。

export function CustomerFilterBar({
  filter,
  sort,
}: {
  filter: AdminCustomerFilter;
  /**
   * 🔴 `#743`:目前的排序 —— **必填**(給 `undefined` 是「沒有排序」,不是「不用管」)。
   *    GET 表單只送出自己的欄位 ⇒ 不把它渲染成 hidden,改一次篩選就會把排序丟掉。
   *    值怎麼算在 `customerSortHiddenFields`(與 `buildCustomerListHref` 共用同一份對照)。
   */
  sort: AdminCustomerSort | undefined;
}) {
  return (
    <form
      method='get'
      action='/customers'
      className='flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 text-card-foreground'
    >
      {/* 🔴 `#743`:排序要原封帶過去。**不是裝飾** —— 少了這兩個 hidden,
          員工改一次會員等級就會把自己排好的順序丟掉,而畫面看起來完全正常。 */}
      {Object.entries(customerSortHiddenFields(sort)).map(([k, v]) => (
        <input key={k} type='hidden' name={k} value={v} />
      ))}
      <SelectFilter
        name={TIER_PARAM}
        label='會員等級'
        value={filter.tier}
        options={TIER_OPTIONS}
      />
      <div className='flex items-center gap-2'>
        {/* MAIN-063 C:選了會員等級就生效,不必再按這顆(關掉 JS 時它照常在)。 */}
        <AutoApplySubmit
          label='篩選'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
        />
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
