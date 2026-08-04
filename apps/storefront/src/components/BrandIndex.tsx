// BrandIndex.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°06 · Authorized brands · 16 品牌 type-only wall、本刀 1b2 後位置 14 加 RIZOMA、共 17)
//
// design 用 window.PCM_DATA.brands → 改 import { MOCK_BRANDS }
//
// M-1-04 刀 1b2:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔):'brands' → /products / 'brand-detail'+brandId → /products?brand=${b.id}
// 🔴 Q4-S5(2026-07-05):原 link `/brands` 與 `/brands/${id}` 路由不存在 → 404;改導 /products?brand=<slug>
//   (b.id=品牌 slug=buildBrandTaxonomy 衍生 id;有商品品牌→過濾該品牌、無商品品牌→fail-safe 顯全部、
//   不再 404)。品牌專屬頁(/brands/[slug])留 Phase 2(#205 系列)。
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示
//
// ── D3c-2(2026-08-04):目錄零商品的品牌**泛白且不可點** ────────────────────────
// Sean 2026-08-04 拍板(信箱 `C-31-A`)原本講的是品牌介紹頁的磚牆,主視窗 `C-33-A` 裁示
// 「同一拍板的一致執行」⇒ 首頁這一排也照做(正式站首頁現在就踩得到,不等 D5 重寫)。
//
// ⚠️ **「自動恢復」有 15 分鐘上限、不是「下次 render」**(關卡2 R1 nit;實查
//    `lib/products.ts:420-424` 的 `unstable_cache` = `CATALOG_REVALIDATE_SECONDS` 900s
//    + tag `catalog`,而 `revalidateTag('catalog')` 同檔 :115 逐字「本批未接」)
//    ⇒ 某家品牌一上架商品後,首頁那一列**最長 15 分鐘後**才會變回可點。
//    🔴 反過來的那半我實查後與審查者的推測**不同**:撈取失敗**不會**被快取住 ——
//    `fetchCatalogBrandTaxonomy` 的 try/catch 包在 `getCatalogBrandTaxonomyCached` **外面**
//    (該函式的 doc 逐字寫「失敗 throw 不進快取(在快取外 catch 回 `[]`)」)
//    ⇒ fail-closed 的全泛白只影響那一次請求,不是 15 分鐘。
//    ⚠️ 這裡刻意引**函式名與那句話**、不引行號(關卡2 R2 nit:上一版寫 `:417`、實為 `:418`)
//       —— 同 MF1 的修法,別人一插註解行號就過期。
//
// 🔴 **實查(不沿用上一棒的說法,2026-08-04 親自比對兩份資料 + 真目錄)**:
//    · `MOCK_BRANDS` 17 家的 id **全部**都是 `BRAND_CONTENT` 20 家 slug 的子集
//      ⇒ 兩邊 id 同一個命名空間,`fetchBrandsWithProducts()`(回的是 catalog 側 id)
//      拿來比對本檔的 `b.id` 成立、不需要另一張對照表。
//    · 目錄零商品的那 5 家(dbk / gilles / kineo / rizoma / wrs)**確實都在這 17 家裡**。
//    · ⚠️ 反方向有個既有落差、**本片不處理**:真目錄 16 家裡有 3 家
//      (`akrapovic` / `ebc` / `k-speed`)**根本不在這 17 家名單上** ⇒ 首頁少列 3 個
//      有商品的品牌。那是 `MOCK_BRANDS` 這份靜態名單本身過期,屬 D5 重寫的事。
//
// 🔴 連結是 `?brand=`(舊 key)不是 `?pbrand=`:`products-url-state.tsx:93-97` 仍收這個
//    legacy key,所以**本片不動它** —— 換 key 會牽動該檔的 vehicle 長版 fallback
//    (同一個 `?brand=` 被兩個命名空間共用,見該檔 :80-85 與 backlog #269),不屬本片。

import Link from 'next/link';
import { MOCK_BRANDS } from '@/data/mock-brands';

export function BrandIndex({ availableSlugs }: { availableSlugs: ReadonlySet<string> }) {
  const brands = MOCK_BRANDS;

  return (
    <section className="ed-brands">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°06</span>
          <span>Authorized brands · 授權代理</span>
        </div>
        <Link href="/products" className="ed-link ed-link-sm">
          <span>品牌專區</span>
          <span className="ed-link-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
      <ul className="ed-brand-list">
        {brands.map((b, i) => {
          // 🔴 **不可點的那幾列渲染成 `<span>`**,不是「`<Link>` 拿掉 href」也不是 `aria-disabled`
          //    —— 理由與品牌頁磚牆同一條(`BrandPageBrandWall.tsx` 那段 doc):沒有 href 的
          //    `<a>` 仍會被部分報讀器唸成連結,`aria-disabled` 只改語意、鍵盤還是走得到。
          const isEmpty = !availableSlugs.has(b.id);
          const inner = (
            <>
              <span className="ed-brand-num ed-mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="ed-brand-name">{b.name}</span>
              <span className="ed-brand-tag">{b.tagline}</span>
              <span className="ed-brand-country ed-mono">{b.country?.toUpperCase()}</span>
              {/* 最後一格:可點的是箭頭(那是「可以去」的 affordance),不可點的整個不畫
                  —— 留著箭頭等於對客人說謊。
                  🔴 **不畫不會讓版面位移**:`.ed-brand-list > li > :is(a, span)` 的欄是
                     `grid-template-columns` 寫死的五軌,少一個子元素只是第五軌空著,前四格
                     位置不動(`.ed-brand-country` 的 `justify-self:end` 也仍在第四軌)。
                     ⇒ 這件事寬窄兩個斷點都用真瀏覽器量過,不是推論。
                  取而代之給一句只給報讀器的說明:否則這 5 家對報讀器就只是「少了連結」,
                  聽不出是**暫時**沒東西。`.ed-sr-only` 是絕對定位、不占格。 */}
              {isEmpty ? <span className="ed-sr-only">(暫無商品)</span> : (
                <span className="ed-brand-arrow" aria-hidden="true">→</span>
              )}
            </>
          );
          return (
            <li key={b.id}>
              {isEmpty ? (
                <span className="is-empty">{inner}</span>
              ) : (
                <Link href={`/products?brand=${b.id}`}>{inner}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
