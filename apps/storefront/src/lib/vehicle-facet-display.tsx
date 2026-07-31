// vehicle-facet-display.tsx — #306-b:把「這台車的件數」餵給分類 / 品牌面板的 client 側。
//
// 取數層在 `lib/vehicle-facet-counts.ts`(server-only)+ `api/catalog/facet-counts`;本檔是它的
// 消費端:一支 hook(選好車就去拿)+ 一個解析器(每一格該顯示什麼)。
//
// 🔴 副檔名 `.tsx` 而非 `.ts`:repo eslint 的 react-hooks plugin glob 只掛
//    `apps/storefront/**/*.tsx`,含 hook 的檔要 `.tsx` 才受 rules-of-hooks / exhaustive-deps 保護
//    (對齊 `components/products-url-state.tsx` 檔頭同一條理由)。
//
// 🔴 車輛以 **URL 的 `?vehicle=` slug** 為輸入,不從 cascade state 自己再組一次 slug:
//    商品列表的件數就是 server 依同一個 URL 算出來的 ⇒ 用同一個字串當輸入,
//    「面板數字」與「點進去的件數」才有結構性保證,而不是靠兩套邏輯抄得一樣。
//    (`useVehicleUrlSync` 走 `router.replace` ⇒ `useSearchParams()` 會跟著更新。)
//    副作用:長版書籤 `?brand=&model=` 沒有 `?vehicle=` ⇒ 拿不到件數 ⇒ 退回不顯示(fail-safe)。

import { useEffect, useState } from 'react';

import { CATEGORY_PATH_SEP } from '@/components/products-filter-logic';

export type VehicleFacetCounts = {
  categories: Record<string, number>;
  brands: Record<string, number>;
};

/** 分類的 facet key = 大類名 或 `大類 · 子類`(與 route 的 `categoryFacetKeys` 同字面)。 */
export function facetCategoryKey(mainName: string, subName?: string): string {
  return subName ? `${mainName}${CATEGORY_PATH_SEP}${subName}` : mainName;
}

/** 回 `null` = 這一格不顯示件數(不是 0)。 */
export type FacetCountResolver = (
  bucket: 'categories' | 'brands',
  key: string,
  serverCount: number | null | undefined,
) => number | null;

/**
 * 每一格該顯示什麼:
 *   - 沒選車 → 沿用 server 帶下來的全站數(現況、零額外查詢)
 *   - 選了車但件數還沒回來 / 取數失敗 → **不顯示**(寧可不給,也不給錯的 —— 這正是 #306 的病灶)
 *   - 選了車且有這個 key → 真實件數(0 就是 0,由呼叫端灰掉並停用)
 *   - 選了車但**沒有**這個 key → 不顯示。🔴 不可當成 0:key 可能是被 route 的分類白名單
 *     濾掉的(名稱含 LIKE 萬用字元),那是「算不出來」不是「沒有商品」。
 */
export function makeFacetCountResolver(
  hasVehicle: boolean,
  counts: VehicleFacetCounts | null,
): FacetCountResolver {
  return (bucket, key, serverCount) => {
    if (!hasVehicle) return serverCount ?? null;
    if (!counts) return null;
    const value = counts[bucket][key];
    return value === undefined ? null : value;
  };
}

function isVehicleFacetCounts(value: unknown): value is VehicleFacetCounts {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<VehicleFacetCounts>;
  return typeof candidate.categories === 'object' && typeof candidate.brands === 'object';
}

/**
 * 選好車就去把件數算回來(Sean Q3=A:桌機手機同一套機制、不做裝置分支)。
 *
 * 🔴 換車時先清成 `null` 再抓:舊車的件數留在畫面上比「沒有數字」更誤導。
 * 🔴 非 2xx / 網路失敗 / abort 一律維持 `null` ⇒ 面板不顯示件數 = #306 之前的現況(fail-safe)。
 */
export function useVehicleFacetCounts(vehicleSlug: string | null): VehicleFacetCounts | null {
  const [counts, setCounts] = useState<VehicleFacetCounts | null>(null);

  useEffect(() => {
    setCounts(null);
    if (!vehicleSlug) return;
    const controller = new AbortController();
    fetch(`/api/catalog/facet-counts?vehicle=${encodeURIComponent(vehicleSlug)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (isVehicleFacetCounts(data)) setCounts(data);
      })
      .catch(() => {
        // abort(換車)或網路失敗 ⇒ 什麼都不做,維持不顯示件數
      });
    return () => controller.abort();
  }, [vehicleSlug]);

  return counts;
}
