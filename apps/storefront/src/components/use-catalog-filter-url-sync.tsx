// use-catalog-filter-url-sync.tsx — #341-B:從 `products-url-state.tsx` **原樣搬出**。
//
// 🔴 **純位移**:hook 本體一個字元都沒改,只換了住址。它是本 repo 最密的 race 修法聚集地
//    (#287 Next segment-key 碰撞 / #289 深連結還原波 / Q28① vehicle 讓路),
//    那些理由**正本就在下面的註解裡** —— 別的檔要提到它們請留單向指標指回這裡,不要複製第二份
//    (兩份會漂,而漂掉的症狀是「測試全綠、正式站偶發」)。
// 🔴 副檔名 `.tsx`:repo 的 eslint react-hooks plugin glob 只掛 `**/*.tsx`,含 hook 的檔必須是 .tsx
//    才受 rules-of-hooks / exhaustive-deps 保護(沿用原檔頭的理由,不是隨手選的)。
// 回歸鎖:`products-url-state.hooks.test.tsx`(**18 格**,窮舉:①②③⑤ = #287 品牌軸四案、
//    ④ = 單值 key 不得多餘 refresh、⑥⑦⑧⑨ = 分頁失效四案、⑩⑯ = #289 還原波(舊/新格式各一)、
//    ⑪⑫⑬⑭⑮ = #315 五案、⑰ = 碰撞守門判別力、⑱ = 條件式刪 page;4+1+4+2+5+1+1 = 18)。
//    🔴 這個數字 2026-08-11 由 15 改成 18(同日稍早由 11 改成 15;**原本的 11 就已經是錯的**、
//    實跑 10 —— R1 nit-2 抓到)。數法 = 該檔實跑的 `Tests N passed`,不是數 `it(` 也不是憑記憶。

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { CascadeFilterState } from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { ProductExtraFilters } from './filter-state';
import { resolveVehicleForUrl } from '@/lib/vehicle-url';
import {
  CATEGORY_URL_SEPARATOR,
  parseBrandFiltersFromUrl,
  parseCategoryFromUrl,
} from './products-url-parsers';
import { BRANDS_PARAM, LEGACY_BRAND_PARAM, parseBrandSlugsFromUrl } from '@/lib/catalog-query';


/**
 * query string 的「值」指紋(排序後比對,忽略參數順序)。
 * 重建品牌軸必然把它排到尾端,`?pbrands=x&page=2` → `?page=2&pbrands=x`,
 * 值同僅順序不同;字面比較會讓每次 props 抖動都多送一次導覽 + 多查一次全型錄。
 *
 * 🔴 **#287:品牌軸先收斂成同一種表示再比對**(舊格式 `?pbrand=a&pbrand=b` 與新格式
 *   `?pbrands=a,b` 視為相等)。少了這一步,#289 那個已修好的 bug 會原封不動回來:
 *   客人帶**舊格式**連結進站(`?pbrand=a&pbrand=b&page=2`)時,重建出來的 params 是新格式
 *   ⇒ 下方 :`if (normalizedQuery(...) === ...)` 的還原波早退**永遠不觸發**
 *   ⇒ 還原波被 `filtersChanged` 誤判成使用者操作 ⇒ `page` 被刪、且不會自癒。
 *   🔴 而站內連結全都會是新格式 ⇒ **我們自己怎麼點都測不出來**,只有客人手上的舊連結會踩。
 *   回歸鎖 = `products-url-state.hooks.test.tsx` 案例⑩(舊格式)與⑯(新格式)。
 * ⚠️ 收斂同時吃掉重複值(`?pbrand=dbk&pbrand=dbk` → `dbk`)⇒ 那種網址現在**連收斂導覽都不送**、
 *   原樣留在網址上(server 端 `parseCatalogQuery` 一樣去重,結果相同)。
 */
const normalizedQuery = (search: string) => {
  const params = new URLSearchParams(search);
  const brands = parseBrandSlugsFromUrl(params).sort();
  const entries = [...params.entries()].filter(
    ([key]) => key !== BRANDS_PARAM && key !== LEGACY_BRAND_PARAM,
  );
  if (brands.length > 0) entries.push([BRANDS_PARAM, brands.join(',')]);
  return JSON.stringify(
    entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]))),
  );
};

/** P4:品牌／分類／價格 UI state 變動時，寫入 URL 並讓 route 重跑 server catalog query。 */
export function useCatalogFilterUrlSync(
  cascade: CascadeFilterState,
  extras: ProductExtraFilters,
  // V-1a 還原窗口守衛的對照表(與 useDeepLinkRestore 同源清單;守窗口條件=「可還原」而非「參數存在」)
  restoreSources: {
    categories: { id: string; name: string; children?: { id: string; name: string }[] }[];
    productBrands: { id: string }[];
    // Q28① R1 MF-1:判斷 vehicle 這輪會不會被 useVehicleUrlSync 寫進 URL(見下方 hold 守衛)
    motoBrands: MockMotoBrand[];
  },
): void {
  const router = useRouter();
  const initialized = useRef(false);
  // 🔴 還原窗口守衛(V-1a;同 useVehicleUrlSync idiom):useDeepLinkRestore 的 dispatch 未 flush 前,
  // 本 effect 若以「state 還空、URL 帶可還原 category/pbrand」執行(StrictMode 第二次 invoke 會繞過
  // initialized 首輪守衛),會把 URL 上待還原的參數整組洗掉=返回/深連結分類丟失。
  // 規則:state 對應軸仍空且 URL 參數**可還原**(parse 命中對照表、對齊 vehicle idiom)且還原未消化
  // → skip;查無(改名殘連結等)=restore 永不來 → 不 hold、照常同步(price 等其他軸不得被吞);
  // state 首次非空=消化、之後才允許清。
  // 🔴 **本句 2026-08-11 #315 更正**:原字面是「垃圾參數同 vehicle 語意清掉」——那一半**已被推翻**。
  //   認不得的 pbrand/category 現在**留在 URL 上**(理由在下方寫回段)。本 hold 守衛本身一個字沒改:
  //   它判的仍是「可還原」(parse 命中對照表),未知值本來就不 restorable ⇒ 不 hold;
  //   #315 只改變**它放行之後**那一段怎麼重建 URL。兩件事不要混。
  const pendingRestoreRef = useRef<boolean | null>(null);
  // 🔴 2026-07-19 修「分頁失效」(既有 bug、已用基準版對照確認非品牌片引入;單元測試坐實根因):
  // 本 effect deps 含 `restoreSources`(ProductsPage 的 `useMemo(...,[categories,brands])`)→
  // server 每回新 props 就換 identity → effect 重跑 → 舊版**無條件** `delete('page')` 把使用者
  // 剛翻到的 `?page=2` 洗掉、內容退回第 1 頁(分頁 UI 卻停在第 2 頁)。目錄 512 頁形同翻不動。
  // 修法:改為只在**篩選值指紋變動**時才刪 page。
  // ⚠️ 指紋本身**無法區分**「使用者改篩選」與「深連結還原波」(`?pbrand=x&page=2` 進站時 restore
  //    dispatch 會讓指紋由空變非空);該缺口由 effect 內的「state 剛追上 URL 即收手」判斷補上
  //    (見下方 #289 段)。兩者合起來才完整,單獨留任一個都會讓 `?page=N` 深連結被吃掉頁碼。
  const lastFilterKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // 篩選值指紋(只取會寫進 URL 的軸;brands 排序後比對,避免順序抖動誤判為變動)
    const filterKey = JSON.stringify([
      cascade.category?.main ?? null,
      cascade.category?.sub ?? null,
      [...cascade.brands].sort(),
      extras.price ?? null,
      extras.priceRange ?? null,
    ]);
    const prevFilterKey = lastFilterKeyRef.current;
    lastFilterKeyRef.current = filterKey;
    const filtersChanged = prevFilterKey !== null && prevFilterKey !== filterKey;
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    // 🔴 Q28① R1 MF-1 —— vehicle 讓路守衛(本 effect 與 useVehicleUrlSync 的 replace 競態):
    //   `router.replace` 是 App Router 導覽、**非同步**(force-dynamic 要 RSC 往返才更新
    //   window.location)。Q28① 讓車可以從鏡入站 ⇒ 出現「cascade 有車、URL 還沒有」這個新狀態,
    //   而本 effect 這輪讀到的 `params` 是那份**尚未含 vehicle** 的舊網址 ⇒ 照它算出的 next
    //   一送出去,就把 useVehicleUrlSync 剛送出的那個 replace 覆蓋掉、`?vehicle=` 永久消失
    //   (兩支 hook 的 deps 此時都不會再變 ⇒ **不會自癒**)。終態=畫面顯示已選車、server 卻沒收到
    //   vehicle ⇒ 清單根本沒被車輛篩選,比不做這片更糟。
    //   ⚠️ 只在「URL 上有本 effect 會改寫的五軸、而 state 對不上」時才真的撞得到(否則下方 :196
    //   的等值早退會先收手);最短觸發=`/products?pmin=1000&pmax=5000` + 鏡有車(extras 從不從
    //   URL 還原,`filter-state.ts:63-71`)。長版 `?brand=&model=` 入站同形。
    //   讓路一輪即可:vehicle 的 replace 落地後 server 回新 props ⇒ restoreSources 換 identity
    //   ⇒ 本 effect 重跑,那時 `params` 已含 vehicle。
    //   🔴 判斷用與 useVehicleUrlSync **同一支** resolveVehicleForUrl:taxonomy 查無時它同樣不寫 URL,
    //   若這裡改用「cascade.vehicle 非 null」這種較寬的條件,那格會被永久 hold、分類/價格同步整個死掉。
    if (
      cascade.vehicle &&
      !params.has('vehicle') &&
      resolveVehicleForUrl(cascade.vehicle, restoreSources.motoBrands)
    ) {
      return;
    }
    const stateHasAny = cascade.category !== null || cascade.brands.length > 0;
    if (stateHasAny) {
      pendingRestoreRef.current = false; // 還原已消化(或使用者自選)
    } else if (pendingRestoreRef.current !== false) {
      const restorable =
        parseCategoryFromUrl(params, restoreSources.categories) !== null ||
        parseBrandFiltersFromUrl(params, restoreSources.productBrands).length > 0;
      if (restorable) {
        return; // 還原窗口:URL 參數待 restore dispatch flush、勿清
      }
    }
    // 🔴 #315(Sean 2026-08-11 Q1=A):URL 上**認不得**的 pbrand/category 原樣留著,不再清掉。
    //   理由:「垃圾參數」與「客人手打的舊連結/改名殘連結」在 URL 上長得一模一樣 —— 程式手上
    //   只有「在不在對照表裡」這一個位元(`products-url-parsers.ts:94` 的 `.filter`),**沒有任何
    //   欄位能分辨意圖**;而清掉的代價是**靜默顯示全站商品**(server 只驗形狀不驗對照表,
    //   `lib/catalog-query.ts:161`)⇒ 客人以為還在看 DBK。留著 = 0 筆 + 空狀態,看得見、可自我解釋。
    // 🔴 它同時是本修法的支點,而且方向是**更安全**不是更危險:保留後重建結果與當前 URL 在
    //   **值層等值**(`normalizedQuery` 排序後比對、忽略參數順序)⇒ 下方的等值早退通常命中
    //   ⇒ 連 `router.replace` 都不送。
    //   ⚠️ 「逐字相等」曾是**過度宣稱**(跨模型審查 F3 抓到):`?pbrand=dbk&pbrand=dbk` 這種重複鍵
    //     會被 `new Set` 收斂成一個,值層就不等 ⇒ 仍送一次收斂導覽。**#287 之後這格也不送了** ——
    //     `normalizedQuery` 現在會把品牌軸(含重複值)收斂成同一種表示才比對。
    //   ⚠️ 這裡**沒有新增任何 `params.set/delete`**(改的是同一次寫入的來源集合、以及把既有的
    //      delete 改成條件式)⇒ 下方「不得在等值比對之前再新增寫入」那條安全前提照舊成立。
    // 🔴 **對照表空的時候照樣保留**(= 不特別處理),這是想過的、不是漏的:
    //   `fetchCatalogBrandTaxonomy()` 撈失敗回 `[]` 而非 null(`lib/products.ts:531-536`),
    //   而 `ProductsPage.tsx:234` 是 `??` ⇒ `[]` 不觸發 fallback ⇒ 中斷期對照表真的是空的。
    //   但**商品過濾不吃這張表**:品牌條件走 `search_catalog_by_vehicle` 的 `p_brand_slugs`
    //   (`lib/products.ts:402`),與 `catalog_brand_counts`(:543)是**兩支不同的 RPC**
    //   ⇒ 側欄品牌清單掛掉時,有效品牌照樣正確過濾。
    //   ⇒ 空表時「照樣保留」= 網址原封不動、server 照常篩對;若反過來在空表時停用保留,
    //     客人一動篩選,**有效**的 pbrand 會被刪掉 ⇒ 靜默顯示全站 = #315 這個病本身,
    //     而且表恢復後**不會自癒**(值已經不在網址上了)。
    //   ⚠️ 這道守衛我真的加過(R1 nit-4),被跨模型 adversarial 輪擊破後拆掉 —— 前提「中斷期
    //     帶品牌網址會被釘 0 筆」是假的,錯在只驗了「表會是空的」卻沒驗「空表會不會影響查詢」。
    // 🔴 #287:讀進來時新舊格式都吃(客人的舊連結、站內品牌頁連結仍是舊格式),**寫出去只產新格式**
    //   `?pbrands=a,b` —— 單值鍵讓每個品牌組合的 Next segment cache key 天然不同,
    //   結構上消掉下方那個「碰撞才補 refresh」的觸發條件(理由正本在 `lib/catalog-query.ts`)。
    const knownBrandIds = new Set(restoreSources.productBrands.map((b) => b.id));
    const unknownBrands = parseBrandSlugsFromUrl(params).filter((slug) => !knownBrandIds.has(slug));
    params.delete(LEGACY_BRAND_PARAM);
    params.delete(BRANDS_PARAM);
    const brandSlugs = [...new Set([...cascade.brands, ...unknownBrands])].sort();
    if (brandSlugs.length > 0) params.set(BRANDS_PARAM, brandSlugs.join(','));
    const category = cascade.category?.sub
      ? `${cascade.category.main}${CATEGORY_URL_SEPARATOR}${cascade.category.sub}`
      : cascade.category?.main;
    if (category) params.set('category', category);
    // state 沒有分類時,只有「URL 那個值**認得出來**」(= 使用者剛把篩選清掉)才刪;認不得的留著。
    else if (parseCategoryFromUrl(params, restoreSources.categories) !== null) params.delete('category');
    if (extras.price) params.set('price', extras.price);
    else params.delete('price');
    if (extras.priceRange) {
      params.set('pmin', String(extras.priceRange[0]));
      params.set('pmax', String(extras.priceRange[1]));
    } else {
      params.delete('pmin');
      params.delete('pmax');
    }
    // 🔴 #289:先用「**尚未刪 page**」的版本比對——若它已等於當前 URL,代表 state 只是**剛追上
    //    URL**(深連結還原波:`?pbrand=x&page=2` 進站,restore dispatch 讓 state 由空變非空),
    //    🔴 安全前提(勿破壞):`params` 是 `window.location.search` 的原樣拷貝,本 effect 只改寫
    //    品牌軸(`pbrands` + 舊的 `pbrand`)/category/price/pmin/pmax 五軸;外來鍵
    //    (vehicle/sort/per/filter/from)兩側恆等,故此比對 ⟺「五軸已全數與 state 一致」。
    //    **不得**在本行之前再新增任何 `params.set/delete`。
    //    URL 本來就是正確結果 → 直接收手。缺這道判斷時,還原波會被 `filtersChanged` 誤判為
    //    使用者操作而刪掉 page:實測終態 = 內容第 1 頁 + 分頁 UI 停在第 2 頁、且**不會自癒**
    //    (`useBrowseUrlSync` deps 此時全未變、effect 不重跑,page 永不寫回)。
    if (normalizedQuery(window.location.search) === normalizedQuery(params.toString())) return;
    // 篩選指紋變動才回第 1 頁;server 回新 props 造成的 effect 重跑(指紋未變)不得洗掉頁碼。
    // 🔴 `page` 的**權威寫入者是 `useBrowseUrlSync`**;此處刪除只為省掉「先用舊頁碼查一次再被
    //    更正」的往返。⚠️ `filterKey` 是 `usePageResetOnFilterChange` key 的**刻意子集**——不含
    //    vehicle/sort/perPage(那些由 useBrowseUrlSync 收);兩者本就不同步、非漂移(R2 nit-1)。
    //    新增**會寫進本 effect URL** 的軸時才需同步 `filterKey`,代價是多一次往返、非停在舊頁碼。
    if (filtersChanged) params.delete('page');
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    // 🔴 #287 實作首件(plan §6 標為「沒驗」的那條):`normalizedQuery` 收斂品牌軸之後,**這一處
    //    比較的語意沒有變**。理由:走得到本行 ⟺ 上方那次比較已判定「不等」,而兩次比較之間唯一
    //    的差別只有「可能刪掉了 page」—— 刪東西不會把既有的差異變不見。
    // ⚠️ **推論的另一面要講清楚:這個 `if` 因此恆為真 = 它今天沒有判別力**(構造不出讓它為假的
    //    輸入,所以也寫不出會紅的負測 —— 拿掉它零測試變化)。留著的理由是可讀性與防禦:
    //    上方那段若日後被改成「某些情況不早退」,本行就是最後一道「沒差別就不要送導覽」。
    //    ⇒ 不要把它當成一道**有效的**守門引用,也不要因為「有這行」而放心刪上面那段。
    if (normalizedQuery(window.location.search) !== normalizedQuery(next.split('?')[1] ?? '')) {
      // 🔴 2026-07-19 修「取消其中一個品牌,該品牌商品不消失」(Sean 回報)。全貌 = backlog #287。
      // 根因(實測 + 讀 node_modules 內 Next 16.2.6 原始碼坐實):`route-params.js`
      // `getCacheKeyForDynamicParam` 以 `Object.fromEntries(new URLSearchParams(...))` 產 page
      // segment key → **重複 key 只留最後值** → 兩個不同的網址可能拿到同一個 key → replace
      // 判定同一 segment、重用舊 CacheNode、零 RSC 請求 → 畫面停在舊清單。
      // 🔴 **2026-08-11 #287 落地後,品牌軸已不可能再碰撞**:寫出端改成單值鍵 `?pbrands=a,b`,
      //    每個組合的 key 天然不同(結構上消除,而非偵測後補救)⇒ 品牌篩選恆一次查詢。
      // 🔴 **這道守門仍然留著,而且不是死碼**:重複鍵可以來自我們寫不出來、但客人網址上真的會有的
      //    形狀 —— 例如手打/外站來的 `?category=A&category=B`。server 端讀的是**第一個**值
      //    (`catalog-query.ts` 的 `searchParams.get`),而 segment key 取的是**最後一個**;
      //    使用者把分類切成 B 時,新舊網址的 segment key 同為 `{category:B}`、內容卻該變
      //    ⇒ 沒有這次 refresh 就會停在舊清單。判別力守門 = 測試案例⑤(拿掉 refresh 那一行才會紅)。
      // 🔴 必須**條件式**:單值 key 天然不碰撞,無條件 refresh 會讓每次切分類/拉價格都對全型錄
      //    多查一次(R1 must-fix-2)。
      // ⚠️ 已實測否決:native `replaceState` + refresh() **沒有修好**(不更新 Next canonical URL)。
      // 🔴 依賴 Next 內部實作,升級須重跑實測(E2E 守門 = #288)。
      const segmentKey = (search: string) =>
        JSON.stringify(Object.fromEntries(new URLSearchParams(search)));
      const collides =
        segmentKey(window.location.search) === segmentKey(next.split('?')[1] ?? '');
      router.replace(next, { scroll: false });
      if (collides) router.refresh();
    }
  }, [cascade, extras, restoreSources, router]);
}
