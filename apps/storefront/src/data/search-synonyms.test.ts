import { describe, expect, it } from 'vitest';
import {
  SEARCH_CATEGORY_AMBIGUOUS_NAMES,
  SEARCH_CATEGORY_EMPTY_NAMES,
  SEARCH_CATEGORY_NAMES,
  SEARCH_CATEGORY_NAMES_SNAPSHOT,
} from './search-category-names';
import { SEARCH_SYNONYMS, synonymFor } from './search-synonyms';
import { parseSearchFacets } from '@/lib/parse-search-facets';
import { foldEquals, foldSearchTerm } from '@/lib/search-terms-fold';

// ⟦search-CAPSULEPARSE⟧ · code-reviewer 2026-09-04 minor
//
// 🔴🔴 **這支檔存在的理由是一個問句,而它的答案本來是「沒有」**:
//    我在 `search-synonyms.ts` 自己標了「`土除 ⇒ 前擋泥板` 若目錄裡沒有那個分類,
//    這一列今天就是死的」——
//    ⇒ 🛑 而 reviewer 問「**有沒有東西會告訴你它是死的?**」⇒ **沒有。**
//    ⇒ 📌 **一個【我自己標記了的缺口】與【沒有標記的缺口】,在「會不會有人發現」上是一樣的**
//      —— 標記讓我心安,而它不會叫。
//
// ⚠️ **而這支檔【擋不到】那個缺口的全部** —— 射程要講清楚:
//    它驗的是「這張表**自己**內部一致」(格式、必填欄、`from` 不重複、fold 之後不空),
//    **不是**「`to` 真的對得到正式站的分類」——
//    後者要拿**真 taxonomy** 比,而那份東西只有 server 執行時才有。
//    ⇒ 🔵 而**解析器已經替我擋住那個世界的後果**(`parse-search-facets.ts`:
//      字典查到的正式名還要在目錄裡真的存在才採用)⇒ 死列不會產生錯的膠囊,
//      它只是**靜靜地沒有效果**。
//    ⇒ 🔴 **⇒ 所以真正沒有守門的是「它沒效果」這件事本身。** 那一格我沒有解掉,明寫在這裡。

describe('SEARCH_SYNONYMS — 這張表自己要站得住', () => {
  it('🔴 每一列的 from / to 折過之後都【不得是空的】', () => {
    for (const s of SEARCH_SYNONYMS) {
      expect(foldSearchTerm(s.from), `${s.from} 折完是空的 ⇒ 它會命中每一個東西`).not.toBe('');
      expect(foldSearchTerm(s.to), `${s.to} 折完是空的`).not.toBe('');
    }
  });

  it('🔴 `from` 不得重複(重複 ⇒ 後面那列永遠查不到,而不會有人發現)', () => {
    const seen = SEARCH_SYNONYMS.map((s) => foldSearchTerm(s.from));
    expect(new Set(seen).size, `重複的 from:${seen.join(',')}`).toBe(seen.length);
  });

  it('🔴 `from` 與 `to` 不得折成同一個 —— 那樣這一列什麼都沒做', () => {
    for (const s of SEARCH_SYNONYMS) {
      expect(
        foldSearchTerm(s.from) === foldSearchTerm(s.to),
        `${s.from} ⇒ ${s.to}:兩邊折完一樣 ⇒ 正規化本來就會中, 這一列是多餘的`,
      ).toBe(false);
    }
  });

  // 🔴 `draft` = AI 查來未經人核 ⇒ 它**必須**說得出自己是怎麼來的。
  // 🔴🔴 **這一格是 2026-09-04 補的, 而它擋的是【這張表最會出的錯】**:
  //    `to` 打成一個**不存在的分類名** ⇒ 那一列什麼都對不到, 而**先前沒有任何東西會紅**
  //    (上面那幾格只驗格式:非空、不重複、from≠to、draft 有 note)。
  //    🎯 而既有那一列 `土除 ⇒ 前擋泥板` 就是這樣活到今天的 —— **不是誰寫錯了, 是沒有東西在檢查。**
  //    🛑 天花板見 `search-category-names.ts` 檔頭:那份快照是 migrations 的**超集**
  //       (134 vs 正式庫實測 117)⇒ 它防**打錯字**, 不防「這個分類真的還在嗎」。
  it.each(SEARCH_SYNONYMS.filter((s) => s.kind === 'category'))(
    "🔴 category 列的 `to` 必須是真的分類名:%s",
    (syn) => {
      expect(
        SEARCH_CATEGORY_NAMES.includes(syn.to),
        `「${syn.from} ⇒ ${syn.to}」的 to 不在合法分類名快照裡(快照 ${SEARCH_CATEGORY_NAMES.length} 個,` +
          ` 取自 ${SEARCH_CATEGORY_NAMES_SNAPSHOT.takenAt})⇒ 這一列今天指不到任何東西`,
      ).toBe(true);
    },
  );

  // 🔴🔴🔴 **2026-09-04 訂正:這一道【呼叫解析器】, 不再複述它的規則。**
  //
  //  ⛔ ~~原本這裡是【兩道】閘, 而兩道都是把 `parse-search-facets.ts` 的行為【重打一份】~~:
  //     · 前綴閘:自己寫 `foldStartsWith(name, syn.from)`  ← 複製 `:100` 的規則
  //     · 空白閘:自己寫 `/[\s　 ]/`                        ← 複製 `:42` `splitWords` 的行為
  //  🛑 **而這支測試檔【沒有 import 那支解析器】** ⇒ 它守的是那兩份副本, 不是生產碼。
  //     ⇒ 🎯 生產碼哪天把 `foldStartsWith` 換成 `foldIncludes`(線【前台】正在做),
  //       前綴閘**還在測一條已經不存在的規則, 而且全綠** ——
  //       分母:兩道閘 × 32 列 = **64 格**在同一秒失去意義而不出聲。
  //  ⇒ 📌 **一道測試若不 import 被測的那支碼, 它守的是它自己的那份副本。**
  //     (2026-09-04 同一天三個受詞:線【前台】測試重打生產規則 ⇒ 5 列變讀不到而 144 全綠;
  //      本檔這兩道 ⇒ 還沒發作的假綠 64 格;線【DB】全樹掃描守門與 related 沒有 import 關係。)
  //  🔴 **而失效時間不由我決定** —— 它在【別人的 commit 落地那一刻】變成假的
  //     ⇒ 所以這件不能排在別人後面。
  //
  //  ✅ **改法:把 `from` 餵進【真的解析器】, 看它是不是靠【這一列】解出 `to` 的。**
  //     🎯 這一道同時取代了原本那兩道, 而且**嚴格更強** —— 它不管規則長什麼樣,
  //        只問「客人打這個字, 我們的碼會不會用這一列把他帶到 `to`」。那才是這一列存在的理由。
  //     🔵 它順帶也擋住了兩件原本要另外寫的事:`to` 不在目錄樹裡 / `to` 沒有商品
  //        —— 因為 `allCats` 就是有貨的那份(下面 `SRC` 是照 `buildCategoryTree` 的語意造的)。
  //  ⚠️ **這一格的天花板**:`SRC` 是用快照造的假目錄樹, 不是真的 `buildCategoryTree` 輸出
  //     ⇒ 它驗得了「規則與字典怎麼互動」, 驗不了「快照跟不跟得上正式庫」——
  //       後者由 `SEARCH_CATEGORY_EMPTY_NAMES` 那段檔頭寫的「上架後要重跑那行 SQL」負責。
  const LIVE_CATS = SEARCH_CATEGORY_NAMES.filter((n) => !SEARCH_CATEGORY_EMPTY_NAMES.includes(n));
  const FACET_SRC = {
    motoBrands: [],
    brands: [],
    // `buildCategoryTree` 的語意:只留有商品的分類。這裡攤平成單層, 解析器對 children 是 flatMap, 等價。
    categories: LIVE_CATS.map((name, i) => ({ id: `c${i}`, name, children: [] })),
  } as unknown as Parameters<typeof parseSearchFacets>[1];

  it('🟢 正對照:這把尺量得到東西(假目錄樹非空, 且解析器對【規則就吃得到】的字會回分類)', () => {
    // 🔴 少了這一格, FACET_SRC 若變成空的 ⇒ 下面每一格都紅, 看起來像字典壞了(而其實是尺壞了)。
    expect(LIVE_CATS.length).toBeGreaterThan(50);
    const direct = parseSearchFacets('排氣', FACET_SRC);
    expect(direct.category, '「排氣」應該靠規則本身就命中, 不需要字典').not.toBeNull();
    expect(direct.usedSynonyms, '「排氣」不該用到字典').toHaveLength(0);
  });

  it.each(SEARCH_SYNONYMS.filter((s) => s.kind === 'category'))(
    '🔴 把 `from` 餵進真的解析器, 它必須靠【這一列】解出 `to`:%s',
    (syn) => {
      const out = parseSearchFacets(syn.from, FACET_SRC);
      const usedThis = out.usedSynonyms.some((u) => u.from === syn.from);
      // 🔵 訊息在【紅的時候】才算, 所以診斷寫在這裡, 平常不花錢。
      const why =
        out.category === null
          ? `解析器回 null —— 可能是 to「${syn.to}」不在目錄樹裡(打錯字 / 那個分類 0 件),` +
            ` 或 from 含空白(解析器逐字拆 ⇒ 帶空白的永遠餵不進字典)`
          : usedThis
            ? `靠這一列解出來了, 但落到「${out.category}」而不是「${syn.to}」`
            : `落到「${out.category}」而【沒有用到這一列】 ⇒ 規則本身就先命中了` +
              ` ⇒ 這一列是純多餘, 刪掉(或那個規則改了, 這一列要跟著改)`;
      expect(usedThis && out.category === syn.to, `「${syn.from} ⇒ ${syn.to}」${why}`).toBe(true);
    },
  );

  it.each(SEARCH_SYNONYMS.filter((s) => s.kind === 'category'))(
    '🔴 `to` 不得指向【同名掛在不同父分類】的那幾個(名字不是唯一鍵, 會選到哪一列不知道):%s',
    (syn) => {
      expect(
        SEARCH_CATEGORY_AMBIGUOUS_NAMES.includes(syn.to),
        `「${syn.from} ⇒ ${syn.to}」的 to 是同名分類(正式庫有多列同名)` +
          ' ⇒ foldEquals 會回先出現的那一列, 而你不知道是哪一列。換一個名字, 或停下來報主視窗。',
      ).toBe(false);
    },
  );

  // 🔴🔴 **2026-09-04 補:`to` 指到一個【沒有商品】的分類, 那一列也是死的。**
  //    🛑 而它與上面那道「to 必須是真的分類名」**不是同一件事** ——
  //       分類名**存在**、拼字**完全正確**、上面那格**全綠**, 而 `buildCategoryTree`
  //       走的是「只留有商品的分類」⇒ 沒商品的分類**不在目錄樹裡** ⇒ 解析器找不到它。
  //    🔬 **這一格是我自己踩出來的**:同日 `64014acc6` 我一次加了 16 列, 而其中 **9 列**
  //       指向 排氣系統 / 煞車系統 / 精品螺絲與螺帽 —— 三個都是 **0 件**。
  //       ⇒ 上面那格**對這 9 列印了綠**, 因為它問的是「名字在不在」不是「那裡有沒有東西」。
  //    ⇒ 📌 **判別句:我這道閘問的是「這個名字存在嗎」, 還是「那個名字底下有東西嗎」?**
  //    ⚠️ 天花板:`SEARCH_CATEGORY_EMPTY_NAMES` 是**快照**(見該檔註解)。
  //       它過期的方向是單向的:分類進貨而清單沒更新 ⇒ **這一格誤殺** ⇒ 會紅、會被看到;
  //       分類被清空而清單沒更新 ⇒ **這一格漏抓** ⇒ 安靜 ⇒ 所以上架後要重跑那行 SQL。
  it.each(SEARCH_SYNONYMS.filter((s) => s.kind === 'category'))(
    '🔴 `to` 底下必須真的有商品(空分類不會進目錄樹 ⇒ 那一列指不到東西):%s',
    (syn) => {
      expect(
        SEARCH_CATEGORY_EMPTY_NAMES.includes(syn.to),
        `「${syn.from} ⇒ ${syn.to}」的 to 在 2026-09-04 的正式庫是 0 件 ⇒ 它不會出現在目錄樹裡` +
          ' ⇒ 這一列沒有效果。換一個有貨的分類, 或等它進貨後把它從 EMPTY 清單移除。',
      ).toBe(false);
    },
  );

  it('🟢 正對照:那份【0 件分類】清單不是空的, 而且每一個都真的是分類名', () => {
    // 🔴 少了這一格, EMPTY 若變成空陣列 ⇒ 上面那組全綠而什麼都沒擋。
    expect(SEARCH_CATEGORY_EMPTY_NAMES.length).toBeGreaterThan(10);
    for (const n of SEARCH_CATEGORY_EMPTY_NAMES) {
      expect(SEARCH_CATEGORY_NAMES.includes(n), `${n} 不在分類名快照裡 ⇒ 這份清單自己過期了`).toBe(true);
    }
  });

  it('🟢 正對照:那份同名清單不是空的(空的話上面那組等於沒驗)', () => {
    expect(SEARCH_CATEGORY_AMBIGUOUS_NAMES.length).toBeGreaterThan(0);
    // 🔵 而它們每一個都真的在快照裡 —— 否則這張清單自己就過期了
    for (const n of SEARCH_CATEGORY_AMBIGUOUS_NAMES) {
      expect(SEARCH_CATEGORY_NAMES.includes(n), `${n} 不在分類名快照裡 ⇒ 清單過期了`).toBe(true);
    }
  });

  it('🟢 正對照:那份快照不是空的, 也不是恆真', () => {
    // 🔴 少了這一格, 快照若變成空陣列 ⇒ 上面那組 it.each 會【每一格都紅】而看起來像資料壞了;
    //    而若 includes 被改成恆真 ⇒ 上面那組會全綠而什麼都沒驗。兩個方向各釘一次。
    expect(SEARCH_CATEGORY_NAMES.length).toBeGreaterThan(100);
    expect(SEARCH_CATEGORY_NAMES.includes('這個分類不存在')).toBe(false);
  });

  it('🔴 `draft` 的列一定要有 note 與 added 日期(不然數不出它躺多久)', () => {
    for (const s of SEARCH_SYNONYMS.filter((x) => x.source === 'draft')) {
      expect(s.note.length, `${s.from} 沒寫 note`).toBeGreaterThan(10);
      expect(s.added, `${s.from} 的 added 不是 YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('🔵 查得到 / 查不到', () => {
    expect(synonymFor('油箱貼', foldSearchTerm)?.to).toBe('油箱止滑貼');
    expect(synonymFor('zzz不存在zzz', foldSearchTerm)).toBeNull();
    // 🛑 空的一律查不到 —— 否則它會命中表上第一列。
    expect(synonymFor('', foldSearchTerm)).toBeNull();
    expect(synonymFor('---', foldSearchTerm)).toBeNull();
  });
});
