// use-catalog-filter-url-sync.tsx — #341-B:從 `products-url-state.tsx` **原樣搬出**。
//
// 🔴 **純位移**:hook 本體一個字元都沒改,只換了住址。它是本 repo 最密的 race 修法聚集地
//    (#287 Next segment-key 碰撞 / #289 深連結還原波 / Q28① vehicle 讓路),
//    那些理由**正本就在下面的註解裡** —— 別的檔要提到它們請留單向指標指回這裡,不要複製第二份
//    (兩份會漂,而漂掉的症狀是「測試全綠、正式站偶發」)。
// 🔴 副檔名 `.tsx`:repo 的 eslint react-hooks plugin glob 只掛 `**/*.tsx`,含 hook 的檔必須是 .tsx
//    才受 rules-of-hooks / exhaustive-deps 保護(沿用原檔頭的理由,不是隨手選的)。
// 回歸鎖:`products-url-state.hooks.test.tsx`(⛔ ~~**18 格**~~ ⇒ ✅ **25 格**;2026-09-04 實跑
//    `Tests 25 passed` 訂正 —— 18 之後有人加過而沒改這裡,本片再 +4(㉒㉓㉔㉕)。舊字面留刪除線)(窮舉:①②③⑤ = #287 品牌軸四案、
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
import {
  BRANDS_PARAM,
  CATEGORIES_PARAM,
  LEGACY_BRAND_PARAM,
  parseBrandSlugsFromUrl,
} from '@/lib/catalog-query';


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
// 🔴🔴 ⟦search-REDUNDANTREPLACE⟧(主視窗-94 2026-09-05 拍乙):**分類軸也要收斂。**
//   病:`⟦search-SHORTNAMEZEROFLASH⟧` 之後 server 自己把**裸子分類名**(`?category=攝影機支架`)
//   解成全路徑, 而下方回寫段仍然無條件用 `${main} · ${sub}` 重建 ⇒ 兩邊字面不等
//   ⇒ 等值早退不命中 ⇒ 多送一次 `router.replace`, 而同一輪 `filtersChanged` 為真
//   ⇒ 🎯 **`page` 被一起刪掉:客人帶 `?page=2` 進站, 首發真的看到第 2 頁, 然後被打回第 1 頁。**
//   🔬 鑽機 2026-09-05 四格實走:裸子名 ⇒ 網址被改寫 · 裸子名+`page=2` ⇒ 改寫且 page 掉;
//      🟢 全路徑那兩格(負對照)**兩個都沒變** ⇒ 差別只有分類名是裸的還是全的。
//   ✅ 修法 = 在**比對這一層**把「裸子名」與「它解出來的全路徑」視為同一個篩選。
//   🛑 **而這是「把比對改寬」, 板列曾逐字警告過這條路** —— 方向的理由寫在這裡:
//      那道早退 firing **更多**是往**安全**走 —— #289 那個「不會自癒」的終態是它
//      **沒有** firing 時產生的(見 `products-url-state.hooks.test.tsx` ⑩⑯)。
//   🔴 **`categories` 是 optional, 而那不是隨手加的**:缺它時**行為與本片之前逐字相同**
//      (分類軸不收斂)⇒ 沒有呼叫端會因為漏傳而靜靜改變行為。
//   ⚠️ **認不得的值不收斂**:`parseCategoryFromUrl` 回 null 時原樣留著 —— 那是 #315
//      刻意的政策(Sean 2026-08-11 Q1=A), 收斂它會讓「垃圾參數」與「使用者剛清掉」變同一件事。
//      回歸鎖 = 同檔 ㉗。
const normalizedQuery = (
  search: string,
  // 🔵 與 hook 參數 `restoreSources.categories` 同一個形狀 —— 這裡【複述】而不是 import 一個型別,
  //    理由是那個型別今天是 hook 簽章裡的行內物件、沒有名字。⚠️ 兩邊漂掉時 typecheck 會叫。
  categories?: { id: string; name: string; children?: { id: string; name: string }[] }[],
) => {
  const params = new URLSearchParams(search);
  const brands = parseBrandSlugsFromUrl(params).sort();
  // 🔴🔴 **收斂的射程窄到只剩【裸子分類名】這一種, 而那是被一格既有的測試逼出來的。**
  //   ⛔ 我的第一版是「只要解得出來就換成全路徑」⇒ **⑧「分類變動 → 必須刪 page」當場紅。**
  //   🔬 成因:`RESTORE_SOURCES` 那棵樹的 `children` 是**空的** ⇒ `操控部品 · 腳踏後移與傳動`
  //      解析時 sub 找不到 ⇒ `parseCategoryFromUrl` **回一個【沒有 sub】的結果**
  //      ⇒ 兩邊都收斂成 `操控部品` ⇒ 判定相等 ⇒ 早退 ⇒ **一個真的分類變動被吞掉。**
  //   ⇒ 🎯 **收斂會【丟資訊】, 而丟掉的那一半在字面上看不出來。**
  //      而那不只是測試的假樹:taxonomy RPC 中斷時樹就是空的(見同檔 ⑮ 的病史)
  //      ⇒ **中斷期客人動篩選, 網址會靜靜不更新。**
  //   ✅ 所以只在**兩個條件同時成立**時才收斂:①原始值**不含分隔符**(= 它是裸名)
  //      ②解出來的東西**有 sub**(= 它真的是某個父的子)。其餘一律原樣保留。
  //   📌 **判別句:收斂之後那個字串, 是不是還帶著原本那個值的全部資訊?**
  const rawCategory = params.get('category');
  const resolvedCategory = categories ? parseCategoryFromUrl(params, categories) : null;
  const canonicalCategory =
    rawCategory !== null &&
    !rawCategory.includes(CATEGORY_URL_SEPARATOR) &&
    resolvedCategory?.sub
      ? `${resolvedCategory.main}${CATEGORY_URL_SEPARATOR}${resolvedCategory.sub}`
      : null;
  const entries = [...params.entries()].filter(
    ([key]) =>
      key !== BRANDS_PARAM &&
      key !== LEGACY_BRAND_PARAM &&
      !(canonicalCategory !== null && key === 'category'),
  );
  if (brands.length > 0) entries.push([BRANDS_PARAM, brands.join(',')]);
  if (canonicalCategory !== null) entries.push(['category', canonicalCategory]);
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
  // 🔴 **「我上次【真的寫出去】的那一顆分類」**(2026-09-05 · Sean `21`「把多顆分類修好」)。
  //   ⚠️ **不可以用 `lastFilterKeyRef` 代替** —— 它在下面【無條件更新】, 而它之後有
  //      **三個提早 return**(`initialized` / vehicle 讓路 / restore-hold)
  //      ⇒ 那些波會把「變動」吃掉, **而且不自癒**(R1 對抗審查抓到, 逐字複驗成立)。
  //   ✅ 本 ref **只在真的送出 `router.replace` 之後才寫**, 所以被吃掉的波下一次還看得到。
  //   🔴 型別一律 `string | null`(**不是 `undefined`**):`cascade.category?.main` 是
  //      `string | undefined`, 而 `undefined !== null` **恆真** ⇒ 空世界每一波都會被判成
  //      「使用者自選」(R2 對抗審查抓到, 逐字複驗成立)⇒ 下面一律先 `?? null`。
  const lastWrittenCategoryRef = useRef<string | null>(null);
  // 🔴 **送出去了、而還不知道有沒有落地的那一顆**(codex R3 ③)。
  //   由上面那段在【下一波開頭】比對真實網址之後, 才升成 `lastWrittenCategoryRef`。
  const pendingWrittenCategoryRef = useRef<string | null>(null);
  // 🔴 把 `CategorySelection` 壓成**網址上那一顆的字面** —— 與寫入段那三行**同一個規則**。
  //   ⚠️ `parseCategoryFromUrl` 回的是**物件**(`{mainId, main, subId?, sub?}`)不是字串;
  //      2026-09-05 我第一版直接拿它跟字串比 ⇒ **typecheck 兩處紅**(TS2322 / TS2367)。
  //      ⇒ 📌 那一紅是好的:兩個「分類」在型別上本來就不是同一種東西, 而我用同一個名字想它。
  const toUrlCategory = (c: CascadeFilterState['category']): string | null =>
    c === null ? null : c.sub ? `${c.main}${CATEGORY_URL_SEPARATOR}${c.sub}` : c.main;
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
      // 🔴 **初值用【進站網址】播種, 不留 `null`** —— 否則深連結
      //   `?categories=A,B&category=X` 進站時, 還原落地那一波 derived `"X"` !== `null`
      //   ⇒ 被判成「使用者自選」⇒ 寫入 ⇒ `filtersChanged` 為真 ⇒ **`page` 被刪**
      //   (⑩⑯㉕ 那一族;R2 對抗審查 must-fix)。
      lastWrittenCategoryRef.current = toUrlCategory(
        parseCategoryFromUrl(new URLSearchParams(window.location.search), restoreSources.categories),
      );
      return;
    }
    const params = new URLSearchParams(window.location.search);
      // 🔴 **先把「上一發送出去的」與【真實網址】對一次** —— 落地了才升成 committed(R3 ③/①)。
      //   `router.replace()` 回來只代表【已呼叫】;Next 靜默忽略時網址不會變。
      //   🛑 **沒落地就不升** ⇒ 下一波仍判「自選」而重送 ⇒ **不會被永久吞掉**。
      if (pendingWrittenCategoryRef.current !== null) {
        const pend = pendingWrittenCategoryRef.current;
        const inMulti = (params.get(CATEGORIES_PARAM) ?? '')
          .split(',')
          .map((v) => v.trim())
          .includes(pend);
        if (inMulti || params.get('category') === pend) {
          lastWrittenCategoryRef.current = pend;
          pendingWrittenCategoryRef.current = null;
        }
      }
      // 🔵 **瀏覽器上一頁 / 外部導覽**:網址上已經沒有我 committed 的那一顆 ⇒ ref 跟著退回(R3 ①)。
      //   不退的話, 客人退回舊頁再選同一個分類會被判「未變」而漏掉那一次 union。
      const committed = lastWrittenCategoryRef.current;
      if (
        committed !== null &&
        !(params.get(CATEGORIES_PARAM) ?? '')
          .split(',')
          .map((v) => v.trim())
          .includes(committed) &&
        params.get('category') !== committed
      ) {
        lastWrittenCategoryRef.current = null;
      }
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
    //   `lib/catalog-query.ts` 的 `parseCatalogQuery` docblock)⇒ 客人以為還在看 DBK。留著 = 0 筆 + 空狀態,看得見、可自我解釋。
    // 🔴 它同時是本修法的支點,而且方向是**更安全**不是更危險:保留後重建結果與當前 URL 在
    //   **值層等值**(`normalizedQuery` 排序後比對、忽略參數順序)⇒ 下方的等值早退通常命中
    //   ⇒ 連 `router.replace` 都不送。
    //   ⚠️ 「逐字相等」曾是**過度宣稱**(跨模型審查 F3 抓到):`?pbrand=dbk&pbrand=dbk` 這種重複鍵
    //     會被 `new Set` 收斂成一個,值層就不等 ⇒ 仍送一次收斂導覽。**#287 之後這格也不送了** ——
    //     `normalizedQuery` 現在會把品牌軸(含重複值)收斂成同一種表示才比對。
    //   ⚠️ 這裡**沒有新增任何 `params.set/delete`**(改的是同一次寫入的來源集合、以及把既有的
    //      delete 改成條件式)⇒ 下方「不得在等值比對之前再新增寫入」那條安全前提照舊成立。
    // 🔴 **對照表空的時候照樣保留**(= 不特別處理),這是想過的、不是漏的:
    //   `fetchCatalogBrandTaxonomy()` 撈失敗回 `[]` 而非 null,
    //   🔴 **這裡不寫行號**(2026-08-27 線E):原本寫 `lib/products.ts:531-536`,而它已經漂到 :590;
    //     我改對之後【自己那一顆 commit 又把它推到 :612】—— 兩次都是同一個病。
    //     ⇒ 用**函式名**當錨,`grep -n 'function fetchCatalogBrandTaxonomy' apps/storefront/src/lib/products.ts`。
    //     📌 一條過期的行號不會讓假設失效,但會讓下一個人找不到它 ——
    //        而它上面那句「撈失敗回 [] 而非 null」**現在仍然成立**:
    //        線E 新增的 `tryCatalogBrandTaxonomy()` 是另一支,對外這支的簽章與行為 byte 不變。
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
    // 🔴 ⟦search-CHIPDELETEDEADURL⟧(2026-09-04, Sean 拍甲):網址上**已經有 `categories`** 時,
    //   本 effect **完全不碰分類軸**(`category` 的 set 與 delete 都不做)。
    //   成因是量到的、不是推的:`cascade.category` **是單值的** —— 下面那三行只拼得出**一個**字串,
    //   它結構上沒有「多顆」這個概念。多顆狀態下, 膠囊送出的乾淨網址(`?categories=A`)會被這裡
    //   依 cascade 仍握著的那一顆**寫回 `category=A`** ⇒ 📌 **刪膠囊的按鈕按了沒反應。**
    //   ⚠️ 已知代價(**刻意接受, 不是漏掉**;正本 = 板列 `⟦search-CASCADEINMULTI⟧`):
    //   ① 多顆狀態下再用側邊欄選分類, 這裡寫不進網址。**2026-09-04 鑽機當場按過, 代價是真的**
    //     (負對照 = 網址無 `categories` 時同一按活的 ⇒ 那一按本身沒壞, 壞的是這個世界)。
    //   ⛔ ~~② 代價比①寬:`page`/`search`/`unmatched` 三個 delete 一起不跑~~
    //     ⇒ ✅ **2026-09-04 當天就修掉了, 不再是代價**(主視窗-94 裁「一起做」):
    //     那不是範圍擴張, 是**守衛形狀畫寬了** —— 守衛只該擋住分類軸那兩行。
    //     修法 = 下方等值早退加 `!categoryAxisSuppressed`。舊字面留刪除線, 讓搜「三個 delete
    //     一起不跑」的人同一發撞到訂正。⇒ **代價現在只剩①。**
    //   🛑 **不要改成「從 cascade 推出 `categories`」** —— 上面那句「單值」讓那條路結構上不可能對。
    const category = cascade.category?.sub
      ? `${cascade.category.main}${CATEGORY_URL_SEPARATOR}${cascade.category.sub}`
      : cascade.category?.main;
    // 🔴 **分類軸「被壓下」= 守衛生效【而且它真的擋掉了一個會改變網址的寫入】。**
    //   兩個條件缺一不可 —— 只看 `params.has(CATEGORIES_PARAM)` 會把**還原波**也算進來
    //   (那一波 cascade 是從網址上同一個 `category=` 還原來的 ⇒ 兩邊相等 ⇒ 什麼都沒被擋)。
    //   ⇒ 📌 這個布林就是下方等值早退的**判別力補丁**:見那一段的「⚠️ 而在多顆世界」。
    const categoryAxisSuppressed =
      params.has(CATEGORIES_PARAM) && (category ?? null) !== params.get('category');
    // 🔴 **多顆世界下的「使用者自選」要 union 進 `categories=`**(Sean 2026-09-05 `21`)。
    //   🛑 **不是寫進 `category=`** —— 那個槽**只有一個**, 第二顆會蓋掉第一顆
    //      ⇒ Sean 逐字要的「客人可能會多選不同分類」在 n≥2 就做不到(R1 對抗審查)。
    //   判別「自選」的四個條件缺一不可(每一條都是對抗審查逐條擊破後留下來的):
    //     ① `cat` 一律 `?? null` —— 否則 `undefined !== null` 恆真
    //     ② `cat === null` **不算自選** —— 這一條要擋的是「清除全部」那一波
    //        (那時 cascade 已空而網址還是舊的;不擋 ⇒ `categories` 被原封寫回 = 膠囊復活)。
    //        🔴🔴 **而【本條今天沒有測試守著, 我試過了】** —— 把它拿掉跑一輪 ⇒ **29 格全綠**。
    //        🔬 我沒有停在「補一格就好」, 而是去量那一格在突變世界裡到底發生什麼:
    //           探針斷言印出 **`{ n: 0, first: null }`** ⇒ **那一波根本沒送出任何 `replace`**
    //           ⇒ 📌 **擋住它的是【更前面的等值早退】, 不是本條。**
    //        🔴🔴 **2026-09-05 訂正:下面那句「構造不出」被 codex R3 推翻了一半** ——
    //           它指出「同一波【同時改別的軸】就繞得過等值早退」, 而**我照做造出來了**(㉚):
    //           那一波**確實走到寫入段**(replace 1 次、網址帶 price)。
    //           🛑 **而突變(拿掉本條)之後 ㉚ 仍然綠** —— `join(',')` 對 null 不產生尾逗號,
    //              `categories` 照樣印 A,B ⇒ 📌 **本條【今天仍然沒有測試守著】, 而理由換了:**
    //              不是「到不了那個世界」, 是「**到了, 而它的錯誤不留下可觀察的痕跡**」。
    //           ✅ ㉚ 留著當**回歸鎖**(擋未來把 union 改成會產出空值的寫法), **不是突變殺手**。
    //        ⇒ 🛑 **所以本條在單元測試層【構造不出會紅的世界】** —— 那不是「測試沒寫」,
    //           是**那條路在 mock 掉 router 的世界裡到不了**(R2 逐字說過同一件事:
    //           「它要驗的是兩個 `replace` 的落地順序, 而 router 被 mock ⇒ 根本沒有順序」)。
    //        ✅ **本條留著, 而它的驗證欠在【真瀏覽器】那一層** —— 已寫進 plan 的驗收表,
    //           不假裝它被單元測試守著。
    //     ③ 與**上次真的寫出去的那一顆**不同(不是與 `filterKey` 比)
    //     ④ **不是還原波** —— 判準是「這一顆正好等於網址解得出來的那一顆」= state 剛追上 URL。
    //        🔴 **不可以用 `pendingRestoreRef`**:它在上面已被設成 `false`, 在這裡永遠不成立
    //        (R2 對抗審查, 逐字複驗)。
    const cat = category ?? null;
    const restoredFromUrl = toUrlCategory(parseCategoryFromUrl(params, restoreSources.categories));
    const userPicked =
      cat !== null && cat !== lastWrittenCategoryRef.current && cat !== restoredFromUrl;
    if (params.has(CATEGORIES_PARAM) && userPicked) {
      const existing = (params.get(CATEGORIES_PARAM) ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== '');
      if (!existing.includes(cat)) existing.push(cat);
      params.set(CATEGORIES_PARAM, existing.join(','));
      // 🔵 **不碰 `category=`、不 delete 任何東西** —— delete 半邊解禁會撞「清除全部」。
    }
    if (!params.has(CATEGORIES_PARAM)) {
      if (category) params.set('category', category);
      // state 沒有分類時,只有「URL 那個值**認得出來**」(= 使用者剛把篩選清掉)才刪;認不得的留著。
      else if (parseCategoryFromUrl(params, restoreSources.categories) !== null) params.delete('category');
    }
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
    //    (vehicle/sort/per/filter/from **與 `categories`**)兩側恆等。
    //    🔴 `categories` 是 2026-09-04 加進這串外來鍵的(⟦search-CHIPDELETEDEADURL⟧ Sean 拍甲):
    //    本 effect 一個字都不寫它, 它由膠囊那一片(`ActiveChips`)獨佔。**要動這裡先讀上面那段。**
    //    ⛔ ~~故此比對 ⟺「**五**軸已全數與 state 一致」~~ ⇒ 🔴 **2026-09-04 這個 ⟺ 降級**:
    //    網址有 `categories` 時分類軸**不再從 state 重建** ⇒ 等值成立只蘊含「**四**軸與 state 一致,
    //    **分類軸則僅證明『本 effect 沒動過它』**」。⇒ 📌 那一軸的權威在 `ActiveChips`, 不在這裡。
    //    (舊字面留刪除線, 讓搜「五軸已全數」的人同一發撞到訂正。)
    // ✅ 本片**沒有新增任何 `params.set/delete`** —— 只是把既有那兩行變成條件式
    //    ⇒ 下面「**不得**在本行之前再新增 `params.set/delete`」那條前提**照舊成立**(#315 同款自證)。
    // 🔴 **`search` 不在那串外來鍵裡, 而它【是刻意的】**(⟦搜尋-落點換 /products⟧ 2026-09-03):
    //    本 effect 會在**這一行之後**刪掉它(見下方 `filtersChanged` 那格)。
    //    ⇒ 📌 所以它在**這道比對**的兩側仍然恆等(比對之前沒有人動過它)⇒ 上面那句話仍然成立。
    //    ⚠️ 而下一個加軸的人要知道:`search` 是**唯一一個「不是五軸、卻會被本 effect 刪」的鍵**。
    //    **不得**在本行之前再新增任何 `params.set/delete`。
    //    URL 本來就是正確結果 → 直接收手。缺這道判斷時,還原波會被 `filtersChanged` 誤判為
    //    使用者操作而刪掉 page:實測終態 = 內容第 1 頁 + 分頁 UI 停在第 2 頁、且**不會自癒**
    //    (`useBrowseUrlSync` deps 此時全未變、effect 不重跑,page 永不寫回)。
    // ⚠️⚠️ **而在多顆世界, 這一行【自己】失去判別力**(⟦search-CASCADEINMULTI⟧ 代價②,
    //   主視訊-94 2026-09-04 裁「一起做」):分類軸不從 state 重建 ⇒ 重建結果與網址天然相等
    //   ⇒ 這裡早退 ⇒ 🔴 **下面 `page` / `search` / `unmatched` 三個 delete 一起不跑。**
    //   具體受害:搜尋 redirect 留下的 `unmatched=`(「這幾個字沒有用到」)**永久留在畫面上**,
    //   而那正是本檔下方那一格存在的理由 —— 一個安靜的錯, 只是延遲發生。
    //   ⇒ ✅ 修法 = 加 `!categoryAxisSuppressed`。**守衛只該擋住分類軸那兩行, 不該把整段跳過。**
    //   🔵 而它**不會**把 #289 還原波弄回來:還原波的 cascade 是從網址同一個 `category=` 還原的
    //   ⇒ `categoryAxisSuppressed` 為 false ⇒ 那一格照舊早退(守門 ㉕ 釘住)。
    //   🔵 也不會多送導覽:真的沒東西可刪時 `next` 與當前網址仍相等 ⇒ 下方那道比對收手。
    if (
      !categoryAxisSuppressed &&
      normalizedQuery(window.location.search, restoreSources.categories) ===
        normalizedQuery(params.toString(), restoreSources.categories)
    ) {
      return;
    }
    // 篩選指紋變動才回第 1 頁;server 回新 props 造成的 effect 重跑(指紋未變)不得洗掉頁碼。
    // 🔴 `page` 的**權威寫入者是 `useBrowseUrlSync`**;此處刪除只為省掉「先用舊頁碼查一次再被
    //    更正」的往返。⚠️ `filterKey` 是 `usePageResetOnFilterChange` key 的**刻意子集**——不含
    //    vehicle/sort/perPage(那些由 useBrowseUrlSync 收);兩者本就不同步、非漂移(R2 nit-1)。
    //    新增**會寫進本 effect URL** 的軸時才需同步 `filterKey`,代價是多一次往返、非停在舊頁碼。
    if (filtersChanged) params.delete('page');
    // 🔴🔴 **點 facet ⇒ 清掉關鍵字**(⟦搜尋-落點換 /products⟧ Q2=A 的**後半**)。
    //    主視窗 2026-09-03 拍板逐字:「提示句;facet 仍可點, **點了就清掉關鍵字**」
    //    ⛔ 我第一版只做了前半(提示句)⇒ code-reviewer 抓到:
    //       關鍵字還在 URL 上, 而 `ActiveChips` 已經畫出一顆「已選」的膠囊
    //       ⇒ 📌 **畫面聲稱清單被那個 facet 縮過, 而商品其實是關鍵字撈的。**
    //       ⇒ 那正是本片要修的病(安靜的錯), 我在修它的過程裡又造了一個。
    // 🔵 插在這裡而**不是**上面那道相等比對之前 —— 那一段逐字寫著
    //    「不得在本行之前再新增任何 `params.set/delete`」, 因為外來鍵兩側恆等是它的前提。
    //    ⇒ 掛在 `filtersChanged` 上正好:**只有使用者真的動了 facet 才清**,
    //      深連結還原波(state 剛追上 URL)不會誤清。
    if (filtersChanged) params.delete('search');
    // 🔴🔴 **`unmatched` 也要一起清 —— 少了這一行它會變成【孤兒參數】。**
    //    (code-reviewer 2026-09-04 Important 1)
    //    它是「這幾個字我們沒有用到」那句話的來源。客人點掉車款/分類膠囊、或按「清除全部」
    //    之後,那句話**會永久卡在畫面上**,而它講的是一個已經不存在的搜尋。
    //    ⇒ 🎯 **那正是本片存在的理由(看得見的缺 > 安靜的錯)自己做出來的那種安靜的錯 ——
    //      只是延遲發生。**
    // 🔵 而它與 `search` 同一格是對的:兩者都是「這一次搜尋的產物」,
    //    而使用者動了 facet ⇒ 那一次搜尋就結束了。
    if (filtersChanged) params.delete('unmatched');
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    // 🔴 #287 實作首件(plan §6 標為「沒驗」的那條):`normalizedQuery` 收斂品牌軸之後,**這一處
    //    比較的語意沒有變**。理由:走得到本行 ⟺ 上方那次比較已判定「不等」,而兩次比較之間唯一
    //    的差別只有「可能刪掉了 page」—— 刪東西不會把既有的差異變不見。
    // ⚠️ **推論的另一面要講清楚:這個 `if` 因此恆為真 = 它今天沒有判別力**(構造不出讓它為假的
    //    輸入,所以也寫不出會紅的負測 —— 拿掉它零測試變化)。留著的理由是可讀性與防禦:
    //    上方那段若日後被改成「某些情況不早退」,本行就是最後一道「沒差別就不要送導覽」。
    //    ⇒ 不要把它當成一道**有效的**守門引用,也不要因為「有這行」而放心刪上面那段。
    if (
      normalizedQuery(window.location.search, restoreSources.categories) !==
      normalizedQuery(next.split('?')[1] ?? '', restoreSources.categories)
    ) {
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
      // 🔴 **只有真的送出去才記** —— 這正是本 ref 與 `lastFilterKeyRef` 的差別:
      //   上面三個提早 return 都不會走到這裡, 所以被它們吃掉的那些波【下一次還看得到】。
      // ⛔ ~~lastWrittenCategoryRef.current = category ?? null;(在這裡就記)~~
      // 🔴🔴 **codex R3 ③:`router.replace()` 回來只代表【已呼叫】** —— Next 靜默忽略時
      //   **網址沒變而 ref 已前進** ⇒ 📌 **同一個選擇會【永久】被吞掉**。
      //   ✅ 改成先存 pending, 由下一波開頭比對真實網址才升成 committed(見上面那段)。
      //   ⚠️ **而這一行的【突變沒有測試殺得死】**(2026-09-05 實測:改回直接記 committed ⇒ 31 格全綠)。
      //      成因:單元測試裡 `router` 是 mock 的, **`replace` 永遠「成功」** ⇒ pending 與直接記
      //      在那個世界裡**行為相同**。⇒ 📌 **它守的是【Next 靜默忽略】那個世界, 而那個世界
      //      在 mock 掉 router 之後【不存在】。**驗證欠在真瀏覽器/E2E 那一層, 不假裝有。
      pendingWrittenCategoryRef.current = category ?? null;
      if (collides) router.refresh();
    }
  }, [cascade, extras, restoreSources, router]);
}
