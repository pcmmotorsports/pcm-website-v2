# M-3 S2:settle-sweep 搬 Supabase pg_cron + anomaly-alert 一併搬 — 實作計畫

> 2026-07-23 建立。上位線 plan = `docs/specs/2026-07-23-m3-tappay-production-settle-line-plan.md` §5 S2;決策 memory = `project_m3-s2-sweeper-pgcron-decisions`。
> **片型 = 高風險片**(鐵則 8:動 migration + vercel.json;鐵則 12 ③DB 結構 ④平台設定)→ 四層審不降級 + codex 金流/安全背書 + DB 交易性自閘。
> **狀態:✅ 已實作 + Supabase preview branch 實跑驗證(見 §11);codex 關卡1 / code-reviewer / Fable 過,codex 關卡2 R1 FAIL findings 折入後待 R2 覆核。碰 DB/flag/env 一律停下交 Sean 手動。**

---

## 0. 一句話

把「對帳兜底掃描(settle-sweep)」與「雙扣告警(anomaly-alert)」兩支 cron 從 Vercel 每日排程,搬到 **Supabase pg_cron + pg_net**;settle-sweep 改 **每 2 分鐘**、anomaly-alert 維持每日;`vercel.json` 兩支都移除。**flag 不在本片翻開**(留 S4)。

## 1. Sean 2026-07-23 四拍板(鎖定;全文 memory `project_m3-s2-sweeper-pgcron-decisions`)

- **Q1=A**:S2 只建基礎設施 + 用「flag 關著回 200 no-op」驗連通;`CRON_SWEEPER_ENABLED`/`ANOMALY_ALERT_ENABLED` 翻開留 **S4**。
- **Q2=A**:兩支都搬 pg_cron、`vercel.json` crons 兩支都移除。
- **Q3=A**:settle-sweep `*/2 * * * *`。
- **Q4=C**:anomaly-alert 告警 Email(Resend)+ LINE 都發。

anomaly-alert 頻率:**維持每日**(cadence 不變、只換排程器;`0 1 * * *` UTC,同現況)。🔴 **頻率變更須另審**(告警無去重,加頻=放大 Email/LINE 轟炸;codex F14 糾正「Sean 可事後調」)。

## 2. 鐵則 8 四要素

- **改什麼**:①新 migration `20260723120000_m3_s2_settle_sweep_pgcron.sql`(vault secret 前置閘 + Vault-backed SECURITY DEFINER wrapper + `cron.schedule` 兩 job + fail-closed DO 斷言〔僅 postgres 自有物件〕+ 註解 rollback 段;🔴 **不 REVOKE net/cron/vault**——見 §11 為何實測不可行且不必要)②`vercel.json` 移除兩支 cron。**零 TS 變更**(兩 route 已 pg_net-ready)。
- **為什麼**:黑洞漏 webhook 時,現況每日一次兜底最久卡一天;Q4=A 改分鐘級。Vercel Hobby 禁商業用途排程(合規)→ 搬 Supabase。
- **預期影響面**:平台排程(vercel.json)+ DB(新 pg_cron job / pg_net 呼叫 / `pcm_cron` 私有 schema + wrapper;net/cron/vault 的 grant **不動**,見 §11)。**刷卡/對帳核心邏輯零改**(重用 `sweepSettlements`/anomaly use-case 與兩 route)。
- **Rollback**:①`CRON_SWEEPER_ENABLED`/`ANOMALY_ALERT_ENABLED` 本就 false → 即使 pg_cron 已打,route 回 200 no-op、零副作用 ②`cron.unschedule('pcm-settle-sweep'/'pcm-anomaly-alert')` + `drop function` + `drop schema pcm_cron` 即完全撤除 ③vercel.json 還原一行 ④訂單一律只標記不刪 → 零資料破壞。

## 3. 架構事實(偵察 + MCP 查證,2026-07-23)

- **route 零改**:`settle-sweep/route.ts` 與 `anomaly-alert/route.ts` 皆 **GET** + `CRON_SECRET` Bearer + `timingSafeEqual` + `*_ENABLED` 嚴格認 `'true'` 閘 + 限流 + `maxDuration=60`;鑑權**不依賴 Vercel header**(`x-vercel-cron` 全 repo 零命中)→ pg_net 帶對 Bearer 即過。
- **CRON_SECRET 三 route 共用同一把**(`apps/storefront/src/lib/cron/rate-limit.ts:3`)。
- **無現成 pg_cron 可抄**:email 線 E2b 只有設計原則(§4.2/§5)、無實際 SQL、從未 apply → S2 全 repo **首次** pg_cron 落地。
- **擴充狀態(正式站 `bmpnplmnldofgaohnaok`)**:`pg_cron` 1.6.4 / `pg_net` 0.20.0 **皆未安裝**;`supabase_vault` 0.3.1 已啟用。
- **anomaly-alert 管道**:`getAnomalyAlertDeps()`(`apps/storefront/src/lib/payment/composition.ts:221-252`)依主密鑰存在性組管道;enabled 但零管道 → throw fail-closed → route 503。Q4=C 需 Resend(`RESEND_API_KEY`/`ALERT_EMAIL_FROM`/`ALERT_EMAIL_TO`)+ LINE(`LINE_CHANNEL_ACCESS_TOKEN`/`LINE_ALERT_TO`)兩組 env。
- **settle-sweep 單輪最壞 ~50s < maxDuration 60s**;`*/2` = 120s 間隔 → 不重疊。
- 連動 backlog **#282**:`cron.job_run_details` 清理(保留 > dead-man 窗)——pg_cron 上線後才有對象,本片不做、記入交接。

## 4. 安全設計硬規(email plan §4.2/§5,S2 首次落地)⚠️ 本節第 2 點「REVOKE 三 schema」經 branch 實測**不可行**(postgres 非 superuser)、已由 §11 取代,保留供追溯

1. **密鑰零內插**:`cron.job.command` 絕不含 secret 字面 → 只呼 `pcm_cron.invoke_cron_route(path)` wrapper;wrapper `SECURITY DEFINER`(owner=postgres)執行期讀 `vault.decrypted_secrets`。
2. **REVOKE 三 schema**:`net`/`vault`/`cron` 對 PUBLIC/anon/authenticated/service_role 收 USAGE + 表/函式/序列權限;fail-closed DO 斷言(`has_schema_privilege`/`has_table_privilege` + aclexplode allowlist)。
3. **response 零回顯**:`net._http_response`/`net.http_request_queue` 對非 owner 零權限(存明碼、只留 6h;route response 本就 counts-only 零 PII 為第二道)。
4. **連通實證 6h 內**:`net._http_response` 只留 6h → Sean db push 後 6h 內驗 `cron.job_run_details` 成功 + net._http_response 200。
5. **`search_path=''`**:wrapper 全 schema-qualify,防 SECURITY DEFINER search_path 劫持。

## 11. 🔴 Branch dry-run 定案(2026-07-23,supersedes §4 三-schema REVOKE 與 §5 草案的 REVOKE 段)

在 Supabase preview branch(`feumwnmahtfyurdplyjk`、pg_cron 1.6.4 / pg_net 0.20.4)實跑後,**設計重大更正**:

- 🔴 **postgres 非 superuser**(實測 `rolsuper=false`);net/cron/vault 物件與 default grant 全由 **supabase_admin(superuser)授予** → **db push(以 postgres 身分)無權 REVOKE**(靜默 no-op,fail-closed 斷言即抓到)→ **email 線 E2b「REVOKE 三 schema」在 db push 內物理不可行**。
- 🔴 **在目前曝露設定下非必要,但「安全」有必要條件**(codex 關卡2):net/cron/vault **必須不在** PostgREST 曝露 schema(Supabase 預設只曝 public/graphql_public/storage)→ anon 經 Data API 打不到明碼表。🔴 但 pg_net 安裝 SQL 把 net tables 授予 PUBLIC,**若哪天有人把 `net` 加進曝露清單,anon 即可讀 Authorization 明碼** → 故「曝露 schema 清單不含 net/cron/vault」= **db push 前人工硬核項、非本 migration 能自閘**。anon/authenticated 對 vault 本就零權限(實測、3d lock-in 斷言)。
- ✅ **最終設計** = 只做 postgres 自有物件(pcm_cron schema + wrapper)+ 排程 + 對「postgres 可控 / Supabase 預設事實」的 fail-closed 斷言;**不碰 net/cron/vault 任何 grant**。
- ✅ **Q_B 自動解除**:因完全不動 net/cron/vault → `supabase_functions_admin` 的 net USAGE 未被觸及 → **Supabase Database Webhooks 100% 不受影響、無需停用**。
- 🔴 **殘餘風險(不可由 migration 修、已記入 migration 頭註;codex 關卡2 更正)**:①**CRON_SECRET 三 route 共用**(settle-sweep + anomaly-alert + **email-sweep**;email-sweep 無 enabled flag → 洩漏可觸發寄信);限流僅 per-instance best-effort → 洩漏衝擊**大於**「僅冪等 sweeper」。**建議(backlog #294)拆三把 secret**。②service_role 可讀 vault(cron_secret),但 service_role=**NOLOGIN**、持 service-role API key 經 PostgREST(僅曝 public)讀不到 vault、除非橋接 RPC(非「持 key 即可」)。③Authorization 明碼進 net.http_request_queue.headers,**queue 無硬 TTL**(6h 只管 response),worker 崩潰可能滯留 → 事故 SOP 輪替 CRON_SECRET。🔴 **偽觸發 settle/anomaly 仍不能偽造付款**(settleCharge 冪等、Record 唯一權威)。

### Branch 實測證據(兩次 branch;pg_cron 1.6.4 / pg_net 0.20.4)
1. migration 套用綠(BEGIN…COMMIT 自閘)、兩 job 建立(username=postgres/active/schedule 正確)。
2. **端到端連通**:建測試 vault secret → `pcm_cron.invoke_cron_route('/')` → `net._http_response` **status 200**;`queue_rows=0`、response headers 無 Authorization(secret 僅短暫在 request queue、happy path 送出即刪,證 codex F8)。
3. **突變測試**:`grant execute on wrapper to anon` → 斷言 3b **RAISE**;`delete cron_secret` → **0b 前置閘 RAISE**(證 codex 關卡2 缺 secret 靜默綠燈的 gap 已補、非假綠)。
4. wrapper `proconfig` 實測 = `search_path=""`(斷言已對齊)。
5. **R2 re-verify(第二 branch)**:折入 codex 關卡2 的 0b vault 前置閘 + wrapper `rtrim` 後,重跑「先建 secret → 套用綠 → 缺 secret 突變 RAISE」全綠。
- ⚠️ **誠實邊界**:branch pg_net 0.20.4 vs prod 0.20.0(核心物件兩版皆存在、對照官方文件);`queue_rows=0` 只證 happy path、**未證** worker 故障時滯留窗;未測真 route 連通(runbook ⑥ request_id 200 才是真連通、Sean 不可跳)。

### 最終交付(取代 §5/§6 草案)
- migration 檔:`supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql`(已寫、含完整頭註 + rollback 段)。
- `vercel.json`:移除 settle-sweep + anomaly-alert 兩 crons(已改)。
- **🔴 Sean runbook(權威、取代 §8;全 Sean 手動)**:
  1. **Vercel** 設 `CRON_SECRET`(≥32 字元)。
  2. **Supabase Dashboard → Database → Extensions** 啟用 `pg_cron` + `pg_net`。
  3. **Supabase SQL Editor** 以 idempotent block 存兩 secret(0 筆→create / 1 筆→update / >1 筆→RAISE;**不 SELECT 解密值**;`cron_base_url` = 正式站 canonical HTTPS origin **無尾斜線**、`cron_secret` = 與 Vercel `CRON_SECRET` **同值**):
     ```sql
     DO $$
     DECLARE v_id uuid; v_name text; v_val text;
     BEGIN
       FOREACH v_name IN ARRAY ARRAY['cron_base_url','cron_secret'] LOOP
         v_val := CASE v_name WHEN 'cron_base_url' THEN 'https://正式站網域' ELSE '與Vercel_CRON_SECRET同值' END;
         IF (SELECT count(*) FROM vault.secrets WHERE name=v_name) > 1 THEN
           RAISE EXCEPTION '% 有多筆、請先清理', v_name; END IF;
         SELECT id INTO v_id FROM vault.secrets WHERE name=v_name;
         IF v_id IS NULL THEN PERFORM vault.create_secret(v_val, v_name);
         ELSE PERFORM vault.update_secret(v_id, v_val); END IF;
       END LOOP;
     END $$;
     ```
  4. **確認 Data API 曝露 schema 不含 net/cron/vault**(Dashboard → API Settings;預設如此,但為必要條件人工硬核)。
  5. **db push** 本 migration。🔴 **若 secret 未建/不合格 → migration 0b 前置閘 RAISE、整檔拒套用**(fail-closed、不會靜默綠燈)。
  6. **6h 內連通實證**(net._http_response 只留 6h):手動 `select pcm_cron.invoke_cron_route('/api/cron/settle-sweep')` 取 request_id → 以該 id 查 `net._http_response`(**200** + body `{enabled:false,skipped:'sweeper_disabled'}` = flag-off 連通正確)+ `cron.job_run_details` 有成功列 + 🔴 **`select count(*) from net.http_request_queue` 應回 0**(worker 正常清列、Authorization 未滯留)。
  7. **確認含本 vercel.json 移除的 production deploy 已完成、Vercel Dashboard crons=0**(Vercel 要移除設定後重新 prod deploy 才刪 cron)——此為 **S4 開 flag 的硬前置**(避免與 pg_cron 雙跑重複發 Email/LINE)。
  - 🔴 flag(`CRON_SWEEPER_ENABLED` / `ANOMALY_ALERT_ENABLED`)+ Resend/LINE env **留 S4**;S4 開 flag 前須逐項硬驗 5 個 Email/LINE env(否則 Q4=C 可能只送一管道)。
- **S4 前置(codex F14,數字已更正)**:`cron.job_run_details` settle-sweep `*/2` = **720 筆/日**(+anomaly ≈721;≈**21,600 筆/月**)、#282 100k 約 **4.6 月**撞頂 → 保留/清理 job 列為 **S4 前置**(非只 backlog);anomaly 排程器自身死亡偵測 = 另設不同故障域 heartbeat(追蹤項)。

## 5. Migration 草案（⚠️ 已被 §11 取代;REVOKE 三 schema 段經 branch 實測不可行、下段保留供審查追溯）

檔:`supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql`(自帶 `BEGIN;…COMMIT;`,不外包 txn)

```sql
BEGIN;

-- 0. 前置閘:pg_cron / pg_net 必須已由 Sean 於 Dashboard→Database→Extensions 啟用。
--    (不在 migration 內 create extension:Supabase 擴充啟用有其託管機制、且避免 txn 內 create extension 的邊角。)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron 未啟用 — 請先於 Supabase Dashboard 啟用 pg_cron 再 db push;拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net 未啟用 — 請先於 Supabase Dashboard 啟用 pg_net 再 db push;拒繼續';
  END IF;
END $$;

-- 1. 私有 schema(不進 PostgREST 曝露清單;對 API 角色零 USAGE)。
CREATE SCHEMA IF NOT EXISTS pcm_cron;
REVOKE ALL ON SCHEMA pcm_cron FROM PUBLIC, anon, authenticated, service_role;

-- 2. Vault-backed SECURITY DEFINER wrapper:讀 base_url + token → net.http_get 帶 Bearer。
--    命令端零 secret 字面;path 由排程傳入(非機密)。
CREATE OR REPLACE FUNCTION pcm_cron.invoke_cron_route(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base  text;
  v_token text;
  v_req   bigint;
BEGIN
  SELECT decrypted_secret INTO v_base  FROM vault.decrypted_secrets WHERE name = 'cron_base_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_base IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'pcm_cron.invoke_cron_route:缺 vault secret(cron_base_url / cron_secret)';
  END IF;
  SELECT net.http_get(
    url := v_base || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token),
    timeout_milliseconds := 15000
  ) INTO v_req;
  RETURN v_req;
END;
$$;

REVOKE ALL ON FUNCTION pcm_cron.invoke_cron_route(text) FROM PUBLIC, anon, authenticated, service_role;
-- 僅 owner(postgres)可執行;cron job 以 postgres 身分跑 → 免額外 GRANT。

-- 3. REVOKE 三 schema(net / vault / cron)對 API 角色 + PUBLIC。
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['net','vault','cron'] LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', s);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', s);
    EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM PUBLIC, anon, authenticated, service_role', s);
  END LOOP;
END $$;

-- 4. 排程兩 job(command 只呼 wrapper、零 secret;by-name upsert 冪等)。
SELECT cron.schedule('pcm-settle-sweep', '*/2 * * * *',
  $job$SELECT pcm_cron.invoke_cron_route('/api/cron/settle-sweep')$job$);
SELECT cron.schedule('pcm-anomaly-alert', '0 1 * * *',
  $job$SELECT pcm_cron.invoke_cron_route('/api/cron/anomaly-alert')$job$);

-- 5. Fail-closed 斷言(自閘 COMMIT;任一異常 → 整檔 ROLLBACK、DB 不半套)。
DO $$
DECLARE v_role text; v_cnt int; v_cmd text;
BEGIN
  -- 5a. 三 schema 對 anon/authenticated 零 USAGE。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_schema_privilege(v_role, 'net',   'USAGE')
    OR has_schema_privilege(v_role, 'vault', 'USAGE')
    OR has_schema_privilege(v_role, 'cron',  'USAGE') THEN
      RAISE EXCEPTION 'S2 ACL 異常 — 角色 % 仍有 net/vault/cron USAGE;拒繼續', v_role;
    END IF;
  END LOOP;

  -- 5b. response 表對 anon/authenticated 零 SELECT(存明碼、只留 6h)。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(v_role, 'net._http_response', 'SELECT')
    OR has_table_privilege(v_role, 'net.http_request_queue', 'SELECT') THEN
      RAISE EXCEPTION 'S2 ACL 異常 — 角色 % 仍可讀 net response(含 Authorization/明碼);拒繼續', v_role;
    END IF;
  END LOOP;

  -- 5c. cron.job.command 零 secret 字面(不含 Bearer / Authorization / token 值)。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname IN ('pcm-settle-sweep','pcm-anomaly-alert')
     AND (command ILIKE '%Bearer%' OR command ILIKE '%Authorization%');
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'S2 安全異常 — cron.job.command 含 secret 相關字面(% 筆);拒繼續', v_cnt;
  END IF;

  -- 5d. 兩 job 確實建立、schedule 正確。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname = 'pcm-settle-sweep' AND schedule = '*/2 * * * *';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'S2 異常 — pcm-settle-sweep job 未如預期(實 % 筆);拒繼續', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname = 'pcm-anomaly-alert' AND schedule = '0 1 * * *';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'S2 異常 — pcm-anomaly-alert job 未如預期(實 % 筆);拒繼續', v_cnt; END IF;

  -- 5e. wrapper 對 API 角色零 EXECUTE。
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(v_role, 'pcm_cron.invoke_cron_route(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'S2 ACL 異常 — 角色 % 不應能執行 invoke_cron_route;拒繼續', v_role;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ========== Rollback(手動、僅供參考;不外包 txn 於本檔) ==========
-- SELECT cron.unschedule('pcm-settle-sweep');
-- SELECT cron.unschedule('pcm-anomaly-alert');
-- DROP FUNCTION IF EXISTS pcm_cron.invoke_cron_route(text);
-- DROP SCHEMA IF EXISTS pcm_cron;
-- (三 schema 的 REVOKE 屬收緊、不需回補;如需可 GRANT 回原狀,但預設保持收緊。)
```

### 🔴 待 codex 關卡1 重點攻擊面(我先自列)
1. `SET search_path=''` 下 `vault.decrypted_secrets`/`net.http_get`/`has_*_privilege` 是否全可解析(built-in 在 pg_catalog、隱式可見;`net`/`vault` 已 qualify)。
2. `REVOKE … FROM service_role` 是否誤傷 Supabase 或本 app 既有依賴(app 不經 service_role 用 net/vault/cron;需 codex 覆核)。
3. `cron.schedule` 以哪個 role 跑 job / job 是否以 postgres 執行 wrapper(SECURITY DEFINER owner=postgres)。
4. ✅ **已查官方文件確認**:`net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds int)` 簽章與命名參數正確;`http_get` 本身即 `SECURITY DEFINER`(schema `net`)→ 我 REVOKE `net` 函式對 anon/authenticated/service_role 後,wrapper(owner=postgres)仍可呼叫(postgres 自身權限不受 REVOKE PUBLIC/角色影響)。
5. flag-on 時 route 可能 >15s → pg_net timeout 記錄 timeout 但 route 仍非同步跑完(backstop 可接受)——是否有錯誤語意風險。
6. ✅ **已查官方文件確認**表名:`net._http_response`(6h、UNLOGGED)與 `net.http_request_queue` 皆存在 → 斷言引用真物件、不會誤判。
7. ✅ **已查官方文件確認**:Supabase 預設只曝露 `public`(且需顯式 grant);自訂 schema 不會自動進 Data API → `pcm_cron` 安全,REVOKE 為縱深。

## 6. vercel.json 變更

移除 `crons` 陣列兩筆(settle-sweep / anomaly-alert)。若移除後 `crons` 空陣列 → 保留 `"crons": []` 或整段移除(實作時看 schema 需求決定;傾向保留空陣列避免其他欄位連動)。

## 7. 驗證策略(誠實分層)

- **Pre-apply(Claude)**:correct-by-construction + codex 關卡1(plan)+ code-reviewer + codex 關卡2(diff)+ Fable 四模型審 SQL;三綠(typecheck+lint;**零 TS 變更**故 build 非必要、仍跑確認)。
- **🔴 Apply-time 自閘**:migration 自帶 `BEGIN;…COMMIT;` + §5 fail-closed DO 斷言 → ACL/job 任一不符即 `RAISE` → **整檔 ROLLBACK、DB 不半套**(= 最強的安全保證,不依賴我 pre-apply 模擬)。
- **交易模擬限制(誠實揭示)**:pg_cron/pg_net 尚未安裝 → 本機/vanilla PG **無法忠實模擬** `cron.schedule`/`net.http_get`;唯一忠實環境 = 真 Supabase。**選項**:(a) 預設走「自閘斷言 + 四模型審 + Sean 連通實證」(b) 若 Sean 要額外保險 → 開 Supabase preview branch dry-run(有小額成本、屬 R3 需 Sean 點頭)。**預設 (a),(b) 留 Sean 決定。**
- **Post-apply(Sean runbook,見 §8)**:6h 內驗連通 + ACL 抽查。

## 8. Sean 手動 runbook(Claude 一律停下交手;S2 部署 sequencing)

> 順序重要:route 已在 prod(已推)→ 設密鑰 → 存 Vault 同值 → 啟用擴充 → db push → 6h 內驗連通。

1. **Vercel**:確認正式站 `CRON_SECRET` 已設且 ≥32 字元(三 cron route 共用;未設會 500)。
2. **Supabase Dashboard → Database → Extensions**:啟用 `pg_cron`、`pg_net`。
3. **Supabase SQL Editor**:`select vault.create_secret('<正式站 base URL,如 https://…>', 'cron_base_url');` 與 `select vault.create_secret('<與 Vercel CRON_SECRET 同值>', 'cron_secret');`(值不進 git/對話)。
4. **db push** 本 migration。
5. **6h 內連通實證**:`select * from cron.job_run_details order by start_time desc limit 5;`(有成功紀錄)+ `select id,status_code from net._http_response order by created desc limit 5;`(200 + `{enabled:false,skipped:'sweeper_disabled'}` = flag-off 正確 no-op、連通通)+ 抽查 `has_schema_privilege('anon','net','usage')` = false。
6. **flag 不在本片翻**:`CRON_SWEEPER_ENABLED`/`ANOMALY_ALERT_ENABLED` 與 Q4=C 的 Resend/LINE env 全留 **S4** 一組開關一起翻(§ 上位 plan §3)。

## 9. 審查 gate

三綠 → code-reviewer(opus)→ codex 關卡2 對抗審 diff + **DB/安全背書** → Fable 盲審。plan 層先跑 codex 關卡1(高風險六類命中)。輪次:R1 PASS 收工、R1 FAIL 才 R2、上限 2 輪。commit 精準 add + STATUS 7 欄同 commit + 交接;**不 push**。

## 10. codex 關卡1 R1 findings + disposition(2026-07-23、verdict=FAIL)

> codex 全 14 點原文存 scratchpad `codex-k1-out2.txt`。以下逐點分類:🔧=Claude 折入機械修 / 🅢=需 Sean 拍板 / ✅=PASS。

- **F1 ✅🔧**:SQL 可成立(須先裝擴充,已有 §5 L56-64 前置閘)。修:刪「`net.http_get` 本身 SECURITY DEFINER」錯誤宣稱(pg_net 0.20.0 是 invoker;wrapper 靠 owner=postgres 呼叫、不靠此)。
- **F2 ✅🔧**:`search_path=''` 可解析。加:`pg_proc.proconfig` 斷言證 wrapper 固定空 search_path。
- **F3 🔧 must-fix**:job/wrapper 身分只靠註解。加 fail-closed 驗 `current_user='postgres'`(migration 開頭)+ 建後驗 `proowner=postgres`/`prosecdef=true`/兩 job `username='postgres'`/`database=current_database()`/`active=true`。
- **F4 🔧 must-fix**:`cron.schedule` by-name upsert 鍵是 `(jobname,username)`、且不改 `active`(舊停用 job 重跑仍停用)。加:拒跨 role 同名 job + 取 jobid 後 `cron.alter_job(active=>true)` + 5d 驗 username/database/active/完整 command。
- **F5 ✅**:單一交易可維持(pg_net 是先寫 queue、COMMIT 後喚醒 worker、非交易內同步)。
- **F6 🅢 must-fix**:REVOKE 三 schema 全掃 PUBLIC 可能破壞 Supabase Database Webhooks(`supabase_functions_admin` 依賴 pg_net)。repo 現況未用、live 無 webhook trigger。**選項:(a) Sean 接受停用此平台能力(我們用 Next route webhook、非 DB webhook)(b) 精準 allowlist 保留 + webhook smoke test。→ Sean 決策 Q_B。**
- **F7 🔧 must-fix**:5a-5e 多個假綠(§4 宣稱 aclexplode 但 §5 沒有;5a 漏 service_role/未知 role/pcm_cron;5b 漏欄級 ACL/service_role/vault·cron 物件;5c 只搜 Bearer/Authorization;5d 漏 active/username/完整 command;5e 只驗 wrapper)。修:照 email_outbox L448-475 `aclexplode(coalesce(acl,acldefault(...)))` direct ACL allowlist 含 PUBLIC oid 0 + `pg_attribute.attacl` + 有效權限涵蓋 anon/authenticated/service_role 全物件。**🔴 真正落地此斷言需真 Supabase 有裝擴充環境 = 連 Q_A preview branch。**
- **F8 🔧 must-fix**:「明碼只留 6h」不正確——secret 不進 command/job_run_details(成立),但 Authorization 明碼會先入 `net.http_request_queue.headers`,worker 故障時無 6h 硬期限(6h 是 response 清理)。修:改正邊界字面;5c 驗兩條 command 完整字面;限制 queue ACL;canonical HTTPS(無 redirect);CRON_SECRET 輪替入事故 SOP。
- **F9 ✅🔧**:無半套(error/RAISE 全回滾)。修:§2「完全撤除」不正確(rollback 不還原 ACL)→ 改字面。
- **F10 ✅**:金流不變量無破壞(兩 route 零改、settleCharge 只 −1/5 才標 failed)。
- **F11 🔧🅢 must-fix**:部署 sequencing 漏洞:未硬驗 Vercel cron 已從 prod deploy 移除(否則 S4 雙跑 → Email+LINE 重複發);Vault/Vercel CRON_SECRET 不一致 → 401;runbook §8 L201 只查最近 5 筆未關聯 request_id、未取 content 卻宣稱看到 disabled JSON。修 runbook:手動呼 wrapper 存 request_id → 以該 id 驗 status/timed_out/error/content;flag-off 部署 Vercel 移除並確認 dashboard 為零才進 S4。
- **F12 ✅🅢**:正確把 Email+LINE env/flag 留 S4。**但上位 plan §4 L53/§5 L77-85 仍寫「S2 打開/實發」與 Q1=A 衝突 → 需同步上位 plan。**S4 runbook 須逐項硬驗 5 個 Email/LINE env(否則 Q4=C 可能只送一管道)。
- **F13 🅢 must-fix(scope)**:鐵則 8 四要素 PASS;但首次 pg_cron+ACL+Vault+Vercel+連通+多層審不可能 15-45min(鐵則 4)、鐵則 9 應明標「N/A-基礎設施」、上位 plan §2 要求正式 DB 動作前交易模擬 vs 本 §7 preview dry-run 只列可選 = 衝突。**修:preview branch dry-run 改必要前置(Q_A),或取得 Sean 明確覆寫上位 plan 模擬要求。**
- **F14 🔧🅢 must-fix**:①pg_net timeout 15s << route 60s → 改 ~70s ②pg_cron 成功只代表 enqueue、非 route 200 → 驗收合併 job_run_details + request_id response(同 F11)③`cron.job_run_details` 不自動清〔🔴 codex 關卡1 原寫「21,600 筆/日」數字錯、已於 §11/L91 更正為 **720 筆/日、≈21,600/月**〕、#282 100k 約 4.6 月撞頂 → 清理 job/保留天數列 S4 前置 ④兩支同 pg_cron+pg_net → anomaly 無法偵測排程器自身死亡(Q2=A 已鎖不重開,另設不同故障域 dead-man heartbeat = 追蹤項)⑤Vault secret 名唯一、重跑 create_secret 會失敗 → runbook 改先判存在再 update/create、不顯示解密值 ⑥anomaly「Sean 可事後調」→ 改「頻率變更須另審」(無去重、加頻放大轟炸)。

### 待 Sean 兩決策(其餘 🔧 我折入)
- **Q_A(驗證法+小成本)**:是否開 Supabase preview branch 實跑 migration + 精準驗 ACL(=忠實交易模擬,對齊上位 plan §2;同時是把 F7 ACL 斷言與 F6 REVOKE 做精準的唯一途徑)。
- **Q_B(平台取捨)**:收緊三 schema 權限可能關掉「Supabase Database Webhooks」(我們沒在用)→ 接受停用 vs 花工保留。
