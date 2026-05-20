// ProductGallery.tsx — 商品詳細頁圖片牆 + Lightbox 子元件(M-1-13c 拆檔 from ProductPage)
//
// 字面從 design-reference/components/ProductPage.jsx @ 25d3a2a 直接搬:
// - line 7-26 hooks(gallery useMemo / activeImg / lightbox / keyboard nav useEffect + body scroll lock)
// - line 140-141 derived(hasDiscount / discountPct)
// - line 189-265 gallery JSX(hero swipe + track + arrows + counter + thumb overlay + 2 badges)
// - line 547-590 lightbox JSX(close + lb-stage + lb-swipe + arrows + counter)
//
// 字面轉換:
// - window.__pdSwipeX/Y/T/DidSwipe + __lbSwipeX 全局 → 5 個 useRef(heroSwipeXRef / heroSwipeYRef / heroSwipeTRef / heroDidSwipeRef / lbSwipeXRef)
// - PRODUCT_IMG_POOL + productGallery inline(第 2 處、ProductCard.tsx line 17-41 第 1 處、第 3 處撞抽 backlog #155)
// - e.target → cast as Element 取 .closest()(TypeScript 嚴格)
// - product.origPrice! non-null assertion(hasDiscount guard 後安全)
//
// 'use client' 必要:useState / useEffect / useRef / useMemo + 互動 onClick / onTouch
// 對齊 ADR-0006 §1 白名單「Hooks → 'use client'」
//
// 拆檔原因:M-1-13c 落地後 ProductPage.tsx 累積達 366 行、超鐵則 6 「300 警戒 / 400 硬上限」;
// 立即拆 ProductGallery 對齊驗收條件「ProductPage.tsx 行數 < 300」、避免跨警戒。
//
// CSS 不拆:.pd-gallery / .pd-hero-* / .pd-thumb-* / .pd-lightbox / .pd-lb-* 等 selectors 留在
// apps/storefront/src/styles/product-page.css 內(ProductPage.tsx 已 import、本檔不額外 import)。

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MockProduct } from '@/data/mock-products';

// PRODUCT_IMG_POOL + productGallery 字面 inline 自 ProductCard.tsx 既有(M-1-04-mini-slice 搬入)、第 2 處撞;
// 第 3 處撞抽共用、backlog #155 追蹤(對齊 #130 Defer 模式)
const PRODUCT_IMG_POOL = [
  'photo-1558981285-6f0c94958bb6',
  'photo-1568772585407-9361f9bf3a87',
  'photo-1449426468159-d96dbf08f19f',
  'photo-1558980664-10e7170b5df9',
  'photo-1611241443322-b5ba0b9c4f83',
  'photo-1580310614729-ccd69652491d',
  'photo-1517649763962-0c623066013b',
  'photo-1609630875171-b1321377ee65',
  'photo-1558981806-ec527fa84c39',
  'photo-1558981852-426c6c22a060',
  'photo-1558981403-c5f9899a28bc',
  'photo-1591637333472-3e9e137b87d2',
  'photo-1547996160-81dfa63595aa',
  'photo-1449426468159-d96dbf08f19f',
  'photo-1527136006912-44ea5baac0c6',
];

function productGallery(seed: number): string[] {
  const n = PRODUCT_IMG_POOL.length;
  return [
    PRODUCT_IMG_POOL[seed % n] ?? '',
    PRODUCT_IMG_POOL[(seed * 7 + 3) % n] ?? '',
    PRODUCT_IMG_POOL[(seed * 13 + 5) % n] ?? '',
  ];
}

export type ProductGalleryProps = { product: MockProduct };

export function ProductGallery({ product }: ProductGalleryProps) {
  const gallery = useMemo(() => productGallery(product.id), [product.id]);
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const heroSwipeXRef = useRef(0);
  const heroSwipeYRef = useRef(0);
  const heroSwipeTRef = useRef(0);
  const heroDidSwipeRef = useRef(false);
  const lbSwipeXRef = useRef(0);

  // Sean Q-2=C 拍板偏離 design 字面:桌機 hero 不開 lightbox 也能 ←/→ 切圖
  // (原 design line 12-26 useEffect 條件 `if (!lightbox) return;`、lightbox-only;本實作改 always-on listener、
  //  ESC + scroll lock 仍 lightbox-only、PCM 業務 UX 擴張、commit body 揭示鐵則 11 字面 vs 事實偏離)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(false);
        return;
      }
      if (e.key === 'ArrowRight') setActiveImg((i) => Math.min(gallery.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setActiveImg((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    let prevOverflow: string | null = null;
    if (lightbox) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      if (prevOverflow !== null) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [lightbox, gallery.length]);

  const hasDiscount = product.origPrice != null && product.origPrice > product.price;
  const discountPct = hasDiscount ? Math.round((1 - product.price / product.origPrice!) * 100) : 0;

  return (
    <>
      <div className="pd-gallery">
        <div
          className="pd-hero-img"
          onTouchStart={(e) => {
            heroSwipeXRef.current = e.touches[0]!.clientX;
            heroSwipeYRef.current = e.touches[0]!.clientY;
            heroSwipeTRef.current = Date.now();
            heroDidSwipeRef.current = false;
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0]!.clientX - heroSwipeXRef.current;
            const dy = e.changedTouches[0]!.clientY - heroSwipeYRef.current;
            const dt = Date.now() - heroSwipeTRef.current;
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 280) {
              setLightbox(true);
              return;
            }
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
              if (dx < 0 && activeImg < gallery.length - 1) setActiveImg(activeImg + 1);
              else if (dx > 0 && activeImg > 0) setActiveImg(activeImg - 1);
              heroDidSwipeRef.current = true;
              try { e.preventDefault(); } catch { /* noop */ }
            }
          }}
          onClick={(e) => {
            const target = e.target as Element;
            if (target.closest('.pd-hero-arrow, .pd-hero-dot, .pd-thumb-overlay, .pd-hero-counter')) return;
            if (heroDidSwipeRef.current) { heroDidSwipeRef.current = false; return; }
            setLightbox(true);
          }}
        >
          <div className="pd-hero-track" style={{ transform: `translateX(-${activeImg * 100}%)` }}>
            {gallery.map((id, i) => (
              <div key={i} className="pd-hero-slide">
                <img src={`https://images.unsplash.com/${id}?w=1200&q=85&auto=format&fit=crop`} alt={product.name} />
              </div>
            ))}
          </div>
          <button
            className="pd-hero-arrow pd-hero-arrow-left"
            onClick={(e) => { e.stopPropagation(); setActiveImg(Math.max(0, activeImg - 1)); }}
            disabled={activeImg === 0}
            aria-label="上一張"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button
            className="pd-hero-arrow pd-hero-arrow-right"
            onClick={(e) => { e.stopPropagation(); setActiveImg(Math.min(gallery.length - 1, activeImg + 1)); }}
            disabled={activeImg === gallery.length - 1}
            aria-label="下一張"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <div className="pd-hero-counter">
            {String(activeImg + 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}
          </div>
          <div className="pd-thumb-overlay">
            {gallery.map((id, i) => (
              <button
                key={i}
                className={`pd-thumb-ov ${activeImg === i ? 'is-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setActiveImg(i); }}
                aria-label={`圖片 ${i + 1}`}
              >
                <img src={`https://images.unsplash.com/${id}?w=160&q=70&auto=format&fit=crop`} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          {product.isSale && <div className="pd-hero-badge">−{discountPct}%</div>}
          {product.isNew && !product.isSale && <div className="pd-hero-badge pd-hero-badge-new">NEW</div>}
        </div>
      </div>

      {lightbox && (
        <div className="pd-lightbox" onClick={() => setLightbox(false)} role="dialog" aria-label="放大檢視">
          <button
            className="pd-lb-close"
            onClick={(e) => { e.stopPropagation(); setLightbox(false); }}
            aria-label="關閉"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div
            className="pd-lb-stage"
            onTouchStart={(e) => { lbSwipeXRef.current = e.touches[0]!.clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0]!.clientX - lbSwipeXRef.current;
              if (Math.abs(dx) > 40) {
                if (dx < 0 && activeImg < gallery.length - 1) setActiveImg(activeImg + 1);
                else if (dx > 0 && activeImg > 0) setActiveImg(activeImg - 1);
              }
            }}
          >
            <img
              src={`https://images.unsplash.com/${gallery[activeImg]}?w=2000&q=90&auto=format&fit=contain`}
              alt={product.name}
              onClick={() => setLightbox(false)}
              style={{ cursor: 'zoom-out' }}
            />
          </div>
          {gallery.length > 1 && (
            <>
              <button
                className="pd-lb-arrow pd-lb-arrow-left"
                onClick={(e) => { e.stopPropagation(); setActiveImg(Math.max(0, activeImg - 1)); }}
                disabled={activeImg === 0}
                aria-label="上一張"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <button
                className="pd-lb-arrow pd-lb-arrow-right"
                onClick={(e) => { e.stopPropagation(); setActiveImg(Math.min(gallery.length - 1, activeImg + 1)); }}
                disabled={activeImg === gallery.length - 1}
                aria-label="下一張"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </>
          )}
          <div className="pd-lb-counter">
            {String(activeImg + 1).padStart(2, '0')} / {String(gallery.length).padStart(2, '0')}
          </div>
        </div>
      )}
    </>
  );
}
