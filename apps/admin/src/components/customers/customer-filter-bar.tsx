import type { AdminCustomerFilter, AdminCustomerSort } from '@pcm/domain';
import { AutoApplySubmit } from '../shared/auto-apply-submit';
import { SelectFilter } from '../shared/select-filter';
import {
  TIER_OPTIONS,
  TIER_PARAM,
  BIRTH_MONTH_OPTIONS,
  BIRTH_MONTH_PARAM,
  GENDER_OPTIONS,
  GENDER_PARAM,
  AGE_MIN_PARAM,
  AGE_MAX_PARAM,
  AGE_MIN_ALLOWED,
  AGE_MAX_ALLOWED,
  customerSortHiddenFields,
} from '../../lib/customers/customer-list-view';

// M-4a 客戶管理第一片:tier 下拉篩選(server-render、native form GET;無 client JS)。
// 送出 → 瀏覽器組 query string 導回 /customers → server 重讀 searchParams 重查(page 天然回 1)。
// 🔴 送出的**時機**由 `AutoApplySubmit` 接手(Sean 2026-08-19:「點選會員等級後,下方列表沒自動跳,
//    還要按篩選」)—— 表單本身一個字沒改,商品頁那張表單套的是同一顆。

export function CustomerFilterBar({
  filter,
  sort,
  ageInputs,
  showGender,
}: {
  filter: AdminCustomerFilter;
  /**
   * 🔴 `#743`:目前的排序 —— **必填**(給 `undefined` 是「沒有排序」,不是「不用管」)。
   *    GET 表單只送出自己的欄位 ⇒ 不把它渲染成 hidden,改一次篩選就會把排序丟掉。
   *    值怎麼算在 `customerSortHiddenFields`(與 `buildCustomerListHref` 共用同一份對照)。
   */
  sort: AdminCustomerSort | undefined;
  /**
   * 年齡輸入框的回填值 + 「上下界打反了」的訊號(來自 `parseCustomerListSearchParams`)。
   * 🔴 **不是從 `filter` 反推** —— `filter` 裡存的是換算後的**日期**,反推回年齡會在
   *    生日當天差一歲, 而畫面上看不出來。
   */
  ageInputs: { min?: number; max?: number; swapped: boolean };
  /**
   * 段③ 性別下拉要不要出現。**必填,不給預設** ——
   * 🔴 給了 `= true` 的預設就等於「忘了傳 ⇒ 下拉自己冒出來」,
   *    而那正是這顆閘要防的那件事。⇒ 忘了傳 ⇒ **typecheck 紅**,不是靜靜地開。
   */
  showGender: boolean;
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
      {/* 生日月份(Sean 2026-08-26 `e:丙` 的第一半:這個月生日的客人)。
          🔴 是【12 個月下拉】不是一顆「本月」開關 —— 理由見 `AdminCustomerFilter.birthMonth`
             的 docstring:一顆「本月」需要伺服器知道今天是幾月,而伺服器跑 UTC
             ⇒ 台灣時間每月 1 號凌晨會印出一份【上個月的名單】而看起來完全正常。 */}
      <SelectFilter
        name={BIRTH_MONTH_PARAM}
        label='生日月份'
        value={filter.birthMonth === undefined ? undefined : String(filter.birthMonth)}
        options={BIRTH_MONTH_OPTIONS}
        allLabel='不限'
      />
      {/* 性別(`:573` 段③)。
          🔴 **整顆下拉由部署順序閘控制**(`genderFilterEnabled()`)—— view 上還沒有
             `gender` 欄的期間它不算繪。理由與「忘記的時候會發生什麼」寫在
             `lib/customers/gender-filter-flag.ts` 檔頭。
          ⚠️ 而**這一格與 `page.tsx` 那道抹除是【兩件事】** —— 兩邊呼叫同一支函式
             不等於兩邊綁在一起;綁住它們的是 `customer-gender-filter-flag.test.tsx`。
          🔵 標籤用 `@pcm/schemas` 的 `GENDER_LABEL`(註冊表單用的同一份),不自訂字。 */}
      {showGender ? (
        <SelectFilter
          name={GENDER_PARAM}
          label='性別'
          value={filter.gender}
          options={GENDER_OPTIONS}
          allLabel='不限'
        />
      ) : null}
      {/* 年齡區間(`e:丙` 的第二半)。原生 number input、無 client JS,與整張表單同一次 GET 送出。 */}
      <label className='flex flex-col gap-1 text-sm'>
        <span className='text-muted-foreground text-xs font-medium'>年齡</span>
        <span className='flex items-center gap-1'>
          <input
            type='number'
            name={AGE_MIN_PARAM}
            defaultValue={ageInputs.min ?? ''}
            min={AGE_MIN_ALLOWED}
            max={AGE_MAX_ALLOWED}
            placeholder='不限'
            aria-label='年齡下限'
            className='border-input bg-background h-9 w-20 rounded-md border px-2 text-sm'
          />
          <span className='text-muted-foreground text-xs'>到</span>
          <input
            type='number'
            name={AGE_MAX_PARAM}
            defaultValue={ageInputs.max ?? ''}
            min={AGE_MIN_ALLOWED}
            max={AGE_MAX_ALLOWED}
            placeholder='不限'
            aria-label='年齡上限'
            className='border-input bg-background h-9 w-20 rounded-md border px-2 text-sm'
          />
        </span>
        {/* 🔴 打反了要**說出來**, 不要靜靜地當成沒填 ——
            靜靜忽略的話,「這個條件沒有人」與「你打反了」在畫面上長得一樣。 */}
        {ageInputs.swapped ? (
          <span className='text-destructive text-xs'>下限比上限大,這一格先當成不限</span>
        ) : null}
      </label>
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
