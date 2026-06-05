// SupabaseOrderAdapter.test.ts — 建單 adapter 行為(M-3-S2-b2-b2、鐵則 12 建單 path)。
//
// 注入式 mock SupabaseClient 攔 .rpc(fn, args):斷言 placeOrder 呼 create_order RPC、args 為對齊契約的
// snake_case wire(quantity→qty / 複合鍵 / 發票)、回傳只 {orderId, displayId};RPC error 上拋不吞;
// 回傳格式非預期防腐壞 throw;讀路徑 deferred-stub(延 stage ③ 訂單查詢、backlog #217)reject 未實作。
// 真打 RPC(端到端建單)需先 supabase db push(S2-a + S2-b1)、留 db push 後 Sean 肉眼驗。

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type { PlaceOrderInput } from '@pcm/domain';
import { SupabaseOrderAdapter } from './SupabaseOrderAdapter';

function input(over: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    lines: [{ variantId: 'v1', quantity: 2 }],
    addressId: 'addr-1',
    shippingMethod: 'home',
    invoice: { type: 'personal' },
    ...over,
  };
}

function makeClient(rpcResult: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('SupabaseOrderAdapter.placeOrder', () => {
  it('呼 create_order RPC、args snake_case 對齊契約(複合鍵 / quantity→qty / 發票)、回 {orderId, displayId}', async () => {
    const { client, rpc } = makeClient({
      data: { order_id: 'o1', display_id: 'PCM-2026-0001' },
      error: null,
    });
    const adapter: IOrderRepository = new SupabaseOrderAdapter(client);

    const res = await adapter.placeOrder(
      input({
        lines: [{ supplierSlug: 'rpm', sku: 'DCC01-G-F', quantity: 3 }],
        invoice: { type: 'company', title: 'PCM', taxId: '12345678' },
      }),
    );

    // 🔴 鐵則 12:傳給 RPC 的 args 即 mapper 輸出(snake_case、零 price/tier/userId)
    expect(rpc).toHaveBeenCalledWith('create_order', {
      p_lines: [{ supplier_slug: 'rpm', sku: 'DCC01-G-F', qty: 3 }],
      p_address_id: 'addr-1',
      p_shipping_method: 'home',
      p_invoice: { type: 'company', carrier: undefined, title: 'PCM', taxId: '12345678', donateCode: undefined },
    });
    expect(res).toEqual({ orderId: 'o1', displayId: 'PCM-2026-0001' });
  });

  it('RPC error(RAISE / 網路)原樣上拋不吞(對齊既有 adapter 裸 throw)', async () => {
    const { client } = makeClient({ data: null, error: new Error('create_order: 商品已下架') });
    const adapter: IOrderRepository = new SupabaseOrderAdapter(client);
    await expect(adapter.placeOrder(input())).rejects.toThrow('已下架');
  });

  it('RPC 回傳格式非預期(缺 order_id)→ throw(防腐壞)', async () => {
    const { client } = makeClient({ data: { display_id: 'PCM-2026-0001' }, error: null });
    const adapter: IOrderRepository = new SupabaseOrderAdapter(client);
    await expect(adapter.placeOrder(input())).rejects.toThrow('非預期');
  });
});

describe('SupabaseOrderAdapter 讀路徑 deferred-stub(延 stage ③ 訂單查詢、backlog #217)', () => {
  it('findById / listByCustomer / listByStatus 明確 reject 未實作', async () => {
    const { client } = makeClient({ data: null, error: null });
    const adapter: IOrderRepository = new SupabaseOrderAdapter(client);
    await expect(adapter.findById('o1')).rejects.toThrow('未實作');
    await expect(adapter.listByCustomer('c1')).rejects.toThrow('未實作');
    await expect(adapter.listByStatus({})).rejects.toThrow('未實作');
  });
});
