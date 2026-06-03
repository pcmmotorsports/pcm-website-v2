// SwatchLightbox.tsx — 紋路樣品放大檢視 lightbox(共用元件)
//
// Fix B(Sean 2026-06-03 :3001 驗:頁內所有圖片都要可點擊放大)。原 OD-7c lightbox 只在 picker
// 預覽卡 ProductSwatchPreview 內;本片抽成共用元件,N°02 紋路牆 ProductSwatchWall 卡片也接,
// 點圖開、瀏覽全部樣品(←/→ + ESC + 點空白關 + 手機滑)。沿用 .pd-lightbox/.pd-lb-* chrome
// (與商品圖庫共用 chrome、不另寫 CSS)。
//
// 狀態(lbIdx / setLbIdx)由 caller 持有,本元件只負責渲染 + 鍵盤/捲動鎖;lbIdx===null → 不渲染。
// 'use client' 必要:useEffect + onClick / onTouch。

'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { RpmSwatch } from '@/data/rpm-swatches';

export type SwatchLightboxProps = {
  swatches: readonly RpmSwatch[];
  lbIdx: number | null;
  setLbIdx: Dispatch<SetStateAction<number | null>>;
};

export function SwatchLightbox({ swatches, lbIdx, setLbIdx }: SwatchLightboxProps) {
  const lbSwipeXRef = useRef(0);
  const open = lbIdx !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLbIdx(null);
      else if (e.key === 'ArrowRight') setLbIdx((i) => (i === null ? i : Math.min(swatches.length - 1, i + 1)));
      else if (e.key === 'ArrowLeft') setLbIdx((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, swatches.length, setLbIdx]);

  if (lbIdx === null) return null;
  const sw = swatches[lbIdx];
  if (!sw) return null;

  return (
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
          if (Math.abs(dx) > 40) {
            if (dx < 0) setLbIdx(Math.min(swatches.length - 1, lbIdx + 1));
            else setLbIdx(Math.max(0, lbIdx - 1));
          }
        }}
      >
        <img src={sw.img} alt={sw.alt} onClick={() => setLbIdx(null)} style={{ cursor: 'zoom-out' }} />
      </div>
      <div className="pd-lb-caption">
        {sw.name} · {sw.meta}
      </div>
      <button
        className="pd-lb-arrow pd-lb-arrow-left"
        onClick={(e) => { e.stopPropagation(); setLbIdx(Math.max(0, lbIdx - 1)); }}
        disabled={lbIdx === 0}
        aria-label="上一張"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <button
        className="pd-lb-arrow pd-lb-arrow-right"
        onClick={(e) => { e.stopPropagation(); setLbIdx(Math.min(swatches.length - 1, lbIdx + 1)); }}
        disabled={lbIdx === swatches.length - 1}
        aria-label="下一張"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <div className="pd-lb-counter">
        {String(lbIdx + 1).padStart(2, '0')} / {String(swatches.length).padStart(2, '0')}
      </div>
    </div>
  );
}
