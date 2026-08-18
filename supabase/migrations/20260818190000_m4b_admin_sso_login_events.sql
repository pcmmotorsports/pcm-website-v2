-- ============================================================
-- M-4b · 後台登入紀錄寫進自家 DB(Sean 2026-08-18 `Q04=乙` + 三個岔路 `甲/甲/甲`)
--
-- 🔴🔴 **本檔一旦進入 `supabase/migrations/`,下一發 `db push` 會【連它一起推】。**
--    (主視窗 2026-08-18 指示,照 G5 先例落檔。)⇒ 在它被審完之前,任何一發 push 都會帶走它。
--    ⇒ **apply 由主視窗執行,G4 不碰正式庫。**
--
-- 🔴🔴 **重跑行為:本檔用 `IF NOT EXISTS` / `OR REPLACE` ⇒ 【重跑不會炸】。**
--    ⚠️ **而同一批待推的 migration 裡有寫法不同的**(例:`20260818170000_m4b_g3_customer_favorites.sql`
--    建表不帶 `IF NOT EXISTS` ⇒ **重跑會炸,那是它刻意的 fail-closed**)。
--    ⇒ **那一發 push 若中途失敗要重跑,兩支的行為不一樣** —— 打指令之前先知道這一格,
--      不要看到其中一支炸了就以為整批都不能重跑,也不要因為這支能重跑就以為整批都能。
--    (G6 2026-08-18 盤點時指出;本行寫在這裡,是因為**重跑的人會打開的是這支檔,不是那封信**。)
--
-- 為什麼(Sean 已拍板,依據在 plan,不在這裡重述):
--   Vercel Hobby 的 runtime log 保留 = **1 小時**,而 log drain 要 Pro。
--   ⇒ 出事那天要回答「誰、什麼時候、從哪裡登入了後台」,**一小時之後就沒有任何地方查得到**。
--   ⇒ 把登入事件寫進自己的 DB。
--
-- 🔴 **這張表要防的人,包含拿到 `service_role` 金鑰的人** —— 所以:
--   · 只給 INSERT + SELECT,**不給 DELETE**(拿到 key 的人不能刪掉自己的登入紀錄)
--   · 90 天保留改由 owner 的 `SECURITY DEFINER` 函式做,只 GRANT EXECUTE
--
-- Plan: docs/specs/2026-08-18-admin-login-events-to-own-db-draft.md §7
-- 形狀來源:`20260712210000_m4a_admin_audit_log.sql`(**抄它的骨架,不自己發明**)
--   差異兩處,各自申報:
--     ① 本表 `service_role` **有 SELECT** —— 那張表是純 append-only 只有 INSERT(`:89`,且 `:113-115`
--        拿到 SELECT 就 RAISE);而**本表存在的理由就是「出事那天查得到」**,沒有 SELECT 這張表等於白建。
--     ② 本表有清理函式(90 天保留);那張表沒有保留政策。
--
-- 🔴 硬前置(**2026-08-18 19:1x 當場複查:已滿足**):
--   `20260817060000_e683_1_public_default_privileges_revoke.sql`
--   ~~「APPLIED.tsv 查無,分母 179 列」~~ ⇒ **已作廢**:現在 `supabase/APPLIED.tsv:213` 有它,
--   第 3 欄是真日期 `2026-08-18`(不是 `backfill`)、記錄者「主視窗(跑)/G4(記)」,分母 215 列。
--   量法(可重跑):`grep -n "20260817060000" supabase/APPLIED.tsv`
--   ⇒ 新表**不再出生自帶 `anon=Dxtm`**。**但下面那道 REVOKE 仍然要寫** —— 它是縱深,
--     而且 default privileges 是一個「dashboard 上改得回去、而不會有任何東西紅」的設定。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION public.purge_admin_sso_login_events();
--   DROP TABLE public.admin_sso_login_events;   -- 連帶 PK / 2 CHECK / grant 一併消失
--   🔴 **資料會一起消失,而那是 PII** ⇒ rollback 前先問「那些列還需不需要」。
--   ⚠️ 寫入端(`apps/admin/src/lib/sso/security-log.ts`)的 revert 要與 DROP **同一次部署**,
--      否則它會對著不存在的表寫、每次登入吃一個 catch。
-- ============================================================

-- ── 1. 表 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_sso_login_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🔴 DB 權威時間,server **不回填**(防竄改;鏡像 admin_audit_log:53)。
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  outcome      text        NOT NULL,
  reason       text,                                  -- 失敗類別;成功為 NULL
  amr          text,                                  -- 'pwd' / 'pwd+totp'…非敏感
  request_id   text,                                  -- 對得回 Vercel log(在它還在的那一小時內)
  source_app   text        NOT NULL DEFAULT 'quote',
  -- 🔴 PII(Sean 2026-08-18 拍「記」)。**用 `inet` 不用 `text`**:型別本身就是驗證,
  --    而 `x-forwarded-for` 是**客戶端可控**的標頭 —— 解析不出來就寫 NULL,
  --    **不要把一個未驗證的字串原封留在稽核表裡**。
  --    ⚠️ proxy 後面拿到的可能是一串 IP,**取哪一個是 app 層的決定**,而那個決定會影響鑑識結論
  --       ⇒ 取法寫在 `security-log.ts` 的註解裡,不要讀成「這就是客人的 IP」。
  ip           inet,
  user_agent   text,
  CONSTRAINT admin_sso_login_events_outcome_check    CHECK (outcome IN ('success', 'fail')),
  CONSTRAINT admin_sso_login_events_source_app_check CHECK (source_app IN ('admin', 'quote'))
);

COMMENT ON TABLE public.admin_sso_login_events IS
  'M-4b 後台 SSO 登入事件(Sean 2026-08-18 Q04=乙)。Vercel Hobby runtime log 只留 1 小時、drain 要 Pro ⇒ 鑑識視窗一小時 ⇒ 寫進自家 DB。🔴 這張表要防的人包含拿到 service_role 金鑰的人 ⇒ 只 INSERT+SELECT、無 DELETE;90 天保留由 owner 的 SECURITY DEFINER 函式 purge_admin_sso_login_events() 做。ip/user_agent 是 PII:log/告警/錯誤訊息一律不得帶原值。';

COMMENT ON COLUMN public.admin_sso_login_events.ip IS
  '🔴 PII。來源 x-forwarded-for 系列標頭(客戶端可控)⇒ inet 解析失敗一律寫 NULL、不留原字串;取哪一段由 app 層決定,見 apps/admin/src/lib/sso/security-log.ts。90 天由 purge 函式刪。';

-- 查詢面:出事那天是「最近往前翻」與「找某一次失敗」⇒ 時間降冪 + outcome 過濾。
CREATE INDEX IF NOT EXISTS admin_sso_login_events_occurred_at_desc_idx
  ON public.admin_sso_login_events (occurred_at DESC);
-- purge 函式與「只看失敗」都吃這條(占比小 ⇒ 部分索引)。
CREATE INDEX IF NOT EXISTS admin_sso_login_events_fail_occurred_at_idx
  ON public.admin_sso_login_events (occurred_at DESC)
  WHERE outcome = 'fail';

-- ── 2. RLS zero-policy + 表 ACL ────────────────────────────────
ALTER TABLE public.admin_sso_login_events ENABLE ROW LEVEL SECURITY;

-- 🔴 先撤乾淨(含 service_role),再精準只補要用的兩個。
--    這一行擋的是「新表出生自帶的授權」——`TRUNCATE` **不受 RLS 管**,零 policy 擋不住它。
REVOKE ALL ON TABLE public.admin_sso_login_events FROM PUBLIC, anon, authenticated, service_role;

-- INSERT = 寫登入事件;SELECT = 出事那天查得到(與 admin_audit_log 的差異,已於檔頭申報)。
-- 🔴 **不給 DELETE / UPDATE / TRUNCATE** —— 拿到金鑰的人不得抹掉自己的登入紀錄。
GRANT INSERT, SELECT ON TABLE public.admin_sso_login_events TO service_role;

-- ── 3. 90 天保留:清理權**不給** service_role ───────────────────
CREATE OR REPLACE FUNCTION public.purge_admin_sso_login_events()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH d AS (
    DELETE FROM public.admin_sso_login_events
     WHERE occurred_at < pg_catalog.now() - interval '90 days'
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM d;
$fn$;

-- 🔴🔴 這一行**不是形式**:新建函式的 `pg_proc.proacl` 是 `NULL`,而 **NULL 不是零權限** ——
--    `acldefault('f', owner)` ⇒ `{=X/postgres,postgres=X/postgres}`,開頭那個 `=X` 就是 **PUBLIC 的 EXECUTE**。
--    不寫這一行,`anon` 就能執行這支**刪除**函式。
--    (G4 2026-08-18 於拋棄式 PG 17.10 實測;正式庫 17.6 ⇒ 那一發證的是機制不是現值。
--     正典 `docs/patterns/revoking-function-execute-in-supabase.md:264`。)
REVOKE ALL ON FUNCTION public.purge_admin_sso_login_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_admin_sso_login_events() TO service_role;

COMMENT ON FUNCTION public.purge_admin_sso_login_events() IS
  'M-4b 90 天保留(Sean 2026-08-18 拍)。🔴 存在的理由是【不把 DELETE 給 service_role】—— 拿到金鑰的人不得抹掉自己的登入紀錄。owner=postgres 的 SECURITY DEFINER + search_path='''';只 GRANT EXECUTE TO service_role。回傳刪除列數(給排程對帳用)。排程見 pg_cron(本 migration 不建 job)。';

-- ── 4. apply 期 fail-closed 斷言 ───────────────────────────────
-- 🔴 這一段的存在理由:**GRANT 出錯不會讓任何東西紅** —— repo 內零 `GRANT` 字面可掃、三綠不紅。
--    斷言是這條路上**唯一**會在錯的時候停下來的東西。
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_cnt  integer;
BEGIN
  -- 4a. client 三角色(含 PUBLIC)7 權限全零。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.admin_sso_login_events', v_priv) THEN
        RAISE EXCEPTION 'admin_sso_login_events ACL 異常 — % 不應有 %(client 須全鎖);拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 4b. service_role 必須有 INSERT 與 SELECT(缺任一 = 這張表白建 / 寫不進去)。
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'SELECT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.admin_sso_login_events', v_priv) THEN
      RAISE EXCEPTION 'admin_sso_login_events ACL 異常 — service_role 應有 %;拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4c. 🔴 service_role 其餘 5 權限全零 —— **這一格是本表的重點**:
  --     有 DELETE 就代表「拿到金鑰的人可以抹掉自己的登入紀錄」,那正是本表要防的事。
  FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('service_role', 'public.admin_sso_login_events', v_priv) THEN
      RAISE EXCEPTION 'admin_sso_login_events ACL 異常 — service_role 不應有 %(保留政策走 purge 函式,不走 DELETE 權);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4d. relacl allowlist:owner / service_role 以外的 grantee 零筆。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS a
   WHERE n.nspname = 'public'
     AND c.relname = 'admin_sso_login_events'
     AND a.grantee <> 0                                   -- 0 = PUBLIC(4a 已單獨驗)
     AND a.grantee <> c.relowner
     AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'admin_sso_login_events relacl 異常 — owner/service_role 以外的 grantee 應零筆(實 % 筆);拒繼續', v_cnt;
  END IF;

  -- 4e. 🔴 欄級授權必須全空。
  --     `has_table_privilege` **看不到欄級授權**(E 窗 2026-08-17 實測少報 2 vs 實際 3)
  --     ⇒ 只驗 4a-4c 的話,有人 `GRANT SELECT(ip) TO anon` 這一整段照樣全過。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'admin_sso_login_events'
     AND a.attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'admin_sso_login_events 欄級授權異常 — attacl 應全空(實 % 欄有值);拒繼續', v_cnt;
  END IF;

  -- 4f. RLS 已開且 policy 數 = 0(零 policy 縱深:誤 grant 時仍讀不到列)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'admin_sso_login_events' AND c.relrowsecurity;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'admin_sso_login_events RLS 未啟用;拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'admin_sso_login_events';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'admin_sso_login_events 應為 zero-policy(實 % 條);拒繼續', v_cnt;
  END IF;

  -- 4g. 🔴 purge 函式:PUBLIC / anon / authenticated 不得有 EXECUTE。
  --     (proacl=NULL 時 PUBLIC 預設就有 EXECUTE ⇒ 少了上面那道 REVOKE,這一格會 RAISE。)
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.purge_admin_sso_login_events()', 'EXECUTE') THEN
      RAISE EXCEPTION 'purge_admin_sso_login_events EXECUTE 異常 — % 不應執行得了刪除函式;拒繼續', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.purge_admin_sso_login_events()', 'EXECUTE') THEN
    RAISE EXCEPTION 'purge_admin_sso_login_events EXECUTE 異常 — service_role 應執行得了(排程要用);拒繼續';
  END IF;
END $$;
