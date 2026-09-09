// ProductsPageHeader.tsx — 目錄頁頁首(標題 + 麵包屑)。
//
// 🔵 **為什麼獨立成檔(與行數無關的理由)**:它**只吃 `cascade` 一個唯讀 prop**,
//    不碰 state machine、不 dispatch、零 hook ⇒ **它是可以單獨讀懂、單獨看的一塊**。
// 🛑 **本檔是純位移**:函式本體與註解一個字沒改(原 `ProductsPage.tsx:140-175`)。
import Link from 'next/link';
import type { CascadeFilterState } from '@pcm/ui';
import { vehicleLabel } from '@/lib/vehicle-match';

// PageHeader — 頁首標題 + 麵包屑(標題依 cascade 已選分類 / 車輛推導)
//
// 🔴 **`isNewArrivals` 是 2026-09-09 加的, 而它修的是同一個【畫面說謊】**:
//   `/products?filter=new` 的標題原本恆為「全部商品」——
//   客人從首頁「查看所有新品」點進來, 看到的是**「全部商品」+ 一份只有 30 件的清單**
//   ⇒ 📌 那讀起來像「篩選沒生效而且商品不見了」, 而其實兩件事都是對的。
//   ⚠️ **分類 / 車輛仍然優先** —— 它們是客人自己選的、比「從哪個入口進來的」具體。
export function ProductsPageHeader({
  cascade,
  isNewArrivals = false,
}: {
  cascade: CascadeFilterState;
  isNewArrivals?: boolean;
}) {
  const title =
    cascade.category?.sub ??
    cascade.category?.main ??
    (cascade.vehicle
      ? cascade.vehicle.model != null
        ? vehicleLabel(cascade.vehicle.brand, cascade.vehicle.model)
        : cascade.vehicle.brand
      : isNewArrivals
        ? '最新上架'
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
