// ProductPage.tsx — 商品詳細頁主元件(client、'use client')。
//
// 組裝層:pd-main(ProductGallery + ProductInfo)+ breadcrumb + vehicle pill + 各 N° section
//   (ProductServices / Highlights / SwatchWall / Spotlight / Tabs / 相關商品 N°03 / ProductFAQ N°04)
//   + mobile buybar;各 section 拆獨立子元件(鐵則 6)、本檔只負責資料 / 狀態 / 組裝。
// selectedVariant 狀態在此(受控源頭、OD-4a):ProductInfo picker 改它、ProductGallery 隨它換圖、
//   mobile buybar 用它;product 變更 reset 回第一個變體。
//
// 'use client' 必要:useSearchParams / useRouter / useMemo + 互動 onClick(vehicle pill ×)
//   (ADR-0006 §1 白名單「Hooks → 'use client'」、不違 server-component-default)。
//
// 沿革(13b 骨架 / 13c-d 拆 Gallery·Info / 13e-g buy·tabs·related / OD-5~ 視覺真權威遷 OD 模板)
//   詳見 design-storefront-manifest.yaml ProductPage 段 + od_redesign.slices_done;
//   字面真權威源 = OD「Website V2」product-detail-rpm-template.html(鐵則 1)。

'use client';

import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { MemberTier } from '@pcm/domain';
import { RPM_CARBON_BRAND_SLUG, type MockProduct, type UIVariant } from '@/data/mock-products';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { slugify } from '@/lib/vehicle-taxonomy';
import { useCart } from '@/contexts/CartContext';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { ProductGallery } from './ProductGallery';
import { ProductInfo } from './ProductInfo';
import { ProductServices } from './ProductServices';
import { ProductFitments } from './ProductFitments';
import { BrandShowcase } from './BrandShowcase';
import { ProductTabs } from './ProductTabs';
import { ProductFAQ } from './ProductFAQ';
import { ProductRelated } from './ProductRelated';
import { LineCtaButton } from './LineCtaButton';
import '@/styles/product-page.css';

export type ProductPageProps = {
  product: MockProduct;
  tier: MemberTier;
  /** R3/N°03:推薦引擎相關商品(server 端 RuleBasedRecommendationEngine 已排自身 + 排序 + 取前 limit、toUIProduct 'general' strip);空 → 相關商品區隱藏。 */
  related: MockProduct[];
  /** R3:引擎回傳 hasMore(去重排自身後候選 > limit)→ true 才顯「查看全部相容」。 */
  relatedHasMore?: boolean;
  /** R3:「查看全部」連結(有車→ /products?vehicle= / 無車→ /products?brand=);relatedHasMore 為真才用。 */
  relatedMoreHref?: string;
  /** R3:情境化標題(L1、plan §5)——有選車=「這台車也適用」/ 無車=「同款推薦」。 */
  relatedHasVehicle?: boolean;
  /** Q2=A:選定車輛 URL 短版 slug;有值時相關商品卡片連結帶 ?vehicle=、延續車輛 context。 */
  relatedVehicleParam?: string;
};

type Crumb = { label: string; href?: string; current?: boolean };

export function ProductPage({
  product,
  tier,
  related,
  relatedHasMore = false,
  relatedMoreHref,
  relatedHasVehicle = false,
  relatedVehicleParam,
}: ProductPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // M-1-13e-b:接 CartContext;Mobile sticky bar 用(對齊 design L127-130 addToCart 行為)
  // (Phase 1 mock:localStorage 暫存、無後端;M-3 swap 真結帳時介面不變)
  // Mobile sticky 無 qty / color / size 選擇 UI、預設 qty=1 + product 預設色(對齊 design Mobile 簡化邏輯)
  const { addItem } = useCart();

  // OD-4a:selectedVariant 狀態提升至此(受控源頭)— ProductInfo picker 改它、ProductGallery 隨它換圖、
  //   mobile buybar 用它(修 16c-3 buybar 只能用預設變體的限制)。product 變更 reset 回第一個變體
  //   (gallery 同步換圖;ProductInfo 不再自持此 state、只持 qty/liked)。
  const [selectedVariant, setSelectedVariant] = useState<UIVariant | null>(
    product.variants?.[0] ?? null,
  );
  useEffect(() => {
    setSelectedVariant(product.variants?.[0] ?? null);
  }, [product.variants]);
  // 顯示價:選中變體價(general)優先、否則 product.price(無變體 mock fallback)
  const displayPrice = selectedVariant?.price ?? product.price;

  const addToCart = () => {
    // productId 用 product.slug:string、stable、對齊 domain ProductId + Supabase 路由
    // (Codex M-1-13e-b review P1:不用 mock-only product.id:number)
    // M-3-S2-b2-c:mobile sticky buybar 加購帶真選中變體 variant_id(變體 uuid = selectedVariant.id;
    //   OD-4a selectedVariant 已提升至 ProductPage、buybar 同步使用者選擇)。取代 M-1-16c-3 把 sku 塞 color
    //   的 hack + 原 product.color mock fallback(非 SKU、移除、留著反污染 line key)。無變體 → variantId
    //   undefined、line key 退回 productId。🔴 不送價(server 依 tier 取價、鐵則 12)。
    addItem({
      productId: product.slug,
      qty: 1,
      variantId: selectedVariant?.id,
    });
  };

  // M-1-13e-b:hasDiscount derived(對齊 design L140 字面)— Mobile sticky bar mbb-orig 三元判斷用
  const hasDiscount = product.origPrice != null && product.origPrice > product.price;

  // 🔴 P0-C 去碳品牌切換守門:RPM Carbon 商品才渲染碳纖維專屬區塊(N°01 為什麼選 RPM Carbon /
  //   N°02 紋路牆 / 服務橫條泰國原廠卡 / Spotlight 碳纖維工藝);非 RPM = 空白(Q2=B、不猜產地材質)。
  //   🔴 F1:守門用 brandSlug(≠ product.brand 顯示名 'RPM CARBON');brand 恆 false → RPM 碳段全消失=回歸。
  const isRpmCarbon = product.brandSlug === RPM_CARBON_BRAND_SLUG;

  const from = searchParams.get('from') || 'catalog';
  const sourceId = searchParams.get('sourceId');
  const sourceLabel = searchParams.get('sourceLabel');
  const brand = searchParams.get('brand');
  const category = searchParams.get('category');
  const vehicle = searchParams.get('vehicle');

  // Category derived from '引擎部品 · 排氣管' style string(對齊 design L30-31)
  const categoryMain = (product.category || '').split('·')[0]?.trim() || '商品';
  const categorySub = (product.category || '').split('·')[1]?.trim() || '';

  // M-1-13I Bug 2 修:把 vehicle URL param 附加進 href(若存在)
  // 對齊 design ProductPage.jsx L40-82(design 用 SPA globalVehicle 跨頁、
  // storefront 無此機制必須靠 URL 帶;屬合理 URL 轉譯、非反向遷就 design、不違鐵則 1)
  // M-1-13Z external reviewer Q2 升級:用 useCallback 取代原 disable + 註解、
  // 讓 lint rule 繼續守住未來閉包變更(對齊 Sean 2026-05-23 Q2 拍板)
  const withVehicle = useCallback(
    (href: string): string => {
      if (!vehicle) return href;
      const sep = href.includes('?') ? '&' : '?';
      return `${href}${sep}vehicle=${encodeURIComponent(vehicle)}`;
    },
    [vehicle],
  );

  // Breadcrumb 8-source 完整邏輯(對齊 design L40-82 字面、改用 Next.js Link href 取代 onNav callback)
  // Priority: from(URL) > 預設 'catalog' fallback
  // M-1-13I Bug 2:所有導覽 href 包 withVehicle(12 處 = 7 source-based + 5 legacy fallback);
  // 首頁 '/' 與商品名 current 條不帶 vehicle(回首頁不保留車種、current 無 href)。
  const crumbs = useMemo<Crumb[]>(() => {
    const arr: Crumb[] = [{ label: '首頁', href: '/' }];

    if (from === 'brand' && sourceId) {
      arr.push({ label: '品牌', href: withVehicle('/brands') });
      arr.push({
        label: sourceLabel || sourceId.toUpperCase(),
        href: withVehicle(`/brands/${sourceId}`),
      });
    } else if (from === 'new') {
      arr.push({ label: sourceLabel || '新品上架', href: withVehicle('/products?filter=new') });
    } else if (from === 'sale') {
      arr.push({ label: sourceLabel || '特價精選', href: withVehicle('/products?filter=sale') });
    } else if (from === 'home') {
      // From homepage — no extra crumb, just 首頁 → product
    } else if (from === 'search') {
      arr.push({ label: sourceLabel || '搜尋結果', href: withVehicle('/search') });
    } else if (from === 'catalog') {
      arr.push({ label: '商品目錄', href: withVehicle('/products') });
      // 簡化:直接顯示 searchParam category 字面 OR product.categoryMain
      // 不查 MOCK_CATEGORIES.id→name 映射(raw 字面一致、不留屎)
      const categoryLabel = category || categoryMain;
      if (categoryLabel) {
        arr.push({
          label: categoryLabel,
          href: withVehicle(`/products?category=${encodeURIComponent(categoryLabel)}`),
        });
      }
    } else {
      // Fallback:legacy productFilter 路徑(對齊 design L66-78)
      arr.push({ label: '商品目錄', href: withVehicle('/products') });
      if (brand) {
        arr.push({ label: brand.toUpperCase(), href: withVehicle(`/products?brand=${brand}`) });
      } else if (category) {
        arr.push({ label: category, href: withVehicle(`/products?category=${encodeURIComponent(category)}`) });
      } else if (categoryMain) {
        arr.push({ label: categoryMain, href: withVehicle('/products') });
      }
      if (categorySub && !brand) {
        arr.push({ label: categorySub, href: withVehicle('/products') });
      }
    }

    arr.push({ label: product.name, current: true });
    return arr;
    // M-1-13Z:withVehicle 為 useCallback([vehicle])、已涵蓋 vehicle、故 deps 列 withVehicle 不另列 vehicle
    // (exhaustive-deps 判 vehicle 為 unnecessary;withVehicle 變更即 vehicle 變更、連動正確)
  }, [from, sourceId, sourceLabel, brand, category, categoryMain, categorySub, product.name, withVehicle]);

  // Vehicle pill — separate filter indicator(對齊 design L84-94)
  // URL format: vehicle=brandId:modelId:year(冒號分隔)
  // S1(#152 修復)後 /products 端 id 為 fitment 衍生 slug(vehicle-taxonomy)→ pill 解析
  // 首選「商品自身 fitments 同源反查」(被篩選點進來的商品必含該車款 fitment、slugify 同規則
  // 對回原字串);次選舊靜態 MOCK_MOTO_BRANDS(吸收歷史 mock 連結);皆未命中 fallback 裸 slug。
  const vehiclePill = useMemo(() => {
    if (!vehicle) return null;
    const [brandId, modelId, yearStr] = vehicle.split(':');
    const fit = (product.fitments ?? []).find(
      (f) =>
        slugify(f.motoBrand) === brandId &&
        (!modelId || slugify(f.modelCode) === modelId),
    );
    const brandObj = MOCK_MOTO_BRANDS.find((b) => b.id === brandId);
    const modelObj = brandObj?.models?.find((m) => m.id === modelId);
    const brandLabel = fit?.motoBrand || brandObj?.name || brandId;
    const modelLabel = modelId ? fit?.modelCode || modelObj?.name || modelId : undefined;
    const label = [brandLabel, modelLabel, yearStr].filter(Boolean).join(' · ');
    return { label };
  }, [vehicle, product.fitments]);

  const handleClearVehicle = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('vehicle');
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  // M-1-13I Bug 3 修:pill 本體點擊 → 跳 /products 帶 vehicle(對齊 design L171-180、
  // SPA onNav('products', { vehicle }) 轉譯成 URL push;屬合理 URL 轉譯、行為對等)
  const handleVehicleNavigate = () => {
    if (!vehicle) return;
    router.push(`/products?vehicle=${encodeURIComponent(vehicle)}`);
  };

  // R3/N°03(取代 C5/#258 同分類版):Related 由 server 端推薦引擎(RuleBasedRecommendationEngine)供給——
  //   Case A 反查選定車相容池 / Case B 同品牌,已排自身 + 排序 + 取前 limit(8)+ toUIProduct 'general' strip →
  //   `related` prop 交 <ProductRelated>(鐵則 6 抽出子元件)渲染;hasMore/情境化標題由 route 傳 prop。
  const relatedProducts = related;

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
              type="button"
              className="pd-vehicle-pill"
              onClick={handleVehicleNavigate}
              aria-label={`回到商品列表 ${vehiclePill.label}`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 17h14M7 17V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v10" />
              </svg>
              <span>{vehiclePill.label}</span>
              <span
                className="pd-vehicle-pill-x"
                role="button"
                tabIndex={0}
                aria-label={`清除車輛篩選 ${vehiclePill.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearVehicle();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleClearVehicle();
                  }
                }}
              >
                ×
              </span>
            </button>
          )}
        </nav>

        {/* M-1-13e-a:pd-price-block + pd-buy-row + pd-buynow-btn + pd-services 已搬入 ProductInfo;
            Mobile sticky bar 在 main / HomeFooter 之後(對齊 design ProductPage.jsx L501-545 位置)*/}
        {/* TODO M-1-13g: pd-related + pd-toast(responsive media queries 13e-a 已搬 design L662-667 sec 6+7+13 切換規則) */}
        <section className="pd-main">
          <ProductGallery product={product} selectedVariant={selectedVariant} />
          <ProductInfo
            product={product}
            tier={tier}
            selectedVariant={selectedVariant}
            onSelectVariant={setSelectedVariant}
          />
        </section>
        {/* OD-5:服務保障橫條(ProductServices)— OD 模板 §12 hero 下方獨立全寬 section,
            從 ProductInfo 右欄內移出(self-contained section.pd-services-strip)。
            OD 模板順序為 pd-main → pd-services-strip → 適用車款 → N°01。
            🔴 P0-C 去碳:isRpmCarbon 傳入做卡級守門(泰國原廠卡 RPM-only、其餘 3 卡通用不動)。 */}
        <ProductServices isRpmCarbon={isRpmCarbon} />
        {/* OD-12:適用車款表(ProductFitments)— OD 模板 §7.5 直接搬、接 S6 真資料 product.fitments;
            D1=A 3 欄(車廠/車型/年式)。無 fitments(mock / 通用款 / 無資料真品)→ 元件內返 null 整段不渲染。 */}
        <ProductFitments product={product} />
        {/* #270 B S2(Sean 2026-07-08 拍 A、supersede OD §9 分頁):規格區(ProductTabs)由橫向 tabs
            改長頁全展開 + sticky 跳轉列;四段 description/specs/install/warranty 全常駐可見(h2 landmark、
            section id pd-sec-*)。內容 byte 不變、僅呈現型態改;RPM 內容一字不變、只是不再被分頁藏。 */}
        <ProductTabs product={product} />
        {/* #270 B S3(Sean 2026-07-08 拍 B、一致性):品牌形象區統一搬到規格分頁「之下」(三家品牌
            RPM/GB/Bonamici 頁面結構一致、讓客人先確認相容/規格再看品牌行銷)。BrandShowcase 依 brandSlug
            分派:rpm-carbon → N°01 ProductHighlights + N°02 ProductSwatchWall + ProductSpotlight(自帶
            hasSpotlight+brandSlug 雙守門);gb-racing/bonamici → 各自 Showcase(S4/S5 補);未知 → null。
            🔴 RPM 內容 byte 不變、只是位置由規格之上搬到規格之下(RPM byte 鐵律此線解除但僅搬位置)。
            OD 模板原順序(Fitments→N°01→N°02→Tabs)於此 supersede:改 Fitments→Tabs→BrandShowcase。 */}
        <BrandShowcase product={product} />

        {/* N°03 相關商品(R3、鐵則 6 抽 ProductRelated 子元件、對齊 S3 抽 BrandShowcase 精神);
            內容由 server 推薦引擎供給、情境化標題 + carousel + hasMore CTA 皆在子元件。related 空 → 隱藏。 */}
        <ProductRelated
          related={relatedProducts}
          hasMore={relatedHasMore}
          moreHref={relatedMoreHref}
          hasVehicle={relatedHasVehicle}
          vehicleParam={relatedVehicleParam}
        />

        {/* N°04 常見問題(RPM 共用、非條件)+ FAQPage JSON-LD(OD-10、Sean Q1 override 排 N°04) */}
        <ProductFAQ />
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
          <div className="pd-mbb-price">NT$ {displayPrice.toLocaleString()}</div>
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

      {/* LINE 詢價懸浮 CTA(接通現況唯一成交管道、每商品頁顯;手機 deep link 預填 / 桌機 QRCODE) */}
      <LineCtaButton product={product} />
    </div>
  );
}
