-- ============================================================================
-- 片1 測試 fixture —— 🛑 草稿的測試,不是 migration。**四支 harness 共用這一份。**
-- ============================================================================
-- 🔴🔴 為什麼要有這支檔(2026-08-28 code-reviewer 抓到,而 codex 三輪都沒碰到):
--    我原本在每支 harness 裡【各自手寫一份簡化的 staff / admin_audit_log】。
--    而 `admin_audit_log.request_id` 真表是 `NOT NULL` + `CHECK (<> '')`,
--    我寫成 `request_id text`(可空、零 CHECK)—— **比真表寬**。
--    ⇒ 四支 RPC 把 `p_request_id` 原樣塞進去, 而我 39 格測試有 9 格傳 NULL
--    ⇒ 📌 **那條 bug 在 30 發突變 + 39 格 + 22 道碼錨底下【恆綠】。**
--    ⇒ 🔴 **而 codex 三輪看的是同一份假世界 —— 對抗審查沒有自己的世界, 它看的是我給它的那個。**
--       ⇒ **三輪不是三個獨立的證據, 是【同一個前提被檢查了三次】。**
--
-- 🔴 **本檔的 DDL 是【照真表逐字抄】的, 不是「補上我知道缺的那幾道」。**
--    📌 那兩件事的差別, 就是上面那個病:我昨晚才寫過「乾淨環境會殺掉守門判別力」,
--       而我把它套在 sequence 那一格、沒套在 audit 這一格。
--    ⇒ 抄的來源(引字面不引行號):
--      `20260712210000_m4a_admin_audit_log.sql` 的 `CREATE TABLE public.admin_audit_log`
--      `20260726120000_m4b_e8a1_staff_table.sql` 的 `CREATE TABLE public.staff`
--    ⚠️ 那兩支若改了, 本檔要跟著改 —— 而**沒有任何機制會提醒**(已知缺口)。
-- ============================================================================

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 🔴 把 Supabase 的 default ACL 前提造出來 —— 沒有它, 每一發打 REVOKE 的守門都恆綠
--    (新物件本來就沒有權限可撤 ⇒「有 REVOKE」與「沒 REVOKE」印同一個結果)。
--    依據:正式庫 2026-08-14 實測 `pg_default_acl` ⇒ 四個角色各 `arwdDxtm`。
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── 逐字抄自 20260726120000_m4b_e8a1_staff_table.sql ──
CREATE TABLE public.staff (
  id          text        PRIMARY KEY,
  label       text        NOT NULL,
  is_manager  boolean     NOT NULL DEFAULT false,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_id_nonempty    CHECK (id <> ''),
  CONSTRAINT staff_id_format      CHECK (id ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT staff_label_nonempty CHECK (pg_catalog.btrim(label) <> '')
);

-- ── 逐字抄自 20260712210000_m4a_admin_audit_log.sql ──
-- 🔴 `id` 是 **uuid DEFAULT gen_random_uuid()**, 不是 identity —— 我原本也寫錯成 identity。
-- 🔴 `request_id` 是 **NOT NULL** + CHECK —— 就是那條 bug 藏身的地方。
CREATE TABLE public.admin_audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       text        NOT NULL,
  action      text        NOT NULL,
  target      text,
  before      jsonb,
  after       jsonb,
  reason      text,
  request_id  text        NOT NULL,
  source_app  text        NOT NULL DEFAULT 'admin',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_actor_nonempty      CHECK (actor      <> ''),
  CONSTRAINT admin_audit_log_action_nonempty     CHECK (action     <> ''),
  CONSTRAINT admin_audit_log_request_id_nonempty CHECK (request_id <> ''),
  CONSTRAINT admin_audit_log_source_app_check    CHECK (source_app IN ('admin', 'quote'))
);

INSERT INTO public.staff (id, label, is_manager) VALUES
  ('boss',  'boss',  true),
  ('clerk', 'clerk', false),
  ('gone',  'gone',  false);
UPDATE public.staff SET is_active = false WHERE id = 'gone';
