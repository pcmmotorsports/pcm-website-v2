// BrandIndex.tsx — 字面從 design-reference/components/HomePage.jsx @ d5ea3aa 直接搬
// (N°06 · Authorized brands · 16 品牌 type-only wall)
//
// design 用 window.PCM_DATA.brands → 改 import { MOCK_BRANDS }
'use client';

import { useCallback, type MouseEvent } from 'react';
import { MOCK_BRANDS } from '@/data/mock-brands';

export function BrandIndex() {
  const brands = MOCK_BRANDS;

  const onNav = useCallback((target: string, ctx?: object) => {
    console.log('[onNav]', target, ctx);
  }, []);

  const handle = (e: MouseEvent, target: string, ctx?: object) => {
    e.preventDefault();
    onNav(target, ctx);
  };

  return (
    <section className="ed-brands">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°06</span>
          <span>Authorized brands · 授權代理</span>
        </div>
        <a href="#" onClick={(e) => handle(e, 'brands')} className="ed-link ed-link-sm">
          <span>品牌專區</span>
          <span className="ed-link-arrow">→</span>
        </a>
      </div>
      <ul className="ed-brand-list">
        {brands.map((b, i) => (
          <li key={b.id}>
            <a href="#" onClick={(e) => handle(e, 'brand-detail', { brandId: b.id })}>
              <span className="ed-brand-num ed-mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="ed-brand-name">{b.name}</span>
              <span className="ed-brand-tag">{b.tagline}</span>
              <span className="ed-brand-country ed-mono">{b.country?.toUpperCase()}</span>
              <span className="ed-brand-arrow">→</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
