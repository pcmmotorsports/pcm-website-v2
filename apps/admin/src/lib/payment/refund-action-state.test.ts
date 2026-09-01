// refund-action-state.test.ts — 卡片退款失敗文案的**事實守門**(2026-09-01)。
//
// 🔴🔴 **這一支釘的不是措辭,是【每一句話在它自己那一格是不是真的】。**
//    措辭以後可以改;而「錢有沒有離開我們」是那一格的事實,不會因為換句話說而改變。
//    ⇒ 所以下面每一格都寫成「**這一句不得出現 X**」或「**必須出現 X**」,
//      而不是 `toBe('某某某某。')` —— 後者會在任何一次無害的潤稿時假紅,
//      而它守不住真正要守的東西。
//
// ══ 為什麼這支檔在 2026-09-01 才出現 ═══════════════════════════════════════
//    量到的:這幾句員工看得到的失敗文案,在**測試檔裡出現 0 次**
//    ⇒ 📌 **改它、或把它改回去,都不會有任何東西紅。**
//    而本次剛好改了兩句(`⟦b4-MONEYLINE⟧` 逐條實查的結果)——
//    🔴 **改文案而不同時補守門,等於把下一次改回去的成本也一起降到零。**
//
// ══ 🔴 最重的一格:`already_refunded` 不得說「錢沒有動」 ════════════════════
//    它的觸發條件是 `refund-actions.ts:215-216` 的 `order.paymentStatus === 'refunded'`
//    ⇒ **這張單已經全額退款過 ⇒ 錢動過。**
//    ⇒ 補「錢沒有動」⇒ 員工以為客人沒收到 ⇒ **他會再退一次。**
//    ⇒ 📌 那不是文案不精確,是**一句會導致重複退款的文案**。

import { describe, expect, it } from 'vitest';

import { refundFailure, type RefundFailureCode } from './refund-action-state';

const INPUT = { amount: '100', reason: '測試', confirmCode: '1234' } as const;
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function messageOf(code: RefundFailureCode): string {
  const out = refundFailure(code, INPUT as never, TOKEN);
  if (out.status !== 'failed') throw new Error(`${code} 應該是 failed`);
  return out.message;
}

const MONEY_LINE = '錢沒有動';
const NOT_INITIATED = '退款沒有發起';

describe('🔴 錢動過的那一格,不得說錢沒有動', () => {
  it('already_refunded 不得出現「錢沒有動」', () => {
    const msg = messageOf('already_refunded');
    // 🔵 正向對照:這一句真的有內容,不是空字串讓下面的否定式恆真。
    expect(msg.length).toBeGreaterThan(10);
    expect(msg).not.toContain(MONEY_LINE);
  });

  it('already_refunded 應該說「退款沒有發起」(前半是真的)', () => {
    expect(messageOf('already_refunded')).toContain(NOT_INITIATED);
  });
});

describe('🔴 錢狀態【不知道】的那些格,兩句都不得出現', () => {
  // 這三條在 RPC 之【後】才產生:in_flight(有一筆正在處理中)、
  // held(TapPay 已受理而金額不符)、unknown_state(請求可能已送達 TapPay)。
  // ⇒ 說「動了」或「沒動」都是在假裝知道。
  // ⚠️ `error` / `bug` 也在這一族,而它們更糟:一句話涵蓋好幾個世界
  //    (`refund-actions.ts:206` RPC 前 vs `:435` 回應斷在路上;`:430` vs `:603` vs `:676`)
  //    ⇒ 那一句話沒有資格回答「錢動了沒」。
  const UNKNOWN: RefundFailureCode[] = ['in_flight', 'held', 'unknown_state', 'error', 'bug'];

  it('五條都不得出現「錢沒有動」', () => {
    for (const code of UNKNOWN) {
      const msg = messageOf(code);
      expect(msg.length, `${code} 應該有文案`).toBeGreaterThan(10);
      expect(msg, `${code} 不得宣稱錢沒有動`).not.toContain(MONEY_LINE);
    }
  });
});

describe('🟢 錢確實沒動的那一格,兩半都要說', () => {
  it('no_card_transaction 兩句都在', () => {
    const msg = messageOf('no_card_transaction');
    expect(msg).toContain(NOT_INITIATED);
    expect(msg).toContain(MONEY_LINE);
  });
});

describe('🔵 對照:這把尺確實分得出兩種世界', () => {
  // 🔴 沒有這一格的話,上面每一條否定式都可能是因為【尺根本找不到那四個字】而過。
  //    ⇒ 那正是今晚全隊撞了八次的形狀:一把沒接上的尺,印出來的永遠是「沒問題」。
  it('至少有一條文案【真的】帶著「錢沒有動」四個字', () => {
    const withMoneyLine = (
      ['no_card_transaction', 'db_config'] as RefundFailureCode[]
    ).filter((c) => messageOf(c).includes(MONEY_LINE));
    expect(withMoneyLine.length).toBeGreaterThan(0);
  });

  it('負對照:現造的字串一條都不會命中', () => {
    const ALL: RefundFailureCode[] = [
      'already_refunded',
      'no_card_transaction',
      'in_flight',
      'held',
      'unknown_state',
      'error',
      'bug',
    ];
    for (const code of ALL) {
      expect(messageOf(code), `${code}`).not.toContain('ZZQ不存在的字串');
    }
  });
});
