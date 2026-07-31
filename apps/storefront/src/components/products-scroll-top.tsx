// products-scroll-top.tsx — 篩選動作 → 捲回頁首
//
// Sean 2026-07-31 回報:選好車 → 點「類別」→ 選商品分類,如果人正在頁面下方,
// 篩完畫面停在原位(看到的是頁尾資訊),要自己往上滑才看得到篩選結果。
// 期望 = 篩選動作確認後一律回到頁面上方(與翻頁 changePage 既有行為一致)。
//
// 🔴 為什麼包 dispatch / setExtras,而不是掛一個 useEffect 監看篩選值:
//    深連結還原(useDeepLinkRestore)走的是同一個 dispatch。effect 只看得到「篩選值變了」,
//    分不出「使用者剛選了分類」與「從商品頁按上一頁回來、URL 參數正在還原」——後者瀏覽器
//    才剛把捲動位置還原回去,再捲一次頁首就是把使用者的位置弄丟。包在使用者事件這一端
//    天然只吃使用者動作(還原路徑拿到的是未包裝的 rawDispatch)。
//
// 🔴 為什麼獨立成檔:ProductsPage.tsx 已 396 行,鐵則 6 上限 400。
//
// ⚠️ 手機抽屜開著時 body 是 overflow:hidden。CSS 規範裡 overflow:hidden 只擋使用者捲動、
//    不擋程式捲動(overflow:clip 才擋),故抽屜開著時捲動仍生效、關上抽屜就已經在頁首。

'use client';

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { CascadeFilterAction } from '@pcm/ui';
import type { ProductExtraFilters } from './filter-state';

export function scrollCatalogToTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 兩份 extras 之間,除了 priceRange 以外都相同 → 不捲頁。
 * priceRange = FilterSide 的雙滑桿,拖曳中每動一格就更新一次;跟著捲頁會把頁面
 * 從使用者手底下拉走。其餘欄位(價格區間 chip / 顏色 / 現貨 / 新品 / 特價)都是
 * 一次點擊即確定的選擇。
 */
function onlyPriceRangeChanged(prev: ProductExtraFilters, next: ProductExtraFilters): boolean {
  return (
    prev.price === next.price &&
    prev.inStock === next.inStock &&
    prev.isNew === next.isNew &&
    prev.isSale === next.isSale &&
    prev.colors.length === next.colors.length &&
    prev.colors.every((c, i) => c === next.colors[i])
  );
}

/**
 * 把宿主的 rawDispatch / setExtrasRaw 包成「使用者改篩選 → 捲回頁首」的版本。
 * 只把包裝版傳給篩選 UI;URL 還原等程式路徑仍用未包裝的原版。
 */
export function useFilterScrollTop(
  rawDispatch: Dispatch<CascadeFilterAction>,
  setExtrasRaw: Dispatch<SetStateAction<ProductExtraFilters>>,
  extras: ProductExtraFilters,
): {
  dispatch: Dispatch<CascadeFilterAction>;
  setExtras: Dispatch<SetStateAction<ProductExtraFilters>>;
} {
  const dispatch = useCallback(
    (action: CascadeFilterAction) => {
      rawDispatch(action);
      scrollCatalogToTop();
    },
    [rawDispatch],
  );

  const setExtras = useCallback(
    (update: SetStateAction<ProductExtraFilters>) => {
      setExtrasRaw(update);
      // updater 是純函式(各呼叫端一律 `e => ({ ...e, x })`),先算一次 next 只為比對、無副作用。
      const next = typeof update === 'function' ? update(extras) : update;
      if (!onlyPriceRangeChanged(extras, next)) scrollCatalogToTop();
    },
    [setExtrasRaw, extras],
  );

  return { dispatch, setExtras };
}
