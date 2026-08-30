import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// server-action-guard-sweep.test.ts —— 掃描式守門:**新增一支沒有守門的 server action 時,這裡要紅。**
//
// 🔴 為什麼是掃描而不是逐支功能測試(本片存在的理由):
//    功能測試只覆蓋【已經想到的那幾支】。而這一族的風險是**下一支** ——
//    有人新增第 26 個 `'use server'` 檔而忘了 `authorize*Mutation`,
//    **既有的每一支測試都照樣綠**,因為它們沒有一支的分母包含那個新檔。
//    ⇒ 這一支的分母是【目錄】,不是【清單】⇒ 新檔一出生就在射程裡。
//
// 🔵 形狀抄自報價單 repo 的 `tests/node/pricing-rollback-claims.test.mts:35`:
//      assert.ok(found.length >= 9, `只掃到 ${found.length} 支 route: …`)
//    —— **它先證明自己的尺撈得到東西,再去斷言。**
//    2026-08-30 `-15` 在回核那個 repo 時撿到,原封搬過來(見下方 LOWER_BOUND 那一段)。
//
// 🛑 **這把尺的射程(= 什麼算「有守門」)——【只認字面】**:
//    檔案內出現 `authorizeAdminMutation` 或 `authorizeManagerMutation` 就算過。
//    ⇒ 它**證不到**:那個呼叫在不在**每一條**匯出路徑上、有沒有被 early-return 繞過、
//      參數對不對。**它只答「這支檔有沒有想到要授權」,不答「授權對不對」。**
//    ⇒ 📌 **會綠而仍然有洞是可能的;而【完全沒想到】這一種,它抓得到。**
const ADMIN_SRC = path.resolve(__dirname, '../..');

/** 🔴 白名單:每一條【各自附理由】。不准出現「暫時」—— 一條沒有理由的白名單,
 *  下一個人不敢刪也不知道能不能刪 ⇒ 它會永久留下。 */
const ALLOWED_WITHOUT_GUARD: Record<string, string> = {
  'lib/session/actor-actions.ts':
    '它【就是】選身分那一步本身,跑在身分成立【之前】—— 拿授權去守它會變成雞生蛋。' +
    '該檔自己逐字寫著「使用者自行選擇 / 非授權邊界(見 session/actor.ts);真實身分驗證接上後退場」。' +
    '⇒ 退場條件:真實身分閘全面接上、這支 action 退場時,這一條白名單要跟著刪。',
};

/** 🔴 下界怎麼來的:2026-08-30 當場數 `'use server'` 檔 = 25 支。
 *  取 20 是留給【正常刪檔】的餘裕,而不是留給「尺壞掉」的餘裕 ——
 *  真的掉到 20 以下,要先問「是刪了 5 支,還是我的尺不再撈得到它們」。 */
const LOWER_BOUND = 20;

/** 🔴 `'use server'` 的偵測 —— **這是這支尺的【分母】那一半,而它比分子更容易靜默變窄。**
 *
 * code-reviewer 2026-08-30 實測:原本的 `startsWith("'use server'")` 對 7 種**合法**寫法
 * **只抓到 2 種** —— 雙引號 `"use server"` / BOM / 前置註解 / 前置空行 / `.tsx` **全部漏掉**。
 * ⇒ 而漏掉的那些**不會紅,它們根本不進分母** ⇒ **正是這支檔存在要防的那件事,發生在它自己身上。**
 * ⚠️ 而 repo **沒有 prettier、eslint 也沒有 quotes 規則**(reviewer 查過)
 *   ⇒ 沒有任何東西會把 `"use server"` 正規化掉 ⇒ **那條路是活的,不是假想。**
 */
function hasUseServerDirective(src: string): boolean {
  let i = 0;
  if (src.charCodeAt(0) === 0xfeff) i = 1; // BOM
  // 跳過開頭的空白與註解(`'use server'` 之前只准有這兩種東西)
  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i += 1;
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      if (nl === -1) return false;
      i = nl + 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i);
      if (end === -1) return false;
      i = end + 2;
    } else break;
  }
  return /^['"]use server['"]/.test(src.slice(i));
}

function serverActionFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      serverActionFiles(full, acc);
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
      if (hasUseServerDirective(readFileSync(full, 'utf8'))) acc.push(full);
    }
  }
  return acc;
}

/** 🔴 **第二把尺 —— 【獨立實作】的同一個判斷,用來抓「第一把尺自己有 bug」。**
 *
 * ⚠️ **它不是「更寬的尺」** —— 第一版我寫成「檔案裡有沒有出現 use server 這幾個字」,
 *    而那一發當場撈回 **12 支誤報**,其中兩支的內容是註解裡的
 *    `// 可單測、無 'use server' / next 依賴` —— 📌 **一支宣告自己【沒有】那個 directive 的檔,
 *    被一把 grep 字面的尺算成【有】。**(與本 repo「訃聞裡也含那個字面」是同一個病。)
 *
 * ⇒ 改成:**先把註解整片拿掉**,再看第一個 token 是不是那個 directive。
 *   實作方式與 `hasUseServerDirective()` 不同(它是逐字元跳過,這支是先剝再比)
 *   ⇒ **兩支同時錯成一樣的機率,比兩支都對的機率低。**
 */
function hasDirectiveByStripping(src: string): boolean {
  const stripped = src
    .replace(/^\ufeff/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .trim();
  return /^['"]use server['"]/.test(stripped);
}

function byStripping(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) byStripping(full, acc);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
      if (hasDirectiveByStripping(readFileSync(full, 'utf8'))) acc.push(full);
    }
  }
  return acc;
}

describe('server action 守門掃描', () => {
  const files = serverActionFiles(ADMIN_SRC);

  it('🔵 掃描本身要有作用(先證明尺撈得到東西,再去斷言)', () => {
    expect(
      files.length,
      `只掃到 ${files.length} 支 'use server' 檔(下界 ${LOWER_BOUND})——` +
        '要嘛真的刪了很多支,要嘛這把尺不再撈得到它們。先確認是哪一種,不要直接調低下界。',
    ).toBeGreaterThanOrEqual(LOWER_BOUND);
  });

  it('🔴🔴 兩把尺要對得上 —— 這一格抓的是【尺自己變窄】,而 LOWER_BOUND 抓不到那個', () => {
    // LOWER_BOUND 只在「檔數掉下來」時紅;而本檔真正的威脅是【多一支而尺看不見它】——
    // 那時 files.length 完全不動。⇒ 用一支【獨立實作】的偵測來對,雙向都要對得上。
    const other = new Set(byStripping(ADMIN_SRC));
    const mine = new Set(files);
    const rel = (f: string) => path.relative(ADMIN_SRC, f).split(path.sep).join('/');
    const onlyOther = [...other].filter((f) => !mine.has(f)).map(rel);
    const onlyMine = [...mine].filter((f) => !other.has(f)).map(rel);
    expect(
      { 只有第二把尺看到: onlyOther, 只有第一把尺看到: onlyMine },
      '兩支【獨立實作】的偵測對不上 ⇒ 其中一支有 bug。\n' +
        '⇒ 先確認哪一支對,再改 —— 不要為了讓這格變綠而把兩支改成一樣的寫法(那會讓這道交叉失效)。',
    ).toEqual({ 只有第二把尺看到: [], 只有第一把尺看到: [] });
  });

  it('🔴 每一支 server action 都要有 authorize*Mutation,除非白名單裡有它(且附了理由)', () => {
    const missing: string[] = [];
    for (const full of files) {
      const rel = path.relative(ADMIN_SRC, full).split(path.sep).join('/');
      if (rel in ALLOWED_WITHOUT_GUARD) continue;
      if (!/authorize(Admin|Manager)Mutation/.test(readFileSync(full, 'utf8'))) missing.push(rel);
    }
    expect(
      missing,
      `這幾支 server action 沒有 authorize*Mutation:\n  ${missing.join('\n  ')}\n` +
        '⇒ 要嘛補上守門,要嘛加進 ALLOWED_WITHOUT_GUARD 並【寫清楚為什麼它不需要】。',
    ).toEqual([]);
  });

  it('🔴 白名單裡的每一條都要真的存在(不然它會靜靜地放行一個不存在的檔名)', () => {
    const rels = new Set(
      files.map((f) => path.relative(ADMIN_SRC, f).split(path.sep).join('/')),
    );
    const stale = Object.keys(ALLOWED_WITHOUT_GUARD).filter((k) => !rels.has(k));
    expect(
      stale,
      `白名單有這幾條指不到任何檔:${stale.join('、')} —— 檔改名或刪掉了,這一條要跟著清。`,
    ).toEqual([]);
  });
});
