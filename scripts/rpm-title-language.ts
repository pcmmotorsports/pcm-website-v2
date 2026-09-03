// rpm-title-language.ts — 品名語言報告(Q31,Sean 2026-09-03 拍甲)
//
// 🔴 **它解的問題**:沒翻譯的商品【不會被擋】—— `rpm-transform.ts:364` 是
//    `title = product_name_zh || product_name` ⇒ 沒中文就**靜靜地用英文名上架**,
//    而唯一看品名的 `title-shape-gate` 判準是「這個字串有沒有【任何】商品資訊」
//    ⇒ 🎯 **一個英文名【是】有資訊 ⇒ 它過。** 那道閘擋的是 `#N/A`,不是「還沒翻」。
//    ⇒ ⇒ 所以「這家還有幾件是英文名」今天**沒有任何地方看得到**。本檔補的就是那一格。
//
// 🔴🔴 **為什麼判準是「title 沒有中文字」而不是「`product_name_zh` 欄是空的」**
//    —— 這不是品味,是**一發實測擋在那裡**:
//      · `rpm-preflight.test.ts:276` 逐字「2026-08-21 實測:dna **787 筆全部**有 `product_name_zh`」
//      · 而同一天 `~/pcm-mailbox/W1-107-客人看得到的壞資料-20260821.md:51` 量到
//        「品名完全無 CJK **18 件**(客人看得到 18)」
//    ⇒ 🎯 兩件同時成立 ⇒ **那個欄位【有值】而值是英文**
//    ⇒ ⇒ 「欄位空不空」會對那 18 件回報 **0** —— 它量的是「有沒有填」,不是「填的是不是中文」。
//
// 🛑 **這個數字【證不到】什麼 —— 不要把它讀寬**:
//    · 假陽性 = 本來就沒有中文名的東西(純型號 `360°` / `Quad Lock MAG Ring`)。
//      🔵 而它**不是未知**:W1-107 那一天逐筆看過,18 件裡 **17 件**屬這一類。
//      ⚠️ 而那是 **2026-08-21 那一天的數**,沒有重跑 ⇒ **不得當現值。**
//    · 假陰性 = 中英混雜(「碳纖維 Front Fender」)⇒ 有中文 ⇒ 本尺放它過,而它只翻了一半。
//    · 🔴 **翻了但翻錯**(A 的名字掛到 B)⇒ **本尺與任何形狀檢查都答不出來**
//      —— `title-shape-gate.ts:23` 自己逐字寫過「形狀檢查對語意無能為力」。
//    ⇒ 📌 **報告的字面是「品名沒有中文字」** —— 刻意【不】寫「還是英文名」也不寫「沒翻好」:
//      🔴 本尺跑在 `title-shape-gate` **之前**, 所以 `#N/A` / `TBD` 這種【壞名】也會進分子。
//         叫它「英文名」會把一個壞掉的值宣告成一個正常的英文品名(而那正是 title-shape-gate 那件事故)。
//      🔴 而「沒翻好」宣稱了一個我們量不到的東西(翻了但翻錯)。
//
// 🔴 **分母的形狀抄 `rpm-preflight.ts:390-403` 的【原則】,不是抄它的變數名**:
//    那段 docstring 逐字記著「R1 審查的 DN-1 是**呼叫端把『全部的列數』當成『實際掃描列數』傳**
//    ⇒ **話對、數字錯,而畫面上分不出來**。修法是**讓呼叫端沒有機會傳錯**」。
//    ⇒ ✅ 所以本檔**收列陣列、不收 number**,兩個數都由同一份 `rows` 算出來。
//
// 🛑 **只印不擋**(warn 級)—— 與 `title-shape-gate.ts:10`「有資訊但形狀可疑 ⇒ warn,**永不擋**」
//    同一個哲學:擋了等於為一個猜測停掉整家同步。**這一格有測試釘住,不要改成擋。**

/** 判別用的最小列形狀 —— 只需要顯示用的那一串。 */
export type TitleLanguageRow = { external_id: string; title: string };

export type TitleLanguageReport = {
  /** 🔴 分母 = **本次轉換出的商品數(群)**,不是「來源列」——
   *  後者在本 repo 專指逐變體的來源 view 列(`rpm-import.ts:246` / `rpm-delta.ts:264`)。 */
  total: number;
  /** 其中「品名一個中文字都沒有」的商品數(分子)。 */
  noChinese: number;
  /** 那幾個的 external_id —— **會被印出來**(見 `printTitleLanguageReport`),供人抽查。 */
  ids: string[];
};

/**
 * 一個字串裡有沒有中文字。
 * 🔵 用 `Script=Han` 而不是寫死 CJK 區段:後者要維護一張會過期的範圍表。
 */
export function hasChineseChar(s: string): boolean {
  return /\p{Script=Han}/u.test(s);
}

/**
 * 🔴 **兩個數都從同一份 `rows` 算出來** —— 呼叫端沒有機會傳一個對不起來的分母。
 *    (理由見檔頭那段 `rpm-preflight.ts:390-394` 的引用。)
 */
export function countTitlesWithoutChinese(rows: readonly TitleLanguageRow[]): TitleLanguageReport {
  const missing = rows.filter((r) => !hasChineseChar(r.title));
  return { total: rows.length, noChinese: missing.length, ids: missing.map((r) => r.external_id) };
}

/**
 * 印一行給跑上架的人看。
 * 🔴 **零件英文名時仍然印** —— 一個只在「有東西」時才出現的報告,
 *    與「這道檢查根本沒跑」在畫面上長同一個樣子。
 */
export function printTitleLanguageReport(
  rows: readonly TitleLanguageRow[],
  fullMode: boolean,
): TitleLanguageReport {
  const r = countTitlesWithoutChinese(rows);
  // 🔴 `--group` / `--limit` 下分母【不是全量】—— 照 `rpm-import.ts:333` 的既有慣用法,
  //    否則 `--limit 5` 會印出一個看起來很乾淨的「0 / 5」= 假的全綠。
  const scopeNote = fullMode ? '' : '(篩選後、非全量比例)';
  // 🛑 括號裡那句是【射程】不是裝飾。
  const how = '分母=本次轉換出的商品數;判法=顯示用品名無中文字元';
  const head = `\n=== 品名語言 gate(Q31)===`;
  const line =
    `${r.noChinese === 0 ? '✅' : '⚠️'} 本次 ${r.total} 個商品, ` +
    `其中 ${r.noChinese} 個品名沒有中文字${scopeNote}(${how})`;
  // 🔵 >0 走 warn(與 `rpm-preflight.ts:405` 同族), 0 走 log —— 只讀 warn 的過濾器才看得到該看的那一種。
  if (r.noChinese === 0) console.log(`${head}\n${line}`);
  else console.warn(`${head}\n${line}`);
  // 🔴 `ids` 要印出來, 否則型別上算得出來而**沒有人看得到** —— 那句「供人抽查」就會是一個假的宣稱。
  if (r.ids.length > 0) {
    console.warn(`   料號:${r.ids.slice(0, 30).join(', ')}`);
    if (r.ids.length > 30) console.warn(`   (另有 ${r.ids.length - 30} 個未列)`);
  }
  return r;
}
