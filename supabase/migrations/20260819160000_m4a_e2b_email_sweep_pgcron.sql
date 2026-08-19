-- 20260819160000_m4a_e2b_email_sweep_pgcron.sql
-- M-4a Email 線 E2b:把 /api/cron/email-sweep 排進 pg_cron。
--
-- ┌── 這一支解決的是什麼 ────────────────────────────────────────────────────────
-- │ 應用層全部寫好且已 apply(email_outbox / notification_email / 建單寫收件人),
-- │ 而**沒有任何東西呼叫那支 route** ⇒ 正式庫零封信。
-- │ 唯一寫入路徑逐層都只有 1:
-- │   SupabaseEmailOutboxAdapter.ts:200 ← enqueue-order-created-emails.ts:103
-- │   ← app/api/cron/email-sweep/route.ts:280 ← 🔴 沒有人呼叫這支 route
-- │ route 檔頭 :10-11 自己寫著「firing 由 E2b 的 pg_cron 是否存在控制 = 天然開關」。
-- └──────────────────────────────────────────────────────────────────────────────
--
-- 🔴 **本檔【只排程】,不建任何物件。** wrapper `pcm_cron.invoke_cron_route(text)`、
--   私有 schema `pcm_cron`、vault secret 都由 `20260723120000_m3_s2_settle_sweep_pgcron.sql`
--   建立且已 apply(`grep -c 20260723120000 supabase/APPLIED.tsv` ⇒ 1)。
--   ⇒ 本檔對它們只做**斷言**,不 `CREATE OR REPLACE` ——
--     重建一個別人擁有的 SECURITY DEFINER 函式,是在別人的安全邊界上動手。
--
-- 🔴 週期 `*/5` 不是本檔作者選的:`route.ts:3` 逐字「排程走 E2b 的 pg_cron〔*/5〕」,
--   並說明為何不進 vercel.json(Hobby cron 一天一次,放不了 5 分鐘一輪)。
--
-- ══ 🔴🔴 上線順序(三段,順序是承重的;codex 關卡2 R1 must-fix 4 修正過一次)══
--   本窗以 `vercel env ls production` 實查(分母 30,只看名稱、未讀值):
--     ✅ RESEND_API_KEY 已設   ✅ CRON_SECRET 已設   ✅ ALERT_EMAIL_FROM 已設(告警線,非本線)
--     ❌ ORDER_EMAIL_FROM 未設   ❌ B4_DEPLOY_CUTOFF 未設
--
--   🔴 **route 的實際執行順序(讀 route.ts:262 / :299 得到,不是推的)**:
--     ① `readCutoff()` 先跑 ⇒ 決定 **enqueue** 那半跑不跑
--     ② 之後 `getSweepEmailOutboxDeps()` **無條件**建構 ⇒ requireEnv(RESEND_API_KEY / ORDER_EMAIL_FROM)
--        缺就 throw ⇒ **503**
--   ⇒ ⇒ **兩個都沒設時,拿到的是 503,不是 200。**
--     (~~本檔前一版寫「cutoff 未設 ⇒ 200 skipped_no_cutoff ⇒ 看起來完全正常」~~ ——
--      那句**只在 ORDER_EMAIL_FROM 已設的前提下才成立**,而它現在沒設。已修正。)
--
--   🔴🔴 **「第二段零寄信風險」有一個【前提】,它是世界的狀態、不是設計保證:**
--     `cutoff` 只停掉 **enqueue**(排信)那半;**sweeper 那半仍會無條件 claim 並寄出
--     `email_outbox` 裡【既有的】due 列**。
--     ⇒ 目前之所以成立,是因為 Sean 2026-08-19 對正式庫實跑量到 **`c_信件表列數 = 0`**。
--     ⇒ 🔴 **那個 0 會過期**(任何人只要讓 enqueue 跑過一次就不是 0 了)。
--     ⇒ **apply 前重跑一次:`select count(*) from public.email_outbox;`
--        不是 0 ⇒ 停下回報,不要往下走** —— 那代表第二段會真的寄信,不再是零風險的鏈路測試。
--
--   ⇒ **正確三段**:
--     **第一段 · 先補吵的那道**:設 `ORDER_EMAIL_FROM` + redeploy。
--        沒補就往下走,整條鏈永遠回 503,而 **503 分不出「鏈路不通」與「還沒上膛」**。
--     **第二段 · apply 本檔,驗鏈路(零寄信風險)**:此時 cutoff 仍未設
--        ⇒ 預期 **200 且 `enqueueStatus: skipped_no_cutoff`、counts 全零、一封都不寄**。
--        🔴 那是一個**明確可辨識的「鏈路通了、還沒上膛」訊號** —— 兩個世界印不同的東西。
--     **第三段 · 上膛**:設 `B4_DEPLOY_CUTOFF` + redeploy。**這一步才會真的寄信。**
--
-- ══ 🔴 `B4_DEPLOY_CUTOFF` 的值:兩個方向都會出事,route.ts 自己寫著 ══
--   · 填【早】了 ⇒ 掃到 B-4 之前建的舊單 ⇒ 那些單 notification_email 是 NULL ⇒ 走 customers.email
--     ⇒ **客人收到一封關於幾個月前那張單的通知信**,而 repo 內不會有任何東西紅。
--   · 填【晚】了 ⇒ created_at < cutoff 的單**被永久排除** ⇒ 少數客人沒收到信,而 route 一路 200。
--   ⇒ **本檔不建議任何具體時戳** —— 那要看「部署瞬間」怎麼定義,route.ts 明載該決定不在該片、在 plan §4.3。
--   ⚠️ 現況可能讓這題變簡單:Sean 2026-08-18 自陳後台既有訂單都是他本人測試單
--     (memory `project_0818-2sqh2p-resolved-is-seans-test`)⇒ 若**經他本人確認**無真實客人單,
--     cutoff 取「上膛的那一刻」即可。
--     🔴 **這是【轉述+推論】,本窗未查證正式庫** ⇒ 上膛前要他自己確認,不得由本檔代為認定。
--
-- ══ 🔴 本檔【證不到】的三件(codex 關卡2 R1;寫在這裡是因為它們要靠人,不靠 SQL)══
--   ① **vault 的 `cron_secret` 是否等於 Vercel 的 `CRON_SECRET`** —— 0c 只驗得到「存在/長度/形狀」。
--      兩者不相等 ⇒ 本檔照樣 COMMIT,而之後**每一輪都 401**。⇒ 驗收要看 route 真的回 200。
--   ② **`ORDER_EMAIL_FROM` 的值是否為 Resend 已驗證的寄件網域** —— `requireEnv` 只擋空值。
--      🔴 填一個**非空但未驗證**的位址 ⇒ 上膛後會 claim、寄送失敗、**消耗 attempts**,
--      退避到上限後成為**永久死信** ⇒ 那幾封信再也不會寄出。⇒ 上膛前必須先確認寄件網域。
--   ③ **route 是否已部署且可達** —— ~~DB 這一側看不到~~ 🔴 **這句是假的,2026-08-19 W5 證偽。**
--      **DB 這一側看得到,而且是最直接的證據**(它在正式庫實量):
--        `select status_code, count(*) from net._http_response where created > now() - interval '1 hour' group by 1;`
--        `select count(*), count(*) filter (where status = 'succeeded') from cron.job_run_details where start_time > now() - interval '1 hour';`
--      ⇒ W5 當天量得 `net._http_response` 30 筆全 `200`、`cron.job_run_details` 31 runs / 31 succeeded。
--   🔴 **而這句話關掉的,正好是本檔自己列為【最易失敗】的那一格** ——
--      「vault 的 `cron_secret` 是否等於 Vercel 的 `CRON_SECRET`」:不相等 ⇒ **每一輪都 401**,
--      而 `net._http_response` 的 `status_code` **一眼就看得出來**。
--   📌 **教訓(本檔作者自己犯的)**:一句「看不到」的成本**不是它自己錯,是它讓別人不再試**。
--      寫否定句時,同一句要帶上「**那要怎麼才看得到**」——沒有下半句的否定句會被當成句點。
--
-- ══ 誠實界線 ══
--   · 本檔**未在任何資料庫上實跑過**(本窗無正式庫存取、未起拋棄式 PG)⇒ 斷言區的行為**未確認**。
--   · 未做端到端連通實證(request_id / HTTP 200)—— 那要 apply 之後才做得到。
--   · `*/5` 與 settle-sweep 的 `*/2` 同時存在時的 pg_net 佇列競爭,本窗**未評估**。
--   · 0b 的 wrapper body 斷言**擋的是意外漂移,不是惡意** —— 有 postgres 權限的人可以連同斷言一起改;
--     codex R2 另指出四個字面可藏在註解/死碼中,故它**證不到控制流、URL 或 header 正確**。射程僅此。
--   · 🔴 **2b(nodename/nodeport)刻意【不採用】codex R1 與 R2 各自建議的寫死做法** ——
--     R1 建議比 `current_setting('port')`,R2 說該比 `cron.host`/`inet_server_port()`,**兩者互相矛盾**,
--     而本窗沒有 pg_cron 環境可以驗證哪個對。**寫一個我驗不了又可能誤擋的守門,會讓 apply 因假理由失敗。**
--     ⇒ 改為拿現行運作中的 `pcm-settle-sweep` 當基準(不寫死值、在 apply 當下取得)。
--     **下一個讀 codex findings 的人:那兩條不是漏折,是刻意不折,理由在此。**
--
-- 🔴 **不 apply。** 鑰匙在 Sean 手上(本窗不 apply、不 push)。
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 0. 前置身分 + 擴充閘(fail-closed;形狀沿用 20260723120000)。
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'E2b:migration 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'E2b:pg_cron 未啟用;拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'E2b:pg_net 未啟用;拒繼續';
  END IF;
END $$;

-- 0b. 🔴 wrapper 前置閘:本檔**不建立** wrapper,而它必須已存在且安全屬性未被削弱。
--     (少了這一段,就會把 job 排到一個可能已被改壞的 SECURITY DEFINER 上。)
DO $$
DECLARE v_role text; v_cnt int; v_src text;
BEGIN
  IF to_regprocedure('pcm_cron.invoke_cron_route(text)') IS NULL THEN
    RAISE EXCEPTION 'E2b:wrapper pcm_cron.invoke_cron_route(text) 不存在 — 請先 apply 20260723120000;拒繼續';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND ('search_path=""' = ANY(p.proconfig) OR 'search_path=' = ANY(p.proconfig))
  ) THEN
    RAISE EXCEPTION 'E2b:wrapper owner/secdef/search_path 不符;拒繼續';
  END IF;

  -- 🔴 codex 關卡2 R1 must-fix 1:上面四格全部只看【中繼資料】——
  --    保留同樣的 owner/SECDEF/search_path/ACL,而把 body 換成任意內容,四格照樣全過。
  --    ⇒ 加驗 body 的關鍵字面。⚠️ 這擋的是**意外漂移**(有人 CREATE OR REPLACE 成別的版本),
  --      **不是惡意** —— 有 postgres 權限的人可以連這條斷言一起改掉。射程寫在檔頭。
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure;
  IF v_src IS NULL
     OR position('vault.decrypted_secrets' in v_src) = 0
     OR position('cron_base_url'           in v_src) = 0
     OR position('cron_secret'             in v_src) = 0
     OR position('net.http_get'            in v_src) = 0 THEN
    RAISE EXCEPTION 'E2b:wrapper body 與預期不符(缺 vault/net.http_get 字面);拒繼續';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(v_role, 'pcm_cron.invoke_cron_route(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'E2b:% 不應能執行 wrapper;拒繼續', v_role;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid = 'pcm_cron.invoke_cron_route(text)'::regprocedure
     AND a.grantee <> p.proowner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'E2b:wrapper proacl 出現 owner 以外 grantee % 筆;拒繼續', v_cnt;
  END IF;
END $$;

-- 0c. Vault secret 前置閘(wrapper 靠它取 base_url / secret;缺了 job 會 active 但永遠失敗 = 靜默死排程)。
--     🔴 只驗存在/長度/形狀,**絕不把解密值寫進任何 RAISE 訊息**。
--     ⚠️ 證不到「它等於 Vercel 的 CRON_SECRET」(檔頭「本檔證不到的三件」①)。
DO $$
DECLARE v_base text; v_token text;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'cron_base_url') <> 1
  OR (SELECT count(*) FROM vault.secrets WHERE name = 'cron_secret')   <> 1 THEN
    RAISE EXCEPTION 'E2b:vault secret cron_base_url / cron_secret 須各恰一筆;拒繼續';
  END IF;
  SELECT decrypted_secret INTO v_base  FROM vault.decrypted_secrets WHERE name = 'cron_base_url';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_base IS NULL OR v_base !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$' THEN
    RAISE EXCEPTION 'E2b:cron_base_url 須為 https:// origin-only〔值不記錄〕;拒繼續';
  END IF;
  IF v_token IS NULL OR length(v_token) < 32 THEN
    RAISE EXCEPTION 'E2b:cron_secret 缺或長度 <32(值不記錄);拒繼續';
  END IF;
END $$;

-- 1a. 🔴 codex 關卡2 R1 must-fix 2:先把既有兩 job 的**完整形狀**拍下來。
--     原本 2d 只數「有沒有 2 筆 active」⇒ 它們的 schedule/command/database 被改壞照樣過。
--     而「我沒有動到它們」這個宣稱,只有 before/after 比對證得出來 —— 數量相同不等於沒被改。
-- 🔴🔴 **快照【所有既有 job】,不是一份寫死的名單**(W5 2026-08-19 審查抓到,而它【已經漏了一支】):
--   原本寫 `IN ('pcm-settle-sweep','pcm-anomaly-alert')` ——
--   而 W5 在正式庫實量 `cron.job` 有**三支**,第三支 `pcm-expire-unpaid-orders`
--   (由 `20260809170000_m4b_lifecycle_l3b_expire_unpaid_orders_schedule.sql:77` 排,**且已 apply**:
--    `grep -c '^20260809170000' supabase/APPLIED.tsv` ⇒ 1)**不在我的名單裡**
--   ⇒ 本檔對它**零保護**,而它管「過期未付款訂單自動取消」
--   ⇒ 🔴 **它靜靜停掉的症狀要幾天後才有人發現。**
--   📌 **一份寫死的白名單,正確性取決於【有沒有人記得維護它】** —— 而我寫它的當天就已經漏了。
--   ⇒ 改成「**除了我要加的那一支,其餘全部快照**」⇒ **不需要任何人維護,新增 job 自動納入保護。**
CREATE TEMP TABLE _e2b_jobs_before ON COMMIT DROP AS
SELECT jobid, jobname, schedule, command, database, username, active, nodename, nodeport
  FROM cron.job
 WHERE jobname <> 'pcm-email-sweep';

-- 🔴 codex R2:快照本身要先證明【它拍到了東西】。
--   少了這一格,若套用前那兩支本來就不在,before/after 會「兩邊都空 ⇒ 相等 ⇒ 全綠」——
--   一個【什麼都沒有】的比對,和一個【什麼都沒變】的比對,在輸出上是同一句話。
--   (`jobid` 也一併納入快照:少了它,刪掉再用相同欄位重建會全綠。)
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM _e2b_jobs_before;
  -- 🔴 不再斷言「恰 2 筆」(那是寫死名單的殘留);改為斷言【快照拍到了東西】——
  --   少了這一格,若 cron.job 是空的,before/after 會「兩邊都空 ⇒ 相等 ⇒ 全綠」,
  --   而**一個【什麼都沒有】的比對,和一個【什麼都沒變】的比對,在輸出上是同一句話**。
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'E2b:套用前 cron.job 一支既有 job 都沒有 ⇒ 下面的 before/after 比對沒有對象、結論不成立;拒繼續';
  END IF;
  RAISE NOTICE 'E2b:已快照 % 支既有 cron job(全部納入 2e 的逐欄比對保護)', v_cnt;
END $$;

-- 1b. 排程單一 job(command 只呼 wrapper、零 secret;by-name upsert 冪等 + 顯式 active)。
DO $$
DECLARE v_id bigint;
BEGIN
  v_id := cron.schedule('pcm-email-sweep', '*/5 * * * *',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/email-sweep')$job$);
  -- by-name upsert 不會改 active,故顯式設 true(沿 20260723120000 F4)。
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- 2. fail-closed 斷言(自閘 COMMIT;任一異常 → 整檔 ROLLBACK、DB 不半套)。
DO $$
DECLARE v_cnt int;
BEGIN
  -- 2a. job 本身:名稱/擁有者/active/資料庫/週期/command 逐格。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-email-sweep' AND username='postgres' AND active
     AND database=current_database() AND schedule='*/5 * * * *'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/email-sweep'')';
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'E2b:pcm-email-sweep job 不符(實 % 筆);拒繼續', v_cnt; END IF;

  -- 2b. 🔴 by-name upsert **不會更新 nodename/nodeport**;若那兩欄漂掉(指向連不到的位址),
  --     job 會顯示 active、排程存在、而**永遠不執行**,且本檔仍然 apply 成功
  --     ⇒ 又一個「看起來成功而什麼都沒發生」。
  --
  --     🔴🔴 **這一格【不寫死任何值】,拿同一張表裡已知會動的 `pcm-settle-sweep` 當基準。**
  --     codex R1 建議寫死 `current_setting('port')`,R2 反過來說該用 `cron.host`/`inet_server_port()`
  --     ⇒ **兩個建議互相矛盾,而本窗【沒有 pg_cron 環境可以驗證哪個對】。**
  --     ⇒ 一個我驗不了、又可能誤擋的守門,會讓 apply 因為**假理由**失敗 —— 那比沒有守門貴。
  --     ⇒ 所以兩個都不採用:**讓斷言去問世界現在是什麼**。
  --       拿 `pcm-settle-sweep` 當基準,而且是在 apply 當下取得的,
  --       不依賴任何人維護一份會過期的清單。
  --     🔴 **而這一格證得到的是「兩者一致」,【不是】「會跑」**(W6 R3 M2 打掉我原本的措辭):
  --       ~~原註解寫「`pcm-settle-sweep` 是活的(它現在真的在跑)」~~ —— **本檔沒有任何一格在驗那件事。**
  --       `active=true` 只代表**啟用**,不代表**跑得起來** ⇒ 兩支的 nodename/nodeport **同時**漂掉時,
  --       本格會通過而兩支都不執行。
  --     ⇒ 要把「假設活的」升級成「量到活的」,得查 `cron.job_run_details` 近期有無成功紀錄
  --       —— **本檔沒有做**,因為本窗**沒有 pg_cron 環境可以驗那張表的可讀性**,
  --       而**加一道我驗不了的檢查正是上面 2c 剛拒絕的那件事**。⇒ 留為已知射程,不留為假斷言。
  IF NOT EXISTS (
    SELECT 1
      FROM cron.job e
      JOIN cron.job r ON r.jobname = 'pcm-settle-sweep'
     WHERE e.jobname = 'pcm-email-sweep'
       AND e.nodename IS NOT DISTINCT FROM r.nodename
       AND e.nodeport IS NOT DISTINCT FROM r.nodeport
  ) THEN
    RAISE EXCEPTION 'E2b:pcm-email-sweep 的 nodename/nodeport 與現行運作中的 pcm-settle-sweep 不一致 ⇒ 可能靜默不執行;拒繼續';
  END IF;

  -- 2c. 反面:同名 job 沒有掛在別的 role 底下(跨 role 同名防線)。
  --     🔴 codex R2 指出這一格**仰賴 `postgres` 有 BYPASSRLS**(`cron.job` 有 RLS,
  --     沒有該屬性時別的 role 的 job 對我隱形 ⇒ count 恆為 0 = 恆真格)。**那是對的。**
  --
  --     🔴🔴 **而我【不】為此加一道 `rolbypassrls` 的 RAISE**(R2 建議過、我一度加了、W6 R3 打掉):
  --       · 本 repo **兩處逐字記著那個屬性【未查證】**:
  --         `20260817070000:98` 「缺的那一道 = 正式庫查 `pg_roles.rolbypassrls` 與角色關係」
  --         `20260817070000:336`「缺的那道仍列著:正式庫查 `pg_roles.rolbypassrls`」
  --       · ⇒ 若 Supabase 的 `postgres` 其實沒有它,那道 RAISE 會讓**一個完全健康的系統 apply 失敗**,
  --         而 Sean 看到的是一句他無法判斷真假的中止。
  --       · ⇒ 而 2c 擋的是**縱深**(跨 role 同名 job),**不是正確性前提**
  --         ⇒ **拿一個 nice-to-have 去擋一支正在修「正式庫零封信」的檔,是壞交易。**
  --       · 📎 **本 repo 有方向相反的前例,而我照它**:`20260817070000:280` 逐字
  --         「三條 policy 顯式存在(**不依賴 BYPASSRLS**)」——
  --         **那一片遇到同一個未知時,選的是讓檢查不依賴它,不是要求它成立。**
  --
  --     ⇒ **本格的射程因此被降級,而降級【寫在這裡而不是靠人記得】**:
  --       它證的是「**我看得到的範圍內沒有跨 role 同名 job**」,
  --       **不是**「不存在跨 role 同名 job」。看不到的時候它會回 0,而 0 在這裡**不是證據**。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-email-sweep' AND username <> 'postgres';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'E2b:偵測到跨 role 同名 cron job % 筆;拒繼續', v_cnt; END IF;

  -- 2d. command 零 secret 相關字面(縱深:cron.job.command 對持 cron USAGE 者可讀)。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-email-sweep'
     AND (command ILIKE '%Bearer%' OR command ILIKE '%Authorization%' OR command ILIKE '%decrypted_secret%');
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'E2b:cron command 含 secret 相關字面 % 筆;拒繼續', v_cnt; END IF;

  -- 2e. 🔴 既有兩 job **逐欄** before/after 全等(不是只數筆數)。
  --     用 FULL OUTER JOIN + IS DISTINCT FROM:少一筆、多一筆、任一欄變動,三種都會被抓到。
  SELECT count(*) INTO v_cnt
    FROM _e2b_jobs_before b
    FULL OUTER JOIN (
      SELECT jobname, schedule, command, database, username, active, nodename, nodeport
        FROM cron.job WHERE jobname <> 'pcm-email-sweep'
    ) a ON a.jobname = b.jobname
   WHERE (a.jobname, a.schedule, a.command, a.database, a.username, a.active, a.nodename, a.nodeport)
         IS DISTINCT FROM
         (b.jobname, b.schedule, b.command, b.database, b.username, b.active, b.nodename, b.nodeport);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'E2b:既有 job(settle-sweep/anomaly-alert)在本次套用前後不一致 % 筆;拒繼續', v_cnt;
  END IF;
END $$;

COMMIT;
