-- 🔴 這是 2026-09-09 11:5x UTC 從【正式庫】唯讀取出的現行定義(pg_get_functiondef)。
-- 用途:⟦b9-ACLDRIFT5⟧ 那兩處小改的【可執行反向 SQL】—— 要退回,原樣跑這兩段即可。
-- 🛑 不要拿 supabase/migrations/20260905140000 那份當基底:
--    CREATE OR REPLACE 會把 SET 子句整組換掉,而線上這兩支都帶 SET search_path TO ''。
-- 🛑 本檔【不是 migration】,不進 supabase/migrations/。
-- ✅ 它就是 20260909060000 的核准回復件 —— **僅供核准回復時執行**(codex R1 ④:原字面「不要貼」與用途矛盾)。
-- ⚪ 進版控前掃過 vault/decrypted_secret/password/token/bearer/api_key ⇒ 兩檔皆 0 命中。
--
-- 🔴🔴 **兩處 `$function$` 的收尾分號是【我補上去的】,不是 pg_get_functiondef 給的。**
--    codex R1 抓到:原樣輸出的兩段之間【沒有分號】⇒ 第二個 CREATE 會接在第一個的尾巴上 ⇒ 語法錯。
--    ⇒ 📌 一個跑不起來的 rollback 比沒有 rollback 更糟, 所以這一格寫出來。
-- ✅ **[2026-09-09 20:2x 台灣] 補完分號之後在拋棄式 PG 17.10 實跑過了**:
--    原樣 psql -f 這份檔 ⇒ CREATE FUNCTION × 2(語法過);
--    而且先確認兩支的定義 md5 【已經先變過】, 再跑本檔 ⇒ 兩支【逐字回到基底】。
--    🔴 那道「先變過」的前提斷言不可省 —— 少了它,「套了卻沒變」與「回到基底」長得一樣。
-- 🛑 **而它還沒有對正式庫跑過。** 兩句分開講。
--
-- 🛑 **這份 rollback 只還原【函式定義】** —— 它不會:
--    · 把同日重錄覆蓋掉的那張快照還原回來
--    · 把被清掉的 approved_at / approved_note 補回來
--    ⇒ 那兩樣一旦動了就沒有退路, 這是本改動的真實邊界。
-- ✅ 建議把兩段包在同一個交易裡跑(BEGIN; …兩段…; COMMIT;), 不要拆兩次提交。

-- 🔴🔴 [codex R1 must-fix ④] **交易封套是必要的,不是建議** ——
--    psql 預設自動提交:第一支成功、第二支失敗 ⇒ 只退一支 ⇒ 退成一個沒人驗過的組合。
--    ⇒ 下面的 BEGIN … COMMIT 不可以拆掉。

BEGIN;
-- 🔴 ⟦b4-LOCK1⟧ 鎖超時:CREATE OR REPLACE FUNCTION 會拿 ACCESS EXCLUSIVE LOCK。
--    正式庫上那兩支正被 pg_cron 的 0 0 * * * 那一發呼叫時, 這裡會排隊等 ——
--    5 秒等不到就放棄, 不要卡住線上。
SET LOCAL lock_timeout = '5s';


CREATE OR REPLACE FUNCTION public.pcm_acl_digest()
 RETURNS TABLE(digest text, row_count integer, families jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.pcm_acl_digest_record()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

COMMIT;
