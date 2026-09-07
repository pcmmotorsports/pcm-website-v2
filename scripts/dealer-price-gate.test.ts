import { describe, expect, it } from 'vitest';
import {
  DEALER_PRICE_GATE,
  resolveGate,
  runOutcome,
  type DealerPriceGateAction,
  type DealerPriceGateReason,
} from './dealer-price-gate';

/**
 * 🔴 **這支測試存在的理由不是「覆蓋率」** —— 是把「停法互相打架」變成【會紅的東西】。
 * plan 改了七輪,R6 / R7 兩輪連續抓到「一段寫 abort、另一段寫不得 abort」;
 * 📌 **prose 不會因為互斥而紅,而一個封閉集合會。**
 */

const ALL_REASONS: readonly DealerPriceGateReason[] = [
  'upstream_key_not_unique',
  'illegal_key',
  'missing_over_threshold',
  'checksum_mismatch',
  'old_values_read_short',
  'local_key_not_unique',
  'missing_upstream_url',
  'value_out_of_range',
];

describe('每個觸發條件各一格 —— 少一格或多一格都會紅', () => {
  it('🔴 表的鍵集合 = ALL_REASONS(有人加了條件而沒配動作 ⇒ 這格紅)', () => {
    expect(Object.keys(DEALER_PRICE_GATE).sort()).toEqual([...ALL_REASONS].sort());
  });

  // 🔵 逐條釘死。改任何一格都要有人來改這裡 —— 那正是我們要的摩擦。
  const EXPECTED: Record<DealerPriceGateReason, DealerPriceGateAction> = {
    upstream_key_not_unique: 'A1_carry_old',
    illegal_key: 'A1_carry_old',
    missing_over_threshold: 'A1_carry_old',
    checksum_mismatch: 'A1_carry_old',
    old_values_read_short: 'A2_skip_family',
    local_key_not_unique: 'A2_skip_family',
    missing_upstream_url: 'A2_skip_family',
    value_out_of_range: 'report_only',
  };
  for (const r of ALL_REASONS) {
    it(`${r} ⇒ ${EXPECTED[r]}`, () => {
      expect(DEALER_PRICE_GATE[r]).toBe(EXPECTED[r]);
    });
  }
});

describe('🛑 B 型(停整支 job)不存在 —— 這一格就是那句話的機制', () => {
  it('沒有任何條件會停掉整支 job', () => {
    const actions = new Set(Object.values(DEALER_PRICE_GATE));
    // 三個值以外的任何值都會讓這格紅;新增第四種停法的人會在這裡被擋下
    expect([...actions].sort()).toEqual(['A1_carry_old', 'A2_skip_family', 'report_only']);
  });
});

describe('多條件收斂:取最保守', () => {
  it('沒有條件 ⇒ null(正常寫入)', () => {
    expect(resolveGate([])).toBeNull();
  });
  it('A1 + report ⇒ A1', () => {
    expect(resolveGate(['illegal_key', 'value_out_of_range'])).toBe('A1_carry_old');
  });
  it('A1 + A2 ⇒ A2(A2 較保守)', () => {
    expect(resolveGate(['illegal_key', 'old_values_read_short'])).toBe('A2_skip_family');
  });
  it('🔴 只有 report ⇒ report_only(不得升級成停 —— 值域怪不是我們算錯)', () => {
    expect(resolveGate(['value_out_of_range'])).toBe('report_only');
  });
  it('全部條件一起 ⇒ A2', () => {
    expect(resolveGate(ALL_REASONS)).toBe('A2_skip_family');
  });
});

describe('結果標籤:A2 命中過就不得報成功', () => {
  it('A2 ⇒ degraded', () => expect(runOutcome('A2_skip_family')).toBe('degraded'));
  it('A1 ⇒ success', () => expect(runOutcome('A1_carry_old')).toBe('success'));
  it('report_only ⇒ success', () => expect(runOutcome('report_only')).toBe('success'));
  it('null ⇒ success', () => expect(runOutcome(null)).toBe('success'));
});

describe('🔴 非對稱世界(mail 快篩 N5:只餵對稱世界那型)', () => {
  it('{A2, report} 而【沒有 A1】⇒ 仍要收斂成 A2', () => {
    // 🛑 原本的多條件測試每一組都含 A1 ⇒ 那條 if 就算刪掉也可能綠。這一格專門補那個縫。
    expect(resolveGate(['old_values_read_short', 'value_out_of_range'])).toBe('A2_skip_family');
  });
  it('{A1, report} 而【沒有 A2】⇒ A1', () => {
    expect(resolveGate(['upstream_key_not_unique', 'value_out_of_range'])).toBe('A1_carry_old');
  });
  it('只有一個 A2 條件(單元素)⇒ A2', () => {
    expect(resolveGate(['missing_upstream_url'])).toBe('A2_skip_family');
  });
});
