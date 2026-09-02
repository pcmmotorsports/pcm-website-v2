// RizomaShowcase.tsx — RIZOMA 品牌形象區 N°01 + N°02(上架第 18 家、2026-09-02)
//
// 製作依據(Sean 2026-09-02 逐字「甲 重量版(跟 Akrapovic / GILLES 一樣)」):
// - 骨架逐支對照 `GillesShowcase.tsx` = 重量版(N°01 三卡 + N°02 hero 影片帶 + 故事兩段 + 信任狀四格)。
//   N°01 重用 pd-feature-*、N°02 重用 pd-bs-*(信任狀)+ pd-bona-brow(故事段),與其餘 17 家同骨架。
//
// 🔴🔴 **內容範圍是 Sean 自己點名的**(2026-08-02,逐字記在 OD
//   `pcm-home-redesign/brand-content-data.js:1085-1086`):
//     「rizoma 要講解的是**設計理念**」+ 要求帶出「除了原本產品線之外**還拓展了不同產品線**」
//   ⇒ 本片三卡就是照那兩件長的,不是我們自己挑的角度。
//
// 🔴🔴 **而【沿革】刻意不寫 —— 那是一個拍板,不是漏掉。**(主視窗 2026-09-02 判【甲】)
//   本窗 WebFetch 實測三發:`rizoma.com/en/about-us` ⇒ **404** · `rizoma.com/en/company` ⇒ **404** ·
//   首頁無任何 about/history 連結(全頁唯一公司識別 =「©2026 Rizoma Srl … PI 02595220125」)·
//   `rizoma.com/quality-policy/` ⇒ 製造 / 認證 / 產地 / 沿革一句都沒有。
//   ✅ 而 OD 那一側**獨立撞過同一面牆並寫下來**(`brand-content-data.js:1090` 逐字):
//     「⚠️ `rizoma.com` 本身仍無可連線的 About 頁,故沿革標明為**網路查證而非官網**。」
//   ⇒ 🎯 所以「2001 年 / Rigolio 兄弟 / Ferno」那組事實**沒有官網來源** ⇒ 本片不用它們。
//   ⚠️ 而 OD `handoff/pages/brand-content-sources.md:81` 登記的官方來源
//     `https://www.rizoma.com/en/company` **本窗 2026-09-02 實測 404** ——
//     📌 那是一份誠實的來源檔,而它的來源自己過期了,**而它不會叫**。下一個查 RIZOMA 的人會先看它。
//
// 🔴 **事實(除了下面那兩句登記在案的例外)本窗親自 WebFetch 官網當場查證**(不是轉述、不是憑記憶;2026-09-02),逐條原文:
//   cycle.rizoma.com(單車線 R21 後視鏡)逐字:
//     "Invisibile nelle proporzioni, precisa nella funzione, immediata nell'utilizzo."
//     "Perché cambiare un'abitudine non significa imporre qualcosa di nuovo,
//      ma renderlo così naturale da non riuscire più a farne a meno."
//     "Lente ottica ultraleggera con tecnologia Zeiss®, per una visione in alta definizione.
//      Infrangibile, antitaglio, afocale"
//     "Corpo in alluminio ricavato dal pieno e struttura resistente, precisa e a peso ridotto."
//     "Sistema magnetico quick release, con sgancio immediato e posizionamento stabile durante l'utilizzo."
//     R21 = 18 grams,黑 / 銀兩色。
//   www.rizoma.com/en/americana-collection/ 逐字:
//     "to design components that seamlessly integrate and enhance the visual identity of V-Twin motorcycles."
//     "Every detail is inspired from the distinctive lines of these American-made masterpieces,
//      designed to introduce style and innovation and engineered to elevate performance and comfort."
//     "Solar Titanium" — "a custom total look to express the style essence of the Americana Collection:
//      bold, cinematic, radically new."
//     "destined to evolve and expand year over year";涵蓋後視鏡、拉桿、方向燈座、腳踏板、
//     乘客腳踏、後煞車踏桿、打檔桿(Harley-Davidson 車型)。
//
//   🟡 **而有兩句的來源【不是那兩個頁面】,登記在這裡**(`-0e` 2026-09-02 R1 F2 抓到):
//     · `:172`「油箱蓋」—— 那兩個頁面逐字**沒有**它(Americana 品項是後視鏡 / 拉桿 / 方向燈座 /
//       腳踏板 / 乘客腳踏 / 後煞車踏桿 / 打檔桿)。**佐證是 repo 產品圖**
//       `brand-assets/assets/brands-prod/rizoma/tank-cap.jpg`(= 本片 `story-range.jpg` 的原檔)
//       ⇒ 🔴 **那是【我們手上的商品照】, 不是官網文案。**
//     · `:101`「**義大利的**設計取向部品廠」—— 佐證是官網頁尾的法人識別
//       「©2026 Rizoma **Srl** … **PI** 02595220125」(`Srl` 與 `PI` 統編都是義大利法人形式)。
//       ⚠️ 而那不是一句「我們是義大利品牌」的文案 ⇒ **它是推的, 不是抄的。**
//
// 🛑 **本片涵蓋的事實只有上面這兩個頁面撐得住的那些(加上剛剛登記的那兩句)。已知未涵蓋**:
//   創立年份 / 創辦人 / 工廠所在地 / 認證 —— 官網查無,而本片不從第三方補。
//
// - 素材:全部是 repo 既有檔的副本(不是新抓的)。
//   hero.mp4 = `brand-assets/assets/brand-video/rizoma-scrambler.mp4`(1.35MB,sha256 與原檔相同)
//   🟡 **影片是【暫定】** —— repo 裡另有 `rizoma-fashion.mp4`,而挑哪一支是 Sean 的品味;
//     主視窗 2026-09-02 判「先做, 做完連同另一支一起端他」。換它是改一個 `src` 字串。
//   hero-poster.jpg / story-design.jpg / story-range.jpg = `brands-prod/rizoma/` 底下既有圖
//   logo.png = `brands-trim/rizoma.png` 的副本。
//   🟢 **五支逐支比過 sha256, 全部與原檔相同**(`-0e` 2026-09-02 指出我原本只附了兩支的):
//     hero.mp4 ← rizoma-scrambler.mp4 · logo.png ← brands-trim/rizoma.png
//     hero-poster.jpg  `2ce720710b62…` ← brands-prod/rizoma/video-scrambler.jpg
//     story-design.jpg `eb1bd2566a25…` ← brands-prod/rizoma/stealth-mirror.jpg
//     story-range.jpg  `e5a50ef356f5…` ← brands-prod/rizoma/tank-cap.jpg
//   🔴 刻意留副本、不直接引原檔:`/brands/<slug>/` 是 showcase 的資產(同第 17 家前例)。
//   ⚠️ 而副檔名是 `.jpg` 不是 `.webp`(第 17 家轉過檔;本片直接用既有圖,沒有轉)。
//
// 🔴 L2 內容(鐵則 9):信任狀四格 hardcode、無後台 CRUD(同其餘 17 家、backlog #271)。
//
// hero 影片需 IntersectionObserver + video 控制 → 'use client'(同 GillesShowcase 前例)。

'use client';

import { useEffect, useRef } from 'react';

export function RizomaShowcase() {
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
      {/* N°01 — 為什麼選 RIZOMA(三卡、重用 pd-feature 骨架、家族一致) */}
      <section className="pd-section" aria-labelledby="pd-h-rizoma01">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/rizoma/logo.png" alt="RIZOMA" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-rizoma01">為什麼選 RIZOMA</h2>
          <p className="pd-lead">
            義大利的設計取向部品廠。官網把它的做法寫成一句：比例上看不見、功能上準確、用起來直覺——
            部品要像原本就長在車上，而不是加上去的。
          </p>
        </div>

        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">看不見的比例</h3>
            <p className="pd-feature-desc">
              官網對自家設計的描述逐字是「比例上不著痕跡、功能上精準、使用上即時」。
              換句話說：好看不是加東西，是讓它與車身的線條對得上。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">從整塊鋁削出來</h3>
            <p className="pd-feature-desc">
              官網寫本體「以整塊鋁材削切成形，結構堅固、精度高、重量輕」。
              而鏡片那一件用的是 Zeiss® 光學技術，官網標明不碎、抗切割、無度數。
            </p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">不只做機車</h3>
            <p className="pd-feature-desc">
              Americana 系列專為美式 V-Twin 而生，官網說它「會逐年演進與擴張」；
              而另一條線做到了單車上——R21 後視鏡只有 18 公克。
            </p>
          </article>
        </div>
      </section>

      {/* N°02 — 設計理念與產品線(官網形象影片帶 + 設計/擴張兩段 + 信任狀四格;pd-bs 共用骨架) */}
      <section className="pd-section pd-bs pd-bs--rizoma" aria-labelledby="pd-h-rizoma02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  設計理念'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-rizoma02">好看是門檻，合手才是理由</h2>
          <p className="pd-lead">
            官網把「換掉一個習慣」講成這樣：不是把新東西塞給你，是讓它自然到你回不去。
            那句話同時解釋了他們的外觀取向與功能取向為什麼是同一件事。
          </p>
        </div>

        {/* 官網形象影片帶(muted loop、進視窗才播;pd-hero-band 選擇器不限 img、video 直接共用) */}
        <video
          ref={videoRef}
          className="pd-hero-band"
          src="/brands/rizoma/hero.mp4"
          poster="/brands/rizoma/hero-poster.jpg"
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
        />

        {/* 設計理念段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/rizoma/story-design.jpg" alt="RIZOMA 後視鏡裝於車上的特寫" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Design Intent</div>
            <div className="pd-bona-h3">讓它自然到你回不去</div>
            <p className="pd-bona-p">
              官網的原句是：改變一個習慣，不是強加一個新東西，而是讓它自然到你再也離不開。
              所以他們的部品不追求被看見——鏡子、油箱蓋、拉桿，先對上車身的線，再談功能。
            </p>
          </div>
        </div>

        {/* 產品線擴張段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/rizoma/story-range.jpg" alt="RIZOMA 油箱蓋特寫" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Beyond the Bike</div>
            <div className="pd-bona-h3">同一套做法，換一種車</div>
            <p className="pd-bona-p">
              Americana 系列從美式 V-Twin 的線條長出來，官網列的品項包含後視鏡、拉桿、方向燈座、
              腳踏板、乘客腳踏、後煞車踏桿與打檔桿，並說它會逐年擴張；而 R21 那一支把同樣的做法
              放到單車上——整塊鋁削出來的本體，配 Zeiss® 鏡片，18 公克。
            </p>
          </div>
        </div>

        {/* 信任狀四格(🔴 L2 hardcode、backlog #271;佐證逐字見檔頭)
            🛑 四格【刻意不放創立年份】—— 官網查無,見檔頭那段。 */}
        <div className="pd-bs-stats">
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Billet</div>
            <div className="pd-bs-stat-l">整塊鋁削出</div>
            <div className="pd-bs-stat-s">ricavato dal pieno</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">Zeiss®</div>
            <div className="pd-bs-stat-l">光學鏡片技術</div>
            <div className="pd-bs-stat-s">不碎 · 抗切割 · 無度數</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">V-Twin</div>
            <div className="pd-bs-stat-l">Americana 系列</div>
            <div className="pd-bs-stat-s">為美式雙缸而生</div>
          </div>
          <div className="pd-bs-stat">
            <div className="pd-bs-stat-n">18 g</div>
            <div className="pd-bs-stat-l">R21 單車後視鏡</div>
            <div className="pd-bs-stat-s">機車之外的另一條線</div>
          </div>
        </div>
      </section>
    </>
  );
}
