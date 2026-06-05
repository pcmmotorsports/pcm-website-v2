import { describe, it, expect } from 'vitest';
import type { PlaceOrderInput } from '@pcm/domain';
import { mapPlaceOrderToCreateOrderArgs } from './order';

function input(over: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    lines: [{ variantId: 'v1', quantity: 2 }],
    addressId: 'addr-1',
    shippingMethod: 'home',
    invoice: { type: 'personal' },
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
