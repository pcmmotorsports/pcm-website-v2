// @vitest-environment jsdom
// order-detail-items-totals-wiring.test.tsx — 拆檔片(2026-08-24)的呼叫端守門。
//
// 🔴 **為什麼要這一支**:葉元件搬進 `order-detail-items-support.tsx` 之後,
//    它們自己的測試(shape test 掃 SUPPORT 源碼)會綠 ——
//    **而「`ItemsTable` 有沒有真的還在呼叫它們」那道尺不存在**。
//    主視窗 2026-08-24 量到同款:接線改恆 false ⇒ 元件 25 格 + 頁級 87 格【零紅】。
//    ⇒ 本檔 render 的是【呼叫端】(`ItemsTable`),斷言的是搬走的東西回到畫面上。
//
// 🔴 突變驗收(交件檔逐發記錄):
//    · 拿掉 `<ItemsTotals detail={detail} />` ⇒ 「總計區」那格必須紅
//    · 拿掉 `<ItemAxisMissingNote …/>` ⇒ 「尚未就緒」那格必須紅
//    · 拿掉 `<ItemCancelledNote …/>` ⇒ 「已取消」那格必須紅
//    (`resolveAmountEditBlock` 不在此列:它的呼叫結果餵進同一表達式的 `blockedReason` prop,
//     把呼叫那行拿掉 = `amountEditBlock` 識別字無解 ⇒ **typecheck 紅**,已有更硬的閘。)
//
// ⚠️ fixture 形狀抄 `order-detail-items-brand.test.tsx`(同一個呼叫端、同一組必填 prop)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { ItemsTable } from './order-detail-items-table';

afterEach(cleanup);

const PAYMENTS = { status: 'ok', rows: [] } as never;

function detailWith(quantitySummary: unknown): AdminOrderDetail {
  return {
    id: 'o1',
    subtotal: { amount: 5000, currency: 'TWD' },
    shippingFee: { amount: 120, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 5120, currency: 'TWD' },
    itemsTruncated: false,
    items: [
      {
        id: 'oi-1',
        brand: null,
        variantSku: 'BRM-GP4RX-108-DUC-V4S',
        title: 'GP4-RX 輻射式對四卡鉗 108mm',
        spec: null,
        quantity: 3,
        unitPrice: { amount: 5000, currency: 'TWD' },
        lineTotal: { amount: 5000, currency: 'TWD' },
        procurements: null,
        procurementTruncated: false,
        quantitySummary,
      },
    ],
  } as unknown as AdminOrderDetail;
}

describe('🔴 拆檔片呼叫端守門:搬進 support 檔的東西,ItemsTable 還在渲染它們', () => {
  it('🔴 總計區(ItemsTotals):小計/運費/總計三個標籤與金額都回到畫面上', () => {
    const { container } = render(
      <ItemsTable
        detail={detailWith(null)}
        payments={PAYMENTS}
        returnTo='/orders'
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    // 正向錨:品項表本身有渲染(少了它,元件回 null 時下面三條恆綠)。
    expect(container.textContent).toContain('BRM-GP4RX-108-DUC-V4S');
    for (const label of ['小計', '運費', '總計']) expect(container.textContent).toContain(label);
    expect(container.textContent).toContain('NT$ 5,120');
  });

  it('🔴 三軸缺值(ItemAxisMissingNote + ItemAxisValue):「尚未就緒」那句與三個「—」都在', () => {
    const { container } = render(
      <ItemsTable
        detail={detailWith(null)}
        payments={PAYMENTS}
        returnTo='/orders'
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(container.textContent).toContain('數量資料尚未就緒');
    // 三軸各印一個「—」(pcm-pill 裡)。數 pill 不數字面:「—」也出現在別的空欄。
    const pills = [...container.querySelectorAll('.pcm-pill')];
    expect(pills).toHaveLength(3);
    for (const p of pills) expect(p.textContent).toBe('—');
  });

  it('🔴 已取消(ItemCancelledNote):cancelledQuantity > 0 ⇒ 那行紅字在;= 0 ⇒ 不在(負對照)', () => {
    const summary = { quantity: 3, orderedQuantity: 3, instockQuantity: 1, shippedQuantity: 0, cancelledQuantity: 2 };
    const { container } = render(
      <ItemsTable
        detail={detailWith(summary)}
        payments={PAYMENTS}
        returnTo='/orders'
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(container.textContent).toContain('已取消');
    cleanup();
    const zero = { ...summary, cancelledQuantity: 0 };
    const { container: c2 } = render(
      <ItemsTable
        detail={detailWith(zero)}
        payments={PAYMENTS}
        returnTo='/orders'
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(c2.textContent).not.toContain('已取消');
  });
});
