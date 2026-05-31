-- ============================================================
-- M-1-16a Slice：#172 部分收斂 — rls_auto_enable function 納管 + EXECUTE 收斂
-- ============================================================
-- 對齊：
--   docs/phase-1-backlog.md #172（Sean 2026-05-23 Q1=A「該做」）
--   docs/audits/2026-05-24-supabase-db-reconciliation.md 第三節（2026-05-24 Q3=A
--     拍板「維持不急、不另開專門 slice、折入 M-1-16 下個 migration 順手帶」）
--   Sean D2=A（輕量版：納管 function 定義 + REVOKE EXECUTE、不重建 event trigger）
--   codex 關卡1 must-fix 2（字面精準化：本片是 #172 部分收斂、不宣稱關閉 #172）
--
-- 背景：
--   線上 event trigger `ensure_rls`（ddl_command_end）+ function
--   `public.rls_auto_enable()`（owner postgres、SECURITY DEFINER、
--   SET search_path='pg_catalog'）= Supabase 環境自帶安全網（新 public 表自動 enable RLS），
--   但從未進版控（drift）+ advisor security 2 WARN（0028/0029）：
--   anon / authenticated 可經 /rest/v1/rpc/rls_auto_enable 呼叫此 SECURITY DEFINER function。
--
-- 本片做（#172 部分收斂）：
--   (1) CREATE OR REPLACE FUNCTION 把現有定義納入版控（可重播 function 本體）。
--       —— 下方定義逐字抄自線上 pg_get_functiondef（2026-05-31 抓），CREATE OR REPLACE
--          不改行為（同義重建）；審查 session 會對線上 pg_proc 逐字比對。
--   (2) REVOKE EXECUTE FROM PUBLIC, anon, authenticated（清 0028/0029、收斂 ACL
--       至 postgres + service_role，對齊 handle_new_auth_user / sync_wallet 既有收斂範本）。
--
-- 本片不做（留 backlog #172 標部分完成）：
--   event trigger `ensure_rls` 重建（D2=A）。它已在線上正常運作、owner=postgres、
--   CREATE EVENT TRIGGER 無 OR REPLACE（需先 DROP、刪除瞬間安全網消失 + 可能權限不足），
--   重建不影響清 advisor WARN。→ 「可重播納管 event trigger」子項留 backlog #172。
--   驗收須確認線上 ensure_rls 仍存在且指向 public.rls_auto_enable()（輕量版沒破壞安全網）。
--
-- Rollback（forward-only、僅供參考勿執行）：
--   不建議回復 EXECUTE 外露（回復 = 退回 advisor 0028/0029 WARN 狀態）。
--   pre-state ACL 留底（2026-05-31）：{=X, anon=X, authenticated=X, postgres=X, service_role=X}。
--   function 定義：CREATE OR REPLACE 同義重建、無行為變更、無需回滾。
--   真要回復外露才：GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;
-- ============================================================


-- (1) 納管 function 定義（逐字抄線上、CREATE OR REPLACE 同義重建）
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;


-- (2) EXECUTE 收斂：移除 PUBLIC / anon / authenticated 外露（清 advisor 0028/0029）
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
