// BrandPageProducts.tsx — 品牌介紹頁的商品區(D3b;2026-08-04)
//
// 🔴 **2026-08-07 R-2:本區已改用共用 `ProductRail` 橫捲**,以下檔頭的歷史說明多數已作廢,
//    保留是為了記錄「D3b 當時為什麼那樣搬」,不是現況描述:
//
// 〔歷史〕版面字面搬自 Open Design `pcm-home-redesign/brand-page.html`;卡片刻意不照稿搬
//    (稿的 5 個 `.bp-slot` 是骨架槽,它自己的註解逐字寫「正式頁面這一區直接用既有的商品列表元件」)
//    ⇒ 用既有 `ProductCard`,`.bp-slot` / `.bp-bar` 那組宣告不搬。**這條至今成立。**
// 〔已作廢〕`.bp-prod-head`(自刻表頭)與 `.bp-grid`(5 欄版位)連同窄螢幕那套
//    `nth-child(n+4) display:none` 的「選擇器改名」申報 —— **CSS 已整組刪除**,
//    表頭與版位都歸 rail。RWD 來源列的那幾條稿行號同樣不再對應任何規則。
//
import type { CatalogCardProduct } from '@/lib/catalog-page';
import type { BrandContent } from '@/data/brand-content-types';
import { ProductRail } from '@/components/ProductRail';
import { brandCatalogueUrl } from '@/lib/brand-url';

export function BrandPageProducts({
  brand,
  products,
  loadFailed,
}: {
  brand: BrandContent;
  products: CatalogCardProduct[];
  /**
   * ⟦front-CATALOGPRICEGENERALONLY⟧ 2026-09-08 加(codex must-fix)。
   * 🔴 `true` = **撈失敗**, 不是「這家沒有商品」—— 兩者在畫面上必須是**兩個畫面**。
   *    (同一句判別句 `contexts/FavoritesContext.tsx:50` 逐字寫過:
   *     「『讀不到』與『沒有收藏』必須是兩個畫面」。)
   * 🔴🔴 **必填(2026-09-08 codex R2 must-fix)** —— ⛔ ~~`loadFailed = false`~~
   *    **一個 `= false` 的預設值, 讓「漏傳」與「真的沒失敗」在編譯期長得一樣**
   *    ⇒ 漏傳 ⇒ 撈失敗又變回整區消失, 而 typecheck 全綠。
   *    📌 **那正是本片開頭在修的那個形狀**(`fetchCatalogPage` 的 `tier?`)——
   *      我在修它的同一片裡, 用同一個形狀又種了兩個。
   */
  loadFailed: boolean;
}) {
  // 0 筆 → 整區不渲染(同設計稿對選填區塊的 `dropSection()` 慣例)。
  // 🔴 **不留空骨架、也不自己編一句「目前沒有商品」** —— 對客人說什麼是文案決策(鐵則 R6),
  //    而且 5 家 0 商品品牌要不要掛品牌頁本身就在等 Sean 拍(backlog #315)。
  // 🔴🔴 **而【撈失敗】要先判, 不然它會被上面那條吃掉** —— 撈失敗時 `products` 也是空的
  //    ⇒ 順序寫反 ⇒ 整區消失, 而那正是 codex 抓到的那個病。
  if (loadFailed) {
    return (
      <section className="bp-products">
        <div className="bp-products-inner">
          <div className="bp-sec-label">Products</div>
          <ProductRail
            products={[]}
            error
            title="熱門商品"
            viewAllHref={brandCatalogueUrl(brand.slug)}
            viewAllLabel="查看全部"
            ariaLabel={`${brand.name} 熱門商品橫捲`}
            errorText="商品載入失敗、請稍後再試"
            variant="inset"
          />
        </div>
      </section>
    );
  }
  if (products.length === 0) return null;

  return (
    <section className="bp-products">
      <div className="bp-products-inner">
        <div className="bp-sec-label">Products</div>
        {/* 🔴 2026-08-07 R-2:本區由 5 欄 grid 改成**與首頁 N°02 同一顆 `ProductRail`**
            (Sean 拍板「品牌頁熱門商品與會員中心為你推薦都改成首頁那款橫向滑動一列」)。
            ⇒ 原本自己的 `.bp-prod-head`(標題 + 查看全部)與 `.bp-grid` 一起交給 rail ——
              「查看全部 + 左右箭頭」是一組,箭頭本來就住在 rail 的表頭裡。
            三個 prop 的給法各有理由,不是隨手:
              · `variant="inset"` —— rail 的 CSS 吃 7 個只活在 `.ed-page` 的 `--ed-*` token,
                本頁沒有那個作用域,不給 inset 的話整組宣告會**無聲失效**(見 `home.css` 的
                `.b-select-inset`;R-3 真瀏覽器量過三組對照)。
              · **不給 `reveal`** —— 品牌頁 Sean 2026-08-04 拍板 C「捲動揭示先不做」(backlog #316)。
              · **不給 `emptyText`** —— 本檔 0 筆時整區不 render(見上方 early return);
                rail 的 `emptyText` 可省正是為了這個情境,不必替客人編一句文案。
            ⚠️ **連帶的行為變更(申報)**:原本窄螢幕是用 `nth-child(n+4) display:none`
            **隱藏**多出來的格(≤1180 剩 3、≤620 剩 2),客人在手機上根本看不到第 4 筆之後;
            改 rail 之後**手機也滑得到全部** —— 這是產品面的改善,但確實是行為變更。 */}
        <ProductRail
          products={products}
          title="熱門商品"
          // 設計稿的 href 是佔位 `/products`,執行期換成 `catalogue(brand.slug)`
          // ⇒ 正式站直接用同式的 `brandCatalogueUrl`。
          viewAllHref={brandCatalogueUrl(brand.slug)}
          viewAllLabel="查看全部"
          ariaLabel={`${brand.name} 熱門商品橫捲`}
          // 🟢 **[2026-09-08 訂正 · 那個「哪天」到了]**
          // ⛔ ~~`errorText` 在本頁結構性不可達 … 撈失敗時品牌頁是「整區消失」~~
          // ✅ `fetchBrandTopProducts` 現在回 `{ products, loadFailed }` ⇒ **上面那條 `if (loadFailed)`
          //    就是錯誤狀態的入口**, 三區行為已收斂(首頁 / 會員中心 / 品牌頁都印錯誤文案)。
          // 📌 **舊字面留著** —— 它記著「一個傳進去而走不到的 prop, 三綠全綠、審查看不到」。
          // ⚠️ 本行這顆 rail 走的是**有商品**那條路 ⇒ 它的 `errorText` 仍然走不到, 而那是對的。
          errorText="商品載入失敗、請稍後再試"
          variant="inset"
        />
      </div>
    </section>
  );
}
