import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20260727084801_atomic_variant_group_sync.sql', import.meta.url),
  'utf8',
);

describe('atomic variant-group sync migration safety contract', () => {
  it('defines one SECURITY INVOKER RPC with an in-transaction supplier lock', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.sync_product_variant_group\s*\(\s*p_supplier_slug text,\s*p_external_id text,\s*p_variants jsonb,\s*p_orphan_skus text\[\]/s,
    );
    expect(migration).toMatch(/SECURITY INVOKER/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/FOR UPDATE/);
  });

  it('uses a reserved unique sentinel before final upsert and keeps pv_spec_unique', () => {
    expect(migration).toContain('__pcm_sync_sentinel__');
    expect(migration).toMatch(/UPDATE public\.product_variants[\s\S]*jsonb_build_object[\s\S]*INSERT INTO public\.product_variants/);
    expect(migration).toMatch(/ON CONFLICT \(supplier_slug, sku\)/);
    expect(migration).toMatch(
      /ON CONFLICT \(supplier_slug, sku\) DO UPDATE[\s\S]*WHERE public\.product_variants\.product_id = EXCLUDED\.product_id/,
    );
    expect(migration).not.toMatch(/DROP\s+(CONSTRAINT|INDEX)[^;]*pv_spec_unique/i);
  });

  it('keeps the RPC private to service_role', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.sync_product_variant_group\(text, text, jsonb, text\[\]\)\s+FROM PUBLIC, anon, authenticated/s,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.sync_product_variant_group\(text, text, jsonb, text\[\]\)\s+TO service_role/s,
    );
  });

  it('revalidates numeric JSON types and integer/price invariants inside the RPC', () => {
    expect(migration).toMatch(/jsonb_typeof\(item\.value->'sku'\) <> 'string'/);
    expect(migration).toMatch(/jsonb_typeof\(item\.value->'availability'\) <> 'string'/);
    expect(migration).toMatch(/jsonb_typeof\(item\.value->'price_general'\) <> 'number'/);
    expect(migration).toMatch(/jsonb_typeof\(item\.value->'price_store'\) NOT IN \('null', 'number'\)/);
    expect(migration).toMatch(/jsonb_typeof\(item\.value->'sort_order'\) <> 'number'/);
    expect(migration).toMatch(/pg_catalog\.trunc\(\(item\.value->>'price_general'\)::numeric\)/);
    expect(migration).toMatch(/pg_catalog\.isfinite\(\(item\.value->>'updated_at'\)::timestamptz\)/);
  });
});
