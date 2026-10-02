import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// button-feedback.test.ts — 守「後台全站按鈕的滑過與按下回饋」(Sean 2026-10-02;globals.css 檔尾那一段)。
// ⚠️ 量的是 CSS 原始碼, 不是瀏覽器行為。真瀏覽器的截圖在 ~/pcm-mailbox/後台全站按鈕動效-20261002/。

const css = readFileSync(resolve(__dirname, 'globals.css'), 'utf8');
const START = '/* ── 後台全站按鈕:滑過與按下的回饋';
const block = () => {
  const i = css.indexOf(START);
  expect(i, '找不到全站按鈕回饋那一段').toBeGreaterThanOrEqual(0);
  return css.slice(i).replace(/\/\*[\s\S]*?\*\//g, ' ');
};
/** 每一條規則:{選擇器, 宣告}。只切本段, 不含 @media 外殼。 */
const rules = () =>
  [...block().matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: (m[1] ?? '').trim(), body: m[2] ?? '' }));

describe('後台全站按鈕回饋', () => {
  it('滑過浮起 1px、按下縮 0.97(跟訂單動作鈕同一套)', () => {
    const r = rules();
    expect(r.some((x) => /:hover\)$/.test(x.sel) && /transform:\s*translateY\(-1px\)/.test(x.body))).toBe(true);
    expect(r.some((x) => /:active\)$/.test(x.sel) && /scale\(0\.97\)/.test(x.body))).toBe(true);
  });

  it('🔴 每一條滑過 / 按下的規則都排除停用的按鈕', () => {
    const states = rules().filter((x) => /:(hover|active)\)$/.test(x.sel));
    expect(states.length, '滑過 / 按下的規則太少 = 這一格沒在量').toBeGreaterThanOrEqual(8);
    for (const x of states) {
      // 🔴 要在 :not(…) 裡才算「排除」—— `:where(button):disabled:hover` 也含 `:disabled`, 但那是【只對停用生效】(Fable R1 nit 2)
      const excluded = /:not\(([^()]|\([^()]*\))*\)/.exec(x.sel)?.[0] ?? '';
      expect(excluded, `沒排除停用:${x.sel.slice(0, 80)}`).toContain(':disabled');
      expect(excluded, `沒排除 aria-disabled:${x.sel.slice(0, 80)}`).toContain("[aria-disabled='true']");
    }
  });

  it('🔴 減少動態效果時不位移不縮放', () => {
    const m = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(block());
    expect(m, '少了 prefers-reduced-motion 那段').not.toBeNull();
    expect(m?.[1] ?? '').toMatch(/transform:\s*none/);
    expect(m?.[1] ?? '').toMatch(/transition:\s*none/);
  });

  it('🔴 不用陰影、filter、opacity(全站無陰影,Sean 2026-08-16)', () => {
    for (const x of rules()) expect(x.body, x.sel.slice(0, 60)).not.toMatch(/box-shadow|filter|opacity/);
  });

  it('選中 / 按住的狀態鈕保持自己的底色(不被淡藍蓋掉)', () => {
    const tint = rules().filter((x) => /var\(--primary\) 6%/.test(x.body));
    expect(tint.length).toBeGreaterThan(0);
    for (const x of tint) {
      expect(x.sel).toContain("[aria-current='true']");
      expect(x.sel).toContain("[aria-pressed='true']");
      expect(x.sel).toContain('.bg-primary');
    }
  });

  it('對照組:量得出「沒有」(不是恆真)', () => {
    expect(rules().some((x) => /translateY\(-7px\)/.test(x.body))).toBe(false);
  });
});
