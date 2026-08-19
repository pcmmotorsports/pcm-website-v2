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
  PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT,
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

  it('🔴 B-4:canonical 真值進得去 domain／wire，且 mapper 把它【原樣送出】(不是送 null)', () => {
    // ~~B-3:這兩處是 @ts-expect-error,型別只收 null~~ ⇒ B-4 擴型後那兩個 expect-error 變 unused(TS2578)。
    // 🔴 這格不是「刪掉了事」:它反過來釘住【真值送得到 wire】。突變=把 mapper 改回 p_notification_email: null ⇒ 必紅。
    // 🔴 domain 那一半由 **typecheck** 表達,不由 runtime 斷言:擴型前這一行是 `@ts-expect-error`,
    //    擴型後它編得過。~~原本這裡還 expect 了 domainInput.notificationEmail~~ —— 那是斷言
    //    「剛剛寫進 object literal 的值還在」,任何 mapper 突變都不會讓它紅(codex 關卡2 nit 5)。
    const domainInput: PlaceOrderInput = { ...input(), notificationEmail: 'real@example.com' };

    const args: CreateOrderRpcArgs = mapPlaceOrderToCreateOrderArgs(domainInput);
    expect(args.p_notification_email).toBe('real@example.com');
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
    // 🔴 A9c 關卡2 must-fix:本 fixture 原本**整個沒給** `invoice_status`,而尾巴那個
    //    `as SupabaseAdminOrderRow` 把「必填欄缺席」壓了下去 ⇒ mapper 會輸出 `undefined`
    //    卻仍宣稱型別是 `InvoiceStatus`,而且沒有任何測試看得見(全綠)。給真值把那條路徑補上。
    invoice_status: 'voided', // 刻意用第三態:用 DB 預設 `not_issued` 會與「根本沒讀到」難以分辨
    customers: null,
    order_items: [item],
  } as SupabaseAdminOrderRow;
}

// ── A9c:列表側三軸正規化(**與明細側刻意不同**:列表補 0、明細 fail-closed 回 null)────────
const listSummaryOf = (over: Partial<AdminItemEmbed>) =>
  mapSupabaseAdminOrderRowToSummary(adminRow(adminItem(over))).lines[0]!.quantitySummary;

describe('mapSupabaseAdminOrderRowToSummary — A9c 發票三態', () => {
  it('🔴 `invoice_status` 真的被讀進 `invoiceStatus`(不是型別上宣稱、實際 undefined)', () => {
    // 關卡2 抓到:fixture 缺這欄時 mapper 會輸出 `undefined` 卻仍宣稱是 `InvoiceStatus`,
    // 而且**沒有任何測試看得見**。這條就是那個缺口的守門 —— 它同時釘住「有讀」與「值沒被改寫」。
    const summary = mapSupabaseAdminOrderRowToSummary(adminRow(adminItem({})));
    expect(summary.invoiceStatus).toBe('voided');
    expect(summary.invoiceStatus).toBeDefined();
  });
});

describe('mapSupabaseAdminOrderRowToSummary — A9c 列表側三軸正規化', () => {
  it('有摘要列 → 四軸直送 + cancellable = quantity − instock − cancelled', () => {
    // 對照組:證明「補 0」不是無條件發生。四個值互不相等 ⇒ 任兩軸接錯線都紅。
    expect(
      listSummaryOf({
        quantity: 5,
        order_item_quantity_summary: [
          { quantity: 5, ordered_quantity: 4, instock_quantity: 2, cancelled_quantity: 1, shipped_quantity: 2 },
        ],
      } as Partial<AdminItemEmbed>),
    ).toEqual({
      quantity: 5,
      orderedQuantity: 4,
      instockQuantity: 2,
      shippedQuantity: 2,
      cancelledQuantity: 1,
      cancellableQuantity: 2,
    });
  });

  it('🔴 缺摘要列 → 三軸補 0,但**分母用品項自己的 quantity**(不是 0)', () => {
    // 母 plan row 26 逐字「無列 = **三個** 0」—— 三個指的是軸;`quantity` 是 `order_items.quantity`
    // 的去正規化副本。補成 0 會讓訂貨欄顯示「0/0」= 分母憑空消失(A11a-4 才看得到,這裡先釘住)。
    expect(listSummaryOf({ quantity: 3 })).toEqual({
      quantity: 3,
      orderedQuantity: 0,
      instockQuantity: 0,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: 3,
    });
  });

  it('🔴🔴 壞列(C7 違反 / NaN / 缺欄)也走同一個補 0 出口 —— 刻意的,代價釘在這裡', () => {
    // 明細側對這些輸入 fail-closed 回 `null`(停用該品項的取消);列表側**沒有動作可停**、
    // 型別又是非 nullable ⇒ 只能補 0。後果:**「資料損壞」與「真的還沒訂」在列表上長得一模一樣**。
    // 這條的作用是把代價釘成規格、讓下一個人看得見,而不是讓它靜靜發生。
    // ⇒ 列表取消入口(A13)進來時**不得**吃本欄,要走明細那支 `| null` 的讀法。
    const broken: Array<Record<string, unknown>> = [
      { quantity: 2, ordered_quantity: 0, instock_quantity: 2, cancelled_quantity: 1, shipped_quantity: 2 }, // C7:2+1 > 2
      { quantity: Number.NaN, ordered_quantity: 0, instock_quantity: 0, cancelled_quantity: 0, shipped_quantity: 0 },
      {}, // 缺欄
    ];
    for (const row of broken) {
      expect(
        listSummaryOf({ quantity: 2, order_item_quantity_summary: [row] } as Partial<AdminItemEmbed>),
      ).toEqual({
        quantity: 2,
        orderedQuantity: 0,
        instockQuantity: 0,
        shippedQuantity: 0,
        cancelledQuantity: 0,
        cancellableQuantity: 2,
      });
    }
  });
});

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
    // invoice_status / payment_channel 在 schema 是 NOT NULL string(數法=
    // `grep -n "^          invoice_status: string" …/database.types.ts`,落筆當下 `:1487` / `:1492`)
    // ⇒ 給最小合法值;本組測試不讀這兩欄。
    payment_channel: 'none',
    payment_method: null,
    paid_at: null,
    // OD 片 2:orders.customer_user_id 為 NOT NULL(`database.types.ts:1503` 生成型別 `string`)
    // ⇒ fixture 給最小合法值;客人明細入口的映射由本檔另一組測試釘。
    customer_user_id: 'cu-1',
    subtotal: 1000,
    shipping_fee: 0,
    discount_total: 0,
    total: 1000,
    shipping_method: 'home',
    shipping_address_snapshot: null,
    invoice: null,
    invoice_number: null,
    invoice_amount: null,
    // 🔴 A9c 關卡2 must-fix:原本寫 `'pending'` —— 那**不是** `orders_invoice_status_check` 的合法值
    //    (三值只有 `not_issued` / `issued` / `voided`,migration `20260714120000:117`)。
    //    本檔沒有任何斷言讀這欄,所以這個契約外的值一直被遮著。A9c 讓 `InvoiceStatus` 在列表側
    //    開始承重 ⇒ 順手改成合法值,免得被當成「原來 pending 也可以」的先例。
    invoice_status: 'issued',
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
        ...(summary === undefined ? {} : { order_item_quantity_summary: summary }),
      },
    ],
  };
}

// OD 片 2(需求檔 §0-J J-4):詳情頁「客人明細入口」的資料線。
describe('mapSupabaseAdminOrderDetailRowToDetail — customerUserId(OD 片 2)', () => {
  it('🔴 customer_user_id 原樣映到 customerUserId(入口要拿它連 /customers/[id])', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow(undefined));
    expect(res.customerUserId).toBe('cu-1');
  });

  // ⚠️ 這格原本寫成「embed 整個缺時仍要有值」,但 base fixture 的 `customers` **本來就是 null**
  //    ⇒ 相同輸入、零新增判別力(codex 關卡2 nit 抓到)。改成擋「值被寫死」這個真實錯法。
  it('🔴 值跟著 row 走、不是寫死:換一個 customer_user_id,映射結果要跟著換', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail({
      ...detailRow(undefined),
      customer_user_id: 'cu-2',
    });
    expect(res.customerUserId).toBe('cu-2');
  });

  /**
   * 🔴 fail-closed 負測(codex 關卡2 important:原本直送會產出型別說 `string`、實際 `undefined`
   * 的值,下游拼成 `/customers/undefined` 而**沒有任何一步失敗**)。
   * DB 端 `uuid NOT NULL` 保證的是「列裡有值」,不是「wire row 裡有這個鍵」——
   * 投影退版時整個鍵會消失,那正是這三格在守的形狀。
   */
  it.each([
    ['鍵整個不存在(投影退版)', {}],
    ['值是空字串(拼出來會變 /customers/)', { customer_user_id: '' }],
    ['值不是字串(wire 腐壞)', { customer_user_id: 123 as unknown as string }],
  ])('🔴 %s → customerUserId 收斂成 null,不得產出壞路徑', (_label, override) => {
    const row = { ...detailRow(undefined), ...override };
    if ('customer_user_id' in override === false) {
      delete (row as { customer_user_id?: string }).customer_user_id;
    }
    const res = mapSupabaseAdminOrderDetailRowToDetail(row);
    expect(res.customerUserId).toBeNull();
  });
});

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
        { quantity: 5, ordered_quantity: 4, instock_quantity: 2, cancelled_quantity: 1, shipped_quantity: 2 },
      ]),
    );
    expect(res.items[0]?.quantitySummary).toEqual({
      quantity: 5,
      orderedQuantity: 4,
      instockQuantity: 2,
      shippedQuantity: 2,
      cancelledQuantity: 1,
      cancellableQuantity: 2, // 5 − 2 − 1;刻意選四個值互不相等,避免任一擺錯位置仍然過
    });
  });

  it('🔴 已到貨 ≠ 整個品項不可取消:買 5 到貨 2 → 仍可取消 3(A8a2 :395-406 的式子)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow([
        { quantity: 5, ordered_quantity: 5, instock_quantity: 2, cancelled_quantity: 0, shipped_quantity: 2 },
      ]),
    );
    expect(res.items[0]?.quantitySummary?.cancellableQuantity).toBe(3);
  });

  it('全數到貨 → 可取消 0(邊界,非負)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow([
        { quantity: 5, ordered_quantity: 5, instock_quantity: 5, cancelled_quantity: 0, shipped_quantity: 5 },
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
        { quantity: 5, ordered_quantity: 5, instock_quantity: 4, cancelled_quantity: 3, shipped_quantity: 4 },
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
          shipped_quantity: 2,
          cancelled_quantity: 1,
        }),
      ),
    );
    expect(res.items[0]?.quantitySummary).toBeNull();
  });

  it('🔴 單物件(非陣列)且五欄齊全 → 正常解析(不賭 PostgREST 回哪種形狀)', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(
      detailRow({ quantity: 5, ordered_quantity: 4, instock_quantity: 2, cancelled_quantity: 1, shipped_quantity: 2 }),
    );
    expect(res.items[0]?.quantitySummary).toEqual({
      quantity: 5,
      orderedQuantity: 4,
      instockQuantity: 2,
      shippedQuantity: 2,
      cancelledQuantity: 1,
      cancellableQuantity: 2,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // L0(2026-08-13):第四軸 `shipped_quantity`
  //
  // 🔴🔴 **本組存在的第一個理由是一個我自己製造的假綠**:補這一軸時我把既有 fixture 的
  //    `shipped_quantity` 全部設成**等於 `instock_quantity`** —— 那樣的話,mapper 若把
  //    `instockQuantity` 誤抄進 `shippedQuantity`,**每一格都還是綠的**。
  //    ⇒ 下面第一格刻意讓 `shipped ≠ instock`,那才是真的在驗接線。
  //    (memory `feedback_fixture-value-makes-guard-vacuous` 同族:fixture 的值讓斷言失去意義。)
  // ─────────────────────────────────────────────────────────────
  describe('L0 — shipped 軸', () => {
    it('🔴 `shipped ≠ instock` 才有判別力:到貨 4 出貨 1 ⇒ 兩欄各自透傳、不得互抄', () => {
      const res = mapSupabaseAdminOrderDetailRowToDetail(
        detailRow({ quantity: 5, ordered_quantity: 5, instock_quantity: 4, cancelled_quantity: 0, shipped_quantity: 1 }),
      );
      expect(res.items[0]?.quantitySummary?.instockQuantity, '到貨軸被出貨軸蓋掉').toBe(4);
      expect(res.items[0]?.quantitySummary?.shippedQuantity, '出貨軸抄了到貨軸的值').toBe(1);
    });

    it('🔴 `cancellableQuantity` **不減 shipped**(減了 = 重複扣,因為 shipped ⊆ instock)', () => {
      // 買 5、到貨 4、出貨 4、取消 0 ⇒ 可取消 = 5 − 4 − 0 = **1**。
      // 若有人「順手」寫成 `quantity − instock − cancelled − shipped` = 5−4−0−4 = **−3**(夾成 0)
      // ⇒ 畫面會顯示「不能取消」,而實際上還有 1 件沒到貨、可以取消。
      const res = mapSupabaseAdminOrderDetailRowToDetail(
        detailRow({ quantity: 5, ordered_quantity: 5, instock_quantity: 4, cancelled_quantity: 0, shipped_quantity: 4 }),
      );
      expect(res.items[0]?.quantitySummary?.cancellableQuantity).toBe(1);
    });

    it('🔴 C9 違反(`shipped > instock`)→ 走 fail-closed 出口回 null,**不夾值**', () => {
      // Sean 2026-08-05 拍板「出貨必先到貨、無直送」⇒ DB CHECK `oiqs_shipped_le_instock` 保證。
      // 違反 = 資料已損壞 ⇒ 同 C7 那條的處置:回 null,不夾成合法值假裝正常。
      const res = mapSupabaseAdminOrderDetailRowToDetail(
        detailRow({ quantity: 5, ordered_quantity: 5, instock_quantity: 2, cancelled_quantity: 0, shipped_quantity: 3 }),
      );
      expect(res.items[0]?.quantitySummary).toBeNull();
    });

    it('🔴 邊界:`shipped === instock` 合法(不是違反),要正常解析', () => {
      // 上一格的正向對照 —— 少了它,把判準寫成 `>=` 也會全綠。
      const res = mapSupabaseAdminOrderDetailRowToDetail(
        detailRow({ quantity: 5, ordered_quantity: 5, instock_quantity: 3, cancelled_quantity: 0, shipped_quantity: 3 }),
      );
      expect(res.items[0]?.quantitySummary?.shippedQuantity).toBe(3);
    });

    it('🔴 `shipped_quantity` 缺欄 / 非數 → 當作沒讀到(回 null),不是當 0', () => {
      // 🔴 這格擋的是「MF1 那串 `Number.isFinite` 忘了加第五欄」:漏加的話 `shipped` 會是 undefined,
      //    而 `undefined >= quantity` 恆 false ⇒ 「已出貨」永遠判不出來,**零錯誤訊息**。
      const res = mapSupabaseAdminOrderDetailRowToDetail(
        detailRow({
          quantity: 5,
          ordered_quantity: 5,
          instock_quantity: 3,
          cancelled_quantity: 0,
          shipped_quantity: Number.NaN,
        }),
      );
      expect(res.items[0]?.quantitySummary).toBeNull();
    });
  });
});

// ── M-4b E10 A9g-2:在途扣款閘的 fail-closed 轉換 ──
//
// 🔴 承重點:`'clear'` 是**唯一**能給按的值,而它必須同時滿足「觀察完整」與「全 failed / 零筆」。
//    「沒讀到」與「只讀到子集」都必須落在 `'unknown'`;把它們翻成 `'clear'`
//    = 畫面放行、送出必被 A8a2 拒,而那是動到錢的路徑。
// 🔴 三態(非兩個 boolean)是關卡2 codex MF1 的折入:兩個 boolean 讓呼叫端可以只讀一半,
//    而「沒讀到」時那一半恰好長得跟「沒有在途」一樣 ⇒ 型別層面就不該給出那個誤用機會。

function detailRowWithAttempts(
  attempts?: { status: string }[] | null,
): SupabaseAdminOrderDetailRow {
  const base = detailRow([
    { quantity: 5, ordered_quantity: 0, instock_quantity: 0, cancelled_quantity: 0, shipped_quantity: 0 },
  ]);
  return attempts === undefined
    ? base
    : ({ ...base, payment_charge_attempts: attempts } as SupabaseAdminOrderDetailRow);
}

describe('mapSupabaseAdminOrderDetailRowToDetail — A9g-2 在途扣款閘 fail-closed', () => {
  it("🔴 內嵌鍵不存在(投影退版)→ 'unknown'(不得當成「沒有在途扣款」)", () => {
    expect(mapSupabaseAdminOrderDetailRowToDetail(detailRowWithAttempts(undefined))
      .chargeAttemptGate).toBe('unknown');
  });

  it("🔴 null → 'unknown'", () => {
    expect(mapSupabaseAdminOrderDetailRowToDetail(detailRowWithAttempts(null))
      .chargeAttemptGate).toBe('unknown');
  });

  it("零筆(真的沒扣款過)→ 'clear'(這才是唯一能給按的值)", () => {
    expect(mapSupabaseAdminOrderDetailRowToDetail(detailRowWithAttempts([]))
      .chargeAttemptGate).toBe('clear');
  });

  it("全 failed → 'clear'(A8a2 允許集合:全終態 failed 可取消)", () => {
    expect(
      mapSupabaseAdminOrderDetailRowToDetail(
        detailRowWithAttempts([{ status: 'failed' }, { status: 'failed' }]),
      ).chargeAttemptGate,
    ).toBe('clear');
  });

  // 🔴 關卡2 codex MF5:原本只測 `pending` 與一個虛構的未來字串 ⇒ 有人把判定改成
  //    「只擋這兩個值」的白名單也全綠。DB `status` CHECK 現為四值
  //    pending/charged/failed/released(`20260624120000:46`)⇒ 三個非 failed 值逐一測。
  for (const status of ['pending', 'charged', 'released']) {
    it(`🔴 DB 現有狀態 '${status}' → 'blocked'(即使同單其他筆都 failed)`, () => {
      expect(
        mapSupabaseAdminOrderDetailRowToDetail(
          detailRowWithAttempts([{ status: 'failed' }, { status }, { status: 'failed' }]),
        ).chargeAttemptGate,
      ).toBe('blocked');
    });
  }

  it("🔴 未知/新增的狀態值 → 一律 'blocked'(否定式判定,不是列舉白名單)", () => {
    // DB 端日後新增狀態值時,呼叫端要自動偏保守;列舉白名單的寫法會漏判成「可取消」。
    expect(
      mapSupabaseAdminOrderDetailRowToDetail(
        detailRowWithAttempts([{ status: 'some_future_status_nobody_wrote_yet' }]),
      ).chargeAttemptGate,
    ).toBe('blocked');
  });

  it("🔴 觸及上限 → 'unknown'(看到的是子集,不能宣稱沒有在途)", () => {
    // 看到的 50 筆全是 failed,但第 51 筆可能就是在途的 ⇒ 必須 fail-closed。
    expect(
      mapSupabaseAdminOrderDetailRowToDetail(
        detailRowWithAttempts(
          Array.from({ length: PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT }, () => ({ status: 'failed' })),
        ),
      ).chargeAttemptGate,
    ).toBe('unknown');
  });

  it("🔴 截斷 + 看到在途 → 'blocked' 壓過 'unknown'(兩種文案不能互相吃掉)", () => {
    const rows = Array.from({ length: PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT }, () => ({
      status: 'failed',
    }));
    rows[0] = { status: 'pending' };
    expect(mapSupabaseAdminOrderDetailRowToDetail(detailRowWithAttempts(rows)).chargeAttemptGate)
      .toBe('blocked');
  });

  // 🔴 關卡2 codex MF4:上面那條「觸及上限」用同一個常數造資料 ⇒ 把常數改成 1001 也全綠,
  //    但伺服器 max-rows(~~production 實測 1000~~ ⇒ **2026-08-18 起是 2000**;
  //    值以 `packages/adapters/src/supabase/mappers/order.ts:406` 為準,這裡不重寫數字)會先截斷、我們永遠判不出來。
  //    單元測試看不見伺服器設定,能釘住的只有常數本身落在合理區間(對齊
  //    `ORDER_NOTES_EMBED_LIMIT` / `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT` 的既有守門形狀)。
  it('🔴 上限常數必須嚴格小於伺服器 max-rows、且大於 0', () => {
    expect(PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT).toBeGreaterThan(0);
    expect(PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT).toBeLessThan(1000);
  });

  // 🔴 R1 F3 那條防線自己也要被測:上面每一條 fixture 都是陣列 ⇒ **把 `Array.isArray(...)`
  //    正規化整行拿掉,它們照樣全綠**,「兩種形狀都吃」就只是一句沒被驗過的宣稱
  //    (真回物件時 `.some` 直接 TypeError = 明細頁炸掉)。
  //    ⚠️ 這是**防禦**測試:生成型別 `isOneToOne: false`(數法=`grep -n -A 2
  //    "payment_charge_attempts_order_id_fkey" …/database.types.ts`,落筆當下 `:1684-1686`)
  //    ⇒ 規則上不會發生;留著只因賭錯的代價是整頁炸掉(關卡2 codex nit1 更正原本的錯誤理由)。
  it('🔴 內嵌回單物件(to-one 形狀)且是在途 → blocked、不炸', () => {
    expect(
      mapSupabaseAdminOrderDetailRowToDetail({
        ...detailRowWithAttempts([]),
        payment_charge_attempts: { status: 'pending' },
      } as SupabaseAdminOrderDetailRow).chargeAttemptGate,
    ).toBe('blocked');
  });

  // 🔴 關卡2 R2 codex MF1:單物件**只有一筆 failed** 時,原本走「長度 1 的完整清單」那條
  //    ⇒ 回 `'clear'` = 誤放行。這個形狀我們根本沒預期會發生,它證明不了「沒有其他在途筆」
  //    ⇒ 只能 `'unknown'`。把單物件退回當成完整清單,本條就紅。
  it("🔴 內嵌回單物件且只有 failed → 'unknown'(非預期形狀證明不了完整,絕不 clear)", () => {
    expect(
      mapSupabaseAdminOrderDetailRowToDetail({
        ...detailRowWithAttempts([]),
        payment_charge_attempts: { status: 'failed' },
      } as SupabaseAdminOrderDetailRow).chargeAttemptGate,
    ).toBe('unknown');
  });
});

describe('#328 明細 mapper 的 notes 那一跳:缺鍵不得被補成空陣列', () => {
  // 🔴 這一格守的是**中間那一跳**:`order-notes.test.ts` 守 mapper 自己、
  //    `notes-timeline.test.tsx` 守畫面,但把 `?? []` 加回 `order.ts` 的那一刻,兩端都還是綠的。
  //    (同 memory「兩端各有測試但中間透傳一跳無人守」那一形狀。)
  it('🔴 `order_notes` 缺鍵(投影退版)⇒ customerNotified 為 null,不是 false', () => {
    const res = mapSupabaseAdminOrderDetailRowToDetail(detailRow());
    expect(res.customerNotified).toBeNull();
    expect(res.notesTruncated).toBe(false);
  });

  it('🔴 正向對照:帶了空陣列(真的讀到、沒備註)⇒ false', () => {
    // 沒有這格,「這一跳永遠回 null」的突變也會讓上面那格綠。
    const res = mapSupabaseAdminOrderDetailRowToDetail({ ...detailRow(), order_notes: [] });
    expect(res.customerNotified).toBe(false);
  });
});
