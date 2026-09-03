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

import { foldSearchTerm, foldEquals, foldStartsWith } from './search-terms-fold';
import { synonymFor, type SearchSynonym } from '@/data/search-synonyms';
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
   *      `app/products/page.tsx:149`(本函式)· `components/use-catalog-filter-url-sync.tsx:181`
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
  /** 🔴 **沒有被任何一顆膠囊用掉的字** —— 它要被畫出來。 */
  readonly leftover: readonly string[];
  /** 用到了哪幾條字典(給畫面標「這是猜的」用;空 = 全靠格式正規化)。 */
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
  // 🔵 分類吃三種:完全相同 / 前綴(`排氣` ⇒ `排氣管`)/ 字典(`油箱貼` ⇒ `油箱止滑貼`)。
  //    🔴 而**字典排最後** —— 能靠格式對上的就不要動用字典(檔頭那條判別句)。
  let category: string | null = null;
  // 🔴 `name` 用來比對(客人打的是短名), `path` 才是要寫進 `?category=` 的東西。
  //    ⚠️ **兩者不可以合成一個** —— 比對要短名, 網址要全路徑, 而那正是這個缺陷的形狀。
  const allCats: { readonly name: string; readonly path: string }[] = src.categories.flatMap((c) => [
    { name: c.name, path: c.name },
    ...c.children.map((s) => ({
      name: s.name,
      path: `${c.name}${CATEGORY_URL_SEPARATOR}${s.name}`,
    })),
  ]);
  for (let i = 0; i < words.length && category === null; i += 1) {
    if (used.has(i)) continue;
    const w = words[i]!;
    const direct = allCats.find((c) => foldEquals(w, c.name) || foldStartsWith(c.name, w));
    if (direct) {
      category = direct.path;
      used.add(i);
      break;
    }
    const syn = synonymFor(w, foldSearchTerm);
    if (syn && syn.kind === 'category') {
      // 🔴 字典查到的**正式名還是要在目錄裡真的存在** —— 否則那一列是死的,
      //    而**死的字典列不會有任何東西叫**(見 `search-synonyms.ts` 的 `土除` 那一列)。
      const real = allCats.find((c) => foldEquals(syn.to, c.name));
      if (real) {
        category = real.path;
        usedSynonyms.push(syn);
        used.add(i);
      }
    }
  }

  return {
    vehicle,
    brandIds,
    category,
    leftover: words.filter((_w, i) => !used.has(i)),
    usedSynonyms,
  };
}

/** 有沒有解析出**任何**東西。🔵 沒有 ⇒ 呼叫端照舊走關鍵字路(那條退路不准動)。 */
export function hasAnyFacet(p: ParsedFacets): boolean {
  return p.vehicle !== null || p.brandIds.length > 0 || p.category !== null;
}
