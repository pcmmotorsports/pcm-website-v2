// auth-reset.test.ts — /login/forgot、/login/reset 的文字層守門(忘記密碼接線片;2026-08-08)
//
// 本區塊是**逐字直接搬** OD `pcm-auth.css` :84-197(接上時 `diff` 驗過 byte-identical)。
// 既然是直接搬,守門的價值就不在「樣式好不好看」,而在**擋住未來有人把稿的決定改掉而沒人發現**。
//
// 🔴 **挑斷言的判準**:只釘「改了不會有任何東西變紅」的字面。所以刻意**不釘**:
//    padding / margin / font-size 這些純觀感值(改了是設計題、該由 Sean 肉眼驗,不是回歸)。
//    釘的是三類:①稿明講「刻意不那樣做」的決定 ②a11y 觸控下限 ③兩個值互相咬合的耦合。
//
// ⚠️ **它擋不住什麼**:cascade 實際勝負、渲染尺寸、真瀏覽器長相。
//    本 worktree 無 DB,`/login/forgot` 可渲染但 `/login/reset` 的三態需要 recovery session
//    ⇒ **狀態 A/C 沒有真瀏覽器證據**,那是本片最大的驗證缺口,已寫進 STOP 交 Sean 肉眼驗。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const AUTH = strip(read('auth.css'));

/** 切出某選擇器的第一個 `{...}` 內容。找不到就讓測試紅在「選擇器不見了」而不是靜默通過。
 *  🔴 **anchor 必須含行首換行**:`.auth-icon-ok, .auth-icon-warn { … }` 這種共用宣告會讓
 *  裸 `indexOf('.auth-icon-warn {')` 命中那條共用的、而不是它自己那行 ——
 *  本檔第一版就是這樣紅的(紅的是測試不是 CSS)。加 `\n` 把 anchor 釘在行首。 */
function block(label: string, selector: string): string {
  const i = AUTH.indexOf(`\n${selector}`);
  expect(i, `${label}:auth.css 找不到行首選擇器 ${selector}`).toBeGreaterThan(-1);
  const open = AUTH.indexOf('{', i);
  const close = AUTH.indexOf('}', open);
  expect(close, `${label}:${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  return AUTH.slice(open + 1, close);
}

/** 從忘記密碼區塊起點切到檔尾 —— 用來做「整段內不得出現某東西」這種面層斷言。 */
function forgotSection(): string {
  const at = AUTH.indexOf('.auth-back');
  expect(at, '找不到忘記密碼區塊起點 .auth-back').toBeGreaterThan(-1);
  return AUTH.slice(at);
}

describe('忘記密碼 CSS · 稿明講「刻意不那樣做」的兩個決定', () => {
  // 稿逐字:「刻意**不用左側色條 callout**(全站避開的罐頭樣式),用細線分隔 + 方點,
  //          份量剛好是『順帶說明』。」
  // 🔴 這條最容易被「順手改成 callout 比較醒目」弄掉,而且改掉不會有任何東西變紅。
  it('🔴 .auth-steps 是上下細線 + 方點,不得變成左側色條 callout', () => {
    const steps = block('auth-steps', '.auth-steps {');
    const li = block('auth-steps li', '.auth-steps li {');
    expect(steps, '.auth-steps 應以 border-top 起頭').toMatch(/border-top:\s*1px solid var\(--c-border\)/);
    expect(li, '.auth-steps li 應以 border-bottom 分隔').toMatch(/border-bottom:\s*1px solid var\(--c-border\)/);
    // 負向:callout 的特徵是左邊一條粗色條
    expect(steps, '.auth-steps 不得出現 border-left(那就變成 callout 了)').not.toMatch(/border-left/);
    expect(li, '.auth-steps li 不得出現 border-left').not.toMatch(/border-left/);
  });

  // 稿逐字:「刻意不做漸層彩條 —— 那個看起來像遊戲血條,而且顏色會讓人以為『黃色=不安全』,
  //          實際上 8 碼就已經通過規則了。」
  it('🔴 密碼強度是三段實心格,整段不得出現 gradient', () => {
    const bar = block('auth-meter-bar', '.auth-meter-bar {');
    expect(bar, '強度格應為純色背景').toMatch(/background:\s*var\(--c-border\)/);
    expect(forgotSection(), '忘記密碼整段不得出現任何 gradient(稿明確拒絕漸層彩條)')
      .not.toMatch(/gradient/i);
  });
});

describe('忘記密碼 CSS · a11y 觸控下限(改小了不會有東西變紅)', () => {
  it('🔴 .auth-back 與 .auth-eye 的觸控目標不得小於 44px', () => {
    expect(block('auth-back', '.auth-back {'), '.auth-back 應有 min-height: 44px')
      .toMatch(/min-height:\s*44px/);
    const eye = block('auth-eye', '.auth-eye {');
    expect(eye, '.auth-eye 應為 44x44').toMatch(/width:\s*44px/);
    expect(eye, '.auth-eye 應為 44x44').toMatch(/height:\s*44px/);
  });

  // 眼睛鈕是絕對定位疊在 input 上;input 右內距若小於眼睛寬度,長密碼會被鈕蓋住。
  // 這兩個值是**互相咬合**的,分開看都「正常」,所以要一起釘。
  it('🔴 密碼欄右內距(46px)必須 ≥ 眼睛鈕寬度(44px),否則文字會被鈕蓋住', () => {
    const wrapInput = block('auth-input-wrap input', '.auth-input-wrap input {');
    const padRight = /padding-right:\s*(\d+)px/.exec(wrapInput)?.[1];
    const eyeWidth = /width:\s*(\d+)px/.exec(block('auth-eye', '.auth-eye {'))?.[1];
    expect(padRight, '.auth-input-wrap input 抓不到 padding-right').not.toBeUndefined();
    expect(eyeWidth, '.auth-eye 抓不到 width').not.toBeUndefined();
    expect(Number(padRight)).toBeGreaterThanOrEqual(Number(eyeWidth));
  });
});

describe('忘記密碼 CSS · 成功/失敗兩種結果卡必須分得出來', () => {
  // 兩張結果卡共用同一組尺寸規則,只有底色不同。若有人把 warn 也改成墨色,
  // 「連結失效」與「密碼改好了」會長得一模一樣 —— 而文字層沒有任何東西會紅。
  it('🔴 .auth-icon-ok 是墨色、.auth-icon-warn 是紅色,兩者不得同色', () => {
    const ok = block('auth-icon-ok', '.auth-icon-ok   {');
    const warn = block('auth-icon-warn', '.auth-icon-warn {');
    expect(ok, 'ok 圖示應為墨色').toMatch(/background:\s*var\(--c-text\)/);
    expect(warn, 'warn 圖示應為紅色').toMatch(/background:\s*var\(--c-red-dark\)/);
    expect(ok.trim(), 'ok 與 warn 不得同色(否則兩張結果卡分不出來)').not.toEqual(warn.trim());
  });

  // 強度「太短」是唯一一個要用紅色示警的層級;改掉了客人就不知道密碼不合格。
  it('🔴 強度 level=1(太短)必須是紅色,格子與文字都要', () => {
    expect(AUTH, 'level=1 的格子應為紅色')
      .toMatch(/\.auth-meter\[data-level="1"\]\s*\.auth-meter-bar\.is-on\s*\{\s*background:\s*var\(--c-red-dark\)/);
    expect(AUTH, 'level=1 的文字應為紅色')
      .toMatch(/\.auth-meter\[data-level="1"\]\s*\.auth-meter-t\s*\{\s*color:\s*var\(--c-red-dark\)/);
  });
});

describe('忘記密碼 CSS · 用 <a> 當主鈕要補回排版', () => {
  // 狀態 B/C 的主要動作是導頁,所以用 <a> 而非 <button>。
  // `.auth-submit` 是為 <button> 寫的(button 預設置中),<a> 不會 ⇒ 少了這條字會靠左。
  it('🔴 .auth-submit-link 必須自己補 flex 置中(<a> 不繼承 button 的置中)', () => {
    const linkBtn = block('auth-submit-link', '.auth-submit-link {');
    expect(linkBtn).toMatch(/display:\s*flex/);
    expect(linkBtn).toMatch(/align-items:\s*center/);
    expect(linkBtn).toMatch(/justify-content:\s*center/);
  });
});
