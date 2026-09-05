import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANUAL_ORDER_SOURCES_FOR_EMAIL } from './notification-fallback';

/**
 * 🔴🔴 **同一組值域住在兩層,而它們會各自漂。**
 *
 * ```
 * TS  packages/domain/src/order/notification-fallback.ts     ← 四支 use-case 讀它
 * SQL supabase/migrations/20260905210000_..._off_scan_surface.sql ← 四支 view 的收錄述詞
 * ```
 * 🛑 兩份各自為真時**沒有任何東西會紅** —— 而漂開的症狀是:
 * 一種來源在 SQL 那層被排除、在 TS 那層照舊寄(或反過來)⇒ **一封該寄的信沒寄, 或一封不該寄的寄了**。
 * ⇒ 📌 這一格就是那個機械綁定(codex ③ 升成 must-fix 的那一條)。
 *
 * ## ⚠️ 它【證不到】什麼
 * - 它比的是**字面**:SQL 檔裡那串 `'manual_phone', 'manual_line', 'manual_other'`
 *   對 TS 的陣列。它答得出「兩邊列的值一樣嗎」,**答不出「兩邊的邏輯一樣嗎」**
 *   (例如 SQL 那條 `IS NULL` 的處理 —— 那一格由探針格16 答)。
 * - 它讀的是**那一支 migration 的檔案**;若有人**再開一支新的** migration 改掉那個述詞,
 *   這一格**看不到** —— 它綁的是這一支,不是「正式庫現在跑的那一版」。
 */
describe('SQL 與 TS 的 manual_* 值域要一致(兩份會各自漂)', () => {
  const MIG = resolve(
    __dirname,
    '../../../../supabase/migrations/20260905210000_m4b_manual_no_email_off_scan_surface.sql',
  );
  const sql = readFileSync(MIG, 'utf8');

  it('🔴 SQL 那串值域逐字等於 TS 的陣列', () => {
    // 只認【碼那一行】(行首八個空白),不認註解裡提到的 —— 註解會提到它而不是宣告它。
    const lines = sql
      .split('\n')
      .filter((l) => /^ {5}OR o\.order_source NOT IN \(/.test(l));
    expect(lines.length, '🔴 SQL 裡找不到那條 NOT IN(或它的形狀被改了)⇒ 這一格量不到東西').toBe(4);

    const expected = `OR o.order_source NOT IN (${MANUAL_ORDER_SOURCES_FOR_EMAIL.map(
      (v) => `'${v}'`,
    ).join(', ')})`;
    for (const l of lines) {
      expect(
        l.trim(),
        '🔴 SQL 那串與 TS 的陣列不一樣了 ⇒ 兩層對同一種來源會給不同答案',
      ).toBe(expected);
    }
  });

  it('🟢 正對照:同一把尺餵一個 SQL 裡一定有的形狀 ⇒ 找得到', () => {
    expect(sql).toContain('pcm_manual_no_email_excluded');
  });

  it('🔵 負對照:一個現造的來源值不得出現在 SQL 裡', () => {
    expect(sql).not.toContain('zzz_never_a_source_xyz');
  });
});
