// ExtremeComponentsShowcase.tsx — Extreme Components 品牌形象區 N°01 + N°02(品牌放量、2026-07-24)
//
// 製作依據(Sean 2026-07-24 拍板 v5 草案 GO;骨架對齊 Bonamici/Akrapovic 家族):
// - N°01「為什麼選 Extreme Components」三卡:重用 pd-feature-* 骨架;eyebrow 用官方 logo 圖(彩色不轉黑)。
// - N°02「工藝與戰績」:賽車橫幅 pd-hero-band(2.5:1、無官方影片改橫幅、Sean Q8=A)
//   + 材料/賽場/義大利三段圖文(pd-bona-*)+ 信任狀四格(pd-bs-stats、pd-bs--extreme 紅 accent)。
// 文案全數官方 URL 佐證(官網逐句翻譯 + 逐張獎狀圖確認;查無不寫):
//   六座 2025 冠軍(Moto3 車手+車隊雙料世界冠軍/CIV Moto3 義大利/CIV SSP300 義大利亞軍/
//     MotoAmerica SSP600/菲律賓 SBK)= 官網 Palmares 2025 頁六張獎狀圖逐張確認 /
//   Alu 7075 T6 整塊實心切削·硬質陽極·雷射雕刻車隊標誌 / 預浸布 autoclave 成型 · Twill 主用可指定 Plein /
//   Black Fiber 禁碳纖組別用 · Epotex 乾式玻纖 = 官網 /en/company.html 原文 /
//   GYTR GRT Yamaha WorldSBK Team = 官網首頁 2025 合作車隊 /
//   Solo opere d'arte 標語 · 創辦人 Stefano Bragagnolo · 產地 Piombino Dese(PD、威尼托)= 官網標題+頁尾登記。
//   🔴 未確認:創立年份(官網未載、戰績檔最早 2009)→ 版面不寫成立年份。
// 素材 = public/brands/extreme/*(官網形象輪播 /images/slideshow/2023/,Sean 2026-07-24 批「官網可以用」)。
// 🔴 accent = --ext-red-deep(PIL 取樣官方 logo 紅 #e00018 加深;僅進本區、不覆蓋全站金線 --c-gold)。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀 hardcode 無後台 CRUD。
// 純 presentational、無 props、無 hooks → 不需 'use client'(同 AkrapovicShowcase 非影片段落)。

export function ExtremeComponentsShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Extreme Components(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-ext01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo pd-eb-logo--tall">
              <img src="/brands/extreme/logo.png" alt="Extreme Components" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-ext01">為什麼選 Extreme Components</h2>
          <p className="pd-lead">
            義大利賽事部品廠，把 Moto3 世界冠軍腳下的規格，做成你買得到的零件。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">六座冠軍，同一個賽季</h3>
            <p className="pd-feature-desc">2025 年拿下 Moto3 車手與車隊雙料世界冠軍，加上 CIV 義大利 Moto3、MotoAmerica SSP600、菲律賓 SBK——一年六座頭銜，官網逐年公布。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">三種纖維，三個戰場</h3>
            <p className="pd-feature-desc">碳纖維打一般賽事；Black Fiber 專用在禁碳纖的組別；Epotex 用乾式玻纖加特殊環氧，比一般玻纖更輕更韌。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">賽場先跑過，才輪到你</h3>
            <p className="pd-feature-desc">官方說明：研發只與長年征戰國內與世界錦標賽的頂尖車隊合作，經過特定測試之後才進入量產。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 工藝與戰績(賽車橫幅 + 材料/賽場/義大利三段圖文 + 信任狀四格;pd-bona-* + pd-bs--extreme 紅 accent) */}
      <section className="pd-section pd-bs pd-bs--extreme" aria-labelledby="pd-h-ext02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  工藝與戰績'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ext02">從一塊 7075，到世界冠軍的腳下</h2>
          <p className="pd-lead">
            鋁合金整塊實心切削、纖維進高壓釜成型，出廠前都已在賽道上被驗過一輪。
          </p>
        </div>

        {/* 賽車形象橫幅(2.5:1;無官方影片、Sean Q8=A 改橫幅;官網形象輪播) */}
        <img className="pd-hero-band" src="/brands/extreme/band.webp" alt="賽車手跨上裝有 Extreme Components 部品的賽車，配 Dunlop 熱熔胎" loading="lazy" />

        {/* 材料段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/extreme/billet.webp" alt="賽車引擎上同框的 Extreme Components 引擎護蓋、腳踏後移與碳纖引擎蓋" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Billet &amp; Fiber</div>
            <div className="pd-bona-h3">整塊實心切削，只進高壓釜</div>
            <p className="pd-bona-p">鋁件是 Alu 7075 T6 整塊實心切削、硬質陽極，車隊標誌以雷射雕刻——引擎護蓋、腳踏後移、引擎蓋成組登場。碳纖維與 Black Fiber 則一律採預浸布、在高壓釜中成型，主用斜紋（Twill），客人也可指定平紋（Plein）。</p>
          </div>
        </div>

        {/* 賽場段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/extreme/track.webp" alt="Red Bull KTM 維修區內賽車裝著 Extreme Components 拉桿護弓" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Proven on Track</div>
            <div className="pd-bona-h3">裝在廠隊車上，不是型錄上</div>
            <p className="pd-bona-p">Extreme 的部品出現在頂級廠隊的維修區與賽車上，和 Öhlins、Akrapovič 這些名字裝在同一台車。2025 年官方合作車隊包含 GYTR GRT Yamaha WorldSBK Team。賽道是他們的研發實驗室，不是行銷背景板。</p>
          </div>
        </div>

        {/* 義大利段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/extreme/italy.webp" alt="Yamaha R1M 廠車全碳纖車身，可見 Extreme Components 標誌與 Öhlins 前叉" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">03 — Made in Italy</div>
            <div className="pd-bona-h3">Solo opere d&apos;arte — 只做藝術品</div>
            <p className="pd-bona-p">這句是他們官網的標語，不是我們的形容詞。品牌由 Stefano Bragagnolo 創立，設計、加工到成品全部留在義大利威尼托的 Piombino Dese。零件上直接帶著義大利國旗——那是產地，也是態度。</p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">6</div>
            <div className="pd-bs-stat-l">2025 冠軍頭銜</div>
            <div className="pd-bs-stat-s">含 Moto3 雙料世界冠軍</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">7075</div>
            <div className="pd-bs-stat-l">航太級鋁合金 T6</div>
            <div className="pd-bs-stat-s">整塊實心 · 硬質陽極</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3</div>
            <div className="pd-bs-stat-l">纖維工法</div>
            <div className="pd-bs-stat-s">Carbon · Black Fiber · Epotex</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">100%</div>
            <div className="pd-bs-stat-l">義大利製造</div>
            <div className="pd-bs-stat-s">Piombino Dese · 威尼托</div>
          </div>
        </div>
      </section>
    </>
  );
}
