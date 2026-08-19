import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ── 🔴 收合行為被 CSS 蓋掉 —— 我原本寫「這條守不住」,而那是假的 ────────────────
//
// **我第一版的誠實邊界逐字寫**:「有人用 CSS 蓋掉 `details` 預設行為 ⇒ 本片一格都不會紅」。
// 🔴 **那句只對「真瀏覽器的繪製」成立,對「repo 裡有沒有那行 CSS」不成立。**
//   E 窗預告要用那把刀切我(**要環境的狀態,還是引擎的行為?**),我自己先量:
//   `grep -rl "globals.css" apps/admin/src --include='*.test.ts*'` ⇒ **3 支既有測試在掃 CSS 當守門**
//   ⇒ **分母非 0,所以「守不住」是假的。** 那是我第五次往「不可得」倒(紀律 16)。
//
// ⚠️ **本格的真實範圍(不要讀成「收合行為已驗證」)**:
//   · **守得住**:有人在 `globals.css` 加任何 `details` 相關規則 ⇒ 這格紅,強迫他來想一次。
//   · **守不住**:①元件自己被加上 Tailwind class(那要改 `audit-detail.tsx`,而那支的
//     `<details>` 字面沒有守門釘住) ②真實瀏覽器的繪製行為 ③使用者裝的擴充套件 / 使用者樣式。
//   ⇒ **這格把「完全沒有守門」變成「守住最可能的那一條路」,不是把問題解決掉。**
//
// 🔴🔴 **本格守的是「有人蓋掉預設行為」,不是「內容在收合時看不見」**(E 窗 R1 ③,逐字收):
//   **後者永遠不是 DOM 問題** —— `<details>` 收合時內容**仍然在 DOM 裡**,
//   「看不見」是**瀏覽器的繪製行為**,任何 DOM 層測試都答不了。
//   ⇒ **所以這格不是「覆蓋率從 0 變 1」,是「本來就不該由測試回答的那半,現在被正確地排除在外」。**
//   ⚠️ **不要讀成「已經守住不會洩漏」** —— 它守的是**倉庫裡的一行 CSS**,不是使用者的螢幕。
const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);

describe('收合行為不得被 globals.css 蓋掉', () => {
  it('前提:CSS 檔真的讀得到(讀成空字串 ⇒ 下一格恆綠)', () => {
    // 零也要停:檔案路徑寫錯時 `readFileSync` 會丟錯,但若哪天改成容錯讀取,
    // 空字串會讓下一格靜默恆綠 —— 這格擋那種。
    expect(GLOBALS_CSS.length).toBeGreaterThan(0);
  });

  it('前提:偵測字串抓得到(正向對照,證明下一格的 0 是活的 0)', () => {
    expect(/\bdetails\b/.test('details > *:not(summary) { display: block }')).toBe(true);
    // 負向:一般文字不得誤命中,否則這道守門會恆紅。
    expect(/\bdetails\b/.test('.order-detail-panel { color: red }')).toBe(false);
  });

/**
 * 🔴🔴 **具名豁免清單 —— 逐字選擇器,不用萬用字元。**
 *
 * **為什麼是豁免而不是把判準收窄**(主視窗 2026-08-19 裁):
 * 這一格的檔頭自己寫著它的用意 ——「有人加任何 `details` 規則 ⇒ 這格紅,**強迫他來想一次**」。
 * ⇒ **它不是一道禁令,是一道【叫人來想】的絆線。而它成功了。**
 * ⇒ 把判準收窄(例如改成只擋「會改到收合行為的規則」)**會讓下一個人不必來想**,
 *   而那正是這一格存在的全部價值 ⇒ **廣度一格都不能少,所以用逐字豁免。**
 *
 * ⚠️ **本豁免只涵蓋下面這一條選擇器。任何其他 `details` 規則仍然會紅,那是刻意的。**
 */
/**
 * 🔴🔴 **判斷「這一行是不是被具名豁免的那一條」—— 唯一的一份實作。**
 *
 * ⚠️ **抽成具名函式不是整潔,是【讓它可以被測】**(W1 2026-08-19):
 *    我上一版把「豁免必須逐字」寫成一格測試,而**那格測的是常數陣列、不是這個比對法**
 *    ⇒ 把比對法改回子字串 ⇒ **漏洞復活,而那格照樣綠。**
 *    🔴 **我的守門量的是它旁邊那個東西** —— 今天同族第 N 次,而這次是我在【修同一個病的當下】又犯一次。
 *    ⇒ 現在主斷言與判別力那格**吃同一支函式**,改它 ⇒ 兩邊一起紅。
 */
const ALLOWED_DETAILS_RULES: readonly string[] = [
  // `.icard > summary::-webkit-details-marker { display: none }` —— 品項卡把原生小三角形藏起來。
  //
  // 🔴 **為什麼它安全(2026-08-19 W3 實查,證據附在這裡而不是 commit body)**:
  // ① **射程有界**:選擇器是 `.icard > summary`,而 `.icard` 只出現在品項卡
  //    (`components/orders/item-amount-row.tsx` 的 `<details className='icard'>`)。
  //    本格保護的 `AuditDetail` 掛在 `components/audit/audit-log-table.tsx:55`,
  //    **不可能落在 `.icard` 底下** ⇒ 這條規則碰不到它。
  // ② **改的不是收合**:它只動 `::-webkit-details-marker`(那顆小三角形),
  //    **沒有動內容的 `display`** ⇒ **沒有蓋掉 `<details>` 的收合行為**,
  //    而「蓋掉收合行為」正是本格在守的那件事。
  '.icard > summary::-webkit-details-marker',
];

// ⚠️ **不 export**:`import` 一支 `.test.ts` 會讓它的 describe 被重複註冊、整組跑兩次
//    (本 repo 記過:`workspace-shell.test.ts` 檔頭那段 R2 nit)。本函式只在本檔用。
/**
 * 🔴 **這支檔裡有幾個地方在用這個比對?機械數法(`W6-032` M1 要求)**:
 * ```bash
 * grep -c 'isExemptDetailsRule(' apps/admin/src/components/audit/audit-detail-css.test.ts
 * # 2026-08-19 當下 ⇒ 4（1 宣告 + 3 使用：主斷言 / 判別力 / 廣度）
 * grep -cE 'ALLOWED_DETAILS_RULES\.(some|includes)\(' <同檔>
 * # ⇒ 1（只有本函式內那一個）。🔴 大於 1 就代表【又長出一份複本】
 * ```
 * ⚠️ **為什麼要留這條數法**:前三次都是「有人另外寫了一份比對」,而**複本本身不會紅**。
 *    數法比提醒可靠 —— 它可以被重跑。
 */
function isExemptDetailsRule(line: string): boolean {
  // 🔴 **逐字相等,不是子字串**:`.icard > summary::-webkit-details-marker**.x**` 也「包含」豁免項,
  //    而它已經是**另一條選擇器**了。檔頭逐字寫著「逐字選擇器,不用萬用字元」——
  //    **宣稱與實作不一致時,寬的那一邊沒有東西會紅。**
  const selector = line.split('{')[0]!.trim();
  return ALLOWED_DETAILS_RULES.includes(selector);
}


describe('具名豁免本身要有判別力', () => {
  // 🔴🔴 **這一格是【那條機械數法自己的守門】(主視窗 2026-08-19 要求驗它會不會說話)。**
  //
  // ⚠️ **我原本只把數法寫成一行註解** —— 而主視窗當場問:「大於 1 的時候真的會有人看到嗎?
  //    還是它只是一行註解?」我去驗了:**長出第四個複本 ⇒ 數法回 2(正確)、而測試 6 格全綠。**
  //    ⇒ 🔴 **那條數法【沒有任何東西會跑它】** —— 它是一句話,不是一道門。
  //    📌 **同一天同族第六次,而這次是【我為了修前五次而留的那個東西】自己沒有守門。**
  //       ⇒ 這一格就是把它從「一句話」變成「會紅的東西」。
  //
  // ⚠️⚠️ **本格的射程,寫準(`W6-034` nit)——【它數的是一種寫法,不是一個概念】。**
  //   W6 實跑五個形狀:
  //   ```
  //   ✅ 數得到  A  .some(a => l.includes(a))                  ← 正是上一次真的發生的那一種
  //   🔴 數不到  B  for (const a of ALLOWED_DETAILS_RULES) {…}  ← 而這是【下一次最自然的那一種】
  //   🔴 數不到  C  .find(…)   D  先複製到區域變數   E  直接硬寫那條選擇器
  //   ```
  //   ⇒ **它擋得住【上一次發生的形狀】,擋不住【下一次最可能的形狀】。**
  //
  // 🔴 **而為什麼【不去追】那個開放集合 —— 這句要留,否則下一個人會以為只是沒人想到**:
  //   W6 去驗過替代品了:「改成數識別字 `ALLOWED_DETAILS_RULES`」**不是 drop-in** ——
  //   剝註解後今天就回 **4**,而四個裡**三個是合法的**(宣告 / 函式內那一份 / 本格自己的 regex 字面 /
  //   另一格合法的 `for…of`)⇒ **「有幾份複本」是【語意問題】,數字面答不了。**
  //   ⇒ 套本檔自己剛接受的那帖藥:**一個誠實的窄守門,勝過一個宣稱寬的假守門。**
  it('🔴 上一次那個複本形狀(`.some` / `.includes`)不得再出現(**不是**「只准有一份比對法」)', () => {
    const src = readFileSync(fileURLToPath(new URL('./audit-detail-css.test.ts', import.meta.url)), 'utf8');
    // 只數【真的在跑比對】的那種寫法;本 describe 自己的字面不算(它在字串裡,不是呼叫)。
    // 🔴 只數 `.some(` / `.includes(` 這一種寫法 —— 見上面的射程說明,**其餘四種它看不到**。
    const 複本數 = (src.match(/ALLOWED_DETAILS_RULES\.(some|includes)\(/g) ?? []).length;
    // 正向對照:真的數得到東西(回 0 代表我的 pattern 壞了,不代表「沒有複本」)
    expect(複本數).toBeGreaterThan(0);
    expect({ 這個形狀的份數: 複本數 }).toEqual({ 這個形狀的份數: 1 });
  });

  // 🔴🔴 **這一格是把一發【真的抓到東西的突變】留下來,而不是只寫進回報。**
  //    2026-08-19 W1 驗豁免時發現:比對法是 `line.includes(allowed)` ——【子字串】不是逐字
  //    ⇒ 把被豁免那條改成 `.icard > summary::-webkit-details-marker**.x**`,
  //      它仍然「包含」豁免項 ⇒ **照樣被放過,而那已經是另一條選擇器了。**
  //    ⇒ 而檔頭逐字寫著「**逐字選擇器,不用萬用字元**」⇒ **宣稱與實作不一致,而寬的那一邊沒有東西會紅。**
  // 📌 **留成測試的理由(主視窗 2026-08-19 指示)**:下一個人把比對法改回 `includes` 時,
  //    **不留這一格就一樣沒有東西會紅** —— 而那正是這整格守門在防的那件事。
  it('🔴🔴 豁免必須【逐字相等】—— 在豁免項後面多一個字,不得被放過', () => {
    const 原本那條 = '.icard > summary::-webkit-details-marker { display: none }';
    const 動過手腳 = '.icard > summary::-webkit-details-marker.x { display: none }';
    // 🔴 **兩格都吃 `isExemptDetailsRule`** —— 那是主斷言用的【同一支】函式
    //    ⇒ 有人把它改回子字串比對,這一格會紅。(上一版測的是常數陣列 ⇒ 改了也不會紅。)
    // 正向對照:原本那條【要】被放過(否則下面那條在「什麼都不放過」時也會綠)
    expect({ 原本那條被放過: isExemptDetailsRule(原本那條) }).toEqual({ 原本那條被放過: true });
    expect({ 動過手腳被放過: isExemptDetailsRule(動過手腳) }).toEqual({ 動過手腳被放過: false });
  });

  it('🔴 豁免是【逐字比對】,不是子字串或萬用字元', () => {
    // 若哪天有人把豁免改成 `.icard` 之類的前綴,整族 `.icard details {...}` 都會被放過。
    // 這一格釘住:豁免項必須是完整選擇器(含 `::` 那一段)。
    for (const rule of ALLOWED_DETAILS_RULES) {
      expect(rule).toContain('::');
      expect(rule.length).toBeGreaterThan(20);
    }
  });
});

// 🔴🔴 **這一組的標題改過(`W6-032` M2),而改的是【宣稱】不是【判準】。**
//
// 原標題:「**收合行為不得被 globals.css 蓋掉**」—— 那是一句關於**結果**的話。
// 而這把尺量的是**字面**:`/\bdetails\b/`。兩者不是同一件事,而 W6 構造出兩條繞法證明了:
// ```
// 🔴 放過  summary + * { display: block }
// 🔴 放過  .icard > *:not(summary) { display: block }
// ```
// **第二條就是本檔對照組自己舉的「真正會蓋掉收合行為的那一種」(`details > *:not(summary)`)——
//   把 `details` 換成 `.icard`,同一個攻擊就隱形了。**
//
// ⇒ **為什麼不放寬觸發條件(甲案,已否決)**:那要列舉「所有會蓋掉收合的寫法」= **開放集合,做不完**。
// ⇒ **改成把標題與檔頭寫成這把尺【真正做得到】的那句(乙案)** ——
//    理由是我們自己立的那條:**不要讓人以為裝了就守住了。**
//    **一個誠實的窄守門,勝過一個宣稱寬的假守門。**
// ⚠️ **公平話(W6 標的)**:這不是本片造成的,是**既有射程** —— 本片只是讓它變重要。
// 📎 已立 backlog:要真的守「收合行為」需要別的機制(例如渲染後量 `<details>` 的實際行為),不是字面掃描。
describe('globals.css 不得出現【未具名豁免的 `details` 字面規則】(字面掃描,非行為保證)', () => {
  it('🔴 globals.css 不得有任何【未具名豁免的】details 相關規則', () => {
    // ⚠️ **本格看得到什麼**:含 `details` 這個**字面**的行。
    //    **看不到什麼**:任何不含那個字、而仍然會蓋掉收合行為的寫法
    //    (例如 `summary + *` / `.icard > *:not(summary)`)⇒ **那兩種本格【放過】,已知且已立案。**
    const hits = GLOBALS_CSS.split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /\bdetails\b/.test(line))
      // 🔴🔴 **放過的條件:那一行【去掉宣告區塊之後】必須【完全等於】豁免項。**
      //
      // ⚠️ **上一版寫 `line.includes(allowed)`,而那是【子字串】不是逐字**(W1 2026-08-19 突變抓到):
      //    把被豁免那條改成 `.icard > summary::-webkit-details-marker**.x**` ⇒ 它仍然「包含」豁免項
      //    ⇒ **照樣被放過**,而那已經是**另一條選擇器**了。
      //    ⇒ 🔴 **豁免比它自己宣稱的寬** —— 而檔頭那句逐字寫著「**逐字選擇器,不用萬用字元**」
      //      ⇒ **宣稱與實作不一致,而寬的那一邊沒有東西會紅。**
      //    📌 同一天同一族的第 N 次:**一個為了收窄而寫的東西,自己用了一個會放寬的比對法。**
      .filter(([, line]) => !isExemptDetailsRule(line));
    // 失敗訊息帶出行號與原文 —— 紅的時候要看得出「是哪一行」,不是只知道紅了。
    expect(hits.map(([n, line]) => `${n}: ${line.trim()}`)).toEqual([]);
  });

  it('🔴🔴 廣度沒有因為豁免而變小:【任何別的含 `details` 字面的】規則仍然抓得到', () => {
    // 這一格是豁免的對照組 —— 沒有它,豁免可能悄悄把整條規則放寬而沒有人發現。
    const fakeCss = [
      '.icard > summary::-webkit-details-marker { display: none }', // 已豁免 ⇒ 不該命中
      'details > *:not(summary) { display: block }', // 🔴 真正會蓋掉收合行為的那一種
    ].join('\n');
    const hits = fakeCss
      .split('\n')
      .filter((line) => /\bdetails\b/.test(line))
      // 🔴🔴 **這一行原本是【第三份】比對法的複本(`W6-032` M1)** ——
      //    有人把 `isExemptDetailsRule` 改回子字串,判別力那格會紅,
      //    **而這一格永遠不知道:它跑的是自己那份複本。**
      //    📌 它就出現在我逐字寫下「**我的守門量的是它旁邊那個東西**」的 20 行之下 ——
      //       **我自己的判別句這次也還是滑過去了。**
      .filter((line) => !isExemptDetailsRule(line));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('display: block');
  });
});
});
