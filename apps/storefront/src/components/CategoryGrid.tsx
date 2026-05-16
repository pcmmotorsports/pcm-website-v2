// CategoryGrid.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬
// (N°03 · Categories · 部品分類、8 cats hardcoded、view all 11 類)
//
// M-1-04 刀 1b2:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔):'catalog' → /products / 'products'+category → /products?category=${c.id}(8 cats map dynamic)
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示

import Link from 'next/link';

export function CategoryGrid() {
  const cats = [
    { id: 'exhaust', name: '排氣管', en: 'Exhaust', count: 58, img: 'photo-1568772585407-9361f9bf3a87' },
    { id: 'brake', name: '煞車系統', en: 'Brake', count: 42, img: 'photo-1580310614729-ccd69652491d' },
    { id: 'suspension', name: '懸吊', en: 'Suspension', count: 31, img: 'photo-1558981285-6f0c94958bb6' },
    { id: 'control', name: '操控部品', en: 'Control', count: 84, img: 'photo-1568772585407-9361f9bf3a87' },
    { id: 'body', name: '車身套件', en: 'Bodywork', count: 67, img: 'photo-1558981806-ec527fa84c39' },
    { id: 'electronic', name: '電子改裝', en: 'Electronics', count: 29, img: 'photo-1609630875171-b1321377ee65' },
    { id: 'protection', name: '防護零件', en: 'Protection', count: 48, img: 'photo-1558981001-792f6c0d5068' },
    { id: 'carbon', name: '碳纖部品', en: 'Carbon', count: 52, img: 'photo-1558981403-c5f9899a28bc' },
  ];

  return (
    <section className="ed-cats">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°03</span>
          <span>Categories · 部品分類</span>
        </div>
        <Link href="/products" className="ed-link ed-link-sm">
          <span>查看全部 11 類</span>
          <span className="ed-link-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="ed-cat-grid">
        {cats.map((c) => (
          <Link key={c.id} href={`/products?category=${c.id}`} className="ed-cat">
            <div className="ed-cat-media">
              <img src={`https://images.unsplash.com/${c.img}?w=700&q=75&auto=format&fit=crop`} alt=""/>
            </div>
            <div className="ed-cat-foot">
              <div className="ed-cat-name">
                <span>{c.name}</span>
                <span className="ed-cat-count ed-mono">{String(c.count).padStart(3, '0')}</span>
              </div>
              <div className="ed-mono ed-cat-en">{c.en}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
