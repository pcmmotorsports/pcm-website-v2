import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../lib/test-support/strip-comments';

// od-ported-rules-vs-globals.test.ts — 把 `docs/design/od-ported-rules.json`(稿的值)
// 接到 `globals.css`(我方的值)上,**讓那條鏈閉環**。
//
// ═══ 為什麼要這一支 ══════════════════════════════════════════════════════════
// 2026-08-25 交 `od-drift-check.py` 時我自己標了一個洞:「它不看我方的實作」。
// 當時我以為那是**另一件事**。量完才看到它不是 ——
// **它是同一條鏈上的下一節,而那一節是斷的**:
//
//   ```
//   稿改了 ⇒ od-drift-check 紅 ⇒ 有人讀新稿 ⇒ 更新 manifest
//          ⇒ 🔴 我方 CSS 與既有那兩支測試【照樣全綠】,而沒有任何訊號。
//   ```
//
// 成因是 **同一組 OD 值在 repo 裡有兩份各自硬寫的副本,而沒有東西把它們綁在一起**:
//   · `od-ported-rules.json`                     ← 稿的值(給 drift-check 用)
//   · `workspace-shell.test.ts:329/335/344`      ← 我方的值(硬寫)
//   · `design-tokens.test.ts:1904/1913`          ← 我方的值(硬寫)
// ⇒ 本檔不動那兩支(它們還守別的東西),**只補上把 manifest 綁到 `globals.css` 的那一節**。
//
// ═══ 🔴 它為什麼【可以】是 vitest,而 drift-check 不行 ═══════════════════════
// `od-drift-check.py` 比的是「稿現在的值」,而**稿住在 repo 外面**(Open Design 的資料夾)
// ⇒ 別人的機器與 CI 上那個檔不存在 ⇒ 做成測試會「紅在環境」而不是「紅在漂移」。
// 本檔比的兩邊(manifest 與 `globals.css`)**都住在 repo 裡** ⇒ 它在任何機器上都有判別力。
// ⚠️ **兩件事的環境限制不同,不要合成一句「OD 的東西不能做成測試」。**
//
// ═══ 🔴 分母(先講,不是事後補)═════════════════════════════════════════════
// manifest 10 條,本檔**只涵蓋住在 `globals.css` 的那 6 條**:
//   ✅ 組4 ×3(`.workspace-panel` / `.workspace-row` / `.workspace-handle`)· 組5 · 組19 · 組20
//   ❌ 組28 / 組37 / 組38 / 組40 —— 我方是 **Tailwind class**(寫在 `order-detail-tabs.tsx`)
//      不是 `globals.css` 規則 ⇒ 本檔的量法對它們**零判別力**,所以明列在 `NOT_COVERED`。
//   ⚠️ 組37/38 另有一件:顏色是**已知且已落檔的偏離**(稿 `--pill-accent` vs 我方 `--ring`,
//      成因 = 全域那條 `:where(…):focus-visible` 沒有 layer ⇒ 元件層蓋不掉)。
//      **就算它在涵蓋範圍內也不該斷言相同** —— 那會把一個已知偏離變成假的一致。
//
// 🔴 **「沒涵蓋」不可以是安靜的**:下面 `每一條 manifest 都被分類過` 那格會強制
//    每一條 rule 要嘛在 `OURS` 有對應、要嘛【它自己】在 `NOT_COVERED` 裡(綁整個 key,不綁 group 名)。
//    manifest 長出第 11 條而沒有人分類它 ⇒ **紅**,不是靜靜地跳過。
//
// ═══ ⚠️ 組19/20 只比【宣告】不比【選擇器】═══════════════════════════════════
// 我方選擇器**刻意不逐字**:稿用 `details:has(>summary h2…) > summary`,
// 而 `audit-detail-css.test.ts` 那道閘禁止 `globals.css` 出現 `details` 字面(連註解都不行)
// ⇒ 我方改寫成 `summary:has(h2…)`。等價性由 `danger-zone-details.test.tsx` 另外釘住
// (summary 是 details 的直接子代、h2 在 summary 裡面)。
// ⇒ **本檔比得了值,比不了選擇器。** 那是刻意的,不是漏掉。
//
// 🔴 **殘留洞,明寫**(1b 2026-08-25 要求):
//    **我方可能把【對的宣告】套在【錯的元素】上,而這支測不出來。**
//    它讀的是 `globals.css` 的文字 —— 選擇器實際命中誰、命中幾個、有沒有被別條蓋掉,
//    全部在它的射程之外。那要真瀏覽器量(組19/20 當初量過一次,證據在 `globals.css` 那段註解)。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

type Rule = {
  group: string;
  context: string;
  selector: string;
  declarations: Record<string, string>;
};
type Manifest = { source: { path: string; sha256: string }; rules: Rule[] };

const MANIFEST = JSON.parse(read('../../../../docs/design/od-ported-rules.json')) as Manifest;
const GLOBALS = stripComments(read('./globals.css'));

const MOBILE = '@media (max-width: 767px)';

/**
 * manifest 的一條 → 我方在 `globals.css` 的選擇器。
 * 🔴 鍵用**稿的**選擇器:稿換了選擇器 ⇒ 這裡查無 ⇒ 下面那格會紅,而不是安靜略過。
 */
const OURS = new Map<string, { selector: string; media?: string }>([
  ['組4|@media (max-width:767px)|.workspace-panel', { selector: '.workspace-panel', media: MOBILE }],
  ['組4|@media (max-width:767px)|.workspace-row', { selector: '.workspace-row', media: MOBILE }],
  ['組4|@media (max-width:767px)|.workspace-handle', { selector: '.workspace-handle', media: MOBILE }],
  [
    '組5|@media (max-width:767px)|.workspace-panel>.panel-width-locked',
    { selector: '.workspace-panel > .panel-width-locked', media: MOBILE },
  ],
  [
    '組19||[data-od-panel="money"] details:has(>summary h2:not(.text-destructive)) > summary',
    { selector: "[data-od-panel='money'] summary:has(h2:not(.text-destructive))" },
  ],
  [
    '組20||[data-od-panel="money"] details:has(>summary h2.text-destructive) > summary',
    { selector: "[data-od-panel='money'] summary:has(h2.text-destructive)" },
  ],
]);

/**
 * 我方不是寫在 `globals.css` 的那幾條 —— 本檔對它們零判別力,明列出來而不是靜靜跳過。
 * 🔴 **綁【整個 key】不綁 group 名**(codex R3 MF-5):原本用 `Set(['組28', …])`
 *    ⇒ 那幾組換了 selector 或搬了實作位置**而沿用同一個 group 名**時,
 *    它們**仍然被整組排除**,而上面那四個數字一個都不會變 ⇒ 全綠。
 *    「這個組別不歸我管」與「這條規則不歸我管」是兩個宣稱,group 名只答得出前者。
 */
const NOT_COVERED = new Map<string, { file: string; marker: string }>([
  // 🔴🔴 **每一條要綁【實作位置】並機械驗證它真的在**(codex R4 MF-4)。
  //    只綁名字的話,**把 key 加進這張表**就是讓分母那格變綠最省力的動作 ——
  //    而「我方是 Tailwind class」這句話原本只是一句**沒有人能驗的宣稱**。
  //    ⇒ 現在它要指得出檔案與字面,而下面那格會逐條去開檔核。
  ['組28||.od-seg-on .od-seg-dot', { file: 'orders/order-detail-tabs.tsx', marker: 'rounded-full' }],
  ['組37||.od-seg:focus-visible', { file: 'orders/order-detail-tabs.tsx', marker: 'focus-visible:' }],
  ['組38||[data-od-tab]:focus-visible', { file: 'orders/order-detail-tabs.tsx', marker: 'focus-visible:' }],
  ['組40||.od-segbar:focus-within', { file: 'orders/order-detail-tabs.tsx', marker: 'focus-within:' }],
]);

// 🔴 **`context` 必須進 key**(codex R2 MF-5):稿只改 `context`(= media query)而
//    group/selector/值都不動 ⇒ 舊 key 不變 ⇒ 這支測試會**繼續比舊的 media 區塊,而全綠**。
const keyOf = (r: Rule) => `${r.group}|${r.context}|${r.selector}`;

/**
 * 空白正規化:選擇器與 media 條件在兩邊的寫法不同(`100%!important` vs `100% !important`)。
 * 🔴 也把 `#fff` 展開成 `#ffffff` 並轉小寫(codex R2 nit-2)——
 *    兩邊寫法不同而顏色相同時,不正規化會製造**假紅**,而假紅比假綠更容易被學會忽略。
 */
const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s*([>,+~])\s*/g, '$1')
    .replace(/\s*!\s*important/g, '!important')
    .replace(/"/g, "'")
    .replace(/#([0-9a-fA-F]{3})\b/g, (_m, h: string) => `#${[...h].map((c) => c + c).join('')}`)
    .replace(/#[0-9a-fA-F]{6}\b/g, (m) => m.toLowerCase())
    .trim();

const normMedia = (s: string) => s.replace(/\s+/g, '');

type Parsed = { sel: string; body: string; media: string };

/**
 * 把 CSS 拆成 (選擇器, 宣告區塊, 所在 at-rule)。`@import …;` 這種無區塊的要跳過
 * (不跳 ⇒ prelude 會一路吃到下一個 `{`,選擇器全錯而**看起來只是查無**)。
 *
 * 🔴🔴 **只遞迴 `@media` 與 `@supports`,與稿那一側逐字對齊**(codex R4 MF-1)。
 *
 * `tool-final-css.py:133-137` 的 `walk()` 只對這兩種 at-rule 遞迴,其餘整塊跳過。
 * 而本檔第一版**遞迴進所有 `@`** ⇒ 餵 `@container card(width>1px){.a{color:red}}`:
 * ```
 * python 側 ⇒ 整塊跳過, 看不到 .a
 * TS     側 ⇒ 遞迴進去, .a → red
 * ```
 * ⇒ **兩側對「誰贏」會給不同答案** —— 而我自己寫過「兩側要用同一種層疊語意,
 *   不然比出來的相同是兩種算法碰巧撞在一起」。**病灶不在 `norm()`,在 at-rule 的遞迴。**
 * ⚠️ **不改 `tool-final-css.py`** —— 那是共用工具,別人也在用。對齊在本側。
 * ⇒ 跳過的那些 at-rule 收進 `SKIPPED`,下面有一格斷言「我方的目標選擇器沒有住在裡面」。
 *
 * 🔴 第二個對齊(codex 沒點,同一族,我自己撞到的):**逗號要拆開**。
 *    python 側 `for sel in prelude.split(',')` 逐個 yield;本檔第一版把 `.a,.b` 當成一條
 *    ⇒ 稿那側看得到 `.b` 而我方這側看不到。**同一個病的另一半。**
 */
const RECURSE_AT = ['@media', '@supports'];
const SKIPPED: { at: string; body: string }[] = [];

function parseRules(css: string, media = '', collectSkipped = false): Parsed[] {
  const out: Parsed[] = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = css.slice(start, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      const body = css.slice(i + 1, j - 1);
      if (prelude.startsWith('@')) {
        const at = prelude.split('{')[0]!.trim();
        if (RECURSE_AT.some((k) => at.startsWith(k))) {
          out.push(...parseRules(body, at, collectSkipped));
        } else if (collectSkipped) {
          SKIPPED.push({ at, body });
        }
      } else {
        for (const one of splitTop(prelude, ',')) if (one !== '') out.push({ sel: one, body, media });
      }
      i = j;
      start = j;
    } else if (ch === '}' || ch === ';') {
      i += 1;
      start = i;
    } else {
      i += 1;
    }
  }
  return out;
}

const PARSED = parseRules(GLOBALS, '', true);

function declsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    const at = chunk.indexOf(':');
    if (at < 0) continue;
    const prop = chunk.slice(0, at).trim();
    if (prop === '' || prop.includes('{') || prop.includes('}')) continue;
    out[prop] = norm(chunk.slice(at + 1));
  }
  return out;
}

/**
 * 把**所有**符合的區塊按文件順序合併,同屬性後面的贏 —— 回 `undefined` 表示一條都沒有。
 *
 * 🔴🔴 codex R2 MF-6 說「不要取第一個,要取最後一個」——**方向對,而「取最後一個」還不夠。**
 *    我照著改完之後量了一發:在檔尾追加 `.workspace-panel{z-index:999}`
 *    ⇒ **9 個屬性【全部】變紅**,而真瀏覽器只有 `z-index` 被覆寫,另外 8 個仍然來自前面那條。
 *    ⇒ 「取最後一個」把 8 個沒問題的屬性報成問題 = **假紅**,
 *      而假紅的代價是下一個人學會忽略這支測試。
 * ⇒ 正解是**合併**,而那也正是稿那一側的語意:`tool-final-css.py` 的 `final_values()`
 *    對同一個 key 是**累積寫進同一個 dict**,不是換一個 dict。
 *    📌 **兩側要用同一種層疊語意,不然比出來的「相同」是兩種算法碰巧撞在一起。**
 * ⚠️ 射程:同 media 且選擇器**逐字相同**才算同一條。`.a` 與 `.a, .b` 在真瀏覽器是同一組宣告的
 *    兩個來源,本檔把它們當兩條;特異性、`!important`、`@layer` 一律不算 —— 那要 CSS 引擎。
 */
function pick(
  parsed: Parsed[],
  want: { selector: string; media?: string },
): { decls: Record<string, string>; blocks: number } | undefined {
  const sel = norm(want.selector);
  const media = normMedia(want.media ?? '');
  const hits = parsed.filter((r) => norm(r.sel) === sel && normMedia(r.media) === media);
  if (hits.length === 0) return undefined;
  const decls: Record<string, string> = {};
  for (const h of hits) Object.assign(decls, declsOf(h.body)); // 文件順序,後面的贏
  return { decls, blocks: hits.length };
}

const ourBlock = (want: { selector: string; media?: string }) => pick(PARSED, want);

/**
 * 找出**可能命中同一個元素、而選擇器不逐字相同**的規則(codex R3 MF-4)。
 *
 * 🔴 為什麼要有這一格:`pick()` 只合併【逐字同 selector】的區塊 ⇒ 有人新增一條
 *    **特異性更高**的選擇器(`.workspace-panel.foo`、`.x .workspace-panel`)時,
 *    **瀏覽器吃它,而本檔完全看不到** ⇒ 四個數字全不變、全綠,
 *    而 computed style 已經被覆寫。**這正是本包核心命題(哪一條贏)的漏洞。**
 * ⇒ 修不了「誰真的贏」(那要 CSS 引擎),但**可以讓它出聲**:出現新的競爭者就紅,由人分類。
 *
 * 判準:候選選擇器把我方那段挖掉之後,前面是空或以組合子/空白結尾、後面是空或以 `.#[:` 開頭。
 * ⚠️ 因此 `.workspace-panel>.panel-width-locked` **不算**競爭者(它命中的是子元素)。
 * ⚠️ 它答不出「誰贏」,只答得出「有別人也在講這個屬性」。**特異性與 `@layer` 一律沒算。**
 */
function competitors(
  parsed: Parsed[],
  want: { selector: string },
  props: string[],
): { sel: string; media: string; prop: string; value: string }[] {
  const me = norm(want.selector);
  const out: { sel: string; media: string; prop: string; value: string }[] = [];
  for (const r of parsed) {
    const sel = norm(r.sel);
    if (sel === me) continue;
    const d = declsOf(r.body);
    const hit = splitTop(sel, ',').some((alt) => {
      if (alt === me) return false;
      const at = alt.indexOf(me);
      if (at < 0) return false;
      const before = alt.slice(0, at);
      const after = alt.slice(at + me.length);
      if (!(before === '' || /[\s>+~]$/.test(before))) return false;
      if (!(after === '' || /^[.#[:]/.test(after))) return false;
      // 🔴 **主詞判斷**:比對到的那一段後面若還有頂層組合子,主詞就不是它,是後面那個元素。
      //    (實例:`.workspace-row:not(:has(…))>.workspace-panel` 命中 `.workspace-row`,
      //     而它真正命中的元素是 `.workspace-panel` ⇒ 沒有這一格會是假紅。)
      return !hasTopCombinator(after);
    });
    if (!hit) continue;
    for (const p of props) if (p in d) out.push({ sel, media: r.media, prop: p, value: d[p]! });
  }
  return out;
}

/**
 * 已被【人】分類過的競爭選擇器 —— 新的一條出現就會紅,由人決定它是不是問題。
 *
 * 🔴 **這一格不是為了讓測試變綠,它記的是一個真的存在的競爭者**:
 *    `globals.css:560-561` 那條「面板是空的 ⇒ 把面板與把手都藏起來」的規則,
 *    主詞之一就是 `.workspace-handle`,而它也宣告 `display`。
 *    判定 = **無害**:兩邊都是 `display:none`,而且它只在面板空的時候才命中,
 *    與 組4 那條「手機版藏把手」是同向的。
 * ⚠️ 而它是**本偵測器裝上去的第一發就抓到的** —— 不是我事先知道它在那裡。
 *    ⇒ 「同名之間比」這個漏洞不是理論,`globals.css` 現在就有一個實例。
 */
const KNOWN_RIVALS = new Set([
  // 🔴 **key 帶【值】**(codex R4 MF-3):只綁名稱的話,
  //    `.workspace-handle.danger{display:block}` 把同一個名字塞進來就綠,**而覆寫還在**。
  //    帶值之後,那條規則改了值 ⇒ key 變 ⇒ 重新變紅,要人再判一次。
  '|.workspace-row:not(:has(.workspace-panel>*:not(template)))>.workspace-handle|display|none',
]);

/** 依頂層(不在 `()` `[]` 裡)的分隔字元切開。 */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** 這一段裡有沒有【頂層】的組合子(`>` `+` `~` 或空白)。 */
function hasTopCombinator(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && (ch === '>' || ch === '+' || ch === '~' || ch === ' ')) return true;
  }
  return false;
}

describe('OD 已搬規則:manifest(稿的值)vs globals.css(我方的值)', () => {
  it('🔴 每一條 manifest 都被分類過 —— 沒涵蓋要明說,不可以安靜跳過', () => {
    const unclassified = MANIFEST.rules
      .filter((r) => !OURS.has(keyOf(r)) && !NOT_COVERED.has(keyOf(r)))
      .map(keyOf);
    expect(
      unclassified,
      'manifest 有規則既不在 OURS 也不在 NOT_COVERED ⇒ 它會被靜靜略過,而覆蓋率的宣稱會變成假的',
    ).toEqual([]);
  });

  it('🔴 OURS 裡沒有用不到的條目 —— 對照組是假的,覆蓋率也會是假的', () => {
    const manifestKeys = new Set(MANIFEST.rules.map(keyOf));
    const stale = [...OURS.keys()].filter((k) => !manifestKeys.has(k));
    expect(stale, 'OURS 有條目在 manifest 裡查無 ⇒ 稿換了選擇器而這張表沒跟').toEqual([]);
  });

  it('🔴 涵蓋的分母寫死:4 組 / 6 條 / manifest 共 10 條(這一格擋的是恆綠格)', () => {
    // 🔴 **為什麼要寫死數字而不是 `length > 0`**(1b 2026-08-25,他剛在 drift-check 上實測到同款):
    //    manifest 欄位改名 ⇒ 下面那個迴圈掃到 0 條 ⇒ **一條斷言都不會跑,而整支測試全綠**。
    //    「10 掉到 1」與「10 條全過」在 `> 0` 這把尺底下印同一個字。
    const coveredGroups = new Set(
      MANIFEST.rules.filter((r) => OURS.has(keyOf(r))).map((r) => r.group),
    );
    expect([...coveredGroups].sort(), '涵蓋的組別變了').toEqual(['組19', '組20', '組4', '組5']);
    expect(OURS.size, '涵蓋條數變了').toBe(6);
    expect(MANIFEST.rules.filter((r) => NOT_COVERED.has(keyOf(r)))).toHaveLength(4);
    // 🔴 排除清單自己也要有斷言:條目在 manifest 裡查無 ⇒ 它排除的是一條【不存在的規則】,
    //    而那會讓「四條沒涵蓋」這個宣稱悄悄變成「三條沒涵蓋 ＋ 一條沒人看」。
    const manifestKeys2 = new Set(MANIFEST.rules.map(keyOf));
    expect([...NOT_COVERED.keys()].filter((k) => !manifestKeys2.has(k)), '排除清單有條目在 manifest 裡查無').toEqual([]);
    expect(MANIFEST.rules, 'manifest 總條數變了 ⇒ 有人加了規則而本檔的分類沒跟').toHaveLength(10);
  });

  it('🔴🔴 NOT_COVERED 每一條指得出【實作位置】,而那個位置真的存在(R4 MF-4)', () => {
    for (const [key, where] of NOT_COVERED) {
      const src = read(`../components/${where.file}`);
      expect(src.length, `${key}:指的檔 ${where.file} 讀不到`).toBeGreaterThan(0);
      expect(src, `${key}:${where.file} 裡找不到 ${where.marker} ⇒ 「我方寫在那裡」這句話不成立`).toContain(
        where.marker,
      );
    }
  });

  it('🔴🔴 我方的目標選擇器沒有住在【本尺跳過的 at-rule】裡(R4 MF-1)', () => {
    // 稿那側只遞迴 @media / @supports,本側已對齊 ⇒ 其餘 at-rule 兩側都看不見。
    // 而「兩側都看不見」不等於「沒問題」:若我方把規則寫進 `@layer` / `@container`,
    // 它在瀏覽器裡有效、在這兩把尺底下隱形 ⇒ **會安靜地全綠**。
    const hidden: string[] = [];
    for (const { at, body } of SKIPPED) {
      for (const [, want] of OURS) if (body.includes(want.selector)) hidden.push(`${at} ⊃ ${want.selector}`);
    }
    expect(hidden, '目標選擇器出現在本尺跳過的 at-rule 裡 ⇒ 它在瀏覽器有效而兩把尺都看不到').toEqual([]);
    expect(SKIPPED.length, 'SKIPPED 是空的 ⇒ 收集沒接上, 上面那個 [] 沒有判別力').toBeGreaterThan(0);
  });

  it('🔴 KNOWN_RIVALS 裡沒有過期條目(過期的豁免 = 假的安全感)', () => {
    const seen = new Set<string>();
    for (const rule of MANIFEST.rules) {
      const want = OURS.get(keyOf(rule));
      if (want === undefined) continue;
      for (const x of competitors(PARSED, want, Object.keys(rule.declarations)))
        seen.add(`${x.media}|${x.sel}|${x.prop}|${x.value}`);
    }
    expect(
      [...KNOWN_RIVALS].filter((k) => !seen.has(k)),
      '豁免清單有條目在 globals.css 裡查無 ⇒ 它豁免的是一條不存在的規則, 而清單看起來仍然被維護著',
    ).toEqual([]);
  });

  it('🔴 迴圈真的跑到了 6 條(上面那格數的是【表】,這格數的是【實際跑掉的斷言】)', () => {
    // ⚠️ 兩件事:`OURS.size` 是我列的表,`ran` 是迴圈實際找到的。
    //    只驗前者 ⇒ 表寫得漂亮而迴圈一圈沒跑,照樣全綠。
    const ran = MANIFEST.rules.filter((r) => OURS.has(keyOf(r)));
    expect(ran).toHaveLength(6);
    expect(ran.every((r) => Object.keys(r.declarations).length > 0), '有規則的宣告是空的 ⇒ 它會零斷言通過').toBe(true);
  });

  for (const rule of MANIFEST.rules) {
    const want = OURS.get(keyOf(rule));
    if (want === undefined) continue;

    describe(`${rule.group} ${want.selector}`, () => {
      it('這條規則在 globals.css 找得到(含所在的 @media)', () => {
        expect(
          ourBlock(want),
          `globals.css 找不到 ${want.media ?? '頂層'} 裡的 ${want.selector}`,
        ).toBeDefined();
      });

      it('🔴 沒有【未分類的】競爭選擇器(有 ⇒ 誰贏本檔答不出來,要人判)', () => {
        const rivals = competitors(PARSED, want, Object.keys(rule.declarations)).map(
          (x) => `${x.media}|${x.sel}|${x.prop}|${x.value}`,
        );
        expect(
          rivals.filter((k) => !KNOWN_RIVALS.has(k)),
          '出現沒被分類過的競爭選擇器 ⇒ 瀏覽器可能吃它而本檔看的是另一條 ⇒ 要人分類, 不可以沉默',
        ).toEqual([]);
      });

      for (const [prop, odValue] of Object.entries(rule.declarations)) {
        it(`${prop} 與稿相同`, () => {
          const block = ourBlock(want);
          expect(block, 'block 查無 ⇒ 上一格已經紅了,這裡不重複報').toBeDefined();
          expect(
            block!.decls[prop],
            `${rule.group} 的 ${prop}:manifest 記的稿值與 globals.css 對不上`,
          ).toBe(norm(odValue));
        });
      }
    });
  }
});

describe('parseRules 自檢 —— 🔴 它是本檔的量具,量具自己要先雙向表演過', () => {
  it('抓得到頂層規則與它的宣告(正對照)', () => {
    const r = parseRules('.a{color:red;background:blue}');
    expect(r).toHaveLength(1);
    expect(declsOf(r[0]!.body)).toEqual({ color: 'red', background: 'blue' });
  });

  it('@media 裡的規則帶得回它的 media(不帶 ⇒ 手機那條會與桌機那條混在一起)', () => {
    const r = parseRules('.a{color:red}@media (max-width:767px){.a{color:blue}}');
    expect(r.map((x) => [x.media, declsOf(x.body).color])).toEqual([
      ['', 'red'],
      ['@media (max-width:767px)', 'blue'],
    ]);
  });

  it('🔴 `@import …;` 不會把後面的選擇器吃掉(負對照:不處理 `;` 就會)', () => {
    const r = parseRules("@import 'tailwindcss';\n.a{color:red}");
    expect(r).toHaveLength(1);
    expect(norm(r[0]!.sel)).toBe('.a');
  });

  it('🔴 查無要回 undefined,不可以回一個長得像命中的東西(負對照)', () => {
    expect(ourBlock({ selector: '.this-selector-does-not-exist-anywhere' })).toBeUndefined();
    expect(ourBlock({ selector: '.workspace-panel', media: '@media (max-width: 1px)' })).toBeUndefined();
  });

  it('🔴🔴 同選擇器同 media 有兩條時,取【後面那條】—— 瀏覽器吃的是那個(R2 MF-6)', () => {
    const two = parseRules('.a{color:red}.a{color:blue}');
    expect(two).toHaveLength(2);
    const merged = pick(two, { selector: '.a' })!;
    expect(merged.blocks, '兩條都要被看到, 不是只看一條').toBe(2);
    expect(merged.decls.color, '取到第一條 ⇒ 之後任何覆寫都會安靜地被忽略').toBe('blue');
    // 🔴 而【合併】與【取最後一條】的差別就在這一格:前面那條獨有的屬性必須活下來,
    //    否則它會被報成「不見了」= 假紅(這是我照 MF-6 改成 findLast 之後量到的實際行為)。
    const keep = pick(parseRules('.a{color:red;font-size:1px}.a{color:blue}'), { selector: '.a' })!;
    expect(keep.decls, '只取最後一條的話 font-size 會消失, 而真瀏覽器裡它還在').toEqual({
      color: 'blue',
      'font-size': '1px',
    });
    // 負對照:換一個不存在的選擇器,反向掃也不可以撿到隔壁那條
    expect(pick(two, { selector: '.zzz' })).toBeUndefined();
  });

  it('🔴🔴 競爭選擇器偵測:該抓的要抓到、該放過的要放過(R3 MF-4 的量具自檢)', () => {
    const P = (css: string) => parseRules(css);
    // 正對照三種長相:同元素加類別 / 前面加祖先 / 加偽類
    expect(competitors(P('.a{color:red}.a.b{color:blue}'), { selector: '.a' }, ['color'])).toHaveLength(1);
    expect(competitors(P('.a{color:red}.x .a{color:blue}'), { selector: '.a' }, ['color'])).toHaveLength(1);
    expect(competitors(P('.a{color:red}.a:hover{color:blue}'), { selector: '.a' }, ['color'])).toHaveLength(1);
    // 🔴 負對照一:命中【子元素】的不算(不然 組4 會被 組5 自己那條誤報)
    expect(competitors(P('.a{color:red}.a>.b{color:blue}'), { selector: '.a' }, ['color'])).toEqual([]);
    // 🔴 負對照二:講的是【別的屬性】的不算
    expect(competitors(P('.a{color:red}.a.b{margin:0}'), { selector: '.a' }, ['color'])).toEqual([]);
    // 🔴 負對照三:逐字同一條不算自己的競爭者(不然每條規則都會誤報自己)
    expect(competitors(P('.a{color:red}.a{color:blue}'), { selector: '.a' }, ['color'])).toEqual([]);
  });

  it('🔴 `#fff` 與 `#FFFFFF` 要算相同 —— 不然是假紅(R2 nit-2)', () => {
    expect(norm('#fff')).toBe(norm('#FFFFFF'));
    expect(norm('1px solid #ABC')).toBe(norm('1px solid #aabbcc'));
    // 負對照:真的不同的顏色不可以被正規化成一樣
    expect(norm('#fff')).not.toBe(norm('#eee'));
  });

  it('🔴 `.workspace-panel` 在頂層與手機版各有一條,量具要分得開(這是本檔最容易假綠的一格)', () => {
    const top = ourBlock({ selector: '.workspace-panel' });
    const mobile = ourBlock({ selector: '.workspace-panel', media: MOBILE });
    expect(top).toBeDefined();
    expect(mobile).toBeDefined();
    expect(top!.decls.position, '頂層那條不該有 position:fixed').not.toBe('fixed');
    expect(mobile!.decls.position).toBe('fixed');
  });
});
