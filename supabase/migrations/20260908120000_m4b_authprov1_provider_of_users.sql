-- ═══ 貼板 106:一支只回「註冊方式」的小函式 ═══
-- 出板:線【DB】-db, 2026-09-08。Sean 拍 A(只做小函式, **不開 auth schema 的 SELECT**)。
--
-- 🔴 為什麼不開整區:`pcm_readonly` 的 `rolbypassrls = t`(2026-09-08 唯讀實查)
--    ⇒ 開了 `auth` 的 SELECT = **那一區每一張表的每一列**, 包含信箱與密碼雜湊。
--    ⇒ 而要答的那題只需要 **8 列 × 1 欄**。⇒ 📌 範圍要跟問題一樣大, 不是比它大。
--
-- 🔴🔴 **版本號取法(這一格 2026-09-08 咬過我一次, 見板列 ⟦db-VERSIONGATECROSSBRANCH⟧)**:
--    本地那兩道版本號閘**都看不到別的分支上還沒收割的號**。
--    ✅ 取號前掃**全部 ref**:`git for-each-ref … | git ls-tree -r --name-only <ref> supabase/migrations/`
--    ⇒ 2026-09-08 掃 **97** 個 ref、已用 **397** 個號 ⇒ `20260908120000` 零命中。
--    🔴 **commit 之後要再跑一次 `scripts/migration-version-dup-across-lines.sh`。**
--
-- ── 這支的四條線(主視窗 A 劃的, 逐條照做)─────────────────────────────
--   ① 只回 provider。不回信箱、不回任何別的欄。
--      📌 判準:**這支函式的回傳值印進 log 也不會出事。**
--   ② `SECURITY DEFINER` ⇒ `SET search_path = ''` 釘死。
--      🔴 而 `CREATE OR REPLACE` 會把 `SET` 子句**整組換掉** ——
--         抄舊檔改一改, 會把強化打回去(memory `reference_create-or-replace-resets-set-clause`)。
--         ⇒ 本支是 `CREATE FUNCTION`(全新), 而這一句寫在這裡是給**下一個要改它的人**看的。
--   ③ EXECUTE 只給 `pcm_readonly`。而**新函式出生就自帶 PUBLIC 的 EXECUTE**
--      ⇒ 兩道 REVOKE(`FROM anon, authenticated` 一道 + `FROM PUBLIC` 一道)缺一都是開的。
--      📎 `docs/patterns/revoking-function-execute-in-supabase.md` §2 有拋棄式 PG 的實跑。
--   ④ 🔴 **它只回【傳進去的那些 id】** —— 不做「列出全部」。
--      📌 一支能列全部的函式, 與開整區唯讀的差別就沒有了。
--      🛑 **而它【不是】「只限那八人」**(codex R1 must-fix ③ 打的就是這個):
--        拿第九個已知 uuid 進來, 它照樣回那個人的標籤;拿到全部 uuid 就能分批問完。
--        ⇒ 📌 **這一支的邊界是【誰執行得到】, 不是【問哪些 id】。**
--        ⇒ 而那個邊界今天是:`pcm_readonly` + 繼承它的 `postgres`(前置閘③b 釘住)。
--      🔵 而**洩漏面已經被 ② 壓到最小**:回的是六個寫死標籤之一
--        ⇒ 就算有人問遍所有 id, 他拿到的也只是「這個 uuid 用哪一種方式註冊」。
--        ⚠️ 而**那仍然是資訊** —— 我不宣稱它是零。要更緊只能改成【回聚合數】而不回逐人,
--        那是另一個形狀, 要 Sean 另外拍。
--
-- ── 🛑 我證不到的一件, 而它由前置閘去答 ────────────────────────────────
--   這支是 `SECURITY DEFINER` ⇒ 它以**擁有者的身分**讀 `auth.users`。
--   🔴 而**我(`pcm_readonly`)連「postgres 讀不讀得到 auth.users」這個問題都問不出來** ——
--      `has_table_privilege('postgres','auth.users','SELECT')` 對我回
--      `ERROR: permission denied for schema auth`(解析那個名字就需要 schema USAGE)。
--   🔵 間接證據(唯讀查得到的):`postgres` 是 `pg_read_all_data` 的成員、`rolbypassrls = t`;
--      而 `auth.users` 的 owner 是 `supabase_auth_admin`、RLS 開著且 **policy 數 = 0**。
--   ⇒ 📌 **所以「它讀得到」是【推的】不是【量到的】** ⇒ 前置閘②直接去讀一次,
--      讀不到就整支炸掉回滾。**那比我在這裡宣稱它會動可靠。**

BEGIN;

DO $gate$
DECLARE v_n integer;
BEGIN
  -- 前置閘① 角色在
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pcm_readonly') THEN
    RAISE EXCEPTION '貼板106 前置閘①:角色 pcm_readonly 不存在 ⇒ 停';
  END IF;

  -- 前置閘② 🔴 **貼的這條連線真的讀得到 auth.users 嗎** —— 見檔頭「我證不到的一件」。
  --   讀不到 ⇒ 這裡就會炸(permission denied)⇒ 整支回滾 ⇒ 不會留下一支永遠回空的函式。
  --   🔴 **`count(*) = 0` 也會放行**(codex R1 must-fix ⑤)—— 一個有 SELECT 而被無政策 RLS 濾光的
  --     建立者, `count(*)` 回 0 而不報錯 ⇒ 📌 **放行一支永遠回空的函式。**
  --   ✅ `SET LOCAL row_security = off`:那時若這條連線【不是 RLS 豁免的】, PostgreSQL 會**報錯**
  --     ⇒ 兩個世界從此印不同的東西。
  SET LOCAL row_security = off;
  SELECT count(*) INTO v_n FROM auth.users;
  RAISE NOTICE '貼板106 前置閘②:這條連線在 row_security=off 下讀得到 auth.users, 目前 % 列', v_n;

  -- 前置閘③ 那個欄在(2026-09-08 唯讀查 pg_attribute:raw_app_meta_data jsonb)
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='auth' AND c.relname='users' AND a.attname='raw_app_meta_data'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION '貼板106 前置閘③:auth.users 沒有 raw_app_meta_data 欄 ⇒ Supabase 換過欄名 ⇒ 停';
  END IF;

  -- 前置閘③b 🔴 **誰繼承得到 `pcm_readonly`, 就執行得到這支**(codex R1 must-fix ④)。
  --   ACL 只會列 `pcm_readonly`, 而**繼承那條路在 ACL 上看不見**。
  --   🔬 2026-09-08 唯讀實查:`pcm_readonly` 的成員只有 **`postgres`** 一個
  --     (⚪ 對照 `service_role` 的成員 = `authenticator` `postgres` ⇒ 那把尺會動)。
  --   ⇒ `postgres` 本來就讀得到 `auth.users` ⇒ 它多這一支不改變任何事。
  --   ⇒ 🔴 而**多出第二個成員那天, 這道閘會停下來**。
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.member
              WHERE m.roleid='pcm_readonly'::regrole AND g.rolname <> 'postgres') THEN
    RAISE EXCEPTION '貼板106 前置閘③b:pcm_readonly 除了 postgres 之外還有別的成員 ⇒ 他們會繼承到這支的 EXECUTE ⇒ 停';
  END IF;

  -- 前置閘④ 這支函式還不存在(不覆蓋別人的)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='pcm_auth_provider_of') THEN
    RAISE EXCEPTION '貼板106 前置閘④:public.pcm_auth_provider_of 已經存在 ⇒ 停, 先去確認是誰建的';
  END IF;

  RAISE NOTICE '貼板106 前置閘四道全過';
END
$gate$;

CREATE FUNCTION public.pcm_auth_provider_of(p_ids uuid[])
RETURNS TABLE (user_id uuid, provider text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- 🔴🔴 **回傳的是【六個寫死的標籤】之一, 不是資料庫裡的值。**(codex R1 must-fix ②)
  --   ⛔ ~~第一版:`u.raw_app_meta_data ->> 'provider'`~~
  --   ⇒ `->>` 對一個【物件】會把整段轉成文字回傳 ⇒ 誤存 `{"provider":{"email":"…"}}` 時**整段洩出去**,
  --     而回傳型別只有兩欄、`SELECT email` 也照樣失敗 ⇒ 📌 **每一道閘都綠而它漏了。**
  --   ✅ 改成 `CASE` 映射到封閉集合 ⇒ **沒有任何一個位元組從 metadata 流出來。**
  --     那也是「回傳值印進 log 也不會出事」這條線唯一守得住的形狀。
  --
  -- 🔴🔴 **兩個 key 都要看**(codex R1 must-fix ① —— 我自己開檔複驗過, 而它比 codex 講的更嚴重):
  --   我們自己的碼寫的是 `app_metadata.pcm_provider`, **不是 Supabase 的 `provider`**:
  --     `apps/storefront/src/lib/auth/line-admin.ts:82`  ⇒ `{ pcm_provider: 'line', … }`
  --     `apps/admin/src/lib/customers/manual-customer.ts:437` ⇒ `{ pcm_provider: MANUAL_PROVIDER, … }`
  --     `apps/admin/src/lib/customers/email-verification.ts:37` 逐字:
  --       「`app_metadata.pcm_provider` 的兩個具名值;**一般 email 註冊【沒有這一欄】**」
  --   ⇒ 📌 只讀 `provider` 會把 LINE 帳號報成 `email` 或 NULL ——
  --     而**那個錯答案看起來完全正常**, 沒有人會發現。
  SELECT u.id,
    CASE
      WHEN u.raw_app_meta_data ->> 'pcm_provider' = 'line'   THEN 'line'
      WHEN u.raw_app_meta_data ->> 'pcm_provider' = 'manual' THEN 'manual'
      WHEN u.raw_app_meta_data ->> 'provider'     = 'google' THEN 'google'
      WHEN u.raw_app_meta_data ->> 'provider'     = 'email'  THEN 'email'
      WHEN u.raw_app_meta_data ->> 'pcm_provider' IS NULL
       AND u.raw_app_meta_data ->> 'provider'     IS NULL    THEN 'none'
      ELSE 'other'
    END
  FROM auth.users u
  WHERE u.id = ANY (coalesce(p_ids, ARRAY[]::uuid[]))
$fn$;

-- 🔴🔴 兩道 REVOKE, 缺一道都是開的(見檔頭 ③)
-- 🔴 三道 REVOKE, 不是兩道(codex R1 must-fix ⑥ —— 我實查了預設 ACL 才確定):
--   🔬 2026-09-08 唯讀查兩支【既有】函式的展開後 ACL(⚠️ 而它們的授權**可能來自個別 GRANT**,
--     不能證明「新函式的預設 ACL 長這樣」—— codex R2 nit ⑥ 抓到我這句寫得比證據強。
--     真要證預設要查 `pg_default_acl`, 而我沒查 ⇒ **這裡標未確認, 而三道 REVOKE 照下**
--     —— 多收一道的代價是零, 少收一道的代價是洞):
--     `get_vehicle_taxonomy` ⇒ authenticated=EXECUTE anon=EXECUTE postgres=EXECUTE
--     `search_catalog_by_vehicle_dealer` ⇒ authenticated=EXECUTE postgres=EXECUTE
--   ⇒ 這個庫的新函式**預設就帶 anon / authenticated** ⇒ 那兩道要下。
--   ⇒ 而 `service_role` 我一併收 —— 它不需要這支, 而**多收一道的代價是零**。
REVOKE ALL ON FUNCTION public.pcm_auth_provider_of(uuid[]) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_auth_provider_of(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pcm_auth_provider_of(uuid[]) TO pcm_readonly;

DO $post$
DECLARE
  v_bad text;
  -- 🔴 **收權斷言清單**:本片建出來的【可授權物件】全部列在這裡。
  --    `scripts/migration-new-file-static-checks.sh` ③ 守的就是這份清單的長度
  --    ⇒ 因為收權斷言【只檢查你列出來的】:它防「忘記收權」, 不防「忘記列」。
  -- 🔴 變數名必須是 `v_relations` 或 `v_functions` —— `migration-static-checks.sh:714` 的 awk
  --    只從那兩個名字起算。我原本取名 `v_funcs` ⇒ 清單長度被數成 0 ⇒ 閘判「有漏列」。
  --    📌 一個【內容完全正確】的清單, 因為變數名不在那把尺的字面上而不存在。
  v_functions text[] := ARRAY['public.pcm_auth_provider_of(uuid[])']::text[];
  v_i integer;
BEGIN
  -- 事後閘⓪ 逐一走過收權斷言清單:每一支都不得讓 anon / authenticated / PUBLIC 執行得到
  FOR v_i IN 1 .. array_length(v_functions, 1) LOOP
    IF has_function_privilege('anon',          v_functions[v_i], 'EXECUTE')
       OR has_function_privilege('authenticated', v_functions[v_i], 'EXECUTE') THEN
      RAISE EXCEPTION '貼板106 事後閘⓪:收權斷言清單第 % 項(%)anon/authenticated 執行得到 ⇒ 回滾', v_i, v_functions[v_i];
    END IF;
  END LOOP;

  -- 事後閘① 它存在、是 DEFINER、search_path 釘住了
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='pcm_auth_provider_of'
      AND p.prosecdef
      -- 🔴 精確比對, 不用 LIKE '%search_path=%'(codex R1 nit ⑧):
      --   把它改成 `search_path=public` 那個 LIKE 照樣綠 ⇒ 它只證明「有設定」不證明「是空的」。
      AND 'search_path=' = ANY (
            SELECT left(cfg, position('=' in cfg)) FROM unnest(p.proconfig) cfg
          )
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg IN ('search_path=', 'search_path=""'))
  ) THEN
    RAISE EXCEPTION '貼板106 事後閘①:函式不存在, 或不是 SECURITY DEFINER, 或 search_path 沒釘 ⇒ 回滾';
  END IF;

  -- 事後閘② 🔴 **EXECUTE 的名單【剛好】是 pcm_readonly** —— 快照差集, 不是逐項列舉。
  --   (上一支貼板 105 學到的:逐項列舉是黑名單, 它在跟下一個沒想到的角色賽跑。)
  SELECT string_agg(coalesce(g.rolname,'PUBLIC') || '=' || a.privilege_type ||
                    CASE WHEN a.is_grantable THEN '(可轉授)' ELSE '' END, ' ')
    INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
         LEFT JOIN pg_roles g ON g.oid = a.grantee
   WHERE n.nspname='public' AND p.proname='pcm_auth_provider_of'
     AND NOT (
           -- owner 自己那幾筆放行
           coalesce(g.rolname,'PUBLIC') = (SELECT pg_get_userbyid(p.proowner))
           -- pcm_readonly 只放行【不可轉授】的那一筆(codex R2 must-fix ①):
           -- 🔴 預設 ACL 若給了 `EXECUTE WITH GRANT OPTION`, 三道 REVOKE 不會清掉轉授權,
           --   而原本這裡整列排除 pcm_readonly ⇒ 全閘綠, 而它可以再授權給 anon。
           OR (coalesce(g.rolname,'PUBLIC') = 'pcm_readonly' AND NOT a.is_grantable)
         );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '貼板106 事後閘②:除了 pcm_readonly 與 owner 之外還有人拿得到 ⇒ 回滾:%', v_bad;
  END IF;

  -- 事後閘③ 🔴 **`proacl` 是 NULL 時 PUBLIC 那份看不見** —— pattern 檔 §3.6 的那一腳。
  --   兩道 REVOKE 之後 `proacl` 不該是 NULL;若是 NULL, 上面那個 `acldefault` 展開會印出 PUBLIC,
  --   而 ② 已經會擋。這一格只是把「它不是 NULL」這件事**印出來**, 讓下一個人看得到。
  IF (SELECT proacl IS NULL FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='pcm_auth_provider_of') THEN
    RAISE EXCEPTION '貼板106 事後閘③:proacl 是 NULL ⇒ 兩道 REVOKE 沒生效 ⇒ 回滾';
  END IF;

  -- 事後閘④ ⚪ 負對照:anon 不得執行得到
  IF has_function_privilege('anon','public.pcm_auth_provider_of(uuid[])','EXECUTE') THEN
    RAISE EXCEPTION '貼板106 事後閘④:anon 執行得到 ⇒ 兩道 REVOKE 少了一道 ⇒ 回滾';
  END IF;
  -- 🟢 正對照:pcm_readonly 要執行得到 —— 少了它, ④ 的綠與「誰都執行不到」同一個東西
  IF NOT has_function_privilege('pcm_readonly','public.pcm_auth_provider_of(uuid[])','EXECUTE') THEN
    RAISE EXCEPTION '貼板106 事後閘④正對照:pcm_readonly 執行不到 ⇒ 回滾';
  END IF;

  RAISE NOTICE '貼板106 事後閘四道全過';
END
$post$;

COMMENT ON FUNCTION public.pcm_auth_provider_of(uuid[]) IS
  '⟦M-4b 貼板106⟧ 只回傳進來的那些 user_id 的註冊方式(auth.users.raw_app_meta_data->>provider)。'
  'Sean 2026-09-08 拍 A:不開 auth schema 的 SELECT, 只做這一支 —— 因為 pcm_readonly 帶 BYPASSRLS, '
  '開整區等於每一張表每一列都看得到, 而要答的只有 8 列 × 1 欄。'
  '🔴 它【只回 provider】—— 回傳值印進 log 也不會出事, 而那是它可以存在的理由。'
  '🔴 EXECUTE 只給 pcm_readonly(兩道 REVOKE 收 PUBLIC 與 anon/authenticated)。';

COMMIT;
