import { describe, expect, it } from 'vitest';
import type { AdminOrderDetailItem } from '@pcm/domain';
import { lineAmount, sectionSubtotal, shipmentReadsAreConsistent } from './shipping-doc-amounts';

// #10 片4b:出貨單的**金額算式**。**不渲染任何東西** ——
// 這裡只問「算得對不對」,「畫面有沒有印出來」在
// `app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx`。
//
// 🔴🔴 **每一格的規矩:先寫下「這一格若壞了,是哪一種壞法」,再寫斷言。**
//    沒有負向對照的正向格,在「函式永遠回同一個值」的世界裡一樣全綠。

// 🔴 **單價刻意用質數 74183** —— 與數量相乘之後的積**不會與任何一個輸入撞號**,
//    ⇒ 若有人把 `× qty` 寫成 `× 1` 或回傳 `unitPrice` 本身,這裡會得到不同的數。
//    ⚠️ 第一版我用了 100:`100 × 3 = 300` 而 `100 × 1 = 100` —— 看得出差別,
//       但**整除的漂亮數字會讓「少乘了一次」在心算上讀起來合理**。質數不會。
const priced = (amount: number): Pick<AdminOrderDetailItem, 'unitPrice'> =>
  ({ unitPrice: { amount, currency: 'TWD' } }) as unknown as Pick<
    AdminOrderDetailItem,
    'unitPrice'
  >;

describe('lineAmount —— 單價 × 本區數量,零浮點', () => {
  it('整數 × 整數', () => {
    expect(lineAmount(priced(74183), 3)).toBe(222549);
    // 🔴 **負向對照:證明它真的乘了本區數量,不是回單價、也不是回行小計。**
    expect(lineAmount(priced(74183), 3)).not.toBe(74183);
    // 🔴 **零浮點**:結果必須是整數(`Q-D-7` 硬條款)。
    expect(Number.isInteger(lineAmount(priced(74183), 3))).toBe(true);
  });

  it('數量 0 ⇒ 0(這是「真的是 0 件」,與「不知道」不同)', () => {
    expect(lineAmount(priced(74183), 0)).toBe(0);
  });

  it('🔴🔴 拿不到 unitPrice ⇒ null,【不 throw】—— 不印錢,不是不印紙', () => {
    // 型別說 `unitPrice` 一定在,而這一格守的是「合約被違反時我們往哪一邊倒」。
    // 🔴 這張紙最主要的職責(要出哪幾件)不需要錢 ⇒ 少一個欄位不該讓整張紙印不出來。
    // 📎 這一格是 `page.test.tsx` 250 項那個負向對照打出來的真 TypeError,不是我想出來的。
    expect(lineAmount({} as never, 3)).toBeNull();
    expect(lineAmount({ unitPrice: undefined } as never, 3)).toBeNull();
    // 🔴 負向對照:證明它是「回 null」不是「回 0」——後者會在紙上印一個 0。
    expect(lineAmount({} as never, 3)).not.toBe(0);
  });

  it('🔴 數量 null ⇒ null,【絕不補 0】', () => {
    expect(lineAmount(priced(74183), null)).toBeNull();
    // 🔴 **負向對照:分辨 `null` 與 `0`。**
    //    補 0 的症狀是紙上印一個看起來正常的金額而它少算了 ⇒ 這一格就是在擋那個。
    expect(lineAmount(priced(74183), null)).not.toBe(0);
  });
});

describe('sectionSubtotal —— fail-closed:有一列不知道,整區不印', () => {
  it('全部知道 ⇒ 相加', () => {
    expect(sectionSubtotal([222549, 611, 1])).toBe(223161);
  });

  it('🔴🔴 有 null ⇒ 整區 null,【不是把它濾掉再加剩下的】', () => {
    expect(sectionSubtotal([222549, null, 611])).toBeNull();
    // 🔴🔴 **這一行是本檔最重要的斷言。**
    //    最容易被「修好」成錯的寫法是 `.filter(v => v !== null)` ——
    //    那樣會得到 223160,而 **223160 看起來完全正常、而且偏低**(少報)。
    //    ⇒ 明寫那個「錯的答案」,讓下一個人改壞時看到的是它,不是一句 `expected null`。
    expect(sectionSubtotal([222549, null, 611])).not.toBe(223160);
  });

  it('🔴 空集合 ⇒ null,不回 0', () => {
    // 「這一區沒有東西」與「這一區值 0 元」是兩件事;
    // 回 0 會讓紙上出現一個它的標籤沒有宣稱過的數字。
    expect(sectionSubtotal([])).toBeNull();
    expect(sectionSubtotal([])).not.toBe(0);
  });

  it('全部是 null ⇒ null(不要因為「一個都沒加到」而回 0)', () => {
    expect(sectionSubtotal([null, null])).toBeNull();
  });
});

describe('shipmentReadsAreConsistent —— §9⑦ 兩次讀不一致就不印金額', () => {
  const line = (thisShipmentQuantity: number, shippedQuantity: number | null) => ({
    thisShipmentQuantity,
    shippedQuantity,
  });

  it('箱還沒標記出貨 ⇒ 這個競態的簽名不成立 ⇒ 放行', () => {
    // `shippedQuantity` 本來就不該含本箱 ⇒ 小於本箱的量是正常的,不是陳舊讀。
    expect(
      shipmentReadsAreConsistent({ thisShipmentShipped: false, lines: [line(2, 0)] }),
    ).toBe(true);
  });

  it('已出貨且 shippedQuantity 含得下本箱 ⇒ 放行', () => {
    expect(shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, 2)] })).toBe(
      true,
    );
    // 跨多箱:本箱 2、總共已出 5 ⇒ 含得下。
    expect(shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, 5)] })).toBe(
      true,
    );
  });

  it('🔴🔴 已出貨、而 shippedQuantity 還沒算到本箱 ⇒ 陳舊讀 ⇒ 不印金額', () => {
    // 這就是那個競態的簽名:新的 `shippedAt` 配舊的 `shippedQuantity`。
    expect(shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, 0)] })).toBe(
      false,
    );
    expect(shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, 1)] })).toBe(
      false,
    );
  });

  it('🔴 只要【任一列】不一致就整張不印(不是只擋那一列)', () => {
    // 一列對得上、一列對不上 ⇒ 仍然 false。
    // 🔴 沒有這一格,「只看第一列」與「看全部」在單列測資上印同一個答案。
    expect(
      shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, 9), line(3, 0)] }),
    ).toBe(false);
    // 正向對照:同樣兩列、把壞的那列修好 ⇒ true ⇒ 證明上面那個 false 不是因為「兩列就必假」。
    expect(
      shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, 9), line(3, 3)] }),
    ).toBe(true);
  });

  it('🔴🔴 shippedQuantity 是 null(不知道)⇒ 判【不一致】,不是放行', () => {
    // 最容易寫反的一行:`?? Infinity` / `?? 0` 之類會讓「不知道」變成「通過」。
    expect(shipmentReadsAreConsistent({ thisShipmentShipped: true, lines: [line(2, null)] })).toBe(
      false,
    );
  });
});
