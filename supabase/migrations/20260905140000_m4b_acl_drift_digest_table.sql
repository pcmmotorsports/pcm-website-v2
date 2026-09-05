-- ⟦b9-ACLDRIFT5⟧ 片一:每天把八族 ACL 摘要記一列 —— 路⑤(dashboard / SQL Editor 手動改權限)
-- plan:docs/plans/2026-09-05-acl-drift-runtime-detector-plan.md
--
-- 🔴 **本片【只記錄, 不告警】** —— 告警那一列(check-anomaly-alerts 那兩格)是片二。
--    理由:plan §4.3 留了一個沒拍板的岔路(repo 的 hash 怎麼給 DB 讀:env 餵 vs 寫進 DB)。
--    📌 **而片一完全不需要那個答案** —— 「今天與昨天不同」這件事只用 DB 自己的兩列就答得出來。
--    🔴 **而它答的【不是】「有沒有人動過」**(codex 2026-09-05 R1 抓到, 我原本那句寫太強):
--       10:00 手動 GRANT、11:00 改回來 ⇒ 兩次 00:00 的快照【完全相同】⇒ 這支永遠不會叫。
--       ✅ 它答得準確的是:**兩個取樣時點【之間】的狀態差**。
--       ⇒ 要抓「動過又改回來」得靠 event trigger / log,那是另一條路,不在本片也不在片二。
--    ⇒ 那個岔路留給片二(「與【已批准的基線】相同嗎」是另一個問題)。
--
-- 🛑 **本片證不到什麼**(先寫, 免得下一個人以為它涵蓋更多):
--    · 它只看 `public` + `storage` 兩個 schema 與四個應用角色 —— 與 scripts/acl-snapshot.sh 同一個分母。
--      那個分母以外的改動(別的 schema、別的角色)**它一格都不會叫**。
--    · 它記的是【摘要】不是【全表】⇒ 它答得出「有沒有變」, 答不出「哪一格變了」。
--      🔵 診斷靠 `bash scripts/acl-snapshot.sh`(它會逐族印差異)—— **偵測與診斷刻意分開。**
--    · 🔴 它【不會】在有人改權限的當下叫 —— 每天 00:00 一次 ⇒ 最壞情況延遲 24 小時。
--    · 🔴 **⑥b 那四道 REVOKE 擋的是【直接呼叫】, 擋不住 `SET ROLE`**(codex 2026-09-05 R1):
--      一個應用角色若是某個持有 EXECUTE 的角色的成員(即使 `INHERIT FALSE`),
--      它仍可 `SET ROLE` 過去呼叫這支 DEFINER 函式、灌一列假快照進來。
--      🛑 而本片**不打算擋那條路** —— 能 `SET ROLE` 成那種角色的人, 已經動得了比這張表大得多的東西。
--      📌 **寫在這裡是為了不讓下一個人以為它擋住了。** 真要收要在【角色成員關係】那一層做。
--
-- 🔵 為什麼族數是 8 不是 plan 寫的「七族」:plan 寫於 2026-09-05 稍早, 之後 `DEFACL` 族才加進 acl-snapshot.sh。
--    當場量(2026-09-05):FN 704 / REL 308 / FNCFG 176 / POL 96 / STORAGEACL 32 / VIEWOPT 17 / DEFACL 9 / ROLE 4 = **1346**。
--    ⇒ 本片的分母以【腳本現況】為準, 不以 plan 的字面為準。

-- ── ROLLBACK(整支, 照這個順序;codex R1 抓到 plan §5 漏了兩支函式)────────
--   SELECT cron.unschedule('pcm-acl-digest');          -- 🔴 用【名字】不用 jobid(jobid 會變)
--   DROP FUNCTION IF EXISTS public.pcm_acl_digest_record();
--   DROP FUNCTION IF EXISTS public.pcm_acl_digest();
--   DROP TABLE IF EXISTS public.pcm_acl_snapshot_digest;  -- 索引跟著表走
--   🔴 **少了中間兩行, 正式庫會留下一支「呼叫即失敗」的 `pcm_acl_digest_record()`** ——
--      它讀不到表, 而它【存在】⇒ 下一個人 grep 得到它, 以為這片還在跑。
--   🔵 本片不改任何既有物件的權限 ⇒ 回滾不會留下半個狀態。

BEGIN;

-- ── 前置閘⓪:同名物件已存在 ⇒ 這支貼過了, 整支停 ───────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'pcm_acl_snapshot_digest') THEN
    RAISE EXCEPTION '前置閘⓪:public.pcm_acl_snapshot_digest 已存在 ⇒ 這支貼過了, 不要重貼';
  END IF;
END $$;

-- ── ① 那張小表 ──────────────────────────────────────────────────
CREATE TABLE public.pcm_acl_snapshot_digest (
  taken_at   timestamptz PRIMARY KEY DEFAULT now(),
  digest     text        NOT NULL,
  row_count  integer     NOT NULL,
  families   jsonb       NOT NULL
);

COMMENT ON TABLE public.pcm_acl_snapshot_digest IS
  '⟦b9-ACLDRIFT5⟧ 每天一列 ACL 摘要。digest=八族全文的 md5;row_count 與 digest 一起存 —— '
  'digest 相同而列數不同在數學上不可能, 所以它是一個免費的「這支 SQL 有沒有整段沒跑」對照。'
  'families 存每族各自的 md5 與列數, 讓人一眼看出是哪一族變了。'
  '🛑 這張表【只被 cron 寫、只被人讀】—— 四個應用角色四道 REVOKE 全收。';

-- static-checks:no-grant-needed 這張表【刻意不給任何人】—— 只有表擁有者(postgres)與那支
--   cron 走得到, 四個應用角色四道 REVOKE 全收。沒有任何頁面 / API 讀它;
--   要看內容的人走 psql 或 SQL Editor。⇒ 它不是「忘了寫 GRANT」, 是「不該有 GRANT」。

-- ── ② 四道 REVOKE(不是三道)+ RLS ────────────────────────────────
-- 🔴 具名收 service_role 的理由:少了它 `TRUNCATE` 留著, 而 **RLS 不管 TRUNCATE**
--    (codex 2026-09-05 在 M1a 抓到的同一條)。
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM anon;
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM authenticated;
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_acl_snapshot_digest ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_acl_snapshot_digest -- 零 policy 是【刻意】的:只有表擁有者(postgres)與那支 cron 走得到;四個應用角色四道 REVOKE 全收。

-- ── ③ 算摘要的函式 ──────────────────────────────────────────────
-- 🔴 SECURITY DEFINER + search_path='' —— 與 M1a/M1b 鎖的那 20 支同一個形狀。
--    (`has_*_privilege` 要看得到全庫, 而呼叫它的是 cron 的 postgres。)
CREATE FUNCTION public.pcm_acl_digest()
RETURNS TABLE (digest text, row_count integer, families jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH rows AS (
    SELECT 'ROLE' AS kind, r.rolname::text AS obj, '' AS priv,
           CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' ELSE '-' END AS val
      FROM pg_catalog.pg_roles r
     WHERE r.rolname IN ('anon','authenticated','service_role','payment_confirmer')
    UNION ALL
    SELECT 'REL', n.nspname::text||'.'||c.relname::text||'|'||c.relkind::text, g.rol,
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'SELECT') THEN 'S' ELSE '-' END ||
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'INSERT') THEN 'I' ELSE '-' END ||
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'UPDATE') THEN 'U' ELSE '-' END ||
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'DELETE') THEN 'D' ELSE '-' END ||
           -- 🔴 TRUNCATE / REFERENCES / TRIGGER(codex R2)—— 少了它們, 手動 GRANT TRUNCATE 完全隱形,
           --    而 TRUNCATE 正是 RLS 管不到的那一個。與 scripts/acl-snapshot.sh 同步改。
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'TRUNCATE') THEN 'T' ELSE '-' END ||
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'REFERENCES') THEN 'R' ELSE '-' END ||
           CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'TRIGGER') THEN 'G' ELSE '-' END ||
           CASE WHEN c.relrowsecurity THEN '|RLS' ELSE '|---' END
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
     WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p')
    UNION ALL
    SELECT 'FN', n.nspname::text||'.'||p.proname::text||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')', g.rol,
           CASE WHEN pg_catalog.has_function_privilege(g.rol, p.oid, 'EXECUTE') THEN 'X' ELSE '-' END ||
           CASE WHEN p.prosecdef THEN '|DEF' ELSE '|INV' END
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'FNCFG',
           n.nspname::text||'.'||p.proname::text||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
           CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END,
           COALESCE((SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'), '(未設)')
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'VIEWOPT',
           n.nspname::text||'.'||c.relname::text||'|'||CASE c.relkind WHEN 'm' THEN 'matview' ELSE 'view' END,
           COALESCE((SELECT o FROM unnest(c.reloptions) o WHERE o LIKE 'security_invoker=%'), 'security_invoker=(未設)'),
           pg_catalog.pg_get_userbyid(c.relowner)::text
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v','m')
    UNION ALL
    SELECT 'STORAGEACL',
           n.nspname::text||'.'||c.relname::text||'|'||c.relkind::text, g.rol,
           (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'SELECT')   THEN 'S' ELSE '-' END)||
           (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'INSERT')   THEN 'I' ELSE '-' END)||
           (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'UPDATE')   THEN 'U' ELSE '-' END)||
           (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'DELETE')   THEN 'D' ELSE '-' END)||
           (CASE WHEN pg_catalog.has_table_privilege(g.rol, c.oid, 'TRUNCATE') THEN 'T' ELSE '-' END)||
           '|'||CASE WHEN c.relrowsecurity THEN 'RLS' ELSE '---' END||
           '|pol='||(SELECT count(*)::text FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid)||
           '|aclmd5='||pg_catalog.md5(COALESCE(c.relacl::text,''))||
           '|own='||pg_catalog.pg_get_userbyid(c.relowner)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer')) AS g(rol)
     WHERE n.nspname = 'storage' AND c.relkind IN ('r','p','v','m')
    UNION ALL
    SELECT 'DEFACL',
           COALESCE(n.nspname,'(全域)')::text||'|'||d.defaclobjtype::text,
           pg_catalog.pg_get_userbyid(d.defaclrole)::text,
           d.defaclacl::text
      FROM pg_catalog.pg_default_acl d
      LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname IN ('storage','public') OR n.nspname IS NULL
    UNION ALL
    SELECT 'POL',
           n.nspname::text||'.'||c.relname::text||'|'||p.polname::text,
           -- 🔴 這一層的 ORDER BY 也要釘 collation(codex R2)—— 外層釘了而這裡漏掉,
           --    平台升級改了 collation ⇒ 角色順序變 ⇒ 同一條 policy 算出不同的字串。
           COALESCE((SELECT string_agg(r2.rolname::text, ',' ORDER BY r2.rolname COLLATE "C")
                       FROM pg_catalog.pg_roles r2 WHERE r2.oid = ANY(p.polroles)), 'PUBLIC'),
           -- 🔴 **`COALESCE(md5(x),'-')` 不是 `md5(COALESCE(x,''))`** —— 沒有 USING 子句時
           --    前者印 `-`, 後者印【空字串的 md5】(d41d8cd9…)。兩者都「看起來合理」,
           --    而它們讓這支函式與 scripts/acl-snapshot.sh 對同一個世界算出不同的雜湊。
           --    🔬 2026-09-05 實測抓到:8 族裡 7 族逐位元組相同, 只有 POL 異 —— 就是這一格。
           p.polcmd::text||'|'||CASE WHEN p.polpermissive THEN 'PERM' ELSE 'REST' END
           ||'|'||COALESCE(pg_catalog.md5(pg_catalog.pg_get_expr(p.polqual, p.polrelid)), '-')
           ||'|'||COALESCE(pg_catalog.md5(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)), '-')
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
  ),
  lines AS (
    -- 🔴 排序一定要固定, 否則同一個世界會算出不同的 md5(那是最惡劣的誤報:它每天都紅)
    -- 🔴 **而『固定』要寫明 `COLLATE "C"`**(codex R1):不寫的話排序跟著 DB 的 collation 走,
    --    而 collation 會因為【平台升級】而變 ⇒ ACL 一格沒動而隔天 digest 變。
    --    🛑 ⑥d-3(連算兩次要一致)接不住它 —— 升級後連算兩次【仍然一致】, 只是與昨天不同。
    SELECT kind, kind||E'\t'||obj||E'\t'||priv||E'\t'||val AS line
      FROM rows
  )
  SELECT pg_catalog.md5(pg_catalog.string_agg(line, E'\n' ORDER BY line COLLATE "C")) AS digest,
         pg_catalog.count(*)::integer AS row_count,
         -- 🔴 這裡不可以寫成「一個帶 GROUP BY 的純量子查詢」—— 那會回多列而整支炸。
         --    要【先每族各自聚合】再把那些結果 object_agg 成一個物件。
         -- 🔴 **固定八族左接**(codex R2):直接 GROUP BY 的話, 一族【合法為零列】時
         --    那個 key 就不存在 ⇒ 與「整族沒跑」印同一個東西。
         --    ⇒ 族名清單寫死在這裡, 零列的族出現為 n=0、md5 = 空字串的 md5。
         (SELECT pg_catalog.jsonb_object_agg(f.k, pg_catalog.jsonb_build_object(
                   'md5', COALESCE(g.m, pg_catalog.md5('')), 'n', COALESCE(g.n, 0)))
            FROM (VALUES ('ROLE'),('REL'),('FN'),('FNCFG'),('VIEWOPT'),
                         ('STORAGEACL'),('DEFACL'),('POL')) AS f(k)
            LEFT JOIN (SELECT kind AS k,
                              pg_catalog.md5(pg_catalog.string_agg(line, E'\n' ORDER BY line COLLATE "C")) AS m,
                              pg_catalog.count(*)::bigint AS n
                         FROM lines GROUP BY kind) g ON g.k = f.k) AS families
    FROM lines;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_acl_digest() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_acl_digest() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_acl_digest() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_acl_digest() FROM service_role, payment_confirmer;

COMMENT ON FUNCTION public.pcm_acl_digest() IS
  '⟦b9-ACLDRIFT5⟧ 算八族 ACL 的摘要。與 scripts/acl-snapshot.sh 同一組查詢、同一個分母。'
  '🔴 兩份是【會漂的兩個實作】—— 而修法不是靠這句 COMMENT 提醒人:'
  'scripts/acl-digest-parity.sh 把這支函式的 digest 與腳本產出的 tsv 比一次, 不同就紅。'
  '2026-09-05 首次比對:兩邊逐字元相同(32da2a5bd2669d30c66714ed049207de, 1346 列)。';

-- ── ④ 記一列的函式 ──────────────────────────────────────────────
CREATE FUNCTION public.pcm_acl_digest_record()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rec$
DECLARE
  v_kind text;
  v_fam  jsonb;
BEGIN
  -- 🔴 **每天都驗一次「八族都還在」**(codex R2):日後有人 `CREATE OR REPLACE pcm_acl_digest()`
  --    漏掉一族, 這支照樣每天寫入一份【少一族】的快照 ⇒ digest 每天穩定 ⇒ 看起來最健康。
  --
  -- 🔴🔴 **而【不能】用 families 的 key 去驗**(2026-09-05 實測抓到, 我自己踩的):
  --    families 現在是【固定八個 key 左接】(那是為了讓「合法為零的族」不被誤判成漏跑)
  --    ⇒ 刪掉一整族的查詢之後, 那個 key **仍然在**, 只是 n=0
  --    ⇒ 📌 **修 A 的那個動作, 把 B 的偵測器弄壞了, 而兩邊都是對的修法。**
  --    🔬 實測:刪掉 VIEWOPT 那一支 ⇒ 用 key 驗 ⇒ rc=0 通過。
  --
  -- ✅ 改成問【函式自己的定義文字】—— 那是唯一與資料多寡無關的證據。
  FOREACH v_kind IN ARRAY ARRAY['ROLE','REL','FN','FNCFG','VIEWOPT','STORAGEACL','DEFACL','POL'] LOOP
    IF pg_catalog.pg_get_functiondef('public.pcm_acl_digest()'::regprocedure)
       NOT LIKE ('%SELECT ''' || v_kind || '''%') THEN
      RAISE EXCEPTION 'pcm_acl_digest_record:pcm_acl_digest() 的定義裡沒有 % 這一族 ⇒ 有人改它時漏了', v_kind;
    END IF;
  END LOOP;

  -- 🔵 而【結構上一定非空】的四族要真的非空(這一格與上面那格各擋一半):
  --    上面擋「查詢被刪掉」, 這一格擋「查詢還在而它回 0 列」(WHERE 被改壞)。
  --    ⚠️ POL / VIEWOPT / STORAGEACL / DEFACL **可以合法為零** ⇒ 不在這一格裡。
  SELECT d.families INTO v_fam FROM public.pcm_acl_digest() d;
  FOREACH v_kind IN ARRAY ARRAY['ROLE','REL','FN','FNCFG'] LOOP
    IF COALESCE((v_fam -> v_kind ->> 'n')::bigint, 0) = 0 THEN
      RAISE EXCEPTION 'pcm_acl_digest_record:% 族回 0 列 —— 這一族在任何一座 Postgres 上都不可能是空的', v_kind;
    END IF;
  END LOOP;
  -- 🔴 **upsert 不是 insert**(codex R2):唯一索引擋住同一個 UTC 日第二列,
  --    而那會讓【當天第一筆是壞的快照】被鎖死一整天、補不回來。
  --    ⇒ 同一天再跑一次 = 覆蓋當天那列(taken_at 也一起更新, 讓「這列是幾點量的」是真的)。
  INSERT INTO public.pcm_acl_snapshot_digest AS t (digest, row_count, families)
  SELECT d.digest, d.row_count, d.families FROM public.pcm_acl_digest() d
  ON CONFLICT (((taken_at AT TIME ZONE 'UTC')::date)) DO UPDATE
     SET digest = EXCLUDED.digest,
         row_count = EXCLUDED.row_count,
         families = EXCLUDED.families,
         taken_at = now();

  -- ── 心跳 ────────────────────────────────────────────────────────
  -- 🔴 **為什麼一定要寫**:`cron-heartbeat-read` 那張儀表的判準是
  --    「migrations 排了、而白名單沒有 ⇒ 有排程沒有人在看它的心跳」。
  --    而反過來也一樣:**排在白名單裡而從來不寫心跳 ⇒ 每天一封「它沒跳」的信。**
  --    (2026-09-05 這支排程剛上就把那格測試弄紅了 —— 那格測試做對了事。)
  --
  -- 🔴 `clock_timestamp()` 不用 `now()`:`now()` 是【交易起始時間】⇒ 一個開始很早而跑很久的
  --    交易會用舊時刻蓋掉別人剛寫好的心跳 ⇒ `last_success_at` **會倒退**, 而畫面上只是「比較舊」。
  --    而光換函式不夠 —— `GREATEST` 那半才是真正擋倒退的。
  -- 🛑 而它包在自己的 BEGIN/EXCEPTION 裡:**心跳寫不成不該讓這一輪快照失敗**。
  --    ⚠️ 而那個 EXCEPTION **接不住失敗那一側** —— 這支是純 SQL 跑在 pg_cron 自己的交易裡,
  --       函式拋錯 ⇒ 同交易寫的東西一起回捲 ⇒ 它【物理上寫不出失敗心跳】。
  --       ⇒ 所以 `pcm-acl-digest` 也在 `FAILURE_COUNT_MEANINGLESS` 裡:
  --          它的 `consecutive_failures` 永遠是 0, 而那不是「零失敗」是「這一格量不到」。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-acl-digest', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[pcm_acl_digest_record] 心跳寫入失敗(本輪快照不受影響):%', SQLERRM;
  END;
END;
$rec$;

REVOKE ALL ON FUNCTION public.pcm_acl_digest_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_acl_digest_record() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_acl_digest_record() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_acl_digest_record() FROM service_role, payment_confirmer;

-- 🔴 **原本這裡寫「PK 會擋住同一天記兩次」—— 那句是【錯的】**(codex 2026-09-05 R1 抓到)。
--    `now()` 只在【同一個交易裡】不變 ⇒ 手動補跑與 cron 是兩個交易 ⇒ PK 不會撞, 同一天可以寫多列。
--    🛑 而片二若「取最新兩列相比」, 那時比到的是【今天的兩次】不是【今天對昨天】⇒ 靜靜失效。
--    ✅ 修法不是靠註解, 是一道【每天只准一列】的唯一索引:

CREATE UNIQUE INDEX pcm_acl_snapshot_digest_one_per_day
  ON public.pcm_acl_snapshot_digest (((taken_at AT TIME ZONE 'UTC')::date));
COMMENT ON INDEX public.pcm_acl_snapshot_digest_one_per_day IS
  '每個 UTC 日只准一列 —— 讓片二的「最新兩列」等於「今天對昨天」。'
  '🔴 時區釘死 UTC:跟著 session 的 TimeZone 走的話, 同一天會因為誰跑它而變成兩天。';

-- ── ⑤ 每天 00:00 記一次 ────────────────────────────────────────
-- 🟢 **成本已量**(2026-09-05 對正式庫唯讀連跑三發):**108 / 87 / 84 ms**(1346 列)。
--    ⇒ plan §6 說「要先量再定 schedule」—— 量了, 而它比那個顧慮小三個數量級。
-- 🔵 排在 `pcm-anomaly-alert`(0 1 * * *)前一小時 ⇒ 告警跑的時候今天這列已經在。
--    🔴 而「早一小時」是假設不是保證 —— 片二讀它的時候要把 `taken_at` 太舊算成 Unknown,
--       不是算成「沒事」。少了那一格, 一支壞掉的 cron 會讓那封信每天說「權限沒變」。
-- 🟢 而【我們叫得動 cron.schedule 嗎】是量過的, 不是假設(2026-09-05 唯讀實測):
--    has_schema_privilege('postgres','cron','USAGE') = t
--    has_function_privilege('postgres', cron.schedule(...), 'EXECUTE') = t
--    ⚠️ 而 `postgres` **發不出** `GRANT USAGE ON SCHEMA cron`(schema 擁有者是 supabase_admin,
--       而 pg_has_role('postgres','supabase_admin','MEMBER') = f)—— **那是另一件事, 不影響本片。**
SELECT cron.schedule('pcm-acl-digest', '0 0 * * *', $cron$SELECT public.pcm_acl_digest_record();$cron$);

-- ── ⑥ 事後斷言(這一段是量到的結果, 不是我做的動作) ──────────────
DO $$
DECLARE
  -- 🔵 收權斷言的物件清單(靜態檢查靠這個形狀數「你列了幾個」)——
  --    三個可授權物件:那張表 + 兩支函式。三個都在下面 ⑥b 逐一驗過。
  v_relations text[] := ARRAY[
    'public.pcm_acl_snapshot_digest',
    'public.pcm_acl_digest()',
    'public.pcm_acl_digest_record()'
  ]::text[];
  v_rows integer;
  v_sum  integer;
  v_d1   text;
  v_d2   text;
  v_keys text[];
  v_leak text[] := ARRAY[]::text[];
  v_r    text;
BEGIN
  -- ⑥a 表在、函式在
  IF to_regclass('public.pcm_acl_snapshot_digest') IS NULL THEN
    RAISE EXCEPTION '斷言⑥a:表沒建出來';
  END IF;

  -- ⑥b 四個應用角色一格權限都不該有(四道 REVOKE 真的收到了嗎)
  FOREACH v_r IN ARRAY ARRAY['anon','authenticated','service_role','payment_confirmer'] LOOP
    IF has_table_privilege(v_r, 'public.pcm_acl_snapshot_digest', 'SELECT')
    OR has_table_privilege(v_r, 'public.pcm_acl_snapshot_digest', 'INSERT')
    OR has_table_privilege(v_r, 'public.pcm_acl_snapshot_digest', 'UPDATE')
    OR has_table_privilege(v_r, 'public.pcm_acl_snapshot_digest', 'DELETE')
    OR has_table_privilege(v_r, 'public.pcm_acl_snapshot_digest', 'TRUNCATE') THEN
      v_leak := v_leak || v_r;
    END IF;
    IF has_function_privilege(v_r, 'public.pcm_acl_digest()', 'EXECUTE')
    OR has_function_privilege(v_r, 'public.pcm_acl_digest_record()', 'EXECUTE') THEN
      v_leak := v_leak || (v_r || '(fn)');
    END IF;
  END LOOP;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION '斷言⑥b:這些角色還有權限 ⇒ %', array_to_string(v_leak, ', ');
  END IF;

  -- ⑥c 🟢 負對照:同一把尺問【表擁有者】⇒ 必須是 true。
  --     少了這一格, 一支恆回 false 的 has_table_privilege 會讓 ⑥b 永遠通過。
  IF NOT has_table_privilege(current_user, 'public.pcm_acl_snapshot_digest', 'SELECT') THEN
    RAISE EXCEPTION '斷言⑥c:連我自己都讀不到 ⇒ 上面那把尺是壞的, ⑥b 的綠沒有意義';
  END IF;

  -- ⑥d 真的記一列, 而且列數要對得起來
  --  🔴 第一版我寫 `v_rows < 1000`(理由:正式庫實測 1346)——
  --     而拋棄式 PG 上實跑 **rc=3, row_count = 38** ⇒ 那個門檻把【規模】寫死進了一支
  --     必須在任何一座庫上都跑得過的 migration。📌 **門檻要綁解釋, 不要綁值。**
  --     ⇒ 改成三格【與規模無關】的不變式:
  PERFORM public.pcm_acl_digest_record();
  SELECT row_count INTO v_rows FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 1;

  --  ⑥d-1 非空(一座庫至少有那四個角色 ⇒ ROLE 族就不會是 0)
  IF v_rows IS NULL OR v_rows = 0 THEN
    RAISE EXCEPTION '斷言⑥d-1:row_count = % ⇒ 八族一列都沒算出來', v_rows;
  END IF;

  --  ⑥d-2 🔴🔴 **原本這裡只比「各族之和 = row_count」—— 那是一個【恆等式】**
  --       (codex 2026-09-05 R1 抓到):兩個數來自同一次 `lines`, 刪掉一整族時
  --       **兩邊一起縮小** ⇒ 它必然相等 ⇒ 這一格對「有一族沒跑」**零判別力**。
  --       📌 一個看起來像不變式的斷言, 可以只是同一個讀數的兩種寫法。
  --  ✅ 改成【點名八族】—— 少一族就少一個 key, 而 key 的名字不會跟著資料縮小。
  SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM public.pcm_acl_snapshot_digest d,
         LATERAL jsonb_object_keys(d.families) AS k
   WHERE d.taken_at = (SELECT max(taken_at) FROM public.pcm_acl_snapshot_digest);
  IF v_keys IS DISTINCT FROM ARRAY['DEFACL','FN','FNCFG','POL','REL','ROLE','STORAGEACL','VIEWOPT']::text[] THEN
    RAISE EXCEPTION '斷言⑥d-2:族名不是那八個 ⇒ 有整族沒跑或多跑了。實得 %',
      COALESCE(array_to_string(v_keys, ','), '(NULL)');
  END IF;

  --  ⑥d-2b 各族之和 = row_count(保留, 而它【只】接住「families 與總數不是同一次量測」)
  SELECT COALESCE(sum((v.value ->> 'n')::integer), -1) INTO v_sum
    FROM public.pcm_acl_snapshot_digest d,
         LATERAL jsonb_each(d.families) AS v
   WHERE d.taken_at = (SELECT max(taken_at) FROM public.pcm_acl_snapshot_digest);
  IF v_sum <> v_rows THEN
    RAISE EXCEPTION '斷言⑥d-2b:各族之和 % 與 row_count % 不同', v_sum, v_rows;
  END IF;

  --  ⑥d-3 🔴 同一個世界連算兩次要一樣 —— 接住「排序不固定」那種【每天都紅】的誤報,
  --        那是這道閘最惡劣的死法:它會天天叫, 然後被人關掉。
  SELECT digest INTO v_d1 FROM public.pcm_acl_digest();
  SELECT digest INTO v_d2 FROM public.pcm_acl_digest();
  IF v_d1 IS DISTINCT FROM v_d2 THEN
    RAISE EXCEPTION '斷言⑥d-3:同一個世界連算兩次得到不同的 digest ⇒ 排序不固定';
  END IF;

  -- ⑥e RLS 真的開著
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
           WHERE oid = 'public.pcm_acl_snapshot_digest'::regclass) THEN
    RAISE EXCEPTION '斷言⑥e:RLS 沒開';
  END IF;

  -- ⑥f 那支排程真的排上去了 —— 而【名字在】不等於【它會跑】
  --  🔴 codex 2026-09-05 R1:同名 job 若既存且 `active = false`, `cron.schedule` 只更新
  --     schedule / command, **不會把它重新啟用** ⇒ 只看名字的話, 排程永遠不跑而斷言全綠。
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-acl-digest') THEN
    RAISE EXCEPTION '斷言⑥f:cron.schedule 回了值而 cron.job 裡沒有那一列';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'pcm-acl-digest' AND command LIKE '%pcm_acl_digest_record%') THEN
    RAISE EXCEPTION '斷言⑥f-3:那支排程的 command 不是在叫 pcm_acl_digest_record() ⇒ 名字對而做的事不對';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-acl-digest' AND active) THEN
    RAISE EXCEPTION '斷言⑥f-2:那支排程存在而 active = false ⇒ 它永遠不會跑。'
                    '先 SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname=''pcm-acl-digest''), active := true);';
  END IF;
END $$;

COMMIT;
