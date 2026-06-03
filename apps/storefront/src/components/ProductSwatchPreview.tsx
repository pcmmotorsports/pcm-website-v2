// ProductSwatchPreview.tsx — 右欄 picker 上方「紋路 × 表面 即時預覽小卡」(+ 樣品 lightbox)
//
// OD-7c(Sean 2026-06-03 Q2「預覽卡保留」、視覺真權威 OD 模板 §8 .pd-pattern-preview、鐵則 1):
// - 顯示當前選中變體對應的**紋路樣品圖**(findSwatch(spec) from @/data/rpm-swatches、含 fallback),
//   解決「按了 picker 看不到變化」(HANDOFF §8 核心 UX);與 Hero 圖庫(OD-7d 真變體實拍)互補 ——
//   預覽卡是乾淨的紋路參考樣品、圖庫是該商品實際照片。
// - 點預覽圖開 lightbox、瀏覽全 10 張樣品(以當前選擇為起點、←/→ + ESC + 點空白關 + 手機滑動)。
//   lightbox 沿用 .pd-lightbox/.pd-lb-* CSS(與圖庫共用 chrome、不另寫)。
// - value 文字由 caller(ProductInfo)算好傳入(反映實際選擇、如「Kevlar斜紋 · 亮光」),
//   非從 fallback 樣品名推(避免 Kevlar 顯成斜紋字面);is-rare 金字由樣品 rare 決定。
// - 無 selectedVariant(非變體 mock 商品)→ 不渲染。
//
// 'use client' 必要:useState / useEffect + onClick / onTouch。

'use client';

import { useEffect, useRef, useState } from 'react';
import type { UIVariant } from '@/data/mock-products';
import { RPM_SWATCHES, findSwatch } from '@/data/rpm-swatches';

export type ProductSwatchPreviewProps = {
  selectedVariant: UIVariant | null;
  /** 反映實際選擇的「紋路 · 表面」文字(由 ProductInfo 算、如「12K斜紋 · 亮光」)*/
  valueText: string;
};

export function ProductSwatchPreview({ selectedVariant, valueText }: ProductSwatchPreviewProps) {
  const [lbIdx, setLbIdx] = useState<number | null>(null);
  const lbSwipeXRef = useRef(0);

  const open = lbIdx !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLbIdx(null);
      else if (e.key === 'ArrowRight') setLbIdx((i) => (i === null ? i : Math.min(RPM_SWATCHES.length - 1, i + 1)));
      else if (e.key === 'ArrowLeft') setLbIdx((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!selectedVariant) return null;
  const swatch = findSwatch(selectedVariant.spec);

  const openLightbox = () => {
    const idx = RPM_SWATCHES.indexOf(swatch);
    setLbIdx(idx < 0 ? 0 : idx);
  };

  const lbSwatch = lbIdx !== null ? RPM_SWATCHES[lbIdx] : null;

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

      {lbSwatch && (
        <div className="pd-lightbox" onClick={() => setLbIdx(null)} role="dialog" aria-label="紋路樣品放大檢視">
          <button
            className="pd-lb-close"
            onClick={(e) => { e.stopPropagation(); setLbIdx(null); }}
            aria-label="關閉"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div
            className="pd-lb-stage"
            onTouchStart={(e) => { lbSwipeXRef.current = e.touches[0]!.clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0]!.clientX - lbSwipeXRef.current;
              if (Math.abs(dx) > 40 && lbIdx !== null) {
                if (dx < 0) setLbIdx(Math.min(RPM_SWATCHES.length - 1, lbIdx + 1));
                else setLbIdx(Math.max(0, lbIdx - 1));
              }
            }}
          >
            <img src={lbSwatch.img} alt={lbSwatch.alt} onClick={() => setLbIdx(null)} style={{ cursor: 'zoom-out' }} />
          </div>
          <div className="pd-lb-caption">
            {lbSwatch.name} · {lbSwatch.meta}
          </div>
          <button
            className="pd-lb-arrow pd-lb-arrow-left"
            onClick={(e) => { e.stopPropagation(); setLbIdx(Math.max(0, (lbIdx ?? 0) - 1)); }}
            disabled={lbIdx === 0}
            aria-label="上一張"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button
            className="pd-lb-arrow pd-lb-arrow-right"
            onClick={(e) => { e.stopPropagation(); setLbIdx(Math.min(RPM_SWATCHES.length - 1, (lbIdx ?? 0) + 1)); }}
            disabled={lbIdx === RPM_SWATCHES.length - 1}
            aria-label="下一張"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 18 6-6-6-6" /></svg>
          </button>
          <div className="pd-lb-counter">
            {String((lbIdx ?? 0) + 1).padStart(2, '0')} / {String(RPM_SWATCHES.length).padStart(2, '0')}
          </div>
        </div>
      )}
    </>
  );
}
