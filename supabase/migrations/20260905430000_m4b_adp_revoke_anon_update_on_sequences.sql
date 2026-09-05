-- ═══════════════════════════════════════════════════════════════════════════
-- ⟦b4-SEQADPANON⟧:序列的預設權限 —— 把 `anon` / `authenticated` 的那一格收掉
--   板列 docs/launch-todo.md ⟦b4-SEQADPANON⟧(`-db` 2026-09-05 開列 · `-auth` 2026-09-06 量完危害)
--   派工 主視窗 `-f8` 2026-09-06
--   做法照 docs/patterns/revoking-function-execute-in-supabase.md
--   姊妹片 20260905350000(同一個形狀, 物件型別是 TABLES;本片是 SEQUENCES)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ■ 段一 · 這一片在解什麼
--   schema `public` 的預設權限裡有一列(grantor = `postgres`, 物件型別 = 序列):
--       postgres=rwU/postgres  anon=w/postgres  authenticated=w/postgres  service_role=w/postgres
--   `w` = **UPDATE**。而序列上的 `UPDATE` 就是 **`setval()` 的鑰匙**。
--   ⇒ 📌 **每一個由 `postgres` 在 `public` 新建的序列, 出生就讓 `anon` 改得動它的下一個號碼。**
--   ⇒ 🔴 而 repo 裡**一行 `GRANT` 都沒有** ⇒ grep 不到、三綠不紅、審查看不到。
--
-- ■ 段二 · 🔬 今天的落點是【零】—— 而那不是「不用做」, 是「還沒有指到東西」
--   2026-09-06 `-auth` 唯讀實測(全庫掃, 不限 public):
--     public 的 9 條序列 ⇒ `anon` UPDATE **0 條** · `authenticated` UPDATE **0 條** · `anon` USAGE **0 條**
--     那 9 條的 `relacl` 原文裡, **`anon` / `authenticated` 一次都沒出現**。
--     全庫唯一一條 `anon` 真能 UPDATE 的序列 = `net.http_request_queue_id_seq`(平台側, 我們動不到)
--   🔴 **為什麼 ADP 開著而落點是 0**:`ALTER DEFAULT PRIVILEGES` **只對【設定之後新建】的物件生效**,
--      而那 9 條全部 owner=`postgres` 且**早於它** ⇒ 🛑 **槍上膛了而還沒指到任何東西。**
--      ⇒ **下一條在 `public` 由 `postgres` 建的序列, 出生就會帶 `anon=UPDATE`。**
--
--   🔴🔴 **而那個 0 我一開始量錯了, 寫在這裡因為它會再騙下一個人**:
--      `information_schema.sequences WHERE sequence_schema='public'` ⇒ **0**
--      `pg_class WHERE relkind='S'` 同一個 schema           ⇒ **9**
--      ⇒ 📌 **`information_schema` 依【你的權限】過濾, `pg_catalog` 不會。**
--        唯讀角色看不見那 9 條 ⇒ 它**誠實地**回了一個 0。
--      ⇒ 🛑 **照那個 0 會寫出「public 沒有序列 ⇒ 這片不用做」—— 剛好相反。**
--      ⇒ ✅ **所以本檔每一格都走 `pg_catalog`, 一次都不碰 `information_schema`。**
--
-- ■ 段三 · 貼進正式庫會發生什麼 · 以及它管不到什麼
--   會發生:那一列裡 `anon` 與 `authenticated` 的格子消失。
--   ⛔ ~~既有物件零改動~~ ⇒ 🔴 **codex 2026-09-06 訂正:那句宣稱大於事實。**
--      2️⃣ 對每一條既有序列都跑了 `REVOKE ALL`, 而 📌 **對 `relacl IS NULL`(owner-only)的序列,
--      第一次 REVOKE 會把 ACL【實體化】**(NULL ⇒ 一個明寫 owner 權限的陣列)。
--      ⇒ ✅ 正確的說法是:**有效權限零改動(今天 anon/authenticated 本來就是 0 條), 而
--        `relacl` 這個欄位的值可能從 NULL 變成等價的明寫形式。**
--      ⇒ 🛑 那會讓 `scripts/acl-snapshot.sh` 的快照出現 diff —— **那是預期, 不是漂移。**
--   🛑 **貼完畫面零變化, 那是預期, 不是驗收通過。** 驗收看事後閘印的數字。
--
--   🛑🛑 **它管不到 `supabase_admin` 那一列, 而那一列更寬**:
--      `supabase_admin` / `public` / 序列 ⇒ `anon=rwU` · `authenticated=rwU`(**r=SELECT · w=UPDATE · U=USAGE**)
--      ⇒ 📌 **由 `supabase_admin` 建的序列照樣自帶那三種, 而我們沒有那個角色的權限去改它。**
--      ⇒ ✅ 本片**不假裝收乾淨**:事後閘只斷言 `postgres` 那一列, NOTICE 明說另一半還在。
--      ⇒ 🔵 那一半**不是一支 migration 的射程**。
--      ⛔ ~~走 dashboard 就收得掉~~ ⇒ 🔴 **codex 2026-09-06 訂正:那句是錯的。**
--        **Dashboard 的 SQL Editor 跑起來一樣是 `postgres`** ⇒ 換一個介面**不會換到另一個身分**,
--        它一樣改不動 `supabase_admin` 的那一列。⇒ 那條路要走 **Supabase 支援**。
--
--   🔵 **`service_role` 那一格【刻意不動】** —— 它需要 `setval()`(見 `20260902210000:301-304`
--      逐字「少了 `UPDATE` 的話 `setval()` 會被拒」)。本片只收 `anon` / `authenticated`。
--
--   ⚠️ **已知上限 · 併發(codex R2 指出, 我沒有構造那個世界)**:本交易還沒 COMMIT 的時候,
--      **另一個交易可以照【舊的】ADP 建一條序列** —— 它對本片的事後閘是不可見的(未提交),
--      而它會在之後帶著 `anon=UPDATE` 提交進來。
--      ⇒ 📌 **本片守的是「此後由 postgres 新建的」, 而「此後」的起點是【COMMIT】不是【開始執行】。**
--      ⇒ ✅ 處置不是加鎖(擋不到還沒出生的物件), 是**貼完之後再跑一次唯讀複查**
--        (`scripts/readonly-prod-sql.sh` + 本片段二那組查詢)。貼板檔第三段有那一步。
--
--   ⚠️ **本片答不出「打不打得到」** —— `anon` 有沒有一條【叫得到 `setval`】的路(那要一支對外
--      暴露的 RPC 去碰它), **2026-09-06 沒有掃那一面**。⇒ 本片收的是**權限面**, 不是**可達面**。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── 前置閘⓪:有沒有【全域】預設權限(不綁 schema)在給序列 ──────────────
-- 🔴 `ALTER DEFAULT PRIVILEGES` 有兩種射程:綁 schema 的與全域的, **各自獨立累加**,
--    而 📌 **per-schema 的 REVOKE 抵銷不掉 global 的 GRANT。**
--    ⇒ 若有一列全域的還在給 anon 序列權限, 本片會**成功**而新序列照樣自帶
--      ⇒ 🛑 **一個成功的 migration 什麼都沒解決, 而沒有東西會叫。**
-- 🔬 2026-09-06 唯讀實測:全庫 `pg_default_acl` 的序列列共 9 列, **每一列都綁在某個 schema**
--    ⇒ 今天一列全域的都沒有。而「今天沒有」不是守門, 所以這一格留著。
DO $g0$
DECLARE v_g text;
BEGIN
  SELECT COALESCE(pg_catalog.string_agg(
           pg_catalog.pg_get_userbyid(d.defaclrole)::text || ':' ||
           COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text, 'PUBLIC') || ':' ||
           a.privilege_type, ', '), '(無)')
    INTO v_g
    FROM pg_catalog.pg_default_acl d,
         LATERAL pg_catalog.aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 0
     AND d.defaclobjtype = 'S';
  -- 🔴🔴 **codex 2026-09-06 must-fix:原本這裡只問【具名的 anon / authenticated】** ——
  --    而 `PUBLIC`(aclexplode 的 grantee = 0)與**任何 anon 繼承得到的群組角色**都繞得過它。
  --    ⇒ 📌 **一把只認得你想得到的那兩個名字的尺, 對第三個名字永遠印 0。**
  --    ⇒ ✅ 改成【任何一列全域序列 ADP 都拒繼續】—— 今天實測是 0 列, 所以這個嚴格版零代價,
  --      而它**不需要知道下一個沒想到的被授權者叫什麼**。

  IF v_g <> '(無)' THEN
    RAISE EXCEPTION '前置閘⓪:有【全域】序列預設權限(不綁 schema)存在(%)⇒ 本片的 per-schema REVOKE 抵銷不掉它, 而它可能經 PUBLIC 或群組角色流到 anon ⇒ 貼下去會【成功而無效】, 拒繼續', v_g;
  END IF;
END $g0$;

-- ── 前置閘⓪b:角色必須存在 ────────────────────────────────────────────
-- 🔵 角色不存在時 `to_regrole` 回 **NULL**, 而 `grantee IN (NULL)` 恆為 NULL ⇒ **每一格都假綠**。
--    ⇒ 這一格不是禮貌, 它是上面與下面所有斷言的前提。
DO $g0b$
BEGIN
  IF to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:角色 anon 不存在 ⇒ 這個庫不是我讀到的那個, 拒繼續';
  END IF;
  IF to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:角色 authenticated 不存在 ⇒ 拒繼續';
  END IF;
  IF to_regrole('postgres') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:角色 postgres 不存在 ⇒ 拒繼續';
  END IF;
  -- 🔴🔴 **codex R2 must-fix:`service_role` 也要斷言, 而漏掉它的後果比看起來嚴重。**
  --    前置閘① 的 `v_others` 用 `NOT IN (anon, authenticated, service_role, postgres)`,
  --    而 📌 **SQL 的 `NOT IN` 只要清單裡有一個 NULL, 整個判斷就恆為 NULL(= 不成立)**
  --    ⇒ `service_role` 不存在 ⇒ `v_others` **永遠是「(無)」** ⇒ 🛑 **第四個被授權者被整個藏起來**
  --      ⇒ 那正是態 B 那道新斷言要擋的東西, 而它會安靜地失效。
  --    ⇒ 🎯 **我替另外三個角色寫了這道閘, 而漏掉第四個 —— 漏的那一個剛好在 `NOT IN` 裡。**
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪b:角色 service_role 不存在 ⇒ 前置閘① 的 NOT IN 會因為 NULL 而把所有其他被授權者藏起來(假綠), 拒繼續';
  END IF;
  -- 🔴🔴 **codex R2 must-fix:`NOINHERIT` + `SET ROLE` 那條路**
  --    `has_sequence_privilege` 折進了**繼承**得來的權限, 而 📌 **它不涵蓋
  --    「`anon` 先 `SET ROLE` 切到另一個有權角色, 再動序列」** —— 那條路不需要繼承。
  --    ⇒ ✅ 所以直接斷言:**`anon` / `authenticated` 不是任何角色的成員**(今天實測就是如此)。
  --      有成員關係 ⇒ 停下來讓人看一眼那個角色拿得到什麼, 而不是替它猜。
  DECLARE v_mem text;
  BEGIN
    SELECT COALESCE(pg_catalog.string_agg(
             pg_catalog.pg_get_userbyid(m.member)::text || '→' ||
             pg_catalog.pg_get_userbyid(m.roleid)::text, ', '), '(無)')
      INTO v_mem
      FROM pg_catalog.pg_auth_members m
     WHERE m.member IN (to_regrole('anon'), to_regrole('authenticated'));
    IF v_mem <> '(無)' THEN
      RAISE EXCEPTION '前置閘⓪b:anon/authenticated 是別的角色的成員(%)⇒ 就算收乾淨了, 它們仍可能 SET ROLE 切過去動序列 ⇒ has_sequence_privilege 看不到那條路 ⇒ 停下來人工判, 拒繼續', v_mem;
    END IF;
  END;
END $g0b$;

-- ── 記下【改之前】的既有序列讀數(事後閘要拿它比, 不是拿一個門檻比)──────
-- 🔴 用「改前 vs 改後」兩個讀數, 不用「小於某個數」:
--    📌 一個門檻式的閘, 在**意外只剩一條**時照樣通過, 而在**合法清到 0** 時反而假紅。
CREATE TEMP TABLE _seq_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S')                       AS seq_total,
  (SELECT count(DISTINCT c.oid) FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
          LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      AND a.grantee IN (to_regrole('anon'), to_regrole('authenticated'))) AS exposed_before;

-- ── 前置閘①:那一列現在是什麼形狀 ──────────────────────────────────────
-- 🔴🔴 **逐條解析, 不比整串字面** —— 姊妹片 20260905350000 用一次拋棄式 PG 實測換到的:
--    PostgreSQL 在 **owner 的預設值等於內建值**時**不會把 owner 那格印出來**
--    ⇒ 📌 正式庫與空庫上**同一個設定印出不同的字串** ⇒ 整串逐字比對會在正式庫過、在任何別的庫紅,
--      **而紅的理由與它要守的事無關。**
--    ⇒ ✅ 改成問三件事:①anon/authenticated 拿到的是什麼 ②service_role 那格沒被動 ③沒有第四個人。
DO $gate1$
DECLARE
  v_anon   text;
  v_auth   text;
  v_svc    text;
  v_others text;
  v_found  boolean;
  -- 🔵 **把 `COALESCE(...)` 先算進變數, 不寫在 `RAISE` 的參數位置**(2026-09-06)——
  --    兩個理由, 第二個才是真的:
  --    ① 讀起來短
  --    ② 🔴 `scripts/migration-new-file-static-checks.sh` 的第⑥格**用逗號數 RAISE 的參數個數**,
  --      而 `COALESCE(v,'(無)')` 裡面那個逗號會被算成分隔符 ⇒ 它把「1 個參數」讀成 2 個
  --      ⇒ **假紅**(2026-09-06 實測:PG 17.10 上這個形狀跑得好好的,
  --        而真的對不上時 PL/pgSQL 在【編譯期】就會 `too few parameters specified for RAISE`)。
  --    ⇒ 🛑 **我沒有去動那道閘**(那不是我的、也不該為了過閘而弱化它);
  --      我改成一個**它數得對、而且本來就比較好讀**的寫法。假紅那件事另外回報。
  v_anon_t text;
  v_auth_t text;
  v_svc_t  text;
BEGIN
  SELECT
    TRUE,
    (SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
       FROM pg_catalog.pg_default_acl d2, LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid AND a.grantee = to_regrole('anon')),
    (SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
       FROM pg_catalog.pg_default_acl d2, LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid AND a.grantee = to_regrole('authenticated')),
    (SELECT pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
       FROM pg_catalog.pg_default_acl d2, LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid AND a.grantee = to_regrole('service_role')),
    (SELECT COALESCE(pg_catalog.string_agg(DISTINCT
              COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text, 'PUBLIC'), ','), '(無)')
       FROM pg_catalog.pg_default_acl d2, LATERAL pg_catalog.aclexplode(d2.defaclacl) a
      WHERE d2.oid = d.oid
        AND a.grantee NOT IN (to_regrole('anon'), to_regrole('authenticated'),
                              to_regrole('service_role'), to_regrole('postgres')))
  INTO v_found, v_anon, v_auth, v_svc, v_others
  FROM pg_catalog.pg_default_acl d
  JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
 WHERE n.nspname = 'public' AND d.defaclobjtype = 'S'
   AND d.defaclrole = to_regrole('postgres');

  -- 🔵 **態 B:那一列整個不在, 或 anon/authenticated 已經不在裡面 ⇒ 本片【已經做過了】**
  --    ⇒ 這不是失敗, 是**冪等**。一支只能貼一次成功的 migration, 在重播與重貼時會變成事故。
  v_anon_t := COALESCE(v_anon, '(無)');
  v_auth_t := COALESCE(v_auth, '(無)');
  v_svc_t  := COALESCE(v_svc,  '(無)');

  IF v_found IS NOT TRUE THEN
    RAISE NOTICE '前置閘①:postgres 在 public 的【序列】預設權限那一列不存在 ⇒ 本片沒有東西要收(冪等)。';
  ELSIF v_anon IS NULL AND v_auth IS NULL THEN
    -- 🔴 **codex 2026-09-06 must-fix:態 B 不可以只看那兩個名字就放行。**
    --    `PUBLIC` 或一個 `anon` 繼承得到的群組, 都能讓「那兩個名字不在」而權限照樣流過去。
    --    ⇒ 📌 **「我要找的那兩個不在」與「沒有人在」是兩件事。**
    IF v_others <> '(無)' THEN
      RAISE EXCEPTION '前置閘①(態 B):anon/authenticated 不在那一列裡, 而有我沒預期的被授權者(%)⇒ 權限可能經它流到 anon ⇒ 沒有人審過那一個, 拒繼續', v_others;
    END IF;
    RAISE NOTICE '前置閘①:那一列在, 而 anon / authenticated 已經不在裡面, 也沒有第四個被授權者 ⇒ 本片已經做過了(冪等)。service_role=%', v_svc_t;
  ELSE
    -- 態 A:還沒收 ⇒ 形狀要對得上我量到的那一個, 對不上就停
    IF v_anon_t <> 'UPDATE' THEN
      RAISE EXCEPTION '前置閘①:anon 在那一列拿到的不是【恰好 UPDATE】而是(%)⇒ 有人動過這一列, 而我讀到的現況已過期, 拒繼續', v_anon_t;
    END IF;
    IF v_auth_t <> 'UPDATE' THEN
      RAISE EXCEPTION '前置閘①:authenticated 在那一列拿到的不是【恰好 UPDATE】而是(%)⇒ 拒繼續', v_auth_t;
    END IF;
    IF v_others <> '(無)' THEN
      RAISE EXCEPTION '前置閘①:那一列還有我沒預期的被授權者(%)⇒ 本片只收 anon/authenticated, 而多出來的那個沒有人審過 ⇒ 拒繼續', v_others;
    END IF;
    RAISE NOTICE '前置閘①:態 A —— anon=% · authenticated=% · service_role=%(service_role 刻意不動)', v_anon, v_auth, v_svc_t;
  END IF;
END $gate1$;

-- ═══ 1️⃣ 改預設:此後由 postgres 在 public 新建的序列, 不再自帶 anon/authenticated ═══
-- 🔴 **`REVOKE ALL`, 一個權限名都不列舉** —— 那是 ⟦b9-PUBLICVIEWALL⟧ 用一次漏報換到的:
--    列舉式 REVOKE 寫在 `MAINTAIN` 存在之前(PG17 才有), 留下的殘餘**恰好是任何一把
--    「列舉六種」的尺看不見的那一格**。⇒ 📌 **列舉會跟下一個沒想到的權限名賽跑。**
-- ⚠️ **`FOR ROLE postgres` 不可省** —— 不寫的話它改的是【執行者自己】的預設權限;
--    執行者若不是 postgres, 這一行會**成功**而那一列原封不動 ⇒ 事後閘會抓到, 而診斷會指錯地方。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ═══ 2️⃣ 逐條收既有序列 —— 清單【當場從 pg_class 撈】, 不寫死 ═══════════════
-- 🔴 **為什麼不寫死清單**:寫死的那一刻它就開始過期, 而 📌 **「本片量測之後、Sean 貼之前」
--    新建的那幾條, 正是最需要被收的**(它們出生在 ADP 還開著的那段時間裡)。
-- 🔵 **0 條也要跑** —— 今天實測就是 0 條。一個「沒有東西可做」的迴圈跑完印 0,
--    與一個「根本沒跑」的迴圈, 在事後閘上要分得開 ⇒ 所以它印出處理了幾條。
DO $revoke_each$
DECLARE
  r        record;
  v_count  integer := 0;
BEGIN
  FOR r IN
    SELECT n.nspname AS nsp, c.relname AS seq
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
     ORDER BY c.relname
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON SEQUENCE %I.%I FROM anon, authenticated', r.nsp, r.seq);
    v_count := v_count + 1;
  END LOOP;
  -- 🔵 **codex 2026-09-06 nit(今天不成立而寫著)**:由**非 owner 且無 grant option** 的身分執行時,
  --    `REVOKE` 會**只發一個 warning、rc 仍是 0、而權限沒有被收**, 且 `v_count` 照樣加一。
  --    ⇒ 📌 **那個世界裡這個計數是【跑過幾條】不是【收掉幾條】。**
  --    ⇒ ✅ 而它接不到假綠:**事後閘③ 問的是有效權限**, 沒收掉就會在那裡紅。
  --    🔬 今天不成立的理由是量到的:那 9 條 owner 全是 `postgres`, 而 Sean 貼的身分就是 `postgres`。
  RAISE NOTICE '2️⃣ 逐條 REVOKE ALL 跑過的序列數 = %(0 也是合法的:今天 public 的 9 條本來就沒有 anon/authenticated)', v_count;
END $revoke_each$;

-- ── 事後閘②:ADP 那一列裡 anon / authenticated 必須消失 ──────────────────
DO $after1$
DECLARE v_left text;
BEGIN
  SELECT COALESCE(pg_catalog.string_agg(
           COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text,'PUBLIC') || '=' || a.privilege_type,
           ', ' ORDER BY COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text,'PUBLIC')), '(無)')
    INTO v_left
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace,
         LATERAL pg_catalog.aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'S'
     AND d.defaclrole = to_regrole('postgres')
     AND a.grantee IN (to_regrole('anon'), to_regrole('authenticated'));

  IF v_left <> '(無)' THEN
    RAISE EXCEPTION '事後閘②:收完了而 anon/authenticated 還在那一列裡(%)⇒ REVOKE 沒生效, 拒 COMMIT', v_left;
  END IF;
  RAISE NOTICE '事後閘②:✅ postgres 在 public 的序列預設權限, anon / authenticated 已清空。';
END $after1$;

-- ── 事後閘③:既有序列上 anon/authenticated 的【有效權限】必須 0 格 ──────
-- ── 🔴 而【同一格要帶負對照】:一把壞掉的尺與一個乾淨的庫, 都印 0。
--    ⛔ ~~所以同時問「還有誰有」—— 那個答案必須非空~~
--    ⇒ 🔴 **codex R2 訂正:那個負對照會在【全部序列都 owner-only】的乾淨庫上假紅**
--      (`aclexplode(NULL)` 回零列, 而那是完全正常的狀態)。
--    ⇒ ✅ 改成問 **owner(`postgres`)是不是在【每一條】序列上都量得到 UPDATE** ——
--      那件事恆真, 所以數不到就只可能是【尺沒接上】。
--    ⇒ 📌 **一個沒有負對照的 0, 證不到任何事;而一個會在正常狀態下紅的負對照, 一樣沒用。**
DO $after2$
DECLARE
  v_bad      integer;
  v_who      text;
  v_total    integer;
  v_owner_ok integer;
BEGIN
  -- 🔴🔴 **codex 2026-09-06 must-fix:原本這一格走 `aclexplode(relacl)`, 而那只看得到【具名的直接授權】。**
  --    它對三條路失明:①`PUBLIC`(grantee = 0)②`anon` 從**群組角色**繼承來的 ③`relacl IS NULL`
  --    (`aclexplode(NULL)` **回零列** ⇒ 一個 owner-only 的序列在這把尺上與「乾淨」同形)。
  --    ⇒ ✅ 改用 `has_sequence_privilege(角色, 物件, 權限)` —— 它算的是**有效權限**,
  --      **PUBLIC 與角色繼承都已經折進去**, 而 `relacl IS NULL` 它也答得出來。
  --    ⇒ 📌 **這正是本片檔頭段二那句的同一個教訓:問「誰實際拿得到」, 不要問「誰的名字在表上」。**
  -- 🔴🔴 **`AS MATERIALIZED` 不是裝飾, 它是這一格能不能跑的前提**(2026-09-06 實測):
  --    規劃器會把 `has_sequence_privilege(...)` **推到 `relkind='S'` 的過濾【之前】**求值
  --    ⇒ 它會拿到一張普通表 ⇒ `ERROR: "pg_statistic" is not a sequence` ⇒ 整支中止。
  --    ⇒ 📌 **這不是「權限查錯」, 是【過濾與函式的求值順序】** —— 而 SQL 不保證那個順序。
  --    ⇒ ✅ `WITH ... AS MATERIALIZED` 逼它先把序列集合算出來, 函式才看得到乾淨的輸入。
  --    🔬 我今天稍早在唯讀查詢上**踩過同一個坑並修好了**, 而改寫這一格時**沒有把那個修法帶過來**。
  WITH s AS MATERIALIZED (
    SELECT c.oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
  )
  SELECT count(*) INTO v_bad FROM s c
   WHERE (pg_catalog.has_sequence_privilege('anon', c.oid, 'UPDATE')
       OR pg_catalog.has_sequence_privilege('anon', c.oid, 'USAGE')
       OR pg_catalog.has_sequence_privilege('anon', c.oid, 'SELECT')
       OR pg_catalog.has_sequence_privilege('authenticated', c.oid, 'UPDATE')
       OR pg_catalog.has_sequence_privilege('authenticated', c.oid, 'USAGE')
       OR pg_catalog.has_sequence_privilege('authenticated', c.oid, 'SELECT'));

  SELECT count(*) INTO v_total
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'S';

  -- 🔵 診斷用:把具名的被授權者印出來(含 PUBLIC)。
  -- ⚠️ **這一串是【給人看的】, 不是上面那個 0 的依據** —— 依據是有效權限那一段。
  --    🔴 codex must-fix:`aclexplode(NULL)` 回零列 ⇒ 全部序列都 owner-only 時它會印「(無)」,
  --      而那**不代表尺壞了** ⇒ 所以下面的負對照【不能】用它。
  SELECT COALESCE(pg_catalog.string_agg(DISTINCT
           COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text,'PUBLIC'), ','), '(無 —— 全部 owner-only)')
    INTO v_who
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
         LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE n.nspname = 'public' AND c.relkind = 'S';

  IF v_bad <> 0 THEN
    RAISE EXCEPTION '事後閘③:public 仍有 % 條序列讓 anon/authenticated 拿得到權限 ⇒ 拒 COMMIT', v_bad;
  END IF;

  -- 🔴🔴 **負對照:這把尺【在該回 true 的時候】會不會回 true**
  --    owner(`postgres`)對每一條序列一定拿得到 UPDATE ⇒ 這一格必須數到全部。
  --    數不到 ⇒ `has_sequence_privilege` 這把尺沒有接上 ⇒ **上面那個 0 不算數。**
  --    ⇒ 📌 **一個沒有負對照的 0, 與一把壞掉的尺, 印同一個東西。**
  --    🔵 這一版**不再拿 `aclexplode` 當負對照** —— 它對 owner-only(relacl IS NULL)的序列回零列,
  --      而那是完全正常的狀態 ⇒ 舊版會在一個乾淨的庫上【假紅】。
  WITH s AS MATERIALIZED (
    SELECT c.oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
  )
  SELECT count(*) INTO v_owner_ok FROM s c
   WHERE pg_catalog.has_sequence_privilege('postgres', c.oid, 'UPDATE');

  IF v_total > 0 AND v_owner_ok <> v_total THEN
    RAISE EXCEPTION '事後閘③負對照:public 有 % 條序列, 而 postgres 只在 % 條上量得到 UPDATE ⇒ has_sequence_privilege 這把尺沒有接上(或 owner 不是 postgres)⇒ 上面那個 0 不算數, 拒 COMMIT', v_total, v_owner_ok;
  END IF;

  RAISE NOTICE '事後閘③:✅ public 序列 % 條 · anon/authenticated【有效權限】拿得到的 = 0 條 · 🟢 負對照:postgres 在 %/% 條上量得到 UPDATE(尺有接上)· 具名被授權者 = %', v_total, v_owner_ok, v_total, v_who;
END $after2$;

-- ── 事後閘④:序列【條數】未變(改前改後兩個讀數相等)──────────────────
-- ⛔ ~~既有物件零改動~~ ⇒ 🔴 **codex R2 訂正:標題也要跟著內文改** ——
--    這一格只比條數, 它證不到每一條的 ACL 位元組沒變(理由見下面 NOTICE 上方那段)。
DO $after3$
DECLARE
  v_before_total integer;
  v_before_exp   integer;
  v_after_total  integer;
BEGIN
  SELECT seq_total, exposed_before INTO v_before_total, v_before_exp FROM _seq_before;
  SELECT count(*) INTO v_after_total
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'S';

  IF v_before_total <> v_after_total THEN
    RAISE EXCEPTION '事後閘④:序列總數在本交易中變了(% ⇒ %)⇒ 有別人同時在動這個 schema, 拒 COMMIT', v_before_total, v_after_total;
  END IF;
  -- 🔴 **codex 2026-09-06 must-fix:這一格【證不到「既有物件零改動」】** ——
  --    它只比【序列的條數】。而本片的 2️⃣ 對每一條都跑了 `REVOKE ALL`:
  --    📌 **對一條 `relacl IS NULL`(owner-only)的序列, 第一次 REVOKE 會把 ACL【實體化】** ——
  --      `relacl` 從 NULL 變成一個明寫 owner 權限的陣列。**有效權限一格都沒變, 而欄位的值變了。**
  --    ⇒ ✅ 所以這裡只敢說「條數未變」, 不說「零改動」;檔頭那句也已經跟著改。
  RAISE NOTICE '事後閘④:✅ 序列條數 %(未變)· 改之前就已曝露的條數 = % ⚠️ 本格只證【條數】, 不證【每一條的 ACL 位元組沒變】(REVOKE 會實體化 NULL 的 relacl)', v_after_total, v_before_exp;
END $after3$;

-- ── 收尾 NOTICE:🛑 明說本片【收不到】的那一半 ──────────────────────────
-- 🔴 這一段是 `RAISE NOTICE` 不是註解 —— 因為**貼的人讀的是輸出, 不是這支檔**。
DO $residual$
DECLARE v_sa text;
BEGIN
  SELECT COALESCE(pg_catalog.string_agg(
           COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text,'PUBLIC') || '=' || a.privilege_type,
           ', ' ORDER BY COALESCE(pg_catalog.pg_get_userbyid(a.grantee)::text,'PUBLIC')), '(無)')
    INTO v_sa
    FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace,
         LATERAL pg_catalog.aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'S'
     AND d.defaclrole = to_regrole('supabase_admin')
     AND a.grantee IN (to_regrole('anon'), to_regrole('authenticated'));

  RAISE NOTICE '🛑 本片【收不到】的那一半:supabase_admin 在 public 的序列預設權限 ⇒ %', v_sa;
  RAISE NOTICE '   ⇒ 由 supabase_admin 建的序列照樣自帶那些權限, 而我們沒有那個角色的權限去改它。';
  RAISE NOTICE '   ⇒ 要收那一半得走 Supabase 支援 —— 不是一支 migration 的射程。';
  RAISE NOTICE '   ⛔ 而【不是】換去 Dashboard 貼就收得掉:Dashboard 的 SQL Editor 跑起來一樣是 postgres, 換介面不會換身分。';
  RAISE NOTICE '   ⚠️ 上面那一行若印【(無)】, 只代表【今天讀不到】—— 唯讀角色對 pg_default_acl 是讀得到的, 而角色不存在時它也印(無)。';
END $residual$;

COMMIT;
