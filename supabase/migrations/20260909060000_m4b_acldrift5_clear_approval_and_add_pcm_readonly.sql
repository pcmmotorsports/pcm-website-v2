-- ═══ ⟦b9-ACLDRIFT5⟧ 偵測器補【便宜的兩個】 ═══
-- 出板:線【權限/信件】窗 C, 2026-09-09。plan `docs/plans/2026-09-09-acl-digest-two-cheap-fixes-plan.md`。
-- 授權鏈逐字:Sean 2026-09-09 對「偵測器要不要補」拍 乙, 原話「只補便宜的兩個」;
--             2026-09-09 傍晚對本 plan 拍 甲(批)。SQL 由主視窗代貼, 窗 C 不 apply。
--
-- ── 改動 A · pcm_acl_digest_record():同日重錄要清掉舊的章 ──────────────────
--   病:ON CONFLICT DO UPDATE 換掉 digest/row_count/families/taken_at, 而【不清】approved_at。
--       ⇒ 「批准了 A → 權限被改成 B → 同一個 UTC 日再跑一次」⇒ B 帶著 A 的章,
--         而 pcm_acl_drift_status 印「最新這列已被批准 = t」⇒ 不告警。
--   🔬 拋棄式 PG 17.10 實測(2026-09-09 20:1x):
--       ⚪ 負對照(只套改動 B、不套 A)⇒ 同日重錄後 approved_note 逐字仍是「負對照:我是舊的章」
--       🟢 正向(套上 A)          ⇒ approved_at=NULL · approved_note=NULL, 而一天仍只有一列
--       ⇒ 📌 那個負對照【真的紅了】—— 病是重現過的, 不是推的。
--
-- ── 改動 B · pcm_acl_digest() 的【REL 族】加 pcm_readonly ────────────────────
--   病:REL 族的 CROSS JOIN 只有 anon/authenticated/service_role/payment_confirmer
--       ⇒ pcm_readonly 不在偵測射程 ⇒ 一個 GRANT … TO pcm_readonly 即使【永久留著】也不會叫。
--   🎯 而那不是假設:2026-09-08 真的發生過 ——
--       20260908110000_m4b_aclro1_grant_readonly_acl_tables.sql:141-142 那兩道 GRANT 就在盲區裡。
--   🛑🛑 **只改 REL 族那一處。** 同一支函式裡還有兩處【一模一樣】的 CROSS JOIN (VALUES …):
--       FN 族 與 STORAGEACL 族。**它們不准動** —— Sean 只拍了 REL。
--       🔬 守門讀數(拋棄式實測):套完之後 FN = 8 = 2 支函式 × 4 角色
--          ⇒ FN 族【沒有】跟著加第五個角色。REL = 25 = 5 relations × 5 角色。
--
-- ── 🔴 這支 SQL 最容易【安靜出錯】的一格 ────────────────────────────────────
--   兩支線上都是 SECURITY DEFINER 且帶 SET search_path TO ''(唯讀實測 proconfig = {"search_path=\"\""})。
--   而 **CREATE OR REPLACE 會把 SET 子句整組換掉** ⇒ 少寫那一行, 強化就被打回去,
--   **而函式本體 md5 一模一樣、每一道尺照樣綠**。
--   ⇒ ✅ 本檔的基底是 2026-09-09 11:5x UTC 從【正式庫】唯讀取出的 pg_get_functiondef
--        (原樣存在 docs/evidence/2026-09-09-acl-digest-functions-live-baseline.sql),
--        **不是** supabase/migrations/20260905140000 那一份 —— 後者是「當初貼的那一版」。
--   ⇒ 事後閘② 專門守這一格。
--
-- ── 🔴 而【檔內的閘擋不到的那一格】(codex R1 must-fix ⑤, 寫給代貼的人)────────────
--   前置閘② 只驗「存在 + 零參數 + SECURITY DEFINER + proconfig 相符」。
--   🛑 若別的窗改了函式【本體】而那四樣沒動 ⇒ 本檔所有閘照樣全綠, 而【舊基底會覆蓋新修正】。
--   ⇒ ✅ **代貼前必須另外做一次定義比對**(plan §7 貼前閘②):
--        把兩支的 pg_get_functiondef 與 supabase/rollbacks/20260909060000-rollback.sql 裡
--        對應那兩段逐字比 —— 不同 ⇒ 停, 重新取一次線上定義。
--        ⚠️ 比的是【同格式的 pg_get_functiondef】, 不是整份 rollback 檔的雜湊(它多了註解與交易封套)。
--
-- ── 🛑 本檔不涵蓋(寫出來, 免得被讀成「漂移偵測修好了」)────────────────────
--   ① 未批准的漂移訊號【第三天會自己消失】(view 只取最新兩列)—— Sean 沒選補。
--      後果:一筆沒人看的漂移, 兩天後沒有任何地方會提到它。RECORD 2(2026-09-06)就是這樣過去的。
--      今天唯一的緩解 = docs/evidence/2026-09-09-acl-drift-snapshot-preserved.md 那份保全抄本。
--   ② FN 族與 STORAGEACL 族一樣只有那四個角色(見上)。
--   ③ 欄級授權(attacl)仍不在射程 —— REL 族走的是 has_table_privilege(表級)。
--   ④ pcm_acl_approve_latest 綁不住受審快照(只吃 p_note、取 max(taken_at))—— Sean 已拍【不蓋章】。
--
-- ── rollback ────────────────────────────────────────────────────────────────
--   supabase/rollbacks/20260909060000-rollback.sql(= 那份線上基底, 已在拋棄式實跑過語法)
--   🛑 它只還原【函式定義】:還原不了被同日重錄覆蓋的快照, 也補不回被清掉的 approved_at。
--      那兩樣一動就沒有退路 —— 這是本改動的真實邊界。

BEGIN;
-- 🔴 ⟦b4-LOCK1⟧ 鎖超時:CREATE OR REPLACE FUNCTION 會拿 ACCESS EXCLUSIVE LOCK。
--    正式庫上那兩支正被 pg_cron 的 0 0 * * * 那一發呼叫時, 這裡會排隊等 ——
--    5 秒等不到就放棄, 不要卡住線上。
SET LOCAL lock_timeout = '5s';


-- ══ 前置閘 ══════════════════════════════════════════════════════════════════
DO $gate$
DECLARE
  v_missing text;
  v_bad     text;
BEGIN
  -- 前置閘① 🔴 pcm_readonly 這個角色必須存在。
  --   理由不是潔癖:has_table_privilege('<不存在的角色>', …) 會【拋錯】, 不是回 false
  --   ⇒ 角色不在 ⇒ 整支 pcm_acl_digest() 失敗 ⇒ 快照停止更新,
  --     **而保留中的舊快照不會顯示這次失敗** ⇒ 壞掉與沒事印同一個畫面。
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 前置閘①:角色 pcm_readonly 不存在 ⇒ 停。'
                    '本檔的改動 B 會把它放進 has_table_privilege, 角色不在會讓整支 digest 拋錯。';
  END IF;

  -- 前置閘② 兩支函式都必須在, 而且仍是 SECURITY DEFINER + search_path 空字串。
  --   不符 ⇒ 本檔的基底(2026-09-09 11:5x UTC 的線上定義)已經過期, 停。
  SELECT pg_catalog.string_agg(x.nm, ', ') INTO v_missing
    FROM (VALUES ('pcm_acl_digest'),('pcm_acl_digest_record')) AS x(nm)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = x.nm AND p.pronargs = 0);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 前置閘②:這幾支零參數函式不存在 ⇒ 停:%', v_missing;
  END IF;

  SELECT pg_catalog.string_agg(p.proname::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_acl_digest','pcm_acl_digest_record')
     AND p.pronargs = 0
     -- [codex R1 must-fix 1] 舊寫法 split_part(c,char,1) = 'search_path=' 只驗【第一個引號前的字】
     --    ⇒ search_path="$user", public 與 search_path="SomeSchema" 都會【被錯誤放行】(codex 逐格推導)。
     --    ✅ 契約就是受審基底那唯一一個設定 ⇒ 整個陣列比對:NULL / 別的路徑 / 多餘設定全部擋下。
     AND (p.prosecdef IS NOT TRUE
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 前置閘②:這幾支已不是「SECURITY DEFINER + 帶 search_path」⇒ '
                    '本檔的基底過期了, 停, 重新取一次線上定義:%', v_bad;
  END IF;
END $gate$;

-- ══ 改動 A + 改動 B(基底 = 2026-09-09 11:5x UTC 的線上 pg_get_functiondef)═══════
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
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role'),('payment_confirmer'),
                         ('pcm_readonly')) AS g(rol)
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
         taken_at = now(),
         approved_at   = NULL,
         approved_note = NULL;

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

-- ══ 事後閘 ══════════════════════════════════════════════════════════════════
DO $post$
DECLARE
  v_rel_n   int;
  v_relcnt  int;
  v_bad     text;
BEGIN
  -- 事後閘① 改動 A 真的進去了(而不是只進了 B)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'pcm_acl_digest_record'
       AND p.pronargs = 0            -- [codex R1 must-fix 5] 鎖定零參數簽章
       AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%approved_at   = NULL%') THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 事後閘①:改動 A 沒進去(pcm_acl_digest_record 的定義裡找不到 approved_at = NULL)⇒ 停';
  END IF;

  -- 事後閘② 🔴 SET 子句沒被 CREATE OR REPLACE 吃掉(本檔最容易安靜出錯的那一格)
  SELECT pg_catalog.string_agg(p.proname::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('pcm_acl_digest','pcm_acl_digest_record')
     AND p.pronargs = 0              -- [codex R1 must-fix 5] 鎖定零參數簽章
     -- [codex R1 must-fix 1] 舊寫法 split_part(c,char,1) = 'search_path=' 只驗【第一個引號前的字】
     --    ⇒ search_path="$user", public 與 search_path="SomeSchema" 都會【被錯誤放行】(codex 逐格推導)。
     --    ✅ 契約就是受審基底那唯一一個設定 ⇒ 整個陣列比對:NULL / 別的路徑 / 多餘設定全部擋下。
     AND (p.prosecdef IS NOT TRUE
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 事後閘②:SET search_path / SECURITY DEFINER 掉了 ⇒ %', v_bad;
  END IF;

  -- 事後閘③ 改動 B 真的進去了 —— 用【行為】驗, 不只驗字面:
  --   REL 族的列數必須 = public 的 r/v/m/p 個數 × 5(五個角色)。
  SELECT ((public.pcm_acl_digest()).families -> 'REL' ->> 'n')::int INTO v_rel_n;
  SELECT count(*) INTO v_relcnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p');
  IF v_rel_n IS DISTINCT FROM v_relcnt * 5 THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 事後閘③:REL 族是 % 而預期 %(= % 個 relation × 5 個角色)⇒ 改動 B 沒生效或改到別處',
                    v_rel_n, v_relcnt * 5, v_relcnt;
  END IF;

  -- 事後閘④ ⚪ 正對照:FN 族【不可以】跟著變成五個角色份。
  --   少了這一道, 「我改到三處 CROSS JOIN 全部」與「只改對那一處」在事後閘③ 眼裡一樣綠。
  IF ((public.pcm_acl_digest()).families -> 'FN' ->> 'n')::int
     IS DISTINCT FROM (SELECT count(*) * 4 FROM pg_catalog.pg_proc p
                         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                         -- [codex R1 2] 基底的 FN 族 WHERE 【只有】 nspname='public',沒有 prokind 過濾
                         --    ⇒ 這裡也不可以加 prokind = 'f',加了反而與被驗的那支對不上。
                        WHERE n.nspname = 'public') THEN
    RAISE EXCEPTION '貼板 ACLDRIFT5 事後閘④(正對照):FN 族的角色數變了 ⇒ 我改到不該改的那兩處 CROSS JOIN ⇒ 停';
  END IF;
END $post$;

COMMIT;
