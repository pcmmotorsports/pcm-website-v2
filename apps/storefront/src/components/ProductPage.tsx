// ProductPage.tsx — 商品詳細頁主元件(client、'use client')。
//
// 組裝層:pd-main(ProductGallery + ProductInfo)+ ProductBreadcrumb(麵包屑 + vehicle pill)+ 各 N° section
//   (ProductServices / Highlights / SwatchWall / Spotlight / Tabs / 相關商品 N°03 / ProductFAQ N°04)
//   + mobile buybar;各 section 拆獨立子元件(鐵則 6)、本檔只負責資料 / 狀態 / 組裝。
// V-2h/MF-3 前置:麵包屑 + vehicle pill 抽出 ProductBreadcrumb.tsx(拆前 401 行 > 400;byte 等價搬移)。
// selectedVariant 狀態在此(受控源頭、OD-4a):ProductInfo picker 改它、ProductGallery 隨它換圖、
//   mobile buybar 用它;product 變更 reset 回第一個變體。
//
// 'use client' 必要:useState/useEffect + useRouter(mobile buybar router.back)+ 互動 onClick
//   (ADR-0006 §1 白名單「Hooks → 'use client'」、不違 server-component-default)。
//
// 沿革(13b 骨架 / 13c-d 拆 Gallery·Info / 13e-g buy·tabs·related / OD-5~ 視覺真權威遷 OD 模板)
//   詳見 design-storefront-manifest.yaml ProductPage 段 + od_redesign.slices_done;
//   字面真權威源 = OD「Website V2」product-detail-rpm-template.html(鐵則 1)。

'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemberTier } from '@pcm/domain';
import { RPM_CARBON_BRAND_SLUG, type MockProduct, type UIVariant } from '@/data/mock-products';
import { parseVehicleFromUrl } from '@/lib/vehicle-url';
import { readSearchVehicle } from '@/lib/search-vehicle';
import { useCart } from '@/contexts/CartContext';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { ProductBreadcrumb } from './ProductBreadcrumb';
import { ProductGallery } from './ProductGallery';
import { ProductInfo } from './ProductInfo';
import { ProductFitments } from './ProductFitments';
import { ProductFitmentCheck, type PdpUrlVehicleState } from './ProductFitmentCheck';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { GarageChipItem } from './GarageChips';
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
  /** V-2b:§7「是否適用我的車」現選入口所需車款字典;無 fitments 商品不撈=[]。 */
  motoBrands?: MockMotoBrand[];
  /** V-2b:§7 愛車快選(登入會員;未登入/失敗/無 fitments=[])。 */
  garage?: GarageChipItem[];
  // V-2h/MF-3:URL 車款不再由 route 傳 prop——ProductPage 反應式衍生(useSearchParams+motoBrands),
  //   同頁 URL 變更即重判;SSR 初值與 route 端 parseVehicleFromUrl 同源同值(motoBrands=同一 taxonomy)。
};

export function ProductPage({
  product,
  tier,
  related,
  relatedHasMore = false,
  relatedMoreHref,
  relatedHasVehicle = false,
  relatedVehicleParam,
  motoBrands = [],
  garage = [],
}: ProductPageProps) {
  const router = useRouter(); // mobile buybar router.back() + MF-3 選車回寫 URL（麵包屑/vehicle pill 已移 ProductBreadcrumb）
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // V-2h/MF-3:反應式衍生 URL 車款三態(取代 route 靜態 prop)——同頁 `?vehicle=` 變更即重判。
  //   邏輯與 route [slug]/page.tsx 同源(parseVehicleFromUrl + MF-2 三態):無參數=null(讀鏡)/
  //   參數在但對不到 taxonomy='invalid'(不讀鏡、顯重選)/ 已解析=名稱字面物件。SSR 同繪同值(motoBrands
  //   =route 傳的同一 taxonomy)→ 零 hydration mismatch。
  const liveUrlVehicle: PdpUrlVehicleState = useMemo(() => {
    const hasVehicleParam =
      searchParams.get('vehicle') != null ||
      (searchParams.get('brand') != null && searchParams.get('model') != null);
    if (!hasVehicleParam) return null;
    const parsed = parseVehicleFromUrl(searchParams, motoBrands);
    return parsed
      ? { brandName: parsed.brand, modelName: parsed.model, year: parsed.year }
      : 'invalid';
  }, [searchParams, motoBrands]);

  // V-2h/MF-3(關卡1=Option A):選車回寫 URL 用 router.replace(scroll:false)——與 ProductBreadcrumb
  //   handleClearVehicle 同機制、選車後 server 相關商品/推薦 realign 到新車(§7 一致性)。
  //   🔴 條件式 skip:目標 param === 現值不寫(避免無謂 RSC refetch / render loop);null=清除 vehicle。
  const persistVehicle = useCallback(
    (param: string | null) => {
      const current = searchParams.get('vehicle');
      if ((param ?? null) === (current ?? null)) return; // 已同值 → 不寫(chosen 已樂觀設妥)
      const params = new URLSearchParams(searchParams.toString());
      if (param) params.set('vehicle', param);
      else params.delete('vehicle');
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

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
    // V-2h/MF-4:sticky buybar 加購亦帶車款(讀選車 context=與 ProductInfo.addToCart 共用 readSearchVehicle
    //   單一來源;修「不同入口加購車款有無不一致」)。名稱不齊=零猜不帶。
    const vehicle = readSearchVehicle();
    addItem({
      productId: product.slug,
      qty: 1,
      variantId: selectedVariant?.id,
      ...(vehicle ? { vehicle } : {}),
    });
  };

  // M-1-13e-b:hasDiscount derived(對齊 design L140 字面)— Mobile sticky bar mbb-orig 三元判斷用
  const hasDiscount = product.origPrice != null && product.origPrice > product.price;

  // 🔴 P0-C 去碳品牌切換守門:RPM Carbon 商品才渲染碳纖維專屬區塊(N°01 為什麼選 RPM Carbon /
  //   N°02 紋路牆 / 服務橫條泰國原廠卡 / Spotlight 碳纖維工藝);非 RPM = 空白(Q2=B、不猜產地材質)。
  //   🔴 F1:守門用 brandSlug(≠ product.brand 顯示名 'RPM CARBON');brand 恆 false → RPM 碳段全消失=回歸。
  const isRpmCarbon = product.brandSlug === RPM_CARBON_BRAND_SLUG;

  // R3/N°03(取代 C5/#258 同分類版):Related 由 server 端推薦引擎(RuleBasedRecommendationEngine)供給——
  //   Case A 反查選定車相容池 / Case B 同品牌,已排自身 + 排序 + 取前 limit(8)+ toUIProduct 'general' strip →
  //   `related` prop 交 <ProductRelated>(鐵則 6 抽出子元件)渲染;hasMore/情境化標題由 route 傳 prop。
  const relatedProducts = related;

  return (
    <div className="pcm-root" data-screen-label="Product Detail">
      <Header currentPage="catalog" />

      <main className="pd-page">
        <ProductBreadcrumb product={product} />

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
            isRpmCarbon={isRpmCarbon}
          />
        </section>
        {/* 2026-07-11(Sean 拍板):服務保障橫條移入 ProductInfo 右欄(買價下方、窄欄直立);原 OD-5 hero 下方全寬版退場。 */}
        {/* V-2b §7:「是否適用我的車」保守比對(適用車款表段首;讀選車 context→checkFitment;
            display-only 不寫庫不擋購物車、車種鐵律零猜)。無 fitments 時元件內返 null。
            V-2c:URL 第一真相優先於 context 鏡;V-2h/MF-3:liveUrlVehicle 反應式(同頁 URL 變更即重判)
            + onPersistVehicle 選車回寫 URL(Option A router.replace 條件式 skip)。 */}
        <ProductFitmentCheck
          fitments={product.fitments ?? []}
          motoBrands={motoBrands}
          garage={garage}
          urlVehicle={liveUrlVehicle}
          onPersistVehicle={persistVehicle}
        />
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
