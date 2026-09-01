// manual-refund-action-state.test.ts — 非卡退款那一側最後一支零測試的檔(2026-09-01 補)。
//
// 🔴 **這一支值得測的不是「有沒有回傳物件」,是它【刻意偏離慣例】的那一格**:
//    被測檔逐字寫著 —— `rejected` **例外地把 RPC 的 message 原樣顯示給員工**,
//    而 `cancel-repository.ts` / `refund-action-state.ts` 的慣例是**只顯示罐頭訊息**。
//    理由也逐字寫著:D1 每一句 RAISE 本身就是寫給員工看的指示(例:「不要換人重送」)。
//    ⇒ 📌 **一個刻意的偏離,如果沒有測試釘住它,下一個人「順手統一成罐頭」時不會有東西紅** ——
//      而那個改動在 diff 上長得像一次無害的一致性整理。
//
// 🛑 **射程**:本檔只驗這個純函式的映射與 token 往返。
//    「哪個 SQLSTATE 該對到哪個 code」在 `manual-refund-repository.ts`(它有自己的測試),
//    本檔一格都不驗。

import { describe, expect, it } from 'vitest';

import {
  EMPTY_MANUAL_REFUND_INPUT,
  isManualRefundRequestToken,
  generateManualRefundRequestToken,
  manualRefundFailure,
  type ManualRefundFailureCode,
  type ManualRefundFormInput,
} from './manual-refund-action-state';

const INPUT: ManualRefundFormInput = {
  rail: 'cash',
  amount: '350',
  reason: '客人匯錯金額,退回差額',
  occurredAt: '2026-08-20T10:00',
};
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const ALL_CODES: ManualRefundFailureCode[] = ['denied', 'invalid', 'rejected', 'bug', 'error'];

describe('manualRefundFailure — 刻意偏離慣例的那一格', () => {
  it('🔴 rejected + 有 rpcMessage ⇒ 【原樣】顯示 RPC 那句話,不換成罐頭', () => {
    const rpc = '同一個 request_id 帶了不同的內容,不要換人重送。';
    const out = manualRefundFailure('rejected', INPUT, TOKEN, rpc);
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.message).toBe(rpc);
    // 🔵 對照:它不是「兩句都給」,也不是把罐頭接在後面。
    expect(out.message).not.toContain('這筆退款登記被拒絕');
  });

  it('🟢 rejected 但【沒給】rpcMessage ⇒ 退回罐頭(備援存在,不是空字串)', () => {
    const out = manualRefundFailure('rejected', INPUT, TOKEN);
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.message).toContain('這筆退款登記被拒絕');
  });

  it('🔴 其餘四個 code 【就算給了 rpcMessage 也不顯示它】', () => {
    // 這一格守的是「只有 rejected 會把 RPC 原文給員工」——
    // 少了它,把條件放寬成任何 code 都帶 rpcMessage 時不會有東西紅。
    const rpc = 'ZZQ-不該出現在畫面上的原始訊息';
    for (const code of ALL_CODES.filter((c) => c !== 'rejected')) {
      const out = manualRefundFailure(code, INPUT, TOKEN, rpc);
      expect(out.status).toBe('failed');
      if (out.status !== 'failed') continue;
      expect(out.message, `${code} 不該顯示 RPC 原文`).not.toContain('ZZQ-');
      expect(out.message.length, `${code} 應該有罐頭文案`).toBeGreaterThan(0);
    }
  });
});

describe('manualRefundFailure — 冪等 token 與輸入原樣帶回', () => {
  it('🔴 token 一律【原樣帶回】,不換新鍵', () => {
    // 被測檔逐字:「D1 沒有『列已終結、token 被永久消耗』的分支 —— 冪等鍵未使用就不必換,
    // 重送本來就該被同一把鍵認出。」⇒ 換新鍵會讓重送變成新請求 = 可能重複退款。
    for (const code of ALL_CODES) {
      const out = manualRefundFailure(code, INPUT, TOKEN);
      if (out.status !== 'failed') continue;
      expect(out.requestToken, `${code} 應原樣帶回 token`).toBe(TOKEN);
    }
  });

  it('🟢 員工填的內容原樣帶回(表單不會被清空)', () => {
    const out = manualRefundFailure('invalid', INPUT, TOKEN);
    if (out.status !== 'failed') return;
    expect(out.input).toEqual(INPUT);
  });

  it('🟢 空輸入常數的每一欄都是空字串(它是表單的初始值)', () => {
    expect(EMPTY_MANUAL_REFUND_INPUT).toEqual({
      rail: '',
      amount: '',
      reason: '',
      occurredAt: '',
    });
  });
});

describe('冪等 token 的形狀', () => {
  it('🟢 產生器產出的 token 自己認得', () => {
    const t = generateManualRefundRequestToken();
    expect(isManualRefundRequestToken(t)).toBe(true);
  });

  it('🔴 不是 uuid 的東西一律不認', () => {
    for (const bad of ['', 'tok-1', '1234', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee']) {
      expect(isManualRefundRequestToken(bad), `${JSON.stringify(bad)} 不該被認`).toBe(false);
    }
  });

  it('🟢 兩次產生不會相同(冪等鍵不能是常數)', () => {
    // 🔵 這一格擋的是「有人把 randomUUID 換成固定字串」——那會讓每一次重送
    //    都被 D1 認成同一筆請求。
    expect(generateManualRefundRequestToken()).not.toBe(generateManualRefundRequestToken());
  });
});
