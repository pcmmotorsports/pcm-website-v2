// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
import { OrderInfoCards } from './order-detail-summary-cards';

// 2026-10-02(TFJ2B5):「出貨狀態」那格的小字。品項還沒下訂、也沒取消過 ⇒ 摘要列本來就不存在(A4a 惰性建立),
// 那是「都還是 0」不是「讀不到」⇒ 不得印「部分品項到貨數量無法計算」;真的讀不到(取消紀錄沒讀到)才印。
afterEach(cleanup);

function detail(over: Partial<AdminOrderDetail>): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    paymentStatus: 'paid',
    orderSource: 'manual_shopee',
    paymentChannel: 'cash',
    paymentInstrument: 'shopee',
    paidAt: null,
    customer: { name: '張澄浩', email: null, phone: '0912000111' },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    shopeeUsername: null,
    shopeeOrderNo: null,
    itemsTruncated: false,
    items: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        quantity: 1,
        quantitySummary: null,
        procurements: [],
        procurementTruncated: false,
      },
    ],
    ...over,
  } as unknown as AdminOrderDetail;
}

describe('OrderInfoCards 出貨狀態小字', () => {
  it('沒動過的品項(沒採購、沒取消)⇒ 不印「無法計算」', () => {
    const { container } = render(<OrderInfoCards detail={detail({ cancellations: [], cancellationsTruncated: false } as never)} />);
    expect(container.textContent).not.toContain('無法計算');
  });

  it('取消紀錄沒讀到 ⇒ 照實印「部分品項到貨數量無法計算」', () => {
    const { container } = render(<OrderInfoCards detail={detail({ cancellations: null, cancellationsTruncated: false } as never)} />);
    expect(container.textContent).toContain('部分品項到貨數量無法計算');
  });
});
