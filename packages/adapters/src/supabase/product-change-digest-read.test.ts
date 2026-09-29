import { describe, expect, it } from 'vitest';
import {
  readProductChangeDigest,
  summarizePriceChanges,
  type PriceChangeRow,
  type ProductChangeReadClient,
} from './product-change-digest-read';

// 每日 LINE 摘要「商品」一行的讀取(Sean 2026-09-29 Q1 甲 / Q2 甲 / Q3 甲)。

const P1 = 'p1';
const P2 = 'p2';
const row = (id: number, variant: string, product: string, oldP: number | null, newP: number | null): PriceChangeRow => ({
  id,
  variant_id: variant,
  product_id: product,
  sku: `SKU-${variant}`,
  old_price: oldP,
  new_price: newP,
});

describe('summarizePriceChanges', () => {
  const listed = new Map([[P1, '商品一'], [P2, '商品二']]);

  it('🔴 同一個規格改兩次只算一個, 漲跌用第一筆舊價、最後一筆新價(照 id, 不照傳進來的順序)', () => {
    const r = summarizePriceChanges([row(2, 'v1', P1, 1100, 1200), row(1, 'v1', P1, 1000, 1100)], listed);
    expect(r.changedVariants).toBe(1);
    expect(r.top).toEqual({ title: '商品一', oldPrice: 1000, newPrice: 1200, pct: 20 });
  });

  it('🔴 下架(不在 listed)的規格不算', () => {
    const r = summarizePriceChanges([row(1, 'v1', 'p-delisted', 1000, 2000)], listed);
    expect(r).toEqual({ changedVariants: 0, top: null });
  });

  it('🔴 舊價 0 / NULL、新價 NULL ⇒ 算進件數, 不參加漲跌最大(不會出現 Infinity / NaN)', () => {
    const r = summarizePriceChanges(
      [row(1, 'v1', P1, 0, 500), row(2, 'v2', P1, null, 500), row(3, 'v3', P2, 500, null)],
      listed,
    );
    expect(r.changedVariants).toBe(3);
    expect(r.top).toBeNull();
  });

  it('未滿 5% 不當漲跌最大;挑絕對值最大(跌價也算)', () => {
    const r = summarizePriceChanges(
      [row(1, 'v1', P1, 1000, 1040), row(2, 'v2', P2, 1000, 850), row(3, 'v3', P1, 1000, 1100)],
      listed,
    );
    expect(r.changedVariants).toBe(3);
    expect(r.top).toEqual({ title: '商品二', oldPrice: 1000, newPrice: 850, pct: -15 });
  });

  it('品名是 null ⇒ 用料號', () => {
    const r = summarizePriceChanges([row(1, 'v9', P1, 1000, 2000)], new Map([[P1, null]]));
    expect(r.top?.title).toBe('SKU-v9');
  });
});

/** 依表名回資料的假 client;記下每張表收到的過濾條件。 */
function fakeClient(tables: Record<string, unknown[] | Error>) {
  const calls: Record<string, string[]> = {};
  // readAll 每一頁都重新 from() ⇒ 換頁狀態要記在表上, 不能記在單次查詢上(否則永遠是第一頁、迴圈停不了)。
  const pageCalls: Record<string, number> = {};
  const client = {
    from(table: string) {
      const log = (calls[table] ??= []);
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (log.push(`eq ${c}=${String(v)}`), q),
        is: () => q,
        in: (c: string, vs: readonly string[]) => (log.push(`in ${c}=${vs.join(',')}`), q),
        gte: (c: string, v: string) => (log.push(`gte ${c}=${v}`), q),
        lt: (c: string, v: string) => (log.push(`lt ${c}=${v}`), q),
        order: () => q,
        range: () => q,
        then(res: (v: { data: unknown[] | null; error: unknown }) => unknown) {
          const d = tables[table];
          if (d instanceof Error) return Promise.resolve({ data: null, error: d }).then(res);
          // 同一張表:單數次給資料, 雙數次給空頁 ⇒ 每一輪 readAll 讀一頁資料就停
          const k = (pageCalls[table] = (pageCalls[table] ?? 0) + 1);
          const out = k % 2 === 1 ? (d ?? []) : [];
          return Promise.resolve({ data: out, error: null }).then(res);
        },
      };
      return q;
    },
  } as unknown as ProductChangeReadClient;
  return { client, calls };
}

describe('readProductChangeDigest', () => {
  const NOW = new Date('2026-09-30T01:00:30Z'); // 台北 09:00 那一班

  it('🔴 新上架只算上架中商品;變價用 12 小時範圍;同步看過去 24 小時 completed 且不是 degraded', async () => {
    const { client, calls } = fakeClient({
      product_price_changes: [row(1, 'v1', P1, 1000, 1100)],
      product_variants: [
        { id: 'n1', product_id: P1 },
        { id: 'n2', product_id: 'p-delisted' },
      ],
      products: [
        { id: P1, title: '商品一', delisted_at: null },
        { id: 'p-delisted', title: '下架品', delisted_at: '2026-09-01T00:00:00Z' },
      ],
      supplier_sync_runs: [{ id: 1, note: null }],
    });
    const d = await readProductChangeDigest(client, NOW);
    expect(d).toEqual({
      newVariants: 1,
      changedVariants: 1,
      top: { title: '商品一', oldPrice: 1000, newPrice: 1100, pct: 10 },
      noCompletedSync: false,
    });
    expect(calls.product_price_changes).toEqual(
      expect.arrayContaining(['gte changed_at=2026-09-29T13:00:00.000Z', 'lt changed_at=2026-09-30T01:00:00.000Z']),
    );
    expect(calls.supplier_sync_runs).toEqual(
      expect.arrayContaining(['eq outcome=completed', 'gte completed_at=2026-09-29T01:00:30.000Z']),
    );
  });

  it('🔴 過去 24 小時只有 degraded 的 completed ⇒ noCompletedSync = true;一列都沒有也是', async () => {
    const onlyDegraded = fakeClient({ product_price_changes: [], product_variants: [], products: [], supplier_sync_runs: [{ id: 1, note: 'degraded' }] });
    expect((await readProductChangeDigest(onlyDegraded.client, NOW)).noCompletedSync).toBe(true);
    const none = fakeClient({ product_price_changes: [], product_variants: [], products: [], supplier_sync_runs: [] });
    expect((await readProductChangeDigest(none.client, NOW)).noCompletedSync).toBe(true);
  });

  it('🔴 任一張表讀失敗 ⇒ throw(呼叫端當「讀不到」, 不當 0)', async () => {
    const { client } = fakeClient({ product_price_changes: new Error('42P01'), product_variants: [], products: [], supplier_sync_runs: [] });
    await expect(readProductChangeDigest(client, NOW)).rejects.toThrow('42P01');
  });
});
