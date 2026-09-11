// 付款信金額凍結快照(plan-paid-amount-frozen 凍-C)—— 寫入端與讀取端共用的判準。
import { describe, expect, it } from 'vitest';
import type { OrderCreatedEmailPayloadV2, PaidEmailContext } from '@pcm/ports';

import { isFreezablePaidSnapshot, loadFreezablePaidSnapshot, readPaidSnapshot } from './paid-email-snapshot';

const m = (n: number) => n as PaidEmailContext['total'];

function ctx(over: Partial<PaidEmailContext> = {}): PaidEmailContext {
  return {
    orderDisplayId: 'PCM-2026-0001',
    lines: [
      { title: '排氣管', variantSku: 'SKU-1', quantity: 1, lineTotal: m(700) },
      { title: null, variantSku: null, quantity: 2, lineTotal: m(240) },
    ],
    linesTruncated: false,
    subtotal: m(940),
    shippingFee: m(160),
    discountTotal: m(50),
    taxTotal: m(0),
    total: m(1050),
    ...over,
  };
}

const V2: OrderCreatedEmailPayloadV2 = {
  event_version: 2,
  display_id: 'PCM-2026-0001',
  paid_at: '2026-09-11T02:00:00.000Z',
  subtotal: 940,
  shipping_fee: 160,
  discount_total: 50,
  tax_total: 0,
  total: 1050,
  lines: [
    { variant_sku: 'SKU-1', quantity: 1, line_total: 700, title: '排氣管' },
    { variant_sku: null, quantity: 2, line_total: 240, title: null },
  ],
};

describe('isFreezablePaidSnapshot', () => {
  it('🟢 完整、加得起來 ⇒ 可凍', () => {
    expect(isFreezablePaidSnapshot(ctx())).toBe(true);
  });
  it.each([
    ['截斷', { linesTruncated: true }],
    ['0 項', { lines: [] }],
    ['品項加總 ≠ 小計(兩次讀之間不一致)', { subtotal: m(941) }],
    ['金額不是安全整數', { total: m(2 ** 60) }],
  ])('🔴 %s ⇒ 不凍', (_l, over) => {
    expect(isFreezablePaidSnapshot(ctx(over as Partial<PaidEmailContext>))).toBe(false);
  });
});

describe('loadFreezablePaidSnapshot —— 讀不到一律 null ⇒ 入列 v1', () => {
  it('🟢 ok ⇒ 回那一份', async () => {
    const c = ctx();
    expect(await loadFreezablePaidSnapshot({ loadPaidContext: async () => ({ kind: 'ok', context: c }) }, 'o1')).toBe(c);
  });
  it.each([
    ['沒注入', undefined],
    ['unavailable', { loadPaidContext: async () => ({ kind: 'unavailable' as const }) }],
    ['cancelled', { loadPaidContext: async () => ({ kind: 'cancelled' as const }) }],
    ['throw', { loadPaidContext: async () => { throw new Error('boom'); } }],
    ['截斷', { loadPaidContext: async () => ({ kind: 'ok' as const, context: ctx({ linesTruncated: true }) }) }],
  ])('🔴 %s ⇒ null', async (_l, dep) => {
    expect(await loadFreezablePaidSnapshot(dep, 'o1')).toBeNull();
  });
});

describe('readPaidSnapshot', () => {
  it('🟢 v2 ⇒ 物化成一個 PaidEmailContext(與入列時那份逐欄相同)', () => {
    expect(readPaidSnapshot(V2)).toEqual({ kind: 'snapshot', context: ctx() });
  });
  it.each([
    ['v1', { event_version: 1, display_id: 'X', paid_at: 'Y' }],
    ['沒有版本', { display_id: 'X' }],
    ['不是物件', null],
  ])('🔵 %s ⇒ live(照今天現查)', (_l, payload) => {
    expect(readPaidSnapshot(payload)).toEqual({ kind: 'live' });
  });
  it.each([
    ['缺 total', { ...V2, total: undefined }],
    ['lines 不是陣列', { ...V2, lines: 'x' }],
    ['0 項', { ...V2, lines: [] }],
    ['料號型別錯', { ...V2, lines: [{ ...V2.lines[0], variant_sku: 7 }, V2.lines[1]] }],
    ['金額是字串', { ...V2, subtotal: '940' }],
    ['品項加總 ≠ 小計', { ...V2, subtotal: 941, total: 1051 }],
    ['不認得的版本', { ...V2, event_version: 3 }],
  ])('🔴 %s ⇒ malformed(不靜默退現查)', (_l, payload) => {
    expect(readPaidSnapshot(payload)).toEqual({ kind: 'malformed' });
  });
});
