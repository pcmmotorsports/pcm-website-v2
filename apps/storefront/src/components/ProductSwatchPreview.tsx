// ProductSwatchPreview.tsx — 右欄 picker 上方「紋路 × 表面 即時預覽小卡」
//
// OD-7c(Sean 2026-06-03 Q2「預覽卡保留」、視覺真權威 OD 模板 §8 .pd-pattern-preview、鐵則 1):
// - 顯示當前選中變體對應的**紋路樣品圖**(findSwatch(spec) from @/data/rpm-swatches、含 fallback),
//   解決「按了 picker 看不到變化」(HANDOFF §8 核心 UX);與 Hero 圖庫(OD-7d 真變體實拍)互補。
// - 點預覽圖開 lightbox、瀏覽全 10 張樣品。lightbox 已抽成共用 ./SwatchLightbox(Fix B、N°02 紋路牆也用)。
// - value 文字由 caller(ProductInfo)算好傳入(反映實際選擇、如「Kevlar斜紋 · 亮光」)。
// - 無 selectedVariant(非變體 mock 商品)→ 不渲染。
//
// 'use client' 必要:useState + onClick。

'use client';

import { useState } from 'react';
import type { UIVariant } from '@/data/mock-products';
import { RPM_SWATCHES, findSwatch } from '@/data/rpm-swatches';
import { SwatchLightbox } from './SwatchLightbox';

export type ProductSwatchPreviewProps = {
  selectedVariant: UIVariant | null;
  /** 反映實際選擇的「紋路 · 表面」文字(由 ProductInfo 算、如「12K斜紋 · 亮光」)*/
  valueText: string;
};

export function ProductSwatchPreview({ selectedVariant, valueText }: ProductSwatchPreviewProps) {
  const [lbIdx, setLbIdx] = useState<number | null>(null);

  if (!selectedVariant) return null;
  const swatch = findSwatch(selectedVariant.spec);

  const openLightbox = () => {
    const idx = RPM_SWATCHES.indexOf(swatch);
    setLbIdx(idx < 0 ? 0 : idx);
  };

  return (
    <>
      <div className={`pd-pattern-preview${swatch.rare ? ' is-rare' : ''}`} aria-live="polite">
        <button
          type="button"
          className="pd-pattern-preview-img"
          onClick={openLightbox}
          aria-label="放大檢視當前選擇的紋路樣品"
        >
          <img src={swatch.img} alt={swatch.alt} />
          <span className="pd-pattern-preview-zoom" aria-hidden="true">⤢</span>
        </button>
        <div className="pd-pattern-preview-text">
          <span className="pd-pattern-preview-label">當前樣式</span>
          <span className="pd-pattern-preview-value">{valueText}</span>
          <span className="pd-pattern-preview-hint">點圖片可放大檢視</span>
        </div>
      </div>

      <SwatchLightbox swatches={RPM_SWATCHES} lbIdx={lbIdx} setLbIdx={setLbIdx} />
    </>
  );
}
