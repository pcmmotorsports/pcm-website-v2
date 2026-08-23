import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// storefront-tier-cookie-surface-guard.test.ts — `#215` 承接:**全樹沒有任何 production 碼碰 `pcm-tier`。**
//
// ── 🔴 為什麼這支檔存在(codex 2026-08-23 批 B must-fix 2)────────────────────────
// `#215` 刪掉了 `storefront-tier-cookie-writer-guard.test.ts`(它的退場拍板要求刪整檔)。
// 而 codex 指出:**刪掉一道守門要證明保護力有被承接,而【分母】也要一起承接。**
// ```
// 舊守門的射程 = apps/storefront/src + packages **全樹**掃 writer
// 新守門的射程 = apps/storefront/src/lib/tier.ts 的單元測試
// ⇒ 我換掉的不只是靶, 是把分母從【全樹】縮成【一支檔】
// ⇒ 「在 page.tsx 旁路 helper 直接讀 cookie」這條路, 舊守門看得到, 新守門看不到
// ```
// ⇒ 本檔把分母接回來,而**靶換成 reader 與 writer 都掃**:
//    🔴 `#215` 的結論是「**危險的一半從來不是 writer,是 reader**」⇒ 只掃 writer 是掃代理變數。
//
// ── ⚠️ 它守不到的(照實寫)────────────────────────────────────────────────────
//  · **字面掃描**:有人用變數組出 `'pcm' + '-tier'`、或改用別的 cookie 名 ⇒ 掃不到。
//    ⇒ 行為那一半是 `tier.test.ts`(偽造輸入 ⇒ general)與 backlog `#877`(真請求層)。
//  · **掃描根就是下面 `SCAN_ROOTS` 那兩個**:`apps/storefront/src` 與 `packages`,副檔名限 `.ts/.tsx`。
//    ⇒ **`apps/admin/src` 不在裡面**,repo 根的設定檔也不在。
//    📏 而那今天不可達(R3 2026-08-24 量):admin 1 支、storefront `src` 外 2 支命中 `pcm-tier`,
//    **逐行開檔全部是註解**;`middleware.ts` 不存在。⇒ 分母之外**今天沒有違規**,而那是量到的、不是推的。
//  · 註解與測試檔**刻意排除** —— 否則本檔自己與各處的歷史留痕都會誤紅。
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCAN_ROOTS = ['apps/storefront/src', 'packages'];
/**
 * 🔴 **副檔名清單逐字抄自被本檔取代的那支守門**(`storefront-tier-cookie-writer-guard.test.ts:40`,
 *    可用 `git show <刪除前的 commit>:<path>` 撈回原文)。
 * ⚠️ **codex R5 must-fix 2**:我原本只寫 `['.ts','.tsx']` ⇒ **舊守門掃得到而新守門看不見**的差集
 *    **不是空的** —— 現樹同尺已有 **1 支 `.mjs`**(正對照:`.ts/.tsx` 772 支)。
 *    ⇒ **刪掉一道守門要承接的不只是靶,連【掃描面】也要逐項對過。**
 */
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const COOKIE = 'pcm-tier';

function listFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.next' || e === '.turbo') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(listFiles(p));
    else if (EXTS.some((x) => p.endsWith(x)) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * 剝掉註解 —— **而它認得字串字面**。
 *
 * 🔴🔴 **codex R5 must-fix 3(而這是今晚第二個同族實例)**:
 *    我原本用兩發 regex 剝註解。餵它 `const url = '/x//y'; jar.set('pcm-tier','store');`
 *    ⇒ 字串裡的 `//` 被當成註解 ⇒ **後面那段真程式被一起刪掉** ⇒ 守門回報**零命中**。
 *    📏 codex 用一發 `node -e` 讓兩個版本表演:`oldHit: true, newHit: false`。
 *
 * 📌 **母題(同夜另一個窗在 SQL 剝殼上踩到同一個)**:
 *    **一個「把註解拿掉」的函式,如果不認得字串,它會拿掉不是註解的東西。**
 *    而它的失敗方式**永遠是安靜的零命中,不是報錯** ⇒ 沒有人會發現。
 *
 * ⚠️ **本函式仍不是完整的 JS 詞法分析器**:它認得 `'` `"` `` ` `` 與反斜線跳脫,
 *    **不認得**正規表示式字面(`/ab\/c/` 裡的 `//` 會被誤讀)。
 *    ⇒ 那個方向是**誤紅**(多留下東西),不是漏放 —— 對本守門是安全的那一邊。
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i] as string;
    if (quote) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => listFiles(join(REPO_ROOT, r)));
const hits = files.filter((f) => stripComments(readFileSync(f, 'utf8')).includes(COOKIE));

describe(`production 原始碼不得碰 \`${COOKIE}\` cookie(reader 與 writer 都算)`, () => {
  it('🔴 前提:掃描分母不是空的(空 = 本守門瞎了,不是通過)', () => {
    // 舊守門的檔頭寫過同一件事;分母塌掉時每一格都會因為「沒東西可掃」而恆真。
    expect(files.length, '掃不到任何 .ts/.tsx ⇒ 路徑或忽略規則壞了').toBeGreaterThan(350);
  });

  it(`全樹零命中 —— 含「旁路 helper 直接讀 cookie」那條路`, () => {
    expect(
      hits.map((f) => f.replace(`${REPO_ROOT}/`, '')),
      `🔴 有 production 碼碰了 \`${COOKIE}\`。\n` +
        '   `#215` 已經把它從身分來源移除(它是 client 可偽造的、而且全樹零 writer)。\n' +
        '   ⇒ 要重新使用它,先回答「它憑什麼可信」,並更新 `apps/storefront/src/lib/tier.ts` 檔頭那段。',
    ).toEqual([]);
  });

  it('🔴 正對照:掃描器真的找得到東西(否則上一格是恆綠的)', () => {
    // 拿一個一定存在的字面去掃同一批檔 —— 找不到就代表 stripComments 或讀檔壞了。
    const probe = files.filter((f) => stripComments(readFileSync(f, 'utf8')).includes('export'));
    expect(probe.length, '連 `export` 都掃不到 ⇒ 掃描器本身壞了').toBeGreaterThan(100);
  });

  it('🔴 負對照:註解裡的字面【不算】(否則歷史留痕會讓本檔恆紅)', () => {
    expect(stripComments(`// ${COOKIE}\nconst a = 1;`).includes(COOKIE)).toBe(false);
    expect(stripComments(`const a = '${COOKIE}';`).includes(COOKIE)).toBe(true);
  });

  // 🔴 codex R5 must-fix 3 的原發:字串裡的 `//` 曾經讓剝殼吃掉後面的真程式。
  it('🔴 剝殼認得字串:字串裡的 `//` 不得吃掉後面的程式', () => {
    const src = `const url = '/x//y'; jar.set('${COOKIE}','store');`;
    expect(stripComments(src).includes(COOKIE), '字串內的 // 把後面那段真程式吃掉了').toBe(true);
    // ✅ 正對照:真的行註解還是要被剝掉,否則上面那格用「什麼都不剝」也會過
    expect(stripComments(`const a = 1; // ${COOKIE}`).includes(COOKIE)).toBe(false);
    // 反引號與跳脫也要認得
    expect(stripComments('const a = `//x`; const b = 2;').includes('//x')).toBe(true);
    expect(stripComments("const a = '\\'//'; const b = 2;").includes('//')).toBe(true);
  });

  // 🔴 codex R5 must-fix 2:掃描面要與被取代的那支守門逐項對過,不能只掃 .ts/.tsx。
  it('🔴 掃描面涵蓋舊守門的八種副檔名,而差集不是空的(現樹確實有 .mjs)', () => {
    for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']) {
      expect(EXTS, `舊守門掃 ${e} 而本檔沒有 ⇒ 掃描面縮水`).toContain(e);
    }
    // ✅ 而它不是理論上的空集合:同一組掃描根底下真的有非 .ts/.tsx 的檔
    const nonTs = files.filter((f) => !/\.tsx?$/.test(f));
    expect(nonTs.length, '一支非 .ts/.tsx 都掃不到 ⇒ 上面那圈斷言沒有判別力').toBeGreaterThan(0);
  });
});
