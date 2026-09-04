import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAYMENT_CHANNEL_VALUES } from './index';

/**
 * 🔴 **本檔存在的理由**:付款管道的白名單有兩個消費者, 而它們在**兩種語言**裡 ——
 * SQL 那一份在【擋】(RAISE), TS 這一份在【給客人選】。
 * ⇒ 「只寫一次」物理上做不到 ⇒ ✅ **而做得到的是讓它們分岔的那一刻有東西會紅。**
 */
const MIGRATION = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260904020000_m4b_create_order_payment_channel.sql',
);

describe('付款管道白名單 · 跨語言對帳', () => {
  it('🔴 TS 的 enum 與 migration 裡 SQL 的白名單必須逐字相同', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // 🔵 **先證這把尺接上了** —— 否則下面在量一個空字串。
    expect(sql).toContain('p_payment_channel NOT IN (');

    // 🔴 抓【SQL 實際寫的那些值】, 不是抓我期望的那些。
    const m = sql.match(/p_payment_channel NOT IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const inner = m![1] ?? '';
    const sqlValues = [...inner.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
    expect(sqlValues).toEqual([...PAYMENT_CHANNEL_VALUES].sort());
  });

  it('🔵 負對照:那把正規表示式抓得到【不同的】集合(否則上一格恆綠)', () => {
    // 🛑 少了這一格, 一個永遠回 [] 的抓法會讓上面那格在兩個世界都綠。
    const fake = "p_payment_channel NOT IN ('line_pay', 'cash')";
    const m = fake.match(/p_payment_channel NOT IN \(([^)]*)\)/);
    const innerFake = m![1] ?? '';
    const vals = [...innerFake.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
    expect(vals).toEqual(['cash', 'line_pay']);
    expect(vals).not.toEqual([...PAYMENT_CHANNEL_VALUES].sort());
  });
});
