import { describe, expect, it } from 'vitest';
import type { AdminOrderDetailItem } from '@pcm/domain';
import { cancelledQuantityOf, outstandingQuantity } from './shipping-doc-quantities';

// #10 出貨單的數量算式。**不渲染任何東西** —— 這裡只問「算得對不對」,
// 「畫面有沒有印出來」在 `app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx`。
//
// 🔴🔴 **六個數量欄【真的兩兩不同】**:9 / 8 / 4 / 1 / 2 / 3。
//    ⚠️ 第一版我寫了「刻意兩兩不同」而 `quantity` 與 `orderedQuantity` 都是 5、
//       `shipped` 與 `cancellable` 都是 2 —— **宣稱與事實不符,而且那兩組正好是最容易抄錯的**
//       (codex 對抗審查 2026-08-16 抓的)。現在真的沒有重複值 ⇒ 取錯任何一欄都會得到不同的數。
const item = (over: Partial<Record<string, number>> = {}): AdminOrderDetailItem =>
  ({
    id: 'it-1',
    variantSku: 'LTC-BK-XL',
    quantitySummary: {
      quantity: 9,
      orderedQuantity: 8,
      instockQuantity: 4,
      cancelledQuantity: 1,
      shippedQuantity: 2,
      cancellableQuantity: 3,
      ...over,
    },
  }) as unknown as AdminOrderDetailItem;

const nullSummary = { ...item(), quantitySummary: null } as unknown as AdminOrderDetailItem;

describe('outstandingQuantity — 還欠客人幾件(四項算式)', () => {
  const call = (over: Partial<Record<string, number>>, thisBox: number, shipped = false) =>
    outstandingQuantity({
      item: item(over),
      thisShipmentQuantity: thisBox,
      thisShipmentShipped: shipped,
    });

  it('🔴 摘要 null ⇒ 回 null(「不知道」不是「都是 0」)', () => {
    expect(
      outstandingQuantity({
        item: nullSummary,
        thisShipmentQuantity: 1,
        thisShipmentShipped: false,
      }),
    ).toBeNull();
  });

  it('🔴 算式 = 買的 − 取消的 − 已出貨的 − 這一箱要寄的', () => {
    // 9 − 1 − 2 − 3 = 3。六個欄位兩兩不同 ⇒ 取錯任一欄都不會是 3。
    expect(call({}, 3)).toBe(3);
    // 🔴 第四項不扣就會得到 6 —— 那正是本片之前的行為。
    expect(call({}, 0)).toBe(6);
  });

  it('🔴🔴 這一箱【已標記出貨】⇒ 不再扣一次(否則補印那張紙會把 3 印成 1)', () => {
    // shipped 已含這一箱 ⇒ 5 − 0 − 2 − 0 = 3
    expect(call({ quantity: 5, cancelledQuantity: 0, shippedQuantity: 2 }, 2, true)).toBe(3);
    // 🔴 同一份資料只把旗標翻成 false ⇒ 重複扣 ⇒ 1。兩個數必須不同,
    //    否則這個參數等於沒作用(而它是唯一防「補印算錯」的東西)。
    expect(call({ quantity: 5, cancelledQuantity: 0, shippedQuantity: 2 }, 2, false)).toBe(1);
  });

  it('🔴 Sean 的驗收現象:分三批出完之後,最後一批的「尚未出貨」必須是 0', () => {
    // 逐字:「第二或這第三批 出到沒貨時 尚未出貨那邊就空了就好,代表出完了。」
    // 訂購 5、取消 0、分三批 2/2/1;印每一批時前面幾批都已標記出貨。
    const batch = (shipped: number, thisBox: number) =>
      call({ quantity: 5, cancelledQuantity: 0, shippedQuantity: shipped }, thisBox);
    expect(batch(0, 2)).toBe(3);
    expect(batch(2, 2)).toBe(1);
    // 🔴 這一格就是他那句話。三項算式(不扣這一箱)在這裡會得到 4,永遠空不了。
    expect(batch(4, 1)).toBe(0);
  });

  it('🔴🔴 其他【還沒出貨的箱】刻意【不扣】—— 方向選「多報」不選「少報」', () => {
    // 訂購 5:A 箱裝 2(正在寄,就是這張紙)/ B 箱裝 3(還是草稿)。
    // 本函式只看這一箱 ⇒ 5−0−0−2 = 3,B 箱那 3 件仍算「還欠客人」。
    expect(call({ quantity: 5, cancelledQuantity: 0, shippedQuantity: 0 }, 2)).toBe(3);
    // 🔴 若改成「扣掉全部待出貨的箱」(2+3=5)⇒ 0 ⇒ 紙上會印「沒有還欠客人的品項」= 少報。
    //    ⚠️ 我一度真的改成那樣(codex 第一輪之後),而 B 箱可能延後或作廢
    //       ⇒ 客人以為收齊了,那 3 件沒有人會再提起。**這一格就是那次過度修正的負向對照。**
    expect(call({ quantity: 5, cancelledQuantity: 0, shippedQuantity: 0 }, 5)).toBe(0);
  });

  it('不會變成負數(前三項有 CHECK,第四項來自另一張表)', () => {
    expect(call({ quantity: 5, cancelledQuantity: 0, shippedQuantity: 5 }, 5)).toBe(0);
  });

  it('🔴 不是 pickableQuantity —— 沒到貨的照樣欠客人', () => {
    // instock 0(貨還沒從供應商到)⇒ 揀貨單「應揀 0」,但客人還是欠 5 件。
    expect(
      call({ quantity: 5, instockQuantity: 0, cancelledQuantity: 0, shippedQuantity: 0 }, 0),
    ).toBe(5);
  });
});

describe('cancelledQuantityOf — 第三區「訂單取消」的量', () => {
  it('取消量原樣回傳', () => {
    expect(cancelledQuantityOf(item())).toBe(1);
  });

  it('🔴 摘要 null ⇒ null,**不是 0** —— 不知道有沒有取消,不能說它沒被取消', () => {
    expect(cancelledQuantityOf(nullSummary)).toBeNull();
  });
});
