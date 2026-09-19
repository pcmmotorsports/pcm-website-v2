// ── 🔴 ⟦5b-RETRYNOEXIT1⟧ 「稍後可再試一次。」沒有出口 —— 而它住在【兩張表】────────────
//
// 🔴 **本檔存在的理由是一個量到的事實**:`record_unavailable` 這個碼同時出現在
//    · `refund-action-state.ts`    (發起退款那條路)
//    · `refund-recovery-state.ts`  (異常回收那條路)
//    兩句都以「稍後可再試一次。」結尾, 而既有那道欠債守門
//    (`refund-action-state.test.ts:192`)**只掃第一張表** ⇒ 修好一張, 另一張沒有任何東西在守。
// 🎯 **所以這一格釘的是「兩張表一起」** —— 那正是「修 A 而 B 還在說同一句沒出口的話」那個形狀。
//
// 🛑 **不釘措辭, 釘結構**:有「再試 / 重新整理」⇒ 必須有「還是不行怎麼辦」。
//    出口字彙沿用既有那道閘的同一張表(`refund-action-state.test.ts:198`), 不自創第三套。
import { describe, expect, it } from 'vitest';
import { judgeFailure, type RecoveryFailureCode } from './refund-recovery-state';
import { refundFailure, type RefundFailureCode } from './refund-action-state';

// 🔵 形狀抄 `refund-action-state.test.ts:32`(那支 union 要先窄化才讀得到 `.message`),
//    不自己另發明一種取訊息的方式。
const INPUT = { amount: '100', reason: '測試', confirmCode: '1234' } as const;
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
// 🔴 `RefundJudgeState` 也是 discriminated union ⇒ 直接讀 `.message` typecheck 會紅
//    (與 `refund-action-state.test.ts:40` 記的是同一件事)⇒ 這裡同樣先窄化。
function recoveryMessageOf(code: RecoveryFailureCode): string {
  const out = judgeFailure(code);
  if (out.status !== 'failed') throw new Error(`${code} 應該是 failed`);
  return out.message;
}

function messageOf(code: RefundFailureCode): string {
  const out = refundFailure(code, INPUT as never, TOKEN);
  if (out.status !== 'failed') throw new Error(`${code} 應該是 failed`);
  return out.message;
}

const RETRY = /重新整理|再試/;
const EXIT = /若仍|仍然|勿反覆|勿直接重發|勿重發|通知系統維護|請勿重試|回報它的現況|超過/;

describe('⟦5b-RETRYNOEXIT1⟧ 叫人重試的話, 兩張表都要有出口', () => {
  it('發起那條路的 record_unavailable 有出口', () => {
    const msg = messageOf('record_unavailable');
    expect(RETRY.test(msg), '這句本來就在叫人再試').toBe(true);
    expect(EXIT.test(msg), `沒有出口:${msg}`).toBe(true);
  });

  it('回收那條路的 record_unavailable 有出口', () => {
    const msg = recoveryMessageOf('record_unavailable');
    expect(RETRY.test(msg), '這句本來就在叫人再試').toBe(true);
    expect(EXIT.test(msg), `沒有出口:${msg}`).toBe(true);
  });

  // ⚪ 負對照:一句「叫人重試而沒有出口」必須被這兩把尺抓到 ——
  //    否則上面兩格在「出口 regex 壞掉」時會恆綠。
  it('負對照:現造一句沒有出口的重試指示 ⇒ 這把尺要判它違規', () => {
    const fake = '查不到,稍後可再試一次。';
    expect(RETRY.test(fake) && !EXIT.test(fake)).toBe(true);
  });

  // 🔴 而兩句都不准出現 Markdown 星號 —— 畫面是純文字輸出, 員工會看到兩個星號
  //    (成因與 ⟦b4-PCM03STARS⟧ 同一族, 那一列已經記過)。
  it('兩句都不含 Markdown 星號', () => {
    expect(messageOf('record_unavailable')).not.toContain('**');
    expect(recoveryMessageOf('record_unavailable')).not.toContain('**');
  });
});
