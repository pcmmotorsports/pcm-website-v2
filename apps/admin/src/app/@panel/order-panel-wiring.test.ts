// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderFilter } from '@pcm/domain';
import {
  buildOrderListHref,
  buildPanelCloseHref,
  buildPanelSelfHref,
  ORDER_PANEL_PARAM,
  CUSTOMER_PANEL_PARAM,
} from '../../lib/orders/order-list-view';

// order-panel-wiring.test.ts — #350c 訂單面板接線的守門。
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
  getLedgerUnregisteredAmount: vi.fn(),
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
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound 不該在槽裡被呼叫');
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
describe('#350c 守門 1:退款 action 的 segment 時限三處同值', () => {
  // 🔴 面板改成 searchParams 驅動之後,退款表單是在 `/orders?panel=<id>` 送出的
  //    ⇒ 吃的是 `/orders` 的時限,不再只有 `/orders/[id]`。三處任一漏掉 = 那條路徑
  //    退回平台預設,而 adapter 有 30s 硬逾時 ⇒ 砍在 fetch 中途 = 錢可能已動、帳本停在 processing。
  // ⚠️ **這條守門擋不住什麼**(codex 關卡2 2026-08-10 nit):`FILES` 是**寫死的清單** ——
  //    今天實查全樹只有 `order-detail.tsx` 一處渲染 `RefundSection`,而它只被這三條 URL 消費;
  //    但**未來多出第四個消費者時,本檔不會自己發現**,它只會安靜地繼續綠。
  //    真正的自動偵測要去讀 build 的 server-action manifest,本片沒做。
  const FILES = [
    'app/orders/[id]/page.tsx',
    'app/orders/page.tsx',
    'app/@panel/orders/page.tsx',
  ] as const;

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
    fulfillmentStatus: undefined,
    orderSources: ['web'],
    paymentChannels: ['tappay'],
    includeUnpaidCardOrders: true,
  };

  it('同時帶 篩選 + page + panel', () => {
    const href = buildOrderListHref(filter, 3, 'ord-1');
    const qs = new URLSearchParams(href.split('?')[1] ?? '');
    expect(href.startsWith('/orders?')).toBe(true);
    // 突變:builder 少列任何一個 entry ⇒ 下面對應那條紅。
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.getAll('order_source')).toEqual(['web']);
    expect(qs.getAll('payment_channel')).toEqual(['tappay']);
    expect(qs.get('show_unpaid_card')).toBe('1');
    expect(qs.get('page')).toBe('3');
    expect(qs.get(ORDER_PANEL_PARAM)).toBe('ord-1');
  });

  it('不給 panelOrderId = 關閉面板(其餘狀態原封不動)', () => {
    const open = new URLSearchParams(buildOrderListHref(filter, 3, 'ord-1').split('?')[1]);
    const closed = new URLSearchParams(buildOrderListHref(filter, 3).split('?')[1]);
    expect(closed.has(ORDER_PANEL_PARAM)).toBe(false);
    open.delete(ORDER_PANEL_PARAM);
    // 關閉前後除了 panel 以外**逐字相同** —— 這條才擋得住「關閉時順手弄丟篩選」。
    expect(closed.toString()).toBe(open.toString());
  });

  // 🔴 上面兩格測的是 **builder**;面板實際用的關閉連結是 `buildPanelCloseHref`,是另一支。
  //    codex 關卡2(2026-08-10)實測擊破:把關閉連結改成固定回 `/orders`(= 關面板就把篩選全洗掉),
  //    當時六組守門**全綠**,因為沒有一格呼叫過它本人。以下四格直接測它。
  describe('buildPanelCloseHref — 面板實際用的那一支', () => {
    it('剝掉 panel、保留篩選與頁碼', () => {
      const href = buildPanelCloseHref({
        payment_status: 'paid',
        page: '3',
        [ORDER_PANEL_PARAM]: 'ord-1',
      });
      const qs = new URLSearchParams(href.split('?')[1] ?? '');
      expect(qs.get(ORDER_PANEL_PARAM)).toBeNull();
      expect(qs.get('payment_status')).toBe('paid');
      expect(qs.get('page')).toBe('3');
    });

    it('多勾選軸的**重複鍵**逐個保留(用 set 會只剩最後一個)', () => {
      const href = buildPanelCloseHref({ order_source: ['web', 'manual_line'] });
      expect(new URLSearchParams(href.split('?')[1]).getAll('order_source')).toEqual([
        'web',
        'manual_line',
      ]);
    });

    it('一次性參數 r / rt / correct 一起剝掉', () => {
      // 🔴 `rt` 是 #350d 補進 `ONE_SHOT_PARAMS` 的(#350c 漏了)。在 #350c 它只是網址上多一個
      //    沒用的參數;#350d 起這份清單被 `buildPanelSelfHref` 拿去當 `return_to` 的來源
      //    ⇒ 夾帶舊 `rt` 的話 action 再接一顆新的 = `?rt=舊&rt=新` 重複鍵
      //    ⇒ D3 classifier fail-closed ⇒ 面板永遠只說「查不到取消紀錄」。
      //    突變:把 `rt` 從清單拿掉 ⇒ 這條紅。
      const href = buildPanelCloseHref({ r: 'OK', rt: 'tok', correct: 'x', payment_status: 'paid' });
      expect(href).toBe('/orders?payment_status=paid');
    });

    it('沒有任何殘留條件 → 乾淨的 /orders(不留一個孤零零的問號)', () => {
      expect(buildPanelCloseHref({ [ORDER_PANEL_PARAM]: 'ord-1' })).toBe('/orders');
    });
  });

  describe('buildPanelSelfHref — #350d 的 return_to 來源', () => {
    it('保留篩選、剝掉一次性參數、**把 panel 留下**', () => {
      const href = buildPanelSelfHref(
        { payment_status: 'paid', r: 'saved', rt: 'tok', [ORDER_PANEL_PARAM]: 'stale' },
        'ord-9',
      );
      const qs = new URLSearchParams(href.split('?')[1] ?? '');
      expect(qs.get('payment_status')).toBe('paid');
      expect(qs.get('r')).toBeNull();
      expect(qs.get('rt')).toBeNull();
      // 🔴 用**參數帶進來的那個 id**,不是網址上原本那顆:槽頁只在 `readOpenPanelOrderId`
      //    回非 null 時才呼叫本支,而那支回的就是驗過形狀的值。
      expect(qs.getAll(ORDER_PANEL_PARAM)).toEqual(['ord-9']);
    });

    it('沒有其他條件時也接得出乾淨的 `?panel=`(不會變成 `/orders&panel=`)', () => {
      expect(buildPanelSelfHref({}, 'ord-9')).toBe(`/orders?${ORDER_PANEL_PARAM}=ord-9`);
    });
  });
});

// ── 3. 桌機改、手機不改(主視窗裁③ / Q5)────────────────────────────────────────
describe('#350c 守門 3:只有桌機走面板,手機仍是整頁', () => {
  const table = read('components/orders/orders-table.tsx');

  it('桌機單號連結走注入的 buildPanelHref', () => {
    expect(table).toContain('href={buildPanelHref(order.id)}');
  });

  it('手機卡片仍是字面 /orders/${order.id}(突變:改成 panel href ⇒ 紅)', () => {
    // eslint-disable-next-line no-template-curly-in-string -- 這裡要比對的就是原始碼裡的字面樣板字串
    expect(table).toContain('href={`/orders/${order.id}`}');
  });

  // 🔴 這裡**刻意沒有**「orders-table 不得自己拼 panel 連結」那一格:
  //    我寫過一版 `expect(table).not.toContain('panel=')`,它當場紅 —— 紅在**我自己的註解**上。
  //    那條斷言量的是「整份原始碼的字元」,不是「程式碼做了什麼」,任何人寫下 `panel=` 三個字
  //    就會誤報。真正的不變量已經被上面那格(桌機 href 走注入的 builder)釘住了。
});

// ── 3b. A13b D6-a:面板版也要吃取消結果碼 ────────────────────────────────────
describe('A13b D6-a 守門:面板版的取消結果頁閘門不得常開', () => {
  const PANEL_ID = '11111111-2222-4333-8444-555555555555';
  const TOKEN = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';

  it('🔴 槽頁必須把 `r`/`rt` 原封傳給 OrderDetailRoute', () => {
    // 🔴 **這格是 R2 codex 抓的**:我原本寫死 `resultCode = undefined`,並宣稱
    //    「今天不可構造(action 全 redirect 去整頁)」——**那句不實**:
    //    action 只決定網址**怎麼被產生**,不決定**怎麼被到達**。
    //    書籤 / 手打 / 上一頁開 `/orders?panel=<單>&r=order_cancel_retry&rt=<uuid>` 就到得了,
    //    當時 `cancelFormsAllowedOnResultPage(undefined)` 恆 true
    //    ⇒ **面板不顯示結果、取消表單卻開著**(fail-open)。
    // ⚠️ 原始碼層守門:面板槽的渲染鏈要真的量得跑真 Next(async server component + 平行路由),
    //    本檔既有守門也是這個層級(見檔頭)。突變:把 `raw[CANCEL_RESULT_PARAM]` 改回
    //    `undefined` ⇒ 下面兩條斷言各紅一邊。
    const src = read('app/@panel/orders/page.tsx');
    expect(src).toContain('const resultCode = raw[CANCEL_RESULT_PARAM];');
    expect(src).toContain('const requestToken = raw[CANCEL_REQUEST_TOKEN_PARAM];');
    // 🔴 而且要真的傳下去,不是算出來放著。
    expect(src).toMatch(/resultCode,\s*\n\s*requestToken,/);
  });

  it('🔴 面板吃的是完整的 `r`,不是「為了關 banner 而不傳 r」', () => {
    // 🔴 這兩件事必須分開:通用 `ResultBanner` 畫在哪一邊(#350d C2 已翻給面板)是一回事;
    //    **取消結果面板與結果頁閘門要吃 `r`/`rt`** 是另一回事。
    //    用「不傳 `r`」來達成關 banner = 把兩件事綁在一起,而代價是閘門常開。
    // ⚠️ #350c 這裡原本還斷言 `showResultBanner: false`;#350d 把那個 prop **整個刪掉**了
    //    ⇒ 再留一條 `not.toContain('showResultBanner: false')` 是**恆真**(prop 不存在,
    //    誰再傳它 typecheck 就紅)。恆真的斷言只會讓人以為這裡守了什麼,已拿掉。
    //    C2 的行為層由下面 #350d 守門 8 那組守(每格都做過突變實測)。
    const src = read('app/@panel/orders/page.tsx');
    expect(src).not.toContain('const resultCode = undefined;');
  });
});

// ── 4. 槽頁的開關語意 ─────────────────────────────────────────────────────────
describe('#350c 守門 4:槽頁只在 panel 是合法 UUID 時才開', () => {
  const PANEL_ID = '11111111-2222-4333-8444-555555555555';
  const load = async () => (await import('./orders/page')).default;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAdminOrderDetail.mockResolvedValue(null);
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
  });

  it('沒帶 panel → null(這就是關閉面板的機制)', async () => {
    const Page = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).resolves.toBeNull();
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
  });

  it('panel 不是 UUID → null、不呼叫 notFound、**且不打 DB**(裁⑤:notFound 面板自理)', async () => {
    const Page = await load();
    // 🔴 突變:拿掉槽頁的 `isUuid` 形狀閘 ⇒ 這條會往下走進 `OrderDetailRoute`,
    //    回傳的不再是 null,而且 `findAdminOrderDetail` 會被呼叫 —— 兩條斷言各自紅一邊。
    await expect(
      Page({ searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: 'not-a-uuid' }) }),
    ).resolves.toBeNull();
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
  });

  it('🔴 panel 是合法 UUID → 真的開,**而且真的拿那個 id 去查**', async () => {
    // 這一格擋兩個壞法(第二個是 codex 關卡2 2026-08-10 補的):
    //   ① 面板永遠打不開(槽頁改成無條件 `return null`)⇒ `not.toBeNull()` 紅;
    //   ② 面板開了但**接錯線**(id 沒傳下去 / 傳成別的值)⇒ 下面那條 `toHaveBeenCalledWith` 紅。
    //      只斷言「非 null」的話,回傳任何一個錯誤殼都會綠。
    const Page = await load();
    const ui = await Page({ searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID }) });
    expect(ui).not.toBeNull();
    expect(mocks.findAdminOrderDetail).toHaveBeenCalledWith(PANEL_ID);
  });

  it('🔴 關閉連結真的接到 `buildPanelCloseHref`(不是硬寫 /orders)', async () => {
    // codex 關卡2:槽頁把 `back.href` 改成固定 `/orders` 時,原本六組守門全綠。
    // 這裡從**渲染結果**把那個連結挖出來比對,才是真的接線斷言。
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID, payment_status: 'paid' }),
    });
    const { container } = render(ui as React.ReactElement);
    const back = container.querySelector('a[href^="/orders"]');
    expect(back?.getAttribute('href')).toBe('/orders?payment_status=paid');
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
          fulfillmentStatus: 'pending',
          orderSource: 'web',
          paymentChannel: 'tappay',
          cancelledAt: null,
          total: { amount: 1000, currency: 'TWD' },
          lines: [],
          invoiceStatus: null,
          tierAtCheckout: null,
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
    const href = [...container.querySelectorAll('a[href*="panel="]')]
      .map((a) => a.getAttribute('href'))
      .find((h) => h?.includes(ORDER_ID));
    expect(href, '列表裡找不到任何指向面板的連結').toBeDefined();
    const qs = new URLSearchParams(href!.split('?')[1]);
    expect(qs.get(ORDER_PANEL_PARAM)).toBe(ORDER_ID);
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
  it('整頁版與面板版都帶 @container', () => {
    // 🔴 比對**含 `className='` 的字面**,不是光找 `@container` 四個字:
    //    code-reviewer(2026-08-10)實測擊破了第一版 —— 這兩個檔的**註解裡**就寫著 `@container`,
    //    所以把 className 上的那個刪掉(= 兩邊全退回單欄,本片裁④整個目的落空)斷言照樣綠。
    expect(read('app/orders/[id]/page.tsx')).toContain("className='@container");
    expect(read('app/@panel/orders/page.tsx')).toContain("className='@container");
  });

  it('明細的欄數用容器斷點、不用 viewport 斷點', () => {
    const detail = read('components/orders/order-detail.tsx');
    expect(detail).toContain('@md:grid-cols-2');
    expect(detail).toContain('@4xl:grid-cols-4');
    // 突變:改回 md:/xl: ⇒ 紅。(1920 螢幕上的 576px 面板會硬排四欄。)
    expect(detail).not.toContain('md:grid-cols-2 xl:grid-cols-4');
  });
});

// ── 8. #350d C2:結果碼歸誰 + return_to 接線 ──────────────────────────────────
describe('#350d 守門 8:有 panel 時列表零橫幅、面板恰一條(契約 §2 C2)', () => {
  // 🔴 這一組是契約 §2 硬條件 2 的**行為層**守門。兩個壞法都沒有執行期訊號:
  //    翻早了 = 兩條橫幅(C2 存在的理由被打破);翻晚了 = **零橫幅**(動作做完什麼都不說)。
  // ⚠️ **誠實界線**:真站上列表與面板是同一個頁面的兩個平行槽,這裡是**分別**渲染再各自數。
  //    量得到「誰畫誰不畫」,量不到「同一次 render 的視覺順序」。
  const PANEL_ID = '11111111-2222-4333-8444-555555555555';
  const BANNER_TEXT = '已儲存變更。';

  /** 🔴 用**文字**數而不是數 `[role="status"]`:取消結果面板與 spinner 也用那個 role。 */
  const countBanner = (root: HTMLElement) =>
    [...root.querySelectorAll('[role="status"]')].filter((el) => el.textContent === BANNER_TEXT)
      .length;

  const renderList = async (sp: Record<string, string | string[]>) => {
    const OrdersPage = (await import('../orders/page')).default;
    return render((await OrdersPage({ searchParams: Promise.resolve(sp) })) as React.ReactElement)
      .container;
  };
  const renderPanel = async (sp: Record<string, string | string[]>) => {
    const PanelPage = (await import('./orders/page')).default;
    const ui = await PanelPage({ searchParams: Promise.resolve(sp) });
    return ui === null ? null : render(ui as React.ReactElement).container;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOrderSummariesForAdmin.mockResolvedValue({ items: [], total: 0 });
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.findAdminOrderDetail.mockResolvedValue(orderDetailFixture(PANEL_ID));
    mocks.listOrderPayments.mockResolvedValue([]);
  });

  it('🔴 面板開著:列表 0 條、面板 1 條', async () => {
    const list = await renderList({ [ORDER_PANEL_PARAM]: PANEL_ID, r: 'saved' });
    const panel = await renderPanel({ [ORDER_PANEL_PARAM]: PANEL_ID, r: 'saved' });
    // 突變 A:拿掉列表的 `!panelOpen &&` ⇒ 這條變 1 ⇒ 紅(兩條橫幅)。
    expect(countBanner(list), '面板開著時列表不該畫橫幅').toBe(0);
    // 突變 B:把面板的 `showResultBanner` 設回 false ⇒ 這條變 0 ⇒ 紅(零橫幅)。
    expect(panel).not.toBeNull();
    expect(countBanner(panel!), '面板要畫恰一條').toBe(1);
  });

  it('🔴 沒有 panel:列表 1 條(正向對照 —— 證明上一格的 0 不是恆真)', async () => {
    expect(countBanner(await renderList({ r: 'saved' }))).toBe(1);
  });

  it('🔴 `panel` 是合法 UUID 但**查無此單**:面板仍畫那一條(不是零橫幅)', async () => {
    // 🔴 code-reviewer R1 nit-6:這條路徑在 `OrderDetailRoute` 裡走 `PanelMessage`,
    //    而它原本在畫橫幅**之前**就 return ⇒ 列表已因 C2 停畫、面板又不畫 = **零橫幅**。
    //    到得了這裡的不只「單剛好被刪」——書籤與上一頁都算。
    //    突變:把 `PanelMessage` 裡的 `<ResultBanner>` 拿掉 ⇒ 這格紅,而上面那格照樣綠
    //    (上面用的是查得到的 fixture)⇒ 兩格互不蘊含。
    mocks.findAdminOrderDetail.mockResolvedValue(null);
    const panel = await renderPanel({ [ORDER_PANEL_PARAM]: PANEL_ID, r: 'saved' });
    expect(panel).not.toBeNull();
    expect(panel!.textContent, '正向對照:確實走到了查無那條訊息').toContain('找不到這張訂單');
    expect(countBanner(panel!)).toBe(1);
  });

  it('🔴🔴 `panel` 不是 UUID:面板不開 ⇒ 列表**照畫**(判準要跟槽頁同一支)', async () => {
    // 🔴 這格擋的是最像對的那個寫法:列表用「`panel` 這個 key 在不在」當判準。
    //    那樣寫的話這條 URL 會變成「面板不開 + 列表也停畫」= **零橫幅**,
    //    而 typecheck / lint / 上面兩格**全綠**。
    //    突變:把 `readOpenPanelOrderId(rawSearchParams) !== null` 改成
    //    `rawSearchParams.panel !== undefined` ⇒ 只有這一格紅。
    const sp = { [ORDER_PANEL_PARAM]: 'not-a-uuid', r: 'saved' };
    expect(await renderPanel(sp), '非 UUID 時槽頁必須回 null').toBeNull();
    expect(countBanner(await renderList(sp)), '面板沒開就該由列表說話').toBe(1);
  });

  it('🔴 `panel` 重複鍵(陣列)⇒ 面板不開、列表照畫', async () => {
    // 🔴 R2 F4 補的:`readOpenPanelOrderId` 的**陣列分支**原本零覆蓋。
    //    日後有人把它改成「取第一顆」⇒ 面板會開,而 `parseOrderReturnTo` 仍拒重複鍵
    //    ⇒ 每次儲存都把面板踢掉,而當時四格全綠。
    const sp = { [ORDER_PANEL_PARAM]: [PANEL_ID, PANEL_ID], r: 'saved' };
    expect(await renderPanel(sp), '重複鍵要 fail-closed').toBeNull();
    expect(countBanner(await renderList(sp))).toBe(1);
  });

  it('🔴 大寫 UUID 的 `panel`:面板照開,且 return_to 折平成小寫', async () => {
    // 🔴 R2 F1:`isUuid` 是 `/i` ⇒ 大寫過閘,但表單的 `order_id` 是 DB 出來的小寫
    //    ⇒ 不折平的話 §6-1 比對判「不同單」⇒ 儲存完面板被靜默關掉。
    //    突變:拿掉 `readOpenPanelOrderId` 的 `.toLowerCase()` ⇒ 這格紅。
    // 🔴🔴 **這裡刻意不用 `PANEL_ID`**:它是 `1111…-5555` 全數字,`toUpperCase()` 是 no-op
    //    ⇒ 第一版這格對上面那個突變**存活**(實測),是 fixture 讓守門恆真的教科書形狀
    //    (memory `feedback_fixture-value-makes-guard-vacuous`)。改用帶 a-f 的 uuid。
    const hexId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(hexId.toUpperCase(), '這顆 uuid 必須含字母,否則大小寫這條恆真').not.toBe(hexId);
    mocks.findAdminOrderDetail.mockResolvedValue(orderDetailFixture(hexId));
    const panel = await renderPanel({ [ORDER_PANEL_PARAM]: hexId.toUpperCase() });
    expect(panel).not.toBeNull();
    const returnTo = panel!.querySelector('input[name="return_to"]')?.getAttribute('value');
    expect(returnTo).toBe(`/orders?${ORDER_PANEL_PARAM}=${hexId}`);
  });
});

describe('#350d 守門 9:return_to = 這個視圖自己的網址(契約 C1)', () => {
  const PANEL_ID = '11111111-2222-4333-8444-555555555555';

  const returnToValues = (root: HTMLElement) =>
    [...root.querySelectorAll('input[name="return_to"]')].map((el) =>
      el.getAttribute('value'),
    );

  // 🔴🔴 **fixture 必須讓「所有會帶 return_to 的表單」都渲染得出來**(#350d-4 code-reviewer
  //    must-fix 2):本組是逐一掃 `input[name="return_to"]` 的**面層**守門,但它原本的 fixture 是
  //    `paymentStatus: 'unpaid'` 且沒開 `REFUND_UI_ENABLED` ⇒ `order-detail.tsx` 的退款入口閘
  //    讓 `RefundSection` **根本沒渲染** ⇒ 「`OrderDetail` → `RefundSection`」那一跳零守門:
  //    把 `returnTo` 改寫成 `/orders/${detail.id}` 或空字串,全套照樣綠,而正式站每次面板退款
  //    都靜默走 fallback、把面板關掉。⇒ 這裡改成 `paid` + 開旗標,for-loop 自動涵蓋到它。
  let savedRefundFlag: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    savedRefundFlag = process.env.REFUND_UI_ENABLED;
    process.env.REFUND_UI_ENABLED = '1';
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.findAdminOrderDetail.mockResolvedValue(
      orderDetailFixture(PANEL_ID, { paymentStatus: 'paid' }),
    );
  });

  afterEach(() => {
    if (savedRefundFlag === undefined) delete process.env.REFUND_UI_ENABLED;
    else process.env.REFUND_UI_ENABLED = savedRefundFlag;
  });

  it('🔴 面板版:return_to 帶著篩選**與 panel**(不是關閉連結)', async () => {
    // 🔴 這格是**契約字面更正**的守門(`D-420-NOTE` §1):契約 §4/§6-2 寫「值 = `back.href`」,
    //    而 `back.href` 在面板版是 `buildPanelCloseHref`(**不帶 panel**)
    //    ⇒ 照字面接 = 動作做完面板被關掉,而畫面上看起來「頁面是對的」、沒有任何錯誤。
    //    突變:把槽頁的 `buildPanelSelfHref(raw, panelId)` 換成 `buildPanelCloseHref(raw)`
    //    ⇒ 下面 `panel=` 那條紅。
    const PanelPage = (await import('./orders/page')).default;
    const ui = await PanelPage({
      searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID, payment_status: 'paid' }),
    });
    const { container } = render(ui as React.ReactElement);
    const values = returnToValues(container);
    // 🔴 **正向對照:退款那一份真的渲染出來了** —— 否則本組的涵蓋面只是一句宣稱
    //    (fixture 若讓退款入口閘擋掉,下面的 for-loop 就掃不到它,而斷言照樣全綠)。
    expect(container.textContent, '退款區塊沒渲染 ⇒ 這組守不到 RefundSection 那一跳').toContain(
      '線上退款',
    );
    expect(values.length, '面板裡至少要有一個接了 return_to 的表單').toBeGreaterThan(0);
    for (const value of values) {
      const qs = new URLSearchParams((value ?? '').split('?')[1] ?? '');
      expect(value?.startsWith('/orders?')).toBe(true);
      expect(qs.get(ORDER_PANEL_PARAM), `${value} 沒帶 panel ⇒ 動作做完面板會關掉`).toBe(PANEL_ID);
      expect(qs.get('payment_status'), `${value} 弄丟了篩選`).toBe('paid');
    }
  });

  it('🔴 整頁版:return_to = /orders/{id}(不是 back.href 的 /orders)', async () => {
    // 突變:整頁版改傳 `back.href` ⇒ 值變 `/orders` ⇒ 紅(改單完被踢回列表 = 回歸)。
    const DetailPage = (await import('../orders/[id]/page')).default;
    const ui = await DetailPage({
      params: Promise.resolve({ id: PANEL_ID }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui as React.ReactElement);
    const values = returnToValues(container);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toBe(`/orders/${PANEL_ID}`);
  });

  // 🔴 #15-B2-c 片1a:**收款明細兩個消費者都要拿得到**。
  //    兩個視圖共用 `OrderDetailRoute`,所以今天是結構上共享的 —— 但 #350c 抽出那一層的
  //    理由逐字就是「複製一份會慢慢分岔」⇒ 把「兩邊都有」釘成守門,分岔當下就轉紅。
  //    突變:只在整頁版傳 `payments`(面板版不傳)⇒ 型別紅;把 `<PaymentList>` 拿掉 ⇒ 兩格都紅。
  it('🔴 收款明細:面板版與整頁版都畫得出來,且金額同樣讀得到', async () => {
    // 金額取 7531:與 fixture 的任何金額都不撞號 ⇒ 「找得到它」只可能來自收款列。
    // ⚠️ **`mockResolvedValue` 會外溢到後面的格**(code-reviewer R1 nit-6):`clearAllMocks`
    //    清呼叫紀錄、**不清 implementation** ⇒ 這一組收款列會被之後每一格拿到。
    //    今天無害(本格是本檔最後一格),但「無害」是位置決定的、不是機制決定的
    //    ⇒ 用 `mockResolvedValueOnce`,讓它只活這一次、位置怎麼搬都不會外溢。
    //    ⚠️ 本格會渲染**兩個**消費者(面板 + 整頁)⇒ 要餵**兩次**。
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

    // 🔴 就地渲染面板頁(本 describe 沒有 `renderPanel` —— 那支是上一個 describe 的區域 helper)。
    const PanelPage = (await import('./orders/page')).default;
    const panelUi = await PanelPage({
      searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID }),
    });
    expect(panelUi).not.toBeNull();
    const panel = render(panelUi as React.ReactElement).container;
    // 🔴 #437 ① 把標題改成「收款」之後,拿它當子字串錨判別力太弱
    //    (「尚未登錄任何收款」「新增收款」都含它)⇒ 改用結構錨:
    //    `paymentSection()` 找不到 `<h2>收款</h2>` 的 section 會 throw。
    expect(paymentSection(panel), '面板版少了收款明細').not.toBeNull();
    expect(panel.textContent).toContain('7,531');

    const DetailPage = (await import('../orders/[id]/page')).default;
    const ui = await DetailPage({
      params: Promise.resolve({ id: PANEL_ID }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui as React.ReactElement);
    expect(paymentSection(container), '整頁版少了收款明細').not.toBeNull();
    expect(container.textContent).toContain('7,531');
  });

  // 🔴 **片2:登錄表單也要兩個消費者都掛得到**(plan v4 §2 的 2b 檔案清單)。
  //    上面那格只證明「明細」兩邊都在;表單是另一個元件、走另一條 prop
  //    ⇒ 只掛在整頁版而漏掉面板版的話,員工從列表開面板時**看得到帳、卻登不了款**,
  //    而上面那格照樣綠。
  //    🔴 錨用**印章 hidden input**、不用文案:文案是暫定稿(Sean 還沒定字),
  //    把守門綁在一個明說會改的東西上,改字的人就得順手改守門 —— 那是製造假紅。
  it('片2:登錄表單的 server 章在面板版與整頁版都掛得到', async () => {
    mocks.listOrderPayments.mockResolvedValue([]);

    const PanelPage = (await import('./orders/page')).default;
    const panelUi = await PanelPage({
      searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID }),
    });
    const panel = render(panelUi as React.ReactElement).container;
    // 🔴 **錨要限定在收款區塊裡**(片2a code-reviewer minor5):`request_id` 這個欄位名
    //    到貨表單也在用(`receipt-action-state.ts:39` 逐字同名)⇒ 不限範圍的話,
    //    收款表單整個不見時還可能撈到到貨表單那顆、這格照樣綠。今天靠 DOM 順序僥倖而已。
    const panelStamp = paymentSection(panel).querySelector('input[name="request_id"]');
    expect(panelStamp, '面板版少了收款登錄表單').not.toBeNull();
    expect(panelStamp?.getAttribute('value')).toMatch(/^[0-9a-f-]{36}$/);

    const DetailPage = (await import('../orders/[id]/page')).default;
    const ui = await DetailPage({
      params: Promise.resolve({ id: PANEL_ID }),
      searchParams: Promise.resolve({}),
    });
    const { container } = render(ui as React.ReactElement);
    const pageStamp = paymentSection(container).querySelector('input[name="request_id"]');
    expect(pageStamp, '整頁版少了收款登錄表單').not.toBeNull();
    expect(pageStamp?.getAttribute('value')).toMatch(/^[0-9a-f-]{36}$/);

    // 🔴 **兩個視圖各自拿到自己的一把鍵**:同一把鍵若在兩張分頁上開著,先送的那張成功、
    //    後送的那張會被 RPC 的 G8 當成重送而**靜默吃掉**(員工以為沒記到、再登一次)。
    //    突變:把鑄章從 `PaymentSection` 提到某個跨請求共用的地方 ⇒ 兩值相同 ⇒ 這條紅。
    expect(pageStamp?.getAttribute('value')).not.toBe(panelStamp?.getAttribute('value'));
  });
});

/** 收款那張卡(用區塊標題錨定;找不到就 throw,不讓「找不到」偽裝成「值是 null」)。 */
function paymentSection(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('h2')).find(
    (h) => h.textContent === '收款',
  );
  const section = heading?.closest('section');
  if (!section) throw new Error('找不到收款區塊(<h2>收款</h2> 的 section)');
  return section as HTMLElement;
}

afterEach(() => cleanup());

// ── OD 片 3b:客人卡蓋在訂單面板上 ──────────────────────────────────────────────
describe('OD 片 3b 守門:`?customer=` 分支', () => {
  const PANEL_ID = '11111111-2222-4333-8444-555555555555';
  const CUSTOMER_ID = '99999999-8888-4777-8666-555555555555';
  const RELATED_ORDER_ID = 'aaaaaaaa-1111-4222-8333-444444444444';
  const HISTORY_ORDER_ID = 'bbbbbbbb-1111-4222-8333-444444444444';
  const load = async () => (await import('./orders/page')).default;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAdminOrderDetail.mockResolvedValue(null);
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.findCustomerById.mockResolvedValue({
      id: CUSTOMER_ID,
      name: '王小明',
      email: 'a@b.c',
      phone: '0912345678',
      birthday: null,
      tier: 'general',
      walletBalance: 0,
      totalDeposit: 0,
      createdAt: '2026-01-01T00:00:00Z',
    });
    // 🔴 **fixture 的值決定了測試能發現什麼**(codex 關卡2 must-fix 的病根):
    //    第一版把這兩個都設成 `[]` ⇒ 儲值金流水表與訂單歷史表**整段 markup 根本不渲染**
    //    ⇒ 「客人卡裡的訂單連結有沒有換成面板 href」這條路徑**零覆蓋**,
    //    而我漏接的正是流水表那一顆。空陣列不是「中性的預設值」,它是**把路徑關掉**。
    mocks.listWalletEntries.mockResolvedValue([
      {
        id: 'w1',
        entryDate: '2026-08-01',
        entryType: 'deposit',
        amount: 1000,
        note: null,
        relatedOrderId: RELATED_ORDER_ID,
      },
    ]);
    mocks.listSummariesByCustomer.mockResolvedValue([
      {
        id: HISTORY_ORDER_ID,
        displayId: 'PCM-2026-0009',
        createdAt: '2026-08-01T00:00:00Z',
        itemCount: 1,
        total: { amount: 1000, currency: 'TWD' },
        paymentStatus: 'paid',
        fulfillmentStatus: 'notOrdered',
      },
    ]);
    mocks.listAddressesByCustomer.mockResolvedValue([]);
    mocks.listVehiclesByCustomer.mockResolvedValue([]);
  });

  const CUSTOMER_SPIES = [
    ['客戶本體', () => mocks.findCustomerById],
    ['儲值金流水', () => mocks.listWalletEntries],
    ['訂單歷史', () => mocks.listSummariesByCustomer],
    ['收件地址', () => mocks.listAddressesByCustomer],
    ['車庫', () => mocks.listVehiclesByCustomer],
  ] as const;

  /**
   * 🔴 **lazy 不是平行路由天然給的,是槽頁那個 early return 給的**。
   * 我在 plan 裡原本寫「C 案 lazy 天然成立」——**那句話當時是錯的**(形狀是 searchParams 驅動、
   * 不是路徑驅動的 slot),所以這條要用**實測**釘住,不能靠推論。
   * ⚠️ 這格量的是「**程式碼路徑沒被呼叫**」(repository spy 零呼叫),
   *    **不是**「網路請求沒發生」—— 在 server component 上兩者通常等價,但那是**推論**,我沒有量到後者。
   */
  it('🔴 沒帶 customer:五路客人查詢**一次都不呼叫**(lazy 的實測,五支全查)', async () => {
    const Page = await load();
    await Page({ searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID }) });
    for (const [label, spy] of CUSTOMER_SPIES) {
      expect(spy(), `${label} 在沒點客人時就被查了 ⇒ lazy 破了`).not.toHaveBeenCalled();
    }
  });

  it('🔴 customer 不是 UUID:同樣零查詢、且不影響訂單面板照常開', async () => {
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({
        [ORDER_PANEL_PARAM]: PANEL_ID,
        [CUSTOMER_PANEL_PARAM]: 'not-a-uuid',
      }),
    });
    for (const [label, spy] of CUSTOMER_SPIES) {
      expect(spy(), `${label} 被一條爛網址觸發了查詢`).not.toHaveBeenCalled();
    }
    // 訂單面板照常(這裡 findAdminOrderDetail 回 null ⇒ missing inline,但**有渲染**、不是 null)
    expect(ui).not.toBeNull();
  });

  it('🔴 沒帶 panel 但帶了 customer:不開任何東西(客人卡是蓋在某張單上,不是獨立視圖)', async () => {
    const Page = await load();
    await expect(
      Page({ searchParams: Promise.resolve({ [CUSTOMER_PANEL_PARAM]: CUSTOMER_ID }) }),
    ).resolves.toBeNull();
    for (const [label, spy] of CUSTOMER_SPIES) {
      expect(spy(), `${label} 在沒有 panel 的情況下被查了`).not.toHaveBeenCalled();
    }
  });

  it('🔴 帶合法 customer:渲染客人卡、五路都查、**訂單明細不查**(客人卡蓋掉訂單面板)', async () => {
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({
        [ORDER_PANEL_PARAM]: PANEL_ID,
        [CUSTOMER_PANEL_PARAM]: CUSTOMER_ID,
      }),
    });
    expect(ui).not.toBeNull();
    for (const [label, spy] of CUSTOMER_SPIES) {
      expect(spy(), `${label} 沒被查 ⇒ 客人卡拿不到那一區塊`).toHaveBeenCalledWith(CUSTOMER_ID);
    }
    // 蓋掉:訂單那邊一次都不查(否則就是兩張卡都在抓資料)
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
    const { container } = render(ui as React.ReactElement);
    expect(container.textContent).toContain('王小明');
  });

  it('🔴 「回訂單」連結 = 拿掉 customer、panel 還在(結構上必然回到原本那張單)', async () => {
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({
        [ORDER_PANEL_PARAM]: PANEL_ID,
        [CUSTOMER_PANEL_PARAM]: CUSTOMER_ID,
        payment_status: 'paid',
      }),
    });
    const { container } = render(ui as React.ReactElement);
    const back = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('回訂單'));
    const href = back?.getAttribute('href') ?? '';
    // 篩選逐字保留 + panel 還在 + customer 不見了
    expect(href).toContain(`${ORDER_PANEL_PARAM}=${PANEL_ID}`);
    expect(href).toContain('payment_status=paid');
    expect(href).not.toContain(CUSTOMER_PANEL_PARAM);
  });

  it('🔴 唯讀:面板版**不出現**等級變更與儲值金調整兩支表單(它們會把員工丟去 /customers)', async () => {
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({
        [ORDER_PANEL_PARAM]: PANEL_ID,
        [CUSTOMER_PANEL_PARAM]: CUSTOMER_ID,
      }),
    });
    const { container } = render(ui as React.ReactElement);
    expect(container.querySelectorAll('form')).toHaveLength(0);
    // 正向對照:卡本體有渲染(否則「零表單」可以靠「整張卡沒渲染」達成)
    expect(container.textContent).toContain('儲值金');
  });

  /**
   * 🔴 codex 關卡2 must-fix:Sean 逐字「**再點訂單**……變成看訂單」**沒有限定是哪一個連結**。
   * 客人卡裡目前有**兩處**能點到訂單:①儲值金流水的「查看訂單」②訂單歷史的單號。
   * 第一版只接了②,而①硬連 `/orders/<id>` ⇒ 員工點它會**整頁跳走、遺失列表篩選與面板狀態**。
   * ⇒ 這格用**遍歷**而不是點名:凡指向訂單的連結,一律必須是面板形式。
   *   新增第三處訂單連結卻忘了接時,這格會紅。
   */
  it('🔴 客人卡裡**每一個**訂單連結都換成面板 href(不是只有訂單歷史那個)', async () => {
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({
        [ORDER_PANEL_PARAM]: PANEL_ID,
        [CUSTOMER_PANEL_PARAM]: CUSTOMER_ID,
      }),
    });
    const { container } = render(ui as React.ReactElement);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

    // 前提斷言:兩處都真的渲染出來了(fixture 給空陣列的話這裡會紅,而不是靜默零覆蓋)
    expect(container.textContent, '儲值金流水沒渲染 ⇒ 這格測不到它').toContain('查看訂單');
    expect(container.textContent, '訂單歷史沒渲染 ⇒ 這格測不到它').toContain('PCM-2026-0009');

    for (const id of [RELATED_ORDER_ID, HISTORY_ORDER_ID]) {
      const toThisOrder = hrefs.filter((h) => h.includes(id));
      expect(toThisOrder.length, `找不到指向 ${id} 的連結`).toBeGreaterThan(0);
      for (const h of toThisOrder) {
        expect(h, `${h} 是整頁跳轉 ⇒ 會弄丟面板與篩選`).toContain(`${ORDER_PANEL_PARAM}=${id}`);
        expect(h).not.toMatch(new RegExp(`^/orders/${id}`));
      }
    }
  });

  it('「開整頁 ↗」出口存在且指向整頁版(OD `customer-card-summary.html:338`;`:310` 說明只放一個)', async () => {
    const Page = await load();
    const ui = await Page({
      searchParams: Promise.resolve({
        [ORDER_PANEL_PARAM]: PANEL_ID,
        [CUSTOMER_PANEL_PARAM]: CUSTOMER_ID,
      }),
    });
    const { container } = render(ui as React.ReactElement);
    const full = [...container.querySelectorAll('a')].filter(
      (a) => a.getAttribute('href') === `/customers/${CUSTOMER_ID}`,
    );
    // OD `:310` 逐字「整頁出口**只有一個**……不重複放第二個」⇒ 恰一個
    expect(full).toHaveLength(1);
  });
});

describe('OD 片 3b 守門:標題列的客人入口(fail-closed)', () => {
  const PANEL_ID = '11111111-2222-4333-8444-555555555555';
  const CUSTOMER_ID = '99999999-8888-4777-8666-555555555555';
  const load = async () => (await import('./orders/page')).default;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSuppliers.mockResolvedValue([]);
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
  });

  async function renderPanel(over: Record<string, unknown>) {
    mocks.findAdminOrderDetail.mockResolvedValue(orderDetailFixture(PANEL_ID, over));
    const Page = await load();
    const ui = await Page({ searchParams: Promise.resolve({ [ORDER_PANEL_PARAM]: PANEL_ID }) });
    return render(ui as React.ReactElement).container;
  }

  it('🔴 有客人 id:入口出現,連結帶 customer + 保留 panel', async () => {
    const container = await renderPanel({
      customerUserId: CUSTOMER_ID,
      customer: { name: '王小明', email: null, phone: null },
    });
    const link = [...container.querySelectorAll('a')].find((a) =>
      a.getAttribute('href')?.includes(`${CUSTOMER_PANEL_PARAM}=${CUSTOMER_ID}`),
    );
    expect(link, '入口不見了').toBeTruthy();
    expect(link?.getAttribute('href')).toContain(`${ORDER_PANEL_PARAM}=${PANEL_ID}`);
    expect(link?.textContent).toContain('王小明');
  });

  /**
   * 🔴 fail-closed 的三種缺值。**`undefined` 那格不是假想的**:
   * 手寫的 detail 物件(本檔 fixture 在片 3b 之前就沒有這一欄)給的正是 `undefined`,
   * 而 `undefined === null` 為 false ⇒ 早一版的 `=== null` 判斷會拿它去拼出
   * `/customers/undefined` 或 `&customer=undefined`。空字串同理。
   */
  it.each([
    ['null(投影退版讀不到)', null],
    ['undefined(手寫物件缺這一欄)', undefined],
    ['空字串', ''],
    // 🔴 **第四類是 codex 關卡2 補的**:我前兩版寫「fail-closed」,但 `=== null` 漏 undefined、
    //    falsy 又漏「長得不像 UUID 的字串」—— 那類會產生一個點下去沒反應(面板版)
    //    或導到 404(整頁版)的入口。**宣稱涵蓋不到的那一類,就是宣稱說謊的那一類。**
    ["字串 'null'(某處把缺值 stringify 過)", 'null'],
    ['純空白字串', '   '],
    ['非 UUID 亂碼', 'not-a-uuid-at-all'],
  ])('🔴 客人 id 是 %s ⇒ 入口**不渲染**,且畫面上沒有 undefined/null 的網址', async (_l, value) => {
    const container = await renderPanel({ customerUserId: value });
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes(CUSTOMER_PANEL_PARAM))).toBe(false);
    for (const h of hrefs) {
      expect(h, `拼出了壞路徑:${h}`).not.toMatch(/undefined|null/);
    }
  });
});
