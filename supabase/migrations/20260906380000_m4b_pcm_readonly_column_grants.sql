-- ═══════════════════════════════════════════════════════════════════════════
-- ⟦貼板 51⟧ 給 `pcm_readonly` **欄級** SELECT —— 兩張表、只有必要的欄
--   派工 主視窗 `-f8` 2026-09-06 · 寫 線【身分】`-auth`
--   審查 codex R1 FAIL(8)→ codex R2 FAIL(6+3)→ **opus adversarial R3 FAIL(4+5+3)**
--        ⇒ R3 的 C4 把整個形狀換掉了(見段二), 折完不再跑 R4(R3 已換模型換角度)。
--
-- 🛑🛑 **只在 Sean 回 `Q-唯讀加兩表(改題)= 甲` 之後才貼。**
--
-- ═══ 段一 · 為什麼需要它, 而為什麼【不能】用 `GRANT SELECT ON <表>` ═══════
--
-- 🔴 **`pcm_readonly` 的 `rolbypassrls = t`(正式庫實測)** ⇒ RLS 對它不生效。
--    🔬 兩處實量:`20260905160000_m4b_pcm_readonly_role_and_grants_into_version_control.sql:28-31`
--       ·`docs/runbooks/local-admin-with-real-data-probe.md:134`
--         逐字 `pcm_readonly   rolbypassrls=t  rolcanlogin=t  rolsuper=f  rolinherit=t`
-- ⇒ 📌 **在 BYPASSRLS 之下,「給一張表」=「給那張表的【全部欄、全部列】」。**
-- ⇒ 🎯 **所以口要我們自己開窄, 不能指望 RLS 幫忙開窄。**
--
-- ⛔ ~~我上一版寫「三張表 RLS 開著而沒有 policy ⇒ GRANT 之後讀到零列」~~ —— **那句話是反的。**
--    🔴 **我怎麼弄錯的(留著, 因為修法要對著病)**:我下的是
--      `grep -rn BYPASSRLS supabase/migrations/ | head -4` ⇒ **看了 4 行就對整個母體下結論**。
--      🔬 實際 **199 行 · 53 支檔**, 其中同一行也提到 `pcm_readonly` 的 **7 行**。
--      ⇒ 📌 **`head` 剛好切掉了會推翻我的那幾行。**
--
-- ═══ 段二 · 為什麼是【欄級 GRANT】而不是兩個 definer view ════════════════
--   ⛔ ~~上一版做的是兩個 `security_invoker = false` 的窄 view~~ —— R3(opus)裁掉, 主視窗拍板改形:
--   · view 那條路要靠 **owner 當橋**(owner=postgres 讀底表 ⇒ **透過 view 讀時 RLS 從此不生效**),
--     而那座橋**會活得比這次的需求久**。
--   · 而**欄級 GRANT 是原生的**:零新物件、零 owner 橋, 也沒有
--     「`CREATE OR REPLACE VIEW` 保留舊 ACL ⇒ 簡單可更新 view 會寫回底表」那一族問題。
--   🔴 **代價明寫**(這是取捨不是免費):
--     ① **底表對 `pcm_readonly` 從此不是「零權限」** —— 它有那幾欄的 SELECT。
--        ⇒ 舊版檔頭那句「底表 0 ⇒ 它只能走 view」**在這一版不成立, 也不該成立**。
--     ② 🛑 **`has_table_privilege` 對欄級授權【少報】** —— 表級問它會回 `f`,
--        而那個 `f` **不代表它讀不到任何東西**。
--        ⇒ 📌 **所以本片的驗收一律用 `has_column_privilege` 逐欄問**, 不用表級那把尺。
--        (這一格正是 `docs/patterns/revoking-function-execute-in-supabase.md` 記過的同一個坑。)
--
-- ═══ 段三 · 露哪幾欄、刻意不露哪幾欄 ═════════════════════════════════════
--   `public.supplier_sync_runs`(建表 `20260906340000…:103-109`, 共七欄)
--     ✅ 給:`id` · `supplier_slug` · `started_at` · `completed_at` · `outcome`
--     ⛔ **不給**:`note` · `run_ref` —— **自由文字**, 誰都可以往裡面寫任何東西。
--     ⚠️ 派工單提到的「**計數欄**」在這張表上**不存在** ⇒ 📌 **我不造一個欄位來滿足描述。**
--       要「幾家卡住」那個數字 ⇒ 既有的 `get_supplier_sync_stale_counts(integer)`。
--     ⚠️ 派工單寫 `finished_at`, **真正的欄名是 `completed_at`** —— 以建表為準。
--   `public.pcm_settle_retry_attempts`(建表 `20260905220000…:47-53`)
--     ✅ 給:`order_id` · `attempts` · `last_attempt_at` · `gave_up_at`
--     ⛔ **不給**:`last_error` —— 錯誤原文(與 `pcm_incident.detail` 同一族)。
--
-- ═══ 段四 · `pcm_incident` 明文【不給】, 而且有一格回頭確認 ════════════════
--   🔬 `20260905290000_m4b_pending_refund_open_failure_incident.sql:146` 逐字:
--     `static-checks:no-grant-needed public.pcm_incident -- 本表刻意對每一個角色都隱形。`
--     `⇒ 明寫一行 GRANT 給任何角色 = 開一條本設計不要的直讀路, 而 detail 是 SQLERRM。`
--   🔬 而那個標記**有閘在管**:`scripts/migration-static-checks.sh`。
--   ⇒ 要它的健康數字 ⇒ 走既有的 definer 函式 `get_pcm_incident_health()`。
--
-- ═══ 段五 · 驗收怎麼看(🔴 **不要看 NOTICE**)═════════════════════════════
--   🔬 R3 抓到 repo 內兩處互相矛盾、而**沒有人量過** Supabase SQL Editor 會不會顯示 NOTICE;
--     而 `supabase/APPLIED.tsv` 記著 Sean 對一支以 NOTICE 收尾的檔**只回「Success. No rows returned」**。
--   ⇒ ✅ **本片最後一段是一個【會回傳列】的 `SELECT`** —— 那張表就是驗收:
--     每一欄一列, `給了嗎` 應該是 `t` 的是白名單那幾欄, `f` 的是刻意不給的那幾欄。
--   ⇒ 🛑 **看不到那張表 = 沒跑完**, 不要用「沒有紅字」當通過。
--
--   rollback:`supabase/rollbacks/20260906380000-rollback.sql`
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 前置閘(🔴 **全部前置條件都在這裡, 不放到事後**;R3 C2)─────────────────
--    📌 事後才紅 = DDL 全做完再回捲, 而訊息叫人去處理一件本片不負責的事。
DO $g0$
DECLARE
  v_missing text;
  v_kind    "char";
BEGIN
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '前置閘①:角色 pcm_readonly 不存在 ⇒ 拒繼續';
  END IF;

  -- 🔴 沒有 schema USAGE 的話, 下面每一格 `has_column_privilege` 照樣回 t, 而真的 SELECT 會 permission denied。
  IF NOT pg_catalog.has_schema_privilege('pcm_readonly', 'public', 'USAGE') THEN
    RAISE EXCEPTION '前置閘②:pcm_readonly 對 schema public 沒有 USAGE ⇒ 給了也打不開, 拒繼續';
  END IF;

  SELECT string_agg(t, ', ') INTO v_missing
  FROM (VALUES ('public.supplier_sync_runs'),
               ('public.pcm_settle_retry_attempts'),
               ('public.pcm_incident')) x(t)
  WHERE pg_catalog.to_regclass(x.t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:表不存在 ⇒ %', v_missing;
  END IF;

  FOR v_kind IN
    SELECT c.relkind FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public'
       AND c.relname IN ('supplier_sync_runs','pcm_settle_retry_attempts')
  LOOP
    IF v_kind <> 'r' THEN
      RAISE EXCEPTION '前置閘④:底表不是 ordinary table(relkind=%)⇒ 本片對它的欄位推論全部換了對象, 拒繼續', v_kind;
    END IF;
  END LOOP;

  -- 🔴 **欄位要真的在** —— `GRANT SELECT (不存在的欄)` 會報錯, 而先問一次的訊息比 PostgreSQL 的清楚。
  SELECT string_agg(format('%s.%s', x.t, x.c), ', ') INTO v_missing
  FROM (VALUES ('supplier_sync_runs','id'),('supplier_sync_runs','supplier_slug'),
               ('supplier_sync_runs','started_at'),('supplier_sync_runs','completed_at'),
               ('supplier_sync_runs','outcome'),
               ('pcm_settle_retry_attempts','order_id'),('pcm_settle_retry_attempts','attempts'),
               ('pcm_settle_retry_attempts','last_attempt_at'),('pcm_settle_retry_attempts','gave_up_at')) x(t,c)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname='public' AND cl.relname = x.t AND a.attname = x.c
       AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑤:要授權的欄不存在 ⇒ %(建表改過了?)', v_missing;
  END IF;

  -- 🔴 **前置條件, 不是事後閘**(R3 C2):底表若已經有【表級】SELECT 給 pcm_readonly,
  --    那本片的「窄」從一開始就不成立 —— 而那不是本片動的東西 ⇒ 要在動任何 DDL 之前就講。
  SELECT string_agg(t, ', ') INTO v_missing
  FROM (VALUES ('public.supplier_sync_runs'),
               ('public.pcm_settle_retry_attempts'),
               ('public.pcm_incident')) x(t)
  WHERE pg_catalog.has_table_privilege('pcm_readonly', x.t, 'SELECT');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⑥:pcm_readonly 對這些表已有【表級】SELECT ⇒ %  ⇒ 那等於全部欄都給了, 本片的窄不成立;先處理那個, 拒繼續', v_missing;
  END IF;
END $g0$;

-- ── 1. 欄級 GRANT —— 🔴 **只有這幾欄, 而且【沒有】表級 GRANT** ────────────
GRANT SELECT (id, supplier_slug, started_at, completed_at, outcome)
  ON public.supplier_sync_runs TO pcm_readonly;

GRANT SELECT (order_id, attempts, last_attempt_at, gave_up_at)
  ON public.pcm_settle_retry_attempts TO pcm_readonly;

-- ── 2. 事後閘 —— 🔴 **白名單, 不是黑名單**(R3 MF4 的教訓) ────────────────
--    📌 黑名單(「這四個名字不准出現」)有兩個洞:①日後新增的敏感欄不在名單裡 ⇒ 綠
--      ②整表/整列形式的授權繞過欄名這一維 ⇒ 綠。
--    ⇒ ✅ 改成問「**它拿得到的欄, 是不是白名單的子集**」—— 多一欄就紅, 不必預先知道那一欄叫什麼。
DO $g1$
DECLARE
  v_extra text;
  v_miss  text;
  v_inc   text;
  v_bad   integer;
BEGIN
  -- 2a 多給了嗎(白名單之外的欄, 一欄都不許)
  SELECT string_agg(format('%s.%s', c.relname, a.attname), ', ') INTO v_extra
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname='public'
     AND c.relname IN ('supplier_sync_runs','pcm_settle_retry_attempts')
     AND a.attnum > 0 AND NOT a.attisdropped
     AND pg_catalog.has_column_privilege('pcm_readonly', c.oid, a.attnum, 'SELECT')
     AND (c.relname, a.attname) NOT IN (
       ('supplier_sync_runs','id'),('supplier_sync_runs','supplier_slug'),
       ('supplier_sync_runs','started_at'),('supplier_sync_runs','completed_at'),
       ('supplier_sync_runs','outcome'),
       ('pcm_settle_retry_attempts','order_id'),('pcm_settle_retry_attempts','attempts'),
       ('pcm_settle_retry_attempts','last_attempt_at'),('pcm_settle_retry_attempts','gave_up_at'));
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '事後閘 2a:pcm_readonly 拿得到【白名單以外】的欄 ⇒ %  ⇒ 拒 COMMIT', v_extra;
  END IF;

  -- 2b 少給了嗎(白名單裡的欄, 一欄都不能漏 ⇒ 這是正對照:證明上面那個「零多餘」不是因為它什麼都沒拿到)
  SELECT string_agg(format('%s.%s', x.t, x.c), ', ') INTO v_miss
  FROM (VALUES ('supplier_sync_runs','id'),('supplier_sync_runs','supplier_slug'),
               ('supplier_sync_runs','started_at'),('supplier_sync_runs','completed_at'),
               ('supplier_sync_runs','outcome'),
               ('pcm_settle_retry_attempts','order_id'),('pcm_settle_retry_attempts','attempts'),
               ('pcm_settle_retry_attempts','last_attempt_at'),('pcm_settle_retry_attempts','gave_up_at')) x(t,c)
  WHERE NOT pg_catalog.has_column_privilege('pcm_readonly', format('public.%s', x.t)::regclass, x.c, 'SELECT');
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '事後閘 2b:白名單裡的欄沒授到 ⇒ %  ⇒ 拒 COMMIT', v_miss;
  END IF;

  -- 2c `pcm_incident` 一欄都不許(表級 + 欄級都問)
  IF pg_catalog.has_table_privilege('pcm_readonly','public.pcm_incident','SELECT') THEN
    RAISE EXCEPTION '事後閘 2c:pcm_readonly 對 pcm_incident 有表級 SELECT ⇒ 那張表刻意對每一個角色隱形, 拒 COMMIT';
  END IF;
  SELECT string_agg(a.attname, ', ') INTO v_inc
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname='public' AND c.relname='pcm_incident'
     AND a.attnum > 0 AND NOT a.attisdropped
     AND pg_catalog.has_column_privilege('pcm_readonly', c.oid, a.attnum, 'SELECT');
  IF v_inc IS NOT NULL THEN
    RAISE EXCEPTION '事後閘 2c2:pcm_readonly 對 pcm_incident 有【欄級】SELECT ⇒ %  ⇒ 拒 COMMIT', v_inc;
  END IF;

  -- 2d anon / authenticated 在這兩張表上一欄都不許(角色軸的負對照)
  SELECT count(*) INTO v_bad FROM (
    SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      CROSS JOIN (VALUES ('anon'),('authenticated')) r(nm)
     WHERE n.nspname='public'
       AND c.relname IN ('supplier_sync_runs','pcm_settle_retry_attempts')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND pg_catalog.has_column_privilege(r.nm, c.oid, a.attnum, 'SELECT')
  ) z;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '事後閘 2d:anon/authenticated 在這兩張表上還讀得到 % 個欄 ⇒ 拒 COMMIT', v_bad;
  END IF;
END $g1$;


-- ═══ 🔴 驗收:這一段【會回傳列】—— 那張表就是驗收, 不要看 NOTICE ═══════════
--   🔵 **它在 `COMMIT` 之前, 而那是刻意的**:`scripts/migration-new-file-static-checks.sh` 的第 ② 道
--     要求「結束交易那一句必須是**最後一句 SQL**」——
--     ⇒ 📌 而 `SELECT` 放在交易【裡面】一樣會把列回傳給 client, 兩個要求同時滿足。
--     ⚠️ 第一版我把它寫在 `COMMIT` 之後 ⇒ 那道閘逐字紅在
--       「命中 1 次但不是最後一句 SQL(它在第 217 行, 而最後一句 SQL 在第 233 行)」。
--   期望:`給了嗎` 這一欄, 白名單那 9 欄是 `t`, 而 `note` / `run_ref` / `last_error` 是 `f`。
--   🛑 **看不到這張表 = 沒跑完。**
SELECT c.relname                                                        AS 表,
       a.attname                                                        AS 欄,
       pg_catalog.has_column_privilege('pcm_readonly', c.oid, a.attnum, 'SELECT') AS 給了嗎,
       CASE WHEN a.attname IN ('note','run_ref','last_error')
            THEN '⛔ 刻意不給' ELSE '✅ 白名單' END                       AS 這一欄的意圖
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname = 'public'
   AND c.relname IN ('supplier_sync_runs','pcm_settle_retry_attempts')
   AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY c.relname, a.attnum;

COMMIT;
