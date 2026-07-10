// CncRacingShowcase.tsx — CNC Racing 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 cncracing.com、彙整 scratchpad research;查無不寫):
//   「Tradition Since 1995」(cncracing.com 首頁 OUR VALUES)/ 義大利 Arezzo(world/privacy 法人 SEFO S.r.l.)/
//   billet 鋁 CNC 切削(首頁 + 產品頁「machined from solid billet aluminium」)/ MotoGP Prima Pramac Racing
//   合作(en/news 官方戰報)/ Ducati 專用 1,787 品項(en/ducati.html「1787 Items found」、查證當下值)/
//   Pramac 聯名限定部品:報價單 view 實料命中——AF280 官方品名「…Pramac Racing Limited Edition」
//   (storefront_catalog_v、scratchpad fixtures/cncracing.json)。
// 商品圖 = 報價單 view 實際 image_url;logo = Sean 提供 PNG 裁切去黑底(public/brands/cnc-racing/logo.png)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字(1,787 為抓取時點值、年度會變)hardcode 無後台 CRUD。

export function CncRacingShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 CNC Racing(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-cnc01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo pd-eb-logo--tall">
              <img src="/brands/cnc-racing/logo.png" alt="CNC Racing" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-cnc01">為什麼選 CNC Racing</h2>
          <p className="pd-lead">
            義大利 Arezzo 的 CNC 切削工坊，1995 年深耕至今——Ducati、MV Agusta 等歐系車主的精品首選，MotoGP 圍場實戰背書。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">Since 1995、義大利切削工藝</h3>
            <p className="pd-feature-desc">整塊 billet 鋁合金一體切削成型，不是鑄造翻模——三十年托斯卡納金工傳統，公差與質感看得出差別。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">MotoGP 圍場實戰</h3>
            <p className="pd-feature-desc">與 MotoGP 車隊 Prima Pramac Racing 合作，並推出 Pramac 聯名限定部品——賽場用得住，街道更有餘裕。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">歐系車款深度覆蓋</h3>
            <p className="pd-feature-desc">Ducati、Aprilia、MV Agusta、BMW、KTM、Moto Guzzi 六大車廠逐車型對應，光 Ducati 就近 1,800 個品項——冷門年式也找得到。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 切削工藝(信任狀四格 + 產品線水平捲) */}
      <section className="pd-section pd-bs pd-bs--cnc-racing" aria-labelledby="pd-h-cnc02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  切削工藝'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-cnc02">整塊鋁，切出來的義大利精品</h2>
          <p className="pd-lead">
            從換檔連桿到避震連桿，每一件都是 billet 一體切削——安裝影片與原廠說明書齊備，DIY 也有把握。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        {/* N°02 形象大圖(CNC Racing 職人精密加工特寫,官方圖;Sean 2026-07-10 各家 N°02 加 HERO) */}
        <img className="pd-hero-band" src="/brands/cnc-racing/hero.jpg" alt="CNC Racing 職人手工組裝義大利製部品" loading="lazy" />

        {/* 故事交錯段(Bonamici 風格,官方研發/製造情境圖;Sean 2026-07-11 品牌放量 rollout;圖逐張肉眼驗零汽車) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/cnc-racing/story-rd.jpg" alt="CNC Racing 碳纖導流板裝於 Brembo 卡鉗" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Development · 研發</div>
            <div className="pd-bona-h3">賽道實測的義式精品</div>
            <p className="pd-bona-p">源自義大利精密機械工坊，產品在 Superbike 與 MotoGP 賽道上反覆實測——曾與 Pramac 車隊並肩，也拿過 WSBK 冠軍。</p>
          </div>
        </div>
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/cnc-racing/story-mfg.jpg" alt="CNC Racing billet 削切引擎外殼特寫" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Manufacturing · 製造</div>
            <div className="pd-bona-h3">billet 一體削切</div>
            <p className="pd-bona-p">鋁合金、鈦合金與碳纖，從整塊 billet 削出，義大利自製，每件都刻上 CNC Racing 盾徽。</p>
          </div>
        </div>

        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1995</div>
            <div className="pd-bs-stat-l">品牌傳統</div>
            <div className="pd-bs-stat-s">義大利 Arezzo</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">MotoGP</div>
            <div className="pd-bs-stat-l">圍場合作</div>
            <div className="pd-bs-stat-s">Prima Pramac Racing</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1,787</div>
            <div className="pd-bs-stat-l">Ducati 品項</div>
            <div className="pd-bs-stat-s">六大歐系車廠逐車型對應</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Billet</div>
            <div className="pd-bs-stat-l">一體切削</div>
            <div className="pd-bs-stat-s">實心鋁材 CNC 成型</div>
          </div>
        </div>

        {/* 產品線矩陣(Pramac Racing 限量旗艦,圖 = cncracing.com 官方圖、Sean 2026-07-10 校正:對齊 MotoGP/Pramac 血統) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/cnc-racing/prod-01.jpg" alt="CNC Racing Pramac 限量腳踏後移" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Pramac Limited</div>
                <div className="pd-bs-mcard-t">Pramac 限量腳踏後移</div>
                <div className="pd-bs-mcard-d">MotoGP 車隊官方聯名，紅銀限量配色。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/cnc-racing/prod-02.jpg" alt="CNC Racing 碳纖維油箱蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Carbon Fuel Cap</div>
                <div className="pd-bs-mcard-t">碳纖維油箱蓋</div>
                <div className="pd-bs-mcard-d">碳纖蓋體＋鋁合金法蘭，快拆設計、車頭質感升級。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/cnc-racing/prod-03.jpg" alt="CNC Racing Pramac 透明離合器外蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Clutch Window</div>
                <div className="pd-bs-mcard-t">透明離合器外蓋</div>
                <div className="pd-bs-mcard-d">billet 鋁合金＋耐熱 Lexan，官方賽車塗裝。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/cnc-racing/prod-04.jpg" alt="CNC Racing Pramac 賽車按鍵總成" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Race Switch</div>
                <div className="pd-bs-mcard-t">賽車按鍵總成</div>
                <div className="pd-bs-mcard-d">7075 鋁合金、IP67、按鍵循環測試。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
