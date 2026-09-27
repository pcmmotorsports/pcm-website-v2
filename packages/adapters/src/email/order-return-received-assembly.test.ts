import { describe, it, expect } from 'vitest';

import {
  buildOrderReturnReceivedPayload,
  orderReturnReceivedSubject,
  ORDER_RETURN_RECEIVED_EVENT_VERSION,
} from './order-email-assembly';

// 退貨收回通知(Sean 2026-09-27 A3 甲甲甲):payload 只帶訂單號、退貨編號、收回時間、實收品項 —— 不帶金額、不帶商品狀況。
const SRC = {
  displayId: 'PCM-2026-9003',
  returnId: 'c1a1b2c3-0000-4000-8000-000000000001',
  receivedAt: '2026-09-27T10:00:00Z',
  receivedItems: [
    { title: '煞車拉桿組', quantity: 1 },
    { title: '  ', quantity: 2 },
  ],
};

describe('buildOrderReturnReceivedPayload', () => {
  it('payload 欄位恰好五欄;空白品名轉 null', () => {
    const p = buildOrderReturnReceivedPayload(SRC);
    expect(p).toEqual({
      display_id: 'PCM-2026-9003',
      return_id: 'c1a1b2c3-0000-4000-8000-000000000001',
      received_at: '2026-09-27T10:00:00Z',
      received_items: [
        { title: '煞車拉桿組', quantity: 1 },
        { title: null, quantity: 2 },
      ],
      event_version: ORDER_RETURN_RECEIVED_EVENT_VERSION,
    });
  });

  it('🔴 fail-closed:實收品項為空(或全是 0 件)⇒ throw 不排', () => {
    expect(() => buildOrderReturnReceivedPayload({ ...SRC, receivedItems: [] })).toThrow();
    expect(() => buildOrderReturnReceivedPayload({ ...SRC, receivedItems: [{ title: 'x', quantity: 0 }] })).toThrow();
  });

  it('🔴 fail-closed:訂單號 / 退貨編號 / 收回時間空白 ⇒ throw', () => {
    expect(() => buildOrderReturnReceivedPayload({ ...SRC, displayId: '' })).toThrow();
    expect(() => buildOrderReturnReceivedPayload({ ...SRC, returnId: ' ' })).toThrow();
    expect(() => buildOrderReturnReceivedPayload({ ...SRC, receivedAt: '' })).toThrow();
  });
});

describe('orderReturnReceivedSubject', () => {
  it('主旨照 Sean Q3 甲的草稿逐字', () => {
    expect(orderReturnReceivedSubject('PCM-2026-9003')).toBe('我們已收到您寄回的商品（訂單 PCM-2026-9003）');
  });
});
