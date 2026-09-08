-- ⟦b9-PROBESCHED⟧ 片 1 · net 曝露面每日唯讀探針
-- 主視窗 A 2026-09-08 批 plan(~/pcm-mailbox/plan-探針接排程-併案-tidy-20260908.md), Q3 = 分批, 本片先。
--
-- 🔴 它從哪裡來:`scripts/check-anon-grants-prod.sh` 的 ④ E686 那一段(:139-190)。
--    那支是【人想到才跑】的手動腳本 ⇒ 本片把它的判準搬進 pg_cron, 每天自己跑一次。
--
-- 🛑🛑 為什麼【不】擴 `pcm_acl_digest()`(這一段要留著, 免得下一個人去做那件事):
--    ① 那支的 DEFACL 族只掃 `nspname IN ('storage','public') OR NULL` —— 它【碰不到 net】
--       (2026-09-08 量:該檔 `nspname = 'net'` 0 命中 · `_http_response` 0 命中 ·
--        `rolsuper|is_super` 0 命中;🟢 正對照 `nspname = 'public'` 6 命中 ⇒ 尺是活的)
--    ② 而它與 `scripts/acl-snapshot.sh` 是【一對】, 兩邊要逐位元組算出同一個 md5
--       —— 2026-09-05 才因為 POL 族的 `COALESCE` 寫法不同而分家過一次。
--    ⇒ 🎯 動它 = 同時動兩個實作 + 重驗八族對等 + 那天的 digest 會變(誤報一次)。
--    ⇒ **本片造一支獨立的, 不碰那一對。**
--
-- 🔴🔴 本片【證不到】什麼(寫在最上面, 不要讀成「net 有人看著了」):
--    · 它看的是 `anon` / `authenticated` 對 net 兩張表的【表級 + 欄級】授權, 與 postgres 的 superuser 旗標。
--    · 它【不看】那 12 格 HTTP 曝露面 —— 那是片 2(⟦0e-PROBENOSCHED⟧), 未做。
--    · 它【不看】有沒有人在 SQL Editor 手排一支不進 repo 的排程(那個受詞量不到)。
--    · 🔴 **本片只【記錄】, 不告警** —— 它把讀數寫進一張表, 而【沒有任何東西會因為那個數字叫】。
--      當場量:`grep -rl pcm_net_exposure_snapshot packages apps` ⇒ **0**(2026-09-08)
--      ⇒ 📌 **「有排程在跑」與「有人會知道」是兩件事**;後者是片 2 的事, 未做。
--    · 🔴 **`GRANT ... TO PUBLIC` 這一種它【看得到】了(2026-09-08 R1 #5 補)** —— aclexplode 對
--      PUBLIC 回 `grantee = 0`, 而 `0::regrole::text` 印 `'-'` ⇒ 原版那個 `IN ('anon','authenticated')`
--      **整族漏掉**。⇒ 有人 `GRANT SELECT ON net._http_response TO PUBLIC` ⇒ anon 真的讀得到,
--      而舊版會印 `exposure_count = 0` 加兩個 true ⇒ **一張說「今天乾淨」的表**。已修。
--    · ⚠️ **欄級那一半的校準比表級弱** —— 見下面 `calib_col` 那一格自己寫的射程。
--
-- 🔴 `postgres_is_super` 那一欄【不是搬的, 是新加的】(2026-09-08 R1 #13):
--    當場量 `grep -c 'rolsuper' scripts/check-anon-grants-prod.sh` ⇒ **0**
--    (🟢 正對照同檔 `relacl` ⇒ 10 · `aclexplode` ⇒ 2 ⇒ 尺是活的)。
--    ⇒ 它來自提案裡「格 0 那三格」的第三格, 不要讀成那支腳本量過。
--
-- 🛑 **四道 REVOKE 擋的是【直接呼叫】, 擋不住 `SET ROLE`(即使 INHERIT FALSE)** ——
--    這句從樣板 20260905140000 搬過來, **不可省**:少了它, 下一個人會把四道 REVOKE
--    讀成「已經關上」。兩道是必要基線, 不是證明(docs/patterns/revoking-function-execute-in-supabase.md §3.5)。

BEGIN;

-- ── ⓪ 前置閘:重貼時要說得出「這支貼過了」, 不是撞 42P07 說「表已存在」──────
DO $gate$
BEGIN
  IF pg_catalog.to_regclass('public.pcm_net_exposure_snapshot') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⓪:public.pcm_net_exposure_snapshot 已經在了 ⇒ 這支 migration 貼過了。'
                    '要重貼請先跑本檔尾端那段 ROLLBACK。(不要讀成「表已存在」那種原生錯誤)';
  END IF;
END $gate$;

-- ── ① 表 ────────────────────────────────────────────────────────────
CREATE TABLE public.pcm_net_exposure_snapshot (
  taken_at            timestamptz PRIMARY KEY DEFAULT now(),
  -- 🔴🔴 這三個 boolean 是本表的骨:少了它們, `exposure_count = 0` 有三種完全不同的意思。
  --    applicable = false ⇒ net 兩張表不在(沒裝 pg_net)⇒ 【不適用】, 不是【已收乾淨】
  --    calibrated = false ⇒ 表級那把尺撈不到已知的 anon 授權 ⇒ 下面的數字【不可以讀】
  --    🛑 而 calibrated 的射程【只涵蓋表級】(2026-09-08 R2 收窄):
  --       它說的是「表級那把尺撈得到已知的 anon 授權」。
  --       🔴 **欄級那一半【沒有校準】** —— `attacl` 在正常庫幾乎全 NULL, 造不出自然的正對照。
  --          ⇒ 它壞掉會安靜地印 0, 而 calibrated 不會叫。**已知缺口, 不是掃過了。**
  --    ⇒ 兩個都 true 時, exposure_count = 0 等於「表級那把尺今天沒看到東西, 而欄級那把未經校準」。
  applicable          boolean NOT NULL,
  calibrated          boolean NOT NULL,
  net_tables_present  smallint NOT NULL,
  -- 🔴 **單位 = 群組數, 不是「幾筆授權」**(2026-09-08 R2):它數的是
  --    (relation, grantee) 與 (relation, column, grantee) 的【組數】——
  --    一張表把 SELECT+UPDATE 都授給 anon 仍然只算 1。要看細目讀 details。
  --    🔴 **而分母也要講清楚**(2026-09-08 R4 N6):`tbl` / `col` 掃的是【整個 net schema
  --       的任何 relkind】—— 序列 `http_request_queue_id_seq` 也算進來(它今天就在基線裡);
  --       而 `present` / `eff` 只看那兩張【表】。⇒ 兩者分母不同, **不要相減**。
  exposure_count      integer  NOT NULL,
  -- 🔴 **刻意 nullable**(2026-09-08 R1 #7):`postgres` 這個 role 不在時(改名 / 別座庫),
  --    寫 false 等於印【不是 superuser】= 令人安心的那個方向 ⇒ 一個【量不到】被讀成【好消息】。
  --    ⇒ NULL = 「我沒找到那個 role」, 與 false =「找到了而它不是」分開。
  postgres_is_super   boolean,
  details             jsonb    NOT NULL,
  -- 🔴🔴 **當日峰值**(2026-09-08 codex R3 #3 —— 它打的是 R1#8 那個修法本身)。
  --    R1#8 要我加「每天只准一列 + upsert」, 而那個修法有一個它沒看到的代價:
  --    🛑 **午夜抓到曝露 ⇒ 早上有人撤權 ⇒ 補跑一次 ⇒ 當日那一列被零覆寫**
  --       ⇒ **那天唯一的事故證據消失, 而表上看起來一切正常。**
  --    ⇒ 📌 「每日摘要」不能兼任「唯一歷史」。peak 兩欄只增不減(同一 UTC 日內)。
  peak_exposure_count integer  NOT NULL,
  peak_details        jsonb    NOT NULL
);

COMMENT ON TABLE public.pcm_net_exposure_snapshot IS
  '⟦b9-PROBESCHED⟧ 每天一列 net 曝露面【取樣讀數】(來源 scripts/check-anon-grants-prod.sh 的 E686 那段)。'
  '🔴🔴 **這一欄要讀 delta, 不要讀絕對值** —— 正式庫的基線【不是 0】。'
  '2026-09-08 唯讀實量(pcm_readonly, 19:45 UTC):net 兩表 relacl 各含一筆 PUBLIC=arwdDxtm '
  '(平台側給的, 20260905260000 明寫我們不碰)⇒ 表級 3 組(含 http_request_queue_id_seq)'
  '+ 有效權限 4 格(anon/authenticated × 2 表 全 true)⇒ **exposure_count 基線 = 7**。'
  '⇒ 貼下去的第一列就是那個基線, 它【存在這張表裡】—— 讀法是「今天對基線差多少」。'
  '🛑 所以拿 exposure_count > 0 當告警閘會【天天叫】;片 2 要用的是對第一列的 delta。'
  '🔴 而 applicable + calibrated 都 true 也【不等於乾淨】—— 這張表不提供「乾淨」這個結論,'
  '它只提供「這三把尺在取樣的那一刻看到幾組」。三個已知缺口:'
  '① 欄級那一半【沒有校準】(attacl 幾乎全 NULL, 造不出正對照)⇒ 它壞掉會安靜地印 0;'
  '② 這是【每天一次的取樣】—— 00:01 開權 23:59 收回, 每一發都會是基線值而白天真的多曝露了;'
  '③ 只看 anon / authenticated / PUBLIC 與它們的有效權限, 其他角色不在射程裡。'
  '⚠️ tbl / col 掃的是整個 net schema 的任何 relkind(所以序列也算進來);'
  'present / eff 只看那兩張【表】—— 兩者分母不同, 不要相減。'
  'applicable = false ⇒ net 兩張表【不是兩張都在】⇒ 本列不適用。'
  'peak_exposure_count / peak_details = 當日峰值, 只增不減 —— 補跑不會洗掉當天曾看到的曝露。'
  '⚠️ 補跑落在【UTC 日】:台灣 07:30 補跑寫的是昨天那列, 今天那列 08:00 才出現。'
  '🛑 這張表只被 cron 寫, 而【讀它的人是 Sean 的 SQL Editor】—— 零 GRANT、RLS 零 policy,'
  '施工窗的唯讀角色(pcm_readonly)是否讀得到【未確認】。';

-- static-checks:no-grant-needed 這張表【刻意不給任何人】—— 只有表擁有者(postgres)與那支 cron
--   走得到。沒有任何頁面 / API 讀它;要看內容的人走 psql 或 SQL Editor。
--   ⇒ 它不是「忘了寫 GRANT」, 是「不該有 GRANT」。

-- ── ② 四道 REVOKE(不是三道)+ RLS ──────────────────────────────────
-- 🔴 具名收 service_role 的理由:少了它 `TRUNCATE` 留著, 而 **RLS 不管 TRUNCATE**。
REVOKE ALL ON TABLE public.pcm_net_exposure_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_net_exposure_snapshot FROM anon;
REVOKE ALL ON TABLE public.pcm_net_exposure_snapshot FROM authenticated;
REVOKE ALL ON TABLE public.pcm_net_exposure_snapshot FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_net_exposure_snapshot ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: public.pcm_net_exposure_snapshot -- 零 policy 是刻意的:四個應用角色四道 REVOKE 全收,
--   只有 owner(postgres)與那支 cron 走得到。沒有任何頁面 / API 讀它 ⇒ 不需要 service_role policy。

-- 🔴🔴 **每天只准一列**(2026-09-08 R1 #8;樣板 20260905140000 為同一件事被 codex 打回過)
--    `now()` 只在【同一個交易裡】不變 ⇒ 手動補跑與 cron 是兩個交易 ⇒ PK 不會撞、同一天寫多列。
--    🛑 而片 2 若「取最新兩列相比」, 那時比到的是【今天的兩次】不是【今天對昨天】⇒ 靜靜失效。
CREATE UNIQUE INDEX pcm_net_exposure_snapshot_one_per_day
  ON public.pcm_net_exposure_snapshot (((taken_at AT TIME ZONE 'UTC')::date));
COMMENT ON INDEX public.pcm_net_exposure_snapshot_one_per_day IS
  '每個 UTC 日只准一列 —— 讓「最新兩列」等於「今天對昨天」。'
  '🔴 時區釘死 UTC:跟著 session 的 TimeZone 走的話, 同一天會因為誰跑它而變成兩天。';

-- ── ③ 讀數函式(唯讀, 不寫任何東西)────────────────────────────────
CREATE FUNCTION public.pcm_net_exposure_probe()
RETURNS TABLE (
  applicable         boolean,
  calibrated         boolean,
  net_tables_present smallint,
  exposure_count     integer,
  postgres_is_super  boolean,
  details            jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH present AS (
    -- (0) 🔴 先問【表在不在】—— 表不在時下面每一格都回空, 而空會被讀成「已收乾淨」
    SELECT pg_catalog.count(*)::smallint AS n
      FROM pg_catalog.unnest(ARRAY['_http_response','http_request_queue']) t
     WHERE pg_catalog.to_regclass('net.'||t) IS NOT NULL
  ),
  tbl AS (
    -- (a) 表級:走 pg_class.relacl(pg_catalog, 不受可見性過濾)
    -- 🔴🔴 `a.grantee = 0` 就是 `GRANT ... TO PUBLIC`(2026-09-08 R1 #5)。
    --    舊版寫 `IN ('anon','authenticated')` ⇒ **整族漏掉** ——
    --    而 `0::regrole::text` 印的是 `'-'`, 不會 match 任何角色名 ⇒ 它安靜地不算。
    --    📌 anon 是 PUBLIC 的一員 ⇒ 授給 PUBLIC 就是授給 anon, 而那條路原本看不見。
    SELECT c.relname::text||' × '||
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS who,
           pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE n.nspname = 'net'
       AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon','authenticated'))
     GROUP BY c.relname, a.grantee
  ),
  col AS (
    -- (b) 欄級:走 pg_attribute.attacl 🔴 has_table_privilege 看不到這一層
    SELECT c.relname::text||'.'||at.attname::text||' × '||
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS who,
           pg_catalog.string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute at
        ON at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped,
           LATERAL pg_catalog.aclexplode(at.attacl) a
     WHERE n.nspname = 'net'
       AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon','authenticated'))
     GROUP BY c.relname, at.attname, a.grantee
  ),
  calib_rel AS (
    -- 🔴🔴 表級正對照:同一把尺(aclexplode 走 relacl)去看 public —— 那裡【本來就該有】 anon 授權。
    --    它回 0 ⇒ 尺壞了或連錯庫 ⇒ 上面那兩個 0 不可以讀成「乾淨」。
    --    📌 這一格擋的是本族最惡劣的那個病:【量不到】與【沒有東西】印同一個 0。
    SELECT pg_catalog.count(*) AS n
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace,
           LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE n.nspname = 'public'
       AND a.grantee::regrole::text IN ('anon','authenticated')
  ),
  eff AS (
    -- 🔴🔴 **有效權限**(2026-09-08 codex R3 #1 —— 兩輪 code-reviewer 都沒抓到)。
    --    上面 `tbl` / `col` 走的是【誰被具名授權】(aclexplode 的 grantee)。
    --    🛑 而權限可以【授給一個群組角色, 由 anon INHERIT 取得】——
    --       那種情況下 grantee 是那個群組, 不是 anon / authenticated / PUBLIC
    --       ⇒ 具名過濾**整族看不到**, 而 anon 真的讀得到。
    --    ✅ `has_table_privilege` 問的是【有效權限】, 它把繼承算進去 ⇒ 補得起這個洞。
    --    ⚠️ 而它【看不到欄級】(docs/patterns/revoking-function-execute-in-supabase.md §3.3)
    --       ⇒ 兩把尺各補對方的盲區, **兩把都要留, 不可以只留一把**。
    SELECT pg_catalog.count(*) AS n
      FROM pg_catalog.unnest(ARRAY['_http_response','http_request_queue']) t
      CROSS JOIN pg_catalog.unnest(ARRAY['anon','authenticated']) r
     WHERE pg_catalog.to_regclass('net.'||t) IS NOT NULL
       AND (has_table_privilege(r, 'net.'||t, 'SELECT')
         OR has_table_privilege(r, 'net.'||t, 'INSERT')
         OR has_table_privilege(r, 'net.'||t, 'UPDATE')
         OR has_table_privilege(r, 'net.'||t, 'DELETE')
         OR has_table_privilege(r, 'net.'||t, 'TRUNCATE'))
  ),
  sup AS (
    SELECT rolsuper AS is_super FROM pg_catalog.pg_roles WHERE rolname = 'postgres'
  )
  SELECT (SELECT n FROM present) = 2,
         -- 🔴🔴 **只有表級那一半有校準**(2026-09-08 R2 訂正)。
         --    R1#6 我加了一個 `calib_col`, 而 R2 在拋棄式 PG 上證明它是【假的控制組】:
         --      ① 它是 `col` 那個 CTE 的【另一份拷貝】⇒ `col` 自己的 join 寫錯, 它一格都不會叫
         --      ② 拿掉 `attnum > 0` 會讓它的數字【變大】不是變 0
         --      ③ net 表在 ⇒ 它必然 > 0 ⇒ 與 `applicable` 同義, 對真正要問的世界零判別力
         --      ④ 而它還把 ⑥d-2 變成硬失敗 ⇒ **無 net 的庫 apply 直接死(R2 實測 rc=3)**
         --    ⇒ 🛑 **拿掉它, 而【不補一個替代品】** —— `attacl` 在正常庫幾乎全 NULL,
         --       造不出讓 `aclexplode(attacl)` 回非空的自然正對照。
         --    ⇒ 📌 **所以欄級那一半【今天沒有校準】。那是【已知缺口】, 不是「掃過了」。**
         --       它壞掉會安靜地印 0, 而 `calibrated` 不會叫。要關掉這個缺口得另外造資料。
         (SELECT n FROM calib_rel) > 0,
         (SELECT n FROM present),
         -- 🔴 三把尺相加:具名表級 + 具名欄級 + 有效權限(含繼承)。
         ((SELECT pg_catalog.count(*) FROM tbl)
          + (SELECT pg_catalog.count(*) FROM col)
          + (SELECT n FROM eff))::integer,
         -- 🔴 **不 COALESCE 成 false**(2026-09-08 R1 #7):role 不在時 false 讀起來是
         --    「不是 superuser」= 令人安心的方向 ⇒ 一個【量不到】被印成【好消息】。NULL 才誠實。
         (SELECT is_super FROM sup),
         pg_catalog.jsonb_build_object(
           'table_grants',  COALESCE((SELECT pg_catalog.jsonb_object_agg(who, privs) FROM tbl), '{}'::pg_catalog.jsonb),
           'column_grants', COALESCE((SELECT pg_catalog.jsonb_object_agg(who, privs) FROM col), '{}'::pg_catalog.jsonb),
           'effective_privilege_hits', (SELECT n FROM eff),
           'calibration_rel_rows', (SELECT n FROM calib_rel),
           -- ⚠️ 這是【觀察值】不是控制組:它只說「net 的欄位走得到幾個」。
           --    R2 實測 5。它【不校準】欄級那把尺 —— 見上面那段。
           'net_columns_visited', (SELECT pg_catalog.count(*)
                                     FROM pg_catalog.pg_class c
                                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                                     JOIN pg_catalog.pg_attribute at
                                       ON at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped
                                    WHERE n.nspname = 'net'),
           'postgres_row_found', (SELECT pg_catalog.count(*) FROM sup)
         );
$fn$;

-- 🔴 兩道 REVOKE 是必要基線, 不是「已經關上」的證明(docs/patterns/revoking-function-execute-in-supabase.md §1/§3.5)
REVOKE ALL ON FUNCTION public.pcm_net_exposure_probe() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_net_exposure_probe() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_net_exposure_probe() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_net_exposure_probe() FROM service_role, payment_confirmer;

-- ── ④ 記錄函式(cron 叫的就是這一支)────────────────────────────────
CREATE FUNCTION public.pcm_net_exposure_record()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rec$
BEGIN
  -- 🔴 同一天再跑一次 = 覆蓋當天那列(taken_at 也一起更新, 讓「這列是幾點量的」是真的)。
  --    不用 DO NOTHING —— 那會讓【當天第一筆是壞的快照】被鎖死一整天、補不回來。
  INSERT INTO public.pcm_net_exposure_snapshot AS t
    (applicable, calibrated, net_tables_present, exposure_count, postgres_is_super, details,
     peak_exposure_count, peak_details)
  SELECT p.applicable, p.calibrated, p.net_tables_present, p.exposure_count,
         p.postgres_is_super, p.details, p.exposure_count, p.details
    FROM public.pcm_net_exposure_probe() p
  ON CONFLICT (((taken_at AT TIME ZONE 'UTC')::date)) DO UPDATE
     SET applicable         = EXCLUDED.applicable,
         calibrated         = EXCLUDED.calibrated,
         net_tables_present = EXCLUDED.net_tables_present,
         exposure_count     = EXCLUDED.exposure_count,
         postgres_is_super  = EXCLUDED.postgres_is_super,
         details            = EXCLUDED.details,
         taken_at           = now(),
         -- 🔴 peak 只增不減:補跑不會把當天曾經看到的曝露洗掉。
         peak_exposure_count = GREATEST(t.peak_exposure_count, EXCLUDED.exposure_count),
         peak_details        = CASE WHEN EXCLUDED.exposure_count > t.peak_exposure_count
                                    THEN EXCLUDED.details ELSE t.peak_details END;

  -- ── 心跳 ────────────────────────────────────────────────────────
  -- 🔴🔴 **為什麼一定要寫**(2026-09-08 R1 #3 —— 我原本【整段漏掉】):
  --    白名單裡有它 ⇒ `cron-heartbeat-read.ts` 走 `neverBeat` 分支 ⇒ `abnormal: true` **永久**,
  --    而 `anomaly-alert.ts` 的 `cronHeartbeatAbnormalCount` 每天 +1
  --    ⇒ 📌 **每天一封「它沒跳」的信, 而它其實每天都跑了。**
  --    🛑 樣板 20260905140000 檔內逐字警告過這一格, 而我照抄了它的形狀卻漏掉這一段。
  -- 🛑 它包在自己的 BEGIN/EXCEPTION 裡:**心跳寫不成不該讓這一輪讀數失敗**。
  --    ⚠️ 而那個 EXCEPTION **接不住失敗那一側** —— 純 SQL 跑在 pg_cron 自己的交易裡,
  --       函式拋錯 ⇒ 同交易寫的東西一起回捲 ⇒ 它【物理上寫不出失敗心跳】。
  --       ⇒ 所以 `pcm-net-exposure` 也在 `FAILURE_COUNT_MEANINGLESS` 裡:
  --          `consecutive_failures` 永遠是 0, 而那不是「零失敗」是「這一格量不到」。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-net-exposure', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[pcm_net_exposure_record] 心跳寫入失敗(本輪讀數不受影響):%', SQLERRM;
  END;
END;
$rec$;

REVOKE ALL ON FUNCTION public.pcm_net_exposure_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_net_exposure_record() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_net_exposure_record() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_net_exposure_record() FROM service_role, payment_confirmer;

-- ── ⑤ 排程 ──────────────────────────────────────────────────────────
-- 🟢 我們叫得動 cron.schedule 嗎 = 量過的(2026-09-05 唯讀實測, 20260905140000 那支記著):
--    has_schema_privilege('postgres','cron','USAGE') = t
-- 🔵 `0 0 * * *` 與既有 pcm-acl-digest 同一格;2026-09-08 唯讀量到 cron.job 9 支 active 全 t。
SELECT cron.schedule('pcm-net-exposure', '0 0 * * *', $cron$SELECT public.pcm_net_exposure_record();$cron$);

-- ── ⑥ 事後斷言 ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_relations text[] := ARRAY[
    'public.pcm_net_exposure_snapshot',
    'public.pcm_net_exposure_probe()',
    'public.pcm_net_exposure_record()'
  ]::text[];
  v_rec record;
  v_n   bigint;
  v_grants jsonb;
BEGIN
  -- ⑥b 四個應用角色 × 三個物件 = 12 格, 一律無權
  FOR v_rec IN
    SELECT o.obj, r.rol
      FROM unnest(v_relations) AS o(obj)
      CROSS JOIN unnest(ARRAY['anon','authenticated','service_role','payment_confirmer']) AS r(rol)
  LOOP
    IF v_rec.obj LIKE '%()' THEN
      IF has_function_privilege(v_rec.rol, v_rec.obj, 'EXECUTE') THEN
        RAISE EXCEPTION '斷言⑥b:% 對 % 仍有 EXECUTE', v_rec.rol, v_rec.obj;
      END IF;
    ELSE
      IF has_table_privilege(v_rec.rol, v_rec.obj, 'SELECT')
         OR has_table_privilege(v_rec.rol, v_rec.obj, 'TRUNCATE') THEN
        RAISE EXCEPTION '斷言⑥b:% 對 % 仍有 SELECT 或 TRUNCATE', v_rec.rol, v_rec.obj;
      END IF;
    END IF;
  END LOOP;

  -- ⑥c 🔴 正對照:上面那個迴圈要證得出它會紅。anon 對一張本來就開放的表【應該】有 SELECT。
  IF NOT has_table_privilege('anon', 'public.brands', 'SELECT') THEN
    RAISE EXCEPTION '斷言⑥c(正對照):anon 對 public.brands 沒有 SELECT ⇒ has_table_privilege 這把尺今天恆假, '
                    '⑥b 裡走表權限那幾格全部不算數。'
                    '⚠️ 而它也可能是【業務合法收掉了那個授權】'
                    '(20260605120000_audit_revoke_overgrant_brands_categories.sql 已經收過一次 INSERT/UPDATE)'
                    '⇒ 那種情況下請換一張仍有 anon SELECT 的對照表, 不要刪掉這一格。';
  END IF;

  -- ⑥c-2 🔴 正對照第二把(2026-09-08 R1#9 加 · R2 訂正):⑥b 有 8 格走 `has_function_privilege`,
  --     而那一把尺【原本沒有正對照】 —— 它若今天恆假, 那 8 個 NOT 全部不算數。
  --  ⛔ ~~R1 版本問 service_role 或 postgres~~ ⇒ 🔴 **R2 指出 service_role 那半是【死支】**:
  --     ⑥b 八行前才剛斷言過它【沒有】EXECUTE ⇒ 走到這裡時它可證為 false, 整格只剩 postgres 那半;
  --     而註解還寫著「挑一支【已知授給 service_role】的既有函式」—— **既不既有, 也沒授給它。**
  --  🔴 **而問死 `postgres` 也不對**:若哪天由 `supabase_admin` 貼, owner 就不是 postgres
  --     (PUBLIC 已 REVOKE)⇒ **這個正對照會自己把一個健康的 apply 打死。**
  --  ✅ 改問 `CURRENT_USER` —— 貼這支 migration 的人【就是 owner】, 它必然有 EXECUTE。
  --     ⇒ 這把尺對「誰貼」不敏感, 而它仍然證得出「has_function_privilege 今天不恆假」。
  IF NOT has_function_privilege(CURRENT_USER, 'public.pcm_net_exposure_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION '斷言⑥c-2(正對照):連 owner(%) 對自己剛建的函式都回 false ⇒ '
                    'has_function_privilege 這把尺今天恆假, ⑥b 裡走函式權限那 8 格全部不算數', CURRENT_USER;
  END IF;

  -- ⑥d 探針真的跑得起來, 而且【只回一列】
  --    🔴 結構斷言, 與環境無關 —— 回 0 列或多列都代表這支 SQL 壞了。
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_net_exposure_probe();
  IF v_n <> 1 THEN
    RAISE EXCEPTION '斷言⑥d:探針回了 % 列, 應該是 1 列', v_n;
  END IF;

  -- ⑥d-1 applicable 【刻意不設成硬斷言】—— 這一格是本檔最容易被寫錯的地方, 理由寫死:
  --    · `applicable = false` 的意思是「這個庫沒有 net 那兩張表(沒裝 pg_net)」
  --    ⛔ ~~理由:拿它當硬斷言 ⇒ `scripts/migrations-replay-from-zero.sh` 會死在這裡~~
  --    🔴 **[2026-09-08 R1 #11 訂正:那個理由【是假的】, 而它講得通]** 當場量:
  --       `grep -c cron scripts/migrations-replay-from-zero.sh` ⇒ **0**(🟢 正對照 `migration` ⇒ 27)
  --       `grep -rlE 'CREATE EXTENSION.*(pg_cron|pg_net)' supabase/migrations/` ⇒ **0 支**
  --       (🟢 正對照 `CREATE EXTENSION` 任何 ⇒ 3 支 ⇒ 尺是活的)
  --       ⇒ 🛑 **本檔下面無條件呼叫 `cron.schedule`, 從零重放【本來就會死在那一句】**
  --          ⇒ 加不加 pg_net 相依對它沒有差別。**我拿一個不成立的後果替一個對的決定辯護。**
  --    ✅ **真正的理由(而它比原本那個窄)**:`applicable = false` 講的是【這座庫的性質】,
  --       不是【這支 migration 壞了】。用 EXCEPTION 會把兩者印成同一個東西, 而那正是本表
  --       `applicable` 這一欄存在的理由 —— 值要留在表裡讓人讀, 不是讓 apply 當場死掉。
  --    🛑 而它【不是】降級成「沒關係」:它會大聲 NOTICE, 而且那個 false 【存進表裡】——
  --       那正是本表 `applicable` 這一欄存在的理由(不適用 ≠ 已收乾淨)。
  --    ⚠️ ⇒ 代價明寫:正式庫若哪天 net 兩表不見了, 本 migration 【不會紅】。
  --       要抓那一種, 看的是表裡那一欄, 不是 apply 的 rc。
  --       🔬 2026-09-08 唯讀實測正式庫:兩張表都在 · relacl 各 2 筆 ⇒ 貼的當下 applicable 應為 true。
  IF NOT EXISTS (SELECT 1 FROM public.pcm_net_exposure_probe() WHERE applicable) THEN
    -- 🔴 措辭訂正(2026-09-08 R1 #12):⛔ ~~「本列仍會寫進…」~~ —— **apply 當下一列都不寫**
    --    (`pcm_net_exposure_record()` 在本檔內從未被呼叫)⇒ 讀 NOTICE 的人會去 SELECT 然後看到空表。
    RAISE NOTICE '🔴 applicable = false ⇒ 這個庫沒有 net 那兩張表 ⇒ 本探針【不適用】, 不是【已收乾淨】。'
                 '⚠️ 本次 apply 【不寫任何一列】—— 第一列要等 00:00 那一發排程。'
                 '之後每一列的 applicable 欄都會記著這個值, 讀的人看那一欄。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pcm_net_exposure_probe() WHERE calibrated) THEN
    -- 🔴 **六個月後這一格會壞, 而壞法是【假紅】**(2026-09-08 R4 N3):
    --    `calib_rel` 綁「public 裡有 anon/authenticated 的顯式 relacl」, 而近三支 migration
    --    的方向都是【收掉 anon】(板 663 已量到 anon × public.products × SELECT = false)。
    --    ⇒ 哪天 public 收乾淨, 這一格每天 false, 而**重貼會死在這裡**。
    --    ✅ 那時候的動作【不是刪掉這一格】, 是換一個仍然為真的正對照
    --       (任何一張確定要給 anon 讀的表), 並把換的理由寫在旁邊。
    RAISE EXCEPTION '斷言⑥d-2:calibrated = false ⇒ 【表級】那把尺(aclexplode 走 relacl)'
                    '在 public 上撈不到任何 anon/authenticated 授權 ⇒ 它證不出自己會動。'
                    '⚠️ 這一格【不涉及欄級】—— 欄級那半本來就沒有校準(見檔內說明)。';
  END IF;

  -- ⑥d-3 🔴🔴 **apply 當下寫第一列**(2026-09-08 R4 F2 —— 樣板 20260905140000 有, 我漏了)。
  --     不寫的話:貼完到下一個 00:00 UTC 之間, `cron-heartbeat-read.ts` 走 `neverBeat`
  --     ⇒ 後台整天紅「從來沒寫過心跳」;若在台灣 08:00-09:00 貼(= UTC 00:00-01:00, 00:00 那發已過),
  --     `pcm-anomaly-alert 0 1 * * *` 同日就寄一封「1 支背景程式不正常」
  --     ⇒ 📌 **上線第一天一封假警報** —— 那是 R1 那條(函式不寫心跳)的殘餘半格。
  --  ✅ 而它同時是 F1 的落點:**第一列就是基線**, 讀的人有東西可以對。
  PERFORM public.pcm_net_exposure_record();
  SELECT exposure_count, details->'table_grants'
    INTO v_n, v_grants
    FROM public.pcm_net_exposure_snapshot
   ORDER BY taken_at DESC LIMIT 1;
  RAISE NOTICE '🔬 基線第一列:exposure_count = % · 表級授權 = %', v_n, v_grants;
  RAISE NOTICE '   🔴 這個數【不是 0 也不該是 0】—— 正式庫 net 兩表帶著平台側的 PUBLIC=arwdDxtm。'
               '   讀法是【對這一列的 delta】, 不是絕對值。片 2 拿 >0 當閘會天天叫。';

  -- ⑥e 排程:名字在、command 對、而且 active
  --    🔴 同名 job 若既存且 active = false, cron.schedule 只更新 schedule / command,
  --       **不會把它重新啟用** ⇒ 只看名字的話, 排程永遠不跑而斷言全綠(codex 2026-09-05 R1)。
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-net-exposure') THEN
    RAISE EXCEPTION '斷言⑥e:cron.schedule 回了值而 cron.job 裡沒有那一列';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'pcm-net-exposure' AND command LIKE '%pcm_net_exposure_record%') THEN
    RAISE EXCEPTION '斷言⑥e-2:那支排程的 command 不是在叫 pcm_net_exposure_record() ⇒ 名字對而做的事不對';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-net-exposure' AND active) THEN
    RAISE EXCEPTION '斷言⑥e-3:那支排程存在而 active = false ⇒ 它永遠不會跑';
  END IF;
END $$;
COMMIT;

-- ── ⑦ ROLLBACK(2026-09-08 R1#14 補;順序不可調)────────────────────
-- 🛑🛑 **只想改函式的人不要跑這一段**(2026-09-08 R4 N4)——
--    ⑦ 是整組 DROP【含資料表】⇒ 跑下去歷史全沒, 而那不是你要的。
--    ✅ 只修函式 ⇒ `CREATE OR REPLACE FUNCTION`,
--       🔴 **而它會把 `SET search_path` 整組洗掉** ⇒ 那一行要在新版本裡重寫一次
--       (memory `reference_create-or-replace-resets-set-clause`;body md5 一樣而設定沒了, 錨照樣印綠)。
-- 🔴 **少了 `cron.unschedule` 那一行** ⇒ 排程還在, 而它叫的函式沒了
--    ⇒ 每天 00:00 一發 `function public.pcm_net_exposure_record() does not exist`。
-- 🔴 **少了中間那兩行**(兩支函式)⇒ 留下【呼叫即失敗】的函式, 而它們的 ACL 也留著。
-- 🛑 `DROP ... RESTRICT` 過了【不等於】沒有呼叫端 —— `$$` 字串本體不進 pg_depend
--    (docs/patterns/revoking-function-execute-in-supabase.md §3)⇒ 刪之前另外 grep 一次函式名:
--       git grep -n 'pcm_net_exposure' -- supabase/ apps/ packages/ scripts/
--
-- BEGIN;
-- SELECT cron.unschedule('pcm-net-exposure');
-- DROP FUNCTION IF EXISTS public.pcm_net_exposure_record() RESTRICT;
-- DROP FUNCTION IF EXISTS public.pcm_net_exposure_probe() RESTRICT;
-- DROP INDEX IF EXISTS public.pcm_net_exposure_snapshot_one_per_day;
-- DROP TABLE IF EXISTS public.pcm_net_exposure_snapshot;
-- -- 🔴 這一行不可省(2026-09-08 R2 實測):不刪的話 sweeper_heartbeat 裡那一列【留著】,
-- --    而白名單若還在 ⇒ 它從 neverBeat 變成「2880 分沒成功」⇒ 一樣每天叫, 只是換一句話。
-- DELETE FROM public.sweeper_heartbeat WHERE job_name = 'pcm-net-exposure';
-- COMMIT;
--
-- ⚠️ 而 ROLLBACK 之後【那幾天的讀數就沒了】—— 這張表是唯一的落點
--    (`grep -rl pcm_net_exposure_snapshot packages apps` ⇒ 0, 沒有別人抄一份)。
