import { describe, it, expect } from 'vitest';
import type { PlaceOrderInput } from '@pcm/domain';
import {
  mapPlaceOrderToCreateOrderArgs,
  mapSupabaseOrderRowToListItem,
  mapSupabaseAdminOrderRowToSummary,
  mapSupabaseAdminOrderDetailRowToDetail,
  type CreateOrderRpcArgs,
  type SupabaseOrderListRow,
  type SupabaseAdminOrderRow,
  type SupabaseAdminOrderDetailRow,
  type SupabaseOrderItemQuantitySummaryRow,
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

// ── M-4b E10 A9g-1:三軸數量摘要的 fail-closed 轉換 ──
//
// 🔴 本組測試的承重點只有一個:**「摘要缺列」不可以被翻成「都是 0」**。
//    缺列會讓 cancellableQuantity 被算成 quantity(算大)⇒ 畫面放行超量取消、送出必被 A8a2 拒
//    (母 plan 2026-07-28-e10-order-closure-master-plan-v2.md:384 row 37 逐字記這個坑)。
//    所以每條負向都刻意只讓「補 0」那種寫法失敗,正向則釘死公式與原欄透傳。

/** 明細 row fixture:只填本組測試會讀到的欄,其餘給最小合法值。 */
function detailRow(
  summary?: SupabaseAdminOrderDetailRow['order_items'][number]['order_item_quantity_summary'],
): SupabaseAdminOrderDetailRow {
  return {
    id: 'o1',
    display_id: 'PCM-2099-0001',
    created_at: '2026-04-15T00:00:00+00:00',
    payment_status: 'unpaid',
    fulfillment_status: 'notOrdered',
    order_source: 'storefront',
    // invoice_status(database.types.ts:1268)/ payment_channel(:1273)在 schema 是 NOT NULL string
    // ⇒ 給最小合法值;本組測試不讀這兩欄。
    payment_channel: 'none',
    payment_method: null,
    paid_at: null,
    subtotal: 1000,
    shipping_fee: 0,
    discount_total: 0,
    total: 1000,
    shipping_method: 'home',
    shipping_address_snapshot: null,
    invoice: null,
    invoice_number: null,
    invoice_amount: null,
    invoice_status: 'pending',
    cancelled_at: null,
    cancelled_reason: null,
    version: 1,
    customers: null,
    order_items: [
      {
        id: 'oi1',
        variant_sku: 'SKU-1',
        quantity: 5,
        unit_price: 200,
        line_total: 1000,
        product_snapshot: null,
        workflow_status: null,
        version: 1,
        ...(summary === undefined ? {} : { order_item_quantity_summary: summary }),
      },
    ],
  };
}

describe('mapSupabaseAdminOrderDetailRowToDetail — A9g-1 三軸數量摘要 fail-closed', () => {
  it('🔴 內嵌鍵整個不存在(投影退版)→ null,不得補 0', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow(undefined));
    expect(res.items[0]?.quantitySummary).toBeNull();
  });

  it('🔴🔴 空陣列(A4a 尚未建列)→ null,**不得**變成 {instock:0, cancelled:0, cancellable:quantity}', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow([]));
    const summary = res.items[0]?.quantitySummary;
    // 這條就是整片的核心:補 0 的寫法會讓 summary 變成物件、且 cancellable = 5(quantity)。
    expect(summary).toBeNull();
    // 釘死「不是那個具體的錯誤形狀」——否則日後有人回傳 0 值物件,上面那條改成 toBeFalsy 也會過。
    expect(summary?.cancellableQuantity).toBeUndefined();
  });

  it('🔴 null(內嵌鍵存在但值為 null)→ null', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow(null));
    expect(res.items[0]?.quantitySummary).toBeNull();
  });

  it('有列 → 四個原欄逐一透傳,cancellable = quantity − instock − cancelled', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow([
        { quantity: 5, ordered_quantity: 4, instock_quantity: 2, cancelled_quantity: 1 },
      ]),
    );
    expect(res.items[0]?.quantitySummary).toEqual({
      quantity: 5,
      orderedQuantity: 4,
      instockQuantity: 2,
      cancelledQuantity: 1,
      cancellableQuantity: 2, // 5 − 2 − 1;刻意選四個值互不相等,避免任一擺錯位置仍然過
    });
  });

  it('🔴 已到貨 ≠ 整個品項不可取消:買 5 到貨 2 → 仍可取消 3(A8a2 :395-406 的式子)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow([
        { quantity: 5, ordered_quantity: 5, instock_quantity: 2, cancelled_quantity: 0 },
      ]),
    );
    expect(res.items[0]?.quantitySummary?.cancellableQuantity).toBe(3);
  });

  it('全數到貨 → 可取消 0(邊界,非負)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow([
        { quantity: 5, ordered_quantity: 5, instock_quantity: 5, cancelled_quantity: 0 },
      ]),
    );
    expect(res.items[0]?.quantitySummary?.cancellableQuantity).toBe(0);
  });

  // 🔴🔴 關卡2 MF2 推翻本測試的前一版:前一版斷言「資料壞掉 → 夾成 cancellable 0」,
  //    等於把**偽裝**寫成規格 —— 「可取消 0」在畫面上與「全部到貨、本來就不能取消」長得一模一樣,
  //    員工永遠不會知道資料壞了。正解 = 走與「讀不到」同一個 fail-closed 出口。
  it('🔴 C7 不變式被違反(instock+cancelled > quantity)→ null,**不得**夾成看起來正常的「可取消 0」', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow([
        { quantity: 5, ordered_quantity: 5, instock_quantity: 4, cancelled_quantity: 3 },
      ]),
    );
    expect(res.items[0]?.quantitySummary).toBeNull();
    // 釘死「不是那個具體的錯誤形狀」:夾成 0 的舊寫法會讓下面這條拿到 0 而不是 undefined。
    expect(res.items[0]?.quantitySummary?.cancellableQuantity).toBeUndefined();
  });

  // 🔴 關卡2 MF1:adapter 端是 `as unknown as` 強轉,型別層擋不住畸形內嵌 ——
  //    `{}` / 缺欄 / 非數 會讓 row truthy 卻算出 NaN,NaN 進表單 max 屬性 = 行為未定義。
  /** 刻意繞過型別層餵畸形內嵌 —— adapter 端是 `as unknown as`,runtime 真的到得了這裡。 */
  const malformed = (v: unknown) => v as SupabaseOrderItemQuantitySummaryRow;

  it('🔴 空物件 {} → null(不得回帶 NaN 的物件)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow(malformed({})));
    expect(res.items[0]?.quantitySummary).toBeNull();
  });

  it('🔴 缺欄的單物件 → null', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow(malformed({ quantity: 5 })));
    expect(res.items[0]?.quantitySummary).toBeNull();
  });

  // 🔴🔴 這條刻意打 `ordered_quantity` 而不是 instock/cancelled —— 施工當場的教訓:
  //    我原本餵 `instock_quantity: '2'`,突變測試顯示它**不會**紅,因為 C7 那道
  //    (`'2' + 1 = '21' > 5`,字串串接後再比)會先把它擋掉 ⇒ 那條負測量到的是 C7、不是四欄驗證,
  //    等於沒有獨立判別力(memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
  //    `ordered_quantity` 既不進 C7 也不進可取消量公式 ⇒ 只有四欄驗證攔得住它。
  it('🔴 四欄齊全但 ordered_quantity 非數 → null(只有四欄驗證攔得住,C7 碰不到這欄)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow(
        malformed({
          quantity: 5,
          ordered_quantity: 'abc',
          instock_quantity: 2,
          cancelled_quantity: 1,
        }),
      ),
    );
    expect(res.items[0]?.quantitySummary).toBeNull();
  });

  it('🔴 單物件(非陣列)且四欄齊全 → 正常解析(不賭 PostgREST 回哪種形狀)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow({ quantity: 5, ordered_quantity: 4, instock_quantity: 2, cancelled_quantity: 1 }),
    );
    expect(res.items[0]?.quantitySummary).toEqual({
      quantity: 5,
      orderedQuantity: 4,
      instockQuantity: 2,
      cancelledQuantity: 1,
      cancellableQuantity: 2,
    });
  });
});
