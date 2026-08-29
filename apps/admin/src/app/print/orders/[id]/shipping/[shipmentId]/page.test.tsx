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
  listOrderItemsForDetail: vi.fn(),
  loadOrderShipments: vi.fn(),
}));
vi.mock('../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    // 🔴 `Q-C18` 甲:品項改走頂層分頁查詢 —— **這一支才是紙上品項的來源**,
    //    `findAdminOrderDetail` 的 `items` 已經不是(它被內嵌上限 200 夾住)。
    listOrderItemsForDetail: mocks.listOrderItemsForDetail,
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
    // 🔴 **片4 補:訂單層金額四欄。**
    //    在這之前 fixture 沒有它們,而 `as unknown as AdminOrderDetail` **把缺欄藏住了**
    //    ⇒ 型別上是 `Money`(必填)、TS 一聲不吭,而元件一讀 `.amount` 就當場 TypeError。
    //    ⚠️ 那個 cast 是這支 fixture 的既有寫法,本片沒有翻它;但**它讓 14 格一起紅**,
    //       而紅的理由讀起來像「金額功能壞了」,實際是「fixture 少欄」。**記在這裡免得下一個人追錯方向。**
    // 🔴 值刻意挑不與 電話 0912345678 / 單號 PCM-2026-0042 / 箱號 K7X2MP /
    //    單價 74183 / 小計 88291 / 數量 5 / 日期 撞的數字(與 picking 那支同一組,已驗過不撞)。
    subtotal: { amount: 51987, currency: 'TWD' },
    shippingFee: { amount: 611, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 52598, currency: 'TWD' },
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
//    (`Q-C18` 甲之後正式站的來源是頂層分頁查詢 `listOrderItemsForDetail`)。
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
 * `Q-C18` 甲之後,紙上的品項來自 `listOrderItemsForDetail`,而**別的欄位**(收件、取消、單號)
 * 仍來自 `findAdminOrderDetail` ⇒ **只設一支的話,兩邊會描述兩張不同的單,而畫面看起來很正常。**
 * ⚠️ 這正是「mock 跨信任邊界 ⇒ 兩端各綠、中間無人守」的形狀,所以收成一支 helper,
 * 讓「忘了設另一支」在結構上比較難發生。
 */
function setDetail(d: AdminOrderDetail) {
  mocks.findAdminOrderDetail.mockResolvedValue(d);
  mocks.listOrderItemsForDetail.mockResolvedValue({
    items: d.items,
    reportedTotal: d.items.length,
  });
}

async function renderPage(id = ORDER, shipmentId = SHIPMENT) {
  const result = render(await OrderShippingPrintPage({ params: Promise.resolve({ id, shipmentId }) }));
  // 🔴 **分母守門(2026-08-28 突變量到本檔五格是恆綠的)**:本檔大量斷言的形狀是
  //    「紙上**不得**出現某句話」/「某一區整個不出現」—— 而**整頁沒渲染時它們全部成立**。
  //    ⇒ 「那一區正確地沒出現」與「這張紙根本沒印出來」印同一個綠。
  //    放進共用的 renderPage:一道蓋住全檔, 新加的格自動有分母。
  //    ⚠️ 被擋的世界也算「有渲染」—— 它印的是一張只有 <Alert> 的紙 ⇒ 錨要涵蓋 role="alert"。
  //    釘節點數(結構), 不釘任何一句文案。
  expect(
    result.container.querySelectorAll('h1, h2, [role="alert"]').length,
    '整張紙一個標題節點、一則 alert 都沒有 ⇒ 頁面根本沒渲染 ⇒ 本格的負向斷言恆真',
  ).toBeGreaterThan(0);
  return result;
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

/**
 * 讀紙上 `.pd-field` 的 **`.k` 欄名 → `.v` 值** 配對。
 *
 * 🔴 **為什麼從「子字串」改成「配對」**(2026-08-23 片2):稿把欄名與值排成兩欄
 *    (`預覽-出貨明細單.html` 的 `.pd-field`)⇒ 中間**沒有冒號**,
 *    `textContent` 由 `貨運商:新竹物流` 變成 `貨運商新竹物流`。
 *    ⚠️ 若只是把斷言改成 `toContain('貨運商新竹物流')`,**通過集合會變大**:
 *       那樣分不出「值印在正確的欄名旁邊」與「兩個相鄰欄位剛好接成這串字」。
 *    ⇒ 改成配對比對 —— 它比舊的子字串**更強**:舊的抓不到「值跑到別的標籤底下」,
 *      而 2026-08-15 R2 就是為了同一個病才把抬頭那格從「值在某個 dd」升級成 `dt→dd` 配對。
 * 📎 突變證明見本片交件檔:把兩個欄位的值對調 ⇒ 這一族必紅。
 */
const infoFields = (container: HTMLElement): [string, string][] =>
  [...container.querySelectorAll('.pd-field')].map((el) => [
    el.querySelector('.k')?.textContent?.trim() ?? '',
    el.querySelector('.v')?.textContent?.trim() ?? '',
  ]);

/** `.pd-field` 裡指定欄名的值;查無回 `undefined`(**不回空字串** —— 那會讓「沒有這一格」與「這一格是空的」長得一樣)。 */
const infoValue = (container: HTMLElement, key: string): string | undefined =>
  infoFields(container).find(([k]) => k === key)?.[1];

describe('🔴 #10 片2b — 八種「不該印」的狀態', () => {
  it('正向:一切正常時可以印(否則下面六格全部恆綠)', () => {
    // 🔴🔴 **這一格自己曾經是恆綠的(2026-08-28 量到)**:把 `shippingDocBlocker` 改成
    //    `if (true) return null;`(它對任何輸入都不擋)⇒ **本格與下面那六格【全部】照樣綠**。
    //    ⇒ 標題那句「否則下面六格全部恆綠」是對的, **而它自己也在那個名單裡**。
    //    ⇒ 先證這把閘是活的:一個已知該擋的世界必須真的擋。
    expect(
      block({ detail: { cancelledAt: '2026-08-05T02:00:00+00:00' } }),
      '連已取消的單都不擋 ⇒ 這把閘整支沒在跑, 下面那個 null 不算數',
    ).not.toBeNull();
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
    // 🔴 **分母守門**:同 `:185` —— 閘整支回 null 時本格也綠。
    expect(
      block({ detail: { cancelledAt: '2026-08-05T02:00:00+00:00' } }),
      '連已取消的單都不擋 ⇒ 這把閘整支沒在跑, 下面那個 null 不算數',
    ).not.toBeNull();
    expect(block({ detail: { itemsTruncated: true } })).toBeNull();
  });

  // ── 🔴🔴 **這一格 2026-08-18 被翻過來,原本斷言的是「不擋」** ────────────────
  //    🔴 **誰翻的(兩級分開,不要合成一句)**:
  //      **裁定人 = 主視窗(2026-08-18)。非 Sean 拍板。**
  //      提報 = T② 窗 ／ 量測 = V 窗 ／ 落地 = C 窗。
  //      ⚠️ **Sean 已被直接問過;他若另有裁示,以他為準、本裁定作廢。**
  //      (兩級分開寫的理由:合成一句之後,三個月後沒有人分得出來「他到底同意了沒」。)
  //    **原本那格的名字與理由**(留著,不要刪):
  //      「`reportedTotal` 為 null(沒拿到 count)⇒ **不擋**,但也不假裝有對過帳」
  //      理由逐字:「count 拿不到時不能把它當成 0 或當成『對上了』——
  //                 前者會誤擋,**後者是假的保證**。」
  //    🔴 **翻它的依據,是那句理由【反對它自己的斷言】**:
  //      **「不擋」就是把它當成對上了** —— 紙照印,而且沒有經過完整性檢查
  //      ⇒ **那正是他自己說的「假的保證」,只是換成了紙的形式。**
  //      而測試名字裡那句「**但也不假裝有對過帳**」——**紙上沒有任何一個字在說「這張沒對過帳」**,
  //      那句話**沒有落點**。
  //    🔴 **而 Sean 對這個形狀拍過板**(2026-08-17 `Q2`=甲,逐字):
  //      「**撈不全就整區失敗、不顯示任何一列**」/「**標了警告的清單,對帳的人還是會照著算**」
  //      ⇒ 翻這一格**不是同儕窗的判斷蓋過前人**,是**把它對齊一個後來的拍板**。
  //    ⚠️ 原作者防住的是「**在比較式裡誤用 null**」,而沒有防住「**不比較就放行**」——
  //      **兩者是同一個病的兩個面。** 這一格現在守後者。
  it('🔴🔴 面6-b `reportedTotal` 為 null(沒拿到對帳訊號)⇒ **擋印**', () => {
    const msg = block({ reportedTotal: null });
    expect(msg).not.toBeNull();
    // 🔴 訊息必須是「**沒得對**」那一句,不是「**對不上**」那一句 ——
    //    值班的人要分得出「系統壞了」與「資料真的少了」。
    expect(msg).toContain('讀不到');
    expect(msg).toContain('無法確認');
    expect(msg).not.toContain('對不上');
    // 🔴 沿用同檔既有紀律:文案不准叫他做會失敗的動作。
    for (const bad of ['重新整理', '重試', '再試一次', '稍後']) {
      expect(msg, `文案叫員工做一件他做不到的事:${bad}`).not.toContain(bad);
    }
  });

  it('🔴 面6-b 反向:拿得到總數而且對得上 ⇒ **印得出來**(否則上一格靠「一律擋」就能過)', () => {
    // 沒有這一格的話,把整支 blocker 改成「永遠回一句話」上一格照樣綠。
    expect(block({ reportedTotal: null })).not.toBeNull();
    expect(block({})).toBeNull(); // fixture 預設 reportedTotal = items.length
  });

  // 🔴🔴 `#634`:`reportedTotal` 是 `NaN` —— 型別是 `number | null`，而 `NaN` **是** `number`
  //    ⇒ 它躲得過上面那個 `=== null`，然後 `items.length !== NaN` **恆真**
  //    ⇒ 掉進下面那句，印出「資料庫說有 **NaN** 項」給值班的人看。
  //    🔴 **斷言釘在「畫面不准出現 `NaN` 字樣」，不是「有沒有擋印」** ——
  //      後者在修之前**也是綠的**（`NaN` 本來就會擋，只是擋錯句子）⇒ 那個斷言零判別力。
  //      這正是「一格測試可以有判別力又測一個不存在的病」的反面:**寫錯斷言 = 一格恆綠的守門。**
  it('🔴🔴 `#634` `reportedTotal` 為 NaN ⇒ 擋印，且訊息不得出現「NaN」字樣', () => {
    const msg = block({ reportedTotal: Number.NaN });
    expect(msg).not.toBeNull();
    expect(msg, '把一個 JS 內部值原樣印給值班的人看').not.toContain('NaN');
    // 語意上它與 `null` 同一類:**沒得對**（讀不到總數），不是**對不上**（讀到的與總數不符）。
    expect(msg).toContain('讀不到');
    expect(msg).not.toContain('對不上');
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

  // 🔴🔴 **上面兩格漏掉的那一種組合:`items` 空【而且】`lines` 也空**(2026-08-18 審查 must-fix)。
  //    上面兩格用的是 `block({ detail: { items: [] } })` —— **`lines` 走 fixture 預設,非空**
  //    ⇒ 面5 不會發 ⇒ 那兩格**測不到面5 與面8 的先後**。
  //    🔴 而**零品項的單,`lines` 實際上也會是 0** ⇒ 落地前面5 先發
  //    ⇒ 紙上印「**請從訂單頁的出貨卡點進來,不要自己拼網址**」
  //    ⇒ **真正的病是「整張單讀不到品項」(系統),而值班看到的是「你自己拼網址」(怪他)。**
  //    ⚠️ **不是安全洞** —— 兩種都擋印。壞的是**診斷方向 + 怪錯人**。
  //    📎 這一格與上一格是**同一條順序規則的兩個面**(面8 vs 面7 / 面8 vs 面5),
  //       而上一格**只涵蓋了一個面** —— 那正是本片被抓到的原因。
  it('🔴 面8 也必須排在面5 之前(兩者都空時,不可以怪員工拼網址)', () => {
    const msg = block({ detail: { items: [] }, lines: [] });
    expect(msg, '面5 搶先回了 ⇒ 把系統的問題說成員工操作錯').toContain('讀不到任何品項');
    expect(msg).not.toContain('不要自己拼網址');
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
    // 🔴 **片2:`<dl>` 七列被稿壓成三行跑文字** ⇒ 這一格改驗**三行各自逐字相等**。
    //    ⚠️ 那**不是放寬**:整行相等比 `dt→dd` 配對更嚴 ——
    //       配對只保證「這個值在這個欄名旁邊」,整行相等**連分隔空格與順序都釘死**。
    //       (電話與 email 對調 ⇒ 第 3 行整串不同 ⇒ 紅;少一個全形空格 ⇒ 紅。)
    //    🔴 分隔是**全形空格 U+3000**,不是兩個半形。這裡刻意用逸出字元寫,
    //       免得下一個人在編輯器裡把它「順手」換成半形而看不出差別。
    const { container } = await renderPage();
    const issuer = container.querySelector('.pd-issuer');
    const lines = [...(issuer?.children ?? [])].map((el) => el.textContent);
    const S = '\u3000';
    expect(lines).toEqual([
      `派達有限公司${S}PCM MOTOR PARTS LTD${S}統一編號 90003020`,
      '新北市新莊區化成路736巷18號1樓',
      `+886 930-531-867${S}sean@pcmmotorsports.com${S}LINE @pcmmoto`,
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
    const table = must((await renderPage()).container.querySelectorAll('.pd-items table')[0], '本次出貨表');
    // 🔴🔴 **片4b:從「最後一格」改成「元件宣告的數量格」——【更緊,不是更鬆】。**
    //    改前是 `[...querySelectorAll('tbody > tr > td')].at(-1)` = **位置假設**,
    //    而加金額欄的那一刻最後一格就換人了 —— 這一格當場紅給我看,收到 `'148,366'`。
    //    📌 **這正是 R4 F4 / R3 MF7 預告的那件事**(「片5 在數量後面加一欄,分母就整組換人」),
    //       而它這次是**紅的**,因為期望值是具體值不是「有數字就好」。
    //    ⇒ `data-slot='qty'` 是元件自己標的:**它漂掉的時候會紅,位置假設不會。**
    //    ⚠️ 期望值 `'2'` 與下面那條 `not.toContain('5')` **一個字都沒動**(四問第 4 問)。
    const cell = table.querySelector('tbody td[data-slot="qty"]');
    expect(cell, '找不到元件宣告的數量格 ⇒ 下面兩條會恆真').not.toBeNull();
    expect(cell?.textContent?.trim()).toBe('2');
    expect(cell?.textContent).not.toContain('5');
  });

  it('被擋時:出警告**而且不印品項表**(印出來就會有人照著出貨)', async () => {
    // 🔴 `Q-C18` 甲之後,擋這張紙的不再是 `detail.itemsTruncated`(它已與紙無關),
    //    而是「讀到的筆數 vs 資料庫說的筆數」對不上。
    mocks.listOrderItemsForDetail.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
    const { container } = await renderPage();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).not.toContain('LTC-BK-XL');
  });

  it('🔴🔴 `#601` 被擋時是【整幅】阻印版面,不是一行警告 —— 釘的是份量不是字面', async () => {
    // 🔴 **這一格守的是「員工會不會照著那張紙做」,而那件事的變數是【份量】。**
    //    設計端逐字(樣張 `:551`):「印出來看起來正常的紙,員工就會照做,
    //    所以警告必須佔滿這個位置。」
    // 🔴 **為什麼不能只斷言 `toContain('本單不得出貨')`**:把這一幅縮回一行
    //    `<Alert>本單不得出貨</Alert>`,那個斷言**照樣綠**,而紙又變回「看起來正常」——
    //    也就是這件事整個沒做。⇒ 斷言**結構與條目數**,不只斷言字面。
    // 🔴 **也不能只斷言 `[role="alert"]` 存在** —— 上一格已經那樣做了,而它在
    //    「一行 Alert」的世界裡也是綠的(落地前 61 格全過就是證據)。
    // ⚠️ 誠實:單測量不到「它在紙上佔多大」。本格證的是**那些內容都在同一塊裡、而且沒被砍**;
    //    真的印出來看的紀錄另外走 `scripts/pagecount.sh --png`。
    mocks.listOrderItemsForDetail.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
    const { container } = await renderPage();
    const panel = container.querySelector('[data-slot="print-blocked"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('role')).toBe('alert');
    // 標題、訂單編號、以及「這不是漏印」那一句 —— 三者缺一,紙上就少了一層意思。
    expect(panel?.textContent).toContain('本單不得出貨');
    expect(panel?.textContent).toContain('PCM-2026-0042');
    expect(panel?.textContent).toContain('本頁不含品項明細');
    expect(panel?.textContent).toContain('這不是資料漏印,是刻意不印');
    // 🔴 四條「請照這樣做」逐字照樣張,**條目數也釘住** —— 少一條就是少一個動作,
    //    而少掉的那一條(例如「若貨已裝箱,先停下」)正是最貴的那一種情境。
    const actions = [...(panel?.querySelectorAll('li') ?? [])].map((li) => li.textContent?.trim());
    expect(actions).toEqual([
      '不要依本單揀貨、裝箱或出貨。',
      '不要把本單放進任何箱子。',
      '把本單作廢並回報主管,由系統重新確認後再列印。',
      '若貨已裝箱,先停下並確認箱內狀態,不要交給貨運。',
    ]);
    // 原因那一格吃的是 `shippingDocBlocker()` 那句話,不是另外寫一份文案。
    expect(panel?.textContent).toContain('出貨明細單可能少印品項');
    // 🔴 樣張列了「六種情形」那張清單,而我們有八種 ⇒ **刻意不印那張清單**。
    //    印一張比實際少兩種的清單,員工會以為自己遇到的狀況不在系統的預期內。
    expect(panel?.textContent).not.toContain('六種');
  });

  // ── 🔴 片4:金額落地。**這一格是【改寫】,不是刪掉** ──────────────────────────
  //    上一版的標題是「金額區塊還沒做 ⇒ 紙上不得出現任何金額」,而它的註解**自己寫著**:
  //    「這格仍是暫時的:金額真的落地時**要改寫這格**,不是刪掉。留著是為了在那之前
  //      擋住『順手把金額加上去』——那會在沒拍板的情況下印給客人看。」
  //    ⇒ 現在金額經 Sean 拍板落地,那道「不准印」的職責結束,**換成「印的是不是對的」**。
  const moneyRows = (c: HTMLElement) =>
    [...(c.querySelector('.pd-money')?.querySelectorAll('tr') ?? [])].map((tr) => [
      tr.querySelector('.k')?.textContent?.trim() ?? '',
      tr.querySelector('.v')?.textContent?.trim() ?? '',
    ]);

  it('🔴 金額四列:每個數字都是【欄位原值】,零運算(Q-D-7)', async () => {
    const { container } = await renderPage();
    // 🔴 **釘配對,不是釘「這串數字有出現」** —— 後者分不出「運費印成了小計」。
    expect(moneyRows(container)).toEqual([
      ['小計', '51,987'],
      ['運費', '611'],
      ['訂單金額', '52,598'],
    ]);
    // 🔴 全站不寫 NT$;幣別只在區塊抬頭出現一次。
    const t = container.textContent ?? '';
    expect(t).not.toContain('NT$');
    expect(t.split('新臺幣').length - 1).toBe(1);
    // 🔴 **負向對照:不得出現「自己算出來的」數字。**
    //    `Q-D-7` 禁止反推與自算;`74183`(單價)與 `88291`(品項小計)是品項層的值,
    //    它們**不該出現在訂單層的金額區**。若有人把 `unitPrice × 數量` 加總印上去,這裡會紅。
    const money = container.querySelector('.pd-money')?.textContent ?? '';
    expect(money).not.toContain('74183');
    expect(money).not.toContain('88291');
  });

  it('🔴🔴 片4:LOGO 與 QR 必須是 `<img>`,而且沒有任何東西掛在 background 上', async () => {
    // 🔴 **這一格守的是 Sean 2026-08-23 14:08 實印抓到的那件事**:
    //    用 `background` 畫的 LOGO / QR / 三色條 / 黑底反白帶**四樣全不見**,
    //    而同一張紙上的文字與框線都在。瀏覽器預設不印背景,而「背景圖形」那個勾選框是
    //    **使用者的**,`print-color-adjust:exact` 蓋不掉它。
    // ⚠️ **在這一格之前,repo 裡沒有任何東西在看這件事** —— 有人把 `<img>` 改成
    //    `background-image` 時,螢幕上一模一樣、三綠全綠,**只有紙上會少東西**。
    const { container } = await renderPage();
    const imgs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    // 🔴 2026-08-29 線A:從【等於這兩個網址】改成【不得是任何會發出請求的東西】。
    //    理由:那兩個網址走 `proxy.ts` 的登入閘 ⇒ 沒有 cookie 的請求(伺服器渲染出圖)被 303,
    //    而症狀是【圖不見了, 不是錯誤】—— 三綠全綠、零告警。
    //    ⇒ 舊斷言擋的是「網址變了」(連變成更安全的也擋);新斷言擋的是
    //      【網址回到一個要登入的地方】⇒ 它允許更好的做法, 只禁止重新打開那個缺口。
    expect(imgs).toHaveLength(2);
    for (const src of imgs) {
      expect(src?.startsWith('data:image/png;base64,')).toBe(true);
      expect(src).not.toMatch(/^\/print\//); // 走登入閘 ⇒ 無 cookie 被 303
      expect(src).not.toMatch(/^https?:\/\//); // 外部網址 ⇒ 容器不一定連得出去
      expect(src).not.toMatch(/^\/_next\//); // 靜態資源 ⇒ 仍然是一次 HTTP 請求
    }
    // 每張圖都要有 alt(單色印表機印不出來時,螢幕上至少讀得到那是什麼)。
    expect([...container.querySelectorAll('img')].every((i) => (i.getAttribute('alt') ?? '') !== '')).toBe(true);
    // 🔴 **原始碼層**:元件裡不准出現 background-image / backgroundImage。
    //    渲染層看不到這件事 —— CSS 是外部檔,jsdom 不套用它。
    // 用本檔既有的 `SRC`(:48 的 `join(__dirname, …)`)讀原始碼,不另外引入路徑工具。
    // 🔴 **要剝註解** —— `shipping-doc.tsx` 的註解裡就寫著「不得改成 background-image」
    //    ⇒ 對全文 `not.toContain` 會被**它自己的說明文字**弄紅。
    //    📎 同族坑今天在 `print-a4.css` 那片已經發生過一次(`.print-sheet` 出現在註解裡),
    //       正本 `docs/patterns/guard-and-instrument-traps.md`「偵測字串自命中」。
    // 🔴 2026-08-29 A3-1'a:LOGO 那顆 `<img>` 搬到 `components/print/print-masthead.tsx`
    //    ⇒ 只讀 shipping-doc 的話,這道守門對 LOGO 【失明而印綠】
    // ⛔ ~~(正對照 `src='/print/line-qr.png'` 仍在 shipping-doc ⇒ 它會繼續證明「檔沒讀空」)~~
    //    🛑 **2026-08-29 code-reviewer 抓到:那個字面已經不在了** ——
    //       本片把它換成 `src={QR_DATA_URI}`, 而舊字面只剩註解、又被同格的 `strip()` 剝掉。
    //    ✅ 現行正對照的字面是 `src={QR_DATA_URI}` / `src={LOGO_DATA_URI}`(見下),
    //       **性質不變**:仍各自證明那一支檔真的被讀進來了。
    //    📌 ⇒ 改了字面而沒改描述它的那句話 = 這支檔開始對自己說謊。⇒ 兩支一起讀。
    const strip = (f: string) =>
      readFileSync(join(SRC, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    const DOC =
      strip('components/print/shipping-doc.tsx') + strip('components/print/print-masthead.tsx');
    expect(DOC).not.toContain('background-image');
    expect(DOC).not.toContain('backgroundImage');
    // 正向對照:證明上面那兩個 0 不是因為檔案讀成空字串。
    expect(DOC).toContain('src={QR_DATA_URI}');
    // 🔴 第二個正對照:證明【masthead 那半】也真的被讀進來了 —— 少了它,
    //    上面兩個 0 會在「masthead 讀成空字串」的世界裡照樣成立。
    expect(DOC).toContain('src={LOGO_DATA_URI}');
    // 🔴 2026-08-29 線A:兩個正對照的【字面】跟著改法換了, 而它們的【性質沒變】——
    //    仍然各自證明「那一支檔真的被讀進來了」(少了它, 上面兩個 0 會在
    //    「檔案讀成空字串」的世界裡照樣成立)。⇒ 換字面不是降級, 前提是性質保住。
  });

  it('🔴🔴 片4b:出貨單【不得讀 `lineTotal`】—— 型別帶進來了,而紙上不准用它', async () => {
    // 🔴 **這道守門是 Q3=乙 的配套**(78 2026-08-24 裁):
    //    本頁改吃 `listOrderItemsForDetail`,型別因此多帶一個 `lineTotal`。
    //    ⚠️ **`lineTotal` 是【下單量】的行小計**,而 `Q-D-7` 要的是 `unitPrice × 本區數量`
    //       ⇒ 印它會印成**另一個區的錢**,而那張紙寄出去收不回來。
    // 🔴 **為什麼是「機制」不是「規則」**:甲案(新建一份不含 lineTotal 的投影)靠的是
    //    「沒有人會用錯」的期待 —— 錯了不會紅。這一格會紅。
    // ⚠️ **要剝註解** —— 上面那段說明文字自己就含 `lineTotal` 四個字
    //    (同族坑正本 `docs/patterns/guard-and-instrument-traps.md`「偵測字串自命中」)。
    const DOC = readFileSync(join(SRC, 'components/print/shipping-doc.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // 🔴🔴 **這一格 2026-08-24 被 codex finding 3 換過方向,而換的理由有兩層:**
    //
    //    ① **舊版擋不住**:它找的是【單一檔案的連續字面 `lineTotal`】
    //       ⇒ `item['line'+'Total']` / 別名 / 中繼函式全繞得過。
    //       codex 的 WOULD-CHANGE 我在真 runner 覆過 ⇒ 輸出 **`BYPASS`**。
    //    ② 🔴 **而更要命的是舊版【誤紅在正確的碼上】** —— 修法是把 props 收成
    //       `Omit<AdminOrderDetailFullItem, 'lineTotal'>`(讓編譯器當閘),
    //       **而那個型別註記本身就含 `lineTotal` 六個字** ⇒ 舊守門對「已經修好的碼」判紅。
    //       ⇒ 這是「**該綠沒綠**」那一半,而它的後果不是漏抓,是**下一個人繞過這道閘**。
    //       (我當場量過兩發:帶突變 rc=1、**不帶突變也 rc=1**。)
    //
    // ⇒ 現在分成兩條,各守一件事:
    //    (a) **閘還在嗎** —— 型別註記不見了就紅(拿掉 `Omit` = 拆掉編譯器那道閘)
    //    (b) **有沒有人點著讀它** —— 禁 `.lineTotal` 屬性存取(型別註記是引號形,不會誤命中)
    expect(DOC, '(a) 編譯器那道閘不見了:props 不再是 Omit<…, lineTotal>').toContain(
      "Omit<AdminOrderDetailFullItem, 'lineTotal'>",
    );
    expect(DOC, '(b) 有人點著讀 lineTotal').not.toMatch(/\.\s*lineTotal/);
    // ⚠️⚠️ **殘餘風險,原樣寫著不准弱化**:
    //    `(item as never)['line' + 'Total']` **兩條都繞得過** —— 型別被 `as never` 關掉、
    //    字面被拆開。⇒ **這一對不是「擋得住所有寫法」,是「擋得住不小心」。**
    //    🔴 而刻意用 `as never` 去讀一個被型別擋掉的欄位,在本 repo 是**停止訊號**
    //    (`00-work-rules` R4:想繞過驗證本身 ⇒ 停下回報),不是一個會不小心發生的動作。
    // 🔴 **正向對照有兩層,兩層都要**:
    //    ① 檔案沒被讀成空字串 ② **剝註解沒有把整支檔剝光**(這一支的註解比碼多,很容易剝過頭)
    //    🔴 正向對照挑 `lineAmount`(**碼裡真的有**),不挑 `unitPrice` ——
    //       元件根本沒有直接讀 `unitPrice`(它把整個 item 交給 `lineAmount`),
    //       挑它會讓這一格因為**對照組自己不成立**而紅,那是誤紅不是抓到東西。
    expect(DOC).toContain('lineAmount');
    expect(DOC.length, '剝完註解之後幾乎沒東西 ⇒ 上面那個 0 是剝過頭不是真的沒有').toBeGreaterThan(
      2000,
    );
  });

  it('🔴🔴 折扣不為 0 ⇒ 多印一列,否則紙上三個數字加不起來', async () => {
    // 🔴 **這一列稿沒有,是我補的** —— 依據是 `types.ts:133` 的不變式
    //    `total = subtotal + shippingFee − discountTotal`,而稿只印三列。
    //    稿自己的 `_po_money()` docstring 寫著「折扣只印一行」而碼裡沒有 ⇒ 註解與碼不一致。
    //    (已回報 OD/線A;在他們回覆之前採 docstring 的意圖。)
    // 🔴🔴 **片4-R1 修 F7:`total` 從 52,598 改成 51,865,因為它必須【真的加得起來】。**
    //    51,987 + 611 − 733 = **51,865**。上一版寫 52,598 ⇒ 那格只證得了「折扣列會出現」,
    //    **證不了四個數字對得上** —— 而後者正是我推翻稿(補這一列)的**唯一理由**。
    //    ⚠️ 這是本片最尷尬的一格:**我為了「紙上數字要加得起來」加了一列,
    //       然後用一組自己加不起來的測資去驗它。**
    setDetail(
      detail({
        discountTotal: { amount: 733, currency: 'TWD' },
        total: { amount: 51865, currency: 'TWD' },
      } as never),
    );
    const { container } = await renderPage();
    expect(moneyRows(container)).toEqual([
      ['小計', '51,987'],
      ['運費', '611'],
      ['折扣', '−733'],
      ['訂單金額', '51,865'],
    ]);
    // 🔴 **算術對照:紙上印出來的四個數字要真的成立**(這才是這一列存在的理由)。
    const num = (v: string) => Number(v.replace(/[,−]/g, ''));
    const rows = Object.fromEntries(moneyRows(container));
    expect(num(rows['小計']) + num(rows['運費']) - num(rows['折扣'])).toBe(num(rows['訂單金額']));
  });

  it('🔴 折扣為 0 ⇒ 那一列【不印】(常見情況下紙面與稿逐字相同)', async () => {
    const { container } = await renderPage();
    expect(moneyRows(container).map(([k]) => k)).toEqual(['小計', '運費', '訂單金額']);
    // 正向對照:證明上面那個「沒有折扣列」不是因為整個金額區沒渲染。
    expect(moneyRows(container).length).toBe(3);
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
  /**
   * 區名。
   * 🔴 **片2/片3 之後 `h2.pd-sech` 裡是「標題文字 + `<span>` 說明」兩個節點**(稿的形狀)
   *    ⇒ `h2.textContent` 會變成 `本次出貨這個箱子裡屬於這張訂單的品項`。
   *    取 `firstChild` = 只拿標題那個文字節點。
   * ⚠️ **這不是把斷言放寬** —— 說明文字另有一格在看(見下方「說明也要印出來」那格),
   *    兩件事分開釘;綁在一起的話「說明改了」會紅成「區名壞了」。
   */
  // 🔴 **片4 之後 `.pd-money` 也有自己的 `<h2>金額</h2>`** ⇒ 這裡要限定在品項區,
  //    否則區名清單會多出一個「金額」,而**紅的理由讀起來像「區名壞了」**。
  const titles = (c: HTMLElement) =>
    [...c.querySelectorAll('.pd-items h2')].map((h) => h.firstChild?.textContent?.trim() ?? '');
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
      [...c.querySelectorAll('.pd-items table')].find(
        (t) => t.parentElement?.querySelector('h2')?.firstChild?.textContent?.trim() === title,
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
    // 🔴 片4b:`td:last-child` 是**位置假設** —— 加金額欄之後它指到金額格(收到 `'445,098'`)。
    //    改成元件宣告的 `data-slot='qty'`:**更緊**,而期望值 `'6'` 一個字沒動。
    expect(table?.querySelector('tbody td[data-slot="qty"]')?.textContent?.trim()).toBe('6');
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
    for (const word of ['訂購', '對帳', '總計']) expect(t).not.toContain(word);
    // ── 🔴🔴 片4b:`'合計'` 從禁詞清單搬到這裡 —— **替換不是刪除**(走過「動一條綠的測試」四問)──
    //    第1問(理由不提新實作講得完嗎):講得完。spec §3 逐字要求「本次出貨小計 / 尚未出貨小計」,
    //          Sean 2026-08-24 `Q1`=甲 落地兩區各自合計 ⇒ 紙上**本來就要有**一個帶「合計」的字。
    //    第2問(舊期望是規格還是代理):`'合計'` 是**代理**不是規格 —— 本格的規格寫在它自己的標題裡:
    //          「不得印一條**跨區的**對帳等式」。禁「合計」在**沒有任何區塊有小計**的世界裡是安全的,
    //          而那個世界結束了。🔴 **規格沒有被推翻,過期的是代理。**
    //    第3問(通過集合變大還是平移):🔴 **直接把 `'合計'` 刪掉會讓通過集合變大 = 繞過。**
    //          ⇒ 改成**更緊**的斷言:紙上每一個「合計」都必須是「本區合計」。
    //            跨區的合計(例如「訂單合計」「總合計」)照樣紅,而且訊息會指名抓到什麼。
    //    第4問(承重斷言動了嗎):**沒有。** 下面那兩條 regex 與標題的主張一字未動。
    const HE_JI = [...t.matchAll(/.{0,2}合計/g)].map((m) => m[0]);
    for (const hit of HE_JI) {
      expect(hit, `紙上出現了不是「本區合計」的合計:${hit}`).toBe('本區合計');
    }
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

  it('🔴🔴 兩區的金額接線:每一列的金額 = 單價 × 【本區】數量,而不是下單量', async () => {
    // 🔴 **codex 2026-08-24 finding 2**:`shipping-doc-amounts.test.ts` 那 13 格
    //    **自己扮呼叫端** —— 它證明「算式對」,證不到「元件有沒有把對的數量餵進去」。
    //    ⇒ 本片的**主體功能**(兩區金額)先前**沒有一道會紅的尺在守**。
    //    📌 本 repo 假綠七型的第 (e) 型:測試自己扮呼叫端 ⇒ 永遠發現不了呼叫端餵錯。
    //
    // 🔴🔴 **測資刻意讓「本區數量」與「下單量」不同 —— 否則這一格零判別力**:
    //    下單 9 / 取消 1 / 先前出 0 / 這一箱 2 ⇒ 本次出貨 2、尚未出貨 9−1−0−2 = 6
    //    單價 74183(質數,乘出來不會與任何輸入撞號)
    //      本次出貨  74183 × 2 = 148,366
    //      尚未出貨  74183 × 6 = 445,098
    //      🔴 而【誤接下單量 9】會得到 667,647 —— 三個數字兩兩不同 ⇒ 接錯哪一個都分得出來
    setDetail(withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })));
    mocks.loadOrderShipments.mockResolvedValue([{ shipment: shipment(), lines }]);
    const { container } = await renderPage();
    const moneyCells = (name: string) =>
      [...(sectionTable(container, name)?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
        [...tr.querySelectorAll('td')].at(-1)?.textContent?.trim(),
      );
    // 每一區:第一列是品項的金額,最後一列是「本區合計」那一列的值。
    expect(moneyCells('本次出貨'), '本次出貨區的金額欄').toEqual(['148,366', '148,366']);
    expect(moneyCells('尚未出貨'), '尚未出貨區的金額欄').toEqual(['445,098', '445,098']);
    // 🔴 **負向對照:誤接下單量會印出來的那個數字,紙上不得出現。**
    //    沒有這一條,上面兩條在「元件把兩區都印成同一個數」的世界裡仍可能過。
    const t = container.textContent ?? '';
    expect(t, '出現了 74183 × 下單量 9 ⇒ 本區數量接成了下單量').not.toContain('667,647');
    // 🔴 正向對照:證明這把尺撈得到東西(上面那個 not.toContain 不是因為整區沒渲染)。
    expect(t).toContain('本區合計');
  });

  it('🔴🔴 只有一個區塊合計時,【不印那句講「兩塊」的話】—— 紙上不得描述不存在的數字', async () => {
    // 🔴 **codex 跨模型對抗審查 2026-08-24 finding 1(本輪唯一一條「客人打開信封就會讀到」的)。**
    //    那句人話(Sean `Q2`=乙)逐字是「**上面兩塊**回答…**前面兩個**加起來不會等於下面那個」。
    //    ⇒ 最後一箱出完 ⇒「尚未出貨」整區不存在 ⇒ 紙上只剩【一個】本區合計,
    //      而那句話仍然印著 ⇒ **它在描述一個不存在的第二個數字。**
    //    🔴 **觸發情境是最常見的那個**:最後一箱出完。不是邊界。
    // ⚠️⚠️ **這一格的證據幾小時前就印在我自己的畫面上** —— 片4b 中途一發測試失敗的
    //    紙面 dump 裡逐字有「本區合計148,366尚未出貨:無 …」再接那句話,
    //    而我讀那份 dump 是為了找別的東西,**找到就停了**。
    //    ⇒ 同 memory `feedback_doubt-stops-at-the-layer-you-just-thought-of`。
    // 買 5 / 取消 1 / 先前寄 2 / 這一箱 2 ⇒ 5−1−2−2 = 0 ⇒「尚未出貨」整區不出現。
    setDetail(withSummary(summary()));
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).not.toContain('尚未出貨:無 —— 這張訂單沒有還欠客人的品項。上面兩塊');
    expect(t, '只剩一個本區合計,而紙上仍在講「兩塊」').not.toContain('上面兩塊');
    expect(t).not.toContain('前面兩個加起來');
    // 🔴 **正向對照:證明上面三個「沒有」不是因為那句話從來就印不出來。**
    //    兩區都在 ⇒ 兩個本區合計 ⇒ 那句話【必須】出現。
    setDetail(withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })));
    mocks.loadOrderShipments.mockResolvedValue([{ shipment: shipment(), lines }]);
    const t2 = (await renderPage()).container.textContent ?? '';
    expect(t2, '兩區都在時那句話反而不見了 ⇒ 上面那三條是恆真的').toContain('上面兩塊');
  });

  it('🔴🔴 §9⑦ fail-closed:兩次讀對不起來 ⇒ 紙上【一個金額欄都沒有】,而數量照印', async () => {
    // ── 病灶 ──────────────────────────────────────────────────────────────────
    // 頁層分兩次讀:`findAdminOrderDetail`(拿 `shippedQuantity`)、`loadOrderShipments`
    // (拿 `shippedAt`)。兩次之間有人按「標記出貨」⇒ **舊的 shippedQuantity 配新的 shippedAt**。
    // 數量層的後果是多印幾件(早就登記);🔴 **而金額讓它變成多印一筆錢。**
    // ⇒ 78 2026-08-24 裁【丙】:不是登記續留、也不是本片修合流,是**加一道 fail-closed 閘**。
    //
    // ── 這一格構造的就是那個簽名 ────────────────────────────────────────────────
    // 箱已標記出貨(shippedAt 非 null),而 shippedQuantity = 0 < 本箱的 2
    // ⇒ `shippedQuantity` 是跨全部已出貨箱的加總,它**至少要含本箱** ⇒ 違反 ⇒ 陳舊讀。
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ shippedAt: '2026-08-16T02:00:00+00:00' }), lines },
    ]);
    setDetail(withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })));
    // 🔴 本地小工具:讀某一區的欄名列。**不共用下面那個同名的** ——
    //    那一個住在別的 `it` 的 scope 裡,把它提出來會動到一格與本片無關的綠測試。
    const heads = (t: Element | null | undefined) => [
      ...(t?.querySelector(':scope > thead > tr:last-child')?.querySelectorAll('th') ?? []),
    ].map((th) => th.textContent?.trim());
    const { container } = await renderPage();
    // 🔴 **金額欄整組不出現**(不是印一個算錯的、也不是留一個空欄)。
    let checked = 0;
    for (const name of ['本次出貨', '尚未出貨']) {
      const h = heads(sectionTable(container, name));
      expect(h.length, `${name} 掃到 0 個欄名 ⇒ 下一條恆真`).toBeGreaterThan(0);
      expect(h, `${name} 竟然還有金額欄`).not.toContain('金額');
      checked += 1;
    }
    expect(checked, '兩區都沒檢到 ⇒ 上面那個迴圈是空的').toBe(2);
    // 🔴 **而數量照印** —— fail-closed 的方向是「不印錢」,不是「不印紙」。
    //    這一行若跟著不見,代表我把整張紙擋掉了,那是過度修正。
    expect(sectionTable(container, '本次出貨')?.textContent ?? '').toContain('LTC-BK-XL');
    // 🔴 **那句跨區人話也要跟著不見** —— 沒有區塊合計時,它會去解釋一件紙上不存在的事。
    expect(container.textContent ?? '').not.toContain('前面兩個加起來不會等於下面那個');
    // 🔴 **正向對照:同一組測資、只把 shippedQuantity 改成含得下本箱 ⇒ 金額欄【回來】。**
    //    沒有這一段,「金額欄不見」在「金額欄從來就沒做出來」的世界裡一樣綠。
    setDetail(withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 2 })));
    const ok = await renderPage();
    expect(heads(sectionTable(ok.container, '本次出貨'))).toContain('金額');
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
    // 🔴 片4b:`td:last-child` 是**位置假設** —— 加金額欄之後它指到金額格(收到 `'445,098'`)。
    //    改成元件宣告的 `data-slot='qty'`:**更緊**,而期望值 `'6'` 一個字沒動。
    expect(table?.querySelector('tbody td[data-slot="qty"]')?.textContent?.trim()).toBe('6');
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
    const t = (await renderPage()).container.querySelectorAll('.pd-items table')[1]?.textContent ?? '';
    expect(t).toContain('LTC-BK-XL');
    expect(t).toContain('數量資料尚未就緒');
    expect(t).not.toContain('尚未出貨:無');
  });

  it('🔴 真的都寄完了 ⇒ 說「無」,不留一張空表', async () => {
    setDetail(
      withSummary(summary({ cancelledQuantity: 0, shippedQuantity: 5 })),
    );
    const { container } = await renderPage();
    expect(container.querySelectorAll('.pd-items table').length).toBe(1); // 只剩「本次出貨」
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
    const tables = container.querySelectorAll('.pd-items table');
    expect(tables.length).toBe(3);

    // 🔴 **2026-08-17 `Q-C20` 之後 `thead` 是兩列**:第 1 列續頁抬頭、第 2 列才是欄名。
    //    ⚠️ 本 helper 原本把 `thead` 底下**所有** `th` 攤平比對,那把「欄名有哪幾個」與
    //       「thead 裡有沒有別的列」綁成同一個斷言 ⇒ 加抬頭那一列時它會紅,
    //       **而紅的理由讀起來像「欄名壞了」**。⇒ 只取欄名那一列。
    //    📎 續頁抬頭本身**另有一格**釘(見下一格),兩件事不共用一個斷言。
    const headerTexts = (t: Element) => {
      const thead = t.querySelector(':scope > thead');
      expect(thead).not.toBeNull(); // ← thead 換成 tbody 時死在這裡
      const colRow = thead?.querySelector(':scope > tr:last-child');
      return [...(colRow?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    };
    // 🔴 **片3:「本次出貨」多了勾選欄** —— Sean 2026-08-23「揀貨單與出貨單合併」的落地。
    //    另外兩區【沒有】勾選欄(欠貨與已取消沒有東西可以勾)⇒ 下面兩條維持三欄,那是對照。
    // 🔴 片4b:前兩區各多一個「金額」欄(Sean 2026-08-24 `Q1`=甲)。
    //    🔴 **第三區(訂單取消)刻意【沒有】** —— `Q-C11`=甲,理由:客人看到取消品旁邊有金額,
    //       第一直覺是「這是要退我的錢」,而實際退款走退款流程、可能是不同的數字。
    //    ⇒ **這一組三行合起來就是那條紀律的守門**:第三行若哪天長出「金額」,這裡會紅。
    expect(headerTexts(must(tables[0], '本次出貨表'))).toEqual([
      '勾',
      '料號',
      '品名 / 規格',
      '本次出貨',
      '金額',
    ]);
    expect(headerTexts(must(tables[1], '尚未出貨表'))).toEqual([
      '料號',
      '品名 / 規格',
      '還欠幾件',
      '金額',
    ]);
    // 🔴 第三區也要各釘一次,理由同上:不該假設三張表永遠共用同一份 JSX。
    expect(headerTexts(must(tables[2], '訂單取消表'))).toEqual(['料號', '品名 / 規格', '已取消']);
  });

  it('🔴🔴 片3:勾選框【只有】「本次出貨」那一區有,而且每列一個', async () => {
    // 🔴 **這一格在片3 之前不存在** —— 合併之前這張紙沒有勾選欄,所以沒有東西可守。
    //    加欄位卻不加守門 = 下一個人把它拿掉時**零症狀**(紙上少一欄,三綠全綠)。
    setDetail(withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })));
    const { container } = await renderPage();
    const boxes = container.querySelectorAll('[data-slot="shipping-checkbox"]');
    // 本次出貨只有 1 個品項(`lines` 一列)⇒ 1 個框。
    expect(boxes.length).toBe(1);
    // 🔴 **負向對照:那個框必須在「本次出貨」那張表【裡面】** ——
    //    只數總數的話,框跑到別區去也照樣是 1。
    const shipTable = sectionTable(container, '本次出貨');
    expect(shipTable?.querySelectorAll('[data-slot="shipping-checkbox"]').length).toBe(1);
    // 🔴 另外兩區一個都不准有(它們沒有東西可以勾)。
    expect(sectionTable(container, '尚未出貨')?.querySelectorAll('[data-slot="shipping-checkbox"]').length).toBe(0);
    expect(sectionTable(container, '訂單取消')?.querySelectorAll('[data-slot="shipping-checkbox"]').length).toBe(0);
  });

  it('🔴🔴 `Q-C20` 續頁抬頭:三張表【每一張】的 `<thead>` 裡都要有訂單編號與箱號', async () => {
    // 🔴 **守的是「第 2 頁認得出這是哪一張單、哪一箱」**,而關鍵不是「頁面上有沒有單號」——
    //    頁首本來就印著一個。**只有 `<thead>` 裡那一份會被瀏覽器逐頁重複。**
    //    ⇒ 本格斷言的是**位置**:把這一列搬出 `thead`(挪去 `<caption>` 或表格上方的 div),
    //      畫面幾乎一樣、`textContent` 照樣含單號,而**第 2 頁會變回沒有單號**。
    //      那條路只有位置斷言擋得住 —— 內容型斷言在那個世界裡照樣綠。
    // 🔴 **三張各釘一次**:今天它們共用同一份 `Section` JSX,而守門不該假設那永遠成立。
    //    只釘第一張的話,哪天有人把「訂單取消」那區拆出去自己寫,它會靜默失去抬頭。
    // 🔴 落地前實印的缺口長什麼樣:12 品項那份的第 2 頁**欄名有、而整頁沒有單號也沒有箱號**
    //    (三張 PNG 與量法在 `docs/specs/2026-08-17-qc5-tracking-off-paper-decommission-list.md` §4b-4)。
    // ⚠️ 誠實:單測沒有分頁概念 ⇒ 本格證的是那個原生保證的**前提還在**,不是第 2 頁真的印了。
    setDetail(withSummary(summary({ quantity: 9, cancelledQuantity: 1, shippedQuantity: 0 })));
    const { container } = await renderPage();
    const tables = [...container.querySelectorAll('.pd-items table')];
    expect(tables.length).toBe(3);
    for (const [i, t] of tables.entries()) {
      const bar = t.querySelector(':scope > thead > tr.pd-contbar > th');
      expect(bar, `第 ${i + 1} 張表少了續頁抬頭那一列`).not.toBeNull();
      // 🔴 **「品項明細」四個字在片3 拿掉了**(FIX-63:續頁列不再重複區塊名)。
      //    ⚠️ 原本這裡有 `toContain('品項明細')`。**拿掉它會讓通過集合變大**,
      //       所以補一條反向的:那四個字不准回來(順手補齊的人會在這裡紅)。
      expect(bar?.textContent).not.toContain('品項明細');
      expect(bar?.textContent).toContain('PCM-2026-0042');
      expect(bar?.textContent).toContain('K7X2MP');
      // 🔴 跨欄要蓋滿,少一欄的話那一列只撐在左邊、右邊被欄名擠上來。
      //    **改成與該表【實際欄數】比對**,不寫死 3 —— 本次出貨那張是 4 欄(多了勾選欄),
      //    寫死的話加一欄就得回來改一次,而**改的人不會知道他改的是「蓋滿」這個意圖**。
      const cols = t.querySelectorAll(':scope > thead > tr:last-child > th').length;
      expect(bar?.getAttribute('colspan')).toBe(String(cols));
      // 🔴 它必須排在欄名那一列**上面** —— 排下面的話續頁上它會出現在欄名之後,
      //    而樣張 `:291` 的位置是欄名之上。順序錯了畫面上看得出來,但沒有守門就沒人擋。
      const rows = [...(t.querySelectorAll(':scope > thead > tr') ?? [])];
      expect(rows.length).toBe(2);
      expect(rows[0]?.classList.contains('pd-contbar')).toBe(true);
    }
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
    const { container } = await renderPage();
    expect(infoValue(container, '貨運商')).toBe('新竹物流');
    expect(infoValue(container, '日期')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('🔴 號碼並排 ⇒ 每一個都要有標籤(plan §4:客人不知道該拿哪個去查)', async () => {
    const { container } = await renderPage();
    // 🔴 `displayId` 在片3 之前是**裸印**的(紙上只有 `PCM-2026-0042` 沒有「訂單編號」四個字)。
    //    片2 之後標籤由 `.pd-field` 的 `.k` 提供 ⇒ 這一格改驗配對,守的是同一件事。
    expect(infoValue(container, '訂單編號')).toBe('PCM-2026-0042');
    expect(infoValue(container, '箱號')).toBe('K7X2MP');
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
    expect(infoValue((await renderPage()).container, '日期')).toBe('2026-08-17');
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
    const { container } = await renderPage();
    const t = container.textContent ?? '';
    expect(infoValue(container, '貨運商')).toBe('其他(客人自取)');
    expect(t.split('客人自取').length - 1).toBe(1);
    // ⚠️ 原本這裡還有一條 `toContain('無追蹤碼(自取 / 自送)')` ⇒ **`Q-C5`=丙 之後那句不印了**,
    //    它的反面(不准印)已由下方 `Q-C5=丙` 那一族守著,不在這裡重複。
  });

  // ── 🔴 `Q-C5`=丙 的反向守門(2026-08-17)──
  //    Sean 逐字 `q3: 丙` ⇒ **出貨明細單不印追蹤碼,追蹤碼只走LINE／Email**。
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
    const { container } = await renderPage();
    const t = container.textContent ?? '';
    expect(t).not.toContain('追蹤碼');
    expect(t).not.toContain(alsoAbsent);
    expect(t).not.toContain('請回報');
    // 正向對照:貨運資訊那一區本身還在。**主斷言(上面三條 not)一個字都沒動。**
    expect(infoValue(container, '貨運商')).toBeDefined();
    expect(infoValue(container, '日期')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('🔴 未知貨運商代碼 ⇒ 印代碼本身,不留白(守門看不到 DB,回退方向必須安全)', async () => {
    mocks.loadOrderShipments.mockResolvedValue([
      { shipment: shipment({ carrierCode: 'zzz' }), lines },
    ]);
    expect(infoValue((await renderPage()).container, '貨運商')).toBe('zzz');
  });

  it('被擋時貨運資訊也不印 —— 那張紙整張不該存在', async () => {
    // 🔴 `Q-C18` 甲之後,擋這張紙的不再是 `detail.itemsTruncated`(它已與紙無關),
    //    而是「讀到的筆數 vs 資料庫說的筆數」對不上。
    mocks.listOrderItemsForDetail.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
    const t = (await renderPage()).container.textContent ?? '';
    expect(t).not.toContain('貨運商');
    expect(t).not.toContain('6412345678');
  });
});

describe('🔴 Q-C7 = 丙:頁尾【不得】有手寫日期格(Sean 2026-08-16 逐字)', () => {
  it('🔴 片4:簽名區【整塊拿掉】,而手寫日期仍然不准回來', async () => {
    // 🔴 **`Q-C7`=丙(拿掉頁尾手寫日期)沒有被推翻,是被涵蓋了** —— FIX-61 把整個簽名區拿掉。
    //    依據是量到的:稿 `預覽-出貨明細單.html` 掃 `出貨人`/`簽名` ⇒ 各 0;
    //    掃 `簽收` ⇒ 1,而那 1 筆在 CSS 註解裡不是紙上的字。
    // ⚠️ **「不准有手寫日期」那條要留著**,而且現在更容易被人「順手」加回來 ——
    //    一張沒有簽名欄的出貨單,下一個人看了會想補一個。
    const { container } = await renderPage();
    const t = container.textContent ?? '';
    expect(t).not.toContain('出貨人:');
    // 🔴 沒有這一格的話,把那行加回來【零症狀】—— 它看起來像單據的標準欄位。
    expect(t).not.toContain('日期:____');
    // ⚠️ Q-C6 之後表頭那格也叫「日期」⇒ 這裡只能釘【手寫底線】那個形狀,不能只釘「日期」兩個字。
    // 正向對照:表頭那個【印死的】出貨日還在(拿掉的是手寫那格,不是整個日期概念)。
    expect(infoValue(container, '日期')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
    mocks.listOrderItemsForDetail.mockResolvedValue({ items: paged, reportedTotal: 3 });
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
    const table = must((await renderPage()).container.querySelectorAll('.pd-items table')[0], '本次出貨表');
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
    mocks.listOrderItemsForDetail.mockResolvedValue({
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
    // 🔴 片4b:分頁查詢改走 `listOrderItemsForDetail` ⇒ 回來的每一項**都帶單價**。
    //    ⚠️ 補這兩欄不是為了讓測試變綠 —— 是因為**少了它們這份 fixture 就不再長得像真資料**,
    //       而一份不像真資料的 fixture 會讓「250 項印得完」這個結論建立在一個不存在的形狀上。
    //    📎 而它缺著的那一發**打出了一個真的缺陷**:`lineAmount` 當時會 throw ⇒ 整張紙印不出來。
    //       那條已修成「拿不到單價 ⇒ 不印錢,照印紙」(`shipping-doc-amounts.ts` 有專格)。
    unitPrice: { amount: 1000 + i, currency: 'TWD' },
    lineTotal: { amount: 1000 + i, currency: 'TWD' },
  }));

  beforeEach(() => {
    // `detail` = adapter 內嵌撈回來的樣子:**只有前 200 項,且 itemsTruncated = true**。
    setDetail(detail({ items: all.slice(0, LIMIT) as never, itemsTruncated: true }));
    // 分頁查詢 = 撈到盡:250 項。
    mocks.listOrderItemsForDetail.mockResolvedValue({ items: all, reportedTotal: TOTAL });
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
    expect(container.querySelectorAll('.pd-items table').length).toBeGreaterThan(0);
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
    mocks.listOrderItemsForDetail.mockResolvedValue({ items: detail().items, reportedTotal: 5 });
    expect(printButtons((await renderPage()).container)).toHaveLength(0);
  });

  it('🔴 正向對照:沒被擋 ⇒ 列印鈕還在(證明上一格不是「這顆鈕根本不存在」)', async () => {
    expect(printButtons((await renderPage()).container)).toHaveLength(1);
  });
});
