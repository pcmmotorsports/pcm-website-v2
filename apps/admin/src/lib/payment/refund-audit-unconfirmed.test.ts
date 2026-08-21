import { describe, expect, it } from 'vitest';
import { REFUND_AUDIT_UNCONFIRMED_SUFFIX, refundFailure } from './refund-action-state';

// 條件③④(主視窗 2026-08-21):
//   ③「寫得成時留得下來,寫不成時**不影響員工看到的那句話**」
//   ④ 寫不成時要**多一句**,而那一句也要有測試
//
// 🔴 本檔釘的是【④ 那一句 + ③ 的後半】。③ 的前半(真的寫得進 DB)**刻意不在這裡** ——
//    那一格用真的 Postgres 驗。今天正式站事故的形狀就是「那一步只被假的實作執行過」。
//
// ⚠️ 本檔**不 import `FAILURE_MESSAGES`**(它沒 export,也不該為了測試而 export)。
//    基準改用「沒帶 options 的那一版」⇒ 文案哪天改了本檔不會假紅,而它釘的東西沒有變弱。

/**
 * 🔴 **斷言句偵測器**:文案不得【宣稱】紀錄沒寫成(只能說「無法確認」)。
 *
 * ── 這條 regex 自己被改壞過一次,所以它有自己的表(下面那個 describe)──────
 * v1  `/沒有寫成|沒寫成|查不到它/`
 *     ⇒ **誤報了正確的訊息**:「有沒有寫成」含「沒有寫成」這個子字串。
 * v2  `/(?<![有])沒有寫成|查不到它|都沒有寫/`
 *     ⇒ 誤報修好了,**但我是把「沒寫成」整項刪掉來修的** ——
 *       而那一項同時在抓一句真的假話(「內部紀錄沒寫成。」)⇒ **修法自己開了一個洞。**
 *     🔴 教訓(審查線 `-04` RF-1):**收窄與移除,在 diff 上長得像同一種修法。**
 *       誤報的正解是**給那一項加限定**,不是**把那一項拿掉**。
 * v3  現行:每一項都掛否定回顧,一項都沒少。
 */
export const ASSERTS_NOT_WRITTEN = /(?<![有])沒有寫成|(?<![有])沒寫成|查不到它|都沒有寫/;

const INPUT = { kind: 'full', amount: '', reason: '測試', confirmCode: '3N5Q' };
// `RefundActionState` 是聯集(含 idle)⇒ 先窄化再讀 message。
// 窄化失敗直接 throw:那代表 refundFailure 不再恆回 failed,本檔的前提就不成立了。
function failedMessage(
  code: Parameters<typeof refundFailure>[0],
  options?: { readonly auditUnconfirmed?: boolean },
): string {
  const state = refundFailure(code, INPUT, 'tok', options);
  if (state.status !== 'failed') throw new Error('refundFailure 回了非 failed 狀態');
  return state.message;
}
const base = (code: Parameters<typeof refundFailure>[0]) => failedMessage(code);

describe('條件③後半:稽核寫不成,不得吃掉員工本來看得到的那句話', () => {
  it('原本那句【完整保留】且在最前面,不是被換掉', () => {
    const bad = failedMessage('unknown_state', { auditUnconfirmed: true });
    expect(bad.startsWith(base('unknown_state'))).toBe(true);
  });

  it('code / status / 員工打的字都不受影響', () => {
    const b = refundFailure('unknown_state', INPUT, 'tok', { auditUnconfirmed: true });
    if (b.status !== 'failed') throw new Error('refundFailure 回了非 failed 狀態');
    expect(b.code).toBe('unknown_state');
    expect(b.status).toBe('failed');
    expect(b.input).toEqual(INPUT);
  });
});

describe('條件④:寫不成時多的那一句', () => {
  it('寫成了(或沒帶 options)⇒ 不得出現那一句', () => {
    expect(base('unknown_state')).not.toContain(REFUND_AUDIT_UNCONFIRMED_SUFFIX);
    expect(failedMessage('unknown_state', { auditUnconfirmed: false })).not.toContain(
      REFUND_AUDIT_UNCONFIRMED_SUFFIX,
    );
  });

  it('🔴 寫不成 ⇒ 一定出現那一句(兩個世界印不同的東西)', () => {
    const ok = failedMessage('unknown_state', { auditUnconfirmed: false });
    const bad = failedMessage('unknown_state', { auditUnconfirmed: true });
    expect(bad).toContain(REFUND_AUDIT_UNCONFIRMED_SUFFIX);
    expect(bad).not.toBe(ok);
  });

  // codex R1 F9(nit):只驗 startsWith + contains 的話,suffix 被接一千次、
  // 或中間夾一堆別的字,測試照樣綠。改成**逐字相等**。
  it('🔴 恰好是「原句 + 那一句」,一個字不多', () => {
    for (const code of ['unknown_state', 'held', 'finalize_failed'] as const) {
      expect(failedMessage(code, { auditUnconfirmed: true })).toBe(
        failedMessage(code) + REFUND_AUDIT_UNCONFIRMED_SUFFIX,
      );
    }
  });

  it('那一句只出現一次(不得重複串接)', () => {
    const bad = failedMessage('unknown_state', { auditUnconfirmed: true });
    const hits = bad.split(REFUND_AUDIT_UNCONFIRMED_SUFFIX).length - 1;
    expect(hits).toBe(1);
  });

  it('那一句要叫員工做一件【他做得到】的事,而且不准用 Markdown', () => {
    expect(REFUND_AUDIT_UNCONFIRMED_SUFFIX).toContain('截圖');
    // 🔴 codex R2 F2:不得【斷言】沒寫成 —— 逾時/失敗都只能說「無法確認」。
    expect(REFUND_AUDIT_UNCONFIRMED_SUFFIX).toContain('無法確認');
    expect(REFUND_AUDIT_UNCONFIRMED_SUFFIX).not.toMatch(ASSERTS_NOT_WRITTEN);
    // `refund-section.tsx` 是 <p role='alert'>{state.message}</p>,沒有任何 renderer
    // ⇒ 寫 ** 或 ` 或標籤,員工會看到字面上的符號。
    expect(REFUND_AUDIT_UNCONFIRMED_SUFFIX).not.toMatch(/\*\*|`|<[a-z]/);
  });

  it('對其他失敗碼一樣掛得上(它不是 unknown_state 專屬)', () => {
    const bad = failedMessage('held', { auditUnconfirmed: true });
    expect(bad.startsWith(base('held'))).toBe(true);
    expect(bad).toContain(REFUND_AUDIT_UNCONFIRMED_SUFFIX);
  });
});

// ═══ 這個閘自己的表(審查線 -04 RF-1)═══════════════════════════════════════
// 🔴 **一個守門也是一段 code,它也要被當成新 code 審一次。**
//    這五格裡有【一格該放行、四格該擋】—— 只在自己關心的那一格印對答案不算數。
describe('🔴 ASSERTS_NOT_WRITTEN 這個閘自己的五格表', () => {
  const CASES: ReadonlyArray<{ text: string; blocked: boolean; why: string }> = [
    {
      text: '另外:這筆的內部紀錄有沒有寫成,系統無法確認。請立刻截圖這個畫面,並通知系統維護。',
      blocked: false,
      why: '現行正確訊息 —— 疑問句,沒有斷言任何事',
    },
    { text: '這筆的內部紀錄沒有寫成。', blocked: true, why: '假斷言(v1 抓得到)' },
    { text: '這筆的內部紀錄沒寫成。', blocked: true, why: '🔴 假斷言 —— v2 放行,就是 RF-1 那個破口' },
    { text: '這筆的內部紀錄查不到它。', blocked: true, why: '假斷言' },
    { text: '這筆連內部紀錄都沒有寫進去。', blocked: true, why: '假斷言(v1 放行、v2 之後才擋得到)' },
  ];

  it.each(CASES)('$why', ({ text, blocked }) => {
    expect(ASSERTS_NOT_WRITTEN.test(text)).toBe(blocked);
  });

  it('🔴 現行文案在這個閘下必須放行(否則是誤報,要改閘不是改文案)', () => {
    expect(ASSERTS_NOT_WRITTEN.test(REFUND_AUDIT_UNCONFIRMED_SUFFIX)).toBe(false);
  });
});
