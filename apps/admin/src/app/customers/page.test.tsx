// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// repository getter 會拉 server-only 模組 ⇒ 整支 mock(同 `app/orders/page.test.tsx` 紀律)。
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/customers/customer-repository', () => ({
  getAdminCustomerRepository: () => ({ listCustomerSummariesForAdmin: mocks.list }),
}));
vi.mock('server-only', () => ({}));

import CustomersPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(search: Record<string, string> = {}) {
  mocks.list.mockResolvedValue({ items: [], total: 0 });
  return render(await CustomersPage({ searchParams: Promise.resolve(search) }));
}

// #365:儲值金 / 會員等級的失敗出口寫死 redirect('/customers?r=…')(wallet-actions.ts:33/:39、
// tier-actions.ts:35/:41)⇒ 所有 denied / invalid 都落在這一頁。這頁先前沒有橫幅 = 員工零交代。
describe('/customers 結果橫幅(#365)', () => {
  it('🔴 ?r=invalid → 畫面出現員工看得懂的中文,不是靜默', async () => {
    const { getByRole } = await renderPage({ r: 'invalid' });
    expect(getByRole('status').textContent).toContain('表單內容不正確');
  });

  it('🔴 ?r=denied → 同樣有交代(權限失敗也走這條路)', async () => {
    const { getByRole } = await renderPage({ r: 'denied' });
    expect(getByRole('status').textContent).not.toBe('');
  });

  // 🔴 負向對照:沒有這一格,上面兩條對「橫幅恆亮」也會是綠的 ⇒ 證不出 `?r=` 真的在驅動它。
  it('沒有 r 參數 → 不渲染橫幅(證明橫幅不是恆亮)', async () => {
    const { queryByRole } = await renderPage();
    expect(queryByRole('status')).toBeNull();
  });

  it('未知碼 → 不渲染橫幅(ResultBanner 的 Object.hasOwn 守門,#332-2)', async () => {
    const { queryByRole } = await renderPage({ r: '__proto__' });
    expect(queryByRole('status')).toBeNull();
  });
});
