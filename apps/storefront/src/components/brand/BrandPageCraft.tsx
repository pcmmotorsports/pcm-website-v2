// BrandPageCraft.tsx — 品牌介紹頁的 Craft 區:製程步驟兩欄大圖(D2d-2;2026-08-04)
//
// 字面搬自 Open Design `pcm-home-redesign/brand-page.html`
// (骨架 :1425-1434、組裝 :1991-2005、CSS :1108-1132、RWD :1170-1180 與 :1194-1196)。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 OD)。
//
// ⚠️ 實測分布(2026-08-04,對 20 家求值):
//    craft 20 家全有,每家 **2 或 4 步**(版面是 2 欄格線 ⇒ 步數要能被 2 整除,
//    否則右下留一個看起來像沒做完的角;型別檔 :92-94 已記這條)。
//    · `rows[].d` 帶標記(20 家共 38 列)⇒ 過 BrandRichText;`step` / `t` / `alt` 全走 esc ⇒ 純文字
//    · `rows[].video` **只有 rizoma 兩列** —— 🔴 那是「製程格內的影片」,與 D2c-2 的
//      `brand.video`(About 右欄的品牌影片)是**兩個不同欄位**,型別檔 :98 已註明。
//      D1a 當初用 grep 數 `video:` 得到 13 就是被這個鍵騙的。
//    · `rows[].focus` 5 列有(裁切焦點);**每一列都有 `img`** ⇒ 設計稿 :2002 的
//      「沒有 img 就整個 media 不建」在型別上就不存在(`img` 非選填),本片不建那個分支。

import type { CSSProperties } from 'react';
import type { BrandContent } from '@/data/brand-content-types';
import { BrandRichText } from '@/components/BrandRichText';
import { brandAsset } from '@/lib/brand-asset';
import '@/styles/brand-page.css';

export function BrandPageCraft({ brand }: { brand: BrandContent }) {
  return (
    <section className="bp-craft">
      <div className="bp-craft-inner">
        <div className="bp-sec-label">Craft</div>
        {/* 同 Why:這層無 class 的 wrapper 讓標題與格線擠在第二欄裡。
            拿掉的話兩者各自變成 grid item,200px 標籤欄那格會被吃掉。 */}
        <div>
          <div className="bp-craft-head">
            <h2>{brand.craft.title}</h2>
          </div>
          <div className="bp-craft-grid">
            {brand.craft.rows.map((row) => (
              <article className="bp-craft-panel" key={row.t}>
                <div className="bp-craft-media">
                  {row.video ? (
                    // 🔴 影片列用**原生 controls + poster + preload="none"**,不做 D2c-2 那套
                    //    點播邏輯,也**不自動播**(設計稿 :1995-1996 逐字:面板小、不值得再寫一套;
                    //    兩支同時跑很吵)。preload="none" ⇒ 沒按就完全不抓影片位元組。
                    <video
                      src={brandAsset(row.video)}
                      poster={brandAsset(row.img)}
                      controls
                      loop
                      playsInline
                      preload="none"
                      // 圖說掛在元素上:報讀器對 <video> 只念得到 aria-label / title。
                      // 🔴 **只留 aria-label、不掛 title**,刻意偏離設計稿字面(:1999 兩個都給
                      //    同一個字串)—— Sean 2026-08-04 拍 A(backlog #312 第二條)。
                      //    兩個同字串時,部分輔具會先念 name(aria-label)再念 description(title)
                      //    = 同一句聽兩次。留 aria-label 的理由:它是顯式的無障礙名稱契約,
                      //    title 的行為(是否被當 description、是否顯示 tooltip)各家不一。
                      //    ⚠️ 代價 = 滑鼠停留不再有 tooltip;那本來就不是設計稿要的功能。
                      aria-label={row.alt || row.t}
                      style={row.focus ? ({ objectPosition: row.focus } as CSSProperties) : undefined}
                    />
                  ) : (
                    <img
                      src={brandAsset(row.img)}
                      alt={row.alt}
                      loading="lazy"
                      style={row.focus ? ({ objectPosition: row.focus } as CSSProperties) : undefined}
                    />
                  )}
                </div>
                <div className="bp-craft-step">{row.step}</div>
                <h3>{row.t}</h3>
                {/* d 帶白名單標記(38 列)⇒ 過 BrandRichText,絕不直接內插 */}
                <BrandRichText as="p">{row.d}</BrandRichText>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
