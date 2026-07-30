# D1 線交接 —— 2026-07-29 傍晚

> ## 🛑 2026-07-30 上午 Sean 拍板:D1c 永久刪除**取消**
>
> 本檔以下全部內容以「要刪 26 張」為前提,**該前提已作廢**。
> 現行入口 = `docs/runbooks/2026-07-30-d1b1-d1b2-d1c.md` 檔頭的停用區塊(含實測查到的
> TapPay 三處欄位假設錯誤),決定與理由落在 memory `project_m4b-d1c-delete-cancelled`。
>
> **已實跑到哪**:D1b1 跑過一次(`readback-aborted`,證據檔 `~/.pcm-d1/d1b1-evidence-20260730.json`);
> D1b2 / D1c **一步未跑**,正式站零寫入。
> **§⑩ 那張表的「證據等級 = 系統 read-back」對 0064/0090 已不成立**(改為 `official-no-hit`)。
>
> **接手者請改看**:「29 張全部改號(可逆)取代刪除」提案。

> **新 session 讀這一份 + `STATUS.md` 就能接手 D1b1。**(D1t1/D1t2/D1t3 已於 2026-07-29/30 完成)
> 上游總規劃 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(§5.0 順序、§5.1 片表、§8.4 步驟)。
> 第 1 批整體入口仍是 `docs/handoff/2026-07-29-e10-batch1-handoff.md`;本檔只講 D1 線。

---

## ① 現在在哪裡

D1 線十四片,**D1a0-D1a6 + D1t1/D1t2/D1t3 完成**(執行器與它的負測全部收工)。
下一片 = **D1b1(TapPay read-back;🔴 打真 TapPay 正式商戶,必須 Sean 在場)**。
施工前設計盤點 = 本檔 §⑩。

| 片 | 狀態 |
|---|---|
| D1a0 環境守門 / D1a1 匯出腳本 / D1a2 正式匯出 / D1a3 還原號映射 | ✅ |
| D1a4 · D1a5 兩支還原腳本 / D1a6 還原演練 | ✅ 演練實跑通過 |
| D1t1 交易核心 | ✅ 2026-07-29 晚(4 模組 + 25/25 突變紅) |
| D1t2 CLI + dry-run + 隔離 DB 實跑 | ✅ 2026-07-30 凌晨(三段全過 + 10/10 突變紅;harness = `d1t2-rehearsal.sh` provision\|scenarios\|teardown) |
| D1t3 timeout·rollback 整合負測 | ✅ 2026-07-30 凌晨(規格 row 18 ①-⑥ 六項全對真 PG17 實跑 + 兩段等長消融 + 突變 7/7 紅) |
| **D1b1 TapPay read-back** | 🧱 **程式碼就緒**(`1db5263`;CLI `readback` 動作、隔離庫實跑過正反兩向)⬅️ **只差實跑,🔴 打真 TapPay 正式商戶 = Sean 必須在場**;細節見 §⑩ |
| D1b2 dry-run 證據包 | 未開工 |
| 🔴 Sean 批准閘 → D1c apply(唯一不可逆) | 未開工 |
| ~~D1a7 post-n3c 演練~~ | **已移出第 1 批**(Sean Q2=A,改排第 2 批 N3a 之後) |

---

## ② 備份現況(D1c 的硬前置)

- **檔案:** `~/d1-backup-20260729-v2.tar.gz.age`(Sean 機器,`age -p` 加密,密碼在 1Password)
- **內容:** 十六份 CSV(15 張表 + cohort manifest)+ `checksums.txt`
- **匯出時間:** 2026-07-29 10:06:04 UTC(台灣 18:06)
- ⏰ **24 小時時效 → 2026-07-30 台灣 18:06。逾時未執行 D1c 必須重跑 D1a2**
  (操作包 `docs/runbooks/2026-07-29-d1a2-cohort-export.md`)
- 🔴 **早上第一版(11 表、缺五張父表)已作廢**,Sean 已改名為 `作廢-缺父表-…`;`preflight` 會主動擋下它

---

## ③ 這一輪的拍板(權威版在 memory `project_m4b-d1-restore-backup-completeness`)

| 題 | 結論 |
|---|---|
| **Q1=A** | 匯出補五張父表(customers / customer_addresses / products / product_variants / legal_terms_versions)—— cohort **指向**它們,`orders→customers` 是 `ON DELETE RESTRICT`,**D1c 刪掉訂單那一刻這層保護就消失** |
| **Q3=A** | `auth.users` **不備份**(含密碼雜湊)。🔴 殘餘風險 = 客人自刪帳號則該筆救不回,**Sean 明列後拍板接受** |
| **Q2=A** | D1a7 移出第 1 批(需 N3a 的 `pcm_generate_display_id()`;post-n3c 還原本來就只在第 3 批 N3c 後才用得到) |

---

## ④ D1a6 演練驗到了什麼(以及沒驗到什麼)

**做法:** 本機拋棄式 PostgreSQL 17.10 → 套用 84 支 migration → 造一份與正式站 cohort **逐格同筆數**的資料
→ 跑**真正的匯出腳本** → 模擬 D1c 刪除(含刪掉 9 個父商品)→ 跑**真正的還原腳本** → 新連線重數。

✅ 十五張表重數全符 / 運送快照沒被 trigger 覆寫(3 張誘餌單原值保住)/ trigger 已復原 /
父表從備份補回 / 重複執行被擋 / **負向測試:把 Fable 的 BLOCKER 放回去 → 第一張父表就中止、整批 rollback、零寫入**

🔴 **誠實邊界(新 session 不要當成已驗):**
- **沒有用 Sean 那包真的加密備份**(解密需要他的 age 密碼)。用的是同一支匯出腳本現場產的等價 CSV。
  ⇒ 要補這一格:Sean 跑一次 `scripts/d1-rehearsal.sh`(會問密碼),約兩分鐘。
- `scripts/d1-restore.sh` 的 **TLS 那一步沒跑到**(本機沒有 Supabase 憑證,`verify-full` 必然失敗)。
- 環境是本機 PostgreSQL、**不是 Supabase**。角色與預設權限照正式站 `pg_default_acl` 實查值重建。
- `20260723120000` pg_cron 那支 migration **跳過**(需要正式站的 vault 密鑰)。

---

## ⑤ 🔴 D1t1 開工前必讀的三件事

### 5-1 規格已經把難的部分寫死了,不要重新設計

`docs/specs/…-master-plan-v2.md` **§8.4 步驟 8** 是逐字合約,涵蓋:
sweeper 停用/恢復的 crash-safe 順序(先寫 state 再停 job)、advisory lock single-flight、
run id 接管(CAS)、state-first 分流、`REPEATABLE READ`、鎖序 `orders → order_items →
payment_charge_attempts (FOR UPDATE NOWAIT) → pending_invoices`、
NOWAIT 失敗 = **不自動重試**、鎖畢斷言用 **failed/released 計數 12/9 + pending 三筆未變**
(**不是「全終態」** —— 那個斷言必然 fail,R22 已更正)。

### 5-2 TapPay client 不能直接 import adapter

`packages/adapters/src/tappay/TapPayChargeAdapter.ts:22` 逐字 `import 'server-only';`(2026-07-29 親驗),
**在純 node/tsx 載入即 throw**。
⇒ runbook 用獨立小 client:複用 `packages/adapters/src/tappay/wire.ts` 的解析與 Record API 組裝、
env 讀 Partner Key、斷言 `TAPPAY_ENV=production` + 正式商戶 merchant id、用 fetch 原生 30s `AbortSignal`。
**D1t2 單元測必須含「node 環境可載入」斷言。**

⚠️ 注意目錄是 `src/tappay/` **不是** `src/payment/`(我自己第一次就查錯目錄、差點把「查無」寫進交接檔)。

### 5-3 D1c 前置:兩張新表的零引用斷言

A2/A3 已 apply,`order_item_procurement`(經 `order_items`)與 `order_notes` 對 `orders`/`order_items`
都是 **`ON DELETE RESTRICT`**,而實際 apply 序是 A2/A3 先、D1c 後。
⇒ 鎖列後、DELETE 前必須先斷言兩者對 cohort **零引用**,非零即 abort 人工釐清。

---

## ⑥ 已建好、D1t1 可以直接用的東西

| 檔案 | 用途 |
|---|---|
| `scripts/d1-cohort.ts` | 26 刪 + 3 留的凍結名單 + 26 組還原新號。**import 時就守門**(筆數/格式/留存名單/還原號),production 跑 runbook 時測試不在場,這是唯一還生效的閘 |
| `scripts/d1-guard.ts` | `buildD1PgConfig`(離散欄位 + 強制 CA)、`D1_TRANSACTION_GUARD_SQL`(身分×2 + 叢集 + cohort 配對 29)、`PRODUCTION_CLUSTER_ID` / `PRODUCTION_PROJECT_REF` 單一來源 |
| `scripts/d1-export.ts` | `buildCohortSelectors(cohort, source)` = **匯出與還原共用的表清單與 selector**,FK 家長優先序。D1t1 的刪除順序應**沿用它的反序**,不要另抄一份 |
| `scripts/d1-restore.ts` | 兩支還原腳本 + `preflight` + 演練替身 + COMMIT 後重數 |
| `scripts/d1-restore.sh` / `d1-rehearsal.sh` | 還原執行器 / 一鍵演練 |
| `scripts/d1-orchestrator.ts` / `d1-orchestrator-cli.ts` | D1c 交易核心(六態結果)/ CLI(四動作 + 模式×目標 fail-closed 矩陣) |
| `scripts/d1-readback.ts` / `d1-readback-runner.ts` / `d1-tappay-client.ts` | §8.7 判定矩陣純函式 / 真 TapPay 與 fixture 兩版 runner / 獨立 Record client。**D1b1 直接重用這三支,不要另寫** |
| `scripts/d1t2-rehearsal.sh` | 隔離庫 `provision \| scenarios \| teardown`。**可被 `source` 重用**(D1t3 就是這樣接的);直接執行才走 dispatch |
| `scripts/d1t3-negative.sh` / `d1t3-idle-timeout-probe.ts` | 六項故障負測 harness(`all \| negatives <workdir> [stages]`)/ idle 逾時探針 |

---

## ⑦ 這一輪最該記住的一件事

**Fable 抓到的那個 BLOCKER,codex 兩輪 `gpt-5.6-sol` xhigh + 32 條突變測試,全都沒抓到。**

原因是它藏在「測試只讀腳本文字」驗不到的地方 —— 父表驗證的 live 側查了一張**當下必然是空的**表,
腳本長得完全正確,只有真的跑起來才會現形(而且是四種組合全滅、一次都跑不完)。

⇒ **D1t1 這種產生 SQL 的片,文字層測試 + 突變測試是必要條件,不是充分條件。**
D1t3 的隔離 DB 實跑負測**不可省略、不可降級**。

**2026-07-30 D1t3 收工後補一條同款教訓:負測 harness 自己也會假綠,而且更難察覺。**
本片施工中實際發生四次:①持鎖者用了 `count(*) … FOR UPDATE`(PG 非法語法)⇒ 一列都沒鎖到、
負測照樣「通過」;②`kill -9 $!` 殺到 bash 子 shell、orchestrator 變孤兒繼續跑向 COMMIT;
③`STAGES` 帶前導空白 ⇒ 六段**全部靜默跳過、exit 0**;④探針把 server 的 `25P03` 用客戶端
泛用訊息蓋掉 ⇒ 「為什麼被砍」的證據消失。
⇒ **每一段負測都要配一段「等長、同形」的消融**(拿掉受測條件後必須轉綠),
且**每一條新斷言都要有自己的突變**。沒有配對的負測 = 只證明了腳本跑得完。

---

## ⑧ 順帶開出來的 backlog(不擋 D1 線)

- **#299** 🔴 `product_fitments_effective` 整張正式表不在版控裡(148,716 列、PK、3 索引、5 CHECK、FK、RLS),
  4 支 migration 引用它 ⇒ **repo 現在沒辦法從零重建資料庫**,新環境一律卡在 2026-07-12。
  補上它之後 84 支全綠 ⇒ 它是唯一真因。
  🔴 **#298 的版本號守門抓不到這一類**(兩邊完全一致會回報「乾淨」)⇒ **先補齊(#299)再上守門(#298)**。
- **#298** CI 擋 migration 版本漂移(Sean 已拍板加,不插隊第 1 批)。

---

## ⑨ 安全事項

2026-07-29 操作過程中,**資料庫密碼一度被貼進對話**(該值實為錯誤密碼、認證失敗,非有效憑證),
已請 Sean 於 Supabase 重設 database password。

**紀律:** 貼終端機輸出前,含 `export D1_DB_URL=` 或 `postgresql://` 的整行一律刪除;
錯誤訊息本身不含密碼、可安全貼。診斷連線字串一律用
`echo "長度=${#D1_DB_URL} / 開頭=${D1_DB_URL%%:*} / 尾段=${D1_DB_URL##*@}"`(`@` 前面會被切掉)。

---

## ⑩ D1b1 施工前盤點(2026-07-30 過夜整理;**一行 code 都還沒寫**)

**唯一權威 = master plan v2 §8.7**(A0a-1 拍板後的條件改寫),**不是** §5.1 row 19 的舊字面。

| 對象 | 走哪條路 | 證據等級 |
|---|---|---|
| 0052 / 0064 / 0090 / 0102 / 0104 | 逐筆以 `rec_trade_id` 查、判定矩陣不降級 | 系統 read-back |
| **0101(唯一無鍵)** | **不查**;禁用 `bank_transaction_id` 等替代鍵 | **Sean 本人確認,非系統 read-back** |

**✅ 程式碼已就緒(2026-07-30 凌晨,commit `1db5263`)—— 走的是 A 案:CLI 第五個動作 `readback`。**
唯讀:兩句 SELECT(身分閘 + `READBACK_FACTS_SQL`)→ 五筆 keyed 打 TapPay → `judgeReadback` → 證據 JSON;
**不進 orchestrator、不開交易、不鎖列、不動 cron、不寫 state**。
(B 案「直接用 dry-run」被否決:它在 `REPEATABLE READ` 交易內會對 29 張正式站 orders `FOR UPDATE`、
對 attempts `FOR UPDATE NOWAIT` —— 取證不該付演練刪除的代價,而 dry-run(= D1b2)本來就排在後面。)

**🔴 從未打過任何 TapPay,一次都沒有。** 隔離庫實跑用的是 fixture。

實跑指令(**等 Sean 在場才可執行**):

```
D1_DB_URL=... pnpm exec tsx scripts/d1-orchestrator-cli.ts readback \
  --target production --merchant-id <從 TapPay 商家後台抄> --audit ~/.pcm-d1/d1b1-evidence.json
```

判定分流認 stdout 的 `D1-OUTCOME: readback-ok|readback-aborted`(**不要靠 exit code** ——
這兩個 outcome 不在 orchestrator 六態的 `D1_EXIT_CODES` 裡)。`readback-aborted` 時證據**照樣落盤**
(§8.7:出現 `0`/`4` = 保留 cohort、輸出證據、停下等 Sean)。

**🔴 開工前必問 Sean(不可自己決定):**

1. **`--merchant-id` 的第二來源** —— D1t1 就留下的未決題;production read-back 要 Sean 從 TapPay
   商家後台抄一組 merchant id 當雙輸入斷言。
2. **D1b1 實跑本身**(打真 TapPay 正式商戶)—— 過夜授權的禁區,Sean 必須在場。
3. 證據包的保存位置與保存期(匯出檔是 180 天;證據包尚未定)。
