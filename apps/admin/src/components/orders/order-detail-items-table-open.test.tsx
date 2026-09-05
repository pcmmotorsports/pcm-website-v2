// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderItemProcurement } from '@pcm/domain';

// order-detail-items-table-open.test.tsx —
// 🔴🔴 **這一支的存在理由:片7 新加的那半條件【一格守門都沒有】。**
//
// `defaultOpen={stuck.kind === 'stuck' || hasProcurementRows}` 的**後半**是主視窗
// 2026-08-19 加裁的、也是那一輪**唯一會改變畫面的事**,而 W6 `W6-058` M1 指出:
//   · shape 那格的 regex 是 `/defaultOpen=\{stuck\.kind === 'stuck'/` ⇒ 刪掉 `|| …` **仍然命中**
//   · 行為測試的 fixture **一筆採購資料都沒有** ⇒ 那半條件在 jsdom 裡**從來不會為真**
// ⇒ **把 `|| hasProcurementRows` 整段刪掉,四綠全綠。**
// 📌 我實跑驗過那一發突變(2026-08-19):`Test Files 47 passed`、**零紅**。W6 那條成立。
//
// 🔴 而它原本**只有一次沒有提交的瀏覽器量測**在背書 —— 那一發明天不會再跑。
//    這支檔就是把那一發搬進 repo:**同一頁兩個品項互為對照**,與我在 chromium 上量的形狀相同。

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn(),
}));
vi.mock('../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));
vi.mock('./item-amount-form', () => ({ ItemAmountForm: () => <div data-testid='amount-form' /> }));

import { ItemsTable } from './order-detail-items-table';
// 🔵 `#450` 兩個**必填無預設**的 prop —— 大多數格子測的不是到貨列表,
//    給「沒有到貨、沒有包裹」讓行為與加這一片之前逐字相同。
//    🛑 而它們**不是**給 `null`:`null` 在下游是「讀不到」⇒ 會讓判準回「擋」、列表畫錯誤句
//       ⇒ 那會讓一堆與本片無關的格子開始渲染一段紅字。**空陣列才是「沒有」。**
const NO_RECEIPTS: [] = [];
const NO_SHIPMENT_GROUPS: [] = [];


const SUP = '33333333-3333-4333-8333-333333333333';

function proc(): AdminOrderItemProcurement {
  return {
    id: 'p-1',
    supplierId: SUP,
    supplierLabel: 'RPM Carbon',
    supplierIsActive: true,
    allocatedQuantity: 1,
    receivedQuantity: 0,
    replyStatus: 'no_reply',
    contactChannel: null,
    submittedAt: null,
    supplierOrderNo: null,
    exceptionReason: null,
    expectedArrivalDate: null,
    firstOrderedAt: null,
    statusChangedAt: null,
    createdAt: '2026-08-04T02:00:00+00:00',
    voidedAt: null,
    voidReason: null,
  } as unknown as AdminOrderItemProcurement;
}

/**
 * 🔴 兩個品項,**只差一件事**:第一項有 1 筆採購、第二項零筆。
 *    兩項都**沒有缺料**(`replyStatus: 'no_reply'` 不是 `out_of_stock`)——
 *    ⇒ 這樣「開了」就只可能是新加的那半條件造成的,不可能是 `stuck` 那半。
 */
function detail(): AdminOrderDetail {
  const item = (id: string, procurements: readonly AdminOrderItemProcurement[]) => ({
    id,
    variantSku: `SKU-${id}`,
    title: `品項 ${id}`,
    spec: null,
    quantity: 1,
    unitPrice: { amount: 50, currency: 'TWD' },
    lineTotal: { amount: 50, currency: 'TWD' },
    // 🔴🔴 **2026-09-04 片乙:這一格從 `null` 改成【全部訂完】—— 而我改的是【世界】不是【期望值】。**
    //    片乙給 `defaultOpen` 加了第三個條件「還有件數沒有登記來源 ⇒ 開」,
    //    而 `unsourcedQuantity(null)` 回 `null`(算不出來)⇒ 也算「要開」
    //    ⇒ 🛑 **⇒ 舊 fixture 兩項都會開 ⇒ 本檔那兩格的【對照】整個塌掉。**
    //    ⇒ 🎯 **⇒ 而本檔要守的是「有沒有採購列」那一半, 不是新加的那一半。**
    //       所以把兩項都設成 `unsourced === 0`(訂完了)⇒ **新條件在這裡是中性的**
    //       ⇒ 「開了」就只可能是 `hasProcurementRows` 造成的 —— **與原本的設計意圖逐字相同**。
    //    ✅ **⇒ 期望值一個字都沒改。** 改期望值是停止訊號;改 fixture 讓它繼續量原本那件事不是。
    quantitySummary: {
      quantity: 1,
      cancelledQuantity: 0,
      orderedQuantity: 1,
      instockQuantity: 1,
      shippedQuantity: 0,
    },
    procurements,
    procurementTruncated: false,
  });
  return {
    id: '11111111-1111-4111-8111-111111111111',
    paymentStatus: 'unpaid',
    subtotal: { amount: 100, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    taxTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 100, currency: 'TWD' },
    version: 1,
    itemsTruncated: false,
    items: [item('A', [proc()]), item('B', [])],
  } as unknown as AdminOrderDetail;
}

const view = (d: AdminOrderDetail) =>
  render(
    <ItemsTable receiptRows={NO_RECEIPTS} shipmentGroups={NO_SHIPMENT_GROUPS}
      detail={d}
      payments={{ status: 'ok', rows: [] }}
      returnTo='/orders/11111111-1111-4111-8111-111111111111'
      suppliers={[]}
      suppliersFailed={false}
    />,
  );

afterEach(cleanup);

describe('片7 · 有採購資料的品項卡預設展開', () => {
  it('🔴🔴 有 1 筆採購 ⇒ 初始【開著】;零筆 ⇒ 初始【關著】(同一次渲染,互為對照)', () => {
    const { container } = view(detail());
    const open = [...container.querySelectorAll<HTMLDetailsElement>('details.icard')].map((d) => d.open);
    // 🔴 兩格一起斷:只斷第一格的話,「全部都開」也會綠;
    //    只斷第二格的話,「全部都關」也會綠 —— 而後者正是主視窗推翻掉的那個做法。
    expect(open).toEqual([true, false]);
  });

  it('🔴 而它開的是【採購】,不是改金額表單', () => {
    const { container } = view(detail());
    expect(container.textContent).toContain('採購(向供應商訂貨)');
    // 片7 的核心不變式:卡片開著 ≠ 改金額表單在場。
    expect(container.querySelectorAll('[data-testid="amount-form"]')).toHaveLength(0);
  });

  it('🔴 `procurements === null`(讀不到)歸「關著」那半 —— 它不是資料', () => {
    const d = detail();
    // 只把第一項換成讀不到;第二項維持零筆當對照。
    (d.items as unknown as { procurements: unknown }[])[0]!.procurements = null;
    const { container } = view(d);
    const open = [...container.querySelectorAll<HTMLDetailsElement>('details.icard')].map((d2) => d2.open);
    expect(open).toEqual([false, false]);
  });
});


/**
 * 🔴🔴 **片乙(2026-09-04):還有件數沒有登記來源 ⇒ 品項卡預設展開。**
 *
 * 走查【訂貨→到貨】量到:員工打開一張新單, 在商品清單上**看不到「採購」二字** ——
 * 那一區住在品項卡(`<details>`)裡, 而卡片預設收合;而「全部展開」展的是**分頁**不是品項卡。
 *
 * 🛑 **而這推翻了同檔一句寫下的相反決定**:「沒有採購資料的維持收起:**那格展開是空的**」
 *    ⇒ 🔬 而那個前提**量到是假的**:零採購列時那一格仍然有
 *       「還沒跟任何供應商訂…」+「＋ 跟供應商下訂」+ 整張採購表單。
 *    ⇒ 📌 **⇒ 舊字面已加刪除線留在 `order-detail-items-table.tsx`, 沒有刪掉。**
 */
describe('片乙 · 還沒訂完的品項卡預設展開', () => {
  /** 兩項都零採購列、都不缺料 ⇒ 開不開只可能是新條件造成的。 */
  const byUnsourced = (aOrdered: number, bOrdered: number): AdminOrderDetail => {
    const item = (id: string, ordered: number) => ({
      id,
      variantSku: `SKU-${id}`,
      title: `品項 ${id}`,
      spec: null,
      quantity: 2,
      unitPrice: { amount: 50, currency: 'TWD' },
      lineTotal: { amount: 100, currency: 'TWD' },
      quantitySummary: {
        quantity: 2,
        cancelledQuantity: 0,
        orderedQuantity: ordered,
        instockQuantity: 0,
        shippedQuantity: 0,
      },
      procurements: [] as readonly AdminOrderItemProcurement[],
      procurementTruncated: false,
    });
    return {
      id: '11111111-1111-4111-8111-111111111111',
      paymentStatus: 'unpaid',
      subtotal: { amount: 200, currency: 'TWD' },
      shippingFee: { amount: 0, currency: 'TWD' },
      discountTotal: { amount: 0, currency: 'TWD' },
      taxTotal: { amount: 0, currency: 'TWD' },
      total: { amount: 200, currency: 'TWD' },
      version: 1,
      itemsTruncated: false,
      items: [item('A', aOrdered), item('B', bOrdered)],
    } as unknown as AdminOrderDetail;
  };

  const openStates = (d: AdminOrderDetail) => {
    const { container } = view(d);
    return [...container.querySelectorAll('details')]
      .filter((el) => el.querySelector('summary')?.textContent?.includes('品項 '))
      .map((el) => el.open);
  };

  // 🔴🔴 **正負對照在【同一次渲染】裡** —— 分開跑的話「全開」與「對的那個開」印同一個綠。
  it('🔴🔴 還有沒訂的 ⇒ 開;全部訂完 ⇒ 關(同一次渲染,互為對照)', () => {
    // A 買 2 訂 1 ⇒ unsourced = 1 ⇒ 該開 · B 買 2 訂 2 ⇒ unsourced = 0 ⇒ 該關
    expect(
      openStates(byUnsourced(1, 2)),
      '兩項都開 ⇒ 那是「永遠展開」不是「有事要做才展開」;兩項都關 ⇒ 新條件根本沒接上。',
    ).toEqual([true, false]);
  });

  // 🔴 `null`(算不出來)那一半 —— 刻意也開:**算不出來時最需要人去看那一格**。
  it('🔴 數量摘要讀不到(算不出來)⇒ 也開 —— 不知道時不要把入口藏起來', () => {
    // 🔴 B 必須是【訂完的】(2/2)⇒ 它是這一格的負對照。
    //    ⚠️ 我第一版寫 byUnsourced(0, 0) ⇒ B 也還沒訂完 ⇒ 兩項都開 ⇒ 紅。
    //    ⇒ 📌 **而那個紅是對的:期望值沒錯, 是我把世界造錯了。**(今晚第三次同一個形狀。)
    const d = byUnsourced(0, 2) as unknown as {
      items: { quantitySummary: unknown }[];
    };
    // 🔵 `!` 而不掛 eslint-disable —— 本 repo **沒有啟用** no-non-null-assertion,
    //    而一個指向不存在規則的 disable 註解**自己就是 lint error**(2026-09-04 實撞)。
    d.items[0]!.quantitySummary = null;
    expect(openStates(d as unknown as AdminOrderDetail)).toEqual([true, false]);
  });
});
