-- ci-self-contained: no — 需外部 provision 的庫、psql -f 對 $DSN 手動跑(見檔頭跑法),非 CI 自給自足。
BEGIN;
INSERT INTO public.orders (
  display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
  order_source, payment_channel, manual_request_id, manual_request_payload_sha256)
VALUES (public.pcm_generate_display_id(), '11111111-1111-1111-1111-111111111111', NULL,
  '{"name":"併發","phone":"0912000111","line":"併發路1號"}'::jsonb, 'general',
  100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb,
  'manual_phone', 'bank_transfer', 'cccc0001-0000-0000-0000-000000000001', repeat('a',64));
SELECT pg_sleep(6);
COMMIT;
