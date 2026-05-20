// ProductPage.tsx — 商品詳細頁主元件(M-1-13b 骨架 + breadcrumb + vehicle pill;13c gallery 拆 ProductGallery 子元件;13d-g 累積補)
//
// 字面從 design-reference/components/ProductPage.jsx @ 25d3a2a 直接搬(M-1-13b 範圍:line 1-12、29-94、153-189):
// - jsx → tsx + props type 推斷
// - window.PCM_DATA → props.product import(server route 從 findProductBySlug 取、傳 client)
// - tweaks.productFilter / productSource / vehicleFilter → useSearchParams 讀(Q4=B URL state 拍板)
// - <Header onNav={onNav} currentPage="product" /> → <Header currentPage="catalog" />
//   (storefront Header 不接 onNav、navItems 無 'product' id、對齊 ProductsPage 既存慣例)
// - <Footer onNav={onNav} /> → <HomeFooter />(對齊 M-1-12 ProductsPage 既存用法)
//
// M-1-13c 拆檔:gallery + lightbox + 5 swipe useRef + keyboard nav useEffect + body scroll lock
// + PRODUCT_IMG_POOL + productGallery helper + hasDiscount/discountPct derived 全部移至
// ./ProductGallery.tsx(對齊鐵則 6「>300 行硬警戒」、本檔 13c 加完累計 366 行立即拆);
// 本檔 13c 範圍 = `<ProductGallery product={product} />` 一行 + section.pd-main 含 pd-info 空殼預埋。
//
// 'use client' 必要:useSearchParams / useRouter / useMemo + 互動 onClick(vehicle pill ×)
// 對齊 ADR-0006 §1 白名單「Hooks → 'use client'」、不違 server-component-default。
//
// 後續 sub-slice 預埋:
// - 13d info / options + size/color/qty state hooks(進 ProductGallery 同層子元件 ProductInfo 或留 ProductPage)
// - 13d buy row + services + mobile sticky buy bar
// - 13e tabs(spec / desc / faq / review)
// - 13f related + toast
// - 13g responsive media queries(product-page.css line 618-669)
//
// 本 sub-slice 不渲染 product.price / product.tierLabel(防誤觸 backlog #130 tier resolution helper
// 第 3 處撞、13e Buy Row 真撞才抽);不動 backlog #81/#82(variants schema / inStock↔availability、
// 留 13d-e 真做 options / inStock UI 時 trigger)。

'use client';

import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Fragment, useMemo } from 'react';
import type { MockProduct } from '@/data/mock-products';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { ProductGallery } from './ProductGallery';
import '@/styles/product-page.css';

export type ProductPageProps = { product: MockProduct };

type Crumb = { label: string; href?: string; current?: boolean };

export function ProductPage({ product }: ProductPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const from = searchParams.get('from') || 'catalog';
  const sourceId = searchParams.get('sourceId');
  const sourceLabel = searchParams.get('sourceLabel');
  const brand = searchParams.get('brand');
  const category = searchParams.get('category');
  const vehicle = searchParams.get('vehicle');

  // Category derived from '引擎部品 · 排氣管' style string(對齊 design L30-31)
  const categoryMain = (product.category || '').split('·')[0]?.trim() || '商品';
  const categorySub = (product.category || '').split('·')[1]?.trim() || '';

  // Breadcrumb 8-source 完整邏輯(對齊 design L40-82 字面、改用 Next.js Link href 取代 onNav callback)
  // Priority: from(URL) > 預設 'catalog' fallback
  const crumbs = useMemo<Crumb[]>(() => {
    const arr: Crumb[] = [{ label: '首頁', href: '/' }];

    if (from === 'brand' && sourceId) {
      arr.push({ label: '品牌', href: '/brands' });
      arr.push({
        label: sourceLabel || sourceId.toUpperCase(),
        href: `/brands/${sourceId}`,
      });
    } else if (from === 'new') {
      arr.push({ label: sourceLabel || '新品上架', href: '/products?filter=new' });
    } else if (from === 'sale') {
      arr.push({ label: sourceLabel || '特價精選', href: '/products?filter=sale' });
    } else if (from === 'home') {
      // From homepage — no extra crumb, just 首頁 → product
    } else if (from === 'search') {
      arr.push({ label: sourceLabel || '搜尋結果', href: '/search' });
    } else if (from === 'catalog') {
      arr.push({ label: '商品目錄', href: '/products' });
      // 簡化:直接顯示 searchParam category 字面 OR product.categoryMain
      // 不查 MOCK_CATEGORIES.id→name 映射(raw 字面一致、不留屎)
      const categoryLabel = category || categoryMain;
      if (categoryLabel) {
        arr.push({
          label: categoryLabel,
          href: `/products?category=${encodeURIComponent(categoryLabel)}`,
        });
      }
    } else {
      // Fallback:legacy productFilter 路徑(對齊 design L66-78)
      arr.push({ label: '商品目錄', href: '/products' });
      if (brand) {
        arr.push({ label: brand.toUpperCase(), href: `/products?brand=${brand}` });
      } else if (category) {
        arr.push({ label: category, href: `/products?category=${encodeURIComponent(category)}` });
      } else if (categoryMain) {
        arr.push({ label: categoryMain, href: '/products' });
      }
      if (categorySub && !brand) {
        arr.push({ label: categorySub, href: '/products' });
      }
    }

    arr.push({ label: product.name, current: true });
    return arr;
  }, [from, sourceId, sourceLabel, brand, category, categoryMain, categorySub, product.name]);

  // Vehicle pill — separate filter indicator(對齊 design L84-94)
  // URL format: vehicle=brandId:modelId:year(冒號分隔)
  const vehiclePill = useMemo(() => {
    if (!vehicle) return null;
    const [brandId, modelId, yearStr] = vehicle.split(':');
    const brandObj = MOCK_MOTO_BRANDS.find((b) => b.id === brandId);
    const modelObj = brandObj?.models?.find((m) => m.id === modelId);
    const label = [brandObj?.name || brandId, modelObj?.name || modelId, yearStr]
      .filter(Boolean)
      .join(' · ');
    return { label };
  }, [vehicle]);

  const handleClearVehicle = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('vehicle');
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  return (
    <div className="pcm-root" data-screen-label="Product Detail">
      <Header currentPage="catalog" />

      <main className="pd-page">
        <nav className="pd-crumbs" aria-label="navigation path">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="pd-crumbs-sep">/</span>}
              {c.current ? (
                <span className="pd-crumbs-current" title={c.label}>
                  {c.label}
                </span>
              ) : (
                <Link href={c.href!}>{c.label}</Link>
              )}
            </Fragment>
          ))}
          {vehiclePill && (
            <button
              className="pd-vehicle-pill"
              onClick={handleClearVehicle}
              aria-label={`清除車輛篩選 ${vehiclePill.label}`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M5 17h14M7 17V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10" />
              </svg>
              <span>{vehiclePill.label}</span>
              <span className="pd-vehicle-pill-x" aria-hidden="true">
                ×
              </span>
            </button>
          )}
        </nav>

        {/* TODO M-1-13d: section.pd-services / pd-buy-row + pd-mobile-buy-bar + pd-info column(brand row / sku / title / fits-banner / options) */}
        {/* TODO M-1-13e: section.pd-tabs-section */}
        {/* TODO M-1-13f: section.pd-related + pd-toast */}
        {/* TODO M-1-13g: responsive media queries(product-page.css line 618-669) */}
        <section className="pd-main">
          <ProductGallery product={product} />
          <aside className="pd-info">{/* TODO M-1-13d: brand row + sku + title + fits-banner + options */}</aside>
        </section>
      </main>

      <HomeFooter />
    </div>
  );
}
