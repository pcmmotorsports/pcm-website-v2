// @vitest-environment jsdom
//
// 🔴 那一行不是裝飾:admin 那個 vitest project 沒有預設 DOM 環境
//    ⇒ 少了它, `render` 會 `ReferenceError: document is not defined` —— 我第一版就是這樣。
//    (家法:`customers-table-sort.test.tsx:1` 逐字同一行。)
/**
 * CouponsTable 的 smoke —— 而它只測【三件會壞而畫面看起來正常】的事。
 *
 * 🔴 不測「有沒有渲染出來」——那一格在壞掉的世界與對的世界印同一個綠。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CouponsTable } from './coupons-table';
import type { SupabaseAdminCouponRow } from '@pcm/adapters';

// 🔴 每一格自己收乾淨 —— 不收的話, 上一格渲染的 DOM 會留在下一格裡,
//    而 `getAllByText(...).length > 0` 這種斷言【會被上一格的殘留餵飽】⇒ 假綠。
afterEach(cleanup);

function row(over: Partial<SupabaseAdminCouponRow> = {}): SupabaseAdminCouponRow {
  return {
    id: 'id-1',
    code: 'SAVE10',
    description: '測試券',
    discount_type: 'fixed',
    discount_value: 100,
    ends_on: null,
    max_redemptions: null,
    max_per_account: null,
    min_spend: 0,
    stacks_with_tier: false,
    is_active: true,
    created_at: '2026-08-29T00:00:00Z',
    created_by: 'g_probe',
    creator_label: '線G 驗收',
    used_count: 0,
    coupon_level_blocks: [],
    ...over,
  };
}

describe('空狀態 —— 這一頁上線時表是空的，它是主要畫面不是邊角', () => {
  it('🔴 沒套篩選且零筆 ⇒「尚未建立」，不是「沒有符合條件」', () => {
    render(<CouponsTable coupons={[]} statusParam='all' sort={undefined} />);
    expect(screen.getByText('尚未建立任何優惠券。')).toBeTruthy();
  });

  it('套了篩選且零筆 ⇒「沒有符合條件」（負對照：兩句不得互換）', () => {
    render(<CouponsTable coupons={[]} statusParam='inactive' sort={undefined} />);
    expect(screen.getByText('目前沒有符合條件的優惠券。')).toBeTruthy();
    expect(screen.queryByText('尚未建立任何優惠券。')).toBeNull();
  });
});

describe('NULL 一律不留白 —— 留白與載入失敗長得一樣', () => {
  it('結束日 / 總量 / 建立者 三個 NULL 都有字', () => {
    render(
      <CouponsTable
        coupons={[row({ ends_on: null, max_redemptions: null, creator_label: null })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('不限期').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0 / 不限').length).toBeGreaterThan(0);
    // 建立者查不到 ⇒ '—'，不是空白
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('折抵 —— 兩種不能共用一個格式', () => {
  it('🔴 percent 不得被印成金額', () => {
    render(
      <CouponsTable
        coupons={[row({ discount_type: 'percent', discount_value: 10 })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('10%').length).toBeGreaterThan(0);
    expect(screen.queryByText('NT$ 10')).toBeNull();
  });

  it('fixed 印金額', () => {
    render(
      <CouponsTable
        coupons={[row({ discount_type: 'fixed', discount_value: 1500 })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('NT$ 1,500').length).toBeGreaterThan(0);
  });
});

describe('建立者 —— 顯示名字不是 slug', () => {
  it('🔴 印 creator_label，不得印 created_by 那個 slug', () => {
    render(
      <CouponsTable
        coupons={[row({ created_by: 'g_probe', creator_label: '線G 驗收' })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('線G 驗收').length).toBeGreaterThan(0);
    expect(screen.queryByText('g_probe')).toBeNull();
  });
});

describe('⏸️ 擋住的理由 —— 佔位（#963，Sean 未拍）', () => {
  it('一組原因 ⇒ 全部都在，不是只顯示第一個', () => {
    // 只顯示第一個 ⇒ 員工解掉它、券還是不能用 ⇒ 那正是 codex 駁倒單一狀態的理由
    render(
      <CouponsTable
        coupons={[row({ coupon_level_blocks: ['disabled', 'expired'] })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('已停用、已過期').length).toBeGreaterThan(0);
  });

  it('🔴 空陣列不得顯示「可用」', () => {
    render(
      <CouponsTable coupons={[row({ coupon_level_blocks: [] })]} statusParam='all' sort={undefined} />,
    );
    expect(screen.queryByText('可用')).toBeNull();
  });
});
