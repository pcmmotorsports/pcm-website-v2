// GillesShowcase.tsx — GILLES TOOLING 品牌形象區 N°01 + N°02(上架第 17 家、2026-08-27)
//
// 製作依據(Sean 2026-08-27 逐字「我覺得 GG 品牌介紹頁面可以配置跟 Akrapovic」):
// - 骨架逐支對照 `AkrapovicShowcase.tsx` = 重量版(N°01 三卡 + N°02 hero 影片帶 + 故事兩段 + 信任狀四格)。
//   N°01 重用 pd-feature-*、N°02 重用 pd-bs-*(信任狀)+ pd-bona-brow(故事段),與其餘 16 家同骨架。
//
// 🔴 事實全數本窗**親自 WebFetch 官網當場查證**(不是轉述、不是憑記憶;2026-08-27):
//   www.gillestooling.com/en/Behind-the-scenes/ 逐字:
//     "Founded in 2000" / "Gerhard Gilles - a passionate racing driver for over a decade"
//     "The first adjustable footrest systems were built directly for his own racing motorbike"
//     "The first series product: the AS31GT multivariable footrest system"
//     "proudly as an OEM supplier for BMW Motorrad, Yamaha and Suzuki, among others"
//     "TÜV, OEM and KBA certifications" / "GILLES is certified according to ISO 9001 and ABE"
//     "At the new company location since 2016"
//   🔴 **兩處刻意【不】寫成逐字**(code-reviewer R1 nit 6/7 抓到,已改):
//     ① 官網把「為他自己那台賽車做的第一組可調腳踏」與「第一支量產品 AS31GT」**分兩句列**,
//        沒有任何一句說前者就是後者 ⇒ 文案改成照原文的順序並列,不合成因果。
//     ② 官網 /Shop/ 底下實數**八個**分類(六條主要產品線 + Ersatzteile 備品 + OE-Exklusive),
//        故寫「導覽列的主要產品線有六條」而不是「型錄分成六條線」。
//   www.gillestooling.com/en/Shop/Footrest-systems/ 逐字:
//     "High-quality materials and CNC-manufactured quality "Made in Luxembourg""
//     "Ultra-lightweight thanks to specific cut-outs, made from high-strength 7075 aluminium."
//     "Developed with expertise from WorldSBK, it impresses with maximum stability and minimum weight."
//   www.gillestooling.com/en/Service/Imprint/(法人 imprint):
//     Gilles Tooling GmbH / 26, Op der Ahlkerrech, Z.I. Potaschbierg, L-6776 Grevenmacher, Luxembourg
//     R.C.S. Luxembourg: B 107.876
//
// 🔴🔴 **國籍:盧森堡,不是德國。**來源側 2026-08-27 交接文件 §4 逐字寫「德國 Gilles Tooling」= 錯的;
//   imprint 是公司自己的法人登記頁(上游),而「德國」那個說法追到底是經銷商網站(下游)。
//   本 repo `data/brand-content.ts` 那筆寫「盧森堡 · Grevenmacher · 自 2000」**是對的**,兩邊已一致。
//
// - 六條產品線 = 官網導覽列實際分類(Handlebar systems / Brake and clutch lever /
//   Chain tensioners and accessories / Protectors / Footrest systems / Design accessories),
//   **不是**我方 `products.category` 的 13 種內部族名(那是給站內篩選用的,客人在官網看不到)。
// - "Driven by function." = 官方影片片尾字卡逐字(本窗抽格目視,非轉述)。
//
// - 素材:hero.mp4 = Sean 提供之官方形象影片(Desktop 原檔 1920x1080 / 15.3MB)轉 720p H.264
//   去音軌 1.30MB 自 host(同 Akrapovic 前例「35MB 原檔不進 repo」);hero-poster.webp 取自該片第 600 格。
//   logo.png = 本 repo 既有官方淺底版 `apps/storefront/public/brand-assets/assets/brands-trim/gilles.png` 的副本
//   (sha256 與原檔相同。🔴 **刻意留這份副本、不直接引原檔**:`/brands/<slug>/` 是 showcase 的資產
//    命名空間,`/brand-assets/assets/` 是品牌介紹頁那套【機器產生】資料的命名空間——
//    直接跨過去引,等於讓 showcase 被 brand-content 重產的副作用波及。16 支既有 showcase 全走前者。)
//   (🔴 官網 media 的 Logo_GILLES_white.png 實測只有 100x21、且是白字版 = 淺底頁面上看不見,故不採)。
//   story-*.webp = 官網 media 官方照,**實裁後目視比對過**、非用算的:
//   兩張皆 1600x1000(ratio 1.600)對齊 `.pd-bona-media-img` 的 `aspect-ratio: 16 / 10`
//   (🔴 runbook §6-b 寫「16:9」,而 CSS 實際是 16/10 —— 依 CSS 不依 runbook,免得 cover 二次裁切)。
//   🔴 素材授權 gate 同既有「品牌圖授權」(Sean 既有上線 gate、非新裂縫)。
// - 文案繁中台灣買家語氣、全形標點(#223 override)。
// 🔴 L2 內容(鐵則 9):信任狀數字(2000 / 7075 等)hardcode、無後台 CRUD。
//   ⚠️ **不要把 `#271` 讀成「已核准的延期」**(codex R1 抓到,已改寫):`docs/phase-1-backlog.md:7856`
//   逐字寫該項的觸發條件是「品牌形象區擴增到**第 3 個以上品牌**、數字散落多檔難維護時」——
//   而現在是**第 17 家**。⇒ 那個條件在第 3 家就滿足了,`#271` 是一筆**已逾期的待辦**,不是許可。
//   本片仍照既有 16 支的做法 hardcode,理由只有一個:**集中化要一次動 17 支元件 = 另一片的範圍**
//   (跨 3+ 檔、動共用結構 ⇒ 鐵則 8 要先提 plan 等批),不是因為 `#271` 允許我不做。
//
// hero 影片需 IntersectionObserver + video 控制 → 'use client'(同 AkrapovicShowcase 前例)。

'use client';

import { useEffect, useRef } from 'react';

export function GillesShowcase() {
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
      {/* N°01 — 為什麼選 GILLES TOOLING(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-gilles01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/gilles/logo.png" alt="GILLES TOOLING" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-gilles01">為什麼選 GILLES TOOLING</h2>
          <p className="pd-lead">
            盧森堡的 CNC 人車介面專家——第一組可調腳踏是創辦人為自己那台賽車做的，如今是 BMW、Yamaha、Suzuki 的原廠供應商。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">起點是自己那台賽車</h3>
            <p className="pd-feature-desc">創辦人 Gerhard Gilles 跑了十幾年賽車。官網寫著：第一組可調腳踏是直接為他自己那台賽車做的；而品牌的第一支量產品，是 AS31GT 多向可調腳踏系統。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">進得了原廠的門</h3>
            <p className="pd-feature-desc">官網自述為 BMW Motorrad、Yamaha 與 Suzuki 的 OEM 原廠供應商——能進原廠供應鏈，代表它的圖面與品質流程被車廠審過。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">掛得上驗車的認證</h3>
            <p className="pd-feature-desc">官網列出 TÜV 與 KBA 認證，並通過 ISO 9001 與 ABE。⚠️ 認證涵蓋範圍逐件不同，實際驗車請以該件所附文件為準。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 人車三角(官網形象影片帶 + 起源/對應兩段 + 信任狀四格;pd-bs 共用骨架 + gilles 品牌色) */}
      <section className="pd-section pd-bs pd-bs--gilles" aria-labelledby="pd-h-gilles02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  人車三角'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-gilles02">手掌、腳掌與坐姿，一次對齊</h2>
          <p className="pd-lead">
            GILLES 的產品線圍著人碰得到的那幾個點長出來——把手、拉桿、腳踏。位置對了，控制行程與重心才跟著對。
          </p>
        </div>

        {/* 官網形象影片帶(muted loop、進視窗才播;pd-hero-band 選擇器不限 img、video 直接共用) */}
        <video
          ref={videoRef}
          className="pd-hero-band"
          src="/brands/gilles/hero.mp4"
          poster="/brands/gilles/hero-poster.webp"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
        />

        {/* 起源段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/gilles/story-range.webp" alt="GILLES TOOLING 腳踏系統的多款踏板本體" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Racing Origin</div>
            <div className="pd-bona-h3">為自己那台車做的</div>
            <p className="pd-bona-p">官網把順序寫得很清楚：先有「直接為他自己那台賽車做的第一組可調腳踏」，2000 年才創立品牌，而第一支量產品是 AS31GT 多向可調腳踏系統。先有需求，才有產品。</p>
          </div>
        </div>

        {/* 車型對應段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/gilles/story-fitment.webp" alt="Ducati Panigale V4S 側面全車照（GILLES TOOLING 官方媒體照）" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Fit &amp; Range</div>
            <div className="pd-bona-h3">六條線，同一台車</div>
            <p className="pd-bona-p">官網導覽列的主要產品線有六條：把手、煞車與離合器拉桿、鏈條調整、防護件、腳踏後移與外觀件。官網把它們形容成 CNC 削切的「Made in Luxembourg」；其中腳踏系統明寫用高強度 7075 鋁合金。底座對得上，位置微調才有意義。</p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證逐字見檔頭) */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">2000</div>
            <div className="pd-bs-stat-l">品牌創立</div>
            <div className="pd-bs-stat-s">盧森堡 Grevenmacher</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">6</div>
            <div className="pd-bs-stat-l">主要產品線</div>
            <div className="pd-bs-stat-s">把手到腳踏一整組</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">7075</div>
            <div className="pd-bs-stat-l">高強度鋁合金</div>
            <div className="pd-bs-stat-s">CNC Made in Luxembourg</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">OEM</div>
            <div className="pd-bs-stat-l">原廠供應商</div>
            <div className="pd-bs-stat-s">BMW · Yamaha · Suzuki</div>
          </div>
        </div>
      </section>
    </>
  );
}
