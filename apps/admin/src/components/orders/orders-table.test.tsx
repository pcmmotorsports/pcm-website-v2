// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';

import { OrdersTable } from './orders-table';
import {
  PAYMENT_STATUS_CAPSULE,
  PAYMENT_STATUS_LABEL,
  STATUS_CAPSULE,
  orderedCapsuleClass,
} from '../../lib/orders/order-list-view';

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

/** 表頭欄名(唯一權威 = 母 plan §5.1a;A11a-1 = 9 欄 → A11a-4 加訂貨 = 10 → **A11a-5 加發票 = 11**)。 */
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
  '訂貨', // A11a-4(品項層)
  '發票', // A11a-5(訂單層);出貨/操作仍分屬 A11a-6 與 A13
];

// ── V1:欄數 ───────────────────────────────────────────────────────────
describe('V1 — 表頭欄數與內容欄數一致', () => {
  // 🔴 期望值**不寫死**上限:Q5b=A 已把 A11a-3(操作欄)整片移到 A13 ⇒ 本線上限是 **12**(不是 13)。
  //    每片收工值 = 前一片 +1(plan §3);寫死任何終值都會讓中間片永遠過不了驗收。
  it('表頭恰為 11 欄,且欄名與母 plan §5.1a 一致(Q6=A 短字面;A11a-4/-5 起含訂貨、發票)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent);

    expect(headers).toEqual(EXPECTED_HEADERS);
  });

  it('單品項單:該列 <td> 數 = 11(訂單層與品項層都在同一列)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const cells = container.querySelectorAll('tbody tr td');

    expect(cells.length).toBe(11);
  });

  it('三品項單:第一列 <td> 數 + 後續列 <td> 數 = 11 + 品項欄數×2', () => {
    // 🔴 這條是「表頭與 rowSpan 佔位一致」的真正斷言:訂單層 4 欄(單號/日期/金額合併/客戶)
    //    訂單層現為 **5** 欄(單號/日期/金額合併/客戶/發票),只在第一列出現;
    //    後兩列各只有 **6** 個品項欄(品牌/料號/品名/車種/數量 + **A11a-4 訂貨**)。
    //    A11a-5 的發票欄是**訂單層** ⇒ 只加在第一列、不影響後續列的 6 ⇒ 總格數 = **11** + 6 + 6。
    // ⚠️ **這條守的是「格數與 rowSpan 佔位」,不是「渲染後落在第幾欄」**(R1 抓到我原本的註解
    //    宣稱過頭):jsdom **沒有 table layout 引擎**,把 `<th>訂貨</th>` 搬到表頭第一位而 `<td>` 不動,
    //    這三條照樣全綠。真正保證落點的是 HTML 表格模型 + `shouldMergeAmount` 對多列恆真
    //    (⇒ 金額與客戶恆 rowSpan ⇒ 訂貨恆落第 10 欄),最終仍要 Sean 肉眼驗。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(<OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.length).toBe(3);
    expect(rows[0]!.querySelectorAll('td').length).toBe(11);
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

    // 訂單層 5 格:單號 / 日期 / 金額(本例合併)/ 客戶 / **發票**(A11a-5)
    expect(spanned.length).toBe(5);
    expect(spanned.every((td) => td.getAttribute('rowspan') === '3')).toBe(true);
    // 🔴 「只渲染一次」要另外釘:rowSpan 值對、但每列都畫一次的話上面那條仍會過
    //    (它只數帶 rowspan 屬性的格子總數 —— 訂單層現為 **5** 格,每列都畫會變 **15** 而不是 5,
    //     所以這條其實已被涵蓋。A11a-5 加發票後這兩個數字從 12/4 變成 15/5。)
    //    這裡改釘單號文字在整張表只出現一次,那是「重複渲染」最直接的觀察面。
    // 🔴 **A11c:計數面必須鎖進 `<table>`,不能數整個 container** —— 手機卡片是第二份 markup,
    //    同一個單號本來就會在卡片再出現一次。原斷言的**意圖是「桌機表格內只渲染一次」**,
    //    鎖進 table 之後意圖不變、而且比原本更精準(卡片的重複渲染另有 A11c 專屬格把關)。
    const table = container.querySelector('table')!;
    expect(table.innerHTML.split('PCM-0001').length - 1).toBe(1);
  });

  it('單品項單:rowSpan 為 1', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const spanned = [...container.querySelectorAll('tbody td[rowspan]')];

    // 🔴 先釘數量再釘值:`every` 對空陣列恆真 ⇒ 把 rowSpan 整個拿掉時上一版仍會綠(R1 nit)。
    //    單品項單金額不合併 ⇒ 訂單層 4 格:單號 / 日期 / 客戶 / **發票**。
    expect(spanned.length).toBe(4);
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
    // 金額格不帶 rowspan ⇒ 訂單層帶 rowspan 的格子剩 4 個(單號/日期/客戶/**發票**)
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(4);
  });

  it('1 品項 × 數量 3 → 合併格顯示整單總額', () => {
    const { container } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 3, 36000)], total: { amount: toMoneyAmount(36000), currency: 'TWD' } })]} />,
    );

    expect(container.textContent).toContain('NT$ 36,000');
    // 合併態:訂單層 5 格(單號/日期/金額合併/客戶/**發票** A11a-5)
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(5);
  });

  it('🔴 3 品項 × 每個數量 1 → 仍要合併並顯示整單總額(規則的另外半條)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );

    // 🔴 **A11c:量測面必須鎖進 `<table>`** —— 手機卡片是同一個 container 的第二個供應者,
    //    合併態的卡片也會渲染 `order.total` ⇒ 不鎖的話「桌機合併格改顯示 lineTotal」這個突變
    //    會由卡片把 25,000 供應回來、整格靜默全綠(階段 C code-reviewer 抓到)。
    //    這一族與 `:184`/`:469` 的 innerHTML 計數同因,但它**不會轉紅、只會變弱**。
    const table = container.querySelector('table')!;
    expect(table.textContent).toContain('NT$ 25,000');
    // 反面:不得再逐列顯示各列小計
    expect(table.textContent).not.toContain('NT$ 8,000');
    // 合併態:訂單層 5 格(單號/日期/金額合併/客戶/**發票** A11a-5)
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(5);
  });

  it('2 品項 × 其中一列數量 2 → 合併並顯示整單總額', () => {
    const lines = [line('l1', 2, 24000), line('l2', 1, 5000)];
    const { container } = render(
      <OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(29000), currency: 'TWD' } })]} />,
    );

    // 🔴 A11c:同上,鎖進 `<table>`(這格連負向斷言都沒有,更需要限定供應者)
    expect(container.querySelector('table')!.textContent).toContain('NT$ 29,000');
    // 合併態:訂單層 5 格(單號/日期/金額合併/客戶/**發票** A11a-5)
    expect(container.querySelectorAll('tbody td[rowspan]').length).toBe(5);
  });
});

// ── V5:空 lines 兜底 ─────────────────────────────────────────────────
describe('V5 — 空 lines', () => {
  it('lines 為空仍渲染一列佔位、訂單層格不消失', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [] })]} />);
    const rows = [...container.querySelectorAll('tbody tr')];

    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelectorAll('td').length).toBe(11); // A11a-4/-5 起含訂貨、發票欄
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
  it('小字與單號在**同一格**(索引 0),且表頭仍是 11 欄、無「付款」欄', () => {
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

  // 🔴 **A11b(2026-08-07)改寫**:付款軸小字改膠囊,結構從 `<div>純文字</div>` 變成
  //    `<div class="mt-1"><span class="…膠囊…">文字</span></div>` —— 原本 `:scope > div` 直接
  //    命中文字節點的做法會撲空(className 只剩 `mt-1`),改查 `:scope > div > span`。
  //    **`paid` 的期望值也跟著改**:A11b 之前 `paid` 走 `text-muted-foreground`(與 `refunded`/
  //    `partiallyRefunded` 同灰、正是本片要治的訊號塌陷);A11b 之後 `paid` 是 emerald,
  //    不再是 muted ⇒ 舊的 `toContain('text-muted-foreground')` 若照抄會**假紅**,已改斷言方向。
  it('🔴 待付款上紅、已付款走綠(emerald):兩格正負對照(只驗字面會讓上色整段拿掉仍全綠)', () => {
    const { container: unpaidBox } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus: 'unpaid' })]} />,
    );
    const unpaidCell = [...unpaidBox.querySelectorAll('tbody tr td')][0]!;
    const unpaidCapsule = unpaidCell.querySelector(':scope > div > span')!;

    expect(unpaidCapsule.textContent).toBe('待付款');
    expect(unpaidCapsule.className).toContain('text-destructive');

    // 反面:`paid` 那格**不得**是 destructive、也**不得**再是 muted 灰(訊號塌陷解除)。
    const { container: paidBox } = render(
      <OrdersTable orders={[order({ lines: [line('l2', 1, 12000)] })]} />,
    );
    const paidCapsule = [...paidBox.querySelectorAll('tbody tr td')][0]!.querySelector(
      ':scope > div > span',
    )!;

    expect(paidCapsule.textContent).toBe('已付款');
    expect(paidCapsule.className).not.toContain('text-destructive');
    expect(paidCapsule.className).not.toContain('text-muted-foreground');
    expect(paidCapsule.className).toContain('bg-emerald-100');
  });
});

// ─────────────────────────────────────────────────────────────
// A11b(2026-08-07):付款軸與訂貨軸膠囊上色(plan
// `docs/specs/2026-08-07-e10-a11b-status-capsule-plan.md`)。出貨軸不做(§1)。
// ─────────────────────────────────────────────────────────────

describe('A11b — 付款軸膠囊配色(五態,§4 表)', () => {
  it.each([
    // 🔴 用**完整色 token**(`bg-…`)而非 'emerald' 這種子字串:後者在「色 class 被刪掉、
    //    但同一串裡還有別的含該字樣的 class」時仍會過(subagent 自陳的弱點,主對話收緊)。
    //    色階要調(如 amber-100 → amber-50)本來就該是**刻意動測試**的設計決定,不是彈性。
    ['paid', '已付款', 'bg-emerald-100'],
    ['unpaid', '待付款', 'bg-destructive/10'],
    ['partiallyPaid', '付款確認中', 'bg-amber-100'],
    ['refunded', '已退款', 'bg-muted'],
    ['partiallyRefunded', '已退部分', 'bg-amber-100'],
  ] as const)('%s → 文字「%s」、顏色含 %s', (status, label, colorToken) => {
    const { container } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus: status })]} />,
    );
    const capsule = [...container.querySelectorAll('table tbody tr td')][0]!.querySelector(
      ':scope > div > span',
    )!;

    expect(capsule.textContent).toBe(label);
    expect(capsule.className).toContain(colorToken);
    // 每一態都是同一個共用形狀,不是各自另組的 class。
    expect(capsule.className).toContain(STATUS_CAPSULE);
    // 🔴 上一行**單獨看是恆真的**:`STATUS_CAPSULE` 若被改成 `''`,`includes('')` 永遠 true
    //    ⇒ 膠囊的「形狀」在測試層等於沒人釘(階段 C MF3)。補一條硬字面。
    expect(capsule.className).toContain('rounded-full');
  });

  // 🔴 這是擋「訊號塌陷回歸」的直接觀察面:`refunded` / `partiallyRefunded` 一旦被改回與
  // `paid` 同色,這條會紅(§5-1、A11b plan `:46-49` 逐字病灶)。
  it('🔴 相異色數 ≥ 4,且 refunded/partiallyRefunded/unpaid 皆不與 paid 同色(擋訊號塌陷回歸)', () => {
    const statuses = ['paid', 'unpaid', 'partiallyPaid', 'refunded', 'partiallyRefunded'] as const;
    const colors = statuses.map((status) => {
      const { container } = render(
        <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus: status })]} />,
      );
      return [...container.querySelectorAll('table tbody tr td')][0]!.querySelector(
        ':scope > div > span',
      )!.className;
    });

    expect(colors[3]).not.toBe(colors[0]); // refunded ≠ paid
    expect(colors[4]).not.toBe(colors[0]); // partiallyRefunded ≠ paid
    expect(colors[1]).not.toBe(colors[0]); // unpaid ≠ paid
    expect(colors[3]).not.toBe(colors[1]); // refunded ≠ unpaid
    expect(new Set(colors).size).toBeGreaterThanOrEqual(4);
  });
});

describe('A11b — 訂貨軸膠囊配色(三段完成度 + 邊界,§4 表)', () => {
  it.each([
    // 🔴 與付款軸同一條政策:用完整色 token。用 'muted' 的話,把 `bg-muted` 拿掉、只留
    //    `text-muted-foreground`(= 膠囊變成沒有底色的裸文字,正是本片要治的東西)仍會全綠。
    [0, 5, 'bg-muted'],
    [3, 5, 'bg-amber-100'],
    [5, 5, 'bg-emerald-100'],
  ] as const)('ordered=%s quantity=%s → 顏色含 %s', (ordered, quantity, colorToken) => {
    const l = line('l1', quantity, 12000);
    const withOrdered: AdminOrderLine = {
      ...l,
      quantitySummary: { ...l.quantitySummary, orderedQuantity: ordered, cancellableQuantity: quantity - ordered },
    };
    const { container } = render(<OrdersTable orders={[order({ lines: [withOrdered] })]} />);
    const cell = [...container.querySelectorAll('table tbody tr td')][9]!;
    const capsule = cell.querySelector('span')!;

    expect(capsule.textContent).toBe(`${ordered}/${quantity}`);
    expect(capsule.className).toContain(colorToken);
  });

  // 🔴 邊界值(plan §5-2 逐字要求):`ordered === quantity`(齊了、綠)與
  // `ordered === quantity - 1`(仍差一件、琥珀)—— 這兩格緊鄰,擋 `>=` 誤寫成 `>` 或 `>` 誤寫成 `>=`。
  it('邊界:ordered === quantity → 綠;ordered === quantity - 1 → 琥珀(非綠)', () => {
    const quantity = 4;
    const full = line('l-full', quantity, 12000);
    const fullOrdered: AdminOrderLine = {
      ...full,
      quantitySummary: { ...full.quantitySummary, orderedQuantity: quantity, cancellableQuantity: 0 },
    };
    const { container: fullBox } = render(<OrdersTable orders={[order({ lines: [fullOrdered] })]} />);
    const fullCapsule = [...fullBox.querySelectorAll('table tbody tr td')][9]!.querySelector('span')!;

    expect(fullCapsule.className).toContain('bg-emerald-100');
    expect(fullCapsule.className).not.toContain('bg-amber-100');

    const near = line('l-near', quantity, 12000);
    const nearOrdered: AdminOrderLine = {
      ...near,
      quantitySummary: { ...near.quantitySummary, orderedQuantity: quantity - 1, cancellableQuantity: 1 },
    };
    const { container: nearBox } = render(<OrdersTable orders={[order({ lines: [nearOrdered] })]} />);
    const nearCapsule = [...nearBox.querySelectorAll('table tbody tr td')][9]!.querySelector('span')!;

    expect(nearCapsule.className).toContain('bg-amber-100');
    expect(nearCapsule.className).not.toContain('bg-emerald-100');
  });

  it('佔位列(空 lines):訂貨格仍是純文字「—」,不套膠囊(不是一個可辨識的完成度)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [] })]} />);
    const cell = [...container.querySelectorAll('table tbody tr td')][9]!;

    expect(cell.querySelector('span')).toBeNull();
    expect(cell.textContent).toBe('—');
  });
});

describe('A11b — S4:桌機與卡片膠囊 class 字串相等(雙 markup 一致性)', () => {
  it('付款軸:同一筆 fixture 下,桌機與卡片的膠囊 class 完全相等', () => {
    const testOrder = order({ lines: [line('l1', 1, 12000)], paymentStatus: 'partiallyRefunded' });
    const { container } = render(<OrdersTable orders={[testOrder]} />);
    const expected = `${STATUS_CAPSULE} ${PAYMENT_STATUS_CAPSULE.partiallyRefunded}`;

    // 用文字內容鎖定(而非結構深度):卡片內同一列也有訂貨膠囊,結構選擇器容易撞到錯的那顆。
    const deskCapsule = [...container.querySelectorAll('table span')].find(
      (el) => el.textContent === PAYMENT_STATUS_LABEL.partiallyRefunded,
    )!;
    const cardCapsule = [...container.querySelectorAll('ul span')].find(
      (el) => el.textContent === PAYMENT_STATUS_LABEL.partiallyRefunded,
    )!;

    expect(deskCapsule.className).toBe(expected);
    expect(cardCapsule.className).toBe(expected);
    expect(deskCapsule.className).toBe(cardCapsule.className);
  });

  it('訂貨軸:同一筆 fixture 下,桌機與卡片的膠囊 class 完全相等', () => {
    const l = line('l1', 5, 12000);
    const withOrdered: AdminOrderLine = {
      ...l,
      quantitySummary: { ...l.quantitySummary, orderedQuantity: 3, cancellableQuantity: 2 },
    };
    const { container } = render(<OrdersTable orders={[order({ lines: [withOrdered] })]} />);
    const expected = `${orderedCapsuleClass(3, 5)} tabular-nums`;

    const deskCapsule = [...container.querySelectorAll('table span')].find(
      (el) => el.textContent === '3/5',
    )!;
    const cardCapsule = [...container.querySelectorAll('ul span')].find(
      (el) => el.textContent === '3/5',
    )!;

    expect(deskCapsule.className).toBe(expected);
    expect(cardCapsule.className).toBe(expected);
    expect(deskCapsule.className).toBe(cardCapsule.className);
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
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], invoiceStatus: status })]} />,
    );
    const cell = [...container.querySelectorAll('tbody tr td')][10]!;

    expect(cell.textContent).toBe(label);
  });

  // 🔴 原本這裡還有一條「三個字面互不相同(Set size = 3)」,R1 抓到它被上面的 `it.each`
  //    **嚴格蘊含** —— `it.each` 已把三格釘成三個兩兩相異的字面,Set 那條在它全綠時不可能紅。
  //    「三者互不相同」的獨立守門改放在常數所在處:`lib/orders/order-list-view.test.ts`。已刪。

  it('發票是**訂單層**:多品項單只渲染一格、帶 rowSpan', () => {
    // 🔴 擋「順手寫成品項層」——那會讓同一張單的開票狀態在每一列重複、且與訂貨欄混淆。
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container } = render(
      <OrdersTable
        orders={[order({ lines, invoiceStatus: 'issued', total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]}
      />,
    );
    const rows = [...container.querySelectorAll('tbody tr')];

    expect([...rows[0]!.querySelectorAll('td')][10]!.getAttribute('rowspan')).toBe('2');
    // 🔴 A11c:同上,鎖進 `<table>`(手機卡片會讓同一字面在 container 內出現第二次)
    expect(container.querySelector('table')!.innerHTML.split('已開立').length - 1).toBe(1);
    expect(rows[1]!.querySelectorAll('td').length).toBe(6); // 後續列不多一格
  });
});

describe('V11b — Q2b=A:列表**不顯示**載具別', () => {
  it('DOM 內零載具別字面(該資料連投影都沒有,不是有資料而選擇不畫)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);

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
// A11c 手機卡片版(2026-08-06)
// 真權威 = `docs/specs/2026-07-25-admin-backend-rebuild-spec.md:427`(§4 通用 UI 規範 第 1 條):
//   「手機版列表一律轉卡片,不做橫向捲動表格。主要欄位加粗置頂、次要副行、金額/狀態靠右。」
// 🔴 本區量的是**卡片那份 markup**;桌機那份由上面既有 25 格承重、本區一格都不碰它。
// ─────────────────────────────────────────────────────────────
describe('A11c — 手機卡片版', () => {
  // 🔴 選擇器刻意**不綁斷點 class**(用結構:卡片是根層唯一的 <ul>)。
  //    綁 `ul.md\:hidden` 的話,「拿掉 md:hidden」這個突變會讓下面每一格都紅
  //    ⇒ 7 個紅同一個根因、不是 7 個獨立證據(memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
  //    改成結構選擇後,該突變**只紅斷點那一格**,其餘各自量各自的東西。
  const card = (c: HTMLElement) => c.querySelector(':scope > ul')!;

  it('🔴 兩份 markup 各自帶對斷點:桌機 hidden md:block、手機 md:hidden', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    const desk = container.querySelector('table')!.parentElement!;
    // 🔴 用 `classList.contains` 而非 `className.toContain`:後者是**子字串**比對
    //    ⇒ 把 `hidden` 改成 `md:hidden`(= 手機顯示、正好是本片要治的病)也會通過(階段 C nit)。
    expect(desk.classList.contains('hidden')).toBe(true);
    expect(desk.classList.contains('md:block')).toBe(true);
    // 手機那份在桌機要藏起來(否則桌機會同時出現表格與卡片)
    expect(card(container).classList.contains('md:hidden')).toBe(true);
  });

  it('🔴 一張訂單一張卡(不是一個品項一張)—— 3 品項單仍只有 1 個卡片 <li>', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable orders={[order({ lines, total: { amount: toMoneyAmount(25000), currency: 'TWD' } })]} />,
    );
    // 卡片的直屬 <li> = 訂單張數
    expect(card(container).querySelectorAll(':scope > li').length).toBe(1);
    // 卡內品項清單 = 品項數
    expect(card(container).querySelectorAll(':scope > li > ul > li').length).toBe(3);
  });

  it('🔴 卡頭的訂單層欄位在**卡片內**各只出現一次(重複 = 退化成一品項一張卡)', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000), line('l3', 1, 5000)];
    const { container } = render(
      <OrdersTable
        orders={[
          order({ lines, invoiceStatus: 'issued', total: { amount: toMoneyAmount(25000), currency: 'TWD' } }),
        ]}
      />,
    );
    const html = card(container).innerHTML;
    for (const token of ['PCM-0001', '已開立', '王小明']) {
      expect(html.split(token).length - 1).toBe(1);
    }
  });

  // ⚠️ 本格只驗**卡片含這些欄位**;「落在哪個槽」文字層證不了,由真瀏覽器實看 + Sean 肉眼驗承重。
  it('卡片含訂單層全部欄位:單號 / 金額 / 發票 / 日期 / 客戶 / 等級 / 付款軸', () => {
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container } = render(
      <OrdersTable
        orders={[
          order({ lines, invoiceStatus: 'issued', total: { amount: toMoneyAmount(20000), currency: 'TWD' } }),
        ]}
      />,
    );
    const text = card(container).textContent ?? '';
    expect(text).toContain('PCM-0001');
    expect(text).toContain('NT$ 20,000'); // 合併態 = 整單總額進卡頭
    expect(text).toContain('已開立');
    expect(text).toContain('王小明');
    // 🔴 字面取自 `MEMBER_TIER_LABEL.general` 實值(是「一般」不是「一般會員」)—— 猜錯過一次
    expect(text).toContain('一般');
    expect(text).toContain('已付款');
  });

  it('卡內品項行帶品名 / 料號 / 數量 / 訂貨 n/m', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 2, 24000)] })]} />);
    const text = card(container).textContent ?? '';
    expect(text).toContain('排氣管');
    expect(text).toContain('SKU-001');
    expect(text).toContain('數量 2');
    expect(text).toContain('訂貨 0/2'); // 分母跟著 quantity 走(fixture 由 quantity 推出)
  });

  it('🔴 金額語意與桌機同源:合併態只在卡頭、非合併態逐品項', () => {
    // 非合併態 = 單品項且買 1 件 ⇒ 金額走 lineTotal、逐品項顯示。
    // 🔴 `total` 刻意設 **12,100 ≠ lineTotal 12,000**(照本檔 `:209` 桌機那格的同款做法):
    //    兩者相等的話,「一律在卡頭顯示 order.total」這個突變也會讓斷言全綠 = 撞號恆真。
    //    階段 C code-reviewer 抓到我把上一輪已修掉的坑又寫回來。
    const { container: single } = render(
      <OrdersTable
        orders={[order({ lines: [line('l1', 1, 12000)], total: { amount: toMoneyAmount(12100), currency: 'TWD' } })]}
      />,
    );
    expect((card(single).textContent ?? '').split('NT$ 12,000').length - 1).toBe(1);
    expect(card(single).textContent).not.toContain('NT$ 12,100'); // 非合併態不得顯示整單總額

    // 合併態(多品項)⇒ 整單總額恰一次,且**不逐品項重複金額**
    const lines = [line('l1', 1, 12000), line('l2', 1, 8000)];
    const { container: multi } = render(
      <OrdersTable
        orders={[order({ lines, total: { amount: toMoneyAmount(20000), currency: 'TWD' } })]} />,
    );
    const text = card(multi).textContent ?? '';
    expect(text.split('NT$ 20,000').length - 1).toBe(1);
    expect(text).not.toContain('NT$ 12,000');
    expect(text).not.toContain('NT$ 8,000');
  });

  // 🔴 正負成對 —— 只有 `not.toContain` 那半邊的話,把 badge 整段刪掉照樣綠(恆真)。
  it('已取消單:卡頭帶「已取消」標記', () => {
    const { container } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], cancelledAt: '2026-08-06T03:00:00.000Z' })]} />,
    );
    expect(card(container).textContent).toContain('已取消');
  });

  it('未取消單:卡頭**不得**出現「已取消」(上一格的負向對照)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    expect(card(container).textContent).not.toContain('已取消');
  });

  it('🔴 空狀態只有一份 markup(不複製第二份)', () => {
    const { container } = render(<OrdersTable orders={[]} />);
    expect((container.innerHTML.split('目前沒有符合條件的訂單').length - 1)).toBe(1);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('ul')).toBeNull(); // 不綁斷點 class,與本區政策一致
  });

  // 🔴 nit-5:卡片的這兩條分支原本零覆蓋 —— 刪掉 `text-destructive` 三元式或佔位 `[null]`
  //    都不會有任何一格轉紅(桌機有覆蓋、卡片沒有)。補上正負對照。
  it('付款軸 unpaid 在卡片上紅、paid 不上紅(刪掉付款膠囊的 destructive 配色這格會紅)', () => {
    const { container: unpaid } = render(
      <OrdersTable orders={[order({ lines: [line('l1', 1, 12000)], paymentStatus: 'unpaid' })]} />,
    );
    const red = card(unpaid).querySelector('.text-destructive');
    expect(red).not.toBeNull();
    expect(red!.textContent).toContain('待付款');

    const { container: paid } = render(<OrdersTable orders={[order({ lines: [line('l1', 1, 12000)] })]} />);
    // fixture 預設 paid ⇒ 卡片副行不得有紅字(badge 那顆紅屬已取消、本例未取消)
    expect(card(paid).querySelector('.text-destructive')).toBeNull();
  });

  it('空 lines 的佔位:卡內仍出現一列、顯示「—」(不是整段消失)', () => {
    const { container } = render(<OrdersTable orders={[order({ lines: [] })]} />);
    const items = card(container).querySelectorAll(':scope > li > ul > li');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('—');
  });

  it('🔴 鐵則 12:卡片版維持零 client 邊界(全檔零 use client / 零 hook)', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const raw = await readFile(join(__dirname, 'orders-table.tsx'), 'utf8');

    // 🔴 **必須先剝註解**(同 V9 那格的教訓):本檔的 A11c 檔頭註解裡就逐字寫著
    //    「零 `use client`」—— 不剝的話這條守門一寫出來就恆紅。守門要量的是**程式碼**,
    //    不是說明它的那段話。
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 前提斷言 ①:真的讀到那個檔(讀空字串/讀錯檔 ⇒ 下面全部恆真)
    expect(raw).toContain('export function OrdersTable');
    // 前提斷言 ②:真的讀到**卡片那份**(不然這格只是在守桌機)
    expect(raw).toContain('function OrderCard');
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
