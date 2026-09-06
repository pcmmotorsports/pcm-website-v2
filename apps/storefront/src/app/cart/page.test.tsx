// 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):route 改走【帶 `failed` 的那扇門】
//   ⇒ 本檔的 mock 與斷言跟著換受詞:`fetchVehicleTaxonomy` ⇒ `tryVehicleTaxonomy`,
//   回傳形狀從 `MockMotoBrand[]` 變成 `{ motoBrands, failed }`。
//   🛑 **不是為了讓測試變綠才改** —— 是被測的那一行真的換了呼叫對象;
//      不改的話這幾格會綠在一個【已經不存在的呼叫】上。
// @vitest-environment node
//
// `/cart` 的 smoke —— **這支存在的理由是一個【量到的缺口】**(`⟦search-VEHTAXSLOW⟧` · 2026-09-05):
//   要改 `tryVehicleTaxonomy`(七個入口共用)之前, 我查了回歸分母, 而
//   🔴 **`/cart` 只有 `actions.test.ts`, 頁面本身零測試**;PDP 更徹底 —— 整個目錄零測試檔。
//   🟢 正對照:首頁 `app/page` 被 **4** 支測試 import ⇒ 那把尺是活的。
//   ⇒ 🎯 **那兩個入口在回歸分母裡【結構上不存在】** ——
//     改壞它們, 三綠與 `vitest related` 都不會紅。
//
// 慣例照 `app/page.test.tsx`:node 環境、直接 await 呼叫 server component、
// `renderToStaticMarkup` 出真 HTML ⇒ 斷言的是**真的渲染出來的東西**, 不是原始碼字面。

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const tryVehicleTaxonomy = vi.fn();

// 🔴 `CartView` 是 client component ⇒ stub 掉, 而**把它收到的 motoBrands 筆數畫出來**
//    —— 少了這一步, 「taxonomy 有沒有真的傳進去」就只能靠讀原始碼(那是文字層, 擋不住行為改動)。
vi.mock('@/components/CartView', () => ({
  // 🔴 2026-09-06 R1 must-fix:stub 原本【只畫 motoBrands 不畫 failed】⇒ 那條接線零守門。
  CartView: function CartView({
    motoBrands,
    vehicleTaxonomyFailed,
  }: {
    motoBrands?: unknown[];
    vehicleTaxonomyFailed?: boolean;
  }) {
    return (
      <div
        data-stub="cart-view"
        data-moto-brands={String(motoBrands?.length ?? 'undefined')}
        data-failed={String(vehicleTaxonomyFailed)}
      />
    );
  },
}));
vi.mock('@/lib/products', () => ({ tryVehicleTaxonomy }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }),
}));
vi.mock('@/lib/auth/composition', () => ({
  getVehicleRepo: () => Promise.resolve({ listByCustomer: () => Promise.resolve([]) }),
}));

const { default: CartRoute } = await import('./page');

const BRANDS = [
  { id: 'yamaha', name: 'YAMAHA', models: [] },
  { id: 'honda', name: 'HONDA', models: [] },
];

describe('/cart 的車款清單', () => {
  it('🔴 正常世界:taxonomy 有資料 ⇒ 頁面渲染得出來, 而且【真的傳進 CartView】', async () => {
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await CartRoute());
    expect(html).toContain('data-stub="cart-view"');
    // 🛑 只斷言「渲染得出來」的話, 一個把 motoBrands 寫死成 [] 的改動照樣綠。
    expect(html).toContain('data-moto-brands="2"');
    expect(tryVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴 taxonomy 是【真的空】(不是掛了)⇒ 頁面仍然要渲染', async () => {
    // ⛔ ~~舊註解:「撈失敗會回 [] ⇒ 這一格是【車款清單掛了】」~~ ⇒ 🔴 **2026-09-06 起那句不成立**
    //   (R1 nit):`failed: false` 現在的意思是「**真的沒有**」;「掛了」是 `failed: true`, 見下面兩格。
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: false });
    const html = renderToStaticMarkup(await CartRoute());
    expect(html).toContain('data-stub="cart-view"');
    expect(html).toContain('data-moto-brands="0"');
  });

  it('🔴 這一頁【一定會叫】taxonomy —— 而那正是它付那 12 秒的原因', async () => {
    // 🛑 這一格是承重的:`⟦search-VEHTAXSLOW⟧` 的乙案會改這支的實作,
    //    而「它到底有沒有在叫」是那一片的前提。有人把它拿掉 ⇒ 這裡紅。
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    await CartRoute();
    expect(tryVehicleTaxonomy).toHaveBeenCalled();
  });
  // 🔴🔴 **2026-09-06 R1 must-fix:`failed` 那條接線【原本零守門】** ——
  //   stub 只畫 `motoBrands` 不畫 `failed` ⇒ route 把 `vehicleTaxonomyFailed` 寫死 `false` 也全綠。
  //   ⇒ 這兩格【成對】:少了負對照那格, 一個寫死 `true` 的實作照樣過。
  it('🔴 撈失敗(failed=true)⇒ 那個旗標【真的傳進 CartView】', async () => {
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: [], failed: true });
    const html = renderToStaticMarkup(await CartRoute());
    expect(html).toContain('data-failed="true"');
  });

  it('🔵 負對照:沒失敗(failed=false)⇒ 傳下去的是 false, 不是恆真', async () => {
    tryVehicleTaxonomy.mockReset().mockResolvedValue({ motoBrands: BRANDS, failed: false });
    const html = renderToStaticMarkup(await CartRoute());
    expect(html).toContain('data-failed="false"');
  });

});
