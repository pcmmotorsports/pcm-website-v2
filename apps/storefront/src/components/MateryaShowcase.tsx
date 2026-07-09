// MateryaShowcase.tsx — Materya 品牌形象區 N°01 + 短 N°02(#212 方向3 品牌放量、2026-07-10、精簡版)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):最小品牌(54 群)走精簡版=N°01 三卡 + 短 N°02、不硬撐。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 materya.shop、彙整 scratchpad research;查無不寫):
//   創辦人兼 CEO 設計師 Mirco Sapio(materya.shop 首頁)/ 工業 3D 列印+CNC+碳纖工藝(首頁)/
//   米蘭 Piazza Villapizzone 1(產品頁 footer)/ 商品頁固定附 Project idea→Sketch→3D Modelling 設計過程
//   (product/dashboard-cover-for-ktm-duke-125-390)。⚠ 創立年份官網查無 → 不寫。
// 商品圖 = 報價單 view 實際 image_url;logo = Sean 提供白字 PNG 重上色深墨(public/brands/materya/logo.png、
//   淺色主題可見;晨報補圖清單列「高解析版」)。無官方色票 → 中性 accent。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271)。

export function MateryaShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Materya(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-mty01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/materya/logo.png" alt="Materya" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-mty01">為什麼選 Materya</h2>
          <p className="pd-lead">
            米蘭設計師 Mirco Sapio 的工作室品牌——儀表護蓋、風鏡與小翼，3D 列印 × CNC × 碳纖，專車專用的義式細節。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">設計師直營、不是公版模具</h3>
            <p className="pd-feature-desc">每件部品從手繪草圖、3D 建模到成品都出自創辦人之手，商品頁直接展示設計過程——買的是設計，不是開模貨。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">三種工藝並用</h3>
            <p className="pd-feature-desc">工業級 3D 列印、CNC 切削與碳纖維成型按部位選用——貼合度與質感優先，不遷就單一製程。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">專車專用、小廠溫度</h3>
            <p className="pd-feature-desc">每款對應特定車型年式、免鑽孔安裝；連官網評論都是創辦人本人回覆——義大利小廠的職人手感。</p>
          </article>
        </div>
      </section>

      {/* 短 N°02 — 米蘭工作室(信任狀三格 + 產品線三卡;精簡版) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-mty02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">米蘭工作室</span>
          </div>
          <h2 className="pd-h2" id="pd-h-mty02">車頭細節的義式收尾</h2>
        </div>

        {/* 信任狀三格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats cols-3">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Milano</div>
            <div className="pd-bs-stat-l">設計製造</div>
            <div className="pd-bs-stat-s">創辦人 Mirco Sapio 直營</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3</div>
            <div className="pd-bs-stat-l">工藝並用</div>
            <div className="pd-bs-stat-s">3D 列印・CNC・碳纖</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">6</div>
            <div className="pd-bs-stat-l">適配車廠</div>
            <div className="pd-bs-stat-s">BMW／KTM／Ducati／Triumph 等</div>
          </div>
        </div>

        {/* 產品線矩陣(圖 = 報價單 view 實際商品圖) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://materya.shop/wp-content/uploads/2020/03/1290R_3.0_5_SHOP_Materya.jpg.jpg" alt="Materya 儀表外蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Dashboard Covers</div>
                <div className="pd-bs-mcard-t">儀表外蓋</div>
                <div className="pd-bs-mcard-d">修飾車頭線條、順手護儀表。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://materya.shop/wp-content/uploads/2021/09/SHOP_Materya_screws_black.png" alt="Materya 風鏡螺絲" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Screens &amp; Hardware</div>
                <div className="pd-bs-mcard-t">風鏡．螺絲件</div>
                <div className="pd-bs-mcard-d">風鏡周邊與精緻五金。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://materya.shop/wp-content/uploads/2024/12/Cuff2.png" alt="Materya 煞車油杯套" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Details</div>
                <div className="pd-bs-mcard-t">細節小物</div>
                <div className="pd-bs-mcard-d">油杯套等收尾配件。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
