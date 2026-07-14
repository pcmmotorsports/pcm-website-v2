// SupabaseOrderAdapter.test.ts — 建單 adapter 行為(M-3-S2-b2-b2、鐵則 12 建單 path)。
//
// 注入式 mock SupabaseClient 攔 .rpc(fn, args):斷言 placeOrder 呼 create_order RPC、args 為對齊契約的
// snake_case wire(quantity→qty / 複合鍵 / 發票)、回傳只 {orderId, displayId};RPC error 上拋不吞;
// 回傳格式非預期防腐壞 throw;讀路徑 deferred-stub(延 stage ③ 訂單查詢、backlog #217)reject 未實作。
// 線上 create_order RPC 已就緒(S2-a + S2-b1 migration 已 db push、authenticated EXECUTE/anon REVOKE 正確);
// ⚠️ #241 8-param(0b 5-param + p_terms_version/p_client_ip/p_client_ua)尚待 db push、本檔以 mock 驗 TS wire 對齊 8-param 簽名。
// 真打 RPC(端到端建單)可成、留 Sean 階段①末肉眼驗;本片 mock client 單元測只驗 adapter 行為。

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type { PlaceOrderInput } from '@pcm/domain';
import {
  SupabaseOrderAdapter,
  ORDER_LIST_SELECT,
  ADMIN_ORDER_LIST_SELECT,
  ADMIN_ORDER_DETAIL_SELECT,
} from './SupabaseOrderAdapter';

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

    // 🔴 鐵則 12:傳給 RPC 的 args 即 mapper 輸出(snake_case、零 price/tier/userId;#241 8-param)
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
// mock from('orders').select(ADMIN_ORDER_LIST_SELECT,{count}).eq(...)*.order('created_at',desc).range(offset,offset+limit-1)。
// eq 可鏈(回自身 builder);order 回 {range};range 為終端、await 回 {data, error, count}。
function makeAdminListClient(result: { data: unknown; error: unknown; count: number | null }) {
  const range = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ range });
  const eq = vi.fn();
  const is = vi.fn();
  const builder = { eq, is, order };
  eq.mockReturnValue(builder); // query = query.eq(...) 保持可鏈
  is.mockReturnValue(builder); // query = query.is(...) 保持可鏈(workflow_status IS NULL)
  const select = vi.fn().mockReturnValue(builder);
  const from = vi.fn().mockReturnValue({ select });
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
    eq,
    is,
    order,
    range,
  };
}

describe('SupabaseOrderAdapter.listOrderSummariesForAdmin + ADMIN_ORDER_LIST_SELECT 守門', () => {
  it('🔴 鐵則 12:ADMIN_ORDER_LIST_SELECT byte-equal 白名單(客人顯示 customers(name),零成本欄)', () => {
    expect(ADMIN_ORDER_LIST_SELECT).toBe(
      'id, display_id, created_at, payment_status, fulfillment_status, workflow_status, total, order_source, payment_channel, display_position, cancelled_at, customers(name)',
    );
  });

  it('🔴 鐵則 12:投影不含任何成本 / 經銷 / 敏感欄名、且無 select("*")', () => {
    const forbidden = [
      '*',
      'price_store',
      'price_by_tier',
      'priceByTier',
      'cost',
      'unit_price',
      'line_total',
      'product_snapshot',
      'tappay_rec_trade_id',
      'shipping_address_snapshot',
      'invoice',
      'tier_at_checkout',
    ];
    for (const token of forbidden) {
      expect(ADMIN_ORDER_LIST_SELECT).not.toContain(token);
    }
  });

  it('查詢鏈 orders / select(ADMIN_ORDER_LIST_SELECT,{count:exact}) / 五軸 eq 下推 / order(created_at desc) / range(offset,offset+limit-1);row → AdminOrderSummary', async () => {
    const { client, from, select, eq, order, range } = makeAdminListClient({
      data: [
        {
          id: 'o1',
          display_id: 'PCM-2099-0001',
          created_at: '2099-04-15T10:00:00Z',
          payment_status: 'paid',
          fulfillment_status: 'notOrdered',
          workflow_status: 'received_confirmed',
          total: 5200,
          order_source: 'web',
          payment_channel: 'tappay',
          display_position: null,
          cancelled_at: null,
          customers: { name: '王小明' }, // forward FK many-to-one → 單物件
        },
      ],
      error: null,
      count: 37,
    });

    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      {
        paymentStatus: 'paid',
        fulfillmentStatus: 'notOrdered',
        orderSource: 'web',
        paymentChannel: 'tappay',
        workflowStatus: 'received_confirmed',
      },
      { limit: 20, offset: 40 },
    );

    expect(from).toHaveBeenCalledWith('orders');
    expect(select).toHaveBeenCalledWith(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    // 五軸篩選各下推一次 DB where(非前端過濾)
    expect(eq).toHaveBeenCalledWith('payment_status', 'paid');
    expect(eq).toHaveBeenCalledWith('fulfillment_status', 'notOrdered');
    expect(eq).toHaveBeenCalledWith('order_source', 'web');
    expect(eq).toHaveBeenCalledWith('payment_channel', 'tappay');
    expect(eq).toHaveBeenCalledWith('workflow_status', 'received_confirmed');
    expect(eq).toHaveBeenCalledTimes(5);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(range).toHaveBeenCalledWith(40, 59); // offset 40、limit 20 → [40, 59] 含端
    expect(res).toEqual({
      items: [
        {
          id: 'o1',
          displayId: 'PCM-2099-0001',
          createdAt: '2099-04-15T10:00:00Z',
          customerName: '王小明',
          paymentStatus: 'paid',
          fulfillmentStatus: 'notOrdered',
          orderSource: 'web',
          paymentChannel: 'tappay',
          total: { amount: 5200, currency: 'TWD' },
          displayPosition: null,
          cancelledAt: null,
          workflowStatus: 'received_confirmed',
        },
      ],
      total: 37,
    });
  });

  it('workflowStatus=null(「未設定」篩選)→ is(workflow_status, null) 下推、不走 eq;undefined → 兩者皆不呼', async () => {
    const { client, eq, is } = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      { workflowStatus: null },
      { limit: 20 },
    );
    expect(is).toHaveBeenCalledWith('workflow_status', null);
    expect(eq).not.toHaveBeenCalled();

    const second = makeAdminListClient({ data: [], error: null, count: 0 });
    await new SupabaseOrderAdapter(second.client).listOrderSummariesForAdmin({}, { limit: 20 });
    expect(second.is).not.toHaveBeenCalled();
    expect(second.eq).not.toHaveBeenCalled();
  });

  it('無篩選 → 完全不下推 eq(全表);offset 預設 0 → range(0, limit-1)', async () => {
    const { client, eq, range } = makeAdminListClient({ data: [], error: null, count: 0 });
    const res = await new SupabaseOrderAdapter(client).listOrderSummariesForAdmin(
      {},
      { limit: 20 },
    );
    expect(eq).not.toHaveBeenCalled();
    expect(range).toHaveBeenCalledWith(0, 19);
    expect(res).toEqual({ items: [], total: 0 });
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
          workflow_status: null,
          customers: null,
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
      customerName: null, // join 缺 → null 防禦
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'notOrdered',
      orderSource: 'manual_phone',
      paymentChannel: 'cash',
      total: { amount: 999, currency: 'TWD' },
      displayPosition: 3,
      cancelledAt: '2099-05-02T00:00:00Z',
      workflowStatus: null, // NULL = 未設定(顯示端兜「未設定」中性 badge)
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
          workflow_status: 'shipped_done',
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
function makeDetailClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, maybeSingle };
}

const DETAIL_ROW = {
  id: 'o1',
  display_id: 'PCM-2099-0001',
  created_at: '2099-04-15T10:00:00Z',
  payment_status: 'paid',
  fulfillment_status: 'notOrdered',
  workflow_status: 'received_unconfirmed',
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
  customers: { name: '王小明', email: 'a@b.c', phone: '0912345678' },
  order_items: [
    {
      variant_sku: 'BMS-13OEM-G-F',
      quantity: 2,
      unit_price: 2500,
      line_total: 5000,
      product_snapshot: { sku: 'BMS-13OEM-G-F', spec: { finish: 'Glossy' }, title: '下導流' },
    },
  ],
};

describe('SupabaseOrderAdapter.findAdminOrderDetail + ADMIN_ORDER_DETAIL_SELECT 守門', () => {
  it('🔴 鐵則 12:ADMIN_ORDER_DETAIL_SELECT byte-equal(明細專用、含 PII;與列表白名單分立)', () => {
    expect(ADMIN_ORDER_DETAIL_SELECT).toBe(
      'id, display_id, created_at, payment_status, fulfillment_status, workflow_status, order_source, payment_channel, payment_method, paid_at, subtotal, shipping_fee, discount_total, total, shipping_method, shipping_address_snapshot, invoice, invoice_number, invoice_amount, invoice_status, cancelled_at, cancelled_reason, customers(name, email, phone), order_items(variant_sku, quantity, unit_price, line_total, product_snapshot)',
    );
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

  it('查詢鏈 orders / select(明細白名單) / eq(id) / maybeSingle;row → AdminOrderDetail(jsonb 防禦解析)', async () => {
    const { client, from, select, eq } = makeDetailClient({ data: DETAIL_ROW, error: null });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(from).toHaveBeenCalledWith('orders');
    expect(select).toHaveBeenCalledWith(ADMIN_ORDER_DETAIL_SELECT);
    expect(eq).toHaveBeenCalledWith('id', 'o1');
    expect(res).toEqual({
      id: 'o1',
      displayId: 'PCM-2099-0001',
      createdAt: '2099-04-15T10:00:00Z',
      paymentStatus: 'paid',
      fulfillmentStatus: 'notOrdered',
      workflowStatus: 'received_unconfirmed',
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
      items: [
        {
          variantSku: 'BMS-13OEM-G-F',
          title: '下導流',
          spec: { finish: 'Glossy' },
          quantity: 2,
          unitPrice: { amount: 2500, currency: 'TWD' },
          lineTotal: { amount: 5000, currency: 'TWD' },
        },
      ],
    });
  });

  it('jsonb 腐壞防禦:snapshot 非物件 / spec 缺 / invoice null → 各欄 null、不 throw', async () => {
    const { client } = makeDetailClient({
      data: {
        ...DETAIL_ROW,
        shipping_address_snapshot: 'corrupted',
        invoice: null,
        customers: null,
        order_items: [
          { variant_sku: 'X', quantity: 1, unit_price: 100, line_total: 100, product_snapshot: null },
        ],
      },
      error: null,
    });
    const res = await new SupabaseOrderAdapter(client).findAdminOrderDetail('o1');
    expect(res?.shippingAddress).toEqual({ name: null, phone: null, line: null });
    expect(res?.customer).toEqual({ name: null, email: null, phone: null });
    expect(res?.invoiceRequest.type).toBeNull();
    expect(res?.items[0]).toMatchObject({ title: null, spec: null });
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
