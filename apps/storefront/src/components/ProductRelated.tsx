'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductCard } from './ProductCard';
import type { MockProduct } from '@/data/mock-products';

/**
 * N°03 相關商品區(R3、自 ProductPage 抽出——鐵則 6:ProductPage 破 400 行必拆,
 * 對齊 #270 B S3 抽 BrandShowcase 同精神)。
 *
 * 內容由 server 端推薦引擎(RuleBasedRecommendationEngine)供給、經 toUIProduct('general') strip;
 * 本元件呈現:橫向 scroll-snap carousel + 情境化標題(L1)+ hasMore「查看全部」CTA。
 *
 * - 標題 / CTA 文案(L1、plan §5、codex R3 F2):有選車=「這台車也適用」/「查看全部相容商品」,
 *   無車=「同款推薦」/「查看全部同款商品」。
 * - 🔴 紅色左右導覽箭頭(Sean 2026-07-08:客人不知可左右滑 → 加紅箭頭提示):可捲動才顯、放標題右上、
 *   next 初次微動提示、捲到邊界該側 disabled;點擊平滑捲動。
 * - vehicleParam:有值時卡片連結帶 ?vehicle=、延續車輛 context(Q2=A)。
 * - related 空 → 整區隱藏(不顯空卡)。
 */
export type ProductRelatedProps = {
  related: MockProduct[];
  hasMore: boolean;
  moreHref?: string;
  hasVehicle: boolean;
  /** 選定車輛的 URL 短版 slug;有值時相關商品卡片連結帶 `?vehicle=`、延續 Case A context(Q2=A)。 */
  vehicleParam?: string;
};

export function ProductRelated({ related, hasMore, moreHref, hasVehicle, vehicleParam }: ProductRelatedProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= max - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const onResize = () => updateEdges();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateEdges, related]);

  if (related.length === 0) return null;

  const title = hasVehicle ? '這台車也適用' : '同款推薦';
  const moreLabel = hasVehicle ? '查看全部相容商品' : '查看全部同款商品';
  const cardHref = (slug: string): string =>
    vehicleParam ? `/products/${slug}?vehicle=${encodeURIComponent(vehicleParam)}` : `/products/${slug}`;
  const scrollByDir = (dir: 1 | -1): void => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  const scrollable = !atStart || !atEnd; // 內容超出容器才可捲動 → 才顯箭頭提示

  return (
    <section className="pd-section pd-related" aria-labelledby="pd-h-related">
      <div className="pd-section-head">
        <div>
          <div className="pd-eyebrow">
            <span className="pd-eb-no">03</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  相關商品'}</span>
          </div>
          <h2 className="pd-h2" id="pd-h-related">
            {title}
          </h2>
        </div>
        {scrollable && (
          <div className="pd-related-nav" aria-hidden="true">
            <button
              type="button"
              className="pd-related-nav-btn pd-related-nav-btn-prev"
              onClick={() => scrollByDir(-1)}
              disabled={atStart}
              aria-label="看前面的商品"
              tabIndex={-1}
            >
              <span className="pd-related-nav-chevron" />
            </button>
            <button
              type="button"
              className="pd-related-nav-btn pd-related-nav-btn-next"
              onClick={() => scrollByDir(1)}
              disabled={atEnd}
              aria-label="看更多商品"
              tabIndex={-1}
            >
              <span className="pd-related-nav-chevron" />
            </button>
          </div>
        )}
      </div>
      {/* 橫向 scroll-snap carousel(plan §5、Baymard/NN-g:不自動輪播、半露暗示可滑、≤8);
          .pd-related-grid class 由 grid 改 flex carousel、卡片沿用 <ProductCard>。 */}
      <div className="pd-related-grid" ref={scrollerRef} onScroll={updateEdges}>
        {related.map((p) => (
          <ProductCard key={p.slug} p={p} href={cardHref(p.slug)} />
        ))}
      </div>
      {hasMore && moreHref && (
        <div className="pd-related-more">
          <Link href={moreHref} className="pd-related-more-link">
            {moreLabel}
          </Link>
        </div>
      )}
    </section>
  );
}
