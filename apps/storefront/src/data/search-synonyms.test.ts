import { describe, expect, it } from 'vitest';
import { SEARCH_CATEGORY_NAMES, SEARCH_CATEGORY_NAMES_SNAPSHOT } from './search-category-names';
import { SEARCH_SYNONYMS, synonymFor } from './search-synonyms';
import { foldSearchTerm } from '@/lib/search-terms-fold';

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
