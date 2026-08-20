-- 20260820060000_m4a_e2a2_order_ineligible_gate_pgcron.sql
-- M-4a E2a-2(W3-G 拆出):把 /api/cron/order-ineligible-gate 排進 pg_cron。
--
-- ┌── 這一支解決的是什麼 ────────────────────────────────────────────────────────
-- │ applyOrderIneligibleGate use-case 與 route 都已寫好且已 commit(f2194800),
-- │ 而**沒有任何東西呼叫那支 route** ⇒ 這道「寄送前擋已取消/已退款訂單」的閘目前是零效果。
-- │ route 檔頭自己寫著:「本片【縮小】了寄出不合格信的窗口,沒有【關閉】它」——
-- │ 而在本檔 apply 之前,連「縮小」都沒發生,窗口是【全開】的。
-- └──────────────────────────────────────────────────────────────────────────────
--
-- ⛔⛔ **本檔不與 MAIN-APPLY-CHECKLIST-20260820.md 那批 migration 一起套。**
--   它排在【route 部署到線上、可被外部呼叫到之後】——先排程而 route 沒上線,
--   會變成每 N 分鐘打一發 404(op5:36-46 的既有教訓:那個窗口要用結構關掉,不是靠 apply 順序)。
--   本檔自己也擋不住那個錯誤(它不驗證 route 是否真的部署了)⇒ 它必須被人當成最後一步、
--   獨立於 migration 批次之外執行。清單裡的「套完+推上去之後」那一節,本檔就是那一節的第一項。
--
-- 🔴 本檔【只排程】,不建任何物件。wrapper `pcm_cron.invoke_cron_route(text)`、
--   私有 schema `pcm_cron`、vault secret 都由 `20260723120000_m3_s2_settle_sweep_pgcron.sql`
--   建立且已 apply(`grep -c 20260723120000 supabase/APPLIED.tsv` ⇒ 1)。
--   本檔對它們只做斷言,不 `CREATE OR REPLACE`——理由同 email-sweep 那支:
--   重建一個別人擁有的 SECURITY DEFINER 函式,是在別人的安全邊界上動手。
--
-- ══ 🔴 頻率:*/2,不是照抄 email-sweep 的 */5 ══
--   這支存在的唯一理由是縮小 race:「gate 掃到某列該擋 → claim 之前,sweepEmailOutbox 的
--   claimDue 已搶先認領那一列」(packages/use-cases/src/apply-order-ineligible-gate.ts 檔頭)。
--   ⇒ gate 跑得比 sweep(*/5)更頻繁,能在更多輪次裡搶先拿到候選、降低被搶輸的機率。
--   ⇒ 取 */2(與 settle-sweep 同頻率,repo 內已有先例值,不是新發明的數字)。
--   🔴🔴 **而這不關閉那個 race,只縮小它**——即使兩者同頻率甚至 gate 更頻繁,單一輪次內
--   claimDue 與 claimById 仍可能同時對同一列競爭,先後順序不受頻率保證。真正關閉需要把
--   合格性檢查放進 sweep-email-outbox.ts 本身(待 Sean 拍板,見 route.ts 檔頭)。
--
-- ══ 🔴🔴 上線順序(承重;三段,鏡像 email-sweep pgcron 那支的既有形狀)══
--   **第一段 · 確認 route 已部署且可達**:本檔 apply 前,先確認
--   `apps/storefront/src/app/api/cron/order-ineligible-gate/route.ts` 已經在正式站上線
--   (不是本檔的職責,是人工前置條件)。
--   **第二段 · apply 本檔**:排程開始生效,第一輪最多等 2 分鐘就會打第一發。
--   **第三段 · 驗鏈路**:apply 後查
--     `select status_code, count(*) from net._http_response where created > now() - interval '10 minutes' group by 1;`
--   預期至少一筆 `200`(route 本身零 env 依賴、composition 不 requireEnv 任何值,理論上不會 503;
--   若看到 401,代表 vault 的 cron_secret 與 Vercel 的 CRON_SECRET 不一致,那件事本檔證不到,
--   同 email-sweep pgcron 那支檔頭列的「本檔證不到的三件」①)。
--
-- ══ 誠實界線(鏡像 email-sweep pgcron)══
--   · 本檔未在任何資料庫上實跑過(本窗無正式庫存取、未起拋棄式 PG)⇒ 斷言區的行為未確認。
--   · 未做端到端連通實證——那要 apply 之後才做得到。
--   · vault 的 cron_secret 是否等於 Vercel 的 CRON_SECRET、route 是否真的已部署,本檔皆證不到,
--     驗收要看 apply 後 net._http_response 是不是真的出現 200(方法見上方第三段)。
--   · 2c 的跨 role 同名 job 檢查仰賴 postgres 的 rolbypassrls,而該屬性 repo 內未查證
--     (`20260817070000:98/:336` 逐字記著)——本格降級為「看得到的範圍內沒有」,不是「不存在」。
--
-- 🔴 **不 apply。** 鑰匙在 Sean 手上(本窗不 apply、不 push;而且本檔本來就不該與其他批次一起套,見上方⛔)。
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 0. 前置身分 + 擴充閘(fail-closed;形狀沿用 20260723120000 / 20260819160000)。
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'E2a-2 gate:migration 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'E2a-2 gate:pg_cron 未啟用;拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'E2a-2 gate:pg_net 未啟用;拒繼續';
  END IF;
END $$;

-- 0b. wrapper 前置閘:本檔不建立 wrapper,而它必須已存在且安全屬性未被削弱。
DO $$
DECLARE v_role text; v_cnt int; v_src text;
BEGIN
  IF to_regprocedure('pcm_cron.invoke_cron_route(text)') IS NULL THEN
    RAISE EXCEPTION 'E2a-2 gate:wrapper pcm_cron.invoke_cron_route(text) 不存在 — 請先 apply 20260723120000;拒繼續';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND ('search_path=""' = ANY(p.proconfig) OR 'search_path=' = ANY(p.proconfig))
  ) THEN
    RAISE EXCEPTION 'E2a-2 gate:wrapper owner/secdef/search_path 不符;拒繼續';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure;
  IF v_src IS NULL
     OR position('vault.decrypted_secrets' in v_src) = 0
     OR position('cron_base_url'           in v_src) = 0
     OR position('cron_secret'             in v_src) = 0
     OR position('net.http_get'            in v_src) = 0 THEN
    RAISE EXCEPTION 'E2a-2 gate:wrapper body 與預期不符(缺 vault/net.http_get 字面);拒繼續';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(v_role, 'pcm_cron.invoke_cron_route(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'E2a-2 gate:% 不應能執行 wrapper;拒繼續', v_role;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure
     AND a.grantee <> p.proowner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'E2a-2 gate:wrapper proacl 出現 owner 以外 grantee % 筆;拒繼續', v_cnt;
  END IF;
END $$;

-- 0c. Vault secret 前置閘(wrapper 靠它取 base_url / secret;缺了 job 會 active 但永遠失敗 = 靜默死排程)。
DO $$
DECLARE v_base text; v_token text;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'cron_base_url') <> 1
  OR (SELECT count(*) FROM vault.secrets WHERE name = 'cron_secret')   <> 1 THEN
    RAISE EXCEPTION 'E2a-2 gate:vault secret cron_base_url / cron_secret 須各恰一筆;拒繼續';
  END IF;
  SELECT decrypted_secret INTO v_base  FROM vault.decrypted_secrets WHERE name = 'cron_base_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_base IS NULL OR v_base !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' THEN
    RAISE EXCEPTION 'E2a-2 gate:cron_base_url 須為 https:// origin-only(值不記錄);拒繼續';
  END IF;
  IF v_token IS NULL OR length(v_token) < 32 THEN
    RAISE EXCEPTION 'E2a-2 gate:cron_secret 缺或長度 <32(值不記錄);拒繼續';
  END IF;
END $$;

-- 1a. 快照【所有既有 job】(不是寫死名單——鏡像 email-sweep pgcron 修過的教訓:
--     一份寫死的白名單,正確性取決於有沒有人記得維護它;改成「除了我要加的那一支,其餘全部快照」
--     ⇒ 不需要任何人維護,新增 job 自動納入保護,含 pcm-email-sweep / pcm-settle-sweep /
--     pcm-anomaly-alert(若已排)/ pcm-expire-unpaid-orders 等任何現存 job)。
CREATE TEMP TABLE _e2a2_jobs_before ON COMMIT DROP AS
SELECT jobid, jobname, schedule, command, database, username, active, nodename, nodeport
  FROM cron.job
 WHERE jobname <> 'pcm-order-ineligible-gate';

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM _e2a2_jobs_before;
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'E2a-2 gate:套用前 cron.job 一支既有 job 都沒有 ⇒ 下面的 before/after 比對沒有對象、結論不成立;拒繼續';
  END IF;
  RAISE NOTICE 'E2a-2 gate:已快照 % 支既有 cron job(全部納入 2e 的逐欄比對保護)', v_cnt;
END $$;

-- 1b. 排程單一 job(command 只呼 wrapper、零 secret;by-name upsert 冪等 + 顯式 active)。
--     頻率 */2:理由見檔頭「頻率」段——比 sweep(*/5)更頻繁,降低被搶輸的機率,不是關閉 race。
DO $$
DECLARE v_id bigint;
BEGIN
  v_id := cron.schedule('pcm-order-ineligible-gate', '*/2 * * * *',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/order-ineligible-gate')$job$);
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- 2. fail-closed 斷言(自閘 COMMIT;任一異常 → 整檔 ROLLBACK、DB 不半套)。
DO $$
DECLARE v_cnt int;
BEGIN
  -- 2a. job 本身:名稱/擁有者/active/資料庫/週期/command 逐格。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-order-ineligible-gate' AND username='postgres' AND active
     AND database=current_database() AND schedule='*/2 * * * *'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/order-ineligible-gate'')';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'E2a-2 gate:pcm-order-ineligible-gate job 不符(實 % 筆);拒繼續', v_cnt; END IF;

  -- 2b. nodename/nodeport 與現行運作中的 pcm-settle-sweep 一致(理由與不寫死值的原因,
  --     逐字鏡像 email-sweep pgcron 那支的既有立場,不重寫第二份)。
  IF NOT EXISTS (
    SELECT 1
      FROM cron.job e
      JOIN cron.job r ON r.jobname = 'pcm-settle-sweep'
     WHERE e.jobname = 'pcm-order-ineligible-gate'
       AND e.nodename IS NOT DISTINCT FROM r.nodename
       AND e.nodeport IS NOT DISTINCT FROM r.nodeport
  ) THEN
    RAISE EXCEPTION 'E2a-2 gate:pcm-order-ineligible-gate 的 nodename/nodeport 與現行運作中的 pcm-settle-sweep 不一致 ⇒ 可能靜默不執行;拒繼續';
  END IF;

  -- 2c. 反面:同名 job 沒有掛在別的 role 底下(跨 role 同名防線;射程限定同 email-sweep pgcron 檔頭)。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-order-ineligible-gate' AND username <> 'postgres';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'E2a-2 gate:偵測到跨 role 同名 cron job % 筆;拒繼續', v_cnt; END IF;

  -- 2d. command 零 secret 相關字面(縱深:cron.job.command 對持 cron USAGE 者可讀)。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-order-ineligible-gate'
     AND (command ILIKE '%Bearer%' OR command ILIKE '%Authorization%' OR command ILIKE '%decrypted_secret%');
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'E2a-2 gate:cron command 含 secret 相關字面 % 筆;拒繼續', v_cnt; END IF;

  -- 2e. 既有 job 逐欄 before/after 全等(不是只數筆數)。
  SELECT count(*) INTO v_cnt
    FROM _e2a2_jobs_before b
    FULL OUTER JOIN (
      SELECT jobname, schedule, command, database, username, active, nodename, nodeport
        FROM cron.job WHERE jobname <> 'pcm-order-ineligible-gate'
    ) a ON a.jobname = b.jobname
   WHERE (a.jobname, a.schedule, a.command, a.database, a.username, a.active, a.nodename, a.nodeport)
         IS DISTINCT FROM
         (b.jobname, b.schedule, b.command, b.database, b.username, b.active, b.nodename, b.nodeport);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'E2a-2 gate:既有 job 在本次套用前後不一致 % 筆;拒繼續', v_cnt;
  END IF;
END $$;

COMMIT;
