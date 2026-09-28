// coupon-revert-on-full-return-migration.test.ts —— 20260928270000(退貨收回第 4 片:全部退貨也退券)的靜態守門。
//
// 計畫:~/pcm-mailbox/計畫-退貨全退才退券-20260928.md(Sean 2026-09-28 Q5 甲、Q1 甲)。
// 行為本身在拋棄式 Postgres 驗過(13 種情況;舊版有 3 格紅:全部退貨但沒全額退款)。
// 這支釘的是「CREATE OR REPLACE 照抄舊本體、只多那兩處」:
//   · 前置閘的 md5 = 舊 migration 本體的 md5(正式庫 2026-09-28 唯讀實查相同)
//   · 新退券本體 = 舊本體 + 一個「或全部退貨」條件;新收回本體 = 舊本體 + 一行呼叫退券
//   · 退回檔把兩支換回的本體 = 舊本體,而且先換回、最後才 DROP helper
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = resolve(__dirname, '../../../../supabase/migrations');
const read = (p: string) => readFileSync(p, 'utf8');
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

/** 取 `FUNCTION public.<name>(` 之後第 nth 段 $fn$…$fn$ 的本體(= pg_proc.prosrc)。 */
function body(sql: string, name: string, nth = 0): string {
  let from = 0;
  for (let k = 0; k <= nth; k++) {
    from = sql.indexOf(`FUNCTION public.${name}(`, from) + 1;
    if (from === 0) throw new Error(`找不到 ${name} 第 ${nth + 1} 個定義`);
  }
  const a = sql.indexOf('$fn$', from) + 4;
  return sql.slice(a, sql.indexOf('$fn$', a));
}

const NEW = read(resolve(MIGRATIONS, '20260928270000_m4b_coupon_revert_on_full_return.sql'));
const RB = read(resolve(MIGRATIONS, '../rollbacks/20260928270000-rollback.sql'));
const OLD_COUPON = body(read(resolve(MIGRATIONS, '20260911170000_m4b_refund_money_moved_single_source.sql')), 'coupon_revert_on_full_refund');
const OLD_RECEIVE = body(read(resolve(MIGRATIONS, '20260927010000_m4b_order_returns.sql')), 'admin_receive_return');
// 前置閘③④ 各出現一次函式名, 本體在第一個 CREATE OR REPLACE 之後
const NEW_COUPON = body(NEW.slice(NEW.indexOf('CREATE OR REPLACE FUNCTION public.coupon_revert_on_full_refund(')), 'coupon_revert_on_full_refund');
const NEW_RECEIVE = body(NEW.slice(NEW.indexOf('CREATE OR REPLACE FUNCTION public.admin_receive_return(')), 'admin_receive_return');

describe('20260928270000 全部退貨也退券', () => {
  it('前置閘釘的 md5 = 舊 migration 本體的 md5', () => {
    expect(md5(OLD_COUPON)).toBe('49dc62fb5ebb0a1885423d24288143de');
    expect(md5(OLD_RECEIVE)).toBe('fcac06af3de5d320c7b5eaca1f87af4a');
    expect(NEW).toContain(`IS DISTINCT FROM '${md5(OLD_COUPON)}'`);
    expect(NEW).toContain(`IS DISTINCT FROM '${md5(OLD_RECEIVE)}'`);
  });

  it('事後斷言釘的 md5 = 本檔新本體的 md5', () => {
    expect(NEW).toContain(`md5(v_coup) <> '${md5(NEW_COUPON)}'`);
    expect(NEW).toContain(`md5(v_recv) <> '${md5(NEW_RECEIVE)}'`);
  });

  it('退券本體只多「或全部退貨」那個條件(其餘逐字照抄)', () => {
    const oldCond = '  IF NOT ((v_moved > 0 AND v_moved >= v_total) OR v_cancelled_at IS NOT NULL) THEN\n';
    const [before, after] = OLD_COUPON.split(oldCond);
    expect(NEW_COUPON.startsWith(before!)).toBe(true);
    expect(NEW_COUPON.endsWith(after!)).toBe(true);
    const added = NEW_COUPON.slice(before!.length, NEW_COUPON.length - after!.length);
    const code = added.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).toBe(
      '  IF NOT ((v_moved > 0 AND v_moved >= v_total) OR v_cancelled_at IS NOT NULL\n' +
        '          OR public.pcm_order_fully_returned(p_order_id)) THEN\n',
    );
  });

  it('收回本體只多一行呼叫退券,而且在狀態改成 received 之後、寫稽核之前', () => {
    const anchor = '  INSERT INTO public.admin_audit_log';
    const [before, after] = OLD_RECEIVE.split(anchor);
    expect(NEW_RECEIVE.startsWith(before!)).toBe(true);
    expect(NEW_RECEIVE.endsWith(anchor + after!)).toBe(true);
    const added = NEW_RECEIVE.slice(before!.length, NEW_RECEIVE.length - (anchor + after!).length);
    const code = added.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--')).join('\n');
    expect(code).toBe('  PERFORM public.coupon_revert_on_full_refund(v_ret.order_id);');
    expect(before).toContain("SET status = 'received'");
  });

  it('SET 子句照抄(CREATE OR REPLACE 會整組換掉)', () => {
    expect(NEW).toMatch(/coupon_revert_on_full_refund\(p_order_id pg_catalog\.uuid\)\nRETURNS integer\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = ''\nSET lock_timeout = '3s'/);
    expect(NEW).toMatch(/p_note {7}text\n\)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = ''\nSET lock_timeout = '5s'/);
  });

  it('退回檔:換回的本體 = 舊本體;先換回兩支、最後才 DROP helper', () => {
    expect(body(RB.slice(RB.indexOf('CREATE OR REPLACE FUNCTION public.coupon_revert_on_full_refund(')), 'coupon_revert_on_full_refund')).toBe(OLD_COUPON);
    expect(body(RB.slice(RB.indexOf('CREATE OR REPLACE FUNCTION public.admin_receive_return(')), 'admin_receive_return')).toBe(OLD_RECEIVE);
    const drop = RB.indexOf('DROP FUNCTION public.pcm_order_fully_returned');
    expect(drop).toBeGreaterThan(RB.indexOf('CREATE OR REPLACE FUNCTION public.coupon_revert_on_full_refund('));
    expect(drop).toBeGreaterThan(RB.indexOf('CREATE OR REPLACE FUNCTION public.admin_receive_return('));
  });

  it('helper 不開給任何角色', () => {
    expect(NEW).toContain('REVOKE ALL ON FUNCTION public.pcm_order_fully_returned(uuid) FROM PUBLIC;');
    expect(NEW).toContain('REVOKE ALL ON FUNCTION public.pcm_order_fully_returned(uuid) FROM anon, authenticated, service_role;');
    expect(NEW).not.toMatch(/GRANT[^;]*pcm_order_fully_returned/);
  });
});
