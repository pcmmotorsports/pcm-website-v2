import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-09-24 經銷價修正(docs/plans/2026-09-24-dealer-price-fix-before-b2b-plan.md)。
// 經銷價只認【基準款變體】的 product_variants.price_store —— 與結帳 create_order 收錢同一欄。
// 🔴 price_by_tier.store 在沒開灌價的供應商是過期舊價(正式庫 2026-09-24:1,086 件比一般價貴),
//    有人把經銷那條路改回讀它, 這支要紅。
// 行為(拋棄式 PG 實跑 舊 → 新 → 退回 → 再貼)記在 commit 訊息;這支守的是檔案內容不被改回去。
const migration = readFileSync(
  new URL('../supabase/migrations/20260924100000_m4b_dealer_price_reads_basis_variant.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../supabase/rollbacks/20260924100000-rollback.sql', import.meta.url),
  'utf8',
);

// 註解不算:只看碼。
const code = migration
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

const BASIS_ORDER = /ORDER BY (pv|bv)\.price_general ASC NULLS LAST, \1\.sku COLLATE "C" ASC\s+LIMIT 1/g;

describe('經銷價改讀基準款變體(20260924100000)', () => {
  it('經銷目錄 view 的價格欄 = 基準款變體 price_store, 取不到退回一般價', () => {
    expect(code).toMatch(/coalesce\(b\.price_store, v\.price_general\) AS price_general/);
    expect(code).toMatch(/LEFT JOIN LATERAL \(\s*SELECT pv\.price_store\s+FROM public\.product_variants pv/);
    expect(code).not.toMatch(/coalesce\(pr\.price_store/);
  });

  it('get_effective_prices 的 store 那一格讀基準款變體, 不讀 price_by_tier.store', () => {
    expect(code).toMatch(/WHEN v_tier = 'store' THEN coalesce\(\s*\(SELECT bv\.price_store/);
    expect(code).not.toMatch(/price_by_tier\s*->\s*'store'/);
  });

  it('基準款規則在 view、函式本體、WARNING 三處一致, 而且 sku 用 COLLATE "C"', () => {
    expect(code.match(BASIS_ORDER)?.length).toBe(3);
  });

  it('每一處都只看【這件商品自己】的變體(少了這句會拿別件商品的經銷價)', () => {
    expect(code.match(/WHERE pv\.product_id = pr\.id/g)?.length).toBe(1);
    expect(code.match(/WHERE bv\.product_id = p\.id/g)?.length).toBe(2);
  });

  it('函式保留 DEFINER 與空 search_path, 權限只給 authenticated', () => {
    expect(code).toMatch(/SECURITY DEFINER\s+SET search_path = ''/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.get_effective_prices\(uuid\[\], uuid\[\]\) FROM anon, service_role;/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_effective_prices\(uuid\[\], uuid\[\]\) TO authenticated;/);
    expect(code).toMatch(/REVOKE ALL ON TABLE public\.products_list_dealer FROM anon, authenticated;/);
  });

  it('退回前置閘釘住新版兩個指紋(不是只比某個字)', () => {
    expect(rollback).toContain('08fce34c67d5ea1e6209112c212a6fdb');
    expect(rollback).toContain('cc73a38bf5775da7b402c9c1c9fad140');
    expect(rollback).not.toMatch(/NOT I?LIKE '%(lateral|bv\.price_store)%'/);
    // 用 IS DISTINCT FROM:物件不存在(NULL)也要擋;換成 <> 會讓 NULL 溜過去。
    expect(rollback).toMatch(/v_view IS DISTINCT FROM '08fce34c67d5ea1e6209112c212a6fdb'/);
    expect(rollback).toMatch(/v_fn IS DISTINCT FROM 'cc73a38bf5775da7b402c9c1c9fad140'/);
  });

  it('前置閘釘住貼之前正式庫的兩個指紋, 退回事後閘釘回同一組', () => {
    for (const md5 of ['cf5683acb5b69e9c96762fad84a88536', '208abb5ea084bb260f067c7e6640d355']) {
      expect(migration).toContain(md5);
      expect(rollback).toContain(md5);
    }
  });

  it('退回檔用 CREATE OR REPLACE(重貼原本的裸 CREATE 會撞名回滾, 等於沒退)', () => {
    expect(rollback).toMatch(/CREATE OR REPLACE FUNCTION public\.get_effective_prices\(/);
    expect(rollback).not.toMatch(/^CREATE FUNCTION/m);
    expect(rollback).toMatch(/coalesce\(pr\.price_store, v\.price_general\) AS price_general/);
  });
});
