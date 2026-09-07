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
export function useVehicleFacetCounts(vehicleSlug: string | null): {
  counts: VehicleFacetCounts | null;
  failed: boolean;
} {
  // 🔴🔴 **2026-09-07 ⟦search-SILENTDOORS2⟧:回傳從 `counts` 變成 `{ counts, failed }`。**
  //   ⛔ ~~`: VehicleFacetCounts | null`~~ —— 那個 `null` **同時代表三個世界**:
  //     ①沒選車 ②還在抓 ③抓失敗 ⇒ 📌 **而畫面只能對其中一個說話。**
  //   🛑 **今天的行為是對【三個都不說】** ⇒ `facet-counts` 回 503 時, 側欄的件數**整批消失**
  //     而客人那一側**什麼都沒有** —— 那正是本列在講的那扇門。
  //   ⇒ ✅ `failed` 把第 ③ 個世界**分出來**, 讓呼叫端印得出一句話。
  //   ⚠️ **`failed` 也要核 owner**(與 `state` 同一個理由):換車那一幀若讀到上一台車的失敗,
  //     客人會在一台好好的車上看到錯誤訊息。
  // 🔴 state 連同「這份數字是哪一台車的」一起存(codex 關卡2 C2):
  //    abort **不保證**撤銷「已經進入完成序列」的 promise —— A 車的 `res.json()` 若已 resolve、
  //    它的 `.then` 仍可能在切到 B 車之後才執行 ⇒ A 的數字被寫到 B 車上,而且 B 若隨後 503
  //    就會**永久**掛著 A 的數字。只靠 abort 擋不住,必須在寫入前核對 owner。
  const [state, setState] = useState<{ slug: string; counts: VehicleFacetCounts } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleSlug) {
      setState(null);
      setFailedFor(null);
      return;
    }
    setFailedFor(null); // 換車 ⇒ 先清掉上一台車的失敗, 不要讓它掛在新車上
    const controller = new AbortController();
    let active = true; // cleanup 先失效、再 abort(兩道獨立防線)
    fetch(`/api/catalog/facet-counts?vehicle=${encodeURIComponent(vehicleSlug)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        // 🔴🔴 **`4xx` 與 `5xx` 是兩件事, 而 route 自己就這樣分**(code-reviewer must-fix 1):
        //   ⛔ ~~`if (!res.ok) setFailedFor(...)`~~ —— 那會把 **400 也算成故障**。
        //   🔬 `api/catalog/facet-counts/route.ts:15` 逐字:三道白名單「任一不過 → 400,
        //     client 端退回『不顯示件數』= #306 之前的現況(**fail-safe**)」;
        //     `:74-75` 逐字再分一次:「400 = **永久錯誤語意**、client 不知道該重試 / 503 = 這次讀不到」。
        //   🛑 **失敗情境**:舊書籤的車型下架、或型錄重匯後年份收斂(`lib/vehicle-url.ts:90-96` 記的正是這個)
        //     ⇒ route 回 `unknown_model` / `unknown_year` **400** ⇒ 客人在一頁**沒壞**的畫面上
        //     **永久**看到「件數**暫時**無法顯示」—— 📌 **一句永遠不會消失的「暫時」。**
        //   ⇒ ✅ 只有 **5xx** 進畫面;4xx 留一行 log(它是我們自己的白名單擋下的, 不是故障)。
        if (!res.ok) {
          if (res.status >= 500) {
            if (active) setFailedFor(vehicleSlug);
          } else {
            console.error(
              `[useVehicleFacetCounts] facet-counts 回 ${res.status}(白名單擋下)⇒ 不顯示件數, 而【不】對客人說故障`,
            );
          }
          return null;
        }
        return res.json();
      })
      .then((data: unknown) => {
        if (!active) return;
        if (isVehicleFacetCounts(data)) {
          setState({ slug: vehicleSlug, counts: data });
          return;
        }
        // 🔴 **回了 2xx 而形狀認不得, 也是失敗** —— 否則「契約變了」會退化成「沒有數字」而無聲。
        if (data !== null) setFailedFor(vehicleSlug);
      })
      .catch((err: unknown) => {
        // ⛔ ~~`.catch(() => {})` 什麼都不做, 維持不顯示件數~~(2026-09-07 ⟦search-SILENTDOORS2⟧)
        // 🛑 **`abort` 不是失敗** —— 它是換車時我們自己取消的, 對它印錯誤會在每次換車都閃一下。
        //   ⇒ 這是本片唯一必須分開的兩種「進到 catch」的原因。
        const aborted =
          typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
        if (active && !aborted) setFailedFor(vehicleSlug);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [vehicleSlug]);

  // 🔴 render 期就比對 owner:換車那一幀 state 還是舊車的(setState 在 effect 裡、發生在 render 之後)
  //    ⇒ 直接讀 state 會有一幀掛著上一台車的數字(codex C2 的第二半)。
  return {
    counts: state !== null && state.slug === vehicleSlug ? state.counts : null,
    // 🔴 與 `state` 同一條 owner 規則:失敗也只對【當下這台車】成立。
    failed: failedFor !== null && failedFor === vehicleSlug,
  };
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

export function useFacetCountResolver(searchParams: SearchParamsLike): {
  countOf: FacetCountResolver;
  countsFailed: boolean;
} {
  const vehicleSlug = vehicleUrlParam(searchParams);
  const isNewArrivals = searchParams.get('filter') === 'new';
  const { counts, failed } = useVehicleFacetCounts(isNewArrivals ? null : vehicleSlug);
  const resolver = useMemo(
    () => (isNewArrivals ? NO_COUNTS : makeFacetCountResolver(vehicleSlug !== null, counts)),
    [isNewArrivals, vehicleSlug, counts],
  );
  // 🔴 **新品頁不算失敗**:那一頁本來就不顯示件數(Sean 2026-08-11 `Q21 = B`)
  //   ⇒ 對它印 `FACET_COUNTS_UNAVAILABLE` 那句話, 會把一個**刻意的設計**說成故障。
  //   🔵 **這裡刻意寫【常數名】而不是把那句話抄一份** —— `products-message-state.test.tsx`
  //     有一格守「該字面在非測試檔裡只有定義處一支」, 而我第一版把它抄進註解 ⇒ **那格當場紅**。
  //     📌 **一句被抄進註解的文案, 對「只有一個定義處」這種守門而言與真的多一份沒有差別。**
  return { countOf: resolver, countsFailed: !isNewArrivals && failed };
}
