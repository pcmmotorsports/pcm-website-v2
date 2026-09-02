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

/**
 * 🔴 片 B:`payments` 必填無預設 ⇒ 每個渲染點都要給。
 * 這裡統一給 **`unreadable`(fail-closed 那一態)**,而它有一個代價要講明:
 * ⚠️ **任何在測「已付款」行為的案例都必須自己覆寫它** —— 否則你測到的是
 *    「看不出這張單怎麼收的」那條路,而不是你以為在測的那條(刷卡 / 現金)。
 */
const PAY_UNREADABLE = { status: 'unreadable' } as const;
const PAY_CARD = { status: 'ok', rows: [{ rail: 'card' }] } as const;
const PAY_CASH = { status: 'ok', rows: [{ rail: 'cash' }] } as const;

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

/**
 * 🔴 **取消區【本身】有沒有渲染** —— 2026-08-29 量到 `expectPageRendered` 對本檔那一族不夠:
 * 把整個 `OrderCancelBlock` 改成 `return null` ⇒ 全檔 29 格中 11 紅,
 * **而那 9 格「不給表單 / 不給 checkbox / 面板不出現」全部照樣綠**(訂單編號還在)。
 * 📌 **錨釘的是頁面, 而洩漏面是頁面裡的那一區。**
 *
 * 釘 `#cancel`:那是**跨檔契約**(`order-cancel-block.tsx:73-76` 逐字 —— 訂單列表操作欄的連結是
 * `…#cancel`), 而那支元件**沒有任何 early return** ⇒ 任何合法世界它都在 ⇒ 不會做出假紅。
 */
/**
 * 🔴 **商品卡【本身】有沒有渲染** —— 2026-08-29 補審(code-reviewer)抓到:
 * `expectCancelBlockRendered` 對「商品卡上的 checkbox」那幾格**零判別力** ——
 * checkbox 由 `order-detail-items-table.tsx` 渲染, 而 `#cancel` 在**另一條分支**
 * (`order-detail.tsx:351` → money-tab → danger-zone)。
 * 實測:把 `ItemsTable` 改成 `return null` ⇒ 全檔 29 格中只有 **2 紅**,
 * **而三格「商品卡上不給 checkbox」全部照樣綠** —— 而它們正是我上一顆宣稱修好的那幾格。
 * 📌 **⇒ 我修了門, 而 checkbox 住在隔壁那棟。**
 *
 * 🔴🔴 **2026-08-29 補審 C1:原本只釘 `.ihead`(表頭)—— 那是【第五次】把錨釘在外殼上。**
 *   `order-detail-items-table.tsx:188` 的 `.ihead` 在 `detail.items.map`(:204)**外面**,
 *   兩者之間沒有任何因果 ⇒ 實測 `detail.items.slice(1).map(` ⇒
 *   **`.ihead` 照畫、一列品項都沒有、三格負向斷言全綠。**
 *   ⇒ 改成【表頭 + 至少一張品項卡】兩件都要:`.icard` 是 map 裡面每一列的殼
 *   (`item-amount-row.tsx:329`)⇒ 它與 `detail.items` 有真的因果。
 * 📌 **判別句:錨要釘在【被斷言那件事的產生者】上,不是釘在它旁邊那個一定會在的東西上。**
 *
 * ⚠️ **R2 nit:零品項的單【不要】用這支** —— `cancel-view.ts:747` 有合法的 `no_items` 世界
 *   (表頭會畫、零張 `.icard`)⇒ 那種單拿來跑這支會紅,**而那不是 bug、是它沒有分母**。
 *   🔴 寫在這裡是因為:下一個人撞到那個紅,最省事的處置是**把錨刪掉**,而檔內 :530 已經
 *   警告過同一種行為模式。**要嘛換 fixture,要嘛那格自己不呼叫這支 —— 不要刪錨。**
 */
function expectItemsTableRendered(container: HTMLElement) {
  expect(
    container.querySelector('.ihead'),
    '商品卡表頭沒渲染 ⇒ 「商品卡上不給 checkbox」那些負向斷言恆真',
  ).not.toBeNull();
  // 🔴 表頭在【而一列品項都沒有】也會讓那些負向斷言恆真 —— 這一格才是它們真正的分母。
  expect(
    container.querySelectorAll('.icard').length,
    '商品卡零品項列 ⇒ 「商品卡上不給 checkbox」那些負向斷言恆真(表頭在不算數)',
  ).toBeGreaterThan(0);
}

function expectCancelBlockRendered(container: HTMLElement) {
  expect(
    container.querySelector('#cancel'),
    // 🔴 R2 抓到:原字面含「/ 不給 checkbox」—— 而同檔 :229-231 自己量到本錨對 checkbox 那幾格**零判別力**。
    //    ⇒ 那句話會讓下一個人以為 `#cancel` 蓋得住 checkbox,**而刪掉 `expectItemsTableRendered` 的正是會讀那句話的人**。
    '取消區整塊沒渲染 ⇒ 「不給表單」那些負向斷言恆真(🔴 **本錨不涵蓋 checkbox** ⇒ 那幾格看 `expectItemsTableRendered`)',
  ).not.toBeNull();
}

function cancelFormCount(container: HTMLElement): number {
  return container.querySelectorAll('[name="cancel_mode"]').length;
}

/** 片C(取消介面搬家):商品卡上的取消 checkbox 數。 */
function cancelItemCheckboxCount(container: HTMLElement): number {
  return container.querySelectorAll('[name="cancel_item"]').length;
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
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBeGreaterThan(0);
  });

  it('🔴 B 類失敗結果頁 ⇒ 一支取消表單都不給', async () => {
    // 🔴 這是義務 B 的執行點:員工在「送出去了但結果不明」的頁面上**不得就地重送**
    //    —— 重送 = 第二筆刪不掉的取消。他要先重新整理(網址回 canonical)才拿得回表單。
    const { container } = await renderPage({ r: toOrderCancelResultCode('retry'), rt: TOKEN });
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });

  it('🔴 成功結果頁 ⇒ 也不給表單', async () => {
    const { container } = await renderPage({ r: ORDER_CANCELLED_RESULT_CODE, rt: TOKEN });
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });

  it('A 類(RPC 從未被呼叫)⇒ 表單照常給,員工改一改就能再送', async () => {
    // 🔴 這格擋的是**過度封鎖**:什麼都沒送出去卻把表單收起來,員工只能重整、白繞一圈。
    const { container } = await renderPage({ r: toOrderCancelResultCode('invalid') });
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBeGreaterThan(0);
  });

  it('🔴 判定說不能取消(已付款)⇒ 即使 canonical 網址也不給表單', async () => {
    // 🔴 **這格是 R2 codex 抓的缺口**:`showForms` 的第一道是 `view.canCancel`,
    //    而先前每一格都用「可取消的健康單」⇒ **那道閘從沒被負測走過**,拿掉它全綠(W7)。
    //    兩道閘是 AND:`buildOrderCancelView` 仍是唯一判定真相。
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ paymentStatus: 'paid' }));
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
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
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
    expect(container.textContent).toContain('取消訂單');
  });

  it('🔴 重複 query key(`?r=a&r=b`)⇒ 不給表單(看不懂就不放行)', async () => {
    const { container } = await renderPage({ r: [toOrderCancelResultCode('retry'), 'x'] });
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });
});

// 🔴 2026-08-20:Sean 親自開後台看畫面裁定,退款/取消兩塊改成【上下堆疊、各自摺疊】
// (原字:「不要左右,改成上下然後欄位可以點開.跟上面其他功能意思一樣」)。
// plan 見 `~/pcm-mailbox/W2-014-退款取消版面上下堆疊-plan-20260820.md`。
// 本組釘住的是**外層排列方式**,不是 `DangerZoneDetails` 的既有行為(那些已有自己的守門)。
describe('片14(2026-08-20):退款/取消版面改上下堆疊,不再左右並排', () => {
  it('退款、取消各自是一個可摺疊的 <details>,不是共用同一個 flex-row 容器', async () => {
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    // 🔴 舊版面的識別字面(flex-row 容器)不得再出現——這是本格的負向斷言。
    expect(container.querySelector('.justify-between.gap-3')).toBeNull();
    // 兩塊各自是獨立的 <details>,且都套上新的卡片樣式(group + bg-card + rounded-lg border)。
    const cards = Array.from(container.querySelectorAll('details.group.bg-card'));
    expect(cards.length).toBeGreaterThanOrEqual(2);
    // 正向對照:每個都是真的 <details>(可摺疊),不是隨便一個 div 恰好帶了這些 class。
    for (const card of cards) {
      expect(card.tagName).toBe('DETAILS');
      expect(card.querySelector('summary')).not.toBeNull();
    }
  });

  it('DOM 順序:退款卡在前、取消卡在後(視覺/Tab/朗讀三序一致,2026-08-19 codex K2 定案未變)', async () => {
    const { container } = await renderPage();
    const cards = Array.from(container.querySelectorAll('details.group.bg-card'));
    const refundIdx = cards.findIndex((el) => el.textContent?.includes('退款'));
    const cancelIdx = cards.findIndex((el) => el.textContent?.includes('申請取消整張單'));
    expect(refundIdx).toBeGreaterThanOrEqual(0);
    expect(cancelIdx).toBeGreaterThan(refundIdx);
  });

  it('文字未變:退款/申請取消整張單原字仍在(這片只動排版,不動文案)', async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain('退款');
    expect(container.textContent).toContain('申請取消整張單');
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
      <OrderDetail refundsTruncated={false} stuckVerdicts={new Map()} detail={detail()} returnTo='/orders/ord-1' payments={{ status: 'ok', rows: [] }} />,
    );
    // 正向對照:證明元件真的畫出來了(否則「零表單」是恆真)。
    expect(container.textContent).toContain('ABC123');
    // 🔴 補審(2026-08-29)抓到:這幾格【不走 renderPage()】⇒ 沒有拿到那 21 個呼叫點的錨,
    //    而 `toContain('ABC123')` 是**頁面層** ⇒ 對區塊層的洩漏零判別力。
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
  });

  it('🔴 OrderCancelBlock 自己也 fail-closed:formsAllowed 為 undefined ⇒ 零表單', () => {
    // 🔴 **這格是突變抓出來補的**:W2b(把 `formsAllowed === true` 放寬成 `!== false`)
    //    原本**全綠存活** —— 因為 `OrderDetail` 自己的預設值是 `false`,
    //    區塊**永遠收不到 `undefined`** ⇒ 它自己那道嚴格比對從來沒被走到。
    //    兩層各自 fail-closed 是縱深,但**沒被測到的縱深等於不存在**;直接渲染區塊才量得到。
    const { container } = render(<OrderCancelBlock payments={PAY_UNREADABLE} returnTo='/orders?panel=x' detail={detail()} />);
    // 正向對照:複核區塊有畫出來(否則「零表單」是恆真)。
    expect(container.textContent).toContain('取消訂單');
    expect(cancelFormCount(container)).toBe(0);
  });

  it('OrderCancelBlock 明確傳 true ⇒ 表單出現(對照組)', () => {
    const { container } = render(<OrderCancelBlock payments={PAY_UNREADABLE} returnTo='/orders?panel=x' detail={detail()} formsAllowed />);
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
    expectCancelBlockRendered(container);
      expect(container.textContent).toContain('無法斷定');
      expect(container.textContent).not.toContain('目前查不到這筆取消');
    });
  });

  it('同一份資料明確傳 true ⇒ 表單出現(證明上一格不是因為資料不可取消)', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false} stuckVerdicts={new Map()}
        detail={detail()}
        returnTo='/orders/ord-1'
        cancelFormsAllowed
        payments={{ status: 'ok', rows: [] }}
      />,
    );
    expect(container.textContent).toContain('ABC123');
    // 🔴 補審(2026-08-29)抓到:這幾格【不走 renderPage()】⇒ 沒有拿到那 21 個呼叫點的錨,
    //    而 `toContain('ABC123')` 是**頁面層** ⇒ 對區塊層的洩漏零判別力。
    expectCancelBlockRendered(container);
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
    expectCancelBlockRendered(container);
    expect(container.textContent).toContain('取消已完成');
    // 同一次渲染:面板在、表單不在。
    expect(cancelFormCount(container)).toBe(0);
  });

  it('🔴 帳本讀不到時,面板仍要出現並說「不代表沒有送出」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ cancellations: null }));
    const { container } = await renderPage({ r: toOrderCancelResultCode('bug'), rt: TOKEN });
    expectPageRendered(container);
    expectCancelBlockRendered(container);
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
    expectCancelBlockRendered(container);
    expect(container.textContent).not.toContain('取消已完成');
    expect(container.textContent).toContain('認不出你是誰');
  });

  it('沒有結果碼時面板整個不出現(平常看單不受干擾)', async () => {
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(container.textContent).not.toContain('查不到取消紀錄');
    expect(container.textContent).not.toContain('取消已完成');
  });
});

// 🔴🔴 片C(取消介面搬家):商品卡上的取消 checkbox 現在跟危險區的表單吃**同一顆**
//    `cancelFormsAllowed`(`order-detail.tsx` 往下傳給 `ItemsTable` 與 `OrderCancelBlock` 兩邊)。
//    本組驗的正是「兩邊真的接的是同一顆值,不是各自算出剛好一樣的兩份」——
//    只測 `cancel_mode`(表單本身)測不到這件事,商品卡上的 checkbox 要單獨量。
describe('片C 驗收:商品卡的取消 checkbox 與危險區的表單共用同一道 cancelFormsAllowed 閘', () => {
  // 🔴🔴 **這一組的守門是【兩棒接力】,而兩棒各自只擋得住一半 —— 2026-08-29 兩發突變量到。**
  //
  //   🔴 **補審 C2 訂正:原本這裡寫「擋【商品卡整塊沒渲染】」—— 那句話比量到的寬。**
  //     實際是【三個世界,不是兩個】,而第一棒只擋得住其中一個:
  //
  //   世界甲  ItemsTable 進入點 return null(表頭與品項卡都不見)
  //     ⇒ 第一棒 `.ihead` 那格紅 ✅
  //   世界乙  detail.items.slice(1).map(...)(表頭照畫、零品項卡)
  //     ⇒ 🔴 舊版第一棒【全綠】—— `.ihead` 在 map 外面,與品項一列因果都沒有
  //     ⇒ 已於同一顆 commit 補上 `.icard > 0`,現在這一格紅
  //
  //   世界丙  PartialCancelItemControl return null(表頭在、品項卡也在、只有 checkbox 不見)
  //     ⇒ 🔴 **兩棒【都綠】** —— 三格負向斷言全部照樣綠
  //     ⇒ 唯一紅的是下面第一格那個正向對照(`checkbox > 0`)= **第二棒**
  //
  // 📌 **⇒ 三個世界都是「checkbox 不見了」,而錨只擋得住前兩個。**
  // 🔴 **⇒ 世界丙正是「取消勾選功能默默失效」最像的那一種** ——
  //    甲乙員工一眼看得出來(整塊或整列不見);丙他只會以為這張單本來就不能勾。
  // 🔴 **⇒ 所以【第一格不是可有可無的 happy path】,它是下面三格唯一的分母。**
  //    刪掉它 ⇒ 下面三格對「checkbox 消失」這件事變成**完全恆真**,而且零訊號。
  //    ⚠️ 而它讀起來最像可以刪的那一格(名字最平淡、沒有 🔴)—— 這句話就是寫給那個人看的。
  it('canonical 網址 ⇒ 商品卡上也出現取消 checkbox(不只是危險區的表單)', async () => {
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBeGreaterThan(0);
    expect(cancelItemCheckboxCount(container)).toBeGreaterThan(0);
  });

  it('🔴 B 類失敗結果頁(表單被閘住)⇒ 商品卡上的 checkbox 也一起消失', async () => {
    const { container } = await renderPage({ r: toOrderCancelResultCode('retry'), rt: TOKEN });
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
    expectItemsTableRendered(container);
    expect(cancelItemCheckboxCount(container)).toBe(0);
  });

  it('🔴 判定說不能取消(已付款)⇒ 商品卡上也不給 checkbox', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ paymentStatus: 'paid' }));
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expectItemsTableRendered(container);
    expect(cancelItemCheckboxCount(container)).toBe(0);
  });

  it('🔴 直接渲染 OrderDetail 不傳 cancelFormsAllowed ⇒ 商品卡零 checkbox(fail-closed)', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false} stuckVerdicts={new Map()} detail={detail()} returnTo='/orders/ord-1' payments={{ status: 'ok', rows: [] }} />,
    );
    expect(container.textContent).toContain('ABC123');
    // 🔴 補審(2026-08-29)抓到:這幾格【不走 renderPage()】⇒ 沒有拿到那 21 個呼叫點的錨,
    //    而 `toContain('ABC123')` 是**頁面層** ⇒ 對區塊層的洩漏零判別力。
    expectCancelBlockRendered(container);
    expectItemsTableRendered(container);
    expect(cancelItemCheckboxCount(container)).toBe(0);
  });

  it('🔴🔴 品項 id 剛好叫 `constructor` 時,checkbox 仍然正確渲染(Map 查表不中原型鏈)', () => {
    // memory `reference_js-index-lookup-hits-prototype-chain`:`obj['constructor']` 是 truthy,
    // 物件索引版**不會**判定「查無」而是把原型鏈上的東西當資料。`order-detail-items-table.tsx`
    // 的 `cancelItemById` 用 `Map`(規格上沒有原型鏈這回事),這條把它釘成事實,不只是相信規格。
    const withOddId = detail({
      items: [
        {
          id: 'constructor',
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
      ] as never,
    });
    const { container } = render(
      <OrderDetail refundsTruncated={false} stuckVerdicts={new Map()}
        detail={withOddId}
        returnTo='/orders/ord-1'
        cancelFormsAllowed
        payments={{ status: 'ok', rows: [] }}
      />,
    );
    const box = container.querySelector<HTMLInputElement>('input[name="cancel_item"]');
    expect(box).not.toBeNull();
    // 值 = `<id>:<maxCancellable>`——用 `Map.get('constructor')` 真的取到那個品項(不是 undefined
    // 落到某個原型鏈殘留),否則這裡要嘛整支 checkbox 不見,要嘛值裡的 id 段不會是 constructor。
    expect(box!.getAttribute('value')).toMatch(/^constructor:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 🔴🔴 `#808` / `#387` gate 拆四態 —— **頁層渲染**驗收(plan §4 的 ☐3 / ☐4 / ☐5)
//
// 為什麼一定要在頁層量、而不是元件層:
//   `cancel-view.test.ts` 守 `buildOrderCancelView` 的回傳、`cancel-review-copy.test.ts`
//   守文案表的字面 —— **兩支都綠,而那句話仍然可以完全沒有被 render 出來**
//   (只要 page.tsx → OrderDetail → CancelReviewSection 中間任何一跳掉了 detail,
//    兩支照樣全綠)。這裡量的是「員工打開那張單,螢幕上真的印得出那句話」。
//
// 🔴 兩個會讓人重跑時踩到的假象(`#810` 已量過,抄過來免得下一個人再撞一次):
//   ①`items: []` 會被 `cancel-view.ts` 推 `no_items` 拒因 ⇒ 表單消失**不是**本閘造成的
//     ⇒ 本區一律用預設 fixture(有一個品項)。
//   ②本檔的 repository 是 mock ⇒ 能證「這種資料下畫面畫出什麼」,**不能證正式站**。
//     「那兩張單在正式庫真的是 unpaid + pending + needs_manual_review」是 `#808` 向正式庫量過的。
// ═══════════════════════════════════════════════════════════════════════════════
describe("#808 gate='stuck' 的單,員工在畫面上讀得到「系統已經停止自動重試」", () => {
  /** Sean 看到並選甲的那一句的可觀察形式:重整不會有變化。 */
  const STUCK_LINE = '停止自動重試';
  /** `charge_attempt_blocked`(= `'in_flight'`)那格的 title 逐字,Sean 2026-08-21 定稿。 */
  const IN_FLIGHT_LINE = '這張單有一筆刷卡還沒有結束';

  it("☐3 gate='stuck' ⇒ 整頁文字含那句新文案(被 render 出來,不是被 import)", async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ chargeAttemptGate: 'stuck' }));
    const { container } = await renderPage();
    // 🔴 正向對照先跑:沒有它,下面那條 `toContain` 若因整頁沒渲染而空,會長得像另一種紅。
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(container.textContent).toContain(STUCK_LINE);
    // 而它要說出員工今天唯一做得到的那件事。
    expect(container.textContent).toContain('TapPay');
  });

  it("☐5 負對照:gate='in_flight' ⇒ 整頁【不得】出現那句新文案", async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ chargeAttemptGate: 'in_flight' }));
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(container.textContent).not.toContain(STUCK_LINE);
    // 🔴 而【該在的那句仍要在】—— 少了這一格,「把兩碼一起刪掉」的突變會讓上一行全綠。
    expect(container.textContent).toContain(IN_FLIGHT_LINE);
  });

  it("🔴 兩個世界印不同的東西 —— 尺是活的(clear 那一態兩句都不該出現)", async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ chargeAttemptGate: 'clear' }));
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(container.textContent).not.toContain(STUCK_LINE);
    expect(container.textContent).not.toContain(IN_FLIGHT_LINE);
  });

  it('🔴 第二問「看到之後他能做什麼」= 今天什麼都不能做,而那不可以是靜悄悄的', async () => {
    // `#808` 面一未修:後台對這些單一顆可動的按鈕都沒有。
    // 本片交付的是「他知道自己在等什麼」,不是「他可以處理它了」——
    // ⇒ 取消表單與逐品項 checkbox 都必須是 0,而畫面上有一句話在解釋為什麼。
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ chargeAttemptGate: 'stuck' }));
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(cancelFormCount(container)).toBe(0);
    expectItemsTableRendered(container);
    expect(cancelItemCheckboxCount(container)).toBe(0);
    expect(container.textContent).toContain(STUCK_LINE);
  });

  it("🔴 已付款的單不報 stuck —— 那筆非 failed 的嘗試是付款成功的那一筆", async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ paymentStatus: 'paid', chargeAttemptGate: 'stuck' }),
    );
    const { container } = await renderPage();
    expectPageRendered(container);
    expectCancelBlockRendered(container);
    expect(container.textContent).not.toContain(STUCK_LINE);
  });
});
