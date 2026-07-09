// ProductHighlights.tsx — 商品詳細頁 N°01 區塊「為什麼選 RPM Carbon」(3 卡)
//
// OD-6(視覺真權威遷至 OD product-detail-rpm-template.html N°01、鐵則 1 直接搬):
// - 內容字面**直接搬 OD 模板 N°01**(eyebrow / h2 / 3 卡);全形標點保留 OD 原字面。
//   🔴 lead 例外:Sean 2026-07-09 肉眼驗拍板「N°01 文字大約兩行保持精簡」→ lead 由 OD 原多句長段收斂為
//   兩行精簡(核心差異化「原廠開模 → 保留燈具後照鏡 → 全面碳纖道路化」),三家 N°01 lead 一致精簡(business override、鐵則 1 例外)。
// - N°01 在 OD 模板是「RPM 共用區塊」(HANDOFF §2、所有 RPM 商品同一份品牌定位)→ 內容由
//   product.brand 動態改為 **RPM 固定**;元件改 prop-less(不再吃 product)。Phase 1 catalog
//   RPM-only,故 RPM-fixed 合理(business override);Phase 2 接 supabase product_highlights 表
//   真區分品牌時再恢復 product 參數(STATUS M-1-13H Phase 2 LOG 條目 product_highlights)。
// - eyebrow 巢狀形式(.pd-eb-no 義體數字 + .pd-eb-sep 金線 + 品牌標記),CSS 由 OD-1 已備。
//   🔴 品牌標記 = 真 RPM Carbon logo 圖(#270 B、Sean 2026-07-09 提供 精品-RPM Carbon.avif、
//   落地 public/brands/rpm-carbon/logo.avif;pd-eb-logo <img> 與 GB/Bonamici 三家同款、同高對標)。
//   (原為文字 .pd-eb-label「RPM Carbon」佔位,因當時 public/ 無 RPM avif 資產;Sean 補真檔後改真 logo。)
//
// 純 presentational、無 props、無 hooks。由 client parent ProductPage import 進 client bundle。

export function ProductHighlights() {
  return (
    <section className="pd-section" aria-labelledby="pd-h-rpm">
      <div className="pd-section-head">
        <div className="pd-eyebrow">
          <span className="pd-eb-no">01</span>
          <span className="pd-eb-sep" aria-hidden="true" />
          <span className="pd-eb-logo">
            <img src="/brands/rpm-carbon/logo.avif" alt="RPM Carbon" />
          </span>
        </div>
        <h2 className="pd-h2" id="pd-h-rpm">為什麼選 RPM Carbon</h2>
        <p className="pd-lead">
          RPM Carbon 來自泰國，主打針對原廠車身開模的碳纖維車身套件與引擎護蓋——保留原廠燈具與後照鏡，達成全面碳纖道路化。
        </p>
      </div>

      <div className="pd-feature-grid">
        <article className="pd-feature-card">
          <div className="pd-feature-num">01</div>
          <h3 className="pd-feature-title">可直上原廠</h3>
          <p className="pd-feature-desc">大部分部品針對原廠車身開模，可以直接安裝在原廠車身上，保留原本的燈具與後照鏡，達成全面碳纖道路化。</p>
        </article>
        <article className="pd-feature-card">
          <div className="pd-feature-num">02</div>
          <h3 className="pd-feature-title">紋路想怎麼搭都行</h3>
          <p className="pd-feature-desc">斜紋、平織、鍛造、蜂巢、12K 五款紋路 × 亮光、消光兩種表面，從低調實用到強悍個性自己組合。</p>
        </article>
        <article className="pd-feature-card">
          <div className="pd-feature-num">03</div>
          <h3 className="pd-feature-title">輕量化．隔熱防燙</h3>
          <p className="pd-feature-desc">真碳纖維比原廠塑件更輕，能減輕車重；同時不導熱，引擎護蓋、排氣護片這類靠近熱源的部位，騎完不再怕燙到。</p>
        </article>
      </div>
    </section>
  );
}
