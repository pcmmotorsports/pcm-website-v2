import { describe, it, expect, vi } from 'vitest';
import type { IOrderRepository } from '@pcm/ports';
import type { PlaceOrderInput, PlaceOrderResult } from '@pcm/domain';
import { placeOrder } from './place-order';

const RESULT: PlaceOrderResult = { orderId: 'o1', displayId: 'PCM-2026-0001' };

function makeRepo(over: Partial<IOrderRepository> = {}): IOrderRepository {
  return {
    placeOrder: vi.fn().mockResolvedValue(RESULT),
    findById: vi.fn(),
    listByCustomer: vi.fn(),
    listByStatus: vi.fn(),
    ...over,
  } as unknown as IOrderRepository;
}

function input(over: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    lines: [{ variantId: 'v1', quantity: 2 }],
    addressId: '00000000-0000-4000-8000-000000000000',
    shippingMethod: 'home',
    invoice: { type: 'personal' },
    cartSessionId: '11111111-1111-1111-1111-111111111111',
    termsVersion: '2026-06-30', // #241 server 注入(必填)
    ...over,
  };
}

describe('placeOrder', () => {
  it('把已驗證 input 原樣交給 repo.placeOrder、回 RPC DTO {orderId, displayId}', async () => {
    const place = vi.fn().mockResolvedValue(RESULT);
    const repo = makeRepo({ placeOrder: place });

    const res = await placeOrder(repo, input());

    expect(place).toHaveBeenCalledWith(input());
    expect(res).toEqual(RESULT);
  });

  it('🔴 鐵則 12:交給 repo 的 input 不含任何價 / tier / cost 鍵(型別層 + runtime 雙證、server 權威)', async () => {
    let sentArg: unknown;
    const place = vi.fn().mockImplementation((arg: unknown) => {
      sentArg = arg;
      return Promise.resolve(RESULT);
    });
    const repo = makeRepo({ placeOrder: place });

    await placeOrder(repo, input({ lines: [{ supplierSlug: 'rpm', sku: 'DCC01-G-F', quantity: 1 }] }));

    expect(JSON.stringify(sentArg)).not.toMatch(/price|tier|cost/i);
  });

  it('空車 fail-fast:lines 為空 throw、不打 repo(縱深、不打 DB)', async () => {
    const place = vi.fn();
    const repo = makeRepo({ placeOrder: place });

    await expect(placeOrder(repo, input({ lines: [] }))).rejects.toThrow('購物車為空');
    expect(place).not.toHaveBeenCalled();
  });

  it('3DS-0b fail-closed:缺 cartSessionId throw、不打 repo(create_order 8-param 必填縱深)', async () => {
    const place = vi.fn();
    const repo = makeRepo({ placeOrder: place });

    await expect(placeOrder(repo, input({ cartSessionId: '' }))).rejects.toThrow('cart_session_id');
    expect(place).not.toHaveBeenCalled();
  });

  it('🔴 #241 fail-closed:缺 termsVersion throw、不打 repo(create_order 路徑無 consent 不生 order 縱深)', async () => {
    const place = vi.fn();
    const repo = makeRepo({ placeOrder: place });

    await expect(placeOrder(repo, input({ termsVersion: '' }))).rejects.toThrow('同意條款版本');
    expect(place).not.toHaveBeenCalled();
  });

  it('repo.placeOrder 失敗向上拋(RPC RAISE / 網路錯不吞)', async () => {
    const place = vi.fn().mockRejectedValue(new Error('create_order: 商品已下架'));
    const repo = makeRepo({ placeOrder: place });

    await expect(placeOrder(repo, input())).rejects.toThrow('已下架');
  });
});
