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
-- - 🆕 **N3a(2026-07-30)`extensions` schema + pgcrypto**:平台上這兩者由 Supabase 預先建好,
--   而 `supabase/migrations/` 內**零 `CREATE EXTENSION`**(#299 同一病灶)⇒ vanilla PG 上沒有。
--   N3a 的 `pcm_generate_display_id()` 呼 `extensions.gen_random_bytes()`,不補就整批套用失敗。
--   🔴 **已實跑證實非推論**:2026-07-30 provision 跑完 31 支 migration 後查 =
--   `NO-extensions-schema | NO-pgcrypto`。正式站實查 = pgcrypto 1.3 @ schema `extensions`(版本相符)。
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_confirmer') THEN CREATE ROLE payment_confirmer LOGIN; END IF;
  -- 20260719120000 的 ACL 斷言會查 authenticator(Supabase 平台角色)。
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
END $$;

-- 🆕 N3a:Supabase 平台把 pgcrypto 裝在 `extensions` schema;vanilla PG 兩者都沒有。
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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
-- 🔴🔴 **2026-09-01:這一行【與正式站不符】, 而它讓 65 支 harness 兩週跑不起來。**
--    正式庫唯讀實查(Sean 2026-09-01 本人授權的唯讀連線;查 pg_default_acl):
--      SELECT d.defaclobjtype, pg_get_userbyid(d.defaclrole), d.defaclacl::text
--        FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
--       WHERE n.nspname = 'public' AND pg_get_userbyid(d.defaclrole) = 'postgres';
--    ⇒ **f(FUNCTIONS)那一列是 `{postgres=X/postgres}` —— 只有 postgres 自己,**
--      **沒有 anon / authenticated / service_role。**
--    ⇒ 而本檔原本這一行把 EXECUTE 發給那三個角色 ⇒ 隔離庫比正式庫【寬】
--    ⇒ ⇒ `20260818190000_m4b_admin_sso_login_events.sql:318` 的閉世界斷言
--      (「owner 以外的 grantee 應零筆」)在隔離庫必炸:2 支函式 × 3 角色 = 6 筆。
--    📌 **⇒ 而那個斷言是【對的】—— 錯的是這個 shim, 它的職務是模仿正式庫而它沒有。**
--    ⚠️ **grantor 這一格是關鍵**:同一個 schema 底下 `supabase_admin` 授的那一列
--      **確實**含三個角色的 `X`;而本行寫的是 `FOR ROLE postgres` ⇒ **要比的是 postgres 那一列。**
--      🔴 **兩列長得很像, 而只有一列與這一行對應。**
-- ⛔ ~~ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;~~
--    (舊字面留著:拿它去 grep 的人會在同一發撞到這段更正。)
-- ⇒ 正確做法 = **不下那道 ADP**。postgres 建的函式在正式站不自動給那三個角色 EXECUTE,
--   要用的片自己顯式 GRANT(那正是 `docs/patterns/revoking-function-execute-in-supabase.md` 的口徑)。

-- 🛑 **而另外兩行(TABLES / SEQUENCES)【也與正式站不符】—— 本次刻意不動, 理由在下面。**
--    正式站同一次查詢的另外兩列:
--      S(SEQUENCES)⇒ {postgres=rwU, anon=**w**, authenticated=**w**, service_role=**w**}
--                     而本檔寫的是 GRANT **ALL** ⇒ 比正式站寬
--      r(TABLES)   ⇒ {postgres=arwdDxtm, service_role=**Dxtm**, pcm_readonly=r}
--                     🔴 **正式站的 service_role 在這一列【沒有 SELECT】**, 而本檔寫 GRANT ALL 給三個角色
--    🔴 **不動它們的理由是爆炸半徑未知**:很多既有 migration 的 ACL 斷言是對著【這個寬鬆的 shim】寫的
--      (本檔上面那句註解就點名 `20260717010000`「service_role 應可 SELECT」)⇒ 收緊它們可能讓一批
--      本來會過的 migration 當場紅, 而那是另一件事、要另外規劃。
--    📌 **⇒ 但要寫下來:這個 shim 的註解宣稱「照正式站 pg_default_acl 實查值重建」——**
--      **而 2026-09-01 逐列比對, 三列【沒有一列相符】。⇒ 那句宣稱今天是假的。**

COMMIT;
