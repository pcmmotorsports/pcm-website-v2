-- 20260904240000_m4b_search_log_health.sql
-- `get_search_log_health()` —— 讓 anomaly-alert 看得見「搜尋日誌是不是靜靜歸零了」。
--
-- ══ 🔴 為什麼要有它(⟦search-LOGSILENTZERO⟧)══════════════════════════════════
-- `20260904200000_m4b_search_queries_log.sql` 自己的檔頭逐字寫著:
--   「**apply 之後沒有任何東西會再量這一行**。今天看得見它壞掉的只有
--     `⟦search-LOGSILENTZERO⟧` 那格告警, **而那格還沒做。**」
-- ⇒ 這一支就是那格。它回三個值, 讓 cron 那條路每天問一次。
--
-- ══ 🛑 相依:那張表【可能還沒貼】, 而本支【不得】因此 apply 失敗 ══════════════
-- `200000` 在 Sean 的貼板佇列上。本支用 `to_regclass` 動態判斷 ⇒
-- **兩支任意順序貼都不會壞**, 而「表不存在」正好就是需求 ① 要回報的那個世界。
--
-- ══ 🔴 三個值的語意, 逐個釘死(主視窗 2026-09-04 裁)═══════════════════════════
--   table_exists      表在不在。false ⇒ 呼叫端印「未貼」【不告警】。
--   last_row_at       最後一列的時刻。**表存在而從來沒有列 ⇒ NULL**。
--     🔴 **裁的是【乙】**:`NULL` = 「還沒開始收」⇒ **不告警**;
--        有值而 `now() - last_row_at > 24h` ⇒ **告警**。
--        ⛔ ~~原提案甲(rows_24h = 0 就告警)~~ —— **每天半夜假紅一次**,
--           而「閘死於誤報遠比死於漏報常見」⇒ 假紅會被人關掉。
--   anon_can_execute  `anon` 對 `log_search_query` 的 EXECUTE。
--     🔴 **函式不存在 ⇒ NULL, 不是 false** —— 兩者要分開:
--        NULL  = 還沒貼(不告警)   false = **有人把那道門關掉了**(告警)
--        ⇒ 混在一起的話, 「還沒貼」會被告警成「有人把門關了」。
--
-- ══ 天花板:它證不到什麼 ═══════════════════════════════════════════════════
--   ① 它不驗「日誌寫進來的東西是對的」—— 只驗「有沒有在寫」。
--   ② `last_row_at` 用的是那張表自己的時間欄 ⇒ **表被清空過就分不出「沒人搜」與「被清了」**。
--   ③ 它不看顧客站流量。真的沒有人搜尋 24 小時, 它也會告警 —— 而那時該去看的是站, 不是這支。
--   ④ `search_queries.created_at` 的預設是 `date_trunc('hour', now())`(`200000:134`)
--      ⇒ `max(created_at)` 是整點 ⇒ **24h 那條門檻實際落在 24–25h 之間**。刻意不修 —— 那是
--      一個小時的鬆動, 而收緊它會把門檻變成一個沒有人算得出來的數。
--   ⑤ `to_regclass` 對 view / sequence / index 也回非 NULL ⇒ `table_exists` 真正的意思是
--      「那個名字被某個 relation 佔著」。今天無實害(那個名字只會是那張表), 而它不是「表在」。

BEGIN;

CREATE FUNCTION public.get_search_log_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- 🔴🔴 **`SET search_path = ''`, 不是 `public, pg_catalog`**(code-reviewer 2026-09-04 must-fix)。
--    ⛔ ~~我原本寫 `SET search_path = public, pg_catalog`~~ ⇒ 那把【可寫的 schema】排在
--       `pg_catalog` 前面(顯式列出之後它不再隱式優先), 而 repo 零處 `REVOKE CREATE ON SCHEMA public`
--       ⇒ **那正是 SECURITY DEFINER 提權的標準路徑。**
--    📌 而**同板列前一支 `20260904200000:399-403` 的 codex must-fix 逐字判過這個形狀**:
--       「有人改成 `SET search_path = public` 或任何可寫的 schema, 這道閘照樣綠」。
--    🔬 全樹分佈:`''` 174 支 · `pg_catalog, public` 17 支 · **我那個順序 0 支。**
--    ⇒ body 內所有物件一律全名(`pg_catalog.*` / `public.*`)。
SET search_path = ''
AS $fn$
DECLARE
  v_tbl       oid  := pg_catalog.to_regclass('public.search_queries');
  -- 🔴 **存在性問 `proname`, 權限才問簽名**(code-reviewer nit)——
  --    ⛔ ~~兩者都用寫死的簽名~~ ⇒ 簽名一改 ⇒ `to_regprocedure` 回 NULL
  --       ⇒ `anon_can_execute` 永遠是 NULL ⇒ **永久不告警**
  --       ⇒ 📌 那正是這一片要殺的「靜靜歸零」, 換了一個入口。
  v_fn_any    boolean;
  v_fn        oid  := pg_catalog.to_regprocedure('public.log_search_query(text,text,text,integer)');
  v_last      timestamptz;
  v_anon      boolean;
  v_tbl_ok    boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'log_search_query')
    INTO v_fn_any;

  -- 🔴 函式不存在 ⇒ NULL(不是 false)—— 見檔頭那段語意。
  -- 🛑 而【簽名對不上】也回 NULL, 而那與「還沒貼」是【不同的世界】⇒ 下面第三種值。
  IF v_fn IS NOT NULL THEN
    v_anon := pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE');
  ELSIF v_fn_any THEN
    -- 🔴🔴 **第三種世界(codex 2026-09-04 must-fix)**:那個【名字】在, 而【簽名對不上】。
    --    ⛔ ~~我原本算了 `v_fn_any` 而【沒有用它】~~ ⇒ 簽名一改 ⇒ `v_fn` 是 NULL
    --       ⇒ 回 `anon_can_execute = NULL` ⇒ 呼叫端讀成「還沒貼」⇒ **永久不告警**
    --       ⇒ 📌 **那正是這一片要殺的「靜靜歸零」, 換了一個入口。**
    --    ✅ 改成:名字在而簽名對不上 ⇒ **回 false**(= 有人要看), 不是 NULL。
    v_anon := false;
  END IF;

  -- 🔴🔴 **驗 relkind 與 owner(codex must-fix)** —— `to_regclass` 對 view / sequence 也回非 NULL。
  --    表缺席時, 若有人在 `public` 建一支【同名 view】, 下面那句 `EXECUTE` 會用 **DEFINER 的
  --    owner 身分**去跑那支 view 的內容 ⇒ 那是提權面, 不只是「讀到錯的東西」。
  --    ✅ 只認【普通表(r)或分割表(p)】, 而且 owner 必須與本函式的 owner 相同。
  IF v_tbl IS NOT NULL THEN
    SELECT (c.relkind IN ('r', 'p')
            AND c.relowner = (SELECT p.proowner FROM pg_catalog.pg_proc p
                               WHERE p.oid = pg_catalog.to_regprocedure(
                                 'public.get_search_log_health()')))
      INTO v_tbl_ok
      FROM pg_catalog.pg_class c WHERE c.oid = v_tbl;
    IF NOT coalesce(v_tbl_ok, false) THEN
      -- 🛑 **不是回 table_exists=false** —— 那會被讀成「還沒貼」而靜靜不告警。
      --    這是一個【有人種了東西進來】的世界, 它必須吵。
      RAISE EXCEPTION 'get_search_log_health:public.search_queries 不是一張我們擁有的普通表 '
        '(relkind/owner 不符)⇒ 拒絕以 DEFINER 身分讀它';
    END IF;
  END IF;

  IF v_tbl IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'table_exists', false,
      'last_row_at', NULL,
      'anon_can_execute', v_anon);
  END IF;

  -- 🔴 動態 SQL:那張表在【編譯本函式的當下】可能不存在 ⇒ 靜態參照會讓 CREATE 失敗。
  EXECUTE 'SELECT pg_catalog.max(created_at) FROM public.search_queries' INTO v_last;

  RETURN pg_catalog.jsonb_build_object(
    'table_exists', true,
    'last_row_at', v_last,
    'anon_can_execute', v_anon);
END
$fn$;

COMMENT ON FUNCTION public.get_search_log_health() IS
  '搜尋日誌健康度(⟦search-LOGSILENTZERO⟧)。零 PII —— 只回三個值:表在不在、'
  '最後一列的時刻、anon 對 log_search_query 的 EXECUTE。'
  'last_row_at 為 NULL = 表在而從來沒有列 = 【還沒開始收】, 不是異常。'
  'anon_can_execute 為 NULL = 那支函式不存在(還沒貼);false = 那道門被關掉了。';

-- 🔴 兩道都要下:FROM PUBLIC 收不到具名授權, FROM 具名 收不到 PUBLIC 授權。
--    形狀照 docs/patterns/revoking-function-execute-in-supabase.md。
REVOKE ALL ON FUNCTION public.get_search_log_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_search_log_health() FROM anon;
REVOKE ALL ON FUNCTION public.get_search_log_health() FROM authenticated;
REVOKE ALL ON FUNCTION public.get_search_log_health() FROM service_role;
-- 只有 cron 那條路要叫它。
GRANT EXECUTE ON FUNCTION public.get_search_log_health() TO service_role;

-- 新物件收權斷言(樣板抄自 20260817070000, 只換清單)
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.get_search_log_health()'
  ]::text[];
  v_declares_nothing boolean := false;

  r          text;
  v_oid      oid;
  v_bad      int := 0;
  v_first    text;
  v_checked  int := 0;
  v_priv     text;
  v_col      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件，請把 v_declares_nothing 設成 true（明示），不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := pg_catalog.to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(codex 2026-08-17 `must-fix`)。
    --    E-684 樣板手寫七種,而 **PG 17 有八種 —— 少了 `MAINTAIN`**。
    --    而本檔自己的病構造輸出就印著 `anon=MAINTAIN` ⇒ **樣板掃不到它自己舉的那個例子。**
    --    改成從 `acldefault('r', owner)` 推導:PG 之後再加第九種,這一臂自動入列。
    --    📎 同一個修法 B1-b 已經走過(`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:343-346`)。
    --    🔴 `DISTINCT` 在這裡是承重的:這是迴圈,同一權限型別出現兩次會讓 v_bad 多加一次。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;

    -- 🔴🔴 欄級授權必須另外問 —— `has_table_privilege` 對【只有欄級授權】的情況回 false。
    FOR v_col IN
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege('anon', v_oid, v_col, v_priv)
           OR has_column_privilege('authenticated', v_oid, v_col, v_priv) THEN
          v_bad := v_bad + 1;
          IF v_first IS NULL THEN
            v_first := format('%s.%s 上仍有【欄級】%s', r, v_col, v_priv);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母，不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限（第一個:%）。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件，anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

-- ── 事後閘 ────────────────────────────────────────────────────────────────
DO $gate$
DECLARE v_oid oid := pg_catalog.to_regprocedure('public.get_search_log_health()');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'search-log-health 閘①:函式沒建成';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'search-log-health 閘②:anon/authenticated/PUBLIC 仍叫得動它 ⇒ REVOKE 沒生效';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'search-log-health 閘③:service_role 叫不動它 ⇒ GRANT 沒生效或簽名打錯';
  END IF;

  -- 🔴🔴 **閘④(codex 2026-09-04 must-fix):上面那三個 f 【不代表 anon 到不了】** ——
  --    `anon` 若是 `service_role`(或任何被授權角色)的成員, 它可以 `SET ROLE` 過去
  --    ⇒ 那三道 REVOKE **繞得過**, 而 `has_function_privilege` 照樣印 f。
  --    ⇒ ✅ 直接問【角色成員關係】, 不是只問有效權限。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles grantee ON grantee.oid = m.member
      JOIN pg_catalog.pg_roles granted ON granted.oid = m.roleid
     WHERE grantee.rolname IN ('anon', 'authenticated')
       AND granted.rolname = 'service_role'
  ) THEN
    RAISE EXCEPTION 'search-log-health 閘④:anon/authenticated 是 service_role 的成員 '
      '⇒ 它們可以 SET ROLE 過去 ⇒ 上面那三個 f 是【假的】';
  END IF;
  -- 🛑 **而這一格證不到的**:owner 本身當然叫得動它(那是 DEFINER 的前提, 不是缺陷);
  --    而**誰能 SET ROLE 到 owner** 本閘不查 —— 那要看整個叢集的角色圖。
  -- 🔴🔴 ⑤a/⑤b:形狀抄 `20260904200000:390-408`(code-reviewer must-fix:我原本缺這兩格,
  --    而 `scripts/migration-static-checks.sh` **全檔零 `search_path` 字面**
  --    ⇒ 「五道全過」對 search_path 那條【零判別力】)。
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION 'search-log-health 閘⑤a:函式不是 SECURITY DEFINER';
  END IF;
  IF coalesce((SELECT pg_catalog.array_to_string(p.proconfig, ',')
                 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid), '')
     NOT IN ('search_path=', 'search_path=""') THEN
    RAISE EXCEPTION 'search-log-health 閘⑤b:DEFINER 的 search_path 不是【空字串】⇒ 那是提權面';
  END IF;

  -- 🔴 真的叫一次 —— 「它建起來了」與「它跑得動」是兩個宣稱。
  --    而現在那張表【很可能還不存在】⇒ 正好走 table_exists=false 那條路。
  PERFORM public.get_search_log_health();
END
$gate$;

COMMIT;
