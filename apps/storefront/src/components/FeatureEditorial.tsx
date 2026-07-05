// FeatureEditorial.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°02 · This month · RIZOMA · 工藝之鏡)
//
// M-1-04 刀 1b1:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 1 條):'brand-detail' + brandId='rizoma'(硬寫死) → /products?brand=rizoma
// 🔴 Q4-S5(2026-07-05):原 /brands/rizoma 路由不存在=404 → 改導 /products?brand=rizoma(RIZOMA 現無商品→
//   fail-safe 顯全部、不 404;品牌專屬頁留 Phase 2)。anchor:RIZOMA 在 MOCK_BRANDS(mock-brands.ts:33)
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示

import Link from 'next/link';

export function FeatureEditorial() {
  return (
    <section className="ed-feature">
      <div className="ed-feature-inner">
        <aside className="ed-feature-side">
          <div className="ed-feature-num ed-mono">N°02</div>
          <div className="ed-feature-kicker">This month · 本月聚焦</div>
          <h2 className="ed-feature-title">
            RIZOMA.
            <br /><em>工藝之鏡</em>
          </h2>
          <p className="ed-feature-body">
            自米蘭的金屬實驗室,三十年如一日。
            <br />
            RIZOMA 以鏡面後視鏡、CNC 削切的剎車把手,
            <br />
            重新定義了重車配件的工藝高度。
          </p>
          <div className="ed-feature-meta">
            <div>
              <div className="ed-mono ed-feature-meta-k">ORIGIN</div>
              <div className="ed-feature-meta-v">Milano, Italy</div>
            </div>
            <div>
              <div className="ed-mono ed-feature-meta-k">SINCE</div>
              <div className="ed-feature-meta-v">2000</div>
            </div>
            <div>
              <div className="ed-mono ed-feature-meta-k">CRAFT</div>
              <div className="ed-feature-meta-v">CNC · Anodized</div>
            </div>
          </div>
          <Link href="/products?brand=rizoma" className="ed-link ed-link-dark">
            <span>探索 RIZOMA</span>
            <span className="ed-link-arrow" aria-hidden="true">→</span>
          </Link>
        </aside>
        <div className="ed-feature-media">
          <img src="https://images.unsplash.com/photo-1558981852-426c6c22a060?w=1600&q=85&auto=format&fit=crop" alt="RIZOMA"/>
          <div className="ed-feature-caption">
            <span className="ed-mono">Fig. 01</span>
            <span>RIZOMA Stealth 後視鏡 · 鋁合金 CNC 削切</span>
          </div>
        </div>
      </div>
    </section>
  );
}
