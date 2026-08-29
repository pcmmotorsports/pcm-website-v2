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

describe('擋住的理由 —— Sean 2026-08-29 拍【乙】：一顆標籤 +「+N」', () => {
  /**
   * 🛑 **這一組斷言【推翻了它自己的前一版】，而前一版是對的。**
   *
   * 舊斷言逐字：「一組原因 ⇒ 全部都在，不是只顯示第一個」——
   * 理由是：只顯示第一個 ⇒ 員工解掉它、券還是不能用（那正是 codex 駁倒「單一狀態」的理由）。
   * 🔴 **那個理由沒有錯，而 Sean 選了另一個解法**：
   *    乙 顯示第一個 **+ 一個數字** ⇒ 「還差幾關」由 `+N` 回答，不是由名字回答。
   * ⇒ 所以下面那一格盯的是 **`+N` 在不在**，而不只是「第一個標籤在不在」——
   *    🔴 少了 `+N`，這一版就退回成被駁倒的那一版，而畫面上只差兩個字元。
   */
  it('🔴 兩個原因 ⇒ 顯示第一個標籤【而且】要有「+1」', () => {
    render(
      <CouponsTable
        coupons={[row({ coupon_level_blocks: ['disabled', 'expired'] })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('已停用').length).toBeGreaterThan(0);
    // 🔴 這一格是本組的重點：沒有它，「只顯示第一個」就是被駁倒的那個設計
    expect(screen.getAllByText('+1').length).toBeGreaterThan(0);
    // 而第二個原因的【名字】刻意不印 —— 那正是乙 的取捨
    expect(screen.queryByText('已過期')).toBeNull();
  });

  it('🔴 只有一個原因 ⇒ 不得出現「+0」', () => {
    // +0 會讓那個 0 看起來像一個原因，而它是「沒有其他原因」。
    render(
      <CouponsTable
        coupons={[row({ coupon_level_blocks: ['exhausted'] })]}
        statusParam='all'
        sort={undefined}
      />,
    );
    expect(screen.getAllByText('已用完').length).toBeGreaterThan(0);
    expect(screen.queryByText('+0')).toBeNull();
  });

  it('🔴 空陣列不得顯示「可用」', () => {
    render(
      <CouponsTable coupons={[row({ coupon_level_blocks: [] })]} statusParam='all' sort={undefined} />,
    );
    expect(screen.queryByText('可用')).toBeNull();
  });
});
