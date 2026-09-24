import { describe, expect, it } from 'vitest';
import { applyDealerDiscount, findBelowCost, latestUnitCostByVariant, pickPreviewTrio } from './brand-discount-pricing';
import { computeUnitCostTwd } from '../orders/item-costs-view';

describe('折扣後價格(與資料庫 dealer_discount_apply 同一個算法)', () => {
  it('手算:7.5% ⇒ 1000→925、1234→1141、999→924、1500→1388(.5 進位)、0→0;沒有折扣 ⇒ 原價', () => {
    expect([1000, 1234, 999, 1500, 0].map((a) => applyDealerDiscount(a, 7.5))).toEqual([925, 1141, 924, 1388, 0]);
    expect(applyDealerDiscount(1000, null)).toBe(1000);
    expect(applyDealerDiscount(null, 5)).toBeNull();
  });
});

describe('單件台幣成本(B2B 計畫 §10.5 甲)', () => {
  it('(成本 + 運費 + 單件稅 × 數量) × 匯率 ÷ 數量, 最後才四捨五入一次', () => {
    // (100 + 20 + 5×3) × 35.5 ÷ 3 = 1597.5 ⇒ 1598
    expect(computeUnitCostTwd({ costPrice: '100', costShipping: '20', costTax: '5', fxRate: '35.5' }, 3)).toBe(1598);
    expect(computeUnitCostTwd({ costPrice: '100', costShipping: '0', costTax: '0', fxRate: '1' }, 0)).toBeNull();
    expect(computeUnitCostTwd({ costPrice: 'x', costShipping: '0', costTax: '0', fxRate: '1' }, 1)).toBeNull();
  });
});

describe('每個變體取最近一次登記的成本', () => {
  const row = (variantId: string | null, recordedAt: string, tieBreak: string, costPrice: string, quantity = 1) => ({
    variantId, quantity, recordedAt, tieBreak, costPrice, costShipping: '0', costTax: '0', fxRate: '10',
  });
  it('依登記時間由新到舊, 同變體只留最新;算不出來的略過', () => {
    const m = latestUnitCostByVariant([
      row('v1', '2026-09-01T00:00:00Z', 'a', '100'),
      row('v1', '2026-09-20T00:00:00Z', 'b', '120'),
      row('v2', '2026-09-10T00:00:00Z', 'c', '60', 2),
      row(null, '2026-09-10T00:00:00Z', 'd', '1'),
    ]);
    expect(m.get('v1')).toBe(1200);
    expect(m.get('v2')).toBe(300);
    expect(m.size).toBe(2);
  });
  it('🔴 Codex E4 R3:同一毫秒內先後登記, 用微秒分出新舊(不能當成同時)', () => {
    const older = row('v1', '2026-09-20T01:02:03.123100+00:00', 'zzz', '10');
    const newer = row('v1', '2026-09-20T01:02:03.123900+00:00', 'aaa', '90');
    expect(latestUnitCostByVariant([older, newer]).get('v1')).toBe(900);
    expect(latestUnitCostByVariant([newer, older]).get('v1')).toBe(900);
  });

  it('🔴 同一時間 ⇒ 固定順序(order_item_id 大的優先), 與資料回來的順序無關', () => {
    const a = row('v1', '2026-09-20T00:00:00Z', 'aaa', '10');
    const b = row('v1', '2026-09-20T00:00:00Z', 'bbb', '90');
    expect(latestUnitCostByVariant([a, b]).get('v1')).toBe(900);
    expect(latestUnitCostByVariant([b, a]).get('v1')).toBe(900);
  });
});

describe('低於成本的品牌(儲存時 server 重算)', () => {
  const variants = [
    { variantId: 'v1', brandId: 'A', dealerPrice: 1000 },
    { variantId: 'v2', brandId: 'A', dealerPrice: 2000 },
    { variantId: 'v3', brandId: 'B', dealerPrice: 1000 },
  ];
  const cost = new Map([
    ['v1', 900],
    ['v3', 990],
  ]);
  it('折扣後低於成本才算;沒有成本資料的變體不算;null(不打折)不查', () => {
    // A:1000 × 0.9 = 900, 不低於 900;A 12% ⇒ 880 < 900
    expect(findBelowCost(variants, cost, { A: 10 })).toEqual([]);
    expect(findBelowCost(variants, cost, { A: 12 })).toEqual(['A']);
    expect(findBelowCost(variants, cost, { A: 12, B: 5, C: 50 })).toEqual(['A', 'B']);
    expect(findBelowCost(variants, cost, { A: null })).toEqual([]);
  });
});

describe('預覽取三件:一般價最低、中間、最高', () => {
  it('不足三件就全列, 不重複', () => {
    expect(pickPreviewTrio(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'c', 'e']);
    expect(pickPreviewTrio(['a', 'b'])).toEqual(['a', 'b']);
    expect(pickPreviewTrio([])).toEqual([]);
  });
});
