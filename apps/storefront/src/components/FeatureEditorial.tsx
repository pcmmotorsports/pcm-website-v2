// FeatureEditorial.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°02 · This month · RIZOMA · 工藝之鏡)
'use client';

import { useCallback, type MouseEvent } from 'react';

export function FeatureEditorial() {
  const onNav = useCallback((target: string, ctx?: object) => {
    console.log('[onNav]', target, ctx);
  }, []);

  const handle = (e: MouseEvent, target: string, ctx?: object) => {
    e.preventDefault();
    onNav(target, ctx);
  };

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
          <a href="#" onClick={(e) => handle(e, 'brand-detail', { brandId: 'rizoma' })} className="ed-link ed-link-dark">
            <span>探索 RIZOMA</span>
            <span className="ed-link-arrow">→</span>
          </a>
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
