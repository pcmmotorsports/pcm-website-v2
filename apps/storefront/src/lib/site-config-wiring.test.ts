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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
