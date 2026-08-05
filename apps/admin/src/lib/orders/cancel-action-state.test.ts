import { describe, expect, it } from 'vitest';
import {
  cancelNotSentFailure,
  cancelSentFailure,
  generateCancelRequestToken,
  isCancelRequestToken,
  ORDER_CANCELLED_RESULT_CODE,
  type CancelFailureCode,
  type CancelFormInput,
} from './cancel-action-state';

const INPUT: CancelFormInput = {
  cancelMode: 'partial',
  reasonCode: 'other',
  reasonDetail: '客人改買別款',
  items: ['33333333-3333-4333-8333-333333333333:2'],
};

describe('cancel-action-state — A9d2-2a', () => {
  it('產生器與驗證器同源:產出來的一定過得了驗證', () => {
    const token = generateCancelRequestToken();
    expect(isCancelRequestToken(token)).toBe(true);
  });

  // 🔴 關卡2 must-fix:把產生器換成回一顆固定合法 uuid,原本所有測試仍全綠 ——
  //    而那正是「同一張單下一次不同 payload 撞既有 token/hash」的形狀。
  it('🔴 產生器每次都不同(換成固定 uuid 要紅)', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCancelRequestToken()));
    expect(tokens.size).toBe(50);
  });

  it('🔴 `req_<uuid>` 形狀不算 token(前例 Fable F3:重用 generateRequestId 會讓整個功能死掉)', () => {
    expect(isCancelRequestToken(`req_${generateCancelRequestToken()}`)).toBe(false);
  });

  // 🔴 關卡2 nit:原本用純數字 uuid,`toUpperCase()` 是 no-op ⇒ 這條根本沒在測大小寫
  //    (與 cancel-form.test.ts 同款的 fixture 坑,當時只修了那一支)。
  it('大小寫 uuid 皆收(手上有一把合法 uuid 卻被擋掉 = 難查的 bug)', () => {
    const withLetters = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    expect(withLetters.toUpperCase()).not.toBe(withLetters);
    expect(isCancelRequestToken(withLetters.toUpperCase())).toBe(true);
  });

  // ── §2.1 的執行機制:兩種 failed 形狀 ──

  it('沒送到 RPC(denied / invalid)→ 帶回輸入 + 新 token,表單可編輯', () => {
    const state = cancelNotSentFailure('invalid', INPUT);
    expect(state.status).toBe('failed');
    expect(state.outcome).toBe('not_sent');
    expect(state.code).toBe('invalid');
    expect(state.message).toBe('表單內容不正確,取消沒有送出。');
    expect(state.input).toEqual(INPUT);
    expect(isCancelRequestToken(state.requestToken)).toBe(true);
  });

  // 🔴 關卡2 must-fix:原本 token 由呼叫端傳入 ⇒ 片 5 把舊的原樣傳回來型別與測試都不會紅。
  //    現在由 builder 自己鑄 ⇒ 兩次呼叫必不同,「換新」是機制不是願望。
  it('🔴 not_sent 的 token 每次都是新鑄的(呼叫端無從指定舊的那把)', () => {
    const a = cancelNotSentFailure('invalid', INPUT);
    const b = cancelNotSentFailure('invalid', INPUT);
    expect(a.requestToken).not.toBe(b.requestToken);
  });

  // 🔴 關卡2 R2 推翻了前一版(「sent 不帶 token/input」):那擋不住重送(prevState 由 client 送、
  //    可偽造;片 5 也能自己鑄鍵),卻毀掉災難當天的對帳證據。改成**原樣帶回**,
  //    而且刻意**不鑄新鍵** —— 新鍵 = 全新 payload_hash = 同一份 payload 會真的再取消一次。
  it('🔴 已送到 RPC → 原樣帶回這次用的 token(絕不鑄新的)與員工輸入', () => {
    const used = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    for (const code of ['rejected', 'retry', 'bug', 'error'] as const) {
      const state = cancelSentFailure(code, INPUT, used);
      expect(state.requestToken, `${code} 必須是原本那一顆`).toBe(used);
      expect(state.input).toEqual(INPUT);
      expect(state.outcome).toBe('sent');
    }
  });

  // 🔴 兩個 builder 對 token 的處置**相反**,而且必須相反:
  //    not_sent 換新(舊的沒送出)、sent 原樣(換新就是再取消一次)。把 sent 改成也鑄新的,本條紅。
  it('🔴 sent 不鑄新鍵、not_sent 一定鑄新鍵(兩者相反)', () => {
    const used = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
    expect(cancelSentFailure('rejected', INPUT, used).requestToken).toBe(used);
    expect(cancelNotSentFailure('invalid', INPUT).requestToken).not.toBe(used);
  });

  // ── 訊息表與碼一對一(驗收條件)──

  // 🔴 R1 nit:原本只驗「六句非空且互異」⇒ 把 rejected 與 error 的字串**對調**也全綠
  //    (兩句都含「重新整理」、都不含「稍後再試」)。⇒ 改成對 plan §4.2 的表**逐字**釘死。
  it('🔴 六句文案與 plan §4.2 的表逐字相同(對調兩句也要紅)', () => {
    const expected: Record<CancelFailureCode, string> = {
      denied: '沒有權限或登入已失效,取消沒有送出。',
      invalid: '表單內容不正確,取消沒有送出。',
      rejected: '這張單目前不能取消(狀態可能剛變動)。請重新整理本單確認後再決定,不要重複按。',
      bug: '系統狀態異常,取消可能已經寫進去了。請重新整理確認,並通知系統維護,不要重複按。',
      retry: '系統忙碌,這次沒完成。請重新整理本單確認後再送一次。',
      error: '取消可能已經寫進去了。請重新整理本單確認之後再決定要不要重送。',
    };
    for (const code of Object.keys(expected) as CancelFailureCode[]) {
      const actual =
        code === 'denied' || code === 'invalid'
          ? cancelNotSentFailure(code, INPUT).message
          : cancelSentFailure(code, INPUT, '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b').message;
      expect(actual, `${code} 的文案`).toBe(expected[code]);
    }
  });

  // 🔴 plan §4.2:取消帳本 append-only ⇒ 已送達那四支一律叫他「重新整理確認」,
  //    不得出現「稍後再試」這種誘導重按的字。
  it('🔴 已送達的四支訊息都叫他重新整理、且都沒有「稍後再試」', () => {
    for (const code of ['rejected', 'retry', 'bug', 'error'] as const) {
      const { message } = cancelSentFailure(code, INPUT, '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b');
      expect(message, `${code} 應叫員工重新整理`).toContain('重新整理');
      expect(message, `${code} 不得誘導重按`).not.toContain('稍後再試');
    }
  });

  it('成功結果碼是常數(action 與 result-banner 共用同一顆,結構上 typo 不可能)', () => {
    expect(ORDER_CANCELLED_RESULT_CODE).toBe('order_cancelled');
  });
});
