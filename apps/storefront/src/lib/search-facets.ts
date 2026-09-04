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
import { foldIncludes } from '@/lib/search-terms-fold';

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

// 🔴🔴 **[2026-09-04 `match()` 已刪 —— 舊字面留在這裡, 因為外面有東西引用它的行號]**
//    ⛔ ~~`/** 稿 :32 逐字 const match = (s) => s && s.toLowerCase().includes(q)。 */`~~
//    ⛔ ~~`function match(haystack, q) { return typeof haystack === 'string' && haystack.toLowerCase().includes(q); }`~~
//    ✅ 三區都改用 `foldIncludes`(Sean 2026-09-04 第十七題拍甲)⇒ 它沒有呼叫點了,
//       而留著一支沒人叫的函式會讓下一個人以為「還有一條路走它」。
//    🔵 **而稿的那一行仍然是這一區的來源** —— `foldIncludes` 做的還是**子字串**,
//       只是先把兩端折過(去重音 + 去分隔符)。**語意沒有從子字串變成模糊比對。**

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

  // 🔴🔴 **品牌這一區改用 `foldIncludes`(2026-09-04 線【身分】`-auth`)—— 而【只有這一區】。**
  //    Sean 逐字:「反正就是盡可能的兼容, 模糊搜尋但是盡可能地接近」
  //    🔬 而它修的是量到的四格(線上實測, `~/pcm-mailbox/量-品牌打錯字-20260904-auth.md`):
  //    ```
  //    eazigrip   膠囊 ❌ ⇒ slug 是 `eazi-grip`, 而 'eazi-grip'.includes('eazigrip') = false
  //    cncracing  膠囊 ❌ ⇒ 同上, 空格
  //    eazi grip  🔴 商品 8 筆【而膠囊空的】—— 兩層互相矛盾, 而客人看得到那個矛盾
  //    AKRAPOVIČ  名字比對永遠 0(Č ≠ C)⇒ 今天會中【只是因為 slug 剛好叫 akrapovic】
  //    ```
  //    ⇒ 🎯 **`foldSearchTerm` 早就存在(NFD 去重音 + 去分隔符), 只是沒有接到這一區。**
  //
  //    🛑 **而【分類/車種那兩區刻意不動】, 理由不是「我懶」**:
  //       `foldSearchTerm` 逐字「把 `[\s\-_./()[\]{}·,、]` 剝掉」⇒ 它會**剝掉中文標點**,
  //       而分類名是中文(`腳踏後移與傳動`)、車種名混中英 ⇒ **那是另一個分母, 要另外量。**
  //       ⇒ 📌 一次只換一區的尺, 否則出事時分不出是哪一區換壞的。
  //
  //    🔵 **它仍然是【子字串】, 不是模糊比對** —— 打錯一個字母(`akrpovic`)照樣 0。
  //       那一半要 `pg_trgm` 的相似度 ⇒ 是一支 migration ⇒ 不在本片。
  const brands = data.brands.brands
    .filter((b) => foldIncludes(b.name, q) || foldIncludes(b.id, q))
    .slice(0, SEARCH_FACET_LIMIT)
    .map((b) => ({ id: b.id, name: b.name, count: b.count }));

  // 🔴 **分類這一區 2026-09-04 也換成折兩端**(Sean 第十七題拍甲, 見上面品牌那一段)。
  //    🔬 **換之前量過分母, 不是換完才想起來**(正式庫唯讀 + 拿【真的】`foldSearchTerm` 跑):
  //       分類 **83 個唯一名 ⇒ 折後撞名 0 組 · 折成空字串 0** ⇒ 沒有「兩個不同分類被折成一個」的世界。
  const categories = data.categories.categories
    .filter((c) => foldIncludes(c.name, q) || foldIncludes(c.id, q))
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
  //        ⚠️ **[2026-09-04 訂正]** `match()` 已刪、三區改用 `foldIncludes` —— **而「三區共用」這件事沒變**,
  //           它仍然是一支函式管三區。上面那句的**行號已漂**, 不要照它去找。
  //      🛑 **而 2026-09-03 那份答案表的 Q21 那一列(字母說乙 · 說明說不改)【作廢】** —— 那一則被取代了。
  //    🎯 **⇒ 所以這一段不再是「等拍板」, 是【一條拍板的落點】** —— **不改是拍板, 不是沒做。**
  //    🔴🔴 **[2026-09-04 補 —— 而它【不推翻】上面那一板, 兩者管的是不同的事]**
  //       上面那板管的是「**過度命中**」(`R6` 跑出 `CBR600`)⇒ 拍**不改** ⇒ 今天仍然不改。
  //       而 Sean 同日**第十七題**拍的是「**命中不足**」:
  //         > 「Q-膠囊比對: 打『eazigrip』(少一個橫槓)現在找不到 EAZI-GRIP。要不要讓它找得到? 甲 = 要」
  //       ⇒ ✅ 三區改用 `foldIncludes`(折重音 + 折分隔符), 而 **`R6` 照樣跑出 `CBR600`、
  //         車款那一區照樣不顯示** —— 那兩件事一個字都沒動。
  //    🛑 **我當時停下來問過, 沒有自己解釋那一板** —— 因為本段自己寫著「只講一區」正是上次出錯的方式。
  //    🛑 **拍板前不要刪這段** —— 刪了之後那一區要接上來時得重寫,而 `SearchOverlay.test.tsx`
  //      的 G3-b 斷言的是「畫面上不得出現」⇒ **刪掉資料源它照樣綠,不會叫。**
  const vehicles: SearchVehicleHit[] = [];
  for (const b of data.vehicles.motoBrands) {
    for (const m of b.models) {
      // 🔴 **車款這一區同上**。分母也量過:車種品牌 **67 個唯一名 ⇒ 撞名 0**;
      //    車款 **3,536 個「品牌×車款」配對 ⇒ 折後撞名 16 組, 而 16 組【全部同一個品牌】**
      //    (跨品牌 0)⇒ 🎯 那是**同一台車的兩種寫法**(`NC 700 S` / `NC700S`), 不是兩台車被混成一台
      //    ⇒ 折了之後兩筆都中, **而那正是客人要的**(板列 `⟦veh-DUPMODELSPELLING⟧` 記著來源資料重複)。
      // 🛑 **而 `+` 那一族【沒有】被折掉**:`Tracer 9 GT` 與 `Tracer 9 GT+` 是**不同的車**,
      //    而 `foldSearchTerm` 不剝 `+` ⇒ 它們折了也不撞。**不要「順手」把 `+` 加進剝除字元集。**
      if (foldIncludes(m.name, q) || foldIncludes(b.name, q)) {
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
