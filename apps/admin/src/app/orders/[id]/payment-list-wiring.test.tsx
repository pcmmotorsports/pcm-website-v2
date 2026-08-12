// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
import type { OrderPaymentRow } from '../../../lib/orders/payment-list-view';

// payment-list-wiring.test.tsx — M-4b E10 **#15-B2-c 片1a**:收款明細的**頁層接線**測試
// (`refund-wiring.test.tsx` / `procurement-wiring.test.tsx` 同型)。
//
// 🔴 **為什麼非有頁層這一支不可**:`payment-list.tsx` 的三態元件測試早就綠了
//    (B2-a 那片),但那些測試是**直接餵 prop**。真正會出事的是**中間那一跳** ——
//    `listOrderPayments` 的 `[] / null / throw` 折成 `PaymentListData` 的那段程式碼。
//    把 `throw` 折成 `{status:'ok', rows:[]}` 的話:元件測試全綠、頁面畫「尚未登錄任何收款」,
//    而事實是「不知道有沒有」⇒ 員工照著再登一次 ⇒ **重複入帳**。
//    ⇒ 本檔量的是「repository 的三種回法 → 畫面上三句不同的話」整條。
//    (memory `feedback_assertion-measures-the-wrong-thing` 第四形狀:兩端各有測試、
//     中間透傳一跳無人守。)

vi.mock('server-only', () => ({}));
vi.mock('../../../lib/session/actor', () => ({ getSessionActor: async () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
// 每一支 server action 模組都要 mock(vite import 分析先於 `vi.mock('server-only')` 生效;
// `refund-wiring.test.tsx:27-34` 同註)。
vi.mock('../../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn() }));
vi.mock('../../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn(),
}));
vi.mock('../../../lib/orders/note-actions', () => ({ appendOrderNoteAction: vi.fn() }));
vi.mock('../../../lib/orders/order-actions', () => ({ updateOrderWorkflowAction: vi.fn() }));
vi.mock('../../../lib/payment/refund-actions', () => ({ initiateRefundAction: vi.fn() }));

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listSuppliers: vi.fn(),
  listOrderRefunds: vi.fn(),
  getLedgerUnregisteredAmount: vi.fn(),
  listOrderPayments: vi.fn(),
}));
vi.mock('../../../lib/payment/refund-read', () => ({
  listOrderRefunds: mocks.listOrderRefunds,
  getLedgerUnregisteredAmount: mocks.getLedgerUnregisteredAmount,
}));
// 🔴 `payment-repository` → `createSupabaseServiceClient`(server-only)⇒ 必 mock。
vi.mock('../../../lib/orders/payment-repository', () => ({
  listOrderPayments: mocks.listOrderPayments,
}));
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));
vi.mock('../../../lib/supplier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supplier')>();
  return { ...actual, listSuppliers: mocks.listSuppliers };
});
vi.mock('../../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));
// `ShipmentSection` 是 async server component,RTL 同步渲染吃不下(`refund-wiring.test.tsx:61-67`)。
vi.mock('../../../components/orders/shipment-section', () => ({ ShipmentSection: () => null }));

import OrderDetailPage from './page';

const ORDER = '11111111-1111-4111-8111-111111111111';

function detail(): AdminOrderDetail {
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
    items: [],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

/**
 * 🔴 **金額刻意不用 0、不用 100**(memory `feedback_fixture-value-makes-guard-vacuous`):
 *  · `0` 會讓「有沒有印出金額」的斷言在多種壞掉的實作下都碰巧成立;
 *  · `100` 與 `detail().total` 撞號 ⇒ 「畫面上找得到 100」可能是訂單總額印出來的,不是收款列。
 *  取 **8642**:全頁只有這一個地方會出現。
 */
function paymentRow(over: Partial<OrderPaymentRow> = {}): OrderPaymentRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    rail: 'bank_transfer',
    amount: 8642,
    receivedAt: '2026-08-05T01:00:00+00:00',
    createdAt: '2026-08-05T02:00:00+00:00',
    actor: 'sean',
    bankReference: 'REF-8642',
    recTradeId: null,
    payerNote: null,
    reversesPaymentId: null,
    reversalReason: null,
    isReversal: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
  mocks.listSuppliers.mockResolvedValue([]);
  mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
  mocks.getLedgerUnregisteredAmount.mockResolvedValue(null);
  mocks.listOrderPayments.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

async function renderPage() {
  const ui = await OrderDetailPage({
    params: Promise.resolve({ id: ORDER }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

/**
 * 🔴 **正向對照**:每一格「沒有 X」的斷言都要先證明頁面**真的畫出來了**,
 *    否則 container 是空字串時所有 `not.toContain` 都恆真(整支測試變成裝飾)。
 */
function expectPageRendered(container: HTMLElement) {
  expect(container.textContent).toContain('ABC123');
  expect(container.textContent).toContain('已登錄的收款');
}

/**
 * 🔴🔴 **斷言必須鎖在收款區塊裡,不可以拿整頁字串比對**(第一版就是這樣寫、當場被自己的測試抓到):
 *  · `'讀取失敗'` —— 取消紀錄區塊逐字也有「取消紀錄讀取失敗,無法顯示」;
 *  · `'0 筆'` —— 備註區塊逐字也有「0 筆」。
 *  ⇒ 拿整頁比對的話,`not.toContain` 會被**別人的**文字弄紅(這次),
 *    而反過來 `toContain` 會被別人的文字弄**綠**(更糟:收款區塊整個消失也照樣過)。
 *  取區塊的錨 = `<h2>已登錄的收款</h2>` 所在的 `<section>`(`payment-list.tsx` 逐字)。
 * ⚠️ 找不到就 throw,不回 null —— 回 null 會讓後面每一條斷言變成對空字串發問。
 */
function paymentSection(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('h2')).find(
    (h) => h.textContent === '已登錄的收款',
  );
  const section = heading?.closest('section');
  if (!section) throw new Error('找不到收款區塊(<h2>已登錄的收款</h2> 的 section)');
  return section as HTMLElement;
}

/** 收款區塊裡的文字(所有區塊專屬斷言都走這支)。 */
function paymentText(container: HTMLElement): string {
  return paymentSection(container).textContent ?? '';
}

describe('#15-B2-c 片1a:listOrderPayments 的三種回法 → 畫面三句不同的話', () => {
  it('有收款列 ⇒ 列出來,且筆數與金額都在畫面上', async () => {
    mocks.listOrderPayments.mockResolvedValue([paymentRow()]);
    const { container } = await renderPage();
    expectPageRendered(container);
    const text = paymentText(container);
    expect(text).toContain('1 筆');
    expect(text).toContain('8,642');
    expect(text).toContain('銀行匯款');
    // 這條路**不該**出現另外兩態的任何一句。
    expect(text).not.toContain('尚未登錄任何收款');
    expect(text).not.toContain('讀取失敗');
  });

  it('空陣列 ⇒ 說「尚未登錄任何收款」(訂單在、真的還沒收過款)', async () => {
    mocks.listOrderPayments.mockResolvedValue([]);
    const { container } = await renderPage();
    expectPageRendered(container);
    const text = paymentText(container);
    expect(text).toContain('尚未登錄任何收款');
    expect(text).toContain('0 筆');
  });

  it('🔴 回 null(訂單不存在)⇒ 說「查不到這張訂單」,**不得**說「尚未登錄任何收款」', async () => {
    // 靶:把 `null` 收斂成 `[]` ⇒ 這一格轉紅。
    // ⚠️ **誠實界線(code-reviewer R1 nit-4)**:這條在**今天的頁面上近乎不可達** ——
    //    `order-detail-route` 在 `detail === null` 時就先 `notFound()` 了,走得到這裡代表
    //    「訂單本體讀得到、但收款 RPC 說這張單不存在」(兩個來源不一致)。
    //    ⇒ 本格守的是**防禦深度**,不是活路徑;留著的理由是 `listOrderPayments` 的契約有這一態,
    //    而契約有的態一旦沒人測,下一個人就會順手把它收斂掉(收斂的方向正好是會說謊的那邊)。
    mocks.listOrderPayments.mockResolvedValue(null);
    const { container } = await renderPage();
    expectPageRendered(container);
    const text = paymentText(container);
    expect(text).toContain('查不到這張訂單');
    expect(text).not.toContain('尚未登錄任何收款');
  });

  it('🔴🔴 throw(讀不到)⇒ 說「不知道有沒有」,**不得**說「0 筆」或「尚未登錄」', async () => {
    // 🔴 這是全片最重要的一格。靶:把 `rejected` 折成 `{status:'ok', rows:[]}`
    //    ⇒ 畫面會說「尚未登錄任何收款 / 0 筆」,而事實是「不知道有沒有」
    //    ⇒ 員工照著再登一次 = 重複入帳。折錯的那個版本在這格必須轉紅。
    mocks.listOrderPayments.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expectPageRendered(container);
    const text = paymentText(container);
    expect(text).toContain('讀取失敗');
    expect(text).toContain('筆數未知');
    expect(text).not.toContain('尚未登錄任何收款');
    expect(text).not.toContain('0 筆');
  });

  it('🔴 收款讀取失敗**不得**讓整頁掛掉(獨立容錯,同退款帳本那條)', async () => {
    mocks.listOrderPayments.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    // 訂單本體、採購、備註都還在 ⇒ 證明失敗被關在收款那一塊裡面。
    expect(container.textContent).toContain('ABC123');
    expect(container.textContent).toContain('客戶資訊');
  });

  // 🔴 **本格在片2a 被刻意翻面,不是刪掉**:片1a 原本逐字斷言「本片是唯讀、不得出現任何
  //    登錄收款的表單入口(片2 才有)」——片2a 落地之後那句話**應該**不成立了。
  //    刪掉它等於讓「表單掛沒掛上」重新變成無人看守;翻成正面斷言才保得住同一個觀察點。
  it('片2a 起:登錄表單掛在同一張卡裡,而且帶著整組 server 章', async () => {
    mocks.listOrderPayments.mockResolvedValue([paymentRow()]);
    const { container } = await renderPage();
    expectPageRendered(container);
    // 錨 = 收款表單專屬的欄位名(`payment-action-state.ts` 的 `PAY_RAIL_FIELD` 等)。
    const section = paymentSection(container);
    expect(section.querySelector('input[name="rail"]')).not.toBeNull();
    // 🔴 印章**兩格都要在**:`payment-form.ts:160-166` 逐字「兩軌都驗」——
    //    只掛一半的表單送出去會被解析器判 invalid,而畫面上完全看不出來。
    const requestId = section.querySelector('input[name="request_id"]');
    const cashReceivedAt = section.querySelector('input[name="cash_received_at"]');
    expect(requestId).not.toBeNull();
    expect(cashReceivedAt).not.toBeNull();
    // 🔴 **不可以用 `not.toBe('')` 驗非空**(codex 關卡2 nit2):`value` 屬性整個被拿掉時
    //    `getAttribute()` 回的是 `null`,而 `null !== ''` ⇒ 那條斷言照樣過、什麼也沒驗到。
    //    ⇒ 改成比對形狀:uuid 與 ISO 時點各自要長得像自己。
    expect(requestId?.getAttribute('value')).toMatch(/^[0-9a-f-]{36}$/);
    expect(cashReceivedAt?.getAttribute('value')).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });
});
