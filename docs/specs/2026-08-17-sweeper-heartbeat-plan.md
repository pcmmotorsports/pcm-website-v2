# Plan:sweeper 心跳表 + 公開健康端點(鐵則 8 + 12③ ⇒ **等 Sean 批准**)

- **提出**:E 窗(資安稽核,唯讀)　**日期**:2026-08-17　**狀態**:🔴 **尚未批准,未動任何 code**
- **對應**:`docs/phase-1-backlog.md` `#231` ③「cron 靜默死偵測 heartbeat」
- **規格正本**:`docs/security/2026-08-17-sweeper-health-endpoint-spec.md`(本 plan 不重複規格細節,只講四節)
- 🔴 **命中**:鐵則 **12③**(DB 結構 / migration)+ 鐵則 **8**(跨檔、動 schema)⇒ **Sean 批准才執行**。

---

## 🔴 0. 先講清楚:這是「偵測缺口」,不是「正在燒」

**今天(2026-08-17)實測**:6h 窗 **180 列 = `*/2` 排程的理論值 ⇒ 零漏跑**;`errors` 僅 `08:04` **一發**且 `08:06`/`08:08` 自行恢復;ceiling 實測有效(`section1-unverified-items-round2` §5-d)。
⇒ **sweeper 現在是好的。** 本 plan 要補的是:**它哪天壞了,現在【要靠人去查才會發現】。**
⚠️ **不要把這份 plan 讀成緊急修復。**

---

## 1. 改什麼

### 1a. 新增 durable 心跳表(migration)

> 🔴🔴 **2026-08-17 已被取代 —— 本節的 append 型【未被採用】,不要照它做。**
> **Sean 批的是甲′ = 單列三值**(`last_success_at` / `last_failure_at` / `consecutive_failures`)。
> 主視窗端給他的選項原文就是「一列存三個值」,他回「`q1,q2 依照建議`」⇒ **他批的是他看到的那個設計。**
> 本節以下關於 `sweeper_run_log`(每輪 append 一列)的做法**保留供追溯**,但**不是要施工的東西**。
> 施工規格見 `~/pcm-mailbox/E-701-B窗兩份可施工規格-心跳表甲prime與E683-1-20260817.md` ②。
>
> 🔴 **甲′ 的代價,寫在這裡而不是只寫在信裡:甲′ 沒有歷史** —— 查不到「過去 24 小時失敗過幾次」,
> 只知道當下三個值。**這是刻意換掉的,不是漏做的**:本片要的是「它還活著嗎」,不是趨勢分析。
> 未來若真的需要「過去 N 小時」那個數字,那是**新開一片**(append 型或另一張表),
> 而**那時要一併決定保留策略** —— 那個問題只是被甲′ 繞過,沒有被解決。

**現況(量到的)**:全庫**沒有**任何 durable 的「sweeper 最後成功時間」。
量法:`pg_catalog` 全庫掃(🔴 **不能用 `information_schema`,它被權限過濾** —— 見規格 §5)⇒ `ts_cols_total = 97`(正向對照,述詞有判別力)/ `heartbeat_like = 1`,而那一個是 **別的 job 的** `product_fitments_effective_sync_log.ran_at`。

**三個「看起來可以用」的來源逐一排除**:

| 來源 | 為什麼不行 |
|---|---|
| `payment_charge_attempts.last_*_at` | **per-row**,不是 job 級 |
| `payment_webhook_events.processed_at` | 🔴 **最像而最危險**:sweeper **健康但沒事做**時它不前進,**與 sweeper 死掉一模一樣** ⇒ 兩個世界同值 |
| `net._http_response` | TTL **僅 6h**,且 `anon` 有 **TRUNCATE/DELETE**(`E686-1`)⇒ **可被抹掉的軌跡不能當健康來源** |

**做法**:新增 `public.sweeper_run_log`,**照同 repo 現成骨架** `product_fitments_effective_sync_log` 抄:
```
id bigint | ran_at timestamptz | status text | <幾個 counts int> | run_id uuid
```
🔴 **零 PII、零金額、零訂單編號、零 `rec_trade_id`。** 對 `anon` / `authenticated` **不授權**(現成骨架那張表對 `anon` 就是 `f`,實測)。
🔴 **`status='ok'` 只在 HTTP 200 **且** `errors=0` 時寫** —— 否則「一直在跑一直失敗」會被讀成健康。

### 1b. sweeper 每輪成功時寫一列
`settle-sweep` route 在回 200 前寫入。**失敗輪(503)不寫 `ok`。**

### 1c. 新增公開唯讀端點
```
GET /api/health/settle-sweep     公開、不需 secret
→ { "lastSuccessAt": "...", "secondsSinceLastSuccess": 132, "lastRunStatus": "ok" }
```
🔴 **不回 `{ ok: true }`**(在「剛跑完」與「兩天沒跑但服務還活著」兩個世界一樣)。
🔴 **門檻由巡邏那邊判,不由端點判**(端點自判健康 = 被監控者替自己打分數)。
🔴 **DB 讀不到 ⇒ 回 `503` 且 body 不含 `lastSuccessAt`**;零列 ⇒ `503` 或 `null`,**絕不可回 `0`**(`0` 秒會被讀成「剛剛才跑」= 最壞的假綠)。
🔴 **`force-dynamic` + `no-store`** —— 被 CDN 快取住的健康端點會**永遠回「剛跑完」**。
🔴 **不得 blind spread `...result`**(`E680-1` 形狀;本端點**是公開的**)⇒ 顯式挑三個欄位。

---

## 2. 為什麼(🔴 這一節是本 plan 的理由,不是背景)

`#231` ③ 自己寫的後果逐字:**「sweeper 死了沒人發現」**。**它成立,而且成因有兩層**:

**🔴 層一:告警的觸發條件,全部要靠 sweeper【活著】才會成立。**
`checkAnomalyAlerts` 的條件是 `open>0 || refundingStuck>0 || attemptManualReview>0 || releasedStuck>0` —— **沒有一條是「sweeper 沒跑」**。
而 `attemptManualReview` **要靠 sweeper 活著才會被推上去**(轉人工發生在 `attempt_count >= 8`,§5-d 已量證)
⇒ **sweeper 死掉 ⇒ 沒東西遞增 ⇒ 沒東西達 ceiling ⇒ 那個計數停在 `0` ⇒ 不告警。**
⇒ **死掉的 sweeper,在【正好用來報告它的那個計數器】上產生沉默。**

**層二:告警與被監控者共用同一套基礎設施。**
`pcm-settle-sweep` 與 `pcm-anomaly-alert` **同一支 migration、同一個 wrapper `pcm_cron.invoke_cron_route`、同一組 vault secret**(`20260723120000…:128-133`)⇒ **任一壞掉兩個一起停,而停掉的正是要來通知你的那個。**

**✅ 而修法很便宜,因為載體已經存在**:Sean 已有一個**每小時跑的雲端巡邏 routine**(claude.ai;唯讀 GET、不登入、會 `gh issue create` 且有防重複)。
⇒ **「會叫的那條路」已經有了**,我們缺的只是**一個它看得到的健康事實**。
⚠️ **限定**:「巡邏跑在雲端、與被監控者零共用基礎設施」是**主視窗轉述,我未親讀該 routine ⇒ 未確認**。若成立,則它**同時解掉層二**;若不成立,**層一仍然由本 plan 解掉**。

---

## 3. 影響面

| 面 | 影響 |
|---|---|
| **DB** | ~~+1 張表(`sweeper_run_log`)。每 2 分鐘 +1 列 ⇒ 約 720 列/日、26 萬列/年 ⇒ 要一併決定保留策略。~~ ✅ **2026-08-17 此格已關閉**:改採甲′(單列三值 upsert,`public.sweeper_heartbeat`,每個 job 永遠一列)⇒ **不會長大,沒有保留策略要決定**。🔴 但**問題是被繞過不是被解決** —— 哪天要 append 型歷史,這個決定要重新做。 |
| **app** | `settle-sweep` route +1 次寫入/輪;新增 1 支端點 |
| **對外** | 🔴 **新增一個公開端點** ⇒ 它會被掃描器打到。**內容零敏感**(時間+狀態+計數),但**要納入 WAF 觀察名單** |
| **Sean** | 需要在巡邏指令加一項(文字見 §5) |
| **不影響** | 金流邏輯、結算路徑、既有 cron 排程、`anomaly-alert`(**本 plan 不動它們**) |

---

## 4. Rollback

| 元件 | 回退 | 成本 |
|---|---|---|
| 端點 | **直接下線**(刪檔或改回 404) | 即時、零資料 |
| sweeper 的寫入 | 移除那一行寫入 | 即時 |
| `sweeper_run_log` 表 | **留著無害**(不被讀就只是佔空間) | 🔴 **但「留著」的成本要寫明**:①它會**繼續長大**(若已上線且未設保留策略)②**下一個人看到一張沒人讀的表,會不確定能不能刪** ⇒ **建議 rollback 時一併 `DROP`,或在表上加 `COMMENT` 說明它為何存在** |
| 巡邏指令那一項 | Sean 自行移除 | 即時 |

⇒ **本 plan 的每一件都可逆,且沒有資料遷移。**

---

## 5. 要請 Sean 加進巡邏指令的**確切文字**(草案)

> 另外請每次巡邏時多打這一支:
> `https://shop.pcmmotorsports.com/api/health/settle-sweep`
> - 它會回一個 JSON,裡面有 `secondsSinceLastSuccess`。
> - **如果那個數字大於 900(= 15 分鐘)**,或**這支回的不是 200**,請開一張 issue(標籤同現行的 `site-patrol`)。
> - 🔴 **判斷規則**:如果**這支不是 200、但首頁是 200** ⇒ 寫「結算兜底可能停了」;**如果兩支都不是 200** ⇒ 寫「整站或網路問題」。**這兩種要分開寫,處理方式不同。**

**`N = 900 秒` 的推導**(不是憑感覺):sweeper 排程 `*/2` ⇒ 正常間隔 2 分;要留餘裕給 ①單發 `503`(今天實測發生過一次)②退避造成的無事可做輪次 ③**巡邏本身每小時才跑一次**。⇒ 取 **15 分 ≈ 7 個排程週期**。
⚠️ **這是判斷不是量測** —— 上線後看誤報率再調。

---

## 6. 這份 plan **沒有**涵蓋的

- **`anomaly-alert` 自己死掉**的偵測(本 plan 只給 `settle-sweep` 心跳)。同樣的形狀、同樣的修法,**但不在本片**。
- **層二的根治**(告警與被監控者共用基礎設施)—— 本 plan **繞過**它(靠外部巡邏),**沒有拆掉那個共用**。
- **外部巡邏本身死掉**的偵測。⇒ 🔴 **監控鏈總有最後一環沒人監控**,這裡誠實標明它在哪:**Sean 的雲端 routine 就是最後一環。**

## 7. 口徑

🔴 **本檔 §1a 的 append 型設計已於 2026-08-17 被甲′ 取代**(見 §1a 檔頭框);§3 的保留策略未定案**隨之關閉**。
「全庫無 durable 心跳」= `pg_catalog` 實測 + 正向對照(97)。「巡邏零共用基礎設施」= **未親讀、未確認**。`N=900` = **判斷**。保留策略 = **本 plan 提出問題但未定案,要 Sean 或施工窗決定**。**本 plan 未實作、未執行任何一步。**
