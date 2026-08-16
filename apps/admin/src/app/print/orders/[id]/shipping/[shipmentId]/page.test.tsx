// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// #10 片2b:出貨單列印頁的守門。
//
// 🔴 **這張紙有六種「印出來會害人做錯事」的狀態**,而它們的共同症狀是**沒有症狀** ——
//    紙照印、看起來很正常,錯的是紙上的內容或那張紙根本不該存在。
//    ⇒ 六種各一格,外加一格正向(否則「一律不印」也會全綠)。
// 🔴 另外兩格量的是**路由層**:網址帶兩個 id 而**沒有任何東西保證它們有關係**
//    (`(箱, 訂單)` 這種複合單位天生的破口)。

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

const mocks = vi.hoisted(() => ({ findAdminOrderDetail: vi.fn(), loadOrderShipments: vi.fn() }));
vi.mock('../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));
vi.mock('../../../../../../lib/shipping/order-shipments', () => ({
  loadOrderShipments: mocks.loadOrderShipments,
}));

import OrderShippingPrintPage from './page';
import {
  shippingDocBlocker,
} from '../../../../../../components/print/shipping-doc';

const ORDER = '11111111-1111-4111-8111-111111111111';
const SHIPMENT = '33333333-3333-4333-8333-333333333333';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SRC = join(__dirname, '..', '..', '..', '..', '..', '..');

const RECIPIENT = { name: '王小明', phone: '0912345678', line: '台北市信義區松高路 1 號' };

function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: ORDER,
    displayId: 'PCM-2026-0042',
    createdAt: '2026-08-04T02:00:00+00:00',
    cancelledAt: null,
    customer: { name: '王小明', email: null, phone: null },
    items: [
      {
        id: ITEM,
        variantSku: 'LTC-BK-XL',
        title: '前叉防甩頭',
        spec: { 顏色: '黑' },
        quantity: 5,
        unitPrice: { amount: 74183, currency: 'TWD' },
        lineTotal: { amount: 88291, currency: 'TWD' },
        procurements: [],
        procurementTruncated: false,
        quantitySummary: null,
      },
    ],
    itemsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}
const shipment = (over: Record<string, unknown> = {}) =>
  ({
    id: SHIPMENT,
    shipmentReference: 'K7X2MP',
    customerUserId: 'cu-1',
    carrierCode: 'hct',
    carrierNote: null,
    trackingNumber: '6412345678',
    shippedAt: null,
    voidedAt: null,
    voidReason: null,
    recipientSnapshot: RECIPIENT,
    ...over,
  }) as never;
const lines = [{ orderItemId: ITEM, title: '前叉防甩頭', quantity: 2 }];
const block = (over: {
  detail?: Partial<AdminOrderDetail>;
  shipment?: Record<string, unknown>;
  lines?: typeof lines;
}) =>
  shippingDocBlocker({
    detail: detail(over.detail ?? {}),
    shipment: shipment(over.shipment ?? {}),
    lines: over.lines ?? lines,
  });

async function renderPage(id = ORDER, shipmentId = SHIPMENT) {
  return render(await OrderShippingPrintPage({ params: Promise.resolve({ id, shipmentId }) }));
}

/**
 * 取出「應該存在」的量測目標;不存在就用**看得懂的訊息**炸掉。
 *
 * ⚠️ 用它而不是 `!`:`!` 讓「第 2 張表不見了」表現成一句 `Cannot read properties of undefined`,
 * 而那句話會被讀成「測試壞了」而不是「紙上少了一張表」——**紅的原因要能一眼認出來。**
 */
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`量測目標不存在:${what}`);
  return v;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
  mocks.loadOrderShipments.mockResolvedValue([{ shipment: shipment(), lines }]);
});
afterEach(() => cleanup());

describe('🔴 #10 片2b — 六種「不該印」的狀態', () => {
  it('正向:一切正常時可以印(否則下面六格全部恆綠)', () => {
    expect(block({})).toBeNull();
  });

  it('面4 訂單已取消', () => {
    expect(block({ detail: { cancelledAt: '2026-08-05T02:00:00+00:00' } })).toContain('已於');
    expect(block({ detail: { cancelledAt: '2026-08-05T02:00:00+00:00' } })).toContain('不要出貨');
  });

  it('面1 箱已作廢(詳情卡刻意仍列出作廢箱 ⇒ 從那裡點進來的路徑是通的)', () => {
    const msg = block({ shipment: { voidedAt: '2026-08-05T02:00:00+00:00', voidReason: '貼錯單' } });
    expect(msg).toContain('已作廢');
    expect(msg).toContain('貼錯單');
  });

  it('面6 品項清單截斷 ⇒ 可能少列品項', () => {
    expect(block({ detail: { itemsTruncated: true } })).toContain('沒有完整載入');
  });

  it('面5 這箱裡沒有這張訂單的品項(網址把不相干的箱與單湊在一起)', () => {
    expect(block({ lines: [] })).toContain('沒有這張訂單的品項');
  });

  it('面7 箱裡的品項在訂單明細查不到 ⇒ 不用 `?? —` 蒙混', () => {
    expect(block({ lines: [{ orderItemId: 'not-in-order', title: 'x', quantity: 1 }] })).toContain(
      '對不上',
    );
  });

  // 🔴 面8(#10 合併片,2026-08-16 補):**從揀貨單搬過來的** ——
  //    `components/print/picking-doc.tsx:114-115` 早就有,出貨單一直沒有。
  //    合併時「以出貨單為本體」聽起來像保留出貨單的東西,**這道會靜默消失**。
  it('🔴 面8 這張【訂單】讀不到任何品項 ⇒ 擋(與面5「這箱沒有本單品項」是兩件事)', () => {
    expect(block({ detail: { items: [] } })).toContain('讀不到任何品項');
  });

  // 🔴 反向格:沒有它,上一格會被面7 搶先攔截而永遠測不到自己那條路。
  //    `detail.items` 空 ⇒ `known` 集合空 ⇒ 每一條 line 都是孤兒 ⇒ **面7 會先回**,
  //    而面7 的訊息叫員工去找「箱與單對不上」,**方向是錯的**(真病是整張單讀不到東西)。
  //    ⇒ 本格證明面8 排在面7 **之前**;順序調換就紅。
  it('🔴 面8 必須排在面7 之前(否則員工被指去找箱子的問題,而病在訂單投影)', () => {
    const msg = block({ detail: { items: [] } });
    expect(msg, '面7 搶先回了 ⇒ 訊息把員工指向錯的方向').not.toContain('對不上');
  });

  it('面3 收件快照讀不出來(jsonb 形狀不符)', () => {
    expect(block({ shipment: { recipientSnapshot: null } })).toContain('讀不出來');
  });

  it('🔴 面2 `#503` 收件人是空字串 ⇒ 擋(而那是合法寫入,不是髒資料)', () => {
    // 三欄各缺一次:少擋任一欄都會讓一張沒有收件資訊的紙印出去。
    for (const bad of [
      { ...RECIPIENT, name: '' },
      { ...RECIPIENT, phone: '' },
      { ...RECIPIENT, line: '' },
      { name: '', phone: '', line: '' },
    ]) {
      expect(block({ shipment: { recipientSnapshot: bad } }), JSON.stringify(bad)).toContain(
        '沒有完整的收件資料',
      );
    }
  });

  it('🔴 面2 補:只打了空白也算沒填(顯示端 trim 判空,資料層仍原樣保留)', () => {
    expect(block({ shipment: { recipientSnapshot: { ...RECIPIENT, line: '   ' } } })).toContain(
      '沒有完整的收件資料',
    );
  });
});

describe('#10 片2b — 版面', () => {
  it('可以印時:收件人 / 料號 / 品名 / 本次出貨數量都在紙上', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('出貨單');
    expect(t).toContain('PCM-2026-0042');
    expect(t).toContain('K7X2MP');
    expect(t).toContain(RECIPIENT.line);
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('2'); // 本次出貨數量,不是訂單的 5
  });

  it('🔴 印的是**本次出貨**的數量,不是下單量', async () => {
    // 🔴 **這格原本用「全頁最後一個 td」定位,`Q-D-6` 落地後就量錯東西了** ——
    //    紙上多了第二張表(尚未出貨),最後一個 td 變成那張表的。
    //    ⚠️ 它當時**紅得對**(說「數量資料尚未就緒」≠「2」),但紅的原因是選擇器太寬、不是實作壞了。
    //    ⇒ 修法是**把量測範圍縮到該量的那張表**,不是放寬斷言。
    const table = must((await renderPage()).container.querySelectorAll('table')[0], '本次出貨表');
    const cell = [...table.querySelectorAll('tbody > tr > td')].at(-1);
    expect(cell?.textContent?.trim()).toBe('2');
    expect(cell?.textContent).not.toContain('5');
  });

  it('被擋時:出警告**而且不印品項表**(印出來就會有人照著出貨)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
    const { container } = await renderPage();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('LTC-BK-XL');
  });

  it('🔴 金額區塊還沒做(已答但排下一片)⇒ 紙上不得出現任何金額', async () => {
    // 🔴 **標題更正(2026-08-15)**:原本寫「`Q-D-4` 未答」,而 `Q-D-4` 已經答了(乙 = 兩區各自合計)
    //    ⇒ 那句話從那一刻起就是假的,只是格子照樣綠 ⇒ **沒有任何東西會告訴我它過期。**
    //    現在的事實:規格齊了,卡的是工序(金額橫跨兩區 + `Q-D-7` 要求逐數字寫明出處)⇒ 排下一片。
    // ⚠️ 這格仍是**暫時**的:金額真的落地時**要改寫這格**,不是刪掉。
    //    留著是為了在那之前擋住「順手把金額加上去」——那會在沒拍板的情況下印給客人看。
    const t = (await renderPage()).container.textContent ?? '';
    // 🔴 金額值刻意挑**不會與電話 / 單號 / 料號 / 日期 / 數量撞的數字**。
    //    第一版用 12345,而電話 `0912345678` 裡就含 12345 ⇒ 這格假紅。
    //    **是這格自己抓到 fixture 撞號的** —— 換句話說它有判別力,不是恆綠。
    expect(t).not.toContain('74183');
    expect(t).not.toContain('88291');
    expect(t).not.toContain('NT$');
  });
});

describe('#10 片2b — 路由層:網址帶兩個 id,不保證它們有關係', () => {
  it('訂單 id 非 UUID ⇒ 不打 DB', async () => {
    await expect(renderPage('nope')).rejects.toThrow('notFound');
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
  });

  it('🔴 箱 id 非 UUID 也要擋(第二個參數同樣是使用者可控的)', async () => {
    await expect(renderPage(ORDER, 'nope')).rejects.toThrow('notFound');
    expect(mocks.findAdminOrderDetail).not.toHaveBeenCalled();
  });

  it('🔴🔴 箱與單無關 ⇒ notFound(絕不拿箱 id 直接查箱,那等於信了網址)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ id: '44444444-4444-4444-8444-444444444444' }), lines },
    ]);
    await expect(renderPage()).rejects.toThrow('notFound');
  });

  it('查無訂單 ⇒ notFound', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('notFound');
  });
});

describe('#10 片2b — 入口鈕', () => {
  const src = readFileSync(join(SRC, 'components/orders/shipment-section.tsx'), 'utf8');

  it('href 字面還在,而且對應的 page 檔真的存在(資料夾改名就紅,不再靜默 404)', () => {
    expect(src).toContain('`/print/orders/${detail.id}/shipping/${shipment.id}`');
    expect(existsSync(join(SRC, 'app/print/orders/[id]/shipping/[shipmentId]/page.tsx'))).toBe(true);
  });

  it('🔴 作廢的箱不給入口(`!voided` 條件還在)', () => {
    // ⚠️ 這只是 UX 那層;真守門是 `shippingDocBlocker()` 的面1,上面那個 describe 釘它。
    expect(src).toContain('{!voided && (');
  });
});

// ── Q-D-6:「尚未出貨」那一區(Sean 2026-08-15 拍「貨運收走了才算已經出貨」)──
//
// 🔴🔴 **先講這組格子量不到什麼,免得它看起來比實際強**:
//    「裝了箱但還沒寄 ⇒ 仍算尚未出貨」這個語意**不在這一層** —— 它在 DB,由
//    `20260806180000_…_shipped_recompute_wire.sql:228` 的 `AND s.shipped_at IS NOT NULL` 決定,
//    而那支 migration 自己有五處字面一致的守門(同檔 `:17`)。
//    TS 這側拿到的 `shippedQuantity` **已經是**「貨運收走的量」⇒ 我在這裡**構造不出** A 案與 B 案的差異。
//    ⇒ 我**沒有**加一格去 grep 那支 migration 的字面:那種格子釘的是 repo 裡的字,
//       不是資料庫裡的事實,而它紅的時候只代表「有人改了我的字」。**寧可不加,也不要假的覆蓋。**
//    **這組格子真正釘的是:算式用對欄位、`null` 不被吞掉、0 不被印成漏。**

const summary = (over: Partial<Record<string, number>> = {}) => ({
  quantity: 5,
  orderedQuantity: 5,
  instockQuantity: 4,
  cancelledQuantity: 1,
  shippedQuantity: 2,
  cancellableQuantity: 2,
  ...over,
});
const withSummary = (s: ReturnType<typeof summary> | null) =>
  detail({
    items: [{ ...detail().items[0], quantitySummary: s }],
  } as unknown as Partial<AdminOrderDetail>);

// 🔴 **純算式的格子搬到 `lib/shipping/shipping-doc-quantities.test.ts`** ——
//    那些問題(四項算式、補印不重複扣、分三批出完歸零)**不需要渲染就答得出來**,
//    留在這裡的話每一格都要先 render 一次頁面,而那會讓「算式對不對」與
//    「畫面有沒有印出來」在同一格裡紅。**兩件都要測,但不該是同一格。**
//    ⇒ 本檔從這裡開始只問**紙面**。

describe('#10 片2b — 三區(Sean 2026-08-16 逐字:本次出貨 / 尚未出貨 / 訂單取消)', () => {
  const titles = (c: HTMLElement) => [...c.querySelectorAll('h2')].map((h) => h.textContent ?? '');
  /**
   * 🔴 **依【區名】取那一區的表,不依索引** —— 三個區是**條件出現**的
   * (沒有取消就沒有第三區、都出完就沒有第二區)⇒ `tables[1]` 指到哪一區會隨資料變。
   * 用索引寫的話,測試會在「某一區消失」時**默默去驗另一區**而不是紅。
   */
  const sectionTable = (c: HTMLElement, title: string) => {
    // 🔴 **從 table 反查它的區名**,不是從 h2 往下鑽(codex consider):
    //    往下鑽綁死了「h2 → 最近 div → parent → 第一張 table」這條路徑,
    //    多包一層 div 就會靜默取到別區;反查只依賴「每張表上面有一個 h2」這一個假設。
    return (
      [...c.querySelectorAll('table')].find(
        (t) => t.parentElement?.querySelector('h2')?.textContent === title,
      ) ?? null
    );
  };

  it('🔴 三個區名逐字照抄 Sean 的原話,不得正規化', async () => {
    // 他給的是「本次出貨 / 尚未出貨 / 訂單取消」。改成「已取消品項」之類 = 這格紅。
    // ⚠️ 測資要讓三區【同時存在】:買 9 / 取消 1 / 先前寄 0,這一箱 2 ⇒ 尚未 9−1−0−2 = 6 > 0
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })),
    );
    expect(titles((await renderPage()).container)).toEqual(['本次出貨', '尚未出貨', '訂單取消']);
  });

  it('🔴🔴 「尚未出貨」的數字是【扣掉這一箱之後】的 —— 少扣就會多印一件給客人看', async () => {
    // 買 9 / 取消 1 / 先前寄 0 / 這一箱 2 ⇒ 9−1−0−2 = 6
    // 🔴 少扣「這一箱」的舊行為會印 8。兩個數不同 ⇒ 這格分得出來。
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })),
    );
    const { container } = await renderPage();
    const table = sectionTable(container, '尚未出貨');
    expect(table?.textContent ?? '').toContain('LTC-BK-XL');
    // 🔴 **鎖在數量儲存格**,不是整張表找字元「6」(codex:料號/規格裡出現 6 也會讓它綠)。
    expect(table?.querySelector('tbody td:last-child')?.textContent?.trim()).toBe('6');
  });

  it('🔴 全部處理完 ⇒ 「尚未出貨」整區不出現(不留一張空表)', async () => {
    // 買 5 / 取消 1 / 先前寄 2 / 這一箱 2 ⇒ 5−1−2−2 = 0
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(summary()));
    expect(titles((await renderPage()).container)).not.toContain('尚未出貨');
  });

  it('🔴🔴 本檔【不得】印一條跨區的對帳等式(它少了「先前已出貨」那一項,第二箱就對不起來)', async () => {
    // Sean `Q-C4` 拍「會算錯就不印」⇒ 紙面三格、算式四項。
    // 印「訂購 = 本次 + 尚未 + 已取消」的話:訂購 5、先前 2、這箱 1 ⇒ 5 ≠ 1+2+0。
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(summary()));
    const t = (await renderPage()).container.textContent ?? '';
    // 🔴 釘的是**跨區加總這件事**,不是幾個詞。
    //    codex R2 擊穿過一次:`5 件＝1 件＋4 件` —— 數字與運算符之間夾一個「件」,
    //    上一版那兩條 regex 都避開了。⇒ 允許中間有中文量詞。
    for (const word of ['訂購', '對帳', '合計', '總計']) expect(t).not.toContain(word);
    // 🔴 前後都要允許空白 —— 第一版只寫了尾巴的 `\s*`,於是 `5 = 1 + 4`(運算符後有空格)
    //    整條放行。**我是自己跑一遍探針才發現的,不是讀出來的。**
    // ⚠️ **這條 regex 擋得住什麼、擋不住什麼(不要讓它看起來比實際強)**:
    //    擋得住 = 數字直接相等/相加(`5 = 1 + 4`、`5 件＝1 件＋4 件`)。
    //    🔴 擋不住 = 運算符與數字之間夾了詞的寫法(`訂購 5 件 = 本次 1 件 + 尚未 4 件`)——
    //       那一種靠上面的禁詞清單接住,**兩道各補對方的洞,而兩道都不完整。**
    //    ⇒ 真正的防線是 `shipping-doc.tsx` 那段「為什麼不印對帳等式」的理由,這裡只是複發偵測。
    const NUM = String.raw`\s*\d+\s*[件個]?\s*`;
    expect(t).not.toMatch(new RegExp(`${NUM}[=＝]${NUM}`));
    expect(t).not.toMatch(new RegExp(`${NUM}[+＋]${NUM}`));
  });

  it('🔴🔴 這一箱【已標記出貨】⇒ 它的量不再從「尚未出貨」扣第二次', async () => {
    // 🔴 本檔在此之前**沒有任何一格**渲染過 `shippedAt !== null` 的箱(codex 抓的)
    //    ⇒ 「已出貨的箱不進 pending」這條接線在頁層零覆蓋。
    // 買 9 / 取消 1 / 已出貨 2(含這一箱的 2)⇒ 這一箱不在 pending ⇒ 9−1−2−0 = 6
    // 🔴 若誤把已出貨的箱也算進 pending ⇒ 9−1−2−2 = 4,兩個數不同 ⇒ 這格分得出來。
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ shippedAt: '2026-08-16T02:00:00+00:00' }), lines },
    ]);
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 2 })),
    );
    const { container } = await renderPage();
    const table = sectionTable(container, '尚未出貨');
    expect(table?.querySelector('tbody td:last-child')?.textContent?.trim()).toBe('6');
  });

  it('🔴 「訂單取消」區只收取消 > 0 的列;沒有取消時整區不出現', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ cancelledQuantity: 0, shippedQuantity: 0 })),
    );
    expect(titles((await renderPage()).container)).not.toContain('訂單取消');
  });

  it('🔴 摘要 null 的品項**必須留在紙上**、印「不知道」,不得被濾掉', async () => {
    // ⚠️ 這格是本組最重要的一格:濾掉 null 的話紙上會變成「都寄完了」,
    //    員工就會把剩下的貨放回架上。**空白比錯誤更難發現。**
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(null));
    const t = (await renderPage()).container.querySelectorAll('table')[1]?.textContent ?? '';
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('數量資料尚未就緒');
    expect(t).not.toContain('尚未出貨:無');
  });

  it('🔴 真的都寄完了 ⇒ 說「無」,不留一張空表', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ cancelledQuantity: 0, shippedQuantity: 5 })),
    );
    const { container } = await renderPage();
    expect(container.querySelectorAll('table').length).toBe(1); // 只剩「本次出貨」
    expect(container.textContent).toContain('尚未出貨:無');
  });

  it('🔴🔴 兩張表都必須是真的 `<table>` + 真的 `<thead>`(跨頁表頭靠它)', async () => {
    // 🔴 **這格是 R1 must-fix 折出來的,病名是「繼承了結論、沒繼承守門」。**
    //    本檔 `shipping-doc.tsx` 寫「跨頁表頭**沿用**片1 的結論」,但只沿用了那句話 ——
    //    E 窗用兩發突變把邊界釘死:
    //      `<table>` → `<div>`            ⇒ 4 failed（原本擋得住）
    //      🔴 留著 table、`<thead>`→`<tbody>` ⇒ **27 passed，一格都沒紅**
    //    ⇒ **`thead` 是那個「沿用的結論」唯一的成立條件,而它零覆蓋。**
    //       拿掉它:畫面一模一樣、四綠全綠,**而列印時第 2 頁的欄名整排消失**。
    //
    // ⚠️ **本格證得到什麼、證不到什麼(不要讓它看起來比實際強)**:
    //    證得到 = **那個瀏覽器原生保證的「前提」還在**(真 table + 真 thead)。
    //    證不到 = 第 2 頁真的有欄名 —— 單測沒有分頁概念。
    //    真分頁那一層**片1 已用 30 項 fixture + 真 A4 PDF + 負向對照量過**
    //    (`picking/page.test.tsx:148` 那格的註解記著量測結果)⇒ **本片不重做那一輪。**
    //
    // 🔴 兩張表**各釘一次**。現在它們是同一份 `Section` JSX ⇒ 一發突變會同時打到兩張;
    //    **但守門不該假設它們永遠共用** —— 哪天有人把其中一張拆出去,這格要能單獨紅。
    // 🔴 測資要讓**三區同時存在**,否則這格只釘得到其中兩張
    //    (原本寫死 `tables.length === 2` 是兩區時代的字面 ⇒ 三區之後它會在錯的地方紅)。
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })),
    );
    const { container } = await renderPage();
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBe(3);

    const headerTexts = (t: Element) => {
      const thead = t.querySelector(':scope > thead');
      expect(thead).not.toBeNull(); // ← thead 換成 tbody 時死在這裡
      return [...(thead?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    };
    expect(headerTexts(must(tables[0], '本次出貨表'))).toEqual(['料號', '品名 / 規格', '本次出貨']);
    expect(headerTexts(must(tables[1], '尚未出貨表'))).toEqual(['料號', '品名 / 規格', '還欠幾件']);
    // 🔴 第三區也要各釘一次,理由同上:不該假設三張表永遠共用同一份 JSX。
    expect(headerTexts(must(tables[2], '訂單取消表'))).toEqual(['料號', '品名 / 規格', '已取消']);
  });

  it('🔴 三區的母體各不相同,紙上要各自講出來(不然會被讀成同一個東西)', async () => {
    // 區一 = 這一箱 / 區二 = 整張訂單還欠的 / 區三 = 整張訂單已取消的。
    // 🔴 三個母體不同,而三張表長得一模一樣 ⇒ 不寫清楚就會被加總、被比較。
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })),
    );
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('這個箱子裡屬於這張訂單的品項');
    expect(t).toContain('這張訂單還欠客人的東西(不含這一箱要寄的)');
    expect(t).toContain('這張訂單裡已經取消的品項,不會出貨');
  });
});

describe('🔴 #10 片3 — 貨運資訊(落地前紙上一個字都沒有)', () => {
  // 🔴 **這一族釘的是「有印出來嗎」,不是「算對了嗎」** —— 後者在
  //    `lib/shipping/shipping-doc-dispatch.test.ts` 與 `carrier-label.test.ts`(不需渲染就跑得動)。
  //    ⚠️ 兩件都要測,但**不該是同一格**:同一格的話「算式錯」與「忘了 render」會紅在同一個地方。

  it('貨運商 / 日期 / 追蹤碼三個都印出來,而且各自帶標籤', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('貨運商:新竹物流');
    expect(t).toContain('新竹物流追蹤碼:');
    expect(t).toContain('6412345678');
    expect(t).toMatch(/日期:\d{4}-\d{2}-\d{2}/);
  });

  it('🔴 三個號碼並排 ⇒ 每一個都要有標籤(plan §4:客人不知道該拿哪個去查)', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    // 🔴 `displayId` 在片3 之前是**裸印**的(紙上只有 `PCM-2026-0042` 沒有「訂單編號」四個字)。
    expect(t).toContain('訂單編號 PCM-2026-0042');
    expect(t).toContain('箱號 K7X2MP');
    // 🔴 追蹤碼的標籤必須帶貨運商名 —— 只有它是拿去**別人家網站**查的。
    expect(t).not.toMatch(/(?<!新竹物流)追蹤碼:6412345678/);
  });

  it('已出貨 ⇒ 日期那格印的是 shippedAt 那天,不是列印當天', async () => {
    // ⚠️ **本格【量不到時區】**(R1 nit 9):頁測跑在 `vitest.config.ts` 釘死的 `TZ=Asia/Taipei` 下
    //    ⇒ 拿掉實作的 `{ timeZone }` 這格照樣綠。時區那一半在
    //    `lib/shipping/shipping-doc-dispatch.test.ts`(它在執行期切 `TZ=UTC`)。
    //    本格量得到的只有「有沒有接上 shippedAt、而不是 now」。
    // 台北 2026-08-17 01:00 = UTC 2026-08-16 17:00。
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ shippedAt: '2026-08-16T17:00:00Z' }), lines },
    ]);
    expect((await renderPage()).container.textContent).toContain('日期:2026-08-17');
  });

  it('🔴 other + carrierNote ⇒ 說明只印【一次】(在貨運商那格),追蹤碼那列不重印', async () => {
    // R1 must-fix 4:同一句話在同一張紙出現兩次,讀的人會以為是兩件事。
    mocks.loadOrderShipments.mockResolvedValue([
      {
        shipment: shipment({
          carrierCode: 'other',
          carrierNote: '客人自取',
          trackingNumber: null,
          shippedAt: '2026-08-16T02:00:00Z',
        }),
        lines,
      },
    ]);
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('貨運商:其他(客人自取)');
    expect(t.split('客人自取').length - 1).toBe(1);
    expect(t).toContain('無追蹤碼(自取 / 自送)');
  });

  it('🔴 已出貨 + 非 other + 沒追蹤碼 ⇒ 紙上印「請回報」,不留白(plan §3.1 情形③)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      {
        shipment: shipment({ carrierCode: 'sf', trackingNumber: null, shippedAt: '2026-08-16T02:00:00Z' }),
        lines,
      },
    ]);
    const t = (await renderPage()).container.textContent ?? '';
    // 🔴 留白的話員工不會發現,而客人拿到一張查不到貨的紙。
    expect(t).toContain('追蹤碼缺漏');
    expect(t).toContain('系統已記為已出貨');
    // 🔴🔴 **這一格被改過兩次,兩次都是因為【恆真】,記著兩次的形狀**:
    //    R1 原式 `not.toMatch(/追蹤碼:\s*$/m)` —— `textContent` 沒有換行、那列後面永遠還有東西
    //      ⇒ `$` 碰不到。
    //    R2 第二版「量這一列有幾個字 > 4」—— 當時那列尾巴接著一句 **12 個字的常數**
    //      ⇒ `t.text` 改成 `''` 時仍得 12 > 4,**照樣綠**。
    //    R2 折完後我又量了第三次,結果是:**那條長度斷言【從來不會自己紅】** ——
    //      突變 `t.text = ''`      ⇒ 死在上面的 toContain
    //      突變 JSX 改成不渲染 t.text ⇒ 也死在上面的 toContain
    //    ⇒ 它不是恆真,但**沒有任何獨立判別力**,而三行斷言看起來比兩行更周全。
    //    🔴 **所以刪掉它,不留假覆蓋** —— 這一格的判別力全部由上面兩條 toContain 承擔,
    //       而它們釘的是**紙上真的印出來的那句話**,那才是這格要守的東西。
    // ⚠️ 這一列會不會被印成**看不見的樣式**(顏色/字級),單測量不到 —— 紙沒印出來看過。
  });

  it('🔴🔴 未出貨且沒追蹤碼 ⇒ 紙上【整列不印】(Q-C9b=乙「什麼都不寫,空格」)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ trackingNumber: null, shippedAt: null }), lines },
    ]);
    const t = (await renderPage()).container.textContent ?? '';
    // 🔴 連「追蹤碼:」四個字都不印 —— 只把值換成空字串的話,紙上會留下一個看起來壞掉的欄位。
    expect(t).not.toContain('追蹤碼');
    expect(t).not.toContain('出貨後補');
    expect(t).not.toContain('請回報');
    // 🔴 **正向對照**:同一張紙的其他貨運資訊照印 ⇒ 上面那三個「沒有」不是整區沒渲染。
    expect(t).toContain('貨運商:新竹物流');
    expect(t).toMatch(/日期:\d{4}-\d{2}-\d{2}/);
  });

  it('🔴 未知貨運商代碼 ⇒ 印代碼本身,不留白(守門看不到 DB,回退方向必須安全)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ carrierCode: 'zzz' }), lines },
    ]);
    expect((await renderPage()).container.textContent).toContain('貨運商:zzz');
  });

  it('被擋時貨運資訊也不印 —— 那張紙整張不該存在', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ itemsTruncated: true }));
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).not.toContain('貨運商');
    expect(t).not.toContain('6412345678');
  });
});

describe('🔴 Q-C7 = 丙:頁尾【不得】有手寫日期格(Sean 2026-08-16 逐字)', () => {
  it('簽名區只剩「出貨人」,沒有第二個日期', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('出貨人:');
    // 🔴 沒有這一格的話,把那行加回來【零症狀】—— 它看起來像單據的標準欄位。
    expect(t).not.toContain('日期:____');
    // ⚠️ Q-C6 之後表頭那格也叫「日期」⇒ 這裡只能釘【手寫底線】那個形狀,不能只釘「日期」兩個字。
    // 正向對照:表頭那個【印死的】出貨日還在(拿掉的是手寫那格,不是整個日期概念)。
    expect(t).toMatch(/日期:\d{4}-\d{2}-\d{2}/);
  });
});
