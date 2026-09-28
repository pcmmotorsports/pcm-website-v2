// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Customer } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { CustomerDetail } from './customer-detail';

// Sean 2026-09-29 Q2 甲:客人帳號停用後, 儲值金「加值／扣款」與「變更等級」都不能按, 旁邊說明要先恢復。
// 斷言看的是【瀏覽器眼中的 :disabled】(fieldset 停用會連帶停用裡面每一顆), 不是某個 prop。

const customer: Customer = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'a@example.com',
  name: '測試客戶',
  phone: '0912345678',
  birthday: null,
  gender: null,
  tier: 'general',
  walletBalance: 500,
  totalDeposit: 500,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

function renderDetail(memberDisabled: boolean) {
  return render(
    <CustomerDetail
      customer={customer}
      walletEntries={[]}
      walletLoadFailed={false}
      walletTotal={0}
      walletPage={1}
      orders={[]}
      ordersLoadFailed={false}
      addresses={[]}
      addressesLoadFailed={false}
      vehicles={[]}
      vehiclesLoadFailed={false}
      memberDisabled={memberDisabled}
    />,
  );
}

/** 儲值金卡與會員等級卡裡的每一個可操作欄位與按鈕。 */
function cardControls(heading: string): Element[] {
  const card = screen.getByRole('heading', { name: heading }).closest('section');
  if (!card) throw new Error(`找不到「${heading}」那張卡`);
  return [...card.querySelectorAll('button, input:not([type=hidden]), select, textarea')];
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('客戶明細:帳號停用時鎖住加值／扣款與變更等級', () => {
  it('🔴 已停用 ⇒ 兩張卡裡每一顆按鈕與欄位都是 :disabled, 並說明恢復後才能操作', () => {
    renderDetail(true);
    for (const heading of ['儲值金 目前餘額', '會員等級']) {
      const controls = cardControls(heading);
      expect(controls.length, `${heading} 卡裡應該有按鈕`).toBeGreaterThan(0);
      for (const c of controls) expect(c.matches(':disabled'), `${heading}:${c.outerHTML.slice(0, 80)}`).toBe(true);
    }
    expect(screen.getAllByText('帳號已停用，恢復後才能操作。')).toHaveLength(2);
  });

  it('🔵 負對照:未停用 ⇒ 按鈕可以按, 也不出現那句說明', () => {
    renderDetail(false);
    for (const heading of ['儲值金 目前餘額', '會員等級']) {
      const buttons = cardControls(heading).filter((c) => c.tagName === 'BUTTON');
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) expect(b.matches(':disabled')).toBe(false);
    }
    expect(screen.queryByText('帳號已停用，恢復後才能操作。')).toBeNull();
  });
});
