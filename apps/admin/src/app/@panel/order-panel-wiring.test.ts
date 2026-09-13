// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderFilter } from '@pcm/domain';
import {
  buildOrderListHref,
  ORDER_PANEL_PARAM,
  ORDER_OPEN_PARAM,
  ORDER_DENSITY_DEFAULT,
  PANEL_CLOSED,
} from '../../lib/orders/order-list-view';

// order-panel-wiring.test.ts — #350c 訂單面板接線的守門 ⇒ ⛔ 2026-09-13 拆面板後, 守的是**接替它的那條路**:
//    列表就地展開(`?open=`)。槽頁 `@panel/orders/page.tsx`、客人卡、手動建單面板一起刪了;
//    守門 2 內層(buildPanelCloseHref / SelfHref)、4(槽頁開關)、3b(客人卡)整組跟著走 —— 它們守的
//    函式 / 檔案不存在了。守門 8 / 9 改成對 `open=` 那條路問同一個問題(`r` 歸誰、return_to 是誰)。
//    多一格:舊書籤 `?panel=<uuid>` 必須導到 `?open=<uuid>`(主視窗硬線:不是 404)。
//
// 🔴 本檔存在的理由:這一片的壞法**全都沒有執行期訊號**。面板不出現、面板黏著不放、
//    退款吃到平台預設時限 —— 沒有一個會丟錯,只會安靜地做錯事。
// 🔴 每一格都附「弱化它會怎麼樣」,並且都經過突變實測(把守的那個東西改壞 ⇒ 必須紅)。

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

// 守門 4 / 7 會**真的載入並執行**槽頁與列表頁;以下是它們 import 圖上的東西
// (vitest 沒有 server/client 之分,會天真地走完整張圖)。
// 🔴 `notFound` 直接丟錯 = 一旦槽裡真的呼叫它,測試會紅而不是靜默通過
//    (在平行路由槽裡呼叫 `notFound()` 炸掉的是**整個頁面**,不是只清空右槽)。
const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listOrderSummariesForAdmin: vi.fn(),
  listSuppliers: vi.fn(),
  listOrderRefunds: vi.fn(),
  // 🔴 #445a-3:刪短路之後**每次 render 都會呼叫它**(以前零帳本列時不呼叫)。
  //    裸 `vi.fn()` 回 `undefined`,而契約型別是 `number | null` ⇒ 今天本檔 rows 皆 `[]` 所以無害,
  //    但下一個人加一列 fixture 就會撞 `formatOrderAmount(undefined)`。
  //    ⇒ 給一個型別內的預設值,不留這顆地雷。(code-reviewer nit)
  getLedgerUnregisteredAmount: vi.fn(async () => null),
  // #15-B2-c 片1a:收款明細 —— 兩個消費者都要拿得到(守門在檔尾)。
  // 🔴 **預設值寫在 hoisted 這裡、不寫在某個 describe 的 `beforeEach`**:本檔有多個 describe
  //    各自帶 `beforeEach`,寫進其中一個的話,其他 describe 的替身會回 `undefined`
  //    ⇒ 折出 `{status:'ok', rows: undefined}` ⇒ 收款區塊渲染當場炸掉(而症狀會出現在
  //    與收款無關的那些格上,查起來完全不像本片造成的)。
  listOrderPayments: vi.fn(async () => [] as unknown[]),
  // OD 片 3b:客人卡的五路取數。**要有 spy 而不只是 mock 掉** —— 「沒帶 customer 時零查詢」
  // 這句話要有 `not.toHaveBeenCalled()` 才算被守住(同上面 repository 那條 codex 教訓)。
  findCustomerById: vi.fn(),
  listWalletEntries: vi.fn(),
  listSummariesByCustomer: vi.fn(),
  listAddressesByCustomer: vi.fn(),
  listVehiclesByCustomer: vi.fn(),
}));

vi.mock('server-only', () => ({}));
// #347-2b:`app/orders/page.tsx` 自此會讀 `cookies()`(關鍵字搜尋詞的載體)。
// 守門 7 會渲染那一頁 ⇒ 沒有這個替身會擲「cookies was called outside a request scope」。
// 回空 store = 「沒有在搜尋」,守門 7 要驗的是 panel href,與搜尋無關。
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
}));
class RedirectSentinel extends Error {
  constructor(public readonly href: string) {
    super(`redirect ${href}`);
  }
}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound 不該在槽裡被呼叫');
  },
  // 🔴 真的 `redirect()` 會 throw(Next 用 throw 中斷渲染);這裡也 throw, 讓測試接得到它導去哪。
  redirect: (href: string) => {
    throw new RedirectSentinel(href);
  },
  // 守門 7 會渲染整個列表頁,裡面的 client island(勾選列 / 篩選列)用得到這幾支。
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));
// 🔴 **repository 要有 spy,不能只 mock 掉**:codex 關卡2(2026-08-10)指出,只斷言「回 null」
//    證不了註解宣稱的「非 UUID **不打 DB**」—— 那句話要有 `not.toHaveBeenCalled()` 才算被守住。
vi.mock('../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    // 🔴 `D2` C 條(2026-08-18):明細頁改走頂層分頁撈到盡 ⇒ route 會多呼叫這一支。
    //    從上一次 `findAdminOrderDetail` 回的那份導出,讓本檔既有各格繼續量它們本來在量的東西
    //    (面板 / return_to / 客人入口…)。
    //    🔴 **本檔對「品項撈不撈得全」零判別力** —— 那一面由
    //    `lib/orders/merge-detail-items.test.ts` 守(它真的餵 201 項)。
    //    ⚠️ 用 `mock.results` 不再呼叫一次:再呼叫會消耗 `mockResolvedValueOnce` 鏈。
    listOrderItemsForDetail: async () => {
      const d = await mocks.findAdminOrderDetail.mock.results.at(-1)?.value;
      const items = d?.items ?? [];
      return {
        items,
        reportedTotal: d?.itemsTruncated === true ? items.length + 1 : items.length,
      };
    },
    listOrderSummariesForAdmin: mocks.listOrderSummariesForAdmin,
    // OD 片 3b:客人卡的訂單歷史走同一個 repository。
    listSummariesByCustomer: mocks.listSummariesByCustomer,
  }),
}));
vi.mock('../../lib/supplier', () => ({ listSuppliers: mocks.listSuppliers }));
// OD 片 3b:客人卡走 `loadCustomerDetail` → 這四支 getter(訂單那支在上面的 order-repository)。
vi.mock('../../lib/customers/customer-repository', () => ({
  getAdminCustomerRepository: () => ({ findById: mocks.findCustomerById }),
  getAdminWalletRepository: () => ({ listEntries: mocks.listWalletEntries }),
  getAdminAddressRepository: () => ({ listByCustomer: mocks.listAddressesByCustomer }),
  getAdminVehicleRepository: () => ({ listByCustomer: mocks.listVehiclesByCustomer }),
}));
// 🔴 #15-B2-c 片1a:`payment-repository` → `createSupabaseServiceClient`(server-only)。
//    ⚠️ **不 mock 也不會紅** —— 它會在呼叫時 throw、被 `allSettled` 接住折成 `unreadable`
//    ⇒ 整個檔案靜默走在「讀不到」那條路上。要驗「面板真的拿得到收款列」就必須給它可控的替身。
vi.mock('../../lib/orders/payment-repository', () => ({
  listOrderPayments: mocks.listOrderPayments,
}));
// 🔴 `<ShipmentSection>` 是 **async server component**,而 RTL 是**同步**渲染
//    ⇒ 不 mock 的話整個 `OrderDetail` 渲染出來是**空字串、而且不報錯**
//    (`cancel-wiring.test.tsx:67-75` 逐字記過同一個坑:那次讓「期望 0 個表單」整組恆綠)。
//    ⇒ 守門 8/9 的每一格都配正向對照(數得到 1 條橫幅 / 至少一個 return_to),
//      否則「0 條」與「畫面根本沒畫出來」在斷言上分不出來。
// ⚠️ **代價寫清楚**:出貨區塊裡若日後長出自己的 `return_to`,守門 9 看不到它。
vi.mock('../../components/orders/shipment-section', () => ({ ShipmentSection: () => null }));

/**
 * #350d 守門 8/9 用的最小明細 —— 只要**畫得出來**就夠(要量的是橫幅條數與 `return_to` 值)。
 * 🔴 不能用 `null`:`OrderDetailRoute` 對查無會在畫橫幅**之前**就 return 掉
 *    ⇒ 那樣「面板 0 條」會是恆真,量不到 C2 有沒有翻過來。
 */
function orderDetailFixture(id: string, over: Record<string, unknown> = {}): AdminOrderDetail {
  const money = { amount: 0, currency: 'TWD' };
  return {
    id,
    displayId: 'PCM-0001',
    createdAt: '2026-08-10T00:00:00.000Z',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    paymentMethod: null,
    paidAt: null,
    subtotal: money,
    shippingFee: money,
    discountTotal: money,
    taxTotal: { amount: 0, currency: 'TWD' as const },
    total: money,
    shippingMethod: 'home',
    shippingAddress: { name: null, phone: null, line: null },
    // OD 片 2 起 `AdminOrderDetail` 有這一欄;fixture 預設 null = 「投影退版讀不到」,
    // 想測入口的格自己用 `over` 蓋成真 id。
    customerUserId: null,
    customer: { name: null, email: null, phone: null },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    cancelledReason: null,
    chargeAttemptGate: 'clear',
    version: 1,
    items: [],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
    cancellations: [],
    cancellationsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}
vi.mock('../../lib/payment/refund-read', () => ({
  listOrderRefunds: mocks.listOrderRefunds,
  getLedgerUnregisteredAmount: mocks.getLedgerUnregisteredAmount,
}));

// ── 1. 三處 maxDuration:錢的那條 ──────────────────────────────────────────────
/**
 * L3 片4:`buildOrderListHref` 的顯示設定參數是**必填**(主視窗 E-424 裁)。
 * 🔴 本檔多數格子與密度無關 ⇒ 統一給預設值,讓那些格子的斷言維持原意;
 *    密度本身的三條守門在下方自己的 describe 裡,**不靠這個常數**。
 */
const DEN = { density: ORDER_DENSITY_DEFAULT } as const;

describe('#350c 守門 1:退款 action 的 segment 時限兩處同值', () => {
  // 🔴 面板改成 searchParams 驅動之後,退款表單是在 `/orders?panel=<id>` 送出的
  //    ⇒ 吃的是 `/orders` 的時限,不再只有 `/orders/[id]`。三處任一漏掉 = 那條路徑
  //    退回平台預設,而 adapter 有 30s 硬逾時 ⇒ 砍在 fetch 中途 = 錢可能已動、帳本停在 processing。
  // ⚠️ **這條守門擋不住什麼**(codex 關卡2 2026-08-10 nit):`FILES` 是**寫死的清單** ——
  //    今天實查全樹只有 `order-detail.tsx` 一處渲染 `RefundSection`,而它只被這三條 URL 消費;
  //    但**未來多出第四個消費者時,本檔不會自己發現**,它只會安靜地繼續綠。
  //    真正的自動偵測要去讀 build 的 server-action manifest,本片沒做。
  //    ⛔ 2026-09-13 拆面板:第三條 `app/@panel/orders/page.tsx` 連檔一起刪了 ⇒ 兩處。
  const FILES = ['app/orders/[id]/page.tsx', 'app/orders/page.tsx'] as const;

  it.each(FILES)('%s 宣告 maxDuration = 60', (rel) => {
    // 🔴 `^…` + `m` 旗標是承重的(codex 關卡2 2026-08-10 擊破第一版):沒有錨定的話,
    //    把宣告**整行註解掉**(`// export const maxDuration = 60;`)這條斷言照樣綠 ——
    //    而那正是「退款退回平台預設時限」的樣子。
    const match = read(rel).match(/^export const maxDuration = (\d+)/m);
    // 🔴 抽不到 = 守門瞎了 = 必須紅(不能讓 `?? ''` 之類的收尾把它變成恆真;
    //    350b 那片就是在這個形狀上翻過車,見 `D-396-STOP` §⑤-1)。
    expect(match, `${rel} 找不到 maxDuration 宣告`).not.toBeNull();
    expect(Number(match![1])).toBe(60);
  });

  // 🔴 這裡**刻意沒有**「三處是同一個數字」那一格:上面的 `it.each` 已經各自斷言 `=== 60`,
  //    ⇒「集合大小 = 1」被嚴格蘊含、恆真、零獨立判別力(code-reviewer 2026-08-10 指出)。
  //    寫不出只紅它一格的突變 = 那條守門是裝飾品(memory `feedback_unconstructible-negative-test-means-noop-guard`)。
});

// ── 2. 面板連結不得吃掉列表狀態 ────────────────────────────────────────────────
describe('#350c 守門 2:panel 連結帶著篩選與頁碼一起走', () => {
  // 🔴 `order-list-view.ts` 的 href builder 已經為同一個坑寫過兩次警告:漏帶任一軸
  //    = 翻頁/回跳時該軸被靜默丟掉、列表 fail-open 變成全部訂單。
  //    面板連結是這個坑的第三次機會 —— 員工點開一張單就把篩選洗掉。
  // ⚠️ #347-B:原本這份 fixture 還帶 `orderNumber: 'PCM-123'`(當時最能代表「漏帶就出事」
  //    的那一軸)。兩個專用搜尋軸隨 Q-347-B1=B 退場 ⇒ 改讓 `paymentChannels` 帶值,
  //    **保持「單值軸 + 多值軸 + 布林開關」三種形狀都在** —— fixture 退化成只剩單值軸,
  //    「多值軸被漏帶」那個突變就構造不出來了(空陣列的多值軸是恆真格)。
  const filter: AdminOrderFilter = {
    paymentStatus: 'paid',
    goodsAxes: undefined,
    orderSources: ['web'],
    paymentChannels: ['tappay'],
    includeUnpaidCardOrders: true,
  };

  it('同時帶 篩選 + page + panel', () => {
    const href = buildOrderListHref(filter, DEN, 3, 'ord-1');
    const qs = new URLSearchParams(href.split('?')[1] ?? '');
    expect(href.startsWith('/orders?')).toBe(true);
    // 突變:builder 少列任何一個 entry ⇒ 下面對應那條紅。
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.getAll('order_source')).toEqual(['web']);
    expect(qs.getAll('payment_channel')).toEqual(['tappay']);
    expect(qs.get('show_unpaid_card')).toBe('1');
    expect(qs.get('page')).toBe('3');
    // 🏁 **P-b(2026-09-13):`panel` → `open`。這一格守的東西沒變(帶著單走、篩選與頁碼一起),**
    //    變的只是那張單搭哪個參數走 —— 面板退場,同一個目標改寫成就地展開。
    expect(qs.get(ORDER_OPEN_PARAM)).toBe('ord-1');
    expect(qs.get(ORDER_PANEL_PARAM), '列表又寫 panel 了 ⇒ 右側面板會回來、表格縮一半').toBeNull();
  });

  it('給 PANEL_CLOSED = 關閉面板(其餘狀態原封不動)', () => {
    const open = new URLSearchParams(buildOrderListHref(filter, DEN, 3, 'ord-1').split('?')[1]);
    // 🔴 `#742`:原本這一行寫的是「不給第 4 參數」,而那正是病灶 ——
    //    省略與刻意在型別上長得一樣。現在刻意要寫得出來:`PANEL_CLOSED`。
    const closed = new URLSearchParams(
      buildOrderListHref(filter, DEN, 3, PANEL_CLOSED).split('?')[1],
    );
    // 🏁 P-b:目標參數改成 `open`(見上一格)。`panel` 兩邊都不該有。
    expect(closed.has(ORDER_OPEN_PARAM)).toBe(false);
    expect(closed.has(ORDER_PANEL_PARAM)).toBe(false);
    open.delete(ORDER_OPEN_PARAM);
    // 關閉前後除了 open 以外**逐字相同** —— 這條才擋得住「關閉時順手弄丟篩選」。
    expect(closed.toString()).toBe(open.toString());
  });
});
// ── 3. 桌機改、手機不改(主視窗裁③ / Q5)────────────────────────────────────────
describe('#350c 守門 3:只有桌機走面板,手機仍是整頁', () => {
  const table = read('components/orders/orders-table.tsx');

  it('桌機單號連結走注入的 buildPanelHref', () => {
    expect(table).toContain('href={buildPanelHref(order.id)}');
  });

  it('手機卡片仍是字面 /orders/${order.id}(突變:改成 panel href ⇒ 紅)', () => {
    // 這裡要比對的就是原始碼裡的字面樣板字串  ⟵ 原為 eslint-disable(那條規則本 repo 沒在跑)⇒ 指令拆掉、理由留著
    expect(table).toContain('href={`/orders/${order.id}`}');
  });

  // 🔴 這裡**刻意沒有**「orders-table 不得自己拼 panel 連結」那一格:
  //    我寫過一版 `expect(table).not.toContain('panel=')`,它當場紅 —— 紅在**我自己的註解**上。
  //    那條斷言量的是「整份原始碼的字元」,不是「程式碼做了什麼」,任何人寫下 `panel=` 三個字
  //    就會誤報。真正的不變量已經被上面那格(桌機 href 走注入的 builder)釘住了。
});


// ── 3b. A13b D6-a:就地展開那條路也要吃取消結果碼(原本釘槽頁;2026-09-13 起釘 `orders/page.tsx`)──
describe('A13b D6-a 守門:就地展開版的取消結果頁閘門不得常開', () => {
  it('🔴 列表頁必須把 `r`/`rt` 原封傳給 OrderDetailRoute', () => {
    const src = read('app/orders/page.tsx');
    expect(src).toContain('resultCode: rawSearchParams.r,');
    expect(src).toContain('requestToken: rawSearchParams[CANCEL_REQUEST_TOKEN_PARAM],');
  });
  it('🔴 吃的是完整的 `r`,不是「為了關 banner 而不傳 r」', () => {
    const src = read('app/orders/page.tsx');
    expect(src).not.toContain('resultCode: undefined');
  });
});

// ── 7. 列表頁 → builder → 桌機連結,中間那一跳 ────────────────────────────────
describe('#350c 守門 7:列表頁真的把「帶篩選的 panel href」餵給表格', () => {
  // 🔴 codex 關卡2(2026-08-10)擊破:builder 與 `orders-table` 各自有守門,但**中間那一跳沒有**
  //    ⇒ 把 `buildPanelHref={() => '/orders'}` 寫死照樣 typecheck 過、守門全綠,而面板永遠打不開。
  //    (memory `feedback_assertion-measures-the-wrong-thing` 第四形狀:兩端有測試、中間透傳無人守。)
  const ORDER_ID = '99999999-8888-4777-8666-555555555555';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOrderSummariesForAdmin.mockResolvedValue({
      items: [
        {
          id: ORDER_ID,
          displayId: 'PCM-0001',
          customerUserId: null,
          customerName: null,
          createdAt: '2026-08-10T00:00:00.000Z',
          paymentStatus: 'paid',
          // `notOrdered` 不是 `'pending'`:後者不在 `FulfillmentStatus` 四值裡,
          // 靠 mock 的鬆型別才過得去(既存問題,順手修)。
          fulfillmentStatus: 'notOrdered',
          orderSource: 'web',
          paymentChannel: 'tappay',
          cancelledAt: null,
          total: { amount: 1000, currency: 'TWD' },
          // 🔵 稅欄(Sean 2026-09-05 第 6 題)—— 這一族 fixture 走 `as unknown as`,
          //    型別看不到缺欄, 而執行期會 `Cannot read properties of undefined`。
          taxTotal: { amount: 0, currency: 'TWD' as const },
          lines: [],
          invoiceStatus: null,
          tierAtCheckout: null,
          // 🔴 2026-08-27 補上:同檔 :140 那個 fixture 有這一欄, 而這一個沒有
          //    ⇒ `AdminOrderSummary.shippingAddress` 必填, 少了它 `buildOrderExportRows` 會 `TypeError`。
          //    📌 **同一支檔裡兩個 fixture, 只有一個守著型別** —— 而編譯不會講, 因為 mock 的型別是鬆的。
          shippingAddress: { name: null, phone: null, line: null },
        },
      ],
      total: 1,
    });
  });

  it('桌機單號連結 = 帶著篩選與頁碼的 panel href', async () => {
    const OrdersPage = (await import('../orders/page')).default;
    const ui = await OrdersPage({
      searchParams: Promise.resolve({ payment_status: 'paid', page: '2' }),
    });
    const { container } = render(ui as React.ReactElement);
    // 🏁 P-b:列表連結改帶 `open=`(面板退場、就地展開)。守的仍是「帶著篩選與頁碼一起走」。
    const href = [...container.querySelectorAll('a[href*="open="]')]
      .map((a) => a.getAttribute('href'))
      .find((h) => h?.includes(ORDER_ID));
    expect(href, '列表裡找不到任何指向面板的連結').toBeDefined();
    const qs = new URLSearchParams(href!.split('?')[1]);
    expect(qs.get(ORDER_OPEN_PARAM)).toBe(ORDER_ID);
    expect(qs.get(ORDER_PANEL_PARAM), '列表連結不得再帶 panel').toBeNull();
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.get('page')).toBe('2');
  });
});

// ── 5. catch-all:跨區塊導航時清空槽 ──────────────────────────────────────────
describe('#350c 守門 5:槽的 catch-all 回 null', () => {
  it('存在且回 null', async () => {
    // 🔴 沒有它 ⇒ 在 /orders?panel=x 開著面板、按側欄切到「客戶」,
    //    客戶頁右邊會**繼續掛著那張訂單**(2026-08-10 真瀏覽器實測,`D-403-Q` §①)。
    const CatchAll = (await import('./[...catchAll]/page')).default;
    expect(CatchAll()).toBeNull();
  });
});

// ── 6. @container:兩個容器都要標,否則容器斷點沒有參照對象 ──────────────────────
describe('#350c 守門 6:明細的兩個外框都是 @container', () => {
  it('整頁版帶 @container(面板版已拆)', () => {
    // 🔴 比對**含 `className='` 的字面**,不是光找 `@container` 四個字:
    //    code-reviewer(2026-08-10)實測擊破了第一版 —— 這兩個檔的**註解裡**就寫著 `@container`,
    //    所以把 className 上的那個刪掉(= 兩邊全退回單欄,本片裁④整個目的落空)斷言照樣綠。
    expect(read('app/orders/[id]/page.tsx')).toContain("className='@container");
    // ⛔ 面板版那一行 2026-09-13 連槽頁一起刪了;就地展開版的外框在 `orders-table.tsx` 那一列底下。
  });

  it('明細的欄數用容器斷點、不用 viewport 斷點', () => {
    // 🔴 **2026-08-16 改指向新檔**:那四張摘要卡(含這個 grid)從 `order-detail.tsx`
    //    抽到 `order-detail-summary-cards.tsx`(鐵則 6,純結構搬家、零行為改變)。
    //    ⚠️ **本格是被那次抽取【紅出來】的** —— 它盡了它的職責:字面搬家了它就說。
    //    ⇒ 這裡改的是**看哪一支檔**,不是放寬條件;三條斷言一個字沒動。
    // 🔴 **2026-08-19 片14:欄數由 4 改 3,而本格守的不是欄數是【斷點的種類】。**
    //    片14 拿掉了「收件與出貨」那張卡(4→3 張)⇒ 留 4 欄會多出一個被髮絲線畫出框的空格。
    //    ⚠️ 改的是**欄數的字面**,三條斷言的**形狀與用意一個字沒動**:
    //       容器斷點在(前兩條)、viewport 斷點不在(第三條)。**這不是放寬。**
    const detail = read('components/orders/order-detail-summary-cards.tsx');
    // 🔴 2026-08-19 片14 二修:摘要卡改成 `@md:grid-cols-3`(與頭條同一組)。
    //    ~~`@md:grid-cols-2 @4xl:grid-cols-3`~~ 那一版在 720px 面板裡排成 2+1,右下角是空格。
    expect(detail).toContain('@md:grid-cols-3');
    // 突變:改回 md:/xl: ⇒ 紅。(1920 螢幕上的 576px 面板會硬排三欄。)
    expect(detail).not.toContain('md:grid-cols-3 xl:grid-cols-3');
  });
});

// ── 8. #350d C2:結果碼歸誰 —— 2026-09-13 起問的是 `open=`(就地展開)那條路 ─────────────
describe('#350d 守門 8:有 open 時列表零橫幅、展開的明細恰一條(契約 §2 C2 的同型)', () => {
  const OPEN_ID = '11111111-2222-4333-8444-555555555555';
  const BANNER_TEXT = '已儲存變更。';
  const countBanner = (root: ParentNode) =>
    [...root.querySelectorAll('[role="status"]')].filter((el) => el.textContent === BANNER_TEXT)
      .length;
  const listRow = (id: string) => ({
    id,
    displayId: 'PCM-0001',
    customerUserId: null,
    customerName: null,
    createdAt: '2026-08-10T00:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    cancelledAt: null,
    total: { amount: 1000, currency: 'TWD' },
    taxTotal: { amount: 0, currency: 'TWD' as const },
    lines: [],
    invoiceStatus: null,
    tierAtCheckout: null,
    shippingAddress: { name: null, phone: null, line: null },
  });
  const renderList = async (sp: Record<string, string | string[]>) => {
    const OrdersPage = (await import('../orders/page')).default;
    return render((await OrdersPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement)
      .container;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    // 🔴 就地展開只在「那張單在這一頁列表裡」才渲染 ⇒ 列表 mock 要真的有它。
    mocks.listOrderSummariesForAdmin.mockResolvedValue({ items: [listRow(OPEN_ID)], total: 1 });
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.findAdminOrderDetail.mockResolvedValue(orderDetailFixture(OPEN_ID));
    mocks.listOrderPayments.mockResolvedValue([]);
  });

  it('🔴 展開著:整頁恰一條, 而且它在明細那一列裡(列表 0、明細 1)', async () => {
    const page = await renderList({ [ORDER_OPEN_PARAM]: OPEN_ID, r: 'saved' });
    const expanded = page.querySelector('[data-testid="order-expanded"]');
    expect(expanded, '明細沒展開 ⇒ 下面那格量的是列表自己那條').not.toBeNull();
    expect(countBanner(page), '同一個結果只能說一次').toBe(1);
    expect(countBanner(expanded!), '那一條要在明細裡, 不是列表那條').toBe(1);
  });

  it('🔴 沒有 open:列表 1 條(正向對照 —— 證明上一格的 1 不是恆真)', async () => {
    const page = await renderList({ r: 'saved' });
    expect(page.querySelector('[data-testid="order-expanded"]')).toBeNull();
    expect(countBanner(page)).toBe(1);
  });

  it('🔴🔴 `open` 不是 UUID:不展開 ⇒ 列表**照畫**', async () => {
    expect(countBanner(await renderList({ [ORDER_OPEN_PARAM]: 'not-a-uuid', r: 'saved' }))).toBe(1);
  });

  it('🔴 `open` 重複鍵(陣列)⇒ 不展開、列表照畫', async () => {
    expect(countBanner(await renderList({ [ORDER_OPEN_PARAM]: [OPEN_ID, OPEN_ID], r: 'saved' }))).toBe(1);
  });

  // ⛔ 拆面板的硬線:舊書籤不是 404, 是導頁。
  it('🔴🔴 舊書籤 `?panel=<uuid>&r=saved` ⇒ redirect 到 `?open=<uuid>&r=saved`(篩選 / 結果碼跟著走)', async () => {
    const OrdersPage = (await import('../orders/page')).default;
    let caught: unknown = null;
    try {
      await OrdersPage({
        searchParams: Promise.resolve({
          [ORDER_PANEL_PARAM]: OPEN_ID.toUpperCase(),
          payment_status: 'paid',
          r: 'saved',
        }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught, '沒有導頁 ⇒ 舊書籤會落到一個沒人認 panel 的列表').toBeInstanceOf(RedirectSentinel);
    const qs = new URLSearchParams((caught as RedirectSentinel).href.split('?')[1]);
    expect(qs.get(ORDER_OPEN_PARAM)).toBe(OPEN_ID);
    expect(qs.has(ORDER_PANEL_PARAM)).toBe(false);
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.get('r')).toBe('saved');
  });

  it('🔴 舊書籤 `?panel=new` ⇒ redirect 到 `?new=1`(手動建單彈窗)', async () => {
    const OrdersPage = (await import('../orders/page')).default;
    await expect(
      OrdersPage({ searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: 'new' }) }),
    ).rejects.toMatchObject({ href: '/orders?new=1' });
  });

  it('對照組:`?panel=not-a-uuid` 不導頁, 列表照渲染(與拆之前「面板不開」同一個結果)', async () => {
    const page = await renderList({ [ORDER_PANEL_PARAM]: 'not-a-uuid', r: 'saved' });
    expect(countBanner(page)).toBe(1);
  });
});

describe('#350d 守門 9:return_to = 這個視圖自己的網址(契約 C1)', () => {
  const OPEN_ID = '11111111-2222-4333-8444-555555555555';
  const returnToValues = (root: ParentNode) =>
    [...root.querySelectorAll('input[name="return_to"]')].map((el) =>
      el.getAttribute('value'),
    );
  const listRow = (id: string) => ({
    id,
    displayId: 'PCM-0001',
    customerUserId: null,
    customerName: null,
    createdAt: '2026-08-10T00:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    cancelledAt: null,
    total: { amount: 1000, currency: 'TWD' },
    taxTotal: { amount: 0, currency: 'TWD' as const },
    lines: [],
    invoiceStatus: null,
    tierAtCheckout: null,
    shippingAddress: { name: null, phone: null, line: null },
  });
  /** 只看**明細那一列**:列表自己也有帶 return_to 的表單(搜尋 / 匯出), 那些指列表是對的。 */
  const renderExpanded = async (extra: Record<string, string> = {}) => {
    const OrdersPage = (await import('../orders/page')).default;
    const ui = await OrdersPage({
      searchParams: Promise.resolve({ [ORDER_OPEN_PARAM]: OPEN_ID, ...extra }),
    });
    const expanded = render(ui as React.ReactElement).container.querySelector(
      '[data-testid="order-expanded"]',
    );
    if (expanded === null) throw new Error('明細沒展開');
    return expanded as HTMLElement;
  };

  let savedRefundFlag: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    savedRefundFlag = process.env.REFUND_UI_ENABLED;
    process.env.REFUND_UI_ENABLED = '1';
    mocks.listOrderSummariesForAdmin.mockResolvedValue({ items: [listRow(OPEN_ID)], total: 1 });
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.findAdminOrderDetail.mockResolvedValue(
      orderDetailFixture(OPEN_ID, { paymentStatus: 'paid' }),
    );
  });
  afterEach(() => {
    if (savedRefundFlag === undefined) delete process.env.REFUND_UI_ENABLED;
    else process.env.REFUND_UI_ENABLED = savedRefundFlag;
  });

  it('🔴 就地展開版:return_to 帶著篩選**與 open**(不是收合連結)', async () => {
    const expanded = await renderExpanded({ payment_status: 'paid' });
    const values = returnToValues(expanded);
    expect(expanded.textContent, '退款區塊沒渲染 ⇒ 這組守不到 RefundSection 那一跳').toContain(
      '線上退款',
    );
    expect(values.length, '明細裡至少要有一個接了 return_to 的表單').toBeGreaterThan(0);
    for (const value of values) {
      const qs = new URLSearchParams((value ?? '').split('?')[1] ?? '');
      expect(value?.startsWith('/orders?')).toBe(true);
      expect(qs.get(ORDER_OPEN_PARAM), `${value} 沒帶 open ⇒ 動作做完明細會收起來`).toBe(OPEN_ID);
      expect(qs.get(ORDER_PANEL_PARAM), `${value} 帶了 panel ⇒ 每次動作多一次導頁`).toBeNull();
      expect(qs.get('payment_status'), `${value} 弄丟了篩選`).toBe('paid');
    }
  });

  it('🔴 整頁版:return_to = /orders/{id}(不是 back.href 的 /orders)', async () => {
    const DetailPage = (await import('../orders/[id]/page')).default;
    const ui = await DetailPage({
      params: Promise.resolve({ id: OPEN_ID }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui as React.ReactElement);
    const values = returnToValues(container);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(`/orders/${OPEN_ID}`);
  });

  it('🔴 收款明細:就地展開版與整頁版都畫得出來,且金額同樣讀得到', async () => {
    const paymentRows = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        rail: 'cash',
        amount: 7531,
        receivedAt: '2026-08-05T01:00:00+00:00',
        createdAt: '2026-08-05T02:00:00+00:00',
        actor: 'sean',
        bankReference: null,
        recTradeId: null,
        payerNote: null,
        reversesPaymentId: null,
        reversalReason: null,
        isReversal: false,
      },
    ];
    mocks.listOrderPayments.mockResolvedValueOnce(paymentRows);
    mocks.listOrderPayments.mockResolvedValueOnce(paymentRows);
    const expanded = await renderExpanded();
    expect(paymentSection(expanded), '就地展開版少了收款明細').not.toBeNull();
    expect(expanded.textContent).toContain('7,531');

    const DetailPage = (await import('../orders/[id]/page')).default;
    const ui = await DetailPage({
      params: Promise.resolve({ id: OPEN_ID }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui as React.ReactElement);
    expect(paymentSection(container), '整頁版少了收款明細').not.toBeNull();
    expect(container.textContent).toContain('7,531');
  });

  it('片2:登錄表單的 server 章在就地展開版與整頁版都掛得到', async () => {
    mocks.listOrderPayments.mockResolvedValue([]);
    const expanded = await renderExpanded();
    const openStamp = paymentSection(expanded).querySelector('input[name="request_id"]');
    expect(openStamp, '就地展開版少了收款登錄表單').not.toBeNull();
    expect(openStamp?.getAttribute('value')).toMatch(/^[0-9a-f-]{36}$/);

    const DetailPage = (await import('../orders/[id]/page')).default;
    const ui = await DetailPage({
      params: Promise.resolve({ id: OPEN_ID }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui as React.ReactElement);
    const pageStamp = paymentSection(container).querySelector('input[name="request_id"]');
    expect(pageStamp, '整頁版少了收款登錄表單').not.toBeNull();
    expect(pageStamp?.getAttribute('value')).toMatch(/^[0-9a-f-]{36}$/);
    expect(pageStamp?.getAttribute('value')).not.toBe(openStamp?.getAttribute('value'));
  });
});

function paymentSection(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('h2')).find(
    (h) => h.textContent === '收款',
  );
  const section = heading?.closest('section');
  if (!section) throw new Error('找不到收款區塊(<h2>收款</h2> 的 section)');
  return section as HTMLElement;
}

afterEach(() => cleanup());
