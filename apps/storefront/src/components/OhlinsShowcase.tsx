// OhlinsShowcase.tsx — Öhlins 品牌形象區 N°01 + N°02(2026-09-15;同日下午補圖)
//
// Sean 2026-09-15 12:1x 逐字「我要上架 ARROW 、Ilmberger、Ohlins 這三個品牌的品牌介紹跟商品頁面的no1 no2 還沒做」。
// 補圖:Sean 同日逐字「甲 = 照舊: 用官網公開的圖, ARROW 黑色 logo 只改成白色, 出處紀錄註明。商品頁 N°01/N°02 也補上圖」。
//
// 版型:N°01 = design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md:236-261「Highlights」三卡;
//   N°02 = 同檔 :267-289「Engineering」⇒ 家族既有的 pd-hero-band 橫幅 + pd-bona-brow 故事兩段 + pd-bs-stats 四格。
// 🔴 accent 中性(只掛 pd-bs):稿的 hero 是淺黃底深字(來源 D),不是可以當 accent 的專色。
// 🔴 品牌名寫「Öhlins」(帶 Ö):ASCII 規則只管 brand-content.ts 的 name 欄(brand-content.test.ts:344,
//   Sean 2026-09-05 拍乙,為列印字形);showcase 文案沿用真名,同 AkrapovicShowcase 寫「Akrapovič」。
// 🔴 L2 hardcode(鐵則 9、backlog #271)。
// 🔵 文案每段寫成【一行】:JSX 裡換行會變成一個半形空格, 接在全形標點後面就多一格(同 ArrowShowcase 檔頭)。
//
// ═══ 素材(Sean 拍甲:官網公開圖、非授權檔、上線前由代理窗口取得授權)═══
//   由設計窗(pcm-website-v2-1b)自官網 www.ohlins.com 抓取並判定可用,commit 在 agent/design-1 a370f1b27;
//   本檔自那顆 commit 的 `apps/storefront/public/brand-assets/assets/…` 取出、**逐位元組複製**到 `public/brands/ohlins/`
//   (不直接引 /brand-assets/:GillesShowcase.tsx:41-42)。完整 URL 記在 OD pcm-home-redesign/handoff/pages/brand-content-sources.md
//   「2026-09-15:新增 arrow / ilmberger / ohlins」一節(本窗寫檔時 OD daemon 沒開 ⇒ 下面只記清單上的原檔名)。
//     logo.png         sha256 8fbd637f9ea5… 566×200  ← brands-trim/ohlins.png ← og:image logo_ohlins.svg(黃底藍字官方標)
//     hero-damper.jpg  sha256 4048da5303b3… 1037×648 ← brands-hero/ohlins.jpg ← …/MotoGP-damper_web.jpg(偏小,1300/520 裁切後在桌機會放大)
//     story-ttx.jpg    sha256 010e7717b2bb… 636×374  ← brands-prod/ohlins/craft-ttx.jpg ← …/TTX%20GP_6_800px.jpg
//     story-nix.jpg    sha256 f47a54970e97… 636×374  ← brands-prod/ohlins/craft-nix.jpg ← …/NIX%2030%20Adventure_2_technologies%20800px.jpg
//   ⛔ 設計窗判不用:racingMC_hero.jpg / Start_MotoGP_11.jpg(滿版第三方贊助商、看不到 Öhlins)· cbr600rr racetrack · 官網內嵌 cdninstagram 圖。
//   🔵 圖上的產品型號(TTX GP / NIX 30)來自官網原檔名, alt 只寫到系列名。
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
//     `/technology/ttx-technology`(補圖那一輪,同法 directQuote)
//       T1 "The TTX technology is based on the principle of creating damping force by raising oil pressure on one side of the
//           piston and having gas pressure on the other side."
//       T2 "By never reducing oil pressure below gas pressure, cavitation can be avoided. Cavitation is a phenomenon that occurs
//           when the pressure drops in the damper and gas bubbles form in the oil."
//       T3 "With a TTX damper you will never experience a loss of damping performance when pushing your vehicle to the limits"
//     `/technology/nix-technology`(同上)
//       X1 "The front fork cartridge kit is divided into one compression cartridge and one rebound cartridge. The compression
//           cartridge is installed in the left front fork leg and the rebound cartridge in the right front fork leg."
//       X2 "All adjustments (preload, compression and rebound adjustment) are made at the top of the fork legs"
//       X3 meta description "Front fork cartridge kits for motorcycle developed from extensive experience on the race track."
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
            <span className="pd-eb-logo">
              <img src="/brands/ohlins/logo.png" alt="Öhlins" />
            </span>
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

      {/* N°02 — 瑞典避震(避震特寫橫幅 + TTX / NIX 兩段 + 信任狀四格) */}
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

        {/* 避震特寫橫幅(pd-hero-band:1300/520 cover,既有規則、零新 CSS) */}
        <img className="pd-hero-band" src="/brands/ohlins/hero-damper.jpg" alt="Öhlins 金色避震元件特寫" loading="lazy" />

        {/* TTX 段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/ohlins/story-ttx.jpg" alt="Öhlins TTX 後避震的調整旋鈕特寫" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — TTX Twin Tube</div>
            <div className="pd-bona-h3">雙筒設計，油壓不掉</div>
            <p className="pd-bona-p">
              {/* 來源 T1 + T2 + T3 */}
              TTX 在活塞一側提高油壓、另一側是氣壓；油壓始終不低於氣壓，油裡就不會冒出氣泡。官網說，推到極限時阻尼也不會衰退。
            </p>
          </div>
        </div>

        {/* NIX 段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/ohlins/story-nix.jpg" alt="Öhlins NIX 前叉卡匣的頂蓋調整鈕特寫" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — NIX Cartridge</div>
            <div className="pd-bona-h3">壓縮與回彈，分腳調</div>
            <p className="pd-bona-p">
              {/* 來源 X1 + X2 + X3 */}
              NIX 前叉卡匣分成兩支：左腳管負責壓縮、右腳管負責回彈；預載、壓縮、回彈都在前叉頂端調。官網說它來自大量賽道經驗。
            </p>
          </div>
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
