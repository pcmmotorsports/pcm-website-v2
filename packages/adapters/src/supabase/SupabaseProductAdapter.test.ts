// SupabaseProductAdapter.test.ts — DB 查詢層 SELECT 投射經銷價防護回歸守門(2026-06-05 安全稽核 M-11)。
//
// 經銷價防護鏈的 DB 查詢層:read method 必須只向「安全 view」(products_public / product_variants_public)
// 取「不含經銷欄」的投射。稽核發現此層原本零自動化測試 —— 若有人把 PRODUCT_SELECT_* 改成含 price_store /
// price_by_tier / metadata,或把查詢從 products_public 改成 base products 表,CI 不會紅燈。
//
// 本測試用注入式 mock SupabaseClient 攔截 `.from(table)` 與 `.select(cols)` 的實際參數,斷言:
//   - 查的是 products_public 安全 view(非 base products 表);
//   - SELECT 投射字串不含任何經銷敏感欄(price_store / price_by_tier / metadata / cost);
//   - 變體 embed 走 product_variants_public 安全 view(非 base product_variants 表)、且只投射 price_general。
// 註:DB 層另有 view 物理排除 + column GRANT 兩道硬防護(MCP 實測 42703);本測試守的是「應用層投射選擇」
//   這一道,三層任一被改壞都該被某層測試/DB 擋下。
//
// mock 讓 findById/findByHandle 的 .single() 回 PGRST116(not-found)→ findSingle 回 null,
//   故不需建完整 row、只攔截 SELECT 參數即可。

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductId } from '@pcm/domain';
import { SupabaseProductAdapter } from './SupabaseProductAdapter';

const DEALER_COLUMNS = ['price_store', 'price_by_tier', 'metadata', 'cost'];

function makeMockClient() {
  const captured = { table: '', select: '' };
  const builder = {
    select(cols: string) {
      captured.select = cols;
      return builder;
    },
    eq() {
      return builder;
    },
    single() {
      // PGRST116 = not-found → findSingle 回 null(免建完整 row)
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      });
    },
  };
  const client = {
    from(table: string) {
      captured.table = table;
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, captured };
}

describe('SupabaseProductAdapter — SELECT 投射經銷價防護(M-11 安全回歸)', () => {
  it('findByHandle:走 products_public 安全 view、投射不含經銷欄、變體 embed 走 product_variants_public', async () => {
    const { client, captured } = makeMockClient();
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.findByHandle('any-handle');
    expect(result).toBeNull(); // PGRST116 → null

    // 查安全 view、非 base products 表
    expect(captured.table).toBe('products_public');
    // 投射不含任何經銷敏感欄
    for (const col of DEALER_COLUMNS) {
      expect(captured.select).not.toContain(col);
    }
    // 變體 embed 走 product_variants_public 安全 view(非 base product_variants 表)、只投射 price_general
    expect(captured.select).toContain('product_variants_public');
    expect(captured.select).not.toContain('product_variants('); // 不直接查 base 變體表
    expect(captured.select).toContain('price_general');
  });

  it('findById:同走 products_public 安全 view、同投射不含經銷欄', async () => {
    const { client, captured } = makeMockClient();
    const adapter = new SupabaseProductAdapter(client);

    const result = await adapter.findById('p-001' as unknown as ProductId);
    expect(result).toBeNull();

    expect(captured.table).toBe('products_public');
    for (const col of DEALER_COLUMNS) {
      expect(captured.select).not.toContain(col);
    }
  });
});
