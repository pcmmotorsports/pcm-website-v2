// BrandPageBrandWall.tsx — 品牌介紹頁底部的品牌磚牆(D2e-1;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1487-1495、組裝 :2023-2029、CSS :741-790 與 :1307-1314、
//  RWD :879 / :906 / :912 / :919 / :938-941)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// 🔴 這**不是**首頁那個磚牆:首頁 `.b-brand-wall` = grid 5 欄(≤1200→4、≤700→2),
//    本區 `.bp-others-list` = flex-wrap(≤1180→4、≤620→3)。兩個不同元件、兩套排法
//    (計畫 §5.2 逐字)。看到兩邊「應該統一」的念頭 = 停下。
//
// 🔴 磚裡**只有 logo + 品牌名**,不要再加短描述(Sean 2026-08-02 明確否掉;計畫 §5.2:
//    「這條寫下來是因為它看起來像個沒做完的待辦」)。
//
// ⚠️ logo 用 `assets/brands-trim/<slug>.png` —— 這條路徑**不在資料層**,是由 slug 求出來的
//    (組裝 :2027 就是這樣寫的)。三組 logo 資產用途不同、不要拿錯:
//    `brands-trim/` 磚牆 / `brands-dark/` 深色橫幅大 logo(= 資料層的 `bandLogo`)/
//    `brands/` 原始檔。因為是求出來的,`data/brand-assets.test.ts` 那支「資料引用的檔案都在」
//    掃不到它 ⇒ 本片在該檔補了一條專門守這 20 檔的斷言。

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { BRAND_CONTENT } from '@/data/brand-content';
// bp-* 樣式與 `.bp-page` scope 由 `BrandPageRoot.tsx` 一併提供(D3a 收斂;理由見該檔檔頭)。
import { brandAsset } from '@/lib/brand-asset';
import { brandIntroUrl } from '@/lib/brand-url';

/** 磚牆 logo 的資產路徑。與 `bandLogo`(brands-dark/)是不同資料夾,不要拿錯。 */
export const brandTrimLogo = (slug: string): string => brandAsset(`assets/brands-trim/${slug}.png`);

/**
 * `availableSlugs` = 目錄裡真的有商品的品牌(`lib/brand-products.fetchBrandsWithProducts`)。
 *
 * 🔴 **Sean 2026-08-04 拍板**(信箱 `C-31-A`):20 家品牌頁全部上線,但**目錄零商品的那幾家,
 *    磚要泛白、而且不可點**(語意與視覺都不可點),等有商品再恢復。
 *    ⇒ 那幾磚渲染成 `<span>` 而不是 `<Link>`:**不是**「`<a>` 拿掉 href」也不是
 *    「加 aria-disabled」——沒有 href 的 `<a>` 仍會被部分報讀器唸成連結,而 `aria-disabled`
 *    只改語意、鍵盤還是走得到。`<span>` 兩邊一次做完。
 * 🔴 **這是設計稿沒有的狀態**(OD 只畫可點的磚)⇒ 鐵則 1 的申報偏離,依 Sean 拍板;
 *    OD 回寫債照 #319 前例併記。
 * ⚠️ 空集合 = 全部泛白(`fetchBrandsWithProducts` 失敗時的 fail-closed 行為,見該函式 doc)。
 */
export function BrandPageBrandWall({
  currentSlug,
  availableSlugs,
}: {
  currentSlug: string;
  availableSlugs: ReadonlySet<string>;
}) {
  return (
    <section className="bp-others">
      <div className="bp-others-inner">
        <div className="bp-sec-label">Brands</div>
        {/* 這層沒有 class 的 div 是骨架 :1490 就有的 —— 沒有它,h2 與磚牆會各自變成
            grid item,標題被塞進 200px 的標籤欄旁邊、磚牆再自己占一列。 */}
        <div>
          <h2>品牌介紹</h2>
          <div className="bp-others-list">
            {BRAND_CONTENT.map((item) => {
              const isCurrent = item.slug === currentSlug;
              // 目錄零商品 ⇒ 泛白且不可點(Sean 拍板)。當前這一家即使零商品也仍標 is-cur,
              // 否則客人在磚牆上找不到「我現在在哪」。
              const isEmpty = !availableSlugs.has(item.slug);
              const className = [isCurrent ? 'is-cur' : null, isEmpty ? 'is-empty' : null]
                .filter(Boolean)
                .join(' ') || undefined;
              const inner = (
                // 🔴 當前品牌**不從清單拿掉**(組裝 :2024-2026):加 is-cur + aria-current="page"。
                //    拿掉的話 ①客人在磚牆上找不到「我現在在哪一家」②20 家變 19 家,
                //    最後一列的 justify-content:center 會整排偏移。
                <>
                  {/* --logo-scale = 逐家光學校正(實測 7 家非 1、範圍 0.88-1.08)。
                      🔴 設計稿 :2025 只在 `logoScale !== 1` 時才輸出這個 style ——
                         照做,不要無條件寫 `--logo-scale: 1`:CSS 端的 `var(--logo-scale, 1)`
                         已經有預設值,無條件輸出只會讓 13 家的 DOM 多一個沒作用的 inline style。 */}
                  <span
                    className="bp-others-logo"
                    style={
                      item.logoScale !== 1
                        ? ({ '--logo-scale': item.logoScale } as CSSProperties)
                        : undefined
                    }
                  >
                    {/* loading="lazy" 是設計稿字面(:2027)。這 20 張在整頁最底部,
                        與橫幅那張 eager 的 LCP 圖是相反的處理,兩邊都不要順手統一。
                        🔴 **同一個品牌名在這一磚出現三次**:`title`(:2026 字面)+ `alt`(:2027 字面)
                           + 可見的 `.bp-others-name` ⇒ 報讀器會連播三次(R1 更正:我原本只認領
                           alt 那一半)。兩個都是設計稿字面 ⇒ 改成 `alt=""` + 拿掉 title
                           屬偏離鐵則 1、走拍板路徑,與 backlog **#308**(品牌頁 band logo 的
                           alt 與 h1 重複,`docs/phase-1-backlog.md:8125`)是同一個題目、一起解。 */}
                    <img src={brandTrimLogo(item.slug)} alt={item.name} loading="lazy" />
                  </span>
                  <span className="bp-others-name">
                    {item.name}
                    {/* 🔴 不可點的磚要說「為什麼」(關卡2 R1 nit 7):那 5 家從連結清單裡
                        靜默消失,報讀器使用者只會覺得少了幾家。`.bp-sr-only` 是本頁既有的
                        語意載體(年表的「關鍵事件:」在用,#312)。 */}
                    {isEmpty && <span className="bp-sr-only">(暫無商品)</span>}
                  </span>
                </>
              );
              // 🔴 `title` 只給可點的那些:不可點的磚給 title 會讓滑鼠停留跳出一個
              //    看起來像連結提示的浮動框,與「不可點」的訊息互相打架。
              return isEmpty ? (
                <span key={item.slug} className={className} aria-current={isCurrent ? 'page' : undefined}>
                  {inner}
                </span>
              ) : (
                <Link
                  key={item.slug}
                  className={className}
                  aria-current={isCurrent ? 'page' : undefined}
                  href={brandIntroUrl(item.slug)}
                  title={item.name}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
