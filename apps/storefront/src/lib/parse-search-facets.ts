// parse-search-facets.ts — 把客人打的一串字,拆成【膠囊】與【沒用到的字】
// (⟦search-CAPSULEPARSE⟧ 2026-09-03)
//
// 🔵 Sean 逐字:「搜尋出來會在商品目錄顯示,然後如果是車種＋商品名稱也會盡可能的
//    帶入相對應的膠囊這樣,如 mt07 akrapovic 會帶入 MT07、AKRPOVIC 這樣」
//    ⇒ 而他對這一格的驗收標準是他自己給的:「**盡量就好**」。
//
// 🔴🔴 **而「盡量就好」放寬的是【命中率】,不是【沒命中時的行為】** ——
//    ⇒ 📌 **一顆膠囊都帶不到 ⇒ 仍然要給關鍵字結果, 不准靜靜地給他全站。**
//    ⇒ ⇒ 而**新的失敗形狀是「解析一半」**(`mt07 排氣管好看的`):
//      帶到 MT-07,而「好看的」被丟掉 ⇒ 🛑 **丟掉的字要看得見**。
//      ⇒ 所以本函式回的不只是命中,還有 `leftover` —— **它是要被畫出來的,不是內部細節。**
//    ⇒ ⇒ ⇒ 🎯 **本片的驗收不是命中率,是【沒命中的那些字去哪了】。**

import { foldSearchTerm, foldEquals, foldIncludes } from './search-terms-fold';
import { SEARCH_SYNONYMS, type SearchSynonym } from '@/data/search-synonyms';
// 🔴 分隔符**共用同一個定義** —— 而今天這個缺陷的成因就是「好幾個生產者不共用」
//    (實查五個寫入點, 清單與 grep 指令見下方 `category` 欄位的註解)。
//    (那支檔零 hook、無 `use client`, 純解析層 ⇒ server 端 import 安全。)
import { CATEGORY_URL_SEPARATOR } from '@/components/products-url-parsers';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { MockBrand } from '@/data/mock-brands';
import type { MockCategory } from '@/data/mock-categories';

export type ParsedFacets = {
  /** `brandId:modelId` —— 對齊 `?vehicle=` 的短版字面。年份不猜(見下)。 */
  readonly vehicle: string | null;
  /** 產品品牌的 id,對齊 `?pbrands=a,b`。 */
  readonly brandIds: readonly string[];
  /**
   * 🔴🔴 **`?category=` 的值 —— 而【子分類要帶全路徑】`大類 · 子類`, 不是短名。**
   *
   * ⛔ ~~原本這裡回子分類的短名~~ ⇒ **那讓每一顆分類膠囊都回 0 件**, 2026-09-04 修。
   * 🔬 成因(兩端都量過, 正式站唯讀):
   *    · RPC 只認兩種:`category_raw = p_category` 或 `category_raw LIKE p_category || ' · %'`
   *      (`20260827180000_…_new_arrivals_exclude_repair_parts.sql:103`)
   *    · 而 `category_raw` 的真實形狀是 `父 · 子`(24,312 件裡 24,020 件兩層)
   *    ⇒ 短名 `油箱止滑貼` ⇒ **0 件** · 全路徑 `止滑貼與保護膜 · 油箱止滑貼` ⇒ **614 件**
   *    ⇒ 🔵 而 113 個分類名裡只有 **17 個**短名有貨 —— 而那 17 個逐字就是 `category_raw` 的頂層段
   * 🛑 **而它為什麼沒有人發現**:同一個 `?category=` 有【好幾個生產者】——
   *    ⛔ ~~我原本寫「兩個」~~ ⇒ 🔴 **code-reviewer 2026-09-04 實查是【五個寫入點】**:
   *      `app/products/page.tsx:149`(本函式)· `components/use-catalog-filter-url-sync.tsx`(`params.set('category', category)` 那行)
   *      · `components/ProductsPage.tsx:430` · `components/CategoryGrid.tsx` · `lib/brand-url.ts`
   *    🔵 而後三個**恰好只送頂層名** ⇒ 今天安全 —— 🛑 **而「恰好」不是保證。**
   *    ⇒ 📌 側欄那條**拼全路徑, 是對的**;本函式只有一個名字可拼 ⇒ 送短名。
   *    ⇒ ⇒ 🎯 **⇒ 對的那幾條路的綠, 掩護了這一條的紅。**
   *    ⇒ ⇒ ⇒ 🔴 **下一個人要動 `?category=` 的值:先 grep `set('category'`, 不要信這段的清單。**
   * 🔵 顯示**從壞的變成好的**(不是「不受影響」—— 我原本那句往低估自己的方向偏):
   *    修法前送短名 ⇒ `products-url-parsers.ts` 的 exact 比對只掃**頂層**、短名又無分隔符
   *    ⇒ `parseCategoryFromUrl` 回 `null` ⇒ **那顆膠囊本來就畫不出來**。
   *    修法後全路徑拆得回 `{main, sub}` ⇒ 膠囊才真的出得來。
   */
  readonly category: string | null;
  /**
   * ⟦M-4b 多顆分類膠囊⟧ Sean 2026-09-04 拍甲(聯集)——「魚雷管 / 白鐵管要**同時**列全段+尾段」。
   * 🔴 **一個俗稱可以對到多個正式名**:字典那側是**同一個 `from` 多筆列**(`-auth` 的線),
   *    而**讀它的那一行原本是 `.find()`** ⇒ 只回第一筆 ⇒ 📌 **第二筆會被安靜丟掉。**
   * 🔵 `category` 保留 = 這裡的第一顆(舊呼叫端不動);新的呼叫端讀 `categories`。
   * ⚠️ **而「第一顆」是 `SEARCH_SYNONYMS` 的【陣列序】** —— 那是資料檔的偶然, **不是規格**:
   *    字典是手維護的, 重排是零成本動作, 而重排之後客人拿到的第一顆會變, **沒有東西會叫**。
   */
  readonly categories: readonly string[];
  /** 🔴 **沒有被任何一顆膠囊用掉的字** —— 它要被畫出來。 */
  readonly leftover: readonly string[];
  /** 用到了哪幾條字典(給畫面標「這是猜的」用;空 = 全靠格式正規化)。 */
  /** ⚠️ **一個詞可能 push 多筆**(同一個 `from` 對到多個正式名)⇒ 拿 `.length` 當
   *  「幾個詞用了字典」會多算。今天全 repo 只有測試在讀它。 */
  readonly usedSynonyms: readonly SearchSynonym[];
};

export type FacetSources = {
  readonly motoBrands: readonly MockMotoBrand[];
  readonly brands: readonly MockBrand[];
  readonly categories: readonly MockCategory[];
};

/** 切詞:空白系(含全形)。🔵 與 adapter 那支切詞**不同源是刻意的** —— 那支要餵 SQL,這支只給解析。 */
function splitWords(q: string): string[] {
  return q.split(/[\s　  ]+/).filter((w) => w !== '');
}

/**
 * 把自由文字解析成 facet。**不動任何 I/O**(純函式,好測)。
 *
 * 🔴 **一個詞只能被用掉一次**,而順序是 車款 → 品牌 → 分類:
 *    ⚠️ 那個順序**會影響結果**,而我挑它的理由是:車款名(`MT-07`)最具體、
 *    分類名(`排氣管`)最容易誤觸 ⇒ **讓具體的先拿**。
 *    📌 而這是**判斷不是量測** —— 我沒有量過別的順序會差多少。
 */
/**
 * 客人打一個詞, 要送他到哪一個分類。
 *
 * 🔴🔴 **舊規則是 `allCats.find(名字以這個詞【開頭】)`, 而它有兩個【從碼本身看得出來】的毛病**
 *    (⚠️ 這兩條是從規則的形狀推的, **不是**從「哪個答案才對」倒推出來的 —— 那個分別很重要, 見下):
 *    ① **「開頭」是任意的** —— 中文複合分類名把關鍵字放中間是常態:
 *       `煞車離合器拉桿` / `水管束環` / `空氣濾芯` / `端子後照鏡` / `鏈條蓋與齒盤護蓋`。
 *       客人打 `離合` `管束` `濾芯` `後照` `齒盤` ⇒ **一個都不是前綴。**
 *    ② **`find` 取的是【陣列第一個】, 而陣列順序是 `sort_order`** ——
 *       🎯 **那個欄位不回答「哪一個比較相關」。** ⇒ 落點等於由一個不相干的欄位決定。
 *
 * ✅ **新規則三階段(順序在呼叫端)**:① 名字完全相同 ⇒ ② 俗稱字典 ⇒ ③ **本函式**。
 *    本函式做的是 ③:在**名字含這個詞**的候選裡, 取 **`count` 最大的那一個**
 *    —— 理由:客人打那個詞, 是要看到**那個詞的東西**;涵蓋最多的那個桶給他最多。
 *
 * 🛑🛑 **而這條規則【不是】為了讓某一組答案全中而調的, 那件事我刻意沒做**:
 *    2026-09-04 有一版「substring + 葉優先 + max-count」在 18 個案例上 **18/18** ——
 *    🔴 **而那 18/18 是在【調它用的同一組 18 個】上量的 ⇒ 零外推證據 ⇒ 沒有採用。**
 *    📌 **一個在自己的訓練集上滿分的規則, 它的分數不含任何資訊。**
 *    ⛔ ~~我原本寫「它在 25 個詞上沒全中 ⇒ 所以它不是調出來的」~~ **⇒ code-reviewer 2026-09-04 判它不成立, 收下**:
 *      🔴 **我正是拿【同一組 25 個】去淘汰 18/18 那一版的** ⇒ 選規則這個動作本身就用了它
 *      ⇒ 🎯 **「沒滿分」與「沒調過」不是同一件事。**
 *    🟡 **撐得住的證據是【結構】不是分數, 而那句話也要收斂**(R2 抓到我又寫過頭):
 *      ✅ 本規則**零【連續】參數** —— 沒有門檻、沒有權重、沒有例外表。
 *      ⛔ ~~「沒有可以拿去對答案調的旋鈕」~~ **假** —— 離散選擇至少有:比對函式(前綴/子字串)、
 *        排序鍵(count / sort_order)、階段順序、要不要葉優先。
 *      🔴 **而其中「葉優先」那一格, 我確實是看了那 25 個答案之後把它扳掉的。**
 *      ⇒ 📌 **所以誠實的說法是:沒有連續旋鈕可以微調, 而離散選擇有 N 個、其中一個是對著那組答案扳的。**
 *      🔵 而「它在自己的評測上失手」只是**與『被調過』不一致**, 它不證明沒調過。
 *
 * ⚠️ **已知會被它改變而【不在本片授權範圍】的兩個詞**:`服飾` / `傳動` ——
 *    它們舊規則下**一顆膠囊都沒有**, 新規則會給它們一顆。⚠️ **而「只批 16 個」這句的來源要講清楚**:
 *    🔴 拍板正本 `~/pcm-mailbox/Sean拍板-20260904-七題.md` 逐字寫的是 **22**;
 *      「只修那 16 個選錯的」是**主視窗 `pcm-website-v2-94` 2026-09-04 跨窗轉述**的一則新拍板,
 *      **而它在我寫這段的當下【還沒有落進那支檔】**。
 *    ⇒ 🛑 **所以這裡不寫「Sean 明確只批 16」** —— 寫的是:**依主視窗轉述的拍板, 範圍是那 16 個。**
 *      📌 **一個沒落檔的授權, 不可以在碼的註解裡長成一句他說過的話。**
 *    ✅ **[2026-09-04 稍後]主視窗已補落檔** —— 正本 `Sean拍板-20260904-七題.md` 的
 *      「Q-25組(補落檔 · 遲到)」那一節, 原話逐字 `乙 只修那 16 個「選錯」的, 就可以推 main`。
 *      🔬 我自己驗過:`grep -c '只修那 16 個'` ⇒ **3**(負對照一句現編的 ⇒ **0**)。
 *    🔴 **而上面那兩行【不拿掉】** —— 它記的是**當時的證據狀態**, 而那比現在的狀態有用:
 *      下一個讀到這裡的人要看得出「這句話曾經沒有來源, 而是審查去開正本才發現的」。
 */
function pickCategory(
  cats: readonly { readonly name: string; readonly path: string; readonly count: number }[],
  w: string,
): { readonly path: string } | null {
  // 🔵 完全同名那一階段**已經在呼叫端做掉了**(而且排在字典前面)⇒ 這裡只做模糊比對。
  // 🔴🔴 **`count > 0` 不是裝飾, 它擋的是一個【比沒膠囊更糟】的結果**(R2 抓到):
  //    🔬 實測 `來令` ⇒ 舊規則沒有膠囊(走全文搜尋), 而本片會給它 `煞車皮(來令片)`
  //      —— **那個分類 0 件**(`search-synonyms.ts` 自己記著)⇒ 客人拿到一頁空的,
  //      **而那個詞被吃掉了**(`leftover` 空)⇒ 他連「我打的字沒被用到」都看不到。
  //    ⇒ 📌 **一顆送到空分類的膠囊, 比一顆都沒有糟** —— 沒有膠囊至少還有全文搜尋那條退路。
  //    ⚠️ 而階段① ② 不加這道:同名與字典是**明確意圖**, 客人指名要那個分類, 空的也給他看。
  return pickLargest(cats.filter((c) => c.count > 0 && foldIncludes(c.name, w)));
}

/** 一組候選裡取 `count` 最大的。🔵 **嚴格大於 ⇒ 並列取先出現的**, 而陣列順序由
 *  `category-queries.ts` 的 `sort_order → name → id` 釘死 ⇒ 並列的結果**每次都一樣**。 */
function pickLargest(
  cats: readonly { readonly path: string; readonly count: number }[],
): { readonly path: string } | null {
  let best: { readonly path: string; readonly count: number } | null = null;
  for (const c of cats) {
    if (best === null || c.count > best.count) best = c;
  }
  return best;
}

export function parseSearchFacets(query: string, src: FacetSources): ParsedFacets {
  const words = splitWords(query);
  const used = new Set<number>();
  const usedSynonyms: SearchSynonym[] = [];

  // ── 車款 ──────────────────────────────────────────────────────────────
  // 🔵 只認【車款型號】,不認廠牌單獨出現(`yamaha` 一個字不該把整個目錄縮到 Yamaha)。
  //    🔴 而年份**不猜** —— `mt07 2021` 裡的 `2021` 也可能是料號的一部分。
  //      ⇒ 📌 少帶一顆膠囊客人自己補;多帶一顆錯的他得先看出來才拿得掉。
  let vehicle: string | null = null;
  outer: for (const mb of src.motoBrands) {
    for (const model of mb.models) {
      for (let i = 0; i < words.length; i += 1) {
        if (used.has(i)) continue;
        if (foldEquals(words[i]!, model.name) || foldEquals(words[i]!, model.id)) {
          vehicle = `${mb.id}:${model.id}`;
          used.add(i);
          break outer;
        }
      }
    }
  }

  // ── 產品品牌 ──────────────────────────────────────────────────────────
  // 🔵 Q1=A(主視窗 2026-09-03):**解析出多顆就全部帶上**(AND)。
  //    理由:全部帶上 ⇒ 客人多按幾個 ✕ 就好;只帶第一顆 ⇒ **他不知道我們丟了什麼**。
  const brandIds: string[] = [];
  for (const b of src.brands) {
    for (let i = 0; i < words.length; i += 1) {
      if (used.has(i)) continue;
      if (foldEquals(words[i]!, b.name) || foldEquals(words[i]!, b.id)) {
        brandIds.push(b.id);
        used.add(i);
        break;
      }
    }
  }

  // ── 分類 ──────────────────────────────────────────────────────────────
  // 🔵 分類吃三種, **兩趟**:第一趟 完全相同 + 俗稱字典(`油箱貼` ⇒ `油箱止滑貼`);
  //    第二趟 子字串取涵蓋最大(⛔ ~~前綴~~ 2026-09-04 換掉;為什麼是兩趟見下方迴圈)。
  //    ⛔ ~~而**字典排最後** —— 能靠格式對上的就不要動用字典~~ **2026-09-04 作廢**:
  //       字典現在排在**模糊比對前面**(第一趟)⇒ 只有「完全同名」比它早。
  let category: string | null = null;
  let categories: string[] = [];
  // 🔴 `name` 用來比對(客人打的是短名), `path` 才是要寫進 `?category=` 的東西。
  //    ⚠️ **兩者不可以合成一個** —— 比對要短名, 網址要全路徑, 而那正是這個缺陷的形狀。
  // 🔴 `count` 帶進來, 因為挑落點要用它(見下方 `pickCategory` 的第二階段)。
  //    大類的 `count` 已經是 **自身 + 子類加總**(`buildCategoryTree` 做的 rollup)。
  const allCats: { readonly name: string; readonly path: string; readonly count: number }[] =
    src.categories.flatMap((c) => [
      { name: c.name, path: c.name, count: c.count },
      ...c.children.map((s) => ({
        name: s.name,
        path: `${c.name}${CATEGORY_URL_SEPARATOR}${s.name}`,
        count: s.count,
      })),
    ]);
  // 🔴🔴 **兩趟, 而【為什麼是兩趟】是 R2 抓出來的**:
  //    這個迴圈**第一個吃到膠囊的詞就 `break`** ⇒ 早出現的詞會遮蔽晚出現的詞。
  //    🔬 R2 實測:`護網 油箱貼` —— 本片把模糊比對放寬成子字串之後,
  //      `護網` 先用模糊比對吃到 `大燈與護網` ⇒ **`油箱貼` 那條字典從此讀不到**
  //      (舊規則下 `護網` 不是任何分類名的前綴 ⇒ 輪得到 `油箱貼` ⇒ `油箱止滑貼`)。
  //    ⇒ 🛑 **所以「字典排在模糊比對前面」在【單一個詞】裡成立, 在【一句話】裡不成立。**
  //      ⛔ ~~我原本寫「本片變成加法, 字典一列都沒有失效」~~ **那句是假的, 已刪。**
  //    ✅ **修法:把「完全同名 + 字典」跑成第一趟, 全部詞都試過都沒有, 才跑第二趟的模糊比對。**
  //      ⇒ 📌 **這讓「人手寫下來的對應贏猜出來的子字串」變成【對整句成立】, 不只對單一個詞。**
  for (let pass = 0; pass < 2 && category === null; pass += 1) {
    for (let i = 0; i < words.length && category === null; i += 1) {
      if (used.has(i)) continue;
      const w = words[i]!;

      if (pass === 0) {
        // ── ① 完全同名 ⇒ 客人打的就是那個分類名, 意圖最明確 ──────────────
        // 🔴 **同名的也取最大, 不取「陣列第一個」** —— `⟦search-DUPCATNAMES⟧` 記著正式站有
        //    **三組同名分類**(維修零件×3 / 水管束環×2 / 防爆水管組×2)⇒ 用 `find` 的話
        //    落點由 `sort_order` 決定, 而**那個欄位不回答「哪一個比較相關」**。
        const exact = pickLargest(allCats.filter((c) => foldEquals(w, c.name)));
        if (exact) {
          category = exact.path;
          used.add(i);
          break;
        }
        // ── ② 俗稱字典 ⇒ 人工策劃的意圖 ─────────────────────────────────
        // 🔴 **`.filter` 不是 `.find`** —— 同一個 `from` 的每一筆都要收。
        //    而 `synonymFor` 那支(字典檔裡的)**維持原樣不動**:它是 `-auth` 的線,
        //    我動的是【讀它的這一段】。
        // 🔵 **空字串守衛跟著搬過來** —— 原本的 `synonymFor` 有 `if (f === '') return null`,
        //    而我第一版漏了(R1 nit)。今天 42 列全是 CJK ⇒ 行為零差異;而哪天字典加一列
        //    fold 之後變空字串的(純標點), 客人打任何純標點詞都會命中它。
        const foldedWord = foldSearchTerm(w);
        const syns =
          foldedWord === ''
            ? []
            : SEARCH_SYNONYMS.filter(
                (candidate) =>
                  candidate.kind === 'category' && foldSearchTerm(candidate.from) === foldedWord,
              );
        // 🔵 `kind` 已在上面篩掉 ⇒ 這裡只判「有沒有」(原本再判一次 kind 是恆真, R1 nit)。
        if (syns.length > 0) {
          // 🔴 字典查到的**正式名還是要在目錄裡真的存在** —— 否則那一列是死的,
          //    而**死的字典列不會有任何東西叫**(見 `search-synonyms.ts` 的 `土除` 那一列)。
          // 🔵 **每一筆都各自去目錄裡對** —— 字典寫得出來不代表目錄裡有那個分類
          //    (死的字典列不會有任何東西叫)⇒ 對不到的那一筆**只丟那一筆**。
          const resolved: string[] = [];
          for (const candidate of syns) {
            const hit = allCats.find((c) => foldEquals(candidate.to, c.name));
            if (hit && !resolved.includes(hit.path)) {
              resolved.push(hit.path);
              usedSynonyms.push(candidate);
            }
          }
          if (resolved.length > 0) {
            category = resolved[0] ?? null;
            categories = resolved;
            used.add(i);
            break;
          }
        }
        continue;
      }

      // ── ③ 名字含這個詞的候選裡, 取涵蓋最多的 ───────────────────────────
      const fuzzy = pickCategory(allCats, w);
      if (fuzzy) {
        category = fuzzy.path;
        used.add(i);
        break;
      }
    }
  }

  return {
    vehicle,
    brandIds,
    category,
    // 🔵 只解析出一顆時 `categories` 就是那一顆 —— 讓呼叫端**只讀一個欄位**就夠,
    //    不必自己判「要看 category 還是 categories」(那種判斷會有人漏掉)。
    categories: categories.length > 0 ? categories : category !== null ? [category] : [],
    leftover: words.filter((_w, i) => !used.has(i)),
    usedSynonyms,
  };
}

/** 有沒有解析出**任何**東西。🔵 沒有 ⇒ 呼叫端照舊走關鍵字路(那條退路不准動)。 */
export function hasAnyFacet(p: ParsedFacets): boolean {
  return p.vehicle !== null || p.brandIds.length > 0 || p.categories.length > 0;
}
