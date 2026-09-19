-- 20260920010000_m4b_revoke_old_search_catalog_overload.sql
-- M-4b · 前台線(worktree pcm-ops)
-- 🔬 版本號主視窗核過無撞號(2026-09-20):`supabase/migrations` 裡 `20260920` 開頭 0 支 ·
--    全 repo grep `20260920010000` 0 命中 · 帳本最後一筆 `20260919140000`。
-- plan:~/pcm-mailbox/plan-revoke-舊多載-search_catalog_by_vehicle-20260920.md
--   🛑 **敘事在 plan,不在這裡**(docs/patterns/where-migration-narrative-goes.md)。
--   Sean 2026-09-20 逐字「Q11(REVOKE 批」⇒ 批的是 **REVOKE,不是 DROP**。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════════
-- 收掉 `public.search_catalog_by_vehicle` **舊 11 參多載**的 `anon` /
-- `authenticated` EXECUTE。**不 DROP**,那支函式留著。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════════════
-- 正式庫上這個名字有【兩支】:
--   舊 11 參(`p_brand` 起頭,無 `p_categories` / `p_terms` / `p_fit_scope`)
--        md5 `169bf9136f502dd8269f699255782342` · 本體**不含** gilles 通用區放行
--   新 14 參(`p_categories text[]` 起頭)
--        md5 `9242dea94a4ff272efdf485603d821bb` · 本體**含**
-- 顧客站唯一呼叫點 `apps/storefront/src/lib/products.ts:583`,TS 型別**強制**送 14 個
-- 具名參數 ⇒ **PostgREST 靠參數名集合選多載** ⇒ 舊那支少三個名字 ⇒ **網站命中不了**,
-- 也不會 `PGRST203`(不模糊)。
-- 📌 **這同時解釋了「為什麼今天沒出事」與「為什麼還是要收」** ——
--    網站命中不了 ≠ 外面的人命中不了,**外面的人可以自己挑名字送**,
--    而送到舊那支會拿到一份**沒有 gilles 放行**的舊結果。
--
-- ══ 分母(2026-09-20 實查,逐項可重跑)═══════════════════════════════════════
--   庫內其他呼叫者              0   (`pg_proc.prosrc` 全掃;唯一命中是 `_dealer` 的【註解】)
--   repo 內呼叫點                1   (就是上面那個,送 14 個名字)
--   報價單專案                   —   **不同 Supabase 專案、不同庫**,那個庫裡 0 支同名函式
--   Edge Functions(顧客站)      0   (正對照:同一工具問報價單專案 ⇒ 1 支,工具會回東西)
--   14 天 PostgREST 流量         舊那支 **零列** / 新那支 17,389 次
--
-- ══ 🔴 兩個【未確認】,照實寫,不要讀成 0 ══════════════════════════════════════
--   ① 上面那個「零列」的窗口是 `pg_stat_statements`,而它現在 **4,857 / 上限 5,000(97% 滿)**
--      ⇒ **淘汰是活的**,一支十四天內只被叫過一兩次的語句**有可能已經被擠掉**。
--      ⇒ 📌 正確讀法是「**14 天內沒有【常態】流量打舊那支**」,**不是「絕對沒人叫過」**。
--   ② **不在這台機器上的第三方或腳本**拿 anon key 直接打 PostgREST ⇒ **無法枚舉。**
--
-- 🔵 **安全網**:真有一個沒被列舉到的呼叫端,它會拿到 **`42501` 明確報錯**,
--    **不是靜默拿到錯資料** ⇒ 看得見、叫得出來。
--
-- ══ 🛑 為什麼每一句都帶完整參數型別簽章 ═══════════════════════════════════════
-- 🔬 拋棄式 PG 17.10 實跑:同名兩多載,下**不帶簽章**的 REVOKE ⇒
--    `ERROR: function name "public.f_ovl" is not unique` ⇒ **整句失敗,兩支都沒被動到。**
-- ⇒ 所以不帶簽章是【大聲失敗】而不是【安靜誤殺】。**簽章照寫,理由是別人抄走這句話的時候。**
-- 🔬 簽章從正式庫 `p.oid::regprocedure` 抄,**不是從 repo 的 migration 抄**。
--
-- ══ 🔴 `FROM PUBLIC` 那一句在這裡是空砲,而它照寫 ══════════════════════════════
-- 🔬 2026-09-20 實查(照 `docs/patterns/revoking-function-execute-in-supabase.md` §3.6,
--    用 `coalesce(proacl, acldefault('f', proowner))` 展開找 `grantee=0`,**不看 ACL 字面**):
--    兩支都 **0 列 ⇒ PUBLIC 沒有 EXECUTE**。
-- ⇒ 但 §1 的基線是**兩道都下**,而這一句成本 0、漏掉的那個方向是會咬人的那個 ⇒ 照寫。
--
-- ══ 🔴 末尾為什麼要 NOTIFY ════════════════════════════════════════════════════
-- 🔬 正式庫實查 `pgrst_ddl_watch` 的 `command_tag` 白名單:`CREATE FUNCTION` 有、
--    **`GRANT` 與 `REVOKE` 都沒有** ⇒ **REVOKE 不會觸發 PostgREST schema cache reload。**
--    權限本身貼完**立刻生效**(呼叫當下由 Postgres 檢查)⇒ **這一句不是生效的必要條件**,
--    它只是讓 PostgREST 手上那份 schema cache 不要停在貼板之前那一刻。
--
-- 🔴🔴 **而【不要】把它讀成「重讀之後外面會拿到 404」** ——(R1 N1,舊字面留著:
--    ⛔ ~~「這一句讓外面看到的是『這支不存在』而不是『權限不足』」~~ **那句是錯的**。)
--    🔬 正式庫實查:`authenticator` 是 `NOINHERIT`,而它對**兩支多載**的
--       `has_function_privilege` **都是 `f`** ⇒ **schema cache 不是照連線角色的 EXECUTE 濾的**
--       (照那樣濾的話全站早就 404 了)。
--    ⇒ 📌 **重讀之後舊那支仍然在 cache 裡** ⇒ 外面打它拿到的是 **`42501` / 403,不是 404**。
--    🛑 **這條寫錯會害人驗錯**:之後有人照舊字面去驗,看到 403 會以為「revoke 沒生效」。
-- ⇒ NOTIFY 本身無害,留著。
--
-- ══ 🔴 為什麼連 `service_role` 一起收(R1 N5 改的設計,不是原版)═══════════════
-- ⛔ ~~原版只收 `anon` / `authenticated`,`service_role` 留著。~~
-- 🔬 審查抓到:`database.types.ts:9505-9544` 把**兩個多載都生成成 union**
--    ⇒ 檔頭上面那句「TS 型別強制送 14 個具名參數」**只對 `products.ts:586` 那個【字面】成立**,
--      **型別層面並沒有禁止 11 參呼叫**。
-- 🔴 失敗情境:將來某支 server 端(service key)照生成型別送 11 個名字
--    ⇒ **不會 `42501`,會【安靜】拿到不含 gilles 的舊結果。**
-- 🎯 **而那正好打穿本片唯一的安全網** —— 下面那句「漏掉的呼叫端會大聲壞」
--    在 `service_role` 這條路上**不成立**,而那條路偏偏是將來的碼最容易踩到的
--    (server 端、型別還幫它生好了)。
-- ⇒ ✅ **收掉它,那句安全網才是無條件成立的。**
-- ⚠️ 分母已查過(庫內 0 / repo 內唯一呼叫點走新多載 / Edge Function 0)
--    ⇒ 收掉它**不會弄壞今天任何活著的呼叫端**。
--
-- ══ 🔴 貼完【還要做兩件事】,不做的話會留下假帳 ═══════════════════════════════
--  ① **跑 `pcm_acl_approve_latest`**(runbook §0-c,Sean 2026-09-14 拍甲)——
--     本片**就是刻意改 ACL** ⇒ 不跑的話每日 LINE 摘要會**天天叫**「權限與昨天不一樣」。
--  ② **更新 `supabase/acl-snapshot.tsv:1018-1019`** —— 那兩列還記著舊多載的
--     `anon` / `authenticated` = `X|INV`,貼完就過期了。
--     🛑 **現在不要先改它**(還沒貼,先改就是假帳);**貼完才改**。
--
-- ══ 🛑 本片【不宣稱】的事 ═════════════════════════════════════════════════════
-- 同 pattern §3.5:兩道 REVOKE 是**必要基線,不是「已經關上」的證明**。
-- 間接入口(**別的 SECDEF wrapper / trigger / view 相依鏈**)**本片沒有查過** ——
-- 而 `$$` 字串本體的呼叫端連 `DROP … RESTRICT` 都看不到。
-- 🔵 owner 那條路:兩支 owner 都是 `postgres`,而實查 `anon` **切不到** `postgres`。
--
-- 回頭路:`supabase/rollbacks/20260920010000-rollback.sql`

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  v_old CONSTANT text := 'public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone)';
  v_new CONSTANT text := 'public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)';
  v_old_oid oid;
  v_new_oid oid;
  v_md5     text;
BEGIN
  v_old_oid := pg_catalog.to_regprocedure(v_old);
  v_new_oid := pg_catalog.to_regprocedure(v_new);

  IF v_old_oid IS NULL THEN
    RAISE EXCEPTION '前置閘①:舊 11 參多載不存在 ⇒ 本片的前提整個不成立(可能已經被別人 DROP 了)⇒ 停下';
  END IF;
  IF v_new_oid IS NULL THEN
    RAISE EXCEPTION '前置閘②:新 14 參多載不存在 ⇒ 🔴 線上服務客人的那一支不見了, 這比本片重要 ⇒ 停下';
  END IF;

  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = v_new_oid;
  IF v_md5 IS DISTINCT FROM '9242dea94a4ff272efdf485603d821bb' THEN
    RAISE EXCEPTION '前置閘③:新 14 參那支的本體變了(現在 %)⇒ 本片的分母是對【那一版】量的 ⇒ 停下重量', v_md5;
  END IF;

  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = v_old_oid;
  IF v_md5 IS DISTINCT FROM '169bf9136f502dd8269f699255782342' THEN
    RAISE EXCEPTION '前置閘④:舊 11 參那支的本體變了(現在 %)⇒ 有人動過它 ⇒ 停下看清楚再決定要不要收', v_md5;
  END IF;

  -- 🔵 這一格【不擋】, 只說話:已經收過就不該當成事故, 而它也不該被讀成「本片什麼都沒做」。
  IF NOT pg_catalog.has_function_privilege('anon', v_old_oid, 'EXECUTE')
     AND NOT pg_catalog.has_function_privilege('service_role', v_old_oid, 'EXECUTE') THEN
    RAISE NOTICE '前置閘⑤:anon 與 service_role 對舊多載【已經】都沒有 EXECUTE ⇒ 本片是 no-op(不是失敗)';
  END IF;
END
$pre$;

-- 🛑 兩道都下(pattern §1 基線)。PUBLIC 那道在這裡是空砲, 理由見檔頭。
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone) FROM anon, authenticated, service_role;

DO $post$
DECLARE
  v_old CONSTANT text := 'public.search_catalog_by_vehicle(text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone)';
  v_new CONSTANT text := 'public.search_catalog_by_vehicle(text[],text,text,integer,integer,integer,text,text,text[],integer,integer,timestamp with time zone,text[],text)';
  v_old_oid oid := pg_catalog.to_regprocedure(v_old);
  v_new_oid oid := pg_catalog.to_regprocedure(v_new);
  n_bypass  int;
  v_who     text;
BEGIN
  -- ① 要收的收掉了
  IF pg_catalog.has_function_privilege('anon', v_old_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後斷言①:舊多載的 anon EXECUTE 沒有收掉';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', v_old_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後斷言①:舊多載的 authenticated EXECUTE 沒有收掉';
  END IF;
  -- 🔴 R1 N5:service_role 是唯一一條【不會大聲壞】的路 ⇒ 它也要收乾淨
  IF pg_catalog.has_function_privilege('service_role', v_old_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後斷言①:舊多載的 service_role EXECUTE 沒有收掉 ⇒ 安全網那句話會有一個例外';
  END IF;

  -- ② 🔴 不准誤殺線上那支 —— 這一格是本片最重要的
  IF NOT pg_catalog.has_function_privilege('anon', v_new_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後斷言②:🔴 誤殺了線上那支 14 參多載(anon)⇒ 客人的目錄會整個掛掉';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_new_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後斷言②:🔴 誤殺了線上那支 14 參多載(authenticated)';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_new_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後斷言②:🔴 誤殺了線上那支 14 參多載(service_role)';
  END IF;

  -- ③ pattern §3.5:枚舉「anon 切得過去而且執行得到」的角色, 要零列
  --    🛑 這【不】證明不可觸發 —— 它只涵蓋「anon 自己叫」與「anon 切角色叫」。
  -- 🔵 R1 N4:兩個角色都枚舉。今天 authenticated 那半沒有洞(斷言① 直接查過),
  --    而框架不一致的話, 下一個抄這段的人只會抄到一半。
  FOREACH v_who IN ARRAY ARRAY['anon','authenticated'] LOOP
    SELECT pg_catalog.count(*) INTO n_bypass
      FROM pg_catalog.pg_roles r
     WHERE pg_catalog.pg_has_role(v_who, r.oid, 'SET')
       AND pg_catalog.has_function_privilege(r.oid, v_old_oid, 'EXECUTE');
    IF n_bypass <> 0 THEN
      RAISE EXCEPTION '事後斷言③:% 仍有 % 條 SET ROLE 繞路叫得到舊多載 ⇒ 停下', v_who, n_bypass;
    END IF;
  END LOOP;
END
$post$;

-- 🔴 REVOKE 不在 pgrst_ddl_watch 的白名單裡 ⇒ 要自己叫它重讀(理由見檔頭)
NOTIFY pgrst, 'reload schema';

COMMIT;
