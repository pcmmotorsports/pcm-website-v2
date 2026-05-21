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
// M-1-13d 拆檔:pd-info column 上半(brand row + sku + title + fits-banner + color/size options)
// + COLOR_MAP + 13d hooks(sizeOptions/colorOptions useMemo + color/size useState + reset useEffect)
// 全部移至 ./ProductInfo.tsx(對齊鐵則 6「>300 行硬警戒」、Q3=A 2026-05-20 拍板「邊寫邊看 ≥300 立即拆」、
// 13d 合一版 328 行立即拆;對齊 13c 拆 ProductGallery 模式);本檔 13d 範圍 = `<ProductInfo product={product} />` 一行。
//
// 'use client' 必要:useSearchParams / useRouter / useMemo + 互動 onClick(vehicle pill ×)
// 對齊 ADR-0006 §1 白名單「Hooks → 'use client'」、不違 server-component-default。
//
// 後續 sub-slice 預埋:
// - 13d info column 上半 + size/color/qty state(本 sub-slice、ProductPage 內、≥300 行才拆 ProductInfo)
// - 13e buy row + buy-now + services + mobile sticky buy bar(tier resolution helper #130 + #82 mapper trigger)
// - 13f tabs(spec / desc / faq / review)
// - 13g related + toast + responsive media queries(product-page.css line 618-669)
//
// 本檔截至 M-1-13d:不渲染 product.price / origPrice / discountPct / tierLabel(留 13e Buy Row、
// #130 tier resolution helper 第 3 處撞才抽);不渲染 product.inStock / availability(留 13e Buy Row、
// 對齊 Q2=A 2026-05-20 拍板 + #82 mapper trigger);不動 backlog #81 variants schema
// (Q1=A 2026-05-20 拍板:hardcoded 落地、M-5-03 sync engine 前真撞才 spike + Sean 親口講 1-20 種規格業務細節)。

'use client';

import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Fragment, useMemo } from 'react';
import type { MemberTier } from '@pcm/domain';
import type { MockProduct } from '@/data/mock-products';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { useCart } from '@/contexts/CartContext';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { ProductGallery } from './ProductGallery';
import { ProductInfo } from './ProductInfo';
import { ProductHighlights } from './ProductHighlights';
import { ProductSpotlight } from './ProductSpotlight';
import { ProductTabs } from './ProductTabs';
import '@/styles/product-page.css';

export type ProductPageProps = { product: MockProduct; tier: MemberTier };

type Crumb = { label: string; href?: string; current?: boolean };

export function ProductPage({ product, tier }: ProductPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // M-1-13e-b:接 CartContext;Mobile sticky bar 用(對齊 design L127-130 addToCart 行為)
  // (Phase 1 mock:localStorage 暫存、無後端;M-3 swap 真結帳時介面不變)
  // Mobile sticky 無 qty / color / size 選擇 UI、預設 qty=1 + product 預設色(對齊 design Mobile 簡化邏輯)
  const { addItem } = useCart();
  const addToCart = () => {
    // productId 用 product.slug:string、stable、對齊 domain ProductId + Supabase 路由
    // (Codex M-1-13e-b review P1:不用 mock-only product.id:number)
    addItem({ productId: product.slug, qty: 1, color: product.color, size: null });
  };

  // M-1-13e-b:hasDiscount derived(對齊 design L140 字面)— Mobile sticky bar mbb-orig 三元判斷用
  const hasDiscount = product.origPrice != null && product.origPrice > product.price;

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
              {i > 0 && <span className="pd-crumbs-sep">›</span>}
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

        {/* M-1-13e-a:pd-price-block + pd-buy-row + pd-buynow-btn + pd-services 已搬入 ProductInfo;
            Mobile sticky bar 在 main / HomeFooter 之後(對齊 design ProductPage.jsx L501-545 位置)*/}
        {/* TODO M-1-13g: pd-related + pd-toast(responsive media queries 13e-a 已搬 design L662-667 sec 6+7+13 切換規則) */}
        <section className="pd-main">
          <ProductGallery product={product} />
          <ProductInfo product={product} tier={tier} />
        </section>
        {/* M-1-13H-4:Highlights + Spotlight 兩新子元件串接(對應 PRD §4 slice-4 + HANDOFF #12 #13);
            ProductSpotlight 內部條件渲染 product.hasSpotlight、falsy 返 null(caller 無需 if-guard) */}
        <ProductHighlights product={product} />
        <ProductSpotlight product={product} />
        {/* M-1-13f-2:pd-tabs-section 對齊 design ProductPage.jsx L382-453 真權威字面
            (4 tab keys = description / specs / install / warranty、非舊 STATUS 寫錯的 spec/desc/faq/review)*/}
        <ProductTabs product={product} />
      </main>

      <HomeFooter />

      {/* M-1-13e-a:Mobile sticky bar — 字面從 design ProductPage.jsx L501-545 直接搬。
          Sean 2026-05-21 業務拍板 + Q-13e-a-scope=C 簡化:
          (1) 全部 disabled={!product.inStock} 移除(對應 backlog #161、按鈕永遠可點);
          (3) mbb-back navigation 用 router.back() 替代 design 8-source onNav 邏輯
              (字面偏離、行為對等、commit body 揭示)。

          M-1-13e-b:mbb-price-col tier conditional 字面補完(對齊 design L527-532)。
          Mock 路徑 product.price 仍 retail、tier='store' / 'premiumStore' 顯「· 經銷」字面
          tag 對齊 design、但價格未真經銷化(對齊 ProductInfo pd-price-block 同樣偏離、
          backlog #161 追、M-1-16 接 Supabase findBySlug + toUIProduct(p, tier) 才真區分)。 */}
      <div className="pd-mobile-buybar" role="region" aria-label="購買列">
        <button
          type="button"
          className="pd-mbb-back"
          onClick={() => router.back()}
          aria-label="返回上一頁"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="pd-mbb-price-col">
          <div className="pd-mbb-price">NT$ {product.price.toLocaleString()}</div>
          {tier === 'store' || tier === 'premiumStore' ? (
            <div className="pd-mbb-orig">
              原價 NT$ {(hasDiscount ? product.origPrice! : product.price).toLocaleString()} · 經銷
            </div>
          ) : hasDiscount ? (
            <div className="pd-mbb-orig">NT$ {product.origPrice!.toLocaleString()}</div>
          ) : null}
        </div>
        <button
          type="button"
          className="pd-mbb-cart"
          onClick={addToCart}
          aria-label="加入購物車"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          <span>加入購物車</span>
        </button>
        <button type="button" className="pd-mbb-buynow" onClick={addToCart}>
          立即購買
        </button>
      </div>
    </div>
  );
}
