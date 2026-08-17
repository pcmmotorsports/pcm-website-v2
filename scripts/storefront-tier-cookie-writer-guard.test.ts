import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * pcm-tier cookie 零 writer 守門(#215 測試錨點第一格;規格=V 窗 v3、codex FAIL 9 must-fix 全折版)。
 *
 * 【不變量】掃描根內的非測試原始碼,不得出現任何寫入/刪除 `pcm-tier` cookie 的語句 ——
 * server 或 client 皆然。tier.ts 的 JSDoc(:32 一帶)明載這顆 cookie client 可偽造、
 * 僅為顯示 hint;在 #215 修法落地前,「零 writer」是它唯一站得住的安全姿勢:
 * 有 reader 無 writer ⇒ 這顆 cookie 只能由訪客自己造,而造了最多看到 dummy 0 破圖。
 *
 * 🔴 「零 writer」在本檔上線前【沒有被證明過】:先前 grep 只做過同行共現(證不了跨行與
 * 物件形)。本檔第一次全綠 = 那個事實的第一個證據;第一次就紅 = 本來就有 writer,
 * 不是本檔寫壞 —— 逐條 檔案:行號 帶去人裁。
 *
 * 【剝註解是必要的,不是潔癖】tier.ts 的 JSDoc 警告範例逐字含
 * `document.cookie='pcm-tier=store'` —— 不剝 JSDoc,本守門上線第一天就誤紅在它要
 * 保護的那支檔上,然後被關掉,然後永遠是關的。剝法刻意【不共用】
 * storefront-projection-leak-guard.test.ts 的逐行跳過法:本檔對整檔剝 `//` 行尾與
 * `/* … *​/` 塊(含 JSDoc)、以等量換行保行號,再對剝完的整檔跨行匹配。
 *
 * 【盲面明寫】
 * - 字串拼接/跳脫序列混淆(既有裁定不追,同 projection-guard)。
 * - storefront 今日無 middleware/proxy 檔(實作日 `ls` 三處查無);日後出現自動入根
 *   (walk 掃整棵 apps/storefront/src,不點名檔案)。
 * - 行內註解裡的 writer 若 `//` 前不是空白(如貼在分號後)不會被剝 ⇒ 誤紅方向,寧可誤紅不漏放。
 * - 字串字面裡含 `/*` 的極端寫法會讓塊剝除吃掉後續程式碼 ⇒ 漏放方向;掃描根內以
 *   ts/tsx 為主、此形狀今日未見,列為已知窄處。
 *
 * 【退場拍板】cookie 路徑整個移除之日 ⇒ 格1 紅=本檔大聲退場,該片刪整檔並在
 * commit body 引 #215;#215 修法若保留 cookie 為純顯示 hint(有 reader 無 writer)
 * ⇒ 三格自然續綠。
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** packages/ 一樣是破口:storefront import 的 adapter/ui 寫 cookie 等同 storefront 寫。 */
const SCAN_ROOTS = ['apps/storefront/src', 'packages'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo']);
/** 測試排除三條全列(規格逐項寫死):*.test.*、*.spec.*、__tests__/。 */
const TEST_FILE_RE = /\.test\.|\.spec\./;

/** 剝註解、保行號:塊註解(含 JSDoc)以等量換行取代;`//` 需在行首或前有空白(保 `https://`)。 */
export function stripComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  out = out.replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
  return out;
}

interface WriterHit {
  readonly line: number;
  readonly anchor: string;
}

/**
 * 錨點族(命中後看「錨點起 200 字元」視窗內有無 pcm-tier;寧可誤紅不漏放):
 * - .set( / .delete( / .clear( —— 蓋字串形與物件形 {name:'pcm-tier'}、單雙反引號;
 *   clear 納入=會刪這顆,命中由人裁。
 * - set-cookie(大小寫不敏感)—— 逗號形與物件字面皆蓋。
 * - document.cookie 賦值。
 * - serialize( —— 今日零依賴,防日後。
 */
const ANCHORS: ReadonlyArray<{ readonly name: string; readonly re: RegExp }> = [
  { name: 'set/delete/clear', re: /\.(?:set|delete|clear)\s*\(/g },
  { name: 'set-cookie', re: /set-cookie/gi },
  { name: 'document.cookie=', re: /document\.cookie\s*=/g },
  { name: 'serialize(', re: /serialize\s*\(/g },
];
const WINDOW_CHARS = 200;

/**
 * 格2/格3 共用的單一函式:剝註解 → 整檔跨行匹配 → 命中換算回行號。
 * 兩層:①錨點起 200 字元視窗(行號精準)②視窗零命中但整檔【程式碼】同時含錨點與
 * pcm-tier ⇒ 檔級命中(reviewer 實測抓到的漏放形狀:`const opts={name:'pcm-tier',…};
 * res.cookies.set(opts);` —— 宣告在錨點【前面】,前向視窗看不到)。
 * 檔級命中行號=pcm-tier 首次出現處,粗於視窗層,由人開檔裁——寧可誤紅不漏放。
 */
export function findWriters(source: string): WriterHit[] {
  const stripped = stripComments(source);
  const hits: WriterHit[] = [];
  let anchorSeen = false;
  for (const { name, re } of ANCHORS) {
    re.lastIndex = 0;
    for (let m = re.exec(stripped); m !== null; m = re.exec(stripped)) {
      anchorSeen = true;
      if (stripped.slice(m.index, m.index + WINDOW_CHARS).includes('pcm-tier')) {
        hits.push({ line: stripped.slice(0, m.index).split('\n').length, anchor: name });
      }
    }
  }
  if (hits.length === 0 && anchorSeen && stripped.includes('pcm-tier')) {
    hits.push({
      line: stripped.slice(0, stripped.indexOf('pcm-tier')).split('\n').length,
      anchor: 'file-level(錨點與 pcm-tier 同檔共現、視窗外)',
    });
  }
  return hits.sort((a, b) => a.line - b.line);
}

function walk(dir: string, acc: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.has(name) || name === '__tests__') continue;
      walk(p, acc);
    } else if (EXTENSIONS.some((e) => name.endsWith(e)) && !TEST_FILE_RE.test(name)) {
      acc.push(p);
    }
  }
}

function scanFiles(): string[] {
  const acc: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), acc);
  return acc.sort();
}

describe('pcm-tier cookie 零 writer 守門(#215 錨點格)', () => {
  const files = scanFiles();

  it('格1 前提格:分母 ≥ 350 且 tier.ts 的 get(pcm-tier) 讀點還在(讀點消失=退場訊號,見檔頭退場拍板)', () => {
    // 350=實作日(2026-08-17)量得 399 檔(數法=本 walk 的 files.length;失敗訊息會印當下值)
    // 再留約一成收縮裕度;分母大幅縮水表示 walk 壞了或掃描根被搬走,
    // 「0 命中/0 檔」不得讀成通過。
    expect(files.length, `分母=${files.length}`).toBeGreaterThanOrEqual(350);
    const tierSource = readFileSync(join(REPO_ROOT, 'apps/storefront/src/lib/tier.ts'), 'utf8');
    expect(tierSource).toContain("get('pcm-tier')");
  });

  it('格2 判別力格:findWriters 本尊吃正向 6 發必全中、負向 3 發必全不中', () => {
    const positives: ReadonlyArray<readonly [string, string]> = [
      ['單行 set', `cookieStore.set('pcm-tier', 'store');`],
      ['跨行 set', `res.cookies.set(\n  'pcm-tier',\n  value,\n  { httpOnly: false },\n);`],
      ['物件形 set', `res.cookies.set({ name: 'pcm-tier', value: tier });`],
      ['delete 物件形', `cookieStore.delete({ name: 'pcm-tier' });`],
      ['set-cookie 小寫物件字面', 'const h = { "set-cookie": `pcm-tier=${tier}; Path=/` };'],
      ['反引號名', 'jar.set(`pcm-tier`, next);'],
      // reviewer(sonnet)實測抓到的漏放形狀:宣告在錨點前、前向視窗看不到 ⇒ 檔級層接住。
      ['變數傳遞形(宣告在錨點前)', `const cookieOpts = { name: 'pcm-tier', value: v };\nres.cookies.set(cookieOpts);`],
    ];
    for (const [label, src] of positives) {
      expect(findWriters(src).length, `正向必中:${label}`).toBeGreaterThan(0);
    }
    const negatives: ReadonlyArray<readonly [string, string]> = [
      ['// 註解內 writer', `// res.cookies.set('pcm-tier', 'store');`],
      ['JSDoc 行內 writer(tier.ts:32 原形)', `/**\n * document.cookie='pcm-tier=store' 即被當經銷會員\n */`],
      ['純 get', `const raw = cookieStore.get('pcm-tier')?.value;`],
    ];
    for (const [label, src] of negatives) {
      expect(findWriters(src), `負向必不中:${label}`).toEqual([]);
    }
  });

  it('格3 本體格:全根零 writer(命中即逐條列 檔案:行號 [錨點],帶去人裁,不是自動放行)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const h of findWriters(readFileSync(f, 'utf8'))) {
        offenders.push(`${relative(REPO_ROOT, f)}:${h.line} [${h.anchor}]`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
