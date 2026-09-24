import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// B2B 計畫 D1(20260925050000):缺經銷價不再退回一般價、create_order 依站別擋。以後台窗 E2(20260925040000)為底。
// 行為在拋棄式 PG17 上實跑(底 = 正式庫 2026-09-25 唯讀 pg_dump 的 public 結構 + 20260925010000–040000 + 後台窗 E2 測試資料),
//   22 格全過:經銷缺價 ⇒ 變體 / 商品 / 經銷目錄皆 NULL、建單拒絕且零新增;有價照舊(含品牌折扣、零元);
//   標頭 b2b / retail / 大小寫不對 / 不是 JSON;一般會員與 premiumStore 在經銷站被擋;一般會員缺經銷價照一般價買。
//   負對照:在 E2 上跑同一組 ⇒ 第一格紅;只用 ALTER FUNCTION 改設定 ⇒ D1 前置閘③擋;退回檔 ⇒ 三個指紋回到 E2;再貼 D1 ⇒ 全過。
//   網站那一端(建單請求真的帶 x-pcm-site)在 apps/storefront/src/lib/supabase/server-site-header.test.ts。這支守檔案形狀。
//   行為測試可重跑:supabase/tests/database/b2b_d1_behavior.sql(先套 b2b_d1_fixture.sql;兩支檔頭寫了怎麼跑)。
const strip = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const code = strip(readFileSync(new URL('../supabase/migrations/20260925050000_m4b_b2b_d1_no_general_fallback.sql', import.meta.url), 'utf8'));
const rb = readFileSync(new URL('../supabase/rollbacks/20260925050000-rollback.sql', import.meta.url), 'utf8');
const gep = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.get_effective_prices('), code.indexOf('CREATE OR REPLACE FUNCTION public.create_order('));
// 到事後閘之前為止(事後閘自己會提到那些字串)
const co = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.create_order('), code.lastIndexOf('DO $post$'));

describe('B2B D1 migration(20260925050000)', () => {
  it('🔴 三處都不再退回一般價(Sean Q3 甲)', () => {
    expect(code).toMatch(/public\.dealer_discount_apply\(b\.price_store, CASE WHEN dc\.user_id IS NOT NULL THEN dd\.percent END\) AS price_general/);
    expect(code).not.toMatch(/dealer_discount_apply\(coalesce\(/);
    expect(gep).not.toMatch(/dealer_discounted_amount\(v_uid, p\.brand_id, coalesce\(/);
    expect(gep).toContain('public.dealer_discounted_amount(v_uid, pp.brand_id, v.price_store)');
    expect(co).toContain('public.dealer_discounted_amount(v_uid, v_variant.brand_id, v_variant.price_store)');
    expect(co).not.toMatch(/v_variant\.brand_id, coalesce\(/);
    // 缺價 ⇒ 單價 NULL ⇒ 既有這道拒絕接住(不可以被拿掉)
    expect(co).toContain("RAISE EXCEPTION 'create_order: 變體無有效單價(tier=%, variant=%)'");
  });

  it('🔴 站別判斷在 FOR SHARE 讀等級之後、用同一個 v_tier;標頭用 jsonb + nullif', () => {
    const tier = co.indexOf('SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = v_uid FOR SHARE;');
    const site = co.indexOf("v_site := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-pcm-site';");
    expect(tier).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(tier);
    expect(co.match(/SELECT c\.tier INTO v_tier/g)).toHaveLength(1);
    expect(co.match(/pcm_wrong_site/g)).toHaveLength(3);
    expect(co).toContain("ELSIF v_site = 'b2b' AND v_tier <> 'store'::public.member_tier THEN");
    expect(co).toContain("ELSIF v_site = 'retail' AND v_tier = 'store'::public.member_tier THEN");
  });

  it('前置閘:比 E2 的三個指紋、函式屬性、只有一支 create_order;退回檔比 D1 指紋、換回 E2', () => {
    for (const fp of ['77c7ab9cf4dc26404af6dbbe723a1d42', 'c316058adcad20679d7503b8b0967bb2', '42ddb5f87a1096361f42a6db13255918']) {
      expect(code).toContain(fp);
      expect(rb).toContain(fp);
    }
    for (const fp of ['74716d30da57db777cd319ee48652a03', 'c40796dbfc8c46a9592ea8ca7bf1701d', 'f45a37de325ecd907c3713401c61d14a']) {
      expect(code).toContain(fp);
      expect(rb).toContain(fp);
    }
    expect(code).toContain("'true|search_path=\"\"|v|p_lines jsonb");
    expect(code).toContain("'true|search_path=\"\"|s|p_product_ids uuid[] DEFAULT NULL::uuid[]");
    expect(code).toContain("p.proname = 'create_order'");
    expect(rb).toContain('public.dealer_discounted_amount(v_uid, v_variant.brand_id, coalesce(v_variant.price_store, v_variant.price_general))');
    expect(rb).toMatch(/先把經銷站下線/);
    expect(code).not.toContain('pg_temp.');
    expect(rb).not.toContain('pg_temp.');
  });
});
