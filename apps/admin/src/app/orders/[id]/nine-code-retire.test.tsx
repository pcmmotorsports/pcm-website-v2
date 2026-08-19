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
vi.mock('../../../lib/session/actor', () => ({ getSessionActor: async () => null }));
vi.mock('../../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn() }));
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

// 🔴 fixture 的數字刻意互不相等且都非 0(4 / 3 / 1 / 2):
//    任兩個欄位接錯線、或某一格被補 0,下面的字面斷言都會紅。
const SUMMARY: AdminOrderItemQuantitySummary = {
  quantity: 4,
  orderedQuantity: 3,
  instockQuantity: 1,
  shippedQuantity: 1,
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
    // 🔴🔴 **本格用【自己的】fixture,而理由是共用那個 fixture 量不出這件事:**
    //    `SUMMARY` 的 `instockQuantity` 與 `shippedQuantity` **都是 1**
    //    ⇒ 「到」與「出」對調的話,畫面**一個字都不會變** ⇒ 這把尺對那個方向是瞎的。
    //    ⚠️ 而**片5 之前的版本更寬**:它只斷言了 `訂貨 3/4` 與 `到貨 1/4`,
    //       **從頭到尾沒有斷言過「出貨」那一軸** ⇒ shipped 這條線一直沒有守門。
    //    ⇒ 三個軸給三個互不相同的值,任一組對調都至少讓一行紅。
    const DISTINCT_SUMMARY: AdminOrderItemQuantitySummary = {
      ...SUMMARY,
      // 🔴 `quantity` 必須對齊那一列的 `item.quantity`(fixture 寫死 4,見 `detail()`)——
      //    不對齊的話畫面會渲染成「訂 5/9 · 到 3/9 · 出 1/9 · 數量 4」,
      //    而**拆欄之後三軸與「數量」是相鄰欄** ⇒ 分母不一致會直接被員工看到。
      //    (拆欄前三軸擠在最右邊,這個矛盾看不太出來 —— 版面改動讓一個舊的 fixture 問題浮上來。)
      quantity: 4,
      orderedQuantity: 4,
      instockQuantity: 2,
      shippedQuantity: 1,
    };
    mocks.findAdminOrderDetail.mockResolvedValue(detail(DISTINCT_SUMMARY));
    const { container } = await renderPage();

    // 🔴🔴 **這一格的比法在 2026-08-19 片5 之後【必須改,而且不能改鬆】。**
    //
    // 原本比的是 `'訂貨 3/4'` 這種**標籤+數字連在一起**的字串,理由(原註解逐字)是
    // 「連標籤一起比,才擋得住『兩個軸的數字對調』這種改法(單看 `3/4` 在不在場擋不住)」。
    // 而片5 把「訂/到/出」三個字**從值搬到欄頭**(Sean 選的丙案)⇒ 值那一格只剩 `3/4`
    // ⇒ **那個比法的機制被結構改動整個拿掉了**,不是我把它放寬。
    //
    // ⇒ 換成**按欄位位置**比,而它比舊的更強:
    //    舊的只保證「這兩個字串在同一段文字裡」;新的直接問
    //    **「『訂』那一欄底下那一格,裝的是不是 orderedQuantity」** —— 那正是「接錯線」的定義。
    //    ⚠️ 兩軸對調時,欄頭順序不變而值互換 ⇒ 位置比對照樣紅。
    const table = [...container.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => th.textContent?.trim() === '訂'),
    );
    expect(table).toBeTruthy(); // 正向對照:真的找到品項表(找不到就不是「通過」)
    const headers = [...table!.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    const bodyCells = [...table!.querySelectorAll('tbody tr')][0]!.querySelectorAll('td');
    const cellUnder = (name: string) => bodyCells[headers.indexOf(name)]?.textContent?.trim();

    // A9g-1 投影:ordered=4 / instock=2 / shipped=1,總數 4
    expect(cellUnder('訂')).toBe('4/4');
    expect(cellUnder('到')).toBe('2/4');
    expect(cellUnder('出')).toBe('1/4');
    // 🔴🔴 **這一格的前提:三軸的值必須互不相同,否則上面三行對「對調」是瞎的。**
    //    ⚠️ 我第一版寫成 `new Set(['5/9','3/9','1/9']).size === 3` —— 那是**恆真**的:
    //       它只比三個【字面常數】,與 fixture、與受測元件都無關 ⇒ 任何世界都綠。
    //       失敗情境:有人把 shipped 改回等於 instock、順手把上面的期望值一起改,
    //       **這行照樣綠**,而「到↔出 對調零症狀」那個缺口就無聲地回來了。
    //    ⇒ 改成從 **fixture 本身**導出,它才真的在守那個前提。(R1 must-fix 1)
    expect(
      new Set([
        DISTINCT_SUMMARY.orderedQuantity,
        DISTINCT_SUMMARY.instockQuantity,
        DISTINCT_SUMMARY.shippedQuantity,
      ]).size,
    ).toBe(3);
    // 「已取消」是例外不是第四軸,片5 之後掛在「數量」那一格底下。
    // 🔴 連著比,不拆兩個 `toContain` —— 該格文字是 `4已取消 2`,
    //    單獨找 `'2'` 可能命中的是 `item.quantity` 而不是 cancelled(今天剛好有判別力=巧合)。
    expect(cellUnder('數量')).toContain(`已取消 ${DISTINCT_SUMMARY.cancelledQuantity}`);
    expect(container.textContent).not.toContain('數量資料尚未就緒');
  });

  it('🔴 摘要為 null = 「不知道」不是「都是 0」:顯示未就緒、不得出現補 0 的數字', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail(null));
    const { getByText, container } = await renderPage();

    expect(getByText('數量資料尚未就緒')).toBeTruthy();
    // 🔴 這一行是「有人寫 `?? 0`」的突變證。
    //    ⚠️ **2026-08-19 片5 更新 —— 原本的 `not.toContain('0/4')` 已經恆綠**:
    //       ①值那格已無「訂貨」二字(三個字搬去欄頭)
    //       ②`?? 0` 型的突變在 `summary` 為 null 時**分母也會被補 0** ⇒ 渲染成 `0/0`,
    //         **永遠不會是 `0/4`** ⇒ 那個字面再也構造不出來。
    //    ⇒ 改成 `0/0`,它才是這個突變真正會畫出來的字面。
    //    📎 更完整的覆蓋(逐格斷言印「—」)已由
    //       `components/orders/order-detail-items-table-shape.test.tsx` 接手。
    expect(container.textContent).not.toContain('0/0');
  });
});
