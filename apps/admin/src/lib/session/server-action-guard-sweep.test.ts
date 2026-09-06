import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 🔴 **`strip-comments` 這個名字在 repo 裡有三支同名檔**(`git ls-files | grep strip-comments` ⇒ 3):
//    `apps/admin/src/lib/test-support/strip-comments.ts`(**本檔用的就是這一支**)·
//    同目錄的 `.test.ts` · 以及 `apps/storefront/src/lib/test-support/strip-comments.ts`。
//    ⇒ 📌 引用它的行為時要寫**全路徑**, 否則下一個人會去讀錯的那一支。
import { stripComments } from '../test-support/strip-comments';

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
// 🛑 **這把尺的射程(= 什麼算「有守門」)**
//    ⛔ ~~【只認字面】:檔案內出現 `authorizeAdminMutation` 或 `authorizeManagerMutation` 就算過。~~
//    🔴🔴 **2026-09-06 收緊(體檢 F1;`-auth`)—— 舊字面留刪除線, 因為它記著這道守門【曾經有多寬】。**
//      那一版問的是「**這支檔裡有沒有那個字**」, 而**那個字可以出現在四個不算守門的地方**:
//        ① 註解裡(包括「TODO: 之後要加 authorizeAdminMutation」這種**反向**的句子)
//        ② `import { authorizeAdminMutation }` 而**從來沒有呼叫**
//        ③ 字串字面(錯誤訊息、log、白名單常數)
//        ④ 型別位置(`typeof authorizeAdminMutation`)
//      ⇒ 📌 **一支「我知道要授權但還沒做」的檔, 在舊尺底下是綠的** —— 而那正是它要抓的那種人。
//    ✅ **現在問的是「有沒有【呼叫】它」**:剝掉註解(TS parser, 見 `strip-comments.ts`)之後,
//      要有 `authorize(Admin|Manager)Mutation` **後面接左括號**的形狀。
//    🔬 **而收緊【今天不改變任何一支的判定】**(當場量, 2026-09-06):
//      `'use server'` 檔 **28** 支 · 舊尺算過 **27** · 剝註解後 **27** · 要求呼叫形狀後 **27**
//      ⇒ 🛑 **三把尺一致 ⇒ 光看它還是綠的, 證不了它變強了**
//      ⇒ ✅ **所以下面配了一組合成證人**(`hasMutationGuard` 直接餵字串), 那才是這次的守門。
//    ⇒ 它**仍然證不到**:那個呼叫在不在**每一條**匯出路徑上、有沒有被 early-return 繞過、參數對不對。
//      **它答的是「這支檔有沒有【真的叫】授權」, 不答「授權對不對」。**
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

/**
 * 🔴 **「這支檔有沒有【呼叫】授權」—— 抽成具名函式是為了讓證人餵得進合成字串。**
 *   ⛔ ~~原本是 inline 的 `/authorize(Admin|Manager)Mutation/.test(src)`~~
 *   ⇒ 📌 inline 的話, 這道判斷【只跑得到 repo 現況那 28 支檔】, 而它們今天全部都過
 *     ⇒ 🛑 **沒有任何一格在問「它擋不擋得住假的」。**
 *
 * 🔵 剝註解走 `stripComments`(TS parser)—— **不自己寫 regex**:
 *   那支檔自己記著 regex 版曾經「安靜地吃掉 206 行真程式碼 / 27 支檔而 guard 照樣全綠」。
 * ⚠️ **殘留盲區(寫出來, 不假裝覆蓋)**:字串字面裡若剛好寫著 `authorizeAdminMutation(`
 *   仍會被算成呼叫 —— 那要 parser 級的判斷。**方向是【多算 = 放行】** ⇒ 這一格待補。
 */
function hasMutationGuard(src: string, fileName?: string): boolean {
  // ⚠️ **`replace(/^\ufeff/, '')` 對【本函式】無判別力** —— 它是照 `:127` 那個呼叫端抄來的形狀。
  //    那裡要 `.trim()` 之後比對開頭, BOM 會擋路;而這裡只做「整份文字裡有沒有那個呼叫」,
  //    BOM 在不在都不影響結果。⇒ 📌 留著是為了兩處形狀一致, **而它不是一道檢查**。
  return /authorize(Admin|Manager)Mutation\s*\(/.test(
    stripComments(src.replace(/^\ufeff/, ''), fileName),
  );
}

/** 🔴 `'use server'` 的偵測 —— **這是這支尺的【分母】那一半,而它比分子更容易靜默變窄。**
 *
 * 🛑 **它只認【檔頭】那一種 —— 函式層的 inline directive 不進分母**(2026-09-06 補寫):
 *    Next.js 允許 `'use server'` 寫在**函式體裡面**(那一支函式自己變成 server action)。
 *    本偵測跳過 BOM / 空白 / 註解之後就要求 directive ⇒ **寫在函式裡的那種, 這支尺看不到。**
 *    🔬 **今天 0 支**(當場量:`apps/admin/src` 的 `.ts`/`.tsx`,
 *       找【有縮排的獨立一行 `'use server';`】⇒ **0**;🔴 負對照 現造 `'use zzqserver0906'` ⇒ **0**)
 *    ⇒ 📌 **所以今天不是洞, 而它是【現況】不是【保證】** —— 哪天有人這樣寫,
 *      那一支 server action **一出生就不在這道守門的射程裡, 而不會有任何東西紅。**
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
function hasDirectiveByStripping(src: string, fileName: string): boolean {
  // 🔴 **2026-08-31:剝註解從 regex 換成 parser**(`scripts/strip-comments.ts`)。
  //    ⛔ ~~`.replace(/\/\*[\s\S]*?\*\//g, '')`~~ —— 它的供給源是「`*/` 這兩個字元」
  //    而不是「註解」⇒ 一個 `// dev-preview/*` 的**行註解**就能開一個假區塊,
  //    直到下一個 `*/` 才收尾 ⇒ 中間的真程式碼**安靜地從掃描裡消失**,而 guard 照樣全綠。
  //    (`-08` 2026-08-30 在 storefront 那支 guard 上 live 量到:206 行 / 27 支檔。)
  // ⚠️ **這裡【只換剝法,沒有換它在找什麼】** —— 仍然是「剝完之後開頭是不是 'use server'」。
  const stripped = stripComments(src.replace(/^\ufeff/, ''), fileName).trim();
  return /^['"]use server['"]/.test(stripped);
}

function byStripping(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) byStripping(full, acc);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
      if (hasDirectiveByStripping(readFileSync(full, 'utf8'), full)) acc.push(full);
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
      if (!hasMutationGuard(readFileSync(full, 'utf8'), full)) missing.push(rel);
    }
    expect(
      missing,
      `這幾支 server action 沒有 authorize*Mutation:\n  ${missing.join('\n  ')}\n` +
        '⇒ 要嘛補上守門,要嘛加進 ALLOWED_WITHOUT_GUARD 並【寫清楚為什麼它不需要】。',
    ).toEqual([]);
  });

  /**
   * ══ 🔴🔴 這一組才是 2026-09-06 那次收緊【真正的守門】═════════════════════════
   * 🛑 **為什麼非要合成字串**:收緊之後 repo 現況 28 支檔的判定**一支都沒變**(當場量:27/27/27)
   *   ⇒ 📌 **上面那三格照樣全綠, 而它們對「尺有沒有變強」零判別力。**
   *   ⇒ 這一組直接餵 `hasMutationGuard` 四種【不算守門】與三種【算守門】的原始碼,
   *     **兩個方向都釘** —— 只釘一邊的話, 把函式改成 `() => false` 或 `() => true` 各有一半是綠的。
   */
  describe('hasMutationGuard —— 那個字出現在【不是呼叫】的地方時, 不得算過', () => {
    const CASES_NOT_GUARDED: ReadonlyArray<readonly [string, string]> = [
      ['行註解裡', `'use server';\n// TODO: 之後要加 authorizeAdminMutation(actor)\nexport async function a() {}`],
      ['區塊註解裡', `'use server';\n/* 這裡本來要 authorizeAdminMutation( 而還沒寫 */\nexport async function a() {}`],
      ['只 import 沒呼叫', `'use server';\nimport { authorizeAdminMutation } from './x';\nexport async function a() {}`],
      // 🔴 標籤要說清楚是【不含括號】的那一種 —— 含括號的那種本尺【擋不住】, 見下方 it.todo
      ['字串字面(不含括號)', `'use server';\nconst MSG = 'authorizeAdminMutation';\nexport async function a() { throw new Error(MSG); }`],
      ['型別位置', `'use server';\nimport type { authorizeManagerMutation } from './x';\ntype T = typeof authorizeManagerMutation;\nexport async function a() {}`],
    ];
    it.each(CASES_NOT_GUARDED)('🔴 %s ⇒ 不算有守門', (_label, src) => {
      expect(
        hasMutationGuard(src),
        '這種寫法被算成「有守門」⇒ 一支【知道要授權而還沒做】的檔會靜靜地過',
      ).toBe(false);
    });

    // 🟢 正對照:少了這一組, 把函式改成 `() => false` 上面五格全綠而它什麼都不放行
    const CASES_GUARDED: ReadonlyArray<readonly [string, string]> = [
      ['直接呼叫', `'use server';\nexport async function a() { await authorizeAdminMutation(); }`],
      ['換行後才接括號', `'use server';\nexport async function a() { await authorizeManagerMutation\n  (); }`],
      ['前面有註解干擾', `'use server';\n// authorizeAdminMutation 這個字也出現在註解\nexport async function a() { await authorizeAdminMutation(x); }`],
    ];
    it.each(CASES_GUARDED)('🟢 正對照:%s ⇒ 算有守門', (_label, src) => {
      expect(hasMutationGuard(src), '真的呼叫了卻被算成沒守門 ⇒ 這道閘會誤紅').toBe(true);
    });

  /**
   * 🔴 **已知缺口, 寫成 `it.todo` 讓它【有形狀】而不是只躺在註解裡**:
   *   字串字面裡若**連括號一起**寫著 `authorizeAdminMutation()`(例如錯誤訊息、文件字串、
   *   或一支列出「該呼叫哪些守門」的常數表), 本尺會把它算成呼叫 ⇒ **方向是多算 = 放行**。
   *   要根治得問 parser「這個識別字是不是在 CallExpression 的位置上」, 而那是另一片。
   *   ⚠️ **今天 repo 裡零命中** —— 而那是【現況】不是【保證】。
   */
  it.todo("🔴 缺口:字串字面含括號 `'call authorizeAdminMutation()'` 仍被算成呼叫(方向=放行)");

    it('🔴 舊尺與新尺【對同一份輸入給不同答案】—— 證明這次收緊不是換個寫法', () => {
      const fake = `'use server';\n// TODO: authorizeAdminMutation\nexport async function a() {}`;
      // 舊尺(逐字, 2026-09-06 之前那一版):只問「有沒有那個字」
      expect(/authorize(Admin|Manager)Mutation/.test(fake), '前提:舊尺對這份輸入是【過】').toBe(true);
      expect(hasMutationGuard(fake), '新尺必須說【不過】—— 兩尺同答案 ⇒ 這次收緊是空的').toBe(false);
    });
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
