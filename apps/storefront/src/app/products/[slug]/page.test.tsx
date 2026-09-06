// 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):route 改走【帶 `failed` 的那扇門】
//   ⇒ 本檔的 mock 與斷言跟著換受詞:`fetchVehicleTaxonomy` ⇒ `tryVehicleTaxonomy`,
//   回傳形狀從 `MockMotoBrand[]` 變成 `{ motoBrands, failed }`。
//   🛑 **不是為了讓測試變綠才改** —— 是被測的那一行真的換了呼叫對象;
//      不改的話這幾格會綠在一個【已經不存在的呼叫】上。
// @vitest-environment node
//
// PDP 的 smoke —— 而**這支存在的理由是「整個目錄零測試檔」**(`⟦search-VEHTAXSLOW⟧` · 2026-09-05)。
//   要改 `tryVehicleTaxonomy`(七個入口共用)之前查回歸分母, 兩把尺都說沒有:
//   `ls products/[slug]/` ⇒ 只有 `page.tsx`;`grep` 誰 import 它 ⇒ **0**。
//   🟢 正對照:首頁 `app/page` 被 4 支測試 import ⇒ 尺是活的。
//
// 🔴 而這一頁對 taxonomy 的呼叫是【有條件的】(`page.tsx` 那一行):
//    `hasVehicleParam || hasFitments ? tryVehicleTaxonomy() : Promise.resolve([])`
//    ⇒ 📌 **那是一個已經在的優化, 而它今天沒有任何東西守著** —— 本檔把它釘住。

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const tryVehicleTaxonomy = vi.fn();
const fetchProductByHandle = vi.fn();

vi.mock('@/components/ProductPage', () => ({
  // 🔴 2026-09-06 R1 must-fix:stub 原本【只畫 motoBrands 不畫 failed】
  //   ⇒ 四處把 `vehicleTaxonomyFailed` 寫死 `false` 也照樣全綠 ⇒ 那條接線零守門。
  ProductPage: function ProductPage({
    motoBrands,
    vehicleTaxonomyFailed,
  }: {
    motoBrands?: unknown[];
    vehicleTaxonomyFailed?: boolean;
  }) {
    return (
      <div
        data-stub="pdp"
        data-moto-brands={String(motoBrands?.length ?? 'undefined')}
        data-failed={String(vehicleTaxonomyFailed)}
      />
    );
  },
}));
vi.mock('@/lib/products', () => ({ fetchProductByHandle, tryVehicleTaxonomy }));
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
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-stub="pdp"');
    expect(html).toContain('data-moto-brands="2"');
    expect(tryVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 商品【沒有】fitments 且網址沒帶車 ⇒ 【不撈】taxonomy', async () => {
    // 🛑 這一格釘的是一個【已經在的優化】—— 而它今天沒有任何東西守著。
    //    把那個三元運算子改成無條件呼叫 ⇒ 這一格紅, 而畫面看不出差別(只是每次多付那 12 秒)。
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await call([]));
    expect(html).toContain('data-stub="pdp"');
    expect(tryVehicleTaxonomy).not.toHaveBeenCalled();
  });

  it('🔴 沒有 fitments 而【網址帶了車】⇒ 還是要撈(另一半條件)', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    // 🔵 參數名是 `vehicle`(短版), 不是 `v` —— 我第一版寫 `v` 而這一格【當場紅】。
    //    `page.tsx:97-98` 逐字:`spGet('vehicle') != null || (spGet('brand') != null && spGet('model') != null)`
    await call([], { vehicle: 'yamaha-r1-2020' });
    expect(tryVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴 taxonomy 回空 ⇒ 頁面【仍然要渲染】(車款清單掛了不該讓商品頁打不開)', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: false });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-stub="pdp"');
    expect(html).toContain('data-moto-brands="0"');
  });
  // 🔴🔴 **2026-09-06 R1 must-fix:`failed` 那條接線原本零守門**(stub 只畫 motoBrands)。
  //   PDP 這一支多一個【它獨有】的形狀要守:**略過分支必須回 `false`** ——
  //   「這一頁不需要車款樹」與「撈失敗」是兩件事, 混在一起會讓沒有 fitments 的商品頁
  //   對每一個客人都說「車款清單暫時無法載入」。
  it('🔴 撈失敗(failed=true)⇒ 那個旗標【真的傳進 ProductPage】', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: true });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-failed="true"');
  });

  it('🔵 負對照:沒失敗 ⇒ 傳下去的是 false, 不是恆真', async () => {
    fetchProductByHandle.mockReset().mockResolvedValue(product([{ motoBrand: 'Honda' }]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await call([{ motoBrand: 'Honda' }]));
    expect(html).toContain('data-failed="false"');
  });

  it('🔴🔴 沒有 fitments 也沒有車款參數 ⇒ 根本不撈 ⇒ 旗標必須是 false(不是 undefined、不是 true)', async () => {
    // 🛑 **這一格是 PDP 獨有的**:略過分支若回 `true` 或漏傳,
    //    每一個沒有適用車款的商品頁都會對客人說「車款清單暫時無法載入」。
    fetchProductByHandle.mockReset().mockResolvedValue(product([]));
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: true });
    const html = renderToStaticMarkup(await call([]));
    expect(tryVehicleTaxonomy).not.toHaveBeenCalled();
    expect(html).toContain('data-failed="false"');
  });

});
