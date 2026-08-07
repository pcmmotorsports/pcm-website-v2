// KspeedShowcase.tsx — K-SPEED 品牌形象區 N°01 + N°02(品牌放量、2026-07-24)
//
// 製作依據(Sean 2026-07-24 拍板 v5 草案 GO;骨架對齊 Bonamici/Akrapovic 家族):
// - N°01「為什麼選 K-SPEED」三卡:重用 pd-feature-* 骨架;eyebrow 用官方 logo 圖。
// - N°02「設計者」:品牌影片(真 YouTube facade、點縮圖才載 iframe、同 Bonamici/InstallResources 手法)
//   + Tanadit/House of Custom 兩段圖文(pd-bona-*)+ 信任狀四格(pd-bs-stats)。
// 文案全數官方 URL 佐證(Sean 提供品牌介紹頁 k-speed.com/pages/k-speed、逐句翻譯;查無不寫):
//   2002 曼谷小零件店起家 / CEO Tanadit Sarawek / blackout style 全黑化、低而長霧黑線條 /
//   Honda·BMW·Royal Enfield 官方展演車 / house of custom design 穩定供應 bolt-on 零件 /
//   Tanadit Design 冷冽·狂放·優美·現代並存的曲線語言。
//   「21 件全套」= 報價單資料庫實品 RB9998(Diabolus V.2 Full Custom Set, 21 items)。
//   🔴 影片 = 官方頻道 7y1Tz6vm6u4「Rock Rod」Royal Enfield 650 by K-Speed(yt-dlp 實讀、縮圖為品牌片頭卡)。
//   🔴 品牌介紹頁網站主體為 K-SPEED JAPAN(Bamboo Hornet、官方授權日本代理)、非泰國總部自撰(Sean 已知會)。
// 素材 = public/brands/kspeed/*(Sean 提供官網圖 + 官方頻道縮圖;授權同既有品牌圖 gate)。
// 🔴 無官方色票 → 版面 accent 落中性 --c-text(全黑品牌本即黑;對齊 tokens「無 logo/無色票不臆測專色」)。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀 hardcode 無後台 CRUD。
// 影片 facade onClick → useState 換入 iframe → 需 'use client'(同 BonamiciShowcase 前例)。

'use client';

import { useState } from 'react';

// 品牌形象影片 YouTube ID(Sean 2026-07-24 指定;facade 點擊才載入 embed)。
const KSPEED_VIDEO_ID = '7y1Tz6vm6u4';

export function KspeedShowcase() {
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <>
      {/* N°01 — 為什麼選 K-SPEED(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-ks01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo pd-eb-logo--tall">
              <img src="/brands/kspeed/logo.png" alt="K-SPEED" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-ks01">為什麼選 K-SPEED</h2>
          <p className="pd-lead">
            2002 年開在曼谷的小零件店，如今是 Honda、BMW、Royal Enfield 指名合作的全黑美學。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">原廠指名的訂製設計</h3>
            <p className="pd-feature-desc">Honda、BMW、Royal Enfield 都委託 K-SPEED 打造官方展演車——原廠把自家新車交到他手上改，改完掛原廠的名字展出。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">全黑化，不是隨便噴黑</h3>
            <p className="pd-feature-desc">以霧黑為基調、低而長的侵略性車身線條，配上 Tanadit 招牌曲面。整套 Diabolus 共用同一種語言，換到哪件都接得起來。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">小車改裝的天花板</h3>
            <p className="pd-feature-desc">Rebel、Super Cub、CT125、Dax 125、Monkey 125——把一台通勤小車變成另一個世界的樣子，而且不犧牲原本的好騎好用。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 設計者(品牌影片 facade + Tanadit/House of Custom 兩段圖文 + 信任狀四格;pd-bona-* + pd-bs 中性 accent) */}
      <section className="pd-section pd-bs" aria-labelledby="pd-h-ks02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  設計者'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-ks02">從一間小零件店，到全世界的街頭</h2>
          <p className="pd-lead">
            二十多年來只有一位設計者：創辦人兼 CEO Tanadit Sarawek。
          </p>
        </div>

        {/* 品牌形象影片(facade:縮圖 → 點擊才載入 YouTube iframe、省流量;同 Bonamici/InstallResources 手法) */}
        <div className="pd-bona-video">
          {videoOpen ? (
            <iframe
              className="pd-bona-video-frame"
              src={`https://www.youtube.com/embed/${KSPEED_VIDEO_ID}?autoplay=1&rel=0`}
              title="K-SPEED 品牌形象影片"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="pd-bona-video-facade"
              onClick={() => setVideoOpen(true)}
              aria-label="播放 K-SPEED 品牌形象影片"
            >
              <img className="pd-bona-video-thumb" src="/brands/kspeed/video-thumb.webp" alt="" loading="lazy" />
              <span className="pd-bona-video-play" aria-hidden="true" />
              <span className="pd-bona-video-label">品牌形象影片 · K-SPEED</span>
            </button>
          )}
        </div>

        {/* Tanadit Design 段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/kspeed/tanadit.webp" alt="K-SPEED 改裝的 Royal Enfield 全黑越野風格車" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Tanadit Design</div>
            <div className="pd-bona-h3">一個人的手，一整個品牌的樣子</div>
            <p className="pd-bona-p">官方形容 Tanadit 的設計：大膽改寫既有車款的印象，靠獨有的曲線把整台車收成一體。冷冽、狂放、優美、現代這幾種矛盾的味道，他能同時放進同一台車而不打架。</p>
          </div>
        </div>

        {/* House of Custom Design 段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/kspeed/supply.webp" alt="K-SPEED 訂製車：霧黑車身搭配金色細線的咖啡騎士" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — House of Custom Design</div>
            <div className="pd-bona-h3">不只改一台，是穩定供應全世界</div>
            <p className="pd-bona-p">很多訂製車工房一輩子只做獨一無二的展示車。K-SPEED 走另一條路——把那些設計變成可量產、直上不用改車的 bolt-on 零件，穩定供應到世界各地。你買到的，就是展演車上的那一件。</p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2002</div>
            <div className="pd-bs-stat-l">品牌創立</div>
            <div className="pd-bs-stat-s">泰國曼谷</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">3 大原廠</div>
            <div className="pd-bs-stat-l">官方展演車</div>
            <div className="pd-bs-stat-s">Honda · BMW · Royal Enfield</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Diabolus</div>
            <div className="pd-bs-stat-l">自有零件品牌</div>
            <div className="pd-bs-stat-s">全黑化設計語言</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">全車套件</div>
            <div className="pd-bs-stat-l">客製化改裝服務</div>
            <div className="pd-bs-stat-s">從單一部品到 21 件全套</div>
          </div>
        </div>
      </section>
    </>
  );
}
