import { describe, expect, it } from 'vitest';
import {
  EMPTY_PAYMENT_VALUES,
  PAYMENT_RAILS,
  paymentFailure,
  paymentFailureCodeFor,
  paymentFailureCodeForThrown,
  type PaymentFailureCode,
} from './payment-action-state';

// payment-action-state.test.ts — #15-B2-b 逐碼映射。突變靶釘在 `SQLSTATE_TO_FAILURE`。
//
// 🔴 本檔守的是「**具名碼不可以被講成『稍後再試』**」(plan §3.2 / #371 的症狀)。

/** RPC 逐字噴出來的五個具名碼 + 權限碼(`20260810200000` 的 `USING ERRCODE`)。 */
const RPC_CODES: ReadonlyArray<[string, PaymentFailureCode]> = [
  ['P8C01', 'isolation'],
  ['P2B39', 'actor_invalid'],
  ['P2B38', 'received_at_out_of_range'],
  ['P2B41', 'refunded_state'],
  ['P2B40', 'row_count'],
  ['P0001', 'rejected'],
  ['42501', 'forbidden'],
];

describe('逐碼映射', () => {
  it.each(RPC_CODES)('%s ⇒ %s', (sqlstate, expected) => {
    expect(paymentFailureCodeFor(sqlstate)).toBe(expected);
  });

  // 🔴 關卡2 codex nit:原本這一格對「測試資料裡的 expected」做 Set,**根本沒呼叫受測函式**
  //    ⇒ 恆真。改成拿每個 SQLSTATE 實際跑一次再看相異性 —— 現在把表裡任兩格合併,它會紅。
  it('🔴 七個碼**實跑**之後各自相異(合併任兩格都會被抓到)', () => {
    const actual = RPC_CODES.map(([sqlstate]) => paymentFailureCodeFor(sqlstate));
    expect(new Set(actual).size).toBe(RPC_CODES.length);
  });

  // 🔴🔴 關卡2 codex MF3:「有碼」與「沒碼」是兩件事,不可以都歸 `error`。
  //    有碼 = PG 噴的 ⇒ 那個 statement 已中止、整筆回滾 ⇒ **確定沒寫進去** ⇒ `bug`。
  it('🔴 有碼、非連線類(22007 畸形日期 / 57014 逾時)⇒ bug(確定沒寫入)', () => {
    expect(paymentFailureCodeFor('22007')).toBe('bug');
    expect(paymentFailureCodeFor('57014')).toBe('bug');
    expect(paymentFailureCodeFor('XX999')).toBe('bug');
  });

  // 🔴🔴 opus R2 MF1:**連線類的碼照樣是「有碼」,但它證明不了 statement 中止** ——
  //    postgrest-js 對非 2xx 是 `JSON.parse(body)`(`PostgrestBuilder.ts:513`),
  //    code 是回應方寫什麼就是什麼;COMMIT 之後才斷線也會帶著碼上來。
  //    講成「沒有寫入」⇒ 員工再登一次會帶**新的 request_id** ⇒ G8 擋不到 ⇒ 重複入帳。
  it.each(['08000', '08006', '08003', '57P01', '57P02', '57P03', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])(
    '🔴 連線類碼 %s ⇒ error(可能已經寫進去了),**不是** bug',
    (code) => {
      expect(paymentFailureCodeFor(code)).toBe('error');
    },
  );

  it('🔴 連線類的判斷不可以誤傷:57014(statement timeout)不是 57P0*、PGRST116 不是連線類', () => {
    expect(paymentFailureCodeFor('57014')).toBe('bug');
    expect(paymentFailureCodeFor('PGRST116')).toBe('bug');
    expect(paymentFailureCodeFor('P0001')).toBe('rejected');
  });

  it('🔴 沒有碼(連線半路斷)⇒ error —— 只有這種情況才真的不確定', () => {
    expect(paymentFailureCodeFor(null)).toBe('error');
    expect(paymentFailureCodeFor(undefined)).toBe('error');
    expect(paymentFailureCodeFor('')).toBe('error');
  });

  it('🔴 兩者的文案必須講不同的話(一個說「沒有寫入」、一個說「可能已經寫進去」)', () => {
    const withCode = paymentFailure(paymentFailureCodeFor('22007'), EMPTY_PAYMENT_VALUES);
    const noCode = paymentFailure(paymentFailureCodeFor(null), EMPTY_PAYMENT_VALUES);
    expect(withCode.status === 'failed' && withCode.message).toContain('沒有寫入');
    expect(noCode.status === 'failed' && noCode.message).toContain('可能已經寫進去');
  });

  // 🔴 到貨線那支的隔離閘是 `P2B02`,本支是 `P8C01`(`20260810200000:135`)。
  //    照抄姊妹片會得到一格**永遠不觸發**的假映射,而真正的隔離閘掉進 fallback。
  it('🔴 P2B02(到貨線的隔離閘)在本表**不該**有位置', () => {
    expect(paymentFailureCodeFor('P2B02')).toBe('bug');
    expect(paymentFailureCodeFor('P8C01')).toBe('isolation');
  });
});

describe('文案', () => {
  // 型別層已保證碼與訊息一對一(Record<PaymentFailureCode, string>),這裡守的是**內容**。
  it('每個碼都拿得到非空訊息', () => {
    for (const [, code] of RPC_CODES) {
      expect(paymentFailure(code, EMPTY_PAYMENT_VALUES)).toMatchObject({ status: 'failed', code });
      const s = paymentFailure(code, EMPTY_PAYMENT_VALUES);
      expect(s.status === 'failed' && s.message.length > 0).toBe(true);
    }
  });

  it('🔴 `row_count` 必須叫員工**不要重按**(整筆已回滾,重按只會再吞一次)', () => {
    const s = paymentFailure('row_count', EMPTY_PAYMENT_VALUES);
    expect(s.status === 'failed' && s.message).toContain('不要重複按');
  });

  it('🔴 `error` **不可以**叫員工重試 —— 那筆可能已經 commit', () => {
    const s = paymentFailure('error', EMPTY_PAYMENT_VALUES);
    expect(s.status === 'failed' && s.message).toContain('可能已經寫進去');
    expect(s.status === 'failed' && s.message).not.toContain('請重試');
  });

  it('🔴 一碼兩義的 `received_at_out_of_range` 一句要涵蓋兩邊(拿不到 constraint 名,不能猜)', () => {
    const s = paymentFailure('received_at_out_of_range', EMPTY_PAYMENT_VALUES);
    expect(s.status === 'failed' && s.message).toContain('未來');
    expect(s.status === 'failed' && s.message).toContain('成立');
  });

  it('失敗 state 原樣帶回員工打的內容', () => {
    const values = { ...EMPTY_PAYMENT_VALUES, amount: '1180', payerNote: '客人說週五匯' };
    const s = paymentFailure('rejected', values);
    expect(s.status === 'failed' && s.values).toEqual(values);
  });
});

describe('軌別', () => {
  // 🔴 寫入側恰兩軌:`card` 由 RPC 明文拒收(`20260810200000:162-166`),
  //    但**讀取側看得到 card** ⇒ 兩側集合本來就不同,不可互相對齊。
  it('本表單只做得出 bank_transfer 與 cash,沒有 card', () => {
    expect([...PAYMENT_RAILS]).toEqual(['bank_transfer', 'cash']);
    expect((PAYMENT_RAILS as readonly string[]).includes('card')).toBe(false);
  });
});

describe('🔴 丟出來的東西 → 碼(窄確認輪 MF2:分派做成機制,不留給每個 catch 自己猜)', () => {
  it('🔴 `wrote === true`(已寫入但讀不懂)⇒ error,**絕不可**是 bug', () => {
    // 通用的 catch → 'bug' 會逐字說「沒有寫入」,而錢已經在帳上 ⇒ 員工再送一次 = 重複入帳。
    const thrown = Object.assign(new Error('回傳不是物件'), { wrote: true });
    expect(paymentFailureCodeForThrown(thrown)).toBe('error');
    const s = paymentFailure(paymentFailureCodeForThrown(thrown), EMPTY_PAYMENT_VALUES);
    expect(s.status === 'failed' && s.message).toContain('可能已經寫進去');
    expect(s.status === 'failed' && s.message).not.toContain('沒有寫入');
  });

  it('帶 sqlstate 的(PaymentWriteError 形狀)⇒ 走逐碼映射', () => {
    expect(paymentFailureCodeForThrown(Object.assign(new Error('x'), { sqlstate: 'P2B41' }))).toBe(
      'refunded_state',
    );
    expect(paymentFailureCodeForThrown(Object.assign(new Error('x'), { sqlstate: '08006' }))).toBe(
      'error',
    );
    expect(paymentFailureCodeForThrown(Object.assign(new Error('x'), { sqlstate: null }))).toBe(
      'error',
    );
  });

  it('沒預期到的例外 ⇒ bug(fail-closed,不假裝知道發生什麼事)', () => {
    expect(paymentFailureCodeForThrown(new Error('boom'))).toBe('bug');
    expect(paymentFailureCodeForThrown(null)).toBe('bug');
    expect(paymentFailureCodeForThrown('字串')).toBe('bug');
  });
});

describe('🔴 文案與程式是同一條不變式(窄確認輪 MF4:兩個折面互打)', () => {
  // 🔴 `'error'` 的文案曾經逐字寫「請重新整理這張單」,而重新整理 = server 重新 render
  //    = **重鑄一把新的 request_id** ⇒ 員工照做之後再送,G8 認不出是同一次 ⇒ 第二筆收款。
  //    ⇒ 這一格釘住:那句話不准出現在**不確定**的文案裡,而且要明說重新整理的後果。
  it('🔴 「可能已經寫進去了」那句**不得**叫員工重新整理,而且要講清楚後果', () => {
    const s = paymentFailure('error', EMPTY_PAYMENT_VALUES);
    const msg = s.status === 'failed' ? s.message : '';
    expect(msg).toContain('可能已經寫進去');
    expect(msg).toContain('先不要重新整理');
    expect(msg).toContain('第二筆');
    // 「請重新整理」這個**指示**不可以出現(「先不要重新整理」是警告、不是指示)。
    expect(msg).not.toContain('請重新整理');
  });

  // 🔴🔴 Fable R4 F1:**原本這個對照組把病鎖成了契約** —— 它逐字要求 `rejected` 也叫員工重新整理,
  //    而 `P0001` 涵蓋 G8「同鍵不同內容」= 那把鍵下**已經有一筆 commit 過的收款**
  //    ⇒ 叫他重整(重鑄鍵)再送 = 第二筆入帳。⇒ 對照組只留真的「確定沒寫入」的 `bug`。
  it('確定沒寫入的 bug 仍可請他重新整理(對照組,證明上一格不是恆真)', () => {
    const s = paymentFailure('bug', EMPTY_PAYMENT_VALUES);
    expect(s.status === 'failed' && s.message).toContain('重新整理');
  });

  it('🔴 `rejected` 必須把「先看明細」排在「重新整理」前面(P0001 含 G8 同鍵不同內容)', () => {
    const s = paymentFailure('rejected', EMPTY_PAYMENT_VALUES);
    const msg = s.status === 'failed' ? s.message : '';
    // 🔴 錨從逐字的「先看收款明細」放寬成「收款明細」+ 順序 —— 片2a 在中間插了方位詞
    //    (「先看**上方的**收款明細」,code-reviewer must-fix 2)⇒ 原錨被自己的正確修法打斷。
    //    守的東西沒變:**要先叫他看明細,確認過才准重整**。錨釘在會變的措辭上,改字就會假紅。
    expect(msg).toContain('收款明細');
    expect(msg.indexOf('收款明細')).toBeLessThan(msg.indexOf('重新整理'));
    // 前提自斷言:訊息裡真的有「重新整理」(否則 indexOf 回 -1,上面那條會恆真)。
    expect(msg).toContain('重新整理');
  });
});
