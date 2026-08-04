// app/dev-preview/brand-page/[slug]/page.tsx — 品牌介紹頁版型預覽(D2b;2026-08-04)
//
// 🔴 **臨時驗證頁,不是正式路由。正式的 `/brands/[slug]` 已於 D3a 建好。**
//    原本的存在理由(「沒有一個能開的網址就只能靠單元測試」)自 D3a 起已消失。
//    現在只剩一個用途:**底部那排 20 家一鍵切換**,量六寬度時省掉手打網址。
//    ⇒ 版面本體改掛 `BrandPageRoot`(與正式 route 同一個組裝點,不會各自漂移);
//      本頁待 D8 隨 dev-preview/* 整族退場(backlog #147「M-6 前移除」)。
//
// ⚠️ 與正式 route 的兩處刻意差異:①不掛站台 `<Header>` / `<HomeFooter>`(裸頁,量版面用)
//    ②`robots.index=false`。⇒ **真瀏覽器驗收要在 `/brands/<slug>` 上做**,不是這裡
//    (backlog #314:D2b-D2f 全部量在這個沒有 Header 的裸頁上,首屏高度與 z-index 疊層是未量狀態)。
//
// ⚠️ 缺什麼一律以 `BrandPageRoot` 為準(D3b 已補上商品區;本頁與正式 route 共用同一個組裝點)。

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BRAND_BY_SLUG, BRAND_CONTENT } from '@/data/brand-content';
import { BrandPageRoot } from '@/components/brand/BrandPageRoot';
import { fetchBrandTopProducts, fetchBrandsWithProducts } from '@/lib/brand-products';

export const metadata = { robots: { index: false } };

export function generateStaticParams() {
  return BRAND_CONTENT.map((brand) => ({ slug: brand.slug }));
}

export default async function BrandPagePreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Object.hasOwn:擋 constructor/__proto__ 等原型鏈 key(對齊 dev-preview/brands/[slug] 既有慣例)
  if (!Object.hasOwn(BRAND_BY_SLUG, slug)) notFound();
  const brand = BRAND_BY_SLUG[slug]!;
  // D3b:商品區走與正式 route 同一支撈法(同一份排序與筆數;預覽看到的就是正式站會有的)
  const [products, availableSlugs] = await Promise.all([
    fetchBrandTopProducts(slug),
    fetchBrandsWithProducts(),
  ]);

  return (
    <>
      <BrandPageRoot brand={brand} products={products} availableSlugs={availableSlugs} />
      {/* 切換列自帶 `.bp-page`:它用的 `--f-mono` / `--c-ember-ink` / `--c-text-3` 都是
          scoped 色票,放在 BrandPageRoot 外面就吃不到(這正是 #314 講的沉默降級)。 */}
      <div className="bp-page">
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
    </>
  );
}
