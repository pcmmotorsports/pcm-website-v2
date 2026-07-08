// BrandShowcase.tsx — 品牌形象區 dispatcher(#270 B S3)
//
// 🔴 S3 / #270 B(Sean 2026-07-08 拍 B、一致性):三家品牌(RPM/GB/Bonamici)頁面結構統一——
//   品牌介紹/形象區全部搬到規格分頁(ProductTabs)之下,讓客人先確認相容/規格再看品牌行銷
//   (Baymard DTC:完整品牌故事最佳做法是商品頁只留摘要 + 品牌敘事排在購買關鍵資訊之下)。
//   本 dispatcher 依 product.brandSlug 分派各品牌 showcase;未知品牌 → null(把 registry 集中一處、
//   避免 ProductPage 內 O(n) 條件無限膨脹破 400 行、鐵則 6)。
// - rpm-carbon:沿用既有 ProductHighlights(N°01)+ ProductSwatchWall(N°02)+ ProductSpotlight
//   (自帶 hasSpotlight + brandSlug 雙守門)。🔴 RPM 內容 byte 不變、只是位置由規格之上搬到規格之下
//   (Sean 明示授權「要就全部一致」、RPM byte 鐵律此線解除但僅搬位置、內容不改)。
// - gb-racing / bonamici:各自 Showcase(S4 GbRacingShowcase / S5 BonamiciShowcase 補;本片先 render null)。
// 🔴 收完整 product(非只 brandSlug):ProductSpotlight 需 product.hasSpotlight + 完整 product 雙守門
//   (codex 關卡1 must-fix、只傳 slug 會壞/不編譯);未來各品牌 showcase 亦可能吃 product 欄位。

import { RPM_CARBON_BRAND_SLUG, type MockProduct } from '@/data/mock-products';
import { ProductHighlights } from './ProductHighlights';
import { ProductSwatchWall } from './ProductSwatchWall';
import { ProductSpotlight } from './ProductSpotlight';

export type BrandShowcaseProps = { product: MockProduct };

export function BrandShowcase({ product }: BrandShowcaseProps) {
  switch (product.brandSlug) {
    case RPM_CARBON_BRAND_SLUG:
      // N°01 為什麼選 RPM Carbon + N°02 紋路牆 + Engineering Spotlight(內容 byte 不變、僅位置搬移)
      return (
        <>
          <ProductHighlights />
          <ProductSwatchWall />
          <ProductSpotlight product={product} />
        </>
      );
    default:
      // gb-racing → <GbRacingShowcase/>(S4)、bonamici → <BonamiciShowcase/>(S5);其餘未知品牌 → 無形象區
      return null;
  }
}
