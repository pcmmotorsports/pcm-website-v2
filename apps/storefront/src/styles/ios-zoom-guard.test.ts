// ios-zoom-guard.test.ts — 「手機可輸入欄一律 ≥16px」那條全站防線的守門。
//
// 背景:iOS Safari 聚焦字級 <16px 的 input/select/textarea 會自動放大整頁、且不會自己復原
// (Sean 2026-08-08 手機實測回報)。根因是 `account.css` 的 16px 覆寫被寫在
// `@media (min-width: 600px) and (max-width: 1079px)` 裡 = **只涵蓋平板**,iPhone 390px 不匹配。
//
// 🔴 這支守的是「防線還在、而且還贏得了」。真正證明它有效的是**真瀏覽器實測**(3115 production build,
//    390px:/login /register /login/forgot / /products 全數 0 個 <16px 的可輸入欄;桌機 1280 維持原字級),
//    以及同 specificity 打平那幾格的注入實測(`.acc-inline-form-inner input`、`.acc-profile input`、
//    `.cft-cascade .vsc-input`、`.ed-finder-slot select`、`textarea` 全部量到 16px)。
//    CSS 測不到 cascade 結果 ⇒ 本檔釘的是**那些讓實測結論成立的前提**,前提被動就紅。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, 'ios-zoom-guard.css'), 'utf8');
const LAYOUT = readFileSync(resolve(HERE, '../app/layout.tsx'), 'utf8');
const NAKED = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('iOS 聚焦縮放防線(手機可輸入欄 ≥16px)', () => {
  it('🔴 規則掛在 max-width: 1023px,而不是又被寫成只涵蓋平板的 min-width', () => {
    expect(NAKED, '找不到 @media (max-width: 1023px) ⇒ 防線的生效範圍被改過').toMatch(
      /@media\s*\(max-width:\s*1023px\)/,
    );
    expect(
      NAKED,
      '出現 min-width ⇒ 這正是本次事故的形狀(覆寫只涵蓋平板、手機永遠吃不到)',
    ).not.toMatch(/min-width/);
  });

  it('🔴 三種可輸入元素都在,字級是 16px', () => {
    const block = /@media[^{]*\{([\s\S]*)\}/.exec(NAKED)?.[1] ?? '';
    expect(block, '找不到 @media 內容 ⇒ 下面每一條都會拿空字串去比').not.toBe('');
    expect(block, 'input 不在防線內').toMatch(/(^|[\s,])input:not/);
    expect(block, 'select 不在防線內').toMatch(/(^|[\s,])select:not/);
    expect(block, 'textarea 不在防線內').toMatch(/(^|[\s,])textarea\b/);
    const size = /font-size:\s*([0-9.]+)px/.exec(block)?.[1];
    expect(Number(size), `字級是 ${size}px,<16 就是沒防到(iOS 的門檻正好是 16)`).toBeGreaterThanOrEqual(16);
  });

  it('🔴 只排除語意上不會觸發縮放的(checkbox / radio / multiple),不得為了湊 specificity 排掉 disabled·readonly', () => {
    const excluded = [...NAKED.matchAll(/:not\(\[([^\]]+)\]\)/g)].map((m) => (m[1] ?? '').replace(/['"]/g, ''));
    expect(excluded.sort()).toEqual(["multiple", "type=checkbox", "type=radio"]);
    // readonly 欄位在 iOS 仍可聚焦、仍會放大 ⇒ 排掉它是拿正確性換 specificity
    expect(NAKED, 'readonly 被排除 ⇒ readonly 欄仍可聚焦、仍會放大').not.toMatch(/:not\(\[readonly/);
    expect(NAKED, 'disabled 被排除 ⇒ 純粹為了湊分數,語意上站不住').not.toMatch(/:not\(\[disabled/);
  });

  it('🔴🔴 本檔必須是 layout.tsx 最後一支樣式 import(整條防線靠 source order 取勝)', () => {
    const imports = [...LAYOUT.matchAll(/^import\s+'\.\.\/styles\/([\w.-]+\.css)';/gm)].map((m) => m[1]);
    expect(imports.length, '抓不到任何 styles import ⇒ 本條前提失效(import 寫法被改過?)').toBeGreaterThan(5);
    expect(
      imports[imports.length - 1],
      `最後一支是 ${imports[imports.length - 1]} 而不是 ios-zoom-guard.css ⇒ 被插隊後同 specificity 的那幾格(.acc-inline-form-inner input / .ed-finder-slot select)會輸回去,而且畫面不會報任何錯`,
    ).toBe('ios-zoom-guard.css');
  });

  it('🔴 不靠 !important(留給個別欄位用更高 specificity 蓋回去的空間)', () => {
    expect(NAKED, '改用 !important ⇒ 之後任何要放大某一欄的需求都得跟它打架').not.toMatch(/!important/);
  });
});
