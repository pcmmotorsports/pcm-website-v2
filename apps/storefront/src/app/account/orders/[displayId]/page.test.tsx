// @vitest-environment node
//
// 訂單明細【路由】守門(`#240`)。
//
// 🔴 **這支存在的理由**:code-reviewer 2026-08-23 實查 —— 這個目錄底下只有 `page.tsx`、
//    **零測試**。
//    🔴🔴 **原本這裡寫的數法與數字【兩個都不對】,2026-08-27 逐點重量後訂正**:
//      原文:`grep -rln "account/orders" --include='*.test.*'` 「只命中 OrdersTab.test.tsx 與 safe-redirect.test.ts」(2 支)
//      實測(帶時點錨,`git grep -l "account/orders" <ref> -- '*.test.*'`):
//        `ae7dffa9`(建檔那顆 `883ee024` 的**父** = 本檔尚未存在的那一版)⇒ **1 支**,只有 `safe-redirect.test.ts`
//          (`OrdersTab.test.tsx` 那時**存在而零命中** —— 三種寫法都查過)
//        `883ee024`(建檔那顆本身)⇒ **3 支**;今天 HEAD ⇒ **3 支**
//      ⇒ 🔴 **那個「2 支」在【任何一顆 commit 上都不成立】** ——
//        它是「加了 OrdersTab 的連結、而本檔還沒寫進去」那一瞬間的狀態,
//        **只存在於作者當時的工作樹裡,從來沒有進過版控。**
//      📌 **量測的時點與宣稱的時點是兩件事,而寫下來的時候它們長得一樣。**
//    ⇒ 本檔採**時點錨**:「在 `ae7dffa9` 上,這一路只有 `safe-redirect.test.ts` 一支測試碰得到」。而沒被覆蓋到的恰好是這片的**安全面**驗收:
//      驗收 2「不洩存在性」—— 別人的單與不存在的單必須長得一樣
//      驗收 3 走 OD 稿的「查無此訂單」狀態,而不是 Next 的 404 頁
//    ⇒ 四綠不會紅, 而**突變也打不到它**(沒有測試可以變紅)。
//
// 慣例照 `app/page.test.tsx`:node 環境、直接 await 呼叫 server component、
// `renderToStaticMarkup` 出真 HTML,只 stub 會打真 DB 的東西。
// ⇒ 斷言的是**真的渲染出來的 DOM**,不是原始碼的文字。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemberOrderDetail } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }));
// 🔴 **`Header` / `HomeFooter` 2026-08-27 起由本頁渲染**(在那之前這一頁只有一個裸 `<main>`)。
//    它們是 client 元件、內含 `useCart` / `useRouter` ⇒ 不 mock 的話整支檔 9 格紅,
//    而紅的理由是「假件缺出口」與「缺 Provider」—— **與本檔任何一條斷言無關**。
//    ⚠️ **這是換掉殼, 不是動斷言** —— 斷言一個字都沒改。
//    形狀照 `apps/storefront/src/app/page.test.tsx:19`(整個 mock 掉 Header)——
//    repo 另有一種做法是拿 `CartProvider` 包起來(`not-found.test.tsx:21`);
//    這裡選前者, 因為**本檔測的是這一頁自己的邏輯**(授權 / 查無 / 狀態字), 不是站台殼。
//    🔴 而假件**不回 `null`, 回一個看得見的標記** —— 形狀照 `page.test.tsx:19-23`:
//    回 `null` 的話「頁首在」與「頁首不見了」在 DOM 上是同一件事, 而這一片的整個重點就是它不見了。
vi.mock('@/components/Header', () => ({
  Header: ({ currentPage }: { currentPage?: string }) => (
    <div data-stub="site-header" data-current-page={currentPage} />
  ),
}));
vi.mock('@/components/HomeFooter', () => ({
  HomeFooter: () => <div data-stub="site-footer" />,
}));

let currentUser: { id: string } | null = { id: 'owner-1' };
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: currentUser } }) } }),
}));

// 🔴 這個假 repo **刻意複製真 adapter 的行為**:它只認「本人 + 該 displayId」,
//    其餘一律回 `null` —— 而**回 null 這件事本身就是「不洩存在性」的機制**:
//    別人的單與不存在的單,在 caller 眼中是同一個值。
// 🔴🔴 ~~「非 unpaid」~~ **2026-08-24 `#249` 拆掉了那個條件**(Sean 拍【甲】)——
//    unpaid 單(含刷卡卡住的、含已取消的)現在**看得到**,狀態字由取消軸決定。
const findOrderDetailForCustomer = vi.fn();
vi.mock('@/lib/auth/composition', () => ({
  getOrderRepo: () => Promise.resolve({ findOrderDetailForCustomer }),
}));

const money = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });
const OWN_ORDER: MemberOrderDetail = {
  id: 'o1',
  displayId: 'B3XA91',
  createdAt: '2099-04-15T10:00:00Z',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentMethod: 'tappay',
  // 🔵 段 3 加欄:這些 fixture 演的是【已付款的刷卡單】⇒ 填 'tappay',
  //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
  paymentChannel: 'tappay' as const,
  paidAt: '2099-04-18T03:00:00Z',
  shippedAt: null,
  allItemsShipped: false,
  subtotal: money(12000),
  shippingFee: money(100),
  discountTotal: money(0),
  total: money(12100),
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelKind: 'none',
  items: [
    {
      id: 'oi1',
      variantSku: 'SKU-1',
      brand: 'CNC RACING',
      title: '下鏈條蓋',
      spec: { color: 'black' },
      imageUrl: 'https://x/v.jpg',
      vehicle: null,
      quantity: 2,
      unitPrice: money(6000),
      lineTotal: money(12000),
      shipped: false,
    },
  ],
  itemCount: 2,
  itemsTruncated: false,
};

async function renderRoute(displayId: string): Promise<string> {
  const { default: OrderDetailRoute } = await import('./page');
  const el = await OrderDetailRoute({ params: Promise.resolve({ displayId }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  currentUser = { id: 'owner-1' };
  redirectMock.mockClear();
  findOrderDetailForCustomer.mockReset();
  findOrderDetailForCustomer.mockImplementation((displayId: string, customerId: string) =>
    Promise.resolve(displayId === 'B3XA91' && customerId === 'owner-1' ? OWN_ORDER : null),
  );
});

describe('/account/orders/[displayId] 路由', () => {
  it('本人的單 ⇒ 渲染明細(單號 / 品名 / 金額都在)', async () => {
    const html = await renderRoute('B3XA91');
    expect(html).toContain('B3XA91');
    expect(html).toContain('下鏈條蓋');
    expect(html).toContain('NT$ 12,100');
    expect(html).not.toContain('查無此訂單');
  });

  // 🔴🔴 **這是本支最重要的一格(驗收 2)。**
  //    它不是「兩個都查無」而已 —— 是**兩個世界必須印【逐字相同】的東西**。
  //    只要有一天有人為了「比較好懂」把別人的單改成 403 或「這筆不屬於你」,
  //    那句話本身就洩漏了「這張單存在」。這一格會在那天紅。
  it('🔴 別人的單 與 不存在的單 ⇒ 輸出【逐字相同】(不洩存在性)', async () => {
    const someoneElses = await renderRoute('OTHER1'); // 真的存在, 但不是他的
    const doesNotExist = await renderRoute('NOPE99'); // 根本沒有這張單
    expect(someoneElses).toBe(doesNotExist);
    expect(someoneElses).toContain('查無此訂單');
    // 反向那半:不得洩漏任何區別性字眼
    for (const leak of ['403', '無權', '不屬於你', '沒有權限', 'Forbidden']) {
      expect(someoneElses).not.toContain(leak);
    }
  });

  it('🔴 走 OD 稿的「查無此訂單」狀態,不是 Next 404(驗收 3)', async () => {
    const html = await renderRoute('NOPE99');
    expect(html).toContain('查無此訂單');
    // OD 稿 :133-137 的字面與 class(**標題那半仍逐字照稿**)
    expect(html).toContain('acc-empty');
    // 🔴🔴 **2026-08-24 `#249`:副標換掉了,而這一格【紅過】——那是它該做的。**
    //    ~~`訂單編號可能輸入錯誤,或這筆不屬於目前登入的帳號。`~~ = OD 稿字面,
    //    而它對「**我們自己藏起來的、他自己的單**」是假的:它叫客人去重打編號、去換帳號,
    //    兩條都沒用 ⇒ 試完之後最合理的動作就是**再刷一次**。
    //    ⇒ Sean 2026-08-24 拍【甲 = 必做】,三版文案再拍【乙】,逐字:
    expect(html).toContain('您所有的訂單都在訂單記錄裡,回去找找看。若確定是您的,請與客服聯絡');
    // 🔴 **負對照:舊字面必須真的消失** —— 少了這一格,「兩句都在」也會綠。
    expect(html).not.toContain('訂單編號可能輸入錯誤');
    // 負對照:本人的單不得出現這個狀態 —— 否則上面幾格在「永遠查無」時也會綠。
    expect(await renderRoute('B3XA91')).not.toContain('查無此訂單');
  });

  // 🔴🔴 **2026-08-24 `#249`:這一格【整個翻面了】。**
  //    ~~原本:被藏起來的 unpaid 孤兒單在清單看不到 ⇒ 直連網址也必須打不開~~
  //    ⇒ Sean 拍【甲:顯示但標「已取消」/「已逾期」, 不能點去付款】⇒ 那道 `.neq` 兩處都拆了。
  //    ⚠️ **原本那一格在拆完之後【仍然是綠的】** —— 它 mock 的是 `null`,而 `null` 這個回傳值
  //       在「被濾掉」與「真的查無」兩個世界裡長得一樣 ⇒ **它對這次改動零判別力。**
  //       📌 形狀:**一格測試不會因為它描述的世界消失而變紅。**
  //    ⇒ 改成斷言新世界:**客人自己的 unpaid 單現在打得開,而且不是「查無」那個畫面。**
  it('🔴 `#249` 翻面:客人自己的 unpaid 單【打得開】,不再與查無同一個畫面', async () => {
    findOrderDetailForCustomer.mockResolvedValue({
      ...OWN_ORDER,
      paymentStatus: 'unpaid',
      paidAt: null,
      paymentMethod: null,
      // 🔴 **這一處的註解我第一版寫錯了**(code-reviewer nit ①):
      //   它上下文是 unpaid / 取消單, **不是「已付款的刷卡單」** ——
      //   值 'tappay' 站得住(那是它的付款管道), 而**那句理由對這一處是假的**。
      //   📌 我用一句話覆蓋了 10 處, 而其中 3 處演的是別的世界。
      //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
      paymentChannel: 'tappay' as const,
    });
    const html = await renderRoute('B3XA91');
    expect(html).not.toContain('查無此訂單');
    expect(html).toContain('B3XA91');
  });

  it('🔴 已取消的單(仍是 unpaid)⇒ 打得開,而狀態字是「已取消」不是「待付款」', async () => {
    // 🔴 `unpaid` 不是隨手挑的 —— 取消**不動** `payment_status`
    //    (`20260809160000_..._expire_unpaid_orders_fn.sql:18` 逐字「不動 payment_status」)。
    //    這一格紅掉 = 客人會在自己的訂單頁看到一張作廢單寫著「待付款」。
    findOrderDetailForCustomer.mockResolvedValue({
      ...OWN_ORDER,
      paymentStatus: 'unpaid',
      paidAt: null,
      paymentMethod: null,
      // 🔴 **這一處的註解我第一版寫錯了**(code-reviewer nit ①):
      //   它上下文是 unpaid / 取消單, **不是「已付款的刷卡單」** ——
      //   值 'tappay' 站得住(那是它的付款管道), 而**那句理由對這一處是假的**。
      //   📌 我用一句話覆蓋了 10 處, 而其中 3 處演的是別的世界。
      //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
      paymentChannel: 'tappay' as const,
      cancelledAt: '2099-04-16T02:00:00Z',
      cancelKind: 'cancelled' as const,
    });
    const html = await renderRoute('B3XA91');
    expect(html).toContain('已取消');
    expect(html).not.toContain('待付款');
  });

  it('查無 / 非本人 ⇒ 仍是同一個「查無」畫面(這一半沒有變)', async () => {
    findOrderDetailForCustomer.mockResolvedValue(null);
    expect(await renderRoute('NOPE99')).toContain('查無此訂單');
  });

  it('未登入 ⇒ 導 /login 並帶 next 回這一頁(不是回首頁)', async () => {
    currentUser = null;
    await expect(renderRoute('B3XA91')).rejects.toThrow(
      'REDIRECT:/login?next=%2Faccount%2Forders%2FB3XA91',
    );
  });

  // 🔴 codex 關卡2 must-fix 的回歸格:Next 已經解碼過動態段,
  //    再 decodeURIComponent 一次會讓 `%` 拋 URIError ⇒ 繞過查無畫面直接 500。
  it('🔴 displayId 解碼後含裸 `%` ⇒ 不得拋錯,要落到查無畫面', async () => {
    const html = await renderRoute('100%');
    expect(html).toContain('查無此訂單');
    // 而它必須原樣送進 repo(不再解一次)
    expect(findOrderDetailForCustomer).toHaveBeenCalledWith('100%', 'owner-1');
  });

  it('repo 讀取失敗(throw)⇒ 退化查無畫面,不 500', async () => {
    findOrderDetailForCustomer.mockRejectedValue(new Error('connection refused'));
    const html = await renderRoute('B3XA91');
    expect(html).toContain('查無此訂單');
  });

  it('🔴 歸屬:repo 一定被帶著【登入者本人的 id】呼叫(應用層縱深)', async () => {
    await renderRoute('B3XA91');
    expect(findOrderDetailForCustomer).toHaveBeenCalledWith('B3XA91', 'owner-1');
  });

  it('🔴 站台頁首與頁尾都在(2026-08-27 前這一頁只有一個裸 <main>, 客人走不回商店)', async () => {
    const html = await renderRoute('B3XA91');
    expect(html, '頁首不見了').toContain('data-stub="site-header"');
    expect(html, '頁尾不見了').toContain('data-stub="site-footer"');
    // 🔴 順便釘住那個 prop —— `currentPage` 決定導覽哪一格反白;
    //    抄自 `AccountView.tsx:175` 的 `currentPage="account"`, 不自創。
    expect(html, 'currentPage 不是 account ⇒ 導覽反白會落在別頁').toContain('data-current-page="account"');
  });

  it('🔴 負對照:查無那條路【也要】有頁首頁尾(不然客人卡在一個沒有出口的空畫面)', async () => {
    const html = await renderRoute('NOPE-404');
    expect(html).toContain('查無此訂單');
    expect(html, '查無畫面沒有頁首 ⇒ 那才是最需要出口的一頁').toContain('data-stub="site-header"');
    // 🔴 頁尾這一行是 2026-08-27 補的 —— **上一版的標題寫「頁首頁尾」而只斷言了頁首**。
    //    ⇒ 拿掉 `<HomeFooter>` 時只紅 1 格, 而我把那個 1 讀成「設計如此」——
    //      它其實是**少一格**。📌 **標題比斷言寬, 而突變的格數會照著標題被誤讀。**
    expect(html, '查無畫面沒有頁尾').toContain('data-stub="site-footer"');
  });
});
