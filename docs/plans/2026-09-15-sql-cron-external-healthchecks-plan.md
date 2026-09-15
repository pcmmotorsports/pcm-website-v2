# 2026-09-15 · 五支純 SQL 排程接上外部存活監控(healthchecks.io)—— plan

> 設計窗。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P2-1**;缺口原文在 `docs/runbooks/healthchecks-wiring-acceptance.md:93-103`。Sean 逐字「依照建議」= 先寫計畫。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼、零 migration。** 碰 `cron.job` 指令 + 新 DB 函式 + Vault secret ⇒ 鐵則 8 + 12(CI / cron / env),等批。
> 事實由設計窗 2026-09-15 親讀 repo 核對;正式庫只唯讀。

## 1. 白話

- 網站有 10 支定時排程。其中 5 支是「呼叫網站 API」的,每跑成功一次會去外部監控站 healthchecks.io 報到,**哪天沒報到,監控站會叫。**
- 另外 5 支是**直接在資料庫裡跑的 SQL**,**從來沒有報到**。它們停了,外面一聲都不會出。其中兩支在金流路徑上:
  - `pcm-settle-retry`(匯款單重算失敗的補救)
  - `pcm-expire-unpaid-orders`(逾期未付自動取消)
- 網站裡雖然有一支「順便代看」的檢查,但**只看那兩支金流的**,而且它自己跑在網站上 ⇒ **網站整個掛掉時,它也一起掛,沒有人叫。**
- 本 plan:讓這 5 支 SQL 排程**跑成功之後,由資料庫自己去 healthchecks.io 報到**,不經過網站。
- 今天的狀況:5 支都正常在跑,過去 7 天 0 次失敗(下面有數字)。**這是「壞了會不會有人知道」,不是「現在壞了」。**

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 正式庫 `cron.job` 10 支,全部 `active = t` | 2026-09-15 唯讀 `SELECT jobname, schedule, active FROM cron.job` |
| 2 | 已接 healthchecks 的 5 支:`pcm-settle-sweep`(*/2)、`pcm-order-ineligible-gate`(*/2)、`pcm-email-sweep`(*/5)、`pcm-capture-recheck`(*/10)、`pcm-anomaly-alert`(0 1,13) | 同上;`docs/runbooks/healthchecks-wiring-acceptance.md` |
| 3 | 沒接的 5 支與排程:`pcm-expire-unpaid-orders` `0 * * * *` · `pcm-settle-retry` `*/10` · `pcm-late-payment-sweep` `*/10` · `pcm-acl-digest` `0 0 * * *` · `pcm-net-exposure` `0 0 * * *` | 同 #1 |
| 4 | 這 5 支 2026-09-15 唯讀量:7 天內 `runs_7d` = 168 / 1008 / 1008 / 7 / 7,`non_success_7d` 全 0;最後執行 07:00–07:40 UTC(兩支每日的是 00:00 UTC) | `cron.job_run_details` 唯讀查詢 |
| 5 | 各自呼叫的函式(最新一代):`pcm_cron.expire_unpaid_orders` `20260906600000:175` · `public.pcm_settle_retry_sweep` `20260905220000:72` · `pcm_cron.late_payment_pending_refund_sweep` `20260905180000:125` · `public.pcm_acl_digest_record` `20260909060000:230` · `public.pcm_net_exposure_record` `20260908030000:256` | `bash scripts/latest-definition-of.sh <名>` |
| 6 | 5 支函式**成功時都寫** `public.sweeper_heartbeat`(DB 內心跳) | `20260906600000:345`、`20260905220000:203`、`20260905180000:341`、`20260909060000:294`、`20260908030000:296` |
| 7 | 站內代看:`capture-recheck` route 順路呼叫 `get_cron_heartbeat_stale_counts`(讀 `sweeper_heartbeat`),**只看 `MONEY_CRON_JOB_NAMES = ['pcm-settle-retry', 'pcm-expire-unpaid-orders']`** | `apps/storefront/src/app/api/cron/capture-recheck/route.ts:191-224`、`packages/domain/src/ops/cron-jobs.ts:192`、`20260831170000:58`(`:66` LEFT JOIN `sweeper_heartbeat`) |
| 8 | 網站側的外部報到 helper `pingExternalHeartbeat`:只接受 `https://hc-ping.com/` 開頭;沒設網址只 `console.error` 不中斷;`pcm-expire-unpaid-orders` 標 `notApplicable`(純 SQL) | `apps/storefront/src/lib/cron/heartbeat.ts:243-268`、`:283-300` |
| 9 | 報到模型是「**只報成功**」:不送 `/fail`,靠 healthchecks 的寬限時間逾時判死 | `docs/runbooks/healthchecks-wiring-acceptance.md`(小幫手摘要,設計窗未逐行重讀,**吻合但未證實**) |
| 10 | 正式庫已裝 `pg_net` 0.20.0;repo 已有「SQL 經 `net.http_get` 發 HTTP、網址與金鑰從 Vault 讀」的現成寫法 `pcm_cron.invoke_cron_route(p_path)` | 2026-09-15 唯讀 `pg_extension`;`20260723120000_m3_s2_settle_sweep_pgcron.sql:96-121` |
| 11 | 那 5 支已接的 HTTP 排程,`cron.job.command` 就是 `SELECT pcm_cron.invoke_cron_route('/api/cron/…')` ⇒ **正式庫已經每 2 分鐘在用 pg_net 往外打** | 同上 `:124-125` |
| 12 | repo 沒有任何 Vercel cron(`vercel.json` 無 `crons`);排程全部由 pg_cron 觸發 | 小幫手 grep,設計窗未逐檔重讀 |

## 3. 做法:三條路

| | 甲 SQL 自己報到(推薦) | 乙 改函式本體報到 | 丙 網站新開一支 route 代看 |
|---|---|---|---|
| 怎麼做 | 新增 `pcm_cron.ping_healthcheck(p_job text)`:從 Vault 讀 `hc_ping_<job>`,`net.http_get` 打出去,整段吞錯只 `RAISE LOG`。**改 `cron.job.command`** 成 `SELECT <原函式>(…); SELECT pcm_cron.ping_healthcheck('<job>');` | 5 支函式各自在寫 `sweeper_heartbeat` 成功那一段後面呼叫 `ping_healthcheck` | 新 HTTP route 讀 `sweeper_heartbeat` 5 支,新鮮就逐支 ping |
| 不經過網站 | ✅ | ✅ | ❌ 網站掛了一起掛 |
| 動金流函式本體 | ❌ 不動 | 🔴 要 `CREATE OR REPLACE` 5 支(兩支在金流路徑) | ❌ |
| 「成功才報到」的保證 | 靠 pg_cron 對多語句指令的行為(見下 ⚠️) | 最明確:寫在成功分支裡 | 靠心跳時間戳 |
| 新東西 | 1 支函式 + 5 個 Vault secret + 改 5 列 `cron.job` | 1 支函式 + 5 個 secret + 改 5 支函式 | 1 支 route + 1 列 `cron.job` + 5 個 env |

⚠️ **甲的前提未證實**:pg_cron 對「`SELECT a(); SELECT b();`」這種指令,**第一句丟錯時第二句會不會跑**。開工第一步在拋棄式 PG(同版 pg_cron 1.6.4)造一支會丟錯的函式實測:
- 第二句不跑 ⇒ 走甲。
- 第二句照跑(會把失敗也報成成功)⇒ **停,改走乙**,回報。

🔴 **不用 `/fail`**:與既有 5 支同一個模型(事實 #9),兩套模型並存會讓看面板的人讀錯。

## 4. 範圍(以甲為準)

1. **healthchecks.io 端(Sean 或主視窗操作)**:新建 5 個 check。週期與寬限:
   - `pcm-settle-retry`、`pcm-late-payment-sweep`:10 分 / 寬限 20 分
   - `pcm-expire-unpaid-orders`:60 分 / 寬限 30 分
   - `pcm-acl-digest`、`pcm-net-exposure`:1 天 / 寬限 2 小時
   - 通知管道比照既有 5 支。
2. **Vault(Sean 貼)**:5 個 `hc_ping_pcm_<job>` secret,值是 `https://hc-ping.com/<uuid>`。🔴 ping 網址等於寫入權限,**不進 migration、不進 repo、不進 `cron.job.command`**(同 `invoke_cron_route` 讀 `cron_secret` 的做法)。
3. **migration**:
   - `pcm_cron.ping_healthcheck(p_job text)`:SECURITY DEFINER、`search_path = ''`、只接受 `https://hc-ping.com/` 開頭(同 `heartbeat.ts` 的前綴閘)、secret 不存在 ⇒ `RAISE LOG` 後 return(**不 RAISE**,監控不准弄壞被監控的東西)、`timeout_milliseconds` 5000。EXECUTE 只給 postgres(pg_cron 的執行者),其餘全 REVOKE。
   - `cron.alter_job` 改 5 列 command;前置閘先驗每一列現況 command 逐字等於 repo 的那一版,不是就停。
4. **runbook**:`healthchecks-wiring-acceptance.md` 標題與表格改成 10 支,缺口那一節加刪除線 + 指到本片。
5. **網站側**:不動。`heartbeat.ts` 的 `notApplicable` 註解改字面(「純 SQL,由 DB 端報到」),不改邏輯。

## 5. 影響

- 客人:無。
- 資料庫:每 10 分鐘多 2 個、每小時多 1 個、每天多 2 個 `net.http_get` 請求(pg_net 非同步,不佔排程的交易時間)。
- 監控面板:check 從 5 支變 10 支;**新 check 在 Vault secret 設好之前會停在 `new`,`new` 不會叫** ⇒ 驗收一定要讀 API 的 `status` 與 `n_pings`,不是看顏色(同 runbook 既有要求)。
- 🔴 pg_net 的請求佇列若本身卡住,**5 支都會同時變成「沒報到」** ⇒ 面板會一次亮 5 支。那是正確的警報(外送壞了),不是 5 支排程都壞了;runbook 要寫這一句。

## 6. Rollback

- `cron.alter_job` 把 5 列 command 改回原字面(rollback 檔逐字寫死原 command)。
- `DROP FUNCTION pcm_cron.ping_healthcheck(text)`。
- Vault secret 留著無害;healthchecks.io 那 5 個 check 暫停(不刪,保留歷史)。
- 不動任何金流函式 ⇒ rollback 不涉及錢。

## 7. 驗收

1. 拋棄式 PG:pg_cron 多語句指令第一句丟錯 ⇒ 第二句不跑(§3 ⚠️ 的判準,**過不了就不走甲**)。
2. 拋棄式 PG:`ping_healthcheck` 對不存在的 secret ⇒ 只 `RAISE LOG`、不丟錯;對非 `hc-ping.com` 開頭的值 ⇒ 拒絕 + log。
3. ACL:`anon / authenticated / service_role / pcm_readonly` 對 `ping_healthcheck` 都沒有 EXECUTE。
4. 正式庫貼上後:照 runbook 做法,**在每一支下一次預定執行時刻之後**讀 healthchecks API,5 支 `status = up` 且 `n_pings > 0`。
5. 負對照:暫停其中一支(`cron.alter_job(active := false)`,選每 10 分的 `pcm-late-payment-sweep`)⇒ 寬限過後那一支變 `down` 並收到通知 ⇒ 恢復。**這一步要 Sean 同意才做**(會真的發一次通知)。
- codex 一輪(cron / env / 對外請求)。

## 8. 要批的

```
Q1:走哪條路?
A:  甲 資料庫自己報到, 只改排程指令(推薦):不動金流函式本體;前提是 pg_cron 第一句失敗時不跑第二句, 開工先實測, 不成立就停回報
  | 乙 改 5 支函式本體, 在成功那段報到:最明確, 但要重寫兩支金流函式
  | 丙 網站新開 route 代看:最簡單, 但網站掛了一起掛(就是今天這個洞)

Q2:驗收第 5 步(故意停一支排程, 確認真的會叫)要做嗎?
A:  甲 要(推薦):選非金流的 pcm-late-payment-sweep, 停 30 分鐘內恢復;會真的收到一次通知
  | 乙 不做:只看 5 支都 up
```

## 9. 估時

拋棄式 PG 實測前提 ~20 分;migration + ACL 驗 ~40 分;runbook ~15 分;healthchecks 建 check 與 Vault 貼 secret 由 Sean / 主視窗(~15 分);上線後驗收要等最久那支(每日)跑過一次。
