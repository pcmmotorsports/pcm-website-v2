import { describe, expect, it } from 'vitest';
import {
  ORDER_MEMBER_CENTER_SENTENCE,
  ORDER_PAID_HTML_LEAD_SENTENCE,
  ORDER_PAID_NEXT_STEP_SENTENCE,
} from './order-email-copy';
import { renderPaidEmailHtml } from './paid-email-html';
import type { PaidEmailContext } from '@pcm/ports';
import type { MoneyAmount } from '@pcm/domain';

const m = (n: number) => n as MoneyAmount;

/** 🔴 形狀抄 `paid-email-html.test.ts` 的 `ctxWithDiscount()`,**不自己發明一個** —— 我第一版發明的那個缺 `lines`,當場 TypeError。 */
function ctx(): PaidEmailContext {
  return {
    orderDisplayId: 'PCM-2026-9001',
    linesTruncated: false,
    lines: [{ title: '測試品', variantSku: 'SKU-1', quantity: 1, lineTotal: m(100) }],
    subtotal: m(100),
    shippingFee: m(0),
    discountTotal: m(0),
    total: m(100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 **這一格是這一片【唯一會紅】的守門**(Sean 2026-09-03 02:5x 拍甲)。
//
// 沒有它,兩份文案下次再漂**一樣沒有人知道** —— 而它們**已經漂過一次**:
//   純文字 `U+002C`(半形逗號) vs HTML `U+FF0C`(全形逗號),2026-09-03 逐字元量到。
//   🎯 **同一個客人、同一封信,而收信軟體挑哪一份是【客人那端】決定的。**
//
// 🛑 **判別點是「兩份的那一句【逐位元組相同】」,不是「各自比對字面」** ——
//    各自比對字面的話,兩邊一起改錯會**一致通過**(本 repo 對這個形狀有明確立場:
//    `20260816050000` 檔頭逐字「守門不能做成兩邊互比:兩邊【一起】用錯分母時,
//    互比對同一組輸入會得到同一個錯答案、**一致通過**」)。
//    ⇒ 所以下面**同時**做兩件:①兩個消費端的產出都含**同一個常數** ②那個常數逐字元對得上稿。
// ─────────────────────────────────────────────────────────────────────────────
describe('訂單信文案:一份定義、兩邊各自取用(Sean 2026-09-03 拍甲)', () => {
  it('🔴 純文字與 HTML 的主句【逐位元組相同】—— 逗號漂掉就要紅', () => {
    // 期望值來自**稿**(OD `pcm-524f/email-order-paid-A.html`,Sean 2026-08-23 拍 A 版),
    // 不是從實作抄的:逗號 U+FF0C、句號 U+3002。
    expect(ORDER_PAID_NEXT_STEP_SENTENCE).toBe(
      '我們會盡快為您安排出貨，出貨後會再寄一封通知給您。',
    );
    // 🛑 半形逗號 = 漂回去了
    expect(ORDER_PAID_NEXT_STEP_SENTENCE).not.toContain(',');
  });

  it('🔴 HTML 產出真的用了那個常數(不是自己又打了一份)', () => {
    const html = renderPaidEmailHtml(ctx(), {});
    expect(html).toContain(ORDER_PAID_NEXT_STEP_SENTENCE);
    expect(html).toContain(ORDER_PAID_HTML_LEAD_SENTENCE);
    // 🔴 負對照:半形逗號那一版**不准**出現在產出裡
    expect(html).not.toContain('我們會盡快為您安排出貨,');
  });

  it('🔴🔴 production 裡【不准有第二份手打副本】—— 這一格才證得了「來源」', async () => {
    // 🔴 codex 2026-09-03 兩條 must-fix 的根:`toContain` 只證「那個值出現在產出裡」,
    //    **證不了它是從常數來的** —— 把消費端改成手打同樣的字面,上面那兩格照樣全綠。
    // ✅ 所以這一格換一個分母:**掃原始碼**,問「除了定義檔以外,還有誰把這句話打進去了」。
    //    形狀對齊 `order-hidden-rule.ts` 的立場:副本在【測試】裡 = 絆線;
    //    副本在【production】裡 = 會漂的第二份真相。
    const { readFile } = await import('node:fs/promises');
    const consumers = ['./paid-email-html.ts', './sweep-email-outbox.ts'];
    for (const rel of consumers) {
      const src = await readFile(new URL(rel, import.meta.url), 'utf8');
      // 🛑 只看【非註解】的行 —— 註解裡引用這句話是刻意的(訃聞與說明),那不是副本。
      const codeLines = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
      const hardcoded = codeLines.filter((l) => l.includes(ORDER_PAID_NEXT_STEP_SENTENCE));
      expect(hardcoded, `${rel} 裡有手打副本:${hardcoded.join(' | ')}`).toHaveLength(0);
    }
  });

  it('🟢 正對照:上面那個 0 不是恆 0 —— 定義檔自己【必須】命中', async () => {
    // 🔴 沒有這一格,上面那個 `toHaveLength(0)` 在「尺根本沒讀到檔」時也會過。
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./order-email-copy.ts', import.meta.url), 'utf8');
    const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const hits = codeLines.filter((l) => l.includes(ORDER_PAID_NEXT_STEP_SENTENCE));
    expect(hits.length, '定義檔裡應該【正好一處】非註解命中').toBe(1);
  });

  it('🟢 正對照:這把尺對「常數被改壞」會動', () => {
    // 證明上面兩格不是恆真 —— 一個刻意錯的字面必須對不上。
    expect(ORDER_PAID_NEXT_STEP_SENTENCE).not.toBe('我們會盡快為您安排出貨,出貨後會再寄一封通知給您。');
    expect(ORDER_MEMBER_CENTER_SENTENCE).not.toBe('');
  });
});
