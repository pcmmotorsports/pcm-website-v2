import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// sidebar-inset-min-width.test.ts — 守住「訂單面板被往右推」那個 bug 的修法還在。
//
// 🔴🔴 **先讀這段,它決定你能不能信這支測試**:
//    **本檔是【字面守門】。它守的是「`layout.tsx` 那行字還在」,不是「版面沒有破」。**
//    把 `min-w-0` 拿掉 ⇒ 本檔會紅 ✅
//    但如果哪天有人用**別的方式**把同一個版面弄破(改側欄軌道、改面板 max-width、
//    在中間插一層新的 flex),**本檔會全綠而畫面是壞的。**
//
// 🔴 **為什麼不寫成真的版面測試**:這個 bug 在 jsdom 裡**不存在** ——
//    jsdom 不做版面計算,`scrollWidth` 恆等於 `clientWidth`,兩個世界印同一個值 = 零判別力。
//    要真的守它需要**真瀏覽器**,而 `apps/admin` 現在沒有任何瀏覽器測試設定:
//      `find . -maxdepth 3 -name 'playwright.config.*'` ⇒ 只有 `apps/storefront/`
//      `ls -d apps/*/e2e` ⇒ 只有 `apps/storefront/e2e`
//    ⇒ 那要新蓋一套,成本由主視窗決定,**不在本片範圍**(2026-08-21 已報,等裁示)。
//
// 📎 病灶、三個突變世界與實測值:`~/pcm-mailbox/A-bc-004-診斷-訂單面板被往右推-20260821.md`
//    一句話:`SidebarInset` 是 flex item 帶 `w-full flex-1`,而 flex item 預設
//    `min-width:auto` ⇒ 撐不下時它不縮,整條 row 連同訂單面板被推出視窗,
//    推出去的量恰好等於左側欄軌道寬(84 ⇒ 84 / 124 ⇒ 124 / 1 ⇒ 1,三點全中)。

const LAYOUT = readFileSync(resolve(__dirname, 'layout.tsx'), 'utf8');

/** 剝掉註解 —— 否則「有人在註解裡提到 min-w-0」會把這把尺推歪(2026-08-21 MF-1 的同一個病)。 */
const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX 註解
    .replace(/\/\*[\s\S]*?\*\//g, '') // 一般 TS 區塊註解(今天檔裡沒有,補上免得下次漏)
    .replace(/\/\/[^\n]*/g, ''); // 行註解

describe('SidebarInset 的 min-w-0(面板被往右推的修法)', () => {
  it('🔴 `<SidebarInset>` 帶著 `min-w-0` —— 拿掉會紅', () => {
    const code = stripComments(LAYOUT);
    const m = /<SidebarInset\b([^>]*)>/.exec(code);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('min-w-0');
  });

  // 🔴 本格是**這把尺自己的雙向表演**,而它在第一次跑就抓到我自己:
  //    我原本把 regex 套在【沒剝註解】的原文上,而上面那段註解裡就寫著 `<SidebarInset>`
  //    ⇒ 尺量到的是註解那一個,不是真的那一個。**跟 MF-1 是同一個病,同一天犯第二次。**
  // 🔴🔴 **本格第一版是【恆真格】,被審查線 R2-1 擊破** ——
  //    我把假註解 `{/* min-w-0 */}` 接在**字串尾端**,而下一行的 regex 取的是**第一個**
  //    `<SidebarInset…>` ⇒ **那個假註解永遠不在尺的路徑上** ⇒ 把 `stripComments` 換成
  //    identity 也照樣綠(兩個世界同一個答案)。
  //    ⇒ **修法:假註解必須插在第一個使用點【之前】。**
  //    📌 而這件事的形狀值得記:**我抓到了自己一次(尺量到註解),
  //       而我為那件事寫的修法本身沒有被表演過。抓到病 ≠ 驗過藥。**
  // 🔴🔴 **本格改寫兩次,兩次都是被【表演】打掉的,過程留著**:
  //    v1 把假註解接在字串**尾端**,而 regex 取**第一個**使用點 ⇒ 假註解永遠不在尺的路徑上
  //       ⇒ `stripComments` 換成 identity 也照樣綠。(審查線 R2-1 擊破)
  //    v2 改成插在使用點【之前】,**還是綠** —— 因為本檔上方的說明註解裡本來就有一個
  //       `<SidebarInset>`,identity 世界下它排在更前面、而它沒有屬性 ⇒ 尺仍然看不到差別。
  //    ⇒ v3(本格):**不繞 `LAYOUT`,直接對那把剝除器餵一個兩個世界會給不同答案的最小輸入。**
  //    📌 教訓:**抓到病 ≠ 驗過藥**,而且**藥也要表演兩次才知道它是不是又中了同一個病**。
  it('🔴 剝除器本身有判別力:`min-w-0` 只寫在註解裡時,尺不得看見它', () => {
    const sample = "{/* <SidebarInset className='min-w-0'> */}\n<SidebarInset>";
    const m = /<SidebarInset\b([^>]*)>/.exec(stripComments(sample));
    expect(m).not.toBeNull();
    // 剝乾淨 ⇒ 抓到的是真的那個(沒有屬性);沒剝 ⇒ 抓到註解那個(帶 min-w-0)⇒ 本格紅
    expect(m![1]).not.toContain('min-w-0');
  });

  it('🔴 剝除器要剝三種註解(JSX / TS 區塊 / 行)—— 少剝一種就會被那一種騙', () => {
    expect(stripComments('{/* min-w-0 */}x')).toBe('x');
    expect(stripComments('/* min-w-0 */x')).toBe('x');
    expect(stripComments('// min-w-0\nx')).toBe('\nx');
  });

  it('⚠️ 只有一個 `<SidebarInset>` 使用點 —— 多出第二個要各自帶,本尺量不到那個', () => {
    expect((stripComments(LAYOUT).match(/<SidebarInset\b/g) ?? []).length).toBe(1);
  });
});
