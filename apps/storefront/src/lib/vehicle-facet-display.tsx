// vehicle-facet-display.tsx — #306-b:把「這台車的件數」餵給分類 / 品牌面板的 client 側。
//
// 取數層在 `lib/vehicle-facet-counts.ts`(server-only)+ `api/catalog/facet-counts`;本檔是它的
// 消費端:一支 hook(選好車就去拿)+ 一個解析器(每一格該顯示什麼)。
//
// 🔴 副檔名 `.tsx` 而非 `.ts`:repo eslint 的 react-hooks plugin glob 只掛
//    `apps/storefront/**/*.tsx`,含 hook 的檔要 `.tsx` 才受 rules-of-hooks / exhaustive-deps 保護
//    (對齊 `components/products-url-state.tsx` 檔頭同一條理由)。
//
// 🔴 車輛以 **URL** 為輸入,不從 cascade state 自己再組一次:商品列表的件數就是 server 依同一個
//    URL 算出來的 ⇒ 用同一個來源,兩個數字才不會分屬兩個時間軸。
//    (`useVehicleUrlSync` 走 `router.replace` ⇒ `useSearchParams()` 會跟著更新。)
//
// 🔴 **長版書籤 `?brand=&model=` 必須一起認**(codex 關卡2 C1、已自行查證):
//    server 端 `products/page.tsx:60` 把長版**當車**、商品列表是該車的;若這裡只讀 `?vehicle=`
//    就會判定「沒車」⇒ **顯示全站數**(不是「不顯示」)= #306 的病灶本身。
//    改用既有的 `vehicleUrlParam()`(短版直出、長版合成),長版合成出的字串會被 route 的形狀
//    白名單擋下 ⇒ 件數拿不到 ⇒ 不顯示,這才是要的 fail-safe。
//
// 🔴 **「面板數字 = 點進去的件數」只在沒有其他篩選時成立**(codex C1 / Claude n3):
//    facet 刻意只吃「車輛 + 該面板自己那一維」(Sean 拍板的語意),而列表會再疊已選分類 /
//    品牌 / 價格 ⇒ 已勾品牌時,某分類顯示 39、點下去可能更少甚至 0。
//    **不得宣稱兩者恆等**;0 件停用只能保證「這台車在這個分類真的沒有」,不能保證點下去非空。

import { useEffect, useMemo, useState } from 'react';

import { CATEGORY_PATH_SEP } from '@/components/products-filter-logic';
import { vehicleUrlParam, type SearchParamsLike } from '@/lib/vehicle-url';

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
  // 🔴 state 連同「這份數字是哪一台車的」一起存(codex 關卡2 C2):
  //    abort **不保證**撤銷「已經進入完成序列」的 promise —— A 車的 `res.json()` 若已 resolve、
  //    它的 `.then` 仍可能在切到 B 車之後才執行 ⇒ A 的數字被寫到 B 車上,而且 B 若隨後 503
  //    就會**永久**掛著 A 的數字。只靠 abort 擋不住,必須在寫入前核對 owner。
  const [state, setState] = useState<{ slug: string; counts: VehicleFacetCounts } | null>(null);

  useEffect(() => {
    if (!vehicleSlug) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    let active = true; // cleanup 先失效、再 abort(兩道獨立防線)
    fetch(`/api/catalog/facet-counts?vehicle=${encodeURIComponent(vehicleSlug)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (active && isVehicleFacetCounts(data)) setState({ slug: vehicleSlug, counts: data });
      })
      .catch(() => {
        // abort(換車)或網路失敗 ⇒ 什麼都不做,維持不顯示件數
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [vehicleSlug]);

  // 🔴 render 期就比對 owner:換車那一幀 state 還是舊車的(setState 在 effect 裡、發生在 render 之後)
  //    ⇒ 直接讀 state 會有一幀掛著上一台車的數字(codex C2 的第二半)。
  return state !== null && state.slug === vehicleSlug ? state.counts : null;
}

/**
 * #306 給 `/products` 用的單一入口:URL → 件數 → resolver。
 *
 * 🔴 抽成 hook 而非留在 ProductsPage(codex 關卡2 C7):`ProductsPage.tsx` 已達 **405 行**、
 *    踩到鐵則 6 的 400 上限(我在 commit body 寫的 396 是上一版事實、加料後沒重數 = 字面漂移)。
 */
/**
 * 新品頁一律不顯示件數(Sean 2026-08-11 `Q21 = B`)。
 *
 * 🔴 為什麼不是「讓 facet 也吃新品篩選」:facet 的件數**刻意不疊其他篩選**
 *   (`vehicle-facet-counts.ts` 檔頭明載,那是 #306 的設計決定)⇒ 接上 `?filter=new` 之後,
 *   側欄會說「碳纖維部品 2,130」而列表只有 10 件。要讓數字對得上就得把 `p_new_since`
 *   灌進 facet 的 108 次 fan-out,而**沒選車那條路今天根本不呼叫 RPC**(讀 taxonomy 靜態 count)
 *   ⇒ 得為它新開一條算法,代價是沒選車時也要發 108 次查詢(今天是 0 次),
 *   還會推翻 #306 明文寫下的 facet 語意。
 * ⇒ 選擇不顯示。**這不是新狀態**:取數失敗時面板本來就是這樣(見上面 resolver 的 fail-safe)。
 */
const NO_COUNTS: FacetCountResolver = () => null;

export function useFacetCountResolver(searchParams: SearchParamsLike): FacetCountResolver {
  const vehicleSlug = vehicleUrlParam(searchParams);
  const isNewArrivals = searchParams.get('filter') === 'new';
  const counts = useVehicleFacetCounts(isNewArrivals ? null : vehicleSlug);
  return useMemo(
    () => (isNewArrivals ? NO_COUNTS : makeFacetCountResolver(vehicleSlug !== null, counts)),
    [isNewArrivals, vehicleSlug, counts],
  );
}
