import Link from 'next/link';
import { ProductCard } from './ProductCard';
import type { MockProduct } from '@/data/mock-products';

/**
 * N°03 相關商品區(R3、自 ProductPage 抽出——鐵則 6:ProductPage 破 400 行必拆,
 * 對齊 #270 B S3 抽 BrandShowcase 同精神)。
 *
 * 內容由 server 端推薦引擎(RuleBasedRecommendationEngine)供給、經 toUIProduct('general') strip;
 * 本元件純呈現:橫向 scroll-snap carousel + 情境化標題(L1)+ hasMore「查看全部」CTA。
 *
 * - 標題 / CTA 文案(L1、plan §5、codex R3 F2):有選車=「這台車也適用」/「查看全部相容商品」,
 *   無車=「同款推薦」/「查看全部同款商品」。
 * - hasMore = 主池(CTA 目標 filter)去重排自身後 > limit(引擎回傳、codex R3 F1);false → 不顯 CTA。
 * - related 空 → 整區隱藏(不顯空卡)。
 */
export type ProductRelatedProps = {
  related: MockProduct[];
  hasMore: boolean;
  moreHref?: string;
  hasVehicle: boolean;
  /**
   * 選定車輛的 URL 短版 slug(brandId:modelId[:year]);有值時相關商品卡片連結帶 `?vehicle=`,
   * 讓「這台車也適用」的車輛 context 在 PDP→相關商品→下一個 PDP 的點擊鏈中延續(Q2=A vehicle producer)。
   */
  vehicleParam?: string;
};

export function ProductRelated({ related, hasMore, moreHref, hasVehicle, vehicleParam }: ProductRelatedProps) {
  if (related.length === 0) return null;

  const title = hasVehicle ? '這台車也適用' : '同款推薦';
  const moreLabel = hasVehicle ? '查看全部相容商品' : '查看全部同款商品';
  const cardHref = (slug: string): string =>
    vehicleParam ? `/products/${slug}?vehicle=${encodeURIComponent(vehicleParam)}` : `/products/${slug}`;

  return (
    <section className="pd-section pd-related" aria-labelledby="pd-h-related">
      <div className="pd-section-head">
        <div className="pd-eyebrow">
          <span className="pd-eb-no">03</span>
          <span className="pd-eb-sep" aria-hidden="true" />
          <span className="pd-eb-label">{'N°  相關商品'}</span>
        </div>
        <h2 className="pd-h2" id="pd-h-related">
          {title}
        </h2>
      </div>
      {/* 橫向 scroll-snap carousel(plan §5、Baymard/NN-g:不自動輪播、半露暗示可滑、≤8);
          .pd-related-grid class 由 grid 改 flex carousel、卡片沿用 <ProductCard>。 */}
      <div className="pd-related-grid">
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
