// HomeHero.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬(N°01 SPRING EDITORIAL)
//
// M-1-04 刀 1a:'use client' → server component + onNav stub → <Link href>(對齊 backlog #116 + recon §7 候選刀 2)
// onNav target 對映(本檔 1 條):'new' → /products?filter=new
// 'use client' 移除原因:此元件無 useState / useEffect / onClick / window. / hover、純展示

import Link from 'next/link';

export function HomeHero() {
  return (
    <section className="ed-hero">
      <div className="ed-hero-media">
        <img
          src="https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=2400&q=85&auto=format&fit=crop"
          alt="" />
        <div className="ed-hero-tint" />
      </div>
      <div className="ed-hero-inner">
        <div className="ed-hero-eyebrow">
          <span className="ed-hero-dot" />
          <span>2026 SPRING EDITORIAL</span>
        </div>
        <h1 className="ed-hero-title">
          <span>Made</span>
          <span>for those who</span>
          <span className="ed-hero-italic">ride&nbsp;differently.</span>
        </h1>
        <div className="ed-hero-foot">
          <Link href="/products?filter=new" className="ed-link">
            <span>Discover the collection</span>
            <span className="ed-link-arrow" aria-hidden="true">→</span>
          </Link>
          <div className="ed-hero-meta">
            <span className="ed-mono">N°01</span>
            <span>·</span>
            <span>PCM MOTORSPORTS</span>
          </div>
        </div>
      </div>
      <a href="#vehicle-finder" className="ed-hero-scroll" aria-label="scroll">
        <span>Scroll</span>
        <span className="ed-hero-scroll-line" />
      </a>
    </section>
  );
}
