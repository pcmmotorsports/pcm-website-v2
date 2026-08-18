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

export function BrandDirectoryRoot({ availableSlugs }: { availableSlugs: ReadonlySet<string> }) {
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
