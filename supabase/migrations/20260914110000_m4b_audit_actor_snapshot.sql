-- pcm:idempotent: yes
-- 理由:唯一的 apply 當下 DML 是回填 UPDATE, 帶 WHERE actor_label IS NULL ⇒ 第二次跑 0 列;而且前置閘③(欄已存在 ⇒ RAISE)讓整支第二次根本進不了那一句。
--      探針庫 55554 實證(2026-09-14):已貼後再跑 ⇒ 前置閘③ 拒、計數 3/5 不變;硬跑回填那一句第二次 ⇒ 0 列、計數 3/5 不變。
-- ══════════════════════════════════════════════════════════════════
-- ⟦b4-MGR0-RPC⟧ 的另一半:稽核列凍結「當時是誰、當時什麼角色」(2026-09-14, 主視窗 ef 批)
--
-- 🔴 病:admin_audit_log.actor 只存 staff id slug(20260712210000:45);名字與角色都是顯示端【現在】去 staff 表查。
--    ⇒ 員工一停用(listActiveStaff 濾掉)⇒ 他過去每一列都變成機器字串;改 label ⇒ 過去每一列跟著改;
--       角色從來沒記過 ⇒ 事後看不出「做那件事的當下他是不是管理者」。
-- ✅ 解:本表加兩欄 actor_label / actor_is_manager, BEFORE INSERT trigger 在寫入當下從 public.staff 補。
--    · 寫入端【零改動】:82 支含稽核 INSERT 的 migration 與 app 端 ~50 檔一字不改 —— 欄位可 NULL、trigger 只補 NULL。
--    · staff 查無 ⇒ 留 NULL【不 RAISE】:稽核不能因為快照失敗而少一筆(少一筆比少一個名字嚴重)。
--    · RPC 內同交易寫的稽核 ⇒ 快照 = 那一筆交易看到的身分, 這才是「當時」。
-- 🛑 本支【不碰】TOCTOU 那三支 RPC(docs/plans/2026-09-07-mgr0-rpc-toctou-plan.md, 等 Sean 鐵則 8);
--    兩片互補:本支貼了之後, 被搶到的那一筆會自己寫出 actor_is_manager=false, 紀錄不再「看起來正常」。
-- 🔴 回填那段(§3)寫的是【現在的】label / is_manager, 不是【當時的】—— 舊列本來就沒有那個資訊, 沒有任何地方能還原。
--    顯示端對舊列要照樣把它當「現在的名字」看;plan(docs/plans/2026-09-14-audit-actor-snapshot-plan.md)同句。
--    本表約定 append-only(service_role 只 INSERT):回填是 migration 以 owner 跑的一次性 UPDATE, 【不加】任何 UPDATE GRANT。
-- 回滾:supabase/rollbacks/20260914110000_down.sql(DROP TRIGGER / FUNCTION / 兩欄;欄是新的, 丟掉不傷既有資料)。
-- ══════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
-- codex R1 nit:ADD COLUMN 的 ACCESS EXCLUSIVE 會一路握到 COMMIT(含回填);lock_timeout 只管【等鎖】不管【持鎖】
-- ⇒ 給【每一句】30s 上界(statement_timeout 是每句不是整段;本支最重的一句是回填 UPDATE)。
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.admin_audit_log';
  END IF;
  IF pg_catalog.to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.staff(20260726120000 還沒貼)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.admin_audit_log'::regclass AND attname = 'actor_label' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘③:actor_label 已存在 ⇒ 本支貼過了';
  END IF;
  IF pg_catalog.to_regclass('public.zzq_no_such_table_20260914c') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
  -- 記下本表 ACL 的樣子, 後置閘⑤比對「本支一個 GRANT 都沒動」(不斷言絕對值:探針庫的 ACL 與正式庫不同, 那不是本支的事)
  CREATE TEMP TABLE pcm_acl_before_20260914110000 ON COMMIT DROP AS
    SELECT COALESCE(c.relacl::text, '') AS acl FROM pg_catalog.pg_class c WHERE c.oid = 'public.admin_audit_log'::regclass;
END
$pre$;

-- ── 1. 兩欄(可 NULL;既有 INSERT 路徑不帶也不會 23502)────────────────────
ALTER TABLE public.admin_audit_log
  ADD COLUMN actor_label      text,
  ADD COLUMN actor_is_manager boolean;
COMMENT ON COLUMN public.admin_audit_log.actor_label IS
  '寫入當下 staff.label 的快照(trigger 補)。NULL = 寫入當下 staff 查無此 id。'
  ' 🔴 20260914110000 之前的舊列由該支回填【現在的】label, 不是當時的。';
COMMENT ON COLUMN public.admin_audit_log.actor_is_manager IS
  '寫入當下 staff.is_manager 的快照(trigger 補)。NULL = 寫入當下 staff 查無此 id。'
  ' 🔴 20260914110000 之前的舊列由該支回填【現在的】角色, 不是當時的。';

-- ── 2. BEFORE INSERT trigger:只補 NULL、查無不擋 ───────────────────────
CREATE FUNCTION public.pcm_audit_actor_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_label text;
  v_is_manager boolean;
BEGIN
  IF NEW.actor_label IS NULL OR NEW.actor_is_manager IS NULL THEN
    SELECT s.label, s.is_manager INTO v_label, v_is_manager
      FROM public.staff s
     WHERE s.id = NEW.actor;
    -- 🔴 codex R1 must-fix:SELECT INTO 查無時會把目標【清成 NULL】(plpgsql 語意), 直接 INTO NEW.* 會把呼叫端
    --    自帶的半套快照抹掉 ⇒ 先進區域變數, FOUND 才逐欄只補 NULL。查無 ⇒ 一字不動、不 RAISE(稽核少一筆比少一個名字嚴重)。
    IF FOUND THEN
      NEW.actor_label      := COALESCE(NEW.actor_label, v_label);
      NEW.actor_is_manager := COALESCE(NEW.actor_is_manager, v_is_manager);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pcm_audit_actor_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER admin_audit_log_actor_snapshot_bi
  BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_audit_actor_snapshot();

-- ── 3. 一次回填舊列(🔴 回填的是【現在的】身分, 不是【當時的】;owner 跑, 不加 UPDATE GRANT)──
UPDATE public.admin_audit_log a
   SET actor_label = s.label, actor_is_manager = s.is_manager
  FROM public.staff s
 WHERE a.actor = s.id AND a.actor_label IS NULL;

-- ── 4. 後置閘 ─────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.pcm_audit_actor_snapshot()'
  ]::text[];
  v_name text;
  v_fn regprocedure;
  v_missing bigint;
BEGIN
  FOREACH v_name IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(v_name);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '後置閘①:% 沒建起來', v_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.admin_audit_log'::regclass AND t.tgname = 'admin_audit_log_actor_snapshot_bi') THEN
    RAISE EXCEPTION '後置閘②:trigger 沒掛上';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘③:trigger 函式不該讓任何角色直接叫';
  END IF;
  -- 回填:凡 actor 在 staff 表裡的舊列都該有 label 了
  SELECT count(*) INTO v_missing
    FROM public.admin_audit_log a
    JOIN public.staff s ON s.id = a.actor
   WHERE a.actor_label IS NULL;
  IF v_missing <> 0 THEN
    RAISE EXCEPTION '後置閘④:回填漏了 % 列', v_missing;
  END IF;
  -- 本支一個 GRANT 都沒動:表 ACL 前後逐字相同(回填是 owner 跑的, 不需要也不該加權)
  IF (SELECT COALESCE(c.relacl::text, '') FROM pg_catalog.pg_class c WHERE c.oid = 'public.admin_audit_log'::regclass)
     <> (SELECT acl FROM pcm_acl_before_20260914110000) THEN
    RAISE EXCEPTION '後置閘⑤:admin_audit_log 的 ACL 被本支改了 ⇒ 不該';
  END IF;
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260914c()') IS NOT NULL THEN
    RAISE EXCEPTION '後置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
  RAISE NOTICE 'admin_audit_log.actor_label / actor_is_manager 貼好了(trigger 補、舊列已用現在身分回填)。';
END
$post$;

COMMIT;
