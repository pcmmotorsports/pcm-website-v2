// total.test.ts — #953:TS 那一份等式 ≡ SQL 那一份(parity),而且「把稅拿掉 ⇒ 必須紅」。
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderTotal } from './total';

const ROOT = resolve(__dirname, '../../../..');
const CHECK_MIG = resolve(ROOT, 'supabase/migrations/20260828100000_m4b_b1_orders_tax_and_invoice_requested.sql');

describe('orderTotal — 四個數怎麼加', () => {
  it('四項全帶:1000 + 100 − 50 + 53 = 1103', () => {
    expect(orderTotal({ subtotal: 1000, shippingFee: 100, discountTotal: 50, taxTotal: 53 })).toBe(1103);
  });

  it('🔴 突變格:把稅拿掉的舊式等式 ≠ orderTotal —— 這一格紅,代表有人把 + taxTotal 刪了', () => {
    const p = { subtotal: 1000, shippingFee: 100, discountTotal: 50, taxTotal: 53 };
    const oldStyle = p.subtotal + p.shippingFee - p.discountTotal;
    expect(orderTotal(p)).not.toBe(oldStyle);
    expect(orderTotal(p) - oldStyle).toBe(p.taxTotal);
  });

  it('🔵 負對照:稅 0 ⇒ 與舊式相同(舊呼叫端零行為差)', () => {
    expect(orderTotal({ subtotal: 1000, shippingFee: 100, discountTotal: 50, taxTotal: 0 })).toBe(1050);
  });
});

describe('parity:TS 函式體 ≡ SQL 那一句(兩份會各自漂)', () => {
  // 🔴 codex R1/R2 must-fix:不能只問「整份檔含不含那串字」——
  //   ① 舊句留在 `--` 或 `/* */` 註解裡 ⇒ 兩種註解都剝掉;
  //   ② 同檔先建對的再 DROP 重建成錯的 ⇒ 取【最後一個】orders_total_balances 定義(大小寫不分);
  //   ③ 正規化不能「刪掉不認得的東西」(`* 2`、`OR true`、括號都會被刪成看起來一樣)⇒ 改成 tokenizer,
  //      只認四個欄名 + `+`/`-` + `::bigint/::integer`,其他 token 一律判不等;
  //   ④ P1 用【內容】找 `FUNCTION public.pcm_order_total(`,不靠檔名;多份取最後一份(最新代)。
  const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const COL: Record<string, string> = {
    subtotal: 'B', shipping_fee: 'S', discount_total: 'D', tax_total: 'T',
    shippingfee: 'S', discounttotal: 'D', taxtotal: 'T',
  };
  /** 回 token 序列;遇到不認得的 token 回 null(⇒ 任何比對都不等)。 */
  const tokens = (expr: string): string | null => {
    const out: string[] = [];
    for (const raw of expr.replace(/::(bigint|integer)/g, '').trim().split(/\s+/)) {
      if (raw === '+' || raw === '-') { out.push(raw); continue; }
      const id = raw.replace(/^(p_|p\.)/, '').toLowerCase();
      const c = COL[id];
      if (!c) return null;
      out.push(c);
    }
    return out.join(' ');
  };
  const TS_EXPR = 'p.subtotal + p.shippingFee - p.discountTotal + p.taxTotal';
  const EXPECT = 'B + S - D + T';

  const tsLine = readFileSync(resolve(__dirname, 'total.ts'), 'utf8')
    .split('\n')
    .find((l) => l.includes('return p.subtotal'));

  it('🔴 TS 那一行逐字就是四項同序的等式', () => {
    expect(tsLine?.trim()).toBe(`return ${TS_EXPR};`);
    expect(tokens(TS_EXPR)).toBe(EXPECT);
  });

  it('🔴 B1 那支 migration 裡【最後一個會執行的】orders_total_balances CHECK 運算式 ≡ TS', () => {
    const sql = stripSqlComments(readFileSync(CHECK_MIG, 'utf8'));
    const all = [...sql.matchAll(/constraint\s+orders_total_balances\s+check\s*\(\s*total\s*=\s*([^()]+)\)/gi)];
    expect(all.length, 'CHECK 定義找不到(被改名或搬走了?)').toBeGreaterThan(0);
    const last = all[all.length - 1]?.[1] ?? '';
    expect(tokens(last), `CHECK 運算式含不認得的 token:${last}`).toBe(EXPECT);
  });

  it('🔴 P1 的 pcm_order_total() 若已落地(以內容找、取最新一代),函式體 ≡ TS;沒落地 ⇒ 明確 skip', () => {
    const dir = resolve(ROOT, 'supabase/migrations');
    const withFn = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => /FUNCTION\s+public\.pcm_order_total\s*\(/i.test(stripSqlComments(readFileSync(resolve(dir, f), 'utf8'))));
    if (withFn.length === 0) {
      console.info('[total.test] P1 pcm_order_total 尚未落地 ⇒ 只比 B1 CHECK(這一格沒有驗到東西)');
      return;
    }
    const sql = stripSqlComments(readFileSync(resolve(dir, withFn[withFn.length - 1] as string), 'utf8'));
    const all = [...sql.matchAll(/FUNCTION\s+public\.pcm_order_total\s*\([^)]*\)[\s\S]*?\$\$\s*SELECT\s+([^$]+?)\s*\$\$/gi)];
    expect(all.length, 'pcm_order_total 的 SELECT 函式體找不到').toBeGreaterThan(0);
    const body = all[all.length - 1]?.[1] ?? '';
    expect(tokens(body), `函式體含不認得的 token:${body}`).toBe(EXPECT);
  });

  it('🔵 負對照:tokenizer 分得出少一項 / 順序反了 / 乘 2 / 括號 / OR true', () => {
    expect(tokens('subtotal + shipping_fee - discount_total')).not.toBe(EXPECT);
    expect(tokens('subtotal - shipping_fee + discount_total + tax_total')).not.toBe(EXPECT);
    expect(tokens('subtotal + shipping_fee - discount_total + tax_total * 2')).toBeNull();
    expect(tokens('(subtotal + shipping_fee) - (discount_total + tax_total)')).toBeNull();
    expect(tokens('subtotal + shipping_fee - discount_total + tax_total OR true')).toBeNull();
    expect(tokens('p_subtotal::bigint + p_shipping_fee - p_discount_total + p_tax_total')).toBe(EXPECT);
  });
});
