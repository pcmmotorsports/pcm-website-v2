import { describe, expect, it } from 'vitest';
import { indexUpstream, dealerBatchChecksum, gateReasons, type UpstreamDealerRow } from './dealer-price-source';

/**
 * 🔴 **N4(mail 快篩):plan 要的三種 fixture 缺兩種** ——「字串型別經銷價」與「原子 RPC 路徑」。
 *   而風險被搬到「上游讀取時就轉乾淨」那一層,**那一層當時沒有測試**。這支補它。
 */

const row = (sku: string, price: number | null, slug = 'rpm'): UpstreamDealerRow =>
  ({ supplier_slug: slug, sku, price_store: price });

describe('鍵的合法性:拒收不是跳過', () => {
  it('空字串 / 純空白 / 前後空白 / 家別不符 —— 逐筆列出,不進 map', () => {
    const r = indexUpstream(
      [row('OK', 87), row('', 1), row('   ', 2), row(' PAD ', 3), row('X', 4, 'gbracing')],
      'rpm',
    );
    expect(r.bySku.size).toBe(1);
    expect(r.bySku.get('OK')).toBe(87);
    expect(r.illegalKeys).toHaveLength(4); // 🔴 只給個數不夠, 這裡也驗它逐筆
  });

  it('🔴 逐字比, 不做大小寫正規化(與 rpm-transform.ts:458 同判準)', () => {
    const r = indexUpstream([row('abc', 1), row('ABC', 2)], 'rpm');
    expect(r.bySku.size).toBe(2); // 正規化的話會塌成 1 而某支拿到別支的價
  });

  it('同鍵兩列 ⇒ keyUnique = false(不得自己合併)', () => {
    const r = indexUpstream([row('D', 1), row('D', 2)], 'rpm');
    expect(r.keyUnique).toBe(false);
  });
});

describe('checksum:排序後才雜湊', () => {
  it('🔴 同一批不同列序 ⇒ 同一個 checksum(來源列序不保證穩定)', () => {
    const a = dealerBatchChecksum([row('A', 1), row('B', 2)]);
    const b = dealerBatchChecksum([row('B', 2), row('A', 1)]);
    expect(a).toBe(b);
  });
  it('🔵 值變了 ⇒ checksum 一定變(不然它擋不住任何東西)', () => {
    expect(dealerBatchChecksum([row('A', 1)])).not.toBe(dealerBatchChecksum([row('A', 2)]));
  });
  it('🔵 null 與 0 是兩批不同的資料', () => {
    expect(dealerBatchChecksum([row('A', null)])).not.toBe(dealerBatchChecksum([row('A', 0)]));
  });
});

describe('gateReasons:只列事實', () => {
  const ok = { bySku: new Map([['A', 1]]), expected: 1, got: 1, localKeyUnique: true };
  it('全好 ⇒ 空陣列', () => {
    expect(gateReasons({ old: ok, upstream: null, missingCount: 0, hasUpstreamUrl: true, checksumOk: true })).toEqual([]);
  });
  it('🔴 讀漏(got ≠ expected)⇒ old_values_read_short', () => {
    const short = { ...ok, got: 0 };
    expect(gateReasons({ old: short, upstream: null, missingCount: 0, hasUpstreamUrl: true, checksumOk: true }))
      .toContain('old_values_read_short');
  });
  it('🔴 ③ 那堆超過本站變體數 5% ⇒ missing_over_threshold', () => {
    const big = { bySku: new Map<string, number | null>(), expected: 100, got: 100, localKeyUnique: true };
    expect(gateReasons({ old: big, upstream: null, missingCount: 6, hasUpstreamUrl: true, checksumOk: true }))
      .toContain('missing_over_threshold');
  });
  it('🔵 剛好 5% 不觸發(邊界:> 才算)', () => {
    const big = { bySku: new Map<string, number | null>(), expected: 100, got: 100, localKeyUnique: true };
    expect(gateReasons({ old: big, upstream: null, missingCount: 5, hasUpstreamUrl: true, checksumOk: true }))
      .not.toContain('missing_over_threshold');
  });
});

describe('🔴 收工審兩條:allowlist 空仍會改到既有值(合成資料重現過)', () => {
  it('count 回 null 而無錯誤 ⇒ 不是零筆, 要丟出去讓呼叫端判 A2', async () => {
    // 🛑 當成 0 會略過整個讀取迴圈【而且通過守門】(got 0 = expected 0)⇒ 既有經銷價被清成 null
    const { readLocalDealerPrices } = await import('./dealer-price-source');
    let head = false;
    const b: Record<string, unknown> = {};
    b.select = (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; };
    b.eq = () => (head ? Promise.resolve({ count: null, error: null }) : b);
    b.order = () => b;
    b.range = () => Promise.resolve({ data: [], error: null });
    await expect(readLocalDealerPrices({ from: () => b } as never, 'rpm')).rejects.toThrow(/沒讀到/);
  });

  it('🔴 商品層 store.amount 是【字串】"555" ⇒ 要讀成 555, 不是 null', async () => {
    // 🛑 讀成 null ⇒ 之後補成 general ⇒ allowlist 空仍會覆寫有效經銷價(合成重現 "555" → 100)
    const { readLocalProductStore } = await import('./dealer-price-source');
    let head = false;
    const b: Record<string, unknown> = {};
    b.select = (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; };
    b.eq = () => (head ? Promise.resolve({ count: 1, error: null }) : b);
    b.order = () => b;
    b.range = () => Promise.resolve({ data: [{ external_id: 'G1', price_by_tier: { store: { amount: '555' } } }], error: null });
    const m = await readLocalProductStore({ from: () => b } as never, 'rpm');
    expect(m?.get('G1')).toBe(555);
  });

  it('🔵 真的沒有值(非數字字串)⇒ 仍要回 null', async () => {
    const { readLocalProductStore } = await import('./dealer-price-source');
    let head = false;
    const b: Record<string, unknown> = {};
    b.select = (_c?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return b; };
    b.eq = () => (head ? Promise.resolve({ count: 1, error: null }) : b);
    b.order = () => b;
    b.range = () => Promise.resolve({ data: [{ external_id: 'G1', price_by_tier: { store: { amount: 'abc' } } }], error: null });
    const m = await readLocalProductStore({ from: () => b } as never, 'rpm');
    expect(m?.get('G1')).toBeNull();
  });
});
