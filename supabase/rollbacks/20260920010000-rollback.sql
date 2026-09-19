-- 20260920010000-rollback.sql —— 退回 20260920010000_m4b_revoke_old_search_catalog_overload.sql
-- M-4b · 前台線(worktree pcm-ops)
--
-- ═══ 本檔做什麼 ═════════════════════════════════════════════════════════════
-- 把 `public.search_catalog_by_vehicle` **舊 11 參多載**的 `anon` / `authenticated` /
-- `service_role` EXECUTE **加回去**。正片收掉了它們,本檔還原它們。
-- 🔴 `service_role` 是 R1 N5 之後才加進正片的 ⇒ **本檔也要一併還**,
--    那一半是**真的有被收走的東西**,不能比照 PUBLIC 那一半省掉(理由見下面「不對稱」那節)。
-- 🔬 這一段在拋棄式 PG 17.10 實跑過:撤掉之後 `has_function_privilege` 回 `f`,
--    GRANT 回去之後回 `t`。
--
-- ═══ 🔴 還原【不是免費的】—— 它把那個洞打回來 ═══════════════════════════════
-- 還原之後,**任何人拿 anon key、只送那 11 個參數名**,又叫得動舊那支,
-- 而它的本體**不含 gilles 通用區放行** ⇒ 拿到的是一份**舊的、少東西的**結果。
-- 🔴 **而 `service_role` 那一條更糟**:server 端照生成型別送 11 個名字**不會報錯**,
--    會**安靜**拿到舊結果 ⇒ 還原等於把那條【不會大聲壞】的路一起打回來。
-- ⇒ 📌 還原是**知情地把那條路放回去**,不是「回到安全狀態」。
--
-- ═══ 🛑 本檔【不對稱】,而那是刻意的 ════════════════════════════════════════
-- 正片下了**兩道** REVOKE(`FROM PUBLIC` + `FROM anon, authenticated`),
-- 本檔**只還原具名那一道**。
-- 🔬 理由:2026-09-20 實查(§3.6 `coalesce(proacl, acldefault('f', proowner))` 展開找
--    `grantee=0`)⇒ 兩支都 **0 列** ⇒ **PUBLIC 本來就沒有 EXECUTE** ⇒ 正片那一句是空砲,
--    沒有東西被它收走,也就沒有東西要還。
-- 🔴 **而把 `GRANT EXECUTE … TO PUBLIC` 寫進來會是【擴權】,不是還原** ——
--    那會給出一份**貼這片之前也不存在**的權限。
-- ⇒ 📌 **要在別的函式上抄這份 rollback 的人:先自己查一次 PUBLIC 有沒有,**
--    **不要照抄這個不對稱。**
--
-- ═══ 🔵 還原完也要跑 pcm_acl_approve_latest ═════════════════════════════════
-- 本檔一樣改 ACL ⇒ 不跑的話每日 LINE 摘要會叫「權限與昨天不一樣」(runbook §0-c)。
-- 🛑 `supabase/acl-snapshot.tsv:1018-1019` 那兩列也要跟著回到還原後的樣子。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  v_old CONSTANT text := 'public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone)';
BEGIN
  IF pg_catalog.to_regprocedure(v_old) IS NULL THEN
    RAISE EXCEPTION '還原前置閘:舊 11 參多載不存在 ⇒ 它被 DROP 掉了, 本檔還原不了(GRANT 沒有對象)⇒ 停下';
  END IF;
END
$pre$;

GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone) TO anon, authenticated, service_role;

DO $post$
DECLARE
  v_old_oid oid := pg_catalog.to_regprocedure('public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone)');
BEGIN
  IF NOT pg_catalog.has_function_privilege('anon', v_old_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '還原事後斷言:anon 還是沒有 EXECUTE ⇒ 還原沒成功';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_old_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '還原事後斷言:authenticated 還是沒有 EXECUTE ⇒ 還原沒成功';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_old_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '還原事後斷言:service_role 還是沒有 EXECUTE ⇒ 還原沒成功';
  END IF;
END
$post$;

-- 🔴 與正片同一個理由:REVOKE / GRANT 不在 pgrst_ddl_watch 白名單裡
NOTIFY pgrst, 'reload schema';

COMMIT;
