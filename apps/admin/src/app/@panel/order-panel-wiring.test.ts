// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderFilter } from '@pcm/domain';
import {
  buildOrderListHref,
  buildPanelCloseHref,
  ORDER_PANEL_PARAM,
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
  }),
}));
vi.mock('../../lib/supplier', () => ({ listSuppliers: mocks.listSuppliers }));
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
  // 🔴 `order-list-view.ts:316-321` 已經為同一個坑寫過兩次警告:href builder 漏帶參數
  //    = 翻頁/回跳時搜尋詞被靜默丟掉、列表 fail-open 變成全部訂單。
  //    面板連結是這個坑的第三次機會 —— 員工點開一張單就把篩選洗掉。
  const filter: AdminOrderFilter = {
    paymentStatus: 'paid',
    fulfillmentStatus: undefined,
    orderSources: ['web'],
    paymentChannels: [],
    orderNumber: 'PCM-123',
    supplierOrderNo: undefined,
    includeUnpaidCardOrders: true,
  };

  it('同時帶 篩選 + page + panel', () => {
    const href = buildOrderListHref(filter, 3, 'ord-1');
    const qs = new URLSearchParams(href.split('?')[1] ?? '');
    expect(href.startsWith('/orders?')).toBe(true);
    // 突變:builder 少列任何一個 entry ⇒ 下面對應那條紅。
    expect(qs.get('payment_status')).toBe('paid');
    expect(qs.getAll('order_source')).toEqual(['web']);
    expect(qs.get('order_no')).toBe('PCM-123');
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

    it('一次性參數 r / correct 一起剝掉', () => {
      const href = buildPanelCloseHref({ r: 'OK', correct: 'x', payment_status: 'paid' });
      expect(href).toBe('/orders?payment_status=paid');
    });

    it('沒有任何殘留條件 → 乾淨的 /orders(不留一個孤零零的問號)', () => {
      expect(buildPanelCloseHref({ [ORDER_PANEL_PARAM]: 'ord-1' })).toBe('/orders');
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

afterEach(() => cleanup());
