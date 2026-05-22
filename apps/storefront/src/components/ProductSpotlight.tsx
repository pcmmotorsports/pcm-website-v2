// ProductSpotlight.tsx — 商品詳細頁 N°02 Engineering Spotlight 區塊(條件渲染 + 4 段 + 3 stats)
//
// 字面從 design-reference/components/explorations/VariantCFull.jsx L132-152 直接搬:
// - 條件:`product.hasSpotlight === true`(Q2=B 拍板、不採 HANDOFF L291 字面 `product.id % 3 === 0`)
// - eyebrow:`N°02 — Engineering`
// - h2:`為賽道設計、<br/>適合每日通勤。`
// - body × 2(L139-145、設計工藝 + Plug & Play 兩段、L3 hardcoded 對沖)
// - 3 stats(L146-150:−38% / ±0.02mm / 24m、L3 hardcoded 對沖)
// - spot-media(L133-135:design 用 unsplash gallery[1]、storefront Phase 1 用純 CSS gradient
//   placeholder、不取 PRODUCT_IMG_POOL 第 3 處撞觸發 backlog #155 抽 helper;Phase 2 接
//   supabase product_spotlights.image_url 欄)
//
// M-1-13H-4(對應 HANDOFF #13 + PRD §4 slice-4 Q2=B + Q7 全拆):新增子元件、純 presentational
// component、無 hooks、單一 props `{ product: MockProduct }`(只用 product.hasSpotlight);
// 不渲染條件返回 null、ProductPage caller 無需 if-guard;由 client parent ProductPage 渲染、
// 進 client bundle(M-1-13H-6 Codex Fix 4 註解校正:原寫「server component」誤導、
// 本元件無 'use client' 但被 client 端 import、實際進 client bundle)。
//
// 鐵則 9 內容分級對沖揭示(對齊 PRD §7):
// - body 字面「7075-T6 鋁合金 / 5 軸 CNC / Hard Anodized」對齊 Lightech 故事(design 字面源)、
//   套用到其他品牌(Akrapovič / Brembo)字面同樣誤導、屬 L3 hardcoded 對沖;
// - 3 stats(−38% / ±0.02mm / 24m)同樣 Lightech 專屬數字、屬 L3 對沖;
// - Phase 1 業務指定 3 件 hardcoded hasSpotlight: true(lightech-1 + akrapovic-6 + brembo-7、
//   Sean 2026-05-22 A1 拍板);Phase 2 接 supabase product_spotlights 表(M-1-16 後)真區分內容。

import type { MockProduct } from '@/data/mock-products';

export type ProductSpotlightProps = { product: MockProduct };

export function ProductSpotlight({ product }: ProductSpotlightProps) {
  if (!product.hasSpotlight) return null;

  return (
    <section className="pd-spotlight">
      <div className="pd-spot-media" aria-hidden="true" />
      <div className="pd-spot-text">
        <div className="pd-eyebrow">N°02 — Engineering</div>
        <h2 className="pd-h2">
          為賽道設計,<br />適合每日通勤。
        </h2>
        <p className="pd-body">
          從 SBK 賽事工程衍生的設計語言,使用航太級 7075-T6 鋁合金,經 5 軸 CNC
          一體成型後,以 Hard Anodized 硬陽極處理表面,耐腐蝕、耐磨、抗刮傷。
        </p>
        <p className="pd-body">
          對應原廠螺絲孔位,Plug &amp; Play,不需修改車身結構。包含安裝螺絲、扭力建議值與專屬保固卡。
        </p>
        <div className="pd-spot-stats">
          <div>
            <strong>−38%</strong>
            <span>較原廠輕量化</span>
          </div>
          <div>
            <strong>±0.02mm</strong>
            <span>CNC 加工公差</span>
          </div>
          <div>
            <strong>24m</strong>
            <span>原廠保固期</span>
          </div>
        </div>
      </div>
    </section>
  );
}
