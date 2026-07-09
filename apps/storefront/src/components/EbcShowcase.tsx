// EbcShowcase.tsx — EBC Brakes 品牌形象區 N°01 + 短 N°02(#212 方向3 品牌放量、2026-07-10、精簡版)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):小品牌(68 群、單一煞車分類)走精簡版=N°01 三卡 + 短 N°02。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 ebcbrakes.com、彙整 scratchpad research;查無不寫):
//   1980 年代初創立於英國(about-ebc-brakes「In the early 80s in Europe…」;⚠ 精確 1983 官網查無 → 不寫)/
//   英美雙自有工廠、100% 來令片自製、員工 400+、60,000+ 品號、60 年配方研發、40,000+ 經銷商(同頁 + /motorcycle/)/
//   ECE R90 認證系列、碟盤 ABE(TÜV)KBA 編號(/products/motorcycle-brake-pads/、/products/abe-certificates-tuv/)。
//   ⚠ ISO 9001 官網查無 → 不寫。
// 商品圖 = 報價單 view 實際 image_url(PCM R2 圖床);logo = 官方 ebcbrakes.com logo.svg(Sean 授權網路抓、
//   wp-content/uploads/2021/03/EBC-Brake-Logo.svg;官方色 #243588/#E5231D 進 tokens)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD。

export function EbcShowcase() {
  return (
    <>
      {/* N°01 — 為什麼選 EBC Brakes(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-ebc01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/ebc/logo.svg" alt="EBC Brakes" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-ebc01">為什麼選 EBC Brakes</h2>
          <p className="pd-lead">
            1980 年代創立於英國的煞車專家——英美雙自有工廠、逾六萬品號，止得住街道，也止得住賽道。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">英美自有工廠、非貼牌</h3>
            <p className="pd-feature-desc">全系列來令片 100% 在自家英國、美國工廠生產，員工 400 餘人——用的是六十年煞車材料配方經驗，不是代工貼牌。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">認證印在產品上</h3>
            <p className="pd-feature-desc">來令片系列名直接掛 ECE R90 認證，浮動碟盤打上德國 ABE（TÜV）KBA 編號——對得上車型、查得到認證，不用賭。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">按騎法選系列</h3>
            <p className="pd-feature-desc">Double-H 燒結街跑定番、EPFA 街道賽道兩用、GPFAX 純賽道——依用途分系列不是只看料號，煞車手感自己挑。</p>
          </article>
        </div>
      </section>

      {/* 短 N°02 — 制動工程(信任狀四格 + 產品線雙卡;精簡版) */}
      <section className="pd-section pd-bs pd-bs--ebc" aria-labelledby="pd-h-ebc02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">制動工程</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ebc02">六十年只研究一件事——停下來</h2>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1980s</div>
            <div className="pd-bs-stat-l">英國創立</div>
            <div className="pd-bs-stat-s">英美雙自有工廠</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">60,000<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">品號規模</div>
            <div className="pd-bs-stat-s">全球最大來令片／碟盤品項庫</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">R90·TÜV</div>
            <div className="pd-bs-stat-l">雙認證</div>
            <div className="pd-bs-stat-s">ECE R90＋ABE KBA 編號</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">40,000<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">全球經銷</div>
            <div className="pd-bs-stat-s">歐美市場長年驗證</div>
          </div>
        </div>

        {/* 產品線矩陣(圖 = 報價單 view 實際商品圖;68 群單一煞車分類 → 雙卡精簡) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://pub-267d5f9578a344cc92267571caab1743.r2.dev/ebc/FA016.jpg" alt="EBC GPFAX 賽道用煞車皮" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Race Pads</div>
                <div className="pd-bs-mcard-t">賽道來令片</div>
                <div className="pd-bs-mcard-d">GPFAX 純賽道配方，制動力上限拉滿。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="https://pub-267d5f9578a344cc92267571caab1743.r2.dev/ebc/FA018.jpg" alt="EBC 街車用煞車皮" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Street Pads</div>
                <div className="pd-bs-mcard-t">街車來令片</div>
                <div className="pd-bs-mcard-d">Double-H 燒結等街道系列，日常通勤可靠。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
