import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// home-banner-editor-copy.test.ts — 釘住編輯面板【對員工講狀態的那幾句話】與那顆下架鈕的字。
//
// 🔴 **這支存在的理由**:`live` / `scheduled` / `ended` 在 DB 裡**都是 `status = 'published'`**,
//    而客人看到的完全不一樣(正掛著 / 還沒上架 / 檔期過了)。
//    原本三種共用一句「這張已經發布」⇒ **對後面兩種是假的**,而假字面不會自己被發現。
//    同理那顆鈕:`scheduled` 還沒上架, 寫「下架」談不上「下」。
//
// ✅ 證得到:`home-banner-editor.tsx` **原始碼字面**的形狀。
// ⛔ 證不到:渲染出來長什麼樣、員工讀完會不會做對事。那要 Sean 自己開瀏覽器。
//
// 🔬 照 `page-copy.test.ts` 的房規:每一格寫成 `xxxProblems(來源) => string[]` 的**純函式**,
//    正對照餵真檔、負對照餵改壞的同一支 ⇒ 兩邊走同一段程式,
//    不會出現「正對照過了而那道閘其實量不到東西」。

const EDITOR = 'apps/admin/src/components/home-banners/home-banner-editor.tsx';
const SRC = readFileSync(join(process.cwd(), EDITOR), 'utf8');

/**
 * 剝掉 `{/* … *\/}` 那種 JSX 註解 —— 斷言只准在**真的會渲染的字**上成立。
 * 🔴 這不是預防性的:2026-09-17 寫這支時**當場踩到** —— 我在那段裡寫了一行註解解釋
 *    「原本三種共用一句『這張已經發布』」⇒ **斷言在我自己的註解上被滿足** ⇒ 誤報。
 *    跟 `home-banner-duplicate-sql.test.ts` 記的是同一條房規, 這段話留著當疤。
 */
function stripJsxComments(block: string): string {
  return block.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** 切出 `{!isDraft ? (` 到 `<fieldset` 之間那一段 —— 「不能改」那句話的家。 */
function lockedBlock(src: string): string {
  const start = src.indexOf("data-testid='home-banner-locked'");
  if (start < 0) throw new Error('切不出 locked 那一段 ⇒ 形狀變了, 先看它再改測試');
  const end = src.indexOf('<fieldset', start);
  return stripJsxComments(src.slice(start, end));
}

/** 🔴 四種狀態各自要有自己的真話, 而且舊那句共用的不准留。 */
function statusSentenceProblems(src: string): string[] {
  const block = lockedBlock(src);
  const problems: string[] = [];
  for (const [needle, why] of [
    ["state === 'archived'", '沒有 archived 的分支'],
    ["state === 'ended'", '沒有 ended 的分支 ⇒ 過期那張會被說成「已經發布」'],
    ["state === 'scheduled'", '沒有 scheduled 的分支 ⇒ 還沒上架那張會被說成「已經發布」'],
  ] as const) {
    if (!block.includes(needle)) problems.push(why);
  }
  for (const [needle, why] of [
    ['檔期已經過了', 'ended 那句沒講「檔期已經過了」'],
    ['已排程、還沒上架', 'scheduled 那句沒講「已排程、還沒上架」'],
    ['正掛在首頁上', 'live 那句沒講「正掛在首頁上」'],
    ['已經封存', 'archived 那句沒講「已經封存」'],
  ] as const) {
    if (!block.includes(needle)) problems.push(why);
  }
  // 🔴 舊字面不准留 —— 它對 scheduled / ended 是假的。
  if (block.includes('這張已經發布')) {
    problems.push('還留著「這張已經發布」—— 那句對 scheduled / ended 是假的');
  }
  // 🛑 而「不能直接改」這句【要保留】:2026-09-17 Sean 逐字擱置「封存也能改」那條路
  //    ⇒ 改的路就是複製 ⇒ 那句仍然是對的, 並且要指得出出路。
  if (!block.includes('不能直接改')) problems.push('「不能直接改」不見了 —— 改的路是複製, 那句仍然對');
  if (!block.includes('複製一張來改')) problems.push('沒有指出出路(複製一張來改)');
  return problems;
}

/** 🔴 那顆鈕三種說法, 不是兩種。 */
function buttonLabelProblems(src: string): string[] {
  const m = src.match(/\{state === 'draft' \? '封存' : ([^}]*)\}/);
  if (m?.[1] === undefined) return ['切不出那顆鈕的三元式 ⇒ 形狀變了, 先看它再改測試'];
  const rest = m[1];
  const problems: string[] = [];
  if (!rest.includes("state === 'scheduled' ? '取消排程'")) {
    problems.push('排程那張的鈕不是「取消排程」—— 還沒上架, 談不上「下」架');
  }
  if (!rest.includes("'下架'")) problems.push('掛著 / 過期那張的鈕不是「下架」');
  return problems;
}

describe('編輯面板:狀態講的話與那顆鈕的字', () => {
  it('① 四種狀態各講各的真話,不共用「這張已經發布」', () => {
    expect(statusSentenceProblems(SRC)).toEqual([]);
  });

  it('① 負對照:四種改回共用一句「這張已經發布」⇒ 這格要紅', () => {
    const start = SRC.indexOf("{state === 'archived'");
    const end = SRC.indexOf('</p>', start);
    if (start < 0 || end < 0) throw new Error('切不出那一段 ⇒ 形狀變了');
    // 🔵 不用 `!`:那個 `!` 會讓「切不出來」靜靜變成空字串比對,
    //    而負對照一旦量不到東西, 會長得跟「有守住」一模一樣。
    const broken = SRC.slice(0, start)
      + '這張已經發布,<strong>不能直接改</strong>。要改請按「複製一張來改」。\n            '
      + SRC.slice(end);
    expect(statusSentenceProblems(broken).length).toBeGreaterThan(0);
  });

  it('② 排程那張的鈕寫「取消排程」,不是「下架」', () => {
    expect(buttonLabelProblems(SRC)).toEqual([]);
  });

  it('② 負對照:排程那張改回「下架」⇒ 這格要紅', () => {
    const broken = SRC.replace("state === 'scheduled' ? '取消排程' : '下架'", "'下架'");
    expect(buttonLabelProblems(broken).length).toBeGreaterThan(0);
  });

  it('③ 🔬 註解裡出現那些字不算數(斷言只在真的會渲染的字上成立)', () => {
    // 🔴 這一格釘的是 `stripJsxComments` 本身 —— 它 2026-09-17 當場救過一次誤報。
    const withComment = SRC.replace(
      "{state === 'archived'",
      '{/* 說明:原本三種共用一句「這張已經發布」 */}\n              {state === \'archived\'',
    );
    expect(statusSentenceProblems(withComment)).toEqual([]);
  });
});
