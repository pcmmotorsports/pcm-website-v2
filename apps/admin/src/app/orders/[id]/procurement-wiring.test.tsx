// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// M-4b E10 A10b:**頁層接線**測試(關卡2 codex MF10)。
//
// 🔴 為什麼需要它:元件層的測試都是把 `suppliers` 當 prop 餵進去的 ⇒
//    把 `page.tsx` 裡的 `listSuppliers()` 改成永遠回空陣列,那些測試**照樣全綠**,
//    而員工會只能編輯既有供應商、**無法新增任何採購**(選單空的)。
//    ⇒ 這一條量的是「頁面真的把 S3a 的結果傳到採購區塊」。

vi.mock('server-only', () => ({}));
vi.mock('../../../lib/session/actor', () => ({ getSessionActor: async () => null }));
vi.mock('../../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
// 🔴 每一支 server action 模組都要 mock 掉:它們 transitively 拉 `session/authorize` → `server-only`,
//    而 vite 的 import 分析在 `vi.mock('server-only')` 生效**之前**就會解析整張圖 ⇒ 只 mock
//    `server-only` 不夠(A9d2-1 的測試沒踩到,是因為它連 authorize 整支都 mock 掉了)。
vi.mock('../../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn(),
}));
vi.mock('../../../lib/orders/note-actions', () => ({ appendOrderNoteAction: vi.fn() }));
vi.mock('../../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: vi.fn(), // A9w4a:`updateOrderItemWorkflowAction` 已從該模組具名移除
}));
// M-3 RW2d:order-detail 掛了退款入口 ⇒ 頁面圖多了 refund-actions(→ authorize → staff-repository
// → server-only),同上一條註的理由必須 mock。
vi.mock('../../../lib/payment/refund-actions', () => ({ initiateRefundAction: vi.fn() }));
// M-3 RW3:page 直接 import refund-read(→ @pcm/adapters/server → server-only),同理必 mock。
vi.mock('../../../lib/payment/refund-read', () => ({
  listOrderRefunds: vi.fn().mockResolvedValue({ rows: [], truncated: false }),
  getLedgerUnregisteredAmount: vi.fn().mockResolvedValue(null),
}));

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listSuppliers: vi.fn(),
}));
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));
// 🔴 只換掉 `listSuppliers`,`sortSuppliersByLabel` 用**真的**那一把 ——
//    選單順序是這條測試的一部分,mock 掉排序等於在測 mock。
vi.mock('../../../lib/supplier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supplier')>();
  return { ...actual, listSuppliers: mocks.listSuppliers };
});
vi.mock('../../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));

import OrderDetailPage from './page';

// 🔴 2c:`<ShipmentSection>` 是 **async server component**,而本檔用 RTL **同步**渲染
//    ⇒ 不 mock 的話整個 OrderDetail 渲染不出來(症狀是 container 變空字串、本檔全紅)。
//    真實 Next 下 async server component 是支援的,**這是測試工具的限制、不是產品缺陷**。
//    本檔測的是採購/退款/九碼,出貨卡有自己的測試(`shipment-section.test.tsx` +
//    `order-shipments.test.ts`)⇒ 這裡換成佔位、不影響本檔要驗的東西。
vi.mock('../../../components/orders/shipment-section', () => ({
  ShipmentSection: () => null,
}));


const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';

function detail(): AdminOrderDetail {
  // `as unknown as` 同 admin-form-consumers.test.tsx:96 的慣例:MoneyAmount 是 branded type,
  // 測試 fixture 不必為了造一個假訂單去走 toMoneyAmount 守門。
  return {
    id: ORDER,
    displayId: 'ABC123',
    createdAt: '2026-08-04T02:00:00+00:00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    paymentMethod: null,
    paidAt: null,
    subtotal: { amount: 100, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 100, currency: 'TWD' },
    shippingMethod: 'home',
    shippingAddress: { name: null, phone: null, line: null },
    customer: { name: null, email: null, phone: null },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    items: [
      {
        id: ITEM,
        variantSku: 'SKU-1',
        title: '下導流',
        spec: null,
        quantity: 2,
        unitPrice: { amount: 50, currency: 'TWD' },
        lineTotal: { amount: 100, currency: 'TWD' },
        procurements: [],
        procurementTruncated: false,
      },
    ],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
  mocks.listSuppliers.mockResolvedValue([{ id: SUPPLIER, label: 'RPM Carbon' }]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
});

async function renderPage() {
  const ui = await OrderDetailPage({
    params: Promise.resolve({ id: ORDER }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

describe('/orders/[id] — A10b 採購區塊接線', () => {
  it('🔴 S3a 的供應商真的傳到採購選單(改成回空陣列這條要紅)', async () => {
    const { container } = await renderPage();
    const options = [...container.querySelectorAll('select[name="supplier_id"] option')].map(
      (o) => o.getAttribute('value'),
    );
    expect(options).toContain(SUPPLIER);
    expect(mocks.listSuppliers).toHaveBeenCalledTimes(1);
  });

  it('採購區塊有渲染出來(標題 + 每個品項一份表單)', async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain('採購(向供應商訂貨)');
    expect(container.querySelectorAll('select[name="supplier_id"]')).toHaveLength(1);
  });

  // 🔴 供應商清單壞掉**不得讓整頁掛掉**,也不得靜默(空選單會誘發員工建重複供應商,而供應商不可刪)
  it('listSuppliers 失敗 → 頁面照樣渲染、且顯示載入失敗警告', async () => {
    mocks.listSuppliers.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.textContent).toContain('採購(向供應商訂貨)');
    expect(container.textContent).toContain('供應商清單載入失敗');
  });

  it('訂單明細失敗 → 錯誤態,不因為供應商成功就誤render', async () => {
    mocks.findAdminOrderDetail.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(container.textContent).toContain('訂單明細載入失敗');
  });
});
