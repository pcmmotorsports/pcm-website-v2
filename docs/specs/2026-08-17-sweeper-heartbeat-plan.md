# Plan:sweeper 心跳表 + 公開健康端點(鐵則 8 + 12③ ⇒ **✅ Sean 已批**)

> ## 🔴 2026-08-18 更正 —— 原檔頭寫「尚未批准,未動任何 code」,而他早就批了
>
> ~~**狀態**:🔴 **尚未批准,未動任何 code**~~ ⇒ **原句保留劃掉,不刪。**
> **批准早於本次更正** ⇒ 那句在被讀到的每一天都是假的。
> 而它比「等批」更毒:**「未動任何 code」是一句禁止句,下一個窗讀到會直接放下。**
>
> ✅ **Sean 2026-08-17 夜拍 `Q2` = 甲′**,逐字(**I 窗當場開檔核過,不是轉來的** —— 本檔「提出」欄是 E 窗,而這一句是 I 窗寫的;merge 之後裸「我」會指錯人):
> ```
> memory project_0817-night-four-rulings-and-env-literals.md:26
> 「Q2 sweeper 心跳表 | A（＝我推薦的）批甲′ | 單列三值 last_success_at /
>   last_failure_at / consecutive_failures。plan 在
>   docs/specs/2026-08-17-sweeper-heartbeat-plan.md。
>   動 schema ⇒ 鐵則 8＋12③，【這一批就是那個批准】」
> ```
> 🔴 **那條 memory 直接指名本檔** ⇒ 沒有「是不是在講這一份」的模糊空間。
>
> ### 現況(2026-08-18)
> ```
> 心跳表 migration  ✅ code 已落地
>                      supabase/migrations/20260817070000_m4b_231_3_sweeper_heartbeat.sql
>                   🔴 而【未 apply 到任何真實 DB】
>                      apply runbook: docs/reviews/2026-08-17-heartbeat-e683-apply-runbook.md
> 寫入端            ⏳ 一行都沒開始。🔴 沒有東西在寫的心跳表【不會心跳】
>                      ⇒「sweeper 從沒跑過」與「sweeper 死了」在健康端點上印同一件事
> 健康端點          ⏳ 未做。E-701 §2-3 已先處理一半（零列 ⇒ 503、
>                      🔴 絕不可回 secondsSinceLastSuccess: 0 —— 0 秒會被讀成「剛剛才跑」＝最壞的假綠）
> ```
> ⚠️ **「寫入端在不在 `Q2` 甲′ 的批准範圍內」= 主視窗 2026-08-18 裁定「在」**
> (理由逐字:「他批的是要有心跳,不是要有一張表」)——**那是主視窗裁定,不是 Sean 逐字**。
> 🔴 **兩種來源在同一份檔裡。不要合併引用,三個月後沒人分得出來。**

- **提出**:E 窗(資安稽核,唯讀)　**日期**:2026-08-17　**狀態**:✅ **已批**(見上方更正段)
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

> ## 🔴🔴 1b **做不了 —— 硬卡在 apply,而這是量到的不是推的**(2026-08-18 B 窗)
>
> `sweeper_heartbeat` **不在 `database.types.ts` 裡**
> (`grep -c 'sweeper_heartbeat' packages/adapters/src/supabase/database.types.ts` ⇒ **0**)——
> 那份是**從真實 DB 生成**的,而本表的 migration **還沒 apply 到任何真實 DB**。
> ⇒ `supabase.from('sweeper_heartbeat')` **通不過 typecheck**。
>
> **我寫了一個拋棄式探針實測,不是讀 code 推的**:
> ```
> 探針：createSupabaseServiceClient().from('sweeper_heartbeat')
>         .upsert({ job_name: 'settle-sweep', last_success_at: … })
> 實得：error TS2769  No overload matches this call
>       error TS2353  'job_name' does not exist in type 'RejectExcessProperties<…44 more…>'
>       Tasks: 6 successful, 8 total（storefront typecheck 紅）
> 探針已刪，git status --porcelain 空
> ```
>
> ### ⇒ 真正的順序鏈(而它的頭在 Sean 手上)
> ```
> Sean apply migration（runbook: docs/reviews/2026-08-17-heartbeat-e683-apply-runbook.md）
>   ↓
> supabase gen types 重生 database.types.ts
>   ↓
> 1b 寫入端才做得了
>   ↓
> 1c 健康端點才有東西可讀
> ```
> 🔴 **這不是「還沒開始」,是【開不了工】。** 兩者在進度表上長得一樣,而處置完全不同:
> 前者要派人,後者要**Sean 按一個鈕**。
>
> ### 📎 而這是 repo 既有的慣例,不是我發明的例外
> `docs/phase-1-backlog.md:12778` 逐字:
> > 片 A2 = adapter 換源 + admin + 測試 ⇒ ⏸ **等 A1 apply 後 `supabase gen types` 才能開工(型別雞生蛋)**
>
> ⇒ **不要繞過它**(手改生成檔 / `as any` / 自建型別)——
> 那會讓「型別與真實 schema 不同」變成一個**沒有任何東西會紅**的狀態,
> 而生成檔下次重生時會把手改的部分**靜默蓋掉**。
>
> ### ⚠️ 而 1b 的規格本身仍然缺兩件(apply 之後才會撞到,先寫下來)
> ```
> a) 失敗輪要不要寫 last_failure_at / consecutive_failures？
>    §1b 只寫了「失敗輪不寫 ok」—— 那是【不寫成功】，不等於【要寫失敗】
>    而表上那兩欄（migration :57-58）就是為這件事開的 ⇒ 不寫的話它們永遠是初值
> b) 心跳寫入自己失敗時怎麼辦？
>    🔴 它【不可以】改變 route 的回應 —— 否則「監控」會把「被監控者」弄壞
>    ⇒ 必須 best-effort + 自己吞掉例外，而【吞掉】這件事要留一條 log
> ```

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
⚠️ **限定**:「巡邏跑在雲端、與被監控者零共用基礎設施」是**主視窗轉述,E 窗未親讀該 routine ⇒ 未確認**。若成立,則它**同時解掉層二**;若不成立,**層一仍然由本 plan 解掉**。

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
