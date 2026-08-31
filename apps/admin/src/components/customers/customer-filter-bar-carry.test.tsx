// @vitest-environment jsdom
// customer-filter-bar-carry.test.tsx — `#743`:篩選表單不得把排序丟掉。
//
// 🔴🔴 **本族守的是一個【跨兩個檔】的契約,而那種契約沒有型別看得住**:
//    `buildCustomerListHref` 決定「網址上有哪些鍵」,而 `<form method='get'>`
//    決定「送出時哪些鍵活得下來」。**GET 表單只送出自己的欄位** ——
//    網址上有、而表單裡沒有的鍵,一律在下一次送出時消失。
//
// 🔴 **而症狀不是「壞掉」,是【畫面自洽】**:排序沒了,欄頭箭頭也跟著沒了(箭頭從網址推)
//    ⇒ 看起來就像「我本來就沒有排序」⇒ 員工不會回報,他會重排一次。**每天多做一個動作,而沒有人抱怨。**

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { AdminCustomerFilter, AdminCustomerSort } from '@pcm/domain';
import { CustomerFilterBar } from './customer-filter-bar';
import { buildCustomerListHref } from '../../lib/customers/customer-list-view';

afterEach(cleanup);

// 🔴🔴 **每一個常駐輸入框對應的軸, 這裡都要有值**(2026-08-26 R1 must-fix 2):
//    放寬成「蓋住」之後, 若 FILTER 只有 tier, `builderKeys()` 就永遠產不出 `agemin`
//    ⇒ **「表單送得出 agemin」與「builder 產得出 agemin」之間沒有任何一格把它們接起來**
//    ⇒ 而那正是上一版真的壞掉的那一軸(翻頁把年齡丟掉), 舊的 toEqual 本來會抓到它。
//    ⇒ **放寬要留, 反向要補回來。** 這一行就是那個補回來。
const FILTER: AdminCustomerFilter = {
  tier: 'premiumStore',
  birthMonth: 7,
  ageMin: 30,
  ageMax: 40,
  // 🔴 `:573` 段③。**照上面那條 must-fix 補的**:性別下拉在 `showGender` 開著時是常駐輸入框
  //    ⇒ 這裡不給值的話,「表單送得出 gender」與「builder 產得出 gender」之間**又沒有橋**,
  //    而那正是這支檔存在的理由。
  gender: 'female',
};
const SORT: AdminCustomerSort = { key: 'spend', ascending: false };

/** 表單真的會送出去的鍵(含 hidden)。 */
function submittedKeys(sort: AdminCustomerSort | undefined): Set<string> {
  const { container } = render(<CustomerFilterBar filter={FILTER} sort={sort} ageInputs={{ swapped: false }} showGender />);
  const names = [...container.querySelectorAll('[name]')].map((el) => el.getAttribute('name') ?? '');
  cleanup();
  return new Set(names.filter(Boolean));
}

/** `buildCustomerListHref` 產得出的鍵(扣掉 `page` —— 改篩選本來就該回第 1 頁)。 */
function builderKeys(sort: AdminCustomerSort | undefined): Set<string> {
  const qs = buildCustomerListHref(FILTER, 3, sort).split('?')[1] ?? '';
  const keys = new Set([...new URLSearchParams(qs).keys()]);
  keys.delete('page');
  return keys;
}

/** 常駐輸入框:一定會被渲染, 因此空值時也會送出 `key=`(GET 表單的正常行為)。 */
// ⚠️ **`gender` 在這裡算常駐, 而那是【本檔 harness 的條件】不是元件的性質** ——
//    本檔每一次 render 都傳 `showGender`(見 `submittedKeys`), 而正式頁面上它由
//    部署順序閘決定(`lib/customers/gender-filter-flag.ts`)。
//    ⇒ 🔴 **「旗標關掉時它不出現」不歸本檔驗** —— 那一格在
//      `customer-gender-filter-flag.test.tsx`。寫在這裡, 是因為讀到這一行的人
//      很容易把「它在 ALWAYS_RENDERED 裡」讀成「它永遠都在」。
const ALWAYS_RENDERED = ['tier', 'gender', 'bmonth', 'agemin', 'agemax'] as const;

describe('`#743` 客戶篩選表單 — 送得出去的鍵必須蓋住 builder 產得出的鍵', () => {
  it('前提:builder 在有排序時真的會產出 sort/dir(不然下面那條恆真)', () => {
    expect(builderKeys(SORT)).toEqual(
      new Set(['tier', 'gender', 'bmonth', 'agemin', 'agemax', 'sort', 'dir']),
    );
  });

  // 🔴🔴 **2026-08-26 這一族從【相等】改成【蓋住】, 而那不是為了讓它變綠**:
  //    契約的字面(本檔標題)一直都是「**蓋住**」, 而上一版寫成 `toEqual` ——
  //    它之所以一直成立, 是因為當時表單裡**恰好只有 `tier` 一顆常駐輸入框**,
  //    而測試用的 FILTER 又剛好有 tier 值 ⇒ **兩邊碰巧相等。**
  //    ⇒ 生日兩軸加進來(三顆常駐輸入框)之後, 空值時表單會送 `bmonth=` 這種空鍵
  //      ⇒ **表單的鍵天生就會比 builder 多**, 而那不是缺陷, 是 GET 表單的正常行為。
  //    📌 **判別句:契約說的是「蓋住」, 而斷言寫成「相等」—— 那是一道【比契約更緊】的守門。**
  //       更緊的守門在契約沒變的情況下會紅, 而讀的人會以為契約破了。
  it('🔴 有排序時,表單的鍵【蓋住】builder 的鍵(少一個 = 改篩選就把排序丟掉)', () => {
    const submitted = submittedKeys(SORT);
    for (const key of builderKeys(SORT)) {
      expect(submitted, `builder 產得出 \`${key}\` 而表單送不出去`).toContain(key);
    }
  });

  it('🔴 沒有排序時, hidden 的 sort/dir 不憑空出現(對照組 —— 沒有它上面那條就是恆真)', () => {
    const submitted = submittedKeys(undefined);
    expect(submitted.has('sort')).toBe(false);
    expect(submitted.has('dir')).toBe(false);
    // 而常駐輸入框仍然在 —— 它們不隨排序有無而變
    for (const key of ALWAYS_RENDERED) expect(submitted).toContain(key);
  });

  it('🔴 常駐輸入框【每一顆都在】—— 少一顆 = 那一軸的篩選翻頁就會丟掉', () => {
    // 這一格取代上一版的 `toEqual(new Set(['tier']))`:
    // 那個寫法把「表單裡有哪些欄位」釘死成一份清單 ⇒ 每加一個篩選軸就要改它一次,
    // 而改它的人只會把新名字加進去, 不會去想「這一軸的值翻頁時帶不帶得過去」。
    const submitted = submittedKeys(SORT);
    for (const key of ALWAYS_RENDERED) {
      expect(submitted, `表單缺少常駐輸入框 \`${key}\``).toContain(key);
    }
  });

  it('hidden 的【值】與 builder 寫進網址的值逐字相同(不只鍵對上)', () => {
    const { container } = render(<CustomerFilterBar filter={FILTER} sort={SORT} ageInputs={{ swapped: false }} showGender />);
    const qs = new URLSearchParams(buildCustomerListHref(FILTER, 1, SORT).split('?')[1] ?? '');
    for (const key of ['sort', 'dir']) {
      const el = container.querySelector(`input[type="hidden"][name="${key}"]`);
      expect(el?.getAttribute('value')).toBe(qs.get(key));
    }
  });
});
