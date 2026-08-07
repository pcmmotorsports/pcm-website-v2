// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';

// M-4b E10 A9w1(P3 九碼退場):**明細頁**九碼下架 + 品項列改三軸顯示的守門。
//
// 🔴 為什麼是頁層而不是元件層:元件層測試是自己餵 props 的 ⇒ 就算 `page.tsx` 還在讀狀態詞彙、
//    還把九碼下拉掛回明細頁,元件層照樣全綠。這一條量的是「真的進到這一頁的畫面裡有什麼」。
// 🔴 三條斷言各自對應一種會靜默壞掉的改法:
//    ①九碼下拉/存鈕復活 ②三軸數字沒接上投影 ③`quantitySummary` 為 null 時被 `?? 0` 補成 0。

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
// 每一支 server action 模組都要 mock(理由同 procurement-wiring.test.tsx:20-22:
// 它們 transitively 拉 session/authorize → server-only,vite 解析整張圖早於 vi.mock 生效)。
vi.mock('../../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn(),
}));
vi.mock('../../../lib/orders/note-actions', () => ({ appendOrderNoteAction: vi.fn() }));
// A9w4a(2026-08-06):`updateOrderItemWorkflowAction` 已從該模組具名移除 ⇒ 本 factory 同步撤掉那把
// (mock 多回一個真模組沒有的 key = 字面與事實不符,且會讓「action 復活」看起來仍被 mock 蓋住)。
vi.mock('../../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: vi.fn(),
}));
vi.mock('../../../lib/payment/refund-actions', () => ({ initiateRefundAction: vi.fn() }));
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
vi.mock('../../../lib/supplier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supplier')>();
  return { ...actual, listSuppliers: mocks.listSuppliers };
});
vi.mock('../../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));

import OrderDetailPage from './page';

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';

// 🔴 fixture 的數字刻意互不相等且都非 0(4 / 3 / 1 / 2):
//    任兩個欄位接錯線、或某一格被補 0,下面的字面斷言都會紅。
const SUMMARY: AdminOrderItemQuantitySummary = {
  quantity: 4,
  orderedQuantity: 3,
  instockQuantity: 1,
  cancelledQuantity: 2,
  cancellableQuantity: 1,
};

function detail(quantitySummary: AdminOrderItemQuantitySummary | null): AdminOrderDetail {
  // `as unknown as` 同 procurement-wiring.test.tsx:62-63 的慣例(Money 是 branded type)。
  return {
    id: ORDER,
    displayId: 'ABC123',
    createdAt: '2026-08-04T02:00:00+00:00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    // 非 tappay:退款入口不該在這條測試裡渲染(它與九碼退場無關,少一個變數)。
    paymentChannel: 'bank_transfer',
    paymentMethod: null,
    paidAt: null,
    subtotal: { amount: 400, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 400, currency: 'TWD' },
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
        quantity: 4,
        unitPrice: { amount: 100, currency: 'TWD' },
        lineTotal: { amount: 400, currency: 'TWD' },
        workflowStatus: 'shipped_done',
        version: 1,
        procurements: [],
        procurementTruncated: false,
        quantitySummary,
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
  mocks.listSuppliers.mockResolvedValue([]);
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

describe('/orders/[id] — A9w1 九碼明細頁下架', () => {
  it('🔴 九碼零殘留:沒有商品狀態下拉、沒有 workflow_status 欄位、沒有整單彙總 badge', async () => {
    // 品項帶著 `workflowStatus: 'shipped_done'` 進來 —— 頁面仍不得把它畫出來。
    // 🔴 A9w3 後該欄已不在 `AdminOrderDetailItem` 契約裡(投影也不再取),fixture **刻意**留著:
    //    量的是「即使資料源硬塞這個值進來,畫面也不會冒出九碼」,不是「型別擋住了」。
    mocks.findAdminOrderDetail.mockResolvedValue(detail(SUMMARY));
    const { container, queryByRole, queryByText } = await renderPage();

    expect(queryByRole('combobox', { name: '商品狀態' })).toBeNull();
    // 下拉、hidden 欄位、送出鈕三種形狀都查(換掉 aria-label 還留著表單等於沒退場)。
    // 🔴 下面兩個欄名是 **wire 契約字面**(`item_id` / `workflow_status`),不是任何 TS 常數的名字。
    //    R1 抓到這裡原本寫 `wf_status`(**常數名不是欄名**),那個 selector 全 repo 零命中 = 恆真斷言。
    //    ⚠️ 這行的出處指標**被自己腐爛過兩次**:A9w4a 位移(`:9,12`→`:13,16`)、
    //    A9w4c 後半把 `ITEM_ID_FIELD`/`WF_STATUS_FIELD` **整個刪掉**(那兩個行號現在指到不相干的東西)。
    //    ⇒ 第三次不再寫行號、也不再指常數:欄名的權威是 **DB 欄與 HTML name 屬性**,literal 就是它本身。
    expect(container.querySelector('select[name="workflow_status"]')).toBeNull();
    expect(container.querySelector('input[name="workflow_status"]')).toBeNull();
    expect(container.querySelector('input[name="item_id"]')).toBeNull();
    expect(queryByRole('button', { name: '存' })).toBeNull();
    // 九碼詞彙本身:`shipped_done` 的代碼與整單彙總的「多狀態」都不該出現在畫面上。
    expect(container.textContent).not.toContain('shipped_done');
    expect(queryByText('多狀態')).toBeNull();
  });

  it('🔴 三軸數字真的接到 A9g-1 投影(任一欄接錯線就紅)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail(SUMMARY));
    const { container } = await renderPage();

    // 連標籤一起比,才擋得住「兩個軸的數字對調」這種改法(單看 `3/4` 在不在場擋不住)。
    expect(container.textContent).toContain('訂貨 3/4');
    expect(container.textContent).toContain('到貨 1/4');
    expect(container.textContent).toContain('已取消 2');
    expect(container.textContent).not.toContain('數量資料尚未就緒');
  });

  it('🔴 摘要為 null = 「不知道」不是「都是 0」:顯示未就緒、不得出現補 0 的數字', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail(null));
    const { getByText, container } = await renderPage();

    expect(getByText('數量資料尚未就緒')).toBeTruthy();
    // 這一行是「有人寫 `?? 0`」的突變證:補 0 會畫出「訂貨 0/4」。
    expect(container.textContent).not.toContain('0/4');
  });
});
