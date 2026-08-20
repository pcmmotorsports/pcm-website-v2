import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../lib/test-support/strip-comments';

/**
 * panel-items-name-floor.test.ts — 訂單面板品項六軌的**品名軌下限**守門。
 *
 * ## 🔴 檔頭第一句:**我守不到什麼**
 *
 * ```
 * ❌ 我守不到「在某個 viewport 下畫面長什麼樣」。
 *    jsdom 沒有版面引擎 ⇒ 這裡的 getBoundingClientRect() 全是 0
 *    (同族 orders-cutoff-notice.test.ts:11 逐字記過同一件事,那裡的矩形是【假造的】)。
 *    ⇒ 這個 bug 之所以活到今天,正是因為【jsdom 測不了它】。
 * ❌ 我也守不到「120 這個數字夠不夠」。夠不夠只有真瀏覽器量得出來。
 * ✅ 我只守一件事:**那個下限有沒有被人拿掉**(改回 `minmax(0, 1fr)` 或任何 min = 0 的寫法)。
 * ```
 * ⇒ **本格綠 ≠ 窄容器沒問題。** 下一個人若把這格的綠讀成「有人在守這件事」,那是誤讀,
 *   而這段話存在的唯一理由就是擋住那個誤讀。
 *
 * ## 為什麼需要它(W4 2026-08-21 真瀏覽器實量)
 *
 * ```
 * 後五軌固定 158+128+44+76+64 = 470,加 gap 5×10 = 50 ⇒ 520px 是硬的
 * 品名軌若是 minmax(0, 1fr) ⇒ 容器內容寬 ≤ 520 時它只能是 0
 * ⇒ 而品名軌裡還住著【沒有 truncate 的規格行與提示行】⇒ 寬度 0 時變成一個字一行的直排
 * ⇒ 實量:商品卡高 74.5px(viewport 1440)→ 250.5px(viewport 1151),3.4 倍,壓在料號欄上
 * ⇒ 🔴 它看起來像系統故障,不像版面變窄。
 * 實量門檻:viewport ≤ 1174 ⇒ 品名一個中文字都放不下;≤ 1150 ⇒ 整頁橫向溢出。
 * 全文:~/pcm-mailbox/W4-057-訂單面板窄容器破版-20260821.md
 * ```
 *
 * ## 🔴 什麼時候該把我改掉
 *
 * 若哪天改用 container query 換排法(窄容器下品名獨佔一列),六軌這條規則就不再是唯一的版面來源
 * ⇒ **那時要重寫本檔,不是把它刪掉** —— 刪掉會讓「品名不得塌成 0」這個不變量無聲消失。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const CSS = stripComments(readFileSync(resolve(DIR, '../../app/globals.css'), 'utf8'));

/** 從 `grid-template-columns` 的宣告值取第一軌的**下限 px**。取不到回 `null`(讓呼叫端大聲失敗,不靜靜放行)。 */
export function firstTrackMinPx(decl: string): number | null {
  const first = decl.trim();
  const mm = /^minmax\(\s*([^,]+?)\s*,/.exec(first);
  if (!mm) {
    // 不是 minmax(...) ⇒ 可能是寫死的 `120px`,那也是一個下限
    const fixed = /^(\d+(?:\.\d+)?)px\b/.exec(first);
    return fixed ? Number(fixed[1]) : null;
  }
  const lo = mm[1]!.trim();
  if (lo === '0' || lo === '0px') return 0;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(lo);
  return px ? Number(px[1]) : null;
}

/** 找出 `.ihead, .iline` 那一條**唯一**的軌道宣告。找不到 ⇒ 回 null(不假裝找到)。 */
export function itemsGridDecl(css: string): string | null {
  const rule = /\.ihead\s*,\s*\.iline\s*\{([\s\S]*?)\}/.exec(css);
  if (!rule) return null;
  const decl = /grid-template-columns:\s*([^;]+);/.exec(rule[1]!);
  return decl ? decl[1]!.trim() : null;
}

describe('訂單面板品項六軌:品名軌下限', () => {
  it('[1] 現在:那一條軌道宣告找得到(正向對照 —— 少了這格,下面兩格會因為「找不到」而假紅)', () => {
    expect(itemsGridDecl(CSS)).not.toBeNull();
  });

  it('🔴 [2] 品名軌的下限必須 > 0 —— 改回 minmax(0, 1fr) 這格會紅', () => {
    const decl = itemsGridDecl(CSS)!;
    const min = firstTrackMinPx(decl);
    expect(
      min,
      `品名軌的下限解析不出來(宣告值:${decl})—— 寫法變了就把本檔的解析一起更新,` +
        '不要因為解析不到而讓這格靜靜地過',
    ).not.toBeNull();
    expect(
      min,
      '🔴 品名軌的下限被拿掉了(min = 0)。窄容器下它會被壓到 0px,而品名軌裡的規格行沒有 truncate ' +
        '⇒ 會變成一個字一行的直排壓在料號欄上,商品卡高變 3.4 倍,看起來像系統故障。\n' +
        '要動這個下限之前:先用本機真後台量一次 viewport 1440 / 1175 / 1151 三檔' +
        '(做法 docs/runbooks/local-admin-with-real-data-probe.md),再改。\n' +
        '⚠️ 不要改成「面板加 min-width」—— workspace-shell.test.ts:136-149 明文禁止,' +
        '那是 Sean 2026-08-19 Q2 拍板的落地物。',
    ).toBeGreaterThan(0);
  });

  it('🔴 [3] 量具自檢:同一支解析器對「有下限」與「沒下限」要給不同答案', () => {
    expect(firstTrackMinPx('minmax(120px, 1fr) 158px 128px')).toBe(120);
    expect(firstTrackMinPx('minmax(0, 1fr) 158px 128px')).toBe(0); // ← 該說 0 的時候說 0
    expect(firstTrackMinPx('minmax(0px, 1fr) 158px')).toBe(0);
    expect(firstTrackMinPx('120px 158px')).toBe(120); // 寫死也是一種下限
    expect(firstTrackMinPx('1fr 158px')).toBeNull(); // 認不出來 ⇒ null,不假裝是 0 也不假裝有下限
    expect(itemsGridDecl('.something-else { grid-template-columns: 1fr; }')).toBeNull();
  });
});
