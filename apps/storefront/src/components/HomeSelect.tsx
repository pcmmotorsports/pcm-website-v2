// HomeSelect.tsx — 字面從 design-reference/components/HomePage.jsx @ d5ea3aa 直接搬
// (N°04 · The Selection · 編輯精選、4 ProductCard、main-d 真資料接入點)
//
// d1 階段:用 MOCK_PRODUCTS.slice(0, 4) 對齊 design 字面 window.PCM_DATA.products.slice(0, 4)
// d2 階段:接 SupabaseProductAdapter(後續 slice、PRD 字面 listByCategory / featured 邏輯待拍板)
//
// 'use client' 因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client
'use client';

import { useCallback, type MouseEvent } from 'react';
import { MOCK_PRODUCTS } from '@/data/mock-products';
import { ProductCard } from './ProductCard';

export function HomeSelect() {
  const featured = MOCK_PRODUCTS.slice(0, 4);
  // d1 階段 tweaks default(對齊 design HomePage tweaks panel default)、d2 / 後續 slice tweaks panel 落地時 hoist
  const tweaks = { showRedPrice: false, badgeStyle: 'minimal' as const };

  const onNav = useCallback((target: string, ctx?: object) => {
    console.log('[onNav]', target, ctx);
  }, []);

  const handle = (e: MouseEvent, target: string, ctx?: object) => {
    e.preventDefault();
    onNav(target, ctx);
  };

  return (
    <section className="ed-select">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°04</span>
          <span>The Selection · 編輯精選</span>
        </div>
        <a href="#" onClick={(e) => handle(e, 'new')} className="ed-link ed-link-sm">
          <span>查看所有新品</span>
          <span className="ed-link-arrow">→</span>
        </a>
      </div>
      <div className="ed-select-grid">
        {featured.map(p => (
          <ProductCard
            key={p.id}
            p={p}
            showRedPrice={tweaks.showRedPrice}
            badgeStyle={tweaks.badgeStyle}
            onClick={() => onNav('product', { productId: p.id, source: 'home', sourceLabel: '首頁' })}
          />
        ))}
      </div>
    </section>
  );
}
