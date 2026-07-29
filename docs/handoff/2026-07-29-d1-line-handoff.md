# D1 線交接 —— 2026-07-29 傍晚

> **新 session 讀這一份 + `STATUS.md` 就能接手 D1t3。**(D1t1/D1t2 已於 2026-07-29/30 完成)
> 上游總規劃 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(§5.0 順序、§5.1 片表、§8.4 步驟)。
> 第 1 批整體入口仍是 `docs/handoff/2026-07-29-e10-batch1-handoff.md`;本檔只講 D1 線。

---

## ① 現在在哪裡

D1 線十四片,**D1a0-D1a6 + D1t1 完成**。下一片 = **D1t2(CLI + dry-run)**。

| 片 | 狀態 |
|---|---|
| D1a0 環境守門 / D1a1 匯出腳本 / D1a2 正式匯出 / D1a3 還原號映射 | ✅ |
| D1a4 · D1a5 兩支還原腳本 / D1a6 還原演練 | ✅ 演練實跑通過 |
| D1t1 交易核心 | ✅ 2026-07-29 晚(4 模組 + 25/25 突變紅) |
| D1t2 CLI + dry-run + 隔離 DB 實跑 | ✅ 2026-07-30 凌晨(三段全過 + 10/10 突變紅;harness = `d1t2-rehearsal.sh` provision\|scenarios\|teardown) |
| **D1t3 timeout·rollback 整合負測** | ⬅️ **下一片**(重用 D1t2 provision;fake cron 介面 = Sean T-Q1=A) |
| D1b1 TapPay read-back / D1b2 dry-run 證據包 | 未開工 |
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

---

## ⑦ 這一輪最該記住的一件事

**Fable 抓到的那個 BLOCKER,codex 兩輪 `gpt-5.6-sol` xhigh + 32 條突變測試,全都沒抓到。**

原因是它藏在「測試只讀腳本文字」驗不到的地方 —— 父表驗證的 live 側查了一張**當下必然是空的**表,
腳本長得完全正確,只有真的跑起來才會現形(而且是四種組合全滅、一次都跑不完)。

⇒ **D1t1 這種產生 SQL 的片,文字層測試 + 突變測試是必要條件,不是充分條件。**
D1t3 的隔離 DB 實跑負測**不可省略、不可降級**。

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
