// HomeSelect.tsx — 字面從 design-reference/components/HomePage.jsx @ 25d3a2a 直接搬(M-1-04-mini-slice 修:25d3a2a L210 加 ProductCard tier prop、storefront 走 server-side tier 預算 tierLabel conceptually equivalent)
// (N°04 · The Selection · 編輯精選、4 ProductCard、main-d 真資料接入點)
//
// d1 階段:用 MOCK_PRODUCTS.slice(0, 4) 對齊 design 字面 window.PCM_DATA.products.slice(0, 4)
// d2 階段:props.featured 真資料(server-side fetch from SupabaseProductAdapter.listByCategory('操控部品'))
//          MOCK_PRODUCTS import 移除、empty / error UI 字面 Sean 2026-05-09 拍板新增
//
// 'use client' 因 ProductCard 是 client component + 傳 onClick callback、server-client boundary 需 client
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FeaturedResult } from '@/lib/products';
import { ProductCard } from './ProductCard';

export type HomeSelectProps = {
  featured: FeaturedResult;
};

export function HomeSelect({ featured }: HomeSelectProps) {
  const router = useRouter();

  // d1 階段 tweaks default(對齊 design HomePage tweaks panel default)、d2 / 後續 slice tweaks panel 落地時 hoist
  const tweaks = { showRedPrice: false, badgeStyle: 'minimal' as const };

  // 三條 UI 分支(對齊 Sean 2026-05-09 d2 拍板 Q-empty=b / Q-error=b):
  //   - error → 「載入失敗、請稍後再試」
  //   - empty(error=false 且 products.length===0)→ 「目前沒有商品」
  //   - 正常 → render 4 個 ProductCard
  // empty / error 字面 design-reference 無對應、本 slice 新增、字面源 Sean 拍板。
  // 視覺用 inline style + className `ed-select-empty` hook(未來 design 可加 CSS 規則對齊)、
  // 不修 design 真權威 styles/home.css(對齊 lessons §1.1「直接搬」+ d2 範圍紀律)
  const isError = featured.error;
  const isEmpty = !isError && featured.products.length === 0;

  return (
    <section className="ed-select">
      <div className="ed-section-head">
        <div className="ed-section-label">
          <span className="ed-mono">N°04</span>
          <span>The Selection · 編輯精選</span>
        </div>
        <Link href="/products?filter=new" className="ed-link ed-link-sm">
          <span>查看所有新品</span>
          <span className="ed-link-arrow">→</span>
        </Link>
      </div>
      {isError ? (
        <div
          className="ed-select-empty"
          style={{
            padding: '60px 0',
            textAlign: 'center',
            color: 'var(--c-text-3)',
            fontSize: '13px',
            letterSpacing: '0.04em',
          }}
        >
          載入失敗、請稍後再試
        </div>
      ) : isEmpty ? (
        <div
          className="ed-select-empty"
          style={{
            padding: '60px 0',
            textAlign: 'center',
            color: 'var(--c-text-3)',
            fontSize: '13px',
            letterSpacing: '0.04em',
          }}
        >
          目前沒有商品
        </div>
      ) : (
        <div className="ed-select-grid">
          {featured.products.map(p => (
            <ProductCard
              key={p.id}
              p={p}
              showRedPrice={tweaks.showRedPrice}
              badgeStyle={tweaks.badgeStyle}
              onClick={() => router.push('/products/' + p.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
