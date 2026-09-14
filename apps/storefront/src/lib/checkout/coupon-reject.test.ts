// coupon-reject.test.ts — ⟦b4-COUPONFIELD⟧ 片 D 的 TS 半。
//
// 🔴 這支守的第一件事:**本檔不得為 not_found / inactive / exhausted 各寫一句** ——
//    DB 已經把那三種收斂成 `unavailable`(枚舉防線在 SQL 邊界),這裡分開寫等於把防線搬錯層、
//    而且永遠不會被觸發(DB 根本不送那三個字串上來)。

import { describe, it, expect } from 'vitest';
import { COUPON_REJECTED_PREFIX, checkoutCouponFieldMessage, isDomainCouponReason } from './coupon-reject';

describe('checkoutCouponFieldMessage', () => {
  it('🟢 講得出口的四種各講各的', () => {
    expect(checkoutCouponFieldMessage('expired')).toBe('這張券已經過期了');
    expect(checkoutCouponFieldMessage('tier_conflict')).toBe('這張券不適用你目前的會員價');
    expect(checkoutCouponFieldMessage('already_used_by_account')).toBe('你已經用過這張券了');
    expect(checkoutCouponFieldMessage('below_min_spend')).toBe('這張券有最低消費門檻,目前還沒達到');
  });

  it('🔴 unavailable(= DB 收斂過的那三種)與認不得的字串 ⇒ 同一句籠統的', () => {
    const vague = checkoutCouponFieldMessage('unavailable');
    expect(vague).toBe('這張券不能用');
    expect(checkoutCouponFieldMessage('')).toBe(vague);
    expect(checkoutCouponFieldMessage('something_new_from_db')).toBe(vague);
    // 🔴 萬一 DB 哪天又把原始理由送上來:仍然是同一句, 不會在這裡漏出去
    expect(checkoutCouponFieldMessage('not_found')).toBe(vague);
    expect(checkoutCouponFieldMessage('inactive')).toBe(vague);
    expect(checkoutCouponFieldMessage('exhausted')).toBe(vague);
  });

  it('🟢 整筆折到 0:講清楚而且告訴他怎麼辦(不是「請稍後再試」)', () => {
    const m = checkoutCouponFieldMessage('zero_total_unsupported');
    expect(m).toContain('折到 0');
    expect(m).toContain('拿掉券');
    expect(m).not.toContain('稍後再試');
  });

  it('🔵 前綴與 migration 那一側逐字相同(改一邊就會斷)', () => {
    expect(COUPON_REJECTED_PREFIX).toBe('coupon_rejected:');
  });

  it('🔵 unavailable 不是 domain 的理由之一 —— 兩個集合刻意不同', () => {
    expect(isDomainCouponReason('unavailable')).toBe(false);
    expect(isDomainCouponReason('expired')).toBe(true);
  });
});
