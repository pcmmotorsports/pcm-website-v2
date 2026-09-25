import { describe, expect, it } from 'vitest';
import { DEALER_DECISION_MESSAGE, dealerDecisionCodeFor } from './dealer-application-decision';

// 20260926100000:經銷審核對已停用會員回 CUSTOMER_DISABLED(Fable 第 4 片 R1 應修 6)
describe('經銷審核結果對照', () => {
  it('🔴 CUSTOMER_DISABLED ⇒ customer_disabled, 文案說明沒有核准', () => {
    expect(dealerDecisionCodeFor('CUSTOMER_DISABLED')).toBe('customer_disabled');
    expect(DEALER_DECISION_MESSAGE.customer_disabled.text).toBe('這位會員已停用，請先恢復再審核。這次沒有核准。');
  });
  it('既有結果照舊', () => {
    expect(dealerDecisionCodeFor('APPROVED')).toBe('approved');
    expect(dealerDecisionCodeFor('WOULD_DOWNGRADE')).toBe('would_downgrade');
    expect(dealerDecisionCodeFor('???')).toBe('unknown');
  });
});
