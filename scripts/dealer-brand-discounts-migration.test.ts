import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// B2B 計畫 §10.2 片 E1:經銷品牌折扣表與寫入函式(20260925030000)。
// 行為(拋棄式 PG17 實跑:新增 / expected 不符 STALE / 改+刪一批 / 同值 NO_CHANGE 零稽核 / 一般會員 NOT_DEALER /
// 7.55、0、100、字串、重複品牌、缺 expected、不存在品牌全擋且零寫入 / authenticated、anon 讀不到也叫不動 /
// 兩連線同時新增一個 SAVED 一個 STALE / 退回再貼)記在 commit 訊息;這支守檔案形狀。
const code = readFileSync(new URL('../supabase/migrations/20260925030000_m4b_dealer_brand_discounts.sql', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const fn = code.slice(code.indexOf('CREATE FUNCTION public.admin_dealer_brand_discounts_save'), code.indexOf('$fn$;'));

describe('經銷品牌折扣 migration(20260925030000)', () => {
  it('🔴 客人對表零權限;service_role 只讀;寫入函式只給 service_role', () => {
    expect(code).toContain('REVOKE ALL ON TABLE public.dealer_brand_discounts FROM PUBLIC, anon, authenticated, service_role;');
    expect(code).toContain('GRANT SELECT ON TABLE public.dealer_brand_discounts TO service_role;');
    expect(code).not.toMatch(/GRANT[^;]*dealer_brand_discounts[^;]*TO[^;]*(anon|authenticated)/);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;');
  });

  it('🔴 先鎖 customers 再比對 expected;任一筆不符 STALE、整批驗完才寫', () => {
    const lock = fn.indexOf('FOR UPDATE');
    expect(lock).toBeGreaterThan(-1);
    expect(fn.indexOf("RETURN 'STALE'")).toBeGreaterThan(lock);
    // 第一輪只驗不寫:第一個 INSERT / DELETE 出現在最後一個 STALE 之後
    expect(fn.indexOf('DELETE FROM public.dealer_brand_discounts')).toBeGreaterThan(fn.lastIndexOf("RETURN 'STALE'"));
    expect(fn).toContain("(v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_cur.updated_at");
  });

  it('🔴 % 超過一位小數要拒絕(numeric(4,1) 會靜靜進位), 只有 store 能新設', () => {
    expect(fn).toContain('v_pct <> pg_catalog.round(v_pct, 1)');
    expect(fn).toContain("IF v_tier <> 'store' THEN");
    expect(code).toContain('CHECK (percent > 0 AND percent < 100)');
  });

  it('每個有變的品牌寫一筆稽核, before/after 帶 brand_id、percent、below_cost_reason', () => {
    expect(fn).toContain("'dealer.brand_discount.change'");
    expect(fn.match(/'below_cost_reason', /g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('退回檔:E2 還在就拒絕', () => {
    const rb = readFileSync(new URL('../supabase/rollbacks/20260925030000-rollback.sql', import.meta.url), 'utf8');
    expect(rb).toContain("to_regprocedure('public.dealer_discounted_amount(uuid, uuid, integer)') IS NOT NULL");
  });

  it('🔴 漏傳 percent 不能被當成刪除;品牌那一側不 CASCADE(Codex E1 R1)', () => {
    expect(fn).toContain("NOT (v_change ? 'percent')");
    expect(code).toMatch(/brand_id\s+uuid\s+NOT NULL REFERENCES public\.brands\(id\),/);
    expect(code).not.toMatch(/REFERENCES public\.brands\(id\) ON DELETE CASCADE/);
  });
});
