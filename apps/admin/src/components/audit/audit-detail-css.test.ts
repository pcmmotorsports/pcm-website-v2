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

  it('🔴 globals.css 不得有任何 details 相關規則', () => {
    const hits = GLOBALS_CSS.split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /\bdetails\b/.test(line));
    // 失敗訊息帶出行號與原文 —— 紅的時候要看得出「是哪一行」,不是只知道紅了。
    expect(hits.map(([n, line]) => `${n}: ${line.trim()}`)).toEqual([]);
  });
});
