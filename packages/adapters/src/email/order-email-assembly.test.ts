import { describe, it, expect } from 'vitest';

import {
  buildOrderCreatedPayload,
  orderCreatedSubject,
  ORDER_CREATED_EVENT_VERSION,
} from './order-email-assembly';

describe('buildOrderCreatedPayload(REQUIRED-E1b 組裝層)', () => {
  it('payload = 顯式三欄 allowlist(event_version/display_id/paid_at),恰好、不多不少', () => {
    const payload = buildOrderCreatedPayload({
      displayId: 'PCM-2026-0001',
      paidAt: '2026-07-17T02:00:00Z',
    });
    expect(payload).toEqual({
      event_version: ORDER_CREATED_EVENT_VERSION,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-07-17T02:00:00Z',
    });
    expect(Object.keys(payload).sort()).toEqual(['display_id', 'event_version', 'paid_at']);
  });

  it('🔴 負向:來源偷渡 PII(email/phone/address/巢狀物件)→ 物理上到不了 payload', () => {
    const dirty = {
      displayId: 'PCM-2026-0001',
      paidAt: '2026-07-17T02:00:00Z',
      email: 'leak@example.com',
      customerPhone: '0912345678',
      shipping: { address: '台北市中山區', phone: '0987654321' },
    } as unknown as { displayId: string; paidAt: string };
    const payload = buildOrderCreatedPayload(dirty);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('leak@example.com');
    expect(json).not.toContain('0912345678');
    expect(json).not.toContain('台北市');
    expect(json).not.toContain('0987654321');
    expect(Object.keys(payload)).toHaveLength(3);
  });

  it('🔴 runtime 型別檢查:非字串/空字串 → throw,且錯誤訊息不含值(值可能是 PII)', () => {
    expect(() =>
      buildOrderCreatedPayload({ displayId: '', paidAt: '2026-07-17T02:00:00Z' }),
    ).toThrow('displayId');
    expect(() =>
      buildOrderCreatedPayload({
        displayId: { phone: '0912345678' } as unknown as string,
        paidAt: '2026-07-17T02:00:00Z',
      }),
    ).toThrow('displayId');
    try {
      buildOrderCreatedPayload({
        displayId: { secret: '0912345678' } as unknown as string,
        paidAt: '2026-07-17T02:00:00Z',
      });
      expect.unreachable('非字串 displayId 應 throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('0912345678');
    }
  });
});

describe('orderCreatedSubject(固定模板)', () => {
  it('唯一動態欄 = display_id;L2 佔位字面、E3 定案給 Sean 過目', () => {
    const subject = orderCreatedSubject('PCM-2026-0001');
    expect(subject).toContain('PCM-2026-0001');
    expect(subject).toBe('PCM 訂單 PCM-2026-0001 付款成功通知');
  });
});
