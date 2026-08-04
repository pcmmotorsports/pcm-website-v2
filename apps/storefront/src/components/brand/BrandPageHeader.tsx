// BrandPageHeader.tsx — 品牌介紹頁的上三段:麵包屑 / 品牌橫幅 / 四則事實(D2b;2026-08-04)
//
// 版面字面全部搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 1349-1385、CSS 593-660 與 869-960 的 RWD 段;鐵則 1 例外 = Sean 08-03 拍 Q1=B,
//  本線 design 真權威在 OD、不是 design-reference submodule)。
//
// 三段放同一支的理由:它們共用「橫幅的照片/無照片」這一個狀態
// —— `.bp-band` 的 `no-photo` class 決定幕的漸層,而事實列緊貼橫幅底線。
// 拆成三支會讓那個狀態要往下傳兩層。體積遠低於鐵則 6 的 400 行上限。
// (原註解與 commit body 寫過三種不同的行數 118/119/~140 —— 自我指涉的行數會隨每次
//  編輯過期,索性不寫數字,要知道跑 `wc -l` 就好。)

import Link from 'next/link';
import type { CSSProperties } from 'react';
// bp-* 樣式非全域(同 ProductPage.tsx 對 product-page.css 的處理)⇒ 用到的元件自帶,
// 否則裸奔(dev-preview/brands/[slug]/page.tsx 檔頭踩過這個坑)。D3 建路由後可上移到 route。
import '@/styles/brand-page.css';
import type { BrandContent } from '@/data/brand-content-types';
import { BrandRichText } from '@/components/BrandRichText';
// 資產前綴 D2c-2 移到 `@/lib/brand-asset`(理由見該檔:client 元件 BrandPageMedia 也要用,
// 留在本檔會把整支 Header 拖進 client bundle)。
import { brandAsset } from '@/lib/brand-asset';
// 三個網址 helper D2e-1 移到 `@/lib/brand-url`(理由見該檔:分類 chips 與品牌磚牆是第二、
// 第三個消費端,留在本檔會讓它們為了一行字串函式 import 整支 Header)。
import { brandCatalogueUrl, brandVehiclePickUrl } from '@/lib/brand-url';

export function BrandPageHeader({ brand }: { brand: BrandContent }) {
  const hasPhoto = brand.band !== undefined;

  // per-brand 旋鈕走 CSS 變數,與設計稿的 JS 同款(brand-page.html:1635/1638/1847):
  //   --band-focus 裁切焦點 / --logo-align 個別品牌把 logo 推開照片主體 / --fact-n 事實欄數
  const bandStyle: CSSProperties = brand.band
    ? ({ '--band-focus': brand.band.focus } as CSSProperties)
    : {};
  const logoStyle: CSSProperties = brand.band?.align
    ? ({ '--logo-align': brand.band.align } as CSSProperties)
    : {};
  const factsStyle = { '--fact-n': brand.facts.length } as CSSProperties;

  return (
    <>
      <nav className="bp-crumb" aria-label="麵包屑">
        <div className="bp-crumb-inner">
          <Link href="/">首頁</Link>
          <span className="bp-crumb-sep" aria-hidden="true">/</span>
          <Link href="/brands">品牌專區</Link>
          <span className="bp-crumb-sep" aria-hidden="true">/</span>
          <span className="bp-crumb-cur">{brand.name}</span>
        </div>
      </nav>

      {/* 🔴 沒有橫幅照的品牌**根本不建 <img> 節點**,不是用 hidden 藏
          —— 全站 reset 的 `img{display:block}` 會蓋掉 hidden,結果是上一家的照片留在畫面上
          (README「品牌介紹頁的橫幅」逐字)。`no-photo` 讓幕退回純石墨底 + 一道極淡熔橘暈。 */}
      <section className={`bp-band${hasPhoto ? '' : ' no-photo'}`} style={bandStyle}>
        {brand.band && (
          // loading="eager" + decoding="async" 是設計稿字面(brand-page.html:1633-1634)。
          // 🔴 不是可有可無的優化:這張是首屏 LCP 元素。少了 eager,它會排在非首屏資源
          //    後面才開始下載 —— 而且這個漏搬**不會讓任何測試變紅**,只會讓 LCP 變差。
          <img
            className="bp-band-photo"
            src={brandAsset(brand.band.src)}
            alt={brand.band.alt}
            loading="eager"
            decoding="async"
          />
        )}
        <div className="bp-band-inner">
          <div>
            <div className="bp-eyebrow">{brand.origin}</div>
            <h1 className="bp-title">{brand.name}</h1>
            {/* lede 帶白名單標記 ⇒ 一律過 BrandRichText,絕不直接內插 */}
            <BrandRichText as="p" className="bp-lede">
              {brand.lede}
            </BrandRichText>
            <div className="bp-actions">
              <Link className="bp-cta" href={brandCatalogueUrl(brand.slug)}>
                <span>逛全部商品</span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="bp-cta-ghost" href={brandVehiclePickUrl(brand.slug)}>
                <span>只看我的車能裝的</span>
              </Link>
            </div>
          </div>
          <div className="bp-band-logo" style={logoStyle}>
            {/* width/height 是設計稿字面(brand-page.html:1642)。CSS 已把寬度改成
                width:100%;max-width:340px,所以這兩個屬性不決定最終尺寸 ——
                它們給的是 **intrinsic aspect ratio**,讓瀏覽器在圖載完前就保留正確高度。
                拿掉的話 logo 那格在載入瞬間高度為 0、載完撐開 = CLS。
                🔴 alt 照設計稿用純品牌名(原本我寫成「X 標誌」= 未列入偏離清單的自作主張)。
                   ⚠️ 這會與上方 h1 的品牌名對報讀器重複播報一次;設計稿如此,本片不自行改。
                      改成 alt="" 屬偏離設計字面 = 鐵則 1 要走拍板 ⇒ **backlog #308**。 */}
            <img
              src={brandAsset(brand.bandLogo)}
              alt={brand.name}
              width={380}
              height={92}
            />
          </div>
        </div>
      </section>

      {/* 事實列:欄數 = facts 筆數(3 或 4)。查不到的欄位是整格拿掉、不是填「官方未載明」
          ⇒ 3 欄是合法狀態(brand-content-data.js 檔頭的文案硬規則)。
          🔴 facts 是純文字、**不過 BrandRichText** —— 設計稿的 JS 對它走 esc()
          (brand-page.html:1848-1849),實測 20 家 74 列零標記(D1b 已驗)。 */}
      <section className="bp-facts">
        <dl className="bp-facts-inner" style={factsStyle}>
          {brand.facts.map(([label, value, note]) => (
            <div className="bp-fact" key={label}>
              <dt>{label}</dt>
              <dd>
                {value}
                {note ? <span className="bp-fact-s">{note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
