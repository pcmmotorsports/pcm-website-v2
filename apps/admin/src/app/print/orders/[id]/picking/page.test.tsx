// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// #10 片1:揀貨單列印頁的守門。
//
// 🔴 每一格都對應一種**會靜默壞掉**的改法(不是「有渲染就好」的煙霧測試):
//   ①投影沒接上畫面 ②金額/收件資訊漏印上紙 ②b 表格被改成 div(跨頁表頭失效)
//   ③清單沒載完卻照印 ③b 反向(沒截斷時不該有警告)④非 UUID 打 DB ④b 查無卻印空白紙
//   ⑤族 = 「揀貨單不反映貨的真實狀態」(R1 must-fix 3+4,整單取消/部分取消/未到貨/已出貨/不知道)
//   ⑥三顆 `print:hidden` 被刪掉 ⑦登入閘 matcher 被改窄

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

const mocks = vi.hoisted(() => ({ findAdminOrderDetail: vi.fn() }));
vi.mock('../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));

import OrderPickingPrintPage from './page';
import { pickableQuantity } from '../../../../../components/print/picking-doc';

const ORDER = '11111111-1111-4111-8111-111111111111';
const SRC = join(__dirname, '..', '..', '..', '..', '..');

// 🔴🔴 **金額欄位一個都不留 0**(R1 must-fix 5)。第一版 `shippingFee`/`discountTotal` 都是 0,
//    而格②只擋 `12345`/`86415` ⇒ **有人在揀貨單加一列「運費」,那格照樣綠**,而真訂單的運費不是 0。
//    現在六個金額欄各給一個互不相撞、也不與數量/料號/單號/日期相撞的值,並且**整組**進 not.toContain。
const MONEY = {
  unitPrice: 12345,
  lineTotal: 86415,
  shippingFee: 611,
  discountTotal: 733,
  subtotal: 51987,
  total: 52598,
} as const;
const MONEY_VALUES = Object.values(MONEY);

// 數量刻意全用兩位數且彼此不同(nit-8:單字元斷言換 fixture 就可能靜默恆綠)。
const QTY = { bought: 53, instock: 41, shipped: 15 } as const;
const PICKABLE = QTY.instock - QTY.shipped; // 26
const PHONE = '0987654321';
const ADDRESS = '台北市信義區松高路 1 號';

type Over = Partial<AdminOrderDetail> & { summary?: unknown };

function detail(over: Over = {}): AdminOrderDetail {
  const { summary, ...rest } = over;
  // `as unknown as`:Money 是 branded type(慣例同 `app/orders/[id]/nine-code-retire.test.tsx`)。
  return {
    id: ORDER,
    displayId: 'PCM-2026-0042',
    createdAt: '2026-08-04T02:00:00+00:00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'bank_transfer',
    paymentMethod: null,
    paidAt: null,
    subtotal: { amount: MONEY.subtotal, currency: 'TWD' },
    shippingFee: { amount: MONEY.shippingFee, currency: 'TWD' },
    discountTotal: { amount: MONEY.discountTotal, currency: 'TWD' },
    total: { amount: MONEY.total, currency: 'TWD' },
    shippingMethod: 'home',
    shippingAddress: { name: '收件人小明', phone: PHONE, line: ADDRESS },
    customer: { name: '王小明', email: 'a@b.c', phone: PHONE },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    items: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        variantSku: 'LTC-BK-XL',
        title: '前叉防甩頭',
        spec: { 顏色: '黑', 尺寸: 'M' },
        quantity: QTY.bought,
        unitPrice: { amount: MONEY.unitPrice, currency: 'TWD' },
        lineTotal: { amount: MONEY.lineTotal, currency: 'TWD' },
        procurements: [],
        procurementTruncated: false,
        quantitySummary:
          summary === undefined
            ? {
                quantity: QTY.bought,
                orderedQuantity: QTY.bought,
                instockQuantity: QTY.instock,
                cancelledQuantity: 0,
                shippedQuantity: QTY.shipped,
                cancellableQuantity: 0,
              }
            : summary,
      },
    ],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
    ...rest,
  } as unknown as AdminOrderDetail;
}

async function renderPage(id = ORDER) {
  const ui = await OrderPickingPrintPage({ params: Promise.resolve({ id }) });
  const result = render(ui);
  // 🔴 **分母守門(2026-08-28 突變量到本檔八格是恆綠的)**:本檔大量斷言的形狀是
  //    「紙上**不得**出現某個字面」/「沒有列印鈕」/「沒有警告」——
  //    而**整頁沒渲染時它們全部成立** ⇒「那東西正確地沒印」與「這張紙根本沒印出來」
  //    印同一個綠。放進共用的 renderPage:一道蓋住全檔, 新加的格自動有分母。
  //    ⚠️ 被擋的世界也算「有渲染」(它印一張只有 <Alert> 的紙)⇒ 錨要涵蓋 role="alert"。
  //    釘節點數(結構), 不釘任何一句文案。
  expect(
    result.container.querySelectorAll('h1, h2, [role="alert"]').length,
    '整張紙一個標題節點、一則 alert 都沒有 ⇒ 頁面根本沒渲染 ⇒ 本格的負向斷言恆真',
  ).toBeGreaterThan(0);
  return result;
}
const textOf = (c: HTMLElement) => c.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
});
afterEach(() => cleanup());

// 🔴🔴 **[2026-08-31 改名 —— 而它不是「順手改個字」]**
//   ⛔ ~~`describe('#10 片1 揀貨單列印頁')`~~ ⇒ 這一格【自己的斷言】就是 `not.toContain('揀貨單')`。
//   📌 **測試的【名字】與它斷言的【事實】相反 —— 而它【不會紅】**(斷言是對的, 只有名字錯)
//   ⇒ **它只誤導【讀測試輸出的人】, 而測試輸出正是我們拿來當證據的東西。**
//   背景:「揀貨單」2026-08-23 已由 Sean 拍板改名為「訂單明細」(見 `picking-doc.tsx` 檔頭)。
//   🛑 **而路由名 `picking` 刻意不改**(改它要動連結)⇒ 不算缺陷, 也不要順手改。
describe('#10 片1 訂單明細列印頁(路由仍叫 picking)', () => {
  it('①把投影接上畫面:單號 / 料號 / 品名 / 規格都印得出來', async () => {
    const t = textOf((await renderPage()).container);
    // 🔴 `#240`/Q1-A1(2026-08-23):~~expect(t).toContain('揀貨單')~~ ⇒ 抬頭已改名。
    //    原句留在這裡, 因為它記著「這一格【一直】在守抬頭字面」——
    //    改名的時候它紅了, 那正是它該做的事。
    expect(t).toContain('訂單明細');
    expect(t).not.toContain('揀貨單');
    expect(t).toContain('PCM-2026-0042');
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('前叉防甩頭');
    expect(t).toContain('顏色: 黑');
  });

  it('①b🔴 抬頭那張 LOGO 不得是一個【要登入才拿得到的網址】', async () => {
    // 🔴 **為什麼這一格要在【這張紙】上也寫一次**(2026-08-29 線A;主視窗 `-06` 指出):
    //    LOGO 住在共用的 `PrintMasthead`,而出貨單那支測試已經有同款守門
    //    ⇒ **看起來「已經有人在守」了**。而那道守門讀的是【出貨單那條 render 路徑】,
    //      它對「揀貨單有沒有把 masthead 接上」完全失明 —— 少接了它也照樣綠。
    //    📌 ⇒ 一個共用元件的守門,不會自動覆蓋每一個用它的地方。
    //       ⇒ 兩張紙各斷言一次,不要靠一支通用的守門。
    // 病:`/print/…` 走 `proxy.ts` 的登入閘 ⇒ 沒有 cookie 的請求(伺服器渲染出圖)被 303,
    //    而症狀是【圖不見了,不是錯誤】—— 三綠全綠、零告警。修法見 `components/print/print-assets.ts`。
    const { container } = await renderPage();
    const imgs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    // 分母:綁【抬頭那顆 LOGO 在不在】, 不是綁「這張紙上有圖」。
    // 🔴 這裡是【新增一道錨】, **不是取代** —— 下面那行 `toBeGreaterThan(0)` 保留著。
    //    (2026-08-29 R2 抓到:原句寫成 `⛔ ~~原本寫 …~~`, 而被劃掉的那一行就活在兩行之下
    //     ⇒ **這支檔在對自己說謊**, 與它上一顆修掉的那個病同族、方向相反。)
    //    理由 2026-08-29 code-reviewer:
    //    今天 picking-doc 只有 1 顆 `<img>`(唯一來源 = `PrintMasthead`)⇒ 那個分母今天守得住;
    //    **而日後任何人加第二張 data-URI 圖 ⇒ masthead 掉了它照樣綠。**
    //    📌 一個「今天剛好等價」的分母, 會在別人加東西的那天安靜失效, 而沒有訊號。
    expect(container.querySelectorAll('.pd-logo')).toHaveLength(1);
    expect(imgs.length).toBeGreaterThan(0);
    for (const src of imgs) {
      expect(src?.startsWith('data:image/png;base64,')).toBe(true);
      expect(src).not.toMatch(/^\/print\//);
      expect(src).not.toMatch(/^https?:\/\//);
      expect(src).not.toMatch(/^\/_next\//);
    }
  });

  // 🔴🔴 A3-4'(2026-08-29):~~②「揀貨單上不得有任何金額欄位, 也不得有收件電話 / 地址」~~
  //    **整格反轉**, 而它是【兩個拍板】的後果, 不是放寬:
  //    ① `Q-DETAIL-MONEY` Sean 2026-08-29 拍【甲 要印金額】
  //       （落檔:~/pcm-mailbox/等Sean決策-20260829.md;理由「訂單明細 = 完整的一張訂單」）
  //    ② PII Sean 2026-08-29 拍【甲 要(照稿)】⇒ 推翻 `page.tsx:19` 那條「只印姓名」
  //       （落檔 `memory/project_0829-sean-order-detail-prints-full-pii.md`, 含原句與代價）
  //    🛑 而原本那道守門【是用突變驗過的】—— 它對【揀貨單】是正確的。
  //       這張紙已經不是揀貨單了(Sean 08-23)⇒ 反轉的是【對象】, 不是紀律。
  //    📌 ⇒ 所以這一格改成守【現在該有的東西】, 而不是刪掉它。
  it("②' 訂單明細【必須】有金額三欄與收件資訊 —— 兩者都是 Sean 2026-08-29 拍板要的", async () => {
    const { container } = await renderPage();
    const rows = container.querySelectorAll('.pd-items tbody tr[data-slot="picking-item"]');
    // ✅ 正對照:確認 fixture 真的渲染了品項 —— 否則下面全是恆真
    expect(rows.length).toBeGreaterThan(0);
    const html = container.innerHTML;
    // 金額:表頭三欄 + 頁尾金額區
    expect(container.querySelector('.pd-money')).not.toBeNull();
    expect(html).toContain('單價');
    expect(html).toContain('小計');
    expect(html).toContain('訂單金額');
    // 收件資訊:姓名 / 電話 / 地址三格
    expect(container.querySelector('.pd-info')).not.toBeNull();
    expect(html).toContain('姓名');
    expect(html).toContain('電話');
    expect(html).toContain('地址');
  });

  it('②b🔴 品項清單必須是真的 `<table>` + 真的 `<thead>`(跨頁表頭靠它)', async () => {
    // 🔴 守的是列印時第 2 頁還有沒有欄名,而那件事單測量不到(沒有分頁概念)。
    //    2026-08-15 真瀏覽器 + 真 A4 PDF 量過:30 項時第 2 頁上緣**有**四個欄名,
    //    把 `thead` 打成 `table-row-group` 之後**就沒有了**(負向對照,詳 `picking-doc.tsx` 該段)。
    //    ⇒ 那是瀏覽器對「真 table + 真 thead」的原生保證,**不是我們寫的 CSS**
    //    ⇒ 唯一會弄壞它而畫面看不出來的改法 = 把表格改成 div 排版。這格釘那條路。
    //    ⚠️ 誠實:本格**不能**證明第 2 頁真的有欄名,它證明的是那個保證的**前提還在**。
    const { container } = await renderPage();
    const thead = container.querySelector('table > thead');
    expect(thead).not.toBeNull();
    // 🔴 **2026-08-17 `Q-C20` 之後 `thead` 是兩列**:第 1 列續頁抬頭、第 2 列才是欄名。
    //    ⚠️ 本格原本把 `thead` 底下**所有** `th` 攤平比對成四個字串,
    //       而那寫法把「欄名有哪幾個」與「thead 裡有沒有別的列」**綁成同一個斷言** ——
    //       加抬頭那一列時它會紅,而**紅的理由讀起來像「欄名壞了」**。⇒ 改成逐列各自斷言。
    const headRows = [...(thead?.querySelectorAll(':scope > tr') ?? [])];
    // 🔵 **2026-08-30 Sean 拿掉續頁抬頭那一列** ⇒ ~~`toBe(2)`~~ ⇒ `thead` 只剩欄名一列。
    //    ⇒ 而欄名列的索引跟著從 `[1]` 變成 `[0]` —— **兩處要一起改**:
    //      只改數字不改索引的話,`headRows[1]` 會是 `undefined` ⇒ 攤平出空陣列
    //      ⇒ 📌 **它會與「欄名全被刪光」印同一個綠**(兩者都是 `[]`)。
    expect(headRows.length).toBe(1);
    expect(
      [...(headRows[0]?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim()),
    // 🔴 A3-3'(2026-08-29):~~['✓', '料號', '品名 / 規格', '應揀數量']~~
    //    勾選欄拿掉（Sean 08-23 + 08-29 Q-PICKORDER 甲）、「應揀數量」⇒「數量」（照稿）。
    //    🛑 而稿的表頭是【六欄】:料號 | 品名 / 規格 | 狀態 | 數量 | 單價 | 小計
    //       ⇒ 本片只到三欄，狀態 / 單價 / 小計是下一片。
    //       ⚠️ 所以這一格【現在守的是一個中間狀態】—— 它會在下一片再改一次，那是預期的。
    ).toEqual(['料號', '品名 / 規格', '狀態', '數量', '單價', '小計']);
    // 🔴🔴 **這一格【刻意】數整個 tbody 的列,不收窄成 `[data-slot="picking-item"]` ——**
    //    審查(2026-08-29)問過同一句:它與 `:160` 改前同款、同一個 `<tbody>`、同一個假紅面。
    //    ⇒ 保留的理由:本格 fixture 的 `itemsTruncated` 是預設的 `false`(:109)
    //      ⇒ 這個世界裡截斷列出現 = **真的壞了**, 數全部列紅得對(而 `:160` 的世界有截斷 ⇒ 那裡要收窄)。
    //      📌 **同一個寫法, 在兩個 fixture 底下一個是缺陷、一個是守門 —— 而 diff 上長得一樣。**
    //
    // 🔴🔴 **R2 抓到:這裡原本寫「唯一結構捕手 / 收窄則歸零 / 零訊號」—— 三句全稱句我【沒有量過】。**
    //    實跑那一發(`picking-doc.tsx:386` 的 `detail.itemsTruncated` ⇒ `true`)⇒ **6 格紅**。
    //    🔴 **用錨字列, 不用行號** —— 我上一版寫了 6 個行號, 而**寫下它們的那次插入自己讓它們全漂了**:
    //      ① 新補的 `picking-truncated-band` 那條(就在本格上面那個 `it` 裡)
    //      ② 本格(`table > tbody > tr`)
    //      ③ `⑤面2/3/4 放大的數字` ④ `⑤面5 quantitySummary 為 null`
    //      ⑤ `⑤面3b 應揀量為 0` ⑥ `而沒有截斷時,那段標記必須【整段不在】`
    //    ⇒ **「唯一 / 歸零 / 零訊號」三句都是假的。**
    //    📌 而危害不在紅不紅(它偏保守), 在於**它是寫給下一個人的行動指引** ——
    //       真的需要動這一行的人會相信「收了就零訊號」而不敢動。
    //    ⚠️ **要動這一行之前**:先確認上面那個 `it` 裡的 `picking-truncated-band` 斷言還在
    //       (它的失敗訊息最直指結構, 這才是保留本格的真正理由 —— 不是因為別處沒有)。
    expect(container.querySelectorAll('.pd-items table > tbody > tr').length).toBe(1);
  });

  it('②c🔴 `Q-C20` 續頁抬頭:訂單編號必須在 `<thead>` 【裡面】,不是在頁面上任何地方', async () => {
    // 🔴 **這一格守的是「第 2 頁認得出是哪一張單」**,而它的關鍵不是「頁面上有沒有訂單編號」——
    //    頁首本來就印著一個(`picking-doc.tsx` 的 `<h1>` 旁邊)。
    //    **只有在 `<thead>` 裡的那一份會被瀏覽器逐頁重複。**
    //    ⇒ 所以本格斷言的是**位置**不是**存在**:把這一列搬出 `thead`(例如挪去 `<caption>`
    //      或表格上方的 div),畫面上看起來幾乎一樣、`textContent` 也照樣含訂單編號,
    //      而**第 2 頁會變回沒有單號** —— 那條路只有這個位置斷言擋得住。
    // ⚠️ 誠實:本格**證不了**第 2 頁真的印出來了(單測沒有分頁概念),
    //    它證的是那個原生保證的**前提還在**。真的印出來看過的紀錄在
    //    `docs/specs/2026-08-17-qc5-tracking-off-paper-decommission-list.md` §4b-4。
    const { container } = await renderPage();
    // ⛔ ~~`const contbar = …'tr.pd-contbar > th'; expect(contbar).not.toBeNull();`~~
    //    **2026-08-30 Sean 拿掉那一列**(逐字「我不要這些奇怪標語」+「訂單明細 也比照上面修正的伴了」)。
    // 🔴 **所以本格盯的那件事【現在沒有東西在守】** —— 它守的是「第 2 頁認得出是哪一張單」,
    //    而那個保證的載體(`<thead>` 裡的訂單編號)被他拿掉了。
    //    ⇒ ⇒ 這不是「測試過期」,是**一個保護被拍板拿掉了**。寫在這裡,不留白。
    // ✅ 改成盯它現在還守得住的那一半:**`<thead>` 這個結構本身還在**
    //    —— 跨頁欄名重複靠的是它,那一格沒有被這次改動碰到。
    const contbar = container.querySelector('.pd-items table > thead > tr.pd-contbar');
    expect(contbar, '續頁抬頭那一列已由 Sean 2026-08-30 拿掉 ⇒ 它必須【不在】').toBeNull();
    // 🔴 A3-4'(2026-08-29):~~contbar 要含「品項明細」~~ ⇒ 稿把那四個字放在
    //    表格【外面】的 `<h2 class="pd-sech">`, 而 contbar 逐字是 `訂單 <b>XXX</b><i>續頁欄名重複</i>`。
    //    ⇒ 本格守的是【第 2 頁認得出是哪一張單】⇒ 真正要釘的是**訂單編號在 thead 裡**（下一行）。
    //    ✅ 而「品項明細」那個標題仍然要在紙上, 只是不在這一列 ⇒ 分成兩個斷言。
    // 🔵 標題「品項明細」**留著**(Sean 拿掉的是它後面那句解釋小字「本訂單全部品項」)。
    expect(container.querySelector('.pd-items > .pd-sech')?.textContent).toContain('品項明細');
    // 🔴 而那句解釋小字必須【不在】—— 這一行是本次那一改的證人。
    expect(container.querySelector('.pd-items > .pd-sech')?.textContent).not.toContain('本訂單全部品項');
    // 🔵 **正對照:欄名列還在**(證上面那兩個 `toBeNull` / `not.toContain` 不是因為整張表沒渲染)。
    const headCols = container.querySelectorAll('.pd-items table > thead > tr')[0]?.querySelectorAll('th').length;
    expect(headCols, '欄名列必須還在 —— 否則上面那些「不在」是因為整張表沒渲染').toBeGreaterThan(0);
  });

  it('③品項沒載完 ⇒ fail-closed 明說「不要拿這張去揀貨」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
    const { container } = await renderPage();
    expect(textOf(container)).toContain('不要拿這張去揀貨');
  });

  // 🔴 **2026-08-17:舊文案逐字「請重新整理後再列印」是一句假話** —— 觸發它的是固定上限
  //    (`ORDER_ITEMS_EMBED_LIMIT = 200`,`packages/adapters/src/supabase/mappers/order.ts:406`)
  //    ⇒ 重整一百次拿回同一個數字。**這張紙比出貨明細單更該修:倉庫真正拿在手上的是它。**
  //    ⚠️ **禁的是【詞根】不是祈使形白名單** —— 白名單版在 `shipping-doc` 那片被穿透兩次
  //    (「請重新整理再列印一次」/「麻煩您重新整理一下再列印看看」都全綠)⇒ 中文祈使形舉不完。
  it('🔴 ③a 截斷文案不得叫他做會失敗的動作(禁詞根)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
    const t = textOf((await renderPage()).container);
    for (const bad of ['重新整理', '重試', '再試一次', '稍後']) {
      expect(t, `文案叫員工做一件永遠不會成功的事:${bad}`).not.toContain(bad);
    }
    // 正向對照:仍要給一條真的做得到的下一步,否則這格會退化成「把話刪掉就過」。
    expect(t).toContain('聯絡負責人');
  });

  // 🔴 **改之前這顆鈕在警告【上面】、不受影響** ⇒ 兩種「不該拿去揀貨」的狀態下
  //    員工都按得下去,印出一張紙照樣進倉庫。
  //    ⚠️ 三格成對:兩個反面 + 一個正面。少了正面那格,把整顆鈕刪掉也會綠。
  //    ⚠️ 釘「文字剛好是【列印】的 button」而不是 `querySelector('button')` ——
  //       後者會因為這頁日後加任何一顆鈕而誤紅(`shipping-doc` 那片 R1 nit8 的原話)。
  describe('🔴 不該揀的紙上不得留下一顆按得下去的列印鈕', () => {
    const printButtons = (c: HTMLElement) =>
      [...c.querySelectorAll('button')].filter((b) => b.textContent === '列印');

    it('訂單已取消 ⇒ 沒有列印鈕', async () => {
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ cancelledAt: '2026-08-05T02:00:00+00:00' }),
      );
      expect(printButtons((await renderPage()).container)).toHaveLength(0);
    });

    it('品項沒載完 ⇒ 沒有列印鈕', async () => {
      mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
      expect(printButtons((await renderPage()).container)).toHaveLength(0);
    });

    it('🔴 `#601` 讀不到任何品項 ⇒ 沒有列印鈕(落地前這一種【還有】鈕)', async () => {
      // 鈕條件原本只看 `cancelledAt` 與 `itemsTruncated`,`items.length === 0` 不在裡面
      // ⇒ 紙上寫「讀不到任何品項」而我們自己遞了刀。**鈕與紙的條件不一致 = 守門裝在一半的路上。**
      mocks.findAdminOrderDetail.mockResolvedValue(detail({ items: [] }));
      expect(printButtons((await renderPage()).container)).toHaveLength(0);
    });

    it('🔴 正向對照:一切正常 ⇒ 列印鈕還在(證明上三格不是「這顆鈕根本不存在」)', async () => {
      const { container } = await renderPage();
      expect(printButtons(container)).toHaveLength(1);
      // 🔴 **`data-slot` 那個選取器的正向對照** —— 別處那幾格用它斷言「鈕不在」,
      //    而**選不到的選取器會讓那些斷言恆真**。這一行證明它真的選得到。
      //    (我第一版寫那些斷言時 `print-button.tsx` 上還沒有這個 attribute ⇒ 恆真,當場發現。)
      expect(container.querySelector('[data-slot="print-button"]')).not.toBeNull();
    });
  });

  it('③b 一切正常時不得出現任何警告(否則上面幾格恆綠)', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('④id 非 UUID ⇒ 不打 DB、直接 notFound', async () => {
    await expect(renderPage('not-a-uuid')).rejects.toThrow('notFound');
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
  });

  it('④b 查無訂單 ⇒ notFound(不印出一張空白的紙)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('notFound');
  });
});

// 🔴🔴 R1 must-fix 3+4 是**同一個病的兩個面**:「揀貨單不反映貨的真實狀態」。
//    折的時候先列了這病的全部面(見 `picking-doc.tsx` 的 `pickableQuantity` docstring),
//    這個 describe 逐面釘住,不只釘被 reviewer 指名的那兩處。
// 🔴 同上(2026-08-31):⛔ ~~「揀貨單必須反映貨的真實狀態」~~ ⇒ 這張紙已經是【訂單明細】。
describe('#10 片1 🔴 訂單明細必須反映貨的真實狀態', () => {
  it('⑤面1 整單已取消 ⇒ 出警告**而且不印品項表**(印出來就會有人照著去揀)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ cancelledAt: '2026-08-05T02:00:00+00:00' }),
    );
    const { container } = await renderPage();
    // 🔴 **2026-08-17 `#601` A 種落地之後,這一格的字面換過** ——
    //    原本斷言 `toContain('已取消')` 與 `toContain('不要揀貨')`,而那兩個字面來自
    //    舊的一行 `<Alert>`。現在是整幅 `BlockedSheet`:原因寫「已於 … 取消」、
    //    「不要揀貨」那句在四條動作裡是「不要依本單揀貨、裝箱或出貨。」
    //    ⚠️ **兩個【意思】都還在,是【字面】變了** ⇒ 本格改成斷言意思落在哪一塊裡,
    //       而不是斷言那兩串字。**這不是放寬:下面多了位置與條目數兩條。**
    const panel = container.querySelector('[data-slot="print-blocked"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('取消');
    expect(panel?.textContent).toContain('不要依本單揀貨、裝箱或出貨。');
    expect(panel?.textContent).toContain('本頁不含品項明細');
    // 四條動作的條目數也釘住(少一條 = 少一個動作,而少掉的那條可能正是最貴的情境)。
    expect(panel?.querySelectorAll('li').length).toBe(4);
    // 🔴 這一條才是真的守門:表格不存在 ⇒ 沒有東西可以照著揀。
    expect(container.querySelector('table')).toBeNull();
    expect(textOf(container)).not.toContain('LTC-BK-XL');
    // 🔴 而且**不再遞刀**:這一種狀態下列印鈕不該在(⌘P 擋不住,但我們不主動給)。
    expect(container.querySelector('[data-slot="print-button"]')).toBeNull();
  });

  it('🔴 `#601` C 種:讀不到任何品項 ⇒ 整幅阻印版面,而且**列印鈕不再照給**', async () => {
    // 🔴 **落地前這一種的鈕【還在】** —— 鈕條件只看 `cancelledAt` 與 `itemsTruncated`,
    //    `items.length === 0` 不在裡面 ⇒ 紙上寫「讀不到任何品項」,而我們自己遞了刀。
    //    ⇒ **鈕的條件與紙的條件不一致 = 守門裝在一半的路上。**
    // ⚠️ 這一種的文案保留「請重新整理」是刻意的:它與 `itemsTruncated` 不同 ——
    //    那一種是固定上限(重整一百次拿回同一個數字),這一種是投影出問題、重整真的可能好。
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ items: [] }));
    const { container } = await renderPage();
    const panel = container.querySelector('[data-slot="print-blocked"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('讀不到任何品項');
    expect(panel?.querySelectorAll('li').length).toBe(4);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[data-slot="print-button"]')).toBeNull();
  });

  // 🔴🔴 A3-3'(2026-08-29, codex R2 must-fix 1):以下三格【刻意反轉】, 原標題留痕:
  //    ~~⑤面2/3/4 放大的數字是「已到貨 − 已出貨」,不是下單量~~
  //    ~~⑤面5 quantitySummary 為 null ⇒ 明說不知道, 絕不補 0、也絕不印下單量~~
  //    ~~⑤面3b 應揀量為 0 ⇒ 用字說「這次不用揀」~~
  //
  //    🛑 **那三條紀律對【揀貨單】是正確的** —— 揀貨的人要知道「這次要動手拿幾個」,
  //       而印下單量會讓他拿錯。
  //    ✅ **而這張紙已經不是揀貨單了**(Sean 2026-08-23「原揀貨單鈕改成訂單明細」
  //       + 2026-08-29 `Q-PICKORDER` 拍甲)⇒ 它是【這張訂單的完整明細】。
  //    ⇒ 稿(OD `pcm-524f/預覽-訂單明細.html`)那一欄印的是**訂購數量**:
  //       第一列逐字 `PR333-PR333B | 下鏈條蓋… | 未到貨 1 | 1 | 1,400 | 1,400` ⇒ 數量欄 = 1。
  //    🔴 而 codex 抓到的正是這一格:欄名改成「數量」而數字還是應揀量
  //       ⇒ 它的實例逐字「訂購 53、到貨 41、已出貨 15 ⇒ 訂單明細會把數量印成 26」。
  //    ⚠️ **「數量資料尚未就緒」那個資訊沒有消失** —— 它在頁首那顆 Alert 裡(上面那格在守),
  //       而稿把它放在【狀態】欄 ⇒ **那一欄是下一片**。
  it("⑤面2/3/4'(A3-3' 反轉):數量欄印的是【訂購數量】, 不是應揀量", async () => {
    const { container } = await renderPage();
    const cells = [...container.querySelectorAll('.pd-items table > tbody > tr > td')];
    // fixture 第一列:訂購 53 / 到貨 41 / 已出貨 15 ⇒ 應揀量 26
    // 🔴 A3-4':稿的表頭是六欄, 狀態插在品名與數量之間 ⇒ 數量從 cells[2] 變成 cells[3]
    expect(cells[3]?.textContent?.trim()).toBe('53');
    // ✅ 反例守門:26 是【舊行為】的值 —— 它不得再出現在這一格
    expect(cells[3]?.textContent).not.toContain('26');
  });

  // 🔴 A3-3'(2026-08-29):~~⑤面3b 反向:應揀量 > 0 時必須有打勾框~~ **整格作廢** ——
  //    這張紙上不再有打勾框(Sean 08-23 + 08-29 `Q-PICKORDER` 甲)。
  //    ⚠️ 而它原本防的是【上一格恆綠】—— 那個顧慮沒有消失, 只是換了對象:
  //       新的反向守門在下面那個 describe 的第二個 it(正對照:表格與料號/數量欄要真的在)。
  it("⑤面3b' 反向(A3-3' 之後):應揀量 > 0 的列, 也不得有任何框", async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[data-slot="picking-checkbox"]')).toBeNull();
    // 正對照:這一發餵的 fixture 確實有【應揀量 > 0】的列 —— 否則上面那個 null 恆真。
    expect(pickableQuantity(detail().items[0] as never)).toBeGreaterThan(0);
  });

  it('⑤面7 品項空陣列 ⇒ fail-closed,不印一張只有表頭的空表格', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ items: [] }));
    const { container } = await renderPage();
    expect(textOf(container)).toContain('讀不到任何品項');
    expect(container.querySelector('table')).toBeNull();
  });

  it('⑤`pickableQuantity` 契約:null → null;shipped 全出 → 0;正常 → 差', () => {
    const mk = (instockQuantity: number, shippedQuantity: number) =>
      ({ quantitySummary: { instockQuantity, shippedQuantity } }) as never;
    expect(pickableQuantity({ quantitySummary: null } as never)).toBeNull();
    expect(pickableQuantity(mk(41, 15))).toBe(26);
    expect(pickableQuantity(mk(41, 41))).toBe(0);
    // 理論上 `shipped ⊆ instock` ⇒ 不會負;真的負也不印負數給倉庫看。
    expect(pickableQuantity(mk(3, 9))).toBe(0);
  });
});

// 🔴 R1 must-fix 6:三顆 `print:hidden` 原本**零守門** —— 刪掉之後三綠全綠、畫面完全看不出來,
//    紙上卻多一整條 144px 空白欄(`SIDEBAR_WIDTH='9rem'`)。
//    ⚠️ 這是**字面**守門:它擋不住「用值被別的規則蓋掉」(那只有真瀏覽器量得到,`D-004` §3 量過一次),
//       但它擋得住**刪除**,而刪除是這三處唯一沒人守的一條路。**量過 ≠ 有守門。**
// ── 本次應揀合計(Sean 2026-08-16 答「幾項」)────────────────────────────────
//
// 🔴 **它守的是「漏揀一整列」,而那件事在這張紙上原本【零症狀】** ——
//    揀貨的人一列一列往下勾,勾完最後一列就走;**沒有任何東西告訴他應該勾滿幾個**。
//    ⇒ 這一族釘的不是「有沒有印出一個數字」,是**那個數字與紙上的框對不對得起來**。
describe("#10 片1 🔴 A3-3' 誤刪後【還原】的四格 —— 它們與勾選【無關】", () => {
  // 🛑 2026-08-29:`-c8` 拿掉「本次應揀合計」那個 describe 時, 把這四格【一起刪掉了】,
  //    而它們守的是【紙面文字品質】與【B 態的標記位置】, 與勾選框一點關係都沒有。
  //    🔴 而我當時在 commit body 草稿寫「刪了 7 個 it」—— 實際 13 個
  //       ⇒ 我以為我逐一比對過了, 而我比對的是【我以為的那一半】。
  //    ✅ code-reviewer R1 抓到, 從 git HEAD 逐字撈回, 一個字未改。
  // 🔴 fixture helper 也在誤刪範圍裡（MIXED / ALL_UNKNOWN）⇒ 一起還原, 一字未改。
  const row = (sku: string, instock: number, shipped: number, unknown = false) => ({
    id: `id-${sku}`,
    variantSku: sku,
    title: '測試品項',
    spec: null,
    quantity: 9,
    unitPrice: { amount: 100, currency: 'TWD' },
    lineTotal: { amount: 900, currency: 'TWD' },
    procurements: [],
    procurementTruncated: false,
    quantitySummary: unknown
      ? null
      : {
          quantity: 9,
          orderedQuantity: 9,
          instockQuantity: instock,
          cancelledQuantity: 0,
          shippedQuantity: shipped,
          cancellableQuantity: 0,
        },
  });

  // 3 列要揀 / 1 列這次不用揀(到貨=已出貨)/ 1 列不知道
  const MIXED = [
    row('AAA', 5, 0),
    row('BBB', 3, 1),
    row('CCC', 2, 0),
    row('DDD', 7, 7),
    row('EEE', 0, 0, true),
  ];

  // 🔴🔴 **這一格的來源是【真伺服器 + 真資料】,不是想出來的**(2026-08-18)。
  //    真單 `PCM-2026-0102`:1 個品項、`quantitySummary` 為 `null`
  //    ⇒ 頁首「有 1 項的數量資料尚未就緒…這張單仍然不算處理完」
  //    ⇒ 而頁尾同時印「勾選欄共 0 項,全部勾完才算揀完。」
  //    ⇒ 🔴 **「把 0 個框全部勾完」是一個【不做任何事就成立】的條件。**
  //    ⚠️ 兩句話互相矛盾時,拿著紙的人會信**離簽名欄近的那一句**。
  //    📎 **六份量測 fixture 一份都沒照出這一格** —— 它們要嘛每列都有數量、要嘛零品項,
  //       而真資料是**有品項、但數量不知道**,那是 fixture 沒有的第三種。
  const ALL_UNKNOWN = [row('ZZZ', 0, 0, true)];
    it('🔴 B 態 ⇒ 品項表【自己】要說它沒有結尾(缺列印在表身,不是只在表尾講)', async () => {
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ items: MIXED, itemsTruncated: true } as unknown as Partial<AdminOrderDetail>),
      );
      const { container } = await renderPage();
      const t = textOf(container);
      // 正向對照:表要【在】—— B 與 A/C 的分野就在這裡,照抄整幅阻印會把 B 變成「一列都沒有」。
      expect(container.querySelector('table')).not.toBeNull();
      expect(t).toContain('AAA');
      // 🔴 標記必須在 `<tbody>` 裡面,不是表格外面 —— 在外面就退化成乙案了。
      const tbody = container.querySelector('tbody');
      expect(tbody?.textContent).toContain('未載入的品項');
      expect(tbody?.textContent).toContain('這張表沒有結尾');
      // 🔴 **不得印任何具體的缺件數** —— 上游只給布林,印數字就是編的。
      expect(tbody?.textContent).toContain('?');
    });

    it('🔴 紙上不得出現 markdown 星號(JSX 文字裡寫 ** 會照字面印出來)', async () => {
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ items: MIXED, itemsTruncated: true } as unknown as Partial<AdminOrderDetail>),
      );
      expect(textOf((await renderPage()).container)).not.toContain('**');
    });

    it('🔴 紙上不得出現表情符號(內部嚴重度標記漏到給倉庫的紙上)', async () => {
      const PICTOGRAPHS = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2200}-\u{22FF}\u{27F0}-\u{27FF}]/u;
      for (const over of [
        { items: MIXED, itemsTruncated: true },
        { items: MIXED },
        { items: ALL_UNKNOWN },
        { items: [] },
        { cancelledAt: '2026-08-16T03:00:00+00:00' },
      ]) {
        mocks.findAdminOrderDetail.mockResolvedValue(
          detail(over as unknown as Partial<AdminOrderDetail>),
        );
        const t = textOf((await renderPage()).container);
        expect(PICTOGRAPHS.test(t), `這一態的紙上有表情符號:${JSON.stringify(over)}`).toBe(false);
      }
      // 🔴 正向對照:證明這支正則抓得到東西 —— 沒有它,把 regex 寫壞成永不命中也會全綠。
      expect(PICTOGRAPHS.test('清單沒載完')).toBe(false);
      expect(PICTOGRAPHS.test('🔴 清單沒載完')).toBe(true);
      // 🔴 而 `✓`(勾選欄名)必須【不被誤傷】—— 否則下一個人會來加白名單。
      expect(PICTOGRAPHS.test('✓')).toBe(false);
      // 🔴 第三個出口(邏輯符號)的雙向對照:`⇒` 要抓到,而紙上真的在用的兩個符號不能誤傷。
      expect(PICTOGRAPHS.test('⇒ 勾完合計')).toBe(true);
      expect(PICTOGRAPHS.test('顏色: 黑 · 規格: 通用')).toBe(false);
      expect(PICTOGRAPHS.test('未載入的品項 —— 這一列不在這張紙上')).toBe(false);
    });

    it('🔴 同一張紙不得用兩個量詞數品項(「200 筆」vs「N 項」)', async () => {
      for (const over of [
        { items: MIXED, itemsTruncated: true },
        { items: MIXED },
        { items: ALL_UNKNOWN },
      ]) {
        mocks.findAdminOrderDetail.mockResolvedValue(
          detail(over as unknown as Partial<AdminOrderDetail>),
        );
        const t = textOf((await renderPage()).container);
        expect(t, `這一態的紙上用了「筆」數品項:${JSON.stringify(over)}`).not.toMatch(/\d+\s*筆/);
      }
      // 🔴 正向對照:B 態確實印得出那個上限句,而它現在用「項」——
      //    沒有這一格,把整段刪掉也會讓上面三發通過。
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ items: MIXED, itemsTruncated: true } as unknown as Partial<AdminOrderDetail>),
      );
      expect(textOf((await renderPage()).container)).toContain('200 項上限');
    });

  it('🔴 MF2/MF7:而【那顆會印應揀字樣的 Alert 真的出現】的世界裡, 也不得有應揀字樣', async () => {
    // 🛑 reviewer R1 MF2:上一格跑的是預設 fixture ⇒ unknownCount===0 ⇒ 那顆 Alert 根本不 render
    //    ⇒ `not.toContain('應揀')` 在那個世界【恆真】。唯一餵得出它的是 ALL_UNKNOWN。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: ALL_UNKNOWN } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    // ✅ 正對照(MF7):那顆 Alert 必須【真的在】—— 否則下面那個 not.toContain 又是恆真
    // 🔴 codex R2 must-fix 3:~~只驗全文有那句字面~~ ⇒ 把警告搬進普通品項列, 這格照樣過。
    //    ✅ 釘【位置】:那顆警告必須在頁首的 [role="alert"] 裡面。
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('數量資料尚未就緒');
    expect(alert?.textContent).toContain('不算處理完');
    // 🔴 而它現在【不得】再提一個已經不存在的合計
    expect(container.innerHTML).not.toContain('應揀');
    expect(container.innerHTML).not.toContain('本次應揀合計');
  });

  it('🔴 codex R2 MF4:B 態(itemsTruncated)也不得重新印出揀貨字面', async () => {
    // 🛑 上面兩格只跑【預設】與【ALL_UNKNOWN】⇒ 若只在 B 態重新印「應揀」或 picking-total,
    //    現有守門與撈回的 B 態測試【都不會紅】。
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: MIXED, itemsTruncated: true } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    // ✅ 正對照:確認我們真的在 B 態（否則下面全是恆真）
    expect(container.querySelector('[data-slot="picking-truncated-band"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain('應揀');
    expect(container.innerHTML).not.toContain('揀貨人');
    expect(container.querySelector('[data-slot="picking-checkbox"]')).toBeNull();
    expect(container.querySelector('[data-slot="picking-total"]')).toBeNull();
  });

  it("⑤面5'(A3-3' 反轉):數量不知道時, 數量欄【仍然】印訂購量, 而警告在頁首", async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: ALL_UNKNOWN } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    const cells = [...container.querySelectorAll('.pd-items table > tbody > tr > td')];
    expect(cells[3]?.textContent?.trim()).toBe('9');
    // 🔴 而「不知道」這件事仍然要說 —— 只是位置換到頁首 Alert（上面那格釘位置）
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('數量資料尚未就緒');
    // ✅ 反例:舊行為會在【格子裡】說「數量資料尚未就緒」⇒ 現在不得如此
    // 🔴 而「尚未就緒」現在住在【狀態欄】(cells[2]) —— 稿把它放在那裡。
    //    ⇒ 數量欄(cells[3])不得有它;而狀態欄【應該】有它。
    expect(cells[3]?.textContent).not.toContain('尚未就緒');
    expect(cells[2]?.textContent).toContain('尚未就緒');
  });
});

describe("#10 片1 🔴 A3-3' 之後:這張紙上【不得】再有任何揀貨用的東西", () => {
  // 🔴 2026-08-29 A3-3':原本這裡是一整個 `本次應揀合計` 的 describe(274 行、7 個 it),
  //    而它守的是【勾選框與應揀合計】—— 那些東西本片整個拿掉了
  //    (Sean 2026-08-23「訂單明細不需要勾選框」+ 08-29 `Q-PICKORDER` 拍甲)。
  // 🛑 **不刪守門, 換掉它守的對象**:那 7 格的共同目的是「紙上叫人做的事要做得到」,
  //    而現在正確的形狀是【這張紙不叫任何人做任何事】。
  // ⚠️ 原本那 7 格的推理沒有消失, 它們逐字留在 `picking-doc.tsx` 的註解裡:
  //    「清單沒載完的時候這句話會說謊」/「把它們寫成同一個數, 就是叫人去勾一個他勾不滿的數」。
  // 🔴 而【出貨單那張紙仍然有勾選欄】⇒ 那些陷阱在那裡照樣成立,
  //    而 **本片沒有查出貨單有沒有同款保護** ⇒ 未確認, 不是已處理。
  it('🔴 紙上不得有勾選框 / 應揀合計 / 應揀字樣(三個一起守, 少一個就留得下半套)', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[data-slot="picking-checkbox"]')).toBeNull();
    expect(container.querySelector('[data-slot="picking-total"]')).toBeNull();
    expect(container.innerHTML).not.toContain('應揀');
    expect(container.innerHTML).not.toContain('全部勾完才算揀完');
  });

  it('🔴 而上面那四個「沒有」不是因為頁面根本沒 render(正對照)', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.innerHTML).toContain('料號');
    expect(container.innerHTML).toContain('數量');
  });
});

describe('#10 片1 列印時必須藏起來的三顆', () => {
  // 🔴🔴 **2026-08-20:第一格從 `ui/sidebar.tsx` 改成 `layout/app-sidebar.tsx`,而那不是改期望值。**
  //    側欄那一片(84px 圖示軌)**不再渲染 shadcn 的 `<Sidebar>`** ⇒ `ui/sidebar.tsx` 還在、
  //    那個字面還在、**而它已經不在渲染樹上** ⇒ 這一格【在紙上多一條 84px 黑邊的那段時間裡，
  //    一直是綠的】。而本檔 `:372` 的註解正好寫著它要防的就是這件事。
  //    ⇒ 📌 **教訓:守門釘【檔案路徑】時，它守的是「那支檔還在」，不是「畫面上那個東西還在」。**
  //       而元件被換掉，是「畫面變了而檔案沒變」的最常見走法。
  const cases: readonly (readonly [string, string])[] = [
    ['components/layout/app-sidebar.tsx', 'shrink-0 border-r print:hidden'],
    ['components/layout/header.tsx', 'border-b px-4 print:hidden'],
    ['components/print/print-button.tsx', 'text-sm print:hidden'],
  ];
  for (const [rel, literal] of cases) {
    it(`${rel} 仍帶 print:hidden`, () => {
      expect(readFileSync(join(SRC, rel), 'utf8')).toContain(literal);
    });
  }

  // 🔴 而上面那三格仍然是【釘檔案路徑】—— 換一支元件它們照樣可能全綠。
  //    這一格把守門**接回渲染樹**:根 layout 現在畫的是哪一支側欄?
  //    ⇒ 有人把 layout 改成畫另一支元件 ⇒ 這裡紅 ⇒ 他會被迫回來看上面那張表。
  it('🔴 根 layout 畫的側欄,就是上面那張表釘的那一支(否則整組守門會靜默失效)', () => {
    const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8');
    expect(layout, '根 layout 必須從 layout/app-sidebar 取側欄').toContain(
      "from '@/components/layout/app-sidebar'",
    );
    expect(layout, '而它必須真的被畫出來').toContain('<AppSidebar');
  });

  it('sidebar 的 print:hidden 必須在 **root**、不是在 sidebar-container', () => {
    // 🔴 這格守的是 `D-002` §2 那個差點犯的錯:`Sidebar` 的 `className` prop 只會落在
    //    `sidebar-container`,而佔位寬度是它的**兄弟** `sidebar-gap` 撐出來的
    //    ⇒ 藏錯層 = 紙上留一整條空白欄,而畫面上完全看不出來。
    const src = readFileSync(join(SRC, 'components/ui/sidebar.tsx'), 'utf8');
    const rootLine = src
      .split('\n')
      .findIndex((l) => l.includes("'group peer text-sidebar-foreground hidden md:block print:hidden'"));
    const gapLine = src.split('\n').findIndex((l) => l.includes("data-slot='sidebar-gap'"));
    expect(rootLine).toBeGreaterThan(-1);
    expect(gapLine).toBeGreaterThan(-1);
    // root 必須在 gap **之前**(gap 是 root 的子節點)⇒ 證明 class 掛在包住 gap 的那一層。
    expect(rootLine).toBeLessThan(gapLine);
  });
});

// 🔴 R2 nit-5:`order-detail.tsx` 那顆入口鈕的 **`!cancelled` 條件與 href 全 repo 零守門**
//    ⇒ 路由資料夾改名 = **靜默 404**(員工按了得到「找不到頁面」),而三綠全綠、沒有任何測試會紅。
//    做法照同目錄既有樣板 `components/orders/order-detail-refund-entry.test.ts` 的 source-scan 形。
describe('#10 片1 入口鈕:href 必須真的指到一支存在的頁', () => {
  // 🔴 2026-08-24 拆檔片:入口鈕住的標頭整塊搬到 `order-detail-header.tsx` ⇒ 改讀它;斷言零改動。
  const detailSrc = readFileSync(join(SRC, 'components/orders/order-detail-header.tsx'), 'utf8');
  const HREF = '`/print/orders/${detail.id}/picking`';

  it('href 字面還在', () => {
    expect(detailSrc).toContain(HREF);
  });

  it('🔴 href 對應的 page 檔真的存在(資料夾被改名就紅,不再靜默 404)', () => {
    // href `/print/orders/<id>/picking` ⇒ 檔案 `app/print/orders/[id]/picking/page.tsx`。
    // 這一步是**把網址翻成檔案路徑**,而不是去 grep 一個字串 —— 改名的人動的是資料夾,不是字串。
    expect(existsSync(join(SRC, 'app/print/orders/[id]/picking/page.tsx'))).toBe(true);
  });

  it('🔴 已取消的訂單不給入口(`!cancelled` 條件還在)', () => {
    // ⚠️ 這只是 UX 那一層;真守門在 `picking-doc.tsx`(已取消 ⇒ 不印品項表),
    //    格⑤面1 釘那一層。兩層都要,少了下面那層這顆鈕等於零。
    expect(detailSrc).toContain('{!cancelled && (');
  });
});

describe('#10 片1 的前提:登入閘的**設定字面**涵蓋 /print', () => {
  // 🔴 這個 describe 不驗本片的 code,驗的是 plan §4「鐵則 12② 不命中」所依賴的那條 matcher。
  // ⚠️ **誠實(nit-9)**:這兩格只讀 `proxy.ts` 的**設定字面** —— `proxy()` 本體一次都沒被呼叫,
  //    「未登入真的會被 303 導去 /api/sso/start」這件事**本檔沒有驗過**。
  //    它們擋的是「有人把 matcher 改窄 / 把 /print 加進白名單」,不是行為回歸。
  const proxySrc = readFileSync(join(SRC, 'proxy.ts'), 'utf8');

  it('matcher 仍是「除靜態資源外全包」', () => {
    expect(proxySrc).toContain("matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']");
  });

  it('未登入白名單仍只有 SSO 那兩條(nit-7:只看那一行,不掃整支檔)', () => {
    // 🔴 第一版寫 `expect(proxySrc).not.toContain('/print')` ⇒ 掃**整支檔**,
    //    任何人寫一句提到 `/print` 的註解就假紅。縮到白名單那一行本身。
    const line = proxySrc.split('\n').find((l) => l.includes('SSO_OPEN_PATHS = new Set'));
    expect(line).toBe("const SSO_OPEN_PATHS = new Set(['/api/sso/start', '/api/sso/callback']);");
  });
});
