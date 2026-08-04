// app/dev-preview/brand-page/[slug]/page.tsx — 品牌介紹頁版型預覽(D2b;2026-08-04)
//
// 🔴 **臨時驗證頁,不是正式路由。** 正式的 /brands/[slug] 由 D3 建。
//    存在理由:D2b-D2e 是逐片長出來的版型,沒有一個能開的網址就只能靠單元測試
//    ——而版面的問題(裁切焦點跑掉、幕壓不住字、窄螢幕變全黑)單元測試看不見。
//    dev-preview/* 整族本來就掛 backlog #147「M-6 前移除」,D8 一併帶走。
//
// 目前掛到 D2d-1(麵包屑 / 橫幅 / 事實列 / About + 右欄影片或產品照 / Why);D2d-2 起各自往下接。

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BRAND_BY_SLUG, BRAND_CONTENT } from '@/data/brand-content';
import { BrandPageHeader } from '@/components/brand/BrandPageHeader';
import { BrandPageAbout } from '@/components/brand/BrandPageAbout';
import { BrandPageWhy } from '@/components/brand/BrandPageWhy';

export const metadata = { robots: { index: false } };

export function generateStaticParams() {
  return BRAND_CONTENT.map((brand) => ({ slug: brand.slug }));
}

export default async function BrandPagePreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Object.hasOwn:擋 constructor/__proto__ 等原型鏈 key(對齊 dev-preview/brands/[slug] 既有慣例)
  if (!Object.hasOwn(BRAND_BY_SLUG, slug)) notFound();
  const brand = BRAND_BY_SLUG[slug]!;

  return (
    <div className="bp-page">
      <BrandPageHeader brand={brand} />
      <BrandPageAbout brand={brand} />
      <BrandPageWhy brand={brand} />
      <nav style={{ padding: '24px 40px', fontFamily: 'var(--f-mono)', fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--c-text-3)' }}>預覽切換:</span>
        {BRAND_CONTENT.map((b) => (
          <Link
            key={b.slug}
            href={`/dev-preview/brand-page/${b.slug}`}
            style={{ color: b.slug === slug ? 'var(--c-ember-ink)' : 'var(--c-text-3)' }}
          >
            {b.slug}
          </Link>
        ))}
      </nav>
    </div>
  );
}
