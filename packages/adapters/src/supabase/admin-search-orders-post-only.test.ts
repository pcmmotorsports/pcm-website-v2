import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

// admin-search-orders-post-only.test.ts — #347-2a 的 **N8 機制化守門**(主視窗指定:
// 「POST-only 做成 source-scan 守門,不是註解」)。
//
// ── 要守的不變量 ────────────────────────────────────────────────────────────
// `admin_search_orders` 的搜尋詞是 PII(客人姓名 / 電話 / 地址)。#347-1 選擇走 RPC 的
// **主要理由**就是「搜尋詞一個字都不進 URL」(migration `:50-74`)。
// supabase-js 的 `.rpc()` 預設是 POST + JSON body ⇒ 照常用就是對的;
// 但它**也吃** `{ get: true }` 與 `{ head: true }` —— 那兩個走 postgrest-js 的**同一個分支**
// (`PostgrestClient.ts:413-422`:`method = head ? 'HEAD' : 'GET'`,接著把每個引數
//  `url.searchParams.append` 進網址)⇒ 搜尋詞會落進 access log / CDN log / 瀏覽器歷史 / Referer。
//
// 🔴 **這條守門擋得住什麼、擋不住什麼(不讓名字大於實力)**:
//   擋得住 —— **無意的回歸**:複製貼上、為了快取或好 debug 順手加 `{ get: true }`、
//   在別的檔再接一支、手搓 URL 打這支 RPC。
//   擋不住 —— **刻意規避**:字串拼接函式名、computed property、把呼叫搬進本檔沒掃的 package
//   (`apps/api`、`packages/schemas`、`packages/ui` 等不在下面六根裡)。
//   ⇒ 真正保證 POST 的是 postgrest-js 的預設分支;本檔釘的是「**沒有人把那個預設改掉**」。
//
// ⚠️ 措辭一律寫「六個掃描根之內」而不是「全樹」—— 掃描面就是六根,寫「全樹」是宣稱大於事實。

/** repo 根(本檔位於 `packages/adapters/src/supabase/` ⇒ 上跳四層)。 */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const ADAPTERS_SRC = path.join(REPO_ROOT, 'packages', 'adapters', 'src');
/**
 * 應用層可能出現這些字面的**六個**面(與 `nine-code-rpc-retired.test.ts` 同一組,理由相同)。
 * 🔴 「理由相同」包含**它的前提斷言**:見下方第一個 describe —— 我第一版只抄了根清單、
 *    沒抄那半,等於留了「刪一根 ⇒ 那格恆綠」的洞(code-reviewer 抓到)。
 */
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'apps', 'admin', 'src'),
  ADAPTERS_SRC,
  path.join(REPO_ROOT, 'apps', 'storefront', 'src'),
  path.join(REPO_ROOT, 'packages', 'use-cases', 'src'),
  path.join(REPO_ROOT, 'packages', 'ports', 'src'),
  path.join(REPO_ROOT, 'packages', 'domain', 'src'),
];

const RPC_NAME = 'admin_search_orders';

/**
 * 豁免:只有本檔(斷言字面本身就是那個 RPC 名與那些危險 option 名)。
 *
 * 🔴 **刻意不用「排除所有 `*.test.*`」** —— 那樣的話,把呼叫寫進一支取名 `foo.test.ts` 的檔、
 * 再從 production 檔 import,整個就消失在掃描外(`nine-code-rpc-retired.test.ts` 的既有結論)。
 */
const EXEMPT = new Set([__filename]);

/**
 * 只剝**整行** `//` 註解與 doc-comment 續行(行首 `*` 且後接空白或 `/`)。
 *
 * 🔴 **這一半是正確性前提、不是排版**:`SupabaseOrderAdapter.ts` 有**四處** URL 組裝字面
 * (`:140` `:142` `:555` `:590`)**全在註解裡**(量 URL 長度的說明 + postgrest-js 行為的引用);
 * 不剝的話下面「不得手搓 URL」那格會對**正確的實作**假紅。
 * ⚠️ 這幾個號碼是**本片全部編輯定案後**量的(`grep -n`);第一版寫的 `:101/:103/:419` 是
 * 改動**前**的號、而且漏了第四處 —— memory `feedback_line-numbers-go-stale-from-your-own-later-edits`。
 * 刻意不剝整個 `/* … *\/` 區塊:字串裡合法出現的 `"/*"` 會讓那種 regex 把中間的真程式碼一起吃掉。
 * `*` 後必須接空白或 `/`,否則 generator 方法 `*items() {}` 這種**真程式碼**會被誤剝(= 假綠)。
 */
function stripLineComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*[\s/].*$/gm, '');
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(m|c)?[jt]sx?$/.test(rel))
    .map((rel) => path.join(root, rel))
    .filter((abs) => !EXEMPT.has(abs));
}

/** 六根之內每個原始檔的「剝掉註解後」內容。 */
const SOURCES: { file: string; code: string }[] = SCAN_ROOTS.flatMap(sourceFiles).map((file) => ({
  file: path.relative(REPO_ROOT, file),
  code: stripLineComments(readFileSync(file, 'utf8')),
}));

/**
 * 呼叫端可能長成的**三種**樣子。組字串而不是寫死字面,避免本檔自我命中。
 *
 * 🔴 **必須同時認單引號與雙引號**(關卡2 R1 抓到):第一版只認單引號 ——
 * 而 `.rpc("admin_search_orders", args, { get: true })` 這種雙引號寫法**整個逃過掃描**,
 * 呼叫數仍是 1、10 格全綠,而搜尋詞已經進 URL。
 * repo 的 prettier 設定會把它改回單引號,但守門**不能靠另一個工具的設定**才成立
 * —— 那等於把判別力外包給一個沒有斷言在保護的前提。
 * 🔴 具名常數那條同理(本 repo 的實作就是這樣寫的)。
 */
const QUOTES = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)];
/**
 * 🔴 **改用 regex、不用字串前綴比對**(關卡2 R2 抓到):前綴比對要求 `.rpc(` 與函式名之間
 * 一個空白都不能有 ⇒ **換行寫法**(prettier 對長引數列就會這樣折)整個逃過掃描。
 * 反引號同理(第一版只有單雙引號)。`\s*` 一起把兩種都收掉。
 */
const RPC_CALL_RE = new RegExp(
  `\\.rpc\\(\\s*(?:[${QUOTES.join('')}]${RPC_NAME}[${QUOTES.join('')}]|${'ADMIN_SEARCH_ORDERS_FN'})`,
  'g',
);
/** 單引號字面(簽章那組斷言在用)。 */
const RPC_NAME_LITERAL = `${String.fromCharCode(39)}${RPC_NAME}${String.fromCharCode(39)}`;
const RPC_NAME_CONST = 'ADMIN_SEARCH_ORDERS_FN';

/**
 * 一個檔裡「呼叫這支 RPC」的位置。
 *
 * 🔴 **兩種寫法都要認**(第一版只認字串字面 ⇒ **對真正的呼叫端整個看不見**、
 * 前提格當場紅給我看):本檔的實作用的是具名常數 `ADMIN_SEARCH_ORDERS_FN`。
 * 只認其中一種的話,另一種寫法就是守門的盲區 —— 而「換一種等價寫法」正是無意回歸最常見的樣子。
 */
function rpcCallIndex(code: string): number {
  const m = new RegExp(RPC_CALL_RE.source).exec(code);
  return m ? m.index : -1;
}

/** 一個檔裡呼叫這支 RPC 的**次數**(引號三種 + 具名常數 + 換行,全部算)。 */
function countRpcCalls(code: string): number {
  return code.match(new RegExp(RPC_CALL_RE.source, 'g'))?.length ?? 0;
}

/**
 * 呼叫所在那一檔的原始碼(「恰一處」已由上面那格釘死)。
 *
 * 🔴 找不到就**當場擲**,不要 `?? ''` 靜默降級 —— 那會讓每一格都在空字串上做斷言 = 全部恆真
 *    (關卡2 R1-n1:原本另立一格「前提:找得到呼叫端」,但它被「恰一處」嚴格涵蓋、
 *     刪掉呼叫會同時紅兩格,違反「一突變只紅一格」;改成讓缺席直接炸,判別力不變、格數不重複)。
 */
function callSiteCode(): string {
  const hit = SOURCES.find(({ code }) => rpcCallIndex(code) !== -1);
  if (!hit) throw new Error('掃描面內找不到 admin_search_orders 的呼叫端');
  return hit.code;
}

describe(`${RPC_NAME} · 掃描面前提(沒有它,下面每一格都可能在 0 個檔上做斷言)`, () => {
  it('🔴 六根**逐根**都真的掃得到檔(根一漂就恆綠)', () => {
    // 🔴 code-reviewer 抓到:我在 SCAN_ROOTS 上方逐字寫了「與 nine-code-rpc-retired.test.ts
    //    同一組、理由相同」,卻**沒有抄它最關鍵的那一半**(該檔 `:100-124`)。
    //    可構造的突變:把 `apps/admin/src` 從陣列刪掉 —— 唯一性/簽章/POST-only 四組仍綠
    //    (adapter 在 ADAPTERS_SRC),只有「不得手搓 URL」那格變成在 5 根上做斷言、照樣綠。
    //    而刪根是**靜默**的(路徑打錯才會 ENOENT 炸)。
    // 🔴 **逐根各一條、不是斷言合計**:合計門檻會放行「刪掉其中一根」,那正是要擋的改法。
    //    門檻遠低於實測值,不會因正常增減檔案誤觸。
    const MIN_FILES: ReadonlyArray<readonly [string, number]> = [
      [path.join(REPO_ROOT, 'apps', 'admin', 'src'), 100],
      [ADAPTERS_SRC, 30],
      [path.join(REPO_ROOT, 'apps', 'storefront', 'src'), 200],
      [path.join(REPO_ROOT, 'packages', 'use-cases', 'src'), 20],
      [path.join(REPO_ROOT, 'packages', 'ports', 'src'), 10],
      [path.join(REPO_ROOT, 'packages', 'domain', 'src'), 15],
    ];
    // 🔴 比**路徑本身**,不只比長度:只比長度的話「把 storefront 換成第二個 admin 根」照樣全綠。
    expect(MIN_FILES.map(([root]) => root)).toEqual(SCAN_ROOTS);
    for (const [root, min] of MIN_FILES) {
      expect({ [path.relative(REPO_ROOT, root)]: sourceFiles(root).length > min }).toEqual({
        [path.relative(REPO_ROOT, root)]: true,
      });
    }
  });
});

describe(`${RPC_NAME} · 呼叫面唯一性`, () => {
  it('🔴 六個掃描根之內,呼叫**出現次數**恰為 1(單/雙/反引號 + 具名常數 + 換行,全部算)', () => {
    // 🔴🔴 **數的是「出現次數」不是「有命中的檔案數」**(突變 G5 實測抓到):
    //    第一版寫 `SOURCES.filter(有命中).length === 1` —— 那對「**同一個檔裡再加第二把**」
    //    完全看不見(filter 只會回那一個檔),而複製貼上最常見的樣子正是在原地再接一支。
    //    memory `feedback_assertion-measures-the-wrong-thing` 第三形狀逐字:
    //    「結構斷言數檔案數而非出現次數 ⇒ 同檔第二把全綠」。
    const perFile = SOURCES.map((s) => ({ file: s.file, n: countRpcCalls(s.code) })).filter(
      (s) => s.n > 0,
    );
    const total = perFile.reduce((sum, s) => sum + s.n, 0);
    // 這一格**同時**涵蓋「零處」:改名或刪掉呼叫 ⇒ 0 !== 1 ⇒ 紅。
    // ⇒ 不另立「字面至少出現一次」的前提格(會被本格嚴格蘊含,且讓一個突變紅兩格)。
    expect(total).toBe(1);
    expect(perFile.map((s) => s.file)).toEqual([
      'packages/adapters/src/supabase/SupabaseOrderAdapter.ts',
    ]);
  });
});

describe(`${RPC_NAME} · 簽章逐字對 migration(GRANT 綁精確簽章)`, () => {
  // 🔴 為什麼要有這一組:PostgREST 靠**簽章**找 overload,函式名或參數名漂一個字就是
  //    執行期 404 / 42501,而 **typecheck 全綠**(RPC 不在生成型別裡、呼叫端是窄介面 cast)。
  //    同款先例:`apps/admin/src/lib/shipping/shipment-repository.test.ts:52` 起那一組。
  //    ⚠️ 這一組與上面 POST-only 那組是**兩件事**:一個守「怎麼送」,一個守「送給誰」。
  const MIGRATION = readFileSync(
    path.join(
      REPO_ROOT,
      'supabase',
      'migrations',
      // 🔴 #347-3a 起改讀**現行**那支 migration:20260809180000 建的兩參數版已被 3a `DROP` 掉,
      //    繼續讀它 = 拿一份**已經不存在的簽章**在對帳,而測試照樣全綠(它只是讀檔比字串)。
      '20260810120000_m4b_347_3a_admin_search_orders_date_range.sql',
    ),
    'utf8',
  );
  const adapter = callSiteCode();

  it('🔴 函式名:呼叫端常數的值 = migration 裡 CREATE 的那個名字', () => {
    // 前提:migration 真的建了這支(檔名改了 / 函式改名 ⇒ 這格先紅,下面才有意義)。
    // 🔴 #347-3a 是 `CREATE FUNCTION`(**沒有** OR REPLACE)—— 它先 DROP 舊簽章再建新的,
    //    因為 `CREATE OR REPLACE` 改不了參數個數(會變成第二支 overload,PostgREST 挑錯就 404)。
    expect(MIGRATION).toContain(`CREATE FUNCTION public.${RPC_NAME}(`);
    expect(adapter).toContain(`${RPC_NAME_CONST} = ${RPC_NAME_LITERAL}`);
  });

  // 🔴 **#347-3b 已照 3a 留下的字條把 `p_from` / `p_to` 加進來**:3a 當時只列兩個,是因為
  //    當時的 adapter 不送日期(PostgREST 允許省略具預設值的參數)。3b 接上之後,
  //    不加的話「adapter 送了但 migration 沒有」那半就沒人守 —— 而那正是執行期 404 的樣子。
  //    ⚠️ 型別要一起認 `timestamptz`(前兩個是 text/integer)。
  // 🔴 **名字與型別成對**(R1 nit 9):共用一組 `(text|integer|timestamptz)` alternation 的話,
  //    把 migration 的 `p_from timestamptz` 改成 `p_from text` 那格仍然綠,
  //    而註解卻說「型別要一起認」= 宣稱大於斷言。
  it.each([
    ['p_query', 'text'],
    ['p_limit', 'integer'],
    ['p_from', 'timestamptz'],
    ['p_to', 'timestamptz'],
  ])('🔴 參數 `%s`(型別 %s)兩邊逐字對得上', (param, type) => {
    expect(MIGRATION).toMatch(new RegExp(`\\b${param}\\s+${type}\\b`));
    // 呼叫端的引數物件裡也必須有它(少一個 = 走進 DEFAULT、多一個 = 找不到 overload)。
    expect(adapter.slice(rpcCallIndex(adapter), rpcCallIndex(adapter) + 600)).toMatch(
      new RegExp(`\\b${param}\\s*:`),
    );
  });
});

/**
 * 數呼叫端 `.rpc(...)` 的**引數個數**(逐字元走括號/大括號/字串深度,不用 regex)。
 *
 * 🔴 regex 數不了這個:引數本身含大括號與逗號(`{ p_query, p_limit }`),
 * 靠 regex 切會把物件內的逗號算成引數分隔 —— 那種守門會恆紅或恆綠,兩種都沒用。
 */
function rpcArgumentCount(code: string): number {
  const open = code.indexOf('(', rpcCallIndex(code));
  let depth = 0;
  let args = 1;
  let quote = '';
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return args;
    } else if (c === ',' && depth === 1) args += 1;
  }
  throw new Error('找不到 .rpc( 的收尾括號');
}

describe(`${RPC_NAME} · POST-only(搜尋詞不得進 URL)`, () => {
  it.each([
    ['get', '`{ get: true }` ⇒ method=GET、引數 append 進 searchParams'],
    ['head', '`{ head: true }` ⇒ method=HEAD、走**同一個分支**、引數一樣 append 進 searchParams'],
  ])('🔴 呼叫端不得出現第三參數 `%s`(%s)', (option) => {
    // 呼叫起點之後的一段窗格 —— 涵蓋 `.rpc(name, args, opts)` 整個呼叫式。
    const code = callSiteCode();
    const window = code.slice(rpcCallIndex(code), rpcCallIndex(code) + 600);
    expect(window).not.toMatch(new RegExp(`\\b${option}\\s*:`));
  });

  it("🔴 呼叫端不得出現 method: 'GET' / 'HEAD' 之類的手動覆寫", () => {
    const code = callSiteCode();
    expect(code.slice(rpcCallIndex(code), rpcCallIndex(code) + 600)).not.toMatch(/method\s*:/);
  });

  it('🔴🔴 呼叫**恰兩個引數** —— 第三參數一律不准,不管它長什麼樣', () => {
    // 🔴 為什麼要這一格(關卡2 R3 consider ②):上面兩格是**黑名單**(找 `get:` / `head:` 字面),
    //    而 `const opts = { get: true }; …rpc(fn, args, opts)` **一個危險字面都不在窗格裡**
    //    ⇒ 黑名單全綠、PII 照樣進 URL。而那個寫法**看起來像無意的重構**,不是刻意規避
    //    ⇒ 屬於本檔宣稱要擋的那一類,不能只寫進「擋不住」清單。
    // ⇒ 改用**白名單**:數引數個數。第三個引數是 options 進來的唯一入口,不准就是不准。
    const code = callSiteCode();
    expect(rpcArgumentCount(code)).toBe(2);
  });

  it('🔴 引數不得用 spread 或 `as any` 餵(那會讓型別與本檔的字面守門同時失效)', () => {
    const code = callSiteCode();
    const window = code.slice(rpcCallIndex(code), rpcCallIndex(code) + 600);
    expect(window).not.toMatch(/\.\.\./);
    expect(window).not.toMatch(/as\s+any/);
  });
});

describe(`${RPC_NAME} · 搜尋詞不得被手搓進 URL`, () => {
  it('🔴 六個掃描根之內,沒有任何檔同時出現 `p_query` 與 URL 組裝字面', () => {
    const offenders = SOURCES.filter(
      ({ code }) =>
        code.includes('p_query') &&
        (code.includes('URLSearchParams') ||
          code.includes('searchParams.append') ||
          code.includes('searchParams.set')),
    ).map((s) => s.file);
    // 🔴 剝註解那一半在這裡是必要的:adapter 有三處 `URLSearchParams` 字面在註解裡
    //    (量 URL 長度的說明),不剝就會對正確實作假紅。
    expect(offenders).toEqual([]);
  });
});
