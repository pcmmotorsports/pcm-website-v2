// site-config-wiring.test.ts —— **結構守門:SSoT 的消費端必須真的接著 SSoT。**
//
// 🔴🔴 **本片【新增】一條約束,不是繼承既有設計。措辭刻意寫死在這裡:**
//   **對外面(法律頁 / 搜尋引擎)的 SSoT 變更必須有人手動確認。**
//   **原作者沒有這樣設計** —— `lib/org-jsonld.test.ts` 與 `components/Header.test.tsx`
//   釘字面的那兩格,查過註解、docstring 與引入它們的 commit body
//   (`5d5cd8d3` / `6b308003`)**都查無「為何釘字面而不吃 SSoT」的說明**;
//   而那兩顆 commit 的自述反而偏向「單一真相」
//   (`5d5cd8d3` 逐字「`lib/site-config.ts`:商家事實單一真相」/
//    `6b308003` 逐字「底部 LINE/門市資訊全部接既有常數(無編造)」)。
//   ⇒ **這是我們的判斷,要推翻請直接推翻,不要以為在動別人的設計。**
//
// **判斷本身(主視窗 2026-08-16,未經 Sean ⇒ 是可退的裁量、不是拍板)**:
//   **法律頁與搜尋引擎的內容改動,機械上叫一聲的價值大於它造成的摩擦。**
//   **而它可逆** —— 拿掉 `org-jsonld.test.ts` / `Header.test.tsx` 那兩格字面斷言即可回到
//   「全接 SSoT、改常數零紅」的那一案。
//
// ---
//
// 🔴 **為什麼需要這一支(既有四格都抓不到的那個洞)**
//   2026-08-16 盤點 `OPENING_HOURS` 的守門,**四格形狀互不相交、交集是空的**:
//     `lib/org-jsonld.test.ts:67-68`      釘字面複本   改 SSoT ✅紅   消費端脫鉤 ❌綠
//     `components/Header.test.tsx:351`    釘字面複本   改 SSoT ✅紅   消費端脫鉤 ❌綠
//     `data/legal-content-hash.test.ts`   內容雜湊     改 SSoT ✅紅   消費端脫鉤 ❌綠
//     `components/LegalDocPage.test.tsx`  吃 SSoT      改 SSoT ❌不紅  消費端脫鉤 ❌綠
//   ⇒ **沒有一格守「渲染衍生自 SSoT」。**
//   實測(把 `MobileMenu.tsx:73` 改回硬寫、**值不變**)⇒ 相關測試 **31 passed、零紅**。
//   ⇒ **真缺口不是「漂移」是「脫鉤」** —— 值一樣、來源斷掉,而所有既有守門都看值。
//
// ⚠️ **本支守的是【接線】不是【值】** —— 值有沒有對是上面那四格的事,兩者不可互相取代。
// ⚠️ **本支會在「有人把消費端改回硬寫」時紅,不會在「改 SSoT」時紅** —— 那是刻意的分工。

/*
 * 🔴🔴 **本檔的通則(2026-08-19 `#528` 折 GR-051 時第三次付學費之後立)**
 *
 * 這支檔為「**掃描器沒剝註解**」付過三次學費,而**三次不是同一個人重複犯錯** ——
 * 是同一支檔裡【**三個不同的掃描器**】各自需要它:
 *   `:116-121` 逐欄 wiring   ⇒ 做過了(docstring 逐字「偵測字串命中了自己的輸入」)
 *   反向硬寫掃描              ⇒ **沒做**(星期字面一加進字集就假紅在 `ComingSoon.tsx:217` 的註解)
 *   新的地址守門              ⇒ **沒做**(GR-051 F1 must-fix)
 * 🔴 **做過的那一個不會幫還沒做的那一個。**
 *
 * 🔴 **判別句**:我這一發是不是【新開了一個掃描器】?是 ⇒ **它自己要剝一次**。
 * 🔴 **可機械化(這一句才是它從提醒變成機制的地方)**:
 *   **本檔新增任何 `readFileSync(...)` + 字面比對 ⇒ 檢查它有沒有經過 `stripComments()`。**
 *   量法:`grep -n 'readFileSync' <本檔>` 逐行看下一個非空白 token 是不是 `stripComments`。
 * ⚠️ 而**這條通則本身沒有守門** —— 它靠讀到的人執行。要做成機制的話,
 *   形狀是「掃本檔的 `readFileSync` 呼叫點」的 meta 測試,**還沒做**。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RPM_WARRANTY_NOTES } from '../data/rpm-policies';
import { STORE_ADDRESS } from './site-config';

const SRC = join(__dirname, '..');

/**
 * 剝掉 `//` 行註解與 `/* *\/` 區塊註解(含 JSX 的 `{/* *\/}`)。
 *
 * 🔴 **為什麼必要**:本支掃的是「這支檔有沒有【取用】某個欄位」,
 * 而**註解裡提到那個欄位**會讓它誤判成「有接」。第一版就是這樣紅的 ——
 * `HomeFooter.tsx` 的註解寫著 `OPENING_HOURS.days` 是為了說明 `#528` 的債,
 * 結果被自己的守門當成「它接了 days」。
 * ⚠️ **這支不是完整的 JS parser** —— 字串字面裡的 `//`(例如網址)會被誤剝。
 * 對本支夠用(我們只找 `OPENING_HOURS.x` 這種識別字),**別拿去做別的事**。
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * `OPENING_HOURS` 的消費端全清單(2026-08-16 實測)。
 *
 * 量法(字集寫下來,兩條都要跑):
 *   git grep -ln 'OPENING_HOURS'            -- apps/storefront/src | grep -v '\.test\.'
 *   git grep -nE '週一[-–]週六|10:00[-–]19:00' -- apps/storefront/src | grep -v '\.test\.'
 * 第二條是**反向**的:抓「該接而沒接」的硬寫殘留。只跑第一條會漏掉脫鉤的那些。
 *
 * 🔴 **新增消費端時要把它加進這張表** —— 否則新的那支脫鉤時本支零訊號。
 *    這是本支自己的已知限度,寫出來不是免責:**分母由人維護,不是機器發現的。**
 */
/**
 * 消費端 × **它各自該吃哪幾個欄位**。
 *
 * 🔴🔴 **2026-08-16 收緊:原本只驗「取用 `opens`/`closes`/`days` 任一欄」** ——
 * 那讓**只吃時段、把星期硬寫**的檔照樣通過,而那正是 `#528` 記的病:
 * 三個顯示點硬寫「週一-週六」,只有 `data/legal-content.ts` 從 `days` 推導。
 * ⇒ 那支守門會給人「**已經接上了**」的錯覺(本窗自己在 `#528` 條目裡寫下這句)。
 * **收緊成逐檔指名**:每支檔宣告它**應該**吃哪幾個欄位,少吃一個就紅。
 *
 * ✅ **2026-08-19 `#528` 修完:三個顯示點的 `days` 已改成 `true`。**
 * 推導從 `legal-content.ts` 搬到 `lib/site-config.ts` 的 `openDaysLabel(joiner)`,四個消費端共用。
 * 🔴 **`days: true` 的意思是「這支檔取用了 `days` 這個欄位」,不是「它顯示的星期是對的」** ——
 *    真的顯示對不對,靠下面那格突變(`days` 加一個 `Sunday`,四個顯示點要全部跟著變)。
 */
const CONSUMERS: readonly (readonly [
  rel: string,
  fields: { opens: boolean; closes: boolean; days: boolean },
  why: string,
])[] = [
  // 顯示點三支:2026-08-19 `#528` 修完之後**三個欄位都吃**(星期改吃 `openDaysLabel('-')`)
  [
    'components/HomeFooter.tsx',
    { opens: true, closes: true, days: true },
    '頁尾門市欄(2026-08-15 接時段、2026-08-19 #528 接星期)',
  ],
  [
    'components/ComingSoon.tsx',
    { opens: true, closes: true, days: true },
    '/coming-soon /stores /install 的頁尾(同上)',
  ],
  [
    'components/MobileMenu.tsx',
    { opens: true, closes: true, days: true },
    '手機選單門市資訊(#528 點名的那支,已接)',
  ],
  // 結構化 / 法律頁兩支:三個欄位都吃
  [
    'lib/org-jsonld.ts',
    { opens: true, closes: true, days: true },
    '🔴 schema.org openingHoursSpecification —— 餵搜尋引擎',
  ],
  [
    'data/legal-content.ts',
    { opens: true, closes: true, days: true },
    '🔴 服務條款正文的營業時間 —— 法律頁;**唯一從 days 推導中文星期的地方**',
  ],
  [
    'data/rpm-policies.ts',
    { opens: true, closes: true, days: true },
    '🔴 商品頁保固 pane + FAQ + /info/shipping 三畫面共用的政策文案末行(2026-08-19 接上;見下方分母守門)',
  ],
];

describe('SSoT 接線:`OPENING_HOURS` 的消費端必須真的接著常數', () => {
  for (const [rel, fields, why] of CONSUMERS) {
    it(`${rel} 逐欄接線正確(${why})`, () => {
      // 🔴 **先剝註解再掃** —— 第一版沒剝,基準就紅了:`HomeFooter.tsx` 的**註解裡**
      //    寫著「`OPENING_HOURS.days` 的中文推導只存在 legal-content.ts」,
      //    而那句是**我自己為了 `#528` 寫的說明** ⇒ **偵測字串命中了自己的輸入**。
      //    同族:`lib/orders/cancel-request-token.test.ts` 的 `stripComments`(admin 側同一個坑)。
      //    ⚠️ 不剝的話這支守門會把「有人寫了註解提到它」當成「有人接了它」。
      const src = stripComments(readFileSync(join(SRC, rel), 'utf8'));
      // ① 有 import(擋「整支改成硬寫、連 import 都刪掉」)
      expect(src, `${rel} 不再 import site-config —— 它脫鉤了`).toMatch(
        /import\s*\{[^}]*\bOPENING_HOURS\b[^}]*\}\s*from\s*['"]@\/lib\/site-config['"]/,
      );
      // ② 🔴 **逐欄**驗,不是「任一欄」——「任一欄」會放行只吃時段的檔(見上方 docstring)。
      for (const f of ['opens', 'closes', 'days'] as const) {
        // 🔴 `days` 這一欄有【兩種合法接法】(2026-08-19 `#528` 之後):
        //    ① 直接讀 `OPENING_HOURS.days`（`lib/org-jsonld.ts` 要的是英文原值）
        //    ② 呼叫 `openDaysLabel()`（要中文標籤的四個消費端;推導住在 site-config,吃的就是 days）
        //    🔴 **只認 ① 的話,把星期接好的檔會被判成脫鉤** —— 而那正是修好 `#528` 之後
        //       這支守門的第一個反應(本窗 2026-08-19 當場撞到,四格紅)。
        //    ⚠️ 而 `openDaysLabel` 算「接上」的前提是:它**真的**從 `OPENING_HOURS.days` 推導。
        //       那個前提由 `site-config.ts` 自己顧,不由本支驗 —— 這是本格的已知射程。
        const used =
          new RegExp(String.raw`\bOPENING_HOURS\s*\.\s*${f}\b`).test(src) ||
          (f === 'days' && /\bopenDaysLabel\s*\(/.test(src));
        if (fields[f]) {
          expect(used, `${rel} 應該吃 OPENING_HOURS.${f},但沒有 ⇒ 那一欄脫鉤了`).toBe(true);
        } else {
          // 🔴 反向:表上寫「不吃」而它其實吃了 ⇒ **表過期了**,要有人回來改表
          //    (那通常代表 #528 被修好了,是好消息 —— 但表不改的話守門會繼續放行舊狀態)。
          expect(used, `${rel} 現在吃了 OPENING_HOURS.${f} ⇒ 請更新本表(可能 #528 已修好)`).toBe(
            false,
          );
        }
      }
    });
  }

  // 🔴 反向格:沒有它,上面那組會退化成「只證存在、不證窮盡」——
  //    有人新增第六個消費端並硬寫,上面五格照樣全綠。
  //    ⚠️ 本格**不掃 `.test.` 檔**(測試裡出現字面是正常的,那是期望值)。
  it('🔴 沒有【該接而沒接】的硬寫殘留(反向:抓脫鉤,不是抓存在)', () => {
    const scanned: string[] = [];
    for (const [rel] of CONSUMERS) scanned.push(rel);
    // 這裡只掃已知消費端;全樹掃在 CI 之外由人跑(量法見上方 docstring)。
    for (const rel of scanned) {
      // 🔴 **用 stripComments 剝,不用行首 regex**(折 GR-051 F4 時當場撞到):
      //    原本的 `^\s*(//|\*|/\*)` 只認【行首】是註解標記的行,而 JSX 區塊註解
      //    `{/* … */}` 的中間行常常以內文開頭 —— `ComingSoon.tsx:217` 那行逐字含「週一-週六」
      //    ⇒ 星期字面一加進掃描字集,那行就被當成硬寫殘留、**假紅**。
      //    這與 F1(地址守門)是同一個病,而它在同一支檔裡已經被記過兩次。
      const src = stripComments(readFileSync(join(SRC, rel), 'utf8'));
      // 只看「渲染/組字」那一類殘留。
      const codeLines = src.split('\n');
      // 🔴 GR-051 F4:原本這條**只掃時段字面**,星期不在掃描字集
      //    ⇒ 有人把渲染退回硬寫「週一-週六」而只留一個沒用的 `openDaysLabel()` 呼叫,
      //      上面那組 wiring 綠、這條也綠、而釘測的期望值【自己就是】`週一-週六`
      //      ⇒ 三道全綠而畫面已經脫鉤。**把星期字面加進來**。
      const hardcoded = codeLines.filter((l) =>
        /['"`][^'"`]*10:00\s*[-–]\s*19:00/.test(l) || /週一\s*[-–]\s*週六/.test(l),
      );
      expect(hardcoded, `${rel} 有硬寫的時段或星期字面 —— 它應該吃 OPENING_HOURS`).toEqual([]);
    }
  });
});

describe('`#528` 同族:門市地址(硬寫的字面必須與 `STORE_ADDRESS` 一致)', () => {
  // 🔴 **為什麼是守門而不是改成吃 SSoT**:`HomeFooter.tsx:127-129` 逐字寫著
  //    「空格與 `<br/>` 是本頁尾的排版、不是地址的一部分,正典值本身沒有空格」。
  //    要讓那兩支直接吃 `STORE_ADDRESS`,得把 `street`(`化成路736巷18號1樓`)
  //    再拆成「路名 / 巷號」兩欄 —— 那會動到 `lib/org-jsonld.ts`(餵搜尋引擎)與法律頁,
  //    **而它們現在是對的**。⇒ 重塑 SSoT 的代價 > 這裡要防的風險。
  // 🔴🔴 **【代裁】這個取捨是 G1 判的、MAIN 2026-08-19 追認,Sean 可推翻。**
  //    (GR-051 F7:理由寫得再好,少了「誰判的、可推翻」那半句,下一個人會把它讀成既定事實。)
  //    他要真的把 `street` 拆欄位,另開一片 —— 本守門就可以退場。
  // 🔴 **這裡要防的風險只有一個**:Sean 換地址 ⇒ `STORE_ADDRESS` 改了、這兩支的硬寫沒改
  //    ⇒ 同一個站兩種地址。**去掉空白後比對**就抓得到,而畫面一個字都不用動。
  // 🔴 GR-051 F1(must-fix):**先剝註解再掃** —— `ComingSoon.tsx:217` 的註解**已經含**
  //    「新北市新莊區化成路」,現在排在 `:190` 渲染之後純屬順序運氣:
  //    註解若加在渲染上方 ⇒ 假紅;註解若引了完整地址 ⇒ **假綠而渲染已漂**。
  //    同一支檔 `:116-121` 四十行前才為同一件事付過學費(「偵測字串命中了自己的輸入」)。
  // 🔴 GR-051 F2:比對用**完整相等**不是 `startsWith` —— 前綴比對會放行
  //    「SSoT 改短成舊值的前綴」(例:拿掉「1樓」)⇒ 過期樓層無聲存活。
  // ⚠️ 它擋不住「兩邊【同時】被改錯」,也擋不住排版走樣 —— 那是別的東西的事。
  const FULL = `${STORE_ADDRESS.region}${STORE_ADDRESS.locality}${STORE_ADDRESS.street}`;

  for (const rel of ['components/HomeFooter.tsx', 'components/ComingSoon.tsx']) {
    it(`🔴 ${rel} 的門市地址字面(去空白後)必須【完整等於】STORE_ADDRESS 串接`, () => {
      const src = stripComments(readFileSync(join(SRC, rel), 'utf8'));
      const i = src.indexOf(STORE_ADDRESS.region);
      expect(
        i,
        `${rel} 剝掉註解之後找不到 ${STORE_ADDRESS.region} —— 地址是不是被改寫或搬走了?`,
      ).toBeGreaterThan(-1);
      // 取「那一段地址」:從 region 起到收尾的 `</p>` 為止(兩支都把地址包在單一 <p> 內)。
      const end = src.indexOf('</p>', i);
      expect(end, `${rel} 的地址區塊沒有收尾的 </p>`).toBeGreaterThan(i);
      const rendered = src
        .slice(i, end)
        .replace(/<br\s*\/?>/g, '')
        .replace(/[<>{}]/g, '')
        .replace(/\s+/g, '');
      expect(
        rendered,
        `${rel} 的地址字面與 STORE_ADDRESS 不一致 ——\n  期望: ${FULL}\n  實際: ${rendered}`,
      ).toBe(FULL);
    });
  }
});

/**
 * ═══ 分母守門:**沒有人維護的清單,遲早會漏一支** ═══════════════════════════
 *
 * 🔴 **為什麼加這一格(2026-08-19,`#528` 的漏網之魚)**
 * 上面 `CONSUMERS` 的註解自己寫著:「**分母由人維護,不是機器發現的**」——
 * 而它在 `#528` 收工後**真的漏了一支**:`data/rpm-policies.ts` 的末行硬寫著
 * 「週一–週六 10:00–19:00」,三個畫面在渲染它,而沒有任何東西會紅。
 *
 * 🔴🔴 **而更值得記的是:當時【已經有一條專門抓它的量法寫在註解裡】,跑起來也撈不到。**
 * 受控實驗(同一棵樹 `HEAD`、同一個檔、同一支 `git grep`、同一刻):
 * ```
 *   git grep -nE '週一–週六'    ⇒ 1 命中（就是那一行）
 *   git grep -nE '週一[-–]週六' ⇒ 0 命中
 * ```
 * 差別只有那個**中括號**。`LANG`/`LC_ALL` 皆空 ⇒ C locale ⇒ `[…]` 是**位元組**類別,
 * 而 en-dash `–`(U+2013)是 **3 個位元組** ⇒「這裡剛好一個位元組」對它永遠不成立。
 * ⇒ **寫 `[-–]` 是為了周全(半形與 en-dash 都涵蓋),而那份周全正是零命中的原因。**
 *
 * ⇒ 所以本格做兩件事,缺一不可:
 *   ① **掃全樹**、不掃清單 —— 新長出來的硬寫殘留會被撿到,不必有人記得加進 `CONSUMERS`
 *   ② **自帶負向自檢** —— 拿一個**已知存在**的字面餵同一支 pattern;撈不到 ⇒ **整格作廢**,
 *      因為那代表尺壞了,而壞尺的輸出跟「乾淨」長得一模一樣
 *
 * ⚠️ **本格是 JS `RegExp`,不是 `git grep`** —— JS 的字元類別是**字元**語意、不是位元組,
 *    所以 `[-–]` 在這裡是安全的。**那正是為什麼自檢不能省**:能不能用不該靠我記得,要靠它自己表演。
 */
describe('分母守門:營業時間字面不得出現在白名單以外的檔', () => {
  /**
   * 白名單 = SSoT 本身 + `CONSUMERS` 宣告過的每一支。
   *
   * ⚠️ **射程(GR-075 ⑤-b)**:白名單是**整檔豁免**,不是逐行豁免 ——
   * 一支檔一旦進了 `CONSUMERS`,它**檔內任何位置**再多硬寫幾處時段字面,本格都不會紅。
   * 擋那一層的是上面的**逐欄接線**格(它驗那支檔有沒有真的取用 SSoT),
   * 而「接了 SSoT **又同時**在別處硬寫一份」這個組合,**兩格都抓不到**。
   */
  const ALLOWED = new Set<string>(['lib/site-config.ts', ...CONSUMERS.map(([rel]) => rel)]);

  /**
   * 時段字面。中括號在 JS 是**字元**語意 ⇒ 位元組那個病不存在;
   * **而安不安全由下面的自檢說了算,不由這句註解說了算。**
   *
   * 🔴 **字集是三個家族,不是一個**(GR-075 MF-B):
   *   星期連接詞 = dash 家族 `-–—` **加上「至」** —— 「至」是本站**活著**的字面
   *   (`legal-content.ts` 走 `openDaysLabel('至')`),而它不在任何 dash 家族裡。
   *   時段連接詞 = 同 dash 家族;而冒號有**半形與全形**兩種。
   * ⚠️ **這仍是一個【由人列的字集】** —— 它擋得住今天已知的六種寫法,
   *   擋不住明天有人寫「週一~週六」或「上午10點到晚上7點」。**射程就到這裡。**
   */
  const DASH = '[-–—]';
  const HOURS = new RegExp(
    `週[一二三四五六日](?:${DASH}|至)週[一二三四五六日]` +
      `|\\d{2}[:：]\\d{2}\\s*(?:${DASH}|－|至)\\s*\\d{2}[:：]\\d{2}`,
  );

  /** 遞迴列出 `apps/storefront/src` 下所有非測試的 .ts/.tsx(相對 SRC 的路徑)。 */
  function walk(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(SRC, dir === '' ? '.' : dir), { withFileTypes: true })) {
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) {
        out.push(...walk(rel, rel));
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(rel);
      }
    }
    return out;
  }

  const FILES = walk('');

  it('🔴 自檢:掃描器與 pattern 兩者都要證明自己會動(不過 ⇒ 下面那格的綠不算數)', () => {
    // ① 掃得到檔:`walk()` 至少要撈到本檔隔壁那支 SSoT。
    expect(FILES, 'walk() 沒撈到 lib/site-config.ts —— 掃描器壞了,不是樹乾淨').toContain(
      'lib/site-config.ts',
    );
    // ② pattern 認得出「該紅的那幾種字面」。
    //    🔴 GR-075 MF-B:原本只有 dash 家族兩種,而**本站活著的星期連接詞是三個**——
    //       「至」在 `legal-content.ts` 走 `openDaysLabel('至')` **真的 render 出去**,
    //       而它**不在** dash 家族裡 ⇒ 有人把法律頁退回硬寫「週一至週六」,舊字集**一聲都不吭**。
    //       時段那半同理漏了**全形冒號**。
    //    📌 **我把位元組病換成字元語意(JS RegExp)是對的,而【字集窄】是另一個病** ——
    //       換了層不等於換了名。這一格就是那句話的落點。
    for (const [s, why] of [
      ['週一–週六 10:00–19:00', 'en-dash 版 —— 就是 #528 漏掉的那一種'],
      ['週一-週六', '半形 hyphen 版'],
      ['週一—週六', 'em-dash 版'],
      ['週一至週六', '🔴「至」版 —— legal-content.ts 現在就 render 它'],
      ['10:00－19:00', '全形冒號/破折的時段版'],
      ['10：00-19：00', '全形冒號的時段版'],
    ] as const) {
      expect(HOURS.test(s), `pattern 配不到「${s}」(${why})`).toBe(true);
    }
    // ③ 而它**不能**什麼都認 —— 否則每支檔都紅,綠紅一樣沒有判別力。
    expect(HOURS.test('營業時間請見門市頁'), 'pattern 太寬,連沒有時段的句子都認').toBe(false);
    // ④ 🔴 GR-075 MF-A:上面兩層各自表演了,而**主判定是三層合成**
    //    (`walk` → `readFileSync` → `stripComments` → `HOURS`)。
    //    `stripComments` **從來沒有在自檢裡表演過** —— 它若剝太多(例如把整份 code 吃掉),
    //    主掃會回空、判定會綠,而上面 ①② 照樣過。
    //    ⇒ 用 inline fixture 走**同一條管線的後兩段**,證明字面穿得過剝註解那一步。
    expect(
      HOURS.test(stripComments('const s = "週一–週六 10:00–19:00";')),
      '🔴 stripComments 把真實 code 裡的字面吃掉了 —— 主判定會恆綠,整格作廢',
    ).toBe(true);
    //    反向:註解裡的字面**必須**被剝掉(否則 `ComingSoon.tsx:217` 那種註解會假紅)。
    expect(
      HOURS.test(stripComments('// 這行註解提到 週一–週六 10:00–19:00')),
      'stripComments 沒剝掉行註解 —— 主判定會假紅在別人的說明文字上',
    ).toBe(false);
  });

  it('🔴 白名單以外的檔不得出現營業時間字面(剝掉註解後)', () => {
    const leaked = FILES.filter(
      (rel) => !ALLOWED.has(rel) && HOURS.test(stripComments(readFileSync(join(SRC, rel), 'utf8'))),
    );
    expect(
      leaked,
      `這幾支檔硬寫了營業時間,而 SSoT 改了它們不會跟著改:\n  ${leaked.join('\n  ')}\n` +
        '⇒ 要嘛改成從 `OPENING_HOURS` / `openDaysLabel()` 衍生,\n' +
        '   要嘛(確定它該獨立)把它加進上面的 `CONSUMERS` 並寫清楚為什麼。',
    ).toEqual([]);
  });
});

/**
 * ═══ `rpm-policies.ts` 末行:接上 SSoT 之後,**畫面上必須一個位元組都沒變** ═══
 *
 * 🔴 鐵則 1:本檔文案 byte-for-byte 取自 OD-8。接 SSoT 是**重構**,不是改字面。
 * ⚠️ 破折號是 **en-dash U+2013**,與三個顯示點用的半形 `-` 刻意不同 —— 沿用 OD 原字面。
 *    這一格就是釘住那個「刻意不同」:有人把它「順手統一」成半形時會紅。
 */
describe('rpm-policies 末行的營業時段(接 SSoT 之後不得漂移)', () => {
  it('🔴 渲染出來的字面必須完整等於 OD 原字面', () => {
    const last = RPM_WARRANTY_NOTES.at(-1);
    // 🔴 不是形式上的 non-null:陣列被清空(或末條被搬走)時,這一格要**紅在這裡**、
    //    而不是安靜地拿一個空字串去比對 —— 那會變成「渲染沒了也照樣紅」的模糊訊息。
    expect(last, 'RPM_WARRANTY_NOTES 是空的 —— 末條被刪掉或搬走了?').toBeDefined();
    const rendered = last!.map((r) => (typeof r === 'string' ? r : r.b)).join('');
    expect(rendered).toBe('有問題請加 LINE：@pcmmoto · 週一–週六 10:00–19:00');
  });
});

/**
 * ═══ 分母守門(第二支):**門市地址** ═══════════════════════════════════════
 *
 * 🔴 **為什麼補這一支**:上面的地址守門(`STORE_ADDRESS` 完整相等)**只掃兩支點名的檔** ——
 * 那與時段守門在 `#528` 之前的病**一模一樣**:**分母由人維護,新長出來的那支脫鉤時零訊號。**
 * 時段那一格已經在 2026-08-19 補上全樹掃描,**而地址這一格當時沒有一起補**
 * ⇒ 本段把同一個機制套過來。
 *
 * ⚠️ **今天掃出來是乾淨的**(全樹只有 SSoT 與下面白名單那兩支帶這個字面)。
 *    🔴 **而「今天乾淨」正是裝守門的時機,不是不裝的理由** ——
 *    它把「乾淨」從一個**當下的觀察**變成一個**會被維持的性質**。
 *
 * ⚠️ **射程與上面那支相同**:白名單是**整檔豁免**,不是逐行;而它只認**字面**,
 *    有人用 `'新北' + '市新莊區'` 拼出來就掃不到。
 */
describe('分母守門:門市地址字面不得出現在白名單以外的檔', () => {
  /**
   * 白名單 = SSoT 本身 + **兩支「刻意硬寫、而由上面那格釘住等值」的顯示點**。
   * 🔴 那兩支不是漏網 —— 它們硬寫,而上面的地址守門逐字比對它們與 `STORE_ADDRESS` 相等。
   *    ⇒ **這裡放行、那裡釘死**,兩格分工。
   */
  const ADDR_ALLOWED = new Set<string>([
    'lib/site-config.ts',
    'components/HomeFooter.tsx',
    'components/ComingSoon.tsx',
  ]);

  /** 地址字面。`region` / `locality` 取自 SSoT ⇒ **改常數時本格自動跟著改**,不是第二份硬寫。 */
  const ADDR = new RegExp(`${STORE_ADDRESS.region}|${STORE_ADDRESS.locality}|化成路`);

  function walkAll(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(SRC, dir === '' ? '.' : dir), { withFileTypes: true })) {
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) out.push(...walkAll(rel, rel));
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const ADDR_FILES = walkAll('');

  it('🔴 自檢:掃描器 / pattern / stripComments 三層都要表演(不過 ⇒ 下面那格的綠不算數)', () => {
    // ① 掃得到檔
    expect(ADDR_FILES, 'walkAll() 沒撈到 lib/site-config.ts —— 掃描器壞了,不是樹乾淨').toContain(
      'lib/site-config.ts',
    );
    // ② pattern 認得出該紅的字面(而它是從 SSoT 組的 ⇒ 這一發同時驗了組法沒寫錯)
    expect(ADDR.test('新北市新莊區化成路736巷18號1樓'), 'pattern 配不到完整地址').toBe(true);
    expect(ADDR.test('化成路'), 'pattern 配不到街名（只寫街名也算硬寫）').toBe(true);
    // ③ 不能什麼都認
    expect(ADDR.test('台北市信義區'), 'pattern 太寬,連別的地址都認').toBe(false);
    // ④ 🔴 `stripComments` 也要走一次同一條管線（GR-075 MF-A 的形狀，本格照抄）
    expect(
      ADDR.test(stripComments(`const s = "${STORE_ADDRESS.region}${STORE_ADDRESS.locality}";`)),
      '🔴 stripComments 把真實 code 裡的字面吃掉了 —— 主判定會恆綠,整格作廢',
    ).toBe(true);
    expect(
      ADDR.test(stripComments(`// 這行註解提到 ${STORE_ADDRESS.region}${STORE_ADDRESS.locality}`)),
      'stripComments 沒剝掉行註解 —— 主判定會假紅在別人的說明文字上',
    ).toBe(false);
  });

  it('🔴 白名單以外的檔不得出現門市地址字面(剝掉註解後)', () => {
    const leaked = ADDR_FILES.filter(
      (rel) =>
        !ADDR_ALLOWED.has(rel) && ADDR.test(stripComments(readFileSync(join(SRC, rel), 'utf8'))),
    );
    expect(
      leaked,
      `這幾支檔硬寫了門市地址,而 STORE_ADDRESS 改了它們不會跟著改:\n  ${leaked.join('\n  ')}\n` +
        '⇒ 要嘛改成從 `STORE_ADDRESS` 衍生,\n' +
        '   要嘛(確定它該硬寫)把它加進 `ADDR_ALLOWED`,**並在上面那格補一條逐字等值斷言**。',
    ).toEqual([]);
  });
});
