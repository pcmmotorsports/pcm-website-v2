import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildOrderCreatedPayload,
  orderCreatedSubject,
  bankOrderCreatedSubject,
  ORDER_CREATED_EVENT_VERSION,
  ORDER_CREATED_SNAPSHOT_EVENT_VERSION,
  PAID_SNAPSHOT_TITLE_MAX_CHARS,
} from './order-email-assembly';
import type { PaidEmailContext } from '@pcm/ports';

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
  it('🔵 沒有快照 ⇒ 仍是 v1 三欄(今天的行為)', () => {
    expect(buildOrderCreatedPayload({ displayId: 'X', paidAt: 'Y' }).event_version).toBe(ORDER_CREATED_EVENT_VERSION);
  });
});

describe('orderCreatedSubject(固定模板)', () => {
  it('唯一動態欄 = display_id;L2 佔位字面、E3 定案給 Sean 過目', () => {
    const subject = orderCreatedSubject('PCM-2026-0001');
    expect(subject).toContain('PCM-2026-0001');
    expect(subject).toBe('PCM 訂單 PCM-2026-0001 付款成功通知');
  });
});

// ══════════════════════════════════════════════════════════════════
// ⟦b4-BANKNOEMAIL⟧ 主旨的鎖 —— **它住在產生它的那一側**(codex R1-#10)
// ══════════════════════════════════════════════════════════════════
// 🔴 為什麼在這裡而不是 sweep 那支測試:sweep 送的是 `job.subject`
//    (enqueue 當下就寫進 outbox 的那一份)⇒ 在那裡鎖它, **鎖到的是 fixture 不是碼**。
// 🛑 **改這格期望值 = 重設一道對外文案的鎖 ⇒ 需要授權**(同內文那一格)。
describe('bankOrderCreatedSubject:對外主旨的鎖', () => {
  it('🔴 主旨逐字 = Sean 核可的那一份(spec 檔對照, 不是手打副本)', () => {
    const spec = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'docs', 'specs', '2026-09-06-bank-order-created-email-copy.md'),
      'utf8',
    );
    const block = spec.split('## 主旨')[1];
    expect(block, 'spec 檔裡找不到「## 主旨」那一節 ⇒ 這道鎖沒接上').toBeDefined();
    const expected = block!.split('```')[1]!.replace(/^\n/, '').replace(/\n$/, '')
      .replaceAll('(訂單編號)', 'PCM-2026-0142');
    // 🔵 自檢:佔位詞要換掉 —— 否則下面那個 toBe 會因為【錯的理由】紅。
    expect(expected).not.toContain('(訂單編號)');
    expect(bankOrderCreatedSubject('PCM-2026-0142')).toBe(expected);
  });
});

// ── 2026-09-11 凍-C:v2 = 金額凍結快照(plan-paid-amount-frozen;Sean 拍「甲、甲」)────────
describe('buildOrderCreatedPayload v2(金額凍結快照)', () => {
  const m = (n: number) => n as PaidEmailContext['total'];
  const snap = (over: Partial<PaidEmailContext> = {}): PaidEmailContext => ({
    orderDisplayId: 'IGNORED-ID',
    lines: [{ title: '排氣管', variantSku: 'SKU-1', quantity: 2, lineTotal: m(940) }],
    linesTruncated: false,
    subtotal: m(940),
    shippingFee: m(160),
    discountTotal: m(50),
    taxTotal: m(47),
    total: m(1097),
    ...over,
  });
  const base = { displayId: 'PCM-2026-0001', paidAt: '2026-09-11T02:00:00Z' };

  it('🟢 有快照 ⇒ v2,逐欄恰好這些(orderDisplayId / linesTruncated 不落表)', () => {
    expect(buildOrderCreatedPayload({ ...base, paidSnapshot: snap() })).toEqual({
      event_version: ORDER_CREATED_SNAPSHOT_EVENT_VERSION,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-09-11T02:00:00Z',
      subtotal: 940,
      shipping_fee: 160,
      discount_total: 50,
      tax_total: 47,
      total: 1097,
      lines: [{ variant_sku: 'SKU-1', quantity: 2, line_total: 940, title: '排氣管' }],
    });
  });

  it('🔴 快照物件夾帶多餘欄位(含 PII)⇒ 到不了 payload', () => {
    const dirty = {
      ...snap(),
      email: 'leak@example.com',
      lines: [{ ...snap().lines[0], unitPrice: 470, phone: '0912345678' }],
    } as unknown as PaidEmailContext;
    const json = JSON.stringify(buildOrderCreatedPayload({ ...base, paidSnapshot: dirty }));
    expect(json).not.toContain('leak@example.com');
    expect(json).not.toContain('0912345678');
    expect(json).not.toContain('unitPrice');
    expect(json).not.toContain('IGNORED-ID');
  });

  it('🔴 自由文字例外 #2:品名只存前 120 字,而且不切半個字', () => {
    const long = '字'.repeat(119) + '😀' + '尾'.repeat(10);
    const p = buildOrderCreatedPayload({
      ...base,
      paidSnapshot: snap({ lines: [{ title: long, variantSku: null, quantity: 1, lineTotal: m(940) }] }),
    });
    const title = p.event_version === 2 ? p.lines[0]!.title : null;
    expect(Array.from(title ?? '')).toHaveLength(PAID_SNAPSHOT_TITLE_MAX_CHARS);
    expect(title?.endsWith('😀')).toBe(true);
  });

  it.each([
    ['截斷', { linesTruncated: true }],
    ['0 項', { lines: [] }],
    ['金額不是安全整數', { total: m(2 ** 60) }],
    ['小數', { shippingFee: 1.5 as PaidEmailContext['total'] }],
  ])('🔴 %s ⇒ throw(半份快照比沒有快照糟)', (_l, over) => {
    expect(() => buildOrderCreatedPayload({ ...base, paidSnapshot: snap(over as Partial<PaidEmailContext>) })).toThrow(
      'order_created 組裝失敗',
    );
  });
});
