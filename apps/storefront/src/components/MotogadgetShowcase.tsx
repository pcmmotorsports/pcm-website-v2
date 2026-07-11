// MotogadgetShowcase.tsx — Motogadget 品牌形象區 N°01 + N°02(#212 方向3 品牌放量、2026-07-10)
//
// 製作依據(2026-07-10 kickoff、Sean 預批):骨架同 EvotechShowcase(pd-feature + pd-bs 共用骨架)。
// 信任狀事實官方 URL 佐證(sonnet subagent 親讀 motogadget.com、彙整 scratchpad research;查無不寫):
//   2000 年機械工程師 Garrit Keller 創立(motogadget.com/en/pages/our-history + /about)/
//   柏林製造、2021 遷入 1,800㎡ 新廠(our-history)/ ISO 9001(about 標章)/ 專利與 IP 逾百件
//   (/en/pages/patents「over a hundred intellectual property rights worldwide」)/
//   「TÜV-tested quality - Made in Germany」(首頁)/ iF Design Award + Good Design Award(about 標章;
//   ⚠ Red Dot 官網查無 → 不寫)。
// 商品圖 = 報價單 view 實際 image_url。
// 🔴 eyebrow = 官方 logo(/brands/motogadget/logo.svg、pd-eb-logo--dark;2026-07-10 rollout 補檔換上,取代原文字 lockup)。
// 🔴 安裝說明影片 facade(Sean 2026-07-10 指定 youtu.be/oqdV8WObU1Y)→ useState 點擊才載 iframe → 需 'use client'(同 Bonamici)。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD。

'use client';

import { useState } from 'react';

// 安裝說明影片 YouTube ID(Sean 指定;facade 點擊才載 embed、省流量)。
const MG_VIDEO_ID = 'oqdV8WObU1Y';

export function MotogadgetShowcase() {
  const [videoOpen, setVideoOpen] = useState(false);
  return (
    <>
      {/* N°01 — 為什麼選 Motogadget(三卡) */}
      <section className="pd-section" aria-labelledby="pd-h-mg01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo pd-eb-logo--dark">
              <img src="/brands/motogadget/logo.svg" alt="motogadget" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-mg01">為什麼選 Motogadget</h2>
          <p className="pd-lead">
            2000 年創立的柏林電裝精品——mo.view 無框後視鏡、motoscope 儀表到 mo.unit 電控中樞，德國製造、專利逾百件。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">德國工程、認證齊全</h3>
            <p className="pd-feature-desc">柏林 1,800 平方米自有廠房，ISO 9001 品質管理、TÜV 檢測——買德國電裝精品，不用賭來路。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">專利逾百件的原創設計</h3>
            <p className="pd-feature-desc">全球智慧財產逾百件，拿過 iF 與 Good Design 設計獎——玻璃無框鏡等獨門技術，仿品做不出同樣的光學品質。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">mo.unit 電控中樞</h3>
            <p className="pd-feature-desc">一顆整合保險絲、繼電器與閃爍器，所有按鍵開關直接接上——咖啡改裝最頭痛的線組，化繁為簡。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 柏林電裝(信任狀四格 + 產品線水平捲;無官方色票 → 中性 accent) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-mg02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  柏林電裝'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-mg02">把車頭改乾淨的德國答案</h2>
          <p className="pd-lead">
            從一支後視鏡到整車線組，Motogadget 的每件產品都在做同一件事——更少的體積，更精緻的機能。
          </p>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2000</div>
            <div className="pd-bs-stat-l">柏林創立</div>
            <div className="pd-bs-stat-s">機械工程師 Garrit Keller</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">100<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">全球專利 IP</div>
            <div className="pd-bs-stat-s">技術・設計雙重保護</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">ISO·TÜV</div>
            <div className="pd-bs-stat-l">品質認證</div>
            <div className="pd-bs-stat-s">ISO 9001＋TÜV 檢測</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">iF</div>
            <div className="pd-bs-stat-l">設計獎項</div>
            <div className="pd-bs-stat-s">iF＋Good Design Award</div>
          </div>
        </div>

        {/* 交錯段:設計/製造圖文夾住安裝影片(Sean 2026-07-11 要求各家交錯;官方無框鏡工藝/柏林工廠圖、肉眼驗零汽車) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/motogadget/story-design.jpg" alt="Motogadget mo.view 無框鏡面 ULTRACUT 工藝" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Design · 無框工藝</div>
            <div className="pd-bona-h3">鏡面即結構</div>
            <p className="pd-bona-p">mo.view 以拋光金屬鏡面取代傳統玻璃與邊框，專利 ULTRACUT 工序切削成型——無框，是把結構做進鏡面本身。</p>
          </div>
        </div>

        {/* 安裝說明影片(facade:縮圖 → 點擊才載入 YouTube iframe、省流量;Sean 2026-07-10 指定) */}
        <div className="pd-bona-video">
          {videoOpen ? (
            <iframe
              className="pd-bona-video-frame"
              src={`https://www.youtube.com/embed/${MG_VIDEO_ID}?autoplay=1&rel=0`}
              title="Motogadget 安裝說明影片"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="pd-bona-video-facade"
              onClick={() => setVideoOpen(true)}
              aria-label="播放 Motogadget 安裝說明影片"
            >
              <img className="pd-bona-video-thumb" src={`https://img.youtube.com/vi/${MG_VIDEO_ID}/maxresdefault.jpg`} alt="" loading="lazy" />
              <span className="pd-bona-video-play" aria-hidden="true" />
              <span className="pd-bona-video-label">安裝說明影片 · Motogadget</span>
            </button>
          )}
        </div>

        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media"><img className="pd-bona-media-img" src="/brands/motogadget/story-mfg.jpg" alt="Motogadget 柏林工廠拋光鏡片產線" loading="lazy" /></div>
          <div>
            <div className="pd-bona-step">Manufacturing · 柏林製造</div>
            <div className="pd-bona-h3">柏林自有工廠</div>
            <p className="pd-bona-p">從切削、拋光到組裝都在柏林自有廠房完成，ISO 9001 品管、TÜV 檢測——德國製造，不只是一句標籤。</p>
          </div>
        </div>

        {/* 產品線矩陣(五大類別:後視鏡／燈具／電控／儀表／把手開關;圖 = motogadget.com 官方商品圖、Sean 指定) */}
        <div className="pd-bs-railwrap">
          <div className="pd-bs-rail">
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/motogadget/prod-01.jpg" alt="Motogadget mo.view classic 60 無框後視鏡" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">mo.view Mirrors</div>
                <div className="pd-bs-mcard-t">無框後視鏡</div>
                <div className="pd-bs-mcard-d">玻璃無框設計，車頭視覺瞬間輕。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/motogadget/prod-02.jpg" alt="Motogadget mo.blaze disc 方向燈" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Lights</div>
                <div className="pd-bs-mcard-t">極簡方向燈</div>
                <div className="pd-bs-mcard-d">圓盤造型 LED，車尾車側乾淨俐落。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/motogadget/prod-03.jpg" alt="Motogadget mo.unit basic 電控中樞" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Electrics</div>
                <div className="pd-bs-mcard-t">電控中樞</div>
                <div className="pd-bs-mcard-d">整合保險絲與繼電器，線組化繁為簡。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/motogadget/prod-04.png" alt="Motogadget motoscope pro 儀表" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Instruments</div>
                <div className="pd-bs-mcard-t">數位儀表</div>
                <div className="pd-bs-mcard-d">半圓 LED 儀表，資訊集中不佔空間。</div>
              </div>
            </article>
            <article className="pd-bs-mcard">
              <img className="pd-bs-mcard-img" src="/brands/motogadget/prod-05.png" alt="Motogadget mo.switch pro 把手開關" loading="lazy" />
              <div className="pd-bs-mcard-b">
                <div className="pd-bs-mcard-en">Switches</div>
                <div className="pd-bs-mcard-t">把手開關</div>
                <div className="pd-bs-mcard-d">鋁合金切削按鍵，握把區精緻化。</div>
              </div>
            </article>
          </div>
          <div className="pd-bs-railhint">← 左右滑看產品線 →</div>
        </div>
      </section>
    </>
  );
}
