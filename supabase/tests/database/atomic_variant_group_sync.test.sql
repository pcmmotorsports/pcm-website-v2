BEGIN;

SELECT plan(25);

SELECT ok(
  pg_catalog.to_regprocedure('public.sync_product_variant_group(text,text,jsonb,text[])') IS NOT NULL,
  'atomic variant-group RPC exists'
);
SELECT results_eq(
  $$SELECT p.prosecdef
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'sync_product_variant_group'$$,
  $$VALUES (false)$$,
  'RPC is SECURITY INVOKER'
);
SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.sync_product_variant_group(text,text,jsonb,text[])',
    'EXECUTE'
  ),
  'service_role can execute RPC'
);
SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'anon',
    'public.sync_product_variant_group(text,text,jsonb,text[])',
    'EXECUTE'
  ),
  'anon cannot execute RPC'
);
SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.sync_product_variant_group(text,text,jsonb,text[])',
    'EXECUTE'
  ),
  'authenticated cannot execute RPC'
);

INSERT INTO public.brands (id, name, slug)
VALUES ('10000000-0000-0000-0000-000000000001', 'Atomic Sync Test', 'atomic-sync-test');

INSERT INTO public.categories (id, name, raw_path, segments)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'Atomic Sync Test',
  'Atomic Sync Test',
  '["Atomic Sync Test"]'::jsonb
);

INSERT INTO public.products (
  id, supplier_slug, external_id, title, subtitle, handle,
  price_general, price_store, price_by_tier, fitments, images,
  availability, brand_id, category_id, metadata, updated_at
)
VALUES
(
  '30000000-0000-0000-0000-000000000001',
  'eazigrip-test',
  'HOSEYAM005',
  'HOSEYAM005',
  'atomic test',
  'eazigrip-test-hoseyam005',
  1000,
  NULL,
  '{"general":{"amount":1000,"currency":"TWD"},"store":{"amount":null,"currency":"TWD"}}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'in-stock',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '30000000-0000-0000-0000-000000000002',
  'eazigrip-test',
  'OTHER-GROUP',
  'OTHER-GROUP',
  'atomic test',
  'eazigrip-test-other-group',
  1000,
  NULL,
  '{"general":{"amount":1000,"currency":"TWD"},"store":{"amount":null,"currency":"TWD"}}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'in-stock',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '30000000-0000-0000-0000-000000000003',
  'eazigrip-test',
  'TWO-WAY-SWAP',
  'TWO-WAY-SWAP',
  'atomic test',
  'eazigrip-test-two-way-swap',
  1000,
  NULL,
  '{"general":{"amount":1000,"currency":"TWD"},"store":{"amount":null,"currency":"TWD"}}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'in-stock',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
);

INSERT INTO public.product_variants (
  id, product_id, supplier_slug, sku, spec, price_general, price_store,
  availability, images, sort_order, metadata, updated_at
)
VALUES
(
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'eazigrip-test',
  'HOSEYAM005',
  '{}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  0,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '40000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001',
  'eazigrip-test',
  'HOSEYAM005BL',
  '{"color":"黑色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  1,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '40000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000001',
  'eazigrip-test',
  'HOSEYAM005RED',
  '{"color":"紅色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  2,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '40000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000002',
  'eazigrip-test',
  'OTHER-SKU',
  '{"color":"銀色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  0,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '40000000-0000-0000-0000-000000000005',
  '30000000-0000-0000-0000-000000000003',
  'eazigrip-test',
  'SWAP-A',
  '{"color":"黑色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  0,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
),
(
  '40000000-0000-0000-0000-000000000006',
  '30000000-0000-0000-0000-000000000003',
  'eazigrip-test',
  'SWAP-B',
  '{"color":"藍色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  1,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
);

SELECT lives_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'HOSEYAM005 transition swap succeeds atomically'
);
SELECT results_eq(
  $$SELECT pv.sku || ':' || (pv.spec->>'color')
      FROM public.product_variants AS pv
     WHERE pv.product_id = '30000000-0000-0000-0000-000000000001'
     ORDER BY pv.sku$$,
  $$VALUES
      ('HOSEYAM005:黑色'),
      ('HOSEYAM005BL:藍色'),
      ('HOSEYAM005RED:紅色')$$,
  'final specs are correct'
);
SELECT is(
  (
    SELECT pg_catalog.count(*)
      FROM public.product_variants AS pv
     WHERE pv.product_id = '30000000-0000-0000-0000-000000000001'
       AND pv.spec ? '__pcm_sync_sentinel__'
  ),
  0::bigint,
  'no sentinel remains after success'
);

SELECT lives_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'TWO-WAY-SWAP',
      '[
        {"sku":"SWAP-A","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"SWAP-B","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'two existing variants can exchange specs in one RPC'
);
SELECT results_eq(
  $$SELECT pv.sku || ':' || (pv.spec->>'color')
      FROM public.product_variants AS pv
     WHERE pv.product_id = '30000000-0000-0000-0000-000000000003'
     ORDER BY pv.sku$$,
  $$VALUES
      ('SWAP-A:藍色'),
      ('SWAP-B:黑色')$$,
  'two-way swap reaches the exact final state'
);
SELECT is(
  (
    SELECT pg_catalog.count(*)
      FROM public.product_variants AS pv
     WHERE pv.product_id = '30000000-0000-0000-0000-000000000003'
       AND pv.spec ? '__pcm_sync_sentinel__'
  ),
  0::bigint,
  'two-way swap leaves no sentinel'
);

SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":"1000","price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'numeric strings are rejected instead of implicitly cast'
);
SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0.5,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'fractional integer fields are rejected before recordset casting'
);
SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":12345,"spec":{"color":"數字"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":3,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'non-string SKU is rejected instead of coerced to text'
);
SELECT is(
  (
    SELECT pg_catalog.count(*)
      FROM public.product_variants AS pv
     WHERE pv.supplier_slug = 'eazigrip-test'
       AND pv.sku = '12345'
  ),
  0::bigint,
  'rejected numeric SKU leaves no coerced text row'
);

INSERT INTO public.product_variants (
  product_id, supplier_slug, sku, spec, price_general, price_store,
  availability, images, sort_order, metadata, updated_at
)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  'eazigrip-test',
  'HOSEYAM005-ROLLBACK',
  '{"color":"舊色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  3,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
);
SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{"cost":1},"updated_at":"2026-07-27T01:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T01:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T01:00:00Z"}
      ]'::jsonb,
      ARRAY['HOSEYAM005-ROLLBACK']::text[]
    )$$,
  'a post-sentinel/delete metadata constraint failure throws'
);
SELECT results_eq(
  $$SELECT pv.sku || ':' || (pv.spec->>'color') || ':' || pv.price_general::text
      FROM public.product_variants AS pv
     WHERE pv.product_id = '30000000-0000-0000-0000-000000000001'
     ORDER BY pv.sku$$,
  $$VALUES
      ('HOSEYAM005:黑色:1000'),
      ('HOSEYAM005-ROLLBACK:舊色:1000'),
      ('HOSEYAM005BL:藍色:1000'),
      ('HOSEYAM005RED:紅色:1000')$$,
  'failed RPC restores original specs, prices, and deleted orphan'
);
SELECT is(
  (
    SELECT pg_catalog.count(*)
      FROM public.product_variants AS pv
     WHERE pv.product_id = '30000000-0000-0000-0000-000000000001'
       AND pv.spec ? '__pcm_sync_sentinel__'
  ),
  0::bigint,
  'failed post-mutation RPC leaves no sentinel'
);
DELETE FROM public.product_variants
 WHERE supplier_slug = 'eazigrip-test'
   AND sku = 'HOSEYAM005-ROLLBACK';

SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY['HOSEYAM005RED']::text[]
    )$$,
  'final duplicate specs are rejected before mutation'
);
SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'wrong-supplier',
      'HOSEYAM005',
      '[{"sku":"X","spec":{},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'wrong supplier/product is rejected'
);
SELECT throws_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"OTHER-SKU","spec":{"color":"銀色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":3,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'cross-product SKU move is fail-closed'
);
SELECT is(
  (
    SELECT pv.product_id
      FROM public.product_variants AS pv
     WHERE pv.supplier_slug = 'eazigrip-test'
       AND pv.sku = 'OTHER-SKU'
  ),
  '30000000-0000-0000-0000-000000000002'::uuid,
  'cross-product rejection leaves original ownership unchanged'
);

INSERT INTO public.product_variants (
  product_id, supplier_slug, sku, spec, price_general, price_store,
  availability, images, sort_order, metadata, updated_at
)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  'eazigrip-test',
  'HOSEYAM005-OLD',
  '{"color":"舊色"}'::jsonb,
  1000,
  NULL,
  'in-stock',
  '[]'::jsonb,
  3,
  '{}'::jsonb,
  '2026-07-27T00:00:00Z'
);
SELECT lives_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY['HOSEYAM005-OLD']::text[]
    )$$,
  'orphan delete and desired upsert succeed in one RPC'
);
SELECT is(
  (
    SELECT pg_catalog.count(*)
      FROM public.product_variants AS pv
     WHERE pv.supplier_slug = 'eazigrip-test'
       AND pv.sku = 'HOSEYAM005-OLD'
  ),
  0::bigint,
  'orphan is deleted'
);
SELECT lives_ok(
  $$SELECT public.sync_product_variant_group(
      'eazigrip-test',
      'HOSEYAM005',
      '[
        {"sku":"HOSEYAM005","spec":{"color":"黑色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":0,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005BL","spec":{"color":"藍色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":1,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"},
        {"sku":"HOSEYAM005RED","spec":{"color":"紅色"},"price_general":1000,"price_store":null,"availability":"in-stock","images":[],"sort_order":2,"metadata":{},"updated_at":"2026-07-27T00:00:00Z"}
      ]'::jsonb,
      ARRAY[]::text[]
    )$$,
  'no-op rerun is idempotent'
);

SELECT * FROM finish();
ROLLBACK;
