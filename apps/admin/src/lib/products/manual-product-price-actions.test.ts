import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

let authed: { sid: string; actorId: string } | null = { sid: 's1', actorId: 'staff_a' };
let source: { actor: { id: string } | null; source: string } = { actor: { id: 'staff_a' }, source: 'ticket' };
let manager = true;
const setPrices = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: async () => authed }));
vi.mock('../session/actor', () => ({ getSessionActorWithSource: async () => source }));
vi.mock('../staff', () => ({ isActiveManager: async () => manager }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./manual-product-repository', () => ({ setVariantPrices: (a: unknown) => setPrices(a) }));

const { saveManualProductPricesAction } = await import('./manual-product-price-actions');
const P = '11111111-1111-4111-8111-111111111111';
const V1 = '22222222-2222-4222-8222-222222222222';
const V2 = '33333333-3333-4333-8333-333333333333';
const input = () => [
  { variantId: V1, priceGeneral: 7200, priceStore: 6000 },
  { variantId: V2, priceGeneral: 5000, priceStore: null },
];

beforeEach(() => {
  authed = { sid: 's1', actorId: 'staff_a' };
  source = { actor: { id: 'staff_a' }, source: 'ticket' };
  manager = true;
  setPrices.mockReset();
  setPrices.mockResolvedValue([
    { variantId: V1, outcome: 'UPDATED' },
    { variantId: V2, outcome: 'NO_CHANGE' },
  ]);
});

describe('商品頁乙 P8:主管改手動商品價格 server action', () => {
  it('主管 + 票證身分 ⇒ 照 RPC 的鍵名送出(不送特價),回改了幾個', async () => {
    expect(await saveManualProductPricesAction(P, input())).toEqual({ ok: true, updated: 1, unchanged: 1 });
    expect(setPrices).toHaveBeenCalledWith({
      productId: P,
      changes: [
        { variant_id: V1, price_general: 7200, price_store: 6000 },
        { variant_id: V2, price_general: 5000, price_store: null },
      ],
      actor: 'staff_a',
      requestId: 'req-1',
    });
    expect(JSON.stringify(setPrices.mock.calls[0])).not.toContain('sale_price_general');
  });

  it('🔴 不是主管 ⇒ 不送', async () => {
    manager = false;
    expect(await saveManualProductPricesAction(P, input())).toEqual({ ok: false, message: '沒有儲存：只有主管可以改價格。' });
    expect(setPrices).not.toHaveBeenCalled();
  });

  it('🔴 自選身分 / 身分和登入不一致 / 沒登入 ⇒ 不送', async () => {
    source = { actor: { id: 'staff_a' }, source: 'self-selected' };
    expect((await saveManualProductPricesAction(P, input())).ok).toBe(false);
    source = { actor: { id: 'staff_b' }, source: 'ticket' };
    expect((await saveManualProductPricesAction(P, input())).ok).toBe(false);
    authed = null;
    expect((await saveManualProductPricesAction(P, input())).ok).toBe(false);
    expect(setPrices).not.toHaveBeenCalled();
  });

  it('一般價不能空、不能是小數或負數;經銷價可以不填;規格不能重複;1 到 50 個', async () => {
    const bad = [
      [{ variantId: V1, priceGeneral: null as unknown as number, priceStore: null }],
      [{ variantId: V1, priceGeneral: 12.5, priceStore: null }],
      [{ variantId: V1, priceGeneral: -1, priceStore: null }],
      [{ variantId: V1, priceGeneral: 100, priceStore: -5 }],
      [{ variantId: 'not-uuid', priceGeneral: 100, priceStore: null }],
      [
        { variantId: V1, priceGeneral: 100, priceStore: null },
        { variantId: V1, priceGeneral: 200, priceStore: null },
      ],
      [],
    ];
    for (const b of bad) expect((await saveManualProductPricesAction(P, b)).ok).toBe(false);
    expect((await saveManualProductPricesAction('bad', input())).ok).toBe(false);
    expect(setPrices).not.toHaveBeenCalled();
  });

  it('資料庫拒絕 ⇒ 說明原因;商品被鎖 ⇒ 請稍後再試', async () => {
    setPrices.mockRejectedValueOnce(new Error('admin_set_variant_prices: 同步商品的一般價與經銷價只能在報價單改'));
    expect(await saveManualProductPricesAction(P, input())).toEqual({
      ok: false,
      message: '沒有儲存：同步商品的一般價與經銷價只能在報價單改。',
    });
    setPrices.mockRejectedValueOnce(new Error('商品正在更新,請稍後再試'));
    expect((await saveManualProductPricesAction(P, input())) as { message: string }).toMatchObject({
      message: '沒有儲存：這件商品正在更新（例如每日同步），請稍後再試。',
    });
    setPrices.mockRejectedValueOnce(new Error('無權執行此操作'));
    expect((await saveManualProductPricesAction(P, input())) as { message: string }).toMatchObject({
      message: '沒有儲存：只有在職主管可以改價格。請重新登入後再試。',
    });
  });

  it('🔴 結果不明(連線中斷)⇒ 不說失敗,請重新整理確認', async () => {
    setPrices.mockRejectedValueOnce(new Error('fetch failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await saveManualProductPricesAction(P, input())).toEqual({
      ok: false,
      message: '無法確認價格是否已儲存。請重新整理頁面，確認目前的價格。',
    });
    spy.mockRestore();
  });
});
