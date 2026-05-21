// ProductHighlights.tsx — 商品詳細頁 N°01 Highlights 區塊(3 卡 hardcoded + h2 用 product.brand 變數注入)
//
// 字面從 design-reference/components/explorations/VariantCFull.jsx L106-129 直接搬:
// - eyebrow:`N°01 — Highlights`
// - h2:`為什麼是 {product.brand}`(模板、L1 動態、年改 0-1 次)
// - lead:`義大利賽道工藝 28 年沉澱、每件配件都為極限操駕而生。`(L3 hardcoded 對沖)
// - 3 卡:01 航太級材質 / 02 CNC 一體成型 / 03 原廠保固(各自含 num + title + desc、L3 hardcoded 對沖)
//
// M-1-13H-4(對應 HANDOFF #12 + PRD §4 slice-4 + Q7 全拆):新增子元件、純 presentational server component、
// 無 hooks、單一 props `{ product: MockProduct }`(只用 product.brand)。
//
// 鐵則 9 內容分級對沖揭示(對齊 PRD §7):
// - lead「義大利賽道工藝 28 年沉澱」對非義大利品牌(Akrapovič / Öhlins / GB Racing)字面誤導、
//   屬 L3 hardcoded 對沖(STATUS 字面「Phase 2 supabase 先 LOG 不動」業務拍板對沖鐵則 9);
// - 3 卡內容「7075-T6 鋁合金 / 五軸 CNC / 義大利原廠 24 個月」對齊 Lightech 故事(design 字面源)、
//   套用到其他品牌(Brembo / Akrapovič)字面同樣誤導、屬 L3 hardcoded 對沖;
// - Phase 2 接 supabase product_highlights 表(STATUS LOG 條目、M-1-16 後)真區分品牌內容;
// - backlog #162(brand.country)+ M-1-13H slice-6 待加 Phase 2 LOG 條目 product_highlights 為相關錨點。

import type { MockProduct } from '@/data/mock-products';

export type ProductHighlightsProps = { product: MockProduct };

export function ProductHighlights({ product }: ProductHighlightsProps) {
  return (
    <section className="pd-section pd-highlights">
      <div className="pd-section-head">
        <div className="pd-eyebrow">N°01 — Highlights</div>
        <h2 className="pd-h2">為什麼是 {product.brand}</h2>
        <p className="pd-lead">義大利賽道工藝 28 年沉澱,每件配件都為極限操駕而生。</p>
      </div>
      <div className="pd-feature-grid">
        <div className="pd-feature-card">
          <div className="pd-feature-num">01</div>
          <div className="pd-feature-title">航太級材質</div>
          <p className="pd-feature-desc">7075-T6 鋁合金,相較原廠減輕 38%,剛性提升 2 倍。</p>
        </div>
        <div className="pd-feature-card">
          <div className="pd-feature-num">02</div>
          <div className="pd-feature-title">CNC 一體成型</div>
          <p className="pd-feature-desc">五軸 CNC 精密切削,公差 ±0.02mm,無焊接點。</p>
        </div>
        <div className="pd-feature-card">
          <div className="pd-feature-num">03</div>
          <div className="pd-feature-title">原廠保固</div>
          <p className="pd-feature-desc">義大利原廠授權 24 個月,全台 9 家合作店家可安裝。</p>
        </div>
      </div>
    </section>
  );
}
