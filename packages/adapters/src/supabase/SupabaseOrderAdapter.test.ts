// SupabaseOrderAdapter.test.ts — 建單 adapter 行為(M-3-S2-b2-b2、鐵則 12 建單 path)。
//
// 注入式 mock SupabaseClient 攔 .rpc(fn, args):斷言 placeOrder 呼 create_order RPC、args 為對齊契約的
// snake_case wire(quantity→qty / 複合鍵 / 發票)、回傳只 {orderId, displayId};RPC error 上拋不吞;
// 回傳格式非預期防腐壞 throw;讀路徑 deferred-stub(延 stage ③ 訂單查詢、backlog #217)reject 未實作。
// 線上 create_order RPC 已就緒(S2-a + S2-b1 migration 已 db push、authenticated EXECUTE/anon REVOKE 正確);
// ⚠️ 3DS-0b 5-param(加 p_cart_session_id)尚待 db push、本檔以 mock 驗 TS wire 對齊 0b 簽名(args 含 p_cart_session_id)。
// 真打 RPC(端到端建單)可成、留 Sean 階段①末肉眼驗;本片 mock client 單元測只驗 adapter 行為。

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
    cartSessionId: '11111111-1111-1111-1111-111111111111',
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
      p_cart_session_id: '11111111-1111-1111-1111-111111111111',
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

// ── findTotal:付款編排窄讀(②-③c-1、plan v6 §4)──
// mock from('orders').select('total').eq('id', id).maybeSingle() 鏈;單欄、RLS own-only(mock 層不重現
// RLS、以「查無 → null」涵蓋非本人被濾掉之 fail-closed 行為)。
function makeQueryClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, maybeSingle };
}

describe('SupabaseOrderAdapter.findTotal', () => {
  it('查得 → {amount: toMoneyAmount(total), currency: TWD};查詢鏈 = orders/select total/eq id', async () => {
    const { client, from, select, eq } = makeQueryClient({ data: { total: 1100 }, error: null });
    const res = await new SupabaseOrderAdapter(client).findTotal('o1');
    expect(res).toEqual({ amount: 1100, currency: 'TWD' });
    expect(from).toHaveBeenCalledWith('orders');
    expect(select).toHaveBeenCalledWith('total'); // 🔴 單欄窄讀(零價結構外、零經銷欄觸及)
    expect(eq).toHaveBeenCalledWith('id', 'o1');
  });

  it('查無 / 非本人(RLS 濾掉、maybeSingle 回 null)→ null(fail-closed、不 throw)', async () => {
    const { client } = makeQueryClient({ data: null, error: null });
    await expect(new SupabaseOrderAdapter(client).findTotal('o-nope')).resolves.toBeNull();
  });

  it('total 形狀非 number(防 DB/wire 腐壞)→ null fail-closed', async () => {
    const { client } = makeQueryClient({ data: { total: '1100' }, error: null });
    await expect(new SupabaseOrderAdapter(client).findTotal('o1')).resolves.toBeNull();
  });

  it('查詢 error → 裸 throw(對齊 placeOrder 慣例;action 層吞通用字面)', async () => {
    const { client } = makeQueryClient({ data: null, error: new Error('connection refused') });
    await expect(new SupabaseOrderAdapter(client).findTotal('o1')).rejects.toThrow();
  });

  it('🔴 非整數 total(浮點腐壞)→ toMoneyAmount 中央守門 throw、不靜默放行', async () => {
    const { client } = makeQueryClient({ data: { total: 1100.5 }, error: null });
    await expect(new SupabaseOrderAdapter(client).findTotal('o1')).rejects.toThrow();
  });
});
