// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';

import { OrdersTable } from './orders-table';

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
const LINE_BASE: Omit<AdminOrderLine, 'id' | 'quantity' | 'lineTotal' | 'quantitySummary'> = {
  variantSku: 'SKU-001',
  title: '排氣管',
  brand: 'Akrapovic',
  unitPrice: { amount: toMoneyAmount(12000), currency: 'TWD' },
  vehicle: null,
  workflowStatus: null,
  version: 1,
};

function line(id: string, quantity: number, lineTotal: number): AdminOrderLine {
  return {
    ...LINE_BASE,
    id,
    quantity,
    lineTotal: { amount: toMoneyAmount(lineTotal), currency: 'TWD' },
    // 🔴 A9c 起 `quantitySummary` 是**非 nullable**(缺列的正規化是 adapter mapper 的責任、不是 UI 的)。
    //    這裡刻意由 `quantity` 推出、不寫死常數:寫死會讓「分母接錯線」在 quantity≠1 的 fixture 下仍全綠。
    //    三軸都給 0 = 「還沒訂、還沒到、沒取消」,對應 A11a-4 訂貨欄要顯示的 `0/quantity`。
    quantitySummary: {
      quantity,
      orderedQuantity: 0,
      instockQuantity: 0,
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
    customerName: '王小明',
    // 🔴 合法值只有 general / store / premiumStore(`MEMBER_TIER_LABEL`)。
    //    初版寫了不存在的 `'regular'`,被 V7 抓到 —— 因為它會查表查到 undefined、等級小字整個消失。
    //    **抓到它的不是 typecheck 而是測試**:下面原本有一個 `as AdminOrderSummary` 把型別檢查壓掉了
    //    (memory `feedback_fixture-value-makes-guard-vacuous` 的同族:fixture 值讓斷言失去意義)。
    //    ⇒ cast 已移除,現在 fixture 由 tsc 守門。
    tierAtCheckout: 'general',
    // A9c:開票紀錄三態(`not_issued` / `issued` / `voided`)。發票欄本身屬 A11a-5,本檔不驗顯示。
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    displayPosition: null,
    ...overrides,
  };
}

/** 表頭欄名(唯一權威 = 母 plan §5.1a;A11a-1 收工 = 9 欄,**A11a-4 加訂貨 = 10 欄**)。 */
const EXPECTED_HEADERS = [
  '訂單編號',
  '日期',
  '品牌',
  '料號',
  '品名',
  '年份廠牌車種',
  '數量',
  '金額',
  '客戶',
  '訂貨', // A11a-4(品項層);出貨/發票/操作仍分屬 A11a-6/-5 與 A13
];

// ── V1:欄數 ───────────────────────────────────────────────────────────
describe('V1 — 表頭欄數與內容欄數一致', () => {
  // 🔴 期望值**不寫死 13**:13 只有在四個加欄子片(A11a-3/-4/-5/-6)全做完才成立。
  //    A11a-1 收工是 9(plan §3「收工欄數」欄);寫死 13 會讓中間片永遠過不了驗收。
  it('表頭恰為 10 欄,且欄名與母 plan §5.1a 一致(Q6=A 短字面;A11a-4 起含訂貨)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).toEqual(EXPECTED_HEADERS);
  });

  it('單品項單:該列 <td> 數 = 10(訂單層與品項層都在同一列)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const cells = container.querySelectorAll('tbody tr td');

    expect(cells.length).toBe(10);
  });

  it('三品項單:第一列 <td> 數 + 後續列 <td> 數 = 10 + 品項欄數×2', () => {
    // 🔴 這條是「表頭與 rowSpan 佔位一致」的真正斷言:訂單層 4 欄(單號/日期/金額合併/客戶)
    //    只在第一列出現,後兩列各只有 **6** 個品項欄(品牌/料號/品名/車種/數量 + **A11a-4 訂貨**)
    //    ⇒ 總格數 = 10 + 6 + 6。
    // ⚠️ **這條守的是「格數與 rowSpan 佔位」,不是「渲染後落在第幾欄」**(R1 抓到我原本的註解
    //    宣稱過頭):jsdom **沒有 table layout 引擎**,把 `<th>訂貨</th>` 搬到表頭第一位而 `<td>` 不動,
    //    這三條照樣全綠。真正保證落點的是 HTML 表格模型 + `shouldMergeAmount` 對多列恆真
    //    (⇒ 金額與客戶恆 rowSpan ⇒ 訂貨恆落第 10 欄),最終仍要 Sean 肉眼驗。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(<OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.length).toBe(3);
    expect(rows[0]!.querySelectorAll('td').length).toBe(10);
    expect(rows[1]!.querySelectorAll('td').length).toBe(6);
    expect(rows[2]!.querySelectorAll('td').length).toBe(6);
  });
});

// ── V2:九碼零殘留 ─────────────────────────────────────────────────────
describe('V2 — 九碼零殘留', () => {
  it('表頭無「商品狀態」與「來源 · 管道」;DOM 內無狀態下拉、無 item_id 隱藏欄、無「存」鈕', () => {
    const lines = [line('l1', 1, 12000), line('l2', 2, 16000)];
    const { container } = render(<OrdersTable orders={[order({ lines })]} />);
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

// ── V3:rowSpan 分組 ───────────────────────────────────────────────────
describe('V3 — rowSpan 分組', () => {
  it('多品項單的訂單層格 rowSpan = lines.length,且每格只渲染一次', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(<OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />);
    const spanned = [...container.querySelectorAll('tbody td[rowspan]')];

    // 訂單層 4 格:單號 / 日期 / 金額(本例合併)/ 客戶
    expect(spanned.length).toBe(4);
    expect(spanned.every((td) => td.getAttribute('rowspan') === '3')).toBe(true);
    // 🔴 「只渲染一次」要另外釘:rowSpan 值對、但每列都畫一次的話上面那條仍會過
    //    (它只數帶 rowspan 屬性的格子總數 —— 每列都畫會變 12 而不是 4,所以這條其實已被涵蓋)。
    //    這裡改釘單號文字在整張表只出現一次,那是「重複渲染」最直接的觀察面。
    expect(container.innerHTML.split('PCM-0001').length - 1).toBe(1);
  });

  it('單品項單:rowSpan 為 1', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const spanned = [...container.querySelectorAll('tbody td[rowspan]')];

    // 🔴 先釘數量再釘值:`every` 對空陣列恆真 ⇒ 把 rowSpan 整個拿掉時上一版仍會綠(R1 nit)。
    expect(spanned.length).toBe(3);
    expect(spanned.every((td) => td.getAttribute('rowspan') === '1')).toBe(true);
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
        orders={[order({ lines: [line('l1', 1, 12000)], total: { amount: toMoneyAmount(12100), currency: 'TWD' } })]}
      />,
    );

    expect(container.textContent).toContain('NT$ 12,000');
    expect(container.textContent).not.toContain('NT$ 12,100');
    // 金額格不帶 rowspan ⇒ 訂單層帶 rowspan 的格子只剩 3 個(單號/日期/客戶)
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(3);
  });

  it('1 品項 × 數量 3 → 合併格顯示整單總額', () => {
    const { container } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 3, 36000)], total: { amount: toMoneyAmount(36000), currency: 'TWD' } })]} />,
    );

    expect(container.textContent).toContain('NT$ 36,000');
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(4);
  });

  it('🔴 3 品項 × 每個數量 1 → 仍要合併並顯示整單總額(規則的另外半條)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );

    expect(container.textContent).toContain('NT$ 25,000');
    // 反面:不得再逐列顯示各列小計
    expect(container.textContent).not.toContain('NT$ 8,000');
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(4);
  });

  it('2 品項 × 其中一列數量 2 → 合併並顯示整單總額', () => {
    const lines = [line('l1', 2, 24000), line('l2', 1, 5000)];
    const { container } = render(
      <OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(29000), currency: 'TWD' } })]} />,
    );

    expect(container.textContent).toContain('NT$ 29,000');
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(4);
  });
});

// ── V5:空 lines 兜底 ─────────────────────────────────────────────────
describe('V5 — 空 lines', () => {
  it('lines 為空仍渲染一列佔位、訂單層格不消失', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [] })]} />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelectorAll('td').length).toBe(10); // A11a-4 起含訂貨欄
    expect(container.textContent).toContain('PCM-0001');
    // 🔴 逐格釘品項欄兜底,不用整表 `toContain('—')` —— 後者由「年份廠牌車種」欄
    //    (fixture `vehicle: null`)恆滿足,證不了品牌/料號/品名真的有兜底(R1 nit)。
    const tds = [...rows[0]!.querySelectorAll('td')];
    expect(tds[2]!.textContent).toBe('—'); // 品牌
    expect(tds[3]!.textContent).toBe('—'); // 料號
    expect(tds[4]!.textContent).toBe('—'); // 品名
    expect(tds[6]!.textContent).toBe('—'); // 數量
  });
});

// ── V7:客戶格 ────────────────────────────────────────────────────────
describe('V7 — 客戶格含等級小字,等級不再單獨成欄', () => {
  it('同一個 <td> 內同時有客戶名與會員等級文字,且表頭無「會員等級」', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).not.toContain('會員等級');
    // 🔴 用**固定欄索引 8**,不用「最後一個帶 rowspan 的格」:A11a-4/-5/-6 任一片在客戶欄之後
    //    再加訂單層 rowSpan 欄,後者就會靜默指到別格、這條變成量錯東西(R1 nit)。
    const customerCell = [...container.querySelectorAll('tbody tr td')][8]!;
    expect(customerCell.textContent).toContain('王小明');
    // 🔴 等級文字必須與名字在**同一格**;分成兩格會讓上面那條仍過、但版面回到舊的兩欄
    expect(customerCell.textContent).not.toBe('王小明');
  });

  it('客戶名為 null → 顯示「—」但等級小字仍在', () => {
    const { container } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], customerName: null })]} />,
    );
    const customerCell = [...container.querySelectorAll('tbody tr td')][8]!;

    expect(customerCell.textContent).toContain('—');
    expect(customerCell.textContent!.length).toBeGreaterThan(1);
  });
});

// ── V8 + V6 接線:A11a-2(付款軸小字 / 列表日期格式;兩者都塞既有格、不加欄)────────────
describe('V8 — 付款軸小字在訂單編號格內,不另立欄', () => {
  it('小字與單號在**同一格**(索引 0),且表頭仍是 10 欄、無「付款」欄', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    // 🔴 同 V7 的理由用**固定索引 0**:訂單編號恆是第一格,不靠「第一個帶 rowspan 的格」推。
    const idCell = [...container.querySelectorAll('tbody tr td')][0]!;

    // 🔴 「沒有付款欄」由這條 `toEqual` 全額涵蓋。原本多寫的 `not.toContain('付款')` 已刪:它被嚴格蘊含,
    //    **且**陣列 `toContain` 是整格相等 ⇒ 欄名若叫「付款狀態」它照樣綠(R1 抓到,名實不符)。
    expect(headers).toEqual(EXPECTED_HEADERS);
    expect(idCell.textContent).toContain('PCM-0001');
    // 字面取自 `PAYMENT_STATUS_LABEL.paid`(`order-list-view.ts`)的**真實值**,不是自己編的中文。
    expect(idCell.textContent).toContain('已付款');
  });

  it('🔴 待付款上紅、其餘走 muted:兩格正負對照(只驗字面會讓上色整段拿掉仍全綠)', () => {
    const { container: unpaidBox } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus: 'unpaid' })]} />,
    );
    const unpaidCell = [...unpaidBox.querySelectorAll('tbody tr td')][0]!;
    // 🔴 `:scope > div` 而非 `div`:單號格今天只有這一顆 div,但 A11a-3 的操作入口很可能加 wrapper,
    //    那時 `querySelector('div')` 會靜默讀到別的元素、這兩條變成量錯東西(R1 抓到)。
    const unpaidLabel = unpaidCell.querySelector(':scope > div')!;

    expect(unpaidLabel.textContent).toBe('待付款');
    expect(unpaidLabel.className).toContain('text-destructive');

    // 反面:`paid` 那格**不得**是 destructive —— 少了這格,「所有狀態一律上紅」也會過。
    const { container: paidBox } = render(
      <OrdersTable orders={[order({ lines: [line('l2', 1, 12000)] })]} />,
    );
    const paidLabel = [...paidBox.querySelectorAll('tbody tr td')][0]!.querySelector(':scope > div')!;

    expect(paidLabel.textContent).toBe('已付款');
    expect(paidLabel.className).not.toContain('text-destructive');
    expect(paidLabel.className).toContain('text-muted-foreground');
  });
});

describe('V6 接線 — 日期格吃的是 formatOrderListDate,不是 formatOrderDate', () => {
  it('同年 fixture → 日期格為 `08/06`,且**不含**完整 `2026-08-06`', () => {
    // 🔴 系統時間釘死:同年/跨年是相對當下判斷,不釘的話這條在 2027 年會自己變紅(時間炸彈)。
    //    fixture `createdAt` = `2026-08-06T02:00:00Z`(台北 2026-08-06)。
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T02:00:00Z'));
    try {
      const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
      const dateCell = [...container.querySelectorAll('tbody tr td')][1]!;

      // 🔴 原本這下面多寫一條 `.not.toContain('2026-08-06')`,R1 抓到被本條嚴格蘊含 ⇒ 已刪。
      //    連帶更正我先前的突變報告:突變②(接線改回 `formatOrderDate`)紅的是**整條 it**,
      //    不是「只紅那一條斷言」—— 兩個斷言在同一條 it 內本來就不可分辨。
      expect(dateCell.textContent).toBe('08/06');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── V9:訂貨欄(A11a-4)────────────────────────────────────────────────
describe('V9 — 訂貨欄接 A9c 的非 nullable 三軸(零 join 由型別層天然成立,本組不另量)', () => {
  it('逐列顯示 `已訂/買了`,分子分母各自接對線', () => {
    // 🔴 三個值刻意互不相等(已訂 2 / 買了 5 / 到貨 1):分子分母對調、或分母誤接
    //    `instockQuantity` / `cancellableQuantity` 都會紅。fixture 預設的 `orderedQuantity: 0`
    //    在這裡不夠用 —— 0 與任何接錯線的結果太容易巧合相同。
    // ⚠️ 誠實邊界(R1):`quantitySummary.quantity` 與 `line.quantity` 依 A9c 合約**恆等**
    //    (複合 FK 物理保證)⇒ 分母若被誤接成 `line.quantity`,本組**抓不到**。那是構造不出的資料,
    //    不是漏測,但別把這條讀成「分母接哪都會紅」。
    const l = line('l1', 5, 60000);
    const withOrdered: AdminOrderLine = {
      ...l,
      quantitySummary: { ...l.quantitySummary, orderedQuantity: 2, instockQuantity: 1, cancellableQuantity: 4 },
    };
    const { container } = render(<OrdersTable orders={[order({ lines: [withOrdered] })]} />);
    const cell = [...container.querySelectorAll('tbody tr td')][9]!;

    expect(cell.textContent).toBe('2/5');
  });

  it('多品項單:訂貨是**品項層**,每列各自一格(不是訂單層 rowSpan)', () => {
    // 🔴 這條擋「順手把訂貨也寫成 `i === 0 &&` + rowSpan」——那會讓第二個品項的進度消失。
    const a = line('l1', 3, 12000);
    const b = line('l2', 4, 8000);
    const lines: AdminOrderLine[] = [
      { ...a, quantitySummary: { ...a.quantitySummary, orderedQuantity: 3, cancellableQuantity: 3 } },
      { ...b, quantitySummary: { ...b.quantitySummary, orderedQuantity: 1, cancellableQuantity: 4 } },
    ];
    const { container } = render(
      <OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]} />,
    );
    const rows = [...container.querySelectorAll('tbody tr')];

    // 第一列訂貨在索引 9;第二列只有 6 格,訂貨是最後一格。
    expect([...rows[0]!.querySelectorAll('td')][9]!.textContent).toBe('3/3');
    expect([...rows[1]!.querySelectorAll('td')][5]!.textContent).toBe('1/4');
    // 訂貨格**不得**帶 rowspan(帶了就是被寫成訂單層)
    expect(rows[0]!.querySelectorAll('td')[9]!.hasAttribute('rowspan')).toBe(false);
  });

  it('佔位列(空 lines)→ 訂貨顯示「—」,不畫出 `0/0`', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [] })]} />);
    const cell = [...container.querySelectorAll('tbody tr td')][9]!;

    expect(cell.textContent).toBe('—');
    expect(container.textContent).not.toContain('0/0');
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
