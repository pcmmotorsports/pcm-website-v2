INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('11111111-1111-1111-1111-111111111111', 'probe-seed@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.customers (user_id, email, name, phone, tier)
VALUES ('11111111-1111-1111-1111-111111111111', 'probe-seed@example.test', '種子客人', '0912345678', 'general')
ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone;
INSERT INTO public.orders (
  display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, discount_total, total, shipping_method, invoice)
SELECT public.pcm_generate_display_id(), '11111111-1111-1111-1111-111111111111', NULL,
  '{"name":"種子","phone":"0912345678","line":"種子地址"}'::jsonb, 'general',
  100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.orders);
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_alice', '測試員小愛', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_bob_off', '已停用小巴', false)
  ON CONFLICT (id) DO UPDATE SET is_active = false;
INSERT INTO public.staff (id, label, is_active) VALUES ('probe_carol', '同事小凱', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;
