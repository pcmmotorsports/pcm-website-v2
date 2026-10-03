import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  indexUpstream,
  dealerBatchChecksum,
  checksumVerdict,
  gateReasons,
  dealerPriceChangeCounts,
  formatDealerPriceChangeLine,
  formatDealerPriceChangeUnavailable,
  type UpstreamDealerRow,
} from './dealer-price-source';

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

const KEY = 'test-key-1';

describe('checksum:排序後才雜湊', () => {
  it('🔴 同一批不同列序 ⇒ 同一個 checksum(來源列序不保證穩定)', () => {
    const a = dealerBatchChecksum([row('A', 1), row('B', 2)], KEY);
    const b = dealerBatchChecksum([row('B', 2), row('A', 1)], KEY);
    expect(a).toBe(b);
  });
  it('🔵 值變了 ⇒ checksum 一定變(不然它擋不住任何東西)', () => {
    expect(dealerBatchChecksum([row('A', 1)], KEY)).not.toBe(dealerBatchChecksum([row('A', 2)], KEY));
  });
  it('🔵 null 與 0 是兩批不同的資料', () => {
    expect(dealerBatchChecksum([row('A', null)], KEY)).not.toBe(dealerBatchChecksum([row('A', 0)], KEY));
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

// 2026-10-02 資安(主視窗 pcm-website-v2-ce 派):repo 公開, 核對碼會印進 Actions 紀錄。
// 舊版是 sha256(供應商, 料號, 經銷價), 部分供應商經銷價 = 一般價 × 固定比例 ⇒ 列舉比例就能反推。改成帶金鑰的 HMAC-SHA256。
describe('核對碼改成帶金鑰的 HMAC', () => {
  const rows = [row('A', 1800), row('B', 2100)];
  const body = 'rpm\tA\t1800\nrpm\tB\t2100';

  it('🔴 是 HMAC-SHA256(金鑰, 內容), 不是沒有金鑰的 sha256(沒有金鑰就算不出來、也猜不回去)', () => {
    expect(dealerBatchChecksum(rows, KEY)).toBe(createHmac('sha256', KEY).update(body, 'utf8').digest('hex'));
    expect(dealerBatchChecksum(rows, KEY)).not.toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
  });

  it('同一批資料、不同金鑰 ⇒ 核對碼不同', () => {
    expect(dealerBatchChecksum(rows, KEY)).not.toBe(dealerBatchChecksum(rows, 'test-key-2'));
  });

  it('金鑰是空的 ⇒ 不算(丟錯), 不會退回成沒有金鑰的雜湊', () => {
    expect(() => dealerBatchChecksum(rows, '')).toThrow();
    expect(() => dealerBatchChecksum(rows, '   ')).toThrow();
  });
});

describe('checksumVerdict:要不要放行寫新經銷價, 以及印什麼', () => {
  const rows = [row('A', 1800), row('B', 2100)];
  const full = dealerBatchChecksum(rows, KEY);
  const text = (v: ReturnType<typeof checksumVerdict>) => v.lines.map((l) => l.text).join('\n');

  it('🔴 沒有金鑰 ⇒ 不放行(走 A1 帶舊值), 而且排程也一樣, 錯誤講清楚要設哪個 secret', () => {
    for (const trigger of ['schedule', 'workflow_dispatch', '']) {
      const v = checksumVerdict({ rows, key: '', expect: '', trigger, dryRun: false });
      expect(v.ok).toBe(false);
      expect(v.missingKey).toBe(true);
      expect(text(v)).toContain('DEALER_PRICE_CHECKSUM_KEY');
      expect(v.lines.some((l) => l.level === 'error')).toBe(true);
    }
    expect(checksumVerdict({ rows, key: undefined, expect: full, trigger: 'workflow_dispatch', dryRun: false }).ok).toBe(false);
  });

  it('🔴 正式跑(不是乾跑)⇒ 紀錄裡只有前 8 碼, 不含完整值', () => {
    const v = checksumVerdict({ rows, key: KEY, expect: '', trigger: 'schedule', dryRun: false });
    expect(v.ok).toBe(true);
    expect(text(v)).toContain(full.slice(0, 8));
    expect(text(v)).not.toContain(full);
  });

  it('乾跑 ⇒ 印完整值(人要把它貼進 workflow_dispatch)', () => {
    expect(text(checksumVerdict({ rows, key: KEY, expect: '', trigger: 'workflow_dispatch', dryRun: true }))).toContain(full);
  });

  it('🔴 帶了期望值而不符 ⇒ 不放行, 紀錄裡期望值與實際值都只有前 8 碼', () => {
    const wrong = dealerBatchChecksum(rows, 'other-key');
    const v = checksumVerdict({ rows, key: KEY, expect: wrong, trigger: 'workflow_dispatch', dryRun: false });
    expect(v.ok).toBe(false);
    expect(text(v)).not.toContain(full);
    expect(text(v)).not.toContain(wrong);
    expect(text(v)).toContain(wrong.slice(0, 8));
  });

  it('帶了期望值而相符 ⇒ 放行', () => {
    expect(checksumVerdict({ rows, key: KEY, expect: full, trigger: 'workflow_dispatch', dryRun: false }).ok).toBe(true);
  });

  it('沒帶期望值:排程 ⇒ 放行(日常同步);手動或本機 ⇒ 不放行(首灌一定要綁核准的那批)', () => {
    expect(checksumVerdict({ rows, key: KEY, expect: '', trigger: 'schedule', dryRun: false }).ok).toBe(true);
    expect(checksumVerdict({ rows, key: KEY, expect: '', trigger: 'workflow_dispatch', dryRun: false }).ok).toBe(false);
    expect(checksumVerdict({ rows, key: KEY, expect: '', trigger: '', dryRun: false }).ok).toBe(false);
  });
});

// 2026-10-03 extreme 價目表全自動(網站那一半, Sean 批):報價單那邊的自動流程從 gh run log 讀這一行
// 決定要不要停(單件 ±30%、改價件數 >20% 整批停)⇒ 格式要固定, 只印件數、不印任何價格。
describe('經銷價變動件數(只印件數)', () => {
  const m = (pairs: [string, number | null][]) => new Map<string, number | null>(pairs);

  it('格式逐字固定(報價單自動流程照這一行解析)', () => {
    expect(formatDealerPriceChangeLine({ changed: 3, added: 2, unchanged: 10, removed: 1, over30: 1 })).toBe(
      '[dealer-price] 經銷價變動件數:改價 3 · 新設 2 · 不變 10 · 移除 1 · 單件漲跌超過 30% 1',
    );
  });

  it('五種情況各自數對, 與寫入行為一致(上游明示 null = 清空;上游整列消失 = 沿用舊值, 算不變)', () => {
    const upstream = m([
      ['SAME', 1000], // 不變
      ['UP10', 1100], // 改價, 漲 10%
      ['UP31', 1310], // 改價, 漲 31% ⇒ 超過 30%
      ['DOWN40', 600], // 改價, 跌 40% ⇒ 超過 30%
      ['NEW', 500], // 新設(本站沒有這個料號)
      ['NEWFROMNULL', 700], // 新設(本站原本是 null)
      ['CLEAR', null], // 移除(本站原本有值)
      ['BOTHNULL', null], // 不變
    ]);
    const old = m([
      ['SAME', 1000],
      ['UP10', 1000],
      ['UP31', 1000],
      ['DOWN40', 1000],
      ['NEWFROMNULL', null],
      ['CLEAR', 800],
      ['BOTHNULL', null],
      ['GONE', 900], // 上游沒有這一列 ⇒ 沿用舊值 ⇒ 不變
    ]);
    expect(dealerPriceChangeCounts(upstream, old)).toEqual({ changed: 3, added: 2, unchanged: 3, removed: 1, over30: 2 });
  });

  it('剛好 30% 不算超過;舊價 0 而新價大於 0 算超過', () => {
    expect(dealerPriceChangeCounts(m([['A', 1300], ['B', 700]]), m([['A', 1000], ['B', 1000]])).over30).toBe(0);
    expect(dealerPriceChangeCounts(m([['Z', 100]]), m([['Z', 0]]))).toEqual({ changed: 1, added: 0, unchanged: 0, removed: 0, over30: 1 });
  });

  it('印出來的那一行不含任何價格數字', () => {
    const line = formatDealerPriceChangeLine(dealerPriceChangeCounts(m([['A', 98765]]), m([['A', 12345]])));
    expect(line).not.toMatch(/98765|12345/);
  });
});

// Fable R1 必修:算不出可信件數的時候也要印同前綴的一行, 不能缺行(下游 grep 缺行可能被當成 0 件放行)。
describe('經銷價變動件數:算不出來時印固定字樣(不是數字)', () => {
  it('三種情況逐字固定', () => {
    expect(formatDealerPriceChangeUnavailable('upstream_unreadable')).toBe('[dealer-price] 經銷價變動件數:讀不到上游');
    expect(formatDealerPriceChangeUnavailable('local_incomplete')).toBe('[dealer-price] 經銷價變動件數:本站現值讀不完整');
    expect(formatDealerPriceChangeUnavailable('not_in_list')).toBe('[dealer-price] 經銷價變動件數:不在經銷價名單');
  });
  it('固定字樣與件數那一行同前綴, 但沒有「改價 N」這種數字欄(下游看到就要停)', () => {
    for (const r of ['upstream_unreadable', 'local_incomplete', 'not_in_list'] as const) {
      const line = formatDealerPriceChangeUnavailable(r);
      expect(line.startsWith('[dealer-price] 經銷價變動件數:')).toBe(true);
      expect(line).not.toMatch(/改價 \d/);
    }
  });
});
