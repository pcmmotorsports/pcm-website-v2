// BrandPageProducts.tsx — 品牌介紹頁的商品區(D3b;2026-08-04)
//
// 版面字面搬自 Open Design `pcm-home-redesign/brand-page.html`(骨架 `:1470-1489`、
// CSS `:717-727` + RWD `:882-883` / `:908` / `:921-922` / `:939` / `:949`;
// 鐵則 1 例外 = Sean 08-03 拍 Q1=B,本線 design 真權威在 OD)。
//
// 🔴 **卡片不照設計稿搬**:設計稿那 5 個 `.bp-slot` 是**骨架槽**,它自己的註解(`:1468-1469`)
//    逐字寫「正式頁面這一區直接用既有的商品列表元件,不是新做的」⇒ 本檔用既有 `ProductCard`。
//    所以 `.bp-slot` / `.bp-bar` 那組宣告(設計稿 `:731-741`)**刻意不搬**,只搬欄線與標題列。
//
// 🔴 **選擇器改名**(申報偏離,同 #311 的處理):設計稿的窄螢幕隱藏規則寫的是
//    `.bp-grid .bp-slot:nth-child(n+4)`,而我們的子元素是 `ProductCard` 的 `.pcard`
//    ⇒ 改成 `.bp-grid > :nth-child(n+4)`。**宣告一字未動、意圖逐字保留**
//    (「窄螢幕少顯示幾格」而不是「換行擠成兩排」);寫成 `.bp-slot` 的話那兩條規則
//    在正式站永遠不生效 —— 而畫面會多長出一排,沒有任何測試看得到。
//
// 資料由呼叫端傳入(`lib/brand-products.fetchBrandTopProducts`)—— 本檔是同步元件,
// 因為 `BrandPageRoot` 要留在 jsdom 測得動的形狀(async server component 進不了
// @testing-library 的 render)。撈資料屬 route 的責任,這也是 Next.js 的慣例分工。

import Link from 'next/link';
import type { MockProduct } from '@/data/mock-products';
import type { BrandContent } from '@/data/brand-content-types';
import { ProductCard } from '@/components/ProductCard';
import { brandCatalogueUrl } from '@/lib/brand-url';

export function BrandPageProducts({ brand, products }: { brand: BrandContent; products: MockProduct[] }) {
  // 0 筆 → 整區不渲染(同設計稿對選填區塊的 `dropSection()` 慣例)。
  // 🔴 **不留空骨架、也不自己編一句「目前沒有商品」** —— 對客人說什麼是文案決策(鐵則 R6),
  //    而且 5 家 0 商品品牌要不要掛品牌頁本身就在等 Sean 拍(backlog #315)。
  if (products.length === 0) return null;

  return (
    <section className="bp-products">
      <div className="bp-products-inner">
        <div className="bp-sec-label">Products</div>
        <div>
          <div className="bp-prod-head">
            <div>
              <h2>熱門商品</h2>
            </div>
            {/* 設計稿 `:1478` 的 href 是佔位 `/products`,執行期由 `:2028` 換成
                `catalogue(brand.slug)` ⇒ 正式站直接用同式的 `brandCatalogueUrl`。 */}
            <Link className="ed-link ed-link-sm" href={brandCatalogueUrl(brand.slug)}>
              <span>查看全部</span>
              <span className="ed-link-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          </div>
          <div className="bp-grid">
            {products.map((product) => (
              <ProductCard key={product.id} p={product} href={`/products/${product.slug}`} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
