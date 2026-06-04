import { describe, it, expect } from 'vitest';
import { createProductSnapshot, assertProductSnapshot } from './snapshot';
import { OrderError } from './errors';
import type { ProductSnapshot } from './types';

function snap(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return { title: '碳纖維護蓋', sku: 'DCC01', spec: { weave: '3K' }, ...overrides };
}

describe('createProductSnapshot(逐欄白名單 / strip)', () => {
  it('只複製 title / sku / spec 三欄', () => {
    const result = createProductSnapshot(snap());
    expect(Object.keys(result).sort()).toEqual(['sku', 'spec', 'title']);
    expect(result).toEqual({ title: '碳纖維護蓋', sku: 'DCC01', spec: { weave: '3K' } });
  });

  it('🔴 經銷價 / cost 等敏感欄即使傳入也被丟棄(編譯期+執行期雙擋)', () => {
    // 偽造「整個 Product 塞進快照」、繞過型別驗執行期白名單
    const malicious = {
      title: 'X',
      sku: 'Y',
      spec: {},
      price_store: 999,
      price_by_tier: { store: 999 },
      cost: 500,
    } as unknown as ProductSnapshot;
    const result = createProductSnapshot(malicious);
    expect(Object.keys(result).sort()).toEqual(['sku', 'spec', 'title']);
    expect((result as Record<string, unknown>).price_store).toBeUndefined();
    expect((result as Record<string, unknown>).price_by_tier).toBeUndefined();
    expect((result as Record<string, unknown>).cost).toBeUndefined();
  });

  it('回傳全新 plain literal、非沿用輸入參照(canonicalize)', () => {
    const input = snap();
    const result = createProductSnapshot(input);
    expect(result).not.toBe(input);
    expect(result.spec).not.toBe(input.spec);
  });

  it('title 空字串 throw invalid_snapshot', () => {
    expect(() => createProductSnapshot(snap({ title: '' }))).toThrow(OrderError);
    try {
      createProductSnapshot(snap({ title: '' }));
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_snapshot');
    }
  });

  it('sku 空字串 throw invalid_snapshot', () => {
    expect(() => createProductSnapshot(snap({ sku: '' }))).toThrow(OrderError);
  });

  it('spec 值非字串 throw invalid_snapshot', () => {
    const bad = { title: 'X', sku: 'Y', spec: { weave: 12 } } as unknown as ProductSnapshot;
    expect(() => createProductSnapshot(bad)).toThrow(OrderError);
  });

  it('無變體商品 spec = {} 合法', () => {
    expect(createProductSnapshot(snap({ spec: {} })).spec).toEqual({});
  });
});

describe('assertProductSnapshot(fail-closed reject 多餘欄、MUST-FIX-2)', () => {
  it('乾淨快照通過', () => {
    expect(() =>
      assertProductSnapshot({ title: 'X', sku: 'Y', spec: { weave: '3K' } }),
    ).not.toThrow();
  });

  it('🔴 帶經銷價 / cost 白名單外欄 → reject(非靜默 strip)throw invalid_snapshot', () => {
    const dirty = {
      title: 'X',
      sku: 'Y',
      spec: {},
      price_store: 999,
      price_by_tier: { store: 999 },
      cost: 500,
    } as unknown as ProductSnapshot;
    expect(() => assertProductSnapshot(dirty)).toThrow(OrderError);
    try {
      assertProductSnapshot(dirty);
    } catch (e) {
      expect((e as OrderError).code).toBe('invalid_snapshot');
    }
  });

  it('title 空字串 throw invalid_snapshot', () => {
    expect(() =>
      assertProductSnapshot({ title: '', sku: 'Y', spec: {} }),
    ).toThrow(OrderError);
  });
});
