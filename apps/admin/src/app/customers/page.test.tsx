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

// ─────────────────────────────────────────────────────────────────────────────
// LINE 合成位址不顯示原字串 —— **頁級**證據(Sean 2026-08-16 拍板乙)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 **為什麼函式級補不到這裡**:`customerEmailDisplay()` 算得對,**不代表這一頁接了它**。
//    有人把 `customers-table.tsx` 那格改回 `cell: (c) => c.email`,單測那族**一格都不會紅**。
//    這一格釘的是「這個畫面用的是哪一個來源」。
describe('/customers 列表:LINE 合成位址不外顯', () => {
  const row = (email: string) => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: '測試客戶',
    email,
    phone: null,
    tier: 'general' as const,
    createdAt: '2026-08-01T00:00:00Z',
  });

  it('🔴 合成位址 → 畫面顯示替代字面,原字串不出現', async () => {
    mocks.list.mockResolvedValue({
      items: [row('line_u5877604cab5e67badac879d777bf702e@line.pcmmotorsports.local')],
      total: 1,
    });
    const { container } = render(await CustomersPage({ searchParams: Promise.resolve({}) }));
    expect(container.textContent).toContain('LINE 帳號登入,無 Email');
    expect(container.textContent).not.toContain('line_u');
    expect(container.textContent).not.toContain('pcmmotorsports.local');
  });

  // 正向對照:真 Email 照樣顯示 ⇒ 上一格不是因為「這頁根本不顯示 Email」而過。
  it('真 Email 仍原樣顯示(正向對照)', async () => {
    mocks.list.mockResolvedValue({ items: [row('sean@example.com')], total: 1 });
    const { container } = render(await CustomersPage({ searchParams: Promise.resolve({}) }));
    expect(container.textContent).toContain('sean@example.com');
  });
});
