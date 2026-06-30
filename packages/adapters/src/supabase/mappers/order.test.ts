import { describe, it, expect } from 'vitest';
import type { PlaceOrderInput } from '@pcm/domain';
import {
  mapPlaceOrderToCreateOrderArgs,
  mapSupabaseOrderRowToListItem,
  type SupabaseOrderListRow,
} from './order';

function input(over: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    lines: [{ variantId: 'v1', quantity: 2 }],
    addressId: 'addr-1',
    shippingMethod: 'home',
    invoice: { type: 'personal' },
    cartSessionId: '11111111-1111-1111-1111-111111111111',
    termsVersion: '2026-06-30', // #241 server 注入(必填)
    ...over,
  };
}

describe('mapPlaceOrderToCreateOrderArgs', () => {
  it('variantId line → {variant_id, qty}(quantity→qty、camelCase→snake_case)', () => {
    const args = mapPlaceOrderToCreateOrderArgs(input());
    expect(args.p_lines).toEqual([{ variant_id: 'v1', qty: 2 }]);
    expect(args.p_address_id).toBe('addr-1');
    expect(args.p_shipping_method).toBe('home');
  });

  it('3DS-0b:cartSessionId → p_cart_session_id(camelCase→snake_case;cart-instance key)', () => {
    const args = mapPlaceOrderToCreateOrderArgs(input({ cartSessionId: 'cs-abc' }));
    expect(args.p_cart_session_id).toBe('cs-abc');
  });

  it('🔴 wire 鍵集合鎖定恰 8 鍵(#241;db push 前守門:typecheck 對多加鍵盲、改測試鎖鍵集合 + db push 後重 gen 抓少鍵)', () => {
    const args = mapPlaceOrderToCreateOrderArgs(input());
    expect(Object.keys(args).sort()).toEqual(
      [
        'p_address_id',
        'p_cart_session_id',
        'p_client_ip',
        'p_client_ua',
        'p_invoice',
        'p_lines',
        'p_shipping_method',
        'p_terms_version',
      ].sort(),
    );
  });

  it('🔴 #241:termsVersion → p_terms_version;clientIp/UA → p_client_ip/ua(缺 → null)', () => {
    const withConsent = mapPlaceOrderToCreateOrderArgs(
      input({ termsVersion: '2026-06-30', clientIp: '1.2.3.4', clientUserAgent: 'UA/1.0' }),
    );
    expect(withConsent.p_terms_version).toBe('2026-06-30');
    expect(withConsent.p_client_ip).toBe('1.2.3.4');
    expect(withConsent.p_client_ua).toBe('UA/1.0');
    // 缺 IP/UA → null(best-effort 容忍)
    const noIp = mapPlaceOrderToCreateOrderArgs(input());
    expect(noIp.p_client_ip).toBeNull();
    expect(noIp.p_client_ua).toBeNull();
  });

  it('複合鍵 line → {supplier_slug, sku, qty}(S3a 後 sku 非全域唯一防撞)', () => {
    const args = mapPlaceOrderToCreateOrderArgs(
      input({ lines: [{ supplierSlug: 'rpm', sku: 'DCC01-G-F', quantity: 3 }] }),
    );
    expect(args.p_lines).toEqual([{ supplier_slug: 'rpm', sku: 'DCC01-G-F', qty: 3 }]);
  });

  it('混合多 line 各自映射', () => {
    const args = mapPlaceOrderToCreateOrderArgs(
      input({
        lines: [
          { variantId: 'v1', quantity: 1 },
          { supplierSlug: 'rpm', sku: 'X', quantity: 5 },
        ],
      }),
    );
    expect(args.p_lines).toEqual([
      { variant_id: 'v1', qty: 1 },
      { supplier_slug: 'rpm', sku: 'X', qty: 5 },
    ]);
  });

  it('invoice 完整(company)映射 5 鍵', () => {
    const args = mapPlaceOrderToCreateOrderArgs(
      input({
        invoice: { type: 'company', title: 'PCM 重機', taxId: '12345678', carrier: '', donateCode: '' },
      }),
    );
    expect(args.p_invoice).toEqual({
      type: 'company',
      carrier: '',
      title: 'PCM 重機',
      taxId: '12345678',
      donateCode: '',
    });
  });

  it('invoice personal(子欄 undefined)type 正確', () => {
    expect(mapPlaceOrderToCreateOrderArgs(input()).p_invoice.type).toBe('personal');
  });

  it('🔴 鐵則 12:RPC args 不含任何 price / tier / cost / userId 鍵(wire 邊界縱深、server 權威)', () => {
    const args = mapPlaceOrderToCreateOrderArgs(
      input({ lines: [{ supplierSlug: 'rpm', sku: 'DCC01-G-F', quantity: 1 }] }),
    );
    expect(JSON.stringify(args)).not.toMatch(/price|tier|cost|user_?id/i);
  });
});

function listRow(over: Partial<SupabaseOrderListRow> = {}): SupabaseOrderListRow {
  return {
    id: 'ord-1',
    display_id: 'PCM-2099-0007',
    created_at: '2099-04-15T10:00:00Z',
    payment_status: 'paid',
    fulfillment_status: 'shipped',
    total: 12345,
    order_items: [{ quantity: 1 }],
    ...over,
  };
}

describe('mapSupabaseOrderRowToListItem(讀路徑摘要投影)', () => {
  it('欄位直送 + total integer → Money(整數 TWD)', () => {
    const item = mapSupabaseOrderRowToListItem(listRow({ total: 12345 }));
    expect(item.id).toBe('ord-1');
    expect(item.displayId).toBe('PCM-2099-0007');
    expect(item.createdAt).toBe('2099-04-15T10:00:00Z');
    expect(item.paymentStatus).toBe('paid');
    expect(item.fulfillmentStatus).toBe('shipped');
    expect(item.total).toEqual({ amount: 12345, currency: 'TWD' });
  });

  it('codex C2:單一品項 quantity=3 → itemCount=3(Σqty、非 distinct 列數)', () => {
    expect(mapSupabaseOrderRowToListItem(listRow({ order_items: [{ quantity: 3 }] })).itemCount).toBe(3);
  });

  it('多品項 [{2},{1}] → itemCount=3(Σquantity)', () => {
    expect(
      mapSupabaseOrderRowToListItem(listRow({ order_items: [{ quantity: 2 }, { quantity: 1 }] }))
        .itemCount,
    ).toBe(3);
  });

  it('0-item(空 array)→ itemCount=0(防禦 case)', () => {
    expect(mapSupabaseOrderRowToListItem(listRow({ order_items: [] })).itemCount).toBe(0);
  });
});
