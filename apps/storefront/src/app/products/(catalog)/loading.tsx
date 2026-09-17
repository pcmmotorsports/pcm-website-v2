// /products route loading fallback。
// design-reference 未定義資料等待態；依 Sean 選定的 C 方向，保留既有型錄外殼，
// 讓導航一開始就有可辨識的「全部商品」語境與骨架，而非停在前一頁。

import { Header } from '@/components/Header';

const SKELETON_CARD_COUNT = 8;

export default function ProductsLoading() {
  return (
    <>
      <Header currentPage="catalog" />
      <div className="pp-loading-progress" aria-hidden="true">
        <span />
      </div>
      <div className="pp-loading-filterbar" aria-hidden="true">
        <span className="pp-loading-line pp-loading-filterline" />
        <span className="pp-loading-line pp-loading-filterline" />
        <span className="pp-loading-line pp-loading-filterline pp-loading-filterline-wide" />
      </div>
      <div className="pp-layout has-side pp-loading" role="status" aria-label="正在載入商品目錄" aria-busy="true">
        <aside className="pp-loading-side" aria-hidden="true">
          <span className="pp-loading-line pp-loading-side-title" />
          <span className="pp-loading-line" />
          <span className="pp-loading-line pp-loading-side-short" />
          <span className="pp-loading-line" />
          <span className="pp-loading-line pp-loading-side-short" />
        </aside>
        <main className="pp-main">
          <div className="pp-head">
            <div className="pp-head-row">
              <h1 className="pp-title">全部商品</h1>
              <nav className="pp-breadcrumb" aria-label="麵包屑導航">
                <span>首頁</span>
                <span>›</span>
                <span>商品目錄</span>
              </nav>
            </div>
          </div>
          <div className="pp-sortbar" aria-hidden="true">
            <span className="pp-loading-line pp-loading-count" />
            <span className="pp-loading-line pp-loading-sort" />
          </div>
          <div className="pp-grid pp-loading-grid" aria-hidden="true">
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <article className="pp-loading-card" data-testid="catalog-loading-card" key={index}>
                <span className="pp-loading-image" />
                <span className="pp-loading-line pp-loading-brand" />
                <span className="pp-loading-line pp-loading-name" />
                <span className="pp-loading-line pp-loading-fitment" />
                <span className="pp-loading-line pp-loading-price" />
              </article>
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
