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

const FILTER: AdminCustomerFilter = { tier: 'premiumStore' };
const SORT: AdminCustomerSort = { key: 'spend', ascending: false };

/** 表單真的會送出去的鍵(含 hidden)。 */
function submittedKeys(sort: AdminCustomerSort | undefined): Set<string> {
  const { container } = render(<CustomerFilterBar filter={FILTER} sort={sort} />);
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

describe('`#743` 客戶篩選表單 — 送得出去的鍵必須蓋住 builder 產得出的鍵', () => {
  it('前提:builder 在有排序時真的會產出 sort/dir(不然下面那條恆真)', () => {
    expect(builderKeys(SORT)).toEqual(new Set(['tier', 'sort', 'dir']));
  });

  it('🔴 有排序時,表單送得出 tier + sort + dir(少一個 = 改篩選就把排序丟掉)', () => {
    expect(submittedKeys(SORT)).toEqual(builderKeys(SORT));
  });

  it('沒有排序時不憑空多送鍵(對照組:hidden 只在有值時出現)', () => {
    expect(submittedKeys(undefined)).toEqual(builderKeys(undefined));
    expect(submittedKeys(undefined)).toEqual(new Set(['tier']));
  });

  it('hidden 的【值】與 builder 寫進網址的值逐字相同(不只鍵對上)', () => {
    const { container } = render(<CustomerFilterBar filter={FILTER} sort={SORT} />);
    const qs = new URLSearchParams(buildCustomerListHref(FILTER, 1, SORT).split('?')[1] ?? '');
    for (const key of ['sort', 'dir']) {
      const el = container.querySelector(`input[type="hidden"][name="${key}"]`);
      expect(el?.getAttribute('value')).toBe(qs.get(key));
    }
  });
});
