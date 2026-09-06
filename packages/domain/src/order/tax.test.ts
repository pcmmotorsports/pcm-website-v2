import { describe, it, expect } from 'vitest';
import { computeTax, VAT_RATE } from './tax';

/**
 * ⟦auth-DEALERTIERPRICING⟧ M-2-08 後半-B 純函式 —— **每一格對應一條拍板或一條查證**。
 * 🛑 這一族**不驗畫面、不驗誰是經銷** —— 那是接線那一顆的事。
 */
describe('computeTax(經銷單/未稅列)', () => {
  it('🔴 依據 Q24(:1589)刷卡 ⇒ 外加 5%', () => {
    // 1000 + 100 = 1100 · ×5% = 55
    expect(computeTax({ subtotalUntaxed: 1000, shippingUntaxed: 100, paymentMethod: 'card' }))
      .toEqual({ taxableBase: 1100, tax: 55, total: 1155 });
  });

  it('🔴 依據 Q24(:1589)匯款 ⇒ 不加稅', () => {
    expect(
      computeTax({ subtotalUntaxed: 1000, shippingUntaxed: 100, paymentMethod: 'bank_transfer' }),
    ).toEqual({ taxableBase: 1100, tax: 0, total: 1100 });
  });

  it('🔴 依據 :441 稅基【含運費】—— 少了運費那一項會少收', () => {
    const withShip = computeTax({ subtotalUntaxed: 1000, shippingUntaxed: 100, paymentMethod: 'card' });
    const noShip = computeTax({ subtotalUntaxed: 1000, shippingUntaxed: 0, paymentMethod: 'card' });
    expect(withShip.tax, '運費 100 ⇒ 稅要多 5 元').toBe(noShip.tax + 5);
    expect(withShip.taxableBase).toBe(1100);
  });

  it('🔴 捨入:整單【一次】四捨五入(查證定案, 非逐列)', () => {
    // 逐列會是 round(333×0.05)×3 = 17×3 = 51;整單一次是 round(999×0.05) = round(49.95) = 50
    const oneShot = computeTax({ subtotalUntaxed: 999, shippingUntaxed: 0, paymentMethod: 'card' });
    expect(oneShot.tax, '整單一次 ⇒ 50;若有人改成逐列會變 51').toBe(50);
  });

  it('🔴 .5 往上(四捨五入, 營業稅法 §14)', () => {
    // 210 × 0.05 = 10.5 ⇒ 11
    expect(computeTax({ subtotalUntaxed: 210, shippingUntaxed: 0, paymentMethod: 'card' }).tax).toBe(11);
    // 190 × 0.05 = 9.5 ⇒ 10
    expect(computeTax({ subtotalUntaxed: 190, shippingUntaxed: 0, paymentMethod: 'card' }).tax).toBe(10);
  });

  it('🟢 負對照:零元的單 ⇒ 稅 0(它不是「恆加 5%」)', () => {
    expect(computeTax({ subtotalUntaxed: 0, shippingUntaxed: 0, paymentMethod: 'card' }))
      .toEqual({ taxableBase: 0, tax: 0, total: 0 });
  });

  it('🟢 負對照:折扣大於小計 ⇒ 稅基夾到 0, 不得回負稅', () => {
    const r = computeTax({
      subtotalUntaxed: 100, shippingUntaxed: 0, paymentMethod: 'card', discountUntaxed: 999,
    });
    expect(r.taxableBase, '負稅基要夾到 0').toBe(0);
    expect(r.tax, '不得出現負的稅').toBe(0);
    expect(r.total).toBe(0);
  });

  it('🔬 稅率是常數不是字面 —— 兩邊必須是同一顆', () => {
    // 🛑 少了這一格, 有人把函式裡的 0.05 改成 0.055 而測試的期望值是手打的 ⇒ 一起改就全綠。
    expect(VAT_RATE).toBe(0.05);
    expect(computeTax({ subtotalUntaxed: 1000, shippingUntaxed: 0, paymentMethod: 'card' }).tax)
      .toBe(Math.round(1000 * VAT_RATE));
  });
});
