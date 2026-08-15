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
  unshippedQuantity,
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

describe('#10 片2b — unshippedQuantity(還欠客人幾件)', () => {
  const call = (s: ReturnType<typeof summary> | null) =>
    unshippedQuantity(must(withSummary(s).items[0], '第一個品項'));

  it('🔴 摘要 null ⇒ 回 null(「不知道」不是「都是 0」)', () => {
    expect(call(null)).toBeNull();
  });

  it('🔴 算式 = 買的 − 取消的 − 寄走的', () => {
    // 五個欄位的值**刻意兩兩不同**,任何一個欄位取錯都會得到不同的數:
    //   quantity 5 / ordered 5 / instock 4 / cancelled 1 / shipped 2
    //   正解 5−1−2 = 2;若誤用 instock 當被減數 ⇒ 4−1−2 = 1;若漏減 cancelled ⇒ 3;若漏減 shipped ⇒ 4。
    expect(call(summary())).toBe(2);
    expect(call(summary({ instockQuantity: 0 }))).toBe(2); // instock 不參與本式
  });

  it('🔴 全部寄完或取消完 ⇒ 0,而且不會變成負數', () => {
    expect(call(summary({ cancelledQuantity: 0, shippedQuantity: 5 }))).toBe(0);
    expect(call(summary({ cancelledQuantity: 3, shippedQuantity: 2 }))).toBe(0);
    // CHECK 保證進不來,但真進來了也不准在紙上印負數。
    expect(call(summary({ cancelledQuantity: 9, shippedQuantity: 9 }))).toBe(0);
  });

  it('🔴 不是 pickableQuantity —— 沒到貨的照樣欠客人', () => {
    // instock 0(貨還沒從供應商到)⇒ 揀貨單「應揀 0」,但客人還是欠 5 件。
    expect(call(summary({ instockQuantity: 0, cancelledQuantity: 0, shippedQuantity: 0 }))).toBe(5);
  });
});

describe('#10 片2b — 尚未出貨區塊(紙面)', () => {
  it('還欠客人的品項會出現在第二張表', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(summary()));
    const tables = (await renderPage()).container.querySelectorAll('table');
    expect(tables.length).toBe(2);
    const unshipped = must(tables[1], '尚未出貨表');
    expect(unshipped.textContent).toContain('LTC-BK-XL');
    expect(unshipped.querySelector('tbody td:last-child')?.textContent?.trim()).toBe('2');
  });

  it('🔴 摘要 null 的品項**必須留在紙上**、印「不知道」,不得被濾掉', async () => {
    // ⚠️ 這格是本組最重要的一格:濾掉 null 的話紙上會變成「都寄完了」,
    //    員工就會把剩下的貨放回架上。**空白比錯誤更難發現。**
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(null));
    const t = (await renderPage()).container.querySelectorAll('table')[1]?.textContent ?? '';
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('數量資料尚未就緒');
    expect(t).not.toContain('尚未出貨項目:無');
  });

  it('🔴 真的都寄完了 ⇒ 說「無」,不留一張空表', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      withSummary(summary({ cancelledQuantity: 0, shippedQuantity: 5 })),
    );
    const { container } = await renderPage();
    expect(container.querySelectorAll('table').length).toBe(1); // 只剩「本次出貨」
    expect(container.textContent).toContain('尚未出貨項目:無');
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
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(summary()));
    const { container } = await renderPage();
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBe(2);

    const headerTexts = (t: Element) => {
      const thead = t.querySelector(':scope > thead');
      expect(thead).not.toBeNull(); // ← thead 換成 tbody 時死在這裡
      return [...(thead?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    };
    expect(headerTexts(must(tables[0], '本次出貨表'))).toEqual(['料號', '品名 / 規格', '本次出貨']);
    expect(headerTexts(must(tables[1], '尚未出貨表'))).toEqual(['料號', '品名 / 規格', '還沒寄出']);
  });

  it('🔴 兩區的母體不同,紙上要講出來(不然會被讀成同一個東西)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(withSummary(summary()));
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('這個箱子裡屬於這張訂單的品項');
    expect(t).toContain('這張訂單還沒交給貨運的東西');
  });
});
