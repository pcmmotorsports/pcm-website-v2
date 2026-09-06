// ⟦b4-TAPPAYDIRECT⟧ 片 B · B2:補登旗標的判準本身。
//
// 🔴 **隔壁 `refund-ui-flag.ts` 沒有這一支** —— 它只被頁層接線測試間接量到。
//    ⇒ 那樣「旗標字面改了」與「顯示鏈斷了」會紅在同一個地方, 分不出是哪一個。
//    ⇒ 📌 本檔只釘**判準**(env 字面 → 布林), 顯示鏈另外由 B3b 的兩世界測試釘。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isRefundBackfillUiEnabled } from './refund-backfill-ui-flag';

describe('⟦b4-TAPPAYDIRECT⟧ 補登旗標', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.REFUND_BACKFILL_UI_ENABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.REFUND_BACKFILL_UI_ENABLED;
    else process.env.REFUND_BACKFILL_UI_ENABLED = saved;
  });

  it('🔴 沒設 ⇒ 關(fail-closed 方向)', () => {
    delete process.env.REFUND_BACKFILL_UI_ENABLED;
    expect(isRefundBackfillUiEnabled()).toBe(false);
  });

  it("🟢 恰 '1' ⇒ 開", () => {
    process.env.REFUND_BACKFILL_UI_ENABLED = '1';
    expect(isRefundBackfillUiEnabled()).toBe(true);
  });

  // 🔴 **這一格是那條血**:隔壁檔頭逐字記著「一邊認 '1' 一邊認 'true'」的失效模式
  //    ⇒ 這裡把 'true' 釘成【關】, 免得有人「順手也認 true」而兩邊字面再次分家。
  it.each(['true', 'TRUE', 'yes', '0', '', ' 1', '1 ', '01'])(
    "🛑 %o 一律當【關】—— 不得順手放寬字面",
    (v) => {
      process.env.REFUND_BACKFILL_UI_ENABLED = v;
      expect(isRefundBackfillUiEnabled()).toBe(false);
    },
  );

  // 🔵 與退款入口那支旗標**互不相干**:開了退款入口不會順帶開補登入口。
  //    ⇒ 兩者風險方向相反(見本旗標檔頭), 共用一個就沒辦法只開安全的那一半。
  it('🔵 REFUND_UI_ENABLED 開著也不會讓補登入口打開', () => {
    const savedRefund = process.env.REFUND_UI_ENABLED;
    try {
      process.env.REFUND_UI_ENABLED = '1';
      delete process.env.REFUND_BACKFILL_UI_ENABLED;
      expect(isRefundBackfillUiEnabled()).toBe(false);
    } finally {
      if (savedRefund === undefined) delete process.env.REFUND_UI_ENABLED;
      else process.env.REFUND_UI_ENABLED = savedRefund;
    }
  });
});
