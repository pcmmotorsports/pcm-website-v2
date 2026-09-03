import { describe, expect, it } from 'vitest';
import { receiptDeletability } from './receipt-deletable';
import type { OrderShipmentGroup } from '../shipping/order-shipments';

const ITEM = 'item-1';

function group(over: {
  ref?: string;
  shippedAt?: string | null;
  voidedAt?: string | null;
  itemId?: string;
}): OrderShipmentGroup {
  return {
    shipment: {
      id: `sh-${over.ref ?? 'A'}`,
      shipmentReference: over.ref ?? 'A',
      shippedAt: over.shippedAt ?? null,
      voidedAt: over.voidedAt ?? null,
    },
    lines: [{ orderItemId: over.itemId ?? ITEM, title: '零件', quantity: 1 }],
  } as unknown as OrderShipmentGroup;
}

// ⛔ ~~「撤不撤得掉」是【品項】的性質~~
// 🔴 **2026-09-03 codex 訂正:那是【假前提】。** DB 還有第二層守門(刪掉之後重算 instock,
//    與**那一筆的數量**有關)⇒ 同一品項底下不同筆可能不同。
// ⇒ ✅ 本模組因此**降級成【事前提醒】**:它只算得出包裹那一層, 而**消費端不得拿它去移除入口**。
describe('receiptDeletability — 包裹那一層的【事前提醒】(不是閘)', () => {
  it('🔴 沒有任何包裹 ⇒ 撤得掉', () => {
    expect(receiptDeletability([], ITEM)).toEqual({ blocked: false });
  });

  it('🔴 被包進一個【未出貨且未作廢】的包裹 ⇒ 擋, 而話裡要有包裹編號', () => {
    const w = receiptDeletability([group({ ref: 'SH-001' })], ITEM);
    expect(w.blocked).toBe(true);
    expect(w.blocked && w.shipmentRefs).toEqual(['SH-001']);
    // 🔴 Sean 2026-09-03 親筆那句 —— 逐字釘住, 因為它是定稿不是暫用字面。
    // 🔵 Sean 原話「…才刪得掉」是斷言, 而我們**證不到**它(數量那一層算不出來)
    //    ⇒ 字面改成帶「可以按按看」的提醒式。🛑 已回報主視窗, 不是我私自改他的字。
    expect(w.blocked && w.message).toContain('這個品項已經包進出貨單');
    expect(w.blocked && w.message).toContain('可以按按看');
    // 🎯 而編號要在 —— 同一個品項可能在多個包裹裡, 而「那個包裹」沒說是哪一個。
    expect(w.blocked && w.message).toContain('SH-001');
  });

  // 🔴🔴 **這兩格是我開工前標的那個未知, 量完的答案。**
  //    DB 那道守門逐字 `sh.shipped_at IS NULL AND sh.deleted_at IS NULL` ⇒ **兩種都不擋**。
  //    ⇒ 少了它們, 一個「只排除作廢」的實作(直覺上的『無效箱』)照樣全綠,
  //      而它會**多擋一些其實刪得掉的列** —— 而誤報會被學會忽略。
  it('🔵 已出貨的包裹 ⇒ **不擋**(貨都出去了, 那筆到貨沒有被它綁住)', () => {
    expect(receiptDeletability([group({ shippedAt: '2026-09-01T00:00:00Z' })], ITEM)).toEqual({
      blocked: false,
    });
  });

  it('🔵 已作廢的包裹 ⇒ **不擋**(它已經被處理過了)', () => {
    expect(receiptDeletability([group({ voidedAt: '2026-09-01T00:00:00Z' })], ITEM)).toEqual({
      blocked: false,
    });
  });

  it('🔵 負對照:包裹裝的是【別的品項】⇒ 不擋(這是品項級判定, 不是訂單級)', () => {
    expect(receiptDeletability([group({ itemId: 'item-2' })], ITEM)).toEqual({ blocked: false });
  });

  it('🔴 多個包裹擋著 ⇒ **全部列出**、升冪、去重(不能只講一個, 他要去作廢的可能不只一箱)', () => {
    const w = receiptDeletability(
      [group({ ref: 'SH-002' }), group({ ref: 'SH-001' }), group({ ref: 'SH-002' })],
      ITEM,
    );
    expect(w.blocked && w.shipmentRefs).toEqual(['SH-001', 'SH-002']);
  });

  it('🔴 一箱已出貨一箱未出貨 ⇒ 照樣擋, 而【只列未出貨那箱】', () => {
    const w = receiptDeletability(
      [group({ ref: 'SHIPPED', shippedAt: '2026-09-01T00:00:00Z' }), group({ ref: 'OPEN' })],
      ITEM,
    );
    expect(w.blocked && w.shipmentRefs).toEqual(['OPEN']);
  });

  it('🔴🔴 讀不到(null)⇒ 擋, 而那句話【不是】Sean 那句(它講的是另一件事)', () => {
    const w = receiptDeletability(null, ITEM);
    expect(w.blocked).toBe(true);
    expect(w.blocked && w.message).toContain('讀不到');
    // 🛑 量不到 ≠ 沒有包裹。一個讀不到時安靜放行的畫面, 會在最亂的那張單上說「可以撤」。
    expect(w.blocked && w.message).not.toContain('已經包進出貨單');
  });
});
