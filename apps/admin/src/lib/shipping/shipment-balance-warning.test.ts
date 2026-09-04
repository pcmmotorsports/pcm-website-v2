// shipment-balance-warning.test.ts —— 建箱彈窗那句「尾款 X 元未收」的四態。
//
// 🔴 **本組釘的是【那句字】, 不是【看不看得見】** —— 「明顯」那半 jsdom 與純函式都證不到,
//   它要真瀏覽器量(座標 / 在視窗內 / 與送出鈕的距離), 而那份量測寫在 commit body 裡。
//
// 🔴 **斷言寫【字面值】不寫 import 來的常數** —— 從被測檔 import 期望值,
//   等於讓實作自己出考題:改壞了兩邊一起變, 而這一格照樣綠。
//
// 📌 **本檔 2026-09-04 從 `components/orders/shipment-section.test.tsx` 搬過來** ——
//   函式搬家(元件檔 ⇒ lib), 測試跟著搬。搬的理由在被測檔的檔頭。

import { describe, expect, it } from 'vitest';
import type { AdminOrderDetail } from '@pcm/domain';

import { shipmentBalanceWarning } from './shipment-balance-warning';

const detail = { id: 'o1', total: { amount: 5000 } } as unknown as AdminOrderDetail;
const paid = (...amounts: number[]) =>
  ({ status: 'ok', rows: amounts.map((amount, i) => ({ id: `p${i}`, amount })) }) as never;

describe('shipmentBalanceWarning', () => {
  it('🔴 還差錢 ⇒ 逐字「尾款 3,000 元未收」(帶「元」= Sean 的字面)', () => {
    // 🧬 突變:把 short 那一行拿掉 ⇒ 回 null ⇒ 這一格紅。
    // 🧬 突變:把「元」拿掉(改回頁面上那格的「尾款 N 未收」)⇒ 這一格也紅。
    expect(shipmentBalanceWarning(detail, paid(2000))).toBe('尾款 3,000 元未收');
  });

  it('🔴 已收足 ⇒ null(彈窗裡什麼都不印)', () => {
    // 🎯 這一格擋的是「一個恆常出現的提示等於沒有提示」——
    //    它會讓下一個人以為「這裡有在提醒」而不去查它有沒有在【該叫的時候】叫。
    // 🧬 突變:讓它無條件回一句話 ⇒ 這一格紅。
    expect(shipmentBalanceWarning(detail, paid(5000))).toBeNull();
  });

  it('🔵 溢收 ⇒ 也是 null —— 溢收不是出貨的風險', () => {
    expect(shipmentBalanceWarning(detail, paid(6000))).toBeNull();
  });

  it('⚠️ 讀不到收款明細 ⇒ 出聲, 而【這一態是實作者的判斷不是 Sean 的字】', () => {
    // 🛑 要推翻這個判斷 ⇒ 刪掉那個 if, 這一格會紅並指到被測檔的說明。
    const text = shipmentBalanceWarning(detail, { status: 'unreadable' });
    expect(text, '讀不到明細時彈窗一句話都不說 ⇒ 與「已收足」在畫面上長一樣').not.toBeNull();
    expect(text).toContain('尾款未知');
    expect(text, '不能印出一個數字 —— 那個數字必然是假的').not.toMatch(/\d/);
    // 🔴 codex MF2:它要說得出**下一步去哪裡看**, 否則那句話在兩個世界都成立而幫不了人做決定。
    expect(text, '沒講去哪裡看 ⇒ 那句提醒沒有辦法被結束').toContain('收款 · 退款');
  });

  it('⚠️ 訂單查無 ⇒ 與讀不到同一種處置(說我不知道, 不是說已收足)', () => {
    expect(shipmentBalanceWarning(detail, { status: 'order_not_found' })).toContain('尾款未知');
  });

  it('🟢 正對照:那個數字真的有參與運算(不是寫死的一句話)', () => {
    // 🎯 沒有這一格的話, 上面那幾格「剛好都對」與「函式回傳寫死」分不開。
    const a = shipmentBalanceWarning(detail, paid(1000));
    const b = shipmentBalanceWarning(detail, paid(2000));
    expect(a).toBe('尾款 4,000 元未收');
    expect(b).toBe('尾款 3,000 元未收');
    expect(a, '兩個不同的已收金額給出同一句話 ⇒ 那個數字沒有真的參與運算').not.toBe(b);
  });
});
