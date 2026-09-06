// catalog-pending.ts — ⟦search-CATSWITCHSLOW⟧ 切分類的載入回饋:**訊號來源**。
//
// 🔴 **為什麼是獨立一支檔**(鐵則 6):`ProductsPage.tsx` 本片後到 512 行(>400)。
//   而這一段本來就是**純函式** —— 輸入三個值、輸出一個布林、不碰 hook、不碰 DOM
//   ⇒ 抽出來之後它可以被**逐格餵**(見 `catalog-pending.test.ts`),而留在元件裡只能靠 render 去撞。
//   ⚠️ 註解**跟著它解釋的那段碼一起搬**,一行都沒有壓縮 —— 鐵則 6 紅字那條。
//
// 🔬 **根因是量到的**(2026-09-06,正本 `~/pcm-mailbox/量-抽屜正式站-20260906.md`):
//   按下分類之後 **RSC 回應 3.4–8.5 秒**,不是丟包 ⇒ 本片只補「畫面要說話」那半,**慢那半不動**。
//
// 🔵 **判準 = 【cascade 已經換了, 而網址還沒換】**。`router.replace` 是 App Router 導覽、
//   **非同步**,而 `/products` 是 `force-dynamic` ⇒ 要 RSC 往返回來才會更新 `useSearchParams()`
//   (同一件事寫在 `use-catalog-filter-url-sync.tsx:259-260`)
//   ⇒ 這個差值**恰好活在客人等待的那幾秒**,不需要另外造一個計時器。
//
// 🛑 **plan §7.1/§7.2 那四種寫法一種都沒有採用** —— 它們要改 `useCatalogFilterUrlSync` 的 deps,
//   而那支 effect 的狀態機**按 render 前進**,收窄 deps = 改語意(實測踩壞 4 格既有守門)。
//   本檔**一行都沒動那支 hook**。

import type { SearchParamsLike } from '@/lib/vehicle-url';
import { CATEGORIES_PARAM } from '@/lib/catalog-query';
import { CATEGORY_URL_SEPARATOR, parseCategoryFromUrl } from './products-url-parsers';

/** 分類樹:與 `parseCategoryFromUrl` 第二參數同一種形狀(`count` 是 optional,見那支檔的註解)。 */
type CategoryTree = Parameters<typeof parseCategoryFromUrl>[1];

/**
 * 只要 `main` / `sub` 兩欄 —— 刻意**不寫成** `CascadeFilterState['category']`。
 * 🔵 那個型別(`@pcm/ui` 的 `CategorySelection`)還帶 `mainId` / `subId`,而本函式一個都沒用到;
 *   寫成結構型別 ⇒ 測試餵 `{ main }` 就跑得動,不必為了過型別去編造兩個假 id
 *   —— **假 id 會讓 fixture 看起來比它實際涵蓋的更像真的**。`CategorySelection` 照樣塞得進來。
 */
type CategoryLike = { main: string; sub?: string };

/** 把一顆分類壓成**網址上那一顆的字面** —— 與 `use-catalog-filter-url-sync.tsx:205-206` 同一個規則。 */
const toUrlShape = (x: CategoryLike | null): string | null =>
  x === null ? null : x.sub ? `${x.main}${CATEGORY_URL_SEPARATOR}${x.sub}` : x.main;

/**
 * 「客人切了分類,而新內容還沒回來」= true。
 *
 * 消費端三個:`ProductsSortBar.isPending`(件數換「更新中…」)、
 * `FilterDrawer.applying`(手機分類抽屜那顆鈕換「套用中…」)、`.pp-grid.is-loading`(格線淡出)。
 */
export function isCatalogPending(
  category: CategoryLike | null,
  searchParams: SearchParamsLike,
  categories: CategoryTree,
): boolean {
  // 🛑 **`category === null` 一律不算 pending** —— 入站水合時 cascade 還是 null 而網址上有值,
  //   拿來比會在**每次深連結進站誤報一次**,而那時候畫面早就畫好了。
  if (category === null) return false;
  const want = toUrlShape(category);

  // 🔴 `?category=` 那一槽比的是【解析之後的形狀】,**不是逐字**。
  //   成因是真的:`?category=水管束環`(裸子分類短名)網址上就長那樣,而 cascade 裡是
  //   `引擎與冷卻 · 水管束環`(⟦01-CATPATHSHORTNAME⟧ 的還原路徑)⇒ 逐字比**永遠不相等**
  //   ⇒ 🛑 那會變成一盞**永遠亮著的「更新中…」**,而那比沒有回饋更糟。
  //   (它最後仍會被 url-sync 寫成正規形而自癒,但那要等一次 RSC 往返 —— 不該讓客人先看到假燈。)
  if (toUrlShape(parseCategoryFromUrl(searchParams, categories)) === want) return false;

  // 🔵 **兩個 key 都要看**:單選走 `?category=`、多選走 `?categories=`(`CATEGORIES_PARAM`)。
  //   只看前者會讓多選那條路**整段恆真**(永遠印「更新中…」)。
  //   多顆那一槽由 `use-catalog-filter-url-sync.tsx:420-427` 的 union 寫入,
  //   而它寫進去的就是上面那個正規字面 ⇒ 這裡逐字比對即可。
  return !(searchParams.get(CATEGORIES_PARAM) ?? '')
    .split(',')
    .map((v) => v.trim())
    .includes(want as string);
}

// ⚠️ **已知、刻意不修的一格**(2026-09-06 code-reviewer minor 3,我判「留著」):
//   多顆世界(`?categories=` 在)底下,若舊的 `?category=` **殘留值恰好等於客人剛選的那一顆**,
//   上面第二個等式會提早回 `false` ⇒ 那一波**短暫看不到「更新中…」**。
//   🔵 **為什麼不改成「有 `categories=` 就只看 `categories=`」**:那條路會製造**相反方向**的錯 ——
//     `use-catalog-filter-url-sync.tsx:414-416` 的 `userPicked` 在 `cat === restoredFromUrl` 時是 `false`
//     ⇒ 那一顆**不會被 union 進 `categories=`** ⇒ 只看 `categories=` 就變成**一盞永遠亮著的燈**。
//   🎯 **兩種錯的代價不對稱**:少閃一次回饋 = 回到修前的樣子(fail-open);
//     永遠亮著的燈 = 客人以為站掛了,而且沒有東西會把它關掉。⇒ **選 fail-open。**
//   📌 板列 `⟦search-CATSWITCHSLOW⟧` 有記這一格,不是忘了。
