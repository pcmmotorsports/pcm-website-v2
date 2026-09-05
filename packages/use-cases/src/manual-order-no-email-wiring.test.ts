import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { suppressCustomerEmailFallback } from '@pcm/domain';

/**
 * 🔴🔴 **跨檔接線:「手動建單留白 = 不寄」的兩半, 中間那一段沒有人守。**
 *
 * ```
 * E 那半(-account)  表單留白 ⇒ 送 `p_notification_email: null` 進第 11 參
 * 我這半(片 C)      讀 view 的 order_source ⇒ manual_* 且信箱為空 ⇒ 不寄
 * 🔴 而【兩半各自綠不等於接上】—— 每支測試的分母是它自己那支檔。
 * ```
 * 📌 本檔就是那個分母:它**同時**看兩半, 而任一半自己改壞時它會紅。
 *
 * ## ⚠️ 它【證不到】什麼(先讀這段)
 * - 它讀的是**原始碼字面**, 不是跑起來的行為 ⇒ 它答得出「兩半有沒有對接上」,
 *   答不出「真的沒寄出去」(那要真跑, 而那要真的 DB + 真的收件匣)。
 * - 它不驗 view 有沒有把 `order_source` 帶出來(那是 adapter 那層, 有自己的格)。
 * - 🔴 **它只在兩半都在同一棵樹上時才有意義** —— 而那正是它的價值:
 *   E 若被退版、或有人把那一行改掉, 這一格會紅,而**兩邊各自的測試都不會**。
 */
describe('跨檔接線:手動建單留白 = 不寄(兩半合起來才成立)', () => {
  const REPO_ROOT = resolve(__dirname, '../../..');
  const E_HALF = resolve(REPO_ROOT, 'apps/admin/src/lib/orders/manual-order-repository.ts');

  const eSource = readFileSync(E_HALF, 'utf8');

  it('🔴 E 那半:建單 RPC 要送 p_notification_email(少了它, 留白根本傳不下去)', () => {
    expect(
      eSource,
      '🔴 apps/admin/.../manual-order-repository.ts 沒有送 p_notification_email ⇒ ' +
        '表單就算有那個欄位, 值也到不了資料庫 ⇒ 我這半永遠看到空的, 而那看起來像「一切正常」',
    ).toContain('p_notification_email');
    // 🟢 正對照:同一把尺問一個一定在的參數 —— 它若也找不到, 上面那一格沒有意義。
    expect(eSource, '🟢 正對照失敗 ⇒ 這把尺沒接上那支檔').toContain('p_lines');
    // 🔵 負對照:一個現造的參數名必須找不到。
    expect(eSource).not.toContain('p_zzz_never_a_param');
  });

  it('🔴 E 那半:留白要送 null, 不得送空字串', () => {
    // 🛑 空字串會被 `orders_notification_email_valid` 擋掉 ⇒ **整張單建不出來**,
    //    而那個症狀(建單失敗)與「不寄」完全不同 —— 員工會以為系統壞了。
    expect(
      eSource,
      '🔴 找不到「送 null 不送空字串」那一句 ⇒ 留白這條路的形狀沒有被寫下來',
    ).toMatch(/null.*不寄|不要送空字串/);
  });

  it('🔴 我這半:四支 use-case 都要用【同一份】判準', () => {
    const files = [
      'enqueue-order-created-emails.ts',
      'enqueue-order-shipped-emails.ts',
      'enqueue-order-unpaid-cancelled-emails.ts',
      'enqueue-tracking-corrected-emails.ts',
    ];
    const missing = files.filter(
      (f) => !readFileSync(resolve(__dirname, f), 'utf8').includes('suppressCustomerEmailFallback'),
    );
    expect(
      missing,
      `🔴 這幾支沒有用共用判準 ⇒ 它們會各自漂:${missing.join(', ')}`,
    ).toEqual([]);
    // 🔵 而「四支」本身也是一個宣稱 —— 少一支時上面那個 filter 會安靜地少檢查一支。
    expect(files).toHaveLength(4);
  });

  it('🔴 兩半對接的那個值:E 送 null ⇒ 我這半判「不寄」', () => {
    // E 送進資料庫的是 null;view 撈出來給我的就是 null。
    // 而我的判準要的是【兩個條件】—— 來源是 manual_*, 而且信箱為空。
    for (const src of ['manual_phone', 'manual_line', 'manual_other']) {
      expect(suppressCustomerEmailFallback(src), src).toBe(true);
    }
    // 🟢 而顧客站那條路不得被影響 —— E 那半根本不碰它。
    expect(suppressCustomerEmailFallback('web')).toBe(false);
  });
});
