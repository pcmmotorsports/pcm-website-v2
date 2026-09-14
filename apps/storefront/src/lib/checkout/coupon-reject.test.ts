// coupon-reject.test.ts — ⟦b4-COUPONFIELD⟧ 片 D 的 TS 半。
//
// 🔴 這支守的第一件事:**本檔不得為任何一種被拒理由各寫一句**(zero_total_unsupported 例外)——
//    DB 已經把它們全部收斂成 `unavailable`(枚舉防線在 SQL 邊界),這裡分開寫等於把防線搬錯層。

import { describe, it, expect } from 'vitest';
import { COUPON_REJECTED_PREFIX, checkoutCouponFieldMessage } from './coupon-reject';

describe('checkoutCouponFieldMessage', () => {
  it('🔴 **每一種**被拒理由都講同一句 —— 細分就是券碼存在性 oracle(2026-09-14 跨片審查 high)', () => {
    const vague = '這張券不能用';
    for (const r of [
      'unavailable',
      'not_found',
      'inactive',
      'exhausted',
      'expired',
      'tier_conflict',
      'already_used_by_account',
      'below_min_spend',
      'unknown',
      '',
    ]) {
      expect(checkoutCouponFieldMessage(r), r).toBe(vague);
    }
  });

  it('🔵 零元那一種【刻意】不收斂 —— 它只有在券通過每一關之後才到得了, 講它不洩漏存在性', () => {
    expect(checkoutCouponFieldMessage('zero_total_unsupported')).not.toBe('這張券不能用');
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
});
