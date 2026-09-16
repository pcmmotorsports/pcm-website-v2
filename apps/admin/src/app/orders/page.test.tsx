// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 本頁的核心交付 = **Sean Q1=A 的「明示、不默默降級」**。
// ⚠️ #347-B(codex R2 nit):承載體**已換人** —— 原本是 A10c2 供應商單號的三種 invalid 訊息
//    與 `TooManyError` 分流,那些連同兩個專用搜尋欄一起退場(下方 81-87 行明載)。
//    現在承載它的是「刷卡未付款被藏起來」提示 + 供應商三態的恆 null 渲染。
// 🔴 這一整層原本零測試(階段 C must-fix 4):把 `instanceof` 換成別的判斷、
//    或 adapter 改成不再擲 `TooManyError`,分流會**靜默退化成通用錯誤態**而三綠全綠。
//
// repository getter 會拉 server-only 模組 ⇒ 整支 mock(同 refund-exceptions/page.test.tsx 紀律)。
// 🔴 本片同時把 `page.tsx` 的 `@/…` import 改成相對路徑:根 `vitest.config.ts:27` 的 `@` alias
//    指向 **storefront** 的 src,admin 檔案用 `@/` 在 vitest 裡 resolve 不到。姊妹頁
//    `refund-exceptions/page.tsx` 本來就用相對路徑 —— 這頁用 `@/` 只是因為它從來沒有測試。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
// 🆕 P-d:`?open=` 不在這一頁時的存在檢查走 `findAdminOrderDetail` ⇒ 一起 mock(預設查無)。
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  // 🆕 `?cancel=` 那組才給值;預設 throw ⇒ 其餘格子的 `open=` 展開照舊走 fail-closed 那條(它們沒餵 detail)。
  items: vi.fn(async (): Promise<{ items: never[]; reportedTotal: number }> => {
    throw new Error('listOrderItemsForDetail 沒 mock');
  }),
}));
const cookieState = vi.hoisted(() => ({ keyword: undefined as string | undefined }));
// 🆕 P-e-2:「跟供應商下訂」body 會 await `listSuppliers()` ⇒ 一起 mock(空清單就夠,本檔只驗殼與 body 有沒有接上)。
vi.mock('../../lib/supplier', async (importOriginal) => ({
  // 🔴 保留真模組、只換會打 DB 的那支(同本檔對 next/navigation 的做法): 是純函式,換掉它沒有意義。
  ...(await importOriginal<typeof import('../../lib/supplier')>()),
  listSuppliers: vi.fn(async () => []),
}));
// 🆕 收款欄可點:pay body 會 await `listOrderPayments`(打 RPC)⇒ mock 成「讀得到、零筆」。
vi.mock('../../lib/orders/payment-repository', () => ({ listOrderPayments: vi.fn(async () => []) }));
// 🆕 到貨彈窗的摺疊「已登的到貨(撤銷在這裡)」撈這兩支(讀):一筆到貨 + 沒有箱 ⇒ 撤銷鈕會出現。保留真模組其餘 export。
vi.mock('../../lib/orders/receipt-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/orders/receipt-repository')>()),
  listOrderItemReceipts: vi.fn(async () => [
    { id: 'rc-1', orderItemId: 'it-1', quantity: 1, surplusQuantity: 0, receivedAt: '2026-09-13T02:00:00.000Z', receivedBy: 'staff-1', note: null },
  ]),
}));
vi.mock('../../lib/shipping/order-shipments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/shipping/order-shipments')>()),
  loadOrderShipments: vi.fn(async () => []),
}));
// 🆕 pay body 同時打 `pcm_order_refundable_remaining`(算已退)⇒ mock 成「查到、未登記額 = 整張」(= 零退款)。
// 🔴 保留真模組、只換這一支:`open=` 展開的 `OrderDetailRoute` 也 import 這個模組的其他函式,整包替換會讓它們變 undefined。
vi.mock('../../lib/payment/refund-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/payment/refund-read')>()),
  getLedgerUnregisteredAmount: vi.fn(async () => 1000),
}));
vi.mock('../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    listOrderSummariesForAdmin: mocks.list,
    findAdminOrderDetail: mocks.detail,
    // 🆕 `?cancel=` 那組:殼裡跑的是真的 `OrderDetailRoute`, 它會撈品項清單到盡;缺這支 ⇒ 整段 fail-closed 印「載入失敗」。
    listOrderItemsForDetail: mocks.items,
  }),
}));
// 🔴 **保留真模組、只換 `useRouter`**(2026-08-12 換版分流片):本頁 `:21` 載入 `shipping-selection`,
//    它再載入 `shipment-launcher.tsx`,而後者的 catch 現在會呼叫 `unstable_isUnrecognizedActionError`。
//    整包替換的話那支是 `undefined` ⇒ 日後在本檔補一格「讀候選失敗」就吃 TypeError。
vi.mock('next/navigation', async () => ({
  ...(await vi.importActual<typeof import('next/navigation')>('next/navigation')),
  useRouter: () => ({ replace: vi.fn() }),
}));
// #347-2b:本頁自此會讀 `cookies()` —— 關鍵字搜尋詞的載體(它是 PII、刻意不進 URL)。
// 🔴 沒有這個替身,vitest 會擲「`cookies` was called outside a request scope」⇒ 本檔**每一格**都紅,
//    而紅的原因與各格自己要驗的東西完全無關。回空 store = 「沒有在搜尋」,正是本檔既有各格的前提。
// 🔴 #347-B:這個替身從「恆空」改成**可控**,因為新的「刷卡未付款被藏起來」提示
//    的觸發條件之一就是「有沒有在搜尋關鍵字」,而關鍵字只住在這顆 cookie 裡。
//    仍然逐鍵比對(`get(name)`)—— 不分鍵回值的替身會讓「讀錯 cookie」這個突變照樣綠。
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'admin_order_keyword' && cookieState.keyword !== undefined
        ? { value: cookieState.keyword }
        : undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

import OrdersPage from './page';

// 🔴 `server-only` 在**本檔**換成空替身 —— **不是放寬護欄,而且刻意不做成全域 alias。**
//    真的 `server-only` 被 client 模組載入時會丟錯,那正是我們要的
//    (`shipment-candidates.ts` 帶著它,誰把訂單明細拉進 client bundle 就建置失敗)。
//    但 vitest 沒有 server/client 之分、會天真地走完整個 import 圖:
//      client 元件 → `shipment-actions.ts`('use server')→ `shipment-candidates.ts`('server-only')→ 丟錯。
//    真實 Next 下這條路**不存在**('use server' 模組在 client 側是引用樁)。
//    ⚠️ **為什麼不做全域 alias**:`apps/storefront/src/lib/brand-products.test.ts:223` 有一條測試
//    **刻意依賴 server-only 真的丟錯**來證明 mock 清乾淨了(斷言字面就是那句錯誤訊息)。
//    全域替身會把那條的驗證機制整個拆掉 —— 實測會讓它從綠變紅。所以只在需要的檔各自 mock。
vi.mock('server-only', () => ({}));
// 🆕 A1(2026-09-14)老闆:成本 —— 三個替身,**預設全部倒向「非管理者」**(既有各格不受影響, 也就是它們的前提:沒有勾、沒有成本查詢)。
//    🔴 保留真模組、只換 `isActiveManager` / `getSessionActor`:`resolveStaff` 等被 `OrderDetailRoute` 那條路 import。
const bossState = vi.hoisted(() => ({
  manager: false,
  actor: null as { id: string; label: string } | null,
  /** 身分來源(`ActorSource`);預設 `'ticket'` = 簽章票。`'self-selected'` = 自選 cookie ⇒ 本片一律當非管理者。 */
  source: 'ticket' as 'ticket' | 'self-selected' | 'none' | 'stale-ticket',
  costs: vi.fn(
    async (_orders: readonly unknown[]): Promise<import('../../lib/orders/order-item-boss-cells').OrderItemCostCells> =>
      new Map(),
  ),
}));
// M-4b-01 P1(2026-09-14):明細 route 的 canManage 走 `getStaffRowById`(與備註收起同一顆)⇒ 這裡也照 bossState 答, 不打 DB。
vi.mock('../../lib/staff-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/staff-repository')>()),
  getStaffRowById: vi.fn(async (id: string | null | undefined) =>
    id ? { id, label: id, is_manager: bossState.manager, is_active: true, created_at: '', updated_at: '' } : null,
  ),
}));
vi.mock('../../lib/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/staff')>()),
  isActiveManager: vi.fn(async (id: string | null | undefined) => Boolean(id) && bossState.manager),
}));
vi.mock('../../lib/session/actor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/session/actor')>()),
  getSessionActor: vi.fn(async () => bossState.actor),
  getSessionActorIdWithSource: vi.fn(async () => ({ id: bossState.actor?.id ?? null, source: bossState.source })),
}));
vi.mock('../../lib/orders/order-item-boss-cells', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/orders/order-item-boss-cells')>()),
  loadOrderItemCostCells: (orders: readonly unknown[]) => bossState.costs(orders),
}));


// 🔴 全檔共用的收尾(2026-09-15 施工窗):上面四個 describe 各自有「cleanup + 等一個 macrotask」,
//    而其餘 describe(含檔案最後一個)沒有 ⇒ 最後一格 render 的 passive effect 由 React scheduler 以
//    setImmediate 排著, 而 jsdom 先拆 ⇒ `schedulerEvent = window.event` 讀到已拆的 window
//    ⇒ 「ReferenceError: window is not defined」Uncaught(全測偶發 rc=1、單跑不出現)。
//    ⇒ 提到檔案層:每一格都先卸載、再讓排著的那一發在 window 還在時跑完。不改任何斷言。
afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

const EMPTY = { items: [], total: 0 };
const ONE_ORDER = {
  items: [
    {
      id: 'o-1',
      displayId: 'YWP3PC',
      createdAt: '2026-08-07T00:00:00+00:00',
      customerName: '王小明',
      paymentStatus: 'paid' as const,
      fulfillmentStatus: 'pending' as const,
      total: { amount: 1000, currency: 'TWD' as const },
      // 🔵 稅欄(Sean 2026-09-05 第 6 題)—— 這一族 fixture 走 `as unknown as`,
      //    型別看不到缺欄, 而執行期會 `Cannot read properties of undefined`。
      taxTotal: { amount: 0, currency: 'TWD' as const },
      orderSource: 'storefront' as const,
      paymentChannel: 'tappay' as const,
      tierAtCheckout: null,
      invoiceStatus: null,
      cancelledAt: null,
      displayPosition: null,
      // 🔴 2026-08-27 補上:`AdminOrderSummary.shippingAddress` 是**必填**, 而本 fixture 少了它
      //    ⇒ `7489aada` 起 `buildOrderExportRows` 在這裡 `TypeError`, 本檔 **5 格**紅在 `dev` 上。
      //    ⇒ 這一欄不是為了讓測試變綠而加的裝飾, 是**這個 fixture 本來就違反型別**。
      shippingAddress: { name: null, phone: null, line: null },
      lines: [],
    },
  ],
  total: 1,
};

async function renderPage(params: Record<string, string | string[] | undefined>) {
  const ui = await OrdersPage({ searchParams: Promise.resolve(params) });
  const result = render(ui);
  // 🔴 **分母守門(2026-08-28 量到本檔有 4 格是恆綠的)**:本檔多數斷言的形狀是
  //    「`container.textContent` 裡**不得**出現某句話」/「某個節點是 `null`」——
  //    而整頁沒渲染時 `textContent` = `''`、任何 `querySelector` 都是 `null`
  //    ⇒ **「頁面正確地沒顯示那句提示」與「頁面整個沒出來」印同一個綠。**
  //    放在共用的 render helper 裡:一道蓋住全檔,新加的格自動有分母。
  //    釘**標題節點的數量**(結構),不釘任何一句文案 —— 文案改字不該讓這裡紅。
  expect(
    result.container.querySelectorAll('h1, h2').length,
    '整頁一個標題節點都沒有 ⇒ 訂單列表頁根本沒渲染 ⇒ 本格的負向斷言恆真',
  ).toBeGreaterThan(0);
  return result;
}

// ── #347-B(Sean 拍板 Q-347-B1=B / Q-347-B5=C):本檔原本整支在測 A10c2 供應商單號的
//    「明示態」(三種 invalid 訊息 + 命中過多 vs 程式壞了的分流 + #338 三態具名)。
//    那些能力連同兩個專用搜尋欄一起退場 ⇒ 整組刪除,改測**接替它們的東西**:
//      ① Q-347-B6=B 的「刷卡未付款被藏起來」提示(承接「不默默降級」的新載體)
//      ② Q-347-B5=C 的「三態在恆 null 之下不渲染」(契約留著、producer 待片 B-2)
//    🔴 「一般錯誤 → 通用錯誤態」那格是**與本片無關的活測試**,原本住在將死的
//       describe 裡 —— 刻意搬出來保留,不隨容器一起刪(整族連鍋端是踩過的坑)。

describe('OrdersPage — Q4 甲(2026-09-14):裸 /orders 預設「未完成」', () => {
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    // 🔴 全套併跑時 React scheduler 還排著工作, jsdom 先拆 ⇒ 「window is not defined」unhandled(單跑不出現, 全套穩定 2 發)。
    //    讓一個 macrotask 跑完再交還環境;不是 disable、不改任何斷言。
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });

  it('🔴 裸 /orders ⇒ 列表查的是 goods_axis 三值(未完成),而第一列那顆亮、摘要印「未完成」', async () => {
    const { container } = await renderPage({});
    // 第一發 = 列表本身(後面六發是 chip 計數;它們各自先清狀態鍵再套,不受本預設影響)
    expect(mocks.list.mock.calls[0]![0]).toMatchObject({ goodsAxes: ['none', 'ordered', 'instock'] });
    expect(container.querySelector('a[data-chip="open"]')?.getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('[data-testid="order-summary"]')?.textContent).toContain('未完成');
  });

  it('🔴 帶任何參數進來(首頁卡 / 側欄 / chip 全帶 date_from)⇒ 不套預設,「全部」就是全部', async () => {
    const { container } = await renderPage({ date_from: '2026-03-13', date_to: '2026-09-13' });
    expect(mocks.list.mock.calls[0]![0].goodsAxes).toBeUndefined();
    expect(container.querySelector('a[data-chip="open"]')?.getAttribute('aria-current')).toBeNull();
    expect(container.querySelector('a[data-chip="all"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('🔴 六顆 chip 的計數不被預設污染:每一發先清狀態鍵再套自己的(「已完成」那發是 shipped,不是三值)', async () => {
    await renderPage({});
    const shippedCall = mocks.list.mock.calls.find((c) => JSON.stringify(c[0].goodsAxes) === JSON.stringify(['shipped']));
    expect(shippedCall, '找不到「已完成」那一發 ⇒ 計數被預設蓋掉了').toBeTruthy();
  });
});

describe('OrdersPage — 讀不到', () => {
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    // 🔴 全套併跑時 React scheduler 還排著工作, jsdom 先拆 ⇒ 「window is not defined」unhandled(單跑不出現, 全套穩定 2 發)。
    //    讓一個 macrotask 跑完再交還環境;不是 disable、不改任何斷言。
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });

  it('一般錯誤 → 通用錯誤態(既有行為零改動)', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage({});
    expect(container.textContent).toContain('訂單列表載入失敗');
  });
});

// ── Q-347-B6=B:「可能有刷卡未付款的單被藏起來」提示 ───────────────────────
// 🔴 **它為什麼存在**:兩個專用搜尋欄退場後,D-385-A 的「豁免綁精準鍵」沒有實作了
//    (adapter 的豁免條件式塌成只看 `includeUnpaidCardOrders`)。Sean 拍板要求
//    「查無時提示」來承接 —— 這一族就是那個承接體的守門。
//
// 🔴 **三個條件,三格負向各只拿掉一個** —— 每格只讓一道閘失敗,否則證不出是哪一道在擋。
describe('OrdersPage — #347-B 刷卡未付款被藏起來的提示', () => {
  // 🔴🔴 **R1 Imp-2:這裡原本寫 `const HINT = '顯示刷卡未付款(預設隱藏)'` 然後
  //    `expect(頁面文字).toContain(HINT)` —— 那是**恆真格**。
  //    同一個字串有**兩個獨立來源**:提示本文(`page.tsx` 的 `UNPAID_CARD_HIDDEN_HINT`)
  //    與篩選列 checkbox 的 label(`order-filter-controls.tsx`,而篩選列**無條件渲染**)。
  //    ⇒ 把提示裡「勾選下方的『…』再查一次」整句換成「請自行想辦法。」,八格照樣全綠(已實測)。
  //    我原本那輪突變之所以會紅,靠的是「找不到單」那句、**不是這條斷言** ——
  //    也就是說我測了三道閘,卻從沒測過我宣稱在守文案一致性的那條。
  //    ⇒ 改成對**原始碼**斷言:label 的字面從元件檔讀出來,再要求提示文案含它。
  //      這條與畫面渲染完全無關,checkbox 渲不渲染都不影響它的判別力。
  const SRC = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  // 🔵 2026-09-13 晚:那顆勾從篩選卡(已拆)搬到工具列「只看」chip,label 住在 `order-toolbar-view.ts` 的 VIEW_CHIPS。
  const TOOLBAR_VIEW_SRC = SRC('../../lib/orders/order-toolbar-view.ts');
  // 🔴 提示文案也從**原始碼**取,不從 `page.tsx` import ——
  //    `UNPAID_CARD_HIDDEN_HINT` 是頁面模組的私有常數,為了測試把它 export 出去
  //    等於為了量它而改變被量的東西(而且 Next 頁面模組的 export 面有它自己的規矩)。
  const PAGE_SRC = SRC('./page.tsx');
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    // 🔴 全套併跑時 React scheduler 還排著工作, jsdom 先拆 ⇒ 「window is not defined」unhandled(單跑不出現, 全套穩定 2 發)。
    //    讓一個 macrotask 跑完再交還環境;不是 disable、不改任何斷言。
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });

  it('🔴 正向:有關鍵字 + 隱藏規則生效 + 0 筆 ⇒ 明示提示並指向那個勾', async () => {
    cookieState.keyword = '王小明';
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    // 🔴 「找不到單」只出現在提示本文,是這一格唯一有判別力的觀察面。
    expect(text).toContain('找不到單');
  });

  it('🔴 文案一致性:提示叫人勾的字,必須逐字等於篩選列上那個 label', async () => {
    // 🔴 **對原始碼斷言、不對畫面斷言**(R1 Imp-2 的修法):
    //    畫面上那個字串由 chip label 無條件供應 ⇒ 對畫面 `toContain` 恆真。
    //    這裡把 label 從元件原始碼挖出來,再要求提示文案含它 —— 改壞任一邊都紅。
    //    同款先例:`packages/domain/src/order/display-id.test.ts` 的 regex 單一來源守門。
    const label = /key: 'show-unpaid-card', label: '([^']+)'/.exec(TOOLBAR_VIEW_SRC)?.[1]?.trim();
    const hint = /const UNPAID_CARD_HIDDEN_HINT =\s*\n?\s*'([^']+)'/.exec(PAGE_SRC)?.[1];
    // 🔴 兩邊都抓得到才算數 —— 抓不到就失敗,不是「跳過這格」
    //    (正規式失配還讓它綠 = 又一個恆真格,正是本格在修的病)。
    expect(label, 'chip label 沒抓到,選擇器過期了').toBeTruthy();
    expect(hint, '提示文案常數沒抓到,選擇器過期了').toBeTruthy();
    expect(hint).toContain(label);

    // 🔴🔴 **第二道:那個 label 必須真的被渲染成表單控制項的標籤**(codex R2 must-fix)。
    //    只有原始碼那道還是假綠:把真的 JSX label 刪掉、在**區塊註解裡**留一行以同字面
    //    開頭的文字,正規式照樣命中 ⇒ 十格全綠(已實測構造出來)。
    //    ⇒ 加這道之後,「label 被刪、只剩註解」會在這裡紅:註解不會變成 accessible name。
    //    ⚠️ 這與 Imp-2 修掉的那個恆真**不同**:那邊錯在拿畫面文字證「提示含 label」
    //      (第二來源供應);這裡是拿畫面證「label 存在且叫這個名字」—— 那正是畫面該負責的事。
    //    🔵 2026-09-13 晚:那個字現在是「只看」列的一顆 chip(連結),accessible name = 它的文字。
    const { getByRole } = await renderPage({});
    expect(getByRole('link', { name: label as string })).toBeTruthy();
  });

  it('負向①:勾已經打開(隱藏規則沒生效)⇒ 不提示(沒有東西被藏,提示就是說謊)', async () => {
    cookieState.keyword = '王小明';
    const { container } = await renderPage({ show_unpaid_card: '1' });
    expect(container.textContent ?? '').not.toContain('找不到單');
  });

  it('負向②:有結果 ⇒ 不提示(員工不需要逃生口)', async () => {
    cookieState.keyword = '王小明';
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({});
    expect(container.textContent ?? '').not.toContain('找不到單');
  });

  it('負向③:沒有在搜尋(只是瀏覽列表)+ 0 筆 ⇒ 不提示(瀏覽時它是噪音)', async () => {
    const { container } = await renderPage({});
    expect(container.textContent ?? '').not.toContain('找不到單');
  });

  /**
   * 🔴 `#841` 乙-2(2026-08-22,線 A `-86`):**瀏覽 + 0 筆時,畫面上要有一句解釋。**
   *
   * **與上面「負向③」的關係(讀之前先看這段,否則會以為兩者打架)**:
   * 負向③ 釘的是「瀏覽 + 0 筆 ⇒ **不得出現【找不到單】那句**」——**那條一個字都沒動,而且仍然綠**。
   * 本族講的是**另一句話**(`BROWSE_EMPTY_HINT`),它刻意不含那四個字。
   * 🔴 誰日後要改那句文案,**先確認沒有把「找不到單」帶進來** —— 帶進來會讓負向③ 紅,
   *    而**那不是它壞了,是你撞到它**。
   *
   * 🔴 三格,而第三格是這一族存在的理由:
   *   ① 瀏覽 + 0 筆        ⇒ 要講
   *   ② 瀏覽 + 有結果      ⇒ 不講（否則變成常駐噪音,那正是原作者當初排除瀏覽態的理由）
   *   ③ 那句話裡【必須】有「其他篩選條件」那一段
   *      —— 因為 0 筆的真正原因可能是別的篩選軸, 而我們證明不了是隱藏造成的。
   *      少了它, 這句話會讓員工以為「勾了就一定找得到」。
   */
  function browseHint(container: HTMLElement): string | null {
    const t = container.textContent ?? '';
    return t.includes('刷卡未付款的單預設不列') ? t : null;
  }

  it('🔴 乙-2 ①:沒有在搜尋 + 0 筆 ⇒ 要講(0 筆時它不是噪音,是畫面上唯一的解釋)', async () => {
    const { container } = await renderPage({});
    expect(browseHint(container), '瀏覽而 0 筆時必須有一句解釋').not.toBeNull();
  });

  it('🔴 乙-2 ②:沒有在搜尋 + 有結果 ⇒ 不講', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({});
    expect(browseHint(container)).toBeNull();
    // 正對照:這一發真的渲染了列表 ⇒ 上面那個 null 不是「整頁沒出來」造成的。
    expect(container.textContent ?? '').toContain('共');
  });

  // ⛔ 乙-2 ③「必須帶【其他篩選條件】」2026-09-14 移除:Sean 逐字「這句話也依樣太囉唆」⇒ 一句、不要第二句。
  it('🔴 那句話一行以內:沒有破折號、沒有第二句', async () => {
    const { container } = await renderPage({});
    const hint = browseHint(container)!;
    const line = hint.slice(hint.indexOf('刷卡未付款的單預設不列'), hint.indexOf('才會出現。') + 5);
    expect(line).toBe('刷卡未付款的單預設不列,按「含刷卡未付款」才會出現。');
    expect(line).not.toContain('——');
  });

  it('🔴 乙-2 ④:勾已經打開 ⇒ 不講(沒有東西被藏,講了是說謊)', async () => {
    const { container } = await renderPage({ show_unpaid_card: '1' });
    expect(browseHint(container)).toBeNull();
  });

  it('🔴 讀不到時不提示 —— 0 筆的原因是壞掉,不是被藏起來', async () => {
    cookieState.keyword = '王小明';
    mocks.list.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    expect(text).toContain('訂單列表載入失敗');
    expect(text).not.toContain('找不到單');
  });
});

// ── Q-347-B5=C:`supplierOrderNoMatchedSuppliers` 恆 null 之下的三態渲染 ────────────
// 🔴 主視窗列為硬驗收:恆 null 是**新常態**,不能只靠「以前 null 也沒事」推定。
//    這一格證的是「整塊不渲染」,不是「渲染成空殼 / undefined 字樣」。
describe('OrdersPage — #347-B 供應商三態在恆 null 之下不渲染', () => {
  // 🔴 用**只有那三段橫幅才有**的句子當觀察面(舊測試的教訓:輸入框的 sr-only
  //    提示裡也有半句一樣的字,拿那半句斷言會抓到輸入框、量到的不是橫幅)。
  const BANNER_ONLY = '到貨登記前請先點進訂單核對供應商';
  beforeEach(() => {
    cookieState.keyword = undefined;
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    cleanup();
    // 🔴 全套併跑時 React scheduler 還排著工作, jsdom 先拆 ⇒ 「window is not defined」unhandled(單跑不出現, 全套穩定 2 發)。
    //    讓一個 macrotask 跑完再交還環境;不是 disable、不改任何斷言。
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });

  it('🔴 有結果、而 adapter 回 null ⇒ 三段橫幅一句都不出現', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, supplierOrderNoMatchedSuppliers: null });
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    expect(text).not.toContain(BANNER_ONLY);
    expect(text).not.toContain('這組單號屬於供應商');
    expect(text).not.toContain('家供應商都有');
    // 🔴 也不得渲染成空殼:整塊不存在,不是存在但沒字。
    expect(text).not.toContain('undefined');
    // 正向對照:訂單本身有正常列出來(證明上面三個 not 不是因為整頁沒渲染)
    expect(text).toContain('YWP3PC');
  });

  it('🔴 契約仍活著:多家 ⇒ 示警橫幅列名(這才是真的會出事的那態)', async () => {
    // ⚠️ 同上,**縱深不是現況**。挑 `multiple` 是因為它是三態裡唯一「不看就會登錄錯貨」的:
    //    兩家供應商用同一組單號時,員工看到具名以為只有一家 ⇒ 到貨登記登到別家頭上。
    //    (R1 m4:原本三態只測了 `single`,`multiple`/`unknown` 在頁層零覆蓋。)
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      supplierOrderNoMatchedSuppliers: [
        { id: 's-1', label: '大同機車行' },
        { id: 's-2', label: '協進車業' },
      ],
    });
    const { container } = await renderPage({});
    const text = container.textContent ?? '';
    expect(text).toContain('大同機車行');
    expect(text).toContain('協進車業');
    // 🔴 光列名不夠 —— 這一態的重點是**叫他去核對**,少了這句就只是資訊、不是警告。
    expect(text).toContain('先點進訂單確認');
  });

  it('🔴 契約仍活著:片 B-2 把 producer 接回來(給一家)⇒ 具名橫幅要出得來', async () => {
    // ⚠️ 這格是**縱深**,不是現況 —— 現在沒有 producer 會產生這個值。
    //    它守的是「有人看到恆 null 就把三態渲染整段刪掉」:那樣本格會紅。
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      supplierOrderNoMatchedSuppliers: [{ id: 's-1', label: '大同機車行' }],
    });
    const { container } = await renderPage({});
    expect(container.textContent ?? '').toContain('大同機車行');
  });
});

// ── P-d:`?open=` 指到的單【不在這一頁】時要說一句(2026-09-13,主視窗裁甲)──────────
describe('P-d — ?open= 指到的單不在這一頁', () => {
  const OPEN = '11111111-2222-4333-8444-555555555555';

  it('🔴 存在但被篩選 / 分頁藏起來 ⇒ 藍提示 + 「清除篩選並打開」,而且【不撈明細、不畫展開列】', async () => {
    // 🔴 這一格是真瀏覽器驗出來的【最糟】情況的替身守門:舊版在這裡**靜靜地什麼都沒有**。
    //    主視窗的突變要求:拿掉「先判在不在」那一步 ⇒ 要當場紅。
    //    ⇒ 拿掉那一步的話,`openMissingOrHidden` 永遠是 null ⇒ 下面「提示要在」那條紅。
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue({ displayId: 'PCM-2026-1002' });
    const { container } = await renderPage({ open: OPEN });

    const notice = container.querySelector('[data-testid="open-order-hidden"]');
    expect(notice, '被藏起來的單沒有任何提示 ⇒ 他會以為網址壞了').not.toBeNull();
    expect(notice!.textContent).toContain('PCM-2026-1002');
    // 🔴 那顆連結 = 同一張單、篩選清空:return_to 不帶任何篩選、只帶 open。
    const rt = notice!.querySelector('input[type="hidden"][value^="/orders?open="]') as HTMLInputElement | null;
    expect(rt, '清除篩選並打開的 return_to 不對').not.toBeNull();
    expect(rt!.value).toBe(`/orders?open=${OPEN}`);
    // 不在列表 ⇒ 沒有展開列(展開列綁在那一列底下,那一列不存在)。
    expect(container.querySelector('tr.orders-expanded')).toBeNull();
    // 存在檢查恰一次、而且問的是那張單。
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.detail).toHaveBeenCalledWith(OPEN);
    // 🔴 兩句是兩件事:紅提示不得同時出現。
    expect(container.querySelector('[data-testid="open-order-missing"]')).toBeNull();
  });

  it('🔴 根本不存在 ⇒ 紅提示、沒有連結(沒有地方可去)、列表照常', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(null);
    const { container } = await renderPage({ open: OPEN });

    const missing = container.querySelector('[data-testid="open-order-missing"]');
    expect(missing).not.toBeNull();
    expect(missing!.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-testid="open-order-hidden"]')).toBeNull();
    // 列表照常(那一張單還在)。
    expect(container.querySelectorAll('tbody.orders-group').length).toBe(1);
  });

  it('🔴 沒帶 open ⇒ 兩種提示都沒有、存在檢查【不跑】(對照組,擋恆真)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockClear();
    const { container } = await renderPage({});
    expect(container.querySelector('[data-testid="open-order-hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="open-order-missing"]')).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('🔴 open 不是 UUID ⇒ 當沒帶(不撈、不提示)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockClear();
    const { container } = await renderPage({ open: 'not-a-uuid' });
    expect(container.querySelector('[data-testid="open-order-hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="open-order-missing"]')).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});

// ── 手動建單彈窗:`?new=1` ⇒ 殼 + ManualOrderView(container='dialog');只開表單不寫入 ────────
//    🔵 ManualOrderView 是 async server component、會撈員工名單 ⇒ 整支 mock 成一個記 props 的探針,
//       本檔守的是「page 有沒有把對的容器餵給它」(同 order-detail-tabs-wiring 那支的理由)。
const manualViewProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('../../components/orders/manual-order-view', () => ({
  ManualOrderView: async (props: Record<string, unknown>) => {
    manualViewProps.last = props;
    return <div data-testid='manual-order-view-probe' />;
  },
}));
/** 🔵 讀成函式:上面剛指派過 `null`, TS 流程分析會把 `manualViewProps.last` 窄成 `never`(同 order-detail-tabs-wiring 那支)。 */
function capturedManualView(): { container?: unknown; raw?: Record<string, string> } | null {
  return manualViewProps.last as { container?: unknown; raw?: Record<string, string> } | null;
}
describe('手動建單 — ?new=1 開彈窗', () => {
  it('🔴 ?new=1 ⇒ 殼在(標題「手動建單」)、ManualOrderView 拿到 container=dialog 與整包 raw', async () => {
    manualViewProps.last = null;
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({ new: '1', r: 'manual_order_error', mrid: 'x' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('手動建單');
    expect(dlg!.querySelector('[data-testid="manual-order-view-probe"]')).not.toBeNull();
    expect(capturedManualView()?.container, '容器餵錯 ⇒ 送出之後會跑去別的容器').toBe('dialog');
    // 🔴 失敗導回帶的 r / mrid 要原樣進 view(它靠這兩顆印橫幅、沿用冪等鍵)
    expect(capturedManualView()?.raw?.r).toBe('manual_order_error');
    expect(capturedManualView()?.raw?.mrid).toBe('x');
  });

  // 🔴 codex 2026-09-13 must-fix:彈窗原本被包在 loadFailed 的成功分支裡 ⇒ 列表撈不到就不能建單、不能沿用 mrid 重送。
  //    面板那條路從來沒有這條規則;建單不依賴列表。
  it('🔴🔴 列表載入失敗 ⇒ 手動建單彈窗【照樣開】(建單不依賴列表, 員工要能沿用 mrid 重送)', async () => {
    manualViewProps.last = null;
    mocks.list.mockRejectedValue(new Error('列表掛了'));
    const { container } = await renderPage({ new: '1', r: 'manual_order_error', mrid: '11111111-1111-4111-8111-111111111111' });
    expect(container.textContent).toContain('訂單列表載入失敗');
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '列表掛了就不能建單 ⇒ 多了一條面板沒有的規則').not.toBeNull();
    expect(capturedManualView()?.container).toBe('dialog');
    expect(capturedManualView()?.raw?.mrid).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('🔵 沒有 ?new= ⇒ 不開、ManualOrderView 沒被渲染', async () => {
    manualViewProps.last = null;
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({});
    expect(container.querySelector('[data-testid="manual-order-view-probe"]')).toBeNull();
    expect(capturedManualView()).toBeNull();
  });
});

// ── 發票小抄:`?invoice=<id>` ⇒ 開彈窗(殼借 P-e-1 的), 只開表單不寫入(2026-09-13, Sean 拍甲)────────
describe('發票小抄 — ?invoice= 開彈窗', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const DETAIL = {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 7,
    invoiceRequested: true,
    invoiceStatus: 'not_issued',
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceRequest: { type: 'personal' },
    priceTaxMode: 'inclusive',
    vehicle: null,
    total: { amount: 1100, currency: 'TWD' },
    taxTotal: { amount: 0, currency: 'TWD' },
    // 標題列「發票 · 單號 · 客人」(v20 稿)讀 customer.name —— fixture 少這格 ⇒ 殼 render 直接炸。
    customer: { name: '王小明', email: null, phone: null },
  };

  it('🔴 invoice 指到這一頁的單 ⇒ 殼在、三個數在、抬頭/統編/登記三格在同一張 form', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ invoice: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.textContent).toContain('發票上要寫的');
    // v20 稿標題列「發票 · 單號 · 客人」(2026-09-13);單號與客人都要在同一條標題裡。
    expect(dlg!.textContent).toContain('發票 · PCM-2099-0001 · 王小明');
    expect(dlg!.textContent).toContain('1,048');
    // 一張 form(不含殼自己那顆 method=dialog 的取消):抬頭 / 統編 / 登記三格全在裡面
    const forms = [...dlg!.querySelectorAll('form')].filter((f) => f.getAttribute('method') !== 'dialog');
    expect(forms).toHaveLength(1);
    for (const name of ['invoice_title', 'invoice_tax_id', 'invoice_status', 'invoice_number', 'invoice_amount', 'version']) {
      expect(forms[0]!.querySelector(`[name="${name}"]`), `缺 ${name}`).not.toBeNull();
    }
  });

  // 走查 0914 第 8 條(主視窗裁):⛔ ~~不在這一頁 ⇒ 不開、不撈~~ ⇒ 照 id 撈、開得了(從搜尋 / 別頁進來那條路);非 UUID 仍不開。
  it('🔴 invoice 指到【不在這一頁】的單 ⇒ 照 id 撈、殼開;非 UUID ⇒ 不開不撈', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockClear();
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ invoice: U });
    expect(container.querySelector('[data-testid="next-step-dialog"]')).not.toBeNull();
    expect(mocks.detail).toHaveBeenCalledWith(U);
    cleanup();
    mocks.detail.mockClear();
    const bad = (await renderPage({ invoice: 'not-a-uuid' })).container;
    expect(bad.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  // 走查 0914 第 7 條(主視窗裁):「此單不開發票」那一句沒有表單 ⇒ 殼要畫自己的「取消」鈕(圖 25 一顆鈕都沒有)。
  it('🔴 不開發票的單 ⇒ 殼在、印那一句、而且有「取消」鈕', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    mocks.detail.mockResolvedValue({ ...DETAIL, invoiceRequested: false });
    const { container } = await renderPage({ invoice: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.textContent).toContain('此單不開發票');
    expect([...dlg!.querySelectorAll('button, a')].some((b) => b.textContent?.trim() === '取消')).toBe(true);
  });

  it('🔴 撈明細失敗(回 null)⇒ 殼在、印一句找不到、零表單', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    mocks.detail.mockResolvedValue(null);
    const { container } = await renderPage({ invoice: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.querySelector('[role="alert"]')?.textContent).toContain('找不到這張單');
    expect([...dlg!.querySelectorAll('form')].filter((f) => f.getAttribute('method') !== 'dialog')).toHaveLength(0);
  });
});

// ── P-e-1:`?next=<id>&do=<動作>` ⇒ 只開彈窗【殼】,零寫入(2026-09-13,Sean 批 P-e 甲)────────
describe('P-e-1 — ?next= 開的是殼,不是動作', () => {
  // 🏁 **P-e-2(2026-09-13):佔位字退場,三支 body 接上。** 本檔只驗「殼 + 對的 body 有沒有接上」,
  //    body 自己長什麼樣由設計窗的 `next-step-bodies.test.ts` 守。
  const U = '11111111-2222-4333-8444-555555555555';
  const withOrder = () =>
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
  // 到貨 body 要一張「有還在等的採購」的明細;其餘欄位它不讀。
  const DETAIL_WITH_PENDING = {
    displayId: 'PCM-2026-1002',
    items: [
      {
        id: 'it-1',
        productSnapshot: { title: '下導流' },
        procurements: [
          // 下訂 body 會把既有採購列整理成供應商選項 ⇒ 供應商三欄要在( 讀它們)。
          { id: 'pr-1', voidedAt: null, allocatedQuantity: 3, receivedQuantity: 1, supplierId: 'sup-1', supplierLabel: '甲供應商', supplierIsActive: true },
        ],
      },
    ],
  };

  it('🔴 do=receipt ⇒ 殼在(標題「到貨登記」)+ 到貨 body 在殼裡', async () => {
    withOrder();
    mocks.detail.mockResolvedValue(DETAIL_WITH_PENDING);
    const { container } = await renderPage({ next: U, do: 'receipt' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('到貨登記');
    expect(dlg!.querySelector('[data-testid="next-step-receipt-body"]'), '到貨 body 沒接進殼').not.toBeNull();
    // 🆕 稿彈窗 8 的摺疊:「已登的到貨(撤銷在這裡)」在、裡面是明細頁那份到貨紀錄清單(每筆自帶「撤銷」details)。
    const fold = dlg!.querySelector('[data-testid="next-step-receipt-history"]');
    expect(fold, '摺疊沒進彈窗').not.toBeNull();
    expect(fold!.querySelector('summary')!.textContent).toBe('已登的到貨(撤銷在這裡)');
    expect(fold!.textContent, '到貨紀錄清單沒進摺疊').toContain('到貨紀錄(1 筆)');
    expect([...fold!.querySelectorAll('summary')].some((x) => x.textContent === '撤銷'), '每筆的「撤銷」入口不在').toBe(true);
  });

  it('🔴 do=order ⇒ 摺疊「已下的採購(作廢在這裡)」在,每筆生效採購一列、內摺「作廢」(稿彈窗 7)', async () => {
    withOrder();
    mocks.detail.mockResolvedValue(DETAIL_WITH_PENDING);
    const { container } = await renderPage({ next: U, do: 'order' });
    const fold = container.querySelector('[data-testid="next-step-procurement-voids"]');
    expect(fold, '摺疊沒進彈窗').not.toBeNull();
    expect(fold!.querySelector('summary')!.textContent).toBe('已下的採購(作廢在這裡)');
    expect(fold!.querySelectorAll('[data-testid="procurement-void-row"]').length).toBe(1);
    expect(fold!.textContent).toContain('甲供應商');
    expect(fold!.querySelector('[data-testid="procurement-void"] summary')!.textContent).toBe('作廢');
    expect(fold!.querySelector('input[name="void_reason"]')!.hasAttribute('required'), '理由必填').toBe(true);
  });

  it('🔴 do=order ⇒ 殼在(標題「跟供應商下訂」)+ 下訂 body 在殼裡', async () => {
    withOrder();
    mocks.detail.mockResolvedValue(DETAIL_WITH_PENDING);
    const { container } = await renderPage({ next: U, do: 'order' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('跟供應商下訂');
    expect(dlg!.querySelector('[data-testid="next-step-procurement-body"]'), '下訂 body 沒接進殼').not.toBeNull();
  });

  it('🔴🔴 M1:採購投影【讀不到】(procurements === null)⇒ 那一項不給表單、印讀不到那句', async () => {
    // 🔴 codex R1 must-fix(P-e-3):第一版把 null 靜靜轉成 [] ⇒ 用空資料初始化表單 ⇒ 送出會用空白蓋掉
    //    別人填過的單號 / 異常原因 / 預計到貨日。明細頁是 `blocked = unreadable || truncated`,彈窗要一樣。
    withOrder();
    mocks.detail.mockResolvedValue({
      ...DETAIL_WITH_PENDING,
      items: [{ ...DETAIL_WITH_PENDING.items[0]!, procurements: null }],
    });
    const { container } = await renderPage({ next: U, do: 'order' });
    const body = container.querySelector('[data-testid="next-step-procurement-body"]')!;
    expect(body.querySelector('[data-testid="next-step-procurement-unreadable"]'), '讀不到時要印那句').not.toBeNull();
    expect(body.querySelector('form'), '讀不到時不得渲染表單 —— 送出會用空白蓋掉既有值').toBeNull();
  });

  it('🔴🔴 do=ship ⇒ 讀取中【有殼】(B13:沒品項的單原本不開也不報);開起來之後 ShipmentDialog 自帶遮罩、不再包殼', async () => {
    withOrder();
    const { container } = await renderPage({ next: U, do: 'ship' });
    // 🔵 2026-09-13 B13:讀取 / 讀不到 / 沒品項 三個狀態現在包在 NextStepDialog 裡(原本是裸 <div> 掉在頁面流裡,
    //    員工按了「出貨」什麼都沒看到)。ShipmentDialog 本體仍是自己那片 fixed 遮罩(page.tsx 那段理由不變)。
    const shell = container.querySelector('[data-testid="next-step-dialog"]');
    expect(shell, '讀取中沒有殼 ⇒ 空品項的單會回到「不開也不報」').not.toBeNull();
    expect(shell!.querySelector('[data-testid="next-step-shipment-loading"]')).not.toBeNull();
    // 出貨 body 是 client 元件、mount 前先印 loading 那一格 ⇒ 那一格在就代表它被渲染了。
    expect(
      container.querySelector('[data-testid^="next-step-shipment-"]'),
      '出貨 body 沒渲染',
    ).not.toBeNull();
  });

  // ── B9 批次列(2026-09-14):`next=a,b&items=…` ⇒ 多單版,一單一份表單、標題「· N 樣一起」、到貨表多一欄單號 ──
  const U2 = '66666666-7777-4888-9999-000000000000';
  const IT1 = 'aaaaaaaa-1111-4111-8111-111111111111';
  const IT2 = 'bbbbbbbb-2222-4222-8222-222222222222';
  const IT3 = 'cccccccc-3333-4333-8333-333333333333';
  const detailFor = (displayId: string, ids: readonly string[]) => ({
    ...DETAIL_WITH_PENDING,
    id: displayId === 'PCM-A' ? U : U2,
    displayId,
    items: ids.map((id, i) => ({ ...DETAIL_WITH_PENDING.items[0]!, id, procurements: [{ ...DETAIL_WITH_PENDING.items[0]!.procurements[0]!, id: `pr-${id}-${i}` }] })),
  });

  it('🔴 B9 多單 do=receipt ⇒ 兩張單各一份、只列 items 勾到的、表頭一次且有「單號」欄、標題「到貨登記 · 3 樣一起」', async () => {
    withOrder();
    mocks.detail.mockImplementation(async (id: string) =>
      id === U ? detailFor('PCM-A', [IT1, IT2, 'dddddddd-4444-4444-8444-444444444444']) : detailFor('PCM-B', [IT3]),
    );
    const { container } = await renderPage({ next: `${U},${U2}`, do: 'receipt', items: `${IT1},${IT2},${IT3}` });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg.querySelector('#next-step-title')!.textContent).toBe('到貨登記 · 3 樣一起');
    expect(dlg.querySelectorAll('[data-testid="next-step-receipt-body"]').length).toBe(2);
    expect(dlg.querySelectorAll('[data-testid="receipt-table-header"]').length, '多單版表頭只印一次').toBe(1);
    expect(dlg.querySelector('[data-testid="receipt-table-header"]')!.textContent).toContain('單號');
    const forms = [...dlg.querySelectorAll('[data-testid="receipt-row-form"]')];
    expect(forms.length, '第一張單有 3 樣、只勾了 2 樣 ⇒ 2 + 1 = 3 份表單').toBe(3);
    expect(forms.map((f) => f.textContent?.includes('PCM-A') || f.textContent?.includes('PCM-B'))).toEqual([true, true, true]);
  });

  it('🔴 B9 多單 do=order ⇒ 每一樣前面印單號;items 沒帶 ⇒ 整張單', async () => {
    withOrder();
    mocks.detail.mockImplementation(async (id: string) => (id === U ? detailFor('PCM-A', [IT1, IT2]) : detailFor('PCM-B', [IT3])));
    const { container } = await renderPage({ next: `${U},${U2}`, do: 'order' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(dlg.querySelector('#next-step-title')!.textContent).toBe('跟供應商下訂');
    const bodies = [...dlg.querySelectorAll('[data-testid="next-step-procurement-body"]')];
    expect(bodies.length).toBe(2);
    expect(bodies[0]!.querySelectorAll('h3').length).toBe(2);
    expect(bodies[0]!.querySelector('h3')!.textContent).toContain('PCM-A');
    expect(bodies[1]!.querySelector('h3')!.textContent).toContain('PCM-B');
  });

  it('🔴 B9-b(主視窗裁,Sean「一次做到完畢」):下訂 / 到貨彈窗 = 一張批次表單(列不自帶 form、欄位掛 r.<id>. 前綴、一顆確認全部)', async () => {
    withOrder();
    mocks.detail.mockImplementation(async (id: string) => (id === U ? detailFor('PCM-A', [IT1, IT2]) : detailFor('PCM-B', [IT3])));
    const { container } = await renderPage({ next: `${U},${U2}`, do: 'receipt', items: `${IT1},${IT3}` });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    // 批次外殼恰一張;作廢 / 撤銷摺疊的表單各自獨立、**不得在外殼裡面**(巢狀 form 瀏覽器會拆掉)。
    const forms = [...dlg.querySelectorAll('[data-testid="next-step-batch-form"]')];
    expect(forms.length, '批次外殼要恰一張').toBe(1);
    expect(forms[0]!.querySelector('form'), '批次外殼裡面出現了別的 form(作廢 / 撤銷摺疊被包進去了)⇒ 巢狀 form').toBeNull();
    expect(dlg.querySelector('[data-testid="next-step-receipt-history"]'), '撤銷摺疊要在').not.toBeNull();
    expect(forms[0]!.querySelector('[data-testid="next-step-receipt-history"]'), '撤銷摺疊不得在批次外殼裡').toBeNull();
    expect((forms[0]!.querySelector('input[name="batch_kind"]') as HTMLInputElement).value).toBe('receipt');
    const rows = [...dlg.querySelectorAll('[data-testid="receipt-row-form"]')];
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.tagName)).toEqual(['DIV', 'DIV']);
    const oids = rows.map((r) => (r.querySelector('input[name$=".order_id"]') as HTMLInputElement).value);
    expect(oids).toEqual([U, U2]);
    for (const r of rows) {
      expect(r.querySelector('input[name^="r."][name$=".request_id"]'), '列少了冪等鍵欄位').not.toBeNull();
      expect(r.querySelector('button[type="submit"]'), '列不得有自己的送出鈕').toBeNull();
    }
    expect([...forms[0]!.querySelectorAll('button[type="submit"]')].map((b) => b.textContent)).toEqual(['確認全部']);
    // 列上那顆鈕開的單張單(沒 items)一樣走批次外殼(P-e-3 那條路同樣受惠)。
    const single = await renderPage({ next: U, do: 'order' });
    expect(single.container.querySelectorAll('[data-testid="next-step-dialog"] [data-testid="next-step-batch-form"]').length).toBe(1);
    expect(single.container.querySelector('[data-testid="next-step-batch-form"] form'), '作廢摺疊被包進批次外殼').toBeNull();
    expect(single.container.querySelector('[data-testid="next-step-dialog"] [data-testid="next-step-procurement-voids"]'), '作廢摺疊要在').not.toBeNull();
  });

  it('🔴 B9-b:出貨彈窗不走批次外殼(一窗一箱);doneHref 維持展開那一張', async () => {
    withOrder();
    const { container } = await renderPage({ next: U, do: 'ship', items: IT1 });
    expect(container.querySelector('[data-testid="next-step-shipment-loading"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="next-step-batch-form"]')).toBeNull();
    const src = readFileSync(`${__dirname}/page.tsx`, 'utf8');
    expect(src).toMatch(/nextStep\.do === 'ship' \? buildOrderListHref\(filter, display, page, nextStep\.orderId\) : closeHref/);
  });

  it('🔴 B9 codex must-fix ③:items 帶了但壞(`i1,nope`)⇒ 不開,不放寬成整張單', async () => {
    withOrder();
    mocks.detail.mockResolvedValue(detailFor('PCM-A', [IT1, IT2]));
    expect((await renderPage({ next: U, do: 'receipt', items: `${IT1},nope` })).container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    expect((await renderPage({ next: U, do: 'order', items: '' })).container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });

  it('🔴 B9:多單 + do=ship ⇒ 不開(稿:跨單不能一起裝箱);next 裡有一段不是 uuid ⇒ 不開', async () => {
    withOrder();
    expect((await renderPage({ next: `${U},${U2}`, do: 'ship' })).container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    expect((await renderPage({ next: `${U},x`, do: 'order' })).container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });

  it('🔴 do 不在三值白名單 ⇒ 不開(不開一個不知道要幹嘛的彈窗)', async () => {
    const U = '11111111-2222-4333-8444-555555555555';
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0]!, id: U }] });
    const { container } = await renderPage({ next: U, do: 'delete' });
    expect(container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });

  it('🔴 next 指到【不在這一頁】的單 ⇒ 照開(codex R2 must-fix ①:送出失敗後那張單離開篩選,彈窗不能跟著卸載、丟掉冪等鍵)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    const { container } = await renderPage({ next: '11111111-2222-4333-8444-555555555555', do: 'order' });
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '綁了列表成員資格').not.toBeNull();
  });

  it('🔴 page 傳給表格的 buildNextHref 帶著篩選與頁碼(擋「漏傳 ⇒ 用了不帶篩選的預設」)', async () => {
    const U = '11111111-2222-4333-8444-555555555555';
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [{ ...ONE_ORDER.items[0]!, id: U, lines: [], paymentStatus: 'unpaid' }],
    });
    const { container } = await renderPage({ payment_status: 'unpaid', page: '2' });
    const a = container.querySelector('td.col-next a');
    expect(a, '這張單的貨品軸應該是 none ⇒ 有「跟供應商下訂」連結').not.toBeNull();
    const qs = new URLSearchParams(a!.getAttribute('href')!.split('?')[1] ?? '');
    expect(qs.get('payment_status')).toBe('unpaid');
    expect(qs.get('page')).toBe('2');
    expect(qs.get('next')).toBe(U);
    expect(qs.get('do')).toBe('order');
    expect(qs.get('open'), 'next 連結不該順手把那一列展開').toBeNull();
  });
});

// ── 收款欄可點:`?pay=<id>` ⇒ 「新增收款」彈窗(2026-09-13,Sean 答甲)──────────────
describe('收款欄可點 — ?pay= 開的是明細頁那份收款表單', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const withOrder = () =>
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [{ ...ONE_ORDER.items[0]!, id: U, balanceDue: 3500, paymentStatus: 'partiallyPaid' }],
    });

  it('🔴 pay 指到這一頁的單 ⇒ 殼在(標題「新增收款」)+ 收款表單在殼裡、同一支 action', async () => {
    withOrder();
    // 🔴 **[2026-09-16 Sean 拍甲]這一行是那一改帶來的【新相依】,不是為了讓測試過關。**
    //    彈窗的「已退多少」現在從 detail 的**原總額**算(先前錯用「取消後應收」⇒ 部分取消的單上算錯)
    //    ⇒ 沒有 detail 就一律「未知」,與同一段 `cancelledUnknown` 同口徑(fail-closed)。
    //    ⚠️ 不加這一行的話,本格描述的是一個**不存在的世界**:單在列表裡、卻查不到它的總額
    //       (`AdminOrderDetail.total` 型別上必填)。
    //    🔵 `mocks.detail` 沒有預設實作(`vi.fn()` 回 `undefined`)—— 這一族 fixture 的坑
    //       逐字寫在 `ONE_ORDER` 上方:「型別看不到缺欄,而執行期會 Cannot read properties of undefined」。
    // 🛑 **用 `Once` 不用 `mockResolvedValue`,而理由是實測出來的**:我第一版用了後者,
    //    **下方「下訂彈窗」那格當場紅**(`Cannot read properties of undefined (reading 'length')`)
    //    —— 本檔沒有逐格 reset,**設進去的值會殘留給後面的格子**,而那些格子正吃著殘留值。
    //    📌 **格與格之間靠 mock 殘留互相傳話,是一種看不見的耦合** —— 它不會紅,直到有人換掉那個值。
    mocks.detail.mockResolvedValueOnce({ total: { amount: 1000 } });
    const { container } = await renderPage({ pay: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    // B17(2026-09-14):稿標題「新增收款 · 單號 · 買主」⇒ 改成前綴比對;單號那半另一格守(下面)。
    expect(dlg!.querySelector('#next-step-title')!.textContent).toMatch(/^新增收款/);
    expect(dlg!.querySelector('#next-step-title')!.textContent).toContain('YWP3PC');
    expect(dlg!.querySelector('[data-testid="next-step-pay-body"]'), '收款 body 沒接進殼').not.toBeNull();
    // 🔴 復用的是明細頁那份 PaymentRecordForm ⇒ 它的表單在(有 request_id 那顆 hidden)。
    expect(dlg!.querySelector('form input[name="request_id"]'), '沒有明細頁那份表單的冪等鍵欄位 ⇒ 不是同一份表單').not.toBeNull();
    // 🔴 codex must-fix ①:整段 PaymentSection(清單在上)—— 零筆時印「尚未登錄任何收款。」而不是沒有清單。
    //    沒清單 ⇒ 首送已入帳但回應失敗時員工看不到那一筆、按「開始下一筆」就寫兩筆。
    expect(dlg!.textContent, '收款清單沒進彈窗 ⇒ 只搬了表單、漏了清單').toContain('尚未登錄任何收款');
    // 彈窗整個就是為了這張表單開的 ⇒ 一進來就攤開。B17(2026-09-14)起表單在彈窗裡不再包 <details>(稿:表單在上、
    //    「已登的收款 N 筆」摺疊在下)⇒ 改量「金額欄不在任何收著的 <details> 裡」。
    const amountInput = dlg!.querySelector('form input[name="amount"]');
    expect(amountInput, '表單沒攤開').not.toBeNull();
    expect(amountInput!.closest('details:not([open])'), '表單收著,員工要再點一次「新增收款」').toBeNull();
    // B17:彙總行不再單獨畫,「應收 / 已收」跟著確認勾走 —— 算得出來才會有,算不出來是「未知」。
    // 🔴 **2026-09-16 期望值改了,而理由是【文案的定義變了】,不是為了過關**:
    //    Sean 走查逐字回報原句「我看過這張單已收的(還沒登過 · 尾款 NT$1,785)」**看不懂**
    //    ⇒ 拆成「勾選句只講動作」+「狀態自己一行」(理由逐字寫在 `payment-record-form.tsx` 那段註解)。
    //    ⇒ 這裡改量**那一行狀態**,它守的仍是同一件事:彙總數字有沒有進到這個彈窗。
    expect(dlg!.textContent).toContain('這張單目前:');
    expect(dlg!.textContent).not.toContain('未知');
    // 🔴 codex must-fix ③:做完回列表要展開【真的收款的這張】,結果橫幅跟著錢走。
    const rt = dlg!.querySelector('form input[name="return_to"]') as HTMLInputElement | null;
    expect(rt, '表單沒帶 return_to').not.toBeNull();
    expect(new URLSearchParams(rt!.value.split('?')[1] ?? '').get('open')).toBe(U);
    // 🔴 對稿(v20-v22 `.ft`):[取消][確認] 同一排 ⇒ 取消鈕只有一顆、住在表單那一排、靠 `form=` 指回殼的隱形 dialog form;
    //    殼自己的 footer 不畫第二顆。
    const cancels = dlg!.querySelectorAll('[data-next-step-cancel]');
    expect(cancels.length, '取消鈕不是恰一顆(兩顆 = 殼 footer 沒收掉;零顆 = body 沒放)').toBe(1);
    expect(cancels[0]!.getAttribute('form')).toBe('next-step-close');
    expect(dlg!.querySelector('form#next-step-close[method="dialog"]'), '殼的隱形 dialog form 不在 ⇒ 取消鈕按了沒反應').not.toBeNull();
    expect(cancels[0]!.closest('.next-step-ft')?.contains(dlg!.querySelector('button[type="submit"]:not([form])')), '取消與確認不在同一排').toBe(true);
  });

  it('🔴 對照:下訂彈窗(每品項一張表單)取消仍在殼的 footer、不帶 form=', async () => {
    withOrder();
    const { container } = await renderPage({ next: U, do: 'order' });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    const cancels = dlg.querySelectorAll('[data-next-step-cancel]');
    expect(cancels.length).toBe(1);
    expect(cancels[0]!.hasAttribute('form')).toBe(false);
    expect(cancels[0]!.closest('form')?.id).toBe('next-step-close');
  });

  // ── 🔴🔴 [2026-09-16 Sean 拍甲] 行為變更的負對照:彈窗的「已退多少」改用【原總額】算 ──────
  //   改之前:那一格餵的是 `amountDue`(= 取消後應收 T−C),而 `refundedTotalFromUnregistered`
  //   假設第一個參數是原總額 T ⇒ 算出 `(T−C)−(T−R) = R−C`。**部分取消的單上那個數是錯的。**
  //   ⇒ 本格刻意造 `amountDue(500) < 未登記額(mock 1000)` ⇒ **改之前算出負數 ⇒ 整段「未知」**;
  //     改之後用 detail 的原總額 10,000 ⇒ 算得出來 ⇒ 彙總那一行印得出來。
  //   📌 **把行為變更釘住,不然下次有人「修」回去,不會有任何東西紅。**
  it('🔴 應收(取消後)比未登記額小 ⇒ 仍算得出彙總 —— 證明用的是【原總額】不是應收', async () => {
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [{ ...ONE_ORDER.items[0]!, id: U, amountDue: 500, paymentStatus: 'partiallyPaid' }],
    });
    // 這張單查得到、原總額 10,000(與上面那個 500 的應收刻意不同 —— 差異就是這一格的判別力)。
    mocks.detail.mockResolvedValueOnce({ total: { amount: 10000 } });
    const { container } = await renderPage({ pay: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(dlg.textContent, '彙總算不出來 ⇒ 又退回拿「取消後應收」當原總額那條路').toContain('這張單目前:');
    expect(dlg.textContent, '印了「未知」⇒ refundedTotal 變成 null ⇒ 第一個參數又錯了').not.toContain('未知');
  });

  it('🔴 must-fix ②/③:`?open=B&pay=A` ⇒ 連結與取消都保留 open=B;做完的 return_to 改展開 A', async () => {
    const B = '22222222-2222-4333-8444-555555555555';
    mocks.list.mockResolvedValue({
      ...ONE_ORDER,
      items: [
        { ...ONE_ORDER.items[0]!, id: U, balanceDue: 3500, paymentStatus: 'partiallyPaid' },
        { ...ONE_ORDER.items[0]!, id: B, orderNo: 'PCM-B' },
      ],
    });
    const { container } = await renderPage({ open: B, pay: U });
    const a = container.querySelector('td.col-pay a');
    expect(new URLSearchParams(a!.getAttribute('href')!.split('?')[1] ?? '').get('open'), '點收款就把明細收掉了').toBe(B);
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    const closeHref = dlg.getAttribute('data-close-href') ?? '';
    expect(new URLSearchParams(closeHref.split('?')[1] ?? '').get('open'), '取消不該改變他在看哪張').toBe(B);
    const rt = dlg.querySelector('form input[name="return_to"]') as HTMLInputElement;
    expect(new URLSearchParams(rt.value.split('?')[1] ?? '').get('open'), '收的是 A、回去卻展開 B').toBe(U);
  });

  it('🔴 pay 指到【不在這一頁】但存在的單 ⇒ 照開,應收從 findAdminOrderDetail 拿(codex R2 must-fix ①)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValueOnce({ displayId: 'PCM-X', total: { amount: 9900, currency: 'TWD' } });
    const { container } = await renderPage({ pay: U });
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '綁了列表成員資格 ⇒ 送出失敗後彈窗會卸載').not.toBeNull();
    expect(mocks.detail).toHaveBeenCalledWith(U);
  });

  it('🔴 pay 補查應收 throw ⇒ 照開、鎖成「讀不到」(codex R3 must-fix ①:那正是「已入帳、回應斷了」的時刻,收窗 = 丟鍵)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockRejectedValueOnce(new Error('db down'));
    const { container } = await renderPage({ pay: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '補查失敗就收窗 ⇒ 表單實例與舊冪等鍵一起沒了').not.toBeNull();
    expect(dlg!.textContent).toContain('未知');
    expect(dlg!.textContent).not.toContain('應收');
  });

  it('🔴 列表本身載入失敗 + 補查成功 ⇒ 彈窗照開(codex R4 must-fix:彈窗生命週期不跟列表讀取成敗走)', async () => {
    mocks.list.mockRejectedValueOnce(new Error('list down'));
    mocks.detail.mockResolvedValueOnce({ displayId: 'PCM-X', total: { amount: 9900, currency: 'TWD' } });
    const { container } = await renderPage({ pay: U });
    expect(container.textContent).toContain('訂單列表載入失敗');
    expect(container.querySelector('[data-testid="next-step-dialog"]'), '列表紅了就把彈窗一起卸載 ⇒ 丟鍵').not.toBeNull();
  });

  it('🔴 pay 指到【不存在】的單 ⇒ 不開(沒有單就沒有錢可收)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValueOnce(null);
    const { container } = await renderPage({ pay: U });
    expect(container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });

  it('🔴 列表那格的連結帶著篩選與頁碼、不帶 open(擋「用了不帶篩選的預設」)', async () => {
    withOrder();
    const { container } = await renderPage({ payment_status: 'paid', page: '2' });
    const a = container.querySelector('td.col-pay a');
    expect(a, '還差 3,500 那格沒有連結').not.toBeNull();
    const qs = new URLSearchParams(a!.getAttribute('href')!.split('?')[1] ?? '');
    expect(qs.get('pay')).toBe(U);
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.get('page')).toBe('2');
    expect(qs.get('open')).toBeNull();
  });
});

// ── v22 展開標題列 ①:`?cancel=<id>` ⇒ 「退款 / 取消」彈窗(2026-09-13,主視窗派工)──────────
describe('展開標題列 ① — ?cancel= 開的是明細頁「收款 · 退款」分頁裡取消 + 退款那幾段', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  beforeEach(() => {
    mocks.items.mockResolvedValue({ items: [], reportedTotal: 0 });
    // jsdom 沒有 scrollIntoView(退款那塊 defaultOpen 時 effect 會叫)⇒ stub 在 admin project 的 setupFiles:`lib/test-support/vitest-setup.ts`。
  });
  const DETAIL = {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    paymentStatus: 'paid',
    paymentChannel: 'bank',
    fulfillmentStatus: 'notOrdered',
    cancelledAt: null,
    cancelledReason: null, // 取消閘:`cancelledAt === null && cancelledReason !== null` = 關單資料殘留 ⇒ 少這格就被當 undefined !== null
    cancellations: [],
    cancellationsTruncated: false,
    items: [],
    notes: [],
    invoiceRequested: false,
    invoiceStatus: 'not_issued',
    total: { amount: 1100, currency: 'TWD' },
    balanceDue: 0,
    customer: { name: '王小明', email: null, phone: null },
    customerUserId: null,
  };
  it('🔴 cancel 指到一張單 ⇒ 殼在(標題「退款 / 取消」)+ 取消 / 退款那幾段在殼裡、收款那段【不】在', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ cancel: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('退款 / 取消');
    expect(dlg!.querySelector('[data-testid="order-detail-section-money"]'), 'money 那段沒接進殼').not.toBeNull();
    expect(dlg!.textContent, '取消區沒進彈窗').toContain('申請取消整張單');
    expect(dlg!.textContent, '退款區沒進彈窗(codex:只剩取消區也會綠)').toContain('退款');
    expect(dlg!.querySelector('#cancel'), '取消區的錨(#cancel)沒進來').not.toBeNull();
    expect([...dlg!.querySelectorAll('h2')].map((h) => h.textContent), '收款那段跑進來了 —— 它有自己的 ?pay=').not.toContain('收款');
    // 只開表單不寫入:那幾段自己的 fail-closed 照舊(本檔的 mock 沒餵收款與品項 ⇒ 取消閘印三條理由、不出表單),
    //   這正是「復用、不重寫」要的 —— 閘在元件裡, 殼不知道也不該知道。表單有出來時 return_to 都要展開【這張】單。
    expect(dlg!.textContent).toContain('先不開放取消');
    for (const i of dlg!.querySelectorAll('form input[name="return_to"]')) {
      expect(new URLSearchParams((i as HTMLInputElement).value.split('?')[1] ?? '').get('open')).toBe(U);
    }
    // 整頁 / 展開才有的東西不在殼裡:返回連結、寄信紀錄卡。
    expect(dlg!.textContent).not.toContain('寄信紀錄');
  });
  // 走查 2026-09-14 第 6 條(主視窗裁):一毛沒收的單 ⇒ 取消區在上且展開、退款區收合;收過款 ⇒ 退款在上(原本)。
  it('🔴 未付款 + 收款列空 ⇒ 兩個 <details> 的順序是 取消 → 退款, 且取消那塊 open;已付款 ⇒ 退款 → 取消', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue({ ...DETAIL, paymentStatus: 'unpaid' });
    const unpaid = (await renderPage({ cancel: U })).container;
    const heads = [...unpaid.querySelectorAll('[data-testid="order-detail-section-money"] details > summary h2')].map((h) => h.textContent);
    expect(heads.indexOf('申請取消整張單')).toBeLessThan(heads.findIndex((t) => t?.startsWith('退款')));
    expect(unpaid.querySelector('details:has(#cancel)')?.hasAttribute('open')).toBe(true);
    cleanup();
    mocks.detail.mockResolvedValue(DETAIL);
    const paid = (await renderPage({ cancel: U })).container;
    const heads2 = [...paid.querySelectorAll('[data-testid="order-detail-section-money"] details > summary h2')].map((h) => h.textContent);
    expect(heads2.findIndex((t) => t?.startsWith('退款'))).toBeLessThan(heads2.indexOf('申請取消整張單'));
  });

  it('🔴 `?open=B&cancel=A` ⇒ 取消(closeHref)保留 open=B;做完的 return_to 展開 A', async () => {
    const B = '22222222-2222-4333-8444-555555555555';
    // B 不放進列表(不展開它, 本格只看 open 這顆參數怎麼被帶);cancel 指 U。
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ open: B, cancel: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(new URLSearchParams((dlg.getAttribute('data-close-href') ?? '').split('?')[1] ?? '').get('open'), '取消不該改變他在看哪張').toBe(B);
    expect(dlg.getAttribute('data-close-href')).not.toContain('cancel=');
  });
  it('cancel 不是 UUID ⇒ 不開;指到不存在的單 ⇒ 殼開著、裡面說找不到;讀取 throw ⇒ 殼開著、說載入失敗、零表單(不是整頁 404)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    const none = await renderPage({ cancel: 'not-a-uuid' });
    expect(none.container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    mocks.detail.mockResolvedValueOnce(null);
    const missing = await renderPage({ cancel: U });
    const dlg = missing.container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.textContent).toContain('找不到這張訂單');
    mocks.detail.mockRejectedValueOnce(new Error('db down'));
    const failed = await renderPage({ cancel: U });
    const dlg2 = failed.container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(dlg2, 'throw 時殼要在(整頁 404 會把列表一起帶走)').not.toBeNull();
    expect(dlg2.textContent).toContain('載入失敗');
    // 殼自己那張 `<form method="dialog">`(取消鈕)不算;要數的是會寫入的那種(帶 action 的)。
    expect(dlg2.querySelectorAll('form:not([method="dialog"])'), '讀失敗還出表單 ⇒ 對著一張讀不到的單送出').toHaveLength(0);
  });
  it('🔴🔴 codex must-fix ①:可部分取消的單 ⇒ 彈窗裡有品項勾選框, 而且關聯到【彈窗那張】表單(id 帶 dialog)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    const qs = { quantity: 2, orderedQuantity: 0, instockQuantity: 0, cancelledQuantity: 0, shippedQuantity: 0, cancellableQuantity: 2 };
    const items = [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', variantSku: 'A', title: '端子鏡', spec: null, quantity: 2, unitPrice: { amount: 1, currency: 'TWD' }, lineTotal: { amount: 2, currency: 'TWD' }, quantitySummary: qs, procurements: [], procurementTruncated: false },
      { id: 'bbbbbbbb-0000-4000-8000-000000000002', variantSku: 'B', title: '腳踏', spec: null, quantity: 2, unitPrice: { amount: 1, currency: 'TWD' }, lineTotal: { amount: 2, currency: 'TWD' }, quantitySummary: qs, procurements: [], procurementTruncated: false },
    ];
    // route 會用「撈到盡」那份取代 detail.items ⇒ 兩邊都給同一份。
    mocks.items.mockResolvedValue({ items: items as never[], reportedTotal: 2 });
    mocks.detail.mockResolvedValue({
      ...DETAIL,
      paymentStatus: 'unpaid', // 未收款 ⇒ 不用驗收款 rail ⇒ 取消閘全開
      chargeAttemptGate: 'clear',
      itemsTruncated: false,
      items,
    });
    const { container } = await renderPage({ cancel: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    const ctl = dlg.querySelector('[data-testid="partial-cancel-inline-controls"]');
    expect(ctl, '彈窗裡沒有品項控制項 ⇒ 送出鈕永遠停用(控制項住在商品卡, 而彈窗沒有商品卡)').not.toBeNull();
    const boxes = [...ctl!.querySelectorAll('input[type=checkbox]')];
    expect(boxes).toHaveLength(2);
    const qty = [...ctl!.querySelectorAll('input[inputmode="numeric"]')];
    expect(qty, 'maxCancellable 2 ⇒ 兩顆數量欄也要在彈窗裡').toHaveLength(2);
    const formId = boxes[0]!.getAttribute('form')!;
    const form = [...dlg.querySelectorAll('form')].find((f) => f.id === formId) ?? null;
    expect(form, 'checkbox 的 form= 指到一張不在彈窗裡的表單').not.toBeNull();
    expect(form!.id.endsWith('-dialog'), '沒帶 scope ⇒ ?open=A&cancel=A 時會撞背景那份').toBe(true);
    // 每一顆(checkbox + 數量欄)都指同一張, 不只第一顆(codex R2 nit)。
    for (const el of [...boxes, ...qty]) expect(el.getAttribute('form')).toBe(formId);
  });
  it('🔴🔴 codex must-fix ②:取消做完導回 `open=A&r=…&rt=…` 而 A 不在這一頁 ⇒ 結果面板照畫(不是消失)', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER); // U 不在列表
    mocks.detail.mockResolvedValue({ ...DETAIL, cancelledAt: '2026-09-13T00:00:00.000Z', cancellations: [], cancellationsTruncated: false });
    const { container } = await renderPage({ open: U, r: 'order_cancelled', rt: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f' });
    expect(container.querySelector('[data-testid="order-expanded"]'), 'U 不在列表 ⇒ 不展開(P-b 的規矩沒變)').toBeNull();
    // cancellations=[] + 有 rt ⇒ classifier 判 miss_complete ⇒ 這一句(不是「讀不到」那句 —— 漏傳 rt 才會變那句, codex R2 nit)。
    expect(container.textContent, '結果面板沒畫 ⇒ 員工不知道剛才那筆取消寫進去了沒').toContain('目前查不到這筆取消');
    expect(container.textContent).not.toContain('查不到取消紀錄(讀不到)');
  });
  it('🔴 路 4 走查(09-15):取消做完、那張單【就在這一頁】⇒ 結果面板畫在展開標題列裡, 整頁恰一份', async () => {
    mocks.list.mockResolvedValue({ ...ONE_ORDER, items: [{ ...ONE_ORDER.items[0], id: U }] });
    mocks.detail.mockResolvedValue({ ...DETAIL, cancelledAt: '2026-09-13T00:00:00.000Z', cancellations: [], cancellationsTruncated: false });
    const { container } = await renderPage({ open: U, r: 'order_cancelled', rt: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f' });
    const head = container.querySelector('[data-testid="order-inline-head"]');
    expect(head, 'U 在列表 ⇒ 要展開').not.toBeNull();
    expect(head!.textContent, '在列表裡取消 ⇒ 員工什麼都看不到').toContain('目前查不到這筆取消');
    expect((container.textContent ?? '').split('目前查不到這筆取消').length - 1, '頁尾那份只給「不在這一頁」').toBe(1);
  });
  it('🔴🔴 codex R2 must-fix:列表查詢拋錯 + 取消結果碼 ⇒ 面板【照畫】(它不能住在列表成功分支裡)', async () => {
    mocks.list.mockRejectedValueOnce(new Error('list down'));
    mocks.detail.mockResolvedValue({ ...DETAIL, cancelledAt: '2026-09-13T00:00:00.000Z' });
    const { container } = await renderPage({ open: U, r: 'order_cancelled', rt: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f' });
    expect(container.textContent).toContain('訂單列表載入失敗');
    expect(container.textContent, '列表紅了就把結果面板一起藏掉 ⇒ 錢動了畫面卻什麼都不說').toContain('目前查不到這筆取消');
  });
  it('其他取消結果碼(不只 order_cancelled)也開面板 —— 判準是 isCancelPanelResultCode, 不是單一字面', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ open: U, r: 'order_mark_rejected' });
    expect(container.textContent).toContain('這張單不能用這個方式結掉');
  });
  it('對照:open 不在列表、但 r 不是取消碼 ⇒ 不多畫任何取消結果面板', async () => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
    const { container } = await renderPage({ open: U, r: 'saved' });
    expect(container.textContent).not.toMatch(/取消紀錄|已經寫進去|查不到這筆取消/);
  });
});

// ── v22 展開標題列 ②:`?note=<id>` ⇒ 「備註與客人聯繫」彈窗(2026-09-13)──────────────
describe('展開標題列 ② — ?note= 開的是備註分頁那兩個元件 + 取消通知兩顆鈕', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const N = '33333333-3333-4333-8333-333333333333';
  const DETAIL = {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    paymentStatus: 'unpaid',
    paymentChannel: 'bank',
    fulfillmentStatus: 'notOrdered',
    cancelledAt: null,
    cancelledReason: null,
    cancellations: [],
    cancellationsTruncated: false,
    items: [],
    notes: [
      { id: N, body: '客人說先不要出貨', noteType: 'customer_contact', channel: 'line', occurredAt: '2026-09-10T06:20:00.000Z', createdAt: '2026-09-10T06:20:00.000Z', actor: 'staff', customerNotified: false, correctsNoteId: null, correctedByNoteId: null, deletedAt: null },
    ],
    notesTruncated: false,
    customerNotified: false,
    invoiceRequested: false,
    invoiceStatus: 'not_issued',
    total: { amount: 1100, currency: 'TWD' },
    balanceDue: 1100,
    customer: { name: '王小明', email: null, phone: null },
    customerUserId: null,
  };
  beforeEach(() => {
    mocks.items.mockResolvedValue({ items: [], reportedTotal: 0 });
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
  });
  it('🔴 note 指到一張單 ⇒ 殼在(標題「備註與客人聯繫」)+ 時間軸(既有那則)+ 新備註表單【攤開】+ return_to 展開這張', async () => {
    const { container } = await renderPage({ note: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('備註與客人聯繫');
    expect(dlg!.querySelector('[data-testid="order-detail-section-notes"]'), 'notes 那段沒接進殼').not.toBeNull();
    expect(dlg!.textContent, '既有備註沒進來 ⇒ 不是同一份時間軸').toContain('客人說先不要出貨');
    const compose = dlg!.querySelector('details#note-compose') as HTMLDetailsElement | null;
    expect(compose, '新備註表單不在').not.toBeNull();
    expect(compose!.open, '彈窗的目的就是寫備註, 表單卻收著').toBe(true);
    const outer = compose!.closest('details:not(#note-compose)') as HTMLDetailsElement | null;
    expect(outer?.open, '整張卡收著 ⇒ 要點兩次').toBe(true);
    const rts = [...dlg!.querySelectorAll('form input[name="return_to"]')].map((i) => (i as HTMLInputElement).value);
    expect(rts.length).toBeGreaterThan(0);
    for (const rt of rts) expect(new URLSearchParams(rt.split('?')[1] ?? '').get('open')).toBe(U);
    // 整頁 / 展開才有的東西不在殼裡。
    expect(dlg!.textContent).not.toContain('寄信紀錄');
    expect(dlg!.textContent).not.toContain('商品明細');
  });
  it('🔴 `?note=A&correct=<noteId>` ⇒ 彈窗裡直接是更正模式(同一支 resolveCorrectTarget)', async () => {
    const { container } = await renderPage({ note: U, correct: N });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(dlg.textContent).toContain('更正備註');
    expect(dlg.querySelector('form input[name="corrects_note_id"], form input[value="' + N + '"]'), '更正目標沒帶進表單').not.toBeNull();
  });
  it('🔴 `?open=B&note=A` ⇒ 取消(closeHref)保留 open=B、不帶 note;非 UUID ⇒ 不開;查無 ⇒ 殼開著說找不到', async () => {
    const B = '22222222-2222-4333-8444-555555555555';
    const a = await renderPage({ open: B, note: U });
    const dlg = a.container.querySelector('[data-testid="next-step-dialog"]')!;
    const close = dlg.getAttribute('data-close-href') ?? '';
    expect(new URLSearchParams(close.split('?')[1] ?? '').get('open')).toBe(B);
    expect(close).not.toContain('note=');
    const none = await renderPage({ note: 'nope' });
    expect(none.container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    mocks.detail.mockResolvedValueOnce(null);
    const missing = await renderPage({ note: U });
    expect(missing.container.querySelector('[data-testid="next-step-dialog"]')!.textContent).toContain('找不到這張訂單');
  });
});

// ── v22 展開標題列 ③:`?edit=<id>` ⇒ 「編輯個資」彈窗(2026-09-13)──────────────
describe('展開標題列 ③ — ?edit= 開的是明細頁那張改單表單 + 發票小抄入口', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const DETAIL = {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    paymentStatus: 'unpaid',
    paymentChannel: 'bank',
    fulfillmentStatus: 'notOrdered',
    shippingMethod: 'home',
    cancelledAt: null,
    cancelledReason: null,
    cancellations: [],
    cancellationsTruncated: false,
    items: [],
    notes: [],
    notesTruncated: false,
    customerNotified: false,
    invoiceRequested: true,
    invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: null, donateCode: null },
    invoiceStatus: 'not_issued',
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceIssuedAt: null,
    total: { amount: 1100, currency: 'TWD' },
    balanceDue: 1100,
    customer: { name: '王小明', email: null, phone: null },
    customerUserId: null,
  };
  beforeEach(() => {
    mocks.items.mockResolvedValue({ items: [], reportedTotal: 0 });
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
  });
  it('🔴 edit 指到一張單 ⇒ 殼在(標題「編輯個資」)+ 改單表單(出貨方式 / 開立狀態 / 發票號碼 / 開立日期 / 發票金額, 同一支 action)+ 小抄入口', async () => {
    const { container } = await renderPage({ edit: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('編輯個資');
    expect(dlg!.querySelector('[data-testid="order-detail-section-customer"]')).not.toBeNull();
    const names = [...dlg!.querySelectorAll('form select, form input')].map((e) => e.getAttribute('name'));
    for (const n of ['shipping_method', 'invoice_status', 'invoice_number', 'invoice_issued_at', 'invoice_amount', 'version', 'return_to']) {
      expect(names, `少了 ${n} 這格 ⇒ 不是明細頁那張表單`).toContain(n);
    }
    const rt = dlg!.querySelector('form input[name="return_to"]') as HTMLInputElement;
    expect(new URLSearchParams(rt.value.split('?')[1] ?? '').get('open')).toBe(U);
    const link = dlg!.querySelector('[data-testid="open-invoice-cheatsheet"]');
    expect(link, '抬頭 / 統編的入口(發票小抄)沒畫').not.toBeNull();
    expect(new URLSearchParams(link!.getAttribute('href')!.split('?')[1] ?? '').get('invoice')).toBe(U);
    // 系統沒有寫入路的欄位不畫(收件人 / 電話 / 地址 / 載具)—— 稿有、系統沒有, 畫了就是一顆按了沒事的鈕。
    for (const n of ['recipient', 'phone', 'address', 'carrier']) expect(names).not.toContain(n);
  });
  it('不開發票的單 ⇒ 沒有小抄入口;非 UUID ⇒ 不開;closeHref 保留 open、不帶 edit', async () => {
    mocks.detail.mockResolvedValue({ ...DETAIL, invoiceRequested: false });
    const a = await renderPage({ open: '22222222-2222-4333-8444-555555555555', edit: U });
    const dlg = a.container.querySelector('[data-testid="next-step-dialog"]')!;
    expect(dlg.querySelector('[data-testid="open-invoice-cheatsheet"]')).toBeNull();
    const close = dlg.getAttribute('data-close-href') ?? '';
    expect(new URLSearchParams(close.split('?')[1] ?? '').get('open')).toBe('22222222-2222-4333-8444-555555555555');
    expect(close).not.toContain('edit=');
    const none = await renderPage({ edit: 'nope' });
    expect(none.container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
  });
});

// ── v22 展開標題列 ④:`?more=<id>` ⇒ 「更多」彈窗(2026-09-13)──────────────
describe('展開標題列 ④ — ?more= 列印兩顆 · 改品項金額 · 通知信', () => {
  const U = '11111111-2222-4333-8444-555555555555';
  const item = (id: string, sku: string) => ({ id, variantSku: sku, brand: 'Rizoma', title: '端子鏡', spec: null, quantity: 1, unitPrice: { amount: 6000, currency: 'TWD' }, lineTotal: { amount: 6000, currency: 'TWD' }, quantitySummary: null, procurements: [], procurementTruncated: false });
  const DETAIL = {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    paymentStatus: 'unpaid',
    paymentChannel: 'bank',
    fulfillmentStatus: 'notOrdered',
    cancelledAt: null,
    cancelledReason: null,
    cancellations: [],
    cancellationsTruncated: false,
    items: [item('aaaaaaaa-0000-4000-8000-000000000001', 'BS299B'), item('bbbbbbbb-0000-4000-8000-000000000002', 'BS818B')],
    itemsTruncated: false,
    notes: [],
    notesTruncated: false,
    customerNotified: false,
    invoiceRequested: false,
    invoiceStatus: 'not_issued',
    subtotal: { amount: 12000, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    taxTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 12000, currency: 'TWD' },
    balanceDue: 12000,
    customer: { name: '王小明', email: null, phone: null },
    customerUserId: null,
  };
  beforeEach(() => {
    mocks.items.mockResolvedValue({ items: DETAIL.items as never[], reportedTotal: 2 });
    mocks.list.mockResolvedValue(ONE_ORDER);
    mocks.detail.mockResolvedValue(DETAIL);
  });
  it('🔴 more 指到一張單 ⇒ 殼在(標題「更多」)+ 訂單明細列印連結 + 出貨明細單【沒箱 ⇒ disabled + 理由】+ 每樣一列改單價表單(同一支 action)+ 通知信卡', async () => {
    // M-4b-01 P1:改單價表單只有管理者看得到 ⇒ 這一格以管理者身分渲染(非管理者那一格在下面)。
    bossState.actor = { id: 'sean', label: 'Sean' };
    bossState.manager = true;
    const { container } = await renderPage({ more: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg, '殼沒渲染').not.toBeNull();
    expect(dlg!.querySelector('#next-step-title')!.textContent).toBe('更多');
    expect(dlg!.querySelector('[data-testid="order-detail-section-more"]')).not.toBeNull();
    const picking = [...dlg!.querySelectorAll('a')].find((a) => a.textContent === '訂單明細');
    expect(picking?.getAttribute('href')).toBe(`/print/orders/${U}/picking`);
    expect(picking?.getAttribute('target')).toBe('_blank');
    const shipBtn = dlg!.querySelector('[data-testid="print-shipping-disabled"]') as HTMLButtonElement | null;
    expect(shipBtn, '沒箱要 disabled 的那顆不在').not.toBeNull();
    expect(shipBtn!.disabled).toBe(true);
    // 本檔沒 mock 出貨 loader(讀失敗 ⇒ null ⇒「讀不到」);三態各自的字面在 order-more-section.test 釘。
    expect(shipBtn!.title).toMatch(/建箱|讀不到/);
    const rows = dlg!.querySelectorAll('tr[data-more-item]');
    expect(rows).toHaveLength(2);
    const forms = [...dlg!.querySelectorAll('tr[data-more-item] form')];
    expect(forms, '每樣一張改單價表單(明細頁那支)').toHaveLength(2);
    const ids = forms.map((f) => (f.querySelector('input[name="order_item_id"]') as HTMLInputElement | null)?.value);
    expect(ids).toEqual(['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002']);
    for (const f of forms) {
      const rt = f.querySelector('input[name="return_to"]') as HTMLInputElement;
      expect(new URLSearchParams(rt.value.split('?')[1] ?? '').get('open')).toBe(U);
      expect((f.querySelector('input[name="version"]') as HTMLInputElement).value).toBe('3');
    }
    expect(dlg!.textContent).toContain('通知信');
    // 稿有「重寄」鈕, 系統沒有那條路 ⇒ 不畫。
    expect(dlg!.textContent).not.toContain('重寄');
    bossState.actor = null;
    bossState.manager = false;
  });
  it('🆕 M-4b-01 P1 + M-4b-03 B:非管理者 ⇒ 改單價表單一張都不掛、改掛申請表單(每樣一張, 冪等 id 是 UUID)', async () => {
    bossState.actor = { id: 'staff-1', label: '員工' };
    bossState.manager = false;
    const { container } = await renderPage({ more: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg!.querySelectorAll('tr[data-more-item] form')).toHaveLength(0);
    expect(dlg!.querySelector('[data-testid="amount-request-mode"]')?.textContent).toContain('只有管理者能做');
    const forms = [...dlg!.querySelectorAll('[data-testid="item-amount-request-form"]')];
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect((f.querySelector('input[name="amount_request_id"]') as HTMLInputElement).value).toMatch(/^[0-9a-f-]{36}$/);
    }
    // 探針 / 測試裡表讀不到 ⇒ 紅字「讀不到」, 不當「沒有申請」。
    expect(dlg!.querySelector('[data-testid="amount-requests-read-failed"]')).not.toBeNull();
    bossState.actor = null;
  });
  it('已取消的單 ⇒ 訂單明細那顆 disabled;有折扣的單 ⇒ 改金額整表一句理由、零表單(同一支 resolveAmountEditBlock)', async () => {
    mocks.detail.mockResolvedValue({ ...DETAIL, cancelledAt: '2026-09-13T00:00:00.000Z', cancelledReason: 'customer', discountTotal: { amount: 100, currency: 'TWD' } });
    const { container } = await renderPage({ more: U });
    const dlg = container.querySelector('[data-testid="next-step-dialog"]')!;
    const picking = [...dlg.querySelectorAll('button')].find((b) => b.textContent === '訂單明細') as HTMLButtonElement | undefined;
    expect(picking?.disabled).toBe(true);
    expect(dlg.querySelector('[data-testid="amount-edit-blocked"]')).not.toBeNull();
    expect(dlg.querySelectorAll('tr[data-more-item] form')).toHaveLength(0);
  });
  it('非 UUID ⇒ 不開;closeHref 保留 open、不帶 more', async () => {
    const none = await renderPage({ more: 'nope' });
    expect(none.container.querySelector('[data-testid="next-step-dialog"]')).toBeNull();
    const B = '22222222-2222-4333-8444-555555555555';
    const a = await renderPage({ open: B, more: U });
    const close = a.container.querySelector('[data-testid="next-step-dialog"]')!.getAttribute('data-close-href') ?? '';
    expect(new URLSearchParams(close.split('?')[1] ?? '').get('open')).toBe(B);
    expect(close).not.toContain('more=');
  });
});

// ── A1(2026-09-14):「老闆:成本」的 server 閘 ─────────────────────────────
// plan §1-d 逐字:「非管理者:忽略參數、不渲染勾、不發第二發查詢(fail-closed)」。
// 🔴 這一組守的是【頁層】:`orders-table.tsx` 只認 `costCells !== null`, 誰能給它是這裡決定的。
describe('A1 — ?boss=1 只有 manager 算數(非管理者:參數忽略、勾不出現、成本查詢不發)', () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue(ONE_ORDER);
    bossState.manager = false;
    bossState.actor = null;
    bossState.source = 'ticket';
    bossState.costs.mockReset();
    bossState.costs.mockResolvedValue(new Map());
  });
  afterEach(() => {
    bossState.manager = false;
    bossState.actor = null;
  });
  const toggle = (c: HTMLElement) => c.querySelector<HTMLAnchorElement>("[data-testid='order-boss-toggle']");
  const headers = (c: HTMLElement) => [...c.querySelectorAll('thead th')].map((th) => th.textContent);

  it('🔴 非管理者帶 `?boss=1` ⇒ 沒有勾、表頭照舊(狀態 / 下一步在, 利潤不在)、成本查詢零發、連結不帶 boss', async () => {
    bossState.actor = { id: 'staff-1', label: '員工' };
    bossState.manager = false;
    const { container } = await renderPage({ boss: '1' });
    expect(toggle(container)).toBeNull();
    expect(headers(container)).toContain('狀態');
    expect(headers(container)).not.toContain('利潤TWD');
    expect(container.querySelectorAll('.boss-cell').length).toBe(0);
    expect(bossState.costs).not.toHaveBeenCalled();
    // 參數被忽略 = 列表產的每一條連結都不再帶 boss(翻頁 / 篩選 / 展開)
    const hrefs = [...container.querySelectorAll('a[href^="/orders"]')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((h) => h.includes('boss=')), '非管理者的連結不得回聲 boss').toEqual([]);
  });

  it('🔴 沒登入(actor null)⇒ 與非管理者同款(fail-closed)', async () => {
    bossState.actor = null;
    bossState.manager = true; // 就算查核函式本身會答 true, 沒 id 也進不去
    const { container } = await renderPage({ boss: '1' });
    expect(toggle(container)).toBeNull();
    expect(bossState.costs).not.toHaveBeenCalled();
  });

  it('🔴 身分來自自選 cookie(source=self-selected)⇒ 就算那個 id 是 manager 也當非管理者(codex R1 MF1)', async () => {
    bossState.actor = { id: 'boss-1', label: '老闆' };
    bossState.manager = true;
    bossState.source = 'self-selected';
    const { container } = await renderPage({ boss: '1' });
    expect(toggle(container)).toBeNull();
    expect(container.querySelectorAll('.boss-cell').length).toBe(0);
    expect(bossState.costs).not.toHaveBeenCalled();
    // stale-ticket / none 同款
    for (const src of ['stale-ticket', 'none'] as const) {
      cleanup();
      bossState.source = src;
      const r = await renderPage({ boss: '1' });
      expect(toggle(r.container), src).toBeNull();
    }
  });

  it('🔴 manager 沒開 ⇒ 勾在(未勾)、連結指向 boss=1、成本查詢零發、表頭照舊', async () => {
    bossState.actor = { id: 'boss-1', label: '老闆' };
    bossState.manager = true;
    const { container } = await renderPage({ payment_status: 'paid' });
    const t = toggle(container)!;
    expect(t).not.toBeNull();
    expect(t.getAttribute('aria-checked')).toBe('false');
    expect(t.getAttribute('href')).toContain('boss=1');
    expect(t.getAttribute('href'), '翻轉時其餘篩選要原樣帶著').toContain('payment_status=paid');
    expect(bossState.costs).not.toHaveBeenCalled();
    expect(headers(container)).toContain('狀態');
  });

  it('🔴 manager + `?boss=1` ⇒ 勾已勾、連結不帶 boss(= 關掉)、成本查詢發一次且吃的是列表那份 orders、表頭換成六欄', async () => {
    bossState.actor = { id: 'boss-1', label: '老闆' };
    bossState.manager = true;
    const { container } = await renderPage({ boss: '1', payment_status: 'paid' });
    const t = toggle(container)!;
    expect(t.getAttribute('aria-checked')).toBe('true');
    expect(t.getAttribute('href')).not.toContain('boss=');
    expect(t.getAttribute('href')).toContain('payment_status=paid');
    expect(bossState.costs).toHaveBeenCalledTimes(1);
    expect(bossState.costs.mock.calls[0]?.[0]).toBe(ONE_ORDER.items);
    const h = headers(container);
    expect(h).toContain('利潤TWD');
    for (const hidden of ['來源', '收款', '狀態', '下一步']) expect(h).not.toContain(hidden);
    // 翻頁 / 篩選連結帶著 boss=1 走(顯示軸進 carried values)
    const hrefs = [...container.querySelectorAll('a[href^="/orders?"]')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((x) => x.includes('boss=1'))).toBe(true);
  });

  it('🔴 成本第二發炸了 ⇒ 六格印「讀取失敗」、列表本體照常(不 500)', async () => {
    bossState.actor = { id: 'boss-1', label: '老闆' };
    bossState.manager = true;
    bossState.costs.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = await renderPage({ boss: '1' });
    spy.mockRestore();
    expect(container.textContent).toContain('YWP3PC');
    expect([...container.querySelectorAll('td.boss-cell')].map((td) => td.textContent?.trim())).toEqual(
      Array<string>(6).fill('讀取失敗'),
    );
  });
});
