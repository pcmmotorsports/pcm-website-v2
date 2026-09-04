// @vitest-environment node
//
// PDP 的 smoke —— 而**這支存在的理由是「整個目錄零測試檔」**(`⟦search-VEHTAXSLOW⟧` · 2026-09-05)。
//   要改 `fetchVehicleTaxonomy`(七個入口共用)之前查回歸分母, 兩把尺都說沒有:
//   `ls products/[slug]/` ⇒ 只有 `page.tsx`;`grep` 誰 import 它 ⇒ **0**。
//   🟢 正對照:首頁 `app/page` 被 4 支測試 import ⇒ 尺是活的。
//
// 🔴 而這一頁對 taxonomy 的呼叫是【有條件的】(`page.tsx` 那一行):
//    `hasVehicleParam || hasFitments ? fetchVehicleTaxonomy() : Promise.resolve([])`
//    ⇒ 📌 **那是一個已經在的優化, 而它今天沒有任何東西守著** —— 本檔把它釘住。

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fetchVehicleTaxonomy = vi.fn();
const fetchProductByHandle = vi.fn();

vi.mock('@/components/ProductPage', () => ({
  ProductPage: function ProductPage({ motoBrands }: { motoBrands?: unknown[] }) {
    return <div data-stub="pdp" data-moto-brands={String(motoBrands?.length ?? 'undefined')} />;
  },
}));
vi.mock('@/lib/products', () => ({ fetchProductByHandle, fetchVehicleTaxonomy }));
vi.mock('@/lib/recommendations/fetch-recommendations', () => ({
  fetchRecommendedProducts: () => Promise.resolve({ items: [], error: false }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
}));
vi.mock('@/lib/auth/composition', () => ({
  getVehicleRepo: () => Promise.resolve({ listByCustomer: () => Promise.resolve([]) }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { default: ProductSlugRoute } = await import('./page');

const BRANDS = [
  { id: 'yamaha', name: 'YAMAHA', models: [] },
  { id: 'honda', name: 'HONDA', models: [] },
];
const product = (fitments: unknown[]) => ({
  id: 'p1', slug: 'a', handle: 'a', name: 'N', brand: 'B', price: 100,
  images: [], description: '', fitments, availability: true, category: null,
});
const call = (fitments: unknown[], sp: Record<string, string> = {}) =>
  ProductSlugRoute({ params: Promise.resolve({ slug: 'a' }), searchParams: Promise.resolve(sp) } as never);

describe('PDP 的車款清單', () => {
  it('🔴 商品有 fitments ⇒ 【會】撈 taxonomy, 而且真的傳進去', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    fetchVehicleTaxonomy.mockReset().mockResolvedValue(BRANDS);
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-stub="pdp"');
    expect(html).toContain('data-moto-brands="2"');
    expect(fetchVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 商品【沒有】fitments 且網址沒帶車 ⇒ 【不撈】taxonomy', async () => {
    // 🛑 這一格釘的是一個【已經在的優化】—— 而它今天沒有任何東西守著。
    //    把那個三元運算子改成無條件呼叫 ⇒ 這一格紅, 而畫面看不出差別(只是每次多付那 12 秒)。
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    fetchVehicleTaxonomy.mockReset().mockResolvedValue(BRANDS);
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-stub="pdp"');
    expect(fetchVehicleTaxonomy).not.toHaveBeenCalled();
  });

  it('🔴 沒有 fitments 而【網址帶了車】⇒ 還是要撈(另一半條件)', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    fetchVehicleTaxonomy.mockReset().mockResolvedValue(BRANDS);
    // 🔵 參數名是 `vehicle`(短版), 不是 `v` —— 我第一版寫 `v` 而這一格【當場紅】。
    //    `page.tsx:97-98` 逐字:`spGet('vehicle') != null || (spGet('brand') != null && spGet('model') != null)`
    await call([], { vehicle: 'yamaha-r1-2020' });
    expect(fetchVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴 taxonomy 回空 ⇒ 頁面【仍然要渲染】(車款清單掛了不該讓商品頁打不開)', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    fetchVehicleTaxonomy.mockReset().mockResolvedValue([]);
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-stub="pdp"');
    expect(html).toContain('data-moto-brands="0"');
  });
});
