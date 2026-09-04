// brand-suggestion.ts —— 「你是不是要找 X?」的候選挑選(`⟦search-BRANDTYPOTRGM⟧`)
//
// 🔴🔴 **Sean 2026-09-04 拍板(原話逐字, 正本 `~/pcm-mailbox/Sean拍板-20260904-七題.md`)**:
//    > Q-你是不是要找: 只在搜尋結果【0 筆】時, 畫面多一行「你是不是要找 AKRAPOVIČ?」(客人自己點)
//    > 甲 = 要 (推薦)
//    ⇒ 📌 **三個限定詞都承重**:①**只在 0 筆時** ②**客人自己點** ③**不自動改字**。
//
// 🛑 **而【門檻那條路已經作廢】, 這不是我省事** ——
//    Sean 本人跑的門檻表(板列 `⟦search-BRANDTYPOTRGM⟧` 有逐字抄)四個門檻都留著
//    「亂編的字也中 = 1」, 而真品牌最低分 0.227 ⇒ **兩堆分數重疊, 沒有一條水平線切得開。**
//    ✅ **所以形狀是【top-1, 不設門檻】** —— 同一份來源逐字寫著「10 個錯字的 top-1 全部命中正確品牌」,
//    ⚠️ **而那句話的射程是【品牌錯字】** —— 見下面「證不到什麼」第一條。
//    而「亂編也中」在 0 筆時的代價是**本來什麼都沒有, 現在多一個建議**。
//
// ⛔ **本檔證不到什麼**:
//    · 🔴🔴 **檔頭那句「兩堆分數重疊」的射程, 是【品牌錯字】那一族, 不是全體查詢**
//      (code-reviewer R1 量到第三堆, 而我原本那句把它們一起蓋掉了):
//      `mt07`⇒MATERYA **0.083** · `cbr600rr`⇒CNC RACING **0.053** · `abs`⇒AKRAPOVIČ **0.083**
//      · `a`⇒AKRAPOVIČ **0.100** · `co`⇒SAMCO SPORT **0.125**
//      ⇒ 🎯 **這一堆比 Sean 量的真品牌下限 0.227 低一個量級** ⇒ **一道 ~0.2 的地板殺得掉它們而不碰品牌錯字。**
//      🛑 **而我沒有加那道地板** —— 因為「不設門檻」是我依他的門檻表下的判斷, 而**這是新資料**
//      ⇒ **要他看過再決定**(已端主視窗)。在那之前:打車款代號而零結果的客人, 會看到一個**不相干的品牌建議**。
//    · 🔴 **我的分數與 Sean 量的那些【不是同一把尺】** —— 他用的是 Postgres 的 `similarity()`,
//      本檔是 TS 重新實作的三連字元 Jaccard(**定義同款, 而未驗證逐值相等**)
//      ⇒ 🛑 **不得拿他那些 0.227 / 0.357 來對本檔的輸出。**
//    · 他那 10 個錯字的**逐字清單已經隨對話消失**(拍板檔只留 `evotch` / `akrpovic` 兩個)
//      ⇒ **本檔的測試分母是我自己造的, 不是他的樣本。**

/**
 * 前面補兩格、後面補一格, 再切三連字元。
 *
 * 🔴🔴 **變音符號要先折掉, 而這是 code-reviewer R1 的 must-fix** ——
 *    ⛔ ~~第一版直接 `replace(/[^a-z0-9]+/g,' ')`~~ ⇒ `AKRAPOVIČ` 的 `Č` **整個變成空白**
 *    ⇒ name 側算出來的尾巴是 `vi ` 而不是 `vic`;`Öhlins` 更慘(`Ö` 直接消失)。
 *    🛑 **而它今天「看起來對」只因為我同時比 slug 取 max, 而 slug 恰好都是 ASCII**
 *    ⇒ 📌 **一個依賴「資料剛好長那樣」的正確性, 而沒有任何一格測試釘住那個依賴。**
 *    ✅ 折法與同一個 `lib/` 底下的 `foldSearchTerm()` **同一招**(NFD 之後剝 `U+0300`–`U+036F`),
 *       而**不直接用它** —— 它把分隔符整個刪掉, 而這裡要**留成空白**當詞界。
 *
 * ⚠️ **與 pg_trgm 不同的一點, 明寫**:pg_trgm 是**逐詞**補空白, 本實作對**整串**補一次
 *    ⇒ 多詞品牌名(`GILLES TOOLING` 這種, 站上 21 個品牌裡有 10 個)會產生**跨詞** trigram。
 */
function trigrams(raw: string): Set<string> {
  const core = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // 🔴 **正規化之後是空的 ⇒ 回空集合, 不要回「三個空白」那一個 trigram**。
  //    ⚠️ 這一格是測試抓到的:少了它, `similarity('', '')` = **1**
  //    ⇒ 兩個空字串會被判成「完全一樣」, 而中文查詢(正規化後也是空的)會與它互相匹配。
  if (core === '') return new Set<string>();
  const s = `  ${core} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i += 1) out.add(s.slice(i, i + 3));
  return out;
}

/** Jaccard:|交集| / |聯集|。兩邊都空 ⇒ 0(而不是 1 —— 「都沒有」不是「完全一樣」)。 */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return hit / (A.size + B.size - hit);
}

export type BrandCandidate = { readonly name: string; readonly slug: string };

/**
 * 從品牌清單挑一個最像的。**沒有門檻** —— 理由見檔頭。
 *
 * 🔵 回 `null` 的三種情況:查詢是空的 · 清單是空的 · 所有候選分數都是 0
 *   (**分數 0 = 一個三連字元都沒對上** ⇒ 那不是「最像」, 那是「毫無關係」)。
 * 🔴 **平手時取【清單順序在前】的那一個** —— 而不是「隨便一個」:
 *    平手在 25 個品牌的清單上是真的會發生的, 而**不穩定的輸出會讓同一個字每次建議不同的牌子**。
 */
export function suggestBrand(
  query: string,
  brands: readonly BrandCandidate[],
): BrandCandidate | null {
  const q = query.trim();
  if (q === '' || brands.length === 0) return null;
  let best: BrandCandidate | null = null;
  let bestScore = 0;
  for (const b of brands) {
    const score = Math.max(trigramSimilarity(q, b.name), trigramSimilarity(q, b.slug));
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return bestScore > 0 ? best : null;
}
