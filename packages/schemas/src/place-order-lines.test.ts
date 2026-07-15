// PlaceOrderLinesInput — V-3a vehicle 判別式驗證(選填;非法=丟欄不擋單=與 create_order RPC
// 白名單「失敗=NULL 不 RAISE」同構=值班台 REQUIRED-4;variantId 缺失=REJECT 整單維持不變)。

import { describe, it, expect } from 'vitest';
import { PlaceOrderLinesInput } from './index';

const V1 = '11111111-1111-4111-8111-111111111111'; // RFC 合規(zod v4 z.uuid() 驗 version/variant bits)
const line = (vehicle?: unknown) => [{ variantId: V1, quantity: 1, ...(vehicle !== undefined ? { vehicle } : {}) }];

function parsed(vehicle?: unknown) {
  const r = PlaceOrderLinesInput.safeParse(line(vehicle));
  if (!r.success) throw new Error('expected success');
  return r.data[0]!;
}

describe('PlaceOrderLinesInput — V-3a vehicle', () => {
  it('無 vehicle → 通過、無 vehicle 鍵(既有行為零變)', () => {
    expect(parsed().vehicle).toBeUndefined();
  });

  it('dict 合法 → 保留(year 選填)', () => {
    expect(parsed({ kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' }).vehicle)
      .toEqual({ kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' });
    expect(parsed({ kind: 'dict', brand: 'YAMAHA', model: 'MT-09', source: 'picker' }).vehicle)
      .toEqual({ kind: 'dict', brand: 'YAMAHA', model: 'MT-09', source: 'picker' });
  });

  it('free 合法 → 保留', () => {
    expect(parsed({ kind: 'free', raw: '阿嬤的野狼', source: 'freetext' }).vehicle)
      .toEqual({ kind: 'free', raw: '阿嬤的野狼', source: 'freetext' });
  });

  it('非法形狀 → vehicle 丟棄、單不擋(catch=RPC「白名單失敗=NULL 不擋單」同構)', () => {
    for (const bad of [
      { kind: 'weird', brand: 'YAMAHA', model: 'MT-09', source: 'search' }, // kind 亂值
      { kind: 'dict', brand: '', model: 'MT-09', source: 'search' }, // brand 空
      { kind: 'dict', brand: 'x'.repeat(201), model: 'MT-09', source: 'search' }, // 超長
      { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 42, source: 'search' }, // year 超界
      { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', source: 'freetext' }, // source 非 dict 白名單
      { kind: 'free', raw: '', source: 'freetext' }, // raw 空
      'YAMAHA MT-09', // 非物件
      42,
    ]) {
      const v = parsed(bad).vehicle;
      expect(v).toBeUndefined();
    }
  });

  it('dict 夾 raw/多餘鍵 → strip(逐 kind 隔離;z.object 預設剝未知鍵、RPC 端亦不收)', () => {
    const v = parsed({ kind: 'dict', brand: 'YAMAHA', model: 'MT-09', source: 'search', raw: '污染', unitPrice: 1 }).vehicle;
    expect(v).toEqual({ kind: 'dict', brand: 'YAMAHA', model: 'MT-09', source: 'search' });
  });

  it('🔴 寫入 fail-closed 維持:variantId 缺/非 uuid → REJECT 整單(與 vehicle 丟欄不同層、不得混淆)', () => {
    expect(PlaceOrderLinesInput.safeParse([{ quantity: 1 }]).success).toBe(false);
    expect(PlaceOrderLinesInput.safeParse([{ variantId: 'not-uuid', quantity: 1 }]).success).toBe(false);
  });
});
