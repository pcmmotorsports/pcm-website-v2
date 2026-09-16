// admin-copy-no-markdown-stars.test.ts —— 後台的可見文案不得含 Markdown `**`(2026-09-17)。
//
// ══ 🔴 為什麼要有它、以及它為什麼是【把舊閘改長】不是【加新閘】═══════════════
// 同一個病 2026-09-16~17 兩天內**四次**,每一次都印在員工畫面上:
// ```
// ① cancel-result-panel 的 MARK_REJECTED_BY_REASON   ← 守門存在, 而新常數不在它的分母裡
// ② settings/audit/page.tsx 的「是**選填**的」        ← 那道守門只掃 ① 那支檔
// ③ shipment-dialog-copy.ts 的 staleDeploymentMessage  8 處
// ④ shipment-dialog.tsx / manual-cancel-notice-button.tsx 各 1 處
// ```
// 🎯 **③④ 是【上線中的真 bug】,不是理論**:那一串走
//    `shipment-dialog.tsx` `setResult({ …, code: null })` ⇒ `parseShipmentError(null, …)`
//    回 `{ copy: null }` ⇒ `<p>{result.message}</p>` **純文字** ⇒ 星號原樣印出來,
//    而那正好是「部署中途換版」那個本來就夠亂的時刻。`window.confirm` 那條同理。
// ⇒ 📌 **前三道守門都對, 而它們各自只掃自己那一支檔** —— 換一支檔就沒有閘。
//    **本檔不是第四道閘, 是把射程放到整棵 `apps/admin` 的那一道。**
//
// ══ 🛑 它擋得住什麼、擋不住什麼(不要讀成「後台不會再印出星號」)═══════════════
//   擋得住 —— 原始碼裡**字串字面**含 `**`(單引號 / 雙引號 / 反引號都掃)。
//   **擋不住**:
//     · 執行期拼出來的(`'**' + x`)—— 字面上看不到。
//     · 從 DB / 使用者輸入帶進來的字(例如稽核的 `reason` 是員工自由文字)。
//     · `*斜體*` 單星號、`` `code` `` 反引號這些其他 Markdown 記號 —— **本閘只管 `**`**。
//   ⚠️ 而它**不判斷那個字串會不會真的被渲染** —— 一個只出現在 log 的字串也會被叫。
//     ⇒ 🔵 那是刻意的 fail-loud 方向:**寧可多叫一次, 也不要漏掉一句印在員工眼前的。**
//     ⇒ 真的有非顯示用途的字串要用 `**`, 加進下面 `EXEMPT` 並寫理由。

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** 具名豁免:非顯示用途的字串。**加一行要寫理由**,不寫理由的豁免等於把閘關掉。 */
const EXEMPT: ReadonlyArray<{ file: string; why: string }> = [
  // (目前沒有。有的話照這個形狀加。)
];

/** 掃描面 = `apps/admin` 底下版控中的 .ts / .tsx,**不含測試**(測試裡寫 `**` 是在測這件事本身)。 */
function adminSourceFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', 'apps/admin/**/*.ts', 'apps/admin/**/*.tsx'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return out.split('\n').filter((f) => f.trim() !== '' && !f.includes('.test.'));
}

/**
 * 把一行裡的**字串字面**挑出來。
 * 🔴 **註解要先剝掉,而剝法是「整行開頭」** —— 本檔第一版用 `startsWith('//')`
 *    漏掉 JSX 區塊註解的**續行**(`⚠️ … **…**`)⇒ 19 個命中裡有 5 個是註解誤報。
 *    ⇒ 這裡把 `//` `/*` `*` `{/*` 開頭的行一律跳過。
 * ⚠️ **天花板**:它不 parse TS,只認引號配對 ⇒ 跨行的樣板字串只看得到有 `**` 的那一行
 *    (而那已經足夠 —— 我們要的是「哪一行有」)。
 */
function stringLiteralsWithStars(line: string, inBlockComment = false): string[] {
  const t = line.trim();
  if (inBlockComment) return [];
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return [];
  const found: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    // 🔵 `noUncheckedIndexedAccess` 之下 `m[2]` 是 `string | undefined` ——
    //    正則保證它有第 2 組, 而**型別系統不知道** ⇒ 顯式判一次, 不用 `!`。
    const lit = m[2];
    if (lit !== undefined && lit.includes('**')) found.push(lit);
  }
  return found;
}

/**
 * 逐檔掃,**帶著「現在在不在區塊註解裡」那個狀態**。
 *
 * 🔴🔴 **本檔第一版沒有這個狀態,而它錯了【兩次】**:
 *    第一次只判 `//` ⇒ 漏掉以 `*` 開頭的續行;補了 `*` 之後**仍然**漏掉
 *    JSX 區塊註解裡**不以 `*` 開頭**的續行(例:`   JSX 文字節點裡 React **不解析…`)
 * 🔵 (這一段本來寫著那個區塊註解的起訖符號, 而**那個結束符號把這段 JSDoc 自己提早關掉了**
 *    ⇒ 整支檔 PARSE_ERROR、`vitest-ran-gate` 印「它沒有跑, 不是它沒事」。
 *    📌 **一段講「註解怎麼判」的註解, 被註解的判法弄壞 —— 所以這裡改用文字描述。**)
 *    ⇒ 4 個註解被報成違規。
 * ⇒ 📌 **「跳過註解」不是一個逐行判得出來的東西 —— 它需要狀態。** 兩次都是同一個成因。
 */
function scanFile(text: string): { line: number; literal: string }[] {
  const out: { line: number; literal: string }[] = [];
  let inBlock = false;
  text.split('\n').forEach((line, i) => {
    const opened = /\/\*/.test(line);
    const closed = /\*\//.test(line);
    const wasIn = inBlock;
    if (!inBlock && opened && !closed) inBlock = true;
    else if (inBlock && closed) inBlock = false;
    // 🔵 開頭那一行(`{/*` 那行)本身也算註解 ⇒ `wasIn || opened`。
    for (const lit of stringLiteralsWithStars(line, wasIn || opened)) {
      out.push({ line: i + 1, literal: lit });
    }
  });
  return out;
}

describe('🔴 後台可見文案不得含 Markdown `**`(JSX / confirm 都是純文字渲染)', () => {
  it('apps/admin 的字串字面裡零個 `**`', () => {
    const files = adminSourceFiles();
    // 🔴 **分母守門**:掃到 0 支檔時任何「零命中」都自動成立(今晚被這個形狀騙過三次)。
    expect(files.length, '掃到 0 支檔 ⇒ 這【不是】「沒有違規」, 是掃描面壞了').toBeGreaterThan(100);

    const exempt = new Set(EXEMPT.map((e) => e.file));
    const offenders: string[] = [];
    for (const f of files) {
      if (exempt.has(f)) continue;
      for (const hit of scanFile(readFileSync(join(ROOT, f), 'utf8'))) {
        offenders.push(`${f}:${hit.line}  ${hit.literal.slice(0, 60)}`);
      }
    }
    expect(
      offenders,
      'JSX 文字節點與 window.confirm 都是純文字 ⇒ `**粗體**` 會原樣印給員工看。' +
        '要強調用 <strong>;整段塞進一個字串的那種用「」:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  // 🔵 **尺會動的證據** —— 沒有這一格, 上面那格在「判準永遠回空陣列」時照樣綠。
  it('🔵 正對照:含 `**` 的字串一定被這條判準抓到', () => {
    expect(stringLiteralsWithStars(`const x = '請**重新整理**';`)).toHaveLength(1);
    expect(stringLiteralsWithStars('const y = `這一次**沒有送出**`;')).toHaveLength(1);
  });

  // 🔵 **負對照** —— 沒有它, 把判準改成「一律回一筆」也會綠(而上面那格會紅得莫名其妙)。
  it('🔵 負對照:沒有星號的字串、以及【註解】裡的星號, 都不算', () => {
    expect(stringLiteralsWithStars(`const x = '請重新整理';`)).toHaveLength(0);
    expect(stringLiteralsWithStars('  // 🔴 **這是註解裡的強調**, 不該被抓')).toHaveLength(0);
    expect(stringLiteralsWithStars('   *    ⚠️ **續行的註解**也不該被抓')).toHaveLength(0);
  });
});
