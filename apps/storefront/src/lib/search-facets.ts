// search-facets.ts — 搜尋疊層的另三區(品牌 / 分類 / 車款)· ⟦搜尋-第2刀⟧ 2a
//
// 🔴 **稿是權威, 而它的形狀在 `design-reference/components/SearchOverlay.jsx:34-58`**:
//    四區在同一個 `useMemo` 裡算完, 各區上限 **商品 8 / 品牌 6 / 分類 6 / 車款 6**。
//    ⇒ 那個 6 是**視覺決定**(疊層裡塞得下幾列)⇒ 照抄, 不在這裡發明一個數字。
//
// 🔵 **為什麼過濾寫成純函式**:route 那一層要 mock 三支 server 端 taxonomy 才測得到,
//    而「打某個字會不會命中」與「資料怎麼來」是兩件事 ⇒ 分開之後這一半用真資料測得起來。
//
// 🛑 **本檔【不】決定「查不到」怎麼畫** —— 它只把 `failed` 原樣帶出去。
//    理由:三區的 `failed` **必須各自回**(`-0a` 2026-09-02 明令 + 一發突變守著):
//    合成一個在型別上完全合法, 而它壞掉的方式是**品牌查不到 ⇒ 三區都說查不到**。

import type { MockBrand } from '@/data/mock-brands';
import type { MockCategory } from '@/data/mock-categories';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

/** 各區上限。稿 `SearchOverlay.jsx:40/46/57` 逐字 `.slice(0, 6)`。 */
export const SEARCH_FACET_LIMIT = 6;

export type SearchBrandHit = { id: string; name: string; count: number };
export type SearchCategoryHit = { id: string; name: string; count: number };
export type SearchVehicleHit = {
  brandId: string;
  brandName: string;
  modelId: string;
  modelName: string;
};

export type SearchFacets = {
  brands: SearchBrandHit[];
  categories: SearchCategoryHit[];
  vehicles: SearchVehicleHit[];
  /**
   * 🔴 **三個旗標各自一格, 不合成一個。**
   * `true` = 這一區**這次查不到**(≠「沒有符合的」)。
   * 畫的人必須把兩者畫成不同的東西 —— 而合成一個會讓一區壞掉時三區一起說謊。
   */
  failed: { brands: boolean; categories: boolean; vehicles: boolean };
};

/** 稿 `:32` 逐字 `const match = (s) => s && s.toLowerCase().includes(q)`。 */
function match(haystack: string | undefined | null, q: string): boolean {
  return typeof haystack === 'string' && haystack.toLowerCase().includes(q);
}

export function filterFacets(
  query: string,
  data: {
    brands: { brands: MockBrand[]; failed: boolean };
    categories: { categories: MockCategory[]; failed: boolean };
    vehicles: { motoBrands: MockMotoBrand[]; failed: boolean };
  },
): SearchFacets {
  const q = query.trim().toLowerCase();
  const empty: SearchFacets = {
    brands: [],
    categories: [],
    vehicles: [],
    failed: {
      brands: data.brands.failed,
      categories: data.categories.failed,
      vehicles: data.vehicles.failed,
    },
  };
  // 🔴 **空字串短路 —— 而這個分支【正式路徑到不了】, 那是刻意的**(`-c7` 2026-09-02 R1 抓到)。
  //
  //    · **為什麼它必須存在**:`''.includes('')` 對每個字串都是 `true`
  //      ⇒ 沒有它, 空查詢會把**整份 taxonomy** 當成命中回出去。
  //      ⇒ 本函式是公開純函式, 它要對自己的輸入負責, 不能假設呼叫端先擋過。
  //    · **為什麼正式路徑到不了**:`app/api/search/route.ts:61` 在空 `q` 時就 `return` 了
  //      —— 而那是 **R1**(該檔測試逐字「空 q ⇒ 200 空陣列且**不打 DB**:
  //      搜尋框剛打開時 client 不該把 DB 叫醒」)。
  //
  //    🛑 **⇒ 所以【不要】為了讓旗標一致而把三支 taxonomy 搬到那個早退之前** ——
  //       那會讓「打開搜尋框」變成一發查詢, 而空查詢時疊層根本沒有東西可畫,
  //       那三個旗標**沒有任何地方會顯示**。⇒ 一致性買不到東西, 而 R1 是有測試的規矩。
  //    ⚠️ 而旗標仍然帶出去(不是回 `false`)—— **「沒查」不可以印成「查過而沒壞」。**
  if (q === '') return empty;

  const brands = data.brands.brands
    .filter((b) => match(b.name, q) || match(b.id, q))
    .slice(0, SEARCH_FACET_LIMIT)
    .map((b) => ({ id: b.id, name: b.name, count: b.count }));

  const categories = data.categories.categories
    .filter((c) => match(c.name, q) || match(c.id, q))
    .slice(0, SEARCH_FACET_LIMIT)
    .map((c) => ({ id: c.id, name: c.name, count: c.count }));

  // 稿 `:47-54`:逐 brand 逐 model,而 **model 名或 brand 名任一命中就算**
  // ⇒ 打「YAMAHA」要撈得出它旗下的車款,不是只有名字裡有 YAMAHA 的那些型號。
  // 🔴🔴 **`vehicles` 今天【算了而沒有人畫】—— 那是刻意的,不是 dead code。**
  //    (2026-09-03;R1 nit 12:指標原本只寫在畫的那一端,而**會刪掉這段的人打開的是這支檔**。)
  //    疊層那一區被 `SearchOverlayFacets.tsx` 刻意不畫,因為 `match()` 是子字串比對
  //    ⇒ 打 `R6` 會比中 `CBR600`(`cbr600` 裡含 `r6`)⇒ 客人會以為網站壞了。
  //    ✅✅ **[2026-09-04 16:3x Sean 拍了 —— 【重出版的甲】: 全部不改]**
  //      原話逐字(正本 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 「Q-R6(重出版)」那一節):
  //        「甲 = 全部不改。 R6 繼續跑出 Honda CBR600, 車款那一區維持不顯示。」
  //      🔴 **引用時務必寫「重出版的甲」** —— **舊版的甲乙【都不對】**:舊版只講車款那一區的代價,
  //        而這支 `match()` **三區共用**(品牌 `:82` / 分類 `:87` / 車款 `:103`)。
  //      🛑 **而 2026-09-03 那份答案表的 Q21 那一列(字母說乙 · 說明說不改)【作廢】** —— 那一則被取代了。
  //    🎯 **⇒ 所以這一段不再是「等拍板」, 是【一條拍板的落點】** —— **不改是拍板, 不是沒做。**
  //    🛑 **拍板前不要刪這段** —— 刪了之後那一區要接上來時得重寫,而 `SearchOverlay.test.tsx`
  //      的 G3-b 斷言的是「畫面上不得出現」⇒ **刪掉資料源它照樣綠,不會叫。**
  const vehicles: SearchVehicleHit[] = [];
  for (const b of data.vehicles.motoBrands) {
    for (const m of b.models) {
      if (match(m.name, q) || match(b.name, q)) {
        vehicles.push({
          brandId: b.id,
          brandName: b.name,
          modelId: m.id,
          modelName: m.name,
        });
      }
    }
  }

  return {
    brands,
    categories,
    vehicles: vehicles.slice(0, SEARCH_FACET_LIMIT),
    failed: empty.failed,
  };
}
