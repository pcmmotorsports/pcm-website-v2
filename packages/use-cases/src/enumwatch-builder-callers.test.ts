import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ⟦b9-ENUMWATCH⟧ 2026-09-06 —— **型別擋不到的那一格, 由這把尺擋。**
 *
 * 🔬 **它為什麼存在(codex R1 must-fix ②)**:`buildAnomalyAlertMessage` 尾端的 `enumWatch`
 *   參數**有預設值**, 而本檔其他參數逐字寫著「刻意沒有預設值 —— 漏傳就當場 typecheck 紅」。
 *   ⛔ 我第一版的理由(「中間插參數會插錯位置」)**被 codex 打掉而它是對的** ——
 *     那是**加在最後面**的參數, 沒有錯位風險。
 *   ⚠️ 而我真的改成必填之後撞到第二件事:77 個呼叫點要補, 我寫的括號計數**被字串裡的括號騙了**
 *     ⇒ 插錯位置 ⇒ **189 個語法錯**(實測)⇒ 還原。
 * ⇒ ✅ **所以最終形狀是:型別留預設值, 而 codex 真正的疑慮由這把尺接。**
 *
 * 🛑 **它擋什麼、不擋什麼(先寫, 免得下一個人以為型別守住了)**:
 * · ✅ 擋 **production 碼**裡漏傳 —— 未來有人加第二個呼叫端而忘了傳, 這一格紅。
 * · ⛔ **不擋測試碼**裡漏傳 —— 那是刻意的:測試漏傳只會少一句話, 而它們測的不是這一格。
 * · ⛔ 它是**字面**尺:有人把呼叫寫成 `const f = buildAnomalyAlertMessage; f(...)` 它看不到。
 *   ⇒ 📌 那不是理論上的漏洞而是**真的漏洞**, 寫在這裡而不假裝守住了。
 */
describe('⟦b9-ENUMWATCH⟧ production 呼叫端必須傳 enumWatch', () => {
  const SRC = resolve(__dirname, 'check-anomaly-alerts.ts');
  const src = readFileSync(SRC, 'utf8');

  it('🔴 每一個 production 呼叫都帶 enumWatch', () => {
    // 呼叫點 = `buildAnomalyAlertMessage(` 而**前面不是 `export function`**(那是定義)。
    const calls = [...src.matchAll(/buildAnomalyAlertMessage\(/g)].filter(
      (m) => !src.slice(Math.max(0, m.index - 20), m.index).includes('function '),
    );
    expect(calls.length, '🟢 正對照:要找得到呼叫點, 否則這把尺在對空氣說話').toBeGreaterThan(0);

    // 每個呼叫點往後 3,000 字內要出現 `enumWatch` 或 `high:`(production 那顆傳的是物件字面)。
    for (const m of calls) {
      const window = src.slice(m.index, m.index + 3000);
      expect(
        /enumWatch|high:\s*manualCustomerSearchHighForMessage/.test(window),
        `${SRC} 第 ${src.slice(0, m.index).split('\n').length} 行那個呼叫沒有傳 enumWatch ⇒ ` +
          '信裡不會說出「本信因此發出」, 而「順帶報數」與「它就是原因」長得一樣',
      ).toBe(true);
    }
  });

  it('🟢 負對照:這把尺在【找不到那個字】時真的會紅(不是恆綠)', () => {
    const fake = 'const x = buildAnomalyAlertMessage(a, b, c);';
    const calls = [...fake.matchAll(/buildAnomalyAlertMessage\(/g)];
    expect(calls.length).toBe(1);
    expect(/enumWatch|high:\s*manualCustomerSearchHighForMessage/.test(fake)).toBe(false);
  });
});
