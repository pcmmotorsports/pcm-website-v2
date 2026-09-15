-- 20260916040000_m4b_admin_list_pcm_incidents.sql
-- M-4b · 後台看得到事故紀錄:pcm_incident 的唯讀窄門(稽核 P2-7;主視窗 2026-09-15 派)
-- plan:docs/plans/2026-09-15-admin-incident-list-plan.md(R2 PASS;Sean「都可以看」)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- pcm_incident 連 service_role 都 REVOKE、RLS 0 policy(20260905290000:137-161);唯一讀口
-- get_pcm_incident_health() 只回各 kind 筆數 ⇒ 後台看不到是哪一張單、什麼錯。
-- ⇒ 開一支 SECURITY DEFINER 讀取函式當門,GRANT EXECUTE 只給 service_role(後台 server 端代讀)。
-- 🔴 不加 policy、不 GRANT SELECT:那會打開一條直接讀表的路。表本身的權限本檔一個字都不改。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 新函式 public.admin_list_pcm_incidents(p_limit integer, p_open_only boolean)(新物件 ⇒ 裸 CREATE)
--    · p_limit NULL ⇒ 50;夾 1..200。p_open_only NULL ⇒ true(只回未解決)。
--      🔴 NULL 不准靜靜回 0 列 —— 那長得和「沒有事故」一樣。
--    · ORDER BY created_at DESC, id DESC。
--    · 既有部分索引是 (kind, created_at DESC) WHERE resolved_at IS NULL,排不了 created_at;事故列很少,刻意不另建索引。
-- ② ACL:REVOKE PUBLIC / anon / authenticated / service_role / payment_confirmer,GRANT EXECUTE 給 service_role。
-- ③ 後置閘:存在、owner postgres、SECURITY DEFINER、search_path 釘死、四個角色 f + service_role t、
--    pattern §3.5 枚舉查詢零列、表本身對 service_role 仍無 SELECT。
--
-- ══ 貼板必附 ════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶版本號 20260916040000;Sean 0914 拍甲):每日 ACL 摘要會把 public 每支函式的 EXECUTE 算進去
--    (20260909060000:136-143),本檔新增一支 ⇒ 不核准就會轉紅。
-- 🔴 上線順序:本檔先貼 + APPLIED.tsv 同顆 commit,後台讀這支函式的那片才合 dev(dev = 後台 production)。
--
-- ══ rollback ════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- supabase/rollbacks/20260916040000-rollback.sql(DROP 函式;退完同批再跑 pcm_acl_approve_latest;先退後台片)。
-- 手動在 psql 貼退回步驟時,上面那句 lock_timeout 要先下(rollback 檔第一句也帶了),否則卡在鎖上會無限等。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.pcm_incident') IS NULL THEN
    RAISE EXCEPTION '前置閘一:public.pcm_incident 不存在 ⇒ 20260905290000 還沒貼, 本檔沒有對象';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_list_pcm_incidents(integer, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘二:admin_list_pcm_incidents(integer, boolean) 已存在 ⇒ 本檔貼過了或有人先建了, 停下人工對齊';
  END IF;
  -- 🔴 definer 讀得到資料的前提:表 owner = postgres 且沒被 FORCE RLS(0 policy + FORCE ⇒ 本函式會安靜回 0 列,
  --    畫面就像「沒有事故」)。寫法照 20260907140000:100-107。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = 'public.pcm_incident'::regclass
                    AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
                    AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '前置閘三:public.pcm_incident 的 owner 不是 postgres, 或被 FORCE ROW LEVEL SECURITY ⇒ 本函式會讀不到資料而回 0 列';
  END IF;
END
$pre$;

-- ── ① 讀取窄門(新物件 ⇒ 裸 CREATE) ─────────────────────────────
CREATE FUNCTION public.admin_list_pcm_incidents(p_limit integer, p_open_only boolean)
RETURNS TABLE (
  id          bigint,
  kind        text,
  subject_id  uuid,
  detail      text,
  created_at  timestamptz,
  resolved_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT i.id, i.kind, i.subject_id, i.detail, i.created_at, i.resolved_at
    FROM public.pcm_incident i
   WHERE NOT COALESCE(p_open_only, true)
      OR i.resolved_at IS NULL
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$fn$;
COMMENT ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) IS
  '後台事故紀錄頁的唯讀窄門(20260916040000;稽核 P2-7)。回 pcm_incident 單筆(含 detail / subject_id),'
  ' p_limit NULL⇒50 夾 1..200、p_open_only NULL⇒true。EXECUTE 只給 service_role(後台 server 端代讀);'
  ' 表本身仍對所有角色 0 權限。Sean 2026-09-15「都可以看」:能登入後台的員工都看得到全文。';

-- ── ② ACL ────────────────────────────────────────────────────
ALTER FUNCTION public.admin_list_pcm_incidents(integer, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) FROM anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) TO service_role;

-- ── ③ 後置閘 ──────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;可授權物件 1 = 窄門)
  v_functions text[] := ARRAY[
    'public.admin_list_pcm_incidents(integer, boolean)'
  ]::text[];
  r      text;
  v_oid  regprocedure;
  v_leak integer;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '後置閘一:% 不存在', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_oid
                      AND p.prosecdef
                      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '後置閘二:% 不是 owner=postgres + SECURITY DEFINER + search_path 釘空', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('payment_confirmer', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘三:% 對 anon / authenticated / payment_confirmer 開著 EXECUTE', r;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
       AND pg_catalog.has_function_privilege('pcm_readonly', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 pcm_readonly 開著 EXECUTE', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘五:% service_role 不能 EXECUTE ⇒ 後台讀不到', r;
    END IF;
    -- docs/patterns/revoking-function-execute-in-supabase.md §3.5:anon 切得過去、且可執行的角色要零列
    SELECT pg_catalog.count(*) INTO v_leak
      FROM pg_catalog.pg_roles ro
     WHERE pg_catalog.pg_has_role('anon', ro.oid, 'SET')
       AND pg_catalog.has_function_privilege(ro.oid, v_oid, 'EXECUTE');
    IF v_leak <> 0 THEN
      RAISE EXCEPTION '後置閘六:% 有 % 個 anon 切得過去的角色可執行(SET ROLE 繞路)', r, v_leak;
    END IF;
  END LOOP;
  -- 表本身權限不准被本檔動到(用 any_column:欄位層級的 SELECT 授權也要抓到)
  IF pg_catalog.has_any_column_privilege('service_role', 'public.pcm_incident', 'SELECT') THEN
    RAISE EXCEPTION '後置閘七:service_role 對 public.pcm_incident 有(欄位或表層級的)SELECT ⇒ 表的窄門被打開了';
  END IF;
END
$post$;

COMMIT;
