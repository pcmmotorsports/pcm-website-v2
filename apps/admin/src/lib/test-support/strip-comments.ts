// strip-comments.ts — 原始碼字面守門用的註解剝除器(admin 共用)。
//
// 🔴 **住在非 `.test.ts` 檔**:原本它 `export` 在 `app-sidebar.test.ts` 裡,而別的測試 import 它時
// vitest 會把**那支檔的 `describe` 一起註冊進 importer** ⇒ 同一組測試被跑兩次。搬出來就沒有這個副作用。
//
// ⛔ ~~`return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');`~~
// 🔴🔴 **2026-08-31:從 regex 換成 TypeScript parser。舊字面留著,因為它曾經是對的、而且很有說服力。**
//
// 🔴 **為什麼不是 regex**(來源 = `-08` 2026-08-30 在 `storefront-projection-leak-guard.test.ts`
//    的四版演進與實測,本檔逐字沿用它第四版的取範圍邏輯):
//    `src.replace(/\/\*[\s\S]*?\*\//g, '')` 會**安靜地吃掉真程式碼** ——
//    供給源是「`*/` 這兩個字元」而不是「註解」,所以一個 `// dev-preview/*` 的行註解
//    就能開一個假區塊,直到下一個 `*/` 才收尾。
//    ⇒ `-08` R2 live 量到:`PreviewHarness.tsx:8` 開、`:17` 收 ⇒ **206 行真程式碼 / 27 支檔
//      當天就從掃描裡消失**,而 guard 照樣全綠。
//    📌 **一個少掃了 27 支檔的掃描器,與一個「真的沒有命中」的掃描器,印同一個綠。**
//
// ⚠️ 中間兩版為什麼也不夠(留著,免得下一個人發明回來):
//    · 逐行剝 ⇒ 答不出「這一行裡有幾段是註解」
//    · 裸 `ts.createScanner` ⇒ 答不出帶 `${}` 的 template(那要 parser 驅動
//      `reScanTemplateToken`)⇒ 它的表現是「**有剝掉一些**」不是整個壞掉 ⇒ 半對的輸出最難發現。
//
// 🔴 **本檔與 `-08` 那一版的【唯一差別】,而它是刻意的**:
//    它把註解區間**刪掉**;本檔**換成等長空白、保留換行**。
//    理由是呼叫端:`order-status-axes-importers.test.ts` 的比對式是
//    `^[ \t]*(?:import|export)…` 帶 `m` 旗標 ⇒ **它依賴行結構**。
//    刪掉一段跨行的區塊註解會把後面那個 `import` **併到上一行的碼後面** ⇒ `^` 不再匹配
//    ⇒ 📌 **少認一個 importer,而那是【漏放】方向,不是誤紅。**
//    ⇒ 換空白對三個呼叫端都安全(另兩個只做子字串比對與 `.trim()`),而刪除不是。
//
// ⚠️ **殘留盲區(照 `-08` 的原文寫,不改成安慰話)**:
//    ① parser 對**語法壞掉**的檔是容錯的,它可能少認出一段註解 ⇒ 那個方向是**多掃**(誤紅),不是漏放。
//    ② 這仍然只是**文字層**:跳脫序列拼出來的字面照樣掃不到。
import ts from 'typescript';

/**
 * 把 `source` 裡的註解換成等長空白(換行保留),回傳同長度的字串。
 *
 * @param fileName **可省**(預設當 `.ts` 讀)—— 既有 17 個呼叫端一行都不用改。
 *   🔴 **「可省」是量到的,不是圖方便**:拿 `apps/admin/src` **641 支檔**(`.ts` 388 / `.tsx` 253)
 *   逐支比「用真副檔名」vs「一律當 `.ts`」⇒ **不同的檔數 = 0**;而「一律當 `.tsx`」⇒ **1**。
 *   ⇒ 所以預設選 `.ts`。⚠️ **那個 0 是今天的 0,不是永遠** —— 而萬一哪天不同,
 *   方向是**註解沒被剝掉 = 掃描器看到更多字 = 誤紅**,不是漏放(見下方那一格)。
 *   ✅ 三支自己 inline 過 regex 的守門會**明確傳真檔名**,不吃這個預設。
 *
 * @param fileName 只用來決定 `ScriptKind` —— `.tsx`/`.jsx` 走 TSX。
 *   🔴 這個參數**在承重,而我量過**:`<Foo>` 在 TS 與 TSX 下語意相反(型別斷言 vs JSX 元素)。
 *   ⚠️ 而它**不是每一種輸入都會分歧** —— 我試了五種形狀,**三種輸出完全相同**
 *   (泛型箭頭 `<T,>` / 斷言後接註解 / JSX 屬性內註解);真的會分歧的是**型別斷言**:
 *   `const a = <string>b; /* C *​/ …` 餵成 `.tsx` ⇒ 被讀成沒收尾的 JSX 元素
 *   ⇒ **那段註解剝不掉**(`strip-comments.test.ts` 有那一格)。
 *   📌 **⇒ 方向是「註解留下來」= 掃描器看到更多字 = 誤紅,不是漏放** —— 與下方盲區①同向。
 *   🛑 **而我沒有量到「整支檔被錯讀」那種形狀** —— 那句是從 `-08` 的原文繼承的,我把它改成我量到的。
 */
export function stripComments(source: string, fileName = 'strip-comments-default.ts'): string {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const cuts: Array<[number, number]> = [];
  const add = (rs: readonly ts.CommentRange[] | undefined): void => {
    for (const r of rs ?? []) cuts.push([r.pos, r.end]);
  };
  // 🔴 走 `getChildren` 不是 `forEachChild` —— 後者跳過標點 token,
  //    而 JSX 的 `{/* … */}` 正好掛在 `}` 上。
  const visit = (n: ts.Node): void => {
    add(ts.getLeadingCommentRanges(source, n.getFullStart()));
    add(ts.getTrailingCommentRanges(source, n.getEnd()));
    for (const c of n.getChildren(sf)) visit(c);
  };
  visit(sf);
  // 同一段註解會被相鄰 token 各報一次 ⇒ 用一張「這個位置是不是註解」的旗標表,
  // 重複回報自然疊在一起,不必處理區間合併。
  const blank = new Uint8Array(source.length);
  for (const [a, b] of cuts) {
    for (let i = Math.max(0, a); i < Math.min(b, source.length); i += 1) blank[i] = 1;
  }
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    out += blank[i] === 1 && ch !== '\n' ? ' ' : ch;
  }
  return out;
}
