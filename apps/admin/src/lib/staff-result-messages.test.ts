import { describe, expect, it } from 'vitest';
import { STAFF_RESULT_MESSAGES } from './staff-result-messages';

describe('STAFF_RESULT_MESSAGES', () => {
  it('should warn that the change succeeded when its audit write failed', () => {
    expect(STAFF_RESULT_MESSAGES.audit_failed).toEqual({
      text: '變更已生效,但稽核紀錄寫入失敗 —— 請通知維護者。',
      tone: 'warn',
    });
  });
});
