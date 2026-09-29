import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 商品頁乙 P-M5(20260929050000):建單沒帶核對單價就拒絕(P2C22),經銷一般價空的兩道檢查。
// 行為在拋棄式 PG(正式庫結構 dump + 補套,P-M4 指紋與正式庫 2026-09-29 唯讀實查相同)實跑:
//   supabase/tests/database/sale_price_pm5_behavior.sql 全過;在 P-M4 上跑第一格就紅(負對照)。
//   退回檔跑完 ⇒ 沒帶照常建單、經銷一般價空仍擋。這支守檔案形狀。
const strip = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const code = strip(readFileSync(new URL('../supabase/migrations/20260929050000_m4b_pm5_require_expected_unit_price.sql', import.meta.url), 'utf8'));
const rb = strip(readFileSync(new URL('../supabase/rollbacks/20260929050000-rollback.sql', import.meta.url), 'utf8'));
const pm4 = strip(readFileSync(new URL('../supabase/migrations/20260928230000_m4b_sale_price_read_paths.sql', import.meta.url), 'utf8'));
const fn = (src: string, name: string) => {
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return i < 0 ? '' : src.slice(i, src.indexOf('$function$;', i));
};

describe('商品頁乙 P-M5(20260929050000)', () => {
  it('🔴 沒帶(或 JSON null)⇒ P2C22 price_unconfirmed;看值不看真假(0 元照常)', () => {
    const co = fn(code, 'create_order');
    expect(co).toContain("IF NOT (v_line ? 'expected_unit_price') OR pg_catalog.jsonb_typeof(v_line -> 'expected_unit_price') = 'null' THEN");
    expect(co).toMatch(/ERRCODE = 'P2C22',\s+DETAIL = 'price_unconfirmed'/);
    // 格式檢查與 P2C21 保留
    expect(co).toContain("RAISE EXCEPTION 'create_order: expected_unit_price 格式不對(variant=%)'");
    expect(co).toMatch(/ERRCODE = 'P2C21',\s+DETAIL = 'price_changed'/);
    // 舊的「有帶才比」那個外層條件不在了
    expect(co).not.toContain("IF v_line ? 'expected_unit_price' AND");
  });

  it('🔴 經銷:create_order 一般價空 ⇒ 單價 NULL;查價商品層全空 / 變體層空 ⇒ NULL', () => {
    const co = fn(code, 'create_order');
    const gep = fn(code, 'get_effective_prices');
    expect(co).toMatch(/dealer_discounted_amount\(v_uid, v_variant\.brand_id, v_variant\.price_store\);\s+IF v_variant\.price_general IS NULL THEN\s+v_unit_price := NULL;/);
    expect(gep).toContain('WHERE gv.product_id = p.id AND gv.price_general IS NOT NULL) THEN NULL');
    expect(gep).toContain("WHEN v_tier = 'store' AND v.price_general IS NULL THEN NULL");
  });

  it('其餘逐字照抄 P-M4:把 P-M5 的改動換回去就等於 P-M4 那一代', () => {
    // 只比「一般會員」那一半的關鍵句還在,避免照抄時漏掉
    expect(fn(code, 'create_order')).toContain('v_unit_price := public.pcm_effective_general_price(v_variant.price_general, v_variant.sale_price_general);');
    expect(fn(code, 'get_effective_prices')).toContain('pcm_effective_general_price(v.price_general, v.sale_price_general)');
    expect(fn(pm4, 'create_order').length).toBeGreaterThan(1000);
  });

  it('🔴 事後閘釘的指紋 = 檔案裡函式本體真正的 md5(改了本體忘了更新指紋 ⇒ 這格紅, 不用等到貼板)', () => {
    const body = (file: string, name: string) => {
      const t = readFileSync(new URL(file, import.meta.url), 'utf8');
      const i = t.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      const a = t.indexOf('AS $function$', i) + 'AS $function$'.length;
      return createHash('md5').update(t.slice(a, t.indexOf('$function$;', a))).digest('hex');
    };
    const mig = '../supabase/migrations/20260929050000_m4b_pm5_require_expected_unit_price.sql';
    const rbf = '../supabase/rollbacks/20260929050000-rollback.sql';
    const pm4f = '../supabase/migrations/20260928230000_m4b_sale_price_read_paths.sql';
    expect(body(pm4f, 'create_order')).toBe('79e253857b6b2757b8823a6740e7107b');
    expect(body(pm4f, 'get_effective_prices')).toBe('636409bea9cff799d5636805809f177d');
    expect(code).toContain(`'${body(mig, 'create_order')}'`);
    expect(code).toContain(`'${body(mig, 'get_effective_prices')}'`);
    expect(rb).toContain(`'${body(rbf, 'create_order')}'`);
  });

  it('前置閘比 P-M4 寫出的指紋(= 正式庫現役);退回檔只換 create_order、先確認是 P-M5 那一代', () => {
    expect(code).toContain("'79e253857b6b2757b8823a6740e7107b'");
    expect(code).toContain("'636409bea9cff799d5636805809f177d'");
    expect(rb).toContain("'083b735dff425a7081111bbc9d637f1c'");
    expect(rb).not.toContain('FUNCTION public.get_effective_prices');
    expect(fn(rb, 'create_order')).toContain("IF v_line ? 'expected_unit_price' AND");
    expect(fn(rb, 'create_order')).toContain('IF v_variant.price_general IS NULL THEN');
  });
});
