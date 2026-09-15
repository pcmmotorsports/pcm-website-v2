// rpm-manufacturer-brand.test.ts —— ⟦DBK 製造商品牌⟧ 逐群掛品牌的規則 + 抓資料那一欄的退路。
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { fetchAllSupplierProducts } from './rpm-fetch';
import { decideGroupBrand, normalizeManufacturerBrand, normalizeSku } from './rpm-manufacturer-brand';

// = supplier-config dbk 的清單(Sean 01:0x「只搬真的是該品牌做的」)
const ALLOWED = ['termignoni', 'ohlins'] as const;
const NONE = new Map<string, Set<string>>();
const row = (sku: string, manufacturer_brand?: string | null) => ({ sku, manufacturer_brand });

describe('normalizeManufacturerBrand / normalizeSku', () => {
  it('slug 或品牌名都吃(去重音、小寫、只留英數);空 ⇒ null', () => {
    expect(normalizeManufacturerBrand('Öhlins')).toBe('ohlins');
    expect(normalizeManufacturerBrand('TERMIGNONI')).toBe('termignoni');
    expect(normalizeManufacturerBrand('termignoni')).toBe('termignoni');
    expect(normalizeManufacturerBrand('  ')).toBeNull();
    expect(normalizeManufacturerBrand(null)).toBeNull();
    expect(normalizeManufacturerBrand(undefined)).toBeNull();
    expect(normalizeSku('ab-12 c')).toBe('AB12C');
  });
});

describe('decideGroupBrand', () => {
  it('有欄、整群同一家 ⇒ 改掛製造商', () => {
    const d = decideGroupBrand([row('D155Y', 'termignoni'), row('D155Y2', 'termignoni')], 'dbk', ALLOWED, NONE);
    expect(d).toEqual({ slug: 'termignoni', reason: 'manufacturer', wanted: null, duplicateSkus: [] });
  });

  it('沒有欄(欄還沒上 ⇒ undefined)或 null ⇒ 照舊掛 dbk', () => {
    expect(decideGroupBrand([row('X1'), row('X2')], 'dbk', ALLOWED, NONE)).toMatchObject({ slug: 'dbk', reason: 'supplier' });
    expect(decideGroupBrand([row('X1', null)], 'dbk', ALLOWED, NONE)).toMatchObject({ slug: 'dbk', reason: 'supplier' });
  });

  it('群內不一致(一列有一列沒有 / 兩家不同)⇒ 照舊掛 dbk 並標 mixed', () => {
    expect(decideGroupBrand([row('A', 'brembo'), row('B', null)], 'dbk', ALLOWED, NONE)).toMatchObject({
      slug: 'dbk',
      reason: 'mixed',
      wanted: 'brembo',
    });
    expect(decideGroupBrand([row('A', 'brembo'), row('B', 'ohlins')], 'dbk', ALLOWED, NONE)).toMatchObject({
      slug: 'dbk',
      reason: 'mixed',
    });
  });

  it('不在允許清單(打錯字 / 還沒建品牌頁)⇒ 照舊掛 dbk 並標 unknown,不靜默', () => {
    expect(decideGroupBrand([row('A', 'arrow')], 'dbk', ALLOWED, NONE)).toMatchObject({
      slug: 'dbk',
      reason: 'unknown',
      wanted: 'arrow',
    });
  });

  it('🔴 報價單標 brembo / akrapovic(DBK 做的配件)⇒ 留 dbk(Sean 01:0x 甲)', () => {
    expect(decideGroupBrand([row('BR1', 'brembo'), row('BR2', 'Brembo')], 'dbk', ALLOWED, NONE)).toMatchObject({
      slug: 'dbk',
      reason: 'unknown',
      wanted: 'brembo',
    });
    expect(decideGroupBrand([row('AK1', 'akrapovic')], 'dbk', ALLOWED, NONE)).toMatchObject({ slug: 'dbk', reason: 'unknown' });
    // 🔵 正對照:同一把尺對 ohlins 會搬
    expect(decideGroupBrand([row('TTX1', 'Öhlins')], 'dbk', ALLOWED, NONE)).toMatchObject({ slug: 'ohlins', reason: 'manufacturer' });
  });

  it('🔴 要搬去的品牌底下別家供應商已經有同料號 ⇒ 不搬、列出撞到的料號', () => {
    const taken = new Map([['ohlins', new Set([normalizeSku('TT-044')])]]);
    const d = decideGroupBrand([row('tt044', 'ohlins'), row('TT-045', 'ohlins')], 'dbk', ALLOWED, taken);
    expect(d).toEqual({ slug: 'dbk', reason: 'duplicate', wanted: 'ohlins', duplicateSkus: ['tt044'] });
    // 🔵 負對照:同料號在【別的】品牌底下不算撞
    expect(decideGroupBrand([row('tt044', 'termignoni')], 'dbk', ALLOWED, taken)).toMatchObject({ slug: 'termignoni' });
  });
});

describe('fetchAllSupplierProducts:manufacturer_brand 那一欄', () => {
  function client(probeError: { code: string } | null) {
    const selects: string[] = [];
    const from = vi.fn(() => ({
      select: (cols: string) => {
        selects.push(cols);
        const q = {
          eq: () => q,
          order: () => q,
          limit: () => Promise.resolve({ data: [], error: probeError }),
          range: () => Promise.resolve({ data: [], error: null }),
        };
        return q;
      },
    }));
    return { client: { from } as unknown as SupabaseClient, selects };
  }

  it('沒開(其他供應商)⇒ 不探、不帶那一欄', async () => {
    const c = client(null);
    await fetchAllSupplierProducts(c.client, 'akrapovic');
    expect(c.selects).toHaveLength(1);
    expect(c.selects[0]).not.toContain('manufacturer_brand');
  });

  it('開了而欄在 ⇒ 分頁 select 帶那一欄', async () => {
    const c = client(null);
    await fetchAllSupplierProducts(c.client, 'dbk', { manufacturerBrand: true });
    expect(c.selects[0]).toBe('manufacturer_brand');
    expect(c.selects[1]).toContain(', manufacturer_brand');
  });

  it('🔴 開了而報價單還沒加欄(42703)⇒ 退回不帶,同步不掛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = client({ code: '42703' });
    await expect(fetchAllSupplierProducts(c.client, 'dbk', { manufacturerBrand: true })).resolves.toEqual([]);
    expect(c.selects[1]).not.toContain('manufacturer_brand');
    warn.mockRestore();
  });
});
