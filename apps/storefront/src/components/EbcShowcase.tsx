// EbcShowcase.tsx — EBC Brakes 品牌形象區 N°01 + 短 N°02(#212 方向3 品牌放量、2026-07-10、精簡版)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):小品牌(68 群、單一煞車分類)走精簡版=N°01 三卡 + 短 N°02。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 ebcbrakes.com、彙整 scratchpad research;查無不寫):
//   1980 年代初創立於英國(about-ebc-brakes「In the early 80s in Europe…」;⚠ 精確 1983 官網查無 → 不寫)/
//   英美雙自有工廠、100% 來令片自製、員工 400+、60,000+ 品號、60 年配方研發、40,000+ 經銷商(同頁 + /motorcycle/;
//   「全球最大來令片/碟盤品項庫」= about 頁原文「largest range of brake pads and brake discs in the world,
//   with over 60,000 part numbers」)/
//   ECE R90 認證系列、碟盤 ABE(TÜV)KBA 編號(/products/motorcycle-brake-pads/、/products/abe-certificates-tuv/)。
//   ⚠ ISO 9001 官網查無 → 不寫。
// 商品圖 = 報價單 view 實際 image_url(PCM R2 圖床);logo = 官方 ebcbrakes.com logo.svg
//   (授權出處 = Sean 2026-07-10 過夜訊息字面「EBC的logo 你去網路上抓吧」;晨報決策題請 Sean 再確認一次
//   〔adversarial F1:kickoff 硬規則 4 logo=授權 gate、此授權在 kickoff 之後口頭補充〕;
//   檔源 wp-content/uploads/2021/03/EBC-Brake-Logo.svg;官方色 #243588/#E5231D 進 tokens)。
// 純 presentational、無 props、無 hooks → 不需 'use client'。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD。
// 🔴 品牌影片 facade(Sean 2026-07-11 指定 youtube xDidxn04Ess「Welcome to EBC Brakes」)→ useState 點擊才載 iframe → 需 'use client'(同 Motogadget/Bonamici)。

'use client';

import { useState } from 'react';

// 品牌影片 YouTube ID(Sean 指定;facade 點擊才載 embed、省流量)。
const EBC_VIDEO_ID = 'xDidxn04Ess';

export function EbcShowcase() {
  const [videoOpen, setVideoOpen] = useState(false);
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
            <span className="pd-eb-label">{'N°  制動工程'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ebc02">六十年只研究一件事——停下來</h2>
          <p className="pd-lead">
            從市區通勤到賽道熱身，煞車的手感與抗衰退，EBC 用配方與認證一路顧到底。
          </p>
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

        {/* 故事交錯段(Bonamici 風格,官方賽道/製造情境圖;Sean 2026-07-11 品牌放量 rollout;圖逐張肉眼驗零汽車) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/ebc/story-rd.jpg" alt="EBC 贊助車隊超級摩托車賽道實測" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Development · 研發</div>
            <div className="pd-bona-h3">賽道與測功機雙驗證</div>
            <p className="pd-bona-p">英國自有研發中心以動態測功機搭配賽道實測，煞車皮與碟盤都經反覆驗證才量產。</p>
          </div>
        </div>

        {/* 品牌影片 facade(Welcome to EBC Brakes;Sean 2026-07-11 指定 xDidxn04Ess) */}
        <div className="pd-bona-video">
          {videoOpen ? (
            <iframe
              className="pd-bona-video-frame"
              src={`https://www.youtube.com/embed/${EBC_VIDEO_ID}?autoplay=1&rel=0`}
              title="EBC Brakes 品牌影片"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="pd-bona-video-facade"
              onClick={() => setVideoOpen(true)}
              aria-label="播放 EBC Brakes 品牌影片"
            >
              <img className="pd-bona-video-thumb" src={`https://img.youtube.com/vi/${EBC_VIDEO_ID}/maxresdefault.jpg`} alt="" loading="lazy" />
              <span className="pd-bona-video-play" aria-hidden="true" />
              <span className="pd-bona-video-label">品牌影片 · EBC Brakes</span>
            </button>
          )}
        </div>

        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/ebc/story-mfg.jpg" alt="EBC 黑鉻花瓣浮動碟盤" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Manufacturing · 製造</div>
            <div className="pd-bona-h3">花瓣浮動碟工藝</div>
            <p className="pd-bona-p">浮動碟以鋁合金花鼓搭配不鏽鋼浪花外環，浮動鉚接、花瓣散熱——精密沖壓與 CNC 輪廓，質感與制動並重。</p>
          </div>
        </div>

        {/* 產品線矩陣(碟盤／來令片／油管／離合器片,圖 = ebcbrakes.com 官方商品圖、Sean 2026-07-10/11 指定) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/ebc/prod-01.png" alt="EBC 機車浮動碟盤 Contour 款" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Floating Rotor</div>
                <div className="pd-bs-mcard-t">浮動碟盤</div>
                <div className="pd-bs-mcard-d">金色碟座＋不鏽鋼碟面，散熱與制動兼顧。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/ebc/prod-02.jpg" alt="EBC 機車來令片系列" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Brake Pads</div>
                <div className="pd-bs-mcard-t">來令片</div>
                <div className="pd-bs-mcard-d">GPFAX 純賽道／EPFA 街道賽道／Double-H 街跑／有機街道，依騎法選配方。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/ebc/prod-brakeline.jpg" alt="EBC 不鏽鋼編織煞車油管實裝於後卡鉗" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Brake Lines</div>
                <div className="pd-bs-mcard-t">煞車油管</div>
                <div className="pd-bs-mcard-d">不鏽鋼編織油管，煞車力道直接、不隨里程軟化。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/ebc/prod-04.png" alt="EBC SRK 機車離合器組" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Clutch Kit</div>
                <div className="pd-bs-mcard-t">離合器片</div>
                <div className="pd-bs-mcard-d">SRK 賽事離合器組，摩擦片與彈簧整組更換。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
