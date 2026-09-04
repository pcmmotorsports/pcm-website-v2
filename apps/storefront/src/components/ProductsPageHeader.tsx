// ProductsPageHeader.tsx — 目錄頁頁首(標題 + 麵包屑)。
//
// 🔵 **為什麼獨立成檔(與行數無關的理由)**:它**只吃 `cascade` 一個唯讀 prop**,
//    不碰 state machine、不 dispatch、零 hook ⇒ **它是可以單獨讀懂、單獨看的一塊**。
// 🛑 **本檔是純位移**:函式本體與註解一個字沒改(原 `ProductsPage.tsx:140-175`)。
import Link from 'next/link';
import type { CascadeFilterState } from '@pcm/ui';
import { vehicleLabel } from '@/lib/vehicle-match';

// PageHeader — 頁首標題 + 麵包屑(標題依 cascade 已選分類 / 車輛推導)
export function ProductsPageHeader({ cascade }: { cascade: CascadeFilterState }) {
  const title =
    cascade.category?.sub ??
    cascade.category?.main ??
    (cascade.vehicle
      ? cascade.vehicle.model != null
        ? vehicleLabel(cascade.vehicle.brand, cascade.vehicle.model)
        : cascade.vehicle.brand
      : '全部商品');

  return (
    <div className="pp-head">
      <div className="pp-head-row">
        <h1 className="pp-title">{title}</h1>
        <nav className="pp-breadcrumb" aria-label="麵包屑導航">
          <Link href="/">首頁</Link>
          <span>›</span>
          {cascade.category ? <Link href="/products">商品目錄</Link> : <span>商品目錄</span>}
          {cascade.category?.main && (
            <>
              <span>›</span>
              <span>{cascade.category.main}</span>
            </>
          )}
          {cascade.category?.sub && (
            <>
              <span>›</span>
              <span>{cascade.category.sub}</span>
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
