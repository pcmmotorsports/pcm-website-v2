// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

import { OrderInfoCards } from './order-detail-summary-cards';
import { OrderFocalRow } from './order-focal-row';

// order-detail-headline.test.tsx — 片3 頭條「尾款」那一格的守門(設計稿 §1 區塊①)。
//
// 🔴 **為什麼需要它**:本片加完那一格之後,`components/orders` + `app/orders` 全部 826 格
//    **沒有一格紅、也沒有一格綠是因為它** —— 那一格加上去的當下就沒有任何人在看。
//
// 🔴 **四態必須各自有一格,不能只測 `short`**:它們的**下一步不同**,而畫面上只差一個數字。
//    最危險的是 `unknown` 被答成 `0` —— 那是對員工說「收齊了」,他就不會去催尾款。
//
// ⚠️ **本檔擋得住 / 擋不住**:
//   擋得住 —— 四態任一被合併、`unknown` 被填成數字、`over` 印出負數、整格被刪。
//   **擋不住** —— 三格有沒有真的排成一列、字級、`tracking` 那些。要真瀏覽器 + Sean 的眼睛。

vi.mock('server-only', () => ({}));

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'ABC123',
  createdAt: '2026-08-10T02:00:00+00:00',
  paymentStatus: 'partiallyPaid',
  invoiceStatus: 'not_issued',
  paidAt: null,
  cancelledAt: null,
  orderSource: 'storefront',
  paymentChannel: 'tappay',
  shippingMethod: 'homeDelivery',
  invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: null },
  invoiceNumber: null,
  invoiceAmount: null,
  customer: { name: '沈佑霖', phone: null, email: null },
  customerUserId: null,
  shippingAddress: { name: null, phone: null, line: null },
  total: { amount: 23800, currency: 'TWD' },
  items: [],
  itemsTruncated: false,
  notes: [],
} as unknown as AdminOrderDetail;

const paid = (n: number) => [{ id: 'p1', amount: n }] as never;

/**
 * 🔴🔴 **取【尾款那一格】的值,不是整個容器的文字。**
 *
 * 本檔第一版用 `container.textContent` 比對,而**突變測試當場證明那把尺是壞的**:
 * 把「`unknown` ⇒ 未知」改成「`unknown` ⇒ 0」之後,**四格全綠** ——
 * 因為「未知」**左邊那格(總額/已收)也會印**,`textContent` 分不出是誰印的。
 * ⇒ 那正是本檔要擋的那個 bug,而尺看不見它。
 *
 * ⇒ 改成:找到小標是「尾款」的那個 `<section>`,只讀它的值。
 *   **量具自檢**:找不到那一格就直接 throw —— 「找不到」與「值不對」必須分得開,
 *   否則整格被刪掉時,下面每一條 `not.toContain` 都會**因為什麼都沒有而變綠**。
 *
 * 🔴 **選法本身也自檢過(W4 指出「那個選法就是一個【只看這一段】的決定」)** ——
 *    2026-08-19 四態各跑一次、印出它抓到第幾個 `<section>` 與全部小標:
 *    ```
 *    [short]   n=7 idx=1 val=13,800     labels=總額 / 已收|尾款|件數 已訂 / 到貨|(四張大卡)
 *    [unknown] n=7 idx=1 val=未知
 *    [settled] n=7 idx=1 val=0
 *    [over]    n=7 idx=1 val=溢收 6,200
 *    ```
 *    ⇒ 四態**都抓到同一格、值都正確**,且沒有第二個小標叫「尾款」⇒ 選法不會抓錯。
 *    🔴 **2026-08-19 片14:那個 `n=7` 已經過期,現在是 `n=6`** —— 拿掉了「收件與出貨」那張卡。
 *       `idx` 與四態的值**都沒變**(尾款仍是唯一叫「尾款」的小標)⇒ 選法仍成立。
 *       ⚠️ 上面那塊量測紀錄**刻意不改數字** —— 它記的是那一天量到什麼,改了就不是紀錄了。
 *    ⚠️ 而這只證明「**當時那七個 section 之下**成立」——日後有人再加一格小標叫「尾款」就會撞,
 *       那時 `find` 會回第一個。**不是永久保證,是一次量測。**
 */
/**
 * 🔴 **2026-08-23:那個外殼元件已刪(審查 important 5),本檔改渲染兩個 export。**
 *
 * ⚠️ **而本檔【兩半都要】,不是「換個 import 名」就好** —— 它同時斷言
 *    頭條四態(`OrderFocalRow`)**與**片14 那三張卡的欄位(`OrderInfoCards`)。
 *    ⇒ 併排渲染,**DOM 與刪殼之前逐字相同**(舊殼只多包一層 `-space-y-px`,
 *      而全 repo 測試零處斷言它 —— 實查過)。
 * 🔴🔴 **本檔【零期望值改動】**:四態的 `13,800 / 未知 / 0 / 溢收 6,200`、`labels` 那條、
 *    11 個欄位那條,一個字都沒動。**改的只有「誰把樹畫出來」。**
 */
function renderSummary(payments: Parameters<typeof OrderFocalRow>[0]['payments']) {
  return render(
    <>
      <OrderFocalRow detail={base} payments={payments} />
      <OrderInfoCards detail={base} />
    </>,
  );
}

function balanceCell(payments: Parameters<typeof OrderFocalRow>[0]['payments']): string {
  const { container } = renderSummary(payments);
  // 🔴 **2026-08-27 OD FIX-01**:焦點列不再是三個 `<section>`,而小標「尾款」現在在
  //    數字的**左邊同一基線**(稿上就是這樣),不再是數字下方的 `p:last-of-type`。
  //    ⇒ 改成:找到內容是「尾款」的那個 `<span>`,取它**後面那個兄弟**的文字。
  //    ⚠️ 這把尺與舊版守的是同一件事:**只讀尾款那一格的值,不讀整個容器**
  //       (整個容器在 `unknown` 態會有兩個「未知」⇒ `toContain` 分不出是誰印的)。
  const label = [...container.querySelectorAll('span')].find((el) => el.textContent === '尾款');
  if (!label) throw new Error('找不到小標為「尾款」的那一格 —— 整格被刪掉了?');
  const value = label.nextElementSibling;
  if (!value) throw new Error('「尾款」小標旁邊沒有值 —— 版面結構變了');
  return value.textContent ?? '';
}

describe('片3 頭條「尾款」四態', () => {
  afterEach(cleanup);

  // 🔴🔴 **N1(W6 抓):上面那些格釘住「尾款那格印什麼」,沒有一格釘住「它在哪一格」。**
  //    設計稿 §1 指定它在**中間**;而我寫在 `balanceCell` 註解裡的 `idx=1`
  //    是**一次量測,不是守門** ⇒ 有人調換 section 順序,四態全綠而畫面不照稿。
  //    ⇒ 這一格同時綁住「恰三格」——多一格 / 少一格都不是設計稿那條。
  // 🔴🔴 **2026-08-27 這一格的【期望值改了,而那不是放寬】** —— OD FIX-01(Sean 拍乙)把
  //    「三張卡」換成一條焦點列 ⇒ **舊期望 `['總額 / 已收','尾款','件數 已訂 / 到貨']`
  //    描述的那個版面【已經不存在】**,它不是被我改鬆,是它的對象沒了。
  //    ⚠️ **而 N1 那條理由完全沒有失效**,原文照留:
  //       「上面那些格釘住『尾款那格印什麼』,沒有一格釘住『它在哪一格』…
  //        有人調換順序,四態全綠而畫面不照稿。」
  //    ⇒ 所以本格**改成釘新版面的順序**,而不是刪掉。
  //    🔴 新的不變式(稿 payload 逐字):尾款 → 總額/已收 → 件數,而**尾款是整列唯一的大字**。
  it('🔴 焦點列**依序**是 尾款 → 總額/已收 → 件數(順序被調換 ⇒ 這一格紅,四態格不會紅)', () => {
    const { container } = renderSummary({ status: 'ok', rows: paid(10000) });
    const focal = container.querySelector('[data-od-id="order-focal"]');
    expect(focal, '找不到焦點列 —— 整條被刪掉了?').not.toBeNull();
    // 🔴 **走【直接子元素】而不是 querySelectorAll('span, summary')**:
    //    第一版那樣寫時,`<summary>` 與它【裡面】那個 `<span>` 會被同一段文字數到兩次
    //    ⇒ 印出 4 而不是 3。**那個 4 不是版面錯了,是我的尺重複計數。**
    const roleOf = (el: Element): string | null => {
      if ([...el.querySelectorAll('span')].some((s2) => s2.textContent === '尾款')) return '尾款';
      if (el.tagName === 'P' && el.textContent?.includes('總額 / 已收')) return '總額 / 已收';
      // 🔴 也看小標(nit 9):只看 tagName 的話, 小標被改字它照樣算「件數」。
      if (el.tagName === 'DETAILS' && el.textContent?.includes('件數 已訂 / 到貨')) return '件數';
      return null;
    };
    const kids = [...(focal?.children ?? [])];
    const labels = kids.map(roleOf).filter((r): r is string => r !== null);
    expect(labels).toEqual(['尾款', '總額 / 已收', '件數']);
    // 🔴🔴 **這一行是 code-reviewer 2026-08-27 must-fix 補的,而它補的正是我自己弄丟的那半。**
    //    上面那個 `filter` **靜靜丟掉 `roleOf` 認不得的子元素** ⇒ 有人插進第四格
    //    (例如日後把稿上那個 `order-vehicle` 補回來)`labels` 仍然是三個 ⇒ **全綠**。
    //    而 N1 原文含「**多一格 / 少一格都不是設計稿那條**」⇒ 我留了那句話,卻把它守的東西刪了。
    //    📌 **字面 vs 事實:那半被刪了,而註解說沒有。**
    //    ⇒ 釘住直接子元素的**總數**:尾款組 + 分隔線 + 總額 + 彈簧 + details = 5。
    //    ⚠️ 補車款那格時**這個 5 會變 7**(車款 + 它自己那條分隔線)—— 那時要連同上面那條
    //       `toEqual` 一起改,而不是只把 5 改大。
    expect(kids.length, '焦點列的直接子元素數變了 —— 多一格/少一格都不是設計稿那條').toBe(5);
  });

  it('🔴 稿上的兩個結構件要在:直立分隔線與彈簧(少了它們,間距會塌成一團)', () => {
    const { container } = renderSummary({ status: 'ok', rows: paid(10000) });
    const focal = container.querySelector('[data-od-id="order-focal"]');
    // 🔴 **先釘住 focal 本身**(code-reviewer 2026-08-27 nit):原本寫 `focal?.querySelector(...)`
    //    ⇒ 焦點列**整條不見**時它回 `undefined`,而 `.not.toBeNull()` 對 `undefined` 是【通過】
    //    ⇒ 這兩格會在最該紅的那個世界靜靜地綠,只剩下面那條負對照會紅,而它的訊息與病因無關。
    expect(focal, '焦點列整條不見了').not.toBeNull();
    const divider = focal!.querySelector('div.bg-border.h-8.w-px');
    const spring = focal!.querySelector('span.flex-1');
    expect(divider, '稿上的直立分隔線不見了').not.toBeNull();
    expect(spring, '稿上的彈簧不見了').not.toBeNull();
    // 🔴 **釘住 `max-sm:hidden`**(nit 7):那是本片唯一從 FIX-80 搬過來的行動 ——
    //    稿逐字 `orders-admin-v2.html:5772-5773` 對這兩個元素寫 `display:none`。
    //    拿掉它 ⇒ 390px 下換行後分隔線與彈簧會吊在行尾(真瀏覽器量到過),而**沒有任何測試會紅**。
    expect(divider!.className, '分隔線少了 max-sm:hidden ⇒ 窄螢幕會吊在行尾').toContain('max-sm:hidden');
    expect(spring!.className, '彈簧少了 max-sm:hidden ⇒ 同上').toContain('max-sm:hidden');
    // 🔴 負對照:一個稿上【沒有】的東西必須抓不到, 否則上面兩格是恆真的。
    expect(focal!.querySelector('div.zzz-not-in-design')).toBeNull();
  });

  it('🔴 `short` ⇒ 印差額(設計稿那一格:23,800 / 10,000 ⇒ 13,800)', () => {
    expect(balanceCell({ status: 'ok', rows: paid(10000) })).toBe('13,800');
  });

  it('🔴🔴 `unknown`(收款列讀不到)⇒ 印「未知」,**絕不印 0** —— 0 = 對員工說「收齊了」', () => {
    // 🔴 用 `toBe` 不是 `toContain`:`toContain('未知')` 在整格印成 `0` 時**仍可能綠**
    //    (左邊那格也印「未知」)—— 第一版就是這樣被突變測試打回來的。
    expect(balanceCell({ status: 'unreadable' } as never)).toBe('未知');
  });

  it('🔴 `settled` ⇒ 真的印 `0`,不是留白(留白讀起來像「還沒算」)', () => {
    expect(balanceCell({ status: 'ok', rows: paid(23800) })).toBe('0');
  });

  it('🔴 `over` ⇒ 印「溢收 N」,**不印負數**(負的尾款會被讀成「還要收 -N」)', () => {
    const v = balanceCell({ status: 'ok', rows: paid(30000) });
    expect(v).toBe('溢收 6,200');
    expect(v).not.toContain('-');
  });
});

// ── 🔴 片14(2026-08-19):拿掉「收件與出貨」那張卡之後的【負向對照】──
//
// 🔴 **為什麼這一節是 must-fix 補上的**:片14 的 plan 原本把「另外三張卡逐欄仍在」
//    寫成一條 **yes/no 的自評**,而同一張驗收表裡其他條都有可跑的命令
//    ⇒ **同一張表兩種證據等級,而讀的人看不出來**(W6 P3)。自評擋不住「我以為我沒刪」。
//
// 🔴 **這一節守的是【沒被順手刪掉】,不是【它們應該存在】** —— 後者還沒拍板:
//    這三張卡有 4 個欄位在三份設計稿上都沒有落點(客人電話 / Email / 來源 / 統編),
//    要不要留是 Sean 的題。**在他答之前,少一個欄位都要有東西紅。**
describe('🔴 片14:剩下三張卡的欄位一個都不能少(負向對照)', () => {
  const render3 = () => renderSummary({ status: 'ok', rows: [] });

  it('「收件與出貨」那張卡已經不在(它 4 個欄位已搬進出貨區)', () => {
    const { container } = render3();
    // 正向錨:元件真的渲染了。少了它,下面那條否定式在「整個元件回 null」時會恆綠。
    expect(container.textContent, '摘要卡整塊沒渲染 ⇒ 下面那條會恆綠').toContain('客戶資訊');
    expect(container.textContent).not.toContain('收件與出貨');
  });

  it('🔴 三張卡的標題與 11 個固定欄位逐一還在', () => {
    const { container } = render3();
    const text = container.textContent ?? '';
    // 🔴 逐一斷言、不是數個數 —— 數量對得起來而換掉其中一個,數量法看不見。
    for (const label of [
      '客戶資訊', '姓名', '電話', 'Email',
      '付款', '付款狀態', '出貨狀態', '來源 · 管道', '付款時間',
      '發票', '需求型式', '開立狀態', '發票號碼', '發票金額',
    ]) {
      expect(text, `摘要卡少了「${label}」—— 片14 只該拿掉「收件與出貨」那一張`).toContain(label);
    }
  });

  // 🔴 **這一格第一版釘的是 `@4xl:grid-cols-3`,而那一版在【面板】裡是壞的** ——
  //    3 張卡在 `@md` 的兩欄下排成 2+1,**右下角多一個被 `gap-px bg-border` 畫出來的空灰格**。
  //    整頁版命中 `@4xl` 排 3 欄、看起來正常 ⇒ **只有面板破,而面板是 Sean 在看的那一面。**
  //    ⚠️ **測試那時是綠的** —— 它釘的是字面,而字面是對的;壞的是那個字面在另一個容器寬度下的效果。
  //    ⇒ **這一格永遠擋不住那種病。擋住它的是開瀏覽器。** 留這行是為了不讓下一個人以為它擋得住。
  it('欄數與頭條同一組斷點(`@md:grid-cols-3`),不是 viewport 斷點', () => {
    const { container } = render3();
    // 🔴 **第一版的選法是錯的,而它【看起來對】**:`querySelector('[class*="grid-cols"]')`
    //    抓到的是**頭條那三格**(`grid gap-px border bg-border @md:grid-cols-3`)——
    //    它同樣有 `gap-px bg-border`、同樣叫 grid-cols-3,**斷言差一點就綠著通過**。
    //    ⇒ 錨改成「**裝著三張卡的那個 grid**」:用它的內容(客戶資訊)認,不用它的 class 認
    //      (用 class 認等於拿要驗的東西當錨,那是循環)。
    const grid = [...container.querySelectorAll('div[class*="grid-cols"]')].find((el) =>
      el.textContent?.includes('客戶資訊'),
    );
    expect(grid, '找不到裝著三張卡的 grid ⇒ 下面兩條會恆綠').toBeDefined();
    expect(grid?.className).toContain('@md:grid-cols-3');
    // 🔴 負向:不得退回兩欄(那正是「多一個空格」那一版)。
    expect(grid?.className).not.toContain('grid-cols-2');
  });
});
