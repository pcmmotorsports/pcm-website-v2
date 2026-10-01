import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { SupabaseNewProductDraftStore, SupabaseNewProductSource, effectivePrice } from './SupabaseNewProductDrafts';

/** 手工假 client 只實作 from / rpc;cast 留在測試(同 SupabaseSupplierNewProductStore.test.ts 的理由)。 */
function asClient(c: unknown): SupabaseClient<Database> {
  return c as SupabaseClient<Database>;
}

function fakeDb(tables: Record<string, unknown[]>, rpcResult: { data: unknown; error: unknown } = { data: 'created', error: null }) {
  const calls: { table?: string; fn?: string; args: unknown[] }[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        let range: [number, number] | null = null;
        const q = {
          select: () => q, gte: () => q, order: () => q, limit: () => q,
          range: (a: number, b: number) => { range = [a, b]; calls.push({ table, args: ['range', a, b] }); return q; },
          in: (...args: unknown[]) => { calls.push({ table, args }); return q; },
          then: (resolve: (r: unknown) => unknown) => {
            const all = tables[table] ?? [];
            return Promise.resolve({ data: range ? all.slice(range[0], range[1] + 1) : all, error: null }).then(resolve);
          },
        };
        return q;
      },
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args: [args] });
        return Promise.resolve(rpcResult);
      },
    },
  };
}

const SINCE = '2026-10-01T00:00:00.000Z';
const base = {
  products_public: [
    { id: 'p-new', handle: 'h-new', title: '新卡', subtitle: 'Yamaha MT-09', images: ['https://x/a.jpg', 'https://x/b.jpg'],
      brand_id: 'b1', category_id: 'c1', price_general: 3200, highlights: ['一', 2, '二'], created_at: '2026-10-01T05:00:00Z' },
    { id: 'p-split', handle: 'h-split', title: '拆出來的卡', subtitle: null, images: [{ url: 'https://x/c.jpg' }],
      brand_id: 'b1', category_id: null, price_general: 900, highlights: [], created_at: '2026-10-01T06:00:00Z' },
  ],
  product_variants: [
    { product_id: 'p-new', sku: 'B-SKU', price_general: 3200, sale_price_general: null, created_at: '2026-10-01T05:00:00Z' },
    { product_id: 'p-new', sku: 'A-SKU', price_general: 3200, sale_price_general: null, created_at: '2026-10-01T05:00:00Z' },
    { product_id: 'p-new', sku: 'C-SKU', price_general: null, sale_price_general: null, created_at: '2026-10-01T05:00:00Z' },
    // 拆卡:卡是新的, 款式是舊的
    { product_id: 'p-split', sku: 'OLD', price_general: 900, sale_price_general: null, created_at: '2026-08-01T00:00:00Z' },
  ],
  brands: [{ id: 'b1', name: 'Materya', slug: 'materya' }],
  categories: [{ id: 'c1', name: '拉桿護弓' }],
  products: [{ id: 'p-new', delisted_at: null }, { id: 'p-split', delisted_at: null }],
};

describe('SupabaseNewProductSource', () => {
  it('只留有新款式的卡;代表料號取最低價、同價取料號;圖取卡片第一張;賣點只留字串', async () => {
    const { client } = fakeDb(base);
    const out = await new SupabaseNewProductSource(asClient(client)).listNewSince(SINCE, 200);
    expect(out).toEqual([{
      productId: 'p-new', handle: 'h-new', title: '新卡', subtitle: 'Yamaha MT-09', brandName: 'Materya', brandSlug: 'materya',
      categoryName: '拉桿護弓', priceGeneral: 3200, imageUrl: 'https://x/a.jpg', highlights: ['一', '二'], sku: 'A-SKU',
      createdAt: '2026-10-01T05:00:00Z',
    }]);
  });

  it('🔴 已下架的新卡不算(service_role 讀 products_public 繞過 RLS, 要自己擋;R1 必修 1)', async () => {
    const { client } = fakeDb({ ...base, products: [{ id: 'p-new', delisted_at: '2026-10-01T07:00:00Z' }, { id: 'p-split', delisted_at: null }] });
    expect(await new SupabaseNewProductSource(asClient(client)).listNewSince(SINCE, 200)).toEqual([]);
  });

  it('有特價時料號與價格取同一個款式(實際價最低;R1 建議 3)', async () => {
    const { client } = fakeDb({ ...base, product_variants: [
      { product_id: 'p-new', sku: 'A', price_general: 3000, sale_price_general: null, created_at: '2026-10-01T05:00:00Z' },
      { product_id: 'p-new', sku: 'B', price_general: 3500, sale_price_general: 2500, created_at: '2026-10-01T05:00:00Z' },
    ] });
    const [c] = await new SupabaseNewProductSource(asClient(client)).listNewSince(SINCE, 200);
    expect(c).toMatchObject({ sku: 'B', priceGeneral: 2500 });
  });

  it('款式超過一頁(1,000 列)時分頁取完, 代表款不會因截斷選錯(R3 建議 3)', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({
      product_id: 'p-new', sku: `S${String(i).padStart(4, '0')}`, price_general: i === 1000 ? 1000 : 3000,
      sale_price_general: null, created_at: '2026-10-01T05:00:00Z',
    }));
    const { client, calls } = fakeDb({ ...base, product_variants: many });
    const [c] = await new SupabaseNewProductSource(asClient(client)).listNewSince(SINCE, 200);
    expect(c).toMatchObject({ sku: 'S1000', priceGeneral: 1000 });
    expect(calls.filter((x) => x.table === 'product_variants' && x.args[0] === 'range').map((x) => x.args[1])).toEqual([0, 1000, 1001]);
  });

  it('沒有新卡就不查款式', async () => {
    const { client, calls } = fakeDb({ ...base, products_public: [] });
    expect(await new SupabaseNewProductSource(asClient(client)).listNewSince(SINCE, 200)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it.each([
    [3000, null, 3000],
    [3000, 2500, 2500],
    [3000, 3000, 3000],
    [2000, 2500, 2000],
    [null, 2500, null],
  ])('實際價照資料庫規則:一般價 %s、特價 %s ⇒ %s(R2 必修)', (g, sale, want) => {
    expect(effectivePrice({ price_general: g, sale_price_general: sale })).toBe(want);
  });

  it('款式查詢分批, 一批最多 30 張卡(避免被單次上限截斷)', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...base.products_public[0], id: `p${i}` }));
    const { client, calls } = fakeDb({ ...base, products_public: many });
    await new SupabaseNewProductSource(asClient(client)).listNewSince(SINCE, 200);
    const sizes = calls.filter((c) => c.table === 'product_variants' && c.args[0] === 'product_id').map((c) => (c.args[1] as unknown[]).length);
    // 150 張卡 ⇒ 5 批 × 30 張;每批翻到拿到 0 列才停 ⇒ 每批兩次(一頁資料 + 一頁空的)
    expect(sizes).toEqual(Array(10).fill(30));
  });
});

describe('SupabaseNewProductDraftStore', () => {
  const draft = {
    sourceProductId: 'p1', eyebrow: 'Materya', titleLine1: 'T', subtitle: null, ctaLabel: '看商品', linkPath: '/products/h',
    imageDesktopUrl: 'https://x/a.jpg', fbText: 'FB', igText: 'IG',
  };

  it('走 system_new_product_draft, 欄位轉 snake_case、帶 request id', async () => {
    const { client, calls } = fakeDb(base);
    const r = await new SupabaseNewProductDraftStore(asClient(client), () => 'req-1').create(draft);
    expect(r).toBe('created');
    expect(calls).toEqual([{ fn: 'system_new_product_draft', args: [{
      p_draft: { source_product_id: 'p1', eyebrow: 'Materya', title_line1: 'T', subtitle: null, cta_label: '看商品',
        link_path: '/products/h', image_desktop_url: 'https://x/a.jpg', fb_text: 'FB', ig_text: 'IG' },
      p_request_id: 'req-1',
    }] }]);
  });

  it('duplicate 照傳;不認得的回傳值或錯誤 ⇒ 丟出來', async () => {
    expect(await new SupabaseNewProductDraftStore(asClient(fakeDb(base, { data: 'duplicate', error: null }).client)).create(draft)).toBe('duplicate');
    await expect(new SupabaseNewProductDraftStore(asClient(fakeDb(base, { data: 'weird', error: null }).client)).create(draft)).rejects.toThrow('不認得');
    await expect(new SupabaseNewProductDraftStore(asClient(fakeDb(base, { data: null, error: new Error('boom') }).client)).create(draft)).rejects.toThrow('boom');
  });
});
