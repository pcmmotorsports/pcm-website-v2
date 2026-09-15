# 2026-09-15 · 五支純 SQL 排程接上外部存活監控(healthchecks.io)—— plan

> 設計窗。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P2-1**;缺口原文在 `docs/runbooks/healthchecks-wiring-acceptance.md:93-103`。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼、零 migration。** 碰 `cron.job` 指令 + 新 DB 函式 + Vault secret ⇒ 鐵則 8 + 12(CI / cron / env),等批。
> 事實由設計窗 2026-09-15 親讀 repo 核對;正式庫只唯讀。
> 🔁 **R2 版(2026-09-15)**:專案版 adversarial-reviewer(opus)R1 必修 3 條 + 小問題已改進本檔,改動處標 `[R1]`。codex 缺席到 09-20,本 plan 只有這一路審查。
> ✅ **Sean 已答**(主視窗轉述):Q1 = 甲;驗收「故意停一支排程」**不做**。healthchecks.io 建 check、Vault 貼值由 Sean 做。
> 🔁 **R3 字面版(2026-09-15)**:R2 仍有必修 2 條 ⇒ 依規不跑 R3,主視窗端 Sean,**Sean 答甲(逐字「依照建議」)= 照審查建議改,改完不再審**。R2 兩條必修與 R2 小問題已改進本檔,標 `[R2]`。

## 1. 白話

- 網站有 10 支定時排程。其中 5 支是「呼叫網站 API」的,每跑成功一次會去外部監控站 healthchecks.io 報到,**哪天沒報到,監控站會叫。**
- 另外 5 支是**直接在資料庫裡跑的 SQL**,**從來沒有報到**。它們停了,外面一聲都不會出。其中兩支在金流路徑上:`pcm-settle-retry`、`pcm-expire-unpaid-orders`。
- 網站裡有一支「順便代看」的檢查,但**只看那兩支金流的**,而且它自己跑在網站上 ⇒ 網站整個掛掉時,它也一起掛。
- 本 plan:讓這 5 支 SQL 排程**跑成功之後,由資料庫自己去 healthchecks.io 報到**,不經過網站。
- 今天的狀況:5 支都正常在跑,過去 7 天 0 次失敗。**這是「壞了會不會有人知道」,不是「現在壞了」。**

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 正式庫 `cron.job` 10 支,全部 `active = t` | 2026-09-15 唯讀 `SELECT … FROM cron.job` |
| 2 | 已接 healthchecks 的 5 支:`pcm-settle-sweep`(*/2)、`pcm-order-ineligible-gate`(*/2)、`pcm-email-sweep`(*/5)、`pcm-capture-recheck`(*/10)、`pcm-anomaly-alert`(0 1,13) | 同上;`docs/runbooks/healthchecks-wiring-acceptance.md` |
| 3 | `[R1]` 沒接的 5 支,**正式庫 live 值逐字**(`username` 全 `postgres`、`database` 全 `postgres`、`active` 全 `t`):見 §4-C 表 | 2026-09-15 唯讀 `SELECT jobname, username, database, active, command FROM cron.job` |
| 4 | 這 5 支 7 天內 `non_success_7d` 全 0;`runs_7d` = 7 / 168 / 1008 / 7 / 1008(acl-digest / expire / late-payment / net-exposure / settle-retry) | `cron.job_run_details` 唯讀 |
| 5 | 各自呼叫的函式(最新一代),`[R1]` owner 全 `postgres`、全 SECURITY DEFINER:`pcm_cron.expire_unpaid_orders` `20260906600000:175` · `public.pcm_settle_retry_sweep` `20260905220000:72` · `pcm_cron.late_payment_pending_refund_sweep` `20260905180000:125` · `public.pcm_acl_digest_record` `20260909060000:230` · `public.pcm_net_exposure_record` `20260908030000:256` | `bash scripts/latest-definition-of.sh <名>`;owner 唯讀 `pg_proc` |
| 6 | 5 支函式寫 `public.sweeper_heartbeat`:成功那支 `20260906600000:345`、`20260905220000:203`、`20260905180000:341`、`20260909060000:294`、`20260908030000:296`。`[R1]` **`late_payment_pending_refund_sweep` 有失敗那支**:單張單失敗只把 `v_fail` 加一(`:215-224`),`v_fail > 0` 或統計被取消時寫 `last_failure_at`(`:333-339`),**然後照常 return**(`:355`)⇒ 交易照樣 commit | 設計窗逐行核對 |
| 7 | `[R1]` `pcm_settle_retry_sweep` 也吞單張失敗(`:178-190`,記進 `pcm_settle_retry_attempts`),但**照寫成功心跳**(`:203`)⇒ 對它而言「本輪有跑完」= 成功,與它自己的心跳語意一致 | 設計窗逐行核對 |
| 8 | 站內代看:`capture-recheck` route 順路讀心跳,**只看 `MONEY_CRON_JOB_NAMES = ['pcm-settle-retry', 'pcm-expire-unpaid-orders']`**。`[R1]` route `:191-224` 只是預算包裝;實際呼叫 RPC 在 `PgAnomalyAlertReaderAdapter.ts:561`;SQL `get_cron_heartbeat_stale_counts` 的 `LEFT JOIN sweeper_heartbeat` 在 `20260831170000:123` | `packages/domain/src/ops/cron-jobs.ts:192`;審查 R1 更正行號 |
| 9 | 網站側報到 helper `pingExternalHeartbeat`:只接受 `https://hc-ping.com/`;沒設網址只 `console.error` 不中斷;`pcm-expire-unpaid-orders` 標 `notApplicable` | `apps/storefront/src/lib/cron/heartbeat.ts:243-268`、`:283-300` |
| 10 | 報到模型「只報成功、不送 `/fail`」 | `docs/runbooks/healthchecks-wiring-acceptance.md`(**吻合但未證實**,未逐行重讀) |
| 11 | 正式庫已裝 `pg_net` 0.20.0;repo 已有「SQL 經 `net.http_get` 發 HTTP、網址與金鑰從 Vault 讀」的 `pcm_cron.invoke_cron_route`。`[R1]` 函式在 `20260723120000:95-120`;那 5 支 HTTP 排程的 command 在 `:128-129` / `:131-132` | 唯讀 `pg_extension`;審查 R1 更正行號 |
| 12 | `[R1]` 正式庫貼板角色 `postgres` **不是 superuser**:`cron.job` SELECT = t、UPDATE = f、`cron.alter_job` EXECUTE = t ⇒ 前置閘**不能** `FOR UPDATE`;拋棄式 PG 的 `postgres` 是 superuser 會繞過權限檢查 | `20260915120000_m4b_anomaly_alert_twice_daily.sql:25-40`(該檔貼板 170 失敗的實錄) |
| 13 | `[R1]` 同檔的改排程前置閘寫法(比 live 值、不鎖、停用中就停、改完再比一次) | 同檔 `:73-117` |
| 14 | `[R2]` 正式庫 pg_cron 設定:`cron.use_background_workers = off`(⇒ libpq 模式)、`cron.timezone = GMT`、`cron.max_running_jobs = 32`、`cron.log_run = on`、`cron.database_name = postgres`。(設計窗的唯讀角色讀不到,`pg_settings` 0 列) | 主視窗以管理帳號強制唯讀查,2026-09-15 16:3x |
| 15 | `[R2]` `late_payment_pending_refund_sweep` 的統計趟若是**非取消的失敗**,仍走成功心跳那一支 ⇒ 仍會報到。與它心跳本來的語意一致(統計失敗不算這一輪補列失敗),寫明不改 | `20260905180000:280-283`(審查 R2 指出) |

## 3. 做法:甲(已批)

新增 `pcm_cron.ping_healthcheck(p_job text)`,把 5 支排程的 command 改成「原句; 報到」。**不動任何金流函式本體。**

### `[R1]` 3-1 為什麼「成功才報到」在甲底下站得住(三道,缺一不可)
1. **pg_cron 一條 command 只跑一個交易、第一句錯就停**:審查 R1 讀 pg_cron 1.6.4 原始碼(背景 worker 模式 `pg_cron.c:2107/2114/2118`;libpq 模式 `:1650` 單一 simple-query 訊息)⇒ 原函式丟錯 ⇒ 第二句不跑。**⇒ 開工第一步照樣實測**(§7-1),不信原始碼閱讀。
2. **心跳閘(補 `late_payment` 那個洞)**:報到前查 `sweeper_heartbeat` 這一輪有沒有寫**成功**:
   ```
   IF NOT EXISTS (SELECT 1 FROM public.sweeper_heartbeat
                   WHERE job_name = p_job AND last_success_at >= pg_catalog.now()) THEN
     RAISE LOG '[ping_healthcheck] % 本輪沒有成功心跳 ⇒ 不報到', p_job; RETURN;
   END IF;
   ```
   `now()` = 交易開始時刻;5 支函式寫心跳都用 `clock_timestamp()` ⇒ 本輪寫的一定 ≥ `now()`,上一輪寫的一定 < `now()`。**⇒ 5 支都拿到「以心跳為準」的真實度**(等同原本的乙,但不改函式本體)。
   代價(寫明):心跳寫入本身失敗(函式裡被吞成 `RAISE WARNING`)⇒ 不報到 ⇒ healthchecks 會叫。方向是對的。
   `[R2]` 例外寫明:`late_payment_pending_refund_sweep` 統計趟的非取消失敗仍寫成功心跳 ⇒ 仍會報到(§2 #15),與它心跳本來的語意一致,不改。
3. **pg_net 的佇列跟著交易走**:`net.http_request_queue` 是 unlogged 表,insert 在同一交易 ⇒ 交易回滾,報到請求一起消失(審查 R1 讀 `pg_net.sql:12`、`:134`)。

### `[R1]` 3-2 報到那一句不准拖垮原排程
報到與原函式同一個交易 ⇒ 報到那句**冒出**錯 ⇒ 原函式這一輪的取消 / 重算整輪回滾、`job_run_details` 記 failed。三條要擋:
- (a) **函式不存在**:migration 先建函式、同一交易再改 command;rollback **同一交易先改回 command、再 DROP**(順序是承重的,檔內註解寫明)。
- (b) **執行權不夠**:前置閘逐支驗 `username = 'postgres'`、`active = t`,函式 owner = `postgres`(§2 #3、#5 今天都成立)。
- (c) **`WHEN OTHERS` 接不住 57014**:函式本體用 `EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE LOG … ; RETURN;`。`[R2]` 出處更正:`20260906600000:331-333` 是在**解釋**「WHEN OTHERS 接不到 57014」;**具名接住**的前例在 `20260905220000:176`、`20260905180000:276`。
  `[R2]` 代價寫明:接住 `query_canceled` 也會吞掉「有人剛好在 ping 那一刻 `pg_cancel_backend`」⇒ 原函式那半照樣 commit、只是這一輪沒報到。**接受**:取消報到不該連帶退掉已經做完的取消 / 重算。

## 4. 範圍

### 4-A healthchecks.io 端(Sean 做)
新建 5 個 check,`[R1]` **用 cron 模式、時區 UTC**(與 `cron.job.schedule` 同字面;正式庫 `cron.timezone = GMT`,§2 #14)。

`[R2]` **寬限 = `staleMinutes` − 週期**(不是直接抄 `staleMinutes`)。cron 模式是「預定時刻過了 + 寬限」才判 down ⇒ 最晚叫的時刻 = 上次報到 + 週期 + 寬限 = 上次報到 + `staleMinutes`,與站內代看**同一個門檻**。直接抄 `staleMinutes` 會晚一整個週期(每日兩支會晚到第 3 天),而網站掛掉時外部是唯一會叫的。

| check 名稱 | Schedule(cron) | 時區 | 週期 | `staleMinutes` | 算式 | **Grace 填** |
|---|---|---|---|---|---|---|
| `pcm-expire-unpaid-orders` | `0 * * * *` | UTC | 60 分 | 180(`cron-jobs.ts:96`) | 180 − 60 | **120 分鐘** |
| `pcm-settle-retry` | `*/10 * * * *` | UTC | 10 分 | 30(`:109`) | 30 − 10 | **20 分鐘** |
| `pcm-late-payment-sweep` | `*/10 * * * *` | UTC | 10 分 | 30(`:125`) | 30 − 10 | **20 分鐘** |
| `pcm-acl-digest` | `0 0 * * *` | UTC | 1440 分 | 2880(`:105`,`2 * 24 * 60`) | 2880 − 1440 | **1440 分鐘** |
| `pcm-net-exposure` | `0 0 * * *` | UTC | 1440 分 | 2880(`:131`,`2 * 24 * 60`) | 2880 − 1440 | **1440 分鐘** |

- `staleMinutes` 由設計窗逐行核對 `packages/domain/src/ops/cron-jobs.ts`;Schedule = 正式庫 `cron.job.schedule` 唯讀 2026-09-15。
- ⚠️ cron 模式下 healthchecks.io 沒有 Period 欄(只有 Schedule / Time Zone / Grace),**UI 欄位名是記憶、未實際開畫面核對**,Sean 照畫面對。
- ⚠️ 每日兩支的 2 天門檻,`cron-jobs.ts:100` 註解自己寫「推的,沒有人拍過」;本表是**對齊**站內,不替那個數字背書。

### 4-B Vault(Sean 貼)
5 個 secret,值是該 check 的 `https://hc-ping.com/<uuid>`。慣例抄既有 `cron_base_url` / `cron_secret`(全小寫、底線)。**名稱逐字:**

| 排程(`cron.job.jobname`) | Vault secret 名稱 |
|---|---|
| `pcm-expire-unpaid-orders` | `hc_ping_pcm_expire_unpaid_orders` |
| `pcm-settle-retry` | `hc_ping_pcm_settle_retry` |
| `pcm-late-payment-sweep` | `hc_ping_pcm_late_payment_sweep` |
| `pcm-acl-digest` | `hc_ping_pcm_acl_digest` |
| `pcm-net-exposure` | `hc_ping_pcm_net_exposure` |

🔴 ping 網址 = 寫入權限 ⇒ 不進 migration、不進 repo、不進 `cron.job.command`。
`[R1]` ⚠️ **殘餘風險要寫出來**:送出前,完整網址會以明文短暫存在 `net.http_request_queue.url`(pg_net 行為),而 `anon` 對那張表有 SELECT —— 那是 2026-09-09 已接受的既有殘餘風險(審查 R1 指 netpublicall plan;原本那 5 支 route 的 `cron_secret` Bearer 也在同一處)。本 plan 不擴大、也不消除它。

### 4-C migration
- `pcm_cron.ping_healthcheck(p_job text)` RETURNS void:
  - `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`,owner `postgres`,**裸 `CREATE`**(不 OR REPLACE)
  - 排程名 → secret 名:**逐字 `CASE`** 對照 §4-B 表;不在表上 ⇒ `RAISE LOG` 後 return(不做連字號轉換,理由同 `heartbeat.ts` `pingTarget` 寫死 switch)
  - §3-1 心跳閘
  - Vault 讀不到 / 值不是 `https://hc-ping.com/` 開頭 ⇒ `RAISE LOG` 後 return
  - `net.http_get(url := v_url, headers := jsonb_build_object('User-Agent', 'pcm-db/' || p_job), timeout_milliseconds := 5000)`(`[R1]` UA 帶排程名;`[R2]` **只作輔助**:審查 R2 讀 pg_net 0.20.0 原始碼,它會在我們的 header 之後**再附**自己的 `User-Agent: pg_net/0.20.0`,監控站記哪一個驗不到 ⇒ 不能單靠它核對貼反,主要做法見 §7-7)
  - 整段 `EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE LOG …`(§3-2 c)
  - ACL:`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role, payment_confirmer`;不 GRANT 任何人(owner `postgres` 執行)
- `[R1]` 改 5 支 command(**原句逐字**,正式庫 live 值 = repo 字面):

  | job | 原 command(逐字) | 新 command |
  |---|---|---|
  | `pcm-expire-unpaid-orders` | `SELECT pcm_cron.expire_unpaid_orders(500)` | `SELECT pcm_cron.expire_unpaid_orders(500); SELECT pcm_cron.ping_healthcheck('pcm-expire-unpaid-orders');` |
  | `pcm-settle-retry` | `SELECT public.pcm_settle_retry_sweep();` | `SELECT public.pcm_settle_retry_sweep(); SELECT pcm_cron.ping_healthcheck('pcm-settle-retry');` |
  | `pcm-late-payment-sweep` | `SELECT pcm_cron.late_payment_pending_refund_sweep()` | `SELECT pcm_cron.late_payment_pending_refund_sweep(); SELECT pcm_cron.ping_healthcheck('pcm-late-payment-sweep');` |
  | `pcm-acl-digest` | `SELECT public.pcm_acl_digest_record();` | `SELECT public.pcm_acl_digest_record(); SELECT pcm_cron.ping_healthcheck('pcm-acl-digest');` |
  | `pcm-net-exposure` | `SELECT public.pcm_net_exposure_record();` | `SELECT public.pcm_net_exposure_record(); SELECT pcm_cron.ping_healthcheck('pcm-net-exposure');` |

  原句出處:`20260809170000:78`、`20260905220000:230`、`20260905180000:431`、`20260905140000:314`、`20260908030000:317`;2026-09-15 唯讀 live 值逐字相同。新句不照範本拼接,避免出現 `;;`(不影響執行,但 rollback 要逐字還原)。
- `[R1]` 前置閘(照 `20260915120000:73-117`,**不鎖列**):逐支讀 `cron.job` ⇒ 不存在 / command ≠ 原句 / `active` ≠ t / `username` ≠ `postgres` / `database` ≠ `postgres` ⇒ `RAISE EXCEPTION`;已是新句 ⇒ NOTICE 冪等。
- `cron.alter_job(job_id, command => 新句)`:只動 command(`alter_job` 只改有傳進去的欄位,username 不動)。
- 事後比對:command = 新句、`schedule` / `active` / `username` 與前置閘讀到的值相同;任一不符 ⇒ 整筆回滾。
- `[R1]` 後置 ACL 斷言:`ping_healthcheck` 的 `proacl` 只剩 owner(`aclexplode` 寫法照 `20260905220000:270-279`)。

### `[R1]` 4-D 既有閘:查過,不會紅也不需要改
- `scripts/cron-allowlist-drift-gate.py`、`scripts/cron-live-drift-check.py`:只比排程**名字**。
- `cron-heartbeat-read.test.ts:254-262`:只解析 `cron.schedule`,看不到 `alter_job`。
- `CRON_JOB_WHITELIST`:沒有 command 欄。
- 釘住 command 的只有已貼的歷史 migration 自己的事後斷言(`20260905180000:504` 逐字;其餘 LIKE),重播順序在前,不受影響。
- 每日 ACL 摘要 `pcm_acl_digest()` 的 FN 族只掃 `public`(`20260909060000:136-142`)⇒ 新的 `pcm_cron` 函式**不改指紋,不用跑 approve**。
(以上為審查 R1 盤點;開工時設計窗逐檔抽核。)

### 4-E runbook / 網站側
- `healthchecks-wiring-acceptance.md`:標題與表格改成 10 支;缺口那一節加刪除線指到本片;補一句「pg_net 壞了 ⇒ 10 支會一起沒報到(原本那 5 支 route 也走 pg_net)」。
- `heartbeat.ts` 的 `notApplicable` 註解改字面(「純 SQL,由 DB 端報到」),不改邏輯。

## 5. 影響

- 客人:無。
- 資料庫:每 10 分鐘多 2 個、每小時多 1 個、每天多 2 個 `net.http_get`。
- 監控面板:5 → 10 支;**secret 設好之前新 check 停在 `new`,`new` 不會叫** ⇒ 驗收讀 API 的 `status` / `n_pings`。
- `[R1]` pg_net 壞了 ⇒ **10 支**一起沒報到(不是 5 支)⇒ 那是外送壞了的正確警報。

## 6. Rollback

- `[R1]` **同一個交易、順序承重**:先 `cron.alter_job` 把 5 支 command 改回 §4-C 原句逐字 ⇒ 事後比對 ⇒ **再** `DROP FUNCTION pcm_cron.ping_healthcheck(text)`。反過來的話,DROP 到改回之間的每一輪排程都會 failed。
- Vault secret 留著無害;healthchecks.io 那 5 個 check 暫停(Sean)。
- 不動任何金流函式本體 ⇒ rollback 不涉及錢。

## 7. 驗收

拋棄式 PG = `~/pcm-mailbox/schema-dump-20260915/up.sh`(有掛 `pg_cron`;先照版本號順序套貼板 178–184)。本機 pg_cron 1.6(正式 1.6.4)。
0. `[R2]` 正式庫 `cron.use_background_workers = off`(§2 #14)⇒ 拋棄式 PG **只測 libpq 模式**:起叢集時明設 `-c cron.use_background_workers=off`,測前 `SHOW cron.use_background_workers` 確認是 `off`。
1. **前提實測(過不了就停,不寫碼)**:排一支測試 job,command = 「會丟錯的函式; 寫一列紀錄的函式」⇒ 第二句沒寫、`job_run_details` = failed。對照:第一句不丟錯 ⇒ 第二句有寫。
2. `[R1]` 反方向:第一句成功寫入、第二句丟錯 ⇒ **第一句的寫入回滾** + failed(證明 §3-2 的風險是真的、也證明 handler 必要)。**用非 superuser 角色建 job 與執行**(§2 #12)。
   `[R2]` ⚠️ libpq 模式下 pg_cron 要**以該角色從本機登入** ⇒ 測前先設好那個角色的密碼與 `pg_hba`(或 `.pgpass`),並用 `psql -U <角色>` 登入一次確認;不然測試會因為登入失敗而紅,跟前提無關。
3. `ping_healthcheck`:
   - 心跳閘:本輪沒成功心跳 ⇒ `net.http_request_queue` 0 列;有 ⇒ 1 列。`[R1]` 特例:讓 `late_payment_pending_refund_sweep` 一張單失敗 ⇒ 0 列。
   - 表外名字 / 讀不到 secret / 前綴不對 ⇒ 只 log、0 列、不丟錯。
   - 函式裡丟 `query_canceled`(`pg_cancel_backend` 或 `statement_timeout`)⇒ 被接住、原函式寫入保留。`[R2]` `statement_timeout` **只設在 ping 那一句**(包一層 `SET LOCAL` 再呼叫),不設整個 session ⇒ 不然第一句可能先逾時,測到的是別的東西。
   - UA header = `pcm-db/<job>`。
4. 前置閘:command 被改過 / `active = f` / `username` 不是 postgres ⇒ 各自 RAISE、整筆回滾;冪等重跑 ⇒ NOTICE。
5. ACL:`proacl` 只剩 owner。
6. Rollback 檔:同交易先改回再 DROP;改回後 command 與原句逐字相同。
7. **正式庫貼上後**(Sean 設好 check 與 secret 之後):照 runbook,**在每一支下一次預定執行時刻之後**讀 healthchecks API,5 支 `status = up`、`n_pings > 0`。
   `[R2]` **核對沒貼反 = 一次只貼一個 secret 的流程**(主要做法,不靠 API 欄位):
   1. 5 個 check 都建好、secret 都還沒貼 ⇒ 讀 API,5 支都是 `new`、`n_pings = 0`。
   2. Sean **一次只貼一個** secret。
   3. 等那一支**下一次預定執行時刻之後**讀 API:**只有那一支** `new → up`(`n_pings 0 → ≥1`),其餘還沒貼的仍是 `new`。
   4. 對了才貼下一個。**`pcm-settle-retry` 與 `pcm-late-payment-sweep` 分在不同的 10 分鐘窗貼**(兩支同週期,同一窗貼就分不出誰是誰)。
   5. 每日兩支(00:00 UTC)各等一次執行,可以分兩天,或同一天先貼一支、跑過確認再貼另一支。
   - User-Agent 只作輔助參考(§4-C `[R2]`)。
- ~~故意停一支排程確認會叫~~(Sean 沒同意,不做)。
- `[R1]` codex 缺席到 09-20 ⇒ 實作完再過一輪專案版 adversarial-reviewer。

## 8. 要批的

> ✅ **2026-09-15 已答**(主視窗轉述):Q1 = 甲;Q2 = 不做。以下保留原題作為決策軌跡。

```
Q1:走哪條路?
A:  甲 資料庫自己報到, 只改排程指令(⇒ Sean 選甲)| 乙 改 5 支函式本體 | 丙 網站新開 route 代看

Q2:驗收要故意停一支排程, 確認真的會叫嗎?
A:  甲 要 | 乙 不做(⇒ Sean 沒同意, 不做)
```

## 9. 估時

前提實測(含非 superuser、反方向)~40 分;migration + 前置 / 事後閘 + ACL ~60 分;rollback 檔 + 驗 ~20 分;runbook ~15 分;Sean 建 check 與貼 secret ~15 分;上線後驗收要等每日那兩支跑過一次。
