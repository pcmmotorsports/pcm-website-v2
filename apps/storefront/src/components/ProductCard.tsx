// ProductCard.tsx — editorial · hover-swap images
// Each product has a small gallery (2-3 images). On hover, cross-fade to next image.
//
// 字面從 design-reference/components/ProductCard.jsx @ d5ea3aa 直接搬:
// - jsx → tsx + props type 推斷
// - React.useState / useMemo → import { useState, useMemo }
// - window.ProductCard / window.ProductImage UMD 註冊移除(改 ES export)
// - className 字面完全不動

'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { MockProduct } from '@/data/mock-products';

const PRODUCT_IMG_POOL = [
  'photo-1558981285-6f0c94958bb6', // brake caliper
  'photo-1568772585407-9361f9bf3a87', // motorcycle closeup
  'photo-1449426468159-d96dbf08f19f', // moto parts
  'photo-1558980664-10e7170b5df9', // exhaust pipe
  'photo-1611241443322-b5ba0b9c4f83', // carbon fiber
  'photo-1580310614729-ccd69652491d', // handlebars
  'photo-1517649763962-0c623066013b', // racing bike
  'photo-1609630875171-b1321377ee65', // moto accessories
  'photo-1558981806-ec527fa84c39', // moto riding
  'photo-1558981852-426c6c22a060', // helmet
  'photo-1558981403-c5f9899a28bc', // track day
  'photo-1591637333472-3e9e137b87d2', // brake disc
  'photo-1547996160-81dfa63595aa', // motorcycle wheel
  'photo-1449426468159-d96dbf08f19f', // parts detail
  'photo-1527136006912-44ea5baac0c6', // track racing
];

function productGallery(seed: number): string[] {
  // Stable deterministic selection of 3 images per product
  const n = PRODUCT_IMG_POOL.length;
  return [
    PRODUCT_IMG_POOL[seed % n] ?? '',
    PRODUCT_IMG_POOL[(seed * 7 + 3) % n] ?? '',
    PRODUCT_IMG_POOL[(seed * 13 + 5) % n] ?? '',
  ];
}

type Tone = 'cool' | 'neutral' | 'warm' | 'dark' | 'red' | 'gold';

type ProductImageProps = {
  tone?: Tone | string;
  label?: string;
  seed?: number;
  hover?: boolean;
};

export function ProductImage({ tone = 'neutral', label = 'PRODUCT', seed = 0, hover = false }: ProductImageProps) {
  const imgs = useMemo(() => productGallery(seed), [seed]);
  const [failedIdx, setFailedIdx] = useState<Record<number, boolean>>({});
  const palettes: Record<Tone, [string, string]> = {
    cool: ['#f1f3f5', '#e4e7ec'],
    neutral: ['#f4f4f5', '#e8e8e8'],
    warm: ['#f6f2ec', '#e8dfd0'],
    dark: ['#1e1e20', '#141416'],
    red: ['#fdf0ef', '#f5d8d4'],
    gold: ['#faf4e4', '#ede0b8'],
  };
  const [c1, c2] = palettes[tone as Tone] ?? palettes.neutral;
  return (
    <div className="pcard-gallery" style={{
      width: '100%', height: '100%', position: 'relative',
      background: `linear-gradient(145deg, ${c1} 0%, ${c2} 100%)`,
      overflow: 'hidden',
    }}>
      {imgs.map((id, i) => failedIdx[i] ? null : (
        <img
          key={i}
          src={`https://images.unsplash.com/${id}?w=600&q=80&auto=format&fit=crop`}
          alt={label}
          loading="lazy"
          onError={() => setFailedIdx(prev => ({ ...prev, [i]: true }))}
          className="pcard-gallery-img"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'cover',
            mixBlendMode: tone === 'dark' ? 'normal' : 'multiply',
            opacity: (hover ? (i === 1 ? 1 : 0) : (i === 0 ? 0.92 : 0)),
            transform: hover && i === 1 ? 'scale(1.04)' : 'scale(1)',
            transition: 'opacity 0.55s ease, transform 1.4s cubic-bezier(0.2,0.7,0.1,1)',
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

export type ProductCardProps = {
  p: MockProduct;
  showRedPrice?: boolean;
  badgeStyle?: 'minimal' | 'pill' | 'corner' | 'none';
  compact?: boolean;
  onClick?: () => void;
};

export function ProductCard({ p, showRedPrice, badgeStyle = 'minimal', compact = false, onClick }: ProductCardProps) {
  const [hover, setHover] = useState(false);
  const [liked, setLiked] = useState(false);
  const hasDiscount = p.origPrice !== null && p.origPrice > p.price;

  const badge: ReactNode = (() => {
    if (badgeStyle === 'none') return null;
    if (p.isNew) {
      if (badgeStyle === 'pill') return <div className="badge badge-pill badge-dark">NEW</div>;
      if (badgeStyle === 'corner') return <div className="badge badge-corner badge-dark">NEW</div>;
      return <div className="badge badge-min">新品</div>;
    }
    if (p.isSale) {
      if (badgeStyle === 'pill') return <div className="badge badge-pill badge-red">SALE</div>;
      if (badgeStyle === 'corner' && p.origPrice) return <div className="badge badge-corner badge-red">-{Math.round((1 - p.price / p.origPrice) * 100)}%</div>;
      return <div className="badge badge-min badge-min-red">特價</div>;
    }
    return null;
  })();

  return (
    <article
      className="pcard"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <div className="pcard-img-wrap">
        <ProductImage tone={p.imgTone} label={p.brand} seed={p.id} hover={hover} />
        {badge && <div className="pcard-badge">{badge}</div>}
        {!p.inStock && (
          <div className="pcard-oos">
            <span>補貨中</span>
          </div>
        )}
        <button
          className="pcard-heart"
          onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
          aria-label="收藏"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'var(--c-red)' : 'none'} stroke={liked ? 'var(--c-red)' : 'currentColor'} strokeWidth="1.6">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        {/* gallery dots (subtle indicator) */}
        <div className="pcard-dots" aria-hidden="true">
          <span className={`pcard-dot ${!hover ? 'is-active' : ''}`} />
          <span className={`pcard-dot ${hover ? 'is-active' : ''}`} />
        </div>
        {/* hover quick-add */}
        <div className={`pcard-quick ${hover ? 'is-visible' : ''}`}>
          <button className="pcard-quick-btn" onClick={(e) => e.stopPropagation()}>
            + 加入購物車
          </button>
        </div>
      </div>

      <div className="pcard-info">
        <div className="pcard-brand">{p.brand}</div>
        <div className="pcard-name">{p.name}</div>
        {!compact && <div className="pcard-fits">適用 {p.fits}</div>}
        <div className="pcard-price-row">
          {hasDiscount && p.origPrice !== null ? (
            <>
              <span className={`pcard-price ${showRedPrice ? 'is-red' : ''}`}>
                NT$ {p.price.toLocaleString()}
              </span>
              <span className="pcard-price-orig">NT$ {p.origPrice.toLocaleString()}</span>
            </>
          ) : (
            <span className={`pcard-price ${showRedPrice ? 'is-red' : ''}`}>
              NT$ {p.price.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
