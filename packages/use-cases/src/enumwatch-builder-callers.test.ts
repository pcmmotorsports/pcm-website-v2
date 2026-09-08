import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ⟦b9-ENUMWATCH⟧ + ⟦b4-FITSYNC1⟧③ —— **型別擋不到的那一格, 由這把尺擋。**
 *
 * 🔬 **它為什麼存在(codex R1 must-fix ②)**:`buildAnomalyAlertMessage` 尾端的 `enumWatch`
 *   參數**有預設值**, 而本檔其他參數逐字寫著「刻意沒有預設值 —— 漏傳就當場 typecheck 紅」。
 *   ⛔ 我第一版的理由(「中間插參數會插錯位置」)**被 codex 打掉而它是對的** ——
 *     那是**加在最後面**的參數, 沒有錯位風險。
 *   ⚠️ 而我真的改成必填之後撞到第二件事:77 個呼叫點要補, 我寫的括號計數**被字串裡的括號騙了**
 *     ⇒ 插錯位置 ⇒ **189 個語法錯**(實測)⇒ 還原。
 * ⇒ ✅ **所以最終形狀是:型別留預設值, 而 codex 真正的疑慮由這把尺接。**
 *
 * 🔴🔴 **[codex R3 must-fix:這把尺【自己是假綠的】—— 而它是其餘六條的驗證所依賴的那道閘]**
 *   ⛔ 舊版做法 = 從呼叫點往後取 **3,000 字**, 在那個窗裡找 `fitmentSync` 這個字。
 *   🛑 而那個窗**大到會撈到別人的東西**, 三個世界各自讓它假綠:
 *   ```
 *   ① 漏傳的呼叫後面 100 字有一句【註解】提到 fitmentSync ⇒ 命中 ⇒ 綠
 *   ② 漏傳的呼叫後面有【另一個正確的呼叫】⇒ 命中 ⇒ 綠
 *   ③ 🔴 而它【當時就已經在發生】:本檔 :952 是一句【註解】, 裡面逐字寫著
 *      `buildAnomalyAlertMessage(` ⇒ 那一句被這把尺當成【一個呼叫點】,
 *      而同一段註解裡當然提到 enumWatch ⇒ 它自己讓自己綠。
 *   ```
 *   🎯 ⇒ 病灶是**窗的邊界不是語法邊界** ⇒ ✅ 改成:先把註解與字串內容遮成空白,
 *      再用**括號配對**取出【那一個呼叫自己的引數文字】。窗 = 引數本身, 不多一個字。
 *   📌 對照 memory `feedback_comments-read-as-code-by-grep`(註解被 grep 當成碼)——
 *      **同一個病的第五次, 而這一次的受詞是【我自己補的那道閘】。**
 *
 * 🛑 **它擋什麼、不擋什麼(先寫, 免得下一個人以為型別守住了)**:
 * · ✅ 擋 **production 碼**裡漏傳 —— 未來有人加第二個呼叫端而忘了傳, 這一格紅。
 * · ⛔ **不擋測試碼**裡漏傳 —— 那是刻意的:測試漏傳只會少一句話, 而它們測的不是這一格。
 * · ⛔ 它是**字面**尺:有人把呼叫寫成 `const f = buildAnomalyAlertMessage; f(...)` 它看不到。
 *   ⇒ 📌 那不是理論上的漏洞而是**真的漏洞**, 寫在這裡而不假裝守住了。
 */

/**
 * 把註解與字串/樣板字面的**內容**換成等長空白(引號與括號結構保留)。
 * 🔴 **換成空白而不是刪掉** —— 刪掉會讓後面每一個 index 位移, 而錯誤訊息要報行號。
 * ⚠️ **射程**:本檔沒有 regex literal(2026-09-08 實測 grep 0 命中);真的出現一個帶單邊
 *   括號的 regex 時, 下面 `extractArgs` 的**括號不平衡**會當場丟例外 ⇒ 它會出聲, 不會靜默錯。
 */
function maskCommentsAndStrings(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const quote = src[i]!;
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === quote) break;
        k++;
      }
      blank(i + 1, k);
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/**
 * 從 `name(` 的**左括號**位置起, 回傳那一對括號之間的文字(用配對計數, 不用固定字數)。
 * 🛑 呼叫端必須餵**已遮罩**的原始碼 —— 否則字串裡的括號會把配對算歪
 *   (那正是 2026-09-06 那 189 個語法錯的成因)。
 */
function extractArgs(masked: string, openParenIdx: number): string {
  let depth = 0;
  for (let k = openParenIdx; k < masked.length; k++) {
    if (masked[k] === '(') depth++;
    else if (masked[k] === ')') {
      depth--;
      if (depth === 0) return masked.slice(openParenIdx + 1, k);
    }
  }
  throw new Error(`括號不平衡:第 ${openParenIdx} 字元起的呼叫沒有收尾 ⇒ 遮罩器對這份原始碼失效`);
}

/** 回傳每一個 production 呼叫點的 `{ line, args }`(定義本身與註解裡的字面都不算)。 */
function productionCallSites(src: string): { line: number; args: string }[] {
  const masked = maskCommentsAndStrings(src);
  const sites: { line: number; args: string }[] = [];
  for (const m of masked.matchAll(/buildAnomalyAlertMessage\s*\(/g)) {
    const idx = m.index!;
    const before = masked.slice(Math.max(0, idx - 20), idx);
    if (before.includes('function ')) continue;
    const open = masked.indexOf('(', idx);
    sites.push({
      line: src.slice(0, idx).split('\n').length,
      args: extractArgs(masked, open),
    });
  }
  return sites;
}

describe('⟦b9-ENUMWATCH⟧ + ⟦b4-FITSYNC1⟧③ production 呼叫端必須傳兩個有預設值的參數', () => {
  const SRC = resolve(__dirname, 'check-anomaly-alerts.ts');
  const src = readFileSync(SRC, 'utf8');

  it('🟢 正對照:遮罩後找得到呼叫點, 而【註解裡那一個不算】', () => {
    const sites = productionCallSites(src);
    expect(sites.length, '找不到呼叫點 ⇒ 這把尺在對空氣說話').toBeGreaterThan(0);
    // 🔴 :952 是一句註解, 逐字含 `buildAnomalyAlertMessage(`。遮罩前它會被算成呼叫點。
    //    這一格就是**那個修法的正對照** —— 遮罩失效的話, 它會回來。
    expect(
      sites.some((s) => s.line === 952),
      '註解行 :952 被算成呼叫點 ⇒ 遮罩沒生效 ⇒ 這把尺會被註解自己餵綠',
    ).toBe(false);
  });

  it('🔴 每一個 production 呼叫都帶 enumWatch', () => {
    for (const s of productionCallSites(src)) {
      expect(
        /enumWatch|high:\s*manualCustomerSearchHighForMessage/.test(s.args),
        `${SRC} 第 ${s.line} 行那個呼叫沒有傳 enumWatch ⇒ ` +
          '信裡不會說出「本信因此發出」, 而「順帶報數」與「它就是原因」長得一樣',
      ).toBe(true);
    }
  });

  it('🔴 每一個 production 呼叫都帶 fitmentSync(⟦b4-FITSYNC1⟧③)', () => {
    /**
     * 🔴 **[codex R2 新 must-fix:這道守門【當時不存在】, 而有一句話宣稱它存在]**
     * ⛔ `check-anomaly-alerts.ts` 那個參數的註解逐字寫著「由掃描守門接」,
     *   🛑 而那道掃描【只看 `enumWatch`】⇒ 漏傳 `fitmentSync` 兩把尺都不紅。
     * ✅ 本格補上那道閘 —— **而它與上面那格【刻意分開】**:
     *   兩個參數各自有各自的漏傳世界, 合成一格的話「漏了哪一個」答不出來。
     */
    for (const s of productionCallSites(src)) {
      expect(
        /fitmentSync|stale:\s*fitmentSyncStaleForMessage/.test(s.args),
        `${SRC} 第 ${s.line} 行那個呼叫沒有傳 fitmentSync ⇒ ` +
          '車款同步那一段會【靜默消失】, 而預設值讓型別與這把尺都不會紅',
      ).toBe(true);
    }
  });

  // ── 🟢 負對照:codex R3 逐字點名的三個假綠世界, 每一個都要真的紅 ──────────────
  // 🛑 舊版(3,000 字窗)在這三個世界【全綠】。它們就是修法的驗收條件。

  it('🟢 負對照①:漏傳的呼叫後面有一句【註解】提到那個字 ⇒ 仍要判定漏傳', () => {
    const fake = [
      'const m = buildAnomalyAlertMessage(a, b, c);',
      '// 這裡提到 fitmentSync 與 enumWatch, 而它只是一句註解',
    ].join('\n');
    const sites = productionCallSites(fake);
    expect(sites.length).toBe(1);
    expect(/fitmentSync/.test(sites[0]!.args), '註解裡的字被算進引數 ⇒ 假綠').toBe(false);
    expect(/enumWatch/.test(sites[0]!.args)).toBe(false);
  });

  it('🟢 負對照②:漏傳的呼叫後面有【另一個正確的呼叫】⇒ 前面那個仍要判定漏傳', () => {
    const fake = [
      'const bad = buildAnomalyAlertMessage(a, b, c);',
      'const ok = buildAnomalyAlertMessage(a, b, c, { fitmentSync: x, enumWatch: y });',
    ].join('\n');
    const sites = productionCallSites(fake);
    expect(sites.length, '兩個呼叫要各自被看見').toBe(2);
    expect(/fitmentSync/.test(sites[0]!.args), '後面那個正確呼叫餵綠了前面那個 ⇒ 假綠').toBe(false);
    expect(/fitmentSync/.test(sites[1]!.args), '正對照:正確的那個要通過').toBe(true);
  });

  it('🟢 負對照③:引數【字串裡的括號】不能把配對算歪', () => {
    const fake = 'const m = buildAnomalyAlertMessage(a, "括號 ) 在字串裡", { fitmentSync: x });';
    const sites = productionCallSites(fake);
    expect(sites.length).toBe(1);
    expect(/fitmentSync/.test(sites[0]!.args), '字串裡的 ) 提早收尾 ⇒ 引數被截斷 ⇒ 假紅').toBe(true);
  });
});
