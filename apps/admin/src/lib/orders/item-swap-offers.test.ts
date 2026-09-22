import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[] | Error>,
  catalog: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const result = () => {
        const v = h.tables[table] ?? [];
        return Promise.resolve(v instanceof Error ? { data: null, error: v } : { data: v, error: null });
      };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'limit']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad);
      return q;
    },
  }),
}));
vi.mock('./manual-order-catalog', () => ({ getManualOrderCatalogHitsByVariantIds: h.catalog }));

import { readItemSwapOffers } from './item-swap-offers';

const ORDER = { id: 'o1', cancelledAt: null, paymentStatus: 'paid' as const, items: [{ id: 'i1' }, { id: 'i2' }] };
const detail = (over: Partial<typeof ORDER> = {}) => ({ ...ORDER, ...over }) as unknown as Parameters<typeof readItemSwapOffers>[0];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.tables = {
    orders: [{ tier_at_checkout: 'general' }],
    order_items: [
      { id: 'i1', variant_id: 'v1' },
      { id: 'i2', variant_id: 'v2' },
    ],
  };
  h.catalog.mockReset();
  h.catalog.mockResolvedValue([
    { variantId: 'v1', sku: 'A', title: 'A', unitPrice: 1050, dealerPriceUntaxed: 800 },
    { variantId: 'v2', sku: 'B', title: 'B', unitPrice: 900, dealerPriceUntaxed: null },
  ]);
});

describe('readItemSwapOffers', () => {
  it('完全還沒處理的品項都給入口, 帶原商品目前的目錄價', async () => {
    const m = await readItemSwapOffers(detail());
    expect(m?.get('i1')).toEqual({ sourceCatalogGeneral: 1050, sourceCatalogDealerUntaxed: 800 });
    expect(m?.get('i2')).toEqual({ sourceCatalogGeneral: 900, sourceCatalogDealerUntaxed: null });
  });

  it('訂單已取消或有退款狀態 ⇒ 全部不給, 也不去查', async () => {
    expect((await readItemSwapOffers(detail({ cancelledAt: '2026-09-22' as never })))?.size).toBe(0);
    expect((await readItemSwapOffers(detail({ paymentStatus: 'refunded' as never })))?.size).toBe(0);
    expect(h.catalog).not.toHaveBeenCalled();
  });

  it.each([
    ['order_item_procurement', { order_item_id: 'i1' }],
    ['shipment_items', { order_item_id: 'i1' }],
    ['order_cancellation_items', { order_item_id: 'i1' }],
    ['order_amount_requests', { order_item_id: 'i1' }],
    ['order_item_quantity_summary', { order_item_id: 'i1', ordered_quantity: 1, instock_quantity: 0, cancelled_quantity: 0, shipped_quantity: 0 }],
  ])('%s 有 i1 的列 ⇒ i1 不給、i2 照給', async (table, row) => {
    h.tables[table] = [row];
    const m = await readItemSwapOffers(detail());
    expect(m?.has('i1')).toBe(false);
    expect(m?.has('i2')).toBe(true);
  });

  it('摘要列全 0 ⇒ 照給(與沒有摘要列同一件事)', async () => {
    h.tables.order_item_quantity_summary = [
      { order_item_id: 'i1', ordered_quantity: 0, instock_quantity: 0, cancelled_quantity: 0, shipped_quantity: 0 },
    ];
    expect((await readItemSwapOffers(detail()))?.has('i1')).toBe(true);
  });

  it.each(['order_refunds', 'order_refund_jobs', 'order_manual_refunds'])('%s 有這張單的列 ⇒ 全部不給', async (table) => {
    h.tables[table] = [{ id: 'r1' }];
    expect((await readItemSwapOffers(detail()))?.size).toBe(0);
  });

  it('原商品規格已刪或查不到目錄 ⇒ 那一項不給', async () => {
    h.tables.order_items = [
      { id: 'i1', variant_id: null },
      { id: 'i2', variant_id: 'v-gone' },
    ];
    expect((await readItemSwapOffers(detail()))?.size).toBe(0);
  });

  it('原商品在這張單的等級下沒有價格 ⇒ 不給;0 元照給', async () => {
    h.catalog.mockResolvedValue([
      { variantId: 'v1', sku: 'A', title: 'A', unitPrice: null, dealerPriceUntaxed: 800 },
      { variantId: 'v2', sku: 'B', title: 'B', unitPrice: 0, dealerPriceUntaxed: null },
    ]);
    let m = await readItemSwapOffers(detail());
    expect(m?.has('i1'), '一般會員看一般價, 沒有就不給').toBe(false);
    expect(m?.has('i2'), '0 元是合法價格').toBe(true);
    h.tables.orders = [{ tier_at_checkout: 'store' }];
    m = await readItemSwapOffers(detail());
    expect(m?.has('i1'), 'store 看經銷價').toBe(true);
  });

  it('🔴 讀滿上限(可能被截斷)⇒ null', async () => {
    h.tables.order_amount_requests = Array.from({ length: 500 }, () => ({ order_item_id: 'ix' }));
    expect(await readItemSwapOffers(detail())).toBeNull();
  });

  it('🔴 任何一發讀取失敗或形狀不對 ⇒ null(整張單不顯示入口)', async () => {
    h.tables.shipment_items = new Error('permission denied');
    expect(await readItemSwapOffers(detail())).toBeNull();
    h.tables = { orders: [{ tier_at_checkout: 'general' }], order_items: [{ id: 'i1', variant_id: 'v1' }], order_item_quantity_summary: [{ order_item_id: 'i1', ordered_quantity: '0' }] };
    expect(await readItemSwapOffers(detail())).toBeNull();
    h.tables = { orders: [{ tier_at_checkout: 'general' }], order_items: [{ id: 'i1', variant_id: 'v1' }] };
    h.catalog.mockRejectedValue(new Error('down'));
    expect(await readItemSwapOffers(detail())).toBeNull();
  });
});
