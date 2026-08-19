// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// 🔴 真的 CSS parser,**不是新增依賴**:`postcss` 已是 `apps/admin` 的直接 devDependency
//    (`apps/admin/package.json` 的 `"postcss": "8.5.14"`)。理由見下方卡片化守門那段。
import postcss from 'postcss';
import { cleanup, render as rtlRender } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// 🔴 `#484a` A2:四值**不再手寫**(本檔原本有三處各自硬寫,改 domain 常數不會讓它們紅)。
//    綁上去之後,`ORDER_GOODS_AXIS_VALUES` 少一個值 ⇒ 這裡的 8 值斷言當場紅。
import {
  ORDER_GOODS_AXIS_VALUES,
  toMoneyAmount,
  type AdminOrderLine,
  type AdminOrderSummary,
  type OrderGoodsAxis,
} from '@pcm/domain';
import { ShippingSelectionProvider } from './shipping-selection';

/**
 * 🔴 **2b-1 起 `OrdersTable` 必須包在 `<ShippingSelectionProvider>` 內。**
 * 那顆勾選 island 在缺 provider 時會**明確丟錯**(刻意的:靜默降級的話「勾不動」與
 * 「這張單不能勾」長得一模一樣、沒有人會發現)。本檔所有 render 統一走這個包裝,
 * 不逐處手包 —— 漏包一處就是整個檔紅一片,不會只紅那一條。
 */
const render = (ui: React.ReactElement) =>
  rtlRender(<ShippingSelectionProvider>{ui}</ShippingSelectionProvider>);

import { CELL, OrdersTable } from './orders-table';

// #350c:桌機單號連結改由呼叫端注入(`/orders?…&panel=<id>`)。這裡給一個最小假 builder ——
// 本檔既有的斷言都不看單號連結的 href;真正釘住「桌機走注入 href / 手機仍是字面路徑」的是
// `order-panel-wiring.test.ts`(那支才有判別力,本行只是讓既有這些格子能繼續 render)。
const panelHref = (orderId: string) => `/orders?panel=${orderId}`;

import {
  PAYMENT_STATUS_LABEL,
  ORDER_DENSITY_DEFAULT,
  STATUS_CAPSULE,
} from '../../lib/orders/order-list-view';
// L3 片1:狀態八值的期望值一律從這裡取,不在本檔重打一份中文字面。
import {
  ORDER_STATUS_CANCELLED_LABEL,
  ORDER_STATUS_LABEL,
  orderStatusView,
} from '../../lib/orders/order-status-axes';

// 🔴 `server-only` 在**本檔**換成空替身 —— **不是放寬護欄,而且刻意不做成全域 alias。**
//    真的 `server-only` 被 client 模組載入時會丟錯,那正是我們要的
//    (`shipment-candidates.ts` 帶著它,誰把訂單明細拉進 client bundle 就建置失敗)。
//    但 vitest 沒有 server/client 之分、會天真地走完整個 import 圖:
//      client 元件 → `shipment-actions.ts`('use server')→ `shipment-candidates.ts`('server-only')→ 丟錯。
//    真實 Next 下這條路**不存在**('use server' 模組在 client 側是引用樁)。
//    ⚠️ **為什麼不做全域 alias**:`apps/storefront/src/lib/brand-products.test.ts:223` 有一條測試
//    **刻意依賴 server-only 真的丟錯**來證明 mock 清乾淨了(斷言字面就是那句錯誤訊息)。
//    全域替身會把那條的驗證機制整個拆掉 —— 實測會讓它從綠變紅。所以只在需要的檔各自 mock。
vi.mock('server-only', () => ({}));


afterEach(cleanup);

// M-4b E10 **A11a-1** 的驗收(plan `docs/specs/2026-08-06-e10-a11a-list-rebuild-plan.md` §5 的 V1-V5、V7)。
//
// 🔴 為什麼這個檔今天才出現:A11a-1 之前 `OrdersTable` **完全沒有元件測試** ——
//    整張表的欄數、rowSpan 分組、金額合併規則全靠肉眼。而 plan §5 的驗收盲區那段已證:
//    D1 之後 production **沒有任何多品項單、也沒有任何 `quantity > 1` 的列**
//    ⇒ V3(rowSpan)與 V4(金額合併)**在真實資料上根本看不到**,只能靠這裡的假資料覆蓋。
//    Sean 肉眼驗時看到的是「單品項單一切正常」,**合併格效果他這批看不到** —— 這句話要帶進交棒。
//
// 🔴 **V6 / V8 已於 A11a-2(2026-08-06)補入本檔末**(原本這裡寫「不在本檔、屬 A11a-2」,已過期)。
//    V6 的**格式真值表**在 `lib/orders/order-list-view.test.ts`(純函式、可注入 `now`);
//    本檔那條只證**接線**——日期格吃的是 `formatOrderListDate` 而不是 `formatOrderDate`。

// `quantitySummary` 也排除:它由 `quantity` 推出(見 `line()`),放進 BASE 會變成寫死的常數。
// 🏁 **L3 片2:`unitPrice` 從 BASE 移出、改由 `lineTotal / quantity` 推。**
//    理由不是整潔:片2 起**單價會上畫面**,而寫死 12000 會讓 `line('l2', 1, 8000)` 這種 fixture
//    出現「單價 12,000、小計 8,000、數量 1」——**違反 domain 不變式**
//    (`packages/domain/src/order/order.ts:90` 逐字 `lineTotal = unitPrice × quantity`)。
//    fixture 自己違反不變式時,任何拿它當基準的斷言都在量一個不可能存在的訂單。
const LINE_BASE: Omit<
  AdminOrderLine,
  'id' | 'quantity' | 'lineTotal' | 'unitPrice' | 'quantitySummary'
> = {
  variantSku: 'SKU-001',
  title: '排氣管',
  brand: 'Akrapovic',
  vehicle: null,
  workflowStatus: null,
  version: 1,
};

function line(id: string, quantity: number, lineTotal: number): AdminOrderLine {
  return {
    ...LINE_BASE,
    id,
    quantity,
    // 🔴 本檔所有呼叫端的 `lineTotal / quantity` 都是整數(實查後才這樣寫);
    //    日後加 fixture 若除不盡,`toMoneyAmount` 會擋下來(它只收整數)⇒ 不會靜默產生小數價。
    unitPrice: { amount: toMoneyAmount(lineTotal / quantity), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(lineTotal), currency: 'TWD' },
    // 🔴 A9c 起 `quantitySummary` 是**非 nullable**(缺列的正規化是 adapter mapper 的責任、不是 UI 的)。
    //    這裡刻意由 `quantity` 推出、不寫死常數:寫死會讓「分母接錯線」在 quantity≠1 的 fixture 下仍全綠。
    //    三軸都給 0 = 「還沒訂、還沒到、沒取消」,對應 A11a-4 訂貨欄要顯示的 `0/quantity`。
    quantitySummary: {
      quantity,
      orderedQuantity: 0,
      instockQuantity: 0,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: quantity,
    },
  };
}

/**
 * 🔴 覆寫參數**刻意寫死成本檔真的會覆寫的三個欄位**,不用 `Partial<AdminOrderSummary>`:
 * 後者展開時每個欄位都可能是 `undefined`,會逼出 `displayPosition` 那類「必填但可為 null」欄的型別錯,
 * 然後很容易被一個 `as` 壓掉 —— 而那個 `as` 正是上面三個假值混進來的原因。
 */
type OrderOverrides = {
  lines: AdminOrderLine[];
  total?: AdminOrderSummary['total'];
  customerName?: string | null;
  /** A11a-2 V8:付款軸小字要能逐狀態驗(fixture 預設 `paid`)。 */
  paymentStatus?: AdminOrderSummary['paymentStatus'];
  /** A11a-5 V11:發票欄要能逐三態驗(fixture 預設 `not_issued`)。 */
  invoiceStatus?: AdminOrderSummary['invoiceStatus'];
  /**
   * A11c:**已取消 badge 原本在整個回歸網裡零覆蓋** —— 沒有這個覆寫,fixture 構造不出已取消單,
   * 「不含已取消」那條斷言就**恆真**(把 badge 整段刪掉照樣綠)。階段 C code-reviewer 抓到。
   */
  cancelledAt?: AdminOrderSummary['cancelledAt'];
  /** 2026-08-16 `Q-EMBED-1`:品項清單可能不完整 ⇒ 狀態欄改印「未知」。預設 false。 */
  itemsTruncated?: AdminOrderSummary['itemsTruncated'];
  /**
   * 片 A-1(2026-08-17):`data-selected` 要能驗「**只有被選中的那一組**帶屬性」
   * ⇒ fixture 必須造得出**兩張 id 不同的單**。
   * 🔴 沒有這個覆寫的話,兩張單的 `id` 都是預設的 `ord-1` ⇒ 兩組都會被選中
   *    ⇒ 「另一組不帶」那條斷言**構造不出來**(同 `cancelledAt` 那條記過的形狀:
   *    fixture 造不出反例時,斷言是恆真的)。
   */
  id?: AdminOrderSummary['id'];
};

function order(overrides: OrderOverrides): AdminOrderSummary {
  return {
    id: 'ord-1',
    itemsTruncated: false,
    displayId: 'PCM-0001',
    createdAt: '2026-08-06T02:00:00.000Z',
    paymentStatus: 'paid',
    // 🔴 移除 `as AdminOrderSummary` 之後,tsc 一口氣抓出**三個**假值:
    //    `tierAtCheckout: 'regular'`(見下)、`fulfillmentStatus: 'pending'`、`orderSource: 'website'`。
    //    後兩個連測試都抓不到(本表不渲染它們)⇒ **只有型別守得住**。這就是 cast 的代價。
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    total: { amount: toMoneyAmount(12000), currency: 'TWD' },
    customerUserId: 'cu-fixture-1',
    customerName: '王小明',
    // 🔴 合法值只有 general / store / premiumStore(`MEMBER_TIER_LABEL`)。
    //    初版寫了不存在的 `'regular'`,被 V7 抓到 —— 因為它會查表查到 undefined、等級小字整個消失。
    //    **抓到它的不是 typecheck 而是測試**:下面原本有一個 `as AdminOrderSummary` 把型別檢查壓掉了
    //    (memory `feedback_fixture-value-makes-guard-vacuous` 的同族:fixture 值讓斷言失去意義)。
    //    ⇒ cast 已移除,現在 fixture 由 tsc 守門。
    tierAtCheckout: 'general',
    // A9c:開票紀錄三態(`not_issued` / `issued` / `voided`)。**A11a-5 起 V11 在本檔逐三態驗顯示**。
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    ...overrides,
  };
}

/**
 * 表頭欄名(唯一權威 = 母 plan §5.1a + `design-brief` §0-B;A11a-1 = 9 欄 → A11a-4 加訂貨 = 10 → A11a-5 加發票 = 11
 * → 2b-1 勾選欄 = 12 → **A13 加操作 = 13**)。
 */
const EXPECTED_HEADERS = [
  // 2b-1:勾選欄(訂單層)。**無欄名**(表頭是空的 <th aria-label='選取' />)——
  // 刻意沒有全選框:全選必然跨客人,而跨客人裝同一箱一定被 DB 退件。
  '',
  // 🏁 **L3 片2:欄序與四個欄名照 `design-brief` §0-B:1(Sean 2026-08-14 拍 Q3=B)。**
  //    🔴 `訂單編號→單號` 與 `品名→物品名稱` **推翻了 Q6=A(08-06)的欄名部分**,
  //       而 Sean 是在選項裡寫明「那等於推翻 08-06 那次拍板」的前提下選的 ⇒ 不是漂移。
  //    🔴 真正搬家的只有 `車種` 提到 `廠牌` 之前;其餘位移是被新增的 `單價` 推的連帶。
  '單號',
  '日期',
  '車種',
  '廠牌',
  '料號',
  '物品名稱',
  '數量',
  '單價', // 🆕 L3 片2(品項層、成交價)
  '金額',
  '客戶',
  // 🏁 L3 片1:A11a-4 的「訂貨」(品項層)原地換成「狀態」(**訂單層**,八值 = 收款軸 × 貨品軸)。
  //    欄名逐字取自 `design-brief` §0-B:1 那張 Sean 給的欄序清單。
  '狀態',
  '發票', // A11a-5(訂單層)
  '操作', // A13(訂單層)。🔴 **出貨欄(A11a-6)仍缺席** —— 那是另一片,別順手補進期望值
];

/**
 * **訂單層**欄的 CSS 掛勾(L2 起元件用 `col-*` class 標每一格,CSS 與測試共用同一組名字)。
 *
 * 🔴 收斂前這組欄用 `rowSpan` 合併;L2 之後改成「只在該單第一列出值、其餘列渲染空 `<td>`」。
 * 🔴 **`col-amount` 刻意不在這張清單裡** —— 它是**條件性**訂單層欄:
 *    `shouldMergeAmount` 為真才是訂單層(只第一列出值),為假時是品項層(逐列都有值)。
 *    把它塞進來會讓單品項單那格必紅,而且會掩蓋 V4 那張真值表真正要守的東西。
 */
const ORDER_LEVEL_COLUMNS = [
  'col-pick',
  'col-oid',
  'col-date',
  'col-customer',
  // 🏁 L3 片1 新入列:狀態是**整張單**走到哪,不是某個品項走到哪 ——
  //    它從品項層的訂貨欄原地換過來,層級跟著換,這一行就是那個換法的守門。
  'col-status',
  'col-invoice',
  'col-ops',
] as const;

// ── V1:欄數 ───────────────────────────────────────────────────────────
describe('V1 — 表頭欄數與內容欄數一致', () => {
  // 🔴 期望值**不寫死**終局:每片收工值 = 前一片 +1(plan §3)。A13(操作欄)落地 ⇒ 本線現值 **13**;
  //    **出貨欄(A11a-6)還沒做** ⇒ 13 不是終值,那片落地時這裡再 +1。
  it('表頭恰為 14 欄,且欄名與期望一致(L3 片2 起:四個欄名改字面 + 新增單價欄)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).toEqual(EXPECTED_HEADERS);
  });

  it('單品項單:該列 <td> 數 = 14(訂單層與品項層都在同一列)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const cells = container.querySelectorAll('tbody tr td');

    expect(cells.length).toBe(14); // 2b-1:+1 勾選欄;A13:+1 操作欄(皆訂單層);L3 片2:+1 單價欄(品項層)
  });

  it('🔴 L2 收斂後:三品項單的**每一列**都是 14 格(訂單層欄在第二列之後渲染成空格)', () => {
    // 🔴🔴 **本條的期望值在 L2(#447 單一 markup 收斂)被改過,改法本身就是驗收點。**
    //    收斂前:訂單層欄用 `rowSpan` 跨列合併 ⇒ 第一列 13 格、後續列各 6 格。
    //    ⚠️ L3 片2 起格數是 **14**(新增單價欄);下面的數字換過,結構論證不變。
    //    收斂後:`rowSpan` 全拆(手機把 `<tr>` 攤成 flex 卡片時合併格語意不存在)
    //           ⇒ **每列都是同樣格數**,訂單層欄在第二列之後渲染成**真的空** `<td>`。
    //    ⇒ 「後續列 6 格」不再是正確期望值;把它改成「每列同格數」不是放寬守門,是描述新結構。
    //    那條被它守住的東西(取消入口不得逐品項冒出三個)改由下面的 `ORDER_LEVEL_COLUMNS`
    //    那組守 —— 而且更準:它直接數「有值的格子」,不靠格數推。
    // ⚠️ **這條守的是格數對齊,不是「渲染後落在第幾欄」**(R1 抓到原註解宣稱過頭):
    //    jsdom **沒有 table layout 引擎**,把 `<th>狀態</th>` 搬到表頭第一位而 `<td>` 不動,
    //    這條照樣全綠。落點最終仍要 Sean 肉眼驗。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.querySelectorAll('td').length)).toEqual([14, 14, 14]);
  });
});

// ── V2:九碼零殘留 ─────────────────────────────────────────────────────
describe('V2 — 九碼零殘留', () => {
  it('表頭無「商品狀態」與「來源 · 管道」;DOM 內無狀態下拉、無 item_id 隱藏欄、無「存」鈕', () => {
    const lines = [line('l1', 1, 12000), line('l2', 2, 16000)];
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines })]} />);
    const html = container.innerHTML;

    expect(html).not.toContain('商品狀態');
    expect(html).not.toContain('來源');
    expect(container.querySelector('select[name="workflow_status"]')).toBeNull();
    expect(container.querySelector('input[name="item_id"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    // 🔴 整單彙總 badge 的中性字面也一併釘住:它與下拉是**不同的**九碼消費點,
    //    只查 select 會漏掉「多狀態」那顆 badge 被留下的情況。
    expect(html).not.toContain('多狀態');
  });
});

// ── V3:訂單層欄的分組(L2 起由「rowSpan 合併」改成「只在第一列出值」)──────────
describe('V3 — 訂單層欄只在該單第一列出值,其餘列是**真的空**格', () => {
  it('🔴 rowSpan 已全數拆除 —— DOM 內零 `rowspan` 屬性(收斂的必要條件,不是順手改的)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />);

    // 🔴 為什麼拆:`rowSpan` 是 `<table>` 專屬的跨列合併,而手機卡片模式把 `<tr>` 攤成
    //    `display:flex` 縱向卡片 ⇒ 合併格語意不存在。收斂前 = 19 個 rowSpan、OD 成品 = 0。
    //    有人「順手把 rowSpan 加回來優化桌機」時這條會紅,並會連帶弄壞手機那一面。
    expect(container.querySelectorAll('[rowspan]').length).toBe(0);
  });

  it('🔴 三品項單:每個訂單層欄在整張表恰有 1 格有值、其餘 2 格是空字串', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />);

    // 🔴 這條接手了收斂前 rowSpan 那兩格守的東西,而且比它準:
    //    直接數「有值的格子」⇒「取消入口被畫成逐品項(三品項單冒出三個取消)」會直接紅。
    for (const col of ORDER_LEVEL_COLUMNS) {
      const cells = [...container.querySelectorAll(`td.${col}`)];
      expect(cells.length, `${col} 每列都要佔位`).toBe(3);
      // 🔴 判「有沒有值」用 `childNodes.length`,**不用 `textContent`** ——
      //    勾選欄裝的是 `<input type=checkbox>`,它的 `textContent` 是空字串
      //    ⇒ 用 textContent 會把「有勾選框」誤判成「空格」,那格就恆綠。
      expect(cells.filter((td) => td.childNodes.length > 0).length, `${col} 只該有一格有值`).toBe(1);
    }
  });

  it('🔴🔴 第二列之後的訂單層格必須是**真的空**(`<td/>`),不得含空白字元', () => {
    // 🔴 承重理由在 `globals.css` 的 `.orders-grid td:empty{display:none}`:
    //    手機卡片靠 `:empty` 把這些格收掉。`<td> </td>` 在 CSS 眼中**不是** `:empty`
    //    ⇒ 卡片會冒出一排「只有標籤、沒有值」的空行,而桌機看起來完全正常
    //    ⇒ **這種錯不會被桌機肉眼驗抓到**,只能釘在這裡。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(17000), currency: 'TWD' } })]} />);
    const secondRow = [...container.querySelectorAll('tbody tr')][1]!;

    const blanks = ORDER_LEVEL_COLUMNS.map((col) => secondRow.querySelector(`td.${col}`)!);
    expect(blanks.length).toBe(ORDER_LEVEL_COLUMNS.length);
    for (const td of blanks) {
      // `childNodes.length === 0` = 真的空;`textContent === ''` 擋不掉 `<td><span/></td>`
      expect(td.childNodes.length, `${td.className} 必須是真的空節點`).toBe(0);
    }
  });

  it('單品項單:訂單層欄各 1 格、且都有值(上面三格的正向對照)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);

    for (const col of ORDER_LEVEL_COLUMNS) {
      const cells = [...container.querySelectorAll(`td.${col}`)];
      expect(cells.length).toBe(1);
      expect(cells[0]!.childNodes.length, `${col} 單品項單應有值`).toBeGreaterThan(0);
    }
  });
});

// ── V4:金額合併規則(四格真值表)───────────────────────────────────────
describe('V4 — 金額合併規則(母 plan §5.1a 逐字:品項列 >1 或任一列 quantity >1)', () => {
  // 🔴 這張真值表的價值在 **m×1 那格**:v1 的規則只寫了 `quantity > 1` 半條,
  //    那樣「3 個品項、每個都買 1 件」的單會**看不到整單總額**。少了這格,錯誤規則全綠。
  it('1 品項 × 數量 1 → 逐列顯示該列小計(lineTotal)、不合併,且**不是** order.total', () => {
    // 🔴 `total` 刻意設成 12,100(= lineTotal 12,000 + 運費 100,`HOME_SHIPPING_FEE`)。
    //    初版兩個值都寫 12,000 ⇒ 把實作改成顯示 `order.total` 也照樣綠 = **這格零判別力**
    //    (R1 code-reviewer 抓到;memory `feedback_fixture-value-makes-guard-vacuous` 同族)。
    //    兩值分開之後,這格才真的釘得住「非合併態顯示的是品項的錢、不是訂單的錢」。
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines: [line('l1', 1, 12000)], total: { amount: toMoneyAmount(12100), currency: 'TWD' } })]}
      />,
    );

    // 🔴🔴 **L3 片2 · R 審 F1:正向那條收斂到金額欄,負向那條刻意不收。**
    //    片2 起 `unitPrice = lineTotal / quantity` ⇒ **`quantity = 1` 的 fixture,單價恆等於小計**
    //    ⇒ 掃整個元件的 `toContain('NT$ 12,000')` **會被單價欄滿足** = 把金額格整個拿掉仍全綠
    //    (上面 `:322-325` 那段註解警告的「兩值都是 12,000 ⇒ 零判別力」,被我改 fixture 時
    //     從「總額 vs 小計」換成「單價 vs 小計」**部分還原了**)。
    //    🔴 **形狀記著:改共用 fixture 有兩個方向的後果 —— 假紅會自己叫、假綠不會。**
    //       本片改完之後我把全檔 7 條正向金額斷言逐條掃過(量法:`grep -n 'NT\$' <本檔>`),
    //       只有這一條被單價欄滿足;`:346`(36,000)、`:361`(25,000)、`:383`(29,000)、
    //       `:1175`(20,000)的期望值都不等於任何一列的單價 ⇒ 判別力未受影響、不動。
    //    ⚠️ 負向那條(12,100 = 整單總額)**不收斂**:12,100 不可能出現在單價欄,收了是白收。
    expect(
      [...container.querySelectorAll('td.col-amount')].map((td) => td.textContent).join('|'),
    ).toContain('NT$ 12,000');
    expect(container.textContent).not.toContain('NT$ 12,100');
    // 🔴 L2 起結構面改由 `data-l` 釘(rowSpan 已拆、`td[rowspan]` 計數不再存在):
    //    非合併態 = 品項的錢 ⇒ 手機卡片標籤是「小計」;合併態 = 訂單的錢 ⇒ 標籤是「金額」。
    //    這比原本數 rowspan 更貼近使用者看得到的差別 —— 卡片上沒有表頭,標籤就是語意的唯一載體。
    expect(container.querySelector('td.col-amount')!.getAttribute('data-l')).toBe('小計');
  });

  it('1 品項 × 數量 3 → 合併格顯示整單總額', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 3, 36000)], total: { amount: toMoneyAmount(36000), currency: 'TWD' } })]} />,
    );

    expect(container.textContent).toContain('NT$ 36,000');
    // 合併態 ⇒ 金額格是訂單層,卡片標籤是「金額」(上一格的正負對照)
    expect(container.querySelector('td.col-amount')!.getAttribute('data-l')).toBe('金額');
  });

  it('🔴 3 品項 × 每個數量 1 → 仍要合併並顯示整單總額(規則的另外半條)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );

    // ⚠️ **L2 起「鎖進 `<table>`」這個防護不再承重** —— 收斂後整個 container 只剩一份 markup、
    //    手機卡片那個「第二個供應者」已經不存在(原註解說的失效模式結構上消失)。
    //    這裡保留 `table` 限定只為讓斷言意圖仍然明確,不是靠它擋突變。
    const table = container.querySelector('table')!;
    expect(table.textContent).toContain('NT$ 25,000');
    // 反面:不得再逐列顯示各列小計。
    // 🏁 **L3 片2:範圍從整張 table 收斂到金額欄** —— `NT$ 8,000` 現在**合法地**出現在
    //    第二列的單價欄(該品項單價 8,000 × 1 = 小計 8,000),而本格守的是
    //    「金額欄不逐列重複」,不是「這個數字不准出現在畫面上」。
    //    ⚠️ 縮小範圍 ⇒ 已用突變證明它仍會紅(見 commit body)。
    const amountCells = [...table.querySelectorAll('td.col-amount')]
      .map((td) => td.textContent)
      .join('|');
    expect(amountCells).not.toContain('NT$ 8,000');
    // 合併態 ⇒ 金額是訂單層:三列各有一格佔位,只有第一列有值
    const amounts = [...container.querySelectorAll('td.col-amount')];
    expect(amounts.length).toBe(3);
    expect(amounts.filter((td) => td.childNodes.length > 0).length).toBe(1);
  });

  it('2 品項 × 其中一列數量 2 → 合併並顯示整單總額', () => {
    const lines = [line('l1', 2, 24000), line('l2', 1, 5000)];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(29000), currency: 'TWD' } })]} />,
    );

    expect(container.querySelector('table')!.textContent).toContain('NT$ 29,000');
    // 合併態 ⇒ 金額是訂單層:兩列各有一格佔位,只有第一列有值
    const amounts = [...container.querySelectorAll('td.col-amount')];
    expect(amounts.length).toBe(2);
    expect(amounts.filter((td) => td.childNodes.length > 0).length).toBe(1);
  });
});

// ── V5:空 lines 兜底 ─────────────────────────────────────────────────
describe('V5 — 空 lines', () => {
  it('lines 為空仍渲染一列佔位、訂單層格不消失', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [] })]} />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelectorAll('td').length).toBe(14); // L3 片1 狀態+發票、片2 +單價;2b-1 勾選;A13 操作
    expect(container.textContent).toContain('PCM-0001');
    // 🔴 逐格釘品項欄兜底,不用整表 `toContain('—')` —— 後者由「年份廠牌車種」欄
    //    (fixture `vehicle: null`)恆滿足,證不了品牌/料號/品名真的有兜底(R1 nit)。
    const tds = [...rows[0]!.querySelectorAll('td')];
    expect(tds[3]!.textContent).toBe('—'); // 品牌
    expect(tds[4]!.textContent).toBe('—'); // 料號
    expect(tds[5]!.textContent).toBe('—'); // 品名
    expect(tds[7]!.textContent).toBe('—'); // 數量
  });
});

// ── V7:客戶格 ────────────────────────────────────────────────────────
describe('V7 — 客戶格含等級小字,等級不再單獨成欄', () => {
  it('同一個 <td> 內同時有客戶名與會員等級文字,且表頭無「會員等級」', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).not.toContain('會員等級');
    // 🔴 用**固定欄索引 8**,不用「最後一個帶 rowspan 的格」:A11a-4/-5/-6 任一片在客戶欄之後
    //    再加訂單層 rowSpan 欄,後者就會靜默指到別格、這條變成量錯東西(R1 nit)。
    const customerCell = [...container.querySelectorAll('tbody tr td')][10]!; // 2b-1 +1 勾選欄、L3 片2 +1 單價欄
    expect(customerCell.textContent).toContain('王小明');
    // 🔴 等級文字必須與名字在**同一格**;分成兩格會讓上面那條仍過、但版面回到舊的兩欄
    expect(customerCell.textContent).not.toBe('王小明');
  });

  it('客戶名為 null → 顯示「—」但等級小字仍在', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], customerName: null })]} />,
    );
    const customerCell = [...container.querySelectorAll('tbody tr td')][10]!; // 2b-1 +1 勾選欄、L3 片2 +1 單價欄

    expect(customerCell.textContent).toContain('—');
    expect(customerCell.textContent!.length).toBeGreaterThan(1);
  });
});

// ── L3 片1(2026-08-14):付款膠囊下架 + 狀態八值欄上場(Sean 拍 Q2=A:狀態欄獨扛)──────
//
// 🔴🔴 **本段取代了三個舊 describe,取代不是刪除 —— 三個都是在測「已經不存在的 UI」**:
//    ① `V8 — 付款軸小字在訂單編號格內` ② `A11b — 付款軸膠囊配色(五態)`
//    ③ `A11b — 訂貨軸膠囊配色(三段完成度 + 邊界)`
//    留著它們不是「多守一點」——那三組會**恆炸**(它們 querySelector 的節點已不存在、`!` 會丟)
//    ⇒ 唯一的選擇是換掉,不是保留。
// ⚠️ **舊守門守的東西沒有全部消失,要逐項交代去哪了**(不交代就是偷偷放寬):
//    · 「付款軸不另立欄」→ 由本段第一組的 `toEqual(EXPECTED_HEADERS)` 接手(欄集合仍是全額比對)
//    · 「五態各自可辨識、不塌陷成同色」→ **降級了**:狀態八值的收款軸只有 `paid` / 非 `paid` 兩態
//      (`orderPayAxis` 的誠實邊界),`refunded` 與 `unpaid` 在列表上**現在真的同色**。
//      🔴 這是 Sean 拍 Q2=A 的**已知代價**,不是本片弄丟的;`order-status-axes.test.ts`
//      有一格專釘 `refunded` 落在哪一軸。**本檔不再宣稱列表能分辨五態。**
//    · 「訂貨三段完成度配色」→ 移到明細頁(`ItemAxisCell`);列表這格換成**整單彙總**的貨品軸,
//      兩者不是同一個數字(`orderGoodsAxis` docstring 逐字:所有品項都到齊才進下一階段)。

describe('L3 片1 — 付款膠囊已下架(取代 V8)', () => {
  it('表頭恆等於 EXPECTED_HEADERS(「狀態」進、「訂貨」出),且**無**「付款」欄', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).toEqual(EXPECTED_HEADERS);
  });

  // 🔴 **這一格是「下架」的正向守門,不是註解**:把付款膠囊那段 JSX 貼回 `orders-table.tsx`
  //    就會紅。用**五態全掃**而不是只掃 `已付款`:只掃一態的話,有人把它改成永遠顯示
  //    `待付款` 仍然全綠。
  it('🔴 整張表零付款軸字面(五態逐一掃),且單號格內零膠囊 `<span>`', () => {
    for (const status of ['paid', 'unpaid', 'partiallyPaid', 'refunded', 'partiallyRefunded'] as const) {
      const { container, unmount } = render(
        <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus: status })]} />,
      );
      // 2b-1:第 0 格是勾選欄 ⇒ 訂單編號是第 1 格。
      const idCell = [...container.querySelectorAll('tbody tr td')][1]!;

      expect(idCell.textContent).toContain('PCM-0001');
      // 🔴 掃的是**整張表**、不是只掃單號格:膠囊被搬到別格也算沒下架。
      //
      // 🔴🔴 **`#494` 起 `refunded` 這一態是例外,而且是字面撞名、不是下架失敗**:
      //    Sean 拍 `Q-494-2`=B 之後狀態膠囊自己會顯示「已退款」,而
      //    `PAYMENT_STATUS_LABEL.refunded`(`order-list-view.ts:135`)**逐字也是「已退款」**。
      //    共用同一個詞是刻意的:篩選下拉與膠囊講同一件事卻用兩個詞,正是 `#494` 要治的病。
      //    ⇒ 這一態改判「**恰好出現一次,而且那一次在狀態格(td[11])**」。
      //    **判別力沒有變弱**:付款膠囊貼回來 ⇒ 兩次(紅);膠囊被搬到別格 ⇒ 狀態格那條落空(紅)。
      if (status === 'refunded') {
        const statusCell = [...container.querySelectorAll('tbody tr td')][11]!;
        // 🔴 codex 關卡2 F4:只驗「字面恰一次」不夠 —— 把舊付款膠囊塞進**狀態格**、
        //    或把它渲染成沒有膠囊的裸文字,次數仍是 1 ⇒ 綠。
        //    ⇒ 再釘形狀:狀態格內**恰一顆 `<span>`**,而且它就是那顆膠囊。
        const spans = statusCell.querySelectorAll('span');
        expect(spans.length).toBe(1);
        expect(spans[0]!.textContent).toBe(PAYMENT_STATUS_LABEL.refunded);
        expect(container.textContent!.split(PAYMENT_STATUS_LABEL.refunded).length - 1).toBe(1);
      } else {
        expect(container.textContent).not.toContain(PAYMENT_STATUS_LABEL[status]);
      }
      // 🏁 **片6 起單號格內不再有任何 `<span>`**(「已取消」膠囊也下架了、`Q-E1` = A)
      //    ⇒ 這條從「本 fixture 沒取消所以是 0」變成「任何單都該是 0」,判別力**變強不是變弱**:
      //    誰把任何一顆膠囊搬回單號格,這裡就紅。
      expect(idCell.querySelectorAll('span').length).toBe(0);
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 狀態八值欄(L1 `f745e04e` 的純函式第一次上畫面)。
// 🔴 期望值**全部從 `order-status-axes.ts` 的 export 取**,不在本檔重打一份中文字面 ——
//    重打一份的話,那支改字面時本檔仍全綠(= 守門看不到真正的回歸)。
// ─────────────────────────────────────────────────────────────

/**
 * 狀態欄在該列的固定索引。**L3 片2 起是 11**(欄序重排 + 新增單價欄):
 * 0 勾選 / 1 單號 / 2 日期 / 3 車種 / 4 廠牌 / 5 料號 / 6 物品名稱 / 7 數量 / 8 單價 / 9 金額 / 10 客戶 /
 * **11 狀態** / 12 發票 / 13 操作
 */
const STATUS_CELL_INDEX = 11;

/** 把一列的四軸數量推到指定階段(`orderGoodsAxis` 的判序是 shipped ⊆ instock ⊆ ordered)。 */
function lineAt(id: string, quantity: number, stage: OrderGoodsAxis): AdminOrderLine {
  const l = line(id, quantity, 12000);
  const n = quantity;
  return {
    ...l,
    quantitySummary: {
      ...l.quantitySummary,
      orderedQuantity: stage === 'none' ? 0 : n,
      instockQuantity: stage === 'instock' || stage === 'shipped' ? n : 0,
      shippedQuantity: stage === 'shipped' ? n : 0,
    },
  };
}

describe('L3 片1 — 狀態八值欄(取代 A11b 兩組膠囊配色)', () => {
  it.each([
    ['paid', 'none'],
    ['paid', 'ordered'],
    ['paid', 'instock'],
    ['paid', 'shipped'],
    ['unpaid', 'none'],
    ['unpaid', 'ordered'],
    ['unpaid', 'instock'],
    ['unpaid', 'shipped'],
  ] as const)('%s × %s → 字面與 class 皆等於 orderStatusView 的回傳(不在 UI 端重拼)', (pay, goods) => {
    const testOrder = order({ lines: [lineAt('l1', 2, goods)], paymentStatus: pay });
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[testOrder]} />);
    const cell = [...container.querySelectorAll('tbody tr td')][STATUS_CELL_INDEX]!;
    const capsule = cell.querySelector('span')!;
    const expected = orderStatusView(testOrder);

    // 🔴 正向:純函式算出來的軸真的是我們想測的那一格(否則八格可能全落在同一個狀態上而仍全綠)。
    expect([expected.payAxis, expected.goodsAxis]).toEqual([pay, goods]);
    expect(capsule.textContent).toBe(ORDER_STATUS_LABEL[pay][goods]);
    expect(capsule.className).toBe(expected.capsuleClass);
    // 🔴 **獨立字面,不是重複上一行**(R 審 F1):上一行兩邊都來自 `orderStatusView`
    //    ⇒ 把 `order-status-axes.ts:162` 的 `STATUS_CAPSULE` 拿掉,期望值會跟著變、那行**不會紅**。
    //    這行拿的是共用形狀常數本身 ⇒ 膠囊被改成沒有 `rounded-full`/`px-2` 的裸文字時它會紅。
    expect(capsule.className).toContain(STATUS_CAPSULE);
  });

  it('🔴 八值字面互不相同(擋「兩格顯示同一個詞」——那等於員工分不出來)', () => {
    const labels = (['paid', 'unpaid'] as const).flatMap((pay) =>
      ORDER_GOODS_AXIS_VALUES.map((goods) => ORDER_STATUS_LABEL[pay][goods]),
    );

    expect(labels.length).toBe(8);
    expect(new Set(labels).size).toBe(8);
  });

  // 🔴 這格守的是 Sean 拍 Q28=A 那個**唯一例外**:未收 × 出貨 = 全檔唯一的實心深紅。
  //    正負對照缺一不可 —— 只驗「未收出貨是深紅」的話,把所有格都改成深紅仍然綠。
  it('🔴 未收出貨 = 唯一實心深紅;已收出貨走淡綠(正負對照)', () => {
    const risk = order({ lines: [lineAt('l1', 1, 'shipped')], paymentStatus: 'unpaid' });
    const safe = order({ lines: [lineAt('l1', 1, 'shipped')], paymentStatus: 'paid' });
    const cls = (o: AdminOrderSummary) => {
      const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[o]} />);
      return [...container.querySelectorAll('tbody tr td')][STATUS_CELL_INDEX]!.querySelector('span')!.className;
    };

    const riskCls = cls(risk);
    const safeCls = cls(safe);

    // 🔴 2026-08-16 Sean 拍板配色換 BMW ⇒ 期望值由 Tailwind 調色盤改成 `.cap-*`。
    //    真正在守「顏色看不看得清楚」的是 `app/design-tokens.test.ts` 的實算對比;這裡守的是掛對 class。
    expect(riskCls).toContain('text-white');
    expect(riskCls).not.toContain('cap-g');
    expect(safeCls).toContain('cap-g');
    expect(safeCls).not.toContain('text-white');
  });

  // 🔴 未收的紅框:它是**收款軸的唯一視覺載體**(付款膠囊下架之後)。
  //    ⚠️ 例外格(未收出貨)刻意不吃紅框 ⇒ 這格用 `instock` 而不是 `shipped`。
  it('🔴 未收 × 在庫 → 帶紅框;已收 × 在庫 → 不帶(付款膠囊下架後,紅框是收款軸唯一的視覺載體)', () => {
    const cls = (paymentStatus: 'paid' | 'unpaid') => {
      const { container } = render(
        <OrdersTable
          buildPanelHref={panelHref}
          orders={[order({ lines: [lineAt('l1', 1, 'instock')], paymentStatus })]}
        />,
      );
      return [...container.querySelectorAll('tbody tr td')][STATUS_CELL_INDEX]!.querySelector('span')!.className;
    };

    // ⚠️ **2026-08-17 片 A-1:未收款標記的載體從 `shadow-[…]` 換成 class `cap-unpaid`**
    //    (OD `-bmw-m:218` 的 inset 左緣紅槓)。**這格守的是「未收有標記、已收沒有」,與載體無關。**
    expect(cls('unpaid')).toContain('cap-unpaid');
    expect(cls('paid')).not.toContain('cap-unpaid');
    // 兩者的底色相同 ⇒ 證明差別真的只在標記那一項,不是整個換了配色。
    expect(cls('unpaid')).toContain('cap-bl');
    expect(cls('paid')).toContain('cap-bl');
  });

  it('已取消單:狀態格顯示「已取消」、不落進 2×4 矩陣的任何一格', () => {
    const testOrder = order({ lines: [lineAt('l1', 1, 'ordered')], cancelledAt: '2026-08-12T06:00:00.000Z' });
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[testOrder]} />);
    const capsule = [...container.querySelectorAll('tbody tr td')][STATUS_CELL_INDEX]!.querySelector('span')!;

    expect(capsule.textContent).toBe(ORDER_STATUS_CANCELLED_LABEL);
    // 已取消走的是 `orderStatusView` 的**另一條 return**(早退分支)⇒ 共用形狀各釘各的,不靠上面那格蘊含。
    expect(capsule.className).toContain(STATUS_CAPSULE);
    // 反面:它不得同時是矩陣裡的任何一個字面(擋「已取消被畫成已收已定」)。
    const matrix = (['paid', 'unpaid'] as const).flatMap((p) =>
      ORDER_GOODS_AXIS_VALUES.map((g) => ORDER_STATUS_LABEL[p][g]),
    );
    expect(matrix).not.toContain(capsule.textContent);
  });

  // 🔴 空 lines 的貨品軸必須是 `none` 而不是 `shipped` —— `[].every()` 恆真,
  //    不擋的話一張沒有品項的單會顯示「出貨完成」(`orderGoodsAxis` docstring 記的那個坑)。
  it('🔴 空 lines 佔位單:狀態走 none 那一格,不是 shipped', () => {
    const testOrder = order({ lines: [] });
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[testOrder]} />);
    const capsule = [...container.querySelectorAll('tbody tr td')][STATUS_CELL_INDEX]!.querySelector('span')!;

    expect(capsule.textContent).toBe(ORDER_STATUS_LABEL.paid.none);
    expect(capsule.textContent).not.toBe(ORDER_STATUS_LABEL.paid.shipped);
  });
});

/**
 * 🔴🔴 **原本這裡是 S4「桌機與卡片膠囊 class 字串相等(雙 markup 一致性)」,L2 起換了守門對象。**
 *
 * 換的理由不是「不重要了」,是**那個失效模式結構上消失了**:S4 守的是「同一顆膠囊在兩份 markup
 * 各拼一次、兩邊會漂」,而 #447 收斂之後整張表只有一份 markup ⇒ 沒有第二份可以漂。
 * 原斷言裡的 `container.querySelectorAll('ul span')` 現在恆為空集合
 * ⇒ 留著它只會是一條**恆真(或恆炸)**的假守門。
 *
 * ⇒ 改守收斂本身:**同一顆膠囊在整張表恰好渲染一次**。
 *    有人日後為了「手機好看」再補一份卡片 markup 回來,這組會直接紅。
 */
describe('L2 — 收斂後每顆膠囊只渲染一次(取代雙 markup 一致性 S4)', () => {
  // 🏁 **L3 片1:原本這裡守兩顆膠囊(付款軸 / 訂貨軸),兩顆都已下架 ⇒ 改守狀態膠囊那一顆。**
  //    守門的**用意沒有變**:「同一顆膠囊在整張表恰好渲染一次」——
  //    有人日後為了「手機好看」再補一份卡片 markup 回來,這格會直接紅。
  //    ⚠️ 三品項單是**承重的 fixture**,不是隨手挑的:狀態是訂單層 ⇒ 它必須只在第一列出現;
  //    若有人把它寫成逐列(照抄舊訂貨欄那個分支),這格會數到 3 顆而不是 1 顆。
  it('狀態軸:三品項單整張表恰一顆、class 走 orderStatusView', () => {
    const testOrder = order({
      lines: [line('l1', 1, 4000), line('l2', 1, 4000), line('l3', 1, 4000)],
      total: { amount: toMoneyAmount(12000), currency: 'TWD' },
    });
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[testOrder]} />);
    const expected = orderStatusView(testOrder);

    const capsules = [...container.querySelectorAll('span')].filter(
      (el) => el.textContent === expected.label,
    );

    expect(capsules.length).toBe(1);
    expect(capsules[0]!.className).toBe(expected.capsuleClass);
  });

  it('🔴 收斂的結構斷言:整個元件不再有第二份列表容器(零 `<ul>`)', () => {
    // 收斂前手機卡片是 `<ul class="… md:hidden">`;它整支刪除之後這裡恆 0。
    // ⚠️ 這條**只擋「用 ul 重新長出第二份」**,擋不了改用 `<div>` 重寫一份
    //    —— 那種要靠上面兩格的「恰一顆」計數擋。兩者一起看才完整。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]} />);

    expect(container.querySelectorAll('ul').length).toBe(0);
    expect(container.querySelectorAll('table').length).toBe(1);
  });
});

describe('V6 接線 — 日期格吃的是 formatOrderListDate,不是 formatOrderDate', () => {
  it('同年 fixture → 日期格為 `08/06`,且**不含**完整 `2026-08-06`', () => {
    // 🔴 系統時間釘死:同年/跨年是相對當下判斷,不釘的話這條在 2027 年會自己變紅(時間炸彈)。
    //    fixture `createdAt` = `2026-08-06T02:00:00Z`(台北 2026-08-06)。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T02:00:00Z'));
    try {
      const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
      const dateCell = [...container.querySelectorAll('tbody tr td')][2]!;

      // 🔴 原本這下面多寫一條 `.not.toContain('2026-08-06')`,R1 抓到被本條嚴格蘊含 ⇒ 已刪。
      //    連帶更正我先前的突變報告:突變②(接線改回 `formatOrderDate`)紅的是**整條 it**,
      //    不是「只紅那一條斷言」—— 兩個斷言在同一條 it 內本來就不可分辨。
      expect(dateCell.textContent).toBe('08/06');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── V9(L3 片1 改寫):原本守「訂貨欄是品項層」,訂貨欄已下架 ⇒ 守門對象換人 ────────────
//
// 🔴🔴 **這一段是覆蓋差集的落點,不是順手保留** —— 舊 V9 有三格,標的各自的去處:
//   ① 「逐列顯示 `已訂/買了`、分子分母各自接對線」= `quantitySummary` 三軸有沒有流到畫面。
//      **標的仍在**,但流去的地方換了:現在流進 `orderGoodsAxis` ⇒ 由狀態八值那組的
//      `expect([expected.payAxis, expected.goodsAxis]).toEqual([pay, goods])` 加
//      `order-status-axes.test.ts`(34 格)接手。⚠️ **粒度降低了**:舊格分得出「分子分母對調」,
//      新格只分得出「整單走到哪一階段」。**這是真的損失,寫在這裡不掩蓋。**
//   ② 「品項層欄不得被寫成 `first ?` 分支」= **標的完全還在**(料號 / 品名 / 數量 / 車種 / 廠牌
//      五欄仍是品項層)⇒ 就是下面這一格,只是換成拿料號與數量當標的。
//      **若把它跟訂貨欄一起刪掉,片2 重排欄序時沒有任何東西會攔「把品項層寫成訂單層」。**
//   ③ 「佔位列不畫 `0/0`」= 隨訂貨欄一起走(那是訂貨欄專屬的字面);
//      「空 lines 仍渲染一列」由 V5 與狀態八值那組的空 lines 格接手。
describe('V9(改寫)— 品項層欄位逐列都有值,不得被寫成訂單層的 `first ?` 分支', () => {
  it('🔴 兩品項單:料號與數量兩欄的**每一列**都有各自的值', () => {
    const a = line('l1', 3, 12000);
    const b = line('l2', 4, 8000);
    const lines: AdminOrderLine[] = [
      { ...a, variantSku: 'SKU-AAA' },
      { ...b, variantSku: 'SKU-BBB' },
    ];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]} />,
    );
    const rows = [...container.querySelectorAll('tbody tr')];

    // 🔴 用 `col-*` class 選、不用索引:比索引更抗欄序變動(片2 就要重排欄序)。
    expect(rows.map((r) => r.querySelector('td.col-sku')!.textContent)).toEqual(['SKU-AAA', 'SKU-BBB']);
    expect(rows.map((r) => r.querySelector('td.col-qty')!.textContent)).toEqual(['3', '4']);
    // 兩欄都不得變成訂單層:兩列都要有子節點(其中一列變空 = 被寫成 `first ?` 分支)
    for (const col of ['col-sku', 'col-qty'] as const) {
      expect(
        [...container.querySelectorAll(`td.${col}`)].filter((td) => td.childNodes.length > 0).length,
        `${col} 應是品項層(兩列都有值)`,
      ).toBe(2);
    }
  });

  // 🔴 反面對照:同一張單上,**訂單層**的狀態欄只有第一列有值。
  //    兩格一起看才守得住「層級」這件事 —— 只驗品項層的話,把所有欄都寫成品項層仍全綠。
  it('🔴 同一張兩品項單:狀態欄(訂單層)只有第一列有值', () => {
    const lines = [line('l1', 1, 4000), line('l2', 1, 8000)];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(12000), currency: 'TWD' } })]} />,
    );
    const cells = [...container.querySelectorAll('td.col-status')];

    expect(cells.length).toBe(2);
    expect(cells.filter((td) => td.childNodes.length > 0).length).toBe(1);
  });
});

// 🔴 V9 逐字要求的另一半:「grep 該檔無 `?? 0`」。
//    **不能只靠型別層** —— `quantitySummary` 雖是非 nullable,`x ?? 0` 在 TS 仍完全合法、不會報錯
//    (plan 那格寫「型別層由 tsc 保證」其實不成立,只有這條文字守門擋得住)。
//    量的是原始碼字面,而這正是本條要防的東西:UI 端自己補 0 = 把 A9c 的正規化責任偷渡回顯示層。
describe('V9 — 原始碼層:本元件不得出現 `?? 0`(正規化責任在 adapter mapper)', () => {
  it('orders-table.tsx 剝掉註解後零 `?? 0`', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // 路徑走 `__dirname`(同 app 既有先例 `app/orders/[id]/refund-wiring.test.tsx` 的 `scanSources`)——
    // 不用 `import.meta.url`:在 jsdom + `.tsx` 下實測擲 `The URL must be of scheme file`。
    const raw = await readFile(join(__dirname, 'orders-table.tsx'), 'utf8');

    // 🔴 **必須先剝註解**:本檔的註解裡就逐字寫著「UI 端零 `?? 0`」——不剝的話這條守門
    //    一寫出來就恆紅(第一版真的紅了)。memory `feedback_ui-count-change-check-hardcoded-css-track-counts`
    //    同族:守門要量的是**程式碼**,不是說明它的那段話。
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 前提斷言 ①:真的讀到那個檔(讀空字串或讀錯檔 → 下面那條恆真)。
    expect(raw).toContain('export function OrdersTable');
    // 前提斷言 ②:剝註解**真的有作用**。🔴 用**合成字串**驗、不拿 production 註解當供應者(R1 nit):
    //    否則哪天有人重寫 `orders-table.tsx` 那段註解,這道前提就會轉**假紅**。
    expect(stripComments('const a = 1; // x ?? 0\n/* y ?? 0 */')).not.toContain('?? 0');

    expect(stripComments(raw)).not.toContain('?? 0');
  });
});

// ── V11 / V11b:發票欄(A11a-5)──────────────────────────────────────────
describe('V11 — 發票欄顯示 invoice_status 三態,各自可辨識', () => {
  // 🔴 三態逐格驗,**而且 `voided` 不得與 `not_issued` 同字面**(plan V11 逐字的突變靶就是
  //    「把 `voided` 併進『未開』」)。字面取自 `INVOICE_STATUS_LABEL` 的**真實值**,不是自己編的中文。
  it.each([
    ['not_issued', '未開立'],
    ['issued', '已開立'],
    ['voided', '已作廢'],
  ] as const)('%s → 「%s」', (status, label) => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], invoiceStatus: status })]} />,
    );
    const cell = [...container.querySelectorAll('tbody tr td')][12]!; // L3 片2:+1 單價欄整體右移

    expect(cell.textContent).toBe(label);
  });

  // 🔴 原本這裡還有一條「三個字面互不相同(Set size = 3)」,R1 抓到它被上面的 `it.each`
  //    **嚴格蘊含** —— `it.each` 已把三格釘成三個兩兩相異的字面,Set 那條在它全綠時不可能紅。
  //    「三者互不相同」的獨立守門改放在常數所在處:`lib/orders/order-list-view.test.ts`。已刪。

  it('發票是**訂單層**:多品項單只有第一列有值,字面在整張表只出現一次', () => {
    // 🔴 擋「順手寫成品項層」——那會讓同一張單的開票狀態在每一列重複、且與訂貨欄混淆。
    //    L2 起判準從 `rowspan="2"` 換成「兩格佔位、一格有值」(rowSpan 已拆)。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines, invoiceStatus: 'issued', total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]}
      />,
    );
    const cells = [...container.querySelectorAll('td.col-invoice')];

    expect(cells.length).toBe(2);
    expect(cells.filter((td) => td.childNodes.length > 0).length).toBe(1);
    // 收斂後 container 只有一份 markup ⇒ 這條同時也證了「沒有第二份卡片再印一次」
    expect(container.innerHTML.split('已開立').length - 1).toBe(1);
  });
});

describe('V11b — Q2b=A:列表**不顯示**載具別', () => {
  it('DOM 內零載具別字面(該資料連投影都沒有,不是有資料而選擇不畫)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);

    // 🔴 這條的判別力邊界要講清楚:`AdminOrderSummary` **型別上就沒有** carrier/載具欄
    //    (A9c 沒把 `orders.invoice` jsonb 放進列表投影)⇒ 真正擋住它的是型別層與投影白名單,
    //    本條只是把「Q2b=A 的拍板結果」釘成可讀的驗收字面。要動它得先動 A9c 的投影。
    for (const token of ['載具', 'carrier', '統編', '抬頭']) {
      expect(container.textContent).not.toContain(token);
    }
    // 🔴 原本這裡還有一條 `expect('invoice' in order(...)).toBe(false)`,R1 抓到它量的是**本檔自己的
    //    fixture 字面**、不是型別也不是投影 ⇒ **恆真**,已刪。真正的投影守門在
    //    `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts`(剝掉 `invoice_status` 再查
    //    `invoice` token,A9c 有突變證)。
  });
});

// ─────────────────────────────────────────────────────────────
// L2(#447)手機卡片模式 —— **同一份 markup + CSS**,取代 A11c 的第二份 JSX(2026-08-13)
//
// 真權威(不變)= `docs/specs/2026-07-25-admin-backend-rebuild-spec.md:427`(§4 通用 UI 規範 第 1 條):
//   「手機版列表一律轉卡片,不做橫向捲動表格。主要欄位加粗置頂、次要副行、金額/狀態靠右。」
//
// 🔴🔴 **本區的量測對象整個換過:A11c 量的是「卡片那份 markup」,現在沒有那份了。**
//    卡片化改由 `app/globals.css` 的 `.orders-grid` 區塊完成(**L3 片3 起是 `@container (max-width: 520px)`**)
//    🔴 **斷點字面全檔只准有一個版本**(R2 F1 + R3):這裡先後殘留過 `767px` 與 `47.99rem`,
//       都與當時的 CSS 互斥 ⇒ 後人照舊字面去改 CSS 會讓 M2 回歸,而守門會紅,
//       **他最可能去改守門而不是改回來**。字面漂移比缺守門更會誤導人。
//       現行唯一正確字面 = `(max-width: 520px)`,由 `CARD_QUERY` 以 postcss **全等**比對 params 釘住。
//       🔴 **L3 片3 起它也是雙份連結顯隱的斷點**(`a[data-nav]`)—— 同一條規則 ⇒ 不可能不一致。
//    ⇒ **版面本身在 jsdom 量不到**(沒有 layout 引擎、也不套 media query)。
//    ⇒ 本區只能守**卡片化所依賴的 DOM 契約**:掛勾 class、`col-*` 欄位 class、`data-l` 標籤、
//      `:empty` 賴以成立的真空格(在 V3)。**版面對不對仍要真瀏覽器 + Sean 肉眼驗**,
//      這句話是誠實邊界、不是免責 —— 交件附 430 寬截圖就是為了補這一段。
// ─────────────────────────────────────────────────────────────
describe('L2 — 手機卡片模式的 DOM 契約(卡片化由 CSS 做,本區守 CSS 靠什麼認得欄位)', () => {
  // 🔴🔴 **`globals.css` 那整塊卡片化 CSS 原本零守門(code-reviewer M3)。**
  //    失效形狀:有人刪掉那塊 ⇒ 所有測試照樣全綠、桌機完全正常、**只有手機靜默退回
  //    「13 欄橫向捲動表格」** —— 而那正是 `admin-backend-rebuild-spec.md:427` 明文禁止的形狀。
  //    三個症狀都不會報錯 ⇒ 只能靠讀 CSS 原始碼釘住。
  //    做法照現成樣板 `components/layout/workspace-shell.test.ts:36`(同一個病、同一種解法),
  //    **CSS 也要剝註解** —— `/* */` 是 CSS 唯一的註解形式,不剝就是把規則註解掉照樣綠。
  // 🔴🔴 **R3(換模型 codex)判 FAIL:手寫的大括號配對守不住三種破壞,而三種同一個根因 ——
  //    **我在用字串比對解析 CSS**。R3 逐條實跑重現:
  //      ① `indexOf(header)` 只做**前綴命中** ⇒ 在 header 後面接一個永假條件
  //         (`@media (…) and (永假)`)照樣命中、守門全綠,而手機卡片 CSS **永不生效**。
  //      ② 目標 media 被包進**永假的 `@supports`** 仍會被擷取(我只測了 media 的**子孫**、沒測**祖先**)。
  //      ③ 守門只驗「曾出現正確宣告」,**不驗 cascade 最終勝者** ——
  //         同區塊尾端、或第二塊相同 header 加一條反向規則 ⇒ 畫面壞掉而測試全綠。
  //         🔴 這條與我自報的天花板(「相同 header 只取第一個」)是**同一個洞的另一面**,
  //            而且比我以為的嚴重:不是「第二塊隱形」,是**第二塊可以推翻第一塊**。
  //
  //    ⇒ **不再補第四、第五個邊界** —— 那條路每補一次就再長出一個。改用**真的 CSS parser**:
  //      `postcss` 已是 `apps/admin` 的直接 devDependency(`package.json` 的 `"postcss": "8.5.14"`),
  //      **零新增依賴**。手寫的 `extractAtRule` 連同它那組邊界測試整個刪除(刪比補好)。
  //
  //    ⚠️ **這仍不是「畫面對了」的證明**(誠實邊界,不要讀成別的):
  //      postcss 給的是**原始碼結構**,不是瀏覽器的計算樣式。它現在能證
  //      「條件作用域對 + 同選擇器同屬性的最後一條宣告是我要的那條」,
  //      **證不了**跨選擇器的特異性競爭、也證不了實際算出來的值。那一面仍要真瀏覽器 + Sean 肉眼驗。
  describe('L2 — `globals.css` 卡片化區塊(用 postcss 走 AST,不用字串比對)', () => {
    const CSS_PATH = join(__dirname, '../../app/globals.css');
    const ROOT = postcss.parse(readFileSync(CSS_PATH, 'utf8'), { from: CSS_PATH });

    /**
     * 卡片化那條 media query 的 params 逐字(正規化空白後比對,**全等不是前綴**)。
     *
     * ⚠️ **含括號** —— postcss 的 `AtRule.params` 保留原字面的括號(實測:`"(width < 48rem)"`)。
     *    我第一版寫成不含括號,五格全紅;**是實跑告訴我的,不是我事先知道**。
     *    寫在這裡免得下一個人以為可以省括號。
     */
    // 🏁 **L3 片3:從 `@media (width < 48rem)`(視窗)換成 `@container (max-width: 520px)`(容器)。**
    //    斷點值也從 Tailwind 的 `md` 換成 OD 的 520(`overview-desktop.html:139` 逐字)。
    const CARD_QUERY = '(max-width: 520px)';
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

    /** params 全等於 `CARD_QUERY` 的所有 `@media`(數量本身就是斷言對象)。 */
    const cardMedias = () => {
      const out: import('postcss').AtRule[] = [];
      ROOT.walkAtRules('container', (r) => {
        if (norm(r.params) === CARD_QUERY) out.push(r);
      });
      return out;
    };

    /**
     * 某選擇器某屬性在**全檔 source order 裡的最後一條**宣告(= 同特異性下的 cascade 勝者)。
     * 回傳 `{ value, insideCard }`;找不到回 `null`。
     *
     * 🔴 這支就是 R3 第 ③ 條的解法:守「最後一條是誰」而不是「有沒有出現過」。
     * ⚠️ **已知邊界**:它假設同選擇器同特異性。跨選擇器的特異性競爭(例如別處寫
     *    `.orders-grid tbody.orders-group.x`)本支**不處理** —— 那要真的算特異性,
     *    而那已經是在重寫一個瀏覽器。寫出來,不要當成沒有。
     */
    const lastDecl = (selector: string, prop: string) => {
      let hit: { value: string; insideCard: boolean } | null = null;
      ROOT.walkRules((rule) => {
        if (norm(rule.selector) !== selector) return;
        rule.walkDecls(prop, (decl) => {
          // 往上走祖先鏈找卡片化 media(不是只看直接 parent —— 中間可能隔著別的 at-rule)
          let node: postcss.Container | postcss.Document | undefined = rule.parent;
          let insideCard = false;
          while (node) {
            if (node.type === 'atrule' && norm((node as postcss.AtRule).params) === CARD_QUERY) {
              insideCard = true;
              break;
            }
            node = node.parent;
          }
          hit = { value: norm(decl.value), insideCard };
        });
      });
      return hit as { value: string; insideCard: boolean } | null;
    };

    it('🔴 前提 — 卡片化 `@media` **恰一塊**,且**祖先只有 Root**(不得被任何條件 at-rule 包住)', () => {
      const found = cardMedias();
      // 恰一塊:兩塊相同 header 時,第二塊可以推翻第一塊,而舊守門只看第一塊(R3 ③)
      expect(found.length, `params 全等於 "${CARD_QUERY}" 的 @media 應恰有 1 塊`).toBe(1);
      // 祖先只有 Root:被永假的 @supports 包住時,規則永不生效而字串仍在(R3 ②)
      expect(
        found[0]!.parent?.type,
        '卡片化 @media 被包在別的 at-rule 裡 ⇒ 外層條件不成立時整塊永不生效,而字串照樣在',
      ).toBe('root');
      // 非空殼
      expect(found[0]!.nodes?.length ?? 0).toBeGreaterThan(10);
    });

    it('🔴 斷點 params **全等**,不是前綴命中(擋「後面接一個永假條件」)', () => {
      // R3 ①:`indexOf` 版對 `@container (max-width: 520px) and (min-width: 99999px)` 照樣命中。
      // postcss 給的是 params 本身 ⇒ 全等比對讓那個突變直接紅。
      expect(norm(cardMedias()[0]!.params)).toBe(CARD_QUERY);
    });

    // 🔴🔴 **截斷三件只給 `td`,`th` 不套**(W7 2026-08-18,把 OD 搬對)。
    //
    // **症狀**:表頭「數量」被截成「數…」。**根因不是欄太窄,是我們把 `td` 的截斷抄到了 `th` 上。**
    //   真瀏覽器量到(`localhost:3002` / viewport 1728):`th.col-qty` 可用 **25px**,
    //   「數量」帶表頭字距 `1.5px` = **27px**、不帶 = **24px** ⇒ **溢出的 2px 全部來自字距**,
    //   而字距在最後一個字後面還加一次 —— 那 1.5px 是**看不到的尾空**。
    // **OD 逐字**(兩份檔都一樣,開檔讀的):`table.g th{…white-space:nowrap}` 沒有 overflow / ellipsis;
    //   三件只在 `table.g td`(`overview-desktop.html:106-107` / `-bmw-m:168-170`)。
    // 📌 **這一格守的是「範圍」不是「有沒有」** —— 原本的引用(`:107`)是對的,
    //    錯的是把那條 `td` 規則的**適用對象**擴大成 `th, td`。**引用正確不代表範圍正確。**
    //
    // ⚠️ **誠實邊界**:postcss 看不到瀏覽器算出來的樣式,也算不了跨選擇器的特異性競爭
    //    (與本區塊上方 `lastDecl` 的自報邊界同一條)。這一格能證的是**原始碼裡誰宣告了它**。
    // 🔴 **兩格成對,缺一就恆綠**:
    //    ①`td` 那條**還在**(有人整條刪掉 ⇒ 資料格互相壓,而只守 `th` 的話這格照樣綠);
    //    ②沒有任何帶 `th` 的選擇器宣告 `overflow`(有人改回 `th, td` ⇒ 刪節號回來)。
    it('🔴 截斷三件只給 `td`:`td` 那條還在,而**沒有任何 `th` 選擇器**宣告 `overflow`', () => {
      // ① 正向(同時是本格的量具自檢:找得到才代表這支 parser 真的看得見這條規則)
      // 🔴 **不能用 `lastDecl`** —— 它回「全檔最後一條」,而卡片化區塊裡有一條
      //    `.orders-grid td { overflow: visible }`(縱向卡片不能截斷)⇒ 全檔最後一條恆為 `visible`。
      //    **這是實跑告訴我的**:第一版斷言 `toBe('hidden')` 直接紅在 `visible` 上。
      //    ⇒ 桌機那條要問的是「**卡片化以外**的最後一條」。
      const tdOverflows: Array<{ value: string; insideCard: boolean }> = [];
      ROOT.walkRules((rule) => {
        if (norm(rule.selector) !== '.orders-grid td') return;
        rule.walkDecls('overflow', (decl) => {
          let node: postcss.Container | postcss.Document | undefined = rule.parent;
          let insideCard = false;
          while (node) {
            if (node.type === 'atrule' && norm((node as postcss.AtRule).params) === CARD_QUERY) {
              insideCard = true;
              break;
            }
            node = node.parent;
          }
          tdOverflows.push({ value: norm(decl.value), insideCard });
        });
      });
      const desktop = tdOverflows.filter((d) => !d.insideCard);
      const card = tdOverflows.filter((d) => d.insideCard);
      expect(
        desktop.length,
        '卡片化之外一條 `.orders-grid td` 的 overflow 都沒有 ⇒ fixed 版面下資料格會互相壓',
      ).toBeGreaterThan(0);
      expect(desktop[desktop.length - 1]!.value, '桌機那條 `td` 截斷被改掉了').toBe('hidden');
      // 卡片化那條也一起釘:它被刪掉的話,換行後的第二行會被裁掉(縱向卡片沒有欄寬)
      expect(card.map((d) => d.value), '卡片化區塊的 `td` overflow 解除被動到了').toEqual(['visible']);

      // ② 反向:任何選擇器只要含 `.orders-grid th` 就不得宣告 overflow
      const offenders: string[] = [];
      ROOT.walkRules((rule) => {
        if (!/\.orders-grid\s+th\b/.test(norm(rule.selector))) return;
        rule.walkDecls('overflow', (decl) => {
          offenders.push(`${norm(rule.selector)} { overflow: ${norm(decl.value)} }`);
        });
      });
      expect(
        offenders,
        `表頭被套上 overflow ⇒ 「數量」這種剛好差 2px 的表頭會被打成「數…」。命中:${offenders.join(' / ')}`,
      ).toEqual([]);

      // ③ 分母:上面那個正規式真的掃得到 `th` 選擇器嗎(掃不到的話 ② 是恆綠的)
      let thRules = 0;
      ROOT.walkRules((rule) => {
        if (/\.orders-grid\s+th\b/.test(norm(rule.selector))) thRules += 1;
      });
      expect(thRules, '一個 `.orders-grid th` 選擇器都沒掃到 ⇒ ② 那格沒有判別力,不是通過').toBeGreaterThan(0);
    });

    it('🔴 四條承重規則:**最後一條宣告**落在卡片化 media 內、值正確(不是「出現過」)', () => {
      const cases: Array<[string, string, string, string]> = [
        ['.orders-grid thead', 'display', 'none', 'thead 沒收起 ⇒ 卡片頂端出現一排桌機欄名'],
        ['.orders-grid td:empty', 'display', 'none', 'td:empty 沒收起 ⇒ 卡片冒出只有標籤沒有值的空行'],
        ['.orders-grid td[data-empty]', 'display', 'none', 'data-empty 沒收起 ⇒ 卡片印出「廠牌 —」噪音'],
        ['.orders-grid td::before', 'content', 'attr(data-l)', 'data-l 沒接上 ⇒ 卡片上每個值都沒有欄名'],
      ];
      for (const [sel, prop, want, why] of cases) {
        const last = lastDecl(sel, prop);
        expect(last, `${sel} 的 ${prop} 完全不存在 ⇒ ${why}`).not.toBeNull();
        expect(last!.value, why).toBe(want);
        expect(last!.insideCard, `${sel} 的最後一條 ${prop} 不在卡片化 media 內 ⇒ 桌機也會吃到`).toBe(true);
      }
    });

    // 🏁 **L3 片6:狀態膠囊的紅框被 `overflow: hidden` 切掉**(Sean 2026-08-14 回報「狀態圖標卡到」)。
    //
    // 🔴 **這一格守的是「那一行還在」,不是「膠囊沒被切」** —— 誠實邊界,不要讀成別的:
    //    postcss 看不到 `box-shadow` 往外溢出幾 px。真正證明它好了的是瀏覽器實測
    //    (三檔各 15 顆膠囊、逐顆量**膠囊元素本身**、`clipped 0/15`、最小餘裕 4.1px > 紅框 3px;
    //     數字在 `~/pcm-mailbox/E-504-STOP.md`)。
    // 🔴 **那為什麼還要這一格**:症狀是「未收款膠囊的紅框上緣少 2px」——
    //    肉眼幾乎看不出來、截圖也看不出來 ⇒ 誰把這一行刪了或改回 `top`,**不會有任何人發現**。
    //    這一格讓「刪掉它」變成紅的。
    // ⚠️ `insideCard` 必須是 **false**:置中是**桌機**的修法;卡片模式那段自己把列高改成 `auto`,
    //    寫進 media 內等於桌機吃不到 = 修了跟沒修一樣,而三綠照樣全綠。
    it('🔴 片6 — 狀態格 `vertical-align: middle` 還在,且**不在**卡片化 media 內', () => {
      const last = lastDecl('.orders-grid td.col-status', 'vertical-align');
      expect(
        last,
        '狀態格沒有 vertical-align ⇒ 回到元件的 `align-top`,未收款膠囊的 3px 紅框會被 overflow:hidden 切掉',
      ).not.toBeNull();
      expect(last!.value, '值不是 middle ⇒ 膠囊不再置中,上緣餘裕回到 0.5~1px < 紅框的 3px').toBe('middle');
      expect(last!.insideCard, '寫進卡片化 media 內 ⇒ 桌機吃不到,而桌機才是出問題的那一邊').toBe(false);
    });

    it('🔴🔴 整卡可點的定位脈絡:兩條成對,且 `tr` 的 position **只准存在於 media 內**', () => {
      // M4 那個真功能損失的唯一守門(桌機看不到、截圖也看不到)。
      const tbody = lastDecl('.orders-grid tbody.orders-group', 'position');
      expect(tbody, 'tbody 沒有 position ⇒ 覆蓋層只蓋第一段,其餘品項點不到').not.toBeNull();
      expect(tbody!.value).toBe('relative');
      expect(tbody!.insideCard).toBe(true);

      const tr = lastDecl('.orders-grid tr', 'position');
      expect(tr, 'tr 沒有 position:static ⇒ 它仍是最近的已定位祖先,上面那條白寫').not.toBeNull();
      expect(tr!.value).toBe('static');
      // 🔴🔴 **負向、而且是本組最重的一條**:`.orders-grid tr{position:…}` 一旦落在 media **外**,
      //    桌機會蓋掉 Tailwind 的 `.relative`(0-1-1 且未包 @layer ⇒ 恆勝)
      //    ⇒ `after:inset-0` 往上找不到已定位祖先 ⇒ 覆蓋層落到 initial containing block
      //    ⇒ **整個視窗變成那張訂單的連結**。⚠️ 手機完全正常 ⇒ 430 的 hit test 照不到它。
      expect(tr!.insideCard, 'tr 的 position 落在 media 外 ⇒ 桌機整頁變成一個大連結').toBe(true);
    });

    it('🔴🔴 #466 觸控熱區:`col-ops` 的連結要 `relative` + `::after` 撐出命中區,**且只在卡片模式**', () => {
      // 🔴 為什麼需要守門:這兩條掉了之後**畫面完全不變**(熱區不畫任何視覺)——
      //    症狀只有「手機上比較難按到取消」,而那要真的用手指按才發現。
      //    ⚠️ 兩條**成對**:少了 `position:relative`,`::after` 的 `inset` 會對更外層解析
      //    ⇒ 熱區跑到別的地方,而 `::after` 本身仍然存在 ⇒ 只驗其中一條會漏。
      const rel = lastDecl('.orders-grid .col-ops a', 'position');
      expect(rel, 'col-ops 的連結沒有 position ⇒ ::after 的 inset 會對更外層解析').not.toBeNull();
      expect(rel!.value).toBe('relative');
      expect(rel!.insideCard).toBe(true);

      const after = lastDecl('.orders-grid .col-ops a::after', 'inset');
      expect(after, '熱區的 inset 不見了 ⇒ ⋯ 鈕縮回視覺尺寸,低於 WCAG 2.2 的 44×44').not.toBeNull();
      // 🔴 **`#486` 乙案起這個數字重算過,不是沿用**:
      //    舊值 `-14px -12px` 是為「取消」兩個字(24×16)算的;⋯ 方鈕在卡片模式是 36×36
      //    ⇒ 照抄舊值會變 60×64,**多吃掉整整一圈 stretched link 的可點面積,而畫面上看不出差別**
      //    (「取消鈕周圍點下去會取消而不是開單」那條代價,舊註解已經認過一次)。
      //    36 + 4×2 = **44** ⇒ 剛好過線、不多吃一個像素。
      // ⚠️ 這一格釘的是**字面**,不是真實命中區 —— 真的量得到那 44×44 的只有真瀏覽器 hit test。
      expect(after!.value).toBe('-5px');
      // 配對:視覺尺寸也要在卡片區塊裡被改成 36(不改 ⇒ 熱區的算式前提不成立)。
      const cardW = lastDecl('.orders-grid .col-ops a', 'width');
      expect(cardW?.value, '卡片模式沒把 ⋯ 放大到 36 ⇒ 熱區 -5px 的算式前提不成立').toBe('36px');
      expect(cardW?.insideCard).toBe(true);

      // 🔴🔴 **這三格釘的是「字面」,而字面 ≠ 用值**(R1 F1/F8 的教訓,寫在這裡而不是別處):
      //    第一版 CSS 字面寫 36、**真瀏覽器量到 30** —— 因為 `.orders-grid .col-ops{width:34px}`
      //    的特異性壓過卡片區塊的 `td{width:auto}`,而 `lastDecl` 這支工具**不處理跨選擇器的特異性競爭**
      //    (它自己的檔頭 `:927-929` 就寫了)⇒ 那一版這些格子全綠,而手機上的按鈕是被壓扁的。
      //    ⇒ 下面這格釘的是**那條解藥還在**;真正的「用值對不對」只有真瀏覽器量得到,
      //    交件用的那次量測寫在 commit body(容器 400px:36×36、熱區 44×44、桌機槽 display:none)。
      const cardCellW = lastDecl('.orders-grid .col-ops', 'width');
      expect(
        cardCellW?.value,
        '卡片區塊沒把 col-ops 的 34px 放開 ⇒ 36px 的連結會被壓成 30px,而 CSS 字面看起來是對的',
      ).toBe('auto');
      expect(cardCellW?.insideCard).toBe(true);

      // 🔴 **只有「要顯示的那一槽」可以被提回 flex** —— 對兩槽通用地寫 `display`
      //    會與 `a[data-nav='panel']{display:none}` **同特異性**,靠 source order 蓋掉它
      //    ⇒ 手機同時出現兩顆 ⋯(真瀏覽器實測抓到過:desk 那槽量到 `flex` 而不是 `none`)。
      // 🔴 **桌機那顆的尺寸原本零守門**(R1 F15,而且我的第一輪突變確實沒抓到它:
      //    刪掉基底那條 26×26,整份測試照樣綠,而桌機的 ⋯ 會塌成字形寬 ≈ 13px、掉出
      //    WCAG 2.2 SC 2.5.8 的 24×24 AA)。⇒ 這一格專釘「**卡片區塊外面**還有一條」。
      //    ⚠️ `lastDecl` 取的是全檔最後一條(= 卡片的 36)⇒ 這裡不能用它,要自己走一次。
      const baseSize = (() => {
        let found: { w?: string; h?: string } = {};
        ROOT.walkRules((rule) => {
          if (norm(rule.selector) !== '.orders-grid .col-ops a') return;
          let node: postcss.Container | postcss.Document | undefined = rule.parent;
          while (node) {
            if (node.type === 'atrule' && norm((node as postcss.AtRule).params) === CARD_QUERY) return;
            node = node.parent;
          }
          rule.walkDecls('width', (d) => {
            found.w = norm(d.value);
          });
          rule.walkDecls('height', (d) => {
            found.h = norm(d.value);
          });
        });
        return found;
      })();
      expect(
        [baseSize.w, baseSize.h],
        '卡片區塊**外面**沒有 ⋯ 的尺寸 ⇒ 桌機那顆會塌成字形寬(≈13px),掉出 WCAG 2.5.8 的 24×24 AA',
      ).toEqual(['26px', '26px']);

      const pageDisplay = lastDecl(".orders-grid .col-ops a[data-nav='page']", 'display');
      expect(pageDisplay?.value, '手機槽沒有被提回 inline-flex ⇒ ⋯ 不置中,貼在左上角').toBe('inline-flex');
      expect(lastDecl('.orders-grid .col-ops a', 'display')?.insideCard, '卡片區塊裡不得對兩槽通用地寫 display').not.toBe(
        true,
      );
      expect(after!.insideCard, '熱區規則落在 media 外 ⇒ 桌機也會擴,會吃掉同列其他欄').toBe(true);

      const pos = lastDecl('.orders-grid .col-ops a::after', 'position');
      expect(pos?.value, '熱區不是 absolute ⇒ 它會參與版面計算、把卡片撐高(正是要避免的那件事)').toBe(
        'absolute',
      );
    });

    /**
     * 🔴🔴 `#475`(2026-08-18 重寫):**舊版只驗「有沒有提到」,三件事一件都不驗。**
     *
     * 舊版逐字 `[...inCard].some((s) => s.includes(`.${col}`))` + **硬寫的 14 個字串清單**:
     * ```
     * ① 那條規則的 order **值**是多少        —— 不驗
     * ② 同一個 order 值有沒有被兩個欄共用（重號）—— 不驗
     * ③ 清單【之外】還有沒有殘留規則          —— 不驗
     * ④ 清單本身硬寫 ⇒ 與 TSX 的 CELL 各自漂時也不會紅
     * ```
     * 實錘(條目記的):2026-08-14 一次踩中兩個盲區(`.col-ordered` 刪漏 + 與 `.col-qty` 重號),
     * **456 檔 7622 格沒有一格會紅**,抓到它的是人工逐行列 `order`。
     *
     * ⚠️ **與條目建議的差異(刻意,理由在這)**:條目寫「每個 `col-*` **恰一條**規則」,
     *    而實測 `.col-amount` **合法地有兩條**(合併態在抬頭段 `order:7`、非合併態在品項段 `order:15`,
     *    CSS 那兩處自己的註解寫著理由)⇒ 本組改成「**至少一條** + **值兩兩相異** + **集合相等**」。
     *    照條目原文寫會擋掉一個正確的設計。
     */
    it('🔴 `#475` 卡片縱向順序:每欄都有 order、值不重號、且集合恰等於 TSX 的 CELL', () => {
      /** 卡片 media 內所有「宣告了 order」的規則 ⇒ `[col, order 值]`。 */
      const orderRules: Array<[string, string]> = [];
      cardMedias()[0]!.walkRules((r) => {
        r.walkDecls('order', (decl) => {
          // 一條規則可以同時掛多個 col(選擇器逗號分隔)⇒ 逐個記。
          // 🔴 用 postcss 走訪而不是自己 regex 切:**註解裡提到的 `.col-*` 不算數** ——
          //    我第一版用 regex 掃原始碼,把註解文字當成選擇器,量出兩個不存在的重號(自己踩過)。
          for (const col of new Set(norm(r.selector).match(/\.col-[a-z]+/g) ?? [])) {
            orderRules.push([col.slice(1), norm(decl.value)]);
          }
        });
      });

      // ① 每個 TSX 宣告的欄,在卡片模式都要有落點(至少一條 order 規則)
      const withOrder = new Set(orderRules.map(([col]) => col));
      for (const col of Object.values(CELL)) {
        expect(
          withOrder.has(col),
          `${col} 在卡片化 media 內沒有 order ⇒ 它的縱向位置退回 DOM 順序,而畫面看起來「就是這樣」`,
        ).toBe(true);
      }

      // ② 🔴 order 值兩兩相異 —— 重號時順序退回 DOM 順序,**靜默**、沒有錯誤訊息
      const values = orderRules.map(([, v]) => v);
      expect(
        new Set(values).size,
        `order 值重號:${values.join(',')} ⇒ 重號的那兩欄誰在前面由 DOM 順序決定,而那不是設計`,
      ).toBe(values.length);

      // ③ 🔴 沒有 CELL 之外的殘留 —— 這一格抓的正是 2026-08-14 那個「刪漏的 .col-ordered」
      const declared = new Set<string>(Object.values(CELL));
      for (const col of withOrder) {
        expect(
          declared.has(col),
          `${col} 有 order 規則但 TSX 的 CELL 沒有它 ⇒ 不是刪漏就是改名沒同步(而它會佔掉一個 order 值)`,
        ).toBe(true);
      }
    });
  });

  it('🔴 CSS 掛勾:外框帶 `orders-grid`,內含唯一一份 `<table>`', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const wrap = container.querySelector('table')!.parentElement!;

    // 🔴 `classList.contains` 而非子字串比對:子字串會把 `orders-grid-x` 之類放過。
    //    這個 class 是 `globals.css` 那整塊的**唯一**選擇器前綴,改名沒同步 = 手機整份卡片化失效,
    //    而桌機看起來完全正常 ⇒ 桌機肉眼驗抓不到。
    expect(wrap.classList.contains('orders-grid')).toBe(true);
    // 收斂前這裡是 `hidden md:block`(桌機那份的斷點)。現在只有一份 markup ⇒ 不得再藏。
    expect(wrap.classList.contains('hidden')).toBe(false);
  });

  it('🔴 一張訂單一個 `<tbody class="orders-group">`(= 手機的一張卡),品項是它底下的 `<tr>`', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );

    // CSS 用 `tbody.orders-group` 畫卡片外框 ⇒ 這個 class 掉了,手機會變成一長串沒有分卡的列。
    expect(container.querySelectorAll('tbody.orders-group').length).toBe(1);
    expect(container.querySelectorAll('tbody.orders-group > tr').length).toBe(3);
  });

  it('🔴 訂單層欄位在整個元件內各只出現一次(收斂前這條只保證「卡片內」)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[
          order({ lines, invoiceStatus: 'issued', total: { amount: toMoneyAmount(25000), currency: 'TWD' } }),
        ]}
      />,
    );
    const html = container.innerHTML;
    const times = (token: string) => html.split(token).length - 1;

    // 🔴 量測範圍從「卡片內」放大成「整個 container」= 比收斂前**更強**:
    //    收斂前這些字面本來就會在桌機與卡片各出現一次,這條當時只能數其中一份。
    for (const token of ['已開立', '王小明']) {
      expect(times(token), `${token} 在整個元件應只渲染一次`).toBe(1);
    }

    // 🔴🔴 **單號是刻意的例外,不是漏網 —— 期望值就是 2。**
    //    #350c 拍板兩槽去處不同(桌機開面板 `/orders?panel=…`、手機走整頁 `/orders/[id]`),
    //    一個 `<a>` 沒辦法同時是兩個 href ⇒ 那一格保留雙份連結、由斷點 class 分流。
    //    ⚠️ 把它「順手統一成一個」會讓其中一槽的動線壞掉,而畫面上**兩槽看起來都有反應**
    //       (都會連到訂單相關頁面)⇒ 肉眼驗抓不到。所以這裡把 2 寫死當契約。
    // 🔴 數**連結元素**、不數字串出現次數:單號現在也出現在 `<tbody aria-label>` 裡
    //    (無障礙緩解,見元件端註解)⇒ 純字串計數會把它算進去,而它不是第三個可見的單號。
    //    實跑撞到才改的 —— 原本寫 `times('PCM-0001') === 2`,加了 aria-label 之後變 3。
    const oidLinks = [...container.querySelectorAll('a')].filter((a) => a.textContent === 'PCM-0001');
    expect(oidLinks.length, '單號 = 桌機槽 + 手機槽兩個連結(#350c 兩槽去處不同)').toBe(2);
    expect(
      container.querySelector('tbody')!.getAttribute('aria-label'),
      'tbody 的 aria-label 是「第二列之後讀不到單號」的緩解,拿掉要同步改 backlog',
    ).toBe('訂單 PCM-0001');
    // 🔴 比對**完整的 href 屬性字面**(含引號):只比 `/orders?panel=ord-1` 會連同一格的
    //    取消連結 `/orders?panel=ord-1#cancel` 一起數進去 —— 實測就是這樣紅的,不是猜的。
    expect(times('href="/orders?panel=ord-1"'), '桌機槽:面板 href').toBe(1);
    expect(times('href="/orders/ord-1"'), '手機槽:整頁 href').toBe(1);
  });

  it('🔴 每個欄位格都帶得到 `col-*` class(CSS 靠它排卡片內的縱向順序)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const row = container.querySelector('tbody tr')!;

    // 🔴 14 個 class 全列出來、逐一比對,不寫「有 14 個 col- 開頭的 class」那種弱斷言:
    //    後者在有人把兩格寫成同一個 class 時仍然全綠,而那會讓 CSS 的 `order` 撞在一起。
    // 🏁 **L3 片2:本清單同時是「桌機欄序」的唯一 DOM 面守門** —— `col-vehicle` 排在 `col-brand`
    //    之前就是「車種提到廠牌之前」那件事;有人把它換回去,這一格會紅。
    const classes = [...row.querySelectorAll('td')].map(
      (td) => [...td.classList].find((c) => c.startsWith('col-')) ?? null,
    );
    expect(classes).toEqual([
      'col-pick',
      'col-oid',
      'col-date',
      'col-vehicle',
      'col-brand',
      'col-sku',
      'col-title',
      'col-qty',
      'col-unit',
      'col-amount',
      'col-customer',
      'col-status',
      'col-invoice',
      'col-ops',
    ]);
  });

  it('🔴 `data-l` = 卡片上欄名的唯一載體(桌機有表頭、手機沒有)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const labelOf = (col: string) =>
      container.querySelector(`td.${col}`)!.getAttribute('data-l');

    // 🔴 手機卡片的 `thead` 被 CSS 收起來 ⇒ 這些格若沒有 `data-l`,卡片上就是一排沒有名字的值。
    //    ⚠️ 車種與廠牌的標籤**刻意不同字**(需求檔 §0-B:115 名詞陷阱:
    //       `brand` 是零件品牌、vehicle 裡的是車廠)—— 兩者共用同一個詞就是那條明文禁止的合併。
    expect(labelOf('col-date')).toBe('下單');
    expect(labelOf('col-brand')).toBe('廠牌');
    expect(labelOf('col-sku')).toBe('料號');
    expect(labelOf('col-vehicle')).toBe('車種');
    expect(labelOf('col-qty')).toBe('數量');
    expect(labelOf('col-unit')).toBe('單價'); // 🆕 L3 片2
    expect(labelOf('col-customer')).toBe('客戶');
    expect(labelOf('col-status')).toBe('狀態');
    expect(labelOf('col-invoice')).toBe('發票');
    expect(labelOf('col-brand')).not.toBe(labelOf('col-vehicle'));

    // 主標與純控件不掛標籤(CSS 用 `td:not([data-l])::before{display:none}` 讓它們不長標籤欄)
    for (const col of ['col-pick', 'col-oid', 'col-title', 'col-ops']) {
      expect(container.querySelector(`td.${col}`)!.hasAttribute('data-l'), `${col} 不該掛 data-l`).toBe(false);
    }
  });

  // 🔴🔴 **`data-empty` 是 N2 折出來的新 DOM 契約,原本 DOM 面零守門(R2 F3)。**
  //    CSS 那邊只驗「有那條規則」;若元件端條件寫反、或 refactor 掉 `line?.brand ?` 那半,
  //    手機卡片會**靜默少掉有值的廠牌/車種兩行**,而桌機零變化、全套測試與 CSS 守門都全綠。
  //    ⚠️ 同檔姊妹契約 `col-*` 與 `data-l` 都有 DOM 面正負守門,只有這個沒有 ⇒ 補齊。
  it('🔴 `data-empty` 正負對照:**無值才標**(標反了會讓有值的欄在手機上消失)', () => {
    const withValues = line('l1', 1, 12000); // fixture 預設 brand='Akrapovic'、vehicle=null
    const noBrand: AdminOrderLine = { ...withValues, brand: null };

    const { container: hasBrand } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [withValues] })]} />,
    );
    // 正向:有值 ⇒ **不得**標(標了 = 那一行在手機上被 CSS 收掉、值看不見)
    expect(
      hasBrand.querySelector('td.col-brand')!.hasAttribute('data-empty'),
      '廠牌有值卻標了 data-empty ⇒ 手機卡片上這一行會整個消失',
    ).toBe(false);

    const { container: blank } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [noBrand] })]} />,
    );
    // 反向:無值 ⇒ 必須標(不標 = 手機印出「廠牌 —」那行噪音,N2 回歸)
    expect(
      blank.querySelector('td.col-brand')!.hasAttribute('data-empty'),
      '廠牌無值卻沒標 ⇒ 手機卡片印出「廠牌 —」,N2 回歸',
    ).toBe(true);
    // 桌機那面不受影響:兩種情況都仍渲染 `—`,欄位不會憑空消失
    expect(blank.querySelector('td.col-brand')!.textContent).toBe('—');

    // 車種同一條(fixture `vehicle: null` ⇒ 恆無值);同時證這不是只對 brand 生效
    expect(
      hasBrand.querySelector('td.col-vehicle')!.hasAttribute('data-empty'),
      '車種無值卻沒標 ⇒ 手機卡片印出「車種 —」',
    ).toBe(true);
  });

  it('卡片含訂單層全部欄位:單號 / 金額 / 發票 / 日期 / 客戶 / 等級 / **狀態**', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[
          order({ lines, invoiceStatus: 'issued', total: { amount: toMoneyAmount(20000), currency: 'TWD' } }),
        ]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('PCM-0001');
    expect(text).toContain('NT$ 20,000'); // 合併態 = 整單總額
    expect(text).toContain('已開立');
    expect(text).toContain('王小明');
    // 🔴 字面取自 `MEMBER_TIER_LABEL.general` 實值(是「一般」不是「一般會員」)—— 猜錯過一次
    expect(text).toContain('一般');
    // 🏁 L3 片1:原本這裡驗的是付款膠囊「已付款」,那顆已下架 ⇒ 換成狀態八值那顆。
    //    字面從 `ORDER_STATUS_LABEL` 取(fixture 是 paid × 三軸皆 0 ⇒ `已收未定`),不自己打中文。
    expect(text).toContain(ORDER_STATUS_LABEL.paid.none);
  });

  it('品項層欄位:物品名稱 / 料號 / 數量 / **單價**(訂貨 n/m 已隨 L3 片1 下架)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 2, 24000)] })]} />);

    expect(container.querySelector('td.col-title')!.textContent).toBe('排氣管');
    expect(container.querySelector('td.col-sku')!.textContent).toBe('SKU-001');
    expect(container.querySelector('td.col-qty')!.textContent).toBe('2');
    // 🆕 L3 片2:單價 = 24,000 / 2 = **12,000**,刻意與小計 24,000 **不同**
    //    ⇒ 有人把單價接成 `lineTotal` 或反過來,這一格會紅(相等的 fixture 會讓接錯線全綠)。
    expect(container.querySelector('td.col-unit')!.textContent).toBe('NT$ 12,000');
    // ⚠️ **金額那格這裡是 `order.total`(12,000)不是 lineTotal(24,000)** ——
    //    `quantity 2 > 1` ⇒ `shouldMergeAmount` 為真 ⇒ 金額是**訂單層**。
    //    (我第一版把它寫成 24,000、被測試打回;留這句是為了下一個人不要再猜。)
    expect(container.querySelector('td.col-amount')!.getAttribute('data-l')).toBe('金額');
  });

  it('🔴 金額語意與桌機同源:合併態只在卡頭、非合併態逐品項', () => {
    // 非合併態 = 單品項且買 1 件 ⇒ 金額走 lineTotal、逐品項顯示。
    // 🔴 `total` 刻意設 **12,100 ≠ lineTotal 12,000**(照本檔 `:209` 桌機那格的同款做法):
    //    兩者相等的話,「一律在卡頭顯示 order.total」這個突變也會讓斷言全綠 = 撞號恆真。
    //    階段 C code-reviewer 抓到我把上一輪已修掉的坑又寫回來。
    const { container: single } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines: [line('l1', 1, 12000)], total: { amount: toMoneyAmount(12100), currency: 'TWD' } })]}
      />,
    );
    // 🏁 **L3 片2:計數範圍從「整個元件」收斂到「金額欄」** —— 單價欄現在也會印 `NT$`,
    //    而本格守的是**金額欄的語意**(整單的錢 vs 品項的錢),不是「畫面上出現幾次這個數字」。
    //    ⚠️ 這是**縮小**斷言範圍 ⇒ 已用突變證明它仍會紅(見 commit body)。
    const amountText = (box: HTMLElement) =>
      [...box.querySelectorAll('td.col-amount')].map((td) => td.textContent).join('|');
    expect(amountText(single).split('NT$ 12,000').length - 1).toBe(1);
    expect(amountText(single)).not.toContain('NT$ 12,100'); // 非合併態不得顯示整單總額

    // 合併態(多品項)⇒ 整單總額恰一次,且**不逐品項重複金額**
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container: multi } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines, total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]} />,
    );
    const text = amountText(multi);
    expect(text.split('NT$ 20,000').length - 1).toBe(1);
    expect(text).not.toContain('NT$ 12,000');
    expect(text).not.toContain('NT$ 8,000');
  });

  // 🏁 **L3 片6:單號格的「已取消」膠囊下架**(Sean 拍 `Q-E1` = A;理由=與狀態欄重複,而它讓
  //    已取消的舊格式單號被截 —— 實測需 190px、欄寬 132)。
  // 🔴 **這一格不是把舊斷言刪掉,是把方向轉過來並補上「訊息去哪了」** ——
  //    只寫「單號格沒有已取消」的話,**整顆功能被刪光也會綠**(恆真)。
  //    所以三條一起:①單號格沒有 ②狀態格有 ③**整列恰出現一次**(擋「兩邊都畫」與「兩邊都沒畫」)。
  it('🔴 已取消單:「已取消」只出現在狀態格、單號格不再重複一次', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], cancelledAt: '2026-08-06T03:00:00.000Z' })]} />,
    );
    expect(
      container.querySelector('td.col-oid')!.textContent,
      '單號格又出現「已取消」⇒ 重複訊號回來了,已取消的舊格式單號會再度被截',
    ).not.toContain('已取消');
    expect(
      container.querySelector('td.col-status')!.textContent,
      '狀態格沒有「已取消」⇒ 這張單在列表上完全看不出被取消了(片6 拿掉單號那顆的前提就是這裡有)',
    ).toContain('已取消');
    // 恰一次:`toContain` 兩條加起來仍容得下「兩格都有」,這條才擋得住。
    expect(container.textContent!.split('已取消').length - 1, '「已取消」在整列出現的次數').toBe(1);
  });

  it('未取消單:**不得**出現「已取消」(上一格的負向對照)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    expect(container.textContent).not.toContain('已取消');
  });

  // ═══ 片 A-1(2026-08-17):選中的那張單要有色塊指示 ═══════════════════════════════
  // Sean 逐字:「我在點擊訂單時候,跳出左邊側邊欄位後,**左邊訂單列會有色塊指示是在哪一個訂單**」。
  // 🔴 **改版前這件事完全沒有**(掃 5 個 pattern、分母 238 支檔全 0),不是壞掉,是沒做。
  //
  // 🔴🔴 **這一族三格【必須同時存在】,少任何一格都會變成恆綠**:
  //   ① 選中那組**有** `data-selected`      ← 只有這格 ⇒ 全部都掛也會過
  //   ② 沒選中那組**沒有** `data-selected`  ← 只有這格 ⇒ 全部都不掛也會過
  //   ③ 沒傳 prop 時**一組都不掛**          ← 擋「呼叫端漏傳」那條路（症狀是「看起來沒做」而非「壞掉」）
  // ⚠️ **屬性要用「存不存在」判,不能用值判**:React 對 `undefined` 是不渲染屬性,
  //    而 `data-selected={false}` 會渲染成 `data-selected="false"` ⇒ CSS 的 `[data-selected]` 全部命中。
  describe('片 A-1 — 選中的那張單(`data-selected`)', () => {
    const twoOrders = [
      order({ id: 'o-1', lines: [line('l1', 1, 1000)] }),
      order({ id: 'o-2', lines: [line('l2', 1, 2000)] }),
    ];
    const groups = (selectedOrderId?: string | null) => {
      const { container } = render(
        <OrdersTable buildPanelHref={panelHref} orders={twoOrders} selectedOrderId={selectedOrderId} />,
      );
      return [...container.querySelectorAll('tbody.orders-group')].map((g) =>
        g.hasAttribute('data-selected'),
      );
    };

    it('🔴 面板打開的那一組帶 `data-selected`,另一組不帶(兩個世界都餵)', () => {
      expect(groups('o-1'), 'o-1 被選中時應只有第一組帶屬性').toEqual([true, false]);
      // 🔴 反向再餵一次:換一張單,亮的那一組要跟著換 —— 只餵一邊的話「永遠亮第一組」也會過。
      expect(groups('o-2'), 'o-2 被選中時應只有第二組帶屬性').toEqual([false, true]);
    });

    it('🔴 面板沒開(`null`)⇒ 一組都不帶 —— 那是正確狀態,不是沒生效', () => {
      expect(groups(null)).toEqual([false, false]);
    });

    it('🔴 呼叫端漏傳 prop ⇒ 一組都不帶(預設 `null`,不得意外全亮)', () => {
      expect(groups()).toEqual([false, false]);
    });

    it('🔴 屬性的【值】必須是空字串,不得是 "false" —— CSS 選的是存在性', () => {
      const { container } = render(
        <OrdersTable buildPanelHref={panelHref} orders={twoOrders} selectedOrderId='o-1' />,
      );
      const all = [...container.querySelectorAll('tbody.orders-group')];
      expect(all[0]!.getAttribute('data-selected')).toBe('');
      // 沒選中的那組:屬性**整個不存在**(不是 "false")
      expect(all[1]!.getAttribute('data-selected')).toBeNull();
    });
  });

  it('🔴 空狀態只有一份 markup(不複製第二份)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[]} />);
    expect((container.innerHTML.split('目前沒有符合條件的訂單').length - 1)).toBe(1);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('ul')).toBeNull(); // 不綁斷點 class,與本區政策一致
  });

  // 🏁 **L3 片1 改寫**:原本這格守「卡片上付款軸 unpaid 上紅」(nit-5 補的正負對照)。
  //    付款膠囊已下架 ⇒ 標的換成**同一件事的新載體**:狀態膠囊上的未收紅框。
  //    🔴 標的沒有變 —— 都是「收款軸在卡片上看不看得出來」;變的只是它畫在哪一顆上。
  it('卡片上收款軸仍看得出來:unpaid 的狀態膠囊帶紅框、paid 不帶(正負對照)', () => {
    const capsuleCls = (paymentStatus: 'paid' | 'unpaid') => {
      const { container } = render(
        <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus })]} />,
      );
      return container.querySelector('td.col-status span')!.className;
    };

    // ⚠️ 2026-08-17 片 A-1:標記載體 `shadow-[…]` → class `cap-unpaid`(OD `-bmw-m:218`)。判準沒變。
    expect(capsuleCls('unpaid')).toContain('cap-unpaid');
    expect(capsuleCls('paid')).not.toContain('cap-unpaid');
  });

  it('空 lines 的佔位:仍渲染一列、品項欄顯示「—」(不是整段消失)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [] })]} />);

    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    expect(container.querySelector('td.col-title')!.textContent).toBe('—');
    expect(container.querySelector('td.col-sku')!.textContent).toBe('—');
  });

  it('🔴 鐵則 12:維持零 client 邊界(全檔零 use client / 零 hook)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const raw = await readFile(join(__dirname, 'orders-table.tsx'), 'utf8');

    // 🔴 **必須先剝註解**(同 V9 那格的教訓):本檔的檔頭註解裡就逐字寫著
    //    「零 `use client`」—— 不剝的話這條守門一寫出來就恆紅。守門要量的是**程式碼**,
    //    不是說明它的那段話。
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 前提斷言 ①:真的讀到那個檔(讀空字串/讀錯檔 ⇒ 下面全部恆真)
    expect(raw).toContain('export function OrdersTable');
    // 前提斷言 ②:🔴 **L2 起改成反向** —— 收斂後 `OrderCard` **必須不存在**。
    //    收斂前這裡是 `toContain('function OrderCard')`(證「讀到卡片那份」);
    //    第二份 markup 刪掉之後那個前提永遠不成立 ⇒ 改成守「它沒有被重新長回來」。
    expect(stripComments(raw)).not.toContain('function OrderCard');
    // 前提斷言 ③:剝註解真的有作用 —— 用**合成字串**驗,不拿 production 註解當供應者
    expect(stripComments("const a = 1; // 'use client'\n/* useState( */")).not.toContain(
      'use client',
    );

    const code = stripComments(raw);
    expect(code).not.toContain('use client');
    // 🔴 通用式而非枚舉(階段 C nit:枚舉寫下即過期,漏 useRouter/useSearchParams/useActionState…)
    expect(code).not.toMatch(/\buse[A-Z]\w*\s*\(/);
  });
});

// ── A13(訂單列表操作欄)─────────────────────────────────────────────────
//
// plan `docs/specs/2026-08-06-e10-a11a-list-rebuild-plan.md:108` 第 13 欄:
// 取消入口 = A13a/A13b(已完工的明細端流程),檢視入口 = 現行單號連結。
// 🔴 **本欄只放連結、零 client 狀態**。
//    ⚠️ 收斂前這句的理由是「桌機列與手機卡各渲染一次,帶互動控件就會變成兩份表單」;
//       L2 之後那個理由消失了(只剩一份 markup),但**結論不變** —— 本表整體維持零 client 邊界
//       (唯一 island 是勾選框),帶表單的控件仍不屬於這裡。
// 🔴 與 backlog #372 的 **OP-A13(退款態沖銷入口)無關**,只是撞字面。
// ── L3 片4:密度只在 DOM 面留一個掛勾,值全在 CSS ──────────────────────────
describe('L3 片4 — 密度掛勾(`data-den`)', () => {
  it('🔴 `data-den` 掛在 `.orders-grid` 上(CSS 的三檔選擇器認的就是它)', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} density='tight' orders={[order({ lines: [line('l1', 1, 12000)] })]} />,
    );
    const grid = container.querySelector('.orders-grid')!;

    expect(grid.getAttribute('data-den')).toBe('tight');
  });

  it('🔴 不傳 density 時倒向預設(寬鬆),不是變成沒有這個屬性', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const grid = container.querySelector('.orders-grid')!;

    // 🔴 期望值取自 `ORDER_DENSITY_DEFAULT` 常數本身,不在本檔重打 'loose'
    //    —— 重打一份的話,那顆常數改值時本格仍全綠。
    expect(grid.getAttribute('data-den')).toBe(ORDER_DENSITY_DEFAULT);
  });

  // 🔴🔴 **R 審 F1:本格的第一版把期望值 `['40px','32px','26px']` 重打在測試裡** ——
  //    那禁的是**當下那三個值**,不是「值不准有第二份」。有人把 CSS 改成 38/30/24,
  //    本格照樣全綠(它在禁已經不存在的值),而新值可以自由被複製進元件
  //    ⇒ **它唯一要防的事,改一次值就完全失效。**
  //    ⚠️ 諷刺的是 `:1344` 那格(兩格之前)就寫著這條規則的正面版
  //      「期望值取自常數本身、不在本檔重打」—— **同一個檔、相隔兩格、自己違反自己寫的規則。**
  //      本專案給這個形狀的名字是「知道規則不等於執行規則」。
  //    ⇒ 改成**從 `globals.css` 抽出當下的值**再去掃,值改了守門跟著改。
  it('🔴 CSS 三檔選擇器都在,而且密度值只住 globals.css(不得有第二份)', () => {
    // 🔴🔴 **剝掉 CSS 註解再掃 —— 表演出來才加的**(W1 2026-08-20):
    //    構造 = 把真的 `.orders-grid[data-den='std']` 改名,只在檔頭留一行
    //    `/* 舊版這個規則的選擇器是 .orders-grid[data-den='std'] */`
    //    ⇒ **本檔 99 條全綠。** 而那正是本格自己那句錯誤訊息在講的災難
    //    (「切過去不會有任何變化」)—— 選擇器沒了、密度切換靜靜失效,而沒有任何東西紅。
    //    🔴 **而這一格是【唯一守門】**:CSS 不進 typecheck、選擇器消失不會讓任何 import 壞掉
    //       ⇒ 與 `:1585` 那種「export 沒了整支測試會 import 失敗」的情況**不同,那種不必修**。
    //    ⚠️ 方向性:剝過頭 ⇒ 真規則消失 ⇒ **紅**;剝不夠 ⇒ 退回原狀。兩者都不產生假綠。
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    for (const den of ['std', 'tight']) {
      expect(css, `${den} 那檔的選擇器不在 ⇒ 切過去不會有任何變化`).toContain(
        `.orders-grid[data-den='${den}']`,
      );
    }

    // 從 CSS 抽出**當下**的三個列高值(不是重打)
    const rowHeights = [...css.matchAll(/--od-row-h:\s*([\d.]+px)/g)].map((m) => m[1]!);
    // 🔴 **這一步不可省**(R 逐字要求):regex 失效時 `rowHeights` 為空 ⇒ 下面的迴圈不跑 ⇒ 整格恆真
    //    = 用一個更隱蔽的假綠換掉原本那個。抽到的數量本身就是斷言對象。
    expect(rowHeights.length, '抽不到三個 --od-row-h ⇒ 本格失去判別力,不是 CSS 沒問題').toBe(3);
    expect(new Set(rowHeights).size, '三檔的列高值應互不相同').toBe(3);

    // 反面:**本片動到的元件檔**都不得出現那些值(掃描面不再只有一個檔)
    const scanned = ['orders-table.tsx', 'order-density-toggle.tsx'];
    for (const file of scanned) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      for (const px of rowHeights) {
        expect(src, `${file} 裡出現了 ${px} ⇒ 密度值變成兩份、會漂`).not.toContain(px);
      }
    }
  });
});

describe('A13 — 操作欄(`#486` 乙案起是 ⋯ 訂單操作入口,不再是「取消」兩個字)', () => {
  // 🔴 L2 起兩槽是**同一格裡的兩個 `<a>`**(#350c 拍板:桌機開面板、手機走整頁;
  //    收斂 markup 不得順手統一目的地)。⇒ 選擇器用 href 形狀認槽。
  // 🏁 **L3 片3:分流從元件的 `md:hidden`/`hidden md:inline` 換成 CSS 的 `a[data-nav]`**
  //    —— 理由是機制:顯隱與卡片化在 `globals.css` 的**同一條 `@container` 規則**裡,
  //    兩者不可能不一致(舊做法是兩處靠人保持一致,而失效是安靜的)。
  //    ⇒ 本區的 class 斷言換成 `data-nav` 屬性斷言。**守的東西沒變:兩槽各恰一顆、目的地各自不同。**
  //    ⚠️ **屬性在不在 ≠ 真的顯隱** —— 真實顯隱只有真瀏覽器量得到,交件的負向 hit test 才是那一面。
  // 🏁 **`#486` 乙案(2026-08-14):選取條件從「文字 === 取消」換成「操作欄裡的連結」。**
  //    🔴 **不是換成「文字 === ⋯」** —— 那只是把一個字面換成另一個字面,而且新字面
  //    (U+22EF)肉眼與 `…`(U+2026)幾乎一樣 ⇒ 打錯字時測試會**跟著錯到同一個地方**、照樣綠。
  //    改用「這一格裡的 `<a>`」之後,選取條件不再依賴任何文案;字面本身由下面兩格單獨釘
  //    (碼位 + aria-label),**壞掉的時候會紅在「字面錯了」而不是「找不到元素」**。
  const opsLinks = (c: HTMLElement) => [...c.querySelectorAll('td.col-ops a')] as HTMLElement[];
  const deskOps = (c: HTMLElement) =>
    opsLinks(c).find((a) => a.getAttribute('href')?.startsWith('/orders?')) ?? null;
  const cardOps = (c: HTMLElement) =>
    opsLinks(c).find((a) => a.getAttribute('href')?.startsWith('/orders/')) ?? null;

  it('🔴 每張訂單恰**一組**取消入口(3 品項單不會冒出三組)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );

    // 一組 = 桌機槽 1 個 + 手機槽 1 個 = 2 個 `<a>`;逐品項畫的話會變 6 個。
    expect(opsLinks(container).length, '操作入口畫成逐品項 ⇒ 一張三品項的單冒出三組 ⋯,員工不知道按哪個').toBe(2);
    // 有值的操作格只有一個(其餘兩列是空格)
    expect(
      [...container.querySelectorAll('td.col-ops')].filter((td) => td.childNodes.length > 0).length,
    ).toBe(1);
  });

  it('🔴🔴 桌機的取消連結必須在 `relative z-10` 容器內 —— 否則被整列的 stretched link 蓋住', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const cell = deskOps(container)!.closest('td')!;
    // 🔴 這一格是本片**最值錢**的驗收(主視窗逐字):沒有 z-10 時,點「取消」會被整列覆蓋層接走
    //    ⇒ 員工被帶進面板頂端(畫面**確實有反應**)⇒ 看起來像功能好了,肉眼驗抓不到。
    //    `classList.contains` 而非子字串比對:`z-100`/`md:z-10` 之類會被子字串放過。
    expect(cell.classList.contains('relative'), '取消格少了 relative ⇒ z-10 沒有定位脈絡、等於沒設').toBe(true);
    expect(cell.classList.contains('z-10'), '取消連結被整列 stretched link 蓋住 ⇒ 點下去進面板而不是取消').toBe(true);

    // 🔴🔴 **這一格【順帶】擋住了第二件事,而在 2026-08-16 之前沒有人知道**(`#520`):
    //
    //    `multi-check-filter.tsx:51` 的篩選下拉在開啟時會鋪一層
    //    `<div className='fixed inset-0 z-10'>` 全螢幕點擊攔截層(它的用途是「點外面關閉」)。
    //    **那層與這裡的 `z-10` 剛好同值** ⇒ 同一個 stacking context 下比 DOM 順序,
    //    而篩選列在表格【之前】⇒ **這格贏,攔截層打不到它。**
    //
    //    📏 **主視窗 2026-08-16 用 `elementFromPoint` 逐格量的**(下拉開著、第一列 14 格):
    //      被攔截層接走 **10 格**(下單日/料號/數量/單價/金額/客戶/狀態/發票…)
    //      免疫 **2 格** —— 就是勾選格與本格,**兩格都靠這個 `z-10`**
    //      另 2 格打到下拉面板自己(那是面板,不是攔截層)
    //
    // ⚠️ **所以「為了 stretched link 的理由」改動這個 `z-10`,會【靜默】讓篩選攔截層開始吃掉
    //    這顆連結的點擊** —— 而那條路徑本格【不涵蓋】(本格只驗 class,不驗與攔截層的相對關係)。
    // 🔴 動它之前先讀 `#520`。**兩個理由都要重新成立,不是只確認第一個。**
  });

  it('🔴🔴 手機那個連結也在同一個 `relative z-10` 格內(整列都是 stretched link)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    // 🔴 L2 起兩個 `<a>` 共用同一個 `<td>` ⇒ z-10 掛在**格**上、不是掛在連結上。
    //    收斂前手機那顆是掛在連結自己身上(它在卡片裡沒有對應的 td),這是換載體不是放寬。
    const cell = cardOps(container)!.closest('td')!;
    expect(cell.classList.contains('relative')).toBe(true);
    expect(cell.classList.contains('z-10')).toBe(true);
  });

  it('🔴 手機槽也要有取消入口(2b-1 教訓:只改桌機、桌機測試全綠而手機沒得按)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const link = cardOps(container);
    expect(link, 'Sean 常用手機看後台;只做桌機等於這片對他不存在').not.toBeNull();
    // 🔴 兩槽靠 `data-nav` 分流 —— 少了它 CSS 選不到,兩顆「取消」會**同時**出現。
    expect(link!.getAttribute('data-nav'), "手機槽少了 data-nav='page' ⇒ CSS 選不到它").toBe('page');
    expect(deskOps(container)!.getAttribute('data-nav'), "桌機槽少了 data-nav='panel'").toBe('panel');
  });

  // 🔴🔴 **R 審 F1(片3):`data-nav` 有兩對,原本只釘了取消那對。**
  //    失敗情境:拿掉**單號**那顆的 `data-nav='panel'` ⇒ 桌機看起來正常(基底只藏 `page`),
  //    但**卡片模式下它不再被藏** ⇒ 同一張卡上兩顆 stretched link 重疊,其中一顆去手機不該去的面板,
  //    而**零測試會紅** —— 正是 `orders-table.tsx:197-198` 自己寫的「而且沒有東西會叫」。
  //    ⚠️ 這條與上面取消那對是**同一個守門的兩半**,擺在一起才看得出「兩對都要有」。
  it("🔴 單號那對也要有 data-nav(兩對都掛才防得住錯配;R 審 F1)", () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const oidLinks = [...container.querySelectorAll('td.col-oid a')];

    // 前提:這一格真的有兩顆(不然下面兩條會在空集合上恆真)
    expect(oidLinks.length, '單號格應恰有兩顆連結(桌機面板 + 手機整頁)').toBe(2);
    expect(
      oidLinks.map((a) => a.getAttribute('data-nav')),
      "單號那對少了 data-nav ⇒ CSS 選不到 ⇒ 卡片上兩顆 stretched link 會重疊",
    ).toEqual(['panel', 'page']);
    // 目的地與 data-nav 必須對得上(標對了但接錯 href,屬性斷言本身看不出來)
    expect(oidLinks[0]!.getAttribute('href')).toBe('/orders?panel=ord-1');
    expect(oidLinks[1]!.getAttribute('href')).toBe('/orders/ord-1');
  });

  it('🔴 兩槽的目的地各自沿用同槽的單號連結:桌機走注入的面板 href、手機走整頁路徑', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    // 🔴 **不要為了「一致性」把兩槽統一**(主視窗逐字):兩槽本來就不同去處,那是 #350c 的動線決定。
    expect(deskOps(container)!.getAttribute('href')).toBe('/orders?panel=ord-1#cancel');
    expect(cardOps(container)!.getAttribute('href')).toBe('/orders/ord-1#cancel');
  });

  it('🔴 錨點字面是 `#cancel`,對得上 `order-cancel-block.tsx` 的 id(跨檔契約)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const raw = await readFile(join(__dirname, 'order-cancel-block.tsx'), 'utf8');
    // 🔴 **先剝註解再找**(突變實測當場抓到的):那個檔的註解裡就寫著 `id='cancel'` 在解釋這條契約
    //    ⇒ 不剝的話,把**真正的屬性**改名而註解沒跟著改,這一格照樣綠 —— 守門被自己的說明文字餵飽。
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // 前提:剝完之後元件本體還在(讀錯檔 / 剝過頭 ⇒ 下面會恆假,寧可紅也不要恆綠)。
    expect(code, '剝完註解連元件都不見了 ⇒ 這格在量錯東西').toContain('OrderCancelBlock');
    // 連結指的錨點被改名/拿掉 ⇒ 連結全部落空,而畫面「有反應」(跳到頁頂)最難察覺。
    expect(code, '`order-cancel-block.tsx` 的 id=cancel 不見了 ⇒ 列表那些 #cancel 連結全部落空').toContain(
      "id='cancel'",
    );
  });

  it('🔴 已取消的單:兩槽都不出現取消入口(桌機顯示「—」)', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], cancelledAt: '2026-08-06T03:00:00.000Z' })]} />,
    );
    expect(deskOps(container), '已取消的單還給取消入口 ⇒ 員工按進去只會看到一個不能用的表單').toBeNull();
    expect(cardOps(container)).toBeNull();
    // 🔴 codex R1 must-fix:只驗「沒有連結」擋不住「把那格連『—』一起刪掉」——
    //    那樣該欄變空白格,員工看到的是一欄莫名其妙的空,而上面兩條照樣綠。
    //    ⇒ L2 起直接用 `col-ops` 定位(收斂前是「rowSpan 的最後一格」,rowSpan 已拆)。
    expect(
      container.querySelector('td.col-ops')!.textContent,
      '已取消的單:操作欄要明確顯示「—」,不是留一個空格子',
    ).toBe('—');
  });

  it('前提 — 沒取消的單這兩個入口是真的存在(不然上一格恆綠)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    expect(deskOps(container)).not.toBeNull();
    expect(cardOps(container)).not.toBeNull();
  });

  // 🔴 **`#486` 乙案:字面用碼位釘,不用肉眼**。`⋯`(U+22EF)與 `…`(U+2026)在編輯器裡
  //    幾乎一樣,而 OD `overview-desktop.html:985` 用的是前者。打錯字的症狀是「看起來對」——
  //    這正是「錯的那次和對的那次長得一樣」,所以這一格比對的是 `codePointAt`,不是字串長相。
  it('🔴 ⋯ 是 U+22EF(不是 U+2026、不是三個句點)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    // 🔴 **零也要停**:`for...of` 對空陣列不跑一次迴圈 ⇒ 選取條件哪天失效,這一格會**恆綠**。
    expect(opsLinks(container), '一顆都沒抓到 ⇒ 下面的迴圈跑 0 次、這格會假通過').toHaveLength(2);
    for (const a of opsLinks(container)) {
      const text = a.textContent ?? '';
      expect([...text], `操作欄連結的字面是 ${JSON.stringify(text)},應該恰好一個字元`).toHaveLength(1);
      expect(text.codePointAt(0)?.toString(16), '碼位不是 22ef ⇒ 抄成了另一顆長得像的省略號').toBe('22ef');
    }
  });

  // 🔴 **無障礙不是可選**:`⋯` 對螢幕閱讀器念不出意思,對第一次看到的員工也一樣
  //    (Sean 的「操作直覺化」常設準則:不用人教能不能做對)。
  //    ⚠️ 兩槽都要有 —— 只給桌機那顆會讓手機使用者拿到一顆沒有名字的按鈕,而測試若只驗一顆就看不到。
  it('🔴 兩槽都有 aria-label 與 title(⋯ 自己不帶語意)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const links = opsLinks(container);
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('aria-label'), '⋯ 沒有 aria-label ⇒ 螢幕閱讀器只會念出一個符號').toBe('訂單操作');
    }
    // 🔴 **`title` 只在桌機那槽,而且這個不對稱是刻意的**(R1 F12):
    //    觸控裝置沒有 hover ⇒ tooltip 永遠不顯示;兩個屬性同值還會讓部分 SR 念兩次。
    expect(deskOps(container)!.getAttribute('title'), '桌機槽沒有 title ⇒ 滑鼠使用者沒有任何線索').toBe('訂單操作');
    expect(cardOps(container)!.getAttribute('title'), '手機槽給了 title ⇒ 永遠不顯示、還多念一次').toBeNull();
  });

  // 🔴 **目的地沒有跟著改**(本片只換外觀與入口語意):仍然是 `#cancel`。
  //    這一格的價值在於**它會在「有人把錨點改掉」時紅** —— 退款/沖銷進來時那是刻意的改動,
  //    但那一刻要有人重新想「⋯ 該落在哪裡」,而不是靜靜地改掉。
  it('目的地仍是 #cancel(退款/沖銷進來時要改的就是這裡)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    expect(deskOps(container)!.getAttribute('href')).toBe('/orders?panel=ord-1#cancel');
    expect(cardOps(container)!.getAttribute('href')).toBe('/orders/ord-1#cancel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 品項清單不完整 ⇒ 狀態欄改印「未知」(2026-08-16,Q-EMBED-2 Sean 拍甲)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴🔴 **為什麼是「未知」而不是「照算」**:`goodsAxisOfLines` 三條判定都是 `.every(...)`,
//    而 `.every()` 對子集**單調**(全集為真 ⇒ 子集必真,反之不然)
//    ⇒ **子集算出來的階段恆 ≥ 真實階段** ⇒ 看得見的全出貨了就答「出貨完成」。
//    ⇒ **員工看到「出貨完成」就不再動作** —— 他做對了,但結果是錯的。
describe('itemsTruncated ⇒ 狀態欄印「未知」', () => {
  /**
   * 🔴 **fixture 要選【沒有截斷時會算出一個明確狀態】的那組** ——
   *    否則「不印那個狀態」這件事測不出來(那個狀態本來就不會出現)。
   *    這裡用兩件全出貨 ⇒ 沒截斷時軸 = shipped、已付款 ⇒ 標籤是「出貨完成」,
   *    **正是最危險的那個答案**。
   */
  // 🔴 **helper 用檔內既有的 `lineAt(id, quantity, stage)`,不自己拼一個** ——
  //    我第一版憑印象寫了一個不存在的 `line({quantity, ordered, instock, shipped})` 形狀,
  //    當場炸在 `MoneyAmount must be integer, got NaN`。
  //    ⇒ **要餵進量具的東西一律從檔裡讀出來**(本輪第三次同一個教訓)。
  const shippedLines = [lineAt('l1', 2, 'shipped')];

  it('🔴 itemsTruncated=true ⇒ 印「未知」,不印算出來的狀態', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: shippedLines, itemsTruncated: true })]} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('未知');
    // 🔴 反向:那個「算得出來但可能是錯的」狀態一個字都不准出現。
    expect(text).not.toContain('出貨完成');
  });

  /**
   * 🔴 **正向對照** —— 同一組 lines、只把旗標關掉,「出貨完成」就該回來。
   * 沒有這一格,上面那條 `not.toContain('出貨完成')` 可能只是因為那個字本來就不會出現。
   */
  it('正向對照:itemsTruncated=false ⇒ 「出貨完成」照常印出來', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: shippedLines, itemsTruncated: false })]} />,
    );
    expect(container.textContent ?? '').toContain('出貨完成');
  });

  /**
   * 🔴🔴 **驗收 12**(`plan §7#12`;2026-08-18 A 窗補)——
   * **上面兩格斷言的是 `textContent`,而「未知」旁邊那個 `title` 是【零斷言】的。**
   *
   * 🔴 **為什麼這一格非有不可**:「未知」兩個字自己**不解釋任何事** ——
   *    員工看到它會問「為什麼不知道」,而答案只長在 `title` 裡
   *    (`orders-table.tsx:429` 逐字)。**那句話被刪掉、被改壞,上面兩格照樣全綠。**
   *
   * 🔴 **實作與這一格的時間差(寫下來,免得被讀成「一直都有」)**:
   *    片 A-1 本體 `5e46360e`(08-17 14:44)已進 dev;驗收 12 是 `b174532f`(21:36)
   *    才補進 plan 的 —— **實作之後 7 小時**。補進來當天實測
   *    `grep -rn "算不出狀態" --include='*.test.tsx' | wc -l` ⇒ **0**。**這一格就是在補那個 0。**
   */
  const TRUNCATED_TITLE = '這張單的品項達到 500 筆上限,系統一次載不完。這是系統的固定限制,不是暫時的狀況。這一格現在看不出這張單實際走到哪一步,請不要用它判斷這張單的進度。請聯絡負責人處理。';

  it('🔴🔴 驗收12a(2026-08-18 `#639 甲` 反轉):那顆膠囊【不得】再帶那句 title', () => {
    // 🔴 **這一格原本斷言的是「title 存在,且逐字等於那句話」——它把病寫成了規格。**
    //    `#639` 立案的正是「說明掛在 `title` 上」這個載體;Sean 2026-08-18 拍 `#639 甲`
    //    ⇒ 三處一起換載體(顧客站兩處印在畫面上,這裡把理由讓給下面那一列)。
    //    ⇒ 期望值整個反過來:**存在 ⇒ 紅**。
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: shippedLines, itemsTruncated: true })]} />,
    );
    const capsule = [...container.querySelectorAll('span')].find((el) => el.textContent === '未知');
    expect(capsule, '截斷時仍要印「未知」——這一格不是把膠囊拿掉').toBeDefined();
    expect(capsule?.getAttribute('title'), '說明不得再掛回 title').toBeNull();
    // 整棵樹都不准出現那句話的 title 版本(有人搬到別的節點上一樣算)
    const titles = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    expect(titles).not.toContain(TRUNCATED_TITLE);
  });

  it('🔴🔴 理由沒有消失:原本 title 裡那【三件事】都要出現在畫面文字上', () => {
    // 🔴 **這一格原本只驗「數量未知」,codex 判 must-fix:那時完整理由已經被我刪掉,而它照樣綠。**
    //    「拿掉 title」與「把說明搬到看得見的地方」是兩件事,只做前者 = 資訊刪減。
    //    ⇒ 期望值改成逐條驗那三件,任一件被拿掉就紅。
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: shippedLines, itemsTruncated: true })]} />,
    );
    const note = [...container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('另有'),
    );
    expect(note, '截斷時那一列必須在').toBeDefined();
    const text = note?.textContent ?? '';
    expect(text, '① 這是固定限制、不會自己好').toContain('固定限制');
    expect(text, '② 狀態那一格不能拿來判斷進度').toContain('不能拿來判斷');
    expect(text, '③ 下一步:找誰').toContain('負責人');
  });

  it('正向對照:非截斷時那三件【不出現】(⇒ 上一格不是恆真)', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: shippedLines, itemsTruncated: false })]} />,
    );
    for (const s of ['固定限制', '不能拿來判斷', '負責人']) {
      expect(container.textContent, `非截斷時不該出現「${s}」`).not.toContain(s);
    }
  });

  /**
   * 🔴 **負向對照** —— 沒有這一格,12a 可以靠「每顆膠囊都掛同一句 title」通過,
   * 那時它量到的不是「截斷態有解釋」,而是「這個元件到處都有 title」。
   */
  /**
   * 🔴🔴 **codex must-fix `§7:268`(2026-08-18 A 窗收)——「第二個算答案的地方」**
   *
   * 原 plan `§7` 掃出 `shouldMergeAmount` 是截斷態下**第二個由半份資料決定語意**的分支,
   * 卻以「**今天構造不出來**」豁免。**codex 判 must-fix:fixture 明明構造得出來。**
   * 而它說得對 —— **下面這兩格就是那個 fixture,寫出來只花了幾行。**
   *
   * 🔴 **這一組守的不是「今天會壞」,是「那個安全條件從來沒被寫下來」**:
   * 舊式 `lines.length > 1 || some(q>1)` 今天安全,**純粹因為截斷恆發生在 500**
   * ⇒ 截斷時 `lines.length` 恆為 500 ⇒ 恆真。`mappers/order.ts:425-426` 的註解自己留了口子:
   * 「若專案 `max-rows` 日後被設到低於本值…**本判定看不見**」。
   *
   * ⚠️ **不要把這組讀成「修了一個 bug」** —— 今天的實際影響面是零。
   *    它讓一條隱形的依賴變成一格會叫的守門。**性質 = 套用既有拍板 `Q-EMBED-2`,不是新規格。**
   */
  describe('🔴 截斷 + 只剩一列 quantity=1 ⇒ 金額欄仍走【訂單層】語意', () => {
    /**
     * 🔴🔴 **`5,000` 這個值是承重的,不要改成 12,000**(2026-08-18 codex 對抗審查 #3 抓到)。
     *
     * 我第一版用 `lineAt('l1', 1, 'shipped')` ⇒ 它的 `lineTotal` 是 **12,000**,
     * 而 fixture 的 `order.total` **也是 12,000** ⇒ **「印的是 order.total」那條斷言零判別力**:
     * 把截斷分支改成仍印 `lineTotal`,那格**照樣全綠**。
     * 🔴 **最刺的是**:我自己在別處的註解寫過「兩值都是 12,000 ⇒ 零判別力」這個坑,
     *    然後在同一支檔裡**又踩了一次**。⇒ 知道規則不等於執行規則。
     */
    const singleUnitLine = [line('l1', 1, 5000)];

    it('截斷時:印 order.total(訂單的錢),data-l 是「金額」', () => {
      const { container } = render(
        <OrdersTable
          buildPanelHref={panelHref}
          orders={[order({ lines: singleUnitLine, itemsTruncated: true })]}
        />,
      );
      const cell = container.querySelector('td.col-amount')!;
      // 🔴 兩條缺一不可,而且**兩條守的是不同的東西**:
      //    `data-l` 守語意標籤(手機卡片上沒有表頭,它是唯一的差別)
      //    金額數字守**印的是哪一個值** —— 12,000 = order.total、5,000 = 這一列的 lineTotal
      expect(cell.getAttribute('data-l')).toBe('金額');
      expect(cell.textContent).toContain('NT$ 12,000');
      // 🔴 反向:那個「由半份資料算出來的」品項小計一個字都不准出現。
      //    沒有這條,把分支改成印 lineTotal 而標籤照舊,上面兩條仍全綠(codex #3 原話)。
      expect(cell.textContent).not.toContain('NT$ 5,000');
    });

    /**
     * 🔴 **負向對照** —— 同一組 lines、只把旗標關掉,就該回到品項層語意。
     * 沒有這格,上面那條可能只是因為「這個 fixture 本來就走合併態」而通過。
     */
    it('負向對照:非截斷時同一組 lines ⇒ 回到品項層,data-l 是「小計」', () => {
      const { container } = render(
        <OrdersTable
          buildPanelHref={panelHref}
          orders={[order({ lines: singleUnitLine, itemsTruncated: false })]}
        />,
      );
      expect(container.querySelector('td.col-amount')!.getAttribute('data-l')).toBe('小計');
    });
  });

  it('正向對照:非截斷時那顆狀態膠囊也不帶那句 title(⇒ 上面那格不是靠「反正沒有 title」恆真)', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: shippedLines, itemsTruncated: false })]} />,
    );
    const capsule = [...container.querySelectorAll('span')].find((el) => el.textContent === '出貨完成');
    expect(capsule).toBeDefined();
    expect(capsule?.getAttribute('title')).not.toBe(TRUNCATED_TITLE);
  });
});

/**
 * `#631` 甲(Sean 2026-08-18 拍板):列表每張單最多畫前 3 個品項 + 一列「另有 …,點進去看」。
 *
 * 🔴🔴 **這一組存在的第一個理由是【本檔原本構造不出 3 列以上的單】** ——
 *    落地那天實測:整份測試檔 `lines: [ … ]` 出現 45 次,**單筆訂單最多 3 個 `line(...)`**
 *    (量法:對測試檔跑「抓每個 `lines: [...]` 區塊、數裡面 `line('` 的次數」,取最大值 ⇒ **3**)。
 *    ⇒ **把渲染改成「只畫前 3 列」的那一刻,既有 89 格【一格都不會紅】** ——
 *      不是因為改對了,是因為**沒有任何 fixture 走到第 4 列**。
 *    ⇒ 這正是 `feedback_fixture-value-makes-guard-vacuous` 那一族:**fixture 造不出反例時,斷言是恆真的。**
 *
 * ⚠️ **`MAX_VISIBLE_LINES = 3` 這個值本身不是版面算出來的**,是 Sean 挑的
 *    ⇒ 本組刻意**不重抄那個 3**,改用「4 個品項 ⇒ 看得到 3 列」這種**行為**斷言:
 *    有人把常數改成 5,這裡會紅(而它**應該**紅 —— 那是要再問他一次的改動)。
 */
describe('#631 甲 — 列表每張單最多畫 3 個品項,其餘收成一列連結', () => {
  const fourLines = [line('l1', 1, 1000), line('l2', 1, 1000), line('l3', 1, 1000), line('l4', 1, 1000)];

  /** 只數「品項列」:含 `col-sku` 那格的 `<tr>`(那一列一定有料號欄)。收摺列沒有它。 */
  const itemRowCount = (container: HTMLElement) =>
    [...container.querySelectorAll('tbody.orders-group tr')].filter(
      (tr) => tr.querySelector('td.col-sku') !== null,
    ).length;

  const moreRow = (container: HTMLElement) =>
    [...container.querySelectorAll('tbody.orders-group tr')].find(
      (tr) => tr.querySelector('td.col-sku') === null,
    ) ?? null;

  it('🔴 四個品項 ⇒ 只畫 3 列品項,而且多出一列「另有 1 項」', () => {
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines: fourLines, total: { amount: toMoneyAmount(4000), currency: 'TWD' } })]}
      />,
    );
    expect(itemRowCount(container), '品項列數不是 3 ⇒ 收摺沒生效或收錯列').toBe(3);
    const more = moreRow(container);
    expect(more, '沒有「另有 …」那一列 ⇒ 被收起來的品項在畫面上完全沒有痕跡').not.toBeNull();
    expect(more!.textContent).toContain('另有 1 項');
    expect(more!.textContent).toContain('點進去看');
  });

  it('🔴 邊界:恰好 3 個品項 ⇒ **不得**冒出「另有 0 項」那一列', () => {
    // 這格擋的是 `hiddenCount >= 0` 這種寫法 —— 它在 3 列時會印「另有 0 項」,
    // 而「另有 0 項」讀起來像「還有東西」,比不印更糟。
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[
          order({
            lines: [line('l1', 1, 1000), line('l2', 1, 1000), line('l3', 1, 1000)],
            total: { amount: toMoneyAmount(3000), currency: 'TWD' },
          }),
        ]}
      />,
    );
    expect(itemRowCount(container)).toBe(3);
    expect(moreRow(container), '3 個品項卻多出一列 ⇒ 邊界寫成了 >= 0').toBeNull();
  });

  it('🔴🔴 截斷態 ⇒ 那一列**一個數字都不准出現**(不是「數字會差一點」,是那個數字不存在)', () => {
    // `itemsTruncated` 時 `order.lines` 本身就是半份的 ⇒ `rows.length - 3` 算的是
    // 「載進來的那半還剩幾項」,而畫面那句話講的是「這張單還有幾項」。
    // 501 項的單會印「另有 497 項」而真值是 498 —— 而它讀起來完全正常。
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[
          order({
            lines: fourLines,
            itemsTruncated: true,
            total: { amount: toMoneyAmount(4000), currency: 'TWD' },
          }),
        ]}
      />,
    );
    const more = moreRow(container);
    expect(more, '截斷態連那一列都沒有 ⇒ 被截掉的品項零痕跡').not.toBeNull();
    expect(more!.textContent).toContain('另有多項');
    expect(
      /\d/.test(more!.textContent ?? ''),
      `截斷態印出了數字,而那個數字是算出來的假值。實際印的是:${more!.textContent}`,
    ).toBe(false);
    // 正向對照:非截斷態的同一個 fixture **必須**印得出數字,否則上一條的 `false` 是恆真的。
    const { container: c2 } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines: fourLines, total: { amount: toMoneyAmount(4000), currency: 'TWD' } })]}
      />,
    );
    expect(
      /\d/.test(moreRow(c2)!.textContent ?? ''),
      '非截斷態也印不出數字 ⇒ 上一條的「沒有數字」證明不了任何事',
    ).toBe(true);
  });

  it('🔴 那一列要真的點得進去:雙目的地連結 + `data-l`(手機卡片的欄名)', () => {
    // stretched link 只鋪在第一列 ⇒ 這一列若只有文字,Sean 那句「點進去看」是做不到的。
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines: fourLines, total: { amount: toMoneyAmount(4000), currency: 'TWD' } })]}
      />,
    );
    const more = moreRow(container)!;
    const panel = more.querySelector("a[data-nav='panel']");
    const page = more.querySelector("a[data-nav='page']");
    expect(panel, '沒有桌機面板連結 ⇒ 桌機點不進去').not.toBeNull();
    expect(page, '沒有手機整頁連結 ⇒ 手機點不進去(卡片模式走整頁)').not.toBeNull();
    expect(panel!.getAttribute('href')).toBe(panelHref('ord-1'));
    expect(page!.getAttribute('href')).toBe('/orders/ord-1');
    expect(
      more.querySelector('td')!.getAttribute('data-l'),
      '沒有 data-l ⇒ 手機卡片上這一列是個沒有欄名的孤兒',
    ).not.toBeNull();
  });
});

// ── V-07 補三格(2026-08-18 收斂:`#631 甲` 與 `07=甲` 是同一個拍板派給兩個窗,
//    實作以 dev 那版為基準。這三格是 G2 那版有、而上面那組沒有的判別力,只留判別力、不留重複)──
describe('V-07 補 — 收合不得碰到算式;欄數推法不得漂', () => {
  const nLines = (n: number) => Array.from({ length: n }, (_, i) => line(`v${i + 1}`, 1, 1000));

  it('🔴🔴 收合【不影響狀態判定】:前 3 列全出貨、第 4 列沒出貨 ⇒ 狀態**不得**是「出貨完成」', () => {
    // 🔴 這一格才有判別力:`orderStatusView` 走 `.every(...)`,把切過的 3 列餵給它
    //    ⇒ 「子集全出貨就答出貨完成」——**員工看到出貨完成就不再動作,他做對了但結果是錯的**
    //    (`mappers/order.ts` 那段註解逐字寫的就是這個病)。
    //    突變複跑驗過:把 `order.lines.slice(0, MAX_VISIBLE_LINES)` 餵給 `orderStatusView`
    //    ⇒ 全檔唯一紅的就是這一格。
    const mixed = [
      lineAt('s1', 1, 'shipped'),
      lineAt('s2', 1, 'shipped'),
      lineAt('s3', 1, 'shipped'),
      lineAt('s4', 1, 'none'),
    ];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: mixed })]} />,
    );
    const statusCell = container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[STATUS_CELL_INDEX]!;
    expect(statusCell.textContent).not.toBe('出貨完成');
  });

  it('正向對照:四列**全部**出貨 ⇒ 狀態就是「出貨完成」(⇒ 上一格不是恆真)', () => {
    const allShipped = [1, 2, 3, 4].map((n) => lineAt(`a${n}`, 1, 'shipped'));
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: allShipped })]} />,
    );
    const statusCell = container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[STATUS_CELL_INDEX]!;
    expect(statusCell.textContent).toBe('出貨完成');
  });

  it('表頭沒有任何 <th> 用 colSpan —— 否則「`CELL` 鍵數 = 欄數」那個推法會靜默算錯', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: nLines(4) })]} />,
    );
    const spans = [...container.querySelectorAll('thead th')].map(
      (th) => (th as HTMLTableCellElement).colSpan,
    );
    expect(spans.every((n) => n === 1)).toBe(true);
  });

  it('🔴 截斷態那一列的字面帶「數量未知」 —— 「另有多項」讀起來像「我知道只是懶得講」', () => {
    const { container } = render(
      <OrdersTable
        buildPanelHref={panelHref}
        orders={[order({ lines: nLines(10), itemsTruncated: true })]}
      />,
    );
    const note = [...container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('另有'),
    )!;
    expect(note.textContent).toContain('數量未知');
    // 說明【不得】掛在 `title` 上 —— `#639` 立案的就是這個載體(手機一段都拿不到)
    expect(note.querySelector('[title]')).toBeNull();
  });
});
