import { describe, expect, it } from 'vitest';
import type { OrderShipmentGroup } from '../shipping/order-shipments';
import {
  CANCEL_SHIPMENT_MESSAGE,
  cancelShipmentWarning,
} from './cancel-shipment-warning';

// cancel-shipment-warning.test.ts — 取消已出貨單那道閘的守門。
//
// 🔴🔴 **這支要證的核心有三句**:
//    ① 該擋的擋(已出貨 / 只有單號 / 讀不到)
//    ② 🔴 **該放的放** —— 沒有出貨、或箱已作廢 ⇒ **完全不擋**(誤擋率 0 是驗收條件)
//    ③ 三個「該擋」的世界印**三個不同的字** —— 因為看到的人下一步不同
//
// 🔴 **誠實邊界**:這是純函式測試, 它證得了判準, **證不到**呼叫端真的有呼叫它 ——
//    接線那半由 `cancel-view` / `cancel-actions` 那兩支自己的測試證。

function group(over: Partial<OrderShipmentGroup['shipment']>): OrderShipmentGroup {
  return {
    shipment: {
      id: 'sid',
      shipmentReference: 'BCDFGH',
      customerUserId: 'uid',
      carrierCode: 'hct',
      carrierNote: null,
      trackingNumber: null,
      shippedAt: null,
      voidedAt: null,
      voidReason: null,
      recipientSnapshot: { name: '', phone: '', line: '' },
      ...over,
    } as OrderShipmentGroup['shipment'],
    lines: [],
  };
}

describe('cancelShipmentWarning', () => {
  it('🟢 負對照:一箱都沒有 ⇒ 完全不擋(誤擋率 0 是驗收條件)', () => {
    expect(cancelShipmentWarning([])).toEqual({ blocked: false });
  });

  it('🟢 負對照:有箱而沒出貨也沒單號 ⇒ 不擋', () => {
    expect(cancelShipmentWarning([group({})])).toEqual({ blocked: false });
  });

  it('🔴🔴 已按過出貨 ⇒ 擋, 而話是【已經出貨】', () => {
    const w = cancelShipmentWarning([group({ shippedAt: '2026-09-03T00:00:00Z' })]);
    expect(w.blocked).toBe(true);
    expect(w).toMatchObject({ kind: 'shipped', message: CANCEL_SHIPMENT_MESSAGE.shipped });
  });

  it('🔴 只有託運單號 ⇒ 擋, 而話【不同】(不得共用「已經出貨」那句)', () => {
    const w = cancelShipmentWarning([group({ trackingNumber: '1234567890' })]);
    expect(w).toMatchObject({ kind: 'tracking_only' });
    expect(w.blocked && w.message).not.toBe(CANCEL_SHIPMENT_MESSAGE.shipped);
    // 🔴 它不准宣稱「已經出貨」—— 我們只知道有單號。
    expect(w.blocked && w.message).not.toContain('已經出貨');
  });

  it('🔴🔴 讀不到(null)⇒ 擋, 而話是【讀不到】不是【沒有出貨】', () => {
    const w = cancelShipmentWarning(null);
    expect(w).toMatchObject({ kind: 'unreadable' });
    // 🔴 這一格是本片最容易漏的:量不到 ≠ 沒有出貨。
    //    一個讀不到時安靜放行的閘, 正好會在最亂的那張單上放行。
    expect(w.blocked && w.message).toContain('讀不到');
  });

  // ⛔ ~~箱已作廢 ⇒ **不擋**(它不再代表任何一件在路上的貨)~~
  // 🔴🔴 **這一格 2026-09-03 翻面了, 而翻它的是 Sean 拍板, 不是我改期望值遷就實作。**
  //    ⇒ 而**原本那個期望值不是寫錯 —— 它守的是一個真的顧慮**:
  //      作廢過的單每次取消都要多按一次(**誤擋變多**)。那個代價今天還在, 只是 Sean 選了另一邊。
  //    🔬 而讓他改變答案的是一格當時沒有的資訊:「作廢」撤銷的是**我們系統裡的紀錄**,
  //      而**我們對貨運零呼叫** ⇒ 它不會讓那件貨自己回來。⇒ **箱被作廢 ≠ 貨被攔下來。**
  //    ⇒ 📌 舊期望值逐字留在這裡, 讓「為什麼曾經是不擋」有得查。
  it('🔴 箱已作廢 ⇒ **仍要擋**(作廢只撤我們的紀錄, 不會通知貨運;Sean 2026-09-03 拍甲)', () => {
    const voided = group({ shippedAt: '2026-09-03T00:00:00Z', voidedAt: '2026-09-03T01:00:00Z' });
    expect(cancelShipmentWarning([voided])).toMatchObject({ blocked: true, kind: 'shipped' });
  });

  // 🔵 這一格在翻面之後**判別力變弱了**(兩箱現在都會擋)—— 而它留著:
  //    它守的是「多箱時只要有一箱命中就擋」那條, 與作廢無關。
  it('🛑 一箱作廢一箱已出貨 ⇒ 照樣擋(只要還有一件在路上)', () => {
    const voided = group({ shippedAt: 'x', voidedAt: 'y' });
    const live = group({ id: 'sid2', shippedAt: '2026-09-03T00:00:00Z' });
    expect(cancelShipmentWarning([voided, live])).toMatchObject({ kind: 'shipped' });
  });

  // ══════════════════════════════════════════════════════════════════
  // 🔴🔴 空字串那一族 —— 今天早上才在別的片修過同一個形狀
  // ══════════════════════════════════════════════════════════════════
  it('🔴🔴 trackingNumber 是空字串 ⇒ **不擋**(空字串在這張表上是合法值)', () => {
    // DB 那道 shipments_shipped_needs_tracking 只在 shipped_at IS NOT NULL 時生效
    // ⇒ 還沒出貨的箱, tracking_number 可以是 '' 而沒有任何約束擋
    // ⇒ 只判 !== null 的話會產生一個【假的警示】, 而假警示會被人學會忽略。
    expect(cancelShipmentWarning([group({ trackingNumber: '' })])).toEqual({ blocked: false });
  });

  it('🔴 trackingNumber 只有空白 ⇒ 也不擋', () => {
    expect(cancelShipmentWarning([group({ trackingNumber: '   ' })])).toEqual({ blocked: false });
  });

  it('🔴 三個該擋的世界印【三個不同的字】—— 看到的人下一步不同', () => {
    const msgs = new Set([
      CANCEL_SHIPMENT_MESSAGE.shipped,
      CANCEL_SHIPMENT_MESSAGE.tracking_only,
      CANCEL_SHIPMENT_MESSAGE.unreadable,
    ]);
    expect(msgs.size).toBe(3);
  });

  it('🔴🔴 三句話都要說「我們不會自動通知」, 而【不准】說「攔不了」', () => {
    // -ship 2026-09-03 實測:新竹那台主機自列 24 支操作, 其中【有】TransDataCancel_Json
    // ⇒ 新竹攔得了, 是我們沒接線。
    // ⇒ 🎯 寫成「攔不了」的話, 員工不會去打那通電話 —— 而他本來還來得及攔。
    for (const m of Object.values(CANCEL_SHIPMENT_MESSAGE)) {
      expect(m).toContain('不會自動通知新竹攔件');
      expect(m).not.toContain('攔不下來');
      expect(m).not.toContain('不會被攔');
    }
  });
});
