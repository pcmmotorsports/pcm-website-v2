'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ProductCard } from './ProductCard';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import type { VehicleIntent } from '@/lib/vehicle-intent';

/**
 * 客人在這一頁當下的車款意圖(`ProductPage` 提供)。
 * 推薦區改成伺服器串流進來(計畫-商品頁推薦查詢逾時 §4 甲)之後, 它不再是 `ProductPage` 直接畫的子元件,
 * 所以「清車 / 換車後連結跟著變」改由這裡讀。`null` = 意圖還沒接手, 用伺服器算的那一份。
 */
export const PdpVehicleIntentContext = createContext<VehicleIntent | null>(null);

const neverChanges = () => () => {};

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
  related: CatalogCardProduct[];
  hasMore: boolean;
  moreHref?: string;
  hasVehicle: boolean;
  /** 選定車輛的 URL 短版 slug;有值時相關商品卡片連結帶 `?vehicle=`、延續 Case A context(Q2=A)。 */
  vehicleParam?: string;
};

export function ProductRelated({
  related,
  hasMore,
  moreHref: serverMoreHref,
  hasVehicle,
  vehicleParam: serverVehicleParam,
}: ProductRelatedProps) {
  // 🔴 串流進來的這一段比 ProductPage 晚 hydrate ⇒ 那時意圖多半已經接手了(客人上次選的車)。
  //   hydrate 當下若直接用意圖, 卡片連結會跟伺服器 HTML 不同 ⇒ React 警告而且不修正(2026-09-28 本機實測)。
  //   ⇒ hydrate 那一輪用伺服器那一份(server snapshot = false), 下一輪才換成意圖。
  const hydrated = useSyncExternalStore(neverChanges, () => true, () => false);
  const intentFromPage = useContext(PdpVehicleIntentContext);
  const vehicleIntent = hydrated ? intentFromPage : null;
  // 以下兩個算法從 ProductPage 原封搬過來(§4 甲-2)。
  const moreHref =
    // 意圖已接手而沒有車 ⇒ 不能退回伺服器算的那一份(它還帶著剛清掉的車;Fable 片 9+10 R1 必修 2)
    vehicleIntent?.kind === 'vehicle'
      ? `/products?vehicle=${encodeURIComponent(vehicleIntent.segment)}`
      : // 🔵 只有「伺服器那份本來就帶車」才需要換掉(客人剛清車);本來就是品牌連結(Case B)要留著,
        //   否則「查看全部同款商品」會連到全站(Fable 片 9+10 R2 必修)。
        vehicleIntent && hasVehicle
        ? '/products'
        : serverMoreHref;
  // :901 §3-6 P4:相關商品卡片的車款讀意圖(server prop 只是還沒接手前的初值)
  const vehicleParam =
    vehicleIntent?.kind === 'vehicle' ? vehicleIntent.segment : vehicleIntent ? undefined : serverVehicleParam;
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

/** 推薦還在算的時候先佔位(§4 甲-7):設計稿沒畫載入狀態 ⇒ 沿用型錄骨架的閃爍條, 卡片寬度吃 `.pcard` 既有斷點。 */
export function ProductRelatedSkeleton() {
  return (
    <section className="pd-section pd-related" aria-busy="true" aria-label="正在載入相關商品" data-testid="pd-related-skeleton">
      <div className="pd-section-head">
        <div>
          <div className="pd-eyebrow">
            <span className="pd-eb-no">03</span>
            <span className="pd-eb-sep" aria-hidden="true" />
            <span className="pd-eb-label">{'N°  相關商品'}</span>
          </div>
          <span className="pp-loading-line pd-related-skel-title" aria-hidden="true" />
        </div>
      </div>
      <div className="pd-related-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="pcard pd-related-skel" key={i}>
            <span className="pp-loading-image" />
            <span className="pp-loading-line pp-loading-brand" />
            <span className="pp-loading-line pp-loading-name" />
            <span className="pp-loading-line pp-loading-price" />
          </div>
        ))}
      </div>
      {/* 「查看全部」多半會出現(車款池、品牌池通常超過 8 件)⇒ 先佔它的高度 */}
      <div className="pd-related-more" aria-hidden="true">
        <span className="pp-loading-line pd-related-skel-more" />
      </div>
    </section>
  );
}
