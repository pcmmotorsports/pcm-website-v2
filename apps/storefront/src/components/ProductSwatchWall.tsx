// ProductSwatchWall.tsx — 商品詳細頁 N°02「紋路 × 表面」紋路樣式牆
//
// OD-7b(視覺真權威 OD product-detail-rpm-template.html N°02、鐵則 1 直接搬):
// - 結構 + 字面 + 圖片 URL 直接搬 OD 模板 N°02:eyebrow(義體 02 + 金線 + N° 紋路 × 表面)、
//   h2 / lead、亮光款 6 卡(cols-6)+ 消光款 4 卡(cols-4)+ 挑選小提醒(swatch-note)。
// - 10 張樣品圖來自 shared data `@/data/rpm-swatches`(Shopee 圖床遠端 URL、直接搬、無需本地資產);
//   同份資料 OD-7c picker 預覽卡共用。
// - **RPM 品牌通用展示**(HANDOFF §2 RPM 共用區塊、全商品同一份)→ prop-less。
// - ⚠️ swatch 圖點擊放大 lightbox:本片暫靜態(cursor:zoom-in CSS 直接搬、提示未來可點),
//   lightbox 互動 + picker 預覽卡一起在 OD-7c 補(對齊 OD-2「不移植 vanilla lightbox JS」、
//   storefront 用 React lightbox);本片不接 click handler。
//
// 純 presentational、無 props、無 hooks。由 client parent ProductPage import 進 client bundle。

import { RPM_SWATCHES_GLOSSY, RPM_SWATCHES_MATTE, type RpmSwatch } from '@/data/rpm-swatches';

function SwatchCard({ swatch }: { swatch: RpmSwatch }) {
  return (
    <article className={`swatch-card${swatch.rare ? ' is-rare' : ''}`} role="listitem">
      <div className="swatch-card-img">
        {swatch.tag && <span className="swatch-card-tag">{swatch.tag}</span>}
        <img loading="lazy" src={swatch.img} alt={swatch.alt} />
      </div>
      <div className="swatch-card-info">
        <span className="swatch-card-name">{swatch.name}</span>
        <span className="swatch-card-meta">{swatch.meta}</span>
      </div>
    </article>
  );
}

export function ProductSwatchWall() {
  return (
    <section className="pd-section" aria-labelledby="pd-h-swatch">
      <div className="pd-section-head">
        <div className="pd-eyebrow">
          <span className="pd-eb-no">02</span>
          <span className="pd-eb-sep" aria-hidden="true" />
          <span className="pd-eb-label">{'N°  紋路 × 表面'}</span>
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
            <SwatchCard key={s.meta} swatch={s} />
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
            <SwatchCard key={s.meta} swatch={s} />
          ))}
        </div>
      </div>

      <div className="swatch-note">
        <strong>挑選小提醒:</strong>
        亮光款共 6 種紋路、消光款共 4 種紋路,依車款不同可選擇的樣式略有差異。
        <strong>蜂巢紋路主要為亮光款</strong>,消光蜂巢屬於特別訂製。
        彩色碳纖、特殊樣式需等 <strong>1–4 個月</strong>,下單前請先聊聊確認貨況。
      </div>
    </section>
  );
}
