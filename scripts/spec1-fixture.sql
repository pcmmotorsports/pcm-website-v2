-- ⟦b4-SPEC1⟧ probe 的最小世界 —— **全部是替身**, 只建到讓 admin_create_manual_order 跑得完為止。
-- 🛑 本檔【不驗】這些表的真實約束;真實形狀在 supabase/migrations 的建表那幾支。
create type public.member_tier as enum ('general','vip','dealer');

create table public.staff (
  id        text primary key,
  is_active boolean not null default true);
insert into public.staff (id, is_active) values ('probe', true);

create table public.customers (
  user_id uuid primary key,
  tier    public.member_tier not null default 'general');
insert into public.customers (user_id, tier)
  values ('11111111-1111-1111-1111-111111111111'::uuid, 'general');

-- 🔴 權威來源:本片的整個重點就是這一張表的 spec 欄。
--    形狀對齊 20260531142533_init_product_variants.sql:40/43/62。
create table public.product_variants (
  id   uuid primary key,
  spec jsonb not null default '{}',
  constraint pv_spec_is_object check (jsonb_typeof(spec) = 'object'));
insert into public.product_variants (id, spec) values
  ('22222222-2222-2222-2222-222222222222'::uuid, '{"color":"red"}'::jsonb);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  display_id text not null,
  customer_user_id uuid not null references public.customers(user_id),
  address_id uuid,
  shipping_address_snapshot jsonb,
  tier_at_checkout public.member_tier,
  subtotal integer not null, shipping_fee integer not null,
  discount_total integer not null, total integer not null,
  tax_total integer not null default 0,
  shipping_method text, invoice jsonb,
  order_source text, payment_channel text,
  manual_request_id uuid, manual_request_payload_sha256 text,
  created_at timestamptz not null default now());

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  -- 🔴 真表是 ON DELETE SET NULL(20260604120000:143)⇒ 這裡照抄那個「允許 NULL」的性質,
  --    因為代購品項就是靠它。
  variant_id uuid references public.product_variants(id) on delete set null,
  variant_sku text, product_snapshot jsonb not null,
  quantity integer not null, unit_price integer not null, line_total integer not null);

create table public.admin_audit_log (
  id bigserial primary key,
  -- 🔴 request_id 是 text 不是 uuid —— 函式傳的是 p_manual_request_id::text。
  --    本檔第一版寫 uuid ⇒ 四個世界全部拿到空字串, 而【那個空與「查不到」長得一樣】。
  actor text, action text, target text, request_id text,
  before jsonb, after jsonb, reason text, source_app text,
  created_at timestamptz not null default now());

create function public.m3_jsonb_values_all_string(p jsonb) returns boolean
  language sql immutable as $$
  select coalesce(bool_and(jsonb_typeof(value) = 'string'), true)
    from jsonb_each(p) $$;

create sequence public.probe_disp start 1;
create function public.pcm_generate_display_id() returns text
  language sql volatile as $$ select 'PB' || to_char(nextval('public.probe_disp'), 'FM000000') $$;

-- 🔴 後置④c 用 has_function_privilege('anon', …) ⇒ 角色不存在會直接炸,
--    而那個炸與「權限錯」長得不一樣但同樣讓本發作廢 ⇒ 替身角色要先建。
create role anon;
create role authenticated;
create role service_role;
