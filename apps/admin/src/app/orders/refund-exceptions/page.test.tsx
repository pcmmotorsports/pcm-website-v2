// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RefundExceptionRow } from '../../../lib/payment/refund-read';

// M-3 A7c RW3:退款異常清單頁(RW4 前置 UI;唯讀)。
// refund-read transitively 拉 server-only ⇒ 整支 mock(refund-wiring.test.tsx 同紀律)。

const mocks = vi.hoisted(() => ({ listRefundExceptions: vi.fn() }));
vi.mock('../../../lib/payment/refund-read', () => ({
  listRefundExceptions: mocks.listRefundExceptions,
}));

import RefundExceptionsPage from './page';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function exceptionRow(over: Partial<RefundExceptionRow> = {}): RefundExceptionRow {
  return {
    id: 'r-1',
    kind: 'partial',
    status: 'processing',
    refundAmount: 100,
    reason: '缺貨退款',
    actor: 'sean',
    createdAt: '2026-08-04T03:00:00+00:00',
    failedReason: null,
    failedDetail: null,
    providerEvidence: null,
    orderId: ORDER_ID,
    orderDisplayId: 'PCM-2026-0001',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage() {
  return render(await RefundExceptionsPage());
}

describe('/orders/refund-exceptions — RW3', () => {
  it('[1] 空清單 → 空態;頁面明寫勿重複發起', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [], truncated: false });
    const { container } = await renderPage();
    expect(container.textContent).toContain('目前沒有滯留的退款');
    expect(container.textContent).toContain('勿重複發起');
  });

  it('[2] 列渲染:訂單連結回明細頁、金額、證據標示', async () => {
    mocks.listRefundExceptions.mockResolvedValue({
      rows: [exceptionRow(), exceptionRow({ id: 'r-2', providerEvidence: 'DR999', refundAmount: 4500 })],
      truncated: false,
    });
    const { container } = await renderPage();
    const link = container.querySelector(`a[href="/orders/${ORDER_ID}"]`);
    expect(link?.textContent).toBe('PCM-2026-0001');
    expect(container.textContent).toContain('4,500');
    // 證據列=G7-hold 優先處理;無證據列=滯留逾時。兩種標示都要在。
    expect(container.textContent).toContain('TapPay 已受理,優先處理');
    expect(container.textContent).toContain('無(滯留逾時)');
  });

  it('[2b] 截斷旗標 → 顯「較新的異常未列出」橫幅(codex MF1)', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [exceptionRow()], truncated: true });
    const { container } = await renderPage();
    expect(container.textContent).toContain('較新的異常未列出');
  });

  it('[3] 讀取失敗 → 錯誤態 200(不 500、不靜默)', async () => {
    mocks.listRefundExceptions.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.textContent).toContain('清單載入失敗');
  });

  it('[4] 🔴 措辭鐵律同頁適用:不得出現「還能退」「剩餘可退」', async () => {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [exceptionRow()], truncated: false });
    const { container } = await renderPage();
    expect(container.textContent).not.toContain('還能退');
    expect(container.textContent).not.toContain('剩餘可退');
  });
});
