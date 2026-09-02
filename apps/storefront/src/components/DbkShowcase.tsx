// DbkShowcase.tsx — DBK SPECIAL PARTS 品牌形象區 N°01 + N°02(上架第 19 家、2026-09-03)
//
// 製作依據:骨架對照 `KspeedShowcase.tsx`(重量版 + YouTube facade),
//   N°01 三卡重用 pd-feature-*、N°02 重用 pd-bona-*(影片 facade + 故事兩段)+ pd-bs-*(信任狀四格)。
//   🔴 **影片用 facade 而不是本地 mp4** —— DBK 在 repo 裡**沒有** mp4(`find public -iname '*.mp4'` ⇒ 7 支無 dbk),
//     只有官方 YouTube ⇒ 與 Akrapovic / GILLES / RIZOMA 的 `<video className="pd-hero-band">` 不同,
//     而那是**素材決定的**,不是配置降級:重量版四個組成(三卡 / 影片 / 故事兩段 / 信任狀四格)一個不少。
//
// ═══ 本片的事實有【三個來源】, 逐條標明是哪一個 ═══
//
// 🔴🔴 **訂正(R1 F1, 2026-09-03)**:本檔頭原句寫「事實全部由本窗當場抓官網取得 … **不是轉述
//   `brand-content.ts`**」—— **那句話是假的, 而它是本片最嚴重的一格**(鐵則 11 字面 vs 事實)。
//   實查:版面上有 **5 句與 `brand-content.ts` 逐字相同**(`grep -cF` 各命中 1),而其中三個事實
//   (**LED 照明** / **排氣量** / **引擎護件·腳踏的固定點**)**官網來源 A、B 一句都沒有**。
//   ⇒ 🎯 我寫下那句話的當下真心以為它是對的 —— 我確實親自抓了官網,而我沒去數**版面上還有什麼
//     不是從那裡來的**。⇒ **「我查證過」與「版面上每一句都來自我查證的那份」是兩個宣稱。**
//   ⇒ 下面改成逐句標來源。**沒有標 A/B 的句子, 就是來源 C。**
//
//   ── 來源 A(官網 about 頁)`https://www.dbkspecialparts.com/en/content/6-about-us`
//      2026-09-03 本窗 firecrawl `maxAge:0` 強制 live 抓取、HTTP 200。逐條原文:
//     "DBK Special parts was born from the experience and research over more than 14 years of
//      DUCABIKE, a brand by which we have developed an extensive line of accessories for
//      Ducati motorcycles."
//     "we have introduced in the market products such as the oil bath clutch clear cover,
//      an accessory that has become a trend among owners of premium brands motorcycles."
//     "... to offer a new catalog of special accessories with the mission to meet the needs of all
//      motorcyclists. This need arises precisely from the huge request we have received all over
//      this years from customers who did not necessarily own Ducati motorcycles."
//     "DBK Special parts was born in 1999, an idea of Claudio Gandolfi ... and then since 2014,
//      creating an headquarter with more than 22 employees that design, make and sell accessories
//      for all the best motorcycle brands, always with an handcrafted quality but revised in a
//      modern key for design and production."
//     "The factory, which has over 2600 square meters, is equipped with state-of-the-art machinery
//      for CNC machining: highly qualified personnel manage operations on 3 and 5 axis equipment."
//     "The technical department makes use of the latest cad/cam softwares, 3D scanners and printers
//      for prototyping, essential for the R&D of our products."
//     "All DBK's products are 100% Made in Italy by our company."
//     地址逐字:"Via M. Serenari, 33/E - 40013 Castel Maggiore (BO) Italy"(= 波隆那 BO 省)
//
//   ── 來源 B(官網首頁)`https://www.dbkspecialparts.com/en/` 同日同法抓取。車系選單逐字:
//     "Select Brands Aprilia BMW Ducati Honda Italjet Kawasaki KTM Moto Guzzi Moto Morini
//      MV Agusta Suzuki Triumph Yamaha"(其後 Spare Parts / Clothing - Gadgets / Universal 不是車廠)
//      ⇒ **當天實數 13 家**。同頁嵌著本片用的影片 `HmESGjFkVPw`(頻道 "DBK Special Parts")。
//
//   ── 來源 C(我方 repo 既有已審內容)`apps/storefront/src/data/brand-content.ts` 的 dbk 那筆。
//      🔴 **它不是官網, 它是我們自己的品牌頁文案** —— 由品牌頁那條線另行查證過,而**本窗沒有重驗它**。
//      本片沿用它的句子(逐字,故意不改寫,讓品牌頁與商品頁對同一件事說同一句話):
//        · "內建 LED 讓它在夜裡也成立"(`brand-content.ts` craft:LED **官網 A/B 查無**;
//           佐證是我方商品照 `brands-prod/dbk/led-clutch.jpg` 檔名與畫面)
//        · "這類外蓋要對到車型與排氣量，不是通用件"(**排氣量**一詞官網 A/B 查無)
//        · "外觀相近，不代表孔位相同"(about.tail)
//        · "引擎護件與腳踏的固定點在不同車系之間差異甚大"(craft;**官網 A/B 查無**)
//        · 圖 alt "DBK 義大利廠內的 CAD 設計作業"
//
// 🛑 **【創立年份】刻意不上版面 —— 那是一個判斷, 不是漏掉。而 repo 裡有【四個】不相容的年份**:
//   ① 來源 A 同一頁自己就對不起來:"born in 1999" vs "more than 14 years of DUCABIKE"(⇒ 2013/14)
//   ② `brand-content.ts:601` 那筆的 facts 寫「Founded / 2009 年」
//   ③ `mock-brands.ts:22` 寫 `since: 2008`
//   ⇒ 四個數字互不相容 ⇒ 本片四格不放創立年份,改放來源 A 講得毫不含糊的那些
//     (2600 m² / 3+5 軸 / 2014 年起逾 22 名員工 / 100% Made in Italy)。
//   🔴 **而擋它的那把尺是【白名單】不是黑名單**(R1 F4):原版只擋 '1999' 與 '2009' 兩個字面
//     ⇒ **`since: 2008` 正好是它沒列到的那一個**,而黑名單永遠在跟下一個沒想到的值賽跑
//     (同 CLAUDE.md §Git 紀律 token 前綴那條)。測試已改成「四格裡的四位數年份**只准是 2014**」。
//   ⚠️ **而本片【沒有解掉】那個矛盾, 只是自己不參與**:`brand-focus.ts:110` 的
//     `['Founded', '2009 年']` 經 `app/page.tsx:161` → `FeatureEditorial` **印在首頁**,
//     同一個客人看得到 ⇒ 那一格不歸本片修,但不得把矛盾寫成已解(R1 F7 訂正)。
//
// 🛑 **【對應車系數】刻意不上版面。** 來源 B 當天實數 13,而 `brand-content.ts:625` 的信任狀寫 12
//   (清單 `:610` 無 Suzuki)⇒ 兩處印不同數字給同一個客人看是可見矛盾;且該數字每次 DBK 加車廠
//   就過期一次而**零訊號** ⇒ 版面列車廠名、不列筆數。
//   ⚠️ **而版面上點名的車廠只用【來源 B 與來源 C 都有】的那些**(R1 F8):Suzuki 只有來源 B 撐著、
//     單一來源未交叉驗證 ⇒ **不上版面**。抓錯的話版面會對客人點名一個 DBK 不做的車廠。
//   📌 `brand-content.ts:625` 那個 12 要不要改成 13,是品牌頁那條線的事,本片沒動;已回報主視窗
//     (`~/pcm-mailbox/心跳.tsv` 2026-09-03 00:48 `-front` 那列 + 同時段直送主視窗 pcm-website-v2-f0)。
//
// 🔴 **這個檔在什麼情況下會【變成假的】**:
//   ① 官網改寫 about 頁(2600 m² / 22 名員工 / 3+5 軸任一變動)⇒ 信任狀四格與故事段同時假掉。
//      驗法 = 重抓來源 A 逐句比;而**沒有任何東西會自己叫**,四格是 hardcode。
//   ② YouTube `HmESGjFkVPw` 被下架或改私人 ⇒ facade 點下去是空的。而**縮圖還在, 畫面看起來正常**。
//   ③ `brand-content.ts` 的 dbk 那筆被改寫 ⇒ 來源 C 那五句與品牌頁**不再一致**,而兩邊都不會紅。
//   ④ 🔴 來源 A / B 那兩次 live fetch 的原始回應**沒有存證落檔** ⇒ 從別人那一端只能寫
//      「與引文吻合,而引文本身未證實」(R1 射程聲明)。要關掉這格就得把原始回應存成 artifact。
//
// 🔴 素材 = `public/brands/dbk/*`,全部是 repo 既有檔的副本(不是新抓的),四支逐支比過 sha256 全相同:
//   logo.png              `8693ee426a50…` ← brand-assets/assets/brands-trim/dbk.png
//   video-thumb.jpg       `69640e120064…` ← brand-assets/assets/brands-prod/dbk/film-poster.jpg
//   story-clutch.jpg      `9be5590611ee…` ← brand-assets/assets/brands-prod/dbk/led-clutch.jpg
//   story-engineering.jpg `f577e87404d8…` ← brand-assets/assets/brands-prod/dbk/cad-room.jpg
//   🔴 刻意留副本、不直接引原檔:`/brands/<slug>/` 是 showcase 的資產(同第 17/18 家前例)。
//
// 🔴 **accent 落中性(只掛 `pd-bs`, 不加 `pd-bs--dbk`)** —— 無官方色票,不臆測專色(同 K-SPEED 前例)。
//   ⚠️ 而這是**刻意不加**:`product-page.css` 只有 8 個 `pd-bs--*`,rizoma / dna / kspeed / dbk 都不存在,
//   而 `:1182` `.pd-bs { --bs-accent: var(--c-text); }` 是真的中性 fallback ⇒ 加一個空 class
//   只會讓下一個人以為有顏色。要給 DBK 一個顏色 = Sean 的品味題,不在本片。
//
// 🔴 L2 內容(鐵則 9):信任狀四格 hardcode、無後台 CRUD(同其餘 18 家、backlog #271)。
//
// ⚠️ **肉眼驗的前提**(R1 nit 11):`lib/brand-products.ts` 實測 dbk 在目錄中 **0 筆**
//   ⇒ 真站上今天沒有商品頁走得到這一區;要看畫面得自己造一筆 brandSlug='dbk' 的假商品。
//
// 影片 facade onClick → useState 換入 iframe → 需 'use client'(同 KspeedShowcase 前例)。

'use client';

import { useState } from 'react';

// DBK 官方形象影片 YouTube ID。2026-09-03 本窗在官網首頁 `dbkspecialparts.com/en/` 實見它被嵌在頁上
// (頻道 "DBK Special Parts");`brand-content.ts:648` 的 video.youtube 亦是同一支 ⇒ 兩處獨立一致。
const DBK_VIDEO_ID = 'HmESGjFkVPw';

export function DbkShowcase() {
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <>
      {/* N°01 — 為什麼選 DBK(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-dbk01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/dbk/logo.png" alt="DBK SPECIAL PARTS" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-dbk01">為什麼選 DBK</h2>
          <p className="pd-lead">
            義大利波隆那近郊的自有工廠。官網把它的來歷寫得很直白：從替 Ducati 做部品開始，
            而不是 Ducati 車主的人一直來問同樣的東西——型錄就是這樣長出來的。
          </p>
        </div>

        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">從 Ducati 開始，不止於 Ducati</h3>
            <p className="pd-feature-desc">
              官網說 DBK 是從 DUCABIKE「十四年以上」的 Ducati 部品經驗長出來的，
              而開這條新型錄的理由逐字是：來問的客人「不見得騎 Ducati」。
              今天選單上從 Aprilia、BMW 一路到 Triumph、Yamaha 都在。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">透明離合器外蓋是他們帶起來的</h3>
            <p className="pd-feature-desc">
              官網把「油浴式透明離合器外蓋」列為自己投進市場的代表作，
              並說它「在高階車主之間成了一股風潮」。看得見離合器在動，是這家最好認的一件。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">三軸與五軸，都在自家廠裡</h3>
            <p className="pd-feature-desc">
              官網寫廠房「超過 2600 平方公尺」，由專責人員操作三軸與五軸 CNC 設備；
              技術部門用最新 CAD／CAM，並以 3D 掃描與列印做原型。所有產品「100% 義大利自製」。
            </p>
          </article>
        </div>
      </section>

      {/* N°02 — 自有工廠(官方形象影片 facade + 招牌件/工程兩段 + 信任狀四格;pd-bona-* + pd-bs 中性 accent) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-dbk02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  自有工廠'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-dbk02">設計、製造、銷售，在同一個總部</h2>
          <p className="pd-lead">
            設計、製造與銷售在同一個總部完成。官網說那是 2014 年起的事，逾 22 名員工，
            工法保留手工的品質，但用現代的方式重新整理過。
          </p>
        </div>

        {/* 官方形象影片(facade:縮圖 → 點擊才載入 YouTube iframe、省流量;同 K-SPEED/Bonamici 手法) */}
        <div className="pd-bona-video">
          {videoOpen ? (
            <iframe
              className="pd-bona-video-frame"
              src={`https://www.youtube.com/embed/${DBK_VIDEO_ID}?autoplay=1&rel=0`}
              title="DBK Special Parts 官方形象影片"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="pd-bona-video-facade"
              onClick={() => setVideoOpen(true)}
              aria-label="播放 DBK Special Parts 官方形象影片"
            >
              <img className="pd-bona-video-thumb" src="/brands/dbk/video-thumb.jpg" alt="" loading="lazy" />
              <span className="pd-bona-video-play" aria-hidden="true" />
              <span className="pd-bona-video-label">品牌形象影片 · DBK SPECIAL PARTS</span>
            </button>
          )}
        </div>

        {/* 招牌件段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/dbk/story-clutch.jpg" alt="DBK 透明離合器外蓋，內建 LED 照明" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Signature</div>
            <div className="pd-bona-h3">把看不見的那一半打開</div>
            <p className="pd-bona-p">
              {/* 🔴 第 1 句 = 來源 A 官網;LED 與「排氣量」兩處 = 來源 C brand-content.ts, 官網查無(檔頭 R1 F1) */}
              油浴式透明離合器外蓋是官網自己列出來的代表作，也是他們說「成了一股風潮」的那一件。
              透明蓋讓離合器的動作看得見，內建 LED 讓它在夜裡也成立。
              這類外蓋要對到車型與排氣量，不是通用件——問我們，我們幫您查。
            </p>
          </div>
        </div>

        {/* 工程段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/dbk/story-engineering.jpg" alt="DBK 義大利廠內的 CAD 設計作業" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Engineering</div>
            <div className="pd-bona-h3">外觀相近，不代表孔位相同</div>
            <p className="pd-bona-p">
              {/* 🔴 第 1 句 = 來源 A 官網;「引擎護件與腳踏的固定點」那句 = 來源 C, 官網查無(檔頭 R1 F1) */}
              技術部門以最新 CAD／CAM 作業，量產前先用 3D 掃描與 3D 列印做原型——官網說那是研發的必要環節。
              引擎護件與腳踏的固定點在不同車系之間差異甚大，逐車系重畫，
              才是同一份型錄橫跨那麼多車廠的前提。
            </p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;四格佐證逐字見檔頭來源 A)
            🛑 四格【刻意不放創立年份】—— 官網自己 1999 與「14 年以上」對不起來,
               而 brand-content.ts 寫 2009 是第三個版本 ⇒ 見檔頭。 */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2600 m²</div>
            <div className="pd-bs-stat-l">自有廠房</div>
            <div className="pd-bs-stat-s">over 2600 square meters</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3 + 5</div>
            <div className="pd-bs-stat-l">軸 CNC 並行</div>
            <div className="pd-bs-stat-s">3 and 5 axis equipment</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">22<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">名員工</div>
            <div className="pd-bs-stat-s">2014 年起的自有總部</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">100%</div>
            <div className="pd-bs-stat-l">義大利自製</div>
            <div className="pd-bs-stat-s">Made in Italy by our company</div>
          </div>
        </div>
      </section>
    </>
  );
}
