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
// 🔴 **`markOrderCancelledAction` 也要 mock**(片② 2026-09-05 新增的第二個 server action)——
//    少了它, 任何渲染到 `MarkCancelledForm` 的路徑會炸
//    `No "markOrderCancelledAction" export is defined on the … mock`。
//    📌 而**七支檔 mock 這個模組, 而當時只有一支紅** ⇒ 另外六支是【潛伏的】:
//       它們今天沒渲染到那條路而已。⇒ **模組多一個 export 時, 它的每一份 mock 都要跟上。**
vi.mock('../../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn(), markOrderCancelledAction: vi.fn() }));
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
  listPendingRefundAmounts: vi.fn(),
  cancelPendingRefundNotice: vi.fn(),
}));
// 🔴🔴 **這個 mock 是【錢的告知鏈】唯一的接線守門**(codex 2026-09-05 finding 4)——
//    在它之前, 把 route 那發 RPC 整個拔掉、固定傳 `pendingRefund={{kind:'none'}}`,
//    元件層與判準層的測試**全部照樣綠**。⇒ 📌 那與 R3 抓到的「解析端好了而畫面沒那個 input」
//    是同一個病的第四個實例:**每一層都測了自己, 而沒有人測【它們有沒有接起來】。**
vi.mock('../../../lib/payment/pending-refund-repository', () => ({
  listPendingRefundAmounts: mocks.listPendingRefundAmounts,
}));
// 🔴 **判準那支【不整個換掉】, 而是「呼叫真的那一支 + 記下它收到什麼」** ——
//    整個 mock 掉的話, 這一族就變成在測我的 mock, 而不是在測接線。
vi.mock('../../../lib/orders/cancel-pending-refund-notice', async (orig) => {
  const actual =
    await orig<typeof import('../../../lib/orders/cancel-pending-refund-notice')>();
  return { ...actual, cancelPendingRefundNotice: mocks.cancelPendingRefundNotice };
});
vi.mock('../../../lib/payment/refund-read', () => ({
  listOrderRefunds: mocks.listOrderRefunds,
  getLedgerUnregisteredAmount: mocks.getLedgerUnregisteredAmount,
}));
// 🔴 `payment-repository` → `createSupabaseServiceClient`(server-only)⇒ 必 mock。
vi.mock('../../../lib/orders/payment-repository', () => ({
  listOrderPayments: mocks.listOrderPayments,
}));
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    // 🔴 `D2` C 條(2026-08-18):明細頁改走頂層分頁撈到盡 ⇒ route 會多呼叫這一支。
    //    這裡從【上一次 `findAdminOrderDetail` 回的那份】導出,讓本檔既有各格
    //    繼續量它們本來在量的東西(收款 / 取消 / 採購 / 排序…)。
    //    🔴🔴 **代價要講白:這樣導出之後,本檔【對「品項撈不撈得全」零判別力】** ——
    //    兩份永遠一樣。那一面由 `lib/orders/merge-detail-items.test.ts` 守(它真的餵 201 項)。
    //    ⚠️ 用 `mock.results` 而不是再呼叫一次:再呼叫會**消耗 `mockResolvedValueOnce` 鏈**。
    listOrderItemsForDetail: async () => {
      const d = await mocks.findAdminOrderDetail.mock.results.at(-1)?.value;
      const items = d?.items ?? [];
      // 🔴 **把 fixture 的意圖翻譯到新機制上**:
      //    `D2` C 條之後,「這張單的品項沒列完」不再由 detail 的 `itemsTruncated` 表達
      //    (那一份是內嵌撈的、而明細頁已經改走撈到盡)——
      //    改由【撈到的筆數與伺服器說的對不上】表達。
      //    ⇒ fixture 說 truncated ⇒ 這裡回一個對不上的 count,讓 merge 判它不完整。
      //    ⚠️ 不這樣翻的話,本檔那幾格「截斷時要印未知」的守門會【無法構造那個狀態】而被誤刪。
      return {
        items,
        reportedTotal: d?.itemsTruncated === true ? items.length + 1 : items.length,
      };
    },
  }),
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
    taxTotal: { amount: 0, currency: 'TWD' },
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
  mocks.listPendingRefundAmounts.mockResolvedValue([]);
  mocks.cancelPendingRefundNotice.mockImplementation((r: unknown) =>
    r === null ? { kind: 'unknown' } : { kind: 'none' },
  );
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
  // 🔴 #437 ① 把標題改成「收款」之後**不能**再拿它當子字串錨 ——
  //    「尚未登錄任何收款」「新增收款」都含這兩個字 ⇒ 收款區塊整個消失也照樣綠。
  //    改用結構錨:`paymentSection()` 找不到 `<h2>收款</h2>` 的 section 會 throw。
  expect(paymentSection(container)).not.toBeNull();
}

/**
 * 🔴🔴 **斷言必須鎖在收款區塊裡,不可以拿整頁字串比對**(第一版就是這樣寫、當場被自己的測試抓到):
 *  · `'讀取失敗'` —— 取消紀錄區塊逐字也有「取消紀錄讀取失敗,無法顯示」;
 *  · `'0 筆'` —— 備註區塊逐字也有「0 筆」。
 *  ⇒ 拿整頁比對的話,`not.toContain` 會被**別人的**文字弄紅(這次),
 *    而反過來 `toContain` 會被別人的文字弄**綠**(更糟:收款區塊整個消失也照樣過)。
 *  取區塊的錨 = `<h2>收款</h2>` 所在的 `<section>`(`payment-list.tsx` 逐字)。
 * ⚠️ 找不到就 throw,不回 null —— 回 null 會讓後面每一條斷言變成對空字串發問。
 */
function paymentSection(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('h2')).find(
    (h) => h.textContent === '收款',
  );
  const section = heading?.closest('section');
  if (!section) throw new Error('找不到收款區塊(<h2>收款</h2> 的 section)');
  return section as HTMLElement;
}

/** 收款區塊裡的文字(所有區塊專屬斷言都走這支)。 */
function paymentText(container: HTMLElement): string {
  return paymentSection(container).textContent ?? '';
}

/**
 * 🔴 `#841` 甲案(2026-08-22,線 A `-86`):**收到錢了、而那張單仍然被預設隱藏 ⇒ 畫面要講。**
 *
 * **病**:員工照著唯一一條人工出路走完(客人刷卡失敗 → 改用匯款 → 他登錄收款),
 * 而那張單的 `payment_channel='tappay'` / `payment_status='unpaid'` **兩欄一個字都沒動**
 * ⇒ 它仍然符合列表的預設隱藏規則 ⇒ **從他眼前消失,而沒有任何字告訴他為什麼。**
 * 真訂單 `2SQH2P` 實測:登錄 1,500 之後,總覽說「今日實收 1,500」、面板說「尾款 0」,
 * 而預設清單 **0 命中**(正對照同頁其他單 6 命中)。
 *
 * 🔴 **三格,而三格守的是三件不同的事**:
 *   ① 該講的時候講      —— 否則員工以為單子不見了
 *   ② 沒收過錢時不講    —— 那種單被藏起來【是 Sean 要的行為】,講出來只是噪音
 *   ③ 讀不到明細時不講  —— 「不知道有沒有收過錢」不可以被畫成「有」
 *
 * ⚠️ **本族只驗「有沒有講」,不驗隱藏規則本身** —— 甲案一個字都沒改行為。
 *
 * ══ 🔴🔴 `#841` 治本(2026-08-23)之後,①③ 兩格的真值【換了】 ═══════════════════
 *
 * 隱藏規則現在會問帳本(`SupabaseOrderAdapter.ts` 的 `and(paid_total.neq.0,cancelled_at.is.null)`)
 * ⇒ **淨額 > 0 的單不再被藏** ⇒ 對它講「預設不會出現在訂單列表」變成一句**假話**,
 * 而且會教員工去勾一個不必勾的勾。
 *
 * 🔴 **這裡改的是【期望值】,而那通常是停止訊號** —— 所以把理由寫清楚:
 *    改的不是「測試太嚴」,是**被測的那句話在新行為下不再為真**。
 *    ⇒ 覆蓋面**沒有縮**:原①(淨額>0 ⇒ 講)翻成「⇒ 不講」,
 *      並**新增**一格(收了又沖、淨額 0 ⇒ 仍被藏 ⇒ 仍要講)接住原①守的那件事。
 *    判別句:**「有收款列」與「被藏起來」在治本前等價,治本後不等價。**
 *    而**沒有任何測試會因為一句話變假而紅** —— 這一族就是補那個缺口。
 */
function hiddenNotice(container: HTMLElement): Element | null {
  return (
    Array.from(container.querySelectorAll('[role="status"]')).find((el) =>
      (el.textContent ?? '').includes('預設不會出現在訂單列表'),
    ) ?? null
  );
}

describe('#841 甲:收到錢了而那張單仍被預設隱藏 ⇒ 面板要講', () => {
  it('🔴 tappay + unpaid + 收了又沖(淨額 0)⇒ 講,而且給得出一條點得過去的路', async () => {
    // 🔴 淨額 0 = 收了又沖掉 = 錢不在我們手上 ⇒ 治本之後它**仍然**被藏 ⇒ 這句話對它仍然為真。
    //    ⚠️ 判斷沖銷用 `isReversal`,不是看金額正負(`payment-list-view.ts:28-31`);
    //       這裡的加總本來就只加總、不分類。
    mocks.findAdminOrderDetail.mockResolvedValue({ ...detail(), paymentStatus: 'unpaid' });
    mocks.listOrderPayments.mockResolvedValue([
      paymentRow(),
      paymentRow({
        id: '33333333-3333-4333-8333-333333333333',
        amount: -8642,
        bankReference: null,
        reversesPaymentId: '22222222-2222-4222-8222-222222222222',
        reversalReason: '測試沖銷',
        isReversal: true,
      }),
    ]);
    const { container } = await renderPage();
    const notice = hiddenNotice(container);
    expect(notice, '錢收了又沖掉、單子仍被藏起來時必須講').not.toBeNull();
    // 🔴 只講不給路 = 還是死路。連結要真的帶著那個開關。
    const href = notice?.querySelector('a')?.getAttribute('href') ?? '';
    expect(href).toContain('show_unpaid_card=1');
  });

  it('🔴 tappay + unpaid + 淨額 > 0 + 【已取消】⇒ 講 —— 它仍然被藏著', async () => {
    // 🔴 這一格是 code-reviewer(R1 MF3)抓出來的,我第一版漏了。
    //    新述詞的復活條件是 `and(paid_total.neq.0,cancelled_at.is.null)` ⇒ **兩個條件都要成立才放行**
    //    ⇒ 已取消的單即使有錢也**仍然被藏** ⇒ 只看「淨額 = 0」會讓它不再跳提示,
    //      而那**比治本前更糟**(治本前它會跳)。
    mocks.findAdminOrderDetail.mockResolvedValue({
      ...detail(),
      paymentStatus: 'unpaid',
      cancelledAt: '2026-08-23T02:00:00+00:00',
    });
    mocks.listOrderPayments.mockResolvedValue([paymentRow()]);
    const { container } = await renderPage();
    expect(hiddenNotice(container), '已取消 + 有錢 ⇒ 它仍然被藏著,必須講').not.toBeNull();
  });

  it('🔴 tappay + unpaid + 【淨額 > 0】⇒ 不講 —— 治本之後它已經看得見了,講了是假話', async () => {
    // 🔴 這一格在 `#841` 治本【之前】的期望值是「要講」。翻面的理由不是測試太嚴,
    //    是那句「預設不會出現在訂單列表」對這種單**已經是假的**。
    mocks.findAdminOrderDetail.mockResolvedValue({ ...detail(), paymentStatus: 'unpaid' });
    mocks.listOrderPayments.mockResolvedValue([paymentRow()]);
    const { container } = await renderPage();
    expect(hiddenNotice(container)).toBeNull();
    // 正對照:這一發真的渲染了付款卡 ⇒ 上面那個 null 不是「整頁沒出來」造成的。
    expect(container.textContent ?? '').toContain('收款');
  });

  // 🔴🔴 **下面這兩格 2026-08-28 量到是恆綠的** —— 它們唯一那條斷言是
  //    `hiddenNotice(container)).toBeNull()`,而 `hiddenNotice` 找不到就回 `null`
  //    ⇒ **整頁沒渲染時它們照樣綠**(實測:`app/orders/[id]/page.tsx:98` 插空渲染
  //    ⇒ 本檔 13 格裡 11 格紅,而這兩格是那 2 格綠)。
  // ⚠️ **同族的其他格早就有錨了** —— 上一格帶著「正對照:這一發真的渲染了付款卡」那一行,
  //    `#841 乙` 那一族五格都呼叫 `expectPageRendered`。**缺的只有這兩格。**
  //    📌 一族裡大部分有錨、少數沒有 ⇒ 整族讀起來像已經處理過了。
  // ⇒ 補的是**本檔既有的** `expectPageRendered`,不另外發明第三種寫法。
  it('🔴 tappay + unpaid + 【零收款】⇒ 不講(那種單被藏是刻意的,講了是噪音)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue({ ...detail(), paymentStatus: 'unpaid' });
    mocks.listOrderPayments.mockResolvedValue([]);
    const { container } = await renderPage();
    expectPageRendered(container);
    expect(hiddenNotice(container)).toBeNull();
  });

  it('🔴 收款明細【讀不到】⇒ 不講 ——「不知道有沒有收過錢」不可以被畫成「有」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue({ ...detail(), paymentStatus: 'unpaid' });
    mocks.listOrderPayments.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expectPageRendered(container);
    expect(hiddenNotice(container)).toBeNull();
  });

  it('🔴 【非 tappay】+ unpaid + 有收款 ⇒ 不講 —— 現金/匯款單不受這條規則管', async () => {
    // 🔴 codex 2026-08-23 M6:本族原本**每一格都是 tappay** ⇒ 把元件的 channel 那道拿掉,
    //    整組仍然全綠。這一格就是那個缺口。
    mocks.findAdminOrderDetail.mockResolvedValue({
      ...detail(),
      paymentStatus: 'unpaid',
      paymentChannel: 'cash',
    });
    mocks.listOrderPayments.mockResolvedValue([paymentRow()]);
    const { container } = await renderPage();
    expect(hiddenNotice(container), '非 tappay 的單本來就看得見,講了是假話').toBeNull();
    // 正對照:這一發真的渲染了付款卡 ⇒ 上面那個 null 不是「整頁沒出來」造成的。
    expect(container.textContent ?? '').toContain('收款');
  });

  it('已付款(不符隱藏規則)+ 有收款 ⇒ 不講', async () => {
    mocks.listOrderPayments.mockResolvedValue([paymentRow()]);
    const { container } = await renderPage();
    expect(hiddenNotice(container)).toBeNull();
    // 正對照:這一發真的渲染了付款卡 ⇒ 上面那個 null 不是「整頁沒出來」造成的。
    expect(container.textContent ?? '').toContain('收款');
  });
});

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

// 🔴 **本檔原本的 `detail()` 是 `items: []` ⇒ 取消區【整個不渲染】**(`order-cancel-block.tsx:95`
//    的 `view.canCancel`)⇒ 想看那個框就必須餵一張**有品項**的單。
//    🔬 那不是我猜的:第一版直接用 `detail()` ⇒ 兩格「框在」當場紅、`box()` 回 null。
//    形狀逐字抄隔壁 `procurement-wiring.test.tsx:130-157`, 不自創第二種。
function detailWithItem(): AdminOrderDetail {
  return {
    ...detail(),
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        variantSku: 'SKU-1',
        title: '下導流',
        spec: null,
        quantity: 2,
        unitPrice: { amount: 50, currency: 'TWD' },
        lineTotal: { amount: 100, currency: 'TWD' },
        quantitySummary: {
          quantity: 2,
          cancelledQuantity: 0,
          orderedQuantity: 2,
          instockQuantity: 0,
          shippedQuantity: 0,
        },
        procurements: [],
        procurementTruncated: false,
      },
    ],
  } as unknown as AdminOrderDetail;
}

describe('🔴 錢的告知鏈:route → prop(codex finding 4 —— 這一族是【接線】的守門)', () => {
  // 🔴🔴 **這一族的射程要先說清楚, 免得下一個人以為它守到畫面了。**
  //    🔬 **實測(2026-09-05, 三發診斷)**:本檔的 `renderPage()` 走 server render,
  //       而取消區住在「錢」那個**分頁**裡, 分頁是 `initialKey` 的 **client 狀態**
  //       (`order-detail.tsx:311`)⇒ 首屏 HTML 裡 `cancel_mode` / `cancel-shipment-warning`
  //       **一個都沒有**(量到的是 `{shipBox:false, cancelMode:false, submitFull:false}`)。
  //    ⇒ 🛑 **所以「RPC 的值有沒有畫進那個框」這一格, 在這裡【量不到】** —— 那是結構性的,
  //       不是我沒寫。它由 `cancel-order-forms.test.tsx` 那一族守(三個世界 + 突變 3 紅)。
  //    ✅ **這裡守得住的是【route 到底有沒有去讀】** —— 而那正是 codex finding 4
  //       點名的那個突變:「把 route 那發 RPC 拔掉、固定傳 `none`」。
  //    ⚠️ **仍然守不住**:保留呼叫而把 prop 硬寫成 `none`。**已知缺口, 不是已守住。**
  it('🔵 route 真的有去讀待退款, 而且帶著這張單的 id', async () => {
    mocks.listPendingRefundAmounts.mockResolvedValue([]);
    await renderPage();
    expect(mocks.listPendingRefundAmounts).toHaveBeenCalledWith(ORDER);
  });

  it('🔴🔴 RPC 拋的時候, route 餵給判準的是 `null`(= unknown), 【不是】空陣列', async () => {
    // 🛑 這一格是這一族最重要的那個 —— 它殺的是「把 catch 改成 `pendingRefundRails = []`」。
    //    那個突變會讓「讀不到」變成「沒收過錢」⇒ **畫面上沒有紅框** ⇒ 錢靜靜地不見,
    //    而它在**元件層與判準層都量不到**(那兩層拿的是已經算好的 prop)。
    //    🔬 實測:在補這一格之前, 那個突變**全綠**(15/15)。
    mocks.listPendingRefundAmounts.mockRejectedValue(new Error('42501'));
    await renderPage();
    expect(mocks.cancelPendingRefundNotice).toHaveBeenCalledWith(null);
  });

  it('🔵 正對照:RPC 成功時餵的是那個陣列本身, 不是 null', async () => {
    // 少了這一格,一個「永遠餵 null」的實作會讓上面那格綠。
    const rails = [{ rail: 'cash', amount: 100 }];
    mocks.listPendingRefundAmounts.mockResolvedValue(rails);
    await renderPage();
    expect(mocks.cancelPendingRefundNotice).toHaveBeenCalledWith(rails);
  });

  it('🔴 RPC 拋的時候, 整頁【不能】掛掉(那一發由 route 的 try/catch 接住)', async () => {
    // 🛑 少了這一格,一個「把 try/catch 拿掉」的改動會讓整張訂單頁在讀不到時 500,
    //    而那比看不到紅框嚴重一級。
    mocks.listPendingRefundAmounts.mockRejectedValue(new Error('42501'));
    const { container } = await renderPage();
    expectPageRendered(container);
  });
});
