import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isOrderShipBlocked } from './SupabaseShippedEmailContextAdapter';

/**
 * P0-1 片 4b:「這張單還能不能再出貨」有兩份判準 —— SQL `pcm_order_ship_blocked`(出貨守門用)與
 * TS `isOrderShipBlocked`(出貨信「其餘商品會另外通知」那句用)。兩份各自漂, 信就會和守門說不同的話。
 *
 * ⚠️ 射程:比的是 migration 檔的字面, 不是正式庫裡那支函式現在的樣子;SQL 換寫法(例如改成 CASE)⇒ 這一格會紅,
 *    那是刻意的:看不懂就停下來重看, 不安靜放行。
 */

const MIGRATION = path.join(
  __dirname,
  '../../../../supabase/migrations/20260916000000_m4b_p01_ship_guards_block_cancelled_and_refunded.sql',
);

/** 只取 `CREATE FUNCTION public.pcm_order_ship_blocked` 那一支的 `$fn$ … $fn$` 本體, 並剝掉 `--` 註解。 */
function sqlBody(): string {
  const whole = readFileSync(MIGRATION, 'utf8');
  const start = whole.indexOf('CREATE FUNCTION public.pcm_order_ship_blocked(');
  if (start < 0) throw new Error('migration 裡找不到 pcm_order_ship_blocked 的 CREATE FUNCTION —— 名稱或檔案換了, 回來重看這一格');
  const m = whole.slice(start).match(/\$fn\$([\s\S]*?)\$fn\$/);
  if (!m) throw new Error('找不到 pcm_order_ship_blocked 的 $fn$ 本體');
  return m[1]!
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

describe('P0-1 片 4b:出貨判準 SQL pcm_order_ship_blocked vs TS isOrderShipBlocked', () => {
  /**
   * 🔴 釘住【整個本體】(codex 4b R1 should-fix):只數 RETURN 與找兩句條件字面擋不住改寫 ——
   *    條件包進 `IF FALSE`、SELECT 改讀 `NULL AS cancelled_at`、多一個 `RETURN lower(...)` 都能全綠。
   *    ⇒ 本體(剝 -- 註解、壓空白)的 md5 對不上就紅:改 SQL 的人必須回來看 TS 那份要不要跟著改, 再更新這個值。
   */
  it('SQL 本體整段釘住(任何改寫都要回來重看 TS 鏡像)', () => {
    const normalized = sqlBody().replace(/\s+/g, ' ').trim();
    expect(createHash('md5').update(normalized).digest('hex')).toBe('1c3a88db883529812eecfffa12ce6ff1');
  });

  it('SQL 恰好兩個「擋」的出口:cancelled 與 card_fully_refunded(多一條或少一條 ⇒ TS 要跟著改)', () => {
    const returns = [...sqlBody().matchAll(/RETURN '([a-z_]+)'/g)].map((m) => m[1]);
    expect(returns).toEqual(['cancelled', 'card_fully_refunded']);
  });

  it('SQL 的兩個條件字面是 TS 鏡像的那兩個', () => {
    const body = sqlBody().replace(/\s+/g, ' ');
    expect(body).toContain('IF v.cancelled_at IS NOT NULL THEN RETURN \'cancelled\'');
    expect(body).toContain('IF v.payment_method = \'tappay\' AND v.payment_status = \'refunded\' THEN RETURN \'card_fully_refunded\'');
  });

  it.each([
    [null, 'tappay', 'paid', false],
    ['2026-09-15T01:00:00Z', 'tappay', 'paid', true],
    ['2026-09-15T01:00:00Z', 'bank_transfer', 'unpaid', true],
    [null, 'tappay', 'refunded', true],
    [null, 'tappay', 'partiallyRefunded', false],
    [null, 'bank_transfer', 'refunded', false],
    [null, null, 'refunded', false],
  ])('TS:cancelled_at=%s payment_method=%s payment_status=%s ⇒ 擋=%s', (cancelledAt, method, status, blocked) => {
    expect(isOrderShipBlocked({ cancelled_at: cancelledAt, payment_method: method, payment_status: status })).toBe(blocked);
  });
});
