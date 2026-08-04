// brand-url.test.ts — 三個品牌網址 helper 的純字串守門(D2e-1;2026-08-04)
//
// 從 `components/brand/BrandPageHeader.test.tsx` 搬過來 + 補 D2e-1 新增的兩件事。
// 元件那一半(「兩顆 CTA 真的指到這些網址」)仍留在 Header 的測試裡 —— 兩邊守的不是同一件事。

import { describe, expect, it } from 'vitest';
import { brandCatalogueUrl, brandIntroUrl, brandVehiclePickUrl } from './brand-url';

describe('brandCatalogueUrl', () => {
  it('slug 有做 encodeURIComponent(未來出現需跳脫字元時不會壞掉)', () => {
    expect(brandCatalogueUrl('a b')).toBe('/products?pbrand=a%20b');
    expect(brandVehiclePickUrl('a b')).toBe('/products?pbrand=a%20b&pick=vehicle');
  });

  it('🔴 第二參數 category —— 空字串不加 key、有值才加且 encode', () => {
    // 設計稿 `brand-content-data.js:1187` 的 `(slug, category = "") => ... category ? ... : ""`。
    // 「空字串照樣加 &category=」的話,橫幅那兩顆 CTA(用的是同一個函式)會多帶一個空分類,
    // 而 `products-url-state.tsx:63-64` 對空值是 `if (!raw) return null` ⇒ 症狀是零。
    expect(brandCatalogueUrl('akrapovic')).toBe('/products?pbrand=akrapovic');
    expect(brandCatalogueUrl('akrapovic', '')).toBe('/products?pbrand=akrapovic');
    expect(brandCatalogueUrl('akrapovic', '排氣系統'))
      .toBe(`/products?pbrand=akrapovic&category=${encodeURIComponent('排氣系統')}`);
    // 中文一定被 encode(沒 encode 的話這裡會直接看到那三個字)
    expect(brandCatalogueUrl('akrapovic', '排氣系統')).not.toContain('排氣系統');
  });

  it('🔴 category 帶 & 或 = 時不得撕裂 query string(注入形狀)', () => {
    // 分類名目前 12 種都是純中文,但這條守的是「哪天分類表加了帶符號的名字」——
    // 沒 encode 的話 `A&sort=price` 會憑空多出一個 sort 參數。
    expect(brandCatalogueUrl('akrapovic', 'A&sort=price'))
      .toBe('/products?pbrand=akrapovic&category=A%26sort%3Dprice');
  });
});

describe('brandIntroUrl', () => {
  it('🔴 → /brands/<slug>(計畫 §3 A 案;route 自 D3a 起存在,/brands 總覽仍待 D3c)', () => {
    // 🔴 對照基準 = `brand-page.html:1606` 的 `intro()`(= `/products?pbrand=X#brand-about`),
    //    **不是** `brand-content-data.js:1188` 的 `PCM_introUrl`(該函式在設計稿內零引用)。
    //    理由全文在 `lib/brand-url.ts` 那條 doc,一處全文、這裡不重抄。
    expect(brandIntroUrl('akrapovic')).toBe('/brands/akrapovic');
    expect(brandIntroUrl('a b')).toBe('/brands/a%20b');
    // 🔴 反面要能被構造出來才有意義:B 案(`/products?pbrand=X#brand-about`)是計畫裡真的
    //    被考慮過的另一條路 ⇒ 有人改採它時這條會紅、逼他同步改磚牆的測試與註解。
    //    (原本寫的是 `not.toContain('brand-page.html')` —— 模板字串產不出那串字、零判別力,
    //     R1 nit 指出後換成這條。)
    expect(brandIntroUrl('akrapovic')).not.toContain('?pbrand=');
    expect(brandIntroUrl('akrapovic')).not.toContain('#brand-about');
  });
});
