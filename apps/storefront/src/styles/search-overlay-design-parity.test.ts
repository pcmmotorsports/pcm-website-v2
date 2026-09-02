// search-overlay-design-parity.test.ts — 「本站的疊層樣式與設計稿的差異,恰好是那幾處刻意的」。
//
// 🔴 **這支存在的理由不是為了比對本身,是因為【寫成散文的判準壞了四次而沒有東西會叫】**:
//    ① `head -n -10` 在 macOS(BSD head)跑不起來 ⇒ 印 208
//    ② 改用行數算 ⇒ 算錯一行 ⇒ 印 25
//    ③ 改用錨點切 ⇒ 對了一次,而下一次改註解就又壞(註解被算進差異)
//    ④ 改成「剝註解再比」並把那段 python 寫進 CSS 註解
//       ⇒ 那段 python 含一個【星號接斜線】⇒ **把那個 CSS 註解提前關掉**
//       ⇒ 十行散文變成真的 CSS。⑤ 而我寫那段【更正】時,又原樣引用了那兩個字元一次。
//    📌 **四次都印出一個像樣的數字或安靜地壞掉 —— 因為散文不會跑。**
//    ⇒ 判準搬到這裡,它每次 CI 都跑。
//
// ⚠️ **它證不到什麼**:文字層比對 —— 看不到 cascade 勝負、看不到真實渲染。
//    「搬對」與「長得對」是兩件事,後者只有人眼看得到。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

/** 剝掉註解與本站新增的鎖規則,只留可比對的樣式本體。 */
function normalize(path: string): string[] {
  const raw = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/body\[data-pcm-search-lock\][^}]*\}/g, '');
  return raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
}

const MINE = () => normalize(resolve(HERE, 'search-overlay.css'));
const DESIGN = () => normalize(resolve(REPO, 'design-reference/styles/search-overlay.css'));

/** 兩份的逐行差異(只要行內容不同就算,不做 LCS —— 兩份是同源、行序一致)。 */
function diffLines(): { mine: string; design: string }[] {
  const a = MINE();
  const b = DESIGN();
  expect(a.length, '兩份的行數不同 ⇒ 有人新增或刪掉了整條規則,不只是改值').toBe(b.length);
  const out: { mine: string; design: string }[] = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) out.push({ mine: a[i]!, design: b[i]! });
  return out;
}

/** 三處【刻意】的差異:token 名(10 處)、z-index(1 處)。鎖規則已在 normalize 剝掉。 */
const INTENTIONAL = /--f-sans|--f-mono|--font-sans|--font-mono|z-index/;

describe('search-overlay.css 與設計稿的差異', () => {
  it('🔵 前提 — 稿讀得到而且不是空的(尺沒接上時本格會紅)', () => {
    expect(DESIGN().length, '設計稿讀不到或是空的 ⇒ 下面每一格都零判別力').toBeGreaterThan(100);
    expect(MINE().length).toBeGreaterThan(100);
  });

  it('🔴 每一處差異都必須是【刻意的那三種】之一 —— 沒有夾帶別的改動', () => {
    const unexpected = diffLines().filter((d) => !INTENTIONAL.test(d.mine));
    expect(
      unexpected.map((d) => `本站「${d.mine.trim()}」 vs 稿「${d.design.trim()}」`),
      '出現了預期外的差異 ⇒ 要嘛是不小心改到稿的樣式,要嘛是又多了一處刻意偏離而沒記錄',
    ).toEqual([]);
  });

  it('🔴 那三種【每一種都要真的還在】—— 不是「差異為 0 所以全過」', () => {
    const diffs = diffLines();
    // 🔵 少了這一格,把本檔改成與稿逐字相同(= 把 token 名與 z-index 的修法退掉)
    //    上一格會【全過】,而那正是兩個真缺陷回來的那一刻。
    expect(diffs.filter((d) => /--f-sans|--f-mono/.test(d.mine)).length, 'token 名的修法不見了').toBe(10);
    expect(diffs.filter((d) => /z-index/.test(d.mine)).length, 'z-index 的修法不見了').toBe(1);
  });

  it('🔵 負對照 — 現造一個字串當「刻意差異」的樣式,必須撈不到任何一行', () => {
    expect(diffLines().filter((d) => /zzz-not-a-real-token/.test(d.mine))).toEqual([]);
  });
});
