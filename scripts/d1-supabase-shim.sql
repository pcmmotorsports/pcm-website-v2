-- D1t2:vanilla PostgreSQL 的 Supabase 相容 shim —— **rehearsal 隔離環境專用**。
--
-- migrations 之前先跑。範圍 = 實掃 85 支 migration 的最小集合(角色 TO 清單 + auth 引用):
-- - 角色:anon / authenticated / service_role / payment_confirmer(postgres 由 initdb 提供;
--   payment_confirmer 在 20260611120000 有冪等 DO IF NOT EXISTS,預建無衝突)。
-- - auth schema:`auth.users` 必須含 email 與 raw_user_meta_data ——
--   `20260523034911:278-295` 的 `handle_new_auth_user` trigger 讀這兩欄,
--   id-only 最小表在造資料當下就會炸(Fable R3-F1;對齊 D1a6 實證形狀)。
-- - `auth.uid()`:回 NULL(rehearsal 無 JWT;RLS policy 解析需要函式存在)。
-- - vault / pcm_cron / cron / net:唯一引用者 = 被跳過的 `20260723120000`;
--   cron/net 由 d1-fake-cron.sql 提供,vault 不 shim。
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_confirmer') THEN CREATE ROLE payment_confirmer LOGIN; END IF;
  -- 20260719120000 的 ACL 斷言會查 authenticator(Supabase 平台角色)。
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS 'SELECT NULL::uuid';

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Supabase 平台預設權限(D1a6「照正式站 pg_default_acl 實查值重建」口徑):
-- 平台上 postgres 建的物件會自動 GRANT 給三角色;vanilla PG 沒有這條,
-- 後面的 migration 自帶 ACL 斷言(如 20260717010000「service_role 應可 SELECT」)會炸。
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

COMMIT;
