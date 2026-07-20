import { describe, it, expect } from 'vitest';
import type { PlaceOrderInput } from '@pcm/domain';
import {
  mapPlaceOrderToCreateOrderArgs,
  mapSupabaseOrderRowToListItem,
  mapSupabaseAdminOrderRowToSummary,
  type CreateOrderRpcArgs,
  type SupabaseOrderListRow,
  type SupabaseAdminOrderRow,
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

  it('🔴 B-3 flag-off wire 鍵集合仍鎖定恰 8 鍵；flag-on 第 9 鍵另測', () => {
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

  it('B-3 flag-on marker：notificationEmail 存在時才輸出第 9 鍵，null 不會被省略', () => {
    const args = mapPlaceOrderToCreateOrderArgs(input({ notificationEmail: null }));

    expect(Object.keys(args).sort()).toEqual(
      [
        'p_address_id',
        'p_cart_session_id',
        'p_client_ip',
        'p_client_ua',
        'p_invoice',
        'p_lines',
        'p_notification_email',
        'p_shipping_method',
        'p_terms_version',
      ].sort(),
    );
    expect(Reflect.get(args, 'p_notification_email')).toBeNull();
  });

  it('B-3 型別只允許 null marker，不允許真 Email 提前穿過 domain／wire 邊界', () => {
    // @ts-expect-error B-3 不得讓 canonical 真值進 PlaceOrderInput；B-4 才會擴型。
    const forbiddenDomainInput: PlaceOrderInput = { ...input(), notificationEmail: 'real@example.com' };
    const forbiddenWireArgs: CreateOrderRpcArgs = {
      ...mapPlaceOrderToCreateOrderArgs(input()),
      // @ts-expect-error B-3 wire 第 9 鍵只允許 null；B-4 才會擴型。
      p_notification_email: 'real@example.com',
    };

    expect(forbiddenDomainInput.notificationEmail).toBe('real@example.com');
    expect(forbiddenWireArgs.p_notification_email).toBe('real@example.com');
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

  it('V-3a:line 帶 vehicle → 逐欄顯式重建(dict 多餘欄剝除;free year undefined 不外送)', () => {
    // dirty 模擬 runtime 竄改(型別層不允許、cast 繞過):mapVehicle 逐欄重建必剝
    const dirty = {
      kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search', priceHint: 999,
    } as never;
    const args = mapPlaceOrderToCreateOrderArgs(
      input({ lines: [{ variantId: 'v1', quantity: 1, vehicle: dirty }] }),
    );
    expect(args.p_lines).toEqual([
      { variant_id: 'v1', qty: 1, vehicle: { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' } },
    ]);
    expect(Object.keys((args.p_lines[0] as { vehicle: object }).vehicle)).not.toContain('priceHint');

    const noYear = mapPlaceOrderToCreateOrderArgs(
      input({ lines: [{ variantId: 'v1', quantity: 1, vehicle: { kind: 'free', raw: '阿嬤的野狼', source: 'freetext' } }] }),
    );
    expect(noYear.p_lines).toEqual([
      { variant_id: 'v1', qty: 1, vehicle: { kind: 'free', raw: '阿嬤的野狼', source: 'freetext' } },
    ]);
    expect(Object.keys((noYear.p_lines[0] as { vehicle: object }).vehicle)).not.toContain('year');
  });

  it('V-3a:無 vehicle line → 不帶 vehicle 鍵(既有 wire byte 零變)', () => {
    const args = mapPlaceOrderToCreateOrderArgs(input());
    expect(Object.keys(args.p_lines[0]!)).toEqual(['variant_id', 'qty']);
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

// ── V-3b:admin 摘要 order_items.vehicle_snapshot 防禦解析 → AdminOrderLine.vehicle ──

type AdminItemEmbed = SupabaseAdminOrderRow['order_items'] extends (infer E)[] | null ? E : never;

function adminItem(over: Partial<AdminItemEmbed> = {}): AdminItemEmbed {
  return {
    id: 'oi-1',
    variant_sku: 'DCC01-G-F',
    quantity: 1,
    unit_price: 100,
    line_total: 100,
    product_snapshot: { title: '碳纖護蓋' },
    workflow_status: null,
    version: 1,
    vehicle_snapshot: null,
    product_variants: null,
    ...over,
  } as AdminItemEmbed;
}

function adminRow(item: AdminItemEmbed): SupabaseAdminOrderRow {
  return {
    id: 'o-1',
    display_id: 'PCM-2026-0001',
    created_at: '2026-07-16T00:00:00Z',
    payment_status: 'unpaid',
    fulfillment_status: 'notOrdered',
    total: 100,
    order_source: 'web',
    payment_channel: 'none',
    display_position: null,
    cancelled_at: null,
    tier_at_checkout: 'general',
    customers: null,
    order_items: [item],
  } as SupabaseAdminOrderRow;
}

const vehOf = (snap: unknown) =>
  mapSupabaseAdminOrderRowToSummary(adminRow(adminItem({ vehicle_snapshot: snap as AdminItemEmbed['vehicle_snapshot'] }))).lines[0]!.vehicle;

describe('mapSupabaseAdminOrderRowToSummary — V-3b vehicle_snapshot 解析', () => {
  it('dict 快照 → 逐欄解析(year/source 保留)', () => {
    expect(vehOf({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' })).toEqual({
      kind: 'dict',
      brand: 'Yamaha',
      model: 'MT-09 SP',
      year: 2021,
      source: 'search',
    });
  });

  it('free 快照(無 year)→ 解析、year 不外送', () => {
    expect(vehOf({ kind: 'free', raw: '阿嬤的野狼', source: 'freetext' })).toEqual({
      kind: 'free',
      raw: '阿嬤的野狼',
      source: 'freetext',
    });
  });

  it('null(未帶車款)→ null', () => {
    expect(vehOf(null)).toBeNull();
  });

  it('壞形狀 dict 缺 brand → null(防禦、不炸頁)', () => {
    expect(vehOf({ kind: 'dict', model: 'X', source: 's' })).toBeNull();
  });

  it('未知 kind → null', () => {
    expect(vehOf({ kind: 'bus', foo: 1 })).toBeNull();
  });

  it('year 非整數 → 略去 year 欄(仍解析出車款)', () => {
    expect(vehOf({ kind: 'dict', brand: 'Honda', model: 'CB650R', year: 'abc', source: 'garage' })).toEqual({
      kind: 'dict',
      brand: 'Honda',
      model: 'CB650R',
      source: 'garage',
    });
  });
});
