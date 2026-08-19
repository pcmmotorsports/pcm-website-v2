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
    quantitySummary: null,
    procurements,
    procurementTruncated: false,
  });
  return {
    id: '11111111-1111-4111-8111-111111111111',
    paymentStatus: 'unpaid',
    subtotal: { amount: 100, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 100, currency: 'TWD' },
    version: 1,
    itemsTruncated: false,
    items: [item('A', [proc()]), item('B', [])],
  } as unknown as AdminOrderDetail;
}

const view = (d: AdminOrderDetail) =>
  render(
    <ItemsTable
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
