// HomeHero.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬(N°01 SPRING EDITORIAL)
'use client';

import { useCallback, type MouseEvent } from 'react';

export function HomeHero() {
  const onNav = useCallback((target: string, ctx?: object) => {
    // d1 階段 stub、M-1-04 加 next/navigation 後改 router.push
    console.log('[onNav]', target, ctx);
  }, []);

  const handle = (e: MouseEvent, target: string, ctx?: object) => {
    e.preventDefault();
    onNav(target, ctx);
  };

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
          <a href="#" onClick={(e) => handle(e, 'new')} className="ed-link">
            <span>Discover the collection</span>
            <span className="ed-link-arrow">→</span>
          </a>
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
