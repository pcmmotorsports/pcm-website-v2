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

// 🔴🔴 **2026-09-04:本檔新增 app router 的 mock —— 而它【不是】為了配合某個改動。**
//    本檔的 fixture 走的是 `quantitySummary: null`(那正是它要測的世界),
//    而片乙給 `defaultOpen` 加了「還有件數沒有登記來源 ⇒ 也展開」, 其中 `null` 算「不知道 ⇒ 開」
//    ⇒ 🎯 **⇒ 於是這棵渲染樹開始 mount `ItemProcurementForm`, 而它 `useRouter()`。**
//    ⇒ ⇒ 🛑 **⇒ 沒有 mock ⇒ `invariant expected app router to be mounted` ⇒ 整格炸掉。**
//
//    ⚠️ **那它原本為什麼不用?** —— 因為那棵樹以前不 mount 那支元件。
//    ⇒ 📌 **⇒ 所以補這個 mock 不是「放寬」, 是【它渲染的世界變寬了】** ——
//       它現在真的渲染一棵會用到 router 的樹, 那就該給它一個 router。
//    🔴 **而反過來那半也要成立**:把片乙那個條件拿掉之後, 本檔應該**仍然全綠**
//       —— 否則表示這個 mock 掛錯地方(它變成在測片乙, 而不是在測總計區)。已實跑驗過。
//
// 🛑 而**這一整件最值得記的**:改一個 `defaultOpen` ⇒ **一整棵子樹開始 mount**
//    ⇒ 🎯 爆炸半徑是「那棵子樹裡所有元件的 hook 需求」, 而**那在 diff 上完全看不見**;
//       `vitest related` 與手挑都看 **import 圖**, 而本檔**不 import** 被改的那支
//    ⇒ ⇒ 📌 **⇒ 它是被【渲染樹】牽動的, 不是被 import 牽動的 ⇒ 那一族結構上撈不到。**
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ItemsTable } from './order-detail-items-table';
// 🔵 `#450` 兩個**必填無預設**的 prop —— 大多數格子測的不是到貨列表,
//    給「沒有到貨、沒有包裹」讓行為與加這一片之前逐字相同。
//    🛑 而它們**不是**給 `null`:`null` 在下游是「讀不到」⇒ 會讓判準回「擋」、列表畫錯誤句
//       ⇒ 那會讓一堆與本片無關的格子開始渲染一段紅字。**空陣列才是「沒有」。**
const NO_RECEIPTS: [] = [];
const NO_SHIPMENT_GROUPS: [] = [];


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
      <ItemsTable receiptRows={NO_RECEIPTS} shipmentGroups={NO_SHIPMENT_GROUPS}
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
      <ItemsTable receiptRows={NO_RECEIPTS} shipmentGroups={NO_SHIPMENT_GROUPS}
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
      <ItemsTable receiptRows={NO_RECEIPTS} shipmentGroups={NO_SHIPMENT_GROUPS}
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
      <ItemsTable receiptRows={NO_RECEIPTS} shipmentGroups={NO_SHIPMENT_GROUPS}
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
