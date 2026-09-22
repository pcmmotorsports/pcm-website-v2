// use-deep-link-restore.tsx — #341-B:從 `products-url-state.tsx` **原樣搬出**(純位移)。
//
// 🔴 hook 本體一個字元都沒改。它送出的 dispatch 正是
//    `use-catalog-filter-url-sync.tsx` 的「還原窗口守衛 / #289 還原波」要等的那一波 ——
//    理由正本在那一支,這裡不複製第二份(兩份會漂,而漂掉的症狀是測試全綠、正式站偶發)。
// 🔴 副檔名 `.tsx`:含 hook 的檔要 .tsx 才受 eslint react-hooks 規則保護。
// 回歸鎖:`use-deep-link-restore.test.tsx`。

import { useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import {
  selectCategoryMain,
  selectCategorySub,
  toggleBrand,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { SearchParamsLike } from '@/lib/vehicle-url';
import { parseBrandFiltersFromUrl, parseCategoryFromUrl } from './products-url-parsers';


/**
 * mount 時把 URL 深連結(vehicle / category / brand)還原成 cascade 篩選(#6 + Q4-S5;自 ProductsPage
 * 抽出=鐵則 6 檔案上限)。三來源各對照真實清單驗證、查無 fail-safe 忽略;只入站不回寫 URL。
 * 🔴 Q28①(2026-08-08):**車輛多一個回退來源**——URL 無車時讀全站選車鏡(vehicle-context),
 *    讓 PDP 選的車跳回列表能同步。URL 恆優先;鏡走 `vehicleFromContext` 同一套 taxonomy 驗證。
 *    ⚠️ 由此本 hook 不再是「純 URL 入站」:鏡入站後 useVehicleUrlSync 會把車回寫 URL
 *    (裸 `/products` → `/products?vehicle=…`),Sean 已拍板接受這個行為改變。
 * 🔴 skipPageResetOnce:標記「本波 cascade 變更源自 **URL** 還原、非使用者操作」→ usePageResetOnFilterChange
 *    跳過一次(否則 ?vehicle=…&page=3 back 會被 mount dispatch 誤重置回第 1 頁)。
 *    **鏡入站不設**(拍板 A):那是篩選條件真的變了、照通則回第 1 頁。
 * 🔴 brandAppliedOnce:toggleBrand 非冪等(strict mode dev effect 雙跑會 toggle 掉)→ 守一次;
 *    vehicle/category 為冪等 select、不需守(維持原行為)。
 */
export function useDeepLinkRestore(opts: {
  searchParams: SearchParamsLike;
  motoBrands: MockMotoBrand[];
  categories: { id: string; name: string; children?: { id: string; name: string }[] }[];
  productBrands: { id: string }[];
  dispatch: Dispatch<CascadeFilterAction>;
  skipPageResetOnce: MutableRefObject<boolean>;
  brandAppliedOnce: MutableRefObject<boolean>;
  /**
   * 🔴🔴 **關鍵字結果頁 ⇒ 整支不還原**(⟦搜尋-落點換 /products⟧ R2 must-fix,2026-09-03)。
   *
   * `/products?search=` 走的是關鍵字資料路(`lib/search.ts` 的 ILIKE),而**那條路吃不到
   * 任何 facet**(品牌/分類/價格/車款都在 RPC 那條路上)。而本 hook 會把 URL 上的 facet
   * 灌進 `cascade`,而 `cascade` 被傳給 `FilterSide` / `CascadeFilterTop` /
   * `ProductsMobileControls` / **`PageHeader`(頁面標題!)** ——
   * ⇒ 📌 **每一個都會把它畫成「已選」, 而清單根本沒被它縮過。**
   *
   * ⛔ ~~我第一版只在 `ProductsPage` 把 `ActiveChips` 藏起來~~
   * 🛑 **那是修了被點名的那一個實例, 不是修那個類別** —— R2 逐字抓到 `FilterSide` 的
   *    checkbox 照樣打勾(`FilterSide.tsx:149-156` 的 `selected.includes`)。
   *
   * 🔴🔴 **而我自己另外量到一格比 R2 那個更糟, 因為它【不需要網址上有任何 facet】**:
   *    本 hook 逐字 `const v = urlVehicle ?? vehicleFromContext(motoBrands);`
   *    ⇒ URL 沒有 vehicle 時**回退讀全站選車鏡**
   *    ⇒ 客人先選了車、再搜一個關鍵字 ⇒ 網址乾乾淨淨 `/products?search=X`
   *    ⇒ ⇒ **標題印「Yamaha MT-07」而商品是關鍵字撈的、完全沒按那台車過濾。**
   *    ⇒ 📌 R2 那個要手打網址;**這一格是正常動線。**
   *
   * ✅ 所以閘在**這裡**(源頭)而不是在五個消費端:`cascade` 保持空
   *   ⇒ 膠囊/側欄/標題/手機控制項**自動全部一致**。改一處, 不是改五處。
   */
  keywordActive: boolean;
}): void {
  useEffect(() => {
    // 🔴 這一行必須在**所有**還原動作之前(含 `vehicleFromContext` 那個回退)。
    if (opts.keywordActive) return;
    const { searchParams, motoBrands, categories, productBrands, dispatch, skipPageResetOnce, brandAppliedOnce } = opts;
    // :901(2026-09-22):車款不在這裡還原了 —— 改由 `use-catalog-vehicle-intent.tsx` 的車款意圖負責
    //   (卸載再掛載時這裡讀到的 `searchParams` 可能是舊的 ⇒ 會還原成舊車)。
    // 🔴 R1 MF-3 的「鏡入站要回第 1 頁」搬到那邊:它的 effect 排在本 hook 之後,鏡入站時會把本 hook
    //    設起來的 `skipPageResetOnce` 改回 false(同一次 `filterResetKey` 變動只消化得掉一次 skip)。
    void motoBrands;
    const urlCategory = parseCategoryFromUrl(searchParams, categories);
    const urlBrands = parseBrandFiltersFromUrl(searchParams, productBrands);
    if (!urlCategory && urlBrands.length === 0) return;
    skipPageResetOnce.current = true;
    if (urlCategory) {
      dispatch(selectCategoryMain(urlCategory.mainId, urlCategory.main)); // 空狀態直選、冪等
      // V-1a:#212 兩層還原補子類(mount 單次 dispatch、無 toggle 反覆問題)
      if (urlCategory.subId && urlCategory.sub) {
        dispatch(selectCategorySub(urlCategory.subId, urlCategory.sub));
      }
    }
    if (urlBrands.length > 0 && !brandAppliedOnce.current) {
      brandAppliedOnce.current = true;
      for (const brand of urlBrands) dispatch(toggleBrand(brand));
    }
    // 僅 mount 時讀一次;strict mode dev 雙跑由 brandAppliedOnce 守 toggle、select 類冪等可吸收
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

