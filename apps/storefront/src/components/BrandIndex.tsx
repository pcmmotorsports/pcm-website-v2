// BrandIndex.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°06 · Authorized brands · 16 品牌 type-only wall、本刀 1b2 後位置 14 加 RIZOMA、共 17)
//
// design 用 window.PCM_DATA.brands → 改 import { MOCK_BRANDS }
//
// M-1-04 刀 1b2:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔):'brands' → /brands / 'brand-detail'+brandId → /brands/${b.id}(brands.map dynamic)
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示

import Link from 'next/link';
import { MOCK_BRANDS } from '@/data/mock-brands';

export function BrandIndex() {
  const brands = MOCK_BRANDS;

  return (
    <section className="ed-brands">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°06</span>
          <span>Authorized brands · 授權代理</span>
        </div>
        <Link href="/brands" className="ed-link ed-link-sm">
          <span>品牌專區</span>
          <span className="ed-link-arrow">→</span>
        </Link>
      </div>
      <ul className="ed-brand-list">
        {brands.map((b, i) => (
          <li key={b.id}>
            <Link href={`/brands/${b.id}`}>
              <span className="ed-brand-num ed-mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="ed-brand-name">{b.name}</span>
              <span className="ed-brand-tag">{b.tagline}</span>
              <span className="ed-brand-country ed-mono">{b.country?.toUpperCase()}</span>
              <span className="ed-brand-arrow">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
