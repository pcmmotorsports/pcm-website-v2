// FeatureEditorial.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°05 · This month · 本月聚焦)
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 1 條):'brand-detail' → 商品目錄篩該品牌。
//   🔴 **D5e-1 更正兩處過期字面**(R1 must-fix,原文與同檔程式碼相反):
//      ①原寫「brandId='rizoma'(硬寫死)」—— 本片正是把硬寫死拆掉,現在吃 `focus.slug`。
//      ②原寫「/brands/rizoma 路由不存在=404」—— **那個前提已消失**:`/brands/<slug>` 於 D3a 落地、
//        `/brands` 總覽於 D3c-3 落地(同 `BrandIndex.tsx` 檔頭記過的同一件事)。
//      ⇒ 現在連 `/products?brand=<slug>` 是**沿用既有行為、不是因為路由不存在**。
//      ⚠️ 這一顆用的是 legacy key `?brand=`,而新網址契約是 `?pbrand=`
//        (`products-url-state.tsx` 逐字:「新網址一律輸出不會和車款衝突的 `?pbrand=`」)。
//        🔴 **R2 更正:我原本寫的理由「換 key 會牽動 vehicle 長版 fallback」是錯的** ——
//           那條 legacy 讀取是為舊書籤而留,改**本呼叫點的輸出**不會動到它。
//           真正的理由只是**本片刻意不動 CTA 的網址**(D5e-1 的範圍是「殼 + 輪播」,
//           改動線屬 D5e-2;OD handoff §三另指主按鈕應為 `/brands/<slug>`)。不編理由。
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示
//   🔴 D5a(2026-08-05)編號重標:OD `README.md`「區塊順序(第 7 步之後)」逐字
//      「編號是位置標記不是內容 id,所以聚焦與服務對調後編號跟著位置走」⇒ 本檔編號隨新位置改。
//      權威字面 = OD `direction-b-layout-01-graphite-ember.html` 裡的 `b-feature-num` 那顆 `N°05`。
//      🔴 D5d 順手更正(同族):此處原寫的行號實查已漂掉 —— 該稿當天仍在被改。
//         ⇒ **OD 稿一律不引行號、引逐字字串用 grep 找**;也不補新行號(R3 F4)。
//
// ── D5e-1(2026-08-05):硬編單一品牌 → **資料驅動 + 每 3 天輪播** ──────────────
// 本檔以前把 RIZOMA 的標題、敘述、三則事實、照片、CTA **全部寫死在 JSX 裡**。
// 現在改成吃一顆 `ResolvedBrandFocus`(`lib/brand-focus.ts` 解出來、`app/page.tsx` 傳進來):
// 資料從 `BRAND_CONTENT` + `BRAND_FOCUS` 覆蓋層來,輪播由日期決定。
//
// 🔴 **標題刻意維持「品牌名 + 鉤子」兩行**,不是只吐鉤子:
//    OD 契約逐字「title → 一句鉤子。**品牌名由版位另外顯示**,標題不重複寫品牌名」——
//    OD 是把品牌名放在眉標(`品牌焦點 · ${brand.name}`),本站是放在標題第一行。
//    兩者都滿足「名字有出現、且不由 title 提供」,而**維持現狀的那個版本視覺零變動**
//    ⇒ D5e-1 不動眉標字面(維持「This month · 本月聚焦」)。D5e-2 搬 OD 20 家鉤子進來時
//    直接吃 `focus.title`、這裡零改動。
//
// ⚠️ **本片唯一的可見文案變更**:照片圖說由硬編的「RIZOMA Stealth 後視鏡 · 鋁合金 CNC 削切」
//    改成資料層的 `origin`(RIZOMA = 「義大利」)。OD 契約逐字「圖說只給產地」,而原本那句
//    是寫死的產品說明、**輪到別家就是錯的** —— 這正是本片要拆掉的債。已列入 Sean 肉眼驗。
//
// ⚠️ `title` / `body` 走 `BrandRichString`(白名單 `<strong>`/`<br>`/`&amp;`)⇒ 一律過
//    `BrandRichText`,**絕不 dangerouslySetInnerHTML**(同品牌頁全線的規矩)。

import Link from 'next/link';
import { BrandRichText } from '@/components/BrandRichText';
import type { ResolvedBrandFocus } from '@/lib/brand-focus';

export function FeatureEditorial({ focus }: { focus: ResolvedBrandFocus }) {
  return (
    <section className="ed-feature">
      <div className="ed-feature-inner">
        <aside className="ed-feature-side">
          <div className="ed-feature-num ed-mono">N°05</div>
          <div className="ed-feature-kicker">This month · 本月聚焦</div>
          <h2 className="ed-feature-title">
            {/* 用樣板字串而不是 `{focus.name}.` 兩個相鄰文字節點:後者 React SSR 會插一顆
                `<!-- -->` 分隔符進 HTML(畫面零差異,但「與改動前逐字相同」就不成立了;R1 nit)。 */}
            {`${focus.name}.`}
            <br />
            <em>
              <BrandRichText>{focus.title}</BrandRichText>
            </em>
          </h2>
          <BrandRichText as="p" className="ed-feature-body">
            {focus.body}
          </BrandRichText>
          <div className="ed-feature-meta">
            {/* 標籤當 key:三則事實的標籤在同一家內不重複(OD 契約「不自行增列標籤」)。 */}
            {focus.facts.map(([label, value]) => (
              <div key={label}>
                <div className="ed-mono ed-feature-meta-k">{label}</div>
                <div className="ed-feature-meta-v">{value}</div>
              </div>
            ))}
          </div>
          <Link href={`/products?brand=${encodeURIComponent(focus.slug)}`} className="ed-link ed-link-dark">
            <span>探索 {focus.name}</span>
            <span className="ed-link-arrow" aria-hidden="true">→</span>
          </Link>
        </aside>
        {/* 🔴 `photo` 可能是 `null`(overlay 沒有那一家)⇒ 整個媒體欄不建,不是建一個壞掉的
            `<img src="">`。OD 的順位是 focus.photo → brand.band → logo 牌;後兩段屬 D5e-2
            (band 影像與 logo 牌的版位樣式都還沒接),這裡先只做第一段 + 不渲染。 */}
        {focus.photo && (
          <div className="ed-feature-media">
            <img src={focus.photo} alt={focus.name} />
            <div className="ed-feature-caption">
              <span className="ed-mono">Fig. 01</span>
              <span>{focus.caption}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
