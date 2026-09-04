// @vitest-environment node
//
// `/cart` 的 smoke —— **這支存在的理由是一個【量到的缺口】**(`⟦search-VEHTAXSLOW⟧` · 2026-09-05):
//   要改 `fetchVehicleTaxonomy`(七個入口共用)之前, 我查了回歸分母, 而
//   🔴 **`/cart` 只有 `actions.test.ts`, 頁面本身零測試**;PDP 更徹底 —— 整個目錄零測試檔。
//   🟢 正對照:首頁 `app/page` 被 **4** 支測試 import ⇒ 那把尺是活的。
//   ⇒ 🎯 **那兩個入口在回歸分母裡【結構上不存在】** ——
//     改壞它們, 三綠與 `vitest related` 都不會紅。
//
// 慣例照 `app/page.test.tsx`:node 環境、直接 await 呼叫 server component、
// `renderToStaticMarkup` 出真 HTML ⇒ 斷言的是**真的渲染出來的東西**, 不是原始碼字面。

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const fetchVehicleTaxonomy = vi.fn();

// 🔴 `CartView` 是 client component ⇒ stub 掉, 而**把它收到的 motoBrands 筆數畫出來**
//    —— 少了這一步, 「taxonomy 有沒有真的傳進去」就只能靠讀原始碼(那是文字層, 擋不住行為改動)。
vi.mock('@/components/CartView', () => ({
  CartView: function CartView({ motoBrands }: { motoBrands?: unknown[] }) {
    return <div data-stub="cart-view" data-moto-brands={String(motoBrands?.length ?? 'undefined')} />;
  },
}));
vi.mock('@/lib/products', () => ({ fetchVehicleTaxonomy }));
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
    fetchVehicleTaxonomy.mockReset().mockResolvedValue(BRANDS);
    const html = renderToStaticMarkup(await CartRoute());
    expect(html).toContain('data-stub="cart-view"');
    // 🛑 只斷言「渲染得出來」的話, 一個把 motoBrands 寫死成 [] 的改動照樣綠。
    expect(html).toContain('data-moto-brands="2"');
    expect(fetchVehicleTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('🔴 taxonomy 回空(它自己 catch 掉失敗時就是這樣)⇒ 頁面【仍然要渲染】', async () => {
    // 🔵 `tryVehicleTaxonomy` 撈失敗會回 `[]` ⇒ 這一格是「車款清單掛了, 而購物車照樣打得開」。
    fetchVehicleTaxonomy.mockReset().mockResolvedValue([]);
    const html = renderToStaticMarkup(await CartRoute());
    expect(html).toContain('data-stub="cart-view"');
    expect(html).toContain('data-moto-brands="0"');
  });

  it('🔴 這一頁【一定會叫】taxonomy —— 而那正是它付那 12 秒的原因', async () => {
    // 🛑 這一格是承重的:`⟦search-VEHTAXSLOW⟧` 的乙案會改這支的實作,
    //    而「它到底有沒有在叫」是那一片的前提。有人把它拿掉 ⇒ 這裡紅。
    fetchVehicleTaxonomy.mockReset().mockResolvedValue(BRANDS);
    await CartRoute();
    expect(fetchVehicleTaxonomy).toHaveBeenCalled();
  });
});
