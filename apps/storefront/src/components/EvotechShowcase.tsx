// EvotechShowcase.tsx — Evotech Performance 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批「照三家 SOP 直接製作」):
// - 骨架:N°01 重用 pd-feature-*(三家一致)、N°02 重用 pd-bs-* 共用骨架(同構 GB 工程血統)。
// - 信任狀事實全數官方 URL 佐證(sonnet subagent 2026-07-10 親讀,彙整 scratchpad research;查無之數字不寫):
//   2003 創立(evotech-performance.com 首頁「Established in 2003」)/ Lincolnshire 自有工廠
//   (blogs/news/evotech-performance-goes-bigger-by-design)/ 航太級鋁合金 CNC+粉體烤漆(pages/about-us)/
//   BSB·WSBK 車隊與曼島 TT(首頁)/「選對車型才保證貼合」(FAQ)。
// - 商品圖 = 報價單 view 該品牌實際 image_url(kickoff 圖片紀律:只用報價單庫既有商品圖;原生 <img>)。
// - logo = Sean 提供(廠牌LOGO 2/精品-Evotech Performance.webp,裁字帶去底 → public/brands/evotech/logo.png)。
// - 文案繁中台灣買家語氣(怕買錯/裝不上)、全形標點(#223 override)、lead 精簡兩行(Sean 拍板)。
//
// 純 presentational、無 props、無 hooks → 不需 'use client'(同 GbRacingShowcase)。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字(2003 等)hardcode 無後台 CRUD。

export function EvotechShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 Evotech Performance(三卡、重用 pd-feature 骨架) */}
      <section className="pd-section" aria-labelledby="pd-h-evo01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/evotech/logo.png" alt="Evotech Performance" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-evo01">為什麼選 Evotech Performance</h2>
          <p className="pd-lead">
            英國 Lincolnshire 自有工廠的車身防護專家，自 2003 年起為 BSB、WSBK 車隊與曼島 TT 打造航太級鋁合金防護配件。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">賽事實戰驗證</h3>
            <p className="pd-feature-desc">供應英國超級摩托車錦標賽（BSB）與世界超級摩托車錦標賽（WSBK）車隊，並長期支持曼島 TT——防摔配件不是裝飾，是賽道驗證過的保險。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">航太級鋁合金、英國自家製</h3>
            <p className="pd-feature-desc">Lincolnshire 自有工廠 CAD／CAM 一貫化生產，航太級鋁合金 CNC 切削加耐候粉體烤漆，日曬雨淋不怕鏽、不掉漆。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">選對車型、精準貼合</h3>
            <p className="pd-feature-desc">依車型逐款開發專用套件，原廠明文「選對型號才保證精準貼合」——下單前對好車型年式，不用怕鎖不上。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 防護工程(信任狀四格 + 產品線水平捲;pd-bs 共用骨架 + evotech 品牌色) */}
      <section className="pd-section pd-bs pd-bs--evotech" aria-labelledby="pd-h-evo02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  防護工程'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-evo02">從賽道回到日常的防護配件</h2>
          <p className="pd-lead">
            Evotech 不做萬用件——每一組防摔球、水箱護網都對著特定車型開發，裝上去就像原廠多給的配備。
          </p>
        </div>

        {/* N°02 形象大圖(Evotech 英國自有工廠情境,官方 about 圖;Sean 2026-07-10 要求各家 N°02 加 HERO) */}
        <img className="pd-hero-band" src="/brands/evotech/hero.jpg" alt="Evotech Performance 英國 Lincolnshire 自有工廠" loading="lazy" />

        {/* 故事交錯段(Bonamici 風格,官方研發/製造情境圖;Sean 2026-07-10 樣本) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/evotech/story-rd.jpg" alt="Evotech 手持 3D 掃描器對零件掃描建模" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Development · 研發</div>
            <div className="pd-bona-h3">專車量測與 3D 建模</div>
            <p className="pd-bona-p">每件部品先掃描目標車型，建立曲面、間隙與固定點的數位模型，確保專車貼合、降低萬用件常見的干涉與不服貼。</p>
          </div>
        </div>
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/evotech/story-mfg.jpg" alt="Evotech 英國自有工廠 CNC 加工產線" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Manufacturing · 製造</div>
            <div className="pd-bona-h3">英國自有製程</div>
            <p className="pd-bona-p">航太級鋁合金 CNC 切削，再以粉體烤漆或陽極處理提升強度與耐候——量測、加工與安裝設計，都留在英國自有製程。</p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2003</div>
            <div className="pd-bs-stat-l">品牌創立</div>
            <div className="pd-bs-stat-s">英國 Lincolnshire</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">BSB·WSBK</div>
            <div className="pd-bs-stat-l">賽事供應</div>
            <div className="pd-bs-stat-s">英國／世界超級摩托車錦標賽車隊</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">IOM TT</div>
            <div className="pd-bs-stat-l">曼島 TT</div>
            <div className="pd-bs-stat-s">長期支持車手與車隊</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">CNC</div>
            <div className="pd-bs-stat-l">航太級鋁合金</div>
            <div className="pd-bs-stat-s">自有工廠切削＋粉體烤漆</div>
          </div>
        </div>

        {/* 產品線矩陣(五大代表產品,圖 = evotech-performance.com 官方圖、Sean 認可版本;桌機水平捲) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/evotech/prod-01.jpg" alt="Evotech RACE 水箱與頭段護網組" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Race Protection</div>
                <div className="pd-bs-mcard-t">RACE 水箱／頭段護網組</div>
                <div className="pd-bs-mcard-d">航太級鋁合金、粉體烤漆導流孔，賽道級護網。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/evotech/prod-02.jpg" alt="Evotech 短牌架" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Tail Tidy</div>
                <div className="pd-bs-mcard-t">短牌架</div>
                <div className="pd-bs-mcard-d">品牌起源產品，最具辨識度的核心系列。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/evotech/prod-03.jpg" alt="Evotech 車身防倒球" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Crash Protection</div>
                <div className="pd-bs-mcard-t">車身防倒球</div>
                <div className="pd-bs-mcard-d">無鑽孔、專車固定點，保護但不破壞原車。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/evotech/prod-04.jpg" alt="Evotech 前後輪軸防倒球組" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Spindle Protection</div>
                <div className="pd-bs-mcard-t">前後輪軸防倒球</div>
                <div className="pd-bs-mcard-d">尼龍外層＋鋁合金核心＋不鏽鋼軸桿。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/evotech/prod-05.jpg" alt="Evotech 端子鏡與護弓整合組" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Mirror &amp; Guard</div>
                <div className="pd-bs-mcard-t">端子鏡／護弓整合組</div>
                <div className="pd-bs-mcard-d">視野、防護、CNC 模組化整合在一組。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
