// FeatureEditorial.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°05 · This month · 本月聚焦)
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 1 條):'brand-detail' → **品牌介紹頁**(D5e-2b 起;原為商品目錄篩該品牌)。
//   🔴 **D5e-2b 全面更新本段**(R2 F1:改完動線後,這裡整段與程式碼**相反**還留著)。
//      現況(以程式碼為準,下面每一句都對得上 diff):
//      ①主按鈕 = `brandIntroUrl(focus.slug)` → **`/brands/<slug>`**(不再是 `/products?brand=`)。
//        `/brands/<slug>` 於 D3a 落地、`/brands` 總覽於 D3c-3 落地,實測三家皆 200。
//      ②分類列 = `brandCatalogueUrl(focus.slug[, category])` → **`?pbrand=`**(新契約),
//        `?category=` 收分類名稱。**本元件已無任何 legacy `?brand=`**(守門在
//        `FeatureEditorial.test.tsx` 的「本元件不得再出現 legacy ?brand=」那條)。
//      ⚠️ **但首頁整頁還有 legacy `?brand=`**:`BrandIndex.tsx` 那 17 條尚未改
//        (handoff §三 地雷 1 逐字「2026-08-05 Sean 拍板:這次一起修」)——
//        那是 **D5f 磚牆片**的範圍(主視窗 C-104-A §三 #4 明列),**不是本片漏掉**。
//        🔴 已申報:見 manifest FeatureEditorial 條目與 C-202-STOP。
//      ~~原寫「現在連 /products?brand= 是沿用既有行為」「本片刻意不動 CTA 的網址」~~ = D5e-1 的字面,已作廢。
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
import { brandCatalogueUrl, brandIntroUrl } from '@/lib/brand-url';
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
          {/* ── D5e-2b 動線改版(OD `N05-FOCUS-HANDOFF.md` §三 + §6-2)──────────────
              一行兩區:實心主按鈕 = 去讀品牌故事;右半整排 = 去逛這家的商品。
              🔴 **取代了 D5e-1 那顆「探索 <品牌名>」的 `ed-link`**,同時還掉兩筆債:
                 ①目的地由 `/products?brand=`(legacy key)改成 `/brands/<slug>` 品牌介紹頁
                   —— handoff §三的契約,且該 route 自 D3a 起是活的。
                 ②「查看商品」不再是獨立一條連結,折進右邊分類列當領頭的「全部商品」
                   —— 右半整排都通往 `/products`,語意一致而且少一行文字(OD 逐字)。
              🔴 網址一律走 `lib/brand-url.ts` 的兩支,**不在這裡自己拼字串**:
                 那支是全站品牌網址的單一出處(品牌頁、磚牆、D3 route 都用它),
                 自己拼會讓「哪天要改 key」變成得記得改好幾處。 */}
          <div className="ed-feature-actions">
            <Link href={brandIntroUrl(focus.slug)} className="ed-feature-primary">
              <span>品牌介紹</span>
              <span className="ed-link-arrow" aria-hidden="true">→</span>
            </Link>
            {/* 分區訊號。`aria-hidden` 因為它對讀屏沒有意義 —— 讀屏拿到的是
                「連結」與「導覽」兩個不同的語意群組(OD 逐字)。 */}
            <span className="ed-feature-divider" aria-hidden="true" />
            <nav className="ed-feature-jump" aria-label={`${focus.name} 的商品分類`}>
              <Link className="is-all" href={brandCatalogueUrl(focus.slug)}>全部商品</Link>
              {/* 分類名同時是顯示文字與 `?category=` 的值(讀取端吃名稱,理由見
                  `ResolvedBrandFocus.categories` 的註解)。`brandCatalogueUrl` 內部已經
                  `encodeURIComponent`,這裡**不要再 encode 一次**(會變成 %25XX 的雙重編碼)。 */}
              {focus.categories.map((category) => (
                <Link key={category} href={brandCatalogueUrl(focus.slug, category)}>
                  {category}
                </Link>
              ))}
            </nav>
          </div>
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
