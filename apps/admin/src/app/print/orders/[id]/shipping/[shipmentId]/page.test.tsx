// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderPrintItem } from '@pcm/domain';

// #10 片2b:出貨單列印頁的守門。
//
// 🔴 **這張紙有【八種】「印出來會害人做錯事」的狀態**(原寫六種,2026-08-16 重數更正),而它們的共同症狀是**沒有症狀** ——
//    紙照印、看起來很正常,錯的是紙上的內容或那張紙根本不該存在。
//    ⇒ 每種各一格,外加一格正向(否則「一律不印」也會全綠)。
// 🔴 另外兩格量的是**路由層**:網址帶兩個 id 而**沒有任何東西保證它們有關係**
//    (`(箱, 訂單)` 這種複合單位天生的破口)。

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listOrderItemsForPrint: vi.fn(),
  loadOrderShipments: vi.fn(),
}));
vi.mock('../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    // 🔴 `Q-C18` 甲:品項改走頂層分頁查詢 —— **這一支才是紙上品項的來源**,
    //    `findAdminOrderDetail` 的 `items` 已經不是(它被內嵌上限 200 夾住)。
    listOrderItemsForPrint: mocks.listOrderItemsForPrint,
  }),
}));
vi.mock('../../../../../../lib/shipping/order-shipments', () => ({
  loadOrderShipments: mocks.loadOrderShipments,
}));

import OrderShippingPrintPage, { generateMetadata } from './page';
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
// 🔴 **`items` 預設取自 `detail().items`,而那是【測試的方便】不是【正式站的來源】**
//    (`Q-C18` 甲之後正式站的來源是頂層分頁查詢 `listOrderItemsForPrint`)。
//    ⇒ 想測「品項清單與 detail 不一致」的格,自己傳 `items`。
const block = (over: {
  detail?: Partial<AdminOrderDetail>;
  items?: readonly AdminOrderPrintItem[];
  reportedTotal?: number | null;
  shipment?: Record<string, unknown>;
  lines?: typeof lines;
}) => {
  const d = detail(over.detail ?? {});
  const items = over.items ?? d.items;
  return shippingDocBlocker({
    detail: d,
    items,
    reportedTotal: over.reportedTotal === undefined ? items.length : over.reportedTotal,
    shipment: shipment(over.shipment ?? {}),
    lines: over.lines ?? lines,
  });
};

/**
 * 設定「這張單長什麼樣」—— 🔴 **兩支 mock 必須一起設。**
 *
 * `Q-C18` 甲之後,紙上的品項來自 `listOrderItemsForPrint`,而**別的欄位**(收件、取消、單號)
 * 仍來自 `findAdminOrderDetail` ⇒ **只設一支的話,兩邊會描述兩張不同的單,而畫面看起來很正常。**
 * ⚠️ 這正是「mock 跨信任邊界 ⇒ 兩端各綠、中間無人守」的形狀,所以收成一支 helper,
 * 讓「忘了設另一支」在結構上比較難發生。
 */
function setDetail(d: AdminOrderDetail) {
  mocks.findAdminOrderDetail.mockResolvedValue(d);
  mocks.listOrderItemsForPrint.mockResolvedValue({
    items: d.items,
    reportedTotal: d.items.length,
  });
}

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
  setDetail(detail());
  mocks.loadOrderShipments.mockResolvedValue([{ shipment: shipment(), lines }]);
});
afterEach(() => cleanup());

describe('🔴 #10 片2b — 八種「不該印」的狀態', () => {
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

  // 🔴🔴 **2026-08-17 `Q-C18` 甲:面6 換了判準本身,不只換文案。**
  //    舊判準 `detail.itemsTruncated` = 「內嵌撈到的筆數觸及我們自己設的上限 200」,
  //    而品項改走頂層分頁撈到盡之後**那個旗標對這張紙已經沒有意義**
  //    ——它仍然會在 200 品項的單上為 true,而我們手上的清單是完整的。
  //    ⇒ 新判準 = **拿到幾列 vs 資料庫說有幾列**。
  it('面6 讀到的筆數與資料庫說的對不上 ⇒ 擋', () => {
    const msg = block({ reportedTotal: 5 }); // fixture 只有 1 項
    expect(msg).toContain('對不上');
    expect(msg).toContain('讀到 1 項');
    expect(msg).toContain('資料庫說有 5 項');
  });

  it('🔴 面6 反向:`itemsTruncated` 為 true 但清單對得上 ⇒ **不擋**(那正是本片要解的)', () => {
    // 這一格是 `Q-C18` 甲的**存在理由**:一張 200 品項的真實訂單會讓 `detail.itemsTruncated`
    // 為 true,而我們拿到的品項清單是完整的 ⇒ **紙照印**。
    // 沒有這一格的話,把判準改回 `detail.itemsTruncated` 不會有任何東西紅。
    expect(block({ detail: { itemsTruncated: true } })).toBeNull();
  });

  it('🔴 面6 `reportedTotal` 為 null(沒拿到 count)⇒ 不擋,但也不假裝有對過帳', () => {
    // count 拿不到時**不能**把它當成 0 或當成「對上了」—— 前者會誤擋,後者是假的保證。
    expect(block({ reportedTotal: null })).toBeNull();
  });

  // 🔴 **2026-08-17 補**:舊文案逐字「請重新整理後再列印」,而觸發它的是**固定上限**
  //    (`ORDER_ITEMS_EMBED_LIMIT = 200`,`packages/adapters/src/supabase/mappers/order.ts:406`)
  //    ⇒ 重整一百次拿回同一個數字 ⇒ **那句話叫員工去做一件永遠不會成功的事**,而他會照做、
  //    會做很多次,然後以為是自己哪裡沒弄對。
  //    ⚠️ 這一格釘的是**不准出現的字**,不是「有沒有講清楚」—— 後者測不出來,前者可以。
  //    🔴 為什麼上一格不夠:上一格只釘正面字面,**把「請重新整理」加回去它照樣全綠**。
  it('🔴 面6 文案不得叫他做會失敗的動作(重整/重試/稍後再試)', () => {
    const msg = block({ reportedTotal: 5 });
    // 🔴🔴 **禁【詞根】,不列祈使形白名單**(R2 N2 推翻我上一版)。
    //    白名單版被兩次穿透:①只禁「重新整理後」⇒「請重新整理再列印一次」全綠(R1 MF5)
    //    ②補上祈使形之後 ⇒「麻煩您重新整理一下再列印看看」**還是全綠**(R2 實測)。
    //    **中文的祈使形舉不完** ⇒ 白名單這個形狀本身就是錯的。
    //    ⇒ 連帶把文案裡那句「重新整理沒有用」也改寫成「不會因為再試一次而改變」,
    //      **讓詞根可以被無條件禁掉** —— 修測試修不動它,要改的是被測的那句話。
    for (const bad of ['重新整理', '重試', '再試一次', '稍後']) {
      expect(msg, `文案叫員工做一件永遠不會成功的事:${bad}`).not.toContain(bad);
    }
    // 正向對照:它仍要給一條**真的做得到**的下一步,否則這一格會退化成「把話刪掉就過」。
    expect(msg).toContain('聯絡負責人');
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
    expect(t).toContain('出貨明細單');
    expect(t).toContain('PCM-2026-0042');
    expect(t).toContain('K7X2MP');
    expect(t).toContain(RECIPIENT.line);
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('2'); // 本次出貨數量,不是訂單的 5
  });

  // ── 抬頭七值(2026-08-17 落地)──
  // 🔴 **真權威 = OD 專案 `pcm-print-docs` / `shipping-picking-doc-a4.html:228-241`**
  //    (我當場 `list_projects` 開的,不是轉述);repo 側
  //    `docs/specs/2026-08-15-shipping-doc-content-contract.md:95-101` 七值逐字相同。
  // 🔴 **這一格釘的是【字面】不是【有沒有那個欄位】** —— 樣張 `:231-232` 自己的註解逐字
  //    「全形半形不動、+886 不改 0、LTD 後面沒有句點」⇒ 被正規化過的版本**看起來一樣正常**,
  //    而它是錯的公司登記資料,會印在交給客人的紙上。
  // ⚠️ `PCM MOTOR PARTS LTD` **沒有句點**是 Sean 親自推翻自己前一句的結果
  //    (合約檔 `:315` 逐字「好啦～沒句點,抱歉」)⇒ 下一格專門擋那個句點回來。
  // 🔴 **釘 `<dd>` 的整格文字,不釘「頁面上有沒有這串字」**(code-reviewer R1 MF1):
  //    第一版用 `textContent.toContain('@pcmmoto')`,而 `sean@pcmmotorsports.com`
  //    **自己就含有 `@pcmmoto` 這個子字串** ⇒ **整列 LINE 刪掉那一格照樣綠**。
  //    ⇒ 逐格相等比對才分得出「這一值在紙上」與「別的值剛好包含它」。
  // 🔴 **比對 `dt → dd` 成【對】,不是「這串字有出現在某個 dd 裡」**(R2 F1)。
  //    上一版只驗「值在某個 `<dd>`」⇒ **把電話格與 email 格的值對調,48 格一個都不紅**
  //    (R2 實測),而紙上會印「電話:sean@pcmmotorsports.com」交給客人。
  //    ⚠️ 更早那一版更弱:用 `textContent.toContain('@pcmmoto')`,而
  //    `sean@pcmmotorsports.com` **自己就含 `@pcmmoto`** ⇒ 整列 LINE 刪掉照樣綠。
  //    ⇒ 三版的差別都不是「有沒有測」,是**它分不分得出錯的那次與對的那次**。
  it('🔴 抬頭七值逐字上紙且欄名配對正確(字面不得被正規化)', async () => {
    const { container } = await renderPage();
    const dl = container.querySelector('dl');
    const pairs = [...(dl?.children ?? [])].map((el) => el.textContent);
    expect(pairs).toEqual([
      '公司名稱',
      '派達有限公司',
      '電話',
      '+886 930-531-867',
      '電子郵件',
      'sean@pcmmotorsports.com',
      '統一編號',
      '90003020',
      '地址',
      '新北市新莊區化成路736巷18號1樓',
      'LINE',
      '@pcmmoto',
      '英文名稱',
      'PCM MOTOR PARTS LTD',
    ]);
  });

  it('🔴 英文名不得帶句點(這是 Sean 推翻過一次的字面,最容易被「順手補回」)', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).not.toContain('PCM MOTOR PARTS LTD.');
  });

  // 🔴 **`generateMetadata` 這一支在本片之前【零守門】**(code-reviewer R1 MF2)。
  //    它是瀏覽器分頁名,而**列印時分頁名會被印在頁首** ⇒ 只改 `<h1>` 的話,
  //    **同一張紙上會出現兩個不同的單據名稱**,而畫面上完全看不出來(頁首要真的印才看得到)。
  //    ⇒ 三條路徑各一格:id 形狀不對 / 查無訂單 / 正常。
  it('🔴 分頁名(列印頁首)三條路徑都跟著改成「出貨明細單」', async () => {
    const p = (id: string) => Promise.resolve({ id, shipmentId: SHIPMENT });
    expect(await generateMetadata({ params: p('not-a-uuid') })).toEqual({ title: '出貨明細單' });

    mocks.findAdminOrderDetail.mockResolvedValue(null);
    expect(await generateMetadata({ params: p(ORDER) })).toEqual({ title: '出貨明細單' });

    setDetail(detail());
    const meta = await generateMetadata({ params: p(ORDER) });
    // 🔴 只留這一條 —— 它已經完全釘死。R2 N3:再加一條 `not.toContain('出貨單 ')`
    //    **永遠不會自己紅**(被上面這條嚴格蘊含),而三行看起來比兩行周全。
    expect(meta.title).toBe('出貨明細單 PCM-2026-0042');
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
    // 🔴 `Q-C18` 甲之後,擋這張紙的不再是 `detail.itemsTruncated`(它已與紙無關),
    //    而是「讀到的筆數 vs 資料庫說的筆數」對不上。
    mocks.listOrderItemsForPrint.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
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
    setDetail(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })),
    );
    expect(titles((await renderPage()).container)).toEqual(['本次出貨', '尚未出貨', '訂單取消']);
  });

  it('🔴🔴 「尚未出貨」的數字是【扣掉這一箱之後】的 —— 少扣就會多印一件給客人看', async () => {
    // 買 9 / 取消 1 / 先前寄 0 / 這一箱 2 ⇒ 9−1−0−2 = 6
    // 🔴 少扣「這一箱」的舊行為會印 8。兩個數不同 ⇒ 這格分得出來。
    setDetail(
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
    setDetail(withSummary(summary()));
    expect(titles((await renderPage()).container)).not.toContain('尚未出貨');
  });

  it('🔴🔴 本檔【不得】印一條跨區的對帳等式(它少了「先前已出貨」那一項,第二箱就對不起來)', async () => {
    // Sean `Q-C4` 拍「會算錯就不印」⇒ 紙面三格、算式四項。
    // 印「訂購 = 本次 + 尚未 + 已取消」的話:訂購 5、先前 2、這箱 1 ⇒ 5 ≠ 1+2+0。
    setDetail(withSummary(summary()));
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
    setDetail(
      withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 2 })),
    );
    const { container } = await renderPage();
    const table = sectionTable(container, '尚未出貨');
    expect(table?.querySelector('tbody td:last-child')?.textContent?.trim()).toBe('6');
  });

  it('🔴 「訂單取消」區只收取消 > 0 的列;沒有取消時整區不出現', async () => {
    setDetail(
      withSummary(summary({ cancelledQuantity: 0, shippedQuantity: 0 })),
    );
    expect(titles((await renderPage()).container)).not.toContain('訂單取消');
  });

  it('🔴 摘要 null 的品項**必須留在紙上**、印「不知道」,不得被濾掉', async () => {
    // ⚠️ 這格是本組最重要的一格:濾掉 null 的話紙上會變成「都寄完了」,
    //    員工就會把剩下的貨放回架上。**空白比錯誤更難發現。**
    setDetail(withSummary(null));
    const t = (await renderPage()).container.querySelectorAll('table')[1]?.textContent ?? '';
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('數量資料尚未就緒');
    expect(t).not.toContain('尚未出貨:無');
  });

  it('🔴 真的都寄完了 ⇒ 說「無」,不留一張空表', async () => {
    setDetail(
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
    setDetail(
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
    setDetail(
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

  // ⚠️ **本 describe 原本有第三個欄位(追蹤碼)** —— `Q-C5`=丙(Sean 2026-08-17)之後
  //    那一列不印了,相關的「印出來了嗎」格全部作廢,**改成下方的反向守門**。
  //    ⚠️ 作廢的只有「紙上有沒有印」那一類;`trackingDisplay` 的判斷本身仍有測試
  //    (`lib/shipping/shipping-doc-dispatch.test.ts`,一格未刪),寫入守門在 `shipment-actions.test.ts`。

  it('貨運商 / 日期 都印出來,而且各自帶標籤', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('貨運商:新竹物流');
    expect(t).toMatch(/日期:\d{4}-\d{2}-\d{2}/);
  });

  it('🔴 號碼並排 ⇒ 每一個都要有標籤(plan §4:客人不知道該拿哪個去查)', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    // 🔴 `displayId` 在片3 之前是**裸印**的(紙上只有 `PCM-2026-0042` 沒有「訂單編號」四個字)。
    expect(t).toContain('訂單編號 PCM-2026-0042');
    expect(t).toContain('箱號 K7X2MP');
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
    // ⚠️ 原本這裡還有一條 `toContain('無追蹤碼(自取 / 自送)')` ⇒ **`Q-C5`=丙 之後那句不印了**,
    //    它的反面(不准印)已由下方 `Q-C5=丙` 那一族守著,不在這裡重複。
  });

  // ── 🔴 `Q-C5`=丙 的反向守門(2026-08-17)──
  //    Sean 逐字 `q3: 丙` ⇒ **出貨明細單不印追蹤碼,追蹤碼只走簡訊／Email**。
  //    🔴 **這一族取代的是四格「印出來了嗎」**,而它們原本各自釘一種 `null` 語意
  //       (有碼 / `missing` / `selfService` / `pending`)⇒ **這裡逐一狀態都要餵一次**,
  //       否則只有「本來就不印」的那一種被守到,而那一種在丙之前就不印了 = 零判別力。
  //    ⚠️ 每一格都帶**正向對照**(貨運商 + 日期照印),不然「整區沒渲染」會被讀成通過。
  //
  //    🔴🔴 **突變實測(2026-08-17,`cp` 備份、非 `git checkout`)**:把那一列**忠實還原**
  //    (import 回 `trackingDisplay` + 四支分支照原樣渲染)⇒ `3 failed | 57 passed`。
  //    **紅的是前三列;第 4 列(未出貨)【綠】,而那是預期的** ——
  //    `pending` 在丙之前本來就 `return null` ⇒ **這一列對「忠實還原」零判別力**。
  //    ⇒ 寫下來是因為「四列全部紅」才是我原本以為會看到的,而事實不是。
  //
  //    🔴 **這一族量得到什麼、量不到什麼(codex R1 逼出來的,我原本寫過頭了)**:
  //    它只認**「追蹤碼」這三個字 + 各狀態原本那句話的字面**。
  //    ⇒ **量不到**:有人加一列印**空值 / 破折號**的追蹤碼欄、或把欄名改叫「**貨運單號**」
  //      ⇒ 紙上真的多了一列,而這四格**照樣全綠**。
  //      (我原本寫「它守的是有人加一列無條件印的追蹤碼」—— **那句話太滿**,只在那一列
  //       仍叫「追蹤碼」且印得出值時才成立。)
  //    ⚠️ 另外 `not.toContain('請回報')` 在第 1、3 列是**恆真**的(那兩種狀態本來就不會有那句話),
  //      它只在第 2 列有判別力。留著是因為四列共用一組斷言比四份各寫一份好維護,**但別把它讀成四道**。
  it.each([
    ['已出貨 + 有碼(丙之前會印出號碼)', { shippedAt: '2026-08-16T02:00:00Z' }, '6412345678'],
    ['已出貨 + 非 other + 無碼(丙之前印「追蹤碼缺漏」)', { carrierCode: 'sf', trackingNumber: null, shippedAt: '2026-08-16T02:00:00Z' }, '缺漏'],
    ['已出貨 + other + 無碼(丙之前印「無追蹤碼(自取 / 自送)」)', { carrierCode: 'other', carrierNote: '客人自取', trackingNumber: null, shippedAt: '2026-08-16T02:00:00Z' }, '自送'],
    ['未出貨(丙之前就整列不印)', { trackingNumber: null, shippedAt: null }, '出貨後補'],
  ])('🔴🔴 Q-C5=丙:%s ⇒ 紙上一個追蹤碼字樣都沒有', async (_name, over, alsoAbsent) => {
    mocks.loadOrderShipments.mockResolvedValue([{ shipment: shipment(over), lines }]);
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).not.toContain('追蹤碼');
    expect(t).not.toContain(alsoAbsent);
    expect(t).not.toContain('請回報');
    // 正向對照:貨運資訊那一區本身還在。
    expect(t).toContain('貨運商:');
    expect(t).toMatch(/日期:\d{4}-\d{2}-\d{2}/);
  });

  it('🔴 未知貨運商代碼 ⇒ 印代碼本身,不留白(守門看不到 DB,回退方向必須安全)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ carrierCode: 'zzz' }), lines },
    ]);
    expect((await renderPage()).container.textContent).toContain('貨運商:zzz');
  });

  it('被擋時貨運資訊也不印 —— 那張紙整張不該存在', async () => {
    // 🔴 `Q-C18` 甲之後,擋這張紙的不再是 `detail.itemsTruncated`(它已與紙無關),
    //    而是「讀到的筆數 vs 資料庫說的筆數」對不上。
    mocks.listOrderItemsForPrint.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
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

describe('🔴 箱品項清單算不出來(loadOrderShipments 回 null)⇒ 不印那張紙', () => {
  // 🔴🔴 **2026-08-16 補;在它之前那一行守門【零測試】** —— code-reviewer R1 MF4 逐字:
  //    「出貨單那張紙是本片的存在理由,而守它的那一行是唯一沒有格子的一行。」
  //    把 `if (groups === null) notFound();` 刪掉,七處既有 mock 全是陣列 ⇒ 照樣全綠。
  it('回 null ⇒ notFound(),不進版面', async () => {
    mocks.loadOrderShipments.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow('notFound');
  });

  it('🔴 正向對照:回陣列時照常印 —— 證明上一格紅的是 null 不是「這支 mock 壞了」', async () => {
    mocks.loadOrderShipments.mockResolvedValue([{ shipment: shipment(), lines }]);
    expect((await renderPage()).container.textContent).toContain('出貨明細單');
  });
});

// ── 列印鈕(2026-08-17)──
// 🔴 **改之前這顆鈕在紅字【上面】、不受 `blocked` 影響** ⇒ 員工按得下去,
//    而印出來的紙上只有那一行紅字 —— **一張沒有用的紙照樣被印出來、照樣可能被放進箱子。**
//    ⇒ 守門擋住了內容,**卻沒有擋住那個人真正按得到的那條路**。
// ⚠️ 這兩格必須成對:只有反面那格的話,把整顆鈕刪掉也會綠(而那不是我們要的)。
// ── `Q-C18` 甲(2/2)接線 ──
//
// 🔴🔴 **這一組是本片【唯一】有判別力的守門,而我第一輪漏了它。**
//    第一輪的突變結果:把品項來源改回 `detail.items` ⇒ **50 格全綠**、
//    把「A 餵壞 B」的 id 集合改回 `detail.items` ⇒ **50 格全綠**。
//    病根:所有 fixture 裡 `detail.items` 與分頁查詢回的東西**逐字相同**
//    ⇒ 換哪一個當來源都印出同一張紙。**每一格都有判別力,而它們對【我宣稱的那件事】零判別力。**
// ⇒ 下面兩格刻意讓**兩個來源不一樣**:`detail`(內嵌、被 200 夾住)只看得到 1 項,
//    而分頁查詢撈到 3 項 —— 這正是一張 200+ 品項的真實訂單的形狀。
describe('🔴 Q-C18 甲:紙上的品項來自分頁查詢,不是被夾過的 detail.items', () => {
  const paged = [0, 1, 2].map((i) => ({
    id: `${ITEM.slice(0, -1)}${i}`,
    variantSku: `PAGED-SKU-${i}`,
    title: `分頁品名 ${i}`,
    spec: null,
    quantity: 1,
    quantitySummary: null,
  }));

  beforeEach(() => {
    // detail 只看得到第 0 項(模擬內嵌被上限夾住);分頁查詢看得到三項。
    setDetail(detail({ items: [detail().items[0]] as never, itemsTruncated: true }));
    mocks.listOrderItemsForPrint.mockResolvedValue({ items: paged, reportedTotal: 3 });
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment(), lines: [{ orderItemId: paged[0]!.id, title: 'x', quantity: 1 }] },
    ]);
  });

  it('🔴 被 detail 夾掉的那兩項【也要出現在紙上】', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    // 把「尚未出貨」那半的來源改回 `detail.items` ⇒ 這兩個字面消失 ⇒ 這一格紅。
    expect(t).toContain('PAGED-SKU-1');
    expect(t).toContain('PAGED-SKU-2');
  });

  it('🔴 【本次出貨】那張表的料號也要從分頁清單對回去(itemById 的來源)', async () => {
    // ⚠️ 這一格是補的:上一格只涵蓋「尚未出貨」那半 ——
    //    突變「`itemById` 改回 `detail.items`」在只有上一格時**不會紅**
    //    (本次出貨那格會變成空白,而上一格根本沒看那張表)。
    //    📎 又一次「每一格都有判別力,而它們對【我宣稱的那件事】零判別力」。
    const table = must((await renderPage()).container.querySelectorAll('table')[0], '本次出貨表');
    expect(table.textContent).toContain('PAGED-SKU-0');
  });

  // 🔴🔴 **這一格是【逐對盤點】盤出來的,不是我想到的。**
  //    主視窗 2026-08-17 的可操作版:**改資料來源的片,先列出【所有被換掉的那對】,
  //    逐對問「fixture 裡它們長得一樣嗎」** —— 一樣就先把它們弄不一樣,再寫斷言。
  //    我照著把 6 對逐一突變,`cancelledRows` 那一對**仍然全綠** ——
  //    **補了三格之後,第四個病還在。** 這正是「補格」本身回答不了的那個問題。
  it('🔴 【訂單取消】那一區的母體也要是分頁清單(逐對盤點補的第 4 對)', async () => {
    const cancelled = {
      ...paged[1]!,
      variantSku: 'PAGED-CANCELLED',
      // 🔴 **全數取消**(quantity 3 / cancelled 3 / shipped 0)⇒ 尚未出貨算出來是 0
      //    ⇒ 它**只會**出現在「訂單取消」那一區。
      //    ⚠️ 我第一版給 quantity 9 / cancelled 3 ⇒ 它**同時出現在「尚未出貨」區**
      //    ⇒ 突變把取消區的來源改回 `detail.items` 時,那個字面**仍然在紙上** ⇒ 這一格全綠。
      //    📎 **斷言釘的是「這個字面在紙上」,而它在別的區也印得出來** —— 又一次量錯東西。
      quantitySummary: {
        quantity: 3,
        orderedQuantity: 0,
        instockQuantity: 0,
        cancelledQuantity: 3,
        shippedQuantity: 0,
      },
    };
    mocks.listOrderItemsForPrint.mockResolvedValue({
      items: [paged[0]!, cancelled],
      reportedTotal: 2,
    });
    // 這一項**不在** `detail.items` 裡 ⇒ 來源改回 `detail.items` 就找不到它 ⇒ 取消區空掉。
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).toContain('PAGED-CANCELLED');
  });

  it('🔴🔴 「A 餵壞 B」:餵給箱查詢的 id 集合必須是【完整那份】', async () => {
    await renderPage();
    // `loadOrderShipments(titleByItemId)` —— 以前這個 Map 來自被 200 夾過的 `detail.items`
    // ⇒ 訂單 300 項時,後 100 項所在的箱**根本不會被查到,而那不算截斷、零訊號**。
    const arg = mocks.loadOrderShipments.mock.calls[0]?.[0] as Map<string, unknown>;
    expect([...arg.keys()].sort()).toEqual(paged.map((p) => p.id).sort());
  });
});

// ── 🔴 負向對照:一張【真的超過門檻】的單 ──
//
// ⚠️⚠️ **這是【接縫層】的負向對照,不是端到端的。** 它證明的是:
//   「當 adapter 回一張 250 項的單時,舊來源印 200 項、新來源印 250 項」。
//   它**不證明**「正式站上一張 250 項的真訂單印得出來」—— 那要真 DB,而本窗沒有
//   (`.env.local` 不在施工窗)⇒ **端到端那一格【未做】,不要把這格讀成它。**
// 📌 而門檻本身(`row.order_items.length >= ORDER_ITEMS_EMBED_LIMIT`)由 adapter 自己的
//   測試守著(`packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts` 的
//   「品項數觸及 ORDER_ITEMS_EMBED_LIMIT ⇒ itemsTruncated = true」那格),本檔不重複。
describe('🔴 負向對照:250 項的單 —— 改之前會少 50 項,改之後印得完', () => {
  const LIMIT = 200; // `packages/adapters/src/supabase/mappers/order.ts` 的 ORDER_ITEMS_EMBED_LIMIT
  const TOTAL = 250;
  const all = Array.from({ length: TOTAL }, (_, i) => ({
    id: `bulk-${String(i).padStart(4, '0')}`,
    variantSku: `BULK-${String(i).padStart(4, '0')}`,
    title: `團購品 ${i}`,
    spec: null,
    quantity: 1,
    quantitySummary: null,
  }));

  beforeEach(() => {
    // `detail` = adapter 內嵌撈回來的樣子:**只有前 200 項,且 itemsTruncated = true**。
    setDetail(detail({ items: all.slice(0, LIMIT) as never, itemsTruncated: true }));
    // 分頁查詢 = 撈到盡:250 項。
    mocks.listOrderItemsForPrint.mockResolvedValue({ items: all, reportedTotal: TOTAL });
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment(), lines: [{ orderItemId: all[0]!.id, title: 'x', quantity: 1 }] },
    ]);
  });

  it('🔴 第 201 到第 250 項【出現在紙上】—— 改之前它們整批不見,而紙看起來完全正常', async () => {
    const t = (await renderPage()).container.textContent ?? '';
    // 邊界兩側各釘一個:第 200 項(舊路徑最後一個看得到的)與第 201 項(舊路徑第一個掉的)。
    expect(t, '第 200 項').toContain('BULK-0199');
    expect(t, '🔴 第 201 項 —— 舊路徑從這裡開始整批消失').toContain('BULK-0200');
    expect(t, '🔴 最後一項').toContain('BULK-0249');
  });

  it('🔴 紙上出現的品項【互不重複】且共 250 個 —— 釘數量不只釘存在', async () => {
    // 🔴 只釘字面的話,「印了 250 項但其中 50 項重複」也會過。
    // ⚠️ **刻意不用 `tables[1]`(表格索引)定位** —— 我第一版那樣寫,而它量到的是別張表
    //    (紙上有幾張表隨資料形狀變)⇒ **量錯東西,而它會回一個看起來像數量的數。**
    const text = (await renderPage()).container.textContent ?? '';
    const found = new Set(text.match(/BULK-\d{4}/g) ?? []);
    expect(found.size).toBe(TOTAL);
  });

  it('🔴🔴 餵給箱查詢的 id 集合是 250 個,不是 200 —— 「A 餵壞 B」的負向對照', async () => {
    await renderPage();
    const arg = mocks.loadOrderShipments.mock.calls[0]?.[0] as Map<string, unknown>;
    // 改之前:後 50 項所在的箱**根本不會被查到,而那不算截斷、零訊號**。
    expect(arg.size).toBe(TOTAL);
    expect(arg.has('bulk-0249')).toBe(true);
  });

  it('🔴 正向對照:`itemsTruncated` 仍為 true 而紙【照印】—— 這正是本片的存在理由', async () => {
    // 沒有這一格的話,把面6 判準改回 `detail.itemsTruncated` 會讓上面三格全部變成
    // 「被擋住所以沒有那些字面」⇒ 紅得對而理由完全錯。
    const { container } = await renderPage();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll('table').length).toBeGreaterThan(0);
  });
});

describe('🔴 被擋時不得留下一顆按得下去的列印鈕', () => {
  // 🔴 **釘 `<button>` 元素,不釘「列印」兩個字** —— 第一版釘字面,而**擋下來的那句文案裡
  //    就有「再列印」三個字**(舊文案逐字「請重新整理後再列印」)⇒ 那一格會因為**文案**變動而紅,
  //    紅的理由與它要守的東西無關。**突變 M3(只改文案)當場讓它紅,是它自己招的。**
  // ⚠️ **只數「文字剛好是【列印】的那顆 button」**(code-reviewer R1 nit8):
  //    釘 `querySelector('button')` 太寬 —— 這頁日後加任何一顆鈕(例如「回訂單頁」)
  //    都會讓下面第一格因為**無關的變動**而紅,而正向對照也不保證命中的是 `PrintButton`。
  const printButtons = (c: HTMLElement) =>
    [...c.querySelectorAll('button')].filter((b) => b.textContent === '列印');

  it('被擋 ⇒ 沒有列印鈕', async () => {
    // 🔴 `Q-C18` 甲之後,擋這張紙的不再是 `detail.itemsTruncated`(它已與紙無關),
    //    而是「讀到的筆數 vs 資料庫說的筆數」對不上。
    mocks.listOrderItemsForPrint.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
    expect(printButtons((await renderPage()).container)).toHaveLength(0);
  });

  it('🔴 正向對照:沒被擋 ⇒ 列印鈕還在(證明上一格不是「這顆鈕根本不存在」)', async () => {
    expect(printButtons((await renderPage()).container)).toHaveLength(1);
  });
});
