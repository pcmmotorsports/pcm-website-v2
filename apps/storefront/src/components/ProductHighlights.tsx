// ProductHighlights.tsx — 商品詳細頁 N°01 區塊「為什麼選 RPM Carbon」(3 卡)
//
// OD-6(視覺真權威遷至 OD product-detail-rpm-template.html N°01、鐵則 1 直接搬):
// - 內容字面**直接搬 OD 模板 N°01**(eyebrow / h2 / lead / 3 卡);全形標點保留 OD 原字面。
// - N°01 在 OD 模板是「RPM 共用區塊」(HANDOFF §2、所有 RPM 商品同一份品牌定位)→ 內容由
//   product.brand 動態改為 **RPM 固定**;元件改 prop-less(不再吃 product)。Phase 1 catalog
//   RPM-only,故 RPM-fixed 合理(business override);Phase 2 接 supabase product_highlights 表
//   真區分品牌時再恢復 product 參數(STATUS M-1-13H Phase 2 LOG 條目 product_highlights)。
// - eyebrow 巢狀形式(.pd-eb-no 義體數字 + .pd-eb-sep 金線 + 品牌標記),CSS 由 OD-1 已備。
//   **品牌標記用文字 .pd-eb-label「RPM Carbon」**(對齊 N°02/N°03 文字 label pattern),
//   非 OD 模板的 logo <img>(storefront public/ 無 RPM Carbon avif 資產、不擅自造視覺資產、
//   交 Sean 後補真 logo — 對齊 feedback_sean-owns-visual-design;backlog 追蹤)。
//
// 純 presentational、無 props、無 hooks。由 client parent ProductPage import 進 client bundle。

export function ProductHighlights() {
  return (
    <section className="pd-section" aria-labelledby="pd-h-rpm">
      <div className="pd-section-head">
        <div className="pd-eyebrow">
          <span className="pd-eb-no">01</span>
          <span className="pd-eb-sep" aria-hidden="true" />
          <span className="pd-eb-label">RPM Carbon</span>
        </div>
        <h2 className="pd-h2" id="pd-h-rpm">為什麼選 RPM Carbon</h2>
        <p className="pd-lead">
          RPM Carbon 來自泰國，主要做碳纖維車身套件跟引擎護蓋。跟一般碳纖維廠不一樣的地方在於：大部分部品都針對原廠車身開模，可以保留原本的燈具與後照鏡，達成全面碳纖道路化。前後土除、尾殼、側蓋飾版、整流罩、腳踏翅膀、儀表殼通通有。
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
