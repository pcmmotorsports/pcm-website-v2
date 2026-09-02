// BrandDirectoryRoot.tsx — `/brands` 品牌總覽頁的組裝點 + `.bd-page` 色票 scope(D3c-3;2026-08-05)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-directory.html`
// (骨架 :120-137、組裝 :170-182)。鐵則 1 例外 = Sean 2026-08-03 拍 Q1=B。
//
// 🔴 **scope 與 CSS import 綁在同一支元件**,理由與 `BrandPageRoot.tsx` 完全相同:
//    色票掛在 `.bd-page` 上(不能進 `:root`,會讓正式站每一頁變色),而 class 由呼叫端
//    手寫的話,漏掛時整頁沉默降級、三綠與元件測試都不會紅。綁在一起 ⇒ 拿得到樣式就一定有 scope。
//    ⚠️ 同樣的單點風險也照抄過來:**這支的 CSS import 被刪掉時整頁裸奔而測試全綠**
//    ⇒ `BrandDirectoryRoot.test.tsx` 有一條**讀原始碼**的守門(本檔必須有、其餘 src 必須沒有)。
//
// 🔴 `<main>` 不是 `<div>`:設計稿 `:120` 的 `<main data-od-id="brand-directory">` 恰好包住
//    hero(:126)到 outro(:136)這一段,與本元件的範圍逐節點對齊。
//    站台 `<Header>` / `<HomeFooter>` 不進本元件(設計稿 :94 / :138 是站台層的東西,
//    而且設計稿 :17 自己就寫「正式站會收斂成同一個 React 元件」)。
//
// 🔴 **兩個入口的目的地都不照設計稿字面**(route adaptation,同 D3a 的處理):
//    設計稿 `aboutHref` = `/products?pbrand=X#brand-about`,那是原型時期的網址契約;
//    本線 2026-08-03 計畫 §3 已拍 **A 案**(新 route `/brands/<slug>` + 舊字面靠 redirect 保住)
//    ⇒ 這裡直接用 `brandIntroUrl`。`productsHref` 則與設計稿同式 = `brandCatalogueUrl`。
//
// 📐 版面數字與家數是綁在一起的:hero 那面牆的欄數(10 / 5 / 4)刻意能整除 20,
//    格子是 5 / 4 / 2 欄。品牌家數一旦不是 20,兩邊都要重算 —— 守門在 `brand-directory.test.ts`。

import type { CSSProperties } from 'react';
import Link from 'next/link';
import '@/styles/brand-directory.css';
import { BRAND_CONTENT } from '@/data/brand-content';
import { BRAND_TRIM_LOGO_SCALE } from '@/data/brand-trim-logo-scale';
import { brandAsset, brandTrimLogo } from '@/lib/brand-asset';
import { brandCatalogueUrl, brandIntroUrl } from '@/lib/brand-url';
import {
  BRAND_AVAILABILITY_UNREADABLE,
  BRAND_AVAILABILITY_UNREADABLE_SUB,
} from '@/lib/brand-availability';

/** 卡片格子的兩個入口:有商品 → `<Link>`;零商品 → `<span>`(語意上也不可點)。 */
function BrandCard({ brand, index, isEmpty }: {
  brand: (typeof BRAND_CONTENT)[number];
  index: number;
  isEmpty: boolean;
}) {
  const number = String(index + 1).padStart(2, '0');
  // 🔴 設計稿 :181 無條件輸出 `--logo-scale`;照做(與品牌頁磚牆「只在 !== 1 時輸出」
  //    的處理不同 —— 那是各自設計稿的寫法,不是我在兩邊挑不同做法)。
  const logoStyle = {
    '--logo-scale': BRAND_TRIM_LOGO_SCALE[brand.slug] ?? 1,
    backgroundImage: `url('${brandTrimLogo(brand.slug)}')`,
  } as CSSProperties;

  const aboutInner = (
    <>
      <span className="bd-brand-top">
        <span>{number}</span>
        <span>{brand.country}</span>
      </span>
      <span className="bd-brand-logo" style={logoStyle} />
      {/* 🔴 泛白的卡**上下兩格都不畫箭頭**(關卡2 R1 must-fix 4:第一版只拿掉了下面那格,
          上面照樣輸出「品牌介紹 →」而那格已經是不可點的 `<span>` —— 同一張卡自相矛盾)。
          「品牌介紹」這四個字留著:它不是 affordance,是這一格在講什麼。 */}
      <span className="bd-brand-about-label">
        品牌介紹{isEmpty ? null : <> <span aria-hidden="true">→</span></>}
      </span>
    </>
  );

  return (
    <li>
      <article className={isEmpty ? 'bd-brand is-empty' : 'bd-brand'}>
        {/* 🔴🔴 **上半格「品牌介紹」為什麼在泛白時是不可點的 `<span>` —— 這是拍板, 不是搭便車。**
            ⚠️ **本段 2026-09-03 補上(`-front`)。在此之前, 本檔【唯一】引到的拍板是下面那段的
            `C-29-STOP` Q1 選項 B —— 而那一筆只管【下半格的可見文案】。**
            🎯 ⇒ 一段誠實的註解, 引了一個**射程比實際窄**的來源, 而它讓讀的人以為上半格沒人管。
            實錘:2026-09-03 Sean 逐字回報「品牌頁面按鈕按不下去」, 而查到根因的那條線
            **據此判為缺陷、提出「上半格永遠是 Link」的修法** —— 那會逐字推翻下面這筆拍板。

            ── **真正管上半格的是 `~/pcm-mailbox/C-31-A.md`(Sean 2026-08-04 拍板)逐字三條** ──
            `:5` **1.** 「品牌頁 20 家全部做好上線(`/brands/[slug]` 照現況, 不隱藏任何一家)。」
            `:6` **2.** 「磚牆與總覽的那 5 家磚『保留顯示、但泛白、暫不可點』:首頁磚牆、
                 品牌頁『其他品牌』磚牆、**`/brands` 總覽卡**, DBK/GILLES/KINEO/RIZOMA/WRS 的磚
                 顯示為去飽和/泛白狀態, **不掛連結**(非 `<a>` 或 aria-disabled+無 href,
                 **語意與視覺都不可點**)。」
            `:7` **3.** 「**各處指向這 5 家的連結先不連**, 等有商品再恢復。」
            該信標題逐字:「磚留著泛白不可點、**頁面做好不連結**」。

            📌 ⇒ **「那幾頁 200、內容齊全、而唯一的入口被關掉」不是缺陷的證據, 是這筆拍板被正確
            實作的證據。**第 1 條要頁上線, 第 2、3 條要入口不連 —— 兩者同時成立才是他要的形狀。
            🟢 而「有商品自動恢復」那半也在跑:判準走 `catalog_brand_counts` 衍生
            (`lib/brand-products.ts:89` `fetchBrandsWithProducts`), **不是寫死名單**
            ⇒ 拍板點名 5 家而今天只泛白 4 家, 因為 GILLES 已上架商品、磚自己恢復了。
            🛑 **⇒ 要讓上半格可點 = 推翻 `C-31-A` 第 2、3 條 = 必須 Sean 拍板, 不是一片修法。**
            ✅ **Sean 2026-09-03 已就此再拍一次, 逐字:「乙 不改。維持不可點, 等那幾家上架商品
            自動恢復」** ⇒ 本行為維持原狀; 本次改動**只補這段註解, 零行為改動**。 */}
        {isEmpty ? (
          <span className="bd-brand-about">{aboutInner}</span>
        ) : (
          <Link className="bd-brand-about" href={brandIntroUrl(brand.slug)} aria-label={`${brand.name} 品牌介紹`}>
            {aboutInner}
          </Link>
        )}
        {isEmpty ? (
          // 🔴 泛白的卡:下半格**留白、不畫箭頭也不放任何看得見的字**。
          //    箭頭是「可以去」的 affordance,留著等於說謊;而「暫無商品」這種**可見文案**
          //    我不自己編 —— C-29-STOP 的 Q1 選項 B 逐字就是「換成『這個品牌商品準備中』
          //    之類的字(文案要你給)」,而 **Sean 沒有選它**,選的是泛白這條路。
          //    自己補一句等於把他否掉的選項偷偷做進去(鐵則 R6:文案是 Sean 拍板)。
          //    🔴 **而 `C-29-STOP` 這一筆的射程【只到本格的可見文案】** —— 它答不出
          //    「上半格『品牌介紹』該不該可點」。那一格由 `C-31-A` 管, 逐字引在上面那段註解裡。
          //    ⚠️ 本行 2026-09-03 補(`-front`):在此之前本檔只引得到 `C-29-STOP`,
          //    而**搜這個編號的人會以為它涵蓋整張卡**。舊引用刻意留著, 讓搜舊來源的人同一發撞到訂正。
          //    ⇒ 只留一句**看不見但唸得到**的說明:否則那幾家對報讀器只是「少了兩個連結」,
          //      聽不出是暫時沒東西。要不要放可見的字,已在收工信當文案題問。
          <span className="bd-brand-products">
            {/* 🔴 **字面刻意與前兩片一致**(關卡2 R2 nit 1):D3c-1 磚牆與 D3c-2 首頁那排
                用的都是「(暫無商品)」。這一頁的卡片沒有品牌名在同一個可讀脈絡裡
                (上半格是 logo 圖、不是文字)⇒ 前面補品牌名,但**後半段字面回收既有的**,
                不再發明第三種說法。要統一成一份字串屬 D5 的文案收斂,已落 #322。 */}
            <span className="bd-sr-only">{brand.name}(暫無商品)</span>
          </span>
        ) : (
          <Link
            className="bd-brand-products"
            href={brandCatalogueUrl(brand.slug)}
            aria-label={`${brand.name} 查看商品`}
          >
            查看商品 <span aria-hidden="true">→</span>
          </Link>
        )}
      </article>
    </li>
  );
}

export function BrandDirectoryRoot({
  availableSlugs,
  loadFailed,
}: {
  availableSlugs: ReadonlySet<string>;
  /**
   * 🔴 **撈失敗**(≠ 目錄真的零商品)。線E:兩者都讓磚泛白,而客人看到同一個畫面
   * ⇒ 失敗時**多印一句**,磚照樣泛白(說話不等於放行)。
   * 同型前例 `components/account/tabs/FavoritesTab.tsx:35`(`MAIN-035 ①-1`【必修】)。
   */
  loadFailed?: boolean;
}) {
  const total = BRAND_CONTENT.length;

  return (
    <main className="bd-page">
      {/* ══ Hero:logo 牆 ══
          設計稿 :121-125 的註解逐字:「牆是規模感 —— 刻意出血、疊在文字後面,一眼看到
          代理了多少家;格子是可點選。牆用 aria-hidden,螢幕閱讀器只會讀到下面那份真正能點的清單。」
          🔴 牆用 `bandLogo`(深色底專用),格子用 `brands-trim`(淺色底)——
             **兩個資料夾不要混**(設計稿 :178 逐字)。牆這裡刻意讀資料層的 `bandLogo`
             而不是設計稿那個 `assets/brands-dark/${'${slug}'}.png` 樣板:本 repo 有 3 家的副檔名
             不是 .png(gilles/motogadget 是 .svg、samco 整個放在別的資料夾),
             照樣板組會有 3 個空格。 */}
      <section className="bd-hero">
        <div className="bd-hero-wall" aria-hidden="true">
          {BRAND_CONTENT.map((b) => (
            <i key={b.slug} style={{ backgroundImage: `url('${brandAsset(b.bandLogo)}')` }} />
          ))}
        </div>
        <div className="bd-wrap bd-hero-inner">
          <p className="bd-eyebrow">N°01 · BRANDS</p>
          <h1>依品牌找部品</h1>
          <p className="bd-hero-lede">選擇您熟悉的品牌，直接查看該品牌的全部商品與適用車型。</p>
          {/* 設計稿寫死「20 家」;改由資料求值 —— 家數與這句話不可能再對不上。 */}
          <p className="bd-hero-note">{total} 家合作品牌 · 持續依實際上架狀態更新</p>
        </div>
      </section>

      <section className="bd-directory" aria-labelledby="bd-directory-title">
        <div className="bd-wrap">
          <div className="bd-directory-head">
            <h2 id="bd-directory-title">全部品牌</h2>
            <span>{total} BRANDS</span>
          </div>
          {/* 🔴 讀不到 ⇒ 說一句(線E)。磚照樣泛白 —— 說話不等於放行:失敗時放行會把客人送進零商品的頁。 */}
          {loadFailed ? (
            <p className="brand-avail-note" role="alert">
              {BRAND_AVAILABILITY_UNREADABLE}
              <span>{BRAND_AVAILABILITY_UNREADABLE_SUB}</span>
            </p>
          ) : null}
          <ul className="bd-grid">
            {BRAND_CONTENT.map((brand, index) => (
              <BrandCard
                key={brand.slug}
                brand={brand}
                index={index}
                isEmpty={!availableSlugs.has(brand.slug)}
              />
            ))}
          </ul>
        </div>
      </section>

      <section className="bd-outro">
        <div className="bd-wrap bd-outro-inner">
          <p>想直接用車型或部品分類找貨？</p>
          <Link className="bd-catalogue-link" href="/products">
            查看全部商品 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
