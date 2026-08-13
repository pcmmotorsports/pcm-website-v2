// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// 🔴 真的 CSS parser,**不是新增依賴**:`postcss` 已是 `apps/admin` 的直接 devDependency
//    (`apps/admin/package.json` 的 `"postcss": "8.5.14"`)。理由見下方卡片化守門那段。
import postcss from 'postcss';
import { cleanup, render as rtlRender } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import { ShippingSelectionProvider } from './shipping-selection';

/**
 * 🔴 **2b-1 起 `OrdersTable` 必須包在 `<ShippingSelectionProvider>` 內。**
 * 那顆勾選 island 在缺 provider 時會**明確丟錯**(刻意的:靜默降級的話「勾不動」與
 * 「這張單不能勾」長得一模一樣、沒有人會發現)。本檔所有 render 統一走這個包裝,
 * 不逐處手包 —— 漏包一處就是整個檔紅一片,不會只紅那一條。
 */
const render = (ui: React.ReactElement) =>
  rtlRender(<ShippingSelectionProvider>{ui}</ShippingSelectionProvider>);

import { OrdersTable } from './orders-table';

// #350c:桌機單號連結改由呼叫端注入(`/orders?…&panel=<id>`)。這裡給一個最小假 builder ——
// 本檔既有的斷言都不看單號連結的 href;真正釘住「桌機走注入 href / 手機仍是字面路徑」的是
// `order-panel-wiring.test.ts`(那支才有判別力,本行只是讓既有這些格子能繼續 render)。
const panelHref = (orderId: string) => `/orders?panel=${orderId}`;

import {
  PAYMENT_STATUS_LABEL,
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
};

function order(overrides: OrderOverrides): AdminOrderSummary {
  return {
    id: 'ord-1',
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
      expect(container.textContent).not.toContain(PAYMENT_STATUS_LABEL[status]);
      // 單號格內剩下的 `<span>` 只可能是「已取消」badge,本 fixture 沒取消 ⇒ 應為 0。
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
function lineAt(id: string, quantity: number, stage: 'none' | 'ordered' | 'instock' | 'shipped'): AdminOrderLine {
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
      (['none', 'ordered', 'instock', 'shipped'] as const).map((goods) => ORDER_STATUS_LABEL[pay][goods]),
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

    expect(riskCls).toContain('text-white');
    expect(riskCls).not.toContain('bg-emerald-100');
    expect(safeCls).toContain('bg-emerald-100');
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

    expect(cls('unpaid')).toContain('shadow-[');
    expect(cls('paid')).not.toContain('shadow-[');
    // 兩者的底色相同 ⇒ 證明差別真的只在紅框那一項,不是整個換了配色。
    expect(cls('unpaid')).toContain('bg-sky-100');
    expect(cls('paid')).toContain('bg-sky-100');
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
      (['none', 'ordered', 'instock', 'shipped'] as const).map((g) => ORDER_STATUS_LABEL[p][g]),
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
      expect(after, '熱區的 inset 不見了 ⇒ 取消鈕縮回 24×16,低於 WCAG 2.2 的 44×44').not.toBeNull();
      // 24×16 + 左右各 12 + 上下各 14 = 48×44
      expect(after!.value).toBe('-14px -12px');
      expect(after!.insideCard, '熱區規則落在 media 外 ⇒ 桌機也會擴,會吃掉同列其他欄').toBe(true);

      const pos = lastDecl('.orders-grid .col-ops a::after', 'position');
      expect(pos?.value, '熱區不是 absolute ⇒ 它會參與版面計算、把卡片撐高(正是要避免的那件事)').toBe(
        'absolute',
      );
    });

    it('🔴 CSS 掛勾與 TSX 的 `col-*` 名字對得上(對不上 = 卡片內順序亂掉,零錯誤訊息)', () => {
      const inCard = new Set<string>();
      // 🔴 大括號不可省:`Set.add` 回傳 Set,而 `walkRules` 的 callback 回傳 `false` 代表**中止走訪**
      //    ⇒ 寫成單運算式會讓型別對不上(tsc 實際擋下來),而且語意上是在回傳一個「不是 false 的值」。
      cardMedias()[0]!.walkRules((r) => {
        inCard.add(norm(r.selector));
      });
      for (const col of [
        'col-pick',
        'col-oid',
        'col-date',
        'col-brand',
        'col-sku',
        'col-title',
        'col-vehicle',
        'col-qty',
        'col-unit',
        'col-amount',
        'col-customer',
        'col-status',
        'col-invoice',
        'col-ops',
      ]) {
        expect(
          [...inCard].some((s) => s.includes(`.${col}`)),
          `${col} 在卡片化 media 內沒有落點 ⇒ 它在卡片上的縱向位置沒有被定義`,
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

  // 🔴 正負成對 —— 只有 `not.toContain` 那半邊的話,把 badge 整段刪掉照樣綠(恆真)。
  it('已取消單:單號格帶「已取消」標記', () => {
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)], cancelledAt: '2026-08-06T03:00:00.000Z' })]} />,
    );
    expect(container.querySelector('td.col-oid')!.textContent).toContain('已取消');
  });

  it('未取消單:**不得**出現「已取消」(上一格的負向對照)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    expect(container.textContent).not.toContain('已取消');
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

    expect(capsuleCls('unpaid')).toContain('shadow-[');
    expect(capsuleCls('paid')).not.toContain('shadow-[');
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
describe('A13 — 操作欄(取消入口)', () => {
  // 🔴 L2 起兩槽是**同一格裡的兩個 `<a>`**(#350c 拍板:桌機開面板、手機走整頁;
  //    收斂 markup 不得順手統一目的地)。⇒ 選擇器用 href 形狀認槽。
  // 🏁 **L3 片3:分流從元件的 `md:hidden`/`hidden md:inline` 換成 CSS 的 `a[data-nav]`**
  //    —— 理由是機制:顯隱與卡片化在 `globals.css` 的**同一條 `@container` 規則**裡,
  //    兩者不可能不一致(舊做法是兩處靠人保持一致,而失效是安靜的)。
  //    ⇒ 本區的 class 斷言換成 `data-nav` 屬性斷言。**守的東西沒變:兩槽各恰一顆、目的地各自不同。**
  //    ⚠️ **屬性在不在 ≠ 真的顯隱** —— 真實顯隱只有真瀏覽器量得到,交件的負向 hit test 才是那一面。
  const cancels = (c: HTMLElement) =>
    [...c.querySelectorAll('a')].filter((a) => a.textContent === '取消');
  const deskCancel = (c: HTMLElement) =>
    cancels(c).find((a) => a.getAttribute('href')?.startsWith('/orders?')) ?? null;
  const cardCancel = (c: HTMLElement) =>
    cancels(c).find((a) => a.getAttribute('href')?.startsWith('/orders/')) ?? null;

  it('🔴 每張訂單恰**一組**取消入口(3 品項單不會冒出三組)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable buildPanelHref={panelHref} orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );

    // 一組 = 桌機槽 1 個 + 手機槽 1 個 = 2 個 `<a>`;逐品項畫的話會變 6 個。
    expect(cancels(container).length, '取消入口畫成逐品項 ⇒ 一張三品項的單三組「取消」,員工不知道按哪個').toBe(2);
    // 有值的操作格只有一個(其餘兩列是空格)
    expect(
      [...container.querySelectorAll('td.col-ops')].filter((td) => td.childNodes.length > 0).length,
    ).toBe(1);
  });

  it('🔴🔴 桌機的取消連結必須在 `relative z-10` 容器內 —— 否則被整列的 stretched link 蓋住', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const cell = deskCancel(container)!.closest('td')!;
    // 🔴 這一格是本片**最值錢**的驗收(主視窗逐字):沒有 z-10 時,點「取消」會被整列覆蓋層接走
    //    ⇒ 員工被帶進面板頂端(畫面**確實有反應**)⇒ 看起來像功能好了,肉眼驗抓不到。
    //    `classList.contains` 而非子字串比對:`z-100`/`md:z-10` 之類會被子字串放過。
    expect(cell.classList.contains('relative'), '取消格少了 relative ⇒ z-10 沒有定位脈絡、等於沒設').toBe(true);
    expect(cell.classList.contains('z-10'), '取消連結被整列 stretched link 蓋住 ⇒ 點下去進面板而不是取消').toBe(true);
  });

  it('🔴🔴 手機那個連結也在同一個 `relative z-10` 格內(整列都是 stretched link)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    // 🔴 L2 起兩個 `<a>` 共用同一個 `<td>` ⇒ z-10 掛在**格**上、不是掛在連結上。
    //    收斂前手機那顆是掛在連結自己身上(它在卡片裡沒有對應的 td),這是換載體不是放寬。
    const cell = cardCancel(container)!.closest('td')!;
    expect(cell.classList.contains('relative')).toBe(true);
    expect(cell.classList.contains('z-10')).toBe(true);
  });

  it('🔴 手機槽也要有取消入口(2b-1 教訓:只改桌機、桌機測試全綠而手機沒得按)', () => {
    const { container } = render(<OrdersTable buildPanelHref={panelHref} orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const link = cardCancel(container);
    expect(link, 'Sean 常用手機看後台;只做桌機等於這片對他不存在').not.toBeNull();
    // 🔴 兩槽靠 `data-nav` 分流 —— 少了它 CSS 選不到,兩顆「取消」會**同時**出現。
    expect(link!.getAttribute('data-nav'), "手機槽少了 data-nav='page' ⇒ CSS 選不到它").toBe('page');
    expect(deskCancel(container)!.getAttribute('data-nav'), "桌機槽少了 data-nav='panel'").toBe('panel');
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
    expect(deskCancel(container)!.getAttribute('href')).toBe('/orders?panel=ord-1#cancel');
    expect(cardCancel(container)!.getAttribute('href')).toBe('/orders/ord-1#cancel');
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
    expect(deskCancel(container), '已取消的單還給取消入口 ⇒ 員工按進去只會看到一個不能用的表單').toBeNull();
    expect(cardCancel(container)).toBeNull();
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
    expect(deskCancel(container)).not.toBeNull();
    expect(cardCancel(container)).not.toBeNull();
  });
});
