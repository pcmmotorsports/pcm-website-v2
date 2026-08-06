// BrandIndex.tsx — 首頁 N°06 授權代理:20 家 logo 磚牆(D5f / 首頁對齊批 H2;2026-08-06)
//
// 字面搬自 Open Design `pcm-home-redesign/direction-b-layout-01-graphite-ember.html`
// (骨架 :1059-1069、組裝 :1142-1155、CSS :459-570 與「石墨+熔橘 套用層」:694-704)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD);總原則 = Sean 2026-08-06
// 逐字「反正就是全部依照最新的 OD 設計」(信箱 `D-122-A`)。
//
// ── 本片換掉了什麼(前一版是 17 家純文字清單)────────────────────────────────
//   · 資料源 `MOCK_BRANDS`(17 家、`data/products.js` era 的靜態名單、tagline 是行銷形容詞)
//     → `BRAND_CONTENT`(20 家、品牌頁與 `/brands` 共用的同一份內容模型)。
//     ⇒ 前一版檔頭記的那個既有落差(真目錄有商品、卻不在 17 家名單上的 akrapovic /
//       ebc / k-speed)**本片一併消失** —— 它們本來就在 BRAND_CONTENT 的 20 家裡。
//   · 版面 `.ed-brands` 五軌文字列 → `.b-brands` / `.b-brand-wall` 五欄磚牆(≤1200→4、≤700→2)。
//   · 磚上那一句 = `wallTagline`(品類描述,H1 標點遷移時隨 OD 來源一起進資料層,
//     `brand-content-types.ts` 逐字寫「消費端是 D5f 磚牆片」=本片)。
//
// ── 三處「照 repo 契約、不照設計稿字面」(route adaptation,同 D3a/D3c-3 的處理)──
//  1. 🔴 **每一磚的目的地**:OD 組裝 :1148 是 `/products?pbrand=<slug>#brand-about`
//     —— 那是原型時期的網址契約(意圖 = 品牌**介紹**,不是商品目錄)。本線 2026-08-03
//     計畫 §3 已拍 **A 案**(新 route `/brands/<slug>` + 舊字面靠 `BrandAboutRedirect` 保住)
//     ⇒ 這裡用 `brandIntroUrl`,與 `/brands` 總覽卡片、品牌頁磚牆同一個函式。
//     ⚠️ 這也是**意圖的改變**:前一版每列指 `/products?brand=<id>`(看這個品牌的商品),
//        本版指品牌介紹頁。前一版檔頭自己寫「改動這一半屬 D5 首頁重排的範圍」——本片就是它。
//  2. 🔴 **logo 用真的 DOM 元素、不用 `a::before` + 20 條 `data-od-id` 選擇器**:
//     OD 把 20 張 logo 寫成 `.b-brand-wall a[data-od-id="brand-card-<slug>"]::before`
//     的 background-image(:498-517)+ 20 條 `--logo-scale`(:518-537)。照抄要把
//     `data-od-id`(原型標記)搬進正式站 DOM,而且第 21 家品牌會**靜默沒有 logo**
//     (CSS 沒有那條選擇器、沒有任何測試看得見)。改成 `<span class="b-brand-logo">`
//     + inline `background-image` / `--logo-scale`,與 `/brands` 總覽卡片同一個做法
//     (`BrandDirectoryRoot.tsx:42-45`)⇒ 資產與校正值都由資料求出、缺一家會被守門抓到。
//     幾何(高 54px、寬 86%)與 20 個校正值都是 OD 字面,零改動。
//  3. 表頭右側那顆「品牌專區」連結**不再畫**:OD 的表頭只有 `<h2>`(:1060-1062),
//     「看全部品牌」改由磚牆最後那塊跨滿一列的 CTA 磚承擔(:1067)。
//     ⚠️ D3c-5 關卡2 R1 must-fix 的那個真缺陷(首頁上同名「品牌專區」指到兩個地方)
//        **沒有回來**:CTA 磚指的一樣是 `/brands`,與 Header / 頁尾同一個目的地。
//
// ── 一處對設計稿的申報偏離(鐵則 1 可追性;依 Sean 拍板)──────────────────────
//  🔴 **表頭字面拿掉了家數**:OD :1061 逐字是「Brands · 品牌專區 **20**」,本版只寫
//     「Brands · 品牌專區」。理由 = Sean 2026-08-05 拍板「**首頁對外不報家數**」
//     (無可查證來源、廣告不實風險)。
//     ⚠️ **守門不是 `app/page.test.tsx` 那條家數負向斷言**(R1 F1 更正:本檔上一版這樣寫,
//        而實測那條的 regex `[0-9０-９]+\s*[多餘]?\s*[大家個]` 對 OD 真字面「品牌專區 20」
//        回 false —— 它抓的是「20 家 / 20 多家」那種寫法)。真正守住這一條的是
//        `BrandIndex.test.tsx` 的表頭斷言:字面精確比對 + 表頭那顆 `<span>` 不得含任何數字。
//     D-122-A 的總原則覆蓋的是**版面**,不是既有的文案拍板 —— 同一封信裡
//     Q1=B 也明寫「愛車狀態換標題凍結不變、本板只覆蓋版面」,同一個形狀。
//     ⚠️ 「20」這個字面若要回來,是 Sean 的題(已在 D-2xx 收工信問)。
//  ⚠️ 泛白不可點(下方)同樣是設計稿沒有的狀態,依 Sean 2026-08-04 拍板;OD 回寫債照 #322。
//
// ── 目錄零商品的品牌:泛白且不可點(D3c-2 起,本片沿用)────────────────────────
// 🔴 Sean 2026-08-04 拍板(信箱 `C-31-A`)、主視窗 `C-33-A` 裁示「同一拍板的一致執行」
//    ⇒ 那幾磚渲染成 `<span>` 而不是 `<Link>`:**不是**「`<a>` 拿掉 href」也不是
//    「加 aria-disabled」—— 沒有 href 的 `<a>` 仍會被部分報讀器唸成連結。
// ⚠️ 空集合 = 全部泛白(`fetchBrandsWithProducts` 失敗時的 fail-closed,見該函式 doc);
//    撈取失敗**不會**被快取住(try/catch 包在 `getCatalogBrandTaxonomyCached` 外面),
//    但「某家一上架商品後多久變回可點」有 15 分鐘上限(`lib/products.ts` 的
//    `CATALOG_REVALIDATE_SECONDS` + 未接的 `revalidateTag('catalog')`)。
// 🔴 磚上**看不到品牌名**(只有 logo 圖 + 品類描述)⇒ 泛白磚的那句只給報讀器的話要**帶品牌名**,
//    否則報讀器使用者聽到的是一句沒有主詞的「(暫無商品)」。字面與 `/brands` 卡片一致
//    (`BrandDirectoryRoot.tsx:86`),不發明第三種說法。

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { BRAND_CONTENT } from '@/data/brand-content';
import { BRAND_TRIM_LOGO_SCALE } from '@/data/brand-trim-logo-scale';
import { brandTrimLogo } from '@/lib/brand-asset';
import { brandIntroUrl } from '@/lib/brand-url';

function BrandTile({
  brand,
  index,
  isEmpty,
}: {
  brand: (typeof BRAND_CONTENT)[number];
  index: number;
  isEmpty: boolean;
}) {
  // 編號 = **位置標記 01-20、跟著陣列順序走**,不是品牌 id(OD :1141 逐字)。
  const number = String(index + 1).padStart(2, '0');
  // 🔴 無條件輸出 `--logo-scale`(同 `/brands` 卡片):它是從一張獨立的表求出來的,
  //    漏掉一家時吃預設 1 會**看起來只是有點小**、沒有任何訊號 ⇒ 守門盯的是鍵集合。
  const logoStyle = {
    '--logo-scale': BRAND_TRIM_LOGO_SCALE[brand.slug] ?? 1,
    backgroundImage: `url('${brandTrimLogo(brand.slug)}')`,
  } as CSSProperties;

  const inner = (
    <>
      <span className="b-brand-top">
        <span className="b-brand-num">{number}</span>
        <span className="b-brand-country">{brand.country}</span>
      </span>
      {/* 空元素:內容是 background-image。用 `<img>` 的話 alt 要嘛重複唸品牌名
          (品牌頁磚牆 #308 那個題目),要嘛空字串等於多一個無意義節點 ——
          這裡品牌名已經在 `aria-label`(可點磚)或 sr-only(泛白磚)裡講過一次。 */}
      <span className="b-brand-logo" style={logoStyle} />
      <span className="b-brand-tag">
        {brand.wallTagline}
        {isEmpty && <span className="ed-sr-only">{brand.name}(暫無商品)</span>}
      </span>
    </>
  );

  return (
    <li>
      {isEmpty ? (
        <span className="is-empty">{inner}</span>
      ) : (
        // aria-label 字面 = OD 組裝 :1149(`${name}｜${wallTagline}`):磚上看得見的字只有
        // 品類描述,報讀器要靠這裡才知道是哪一家。
        <Link href={brandIntroUrl(brand.slug)} aria-label={`${brand.name}｜${brand.wallTagline}`}>
          {inner}
        </Link>
      )}
    </li>
  );
}

export function BrandIndex({ availableSlugs }: { availableSlugs: ReadonlySet<string> }) {
  return (
    <section id="brand-index" data-reveal className="b-brands">
      <div className="ed-section-head">
        {/* OD :1061 是 `<h2>`(前一版是 `<div>`):這一段有語意上的標題,報讀器的
            區塊導覽才走得到。`.ed-section-label` 已補 `margin: 0`(OD :76 字面同款)。 */}
        <h2 className="ed-section-label">
          <span className="ed-mono">N°06</span>
          <span>Brands · 品牌專區</span>
        </h2>
      </div>
      <ul className="b-brand-wall">
        {BRAND_CONTENT.map((brand, index) => (
          <BrandTile
            key={brand.slug}
            brand={brand}
            index={index}
            isEmpty={!availableSlugs.has(brand.slug)}
          />
        ))}
        {/* 「看全部品牌」不是品牌、留在版型裡(OD :1066-1067 逐字);跨滿一列。
            🔴 它**不受泛白邏輯影響**:`/brands` 總覽頁本身永遠有東西可看。 */}
        <li className="is-cta">
          <Link href="/brands">
            <span>看全部品牌</span>
            <span aria-hidden="true">→</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
