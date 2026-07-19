// AkrapovicShowcase.tsx — Akrapovič 品牌形象區 N°01 + N°02(上架第三批、2026-07-19)
//
// 製作依據(照 GB/Bonamici/Evotech 家族 SOP;Sean 2026-07-19 拍「依既有經驗直接做、官網首頁大圖動畫可安插」):
// - 骨架:N°01 重用 pd-feature-*(三家一致);N°02 重用 pd-bs-*(信任狀)+ pd-bona-brow(故事兩段)共用骨架。
// - 信任狀事實全數官方 URL 佐證(sonnet subagent 2026-07-19 親抓 akrapovic.com 共 5 頁;查無之數字不寫、
//   創辦人姓名官網未載故不寫):
//   1991 創立/1997 首座 WorldSBK 冠軍/2002 進軍 MotoGP(akrapovic.com/en/about/the-akrapovic-story)
//   200 世界冠軍、MotoGP/WorldSBK/MXGP 官方夥伴、BMW/Ducati/KTM/Yamaha/HRC 廠隊(akrapovic.com/en 首頁)
//   斯洛維尼亞總部、員工 1,800+、銷往 80+ 國(akrapovic.com/en/about/akrapovic)
//   2009 自有鈦合金鑄造廠、專利鈦合金比純鈦強 3 倍/比不鏽鋼輕 40%、逾 35 年多材質加工經驗、
//   2014 Red Dot「Best of the Best」(Ducati 1199 Panigale 系統)(akrapovic.com/en/technology)
// - 素材 = 官網公開資產(www.akrapovic.com/assets/*):logo.svg 原檔、hero-poster.webp 原檔、
//   hero.mp4 = 官網首頁形象影片 1080p 轉 720p H.264 1.77MB 自 host(35MB 原檔不進 repo)。
//   🔴 素材授權 gate 同既有「品牌圖授權」(Sean 既有上線 gate、非新裂縫)。
// - hero 影片 = 官網首頁 autoplay muted loop 大圖動畫的搬移:preload="none" + IntersectionObserver
//   進視窗才 play(避免每次商品頁白吃 1.77MB)、離開即暫停;prefers-reduced-motion 或不支援 IO →
//   不自動播、停留海報圖(功能等價降級);autoplay 被拒(iOS 低電量等)→ 靜默停留海報。
// - 文案繁中台灣買家語氣、全形標點(#223 override)、N°01 lead 精簡兩行(Sean 拍板慣例)。
// 🔴 L2 內容(鐵則 9、backlog #271):信任狀數字(1991/200/1,800/80 等)hardcode 無後台 CRUD。
//
// hero 影片需 IntersectionObserver + video 控制 → 'use client'(同 BonamiciShowcase 需 hooks 前例)。

'use client';

import { useEffect, useRef } from 'react';

export function AkrapovicShowcase() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // jsdom / 舊瀏覽器無 matchMedia 或 IntersectionObserver → 不自動播、停留海報(功能等價降級)
    if (typeof window.matchMedia !== 'function' || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void video.play().catch(() => {}); // autoplay 被拒(iOS 低電量等)→ 靜默停留海報
          } else {
            video.pause();
          }
        }
      },
      { threshold: 0.25 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* N°01 — 為什麼選 Akrapovič(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-akra01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/akrapovic/logo.svg" alt="Akrapovič" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-akra01">為什麼選 Akrapovič</h2>
          <p className="pd-lead">
            斯洛維尼亞的排氣系統世界霸主——自 1991 年起累計 200 座世界冠軍頭銜，從自有鈦合金鑄造廠到 MotoGP 賽道，聲浪與輕量一次到位。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">世界冠軍血統</h3>
            <p className="pd-feature-desc">MotoGP、WorldSBK、MXGP 官方合作夥伴，BMW、Ducati、KTM、Yamaha、HRC 廠隊御用——累計 200 座世界冠軍頭銜，賽道就是它的研發實驗室。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">自有鈦合金鑄造廠</h3>
            <p className="pd-feature-desc">2009 年起自建鈦合金鑄造廠，專利鈦合金強度是純鈦的 3 倍、比不鏽鋼輕 40%——從冶金源頭到成品，全程留在自家屋簷下。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">斯洛維尼亞原廠工藝</h3>
            <p className="pd-feature-desc">逾 1,800 名員工在斯洛維尼亞設計與製造、銷往 80 多國，並以 Ducati 專用系統拿下 Red Dot「Best of the Best」設計大獎。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 冠軍工藝(官網 hero 影片帶 + 材料/鑄造廠故事兩段 + 信任狀四格;pd-bs 共用骨架 + akrapovic 品牌色) */}
      <section className="pd-section pd-bs pd-bs--akrapovic" aria-labelledby="pd-h-akra02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  冠軍工藝'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-akra02">從鈦合金熔湯，到世界冠軍的聲浪</h2>
          <p className="pd-lead">
            Akrapovič 把冶金、實驗室與賽道驗證全部留在自家——每一支消音器出廠前，材料就已經先贏過一輪。
          </p>
        </div>

        {/* 官網首頁形象影片帶(muted loop、進視窗才播;pd-hero-band 選擇器不限 img、video 直接共用) */}
        <video
          ref={videoRef}
          className="pd-hero-band"
          src="/brands/akrapovic/hero.mp4"
          poster="/brands/akrapovic/hero-poster.webp"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
        />

        {/* 材料實驗室段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/akrapovic/story-materials.webp" alt="Akrapovič 材料實驗室與碳纖維部件檢測" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Materials &amp; Lab</div>
            <div className="pd-bona-h3">材料實驗室</div>
            <p className="pd-bona-p">逾 35 年鈦合金、不鏽鋼、碳纖維與鋁合金加工經驗，自建先進實驗室與耐久測功機——輕量與強度不是官網形容詞，是自家實驗室反覆驗證出來的數字。</p>
          </div>
        </div>

        {/* 鑄造廠段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/akrapovic/story-foundry.webp" alt="Akrapovič 自有鈦合金鑄造廠澆鑄作業" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Titanium Foundry</div>
            <div className="pd-bona-h3">自有鈦合金鑄造廠</div>
            <p className="pd-bona-p">2009 年起自煉鈦合金，專利合金比純鈦強 3 倍、比不鏽鋼輕 40%，冶金技術甚至延伸到醫療手術器材——這是全球極少數從熔湯做到消音器的排氣品牌。</p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證 URL 見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">1991</div>
            <div className="pd-bs-stat-l">品牌創立</div>
            <div className="pd-bs-stat-s">斯洛維尼亞</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">200</div>
            <div className="pd-bs-stat-l">世界冠軍頭銜</div>
            <div className="pd-bs-stat-s">MotoGP·WorldSBK·MXGP</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2009</div>
            <div className="pd-bs-stat-l">自有鈦合金鑄造廠</div>
            <div className="pd-bs-stat-s">從冶金到成品一貫化</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">80<span className="pd-bs-stat-plus">+</span></div>
            <div className="pd-bs-stat-l">銷售國家</div>
            <div className="pd-bs-stat-s">員工逾 1,800 人</div>
          </div>
        </div>
      </section>
    </>
  );
}
