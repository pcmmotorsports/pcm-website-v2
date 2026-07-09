// CncRacingShowcase.tsx — CNC Racing 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 cncracing.com、彙整 scratchpad research;查無不寫):
//   「Tradition Since 1995」(cncracing.com 首頁 OUR VALUES)/ 義大利 Arezzo(world/privacy 法人 SEFO S.r.l.)/
//   billet 鋁 CNC 切削(首頁 + 產品頁「machined from solid billet aluminium」)/ MotoGP Prima Pramac Racing
//   合作(en/news 官方戰報)/ Ducati 專用 1,787 品項(en/ducati.html「1787 Items found」、查證當下值)。
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
            <span className="pd-eb-logo">
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
            <span className="pd-eb-label">切削工藝</span>
          </div>
          <h2 className="pd-h2" id="pd-h-cnc02">整塊鋁，切出來的義大利精品</h2>
          <p className="pd-lead">
            從換檔連桿到避震連桿，每一件都是 billet 一體切削——安裝影片與原廠說明書齊備，DIY 也有把握。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
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

        {/* 產品線矩陣(圖 = 報價單 view 實際商品圖) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://www.cncracing.com/images_web/prod/1200x/CEA01B.jpg" alt="CNC Racing 換檔連桿" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Controls</div>
                <div className="pd-bs-mcard-t">操控部品</div>
                <div className="pd-bs-mcard-d">換檔連桿、腳踏與把手周邊。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://www.cncracing.com/images_web/variante/1200x/PL150KB.jpg" alt="CNC Racing 碳纖維煞車拉桿護弓" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Protection</div>
                <div className="pd-bs-mcard-t">拉桿護弓．防護</div>
                <div className="pd-bs-mcard-d">碳纖維護弓，賽道規格防誤觸。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://www.cncracing.com/images_web/variante/1200x/AP001B.jpg" alt="CNC Racing 後避震搖臂連桿套組" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Chassis</div>
                <div className="pd-bs-mcard-t">車架．懸吊連桿</div>
                <div className="pd-bs-mcard-d">Panigale 系避震連桿一體切削。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://www.cncracing.com/images_web/prod/1200x/AF280BPR_AF280RPR_298.jpg" alt="CNC Racing 離合器分泵" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Engine</div>
                <div className="pd-bs-mcard-t">引擎部品</div>
                <div className="pd-bs-mcard-d">離合器分泵、油箱蓋等精品件。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
