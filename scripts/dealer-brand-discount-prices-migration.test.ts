import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// B2B 計畫 §10.3 片 E2:品牌折扣接進三處價格(20260925040000)。
// 行為在拋棄式 PG17 上實跑(底 = 正式庫 2026-09-25 唯讀 pg_dump 的 public 結構 + 20260925010000–030000):
//   三處一致 43 格(變體 / 商品 / 經銷目錄 / 結帳單價 / 小計 / 運費 / 稅 / 券 / 下架 / 零元 / 缺經銷價 / 別的經銷 / 一般會員);
//   三處各自改回不打折, 測試各自紅;兩連線交錯三種(存折扣中下單、下單中存折扣、改等級中下單);退回再貼;
//   2.6 萬件目錄查詢比沒有折扣時慢約 20 ms。這支守檔案形狀。
const code = readFileSync(new URL('../supabase/migrations/20260925040000_m4b_dealer_brand_discount_prices.sql', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');
const co = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.create_order('));

describe('品牌折扣接進價格 migration(20260925040000)', () => {
  it('🔴 公式只有一支(dealer_discount_apply), 兩支算價函式都不給客人角色、都不是 DEFINER', () => {
    expect(code.match(/pg_catalog\.round\(p_amount::numeric \* \(100 - p_percent\) \/ 100\)::integer/g)).toHaveLength(1);
    expect(code).toContain('REVOKE ALL ON FUNCTION public.dealer_discount_apply(integer, numeric) FROM PUBLIC, anon, authenticated, service_role;');
    expect(code).toContain('REVOKE ALL ON FUNCTION public.dealer_discounted_amount(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;');
    const helpers = code.slice(code.indexOf('CREATE FUNCTION public.dealer_discount_apply'), code.indexOf('REVOKE ALL ON FUNCTION public.dealer_discount_apply'));
    expect(helpers).not.toMatch(/SECURITY DEFINER/);
    expect(helpers).toContain("c.tier = 'store'::public.member_tier");
  });

  it('🔴 三處都接上:商品頁 / 購物車(商品半與變體半)、經銷目錄、結帳', () => {
    const gep = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.get_effective_prices('), code.indexOf('CREATE OR REPLACE FUNCTION public.create_order('));
    expect(gep).toContain('public.dealer_discounted_amount(v_uid, p.brand_id, coalesce(');
    expect(gep).toContain('public.dealer_discounted_amount(v_uid, pp.brand_id, coalesce(v.price_store, v.price_general))');
    expect(code).toMatch(/public\.dealer_discount_apply\(coalesce\(b\.price_store, v\.price_general\), CASE WHEN dc\.user_id IS NOT NULL THEN dd\.percent END\) AS price_general/);
    expect(code).toContain('ON dd.customer_user_id = (SELECT auth.uid()) AND dd.brand_id = v.brand_id');
    expect(co).toContain('public.dealer_discounted_amount(v_uid, v_variant.brand_id, coalesce(v_variant.price_store, v_variant.price_general))');
    expect(co.match(/p\.availability AS product_availability, p\.brand_id/g)).toHaveLength(2);
  });

  it('🔴 create_order:等級在 advisory lock 之後用 FOR SHARE 讀(同一張單不混用兩版折扣或等級)', () => {
    const lock = co.indexOf('pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0))');
    const tier = co.indexOf('SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;');
    expect(lock).toBeGreaterThan(-1);
    expect(tier).toBeGreaterThan(lock);
    expect(co.match(/SELECT c\.tier INTO v_tier/g)).toHaveLength(1);
    expect(co.indexOf("v_price_tax_mode := 'exclusive'")).toBeGreaterThan(tier);
  });

  it('前置閘比對正式庫現役本體的 md5;退回檔換回那一版', () => {
    expect(code).toContain("IS DISTINCT FROM '53f803ed322abf33bf1bc31beae7b982'");
    expect(code).toContain("IS DISTINCT FROM 'cc73a38bf5775da7b402c9c1c9fad140'");
    const rb = readFileSync(new URL('../supabase/rollbacks/20260925040000-rollback.sql', import.meta.url), 'utf8');
    expect(rb).toContain('DROP FUNCTION public.dealer_discount_apply(integer, numeric);');
    expect(rb).not.toContain('dealer_discounted_amount(v_uid');
    // Codex E2 R1:三個物件都比整支指紋(view 也是), 不只看一格
    expect(code).toContain("v_vfp IS DISTINCT FROM '684c5b40c960bdc1a690d33b90add602'");
    for (const fp of ['77c7ab9cf4dc26404af6dbbe723a1d42', 'c316058adcad20679d7503b8b0967bb2', '42ddb5f87a1096361f42a6db13255918']) {
      expect(rb).toContain(fp);
    }
    // Codex E2 R2:不建暫存函式(同一連線連跑會撞名), view 指紋在每個檢查區塊裡就地量
    expect(code).not.toContain('pg_temp.');
    expect(rb).not.toContain('pg_temp.');
    expect(rb.match(/PERFORM pg_catalog\.set_config\('search_path', v_sp, true\);/g)?.length).toBe(2);
  });
});
