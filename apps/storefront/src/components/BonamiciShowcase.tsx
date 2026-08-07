// BonamiciShowcase.tsx — Bonamici Racing 品牌形象區 N°01 + N°02(#270 B S5 + S6 真圖/真影片)
//
// 🔴 視覺真權威 = 07-08 壓縮版 Artifact「壓縮版預覽」(9368fc24、file-history 救回、備份於本 session
//   scratchpad/artifact-recovery/0708-preview-ffed-v2.html 的 data-b="bonamici" 區塊)。文案逐字直搬草稿(鐵則 1)。
// 🔴 標點例外:草稿(OD 家族)原用半形逗號/冒號,渲染改**全形**——對齊 storefront 商品詳情散文家族
//   (#223 Sean 2026-06-10 Q2=B「全頁散文全形」業務 override、鐵則 1 例外;manifest productPageFullwidthPunctuation)。
// - N°01「為什麼選 Bonamici」三卡:重用 RPM/GB 的 pd-feature-* 骨架;eyebrow 用真 Bonamici logo 圖(D5=B)。
// - N°02「產線巡禮」:品牌影片(真 YouTube facade)+ 研發/職人兩段真圖 + 8 色陽極真部品照 + 20 年徽章;pd-bona-*。
// 🔴 S6 真圖/真影片(Sean 2026-07-09 授權確認、Q1=A public/brands):圖片為 07-03 長版草稿內嵌 base64 → 解出
//   落地 public/brands/bonamici/*.webp(logo/video-thumb/research/craft/anod-*8);走原生 <img>(對齊 storefront
//   RPM swatch 慣例)。品牌影片 = 草稿內真 YouTube ID(JBWv0RvSWXY)、facade(縮圖→點擊才載 iframe、
//   同 InstallResources 手法、省流量);故本元件需 'use client'(facade onClick → useState 換入 iframe)。

'use client';

import { useState } from 'react';

// 品牌形象影片 YouTube ID(草稿 <a href> 內真連結;facade 點擊才載入 embed)。
const BONA_VIDEO_ID = 'JBWv0RvSWXY';

export function BonamiciShowcase() {
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <>
      {/* N°01 — 為什麼選 Bonamici(三卡、重用 pd-feature 骨架、三家一致) */}
      <section className="pd-section" aria-labelledby="pd-h-bona01">
        {/* lead 精簡(Sean 2026-07-09 肉眼驗二次拍板:「N°01 文字不要加長、大約兩行保持精簡即可」——推翻同日稍早「加長」)。
            標準 pd-section-head(760px 讀寬、段落自然折行),文案逐字直搬壓縮版草稿(鐵則 1)。 */}
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">01</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-logo">
              <img src="/brands/bonamici/logo.webp" alt="Bonamici Racing" />
            </span>
          </div>
          <h2 className="pd-h2" id="pd-h-bona01">為什麼選 Bonamici</h2>
          <p className="pd-lead">
            義大利薩賓丘陵的家族工坊，二十餘年只做一件事——把賽道經驗鍛造成每一件 CNC 切削部品，100% 義大利設計與製造。
          </p>
        </div>
        <div className="pd-feature-grid">
          <article className="pd-feature-card">
            <div className="pd-feature-num">01</div>
            <h3 className="pd-feature-title">義大利家族工坊，三代傳承</h3>
            <p className="pd-feature-desc">從金工師傅 Luciano Bonamici 到兩個兒子 Riccardo 與 Enrico，二十餘年只專注一件事：把賽道經驗鍛造成每一件 CNC 部品。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">02</div>
            <h3 className="pd-feature-title">航太級鋁合金 × F1 等級研發</h3>
            <p className="pd-feature-desc">採用源自 Formula 1 的 CAM 建模與 3D 列印打樣驗證，交由 3／4／5 軸 CNC 精密切削，搭配陽極處理，在效能與輕量間取得平衡。</p>
          </article>
          <article className="pd-feature-card">
            <div className="pd-feature-num">03</div>
            <h3 className="pd-feature-title">WorldSBK 冠軍血統實戰驗證</h3>
            <p className="pd-feature-desc">Bonamici 是 ROKiT BMW WorldSBK 車隊與兩屆世界冠軍 Toprak Razgatlıoğlu 的官方裝備，並與 GRT Yamaha 長期合作。</p>
          </article>
        </div>
      </section>

      {/* N°02 — 產線巡禮(品牌影片 facade + 研發/職人兩段 + 8 色陽極 + 20 年徽章) */}
      <section className="pd-section" aria-labelledby="pd-h-bona02">
        <div className="pd-section-head">
          <div className="pd-eyebrow">
            <span className="pd-eb-no">02</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  產線巡禮'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-bona02">從一塊鋁，到一件賽車部品</h2>
          <p className="pd-lead">
            F1 等級研發 × 多軸 CNC 精密切削 × 職人手工——每一刀都在效能與輕量之間取得平衡。
          </p>
        </div>

        {/* 品牌形象影片(facade:縮圖 → 點擊才載入 YouTube iframe、省流量;同 InstallResources) */}
        <div className="pd-bona-video">
          {videoOpen ? (
            <iframe
              className="pd-bona-video-frame"
              src={`https://www.youtube.com/embed/${BONA_VIDEO_ID}?autoplay=1&rel=0`}
              title="Bonamici Racing 品牌形象影片"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <button
              type="button"
              className="pd-bona-video-facade"
              onClick={() => setVideoOpen(true)}
              aria-label="播放 Bonamici Racing 品牌形象影片"
            >
              <img className="pd-bona-video-thumb" src="/brands/bonamici/video-thumb.webp" alt="" loading="lazy" />
              <span className="pd-bona-video-play" aria-hidden="true" />
              <span className="pd-bona-video-label">品牌形象影片 · Bonamici Racing</span>
            </button>
          )}
        </div>

        {/* 研發段(桌機:圖左文右) */}
        <div className="pd-bona-brow">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/bonamici/research.webp" alt="Bonamici 研發 · CAM 建模與 3D 打樣" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">01 — Research &amp; Development</div>
            <div className="pd-bona-h3">研發與設計</div>
            <p className="pd-bona-p">每件部品先以源自 Formula 1 的 CAM 建模繪製，再 3D 列印快速打樣、實車驗證，確認貼合與強度後才量產——設計不是畫出來就好，是騎出來的。</p>
          </div>
        </div>

        {/* 職人段(桌機:圖右文左、flip) */}
        <div className="pd-bona-brow pd-bona-brow-flip">
          <div className="pd-bona-brow-media">
            <img className="pd-bona-media-img" src="/brands/bonamici/craft.webp" alt="Bonamici 職人 · 多軸 CNC 精密切削" loading="lazy" />
          </div>
          <div>
            <div className="pd-bona-step">02 — Craftsmanship</div>
            <div className="pd-bona-h3">職人手工 · 精密切削</div>
            <p className="pd-bona-p">航太級鋁合金經 3／4／5 軸 CNC 一體切削成型，再由職人手工修整、陽極處理提升抗蝕耐磨——從原料到成品，100% 在義大利完成。</p>
          </div>
        </div>

        {/* 陽極色牆(8 色真部品照;實際可選色以各商品頁為準) */}
        <div className="pd-bona-anod">
          <div className="pd-bona-anod-head">
            <span className="pd-bona-anod-eb">Anodized Finish</span>
            <span className="pd-bona-anod-t">可選陽極色</span>
            <span className="pd-bona-anod-c">實際可選色以各商品頁為準</span>
          </div>
          <div className="pd-bona-sw">
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-black.webp" alt="Bonamici 陽極黑部品" loading="lazy" /><div className="pd-bona-sw-n">陽極黑</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-red.webp" alt="Bonamici 陽極紅部品" loading="lazy" /><div className="pd-bona-sw-n">紅</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-blue.webp" alt="Bonamici 陽極藍部品" loading="lazy" /><div className="pd-bona-sw-n">藍</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-gold.webp" alt="Bonamici 陽極金部品" loading="lazy" /><div className="pd-bona-sw-n">金</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-green.webp" alt="Bonamici 陽極綠部品" loading="lazy" /><div className="pd-bona-sw-n">綠</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-orange.webp" alt="Bonamici 陽極橙部品" loading="lazy" /><div className="pd-bona-sw-n">橙</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-bronze.webp" alt="Bonamici 陽極古銅部品" loading="lazy" /><div className="pd-bona-sw-n">古銅</div></div>
            <div className="pd-bona-sw-item"><img className="pd-bona-sw-c" src="/brands/bonamici/anod-silver.webp" alt="Bonamici 陽極銀部品" loading="lazy" /><div className="pd-bona-sw-n">銀</div></div>
          </div>
        </div>

        {/* 20 年徽章列(🔴 L2 hardcode、backlog #271) */}
        <div className="pd-bona-badges">
          <div className="pd-bona-badge"><div className="pd-bona-badge-t">20 年</div><div className="pd-bona-badge-l">精工淬鍊</div></div>
          <div className="pd-bona-badge"><div className="pd-bona-badge-t">精密機械</div><div className="pd-bona-badge-l">Precision Mechanics</div></div>
          <div className="pd-bona-badge"><div className="pd-bona-badge-t">義大利製</div><div className="pd-bona-badge-l">100% Made in Italy</div></div>
          <div className="pd-bona-badge"><div className="pd-bona-badge-t">持續研發</div><div className="pd-bona-badge-l">R&amp;D Continued</div></div>
        </div>
      </section>
    </>
  );
}
