'use client';

// ProductBreadcrumb.tsx — 商品頁麵包屑 + 車輛 pill。
//
// V-2h/MF-3 前置(鐵則 6):自 ProductPage.tsx 抽出(拆前 401 行 > 400 硬上限)。**行為 byte 等價搬移**、
//   邏輯/註解逐字保留、僅改為自持 useSearchParams/useRouter/usePathname(client 導覽)+ 收 product prop。
// 內容:8-source 麵包屑(withVehicle 帶車款)+ vehicle pill(點本體跳 /products?vehicle=、× 清除 URL vehicle)。
// 字面真權威源=design L40-94(鐵則 1);搬移歷史見 git log(原在 ProductPage.tsx)。

import Link from 'next/link';
import { Fragment, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { MockProduct } from '@/data/mock-products';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { slugify } from '@/lib/vehicle-taxonomy';

type Crumb = { label: string; href?: string; current?: boolean };

export function ProductBreadcrumb({ product }: { product: MockProduct }) {
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

  return (
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
  );
}
