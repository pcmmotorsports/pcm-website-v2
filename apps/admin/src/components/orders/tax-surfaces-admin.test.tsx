// @vitest-environment jsdom
//
// ⟦b4-TAXSURFACES⟧ 題 B(Sean 2026-09-05 拍甲)· **後台三個金額面的稅額列與「小計(未稅)」**
//
// 🔬 **受詞是三個, 而它們共用同一條 `ADMIN_ORDER_DETAIL_SELECT`** ——
//    出貨單 `print/shipping-doc.tsx` · 訂單明細 `print/picking-doc.tsx` ·
//    後台訂單詳情 `orders/order-detail-items-support.tsx` 的 `ItemsTotals`。
//    ⇒ 📌 一條 select 加一次三個面都通, 而**那正是題 B 能一起問的理由**。
//
// 🔴🔴 **每一面都問【兩個世界】** —— 今天每一張單的稅都是 0(價格含稅),
//    只驗有稅那一格的話, **今天的世界從來沒被測過**, 而它才是每天在跑的那一個。
//
// 🛑 **本檔不量版面** —— 稅額列會不會把紙擠到第二頁, 那是真 chromium 那一層的事
//    (`print-doc-cascade-browser.test.tsx`)。這裡只量**字面與有無**。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
import { PickingDoc } from '../print/picking-doc';
import { ShippingDoc } from '../print/shipping-doc';
import { ItemsTotals } from './order-detail-items-support';

afterEach(cleanup);

const money = (n: number) => ({ amount: n as never, currency: 'TWD' as const });

/**
 * 🔵 形狀抄 `print/picking-doc-phone.test.tsx:11-58`, 不自己發明一份 ——
 *    兩份 fixture 分岔時, 分岔本身不會有東西叫。
 * 🔴 **有稅那一版必須平衡**:12000 + 100 − 50 + tax = total。
 *    不平衡的單違反 DB 的金額等式、正式庫寫不進去 ⇒ 拿它量等於量一個不存在的世界。
 */
function detail(tax: number): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    displayId: 'PCM-2099-0001',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'storefront',
    paymentChannel: 'tappay',
    paymentMethod: 'tappay',
    paidAt: '2099-04-15T10:00:00Z',
    subtotal: money(12000),
    shippingFee: money(100),
    discountTotal: money(50),
    taxTotal: money(tax),
    total: money(12050 + tax),
    shippingMethod: 'home',
    shippingAddress: { name: '收件人', phone: '0912345678', line: '新北市新莊區化成路736巷18號' },
    customerUserId: '22222222-2222-4222-8222-222222222222',
    customer: { name: '探針客人', email: 'a@b.c', phone: '0912345678' },
    invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: '/ABC1234', donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'pending',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    // 🔴 **一定要有品項** —— `picking-doc.tsx:504` 是 `{detail.items.length === 0 ? 空狀態 : (…)}`,
    //    而**金額區在 else 那一支** ⇒ 空清單的 fixture 量不到任何一格金額。
    //    📌 我第一版就是空的, 而四格全紅 —— 紅的理由與它們要守的東西無關。
    items: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        variantSku: 'LTC-BK-XL',
        title: '前叉防甩頭',
        spec: { 顏色: '黑' },
        quantity: 1,
        unitPrice: money(12000),
        lineTotal: money(12000),
        procurements: [],
        procurementTruncated: false,
        quantitySummary: null,
      },
    ],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

/**
 * 🔵 出貨單的 props 比另外兩個多。形狀抄 `print/print-doc-cascade-browser.test.tsx:121-168`,
 *    不自己發明 —— 兩份 fixture 分岔時, 分岔本身不會有東西叫。
 * 🔴 `voidedAt: null` 少了會被讀成 `undefined !== null` ⇒ **整張紙走阻印分支**,
 *    而那時金額區根本不渲染 ⇒ 這裡每一格都會紅在無關的理由上。(那支檔逐字記過這件事。)
 */
const SHIP_ITEM = {
  id: 'i1',
  variantSku: 'LTC-BK-XL',
  title: '前叉防甩頭',
  spec: { 顏色: '黑' },
  quantity: 1,
  unitPrice: money(12000),
  lineTotal: money(12000),
  quantitySummary: null,
} as never;

const SHIPMENT = {
  id: 's1',
  shipmentReference: 'K7X2MP',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: '6412345678',
  shippedAt: '2026-08-16T02:00:00Z',
  voidedAt: null,
  voidReason: null,
  recipientSnapshot: { name: '王小明', phone: '0912345678', line: '台北市信義區松高路 1 號' },
} as never;

const shipDoc = (tax: number) =>
  render(
    <ShippingDoc
      detail={detail(tax)}
      items={[SHIP_ITEM]}
      reportedTotal={1}
      shipment={SHIPMENT}
      lines={[{ orderItemId: 'i1', quantity: 1 }] as never}
    />,
  );

const SURFACES = [
  ['訂單明細(紙)', (d: AdminOrderDetail) => render(<PickingDoc detail={d} />)],
  ['後台訂單詳情', (d: AdminOrderDetail) => render(<ItemsTotals detail={d} />)],
] as const;

describe('題 B · 後台金額面:稅額列與「小計(未稅)」', () => {
  for (const [name, mount] of SURFACES) {
    it(`🔵 ${name}:稅 0(= 今天每一張單)⇒ 不印「稅額」, 標籤維持「小計」`, () => {
      const { container } = mount(detail(0));
      expect(container.textContent).not.toContain('稅額');
      expect(container.textContent).toContain('小計');
      expect(container.textContent).not.toContain('小計(未稅)');
    });

    it(`🔴 ${name}:稅 > 0 ⇒ 印出「稅額」與那個數, 標籤變「小計(未稅)」`, () => {
      // 🔬 值用四位數 —— 三位數時「有沒有千分位」印同一個東西。
      const { container } = mount(detail(1605));
      expect(container.textContent).toContain('稅額');
      expect(container.textContent).toContain('1,605');
      expect(container.textContent).toContain('小計(未稅)');
    });
  }

  // 🔴🔴 出貨單另外處理 —— 它的 props 比另外兩個多(要 shipment / groups),
  //    而**把它硬塞進上面那個迴圈會讓 fixture 為了它變形** ⇒ 分開寫, 兩個世界照樣各一格。
  it('🔵 出貨單:稅 0 ⇒ 不印「稅額」, 標籤維持「小計」', () => {
    const { container } = shipDoc(0);
    expect(container.textContent).not.toContain('稅額');
    expect(container.textContent).not.toContain('小計(未稅)');
  });

  it('🔴 出貨單:稅 > 0 ⇒ 印出「稅額」與那個數, 標籤變「小計(未稅)」', () => {
    const { container } = shipDoc(1605);
    expect(container.textContent).toContain('稅額');
    expect(container.textContent).toContain('1,605');
    expect(container.textContent).toContain('小計(未稅)');
  });

  it('🔴 負稅【不算有稅】—— 把判準換成 `!== 0` 的實作要在這裡紅', () => {
    // ⚠️ 這裡造得出來(本檔的 money() 是 `as never` 不經 toMoneyAmount)——
    //    而顧客站那三個面**造不出來**(那邊走 branded type, 負數在建構時就 throw)。
    //    📌 兩邊的守門位置因此不同, 而那不是不一致, 是**型別在一邊擋掉了、另一邊沒有**。
    const { container } = render(<ItemsTotals detail={detail(-1)} />);
    expect(container.textContent).not.toContain('稅額');
    expect(container.textContent).not.toContain('小計(未稅)');
  });
});
