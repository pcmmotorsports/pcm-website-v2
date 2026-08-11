// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// cancel-wiring.test.tsx — M-4b E10 **A13b D6-a**:取消線的**頁層接線**測試。
//
// 🔴 **為什麼一定要在頁層量**:元件層把 `cancelFormsAllowed` 當 prop 餵,
//    等於把 `page → route → order-detail` 這條傳遞鏈整段拔掉 —— 誰把那條閘接錯 / 忘了接,
//    元件測試照樣全綠,而正式站上員工在失敗結果頁**看得到表單、按得下第二次**。
//    ⇒ 本檔量的是「URL 的 `?r=` → 頁層 → 表單出不出現」整條。
//
// 🔴 **突變清單(逐發實跑、全紅零存活)**:
//   W1  `OrderCancelBlock` 的 `showForms` 拿掉 `formsAllowed === true`...... 紅 4
//       🔴 **這發是本片核心**:D5 只交付判斷,**這裡才是它真的生效的地方**;拿掉 = 義務 B 沒有執行點。
//   W2  `OrderDetail` 的 `cancelFormsAllowed` 預設改成 `true`............... 紅 1
//       🔴 **第一次跑存活** —— 頁層每條都經 route 明確傳值,那個預設值沒有測試走得到。
//       補「直接渲染 OrderDetail 不傳 prop」兩格才殺掉。
//   W2b `OrderCancelBlock` 自己的 `=== true` 放寬成 `!== false`............. 紅 1
//       🔴 **也是第一次跑存活** —— `OrderDetail` 恆傳布林,區塊收不到 `undefined`
//       ⇒ 它自己那層縱深從沒被走到。**沒被測到的縱深等於不存在** ⇒ 補直接渲染區塊那兩格。
//   W3  `order-detail-route.tsx` 不傳 `cancelFormsAllowed`(忘了接線)....... 紅 2
//   W4  面板改掛進資格閘內(已取消的單就不渲染)............................ 紅 2
//   W5  頁層先 `typeof === 'string'` 才傳(narrow 掉重複鍵)................ 紅 1
//       🔴 那會讓 `?r=a&r=b` 變成「沒有結果碼」⇒ **面板不出現、表單卻開著** = fail-open。
//       這是 D5 的 R2 抓過的同一形狀,我在頁層又做了一次。
//   W6  `cancellationsTruncated` 缺值折回 `?? false`........................ 紅 1
//       🔴 **第一次跑存活**。折成 false ⇒ 落 `miss_complete` ⇒ 面板說「仍然沒有,才重新送一次」
//       = 全片唯一會讓員工按第二次的那句。

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('../../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn(),
}));
vi.mock('../../../lib/orders/note-actions', () => ({ appendOrderNoteAction: vi.fn() }));
vi.mock('../../../lib/orders/order-actions', () => ({ updateOrderWorkflowAction: vi.fn() }));
vi.mock('../../../lib/payment/refund-actions', () => ({ initiateRefundAction: vi.fn() }));
vi.mock('../../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn() }));

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listSuppliers: vi.fn(),
  listOrderRefunds: vi.fn(),
  getLedgerUnregisteredAmount: vi.fn(),
  getSessionActor: vi.fn(),
}));
vi.mock('../../../lib/session/actor', () => ({ getSessionActor: mocks.getSessionActor }));
vi.mock('../../../lib/payment/refund-read', () => ({
  listOrderRefunds: mocks.listOrderRefunds,
  getLedgerUnregisteredAmount: mocks.getLedgerUnregisteredAmount,
}));
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));
vi.mock('../../../lib/supplier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supplier')>();
  return { ...actual, listSuppliers: mocks.listSuppliers };
});
vi.mock('../../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));
// 🔴 #15-B2-c 片1a:`order-detail-route` 起會讀 `listOrderPayments`(→ `createSupabaseServiceClient`
//    = server-only)。⚠️ **不 mock 也不會紅** —— 它在呼叫時 throw、被 `allSettled` 接住折成
//    `unreadable` ⇒ 本檔每次 renderPage 都靜默多畫一塊紅框 + 噴 `console.error`,
//    而本檔要驗的東西照樣全綠 ⇒ 那塊紅框會被下一個人當成既有雜訊。回空陣列 = 「這單沒收過款」,
//    與本檔要驗的東西無關,也不會多畫任何東西。
vi.mock('../../../lib/orders/payment-repository', () => ({
  listOrderPayments: vi.fn(async () => []),
}));

// 🔴 `<ShipmentSection>` 是 **async server component**,而本檔用 RTL **同步**渲染
//    ⇒ 不 mock 的話整個 OrderDetail 渲染不出來(症狀 = container 變空字串、**而且不報錯**)。
//    ⚠️ 我第一版把這組測試寫在元件層、沒 mock 它 —— 結果「期望 0 個表單」那幾格**全部恆綠**
//    (畫面本來就空的),只有期望有內容的那兩格紅。**那正是本檔每一格都配正向對照的原因。**
//    真實 Next 支援 async server component,這是測試工具的限制、不是產品缺陷
//    (逐字同 `refund-wiring.test.tsx` 的同一段註解)。
vi.mock('../../../components/orders/shipment-section', () => ({
  ShipmentSection: () => null,
}));

import OrderDetailPage from './page';
import { OrderDetail } from '../../../components/orders/order-detail';
import { OrderCancelBlock } from '../../../components/orders/order-cancel-block';
import {
  ORDER_CANCELLED_RESULT_CODE,
  toOrderCancelResultCode,
} from '../../../lib/orders/cancel-action-state';

const ORDER = '11111111-1111-4111-8111-111111111111';
const ITEM = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const TOKEN = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';

function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: ORDER,
    displayId: 'ABC123',
    createdAt: '2026-08-04T02:00:00+00:00',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    paymentMethod: null,
    paidAt: null,
    subtotal: { amount: 500, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 500, currency: 'TWD' },
    shippingMethod: 'home',
    shippingAddress: { name: null, phone: null, line: null },
    customer: { name: null, email: null, phone: null },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    cancelledReason: null,
    chargeAttemptGate: 'clear',
    version: 1,
    items: [
      {
        id: ITEM,
        variantSku: 'SKU-1',
        title: '下導流',
        spec: null,
        quantity: 5,
        unitPrice: { amount: 100, currency: 'TWD' },
        lineTotal: { amount: 500, currency: 'TWD' },
        procurements: [],
        procurementTruncated: false,
        quantitySummary: {
          quantity: 5,
          orderedQuantity: 4,
          instockQuantity: 0,
          cancelledQuantity: 0,
          cancellableQuantity: 5,
        },
      },
    ],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
    cancellations: [],
    cancellationsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}

/**
 * 一列取消歷程。
 * 🔴 `items` / `itemsTruncated` **不可省**:`readCancellationLedger` 會逐列走 `entry.items`,
 *    而真實 mapper(`mappers/order-cancellations.ts`)**一定**會設這兩欄
 *    (缺鍵只發生在**外層** `cancellations` 那一層)⇒ 這裡缺就是 fixture 不對,不是 code 該放寬。
 */
function cancellation(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    reasonCode: 'customer_request',
    reasonDetail: null,
    actor: 'staff-alice',
    idempotencyKey: TOKEN,
    createdAt: '2026-08-05T00:00:00+00:00',
    items: [],
    itemsTruncated: false,
    ...over,
  } as never;
}

async function renderPage(search: Record<string, string | string[]> = {}) {
  const ui = await OrderDetailPage({
    params: Promise.resolve({ id: ORDER }),
    searchParams: Promise.resolve(search),
  });
  return render(ui);
}

/** 🔴 **正向對照**:證明頁面真的畫出來了 —— 沒有它,下面每一條「期望 0」都可能是恆真。 */
function expectPageRendered(container: HTMLElement) {
  expect(container.textContent).toContain('ABC123');
}

function cancelFormCount(container: HTMLElement): number {
  return container.querySelectorAll('[name="cancel_mode"]').length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
  mocks.listSuppliers.mockResolvedValue([]);
  mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
  mocks.getLedgerUnregisteredAmount.mockResolvedValue(null);
  mocks.getSessionActor.mockResolvedValue({ id: 'staff-alice', label: 'Alice' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('D6-a 驗收④ 表單由結果頁閘住(整條 URL → 頁層 → 表單)', () => {
  it('canonical 網址(沒有結果碼)⇒ 取消表單出現', async () => {
    const { container } = await renderPage();
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBeGreaterThan(0);
  });

  it('🔴 B 類失敗結果頁 ⇒ 一支取消表單都不給', async () => {
    // 🔴 這是義務 B 的執行點:員工在「送出去了但結果不明」的頁面上**不得就地重送**
    //    —— 重送 = 第二筆刪不掉的取消。他要先重新整理(網址回 canonical)才拿得回表單。
    const { container } = await renderPage({ r: toOrderCancelResultCode('retry'), rt: TOKEN });
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });

  it('🔴 成功結果頁 ⇒ 也不給表單', async () => {
    const { container } = await renderPage({ r: ORDER_CANCELLED_RESULT_CODE, rt: TOKEN });
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });

  it('A 類(RPC 從未被呼叫)⇒ 表單照常給,員工改一改就能再送', async () => {
    // 🔴 這格擋的是**過度封鎖**:什麼都沒送出去卻把表單收起來,員工只能重整、白繞一圈。
    const { container } = await renderPage({ r: toOrderCancelResultCode('invalid') });
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBeGreaterThan(0);
  });

  it('🔴 判定說不能取消(已付款)⇒ 即使 canonical 網址也不給表單', async () => {
    // 🔴 **這格是 R2 codex 抓的缺口**:`showForms` 的第一道是 `view.canCancel`,
    //    而先前每一格都用「可取消的健康單」⇒ **那道閘從沒被負測走過**,拿掉它全綠(W7)。
    //    兩道閘是 AND:`buildOrderCancelView` 仍是唯一判定真相。
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ paymentStatus: 'paid' }));
    const { container } = await renderPage();
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBe(0);
    // 正向對照:複核區塊仍在(不受 canCancel 影響)⇒ 證明不是整段沒渲染。
    expect(container.textContent).toContain('取消訂單');
  });

  it('🔴 已取消的單 ⇒ 不給表單(由 canCancel 的 already_cancelled 拒因擋)', async () => {
    // ⚠️ 這格量的是**行為**,不是某一道特定的閘:區塊裡曾經有一行
    //    `detail.cancelledAt === null` 想當縱深,但它被 `canCancel` 嚴格蘊含
    //    ⇒ 拿掉零轉紅 ⇒ 已依實測移除(理由寫在 `order-cancel-block.tsx`)。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ cancelledAt: '2026-08-05T00:00:00+00:00' }),
    );
    const { container } = await renderPage();
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBe(0);
    expect(container.textContent).toContain('取消訂單');
  });

  it('🔴 重複 query key(`?r=a&r=b`)⇒ 不給表單(看不懂就不放行)', async () => {
    const { container } = await renderPage({ r: [toOrderCancelResultCode('retry'), 'x'] });
    expectPageRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });
});

describe('D6-a 驗收④-b 預設 fail-closed:prop 沒傳就不給', () => {
  // 🔴 **這一格是突變抓出來補的**:W2(把預設值改成 `true`)原本**全綠存活** ——
  //    因為頁層每一條測試都會經由 route 明確傳值,那個預設值**沒有任何測試走得到**。
  //    而它守的正是最容易發生的錯:**有人新增一個 `OrderDetail` 的呼叫端、忘了接那道閘**。
  //    ⇒ 直接渲染元件、不傳 prop,才量得到預設值本身。
  it('🔴 直接渲染 OrderDetail 且不傳 cancelFormsAllowed ⇒ 零取消表單', () => {
    // `payments` 與本格無關,給「訂單在、零收款列」的中性值(#15-B2-c 片1a 起為必填 prop)。
    const { container } = render(
      <OrderDetail detail={detail()} returnTo='/orders/ord-1' payments={{ status: 'ok', rows: [] }} />,
    );
    // 正向對照:證明元件真的畫出來了(否則「零表單」是恆真)。
    expect(container.textContent).toContain('ABC123');
    expect(cancelFormCount(container)).toBe(0);
  });

  it('🔴 OrderCancelBlock 自己也 fail-closed:formsAllowed 為 undefined ⇒ 零表單', () => {
    // 🔴 **這格是突變抓出來補的**:W2b(把 `formsAllowed === true` 放寬成 `!== false`)
    //    原本**全綠存活** —— 因為 `OrderDetail` 自己的預設值是 `false`,
    //    區塊**永遠收不到 `undefined`** ⇒ 它自己那道嚴格比對從來沒被走到。
    //    兩層各自 fail-closed 是縱深,但**沒被測到的縱深等於不存在**;直接渲染區塊才量得到。
    const { container } = render(<OrderCancelBlock returnTo='/orders?panel=x' detail={detail()} />);
    // 正向對照:複核區塊有畫出來(否則「零表單」是恆真)。
    expect(container.textContent).toContain('取消訂單');
    expect(cancelFormCount(container)).toBe(0);
  });

  it('OrderCancelBlock 明確傳 true ⇒ 表單出現(對照組)', () => {
    const { container } = render(<OrderCancelBlock returnTo='/orders?panel=x' detail={detail()} formsAllowed />);
    expect(cancelFormCount(container)).toBeGreaterThan(0);
  });

  it('🔴 `cancellationsTruncated` 缺鍵 ⇒ 面板說「無法斷定」,不得說「目前查不到」', () => {
    // 🔴 **這格是突變抓出來補的**:W6(把 `?? true` 折回 `?? false`)原本**全綠存活**。
    //    折成 false ⇒ classifier 落 `miss_complete` ⇒ 面板說「仍然沒有,才重新送一次」
    //    = 全片唯一會讓員工按第二次的那句。折成 true 只多說一句「無法斷定」,方向安全。
    const base = detail();
    const withoutFlag = { ...base } as Record<string, unknown>;
    delete withoutFlag.cancellationsTruncated;
    mocks.findAdminOrderDetail.mockResolvedValue(withoutFlag as unknown as AdminOrderDetail);
    return renderPage({ r: toOrderCancelResultCode('retry'), rt: TOKEN }).then(({ container }) => {
      expectPageRendered(container);
      expect(container.textContent).toContain('無法斷定');
      expect(container.textContent).not.toContain('目前查不到這筆取消');
    });
  });

  it('同一份資料明確傳 true ⇒ 表單出現(證明上一格不是因為資料不可取消)', () => {
    const { container } = render(
      <OrderDetail
        detail={detail()}
        returnTo='/orders/ord-1'
        cancelFormsAllowed
        payments={{ status: 'ok', rows: [] }}
      />,
    );
    expect(container.textContent).toContain('ABC123');
    expect(cancelFormCount(container)).toBeGreaterThan(0);
  });
});

describe('D6-a 驗收① 關單之後面板仍在(掛在資格閘之外)', () => {
  it('🔴 已取消的單:面板照樣說得出「寫進去了沒有」', async () => {
    // 🔴 面板若掛在資格閘內,**最需要看到結果的那一刻反而什麼都不顯示** ——
    //    RPC 關單成功之後 `canCancel` 立刻變 false。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({
        cancelledAt: '2026-08-05T00:00:00+00:00',
        cancellations: [cancellation()],
      }),
    );
    const { container } = await renderPage({ r: ORDER_CANCELLED_RESULT_CODE, rt: TOKEN });
    expectPageRendered(container);
    expect(container.textContent).toContain('取消已完成');
    // 同一次渲染:面板在、表單不在。
    expect(cancelFormCount(container)).toBe(0);
  });

  it('🔴 帳本讀不到時,面板仍要出現並說「不代表沒有送出」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ cancellations: null }));
    const { container } = await renderPage({ r: toOrderCancelResultCode('bug'), rt: TOKEN });
    expectPageRendered(container);
    expect(container.textContent).toContain('查不到取消紀錄');
    expect(container.textContent).toContain('不代表沒有送出');
  });

  it('🔴 actor 認不出來(尚未選人)⇒ 不得說「已完成」', async () => {
    mocks.getSessionActor.mockResolvedValue(null);
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({
        cancelledAt: '2026-08-05T00:00:00+00:00',
        cancellations: [cancellation()],
      }),
    );
    const { container } = await renderPage({ r: ORDER_CANCELLED_RESULT_CODE, rt: TOKEN });
    expectPageRendered(container);
    expect(container.textContent).not.toContain('取消已完成');
    expect(container.textContent).toContain('認不出你是誰');
  });

  it('沒有結果碼時面板整個不出現(平常看單不受干擾)', async () => {
    const { container } = await renderPage();
    expectPageRendered(container);
    expect(container.textContent).not.toContain('查不到取消紀錄');
    expect(container.textContent).not.toContain('取消已完成');
  });
});
