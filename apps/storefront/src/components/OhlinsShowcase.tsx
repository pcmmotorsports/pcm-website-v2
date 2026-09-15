// OhlinsShowcase.tsx — Öhlins 品牌形象區 N°01 + N°02(2026-09-15、文字版)
//
// Sean 2026-09-15 12:1x 逐字「我要上架 ARROW 、Ilmberger、Ohlins 這三個品牌的品牌介紹跟商品頁面的no1 no2 還沒做」。
// 主視窗交辦:照 WRS(adcf4b641)的形狀做;事實只寫官網查得到的;照片版權不明先不用。
//
// 版型:N°01 = design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md:236-261「Highlights」三卡;
//   N°02 = 同檔 :267-289「Engineering」數據列,落在家族既有的 pd-bs-stats。
// 🔴 **文字版:沒有 logo、沒有故事圖** —— repo 內 Öhlins 唯一的圖是 `brand-assets/assets/brands-prod/kineo/fitted-ohlins.jpg`
//   (那是 Kineo 的圖),交辦「照片版權不明先不用」⇒ eyebrow 用 pd-eb-label 文字、N°02 不放 pd-bona-brow。
// 🔴 accent 中性(只掛 pd-bs):稿的 hero 是淺黃底深字(來源 D),不是可以當 accent 的專色。
// 🔴 品牌名寫「Öhlins」(帶 Ö):ASCII 規則只管 brand-content.ts 的 name 欄(brand-content.test.ts:344,
//   Sean 2026-09-05 拍乙,為列印字形);showcase 文案沿用真名,同 AkrapovicShowcase 寫「Akrapovič」。
// 🔴 L2 hardcode(鐵則 9、backlog #271)。
// 🔵 文案每段寫成【一行】:JSX 裡換行會變成一個半形空格, 接在全形標點後面就多一格(同 ArrowShowcase 檔頭)。
//
// ═══ 事實來源 ═══
//   ── 來源 A:官網 ohlins.com,2026-09-15 A 窗以 firecrawl maxAge:0 live 抓(HTTP 200,directQuote 模式)。逐字原文:
//     `/about-us`(轉址 /en-us/about-us)
//       A1 "Founded by Kenth Öhlin in 1976"
//       A2 "Based in Upplands Väsby, Sweden"
//       A3 "500+ employees worldwide"
//       A4 "400,000+ shock absorbers, front forks, and steering dampers produced annually"
//       A5 "3 production facilities"
//       A6 "Part of Brembo Group since 2025"
//     首頁 `/`(轉址 /en-us)
//       A7 "For half a century, Öhlins has pushed the boundaries of suspension performance — earning 400+ racing titles
//           while improving the ride for enthusiasts around the world."
//       A8 "Since 1976, Öhlins has led the way in racing innovation — developing, testing, and refining the suspension
//           technology used by some of the world's top racing teams."
//       A9 meta description "Öhlins delivers world-leading suspension technology for MotoGP, Formula 1, UCI series, and a wide
//           range of performance vehicles worldwide."
//     `/about-us/history`(WebFetch,摘要模型轉述、非逐字 ⇒ 版面只用與 A1 一致的那一句)
//       A10 "Öhlin Racing came to life on the race track and in Kenth Öhlin's father's garage."
//       🛑 history 頁另寫「2013 年 world championship titles 超過 300」—— 那是【世界冠軍】, 而 A7 是【racing titles】,
//          兩個不同的量 ⇒ 版面只寫 A7 的「400+ 賽事冠軍」,**不寫「世界冠軍」**,有一格測試擋。
//   ── 來源 D:design-reference/data/products.js:30 逐字
//      `{ id: 'ohlins', name: 'ÖHLINS', … country: 'SE', tagline: '瑞典頂級避震', since: 1976, hero: '#fde7a8', … heroText: 'dark' }`
//      🟢 1976 與來源 A1 一致。
//
// 🔴 **這個檔在什麼情況下會【變成假的】**:官網數字每年會變(員工數、年產量、冠軍數)⇒ 四格同時過期,沒有東西會叫。
//   🔴 抓取的原始回應沒有存證落檔 ⇒ 從別人那一端只能寫「與引文吻合, 而引文本身未證實」。
//
// 純 presentational、無 props、無 hooks → 不需 'use client'。

export function OhlinsShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Öhlins(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-ohlins01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  ÖHLINS'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ohlins01">為什麼選 Öhlins</h2>
          <p className="pd-lead">
            {/* 來源 A1 + A2 + A7 */}
            1976 年由 Kenth Öhlin 在瑞典創立，總部在 Upplands Väsby；官網說半世紀下來，累積超過 400 座賽事冠軍。
          </p>
        </div>

        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">從賽道起家</h3>
            <p className="pd-feature-desc">
              {/* 來源 A10 + A8 */}
              官網說 Öhlins 誕生在賽道上、也誕生在 Kenth Öhlin 父親的車庫裡；至今仍為頂尖車隊開發、測試並調校避震技術。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">從 MotoGP 到一級方程式</h3>
            <p className="pd-feature-desc">
              {/* 來源 A9 */}
              官網列出的舞台有 MotoGP、一級方程式與 UCI 自行車賽事，同一套避震技術也用在各種高性能車輛上。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">避震器、前叉、轉向阻尼</h3>
            <p className="pd-feature-desc">
              {/* 來源 A4 + A5 */}
              每年生產超過 40 萬件避震器、前叉與轉向阻尼器，分布在 3 座生產據點。
            </p>
          </article>
        </div>
      </section>

      {/* N°02 — 瑞典避震(信任狀四格;文字版不放故事圖) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-ohlins02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  瑞典避震'}</span>
          </div>
          {/* 來源 A7「For half a century」+ 來源 D tagline「瑞典頂級避震」 */}
          <h2 className="pd-h2" id="pd-h-ohlins02">半世紀的瑞典避震</h2>
          <p className="pd-lead">
            {/* 來源 A3 + A6 */}
            全球員工超過 500 人；2025 年起成為 Brembo 集團的一員。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;每格來源見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1976</div>
            <div className="pd-bs-stat-l">瑞典創立</div>
            <div className="pd-bs-stat-s">Founded by Kenth Öhlin in 1976</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">400<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">賽事冠軍</div>
            <div className="pd-bs-stat-s">400+ racing titles</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">40萬<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">每年生產件數</div>
            <div className="pd-bs-stat-s">400,000+ produced annually</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3</div>
            <div className="pd-bs-stat-l">生產據點</div>
            <div className="pd-bs-stat-s">3 production facilities</div>
          </div>
        </div>
      </section>
    </>
  );
}
