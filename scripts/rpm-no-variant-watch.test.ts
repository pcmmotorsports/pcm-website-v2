import { describe, expect, it, vi } from 'vitest';
import { countListedProductsWithoutVariants, decideNoVariantAlert } from './rpm-no-variant-watch';

// ⟦f3-HALFWRITE1⟧ 先裝眼睛(Sean 2026-09-15 批 plan 76de8f6d2)。

describe('decideNoVariantAlert —— 判準是「變多」, 不是「非零」', () => {
  it('跑後比跑前多 ⇒ alert(寫到一半:商品進去了、規格沒進去)', () => {
    expect(decideNoVariantAlert(2, 3)).toBe('alert');
  });
  it('一樣多 / 變少 ⇒ ok(本來就有的不算這次造成的)', () => {
    expect(decideNoVariantAlert(5, 5)).toBe('ok');
    expect(decideNoVariantAlert(5, 0)).toBe('ok');
  });
  it('🔴 任一邊讀不到 ⇒ unknown, 不當成 0(當成 0 的話跑前讀不到會恆報 alert、跑後讀不到會恆報 ok)', () => {
    expect(decideNoVariantAlert(null, 3)).toBe('unknown');
    expect(decideNoVariantAlert(3, null)).toBe('unknown');
  });
});

function fakeClient(result: { count: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  (b as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result);
  const from = vi.fn(() => b);
  return { client: { from } as never, calls, from };
}

describe('countListedProductsWithoutVariants', () => {
  it('🔴🔴 一定帶 delisted_at IS NULL(service key 不吃 RLS;不帶就把下架品數進來 = 09-12 那次數錯)', async () => {
    const f = fakeClient({ count: 4, error: null });
    await expect(countListedProductsWithoutVariants(f.client, 'rpm')).resolves.toBe(4);
    expect(f.from).toHaveBeenCalledWith('products');
    expect(f.calls).toContainEqual(['is', ['delisted_at', null]]);
    expect(f.calls).toContainEqual(['is', ['product_variants', null]]);
    expect(f.calls).toContainEqual(['eq', ['supplier_slug', 'rpm']]);
    expect(f.calls).toContainEqual(['select', ['id, product_variants!left(id)', { count: 'exact', head: true }]]);
  });
  it('讀失敗 ⇒ throw(帶碼)', async () => {
    const f = fakeClient({ count: null, error: { code: 'PGRST500' } });
    await expect(countListedProductsWithoutVariants(f.client, 'rpm')).rejects.toThrow('PGRST500');
  });
  it('🔴 count 缺席 ⇒ throw count_missing, 不回 0', async () => {
    const f = fakeClient({ count: null, error: null });
    await expect(countListedProductsWithoutVariants(f.client, 'rpm')).rejects.toThrow('count_missing');
  });
});
