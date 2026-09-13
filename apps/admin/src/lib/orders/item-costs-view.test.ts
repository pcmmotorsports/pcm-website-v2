import { describe, expect, it } from 'vitest';
import {
  COST_ROWS_MAX,
  computeItemCostTwd,
  parseCostAmountInput,
  parseCostRowsField,
  trimAmount,
} from './item-costs-view';

// item-costs-view.test.ts — 「老闆:成本」純函式。錢的路:每一格都是「算錯會讓老闆看到錯的利潤」。
// 🔴 台幣總計只 round 一次,公式與 20260914010000 檔頭同一句:round((price + shipping + tax × qty) × fx)。

const UUID = '0f9a3c2e-1b4d-4e6f-8a9b-0c1d2e3f4a5b';

describe('computeItemCostTwd', () => {
  it('公式:原價 + 運費整列一個數,稅金 × 數量,再乘匯率,四捨五入到整數元', () => {
    // (100 + 10 + 2.5 × 4) × 35.123456 = 120 × 35.123456 = 4214.81472 ⇒ 4215
    const r = computeItemCostTwd(
      { costPrice: '100.0000', costShipping: '10.0000', costTax: '2.5000', fxRate: '35.123456' },
      { quantity: 4, lineTotal: 6000 },
    );
    expect(r).toEqual({ costTwd: 4215, profitTwd: 1785 });
  });

  it('只 round 一次:0.5 進位,0.4999 不進;中間不掉精度', () => {
    // 1.0001 × 0.5 = 0.50005 ⇒ 1(不是先把 1.0001 round 成 1 再乘 0.5 = 0.5 ⇒ 依 float 可能 0)
    expect(computeItemCostTwd({ costPrice: '1.0001', costShipping: '0', costTax: '0', fxRate: '0.5' }, { quantity: 1, lineTotal: 10 })).toEqual({ costTwd: 1, profitTwd: 9 });
    // 0.9999 × 0.5 = 0.49995 ⇒ 0
    expect(computeItemCostTwd({ costPrice: '0.9999', costShipping: '0', costTax: '0', fxRate: '0.5' }, { quantity: 1, lineTotal: 10 })).toEqual({ costTwd: 0, profitTwd: 10 });
    // 經典 float 陷阱:0.1 + 0.2 之類 —— 定點 BigInt 不會 2.675 × 1 = 2.67
    expect(computeItemCostTwd({ costPrice: '2.5', costShipping: '0', costTax: '0', fxRate: '1' }, { quantity: 1, lineTotal: 10 })).toEqual({ costTwd: 3, profitTwd: 7 });
  });

  it('TWD:匯率 1,數字原樣;數量 0 ⇒ 稅金貢獻 0', () => {
    expect(computeItemCostTwd({ costPrice: '1200', costShipping: '80', costTax: '999', fxRate: '1' }, { quantity: 0, lineTotal: 1500 })).toEqual({ costTwd: 1280, profitTwd: 220 });
  });

  it('利潤可以是負的(成本大於售價)', () => {
    expect(computeItemCostTwd({ costPrice: '100', costShipping: '0', costTax: '0', fxRate: '40' }, { quantity: 1, lineTotal: 3000 })).toEqual({ costTwd: 4000, profitTwd: -1000 });
  });

  it('壞輸入 ⇒ null(印「—」不印 0):非數字 / 負數 / 超過 scale / 匯率 7 位小數 / 數量不是整數', () => {
    const ok = { costPrice: '1', costShipping: '0', costTax: '0', fxRate: '1' };
    expect(computeItemCostTwd({ ...ok, costPrice: 'abc' }, { quantity: 1, lineTotal: 1 })).toBeNull();
    expect(computeItemCostTwd({ ...ok, costPrice: '-1' }, { quantity: 1, lineTotal: 1 })).toBeNull();
    expect(computeItemCostTwd({ ...ok, costPrice: '1.00001' }, { quantity: 1, lineTotal: 1 })).toBeNull();
    expect(computeItemCostTwd({ ...ok, fxRate: '1.1234567' }, { quantity: 1, lineTotal: 1 })).toBeNull();
    // 尾 0 不算精度(DB numeric 會吐 `35.1234560`)
    expect(computeItemCostTwd({ ...ok, costPrice: '100', fxRate: '35.1234560' }, { quantity: 1, lineTotal: 5000 })).toEqual({ costTwd: 3512, profitTwd: 1488 });
    expect(computeItemCostTwd({ ...ok, costPrice: '1.00000' }, { quantity: 1, lineTotal: 5 })).toEqual({ costTwd: 1, profitTwd: 4 });
    expect(computeItemCostTwd(ok, { quantity: 1.5, lineTotal: 1 })).toBeNull();
    expect(computeItemCostTwd(ok, { quantity: -1, lineTotal: 1 })).toBeNull();
    expect(computeItemCostTwd(ok, { quantity: 1, lineTotal: Number.NaN })).toBeNull();
  });
});

describe('parseCostAmountInput', () => {
  it('缺 / 空 ⇒ 0;合法字串原樣(去頭尾空白);不合法 ⇒ null', () => {
    expect(parseCostAmountInput(undefined)).toBe('0');
    expect(parseCostAmountInput(null)).toBe('0');
    expect(parseCostAmountInput('')).toBe('0');
    expect(parseCostAmountInput('  ')).toBe('0');
    expect(parseCostAmountInput(' 12.3400 ')).toBe('12.3400');
    expect(parseCostAmountInput('0')).toBe('0');
    for (const bad of ['-1', '1.12345', '1e3', 'abc', '12,000', '.5', '5.', '12345678901', 12 as unknown]) {
      expect(parseCostAmountInput(bad), String(bad)).toBeNull();
    }
  });
});

describe('parseCostRowsField', () => {
  const good = JSON.stringify([{ orderItemId: UUID.toUpperCase(), costPrice: '10', costShipping: '', costTax: '1.5', currency: 'EUR' }]);

  it('合法一列:id 轉小寫、空金額補 0', () => {
    expect(parseCostRowsField(good)).toEqual([
      { orderItemId: UUID, costPrice: '10', costShipping: '0', costTax: '1.5', currency: 'EUR' },
    ]);
  });

  it('任何一列不合法 ⇒ 整包 null(不寫一半)', () => {
    const rows = [
      { orderItemId: UUID, costPrice: '10', costShipping: '0', costTax: '0', currency: 'EUR' },
      { orderItemId: UUID, costPrice: '-1', costShipping: '0', costTax: '0', currency: 'EUR' },
    ];
    expect(parseCostRowsField(JSON.stringify(rows))).toBeNull();
  });

  it('外形不對 ⇒ null:非字串 / 壞 JSON / 空陣列 / 非陣列 / 超過上限 / 壞 uuid / 幣別不在白名單', () => {
    expect(parseCostRowsField(undefined)).toBeNull();
    expect(parseCostRowsField('')).toBeNull();
    expect(parseCostRowsField('{')).toBeNull();
    expect(parseCostRowsField('[]')).toBeNull();
    expect(parseCostRowsField('{"a":1}')).toBeNull();
    expect(parseCostRowsField('[1]')).toBeNull();
    expect(parseCostRowsField(JSON.stringify([{ orderItemId: 'not-a-uuid', currency: 'EUR' }]))).toBeNull();
    expect(parseCostRowsField(JSON.stringify([{ orderItemId: UUID, currency: 'XXX' }]))).toBeNull();
    const tooMany = Array.from({ length: COST_ROWS_MAX + 1 }, () => ({ orderItemId: UUID, currency: 'TWD' }));
    expect(parseCostRowsField(JSON.stringify(tooMany))).toBeNull();
    expect(parseCostRowsField(JSON.stringify(tooMany.slice(0, COST_ROWS_MAX)))).toHaveLength(COST_ROWS_MAX);
  });
});

describe('trimAmount', () => {
  it('去尾 0,不動非數字', () => {
    expect(trimAmount('100.5000')).toBe('100.5');
    expect(trimAmount('0.0000')).toBe('0');
    expect(trimAmount('12')).toBe('12');
    expect(trimAmount('—')).toBe('—');
  });
});
