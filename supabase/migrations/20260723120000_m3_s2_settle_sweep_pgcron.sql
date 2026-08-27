-- 20260723120000_m3_s2_settle_sweep_pgcron.sql
-- M-3 S2:settle-sweep 對帳兜底 + anomaly-alert 雙扣告警 兩支 cron 搬 Supabase pg_cron + pg_net。
-- 全 repo **首次** pg_cron 落地(email 線 E2b 只有設計、從未實作)。plan 真權威 = docs/specs/2026-07-23-m3-s2-sweeper-pgcron-plan.md。
--
-- 鐵則 8(平台設定 + schema)+ 鐵則 12 ③DB ④平台設定 → 高風險片、四層審不降級、commit 前 codex 關卡2。
-- 決策 memory = project_m3-s2-sweeper-pgcron-decisions(Sean Q1=A flag 晚開 / Q2=A 兩支都搬 / Q3=A */2 / Q4=C Email+LINE)。
--
-- ┌── 做什麼 ──────────────────────────────────────────────────────────────────────
-- │ ① 私有 schema pcm_cron + Vault-backed SECURITY DEFINER wrapper invoke_cron_route(path)
-- │    → wrapper 執行期讀 vault.decrypted_secrets(cron_base_url + cron_secret)、組 Authorization: Bearer、
-- │      net.http_get 打對應 Next route。cron.job.command **零 secret 字面**(只呼 wrapper)。
-- │ ② cron.schedule 兩 job:pcm-settle-sweep(*/2 * * * *)、pcm-anomaly-alert(0 1 * * *),明確 active。
-- │ ③ fail-closed 自閘斷言(自帶 BEGIN;…COMMIT;;任一異常 → 整檔 ROLLBACK、DB 不半套)。
-- └────────────────────────────────────────────────────────────────────────────────
--
-- 🔴 為何**不** REVOKE net/vault/cron 三 schema(email 線 E2b 原設計、但實測**不可行**;在目前曝露設定下**亦非必要**,惟「安全」有必要條件,見下):
--   · Supabase 上 `postgres`(= db push / SQL Editor 執行身分)**非 superuser**(實測 rolsuper=false);
--     net/cron/vault 物件與其 default grant 全由 **supabase_admin(superuser)授予** → postgres **無權 REVOKE**
--     supabase_admin 的 grant(REVOKE 靜默 no-op,非 error)。故三 schema 收緊在 db push 內**物理不可行**。
--   · 因此本 migration 只做 postgres **自有物件**(pcm_cron / wrapper)的收緊 + 排程,不碰 Supabase 自有 schema。
--     連帶:**Supabase Database Webhooks 完全不受影響**(supabase_functions_admin 的 net USAGE 未被動)。
--
-- 🔴 **安全成立的必要條件**(db push 前硬核、**非本 migration 能自閘**——3a-3g 只保證 DB 物件/ACL/job 自身):
--   · net/cron/vault **必須不在** Supabase Data API 曝露 schema(預設只曝 public/graphql_public/storage)。
--     pg_net 安裝 SQL 把 net tables/sequences 授予 PUBLIC;若哪天有人把 `net` 加進曝露清單,anon 即可讀
--     net.http_request_queue.headers(Authorization 明碼)。→ 曝露 schema 清單 = S2/S4 部署前人工硬核項。
--   · anon/authenticated 對 vault **零權限**(Supabase 預設,3d 有 lock-in 斷言)。
--
-- 🔴 已知殘餘風險(不可由本 migration 修、記錄供稽核):
--   · **CRON_SECRET 三 route 共用**(settle-sweep + anomaly-alert + **email-sweep**);其中 email-sweep **無 enabled flag**
--     → 持有洩漏之 CRON_SECRET 者可觸發寄信(outbox 有列時);限流僅 per-instance best-effort(lib/cron/rate-limit.ts)。
--     ⇒ 洩漏衝擊**大於**「僅冪等 sweeper」。🔴 **建議(backlog)**:payment/anomaly/email 拆三把 secret,或 email-sweep
--     補獨立 secret + durable throttle。**偽觸發 settle/anomaly 仍不能偽造付款**(settleCharge 冪等、Record 唯一權威)。
--   · service_role 有 vault.decrypted_secrets SELECT(可讀 cron_secret);但 service_role = **NOLOGIN**——持 service-role
--     API key 者經 PostgREST(僅曝 public)**讀不到** vault,除非另有橋接 RPC;非「持 key 即可讀」。
--   · Authorization 明碼進 net.http_request_queue.headers:happy path worker 送出即刪該列;**但 queue 無硬 TTL**
--     (6h TTL 只管 net._http_response);worker 停擺/崩潰 → 該列可能無限保留。事故 SOP = 輪替 CRON_SECRET。
--   · 對策:secret 只在 server env、絕不入瀏覽器 / git / 對話;連通驗收須確認 http_request_queue 回零;worker-down 輪替。
--
-- 🔴 部署 sequencing(全 Sean 手動;見 plan §11 runbook):
--   ① route 已在 prod(已推)② Vercel 設 CRON_SECRET(≥32)③ Dashboard 啟用 pg_cron + pg_net
--   ④ SQL Editor:以 idempotent block(0 筆 create / 1 筆 update / >1 筆 RAISE、不 SELECT 解密值)存
--     cron_base_url(正式站 URL、canonical HTTPS、無尾斜線)+ cron_secret(= Vercel CRON_SECRET 同值、≥32)
--   ⑤ db push 本檔(**secret 未建 → 本檔前置閘 RAISE、拒套用**)⑥ 6h 內連通實證(見 plan §11)。
--   🔴 flag(CRON_SWEEPER_ENABLED / ANOMALY_ALERT_ENABLED)+ Resend/LINE env **不在本片、留 S4**(Q1=A)。
--   🔴 S4 開 flag 硬前置:含本 vercel.json 移除的 production deploy 已完成、Vercel Dashboard cron=0(避免雙跑)。
--
-- ✅ 已於 Supabase preview branch(pg_cron 1.6.4 / pg_net 0.20.4)實跑驗證:secret 前置閘(缺/短即 RAISE)+ migration
--   套用綠 + 兩 job(username=postgres/active)+ 端到端 wrapper→net.http_get→HTTP 200 + secret 僅短暫在 request queue(happy
--   path 送出即刪)+ 突變測試(grant anon execute → 3b RAISE / 抽掉 secret → 前置閘 RAISE)。
--   0b 的 cron_base_url origin-only regex 另以唯讀 SELECT 12 正負案例驗證(read-only、零副作用;branch 突變測的是缺 secret 路徑)。
--   ⚠️ 誠實邊界:branch pg_net 0.20.4 vs prod 0.20.0(核心物件兩版皆存在、已對照官方文件);未測真 route 連通(runbook ⑥
--      的 request_id 200 才是真連通實證,Sean 不可跳);queue_rows=0 只證 happy path、未證 worker 故障時的滯留窗。

BEGIN;

-- 0. 前置身分 + 擴充閘(fail-closed)。
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S2:migration 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'S2:pg_cron 未啟用 — 請先於 Supabase Dashboard→Database→Extensions 啟用再 db push;拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'S2:pg_net 未啟用 — 請先於 Supabase Dashboard→Database→Extensions 啟用再 db push;拒繼續';
  END IF;
END $$;

-- 0b. Vault secret 前置閘(codex 關卡2 must-fix:缺 secret 時,jobs 仍會 active 但執行期永遠失敗、且 anomaly 告警自身也死
--     → 靜默死排程。故 COMMIT 前硬驗兩 secret 存在且合法。🔴 只驗「存在/長度/前綴」,**絕不把解密值寫進任何 RAISE 訊息**)。
DO $$
DECLARE v_base text; v_token text;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'cron_base_url') <> 1
  OR (SELECT count(*) FROM vault.secrets WHERE name = 'cron_secret')   <> 1 THEN
    RAISE EXCEPTION 'S2:vault secret cron_base_url / cron_secret 須各恰一筆(請以 idempotent block 先建);拒繼續';
  END IF;
  SELECT decrypted_secret INTO v_base  FROM vault.decrypted_secrets WHERE name = 'cron_base_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  -- 嚴格 origin-only:拒 path/query/fragment/userinfo/空白/尾斜線(codex 關卡2 R2;rtrim 為第二道)。
  IF v_base IS NULL OR v_base !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' THEN
    RAISE EXCEPTION 'S2:cron_base_url 須為 https:// origin-only〔無 path/query/尾斜線,值不記錄〕;拒繼續';
  END IF;
  IF v_token IS NULL OR length(v_token) < 32 THEN
    RAISE EXCEPTION 'S2:cron_secret 缺或長度 <32(值不記錄);拒繼續';
  END IF;
END $$;

-- 1. 私有 schema(不進 PostgREST 曝露清單)+ Vault-backed SECURITY DEFINER wrapper。
CREATE SCHEMA IF NOT EXISTS pcm_cron;
REVOKE ALL ON SCHEMA pcm_cron FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pcm_cron.invoke_cron_route(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- 防 SECURITY DEFINER search_path 劫持;下方全 schema-qualify。
AS $fn$
DECLARE
  v_base  text;
  v_token text;
  v_req   bigint;
BEGIN
  SELECT decrypted_secret INTO v_base  FROM vault.decrypted_secrets WHERE name = 'cron_base_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_base IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'pcm_cron.invoke_cron_route:缺 vault secret(cron_base_url / cron_secret);拒送出';
  END IF;
  -- rtrim 去尾斜線(Fable N4:base 尾帶 / → //api → 308、pg_net 不跟 redirect → 非 200)。
  -- timeout 70s > route maxDuration 60s(避免 flag-on 時 route 尚在跑、pg_net 就記 timeout;flag-off no-op 即時回)。
  SELECT net.http_get(
    url := rtrim(v_base, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token),
    timeout_milliseconds := 70000
  ) INTO v_req;
  RETURN v_req;
END;
$fn$;

REVOKE ALL ON FUNCTION pcm_cron.invoke_cron_route(text) FROM PUBLIC, anon, authenticated, service_role;

-- 2. 排程兩 job(command 只呼 wrapper、零 secret;cron.schedule by-name upsert 冪等 + 明確 active)。
DO $$
DECLARE v_id bigint;
BEGIN
  v_id := cron.schedule('pcm-settle-sweep', '*/2 * * * *',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/settle-sweep')$job$);
  PERFORM cron.alter_job(job_id => v_id, active => true);   -- F4:by-name upsert 不改 active,顯式設 true。
  v_id := cron.schedule('pcm-anomaly-alert', '0 1 * * *',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/anomaly-alert')$job$);
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- 3. fail-closed 斷言(自閘 COMMIT;任一異常 → 整檔 ROLLBACK。僅涵蓋 DB 物件/ACL/job 自身,曝露 schema 為外部硬核項)。
DO $$
DECLARE v_role text; v_cnt int;
BEGIN
  -- 3a. wrapper:owner=postgres、SECURITY DEFINER、search_path 固定空(proconfig 實測存為 search_path="")。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND ('search_path=""' = ANY(p.proconfig) OR 'search_path=' = ANY(p.proconfig))
  ) THEN
    RAISE EXCEPTION 'S2:wrapper owner/secdef/search_path 不符;拒繼續';
  END IF;

  -- 3b. wrapper 對 API role 零 EXECUTE(has_function_privilege 有效權限)。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(v_role, 'pcm_cron.invoke_cron_route(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'S2:% 不應能執行 wrapper;拒繼續', v_role;
    END IF;
  END LOOP;

  -- 3c. wrapper proacl direct ACL allowlist:僅 owner(含 PUBLIC=oid 0 也不容)。
  SELECT count(*) INTO v_cnt
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure
     AND a.grantee <> p.proowner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S2:wrapper proacl 出現 owner 以外 grantee(含 PUBLIC)% 筆;拒繼續', v_cnt;
  END IF;

  -- 3d. anon/authenticated 對 vault 零可及(Supabase 預設鎖;lock-in 斷言、非本 migration 收緊,若哪天預設變鬆即擋)。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_schema_privilege(v_role, 'vault', 'USAGE')
    OR has_table_privilege(v_role, 'vault.decrypted_secrets', 'SELECT')
    OR has_table_privilege(v_role, 'vault.secrets', 'SELECT') THEN
      RAISE EXCEPTION 'S2:% 可及 vault secret(預設應鎖);拒繼續', v_role;
    END IF;
  END LOOP;

  -- 3e. 兩 job:username=postgres、active、database、schedule、command 呼 wrapper。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-settle-sweep' AND username='postgres' AND active
     AND database=current_database() AND schedule='*/2 * * * *'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/settle-sweep'')';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'S2:pcm-settle-sweep job 不符(實 % 筆);拒繼續', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-anomaly-alert' AND username='postgres' AND active
     AND database=current_database() AND schedule='0 1 * * *'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/anomaly-alert'')';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'S2:pcm-anomaly-alert job 不符(實 % 筆);拒繼續', v_cnt; END IF;

  -- 3f. 反面:兩 job 名下無「非 postgres」同名 job(F4 跨 role 同名防線)。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname IN ('pcm-settle-sweep','pcm-anomaly-alert') AND username <> 'postgres';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'S2:偵測到跨 role 同名 cron job % 筆;拒繼續', v_cnt; END IF;

  -- 3g. command 零 secret 相關字面(縱深:cron.job.command 對持 cron USAGE 者可讀)。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname IN ('pcm-settle-sweep','pcm-anomaly-alert')
     AND (command ILIKE '%Bearer%' OR command ILIKE '%Authorization%' OR command ILIKE '%decrypted_secret%');
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'S2:cron command 含 secret 相關字面 % 筆;拒繼續', v_cnt; END IF;
END $$;

COMMIT;

-- ═══════════════ Rollback(手動、僅供參考;本檔自帶 BEGIN;/COMMIT;,勿外包一層 BEGIN…ROLLBACK) ═══════════════
--   SELECT cron.unschedule('pcm-settle-sweep');
--   SELECT cron.unschedule('pcm-anomaly-alert');
--   DROP FUNCTION IF EXISTS pcm_cron.invoke_cron_route(text);
--   DROP SCHEMA IF EXISTS pcm_cron;
--   -- 未動 net/cron/vault 的任何 grant → 無需回補。vault 的 cron_base_url / cron_secret 由 Sean 視需要以 vault 刪除。
--
-- 零留痕驗證(rollback 後):
--   SELECT count(*) FROM cron.job WHERE jobname LIKE 'pcm-%';                 -- 預期 0
--   SELECT count(*) FROM pg_namespace WHERE nspname='pcm_cron';               -- 預期 0
