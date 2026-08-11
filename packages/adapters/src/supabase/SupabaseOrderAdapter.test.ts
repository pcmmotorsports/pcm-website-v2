// SupabaseOrderAdapter.test.ts — 建單 adapter 行為(M-3-S2-b2-b2、鐵則 12 建單 path)。
//
// 注入式 mock SupabaseClient 攔 .rpc(fn, args):斷言 placeOrder 呼 create_order RPC、args 為對齊契約的
// snake_case wire(quantity→qty / 複合鍵 / 發票)、回傳只 {orderId, displayId};RPC error 上拋不吞;
// 回傳格式非預期防腐壞 throw;讀路徑 deferred-stub(延 stage ③ 訂單查詢、backlog #217)reject 未實作。
// production create_order 已由 B-2 升為 9-param(第 9 參 DEFAULT NULL)；B-3 mock 同時鎖 flag-off 8 鍵相容
// 與 flag-on 9 鍵/null。database.types.ts 依 Sean Q2=A 留 B-4 重生，暫由 mapper/wire 測試守形狀。
// 真打 RPC(端到端建單)可成、留 Sean 階段①末肉眼驗;本片 mock client 單元測只驗 adapter 行為。

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type { AdminOrderFilter, PlaceOrderInput } from '@pcm/domain';
import {
  SupplierOrderNoSearchTooManyError,
  SupplierOrderNoSearchShapeError,
  OrderKeywordSearchShapeError,
  MAX_ORDER_KEYWORD_LENGTH,
} from '@pcm/domain';
import {
  SupabaseOrderAdapter,
  ORDER_LIST_SELECT,
  ADMIN_ORDER_LIST_SELECT,
  ADMIN_ORDER_DETAIL_SELECT,
  SUPPLIER_ORDER_NO_MATCH_CAP,
  SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT,
  ADMIN_ORDER_ID_IN_CAP,
  ADMIN_SEARCH_ORDERS_FN,
} from './SupabaseOrderAdapter';
import * as adapterModule from './SupabaseOrderAdapter';
import { ORDER_NOTES_EMBED_LIMIT } from './mappers/order-notes';
import { ORDER_ITEM_PROCUREMENT_EMBED_LIMIT } from './mappers/order-procurement';
import {
  ORDER_ITEMS_EMBED_LIMIT,
  PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT,
} from './mappers/order';
import {
  ORDER_CANCELLATIONS_EMBED_LIMIT,
  ORDER_CANCELLATION_ITEMS_EMBED_LIMIT,
} from './mappers/order-cancellations';

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

    // 🔴 鐵則 12:flag-off 傳給 RPC 的 args 即 mapper 8 鍵輸出(snake_case、零 price/tier/userId)
    expect(rpc).toHaveBeenCalledWith('create_order', {
      p_lines: [{ supplier_slug: 'rpm', sku: 'DCC01-G-F', qty: 3 }],
      p_address_id: 'addr-1',
      p_shipping_method: 'home',
      p_invoice: { type: 'company', carrier: undefined, title: 'PCM', taxId: '12345678', donateCode: undefined },
      p_cart_session_id: '11111111-1111-1111-1111-111111111111',
      p_terms_version: '2026-06-30', // #241 server 注入
      p_client_ip: null, // #241 best-effort(input fixture 未帶 → null)
      p_client_ua: null,
    });
    expect(res).toEqual({ orderId: 'o1', displayId: 'PCM-2026-0001' });
  });

  it('B-3 flag-on marker：呼叫同一 RPC 時帶第 9 參數 p_notification_email:null', async () => {
    const { client, rpc } = makeClient({
      data: { order_id: 'o1', display_id: 'PCM-2026-0001' },
      error: null,
    });
    const adapter: IOrderRepository = new SupabaseOrderAdapter(client);

    await adapter.placeOrder(input({ notificationEmail: null }));

    expect(rpc).toHaveBeenCalledWith(
      'create_order',
      expect.objectContaining({ p_notification_email: null }),
    );
    expect(Object.keys(rpc.mock.calls[0]![1] as object)).toHaveLength(9);
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

// ── listSummariesByCustomer:account 訂單列表讀(M-3、RLS own-only)──
// mock from('orders').select(ORDER_LIST_SELECT).eq('customer_user_id', id).neq('payment_status','unpaid').order('created_at', desc) 鏈;
// .order() 為終端、await 回 {data, error}。
function makeListClient(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const neq = vi.fn().mockReturnValue({ order });
  const eq = vi.fn().mockReturnValue({ neq });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, neq, order };
}

describe('SupabaseOrderAdapter.listSummariesByCustomer + ORDER_LIST_SELECT 守門', () => {
  it('🔴 codex C1/N2:ORDER_LIST_SELECT byte-equal 白名單(零 unit_price/line_total/product_snapshot/經銷價/PII)', () => {
    expect(ORDER_LIST_SELECT).toBe(
      'id, display_id, created_at, payment_status, fulfillment_status, total, order_items(quantity)',
    );
  });

  it('查詢鏈 orders / select(ORDER_LIST_SELECT) / eq(customer_user_id) / order(created_at desc);row → OrderListItem', async () => {
    const { client, from, select, eq, neq, order } = makeListClient({
      data: [
        {
          id: 'o1',
          display_id: 'PCM-2099-0007',
          created_at: '2099-04-15T10:00:00Z',
          payment_status: 'paid',
          fulfillment_status: 'shipped',
          total: 12345,
          order_items: [{ quantity: 2 }, { quantity: 1 }],
        },
      ],
      error: null,
    });
    const res = await new SupabaseOrderAdapter(client).listSummariesByCustomer('c1');
    expect(from).toHaveBeenCalledWith('orders');
    // 🔴 N2:select 確實以 ORDER_LIST_SELECT(module const)被呼叫、非另傳 inline 字串
    expect(select).toHaveBeenCalledWith(ORDER_LIST_SELECT);
    expect(eq).toHaveBeenCalledWith('customer_user_id', 'c1'); // own-only 應用層縱深
    expect(neq).toHaveBeenCalledWith('payment_status', 'unpaid'); // #249 治標:藏 unpaid 孤兒單
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false }); // 新到舊(Q3)
    expect(res).toEqual([
      {
        id: 'o1',
        displayId: 'PCM-2099-0007',
        createdAt: '2099-04-15T10:00:00Z',
        paymentStatus: 'paid',
        fulfillmentStatus: 'shipped',
        total: { amount: 12345, currency: 'TWD' },
        itemCount: 3, // Σquantity 2+1
      },
    ]);
  });

  it('空結果 → []', async () => {
    const { client } = makeListClient({ data: [], error: null });
    await expect(
      new SupabaseOrderAdapter(client).listSummariesByCustomer('c1'),
    ).resolves.toEqual([]);
  });

  it('查詢 error → 裸 throw(caller try/catch 退空陣列、頁面不 500)', async () => {
    const { client } = makeListClient({ data: null, error: new Error('connection refused') });
    await expect(
      new SupabaseOrderAdapter(client).listSummariesByCustomer('c1'),
    ).rejects.toThrow();
  });
});

// ── listOrderSummariesForAdmin:後台訂單列表(M-4a、service_role 全表、雙軸+次要篩選 + server 分頁 + count)──
// mock from('orders').select(ADMIN_ORDER_LIST_SELECT,{count}).eq/in/is/or(...)*.order('created_at',desc).range(offset,offset+limit-1)。
// filter 方法可鏈(回自身 builder);order 回 {range};range 為終端、await 回 {data, error, count}。
function makeAdminListClient(result: { data: unknown; error: unknown; count: number | null }) {
  const range = vi.fn().mockResolvedValue(result);
  const order = vi.fn();
  order.mockReturnValue({ order, range }); // order 可鏈兩次(created_at 主鍵+id 次鍵)再 range
  const eq = vi.fn();
  const is = vi.fn();
  const inFn = vi.fn(); // D-1b 多勾選 .in(('in' 是保留字、local 取名 inFn)
  const or = vi.fn(); // D-1b code 混勾「未設定」→ 內嵌資源 .or
  const gte = vi.fn(); // #347-3b 建立日期下界
  const lt = vi.fn(); //  #347-3b 建立日期上界(半開區間 ⇒ lt 不是 lte)
  const builder = { eq, is, in: inFn, or, gte, lt, order };
  gte.mockReturnValue(builder);
  lt.mockReturnValue(builder);
  eq.mockReturnValue(builder); // query = query.eq(...) 保持可鏈
  is.mockReturnValue(builder); // query = query.is(...) 保持可鏈(A9w3 後只服務負向斷言)
  inFn.mockReturnValue(builder);
  or.mockReturnValue(builder);
  const select = vi.fn().mockReturnValue(builder);
  const from = vi.fn().mockReturnValue({ select });
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
    eq,
    is,
    in: inFn,
    or,
    gte,
    lt,
    order,
    range,
  };
}

/** L6 預設隱藏規則的 `.or()` 字面(module scope:多處斷言共用同一個真相)。 */
const L6_HIDE_OR = 'payment_channel.neq.tappay,payment_status.neq.unpaid';

describe('SupabaseOrderAdapter.listOrderSummariesForAdmin + ADMIN_ORDER_LIST_SELECT 守門', () => {
  it('🔴 鐵則 12:ADMIN_ORDER_LIST_SELECT byte-equal 白名單(每商品一列:tier + customers(name) + order_items 成交價+per-item 狀態 + V-3b vehicle_snapshot + brand join;D-2 起 orders 層 workflow_status/version 退出投影)', () => {
    expect(ADMIN_ORDER_LIST_SELECT).toBe(
      'id, display_id, created_at, payment_status, fulfillment_status, total, order_source, payment_channel, display_position, cancelled_at, tier_at_checkout, invoice_status, customer_user_id, customers(name), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, workflow_status, version, vehicle_snapshot, product_variants(products(brands(name))), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity))',
    );
  });

  // A9w3:原本這裡有一條「篩選版投影(order_items!inner)與主常數逐欄相同」的 byte-equal 守門。
  // 該常數的唯一用途是九碼篩選,篩選在 A9w2 下架、下推在本片移除 ⇒ 常數與守門一併退場。

  // 🔴 M-4a Slice D-1a 有意識鬆綁(依據 docs/specs/2026-07-15-m4a-order-list-redesign-slice-d-plan.md §0 經銷價護欄①):
  //「每商品一列」需 tier_at_checkout(會員等級)+ order_items 成交價(unit_price/line_total)+ product_snapshot(品名)
  // + brand join → 由 forbidden 移出。admin server-render、SSO 閘後、絕不進非 admin client bundle(WorkflowStatusCell 亦 server component)。
  // 🔴 縱深防線:brand join 穿越帶 price_store/price_by_tier/price_general 的 product_variants/products,故下列**經銷價成本欄
  // 永久 forbidden**(投影只取 brands(name);任一成本欄誤入即被本測試擋下)。
  it('🔴 鐵則 12:投影不含任何經銷價 / 成本欄名、且無 select("*")(成交價/tier 已於 D-1a 有意識放行、非成本欄)', () => {
    const forbidden = [
      '*',
      'price_store',
      'price_by_tier',
      'priceByTier',
      'price_general',
      'cost',
      'tappay_rec_trade_id',
      'shipping_address_snapshot',
      'invoice',
      'cart_session_id',
      'address_id',
    ];
    // 🔴 **A9c 只放行 `invoice_status` 這一欄,`invoice` 家族其餘全部仍禁**(Sean Q2b=A:列表只顯示
    //    未開/已開/作廢三態、**砍掉載具別**)。做法是先把該欄剝掉再查 `invoice` 這個 token ——
    //    不是把 `invoice` 從清單拿掉。差別在判別力:剝掉之後,`invoice`(jsonb,含 carrier/taxId/title)、
    //    `invoice_number`、`invoice_amount` 任一誤入**仍會被擋下**;整條拿掉則全開。
    //    突變證:把投影裡的 `invoice_status` 換成 `invoice`,本測試轉紅。
    const projection = ADMIN_ORDER_LIST_SELECT.split('invoice_status').join('');
    for (const token of forbidden) {
      expect(projection).not.toContain(token);
    }
    // 剝除法自身的前提:被剝的那欄真的在投影裡(不在 = 上面整段變成量一個沒改過的字串)。
    expect(ADMIN_ORDER_LIST_SELECT).toContain('invoice_status');
    // ⚠️ 誠實邊界(關卡2 nit):本條**被上面那條 byte-equal 嚴格蘊含** —— 投影是整串比對,任何改動
    //    都會先讓它紅。保留的理由只有一個:失敗訊息會說出**為什麼**不能加那些欄,byte-equal 只會說
    //    「兩個長字串不一樣」。不宣稱它擋得住 byte-equal 擋不住的東西。
  });

  it('🔴 D-1a 每商品一列:投影確含 tier_at_checkout + order_items 成交價 + brand join(brands(name))', () => {
    expect(ADMIN_ORDER_LIST_SELECT).toContain('tier_at_checkout');
    expect(ADMIN_ORDER_LIST_SELECT).toContain('order_items(');
    expect(ADMIN_ORDER_LIST_SELECT).toContain('unit_price');
    expect(ADMIN_ORDER_LIST_SELECT).toContain('line_total');
    expect(ADMIN_ORDER_LIST_SELECT).toContain('product_variants(products(brands(name)))');
  });

  // ⚠️ 誠實邊界(Codex R1 nit-2):本測試 mock 只驗 wire 參數(投影常數/filter 下推)與 mapper 形狀,
  // **不模擬 PostgREST !inner 的實際過濾**(fixture 刻意含一筆不符篩選的 null 品項=順驗 mapper 容缺;
  // 真 PostgREST「只回命中品項、count 以父單計」= Sean 部署後開站實測驗收點,列晨報)。
  it('查詢鏈 orders / select(主投影,{count:exact}) / 四軸下推(D-1b 多勾選軸走 in)/ order(created_at desc) / range;row → AdminOrderSummary', async () => {
    const { client, from, select, eq, in: inFn, order, range } = makeAdminListClient({
      data: [
        {
          id: 'o1',
          display_id: 'PCM-2099-0001',
          created_at: '2099-04-15T10:00:00Z',
          payment_status: 'paid',
          fulfillment_status: 'notOrdered',
          total: 5200,
          order_source: 'web',
          payment_channel: 'tappay',
          display_position: null,
          cancelled_at: null,
          tier_at_checkout: 'store', // 車行
          // 🔴 A9c:刻意用 `issued` 而非 DB 預設 `not_issued` —— 用預設值會讓「mapper 根本沒讀這欄、
          //    下游自己填了預設」與「真的讀到了」長得一樣(fixture 值讓斷言失去意義的同族)。
          invoice_status: 'issued',
          customer_user_id: 'cu-list-A', // 2b-0:同客人閘的識別(兩個 fixture 刻意不同值:撞號的話 mapper 硬寫死也會全綠)
          customers: { name: '王小明' }, // forward FK many-to-one → 單物件
          order_items: [
            {
              id: 'oi-1',
              variant_sku: 'BMS-13OEM-G-F',
              quantity: 2,
              unit_price: 2500,
              line_total: 5000,
              product_snapshot: { sku: 'BMS-13OEM-G-F', title: '下導流' },
              workflow_status: 'received_confirmed', // D-2 per-item 真相
              version: 3,
              vehicle_snapshot: { kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' }, // V-3b
              product_variants: { products: { brands: { name: 'Bonamici' } } }, // variant→product→brand
              // 🔴 A9c:本品項**有**摘要列。四個值刻意互不相等且非 0 ⇒ 任兩軸接錯線都會紅。
              order_item_quantity_summary: [
                { quantity: 2, ordered_quantity: 2, instock_quantity: 1, cancelled_quantity: 0 },
              ],
            },
            {
              id: 'oi-2',
              variant_sku: 'SUP-ONLY-SKU',
              quantity: 1,
              unit_price: 200,
              line_total: 200,
              product_snapshot: { sku: 'SUP-ONLY-SKU', title: '螺絲包' },
              workflow_status: null, // 未設定
              version: 1,
              vehicle_snapshot: null, // V-3b:未帶車款
              product_variants: null, // variant_id null(supplier_slug+sku 型)→ brand null 容缺
              // 🔴 A9c:本品項**刻意沒有** `order_item_quantity_summary` 鍵 —— 該表由 A4a trigger
              //    惰性建列,沒被採購也沒被取消過的品項就是沒有那一列。這一格量的是列表側的正規化:
              //    三軸補 0、**但分母 `quantity` 必須是品項自己的 1**(補 0 會變「0/0」= 分母憑空消失)。
            },
          ],
        },
      ],
      error: null,
      count: 37,
    });

    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      {
        paymentStatus: 'paid',
        fulfillmentStatus: 'notOrdered',
        orderSources: ['web'],
        paymentChannels: ['tappay'],
      },
      { limit: 20, offset: 40 },
    );

    expect(from).toHaveBeenCalledWith('orders');
    // A9w3:九碼篩選退場後投影恆為主常數(不再有 !inner 版)。
    expect(select).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    // 四軸篩選各下推一次 DB where(非前端過濾);雙軸單值 .eq、多勾選軸 .in(D-1b)。
    expect(eq).toHaveBeenCalledWith('payment_status', 'paid');
    expect(eq).toHaveBeenCalledWith('fulfillment_status', 'notOrdered');
    expect(inFn).toHaveBeenCalledWith('order_source', ['web']);
    expect(inFn).toHaveBeenCalledWith('payment_channel', ['tappay']);
    expect(eq).toHaveBeenCalledTimes(2);
    expect(inFn).toHaveBeenCalledTimes(2);
    expect(order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
    expect(order).toHaveBeenNthCalledWith(2, 'id', { ascending: false }); // n1 次鍵:同秒單分頁穩定
    expect(range).toHaveBeenCalledWith(40, 59); // offset 40、limit 20 → [40, 59] 含端
    expect(res).toEqual({
      items: [
        {
          id: 'o1',
          displayId: 'PCM-2099-0001',
          createdAt: '2099-04-15T10:00:00Z',
          customerUserId: 'cu-list-A',
          customerName: '王小明',
          paymentStatus: 'paid',
          fulfillmentStatus: 'notOrdered',
          orderSource: 'web',
          paymentChannel: 'tappay',
          total: { amount: 5200, currency: 'TWD' },
          displayPosition: null,
          cancelledAt: null,
          tierAtCheckout: 'store',
          invoiceStatus: 'issued', // A9c:三態直送(非 DB 預設值 ⇒ 真的讀到了)
          lines: [
            {
              id: 'oi-1',
              variantSku: 'BMS-13OEM-G-F',
              title: '下導流',
              brand: 'Bonamici',
              quantity: 2,
              unitPrice: { amount: 2500, currency: 'TWD' },
              lineTotal: { amount: 5000, currency: 'TWD' },
              workflowStatus: 'received_confirmed',
              version: 3,
              vehicle: { kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'search' },
              // A9c 有摘要列:四軸直送 + `cancellableQuantity = 2 − 1 − 0`(算式與明細側同一支)
              quantitySummary: {
                quantity: 2,
                orderedQuantity: 2,
                instockQuantity: 1,
                cancelledQuantity: 0,
                cancellableQuantity: 1,
              },
            },
            {
              id: 'oi-2',
              variantSku: 'SUP-ONLY-SKU',
              title: '螺絲包',
              brand: null,
              quantity: 1,
              unitPrice: { amount: 200, currency: 'TWD' },
              lineTotal: { amount: 200, currency: 'TWD' },
              workflowStatus: null,
              version: 1,
              vehicle: null,
              // 🔴 A9c 缺摘要列 → 列表側正規化:三軸 0,**分母是品項自己的 `quantity: 1`、不是 0**。
              //    若這裡寫成 `quantity: 0`,列表的訂貨欄(A11a-4)會顯示「0/0」。
              quantitySummary: {
                quantity: 1,
                orderedQuantity: 0,
                instockQuantity: 0,
                cancelledQuantity: 0,
                cancellableQuantity: 1,
              },
            },
          ],
        },
      ],
      total: 37,
      // #347-2a:未做關鍵字搜尋 ⇒ 沒截斷、且 matchCount 是 `null`(「沒搜過」)
      //          而不是 `0`(「搜了、零命中」)—— 兩者的區分正是這個欄位存在的理由。
      keywordTruncated: false,
      keywordMatchCount: null,
    });
  });

  it('🔴 A9w3:硬塞 workflowStatuses 也不得下推、不得換投影(九碼篩選已退場)', async () => {
    // 🔴 型別上這個欄位已經不存在(A9w3 從 `AdminOrderFilter` 移除)⇒ 只能繞型別塞。
    //    這正是要量的事:舊呼叫端(或反序列化回來的舊 URL 狀態)把它帶進來時,
    //    adapter 必須**完全無視**,而不是靜默走回 !inner 投影或內嵌欄下推。
    //    原本這裡是三條測試(未設定哨兵 / code 混勾 or / 非法形狀 fail-closed),
    //    隨下推整段移除;留這一條當「不得復活」的守門。
    const { client, select, or, is, in: inFn } = makeAdminListClient({
      data: [],
      error: null,
      count: 0,
    });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { workflowStatuses: ['paid_wait', null] } as AdminOrderFilter,
      { limit: 20 },
    );
    expect(select).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    // 🔴 L6 起「`.or` 完全沒被呼叫」不再是有效代理 —— 預設的隱藏規則自己就用 `.or`。
    //    這條要證的是「**單號/九碼沒有被下推**」,所以改成比對字面(意圖不變、只是量對東西)。
    // 🔴 等價強度(code-reviewer important 7):只比兩個具名字面的話,日後有人用**別的**欄名
    //    復活 or 下推,這條不會紅。改成「or 的呼叫集合恰好只有 L6 的隱藏規則那一筆」。
    expect(or.mock.calls).toEqual([[L6_HIDE_OR]]);
    expect(is).not.toHaveBeenCalled();
    expect(inFn).not.toHaveBeenCalled();
  });

  it('無篩選 → 完全不下推 eq(全表);offset 預設 0 → range(0, limit-1)', async () => {
    const { client, eq, range } = makeAdminListClient({ data: [], error: null, count: 0 });
    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      {},
      { limit: 20 },
    );
    expect(eq).not.toHaveBeenCalled();
    expect(range).toHaveBeenCalledWith(0, 19);
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
  });

  it('取消單(cancelled_at 非 null)+ 客人 join 缺(customers null)→ cancelledAt 帶值、customerName null', async () => {
    const { client } = makeAdminListClient({
      data: [
        {
          id: 'o2',
          display_id: 'PCM-2099-0002',
          created_at: '2099-05-01T00:00:00Z',
          payment_status: 'unpaid',
          fulfillment_status: 'notOrdered',
          total: 999,
          order_source: 'manual_phone',
          payment_channel: 'cash',
          display_position: 3,
          cancelled_at: '2099-05-02T00:00:00Z',
          tier_at_checkout: 'general', // 一般
          // 🔴 A9c 關卡2/R1 連動:本 fixture 原本沒有這欄,`toEqual` 對 `undefined` 屬性是**盲的**
          //    ⇒ 「mapper 根本沒讀到」一路全綠。改用 `narrowInvoiceStatus` 後才被逼出來。
          invoice_status: 'not_issued',
          customer_user_id: 'cu-list-B', // 2b-0:同客人閘的識別(兩個 fixture 刻意不同值:撞號的話 mapper 硬寫死也會全綠)
          customers: null,
          order_items: null, // embed 缺 → lines []
        },
      ],
      error: null,
      count: 1,
    });
    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      {},
      { limit: 20 },
    );
    expect(res.items[0]).toEqual({
      id: 'o2',
      displayId: 'PCM-2099-0002',
      createdAt: '2099-05-01T00:00:00Z',
      invoiceStatus: 'not_issued', // A9c
      customerUserId: 'cu-list-B',
      customerName: null, // join 缺 → null 防禦
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'notOrdered',
      orderSource: 'manual_phone',
      paymentChannel: 'cash',
      total: { amount: 999, currency: 'TWD' },
      displayPosition: 3,
      cancelledAt: '2099-05-02T00:00:00Z',
      tierAtCheckout: 'general',
      lines: [],
    });
  });

  it('防禦:customers embed 若回陣列形狀(PostgREST cardinality 落差)→ 取首個 name(非 undefined)', async () => {
    const { client } = makeAdminListClient({
      data: [
        {
          id: 'o3',
          display_id: 'PCM-2099-0003',
          created_at: '2099-06-01T00:00:00Z',
          payment_status: 'paid',
          fulfillment_status: 'shipped',
          total: 100,
          order_source: 'web',
          payment_channel: 'tappay',
          display_position: null,
          cancelled_at: null,
          customers: [{ name: '李大同' }], // 陣列形狀
        },
      ],
      error: null,
      count: 1,
    });
    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      {},
      { limit: 20 },
    );
    expect(res.items[0]?.customerName).toBe('李大同');
  });

  it('查詢 error → 裸 throw(caller〔admin 頁〕try/catch 退錯誤態、頁面不 500)', async () => {
    const { client } = makeAdminListClient({
      data: null,
      error: new Error('connection refused'),
      count: null,
    });
    await expect(
      new SupabaseOrderAdapter(client).listOrderSummariesForAdmin({}, { limit: 20 }),
    ).rejects.toThrow();
  });
});

// ── findAdminOrderDetail:後台訂單明細(M-4a Slice B、明細專用 PII 白名單)──
// mock from('orders').select(ADMIN_ORDER_DETAIL_SELECT).eq('id', id).maybeSingle()。
// 🔴 A9a-2 起 order/limit 各**兩對**(order_notes 一對、order_items.order_item_procurement 一對)
//    ⇒ mock 不能再寫死「order 之後只會有一個 limit」的線性鏈,改成可無限鏈接的同一個物件
//    (寫死鏈長的話,少送一對 order/limit 也一樣全綠 = 承重測試量不到東西)。
function makeDetailClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const chain: Record<string, unknown> = { maybeSingle };
  const limit = vi.fn().mockReturnValue(chain);
  const order = vi.fn().mockReturnValue(chain);
  chain.limit = limit;
  chain.order = order;
  const eq = vi.fn().mockReturnValue(chain);
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, order, limit, maybeSingle };
}

const DETAIL_ROW = {
  id: 'o1',
  display_id: 'PCM-2099-0001',
  created_at: '2099-04-15T10:00:00Z',
  payment_status: 'paid',
  fulfillment_status: 'notOrdered',
  order_source: 'web',
  payment_channel: 'tappay',
  payment_method: 'tappay',
  paid_at: '2099-04-15T10:05:00Z',
  subtotal: 5000,
  shipping_fee: 200,
  discount_total: 0,
  total: 5200,
  shipping_method: 'home',
  shipping_address_snapshot: { name: '王小明', phone: '0912345678', line: '台北市信義區 1 號' },
  invoice: { type: 'personal', taxId: '', title: '', carrier: '', donateCode: '' },
  invoice_number: null,
  invoice_amount: null,
  invoice_status: 'not_issued',
  cancelled_at: null,
  cancelled_reason: null,
  version: 7,
  customers: { name: '王小明', email: 'a@b.c', phone: '0912345678' },
  order_items: [
    {
      id: 'oi-1',
      variant_sku: 'BMS-13OEM-G-F',
      quantity: 2,
      unit_price: 2500,
      line_total: 5000,
      product_snapshot: { sku: 'BMS-13OEM-G-F', spec: { finish: 'Glossy' }, title: '下導流' },
      // 🔴 A9w3 起這兩欄**已不在明細投影裡**,fixture 刻意仍餵 —— 量的是「就算 DB 回了,
      //    mapper 也不得把它們映射出去」(對照下方 `toEqual` 的精確比對)。
      workflow_status: 'received_unconfirmed',
      version: 4,
      // A9a-2:採購內嵌(同樣刻意給倒序 + 一筆已停用供應商 —— 排序在 mapper、停用照常顯示)
      order_item_procurement: [
        {
          id: 'p-2',
          supplier_id: 'sup-b',
          allocated_quantity: 1,
          received_quantity: 0,
          reply_status: 'out_of_stock',
          contact_channel: 'LINE',
          submitted_at: '2026-04-16T02:00:00+00:00',
          supplier_order_no: null,
          exception_reason: '原廠缺料',
          expected_arrival_date: '2026-05-30',
          first_ordered_at: '2026-04-16T02:00:00+00:00',
          status_changed_at: '2026-04-16T03:00:00+00:00',
          created_at: '2026-04-16T02:00:00+00:00',
          suppliers: { label: 'Webike JP', is_active: false }, // 停用:既有列照常顯示(S1b :183)
        },
        {
          id: 'p-1',
          supplier_id: 'sup-a',
          allocated_quantity: 1,
          received_quantity: 1,
          reply_status: 'confirmed',
          contact_channel: 'email',
          submitted_at: '2026-04-15T02:00:00+00:00',
          supplier_order_no: 'SO-123',
          exception_reason: null,
          expected_arrival_date: null,
          first_ordered_at: '2026-04-15T02:00:00+00:00',
          status_changed_at: null,
          created_at: '2026-04-15T02:00:00+00:00',
          suppliers: [{ label: 'RPM Carbon', is_active: true }], // 陣列形(embed 推斷不穩)也要吃得下
        },
      ],
    },
  ],
  // A9a-1:備註內嵌(此處刻意給「時序倒著、且有一筆更正」的形狀 —— 排序與 U6 都在 mapper)
  order_notes: [
    {
      id: 'n-2',
      note_type: 'internal',
      body: '客人說先不要出',
      channel: null,
      occurred_at: null,
      author: 'sean',
      corrects_note_id: 'n-1',
      created_at: '2026-04-15T12:00:00+00:00',
    },
    {
      id: 'n-1',
      note_type: 'customer_notified',
      body: '已用 LINE 告知缺貨',
      channel: 'line',
      occurred_at: '2026-04-15T10:30:00+00:00',
      author: 'sean',
      corrects_note_id: null,
      created_at: '2026-04-15T11:00:00+00:00',
    },
  ],
};

describe('SupabaseOrderAdapter.findAdminOrderDetail + ADMIN_ORDER_DETAIL_SELECT 守門', () => {
  it('🔴 鐵則 12:ADMIN_ORDER_DETAIL_SELECT byte-equal(明細專用、含 PII;D-2 起 orders 層 workflow_status 退出;🔴 A9w3 起 order_items 的 workflow_status+version 亦退出(明細頁九碼下拉已下架);A9a-1 加 order_notes 內嵌;A9a-2 加 order_item_procurement(suppliers) 兩層內嵌;A9g-1 加 order_item_quantity_summary 內嵌;A9g-2 加 payment_charge_attempts(status);A9g-3 加 order_cancellations 兩層內嵌;A9d2-2b 取消歷程加 idempotency_key、payload_hash 仍不取)', () => {
    expect(ADMIN_ORDER_DETAIL_SELECT).toBe(
      'id, display_id, created_at, payment_status, fulfillment_status, order_source, payment_channel, payment_method, paid_at, subtotal, shipping_fee, discount_total, total, shipping_method, shipping_address_snapshot, invoice, invoice_number, invoice_amount, invoice_status, cancelled_at, cancelled_reason, version, customers(name, email, phone), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, order_item_procurement(id, supplier_id, allocated_quantity, received_quantity, reply_status, contact_channel, submitted_at, supplier_order_no, exception_reason, expected_arrival_date, first_ordered_at, status_changed_at, created_at, suppliers(label, is_active)), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity)), order_notes(id, note_type, body, channel, occurred_at, author, corrects_note_id, created_at), payment_charge_attempts!payment_charge_attempts_order_id_fkey(status), order_cancellations(id, reason_code, reason_detail, actor, idempotency_key, created_at, order_cancellation_items(id, order_item_id, cancelled_quantity))',
    );
    // 🔴 A9d2-2b:`idempotency_key` 進來了、`payload_hash` **沒有**,而且兩者當初是同一句話裡的
    //    「內部機制」—— 只改判其中一顆是刻意的。byte-equal 那條把兩者一起釘住,但它紅的時候
    //    人只會看到一長串字串;這條讓「哪一顆該在、哪一顆不該在」直接寫成兩行可讀的斷言。
    expect(ADMIN_ORDER_DETAIL_SELECT).toContain('actor, idempotency_key, created_at');
    expect(ADMIN_ORDER_DETAIL_SELECT).not.toContain('payload_hash');
  });

  // 🔴 A9a-1:order_notes 只該出現在**明細**投影(內部備註;建表檔 :17-19「一個 byte 都不能放 orders」,
  // 而 orders 對登入客人整表開放 SELECT)。列表投影漏進去 = 內部備註走上客人看得到的那條路。
  it('🔴 order_notes 只在明細投影、不得滲入列表投影', () => {
    expect(ADMIN_ORDER_DETAIL_SELECT).toContain('order_notes(');
    expect(ADMIN_ORDER_LIST_SELECT).not.toContain('order_notes');
  });

  // 🔴 A9a-2:採購真相表(供應商身分 / 單號 / 異常原因)同屬 service_role only —— 建表檔
  //    20260729020000:16-18「一個 byte 都不能進 orders / order_items」。三條列表投影都要盯:
  //    **ORDER_LIST_SELECT 是 storefront 那條**(authenticated client、客人自己的訂單列表),
  //    它漏進去就是把上游供應商直接送到客人的瀏覽器 = 客人可以繞過 PCM。
  it('🔴 採購/供應商欄只在明細投影、不得滲入任何列表投影(含 storefront 的 ORDER_LIST_SELECT)', () => {
    expect(ADMIN_ORDER_DETAIL_SELECT).toContain('order_item_procurement(');
    expect(ADMIN_ORDER_DETAIL_SELECT).toContain('suppliers(');

    // 🔴 關卡2 codex nit3:**不逐一列常數名** —— 手寫清單只擋得住今天已經存在的那三條,
    //    日後在本檔加第四條投影常數(例如出貨列表)不會有任何測試轉紅。改成從 module 反射
    //    取出**所有** `*_SELECT` 字串匯出,扣掉明細那條,其餘一律不准出現採購/供應商 token。
    //    (仍擋不住「別的檔案自己寫 inline select」—— 那面沒有守門、誠實記在 handoff。)
    //    ⚠️ 用 `includes('SELECT')` 而不是 `endsWith('_SELECT')`:後者曾經會漏掉
    //    `ADMIN_ORDER_LIST_SELECT_ITEM_STATUS_FILTERED`(該常數已隨 A9w3 退場,字面留作歷史理由
    //    —— 下一個不以 `_SELECT` 結尾的投影常數會再踩同一個坑)——
    //    「用命名 pattern 收集守門對象」本身就是一個會漏的假設,所以下面那條前提斷言是必要的。
    const otherSelects = Object.entries(adapterModule).filter(
      ([name, value]) =>
        name.includes('SELECT') && typeof value === 'string' && name !== 'ADMIN_ORDER_DETAIL_SELECT',
    );
    // 🔴 前提斷言:反射真的抓到**全部**該抓的(抓到 0 條 = 下面整個迴圈空轉 = 恆真守門;
    //    抓到 2 條 = 有一條投影沒被守到)。日後新增投影常數,這條會先紅、逼人來看一眼。
    expect(otherSelects.map(([name]) => name).sort()).toEqual([
      'ADMIN_ORDER_LIST_SELECT',
      'ORDER_LIST_SELECT',
    ]);
    for (const [name, value] of otherSelects) {
      for (const token of ['order_item_procurement', 'supplier', 'exception_reason']) {
        expect(`${name}:${value}`).not.toContain(token);
      }
    }
  });

  // 🔴 A9g-1:三軸數量摘要(已訂/已到貨/已取消)同屬營運內部事實 —— 客人看得到「已向上游訂了幾件」
  //    等於看得到採購節奏。守門形狀逐字照上面那條 A9a-2(反射取全部投影、不手寫常數名),
  //    理由相同:手寫清單只擋得住今天存在的那三條,日後新增第四條投影不會有任何測試轉紅。
  // 🔴 這條**刻意分兩段**(關卡A R1 I-3):三軸欄位對 storefront 與 admin 列表是**不同**的東西。
  //    master plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` **row 40**(A9c;原寫的
  //    `:387` 是過期行號、現指到 row 23 —— 用 row 號當主錨)
  //    明寫「三軸欄位進 `ADMIN_ORDER_LIST_SELECT`」= 已排定的合法去處。
  //    若把兩者寫成同一個「全部列表都禁」的迴圈,A9c 當天這條必紅,而**最省事的修法是刪掉整段**
  //    —— 連 storefront 那半永久性的保護一起陪葬。所以先把「永不放寬」與「待 A9c 解禁」拆開。
  it('🔴 三軸數量摘要:storefront 投影**永久**零滲入(客人看得到已訂幾件 = 看得到採購節奏)', () => {
    expect(ADMIN_ORDER_DETAIL_SELECT).toContain('order_item_quantity_summary(');

    // storefront 那條是 authenticated client 打的、回到客人瀏覽器 ⇒ 這段**沒有**未來解禁計畫。
    for (const token of [
      'order_item_quantity_summary',
      'instock_quantity',
      'ordered_quantity',
      'cancelled_quantity',
    ]) {
      expect(`ORDER_LIST_SELECT:${ORDER_LIST_SELECT}`).not.toContain(token);
    }
  });

  it('🟢 三軸數量摘要:admin 列表投影**已由 A9c 合法解禁**,但只准那四欄', () => {
    // 🔴 本條與上一條的差別是**壽命**,不是嚴格度。A9c(2026-08-06)如期把它翻面;
    //    **上面 storefront 那條原封未動** —— 前一棒逐字交代「改它的人請只改這條」,照辦。
    const adminListSelects = Object.entries(adapterModule).filter(
      ([name, value]) =>
        name.includes('SELECT') &&
        typeof value === 'string' &&
        name !== 'ADMIN_ORDER_DETAIL_SELECT' &&
        name !== 'ORDER_LIST_SELECT',
    );
    // 🔴 前提斷言(同 A9a-2):反射真的抓到全部該抓的;抓到 0 條 = 下面迴圈空轉 = 恆真守門。
    expect(adminListSelects.map(([name]) => name).sort()).toEqual(['ADMIN_ORDER_LIST_SELECT']);
    for (const [, value] of adminListSelects) {
      const projection = String(value); // filter 已保證是 string,Object.entries 的型別不會 narrow
      // 🔴 **解禁 ≠ 開放**:內嵌逐字只有那四欄。用完整片段比對、不是 `toContain('order_item_quantity_summary')`
      //    —— 後者對「多帶一欄」完全盲,該表日後加欄時會靜默滲進 admin 列表投影。
      expect(projection).toContain(
        'order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity)',
      );
      // 且**只內嵌一次**:重複內嵌會讓 PostgREST 回意料外的形狀,而 mapper 只讀第一筆。
      expect(projection.split('order_item_quantity_summary').length - 1).toBe(1);
      // ⚠️ 誠實邊界(關卡2 nit):這兩條同樣被 byte-equal 蘊含,留的是失敗訊息的可讀性,
      //    不是額外的判別力。真正**獨立**的價值在反射前提斷言(上面那條 `toEqual([...])`):
      //    日後新增第四條 admin 列表投影常數時,只有它會轉紅。
    }
    // ⚠️ 誠實邊界(同 A9a-2 那條):這兩條守門**只**看得到本檔的投影常數 ——
    //    別的檔案自己寫 inline `select('…')` 打這張表,這裡完全擋不到。
    //    2026-08-05 A9g-1 實查 `apps/` + `packages/` 目前無任何 inline select 觸及該表。
  });

  // 🔴 A9g-2:扣款嘗試表帶 rec_trade_id / bank_transaction_id / fallback_token_hash 等金流識別碼。
  //    本投影的既有紅線就寫著「零 tappay_rec_trade_id」⇒ 內嵌**只准**帶 status 一欄。
  it('🔴 payment_charge_attempts 內嵌只取 status,零金流識別碼欄', () => {
    // 🔴 2026-08-10 熱修起帶 FK hint(orders↔本表有兩條 FK,裸內嵌 = PGRST201;理由見常數 docstring)。
    //    這條照舊只驗「內嵌逐字只有 status 一欄」,hint 名是 PostgREST 回應逐字給的。
    expect(ADMIN_ORDER_DETAIL_SELECT).toContain(
      'payment_charge_attempts!payment_charge_attempts_order_id_fkey(status)',
    );
    for (const token of [
      'rec_trade_id',
      'bank_transaction_id',
      'fallback_token_hash',
      'customer_user_id',
      'failure_observed_status',
      'last_settle_error',
    ]) {
      expect(ADMIN_ORDER_DETAIL_SELECT).not.toContain(token);
    }
  });

  it('🔴 扣款嘗試**永久**不得滲入 storefront 投影(客人不該看到自己的扣款重試軌跡)', () => {
    for (const token of ['payment_charge_attempts', 'rec_trade_id', 'bank_transaction_id']) {
      expect(`ORDER_LIST_SELECT:${ORDER_LIST_SELECT}`).not.toContain(token);
    }
  });

  // 🔴 A9d2-2b(Fable 關卡2 F1):兄弟三表(採購 / 三軸 / 扣款)都有具名 token 守門,**取消歷程這組沒有** ——
  //    而本片剛把 adapter docstring 的宣稱擴到了新加的 `idempotency_key`(「永不得進三條 storefront 投影,
  //    守門測試逐條盯」)。那句話當時是假的:唯一會紅的只有 byte-equal,而它在別人合法改列表投影時
  //    本來就要跟著改 ⇒ 取消內嵌搭順風車混進去,零測試轉紅。
  //    `scripts/storefront-projection-leak-guard.test.ts` 也接不住:它只掃 `apps/storefront/src`,
  //    而這些投影常數住在 `packages/adapters` —— **在那道守門的掃描根之外**。
  // ⚠️ **本條蓋到哪為止**(關卡2 codex R2 must-fix,收窄我原本寫的「明細以外的**任何**投影」):
  //    反射只收得到本 module 名稱含 `SELECT` 的**具名常數**。本檔已經有一個漏網實例 ——
  //    `findTotal` 的 inline `.select('total')`(`SupabaseOrderAdapter.ts:254`,storefront 打得到)。
  //    ⚠️ 精確說(關卡2 R4 nit 收窄):沒人看得見的是**掃描根之外**的 inline select ——
  //    `apps/storefront/src` 裡手寫的 inline select,leak-guard 掃原始碼全文時看得見。
  //    落在 `packages/` 的這一面**誠實留著**(同 A9a-2 / 三軸兩條既有的邊界字面)。
  // 🔴 欄名 token 不是恆真的冗餘(codex R2 nit 的反面):禁掉兩個表名只擋得住「內嵌那兩張表」,
  //    擋不住日後有人開一個 `cancellation_history` 之類的 view 再投影同名欄 —— 那條字面裡沒有表名。
  // 🔴 **不收 `actor`**(codex R2 nit):它是跨稽核表的通用欄名,未來合法的 `order_refund_jobs(actor)`
  //    這種 admin 投影會被誤紅 —— 誤紅的守門會被下一個人關掉,而不是修好。
  it('🔴 取消歷程(含 idempotency_key)**永久**不得滲入本檔具名的另外三條投影常數', () => {
    const otherSelects = Object.entries(adapterModule).filter(
      ([name, value]) =>
        name.includes('SELECT') && typeof value === 'string' && name !== 'ADMIN_ORDER_DETAIL_SELECT',
    );
    // 🔴 前提斷言(同 A9a-2):反射真的抓到全部該抓的;抓到 0 條 = 下面迴圈空轉 = 恆真守門。
    expect(otherSelects.map(([name]) => name).sort()).toEqual([
      'ADMIN_ORDER_LIST_SELECT',
      'ORDER_LIST_SELECT',
    ]);
    for (const [name, value] of otherSelects) {
      for (const token of [
        'order_cancellations',
        'order_cancellation_items',
        'idempotency_key',
        'payload_hash',
      ]) {
        expect(`${name}:${value}`).not.toContain(token);
      }
    }
  });

  it('🔴 鐵則 12:明細投影仍零成本/經銷/金流識別欄、無 select("*")(PII 解禁 ≠ 全解禁)', () => {
    const forbidden = [
      '*',
      'price_store',
      'price_by_tier',
      'priceByTier',
      'cost',
      'tappay_rec_trade_id',
      'tier_at_checkout',
      'cart_session_id',
      'address_id',
      'wallet',
    ];
    for (const token of forbidden) {
      expect(ADMIN_ORDER_DETAIL_SELECT).not.toContain(token);
    }
  });

  // 🔴 A9a-1:`.limit(n, { referencedTable })` 是截斷偵測的**承重** —— 沒送出這個上限,邊界就回到
  //    伺服器 max-rows(專案設定、程式釘不住)手上,而 mapper 的 `notesTruncated` 會恆 false。
  //    配套的 `.order(created_at DESC)` 同樣是承重:少了它,截斷時回哪 200 筆未定義(審查 R2 nit4)。
  it('查詢鏈 orders / select(明細白名單) / eq(id) / order+limit(order_notes) / maybeSingle;row → AdminOrderDetail(jsonb 防禦解析)', async () => {
    const { client, from, select, eq, order, limit } = makeDetailClient({ data: DETAIL_ROW, error: null });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(from).toHaveBeenCalledWith('orders');
    expect(select).toHaveBeenCalledWith(ADMIN_ORDER_DETAIL_SELECT);
    expect(eq).toHaveBeenCalledWith('id', 'o1');
    expect(order).toHaveBeenCalledWith('created_at', {
      referencedTable: 'order_notes',
      ascending: false,
    });
    expect(limit).toHaveBeenCalledWith(ORDER_NOTES_EMBED_LIMIT, { referencedTable: 'order_notes' });
    // 🔴 A9a-2:兩層深的路徑字面就是承重 —— 拼錯(例如漏了 `order_items.` 前綴)PostgREST 會**靜默忽略**
    //    那個參數,limit 不生效 ⇒ 截斷判定恆 false。路徑的 production 實測見 adapter 的常數 docstring。
    expect(order).toHaveBeenCalledWith('created_at', {
      referencedTable: 'order_items.order_item_procurement',
      ascending: false,
    });
    expect(limit).toHaveBeenCalledWith(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT, {
      referencedTable: 'order_items.order_item_procurement',
    });
    // 🔴 關卡2 codex MF4:`created_at` 單鍵在**截斷邊界**有並列時,回哪一筆未定義 ——
    //    mapper 的 tie-break 只排得了已經拿到的列,救不回被切掉的那筆。兩個內嵌都要次鍵。
    expect(order).toHaveBeenCalledWith('id', { referencedTable: 'order_notes', ascending: false });
    expect(order).toHaveBeenCalledWith('id', {
      referencedTable: 'order_items.order_item_procurement',
      ascending: false,
    });
    // 🔴 關卡2 codex MF2:order_items 自己也要上限 —— 沒有它,品項被伺服器 max-rows 切掉時
    //    per-item 的 procurementTruncated 會連同品項一起消失、旗標全是 false。
    expect(order).toHaveBeenCalledWith('id', { referencedTable: 'order_items', ascending: true });
    // 🔴 A9g-2(R1 F2 補):扣款嘗試那三行原本零斷言 —— **刪掉它們整份測試照樣全綠**,
    //    而 limit 不生效 ⇒ 閘恆 `'clear'` ⇒ 在途扣款閘靜默失效(動到錢的方向)。
    expect(order).toHaveBeenCalledWith('created_at', {
      referencedTable: 'payment_charge_attempts',
      ascending: false,
    });
    expect(order).toHaveBeenCalledWith('id', {
      referencedTable: 'payment_charge_attempts',
      ascending: false,
    });
    // 🔴 關卡2 codex nit4:上面兩條只證「兩個 .order 都呼叫過」,**對調順序仍全綠** ——
    //    但主排序會從 created_at 變成 id,取到的就不再是「最新 50 筆」。次鍵順序要自己被釘住。
    const attemptOrderKeys = order.mock.calls
      .filter(([, opts]) => opts?.referencedTable === 'payment_charge_attempts')
      .map(([column]) => column);
    expect(attemptOrderKeys).toEqual(['created_at', 'id']);
    // 🔴 A9g-3:取消歷程兩層都要 order + limit。母 plan row 3 驗收逐字要求
    //    「`.order()` + limit + `id` 次鍵 + `truncated` 旗標」—— 少任一個,
    //    伺服器回哪 N 筆未定義、跨請求可能是不同子集,而截斷旗標會恆 false。
    // 🔴 R1 must-fix:原本只取 column、丟掉 opts.ascending ⇒ **把兩行翻成 ascending: true 也全綠**,
    //    而截斷時留下的會變成「最舊 100 筆」而不是最新的。方向與次序都要被釘住。
    const cancellationOrders = order.mock.calls
      .filter(([, opts]) => opts?.referencedTable === 'order_cancellations')
      .map(([column, opts]) => [column, opts?.ascending]);
    expect(cancellationOrders).toEqual([
      ['created_at', false],
      ['id', false],
    ]);
    expect(limit).toHaveBeenCalledWith(ORDER_CANCELLATIONS_EMBED_LIMIT, {
      referencedTable: 'order_cancellations',
    });
    expect(order).toHaveBeenCalledWith('id', {
      referencedTable: 'order_cancellations.order_cancellation_items',
      ascending: true,
    });
    expect(limit).toHaveBeenCalledWith(ORDER_CANCELLATION_ITEMS_EMBED_LIMIT, {
      referencedTable: 'order_cancellations.order_cancellation_items',
    });
    expect(limit).toHaveBeenCalledWith(PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT, {
      referencedTable: 'payment_charge_attempts',
    });
    expect(limit).toHaveBeenCalledWith(ORDER_ITEMS_EMBED_LIMIT, { referencedTable: 'order_items' });
    expect(res).toEqual({
      id: 'o1',
      displayId: 'PCM-2099-0001',
      createdAt: '2099-04-15T10:00:00Z',
      paymentStatus: 'paid',
      fulfillmentStatus: 'notOrdered',
      orderSource: 'web',
      paymentChannel: 'tappay',
      paymentMethod: 'tappay',
      paidAt: '2099-04-15T10:05:00Z',
      subtotal: { amount: 5000, currency: 'TWD' },
      shippingFee: { amount: 200, currency: 'TWD' },
      discountTotal: { amount: 0, currency: 'TWD' },
      total: { amount: 5200, currency: 'TWD' },
      shippingMethod: 'home',
      shippingAddress: { name: '王小明', phone: '0912345678', line: '台北市信義區 1 號' },
      customer: { name: '王小明', email: 'a@b.c', phone: '0912345678' },
      invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: null, donateCode: null }, // 空字串 → null
      invoiceNumber: null,
      invoiceAmount: null,
      invoiceStatus: 'not_issued',
      cancelledAt: null,
      cancelledReason: null,
      version: 7,
      items: [
        {
          id: 'oi-1',
          variantSku: 'BMS-13OEM-G-F',
          title: '下導流',
          spec: { finish: 'Glossy' },
          quantity: 2,
          unitPrice: { amount: 2500, currency: 'TWD' },
          lineTotal: { amount: 5000, currency: 'TWD' },
          // A9w3:明細品項不再有 workflowStatus / version(九碼下拉已在 A9w1 下架)——
          // `toEqual` 是精確比對,這兩鍵若被接回投影,本條會立刻紅。
          // A9a-2:採購列依 createdAt ASC 重排(投影給的是倒序);兩種 embed 形狀都正規化成同一形
          procurements: [
            {
              id: 'p-1',
              supplierId: 'sup-a',
              supplierLabel: 'RPM Carbon', // 陣列形 embed
              supplierIsActive: true,
              allocatedQuantity: 1,
              receivedQuantity: 1,
              replyStatus: 'confirmed',
              contactChannel: 'email',
              submittedAt: '2026-04-15T02:00:00+00:00',
              supplierOrderNo: 'SO-123',
              exceptionReason: null,
              expectedArrivalDate: null,
              firstOrderedAt: '2026-04-15T02:00:00+00:00',
              statusChangedAt: null,
              createdAt: '2026-04-15T02:00:00+00:00',
            },
            {
              id: 'p-2',
              supplierId: 'sup-b',
              supplierLabel: 'Webike JP',
              supplierIsActive: false, // 停用的供應商:既有採購列照常回、不藏(S1b :183)
              allocatedQuantity: 1,
              receivedQuantity: 0,
              replyStatus: 'out_of_stock',
              contactChannel: 'LINE',
              submittedAt: '2026-04-16T02:00:00+00:00',
              supplierOrderNo: null,
              exceptionReason: '原廠缺料',
              expectedArrivalDate: '2026-05-30',
              firstOrderedAt: '2026-04-16T02:00:00+00:00',
              statusChangedAt: '2026-04-16T03:00:00+00:00',
              createdAt: '2026-04-16T02:00:00+00:00',
            },
          ],
          procurementTruncated: false,
          // 🔴 A9g-1:本 fixture 的品項**沒有** order_item_quantity_summary 鍵
          //    ⇒ 正好覆蓋「缺鍵 = 不知道」這條 fail-closed 路徑,必須是 null 而不是補 0 的物件。
          quantitySummary: null,
        },
      ],
      // A9a-1:時間軸依 createdAt ASC 重排(投影給的是倒序);n-1 被 n-2 直接指向 ⇒ 已更正
      notes: [
        {
          id: 'n-1',
          noteType: 'customer_notified',
          body: '已用 LINE 告知缺貨',
          channel: 'line',
          occurredAt: '2026-04-15T10:30:00+00:00',
          author: 'sean',
          correctsNoteId: null,
          createdAt: '2026-04-15T11:00:00+00:00',
          corrected: true,
        },
        {
          id: 'n-2',
          noteType: 'internal',
          body: '客人說先不要出',
          channel: null,
          occurredAt: null,
          author: 'sean',
          correctsNoteId: 'n-1',
          createdAt: '2026-04-15T12:00:00+00:00',
          corrected: false,
        },
      ],
      customerNotified: false, // 唯一那筆 customer_notified 已被更正 ⇒ 告知義務不算履行
      notesTruncated: false,
      itemsTruncated: false,
      // 🔴 A9g-2:本 fixture 沒有 payment_charge_attempts 鍵 ⇒ 缺鍵 = 不知道 = `'unknown'`,
      //    **不是** `'clear'`。三態的用意就是讓「沒讀到」沒辦法長得跟「沒有在途扣款」一樣。
      chargeAttemptGate: 'unknown',
      // 🔴 A9g-3:本 fixture 沒有 order_cancellations 鍵 ⇒ `null`(= 沒讀到),**不是** `[]`。
      //    `[]` 是「這張單真的沒被取消過」;兩者若同形,呼叫端 `.map()` 就會把讀取失敗
      //    靜默畫成「本單從未取消」(R3 M2)。
      cancellations: null,
      cancellationsTruncated: false,
    });
  });

  // 🔴 關卡2 must-fix:上面那條(以及所有既有 fixture)都**沒有** order_cancellations 鍵 ⇒
  //    把接線改成永遠傳 undefined(例如 `mapSupabaseOrderCancellationRowsToProjection(undefined)`),
  //    查到的歷程會全被丟掉,而 adapter 與 mapper 測試**照樣全綠**。
  //    ⇒ 需要一條「真的有資料」的正向案例,證明 row 上的內嵌真的流到 DTO。
  it('🔴 內嵌有取消歷程時,真的流進 DTO(接線若改成永遠傳 undefined,本條紅)', async () => {
    const { client } = makeDetailClient({
      data: {
        ...DETAIL_ROW,
        order_cancellations: [
          {
            id: 'cx-1',
            reason_code: 'out_of_stock',
            reason_detail: null,
            actor: 'sean',
            idempotency_key: '9f8e7d6c-5b4a-4392-8172-0a1b2c3d4e5f',
            created_at: '2026-08-05T11:00:00.000000+00:00',
            order_cancellation_items: [
              { id: 'cxi-1', order_item_id: 'oi-1', cancelled_quantity: 1 },
            ],
          },
        ],
      },
      error: null,
    });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(res?.cancellationsTruncated).toBe(false);
    expect(res?.cancellations).toEqual([
      {
        id: 'cx-1',
        reasonCode: 'out_of_stock',
        reasonDetail: null,
        actor: 'sean',
        // 🔴 A9d2-2b:這顆要一路從 row 流到 DTO —— 它是員工手上的 token 與歷程列唯一對得上的鍵。
        //    `toEqual` 是全等比對 ⇒ 接線漏掉這欄本條就紅(不是「多了也算過」的子集比對)。
        idempotencyKey: '9f8e7d6c-5b4a-4392-8172-0a1b2c3d4e5f',
        createdAt: '2026-08-05T11:00:00.000000+00:00',
        items: [{ id: 'cxi-1', orderItemId: 'oi-1', cancelledQuantity: 1 }],
        itemsTruncated: false,
      },
    ]);
  });

  it('jsonb 腐壞防禦:snapshot 非物件 / spec 缺 / invoice null → 各欄 null、不 throw', async () => {
    const { client } = makeDetailClient({
      data: {
        ...DETAIL_ROW,
        shipping_address_snapshot: 'corrupted',
        invoice: null,
        customers: null,
        order_items: [
          {
            id: 'oi-x',
            variant_sku: 'X',
            quantity: 1,
            unit_price: 100,
            line_total: 100,
            product_snapshot: null,
          },
        ],
        // 🔴 #328(2026-08-11 更正):這一行原本註解寫「→ **空時間軸**」,而下面也真的斷言
        //    `customerNotified === false` —— 那是**把 fail-open 寫成規格在替它站崗**:
        //    「沒讀到」被當成「讀到了、沒人告知過客人」。現行契約是 fail-closed ⇒ `null`(無法判定)。
        order_notes: undefined, // 內嵌鍵整個缺(舊 row / 投影退版)→ 不 throw,但**不得**翻成 false
      },
      error: null,
    });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(res?.shippingAddress).toEqual({ name: null, phone: null, line: null });
    expect(res?.customer).toEqual({ name: null, email: null, phone: null });
    expect(res?.invoiceRequest.type).toBeNull();
    expect(res?.items[0]).toMatchObject({ title: null, spec: null });
    expect(res?.notes).toEqual([]);
    // 🔴 #328:null = 無法判定(不是 false = 尚未告知)。
    expect(res?.customerNotified).toBeNull();
    // 🔴 這一欄仍是 false,而且**必須**是 —— 它是畫面分辨「讀取失敗」與「被截斷」的唯一依據。
    expect(res?.notesTruncated).toBe(false);
    // 🔴 A9a-2 + 關卡2 codex MF1:採購內嵌鍵整個缺(投影退版)→ 空清單、不 throw,
    //    但 **procurementTruncated = true**(「沒問到」不等於「答案是零筆」;A10b 據此拒絕送出表單)。
    expect(res?.items[0]?.procurements).toEqual([]);
    expect(res?.items[0]?.procurementTruncated).toBe(true);
  });

  // 🔴 關卡2 codex MF2 的**方向二**:施工當場的突變 M12(把 itemsTruncated 寫死成 false)
  //    原本 111 案全綠 —— 代表那個旗標當時沒有任何斷言在量它。這條補上。
  it('🔴 品項數觸及 ORDER_ITEMS_EMBED_LIMIT ⇒ itemsTruncated = true(per-item 旗標的前提)', async () => {
    const manyItems = Array.from({ length: ORDER_ITEMS_EMBED_LIMIT }, (_, i) => ({
      id: `oi-${i}`,
      variant_sku: `SKU-${i}`,
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      product_snapshot: null,
      order_item_procurement: [],
    }));
    const { client } = makeDetailClient({
      data: { ...DETAIL_ROW, order_items: manyItems },
      error: null,
    });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(res?.itemsTruncated).toBe(true);
    // 對照:每個品項自己的採購旗標仍是 false —— 正是「per-item 旗標看不見外層截斷」那個坑
    expect(res?.items.every((i) => i.procurementTruncated === false)).toBe(true);
  });

  // 🔴 關卡2 R2 nit:上面那條的 fixture 是 `Array.from({ length: 常數 })` —— **fixture 跟著常數縮**,
  //    把上限改成 5 測試照樣綠,而真實的 200 品項訂單會被默默截斷(旗標對、資料少)。
  //    ⇒ 常數本身要有跟 fixture **脫鉤**的下界斷言。
  //    🔴 下界是**設計下界、不是量測值**:PCM 沒有量過單張訂單的品項數上限、也沒量過單一品項的採購筆數。
  //    調到低於這裡 = 有意識縮小「能完整顯示的訂單規模」,必須有人先來改這條斷言、不能順手改常數。
  it('🔴 兩個 embed 上限有下界(防「連同 fixture 一起調小」的假綠;設計下界非量測值)', () => {
    expect(ORDER_ITEMS_EMBED_LIMIT).toBeGreaterThanOrEqual(100);
    expect(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT).toBeGreaterThanOrEqual(20);
    // 上界仍是 2026-08-02 那次量測的伺服器 max-rows(嚴格低於才有意義)
    expect(ORDER_ITEMS_EMBED_LIMIT).toBeLessThan(1000);
    expect(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT).toBeLessThan(1000);
  });

  it('invoice_status 意外值(DB CHECK 外)→ fail-safe narrow 成 not_issued、發票紀錄帶值直送', async () => {
    const { client } = makeDetailClient({
      data: {
        ...DETAIL_ROW,
        invoice_status: 'weird',
        invoice_number: '60556739',
        invoice_amount: 10920,
      },
      error: null,
    });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(res?.invoiceStatus).toBe('not_issued');
    expect(res?.invoiceNumber).toBe('60556739');
    expect(res?.invoiceAmount).toEqual({ amount: 10920, currency: 'TWD' });
  });

  it('查無(maybeSingle null)→ null(caller 404);查詢 error → 裸 throw', async () => {
    const { client } = makeDetailClient({ data: null, error: null });
    await expect(new SupabaseOrderAdapter(client).findAdminOrderDetail('o-nope')).resolves.toBeNull();
    const failing = makeDetailClient({ data: null, error: new Error('connection refused') });
    await expect(
      new SupabaseOrderAdapter(failing.client).findAdminOrderDetail('o1'),
    ).rejects.toThrow();
  });
});

// ── updateAdminOrderWorkflow:後台改單(M-4a Slice C、走 admin_update_order_workflow RPC)──
function makeRpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('SupabaseOrderAdapter.updateAdminOrderWorkflow', () => {
  it('patch → jsonb wire:只放明確提供的 key(camelCase→snake_case);回 UPDATED', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    const res = await new SupabaseOrderAdapter(client).updateAdminOrderWorkflow(
      'o1',
      5,
      { shippingMethod: '宅配', invoiceStatus: 'issued' },
      'sean',
      'req-1',
    );
    expect(rpc).toHaveBeenCalledWith('admin_update_order_workflow', {
      p_order_id: 'o1',
      p_expected_version: 5,
      p_patch: { shipping_method: '宅配', invoice_status: 'issued' },
      p_actor: 'sean',
      p_request_id: 'req-1',
    });
    expect(res).toBe('UPDATED');
  });

  it('🔴 D-2(Codex R1 must-fix 1):繞型別硬塞 workflowStatus → wire 絕不含 workflow_status(orders 層停寫、adapter 不映射)', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    await new SupabaseOrderAdapter(client).updateAdminOrderWorkflow(
      'o1',
      5,
      { workflowStatus: 'shipped_done', invoiceStatus: 'issued' } as unknown as Parameters<
        SupabaseOrderAdapter['updateAdminOrderWorkflow']
      >[2],
      'sean',
      'req-1b',
    );
    const args = rpc.mock.calls[0]?.[1] as { p_patch: Record<string, unknown> };
    expect(args.p_patch).toEqual({ invoice_status: 'issued' }); // toEqual=零額外鍵、workflow_status 被丟棄
  });

  it('🔴 金流紅線:patch 只含白名單 4 欄映射(D-2 起無 workflow_status),未提供欄不進 wire(空 patch → p_patch={})', async () => {
    const { client, rpc } = makeRpcClient({ data: 'NOOP', error: null });
    await new SupabaseOrderAdapter(client).updateAdminOrderWorkflow('o1', 5, {}, 'sean', 'req-2');
    expect(rpc).toHaveBeenCalledWith(
      'admin_update_order_workflow',
      expect.objectContaining({ p_patch: {} }),
    );
  });

  it('明給 null → 清空語意透傳 wire(invoice 兩欄 null 進 p_patch)', async () => {
    const { client, rpc } = makeRpcClient({ data: 'UPDATED', error: null });
    await new SupabaseOrderAdapter(client).updateAdminOrderWorkflow(
      'o1',
      5,
      { invoiceNumber: null, invoiceAmount: null },
      'sean',
      'req-3',
    );
    expect(rpc).toHaveBeenCalledWith(
      'admin_update_order_workflow',
      expect.objectContaining({
        p_patch: { invoice_number: null, invoice_amount: null },
      }),
    );
  });

  it('CONFLICT / NOOP 碼直送', async () => {
    for (const code of ['CONFLICT', 'NOOP'] as const) {
      const { client } = makeRpcClient({ data: code, error: null });
      await expect(
        new SupabaseOrderAdapter(client).updateAdminOrderWorkflow('o1', 5, { invoiceStatus: 'voided' }, 'sean', 'r'),
      ).resolves.toBe(code);
    }
  });

  it('RPC error → 裸 throw(caller server action 收斂固定碼);非預期碼 → throw 防腐壞', async () => {
    const failing = makeRpcClient({ data: null, error: new Error('invoice_number 非法') });
    await expect(
      new SupabaseOrderAdapter(failing.client).updateAdminOrderWorkflow('o1', 5, { invoiceNumber: 'x'.repeat(65) }, 'sean', 'r'),
    ).rejects.toThrow();
    const weird = makeRpcClient({ data: 'WAT', error: null });
    await expect(
      new SupabaseOrderAdapter(weird.client).updateAdminOrderWorkflow('o1', 5, {}, 'sean', 'r'),
    ).rejects.toThrow('非預期');
  });
});

// 🔴 `SupabaseOrderAdapter.updateAdminOrderItemWorkflow` 那組 **3 條**測試,隨受測方法一併移除
//    (A9w4c 後半,2026-08-06)。order 層的 `updateAdminOrderWorkflow` 那組原封保留 —— 兩者是不同的
//    寫入面,只有 item 那支退場。

// ── M-4b E10 A9b1:單號搜尋(display_id + legacy_display_id 同時比對)───────────
// 規格 = docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 A9b1。
// 走 adapter 投影、不開 DB RPC;.or() 是字串內插 ⇒ 值必先過 normalizeOrderNumberSearch。
describe('SupabaseOrderAdapter.listOrderSummariesForAdmin — A9b1 單號搜尋', () => {
  it('舊號搜尋 → .or 同時比對 display_id 與 legacy_display_id(改號後舊號仍查得到)', async () => {
    const { client, or, select } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: 'PCM-2026-0104' },
      { limit: 20 },
    );
    expect(or).toHaveBeenCalledWith(
      'display_id.eq.PCM-2026-0104,legacy_display_id.eq.PCM-2026-0104',
    );
    // 單號搜尋不改投影(A9b1 是查詢合約、不是投影改造)
    expect(select).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
  });

  it('新 6 碼搜尋 → 同一條 .or', async () => {
    const { client, or } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: 'YWP3PC' },
      { limit: 20 },
    );
    expect(or).toHaveBeenCalledWith('display_id.eq.YWP3PC,legacy_display_id.eq.YWP3PC');
  });

  it('小寫與前後空白先正規化再內插(客服貼上的值不該查不到)', async () => {
    const { client, or } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: '  ywp3pc  ' },
      { limit: 20 },
    );
    expect(or).toHaveBeenCalledWith('display_id.eq.YWP3PC,legacy_display_id.eq.YWP3PC');
  });

  it('未給 / 空字串 → 不篩選(不呼叫 .or、也不提前回零筆)', async () => {
    const a = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(a.client).listOrderSummariesForAdmin({}, { limit: 20 });
    // 🔴 L6 起「`.or` 完全沒被呼叫」不再是有效代理 —— 預設的隱藏規則自己就用 `.or`。
    //    這條要證的是「**單號/九碼沒有被下推**」,所以改成比對字面(意圖不變、只是量對東西)。
    expect(a.or.mock.calls).toEqual([[L6_HIDE_OR]]);
    expect(a.range).toHaveBeenCalled();

    const b = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(b.client).listOrderSummariesForAdmin(
      { orderNumber: '   ' },
      { limit: 20 },
    );
    expect(b.or.mock.calls).toEqual([[L6_HIDE_OR]]);
    expect(b.range).toHaveBeenCalled();
  });

  it('🔴 fail-closed:格式不符 → 直接回零筆,且完全不查 DB(不得退化成列出全部)', async () => {
    for (const bad of ['YWP3P0', 'YWP3P', 'YWP3PCX', 'PCM-2026-104', '王小明']) {
      const { client, from, or, range } = makeAdminListClient({
        data: [{ id: 'should-never-be-returned' }],
        error: null,
        count: 999,
      });
      const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
        { orderNumber: bad },
        { limit: 20 },
      );
      expect(res, `格式不符應回零筆:${bad}`).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
      expect(from, `格式不符不該碰 DB:${bad}`).not.toHaveBeenCalled();
      expect(or).not.toHaveBeenCalled();
      expect(range).not.toHaveBeenCalled();
    }
  });

  it('🔴 .or 內插注入形狀在 adapter 層 fail-closed(回零筆、不查 DB)', async () => {
    for (const attack of [
      'YWP3PC,payment_status.eq.paid',
      'PCM-2026-0104,legacy_display_id.is.null',
      'display_id.is.null',
      'YWP3PC)',
    ]) {
      const { client, from } = makeAdminListClient({ data: [], error: null, count: 0 });
      const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
        { orderNumber: attack },
        { limit: 20 },
      );
      expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
      expect(from, `注入形狀不該碰 DB:${attack}`).not.toHaveBeenCalled();
    }
  });

  it('單號搜尋可與既有雙軸篩選並用(各自下推、互不吃掉)', async () => {
    const { client, or, eq } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: 'YWP3PC', paymentStatus: 'paid' },
      { limit: 20 },
    );
    expect(eq).toHaveBeenCalledWith('payment_status', 'paid');
    expect(or).toHaveBeenCalledWith('display_id.eq.YWP3PC,legacy_display_id.eq.YWP3PC');
  });
});

// A9b1 補強(code-reviewer nit)原本測的是「orderNumber + workflowStatuses 併用 = 同一 query
// 兩次 .or(key 分別是 `or` 與 `order_items.or`)不會互相覆蓋」。
// 🔴 A9w3 後那個情境**構造不出來**:九碼下推已移除 ⇒ 全 adapter 只剩單號那一條 .or,
//    「兩條 .or 互相覆蓋」在物理上不可能發生。留著一條假裝在測併用的測試比刪掉更糟
//    (memory `feedback_unconstructible-negative-test-means-noop-guard`)⇒ 刪那條、留下面這條
//    (它測的是單號守門本身,與九碼無關)。日後若再出現第二條 referencedTable .or,
//    這段註解就是「該把併用測試加回來」的觸發點。
describe('SupabaseOrderAdapter — A9b1 單號搜尋守門', () => {
  it('🔴 單號格式不符時,即使有其他篩選也一律回零筆、完全不查 DB', async () => {
    const { client, from } = makeAdminListClient({ data: [], error: null, count: 5 });
    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: 'BAD!', paymentStatus: 'paid' },
      { limit: 20 },
    );
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
    expect(from).not.toHaveBeenCalled();
  });
});

// ── M-4b E10 A9b2-A:依供應商單號跨單搜尋(兩段式查詢)──────────────
// 🔴 這裡**另立** client harness、不改 `makeAdminListClient` —— 本片對既有路徑零行為改動,
//    既有那些測試必須一格不動仍綠(改了就分不清「新片沒壞東西」還是「我把斷言改成配合新行為」)。
// mock:from('order_item_procurement').select(...).limit(n).filter(col,'eq',v) → 終端 await
//       from('orders') 那半邊與 makeAdminListClient 同形。
function makeSupplierSearchClient(opts: {
  proc: { data: unknown; error: unknown };
  list?: { data: unknown; error: unknown; count: number | null };
}) {
  const procFilter = vi.fn().mockResolvedValue(opts.proc);
  const procLimit = vi.fn().mockReturnValue({ filter: procFilter });
  const procOrder = vi.fn().mockReturnValue({ limit: procLimit });
  const procSelect = vi.fn().mockReturnValue({ order: procOrder });

  const listResult = opts.list ?? { data: [], error: null, count: 0 };
  const range = vi.fn().mockResolvedValue(listResult);
  const order = vi.fn();
  order.mockReturnValue({ order, range });
  const eq = vi.fn();
  const inFn = vi.fn();
  const or = vi.fn();
  const gte = vi.fn();
  const lt = vi.fn();
  const builder = { eq, is: vi.fn(), in: inFn, or, gte, lt, order };
  or.mockReturnValue(builder);
  eq.mockReturnValue(builder);
  inFn.mockReturnValue(builder);
  gte.mockReturnValue(builder);
  lt.mockReturnValue(builder);
  const listSelect = vi.fn().mockReturnValue(builder);

  const from = vi.fn((table: string) =>
    table === 'order_item_procurement' ? { select: procSelect } : { select: listSelect },
  );
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    procSelect,
    procOrder,
    procLimit,
    procFilter,
    listSelect,
    eq,
    or,
    in: inFn,
    range,
  };
}

const procRow = (orderId: string) => ({ order_items: { order_id: orderId } });

describe('SupabaseOrderAdapter.listOrderSummariesForAdmin — A9b2-A 供應商單號搜尋', () => {
  it('命中 → 第一段對採購表 eq 比對大寫欄;第二段 .in(id) 且**投影仍是主常數**', async () => {
    const h = makeSupplierSearchClient({
      proc: { data: [procRow('o-1'), procRow('o-2')], error: null },
      list: { data: [], error: null, count: 0 },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: ' so-123 ' },
      { limit: 20 },
    );
    // 第一段:比對的是 A9b2-M 的產生欄、值是正規化後的大寫形(不是使用者原輸入)
    expect(h.procSelect).toHaveBeenCalledWith('order_items!inner(order_id)');
    expect(h.procFilter).toHaveBeenCalledWith('supplier_order_no_upper', 'eq', 'SO-123');
    // 🔴 第二段的投影一個字都沒動(鐵則 12 byte-lock 白名單不因搜尋而換版本)
    expect(h.listSelect).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    expect(h.in).toHaveBeenCalledWith('id', ['o-1', 'o-2']);
  });

  it('🔴 L6-A6 供應商單號搜尋時**不套用**隱藏規則(否則命中的 tappay+unpaid 單會吐「共 0 筆」)', async () => {
    // code-reviewer must-fix 3:先前只豁免了 orderNumber,這條是遺漏不是決定。
    // 技術理由(兩個 `or=`)對這條路徑**不成立**(它走 `.in('id',…)`、不同 param);
    // 站得住的是產品理由:拿供應商給的單號反查,查不到比看到更困惑。
    const h = makeSupplierSearchClient({
      proc: { data: [procRow('o-1')], error: null },
      list: { data: [], error: null, count: 0 },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    expect(h.or).not.toHaveBeenCalled();
  });

  it('同一張訂單有多列採購 → id 去重後才進 .in', async () => {
    const h = makeSupplierSearchClient({
      proc: { data: [procRow('o-1'), procRow('o-1'), procRow('o-2')], error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    expect(h.in).toHaveBeenCalledWith('id', ['o-1', 'o-2']);
  });

  it('零命中 → 回零筆,且**第二段完全沒被打**(省一次往返、不押 .in([]) 的行為)', async () => {
    const h = makeSupplierSearchClient({ proc: { data: [], error: null } });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-NOPE' },
      { limit: 20 },
    );
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
    expect(h.listSelect).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalledWith('orders');
  });

  it('🔴 fail-closed:不合法輸入 → 回零筆,且**兩段都沒被打**(不得退化成不篩選)', async () => {
    const h = makeSupplierSearchClient({ proc: { data: [procRow('o-1')], error: null } });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-123ß' }, // 非 ASCII
      { limit: 20 },
    );
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
    expect(h.from).not.toHaveBeenCalled();
  });

  it('🔴 去重後訂單數超過上限 → 擲 TooMany,**不截斷**假裝那就是全部', async () => {
    const rows = Array.from({ length: SUPPLIER_ORDER_NO_MATCH_CAP + 1 }, (_, i) =>
      procRow(`o-${i}`),
    );
    const h = makeSupplierSearchClient({ proc: { data: rows, error: null } });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
        { supplierOrderNo: 'SO-MANY' },
        { limit: 20 },
      ),
    ).rejects.toBeInstanceOf(SupplierOrderNoSearchTooManyError);
    // 截斷式實作會走完第二段 ⇒ 這條把「悄悄回前 N 筆」那個修法釘死
    expect(h.listSelect).not.toHaveBeenCalled();
  });

  it('🔴🔴 採購列觸頂、但去重後訂單數遠低於上限 → **仍須擲錯**(階段 C must-fix 的觀察面)', async () => {
    // 這一格就是舊版(只有一道 `.limit(CAP+1)` + `ids.length > CAP`)會**全綠**的情境:
    // 列被截斷 ⇒ 我們根本不知道真正的訂單集合,而去重後只有 3 筆、遠低於 CAP
    // ⇒ 舊版會安靜地回那 3 張訂單,員工以為那就是全部 —— 正是這個上限本來要防的病。
    // 一張 PO 覆蓋大量列完全正常:A2 的業務鍵是 (order_item_id, supplier_canonical_key),
    // 一單多品項就是多列。
    const rows = Array.from({ length: SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT + 1 }, (_, i) =>
      procRow(`o-${i % 3}`),
    );
    const h = makeSupplierSearchClient({ proc: { data: rows, error: null } });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
        { supplierOrderNo: 'SO-WIDE' },
        { limit: 20 },
      ),
    ).rejects.toBeInstanceOf(SupplierOrderNoSearchTooManyError);
    expect(h.listSelect).not.toHaveBeenCalled();
  });

  it('採購列剛好觸頂上限、訂單數合法 → 正常查(邊界不誤殺;刻意取 +1 才分辨得出)', async () => {
    const rows = Array.from({ length: SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT }, (_, i) =>
      procRow(`o-${i % 10}`),
    );
    const h = makeSupplierSearchClient({ proc: { data: rows, error: null } });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-EDGE' },
      { limit: 20 },
    );
    expect(h.procLimit).toHaveBeenCalledWith(SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT + 1);
    expect(h.listSelect).toHaveBeenCalledTimes(1);
  });

  it('🔴 第一段必須帶確定性排序 —— 沒有它,分頁每頁可能拿到不同的 id 集合', async () => {
    const h = makeSupplierSearchClient({ proc: { data: [procRow('o-1')], error: null } });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    expect(h.procOrder).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('與其他篩選併用 → 同一個 query 同時下推(不是二選一)', async () => {
    const h = makeSupplierSearchClient({ proc: { data: [procRow('o-1')], error: null } });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-1', paymentStatus: 'paid' },
      { limit: 20 },
    );
    expect(h.in).toHaveBeenCalledWith('id', ['o-1']);
    expect(h.eq).toHaveBeenCalledWith('payment_status', 'paid');
  });

  it('第一段 DB error → 裸 throw(對齊本檔既有慣例,不吞成零筆)', async () => {
    const boom = { message: 'boom' };
    const h = makeSupplierSearchClient({ proc: { data: null, error: boom } });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
        { supplierOrderNo: 'SO-1' },
        { limit: 20 },
      ),
    ).rejects.toBe(boom);
  });

  it('🔴 回傳形狀不符(embed 回陣列)→ 擲 ShapeError,**不是靜默濾掉變成查無此單**', async () => {
    // Fable F1:DB 約束保證每列都萃得出 order_id(order_item_id NOT NULL + order_items.order_id
    // NOT NULL + !inner)⇒ 萃不出來只代表**我的形狀假設破了**。濾掉的話會回零筆、員工以為
    // 真的沒這張單,而 mock 餵的是符合假設的形狀 ⇒ 測試全綠、功能壞掉。
    const h = makeSupplierSearchClient({
      proc: { data: [{ order_items: [{ order_id: 'o-1' }] }], error: null },
    });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
        { supplierOrderNo: 'SO-1' },
        { limit: 20 },
      ),
    ).rejects.toBeInstanceOf(SupplierOrderNoSearchShapeError);
    expect(h.listSelect).not.toHaveBeenCalled();
  });

  it('🔴 **部分**列萃不出 id → 一樣擲 ShapeError(不是「全部失敗才算」)', async () => {
    // 只在「全部萃不出」時擲的話,部分失敗仍會靜默少回訂單 —— 同一個病的小一號版本。
    const h = makeSupplierSearchClient({
      proc: { data: [procRow('o-1'), { order_items: null }], error: null },
    });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
        { supplierOrderNo: 'SO-1' },
        { limit: 20 },
      ),
    ).rejects.toBeInstanceOf(SupplierOrderNoSearchShapeError);
  });

  it('去重後訂單數**恰好**等於上限 → 不誤殺(邊界的另一側)', async () => {
    const rows = Array.from({ length: SUPPLIER_ORDER_NO_MATCH_CAP }, (_, i) => procRow(`o-${i}`));
    const h = makeSupplierSearchClient({ proc: { data: rows, error: null } });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-EXACT' },
      { limit: 20 },
    );
    expect(h.listSelect).toHaveBeenCalledTimes(1);
    expect(h.in).toHaveBeenCalledWith(
      'id',
      Array.from({ length: SUPPLIER_ORDER_NO_MATCH_CAP }, (_, i) => `o-${i}`),
    );
  });

  it('與訂單編號搜尋併用 → 兩條都下推到同一個 query(不是二選一)', async () => {
    const h = makeSupplierSearchClient({ proc: { data: [procRow('o-1')], error: null } });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { supplierOrderNo: 'SO-1', orderNumber: 'PCM-2026-0001' },
      { limit: 20 },
    );
    expect(h.in).toHaveBeenCalledWith('id', ['o-1']);
    expect(h.or).toHaveBeenCalledWith(
      'display_id.eq.PCM-2026-0001,legacy_display_id.eq.PCM-2026-0001',
    );
  });

  it('沒給 supplierOrderNo → 完全不碰採購表(既有路徑零行為改動)', async () => {
    const h = makeSupplierSearchClient({ proc: { data: [], error: null } });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin({}, { limit: 20 });
    expect(h.from).not.toHaveBeenCalledWith('order_item_procurement');
    expect(h.listSelect).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
  });
});

describe('🔴 M-4b 生命週期 L6 — 後台列表預設隱藏「刷卡未付款」單', () => {
  // Sean 逐字「刷卡單失敗直接不顯示在後台就好」(P-233-A)。
  // 🔴 這是**顯示層**:被隱藏的單一列都沒被改動,轉 paid 會自動再出現。
  const HIDE = L6_HIDE_OR;
  const listArgs = { limit: 20, offset: 0 } as const;

  it('L6-A1 預設(沒帶開關)→ 套用隱藏條件', async () => {
    const { client, or } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin({}, listArgs);
    expect(or).toHaveBeenCalledWith(HIDE);
  });

  it('L6-A2 includeUnpaidCardOrders=true → 不套用(員工要看得到)', async () => {
    const { client, or } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { includeUnpaidCardOrders: true },
      listArgs,
    );
    expect(or).not.toHaveBeenCalledWith(HIDE);
  });

  it('🔴 L6-A3 單號搜尋時不套用隱藏 —— 且全程只用掉一個 or=', async () => {
    // 兩個理由(缺一不可,adapter 註解有全文):
    //   ① 產品面:拿單號查特定一張單,查不到比看到更困惑;
    //   ② 技術面:兩個 .or() 會產生兩個同名 `or=` param,而 PostgREST 官方文件**沒有明說**
    //      重複的頂層邏輯運算子怎麼合併 —— 押錯的後果是單號搜尋靜默失效 = 列出全部訂單。
    const { client, or } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: 'PCM-2026-0001' },
      listArgs,
    );
    expect(or).toHaveBeenCalledTimes(1); // 只有單號那一個
    expect(or).not.toHaveBeenCalledWith(HIDE);
  });

  it('🔴 L6-A4 單號搜尋 + 明確要求顯示 → 一樣只有一個 or=(兩條路徑不會疊加)', async () => {
    const { client, or } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { orderNumber: 'PCM-2026-0001', includeUnpaidCardOrders: true },
      listArgs,
    );
    expect(or).toHaveBeenCalledTimes(1);
  });

  it('L6-A5 隱藏條件與其他篩選軸並存(不互相取代)', async () => {
    const { client, or, eq, in: inFn } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { fulfillmentStatus: 'shipped', paymentChannels: ['bank_transfer'] },
      listArgs,
    );
    expect(or).toHaveBeenCalledWith(HIDE);
    expect(eq).toHaveBeenCalledWith('fulfillment_status', 'shipped');
    expect(inFn).toHaveBeenCalledWith('payment_channel', ['bank_transfer']);
  });
});

// ── M-4b #347-2a:八維度關鍵字搜尋(`admin_search_orders` RPC + 第二段 .in(id))────────
// 🔴 同 A9b2-A 的既有慣例:**另立** client harness、不改上面那些 —— 本片對既有路徑零行為改動,
//    既有測試必須一格不動仍綠(改了就分不清「新片沒壞東西」還是「我把斷言改成配合新行為」)。
function makeKeywordSearchClient(opts: {
  rpc?: { data: unknown; error: unknown };
  proc?: { data: unknown; error: unknown };
  list?: { data: unknown; error: unknown; count: number | null };
}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpc ?? { data: { ids: [], truncated: false }, error: null });

  const procFilter = vi.fn().mockResolvedValue(opts.proc ?? { data: [], error: null });
  const procLimit = vi.fn().mockReturnValue({ filter: procFilter });
  const procOrder = vi.fn().mockReturnValue({ limit: procLimit });
  const procSelect = vi.fn().mockReturnValue({ order: procOrder });

  const listResult = opts.list ?? { data: [], error: null, count: 0 };
  const range = vi.fn().mockResolvedValue(listResult);
  const order = vi.fn();
  order.mockReturnValue({ order, range });
  const eq = vi.fn();
  const inFn = vi.fn();
  const or = vi.fn();
  const gte = vi.fn(); // #347-3b 建立日期下界
  const lt = vi.fn(); //  #347-3b 建立日期上界(半開區間 ⇒ lt 不是 lte)
  const builder = { eq, is: vi.fn(), in: inFn, or, gte, lt, order };
  or.mockReturnValue(builder);
  eq.mockReturnValue(builder);
  inFn.mockReturnValue(builder);
  gte.mockReturnValue(builder);
  lt.mockReturnValue(builder);
  const listSelect = vi.fn().mockReturnValue(builder);

  const from = vi.fn((table: string) =>
    table === 'order_item_procurement' ? { select: procSelect } : { select: listSelect },
  );
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    procSelect,
    listSelect,
    or,
    in: inFn,
    gte,
    lt,
    range,
  };
}

const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

describe('SupabaseOrderAdapter.listOrderSummariesForAdmin — #347-2a 關鍵字搜尋', () => {
  it('命中 → 打 RPC(參數名逐字)+ 第二段 .in(id),且**投影仍是主常數**', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1), uuid(2)], truncated: false }, error: null },
    });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '  王小明  ' },
      { limit: 20 },
    );
    // 🔴 參數名逐字對 migration 簽章;`p_limit` 由呼叫端明講、不依賴 DB 的 DEFAULT。
    // 🔴 #347-3b:`p_from`/`p_to` 起也一律帶著(沒選日期就是 `null` = 該側不限)——
    //    這裡跟著加是**行為真的變了**,不是為了配合新程式碼改斷言:wire 上多了兩個 null 鍵。
    //    等價性已對正式站實測(省略 / null 兩種回傳一致,而真有下界時回 0 筆)。
    expect(h.rpc).toHaveBeenCalledWith(ADMIN_SEARCH_ORDERS_FN, {
      p_query: '王小明',
      p_limit: ADMIN_ORDER_ID_IN_CAP,
      p_from: null,
      p_to: null,
    });
    // 🔴 **只有兩個引數** —— 第三參數就是 `{get:true}`/`{head:true}` 進來的地方(搜尋詞會進 URL)。
    expect(h.rpc.mock.calls[0]).toHaveLength(2);
    // 🔴 第二段的投影一個字都沒動(鐵則 12 byte-lock 白名單不因搜尋而換版本)
    expect(h.listSelect).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    expect(h.in).toHaveBeenCalledWith('id', [uuid(1), uuid(2)]);
    expect(res.keywordTruncated).toBe(false);
    expect(res.keywordMatchCount).toBe(2);
  });

  it('🔴 truncated 直通到回傳(靜默截斷 = 員工以為就這幾筆)', async () => {
    const ids = Array.from({ length: ADMIN_ORDER_ID_IN_CAP }, (_, i) => uuid(i + 1));
    const h = makeKeywordSearchClient({ rpc: { data: { ids, truncated: true }, error: null } });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王' },
      { limit: 20 },
    );
    expect(res.keywordTruncated).toBe(true);
    expect(res.keywordMatchCount).toBe(ADMIN_ORDER_ID_IN_CAP);
  });

  it('🔴 truncated 為真、但結果被其他篩選濾成 0 筆時,旗標**仍要是 true**(提示的唯一依據)', async () => {
    const ids = Array.from({ length: ADMIN_ORDER_ID_IN_CAP }, (_, i) => uuid(i + 1));
    const h = makeKeywordSearchClient({
      rpc: { data: { ids, truncated: true }, error: null },
      list: { data: [], error: null, count: 0 },
    });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王', paymentStatus: 'refunded' },
      { limit: 20 },
    );
    // 0 筆 + 沒有提示 = 員工得到「查無此單」的錯誤結論,正是合約要禁的形狀。
    expect(res).toMatchObject({ items: [], total: 0, keywordTruncated: true });
  });

  it('零命中 → 回零筆、**第二段完全沒被打**,但 matchCount 是 0(不是 null)', async () => {
    const h = makeKeywordSearchClient({ rpc: { data: { ids: [], truncated: false }, error: null } });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: 'zzz' },
      { limit: 20 },
    );
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: 0 });
    // 🔴 `0`(搜了、零命中)與 `null`(沒搜過)必須分得出來 —— 那是災難當天的第一個分岔。
    expect(res.keywordMatchCount).not.toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('🔴 fail-closed:搜尋詞不合法 → 回零筆,且 **RPC 與第二段都沒被打**(零 I/O)', async () => {
    const h = makeKeywordSearchClient({ proc: { data: [procRow(uuid(1))], error: null } });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      // 🔴 **一定要同時給一個有效的 supplierOrderNo**(關卡2 R1 抓到):不給的話供應商 probe
      //    本來就不會跑 ⇒ 就算有人把關鍵字驗證移回 probe 之後,`h.from` 仍然沒被呼叫、這格照樣綠
      //    = 這格量的其實不是「驗證排在 I/O 之前」。給了才構造得出那個突變。
      { keyword: 'x'.repeat(MAX_ORDER_KEYWORD_LENGTH + 1), supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: null });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it('🔴 空/全空白(含零寬空格)→ 不篩選:RPC 不打,但列表照查(不是回零筆)', async () => {
    const h = makeKeywordSearchClient({ list: { data: [], error: null, count: 5 } });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '\u200b\u3000' },
      { limit: 20 },
    );
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.in).not.toHaveBeenCalled();
    expect(res).toMatchObject({ total: 5, keywordTruncated: false, keywordMatchCount: null });
  });

  it('🔴 RPC error → 裸 throw(不吞成零筆:那會讓壞掉看起來像查無此單)', async () => {
    const h = makeKeywordSearchClient({ rpc: { data: null, error: { message: 'boom' } } });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin({ keyword: 'x' }, { limit: 20 }),
    ).rejects.toEqual({ message: 'boom' });
  });
});

/**
 * 在任意物件圖裡遞迴找子字串(含 Error 的不可列舉屬性、巢狀物件、陣列)。
 *
 * 🔴 用途:證明「錯誤物件的**任何角落**都沒有搜尋詞」—— 搜尋詞是 PII,而錯誤物件會進 server log。
 * 淺層的 `JSON.stringify` 或看 `.message` 都只覆蓋一層,巢狀欄位會整個溜過去(關卡2 R2)。
 */
function deepContains(value: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((v) => deepContains(v, needle, seen));
  return Object.getOwnPropertyNames(value).some((k) =>
    deepContains((value as Record<string, unknown>)[k], needle, seen),
  );
}

describe('#347-2a 關鍵字搜尋 · RPC 回傳形狀 fail-closed(硬轉 = 假設沒人驗)', () => {
  it.each([
    ['回傳不是物件', 'not-an-object'],
    ['回傳是陣列', [uuid(1)]],
    ['回傳是 null', null],
    ['truncated 缺鍵(undefined 會靜默變成「沒截斷」)', { ids: [uuid(1)] }],
    ['truncated 不是 boolean', { ids: [uuid(1)], truncated: 'yes' }],
    ['ids 不是陣列', { ids: uuid(1), truncated: false }],
    ['ids 含非 UUID(進 .in() 會讓 PostgREST 400 = 整頁錯誤態)', { ids: ['not-a-uuid'], truncated: false }],
  ])('🔴 %s → 擲 OrderKeywordSearchShapeError', async (_name, data) => {
    const h = makeKeywordSearchClient({ rpc: { data, error: null } });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin({ keyword: 'x' }, { limit: 20 }),
    ).rejects.toBeInstanceOf(OrderKeywordSearchShapeError);
  });

  it('🔴 ids 有重複 → 擲錯(不靜默去重:重複會灌水 URL,且讓 matchCount 大於真實訂單數)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1), uuid(1), uuid(2)], truncated: false }, error: null },
    });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin({ keyword: 'x' }, { limit: 20 }),
    ).rejects.toBeInstanceOf(OrderKeywordSearchShapeError);
  });

  it('🔴 ids 超過上限 → 擲錯(RPC 被改成回 101 筆時,.in() 的 URL 會爆,而那個失敗長得像「列表壞了」)', async () => {
    const ids = Array.from({ length: ADMIN_ORDER_ID_IN_CAP + 1 }, (_, i) => uuid(i + 1));
    const h = makeKeywordSearchClient({ rpc: { data: { ids, truncated: true }, error: null } });
    await expect(
      new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin({ keyword: 'x' }, { limit: 20 }),
    ).rejects.toBeInstanceOf(OrderKeywordSearchShapeError);
  });

  it('🔴 錯誤訊息不得含搜尋詞(它會進 server log,而搜尋詞是 PII)', async () => {
    // 🔴 **第一版只掛 `.catch()` = 這一格自己是假綠**(關卡2 R1 抓到):
    //    promise 若意外正常 resolve,裡面的斷言**一次都不會執行**,而測試照樣 PASS。
    //    ⇒ 先用 `rejects` 釘住「它一定要擲」,再對擲出來的東西做斷言。
    const secret = '王小明0912345678';
    const h = makeKeywordSearchClient({ rpc: { data: 'bad', error: null } });
    const call = new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: secret },
      { limit: 20 },
    );
    await expect(call).rejects.toBeInstanceOf(OrderKeywordSearchShapeError);
    const err: unknown = await call.then(
      () => {
        throw new Error('unreachable:上一行的 rejects 已經釘死它必須擲');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).not.toContain(secret);
    expect(msg).not.toContain('王');
    // 🔴 **深層掃描,不是 `JSON.stringify(err, ownPropertyNames)`**(關卡2 R2 抓到):
    //    那個 replacer 陣列只列**頂層**自有屬性 ⇒ `err.context.query = 搜尋詞` 這種巢狀欄位
    //    會被序列化掉、掃不到,而真的 logger(pino/console.error)照樣會把它印出來 ⇒ 那格是假綠。
    expect(deepContains(err, '王')).toBe(false);
    expect(deepContains(err, secret)).toBe(false);
  });
});

describe('#347-2a 關鍵字 × 供應商單號:交集只送一次 .in(id)', () => {
  it('🔴 兩個維度並用 → **只呼叫一次 .in(id)**、值是交集(送兩次 = 兩個同名 query param,合併語意未文件化)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1), uuid(2), uuid(3)], truncated: false }, error: null },
      proc: { data: [procRow(uuid(2)), procRow(uuid(3)), procRow(uuid(4))], error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王', supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    const idCalls = h.in.mock.calls.filter((c) => c[0] === 'id');
    expect(idCalls).toHaveLength(1);
    expect(idCalls.map((c) => c[1])).toEqual([[uuid(2), uuid(3)]]);
  });

  it('🔴 交集為空 → 回零筆、第二段不打;matchCount 仍回報關鍵字**真的有命中**', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
      proc: { data: [procRow(uuid(9))], error: null },
    });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王', supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    // 🔴 這一格正是 keywordMatchCount 存在的理由:畫面上與「關鍵字零命中」完全同形,
    //    只有這個數字分得出來是「找到了、但被交集砍光」。
    expect(res).toEqual({ items: [], total: 0, keywordTruncated: false, keywordMatchCount: 1 });
    expect(h.in).not.toHaveBeenCalled();
  });

  it('🔴 關鍵字零命中 + 供應商命中過多 → 回零筆、**不擲 TooMany**(關鍵字已證明交集必為空)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [], truncated: false }, error: null },
      proc: { data: Array.from({ length: 9999 }, (_, i) => procRow(uuid(i))), error: null },
    });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: 'zzz', supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    // 順序載重:關鍵字 RPC 排在供應商 probe 之前 ⇒ 這裡根本走不到供應商那段。
    expect(res).toMatchObject({ items: [], total: 0, keywordMatchCount: 0 });
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe('#347-2a 關鍵字 × 供應商零命中:早退也要帶出 truncated / matchCount', () => {
  it('🔴 關鍵字 truncated + 供應商零命中 → 早退,但**兩個訊號照實帶出去**', async () => {
    // 🔴 這一格補的是「供應商零命中」那條早退(關卡2 R1 抓到沒人測):
    //    把它改回一個不帶訊號的空回傳 ⇒ truncated 靜默消失、畫面不再顯示「結果太多」,
    //    而在補這格之前,其餘 23 格全部照綠。
    const ids = Array.from({ length: ADMIN_ORDER_ID_IN_CAP }, (_, i) => uuid(i + 1));
    const h = makeKeywordSearchClient({
      rpc: { data: { ids, truncated: true }, error: null },
      proc: { data: [], error: null },
    });
    const res = await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王', supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    expect(res).toEqual({
      items: [],
      total: 0,
      keywordTruncated: true,
      keywordMatchCount: ADMIN_ORDER_ID_IN_CAP,
    });
    expect(h.in).not.toHaveBeenCalled();
  });
});

describe('#347-2a 關鍵字 × L6 隱藏規則(豁免綁精準鍵)', () => {
  const HIDE = 'payment_channel.neq.tappay,payment_status.neq.unpaid';

  it('🔴 純關鍵字搜尋 **不豁免** 隱藏規則(主視窗 D-385-A 裁決;搜「王」會撈回大量刷卡未付款單)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王' },
      { limit: 20 },
    );
    expect(h.or).toHaveBeenCalledWith(HIDE);
  });

  it('關鍵字 + 供應商單號並用 → 豁免**由精準鍵帶入**(這是規則的正確結果,不是 bug)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
      proc: { data: [procRow(uuid(1))], error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王', supplierOrderNo: 'SO-1' },
      { limit: 20 },
    );
    expect(h.or).not.toHaveBeenCalled();
  });

  it('關鍵字 + 員工手動勾「連未付款一起顯示」→ 不套隱藏(既有逃生口對關鍵字一樣有效)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: '王', includeUnpaidCardOrders: true },
      { limit: 20 },
    );
    expect(h.or).not.toHaveBeenCalled();
  });
});

describe('#347-2a 早退回傳 · 每次都是新物件(不得共用可變實例)', () => {
  it('🔴 改動第一次的回傳,**不得**污染第二次(共用 const 物件 = 跨 request 污染)', async () => {
    const h = makeKeywordSearchClient({});
    const adapter = new SupabaseOrderAdapter(h.client);
    const bad = { keyword: 'x'.repeat(MAX_ORDER_KEYWORD_LENGTH + 1) };
    const first = await adapter.listOrderSummariesForAdmin(bad, { limit: 20 });
    // consumer 對回傳做的事(完全合法):往 items 塞東西、改 total。
    first.items.push({ id: 'poison' } as unknown as (typeof first.items)[number]);
    first.total = 999;
    const second = await adapter.listOrderSummariesForAdmin(bad, { limit: 20 });
    // 🔴 關卡2 R1 抓到:第一版 `EMPTY_ADMIN_ORDER_LIST` 是 module-level const
    //    ⇒ 這裡的 second 會帶著 poison 與 999,而症狀出現在**別的 request** 上、幾乎追不回這一行。
    //    `Object.freeze` 不夠(淺凍結,items 照樣 push 得進去)⇒ 必須每次回新物件。
    expect(second.items).toEqual([]);
    expect(second.total).toBe(0);
    expect(second).not.toBe(first);
  });
});

describe('#347-2a 上限常數 · 獨立釘值(抽共用後的漂綠面)', () => {
  it('🔴 ADMIN_ORDER_ID_IN_CAP 必須是字面 100 —— 要改先重量 URL 預算', () => {
    // 🔴 **刻意寫死 100、不從常數導出**:供應商邊界測試是拿這個常數產資料的,
    //    有人改成 200 ⇒ production 與那些測試會**一起漂綠**、8KB URL 的病無聲復活。
    //    來源:adapter `SupabaseOrderAdapter.ts:138-155` 那張 byte 表(100 筆 = 4,461 / 200 筆 = 8,361 越 8KB 線)
    //    + migration `:198` RPC 自己的硬夾值。三者要一起改,不是改一個。
    expect(ADMIN_ORDER_ID_IN_CAP).toBe(100);
    expect(SUPPLIER_ORDER_NO_MATCH_CAP).toBe(100);
  });
});

// ── M-4b #347-3b:建立日期範圍下推(列表 + 關鍵字 RPC 兩處)────────────────────────
describe('SupabaseOrderAdapter — #347-3b 建立日期範圍', () => {
  const FROM = '2026-02-10T00:00:00+08:00';
  const TO = '2026-08-11T00:00:00+08:00';

  it('🔴 列表查詢:`gte(created_at, from)` + **`lt`**(半開區間,不是 `lte`)', async () => {
    // 突變:把 `lt` 改成 `lte` ⇒ 這條紅。`lte` 配「當天 23:59:59」會在微秒級漏單,
    // 而 `to` 是**下一個台北午夜** ⇒ 用 `lte` 會多收隔天 00:00:00.000 那一瞬間的單。
    const h = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { createdFrom: FROM, createdTo: TO },
      { limit: 20 },
    );
    expect(h.gte).toHaveBeenCalledWith('created_at', FROM);
    expect(h.lt).toHaveBeenCalledWith('created_at', TO);
  });

  it('🔴 沒給日期 ⇒ 一個字都不下推(#347-3b 沒有 server 端預設)', async () => {
    // 🔴 這條守的是「對外可見=無」那個驗收:adapter 若自己補近半年,列表就會默默藏掉舊單。
    //    突變:在 adapter 補一個預設 ⇒ 這條紅。
    const h = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin({}, { limit: 20 });
    expect(h.gte).not.toHaveBeenCalled();
    expect(h.lt).not.toHaveBeenCalled();
  });

  it('🔴 空字串 ⇒ 兩條路徑都當作沒給(不得送出 `created_at=gte.`)', async () => {
    // 🔴 R1 nit 6 的靶(我第一版修了 code 卻沒配靶,突變全綠存活):
    //    型別上 `createdFrom: ''` 是合法的,而 `.gte('created_at','')` 會讓 PostgREST 400
    //    ⇒ **整個訂單列表進錯誤態**(不只日期軸失效)。兩條路徑要同語意。
    //    突變:把 `if (filter.createdFrom)` 改回 `!== undefined` ⇒ 這條紅。
    const h = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { createdFrom: '', createdTo: '' },
      { limit: 20 },
    );
    expect(h.gte).not.toHaveBeenCalled();
    expect(h.lt).not.toHaveBeenCalled();

    const k = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
    });
    await new SupabaseOrderAdapter(k.client).listOrderSummariesForAdmin(
      { keyword: 'PCM', createdFrom: '', createdTo: '' },
      { limit: 20 },
    );
    // RPC 那側也要折成 null(`|| null` 而不是 `?? null` —— 空字串照送 = 送一個爛的 timestamptz)。
    expect(k.rpc).toHaveBeenCalledWith('admin_search_orders', {
      p_query: 'PCM',
      p_limit: 100,
      p_from: null,
      p_to: null,
    });
  });

  it('只給一邊也要下推那一邊(兩軸各自獨立)', async () => {
    const h = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { createdFrom: FROM },
      { limit: 20 },
    );
    expect(h.gte).toHaveBeenCalledWith('created_at', FROM);
    expect(h.lt).not.toHaveBeenCalled();
  });

  it('🔴🔴 關鍵字搜尋:日期**也要進 RPC**(只篩列表 = 取樣窗口還是全歷史最新 100)', async () => {
    // 🔴 這是本片最重要的一格:#347-1 的取樣順序是「先取全域最新 100 筆命中、才與其他篩選取交集」
    //    ⇒ 只在列表 `.gte()` 的話,要找的單可能整張落在那 100 筆之外,畫面顯示 0 筆
    //    而且**看起來像查無此單**。突變:把 RPC 那兩個展開拿掉 ⇒ 這條紅(而列表那格照樣綠
    //    —— 兩處各自獨立,少推一處是查得到與查不到的差別)。
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: 'PCM', createdFrom: FROM, createdTo: TO },
      { limit: 20 },
    );
    expect(h.rpc).toHaveBeenCalledWith('admin_search_orders', {
      p_query: 'PCM',
      p_limit: 100,
      p_from: FROM,
      p_to: TO,
    });
  });

  it('🔴 沒給日期的關鍵字搜尋:兩個鍵仍帶著、值是 `null`(= 該側不限)', async () => {
    // 🔴 為什麼是 `null` 而不是省略:`admin-search-orders-post-only.test.ts` 禁止在這個引數物件
    //    用 spread(spread 會讓它的「參數名逐字對 migration」守門與型別檢查同時失效)⇒ 一律兩鍵都帶。
    //    `null` 與省略在 DB 側等價(migration `:134-135` 的 `p_from IS NULL OR …`),
    //    而且**已對正式站實測**:省略 / 兩鍵 null / 單鍵 null 三種都回同一筆數,
    //    而「真的有下界」回 0 筆(對照組證明這個等價不是恆真)。
    // 突變:把 `?? null` 改成漏帶其中一鍵 ⇒ 這條紅。
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: 'PCM' },
      { limit: 20 },
    );
    expect(h.rpc).toHaveBeenCalledWith('admin_search_orders', {
      p_query: 'PCM',
      p_limit: 100,
      p_from: null,
      p_to: null,
    });
  });

  it('🔴 關鍵字 + 日期時,列表那一段**也**照樣下推(兩處都要,不是二選一)', async () => {
    const h = makeKeywordSearchClient({
      rpc: { data: { ids: [uuid(1)], truncated: false }, error: null },
    });
    await new SupabaseOrderAdapter(h.client).listOrderSummariesForAdmin(
      { keyword: 'PCM', createdFrom: FROM, createdTo: TO },
      { limit: 20 },
    );
    expect(h.gte).toHaveBeenCalledWith('created_at', FROM);
    expect(h.lt).toHaveBeenCalledWith('created_at', TO);
  });
});
