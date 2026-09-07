import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ⟦auth-DEALERTIERPRICING⟧ B2a —— **這一支存在的理由是 codex R1 must-fix ③**。
 *
 * 🛑 `actions.test.ts` 那六格把 `fetchEffectivePrices` 與 `priceKey` **整支 mock 掉了**
 *   ⇒ 它們驗的是「拿到 Map 之後怎麼配對」, **驗不到「餵給 RPC 的參數對不對」**。
 * 🔬 codex 給的第五種壞法:**真 helper 的 `p_product_ids` 固定傳 `null`**
 *   ⇒ 那六格**原始斷言仍 6/6 綠**, 而真實情境裡商品價會由 800 退成 1000。
 * ⇒ ✅ 本檔**不 mock 那支 helper**, 只 mock 它下面那層(supabase client),
 *   斷言**它真的把哪些參數送出去**。
 */

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => ({ supabase: { rpc: rpcMock }, user: { id: 'u1' }, error: null }),
  isNoSessionError: () => false,
}));
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTier: async () => 'store' as const }));

import { fetchEffectivePrices, priceKey } from './tier-prices';

beforeEach(() => rpcMock.mockReset());

describe('fetchEffectivePrices —— 真的送出去的參數', () => {
  it('🔴 商品 id 要【真的】進 p_product_ids(codex 第五種壞法就是這裡固定傳 null)', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchEffectivePrices({ tier: 'store', productIds: ['p1', 'p2'], variantIds: [] });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0] ?? [];
    expect(fn).toBe('get_effective_prices');
    expect((args as { p_product_ids: unknown }).p_product_ids, 'p_product_ids 傳成 null ⇒ 經銷價靜默退成一般價').toEqual(['p1', 'p2']);
  });

  it('🔴 變體 id 要進 p_variant_ids', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchEffectivePrices({ tier: 'store', productIds: [], variantIds: ['v1'] });
    const [, args] = rpcMock.mock.calls[0] ?? [];
    expect((args as { p_variant_ids: unknown }).p_variant_ids).toEqual(['v1']);
    expect((args as { p_product_ids: unknown }).p_product_ids, '空的那半送 null 而不是空陣列').toBeNull();
  });

  it('🟢 tier 不是 store ⇒ 【一次都不叫】', async () => {
    await fetchEffectivePrices({ tier: 'general', productIds: ['p1'], variantIds: ['v1'] });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('🔴 回傳用 (kind, id) 當 key —— 同 id 不同 kind 不得互蓋', async () => {
    rpcMock.mockResolvedValue({
      data: [
        { kind: 'product', id: 'same', amount: 700, currency: 'TWD', tier: 'store' },
        { kind: 'variant', id: 'same', amount: 900, currency: 'TWD', tier: 'store' },
      ],
      error: null,
    });
    const m = await fetchEffectivePrices({ tier: 'store', productIds: ['same'], variantIds: ['same'] });
    expect(m.get(priceKey('product', 'same'))).toBe(700);
    expect(m.get(priceKey('variant', 'same'))).toBe(900);
    expect(m.size, '兩列要各自存在, 不是一列').toBe(2);
  });

  it('🛑 RPC 回 error ⇒ 往上拋(不靜默退回 general)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42883' } });
    await expect(
      fetchEffectivePrices({ tier: 'store', productIds: ['p1'], variantIds: [] }),
    ).rejects.toThrow();
  });

  it('🟢 amount 是 null 的列【不進 Map】—— 讓呼叫端自己決定(它會 throw)', async () => {
    rpcMock.mockResolvedValue({
      data: [{ kind: 'product', id: 'p1', amount: null, currency: 'TWD', tier: 'store' }],
      error: null,
    });
    const m = await fetchEffectivePrices({ tier: 'store', productIds: ['p1'], variantIds: [] });
    expect(m.size).toBe(0);
  });
});

describe('R3 nit ④ —— RPC 自己回的 `tier` 當「身分有沒有傳到 DB」的偵測器', () => {
  it('🛑 RPC 回 general(而我送的是 store)⇒ 拋, 不得默默用那個價', async () => {
    // 🔴 那是 auth.uid() 沒傳到 DB 的形狀 —— RPC 端只會 RAISE WARNING 進 PG log, 沒有人看。
    rpcMock.mockResolvedValue({
      data: [{ kind: 'product', id: 'p1', amount: 800, currency: 'TWD', tier: 'general' }],
      error: null,
    });
    await expect(
      fetchEffectivePrices({ tier: 'store', productIds: ['p1'], variantIds: [] }),
    ).rejects.toThrow(/身分沒傳到 DB/);
  });

  it('🟢 正對照:RPC 回 store ⇒ 照常拿到價(少了這格, 上一格只證明我很會拋)', async () => {
    rpcMock.mockResolvedValue({
      data: [{ kind: 'product', id: 'p1', amount: 800, currency: 'TWD', tier: 'store' }],
      error: null,
    });
    const m = await fetchEffectivePrices({ tier: 'store', productIds: ['p1'], variantIds: [] });
    expect(m.get('product:p1')).toBe(800);
  });
});
