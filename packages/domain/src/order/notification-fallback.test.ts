import { describe, expect, it } from 'vitest';

import type { OrderSource } from './types';
import {
  MANUAL_ORDER_SOURCES_FOR_EMAIL,
  suppressCustomerEmailFallback,
} from './notification-fallback';

describe('手動建單留白 = 不寄 —— 判準的兩邊都要有格', () => {
  it('🔴 三種 manual_* 都要擋掉 fallback(只測一種的話,寫死 === manual_phone 會全綠)', () => {
    for (const s of MANUAL_ORDER_SOURCES_FOR_EMAIL) {
      expect(suppressCustomerEmailFallback(s), s).toBe(true);
    }
    // 🔵 而「三種」本身也是一個宣稱 —— 少一種時上面那個迴圈會安靜地少跑一圈。
    expect(MANUAL_ORDER_SOURCES_FOR_EMAIL).toHaveLength(3);
  });

  it('🟢 正對照:顧客站(web)不得被擋 —— 否則真客人的信會靜靜不寄', () => {
    expect(suppressCustomerEmailFallback('web')).toBe(false);
  });

  /**
   * 🔴 fail 方向釘死。`null` / `undefined` 的意思是「view 沒給」,不是「這張單沒有來源」。
   * 🛑 反過來寫會讓一個 `null` 把真的顧客站訂單靜默不寄,而「沒寄」在畫面上沒有形狀。
   * 📌 兩個方向都會錯,而錯的代價不對稱:多寄一封看得見,少寄一封看不見。
   */
  it('🔴 不知道來源(null / undefined)⇒ 照舊寄,不是不寄', () => {
    expect(suppressCustomerEmailFallback(null)).toBe(false);
    expect(suppressCustomerEmailFallback(undefined)).toBe(false);
  });

  it('🔵 負對照:一個現造的來源值 ⇒ 不擋(白名單,不是黑名單)', () => {
    expect(suppressCustomerEmailFallback('zzz_never_a_source')).toBe(false);
    // 🔵 而前綴像 manual 的也不算 —— 具名清單擋得住,`startsWith('manual_')` 擋不住。
    expect(suppressCustomerEmailFallback('manual_whatever')).toBe(false);
  });

  /**
   * 🔴🔴 這一格才是那條「白名單不是黑名單」真正的守門:
   * 它把清單對著 `OrderSource` 的成員比 —— **加第四種來源時它會紅**,
   * 直到有人決定那一種該走哪一邊。
   *
   * ⚠️ 而它比的是**我在測試裡寫死的那一份**,不是型別本身(型別在執行期不存在)。
   * ⇒ 📌 它擋的是「有人改了 `OrderSource` 而沒回來看這裡」,
   *    擋不了「有人同時改了兩邊」—— 後者沒有機械守門,只有 review。
   */
  it('🔴 OrderSource 的成員全部都要被分過邊(加第四種來源 ⇒ 這一格紅)', () => {
    const allSources: readonly OrderSource[] = [
      'web',
      'manual_phone',
      'manual_line',
      'manual_other',
    ];
    const suppressed = allSources.filter((s) => suppressCustomerEmailFallback(s));
    const kept = allSources.filter((s) => !suppressCustomerEmailFallback(s));
    expect(suppressed).toEqual(['manual_phone', 'manual_line', 'manual_other']);
    expect(kept).toEqual(['web']);
    // 🔵 兩堆加起來要等於全部 —— 少了這一句,一個「兩邊都沒進」的值不會有人發現。
    expect(suppressed.length + kept.length).toBe(allSources.length);
  });
});
