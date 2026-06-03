// ProductSwatchWall.tsx — 商品詳細頁 N°02「紋路 × 表面」紋路樣式牆
//
// OD-7b(視覺真權威 OD product-detail-rpm-template.html N°02、鐵則 1 直接搬):
// - 結構 + 字面 + 圖片 URL 直接搬 OD 模板 N°02:eyebrow(義體 02 + 金線 + N° 紋路 × 表面)、
//   h2 / lead、亮光款 6 卡(cols-6)+ 消光款 4 卡(cols-4)+ 挑選小提醒(swatch-note)。
// - 10 張樣品圖來自 shared data `@/data/rpm-swatches`(Shopee 圖床遠端 URL);同份資料 picker 預覽卡共用。
// - **RPM 品牌通用展示**(HANDOFF §2 RPM 共用區塊、全商品同一份)。
//
// Fix B(Sean 2026-06-03 :3001 驗:頁內所有圖片都要可點擊放大):卡片圖改 button、點擊開共用
//   SwatchLightbox 瀏覽全 10 張(以該卡為起點);原 OD-7b「lightbox 暫靜態」此片補上。
//   → 因含 useState 改 'use client'(由 client parent ProductPage import 進 client bundle)。

'use client';

import { useState } from 'react';
import {
  RPM_SWATCHES,
  RPM_SWATCHES_GLOSSY,
  RPM_SWATCHES_MATTE,
  type RpmSwatch,
} from '@/data/rpm-swatches';
import { SwatchLightbox } from './SwatchLightbox';

function SwatchCard({ swatch, onZoom }: { swatch: RpmSwatch; onZoom: () => void }) {
  return (
    <article className={`swatch-card${swatch.rare ? ' is-rare' : ''}`} role="listitem">
      <button
        type="button"
        className="swatch-card-img"
        onClick={onZoom}
        aria-label={`放大檢視 ${swatch.name}`}
      >
        {swatch.tag && <span className="swatch-card-tag">{swatch.tag}</span>}
        <img loading="lazy" src={swatch.img} alt={swatch.alt} />
      </button>
      <div className="swatch-card-info">
        <span className="swatch-card-name">{swatch.name}</span>
        <span className="swatch-card-meta">{swatch.meta}</span>
      </div>
    </article>
  );
}

export function ProductSwatchWall() {
  const [lbIdx, setLbIdx] = useState<number | null>(null);
  const openSwatch = (s: RpmSwatch) => {
    const idx = RPM_SWATCHES.indexOf(s);
    setLbIdx(idx < 0 ? 0 : idx);
  };

  return (
    <section className="pd-section" aria-labelledby="pd-h-swatch">
      <div className="pd-section-head">
        <div className="pd-eyebrow">
          <span className="pd-eb-no">02</span>
          <span className="pd-eb-sep" aria-hidden="true" />
          <span className="pd-eb-label">{'N°  紋路 × 表面'}</span>
        </div>
        <h2 className="pd-h2" id="pd-h-swatch">五款紋路 × 兩種表面,想怎麼配自己決定</h2>
        <p className="pd-lead">斜紋、平織、鍛造、蜂巢、12K 五款紋路 × 亮光、消光兩種表面,自由搭配。紋路依花色不同價格不一樣;表面處理不影響價格。</p>
      </div>

      {/* 亮光款 — 6 種(4 標準紋路 + 2 款 12K 加強)*/}
      <div className="swatch-section">
        <div className="swatch-section-head">
          <span className="swatch-section-eyebrow">Glossy</span>
          <h3 className="swatch-section-title">亮光款</h3>
          <span className="swatch-section-count">6 種樣式</span>
        </div>
        <div className="swatch-grid cols-6" role="list" aria-label="亮光款 紋路樣式">
          {RPM_SWATCHES_GLOSSY.map((s) => (
            <SwatchCard key={s.meta} swatch={s} onZoom={() => openSwatch(s)} />
          ))}
        </div>
      </div>

      {/* 消光款 — 4 種(3 標準紋路 + 1 款消光蜂巢特別訂製)*/}
      <div className="swatch-section">
        <div className="swatch-section-head">
          <span className="swatch-section-eyebrow">Matte</span>
          <h3 className="swatch-section-title">消光款</h3>
          <span className="swatch-section-count">4 種樣式</span>
        </div>
        <div className="swatch-grid cols-4" role="list" aria-label="消光款 紋路樣式">
          {RPM_SWATCHES_MATTE.map((s) => (
            <SwatchCard key={s.meta} swatch={s} onZoom={() => openSwatch(s)} />
          ))}
        </div>
      </div>

      <div className="swatch-note">
        <strong>挑選小提醒:</strong>
        亮光款共 6 種紋路、消光款共 4 種紋路,依車款不同可選擇的樣式略有差異。
        <strong>蜂巢紋路主要為亮光款</strong>,消光蜂巢屬於特別訂製。
        彩色碳纖、特殊樣式需等 <strong>1–4 個月</strong>,下單前請先聊聊確認貨況。
      </div>

      <SwatchLightbox swatches={RPM_SWATCHES} lbIdx={lbIdx} setLbIdx={setLbIdx} />
    </section>
  );
}
