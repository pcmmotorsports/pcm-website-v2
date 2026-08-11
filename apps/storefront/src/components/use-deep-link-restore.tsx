// use-deep-link-restore.tsx — #341-B:從 `products-url-state.tsx` **原樣搬出**(純位移)。
//
// 🔴 hook 本體一個字元都沒改。它送出的 dispatch 正是
//    `use-catalog-filter-url-sync.tsx` 的「還原窗口守衛 / #289 還原波」要等的那一波 ——
//    理由正本在那一支,這裡不複製第二份(兩份會漂,而漂掉的症狀是測試全綠、正式站偶發)。
// 🔴 副檔名 `.tsx`:含 hook 的檔要 .tsx 才受 eslint react-hooks 規則保護。
// 回歸鎖:`use-deep-link-restore.test.tsx`。

import { useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  selectCategorySub,
  toggleBrand,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import { parseVehicleFromUrl, vehicleFromContext, type SearchParamsLike } from '@/lib/vehicle-url';
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
}): void {
  useEffect(() => {
    const { searchParams, motoBrands, categories, productBrands, dispatch, skipPageResetOnce, brandAppliedOnce } = opts;
    const urlVehicle = parseVehicleFromUrl(searchParams, motoBrands);
    // Q28①:URL 沒有車才回退讀全站選車鏡(URL 恆為第一真相、鏡不得覆蓋)。
    // 🔴 `?vehicle=garbage` 與「沒有 vehicle 參數」在 parseVehicleFromUrl 回同一個 null(簽章上分不出),
    //    ⇒ 壞參數落到鏡、並由 useVehicleUrlSync 把 URL 改寫乾淨。Sean 08-08 拍板 A:合意,壞參數視同無車。
    const v = urlVehicle ?? vehicleFromContext(motoBrands);
    const urlCategory = parseCategoryFromUrl(searchParams, categories);
    const urlBrands = parseBrandFiltersFromUrl(searchParams, productBrands);
    if (!v && !urlCategory && urlBrands.length === 0) return;
    // 🔴 車一旦來自鏡就不 skip 頁碼重置(Sean 08-08 拍板 A):`?page=3` 是使用者深連結指名的那一頁,
    //    鏡入站則是「篩選條件真的變了」⇒ 照通則回第 1 頁(否則停在第 3 頁但清單已被車輛篩過=可能整頁空的)。
    // 🔴 R1 MF-3:條件不能只寫「URL 有任何來源」——`skipPageResetOnce` 是**單一共用旗標**、而下面
    //    這批 dispatch 會被 React 批次成一次 `filterResetKey` 變動、只消化得掉一次 skip。
    //    `/products?category=X&page=3` + 鏡有車 這格若讓 urlCategory 把旗標設起來,鏡入站的頁碼重置
    //    就被同一次消化吃掉 ⇒ 停在第 3 頁卻已被鏡的車篩過 = 拍板 A 明文要避免的「可能整頁空的」。
    const vehicleFromMirror = urlVehicle == null && v != null;
    if (!vehicleFromMirror && (urlVehicle || urlCategory || urlBrands.length > 0)) {
      skipPageResetOnce.current = true;
    }
    if (v) {
      dispatch(selectVehicleBrand(v.brand));
      if (v.model) dispatch(selectVehicleModel(v.model));
      if (v.year !== undefined) dispatch(selectVehicleYear(v.year));
    }
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

