// ProductSpotlight.tsx — 商品詳細頁「碳纖維工藝」深度區塊(條件渲染 product.hasSpotlight)
//
// OD-7a(Sean 2026-06-03 Q1 拍板:不移除、先換碳纖維格式 + 備註交資料線):
// - OD 模板無此 Engineering Spotlight 區。Sean 拍板「保留、先換成碳纖維格式」;實際 per-廠牌
//   固定內文(每個品牌有自己的故事)由 **資料線 workstream** 之後接 DB 處理。
//   本片只把舊「7075-T6 鋁合金 / 5 軸 CNC / Hard Anodized」**鋁件**文案
//   ⚠️ 換成**碳纖維通用 placeholder 文案**(非真實 per-product 內容、待資料線真區分)。
// - 去 N°02 編號:N°02 已讓給紋路樣式牆(OD-7b ProductSwatchWall);本區 eyebrow 去掉「N°02 — 」、
//   改不帶編號的 flat eyebrow「碳纖維工藝」。
// - ⚠️ 低風險:hasSpotlight 為 mock-only 欄、只 3 個 legacy mock 商品(lightech-1/akrapovic-6/
//   brembo-7)帶;真 RPM 商品頁(toUIProduct 不設此欄)**不渲染此區**。故 placeholder 文案實際
//   只出現在 throwaway mock 頁、不影響真 RPM 詳情頁。
//
// 🔴 給審查 / 資料線 workstream:本區內文為碳纖維**通用 placeholder**、真正 per-廠牌固定內文
//    (每品牌不同 story)待資料線接 supabase product_spotlights DB(STATUS M-1-13H Phase 2 LOG)。
//    請於資料線 workstream 收口此區內容 + hasSpotlight 觸發條件。
//
// 字面從舊版(M-1-13H-4 design explorations VariantCFull)結構沿用、內容碳纖維化:
// - 條件:product.hasSpotlight === true(Q2=B 拍板、不採 HANDOFF id%3);falsy 返 null。
// - spot-media:純 CSS gradient placeholder(Phase 2 接 product_spotlights.image_url 欄)。
//
// 純 presentational、無 hooks。由 client parent ProductPage import 進 client bundle。

import { RPM_CARBON_BRAND_SLUG, type MockProduct } from '@/data/mock-products';

export type ProductSpotlightProps = { product: MockProduct };

export function ProductSpotlight({ product }: ProductSpotlightProps) {
  // 🔴 P0-C 去碳「第二道守門」(defense-in-depth):除 hasSpotlight 外,再要求 brandSlug 為 RPM。
  //   本區內文為**碳纖維通用 placeholder**,若未來非 RPM 商品(GB/Bonamici)誤帶 hasSpotlight=true,
  //   碳纖維文案不得外洩到非 RPM 頁(Q2=B);故守門用 brandSlug、不只靠 mock-only 的 hasSpotlight。
  if (!product.hasSpotlight || product.brandSlug !== RPM_CARBON_BRAND_SLUG) return null;

  return (
    <section className="pd-spotlight">
      <div className="pd-spot-media" aria-hidden="true" />
      <div className="pd-spot-text">
        <div className="pd-eyebrow">碳纖維工藝</div>
        <h2 className="pd-h2">
          真碳纖維，<br />為原廠車身而生。
        </h2>
        <p className="pd-body">
          採用真碳纖維材質，比原廠塑件更輕、不導熱；引擎護蓋、排氣護片這類靠近熱源的部位，騎完不再怕燙到。
        </p>
        <p className="pd-body">
          大部分部品針對原廠車身開模，鎖點對得起來、不用切割打孔，可直接安裝在原廠車身上，保留原本的燈具與後照鏡。
        </p>
        <div className="pd-spot-stats">
          <div>
            <strong>輕量</strong>
            <span>比原廠塑件輕</span>
          </div>
          <div>
            <strong>隔熱</strong>
            <span>真碳纖不導熱</span>
          </div>
          <div>
            <strong>直上</strong>
            <span>針對原廠開模</span>
          </div>
        </div>
      </div>
    </section>
  );
}
