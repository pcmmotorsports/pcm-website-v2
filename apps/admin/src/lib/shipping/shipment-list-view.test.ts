import { describe, expect, it } from 'vitest';
import {
  canPrintLabel,
  isVoided,
  printOrderId,
  shipmentListDate,
  shipmentListOrders,
  shipmentListStatus,
  shipmentListTracking,
  type ShipmentListRow,
} from './shipment-list-view';

// shipment-list-view.test.ts —— 出貨清單語意層的守門。
//
// 🔴🔴 **這一支的 fixture 不是我編的,是 2026-09-10 唯讀正式庫的四箱全量。**
//    ⇒ 📌 那四箱剛好把這一頁所有的邊界都踩到了:
//      · 真的那一箱:`tracking_number` 空、`shipped_at` 空、只有新竹配號
//      · 三個作廢箱:有人手打的 `tracking_number`、有 `shipped_at`、而 `deleted_at` 也有
//    🎯 **⇒ 照字面接 DB 的話, Sean 最想看的那一箱兩欄都空白, 而作廢的箱反而滿的。**

const BASE: ShipmentListRow = {
  shipmentId: 's-1',
  shipmentReference: 'S9FC6P',
  carrierCode: 'hct',
  hctStatus: 'submitted',
  trackingNumber: null,
  hctRequestId: '8947081964',
  // 🔵 正式庫那四箱這兩欄都是 NULL —— 本片貼上去之前它們不存在。
  hctDispatchAttemptedAt: null,
  hctDispatchedAt: null,
  shippedAt: null,
  voidedAt: null,
  createdAt: '2026-09-10T02:59:51.117015Z',
  recipientName: '王小明',
  orders: [{ orderId: 'o-1', displayId: 'PCM-2026-0042' }],
};

/** 三個作廢箱那一族(正式庫真值:有人手貨號、有出貨時間、而且作廢了)。 */
const VOIDED: ShipmentListRow = {
  ...BASE,
  shipmentId: 's-2',
  shipmentReference: 'XS6XVY',
  hctStatus: 'draft',
  trackingNumber: '123123',
  hctRequestId: null,
  shippedAt: '2026-09-02T03:02:50.595357Z',
  voidedAt: '2026-09-02T03:26:54.764591Z',
  createdAt: '2026-09-02T03:02:50.482429Z',
};

describe('日期欄', () => {
  it('🔴 shippedAt 空 ⇒ 退回 createdAt,而【一定要帶那句小字】', () => {
    const d = shipmentListDate(BASE);
    expect(d.text).toBe(BASE.createdAt);
    // 🔴 這一格就是全部的意義:「沒有出貨日」與「還沒走到那一步」不可以印成同一個畫面。
    expect(d.note).not.toBeNull();
  });

  it('🟢 正對照:shippedAt 有值 ⇒ 用它,而且【沒有】小字(證明上面那個 note 不是恆真)', () => {
    const d = shipmentListDate(VOIDED);
    expect(d.text).toBe(VOIDED.shippedAt);
    expect(d.note).toBeNull();
  });
});

describe('貨號欄', () => {
  it('🔴 tracking_number 空 ⇒ 退回 hct_request_id(= 新竹配的貨號),而帶小字', () => {
    const t = shipmentListTracking(BASE);
    // 🔬 逐字就是 Sean 說「已經送出去」那一箱的貨號(2026-09-10 唯讀正式庫)。
    expect(t.text).toBe('8947081964');
    expect(t.note).toBe('新竹配號');
  });

  it('🟢 正對照:人手填的 tracking_number 蓋過系統值(否則員工改不動它)', () => {
    const t = shipmentListTracking({ ...VOIDED, hctRequestId: '9999999999' });
    expect(t.text).toBe('123123');
    expect(t.note).toBeNull();
  });

  it('🔴 兩個都沒有 ⇒ 印「尚未取得」,不是空白也不是「—」', () => {
    const t = shipmentListTracking({ ...BASE, trackingNumber: null, hctRequestId: null });
    expect(t.text).toBe('尚未取得');
  });

  it('🔵 只有空白字元的 tracking_number 要當成沒有(而不是印一格空白出來)', () => {
    const t = shipmentListTracking({ ...BASE, trackingNumber: '   ' });
    expect(t.text).toBe('8947081964');
  });
});

describe('狀態欄', () => {
  it('🔴🔴 作廢蓋過已出貨 —— 正式庫三個作廢箱【同時】有 shippedAt', () => {
    // 順序寫反的話,這三箱會被印成「已出貨」,而它們其實已經作廢。
    expect(shipmentListStatus(VOIDED)).toBe('已作廢');
  });

  it('🔵 新竹收單 ≠ 我們標記出貨 —— 兩者刻意分開', () => {
    expect(shipmentListStatus(BASE)).toBe('新竹已收單');
    expect(shipmentListStatus({ ...BASE, shippedAt: '2026-09-10T05:00:00Z' })).toBe('已出貨');
  });

  it('🟢 正對照:其餘落「已建立」(證明上面那幾格不是恆真)', () => {
    expect(shipmentListStatus({ ...BASE, hctStatus: 'draft', carrierCode: 'other' })).toBe('已建立');
  });
});

describe('訂單欄與列印網址', () => {
  it('🔴 列印用的 orderId【必須】是畫面上印出來的那一張', () => {
    const many: ShipmentListRow = {
      ...BASE,
      orders: [
        { orderId: 'o-a', displayId: 'PCM-2026-0001' },
        { orderId: 'o-b', displayId: 'PCM-2026-0002' },
      ],
    };
    const { first, moreCount } = shipmentListOrders(many);
    expect(first?.displayId).toBe('PCM-2026-0001');
    expect(moreCount).toBe(1);
    // 🔴 這一格是全部的意義:route 不信網址, 挑錯那張單 ⇒ 按下去 404,
    //    而員工會以為壞了 —— 其實是他看到 A、按到 B。
    expect(printOrderId(many)).toBe(first?.orderId);
  });

  it('🔵 一個 shipment_item 都沒有 ⇒ 沒有列印網址(不編一張假的出來)', () => {
    expect(printOrderId({ ...BASE, orders: [] })).toBeNull();
    expect(shipmentListOrders({ ...BASE, orders: [] }).first).toBeNull();
  });
});

describe('託運標籤那顆鈕', () => {
  it('🔴 只有 hct + submitted + 沒作廢 才給 —— 條件不放寬', () => {
    expect(canPrintLabel(BASE)).toBe(true);
    // 沒送新竹就沒有圖 ⇒ route 回 409 ⇒ 一顆按了必定失敗的鈕比不出現更糟。
    expect(canPrintLabel({ ...BASE, hctStatus: 'draft' })).toBe(false);
    expect(canPrintLabel({ ...BASE, carrierCode: 'other' })).toBe(false);
    expect(canPrintLabel({ ...BASE, voidedAt: '2026-09-10T06:00:00Z' })).toBe(false);
  });

  it('🟢 正對照:作廢判準本身會動(不是恆 false)', () => {
    expect(isVoided(BASE)).toBe(false);
    expect(isVoided(VOIDED)).toBe(true);
  });
});
