// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminCustomerSummary } from '@pcm/domain';
import { CustomersTable } from './customers-table';

// customers-table-sort.test.tsx — 排序欄頭與 `aria-sort`(2026-08-19)。
//
// 🔴 **為什麼斷在 `<th>` 上而不是斷 helper 的回傳值**:
//    helper 算對了、而沒有接到 `<th>` 上,讀屏使用者一樣聽不到 —— **而只測 helper 會全綠。**
//    (同族於今晚那條:「字面守門只能證明 code 裡有這段字,證不了這段字做對了事」。)

afterEach(cleanup);

const ROWS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: '甲',
    email: 'a@example.com',
    phone: null,
    tier: 'general',
    createdAt: '2026-08-01T00:00:00Z',
    activeOrderCount: 3,
    activeSpendTotal: { amount: 100, currency: 'TWD' },
    lastActiveOrderedAt: null,
  },
] as unknown as AdminCustomerSummary[];

const ths = (c: HTMLElement) =>
  [...c.querySelectorAll('thead th')].map((th) => ({
    text: (th.textContent ?? '').trim(),
    sort: th.getAttribute('aria-sort'),
    link: !!th.querySelector('a'),
  }));

describe('客戶表 · 排序欄頭與 aria-sort', () => {
  it('🔴 沒排序時:三個數字欄 aria-sort="none"、其餘五欄【完全沒有這個屬性】', () => {
    const { container } = render(<CustomersTable customers={ROWS} filter={{}} sort={undefined} />);
    const rows = ths(container);
    const sortable = rows.filter((r) => r.sort !== null);
    // 正向:恰好三欄可排序
    expect(sortable.map((r) => r.text)).toEqual(['訂單數', '消費金額', '最後下單']);
    expect(sortable.every((r) => r.sort === 'none')).toBe(true);
    // 🔴 負向對照:其餘五欄【不得】有 aria-sort ——
    //    對不能排序的欄說 "none" 的意思是「可以排序，只是現在沒排」，那是一句假話。
    expect(rows.filter((r) => r.sort === null).map((r) => r.text)).toEqual([
      '姓名',
      'Email',
      '電話',
      '會員等級',
      '註冊日期',
    ]);
  });

  it('🔴 排序中的那一欄要報方向,而其他兩個可排序欄仍是 none', () => {
    const { container } = render(
      <CustomersTable customers={ROWS} filter={{}} sort={{ key: 'spend', ascending: false }} />,
    );
    const byText = Object.fromEntries(ths(container).map((r) => [r.text.replace(/[↑↓\s]/g, ''), r.sort]));
    expect(byText['消費金額']).toBe('descending');
    expect(byText['訂單數']).toBe('none');
    expect(byText['最後下單']).toBe('none');
  });

  it('🔴 升冪要報 ascending —— 兩個方向都要能分辨', () => {
    const { container } = render(
      <CustomersTable customers={ROWS} filter={{}} sort={{ key: 'lastOrder', ascending: true }} />,
    );
    const byText = Object.fromEntries(ths(container).map((r) => [r.text.replace(/[↑↓\s]/g, ''), r.sort]));
    expect(byText['最後下單']).toBe('ascending');
  });

  it('🔴 只有那三欄是連結 —— 其餘欄頭不得變成可點的東西', () => {
    const { container } = render(<CustomersTable customers={ROWS} filter={{}} sort={undefined} />);
    const linked = ths(container).filter((r) => r.link).map((r) => r.text);
    expect(linked).toEqual(['訂單數', '消費金額', '最後下單']);
  });

  it('🔴 箭頭只出現在【正在排的那一欄】—— 每欄都掛一個的話,「照哪一欄排」就從畫面上消失了', () => {
    const { container } = render(
      <CustomersTable customers={ROWS} filter={{}} sort={{ key: 'orders', ascending: true }} />,
    );
    const withArrow = ths(container).filter((r) => /[↑↓]/.test(r.text));
    expect(withArrow).toHaveLength(1);
    expect(withArrow[0]?.text).toContain('訂單數');
    expect(withArrow[0]?.text).toContain('↑');
  });
});
