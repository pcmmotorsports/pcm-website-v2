// @vitest-environment jsdom
// Sean 2026-09-27 G1 甲:「改價待審」清單頁(首頁那一格點進來)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ listPendingAmountRequests: vi.fn() }));
vi.mock('../../../lib/orders/amount-request-repository', () => ({
  listPendingAmountRequests: mocks.listPendingAmountRequests,
}));

import AmountRequestsPage from './page';

const ROW = {
  id: 'r1',
  orderId: '11111111-2222-3333-4444-555555555555',
  orderDisplayId: 'PCM-2026-1234',
  itemTitle: '煞車拉桿組',
  fromUnitPrice: 3000,
  toUnitPrice: 2500,
  reason: '客人議價',
  requestedBy: 'staff_01',
  requestedAt: '2026-09-27T01:00:00Z',
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('改價待審清單頁', () => {
  it('列出每一筆待審:訂單編號連到該單、品項、原單價 → 申請單價、原因、申請人', async () => {
    mocks.listPendingAmountRequests.mockResolvedValue({ rows: [ROW], truncated: false });
    render(await AmountRequestsPage());
    expect(screen.getByRole('heading', { name: '改價待審' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'PCM-2026-1234' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/orders/11111111-2222-3333-4444-555555555555');
    expect(screen.getByText('煞車拉桿組')).toBeTruthy();
    expect(screen.getByText('NT$ 3,000 → NT$ 2,500')).toBeTruthy();
    expect(screen.getByText('客人議價')).toBeTruthy();
    expect(screen.getByText('staff_01')).toBeTruthy();
  });

  it('沒有待審:說明沒有, 不是讀不到', async () => {
    mocks.listPendingAmountRequests.mockResolvedValue({ rows: [], truncated: false });
    render(await AmountRequestsPage());
    expect(screen.getByText('目前沒有待審的改價申請。')).toBeTruthy();
  });

  it('讀不到:說明載入失敗與下一步, 不印成「沒有」', async () => {
    mocks.listPendingAmountRequests.mockRejectedValue(new Error('boom'));
    render(await AmountRequestsPage());
    expect(screen.getByText('改價申請載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。')).toBeTruthy();
    expect(screen.queryByText('目前沒有待審的改價申請。')).toBeNull();
  });
});
