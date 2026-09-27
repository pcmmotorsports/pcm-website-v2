import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 商品頁乙 P10(P-M4,20260928230000):所有讀一般價的資料庫出口改讀「實際一般價」,並在下單時核對單價。
// 行為在拋棄式 PG(正式庫結構,前置閘指紋 = 正式庫 2026-09-28 唯讀實查)實跑:
//   supabase/tests/database/sale_price_pm4_behavior.sql 全過(沒特價照舊、有特價顯示與收錢一致、經銷不吃特價、
//   核對一樣 / 不一樣 / 沒帶 / 格式不對、一般價空擋單、免運門檻與券看實際小計、訪客讀得到原價欄、同步搬規格)。
//   負對照:退回檔跑完 ⇒ 第一格有特價的就紅。b2b_d1_behavior.sql 在新版上也全過。這支守檔案形狀。
const strip = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const raw = readFileSync(new URL('../supabase/migrations/20260928230000_m4b_sale_price_read_paths.sql', import.meta.url), 'utf8');
const code = strip(raw);
const rb = strip(readFileSync(new URL('../supabase/rollbacks/20260928230000-rollback.sql', import.meta.url), 'utf8'));
const co = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.create_order('), code.indexOf('CREATE OR REPLACE VIEW public.products_public'));

describe('商品頁乙 P-M4(20260928230000)', () => {
  it('🔴 一般會員收實際一般價,經銷分支不動(Q-P2 乙)', () => {
    expect(co).toContain('v_unit_price := public.pcm_effective_general_price(v_variant.price_general, v_variant.sale_price_general);');
    expect(co).toContain('public.dealer_discounted_amount(v_uid, v_variant.brand_id, v_variant.price_store)');
    expect(co.match(/pv\.price_store, pv\.sale_price_general,/g)).toHaveLength(2);
    // 一般價空 ⇒ 單價空 ⇒ 這道拒絕要還在
    expect(co).toContain("RAISE EXCEPTION 'create_order: 變體無有效單價(tier=%, variant=%)'");
    expect(code).not.toMatch(/LEAST\s*\(/i);
  });

  it('🔴 單價核對:有帶才比,不同 ⇒ P2C21 不建單;在單價算完之後', () => {
    const check = co.indexOf("IF v_line ? 'expected_unit_price'");
    expect(check).toBeGreaterThan(co.indexOf('變體無有效單價'));
    expect(co).toContain("pg_catalog.jsonb_typeof(v_line -> 'expected_unit_price') <> 'null'");
    expect(co).toMatch(/USING ERRCODE = 'P2C21',\s+DETAIL = 'price_changed'/);
  });

  it('🔴 view 只用 CREATE OR REPLACE、新欄在最後、仍是 security_invoker;經銷目錄不碰', () => {
    expect(code).not.toMatch(/DROP\s+VIEW/i);
    expect(code).not.toMatch(/products_list_dealer\s+AS/i);
    for (const v of ['products_public', 'products_list_public', 'product_variants_public']) {
      expect(code).toContain(`CREATE OR REPLACE VIEW public.${v} WITH (security_invoker = true) AS`);
    }
    expect(code.match(/rep\.original_price\nFROM public\.products p/g)).toHaveLength(2);
    expect(code).toContain('GRANT SELECT (sale_price_general) ON public.product_variants TO anon, authenticated;');
    expect(code).not.toMatch(/GRANT[^;]*price_store/);
  });

  it('前置閘比正式庫現役指紋;退回檔換回 view 與查價、不退 create_order、先確認特價清光', () => {
    for (const fp of ['3c742288d7c733fc73d113f18e9a4a3a', 'c40796dbfc8c46a9592ea8ca7bf1701d', '6ede47501cd538ae12ffb47b1c165baa', '1ab986467f6a5dcb2f5bf4d884f38fa8', '2a075a1e6819554553be377f237dbca4', 'f45a37de325ecd907c3713401c61d14a']) {
      expect(code).toContain(fp);
    }
    expect(rb).not.toContain('FUNCTION public.create_order');
    expect(rb).toContain('sale_price_general IS NOT NULL');
    // 事後閘自己會提到那個函式名 ⇒ 只看事後閘之前
    expect(rb.slice(0, rb.indexOf('DO $post$'))).not.toContain('pcm_effective_general_price');
    expect(rb.match(/NULL::integer AS original_price/g)).toHaveLength(3);
    expect(rb).toContain('c40796dbfc8c46a9592ea8ca7bf1701d');
  });
});
