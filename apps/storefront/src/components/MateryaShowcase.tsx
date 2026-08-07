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
            <p className="pd-feature-desc">每款對應特定車型年式開發、不是通用件；連官網評論都是創辦人本人回覆——義大利小廠的職人手感。</p>
          </article>
        </div>
      </section>

      {/* 短 N°02 — 米蘭工作室(信任狀三格 + 產品線三卡;精簡版) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-mty02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  米蘭工作室'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-mty02">車頭細節的義式收尾</h2>
        </div>

        {/* 故事交錯段:創辦人封面介紹(Sean 2026-07-11「用封面的介紹」;materya.shop 官方創辦人黑白照+首頁介紹文轉譯)+ 碳纖工藝 */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img pd-bona-media-portrait" src="/brands/materya/founder.png" alt="Materya 創辦人 Mirco Sapio" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Studio · 米蘭工作室</div>
            <div className="pd-bona-h3">用熱情設計，用精準製造</div>
            <p className="pd-bona-p">源於多年的機車設計經驗，MATERYA 打造兼具風格、精準與性能的精品部品——從工業級 3D 列印、CNC 加工到碳纖工藝，交出貼合度與辨識度兼具的作品。</p>
          </div>
        </div>
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/materya/craft.jpg" alt="Materya 碳纖儀表遮罩實裝特寫" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Craft · 碳纖工藝</div>
            <div className="pd-bona-h3">3D 列印 × CNC × 碳纖</div>
            <p className="pd-bona-p">工業級 3D 列印做結構、CNC 精修細節、碳纖收尾——三種工藝並用，讓每件部品在車頭都對得上、也認得出。</p>
          </div>
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

        {/* 產品線矩陣(碳纖高階部品,圖 = materya.shop 官方圖、Sean 2026-07-10 校正:移除風鏡螺絲/油杯套小物) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/materya/prod-01.jpg" alt="Materya 碳纖維定風翼組" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Carbon Winglets</div>
                <div className="pd-bs-mcard-t">碳纖維定風翼</div>
                <div className="pd-bs-mcard-d">與 CNC Racing 合作，碳纖外蓋、專車鎖點。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/materya/prod-02.jpg" alt="Materya Track Days 車頭整流面板" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Track Days Plate</div>
                <div className="pd-bs-mcard-t">車頭整流面板</div>
                <div className="pd-bs-mcard-d">賽道日替代頭燈，整合 ActionCam 固定點。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/materya/prod-03.jpg" alt="Materya 碳纖維儀表外蓋" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Carbon Dash</div>
                <div className="pd-bs-mcard-t">碳纖維儀表外蓋</div>
                <div className="pd-bs-mcard-d">碳纖編織、保留 USB，與原車視覺整合。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
