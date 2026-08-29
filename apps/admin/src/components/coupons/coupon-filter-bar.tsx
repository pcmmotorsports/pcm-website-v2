import { AutoApplySubmit } from '../shared/auto-apply-submit';
import { SelectFilter } from '../shared/select-filter';
import {
  STATUS_PARAM,
  STATUS_LABEL,
  STATUS_VALUES,
  couponSortHiddenFields,
  type CouponSort,
  type CouponStatusParam,
} from '../../lib/coupons/coupon-list-view';

/**
 * 券列表的篩選列(server-render、native form GET、無 client JS)。
 *
 * 形狀逐支對齊 `customers/customer-filter-bar.tsx`。送出 → 瀏覽器組 query string 導回 `/coupons`
 * → server 重讀 searchParams 重查(page 天然回 1)。
 * 🔴 送出的**時機**由 `AutoApplySubmit` 接手 —— 那是 Sean 2026-08-19 對客戶頁拍的
 *    (「點選之後下方列表沒自動跳, 還要按篩選」), 而**本頁套的是同一顆**, 不是新做的。
 */

/** `all` 在 `SelectFilter` 是「不選」⇒ 只把另外兩個當選項, `allLabel` 給它。 */
const STATUS_OPTIONS = STATUS_VALUES.filter((v) => v !== 'all').map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}));

export function CouponFilterBar({
  statusParam,
  sort,
}: {
  statusParam: CouponStatusParam;
  /**
   * 🔴 目前的排序 —— **必填**(給 `undefined` 是「沒有排序」, 不是「不用管」)。
   *    GET 表單只送出自己的欄位 ⇒ 不把它渲染成 hidden, 改一次篩選就會把排序丟掉,
   *    **而畫面看起來完全正常**。
   */
  sort: CouponSort | undefined;
}) {
  return (
    <form
      method='get'
      action='/coupons'
      className='flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 text-card-foreground'
    >
      {/* 🔴 排序要原封帶過去。**不是裝飾** —— 少了這兩個 hidden,
          員工改一次狀態就會把自己排好的順序丟掉。 */}
      {Object.entries(couponSortHiddenFields(sort)).map(([k, v]) => (
        <input key={k} type='hidden' name={k} value={v} />
      ))}
      <SelectFilter
        name={STATUS_PARAM}
        label='狀態'
        value={statusParam === 'all' ? undefined : statusParam}
        options={STATUS_OPTIONS}
        allLabel={STATUS_LABEL.all}
      />
      <div className='flex items-center gap-2'>
        {/* 選了狀態就生效, 不必再按這顆(關掉 JS 時它照常在 —— 那是唯一的出口)。 */}
        <AutoApplySubmit
          label='篩選'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
        />
        <a
          href='/coupons'
          className='border-input text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md border px-4 text-sm'
        >
          清除
        </a>
      </div>
    </form>
  );
}
