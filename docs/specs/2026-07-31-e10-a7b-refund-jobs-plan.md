# E10 第 1 批 · A7b「退款工作表 + 狀態機合約」片級 plan **v5**

> 🔴 **關卡1 四輪皆 FAIL,全部已折入本檔**:
> **R1** codex `gpt-5.6-sol` xhigh — 35 must-fix + 5 nit(`docs/reviews/2026-07-31-e10-a7b-k1-codex.md`)
> **R2** codex `gpt-5.6-sol` xhigh — 18 must-fix + 4 nit(`…-k1r2-codex.md`)
> **R3** **Fable(換模型 + 換四角度)** — 11 must-fix + 3 nit(`…-k1r3-fable.md`)
> **R4** codex(**只打 v3→v4 diff 的回歸角度**)— 7 must-fix(`…-k1r4-codex.md`)
> 四輪合計 **71 must-fix + 12 nit**,折入 71/71、駁回 0、改採不同修法 1(§13)。
> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 25(每輪逐字重寫)。
> 決策全文 = memory `project_m4b-a7b-refund-jobs-decisions`。
> 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構)⇒ 兩關對抗審查皆跑,不降級。

## 🔴🔴 讀本檔前必須先知道的兩件事

**一、v3 寫過一個形式證明,它成立、但問題選錯(R3 抓)。**
證的是「一代最多一個後繼」;要保證的是「**同一筆錢只退一次**」。
一個**已被 TapPay 受理**的退款進了 `dead`,若被結成「授權重試」,下一代會帶**全新的 `bank_refund_id`** ——
TapPay 的冪等鍵**不會擋**,錢真的出去兩次。⇒ §3.5。

**二、v4 為了修上一條而寫的承重論證,同樣不成立(R4 抓)。**
v4 說「`dead_reason='retry_exhausted'` 蘊含六次全部收到明確失敗回應 ⇒ 零金額移動」。
**那是把一個 worker 紀律講成了 DB 層證明。** `retry_exhausted` 只證明「呼叫者選了 E5b」,
不證明 TapPay 真的拒絕過六次。反例:HTTP 已送出、TapPay 已受理、worker 逾時、
worker **錯誤地**寫了 E5 ⇒ 戳記被清掉 ⇒ 最終合法拿到 `retry_exhausted`。
⇒ **D7 由「安全證明」降級為「必要條件」**,真正的擋點改由 **D9** 承接。⇒ §3.5。

🔴 **這兩件事是同一個病**:`feedback_control-named-beyond-its-actual-power` ——
**防護被命名成超出它實際能力的東西**。本檔所有「⇒ 所以安全」的句子都已重新檢查過一遍。

---

## §0 Sean 拍板

| 題 | 拍板 | 連動 |
|---|---|---|
| Q1(07-31 早) | **A**:A7-t 先單獨 apply + read-back,再套 A1 | 寫進 A1 plan §3.4 |
| Q2(07-31 早) | **A**:拆成 `A7b-M` + `A7b-T` 兩片 | master row 25 與 §5.0 DAG 已改 |
| Q3(07-31 早) | **B**:結案併發 = 鎖列 + `reviewed_at IS NULL` 當 CAS 條件 | 「結案 RPC 走 token CAS」字面已作廢 |
| Q4(07-31 早) | **B**:帳本快照另開子表 `order_refund_job_items` | 不採「隔日重算」 |
| **Q1(07-31 下午)** | **A**:**§0b 的 D1-D8 全部採用** | 本檔 §0b |
| Q2/Q3(07-31 下午) | **待答**(已用白話重問) | §14 |

---

## §0b 設計改動總表(**推翻 master row 25 既有字面;擋 apply、不擋寫 code**)

| # | 改動 | 為什麼(一句話) | 出處 | 狀態 |
|---|---|---|---|---|
| **D1** | 刪除 `retry_consumed_at` 欄 | 它是「後繼列存在」的抄本,零額外防護;戳它必須 UPDATE 一列已複核的 dead ⇒ 與「已複核 dead 永久凍結」互斥 | R2 #2 | ✅ Sean 拍 A |
| **D2** | 新增 `refund_call_attempted_at` | 沒有它,lease 過期分不出「還沒打 TapPay」與「打了但沒寫回」 | R2 #13 | ✅ |
| **D3** | 刪 E7、新增 E5b、E12 吃下第六次 | 第六次失敗必須**原子**進 dead | R2 #3 | ✅ |
| **D4** | dormant `CHECK (false)` gate | 「兩片同批 apply ⇒ 風險窗為零」已被證偽(兩支各自 COMMIT) | R2 #14 | ✅ |
| **D5** | 新增 `dead_reason` 值域 CHECK | dead 沒有可顯示的死因 ⇒ dead-review 畫面無東西可畫 | R2 #4 | ✅ |
| **D6** | 新增 E2b「退款呼叫戳記」edge | D2 要 worker 先 commit 戳記再發 HTTP,但沒有任何 edge 允許那個 UPDATE | R3 F4 | ✅ |
| **D7** | `retry_authorized` 鎖死在 `dead_reason='retry_exhausted'` | 擋掉兩種**明確已受理**的死因被授權重試 | R3 F5 | ✅ **但已降級,見 §3.5** |
| **D8** | 明文 break-glass 更正程序 | 結錯 `resolution` = 合約內永久死局 | R3 F6 | ✅ |
| **D9** | 🔴 **新增:重試授權的證據三條**(隔日閘 + Record 快照 + 下一代 baseline 必須吻合) | **D7 擋不住「worker 逾時誤寫 E5」** ⇒ 需要真正的擋點,不是更嚴格的形容詞 | **R4 F5** | ⏳ **§14 Q4 待 Sean** |
| **D10** | 🔴 **新增:四條欄位生命週期寫死 + `tappay_refund_id` 首寫獨佔** | v4 有三條 edge **靜態不可能**(`next_retry_at` / `next_check_at` 沒有owner)、且非 E4 的 edge 可塞假 TapPay ID | **R4 F1/F2/F3/F4** | ⏳ 屬修 bug、不屬新功能 |

🔴 **D6-D10 全部出自「修上一輪時自己開的新洞」** —— R1→R2 有 8/18、R2→R3 有 4/11、R3→R4 有 5/7。
**這是本檔第五次同一種復發。** ⇒ §7.5 把 R4 用來抓它的方法**做成強制交付物**,不是再寫一條規則(機制優先律)。

---

## §1 片界(Q2=A;鐵則 4)

| 片 | 型 | 交付 | 版本號 |
|---|---|---|---|
| **A7b-M** | M | 兩表、所有 CHECK、**五道**唯一性、索引、完整 ACL、COMMENT 合約、**dormant gate** | `20260731120000` |
| **A7b-T** | T | **移除 dormant gate** + 六支守門 trigger + 行為探針 + 突變 harness | `20260731120100` |

### 1.1 dormant gate(D4)
兩支 migration **各自 COMMIT** ⇒ A7b-T 失敗時 A7b-M 會單獨留在正式站。
```sql
ALTER TABLE public.order_refund_jobs
  ADD CONSTRAINT order_refund_jobs_dormant_until_triggers CHECK (false) NOT VALID;
```
A7b-T 在**所有守門安裝並通過結構驗收之後、同一交易的最後一步** `DROP CONSTRAINT`。
T 失敗 ⇒ 整支回滾 ⇒ **表存在但寫不進去**。
驗收:**兩個方向都要測**(M 之後合法 INSERT 必拒 / T 之後同一筆必過)。

---

## §2 這片在做什麼

`order_refund_jobs` = **卡片退款的工作表**:一次要退的錢 = 一列 job。
**交付的是規則,不是行為。** worker(第 3 批)照這份合約寫,不得另立。

TapPay 退款**隔日才生效**(`docs/reference/tappay-reference.md` **§2.3**,親驗 = 第 107 行):
Refund API 回 status 0 只代表「已送出」⇒ 送出與確認之間必須有**可持久化、可重入、可對帳**的中間狀態。

**不做**:worker / 排程 / 任何 TapPay 呼叫 / enqueue RPC / 人工結案 RPC(全在第 3 批);
不碰既有結構(🔴 **實查**:`order_cancellations` 已自帶 `UNIQUE (id, order_id)`,`20260730130000:125-126`
⇒ 複合 FK **不需要 ALTER 任何既有表**);**不加 enum type** ⇒ 一律 `text` + 具名 CHECK。

---

## §3 狀態機

### 3.0 🔴 四條欄位生命週期(D10;R4 F1/F2/F3)

v4 的三條 edge **靜態不可能**,根因是**同一個欄位沒有唯一的 owner** ——
「誰設它、誰保留它、誰清它」沒寫死,於是起點狀態與終點狀態的 truth table 對不上。
⇒ 每個跨狀態存活的欄位,**必須有一張生命週期表**:

| 欄位 | 誰設 | 誰保留 | 誰清 | 沒寫死會怎樣(v4 的實況) |
|---|---|---|---|---|
| `next_retry_at` | **E5**(失敗當下算好 backoff) | E6 | **E1** | v4:E5 沒設但 `failed` 要求 R ⇒ E5 不可能;E6 設了但 E1 不准清而 `processing` 要求 N ⇒ **重試迴圈整條卡死** |
| `next_check_at` | E3b / E4 / E10 | E8 / E11 | E9 / **E12** | v4:E12 沒清但 `dead` 要求 N ⇒ **E12 不可能 ⇒ dead 沒有可靠入口** |
| `failed_reason` | E5 / E5b | — | **E6** | R3 已修 |
| `refund_call_attempted_at` | **E2b** | E3b / E4 / E8-E12 | **E5 / E5b** | R3 已修 |
| `first_refund_call_at`(**D9 新增**) | **E2b**(僅 NULL→now()) | **全部** | **無人可清**(永久不可變) | 新增:D9 的隔日閘要它 |

🔴 **`tappay_refund_id` 的首寫獨佔(R4 F4)**:v4 只規定「E4 必須寫」,**沒規定「只有 E4 能首次寫」**
⇒ 走 E3b 的列(該欄為 NULL)可在 **E8 / E10 / E11 / E9** 被塞入一個假 ID,而所有狀態形狀仍合法。
⇒ **除 E4 外,所有 edge 一律 `NEW.tappay_refund_id IS NOT DISTINCT FROM OLD.tappay_refund_id`。**

### 3.1 逐條轉移(**15 條**;A7b-T 逐條擋,**表外的組合一律拒絕**)

🔴 **lease 三欄的共同錨點(R4 F1;v4 把它掉了)**:所有會設 lease 的 edge(E1 / E3 / E3b / E8 / E11)
一律 **`NEW.claimed_at = now()`**(交易時戳,不是呼叫者給的值)且
**`NEW.claim_expires_at = NEW.claimed_at + interval '5 minutes'`**。
v4 只留後者 ⇒ 呼叫者給未來時間可**跳過 backoff 並把 lease 鎖到未來**、給過去時間則**立即過期**。

| # | 從 → 到 | trigger 必驗條件 |
|---|---|---|
| E1 | `queued → processing` | `OLD.claim_token IS NULL` 且 `NEW.claim_token IS NOT NULL`;**lease 錨點**;`OLD.next_retry_at IS NULL OR OLD.next_retry_at <= now()`;🔴 **`NEW.next_retry_at IS NULL`(E1 是它的清除者)**;`refund_call_attempted_at IS NULL`;其餘欄不得改 |
| E2 | `processing → processing`(**baseline 初始化**)| `claim_token` 不變;lease 三欄不變;`refunded_before`/`refunded_target` 由 NULL 變非 NULL(成對);`refund_call_attempted_at` 仍 NULL;🔴 **後代(`generation > 1`)另受 D9c 約束(§3.5)**;不得改其他欄 |
| E2b | `processing → processing`(**退款呼叫戳記**,D6)| `claim_token` 不變;lease 三欄不變;`refunded_before`/`refunded_target` **已非 NULL**;`OLD.refund_call_attempted_at IS NULL` 且 `NEW.refund_call_attempted_at = now()`;🔴 **`NEW.first_refund_call_at = coalesce(OLD.first_refund_call_at, now())`**(僅首次寫入、之後不可變);其餘欄一律不得改 |
| E3 | `processing → processing`(**lease 重領,確定未打款**)| `OLD.claim_expires_at <= now()`;**lease 錨點** + `NEW.claim_token <> OLD.claim_token`;🔴 `OLD.refund_call_attempted_at IS NULL`;不得改其他欄 |
| E3b | `processing → reconciling`(**不確定送出**,D2)| `OLD.claim_expires_at <= now()`;🔴 `OLD.refund_call_attempted_at IS NOT NULL`;**lease 錨點** + token 換新;`NEW.next_check_at >= date_trunc('day', OLD.refund_call_attempted_at) + interval '1 day'`;兩個計數器不變 |
| E4 | `processing → submitted` | `refunded_before`/`refunded_target` **必須已非 NULL**;`OLD.refund_call_attempted_at IS NOT NULL`;🔴 **`OLD.tappay_refund_id IS NULL` 且 `NEW.tappay_refund_id IS NOT NULL`**(**唯一可首寫該欄的 edge**);清空 lease 三欄;`NEW.next_check_at >= date_trunc('day', OLD.refund_call_attempted_at) + interval '1 day'` |
| E5 | `processing → failed`(**明確失敗**)| `btrim(NEW.failed_reason) <> ''`;`NEW.retry_count = OLD.retry_count + 1` 且 **`<= 5`**;清空 lease 三欄;`NEW.refund_call_attempted_at IS NULL`(結果已知);🔴 **`NEW.next_retry_at = now() + (interval '5 minutes' * power(2, NEW.retry_count - 1))`**(E5 是它的設定者;以**失敗當下**為基準 ⇒ 第 1 次 5 分、第 5 次 80 分) |
| E5b | `processing → dead`(**第六次明確失敗**,D3)| `NEW.retry_count = OLD.retry_count + 1 = 6`;`NEW.manual_review_required = true`;`NEW.dead_reason = 'retry_exhausted'`;`btrim(NEW.failed_reason) <> ''`;清空 lease 三欄;`NEW.refund_call_attempted_at IS NULL`;`NEW.next_retry_at IS NULL` |
| E6 | `failed → queued` | `retry_count` 不變且 `<= 5`;🔴 **`NEW.failed_reason IS NULL`**(E6 是它的清除者);🔴 **`NEW.next_retry_at IS NOT DISTINCT FROM OLD.next_retry_at`**(E6 只保留、不重算 —— 重算會讓延遲的排程把間隔吃掉);lease 三欄仍為 NULL;不得改其他欄 |
| E8 | `submitted → reconciling` | **lease 錨點** + `NEW.claim_token` 與 `OLD` 不同;`OLD.next_check_at <= now()` |
| E9 | `reconciling → completed` | `refund_id` 由 NULL 變非 NULL;清空 lease 三欄;🔴 **`NEW.next_check_at IS NULL`**;另由 §5.6(b) 逐欄比對帳本 |
| E10 | `reconciling → submitted` | `NEW.next_check_at > OLD.next_check_at`;清空 lease 三欄;**成功查到但未達標 ⇒ `NEW.check_fail_count = 0`**;**查詢異常 ⇒ `+1` 且 `<= 5`** |
| E11 | `reconciling → reconciling`(lease 重領)| `OLD.claim_expires_at <= now()`;**lease 錨點** + token 換新;**永不回 `processing`**;計數器不變 |
| E12 | `reconciling → dead` | 二擇一:**超退** ⇒ `NEW.dead_reason='over_refunded'`、計數器不變;**第六次查詢異常** ⇒ `NEW.check_fail_count = OLD + 1 = 6` 且 `NEW.dead_reason='reconcile_exhausted'`。兩路皆 `NEW.manual_review_required = true`、清空 lease 三欄、🔴 **`NEW.next_check_at IS NULL`**(E12 是它的清除者之一;v4 漏了這條 ⇒ E12 靜態不可能) |
| E13 | `dead → dead`(**結案**)| **只准寫 review 三欄 + D9 的兩個證據欄**,review 三欄必須同時由 NULL 變非 NULL;`OLD.reviewed_at IS NULL`(Q3=B 的 CAS);其餘欄一律不得改;🔴 `resolution='retry_authorized'` 另受 **D7 + D9a/D9b** 約束(§3.5) |

🔴 **除 E4 外,所有 edge 皆須 `NEW.tappay_refund_id IS NOT DISTINCT FROM OLD.tappay_refund_id`**(D10)。
🔴 **E7(`failed → dead`)已刪除**:沒有任何路徑能讓 `failed` 帶 `retry_count=6` 存在
⇒ 留著就是一條永遠觸發不到、也無法被獨立負測證明的 edge。
`submitted → dead` 刻意不存在:第六次查詢異常由 E12 在 `reconciling` 相位原子完成。
🔴 **`failed` 在 `submitted` 之後永不出現**:`failed → queued` 會繞回送款相。
🔴 **`reconciling` 不與 `processing` 共用**:兩者該呼叫的 API 不同(Refund vs Record),
共用時 lease 過期重領**無法辨識該做哪件事**。**狀態本身就是那個辨識。**

### 3.2 `updated_at`
由 §5.2-6 統一設為 `now()`。
🔴 **v4 讓 E6 的 backoff 以 `OLD.updated_at` 為基準,v5 已移除** —— backoff 改在 **E5**(失敗當下)以 `now()` 算,
基準就是失敗那一刻,更精確且少一個相依。§7.4 的對應負測同步改。

### 3.3 D1:為什麼 `retry_consumed_at` 必須刪掉(R2 #2)

**死結**:可被消耗的前代**必然已結案** ⇒ `reviewed_at IS NOT NULL` ⇒ 而 `dead` 只允許 E13 且 `OLD.reviewed_at IS NULL`
⇒ **任何要戳前代的 UPDATE 都會被自己的守門拒絕**。

**codex 的修法**(AFTER INSERT 之後才戳前代)會**打破「已複核的 dead 列永久凍結」** ——
而那條不變式正是 Q3=B 的 CAS 的基礎。用一條新的可寫路徑,換一個本來就不需要的欄位,是**負收益**。

> **命題**:給定 ①`U1 = UNIQUE (cancellation_id, generation)` ②後代 INSERT 守門要求最大世代列 `M` 滿足
> `M.generation = NEW.generation - 1` 且 `M.status='dead'` 且 `M.resolution='retry_authorized'`
> ③DELETE / TRUNCATE 永久阻擋 ⇒ **任一世代最多只能開出一個後繼世代。**
> **證明**:由 ②,第 N 代的後繼只可能是第 N+1 代。由 ①,`(cancellation_id, N+1)` 最多一列。
> 由 ③,已存在的列不會消失後再被重建。∎

**R3 對三個前提的攻擊**:①擊破失敗(unique index 物理層強制、與隔離級無關);
③擊破失敗(`a7t-concurrency-probe.sh` 那條「RR 下兩交易各刪一列雙雙放行」打的是**快照依賴檢查**,
本片的 DELETE 擋是 **BEFORE trigger 無條件 `RAISE`、不讀快照** ⇒ 無殺傷力);
②缺 `NOT FOUND ⇒ RAISE`,已於 §5.1-3 補上。

🔴🔴 **命題成立,但它答的不是我們要問的問題。** ⇒ §3.5。

### 3.4 D2:`refund_call_attempted_at` 的語意

**問題**:`processing` 的 lease 過期時,新 worker 分不出
(a) 上一個 worker 還沒呼 Refund;(b) 呼了、外部成功了,但寫 `submitted` 之前 crash。

**解**:worker 在呼叫 Refund **之前**,以獨立交易走 **E2b** 戳記並 **COMMIT**,之後才發 HTTP。

| 觀察到 | 世界 | edge |
|---|---|---|
| `refund_call_attempted_at IS NULL` | 一定還沒打過(戳沒 commit ⇒ HTTP 沒發) | **E3** 重領回 `processing`,可安全呼 Refund |
| `refund_call_attempted_at IS NOT NULL` | **不確定** —— 可能已打款 | **E3b** 進 `reconciling`,**不再呼 Refund**,由 Record 裁定 |

**欄位語意 = 「有一次呼叫已發出、且結果未知」**:
- **明確失敗**(收到 TapPay 的非成功回應)⇒ 結果已知 ⇒ **E5 / E5b 清為 NULL**,重試才開得了
- **逾時 / 無回應** ⇒ 結果未知 ⇒ 🔴 **worker 不得寫任何東西**,讓 lease 自然過期走 E3b
- 成功(E4)⇒ 保留原值(`next_check_at` 的隔日基準要用它),`submitted` 之後不可變

#### 🔴 v4 的一句錯話,必須更正(R4 F6)
v4 §3.4 寫「v4 的狀態機**沒有任何路徑會重送同一筆 Refund**,所以不依賴 TapPay duplicate 回應的行為」。
**那句話是錯的,而且錯得離譜** —— 正向鏈 C(`E5→E6→E1→E2b`)就是拿**同一個不可變的 `bank_refund_id`**
最多重送 **6 次**。整個自動重試機制**完全建立在 TapPay 的冪等性上**。

⇒ 正確的分層(本檔以下一律用這個口徑):

| 重試層 | 用哪把鑰匙 | 靠什麼保證不重複扣款 | 已驗證? |
|---|---|---|---|
| **自動重試**(E5→E6→E1,最多 6 次) | **同一個 `bank_refund_id`** | **TapPay 的冪等鍵** | 🔴 **未驗證** —— 官方只寫「不可重複」,PCM 從未實測 ⇒ **第 3 批 sandbox hard release gate** |
| **世代重試**(gen N → N+1) | **全新 `bank_refund_id`** | **不能靠冪等鍵** ⇒ 只能靠 D7 + **D9** | 見 §3.5 |

### 3.5 🔴🔴 D7 的降級與 D9 的補位(R3 F5 + R4 F5,本檔最重要的一節)

**R3 抓到的洞**:E13 對 `resolution` 不看 `dead_reason` ⇒ 一個**已被 TapPay 受理**的退款
(`over_refunded` / `reconcile_exhausted`)可被結成 `retry_authorized` ⇒ gen2 帶新鑰匙再退一次。

**D7(保留,但降級為「必要條件」)**:
```sql
CONSTRAINT orj_retry_auth_only_from_retry_exhausted
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR dead_reason IS NOT DISTINCT FROM 'retry_exhausted')
```
🔴 **兩邊都用 `IS (NOT) DISTINCT FROM`,不用 `=`**:寫成 `dead_reason = 'retry_exhausted'`
在該欄為 NULL 時整式求值為 NULL ⇒ **CHECK 放行**(本 repo 已燒過的同一族)。

**🔴 v4 對 D7 的承重論證是錯的(R4 F5,逐字認錯)**:
v4 寫「`retry_exhausted` 蘊含六次全部收到明確失敗回應 ⇒ 沒有任何一分錢出去過」。
**那是把一個 worker 紀律講成了 DB 層證明。** 反例(全程零違規):
1. E2b 戳記 → 發出 Refund
2. TapPay **已受理**,但 worker 收到**逾時**
3. worker **錯誤地**寫 E5(合約要求它什麼都不寫)—— **DB 允許**,且順手清掉戳記
4. 後續重試收到重複鍵或其他非成功回應 ⇒ 最終 E5b 寫成 `retry_exhausted`
5. E13 選 `retry_authorized` ⇒ **D7 放行**
6. gen2 用新 `bank_refund_id` 再退 ⇒ **可能退第二次**

⇒ **D7 擋得住的**:`over_refunded` / `reconcile_exhausted` 兩種**狀態機自己知道已受理**的死因。這是真防護。
⇒ **D7 擋不住的**:worker 在逾時情境下誤寫 E5。**這一點必須明文寫在 COMMENT 裡,不得再宣稱它是安全證明。**
⇒ 另註:TapPay 參考文件只寫 `status=0` 是成功,**沒有任何依據支持「非 0 回應必然零副作用」** ——
所以連「明確失敗」本身都不是「零金額移動」的證明。

**D9(補位;⏳ §14 Q4 待 Sean 拍板)** —— 三條,合起來把上面那個洞收斂成「可偵測」:

| | 規則 | 形式 | 擋掉什麼 |
|---|---|---|---|
| **D9a** | `resolution='retry_authorized'` **必須**同時填入 `retry_auth_recorded_refunded`(結案當下用 Record API 查到的累計退款額)與 `retry_auth_checked_at` | 同列 CHECK(成對,NULL-safe) | 「憑印象按重試」——**強制留下可稽核的證據** |
| **D9b** | 🔴 **隔日閘**:若 `first_refund_call_at` 非 NULL,則 `retry_auth_checked_at >= date_trunc('day', first_refund_call_at) + interval '1 day'` | 同列 CHECK | 「當天就按重試」—— TapPay **隔日生效**,當天查 Record **看不到**已受理的退款 ⇒ 證據無效 |
| **D9c** | 🔴 後代的 **E2 baseline** 必須 `refunded_before IS NOT DISTINCT FROM 前代的 retry_auth_recorded_refunded`,不等 ⇒ `RAISE` | A7b-T 的 E2 守門(查前代) | 「結案到重試之間錢真的動了」—— 包含**別人在 TapPay portal 手動退了** |

🔴 **D9 誠實邊界(不得省略)**:D9 把「靜默退第二次」變成「**在錢已入帳的情況下必定被擋下**」。
它**擋不住**「第一次退款尚未入帳、Record 還看不到」的情境 —— 但 **D9b 的隔日閘正是為了把那個窗關掉**,
而隔日之後 Record 是否**保證**反映,PCM **沒有實測** ⇒ **第 3 批 sandbox hard release gate**。
**D9 是偵測與收斂,不是證明。** 這句話必須進 migration COMMENT。

---

## §4 A7b-M:表定義

### 4.1 `order_refund_jobs`

**身分與世代**
- `id` uuid PK / `cancellation_id` uuid NOT NULL / `order_id` uuid NOT NULL
- **複合 FK**:`FOREIGN KEY (cancellation_id, order_id) REFERENCES public.order_cancellations (id, order_id) ON DELETE RESTRICT`
  —— 單靠一支 FK,**cancellation A 的 job 可以宣稱自己屬於 order B**,兩道 child FK 仍全部合法。
- `generation` integer NOT NULL DEFAULT 1 CHECK `BETWEEN 1 AND 20`
  🔴 **認列**:第 20 代之後即使合法獲授權也會被拒 = 一條無出口。機率極低,**明文認列**;真發生走 §12.1。
- `UNIQUE (id, order_id)` —— 供子表複合 FK 反向引用

**外部識別(全部不可變)**
- `rec_trade_id` text NOT NULL,CHECK `char_length BETWEEN 1 AND 20`
  🔴 **不加字元集 CHECK**:v2 寫的 `[A-Za-z0-9_-]` **沒有 TapPay 官方依據**(官方只寫 String(20)),
  可能拒絕合法外部 ID = 一筆該退的錢永遠進不了系統。改為僅擋**明確不可能合法**的:
  控制碼 `!~ '[\x00-\x1F\x7F]'`、前後空白、空字串。
  施工前對既有 `payment_charge_attempts.rec_trade_id` 做字元集 read-back,寫進 COMMENT 當**觀察紀錄**,**不升格為 CHECK**。
- `bank_refund_id` text NOT NULL,同上規則
- `payload_hash` text NOT NULL CHECK `~ '^[0123456789abcdef]{64}$'`
  🔴 **逐碼位列舉,不用 `[0-9a-f]`**:POSIX 字元範圍**跟著 locale 走**(backlog **#305**,A7 已實測)。
- `tappay_refund_id` text —— **只有 E4 能首次寫入**(D10);一旦非 NULL 即不可變
  🔴 **它不是「到達某狀態就一定有」**:走 E3b 的 job 從未收到成功回應 ⇒ 永遠 NULL,但可能一路走到 `completed`。

**金額與對帳基準**
- `refund_amount` integer NOT NULL CHECK > 0
- `refunded_before` / `refunded_target` integer(enqueue 時 NULL,E2 才持久化)
  🔴 **規範來源寫死**:`refunded_before` **一律以 TapPay Record API 的當下累計退款額為準**,
  **不得讀本地 `order_refunds` 加總** —— 否則 `external_refund_confirmed` 的 dead 會讓本地值低於 TapPay 事實,
  後續 job 對帳必然 `> target` ⇒ 連環進 dead。
- **成對 CHECK**:
  ```sql
  CHECK ( (refunded_before IS NULL AND refunded_target IS NULL)
       OR (refunded_before IS NOT NULL AND refunded_target IS NOT NULL
           AND refunded_before >= 0
           AND refunded_target = refunded_before + refund_amount) )
  ```
  v1 寫成單向蘊含 ⇒ **`before` 為 NULL 時整式求值為 NULL、CHECK 放行**。
- 🔴 **`refunded_target > 0` 已刪除**:被三者嚴格蘊含 ⇒ 沒有獨立負測的守門。

**帳本快照** — `items_amount` / `shipping_fee_before` / `shipping_fee_after` / `shipping_delta` /
`reason` / `actor`(**FK → `staff(id)` RESTRICT**)/ `request_id`,全部 **enqueue 當下凍結、不可變**,
CHECK 逐條對齊 `order_refunds`(逐字抄 `20260725130100:88-119`)。
🔴 `actor` **刻意不加形狀 CHECK**:`staff` 自帶 `staff_id_format`(`20260726120000:21`)⇒ 形狀已被 FK 傳遞性保證,
加了**原理上無法被獨立突變證明**(A7 已實測,`20260730130000:100-113`)。

**狀態與生命週期**
- `status` text NOT NULL DEFAULT `'queued'` CHECK IN(七值)
- lease **三欄**:`claim_token` uuid / `claimed_at` / `claim_expires_at`
- `refund_call_attempted_at` timestamptz —— 可變性 = 只允許 `NULL → now()`(E2b)與 `非 NULL → NULL`(E5/E5b)
- 🔴 `first_refund_call_at` timestamptz(**D9**)—— **只允許 `NULL → now()`(E2b),此後永久不可變、無人可清**
- 排程:`retry_count` NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `next_retry_at` /
  `next_check_at` / `check_fail_count` NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `failed_reason`
- 人工:`manual_review_required` boolean NOT NULL DEFAULT false / `reviewed_at` / `reviewed_by`(**FK → `staff(id)`**)/
  `resolution` CHECK IN(三值)/ `dead_reason` CHECK IN(三值)/
  🔴 `retry_auth_recorded_refunded` integer / `retry_auth_checked_at` timestamptz(**D9a**)
- `refund_id` uuid FK → `order_refunds(id)` / `created_at` / `updated_at`

### 4.2 `order_refund_job_items`(Q4=B)

```sql
CREATE TABLE public.order_refund_job_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid    NOT NULL,
  order_id      uuid    NOT NULL,          -- 冗餘欄,唯一理由 = 讓下方複合 FK 夾住歸屬
  order_item_id uuid    NOT NULL,
  quantity      integer NOT NULL CHECK (quantity > 0),
  unit_price    integer NOT NULL CHECK (unit_price >= 0),
  line_amount   integer NOT NULL CHECK (line_amount > 0),
  CONSTRAINT orji_line_balances CHECK (line_amount = unit_price * quantity),
  CONSTRAINT orji_job_fk  FOREIGN KEY (job_id, order_id)
    REFERENCES public.order_refund_jobs (id, order_id) ON DELETE RESTRICT,
  CONSTRAINT orji_item_fk FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id) ON DELETE RESTRICT,
  CONSTRAINT orji_job_item_key UNIQUE (job_id, order_item_id)
);
```
🔴 **跨單防護**:兩道複合 FK 夾住「明細品項 ∈ 本 job 的訂單」—— 單靠兩個獨立 FK 做不到。

**四條核心不變式**(前兩條跨列 / 跨表 ⇒ CHECK 做不到,由 §5.6(a) 承接):

| ID | 不變式 | 承接者 |
|---|---|---|
| C1 | 每個 job **至少一列**明細 | §5.6(a) 兩支 deferred(parent AFTER INSERT + child AFTER DELETE) |
| C2 | `jobs.items_amount = Σ child.line_amount` | 同上 |
| C3 | `child.quantity <= order_items.quantity` | §5.6(a) child AFTER INSERT |
| C4 | `child.unit_price = order_items.unit_price` | 同上 |

🔴 **子表 UPDATE / DELETE / TRUNCATE 永久阻擋** —— 沒有這條,「凍結」只擋得住誠實的人。

### 4.3 五道唯一性

| # | 約束 | 擋掉哪一種「退兩次」 |
|---|---|---|
| U1 | `UNIQUE (cancellation_id, generation)` | 同一取消的同一世代重複建 **+ §3.3 命題的 ①** |
| U2 | partial unique `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一取消**同時**兩個未結案 job |
| U3 | partial unique `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一筆 TapPay 交易同時兩個 active job |
| U4 | `UNIQUE (bank_refund_id)` | TapPay 端的冪等鍵 |
| U5 | partial unique `refund_id WHERE refund_id IS NOT NULL` | 兩個 job 共用同一張帳本 |

🔴 **U4 擋不住跨表重用** ⇒ §5.1-2 的 INSERT 守門必須另查 `order_refunds`(它是 bank id 的**真相**)。
🔴 **`rec_trade_id NOT NULL` 是 U3 成立的前提**:partial unique **對 NULL 不生效**。
🔴 **U2/U3 用 `reviewed_at IS NULL` 而非「排除 dead」**:未複核的 dead 若不再擋,人還沒看,系統就自己再退一次。
🔴🔴 **這五道只擋「同時」,擋不住「先後」** —— 擋「先後」的是 §5.1 的 INSERT 守門,不是索引。

**兩條併發合約債(誠實揭示,是債不是防護)**:
1. **跨表 bank id**:「job INSERT 與 ledger INSERT 同時發生」在 PostgreSQL 無法做成宣告式唯一 ⇒ 擋不住。
   現行唯一 ledger writer 的值必然抄自某個 job(§5.6(b) 強制)⇒ 現行規劃內不可觸發。
2. **C2 的併發**:C2 是 count/sum 型 deferred 檢查、子表 INSERT 對 service_role 開放
   ⇒ 兩交易併發對同一 job 各插明細,**各自快照皆平衡、落地後 `Σ > items_amount`** ——
   **與 `scripts/a7t-concurrency-probe.sh` 實測的漏法同型**。現行 enqueue 是單交易一次寫完 ⇒ 不可觸發,
   **但那是推論不是防護**。若第 3 批出現「分批追加明細」,必須先補「trigger 內鎖 parent + 隔離級 fail-closed 閘」
   (**鎖 parent 單獨不足以補**,同一 harness 已實測)。

### 4.4 逐狀態完整 truth table

**R = 必須非 NULL、N = 必須 NULL、− = 不限制**:

| status | lease 三欄 | `attempted_at` | `next_retry_at` | `next_check_at` | `failed_reason` | `retry_count` | `check_fail_count` | review 三欄 | `dead_reason` | `manual_review` | `tappay_refund_id` | `refund_id` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `queued` | N | N | **−** | N | N | 0-5 | 0 | N | N | false | N | N |
| `processing` | R | − | **N** | N | N | 0-5 | 0 | N | N | false | − | N |
| `submitted` | N | R | N | R | N | 0-5 | 0-5 | N | N | false | − | N |
| `reconciling` | R | R | N | R | N | 0-5 | 0-5 | N | N | false | − | N |
| `completed` | N | R | N | N | N | 0-5 | 0-5 | N | N | false | − | R |
| `failed` | N | N | **R** | N | R | 1-5 | 0 | N | N | false | N | N |
| `dead` | N | − | **N** | **N** | − | 0-6 | 0-6 | **全 N 或全 R** | R | **true** | − | N |

🔴 **`next_retry_at` 三格改動(R4 F2)**:`queued` 由 N 改 **−**(初代 NULL、重試後有值)、
`processing` 維持 N(**E1 負責清**)、`failed` 維持 R(**E5 負責設**)。
v4 沒有指定 owner ⇒ **E5 與 E1 兩條 edge 同時靜態不可能 ⇒ 整個重試迴圈死掉**。
🔴 **`dead` 的 `next_check_at` = N(R4 F3)** ⇒ **E12 必須清空它**,否則 E12 靜態不可能 ⇒ **dead 沒有可靠入口**。
🔴 **`tappay_refund_id` 在 submitted / reconciling / completed 一律 `−`(R3 F3)**:
走 E3b 的 job 永遠沒有該值。**保證改由 E4 這條 edge 承接**(且 D10 規定只有 E4 能首寫)。
⇒ **狀態不變式做不到的事,不要寫進狀態不變式** —— 寫進去只會讓合法路徑死掉,而且測試抓不到。
🔴 **`processing` 的 `tappay_refund_id` 由 N 改 −**:E3b 之後可回不到 processing,但 E4 之前該欄本就 NULL;
寫 N 會與「只有 E4 能首寫」重複且互相遮蔽 ⇒ 依「不留無法獨立證明的約束」改 −。
🔴 **`failed` 的 `retry_count` 下界是 1**:`retry_count=0` 的 `failed` 代表「沒失敗過卻是失敗態」。
🔴 **review 三欄的鐵律**:必須全 NULL 或同時非 NULL,且**只允許在 `status='dead'` 時非 NULL**。
v1 允許單獨寫 `reviewed_at` ⇒ U2/U3 的 `reviewed_at IS NULL` 當場失效 ⇒ **放行第二個 active job**。

**具名 CHECK(錢面,逐條可獨立突變)**
```sql
-- D7:必要條件,不是安全證明(§3.5)
CONSTRAINT orj_retry_auth_only_from_retry_exhausted
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR dead_reason IS NOT DISTINCT FROM 'retry_exhausted')
-- D9a:證據成對且僅在授權重試時存在
CONSTRAINT orj_retry_auth_evidence_paired
  CHECK ((retry_auth_recorded_refunded IS NULL) = (retry_auth_checked_at IS NULL))
CONSTRAINT orj_retry_auth_evidence_required
  CHECK ((resolution IS NOT DISTINCT FROM 'retry_authorized') = (retry_auth_checked_at IS NOT NULL))
-- D9b:隔日閘 —— TapPay 隔日生效,當天查 Record 看不到已受理的退款
CONSTRAINT orj_retry_auth_next_day_gate
  CHECK (retry_auth_checked_at IS NULL
      OR first_refund_call_at IS NULL
      OR retry_auth_checked_at >= date_trunc('day', first_refund_call_at) + interval '1 day')
```

### 4.5 ACL 與函式安全

```sql
REVOKE ALL ON public.order_refund_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_refund_jobs TO service_role;  -- 無 DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
ALTER TABLE public.order_refund_jobs ENABLE ROW LEVEL SECURITY;            -- zero-policy
```
子表同上但**僅 `SELECT, INSERT`**。

🔴 **驗收必須是完整八格矩陣**(PG17):八種權限 × `anon / authenticated / service_role / PUBLIC`。
- **PG17 的第八種權限 `MAINTAIN`**:授出去之後 `has_table_privilege(…,'SELECT')` **仍為 false**
  ⇒ 七格矩陣對它**完全無感**(已實測)。正式站同為 PG17。
- 🔴 **`PUBLIC` 那一列必須排在角色矩陣之前**:`GRANT … TO PUBLIC` 會讓 anon/authenticated 因繼承轉紅
  ⇒ PUBLIC 斷言排在後面的話,**把它整條刪掉仍然全綠**。**順序是正確性的一部分。**

**所有 trigger 函式**:`SECURITY INVOKER` + `SET search_path = public, pg_temp`、物件全 schema-qualified;
🔴 **只有寫出「INVOKER 下具體缺哪一個權限、在哪一行會炸」時才准改 DEFINER**;
`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`;一律 `CREATE`(**不用 `OR REPLACE`**);
owner 必須是 `postgres`,列入 §7.1 指紋斷言。

---

## §5 A7b-T:六支守門

### 5.1 `BEFORE INSERT`
1. **所有世代一律**:`status` 必須 `'queued'`;lease 三欄、`refund_call_attempted_at`、`first_refund_call_at`、
   review 三欄、D9 兩個證據欄、`dead_reason`、`refund_id`、`tappay_refund_id`、`refunded_before/target`、
   `next_retry_at`、`next_check_at`、`failed_reason` **全部必須 NULL**;
   `retry_count = 0`、`check_fail_count = 0`、`manual_review_required = false`。
2. **跨表 bank id 唯一**:`NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE bank_refund_id = NEW.bank_refund_id)`。
3. **後代(`generation > 1`)**:鎖住同一 `cancellation_id` 的**最大世代列**
   (`SELECT … ORDER BY generation DESC LIMIT 1 FOR UPDATE`)並驗
   `M.generation = NEW.generation - 1`、`M.status='dead'`、`M.resolution='retry_authorized'`。
   🔴 **`NOT FOUND ⇒ RAISE`**:`generation > 1` 而該 cancellation 零列時**必須 fail-closed**
   (`a7t-concurrency-probe.sh:76` 的 `CONTINUE WHEN NOT FOUND` 就是同型漏法)。
   🔴 **不戳任何欄位**(D1)。
4. **後代 payload 逐欄等於直接前代**:除 `id` / `generation` / `bank_refund_id` / `request_id` /
   `created_at` / `updated_at` 外,業務欄逐欄等於 `M`。**逐欄比對一律 `IS NOT DISTINCT FROM`。**
   ⇒ 沒有這條,「重試授權」可以被拿去**退另一筆錢**。
5. **子表 item set 相等** ⇒ 由 §5.6(a) 在交易結束時比對。

🔴 **併發正確性的真正來源是 U1,不是那把鎖**:兩個 session 同時開 gen2 時,`FOR UPDATE` 讓後者等待,
但後者解鎖後**不會重跑 `ORDER BY`** ⇒ 仍以 gen1 為「最大世代」通過守門,最後**紅在 U1 的 `23505`**。
⇒ 這把鎖只是「減少無謂拒絕」;**拿掉它不會產生第二次退款,拿掉 U1 會**。
⇒ 併發負測必須斷言 **U1 的 constraint 名**,不是 trigger 的自訂碼。

### 5.2 `BEFORE UPDATE`
1. `OLD.status → NEW.status` 必須命中 §3.1 的 **15 條 edge 之一**,含該列全部額外條件
2. **終態不可轉出**:`completed` 之後任何欄位都不准改
3. **`dead` 只允許 E13**,且 `OLD.reviewed_at IS NULL` ⇒ 已複核的 dead 列**永久凍結**
4. **不可變欄位**:`id` / `cancellation_id` / `order_id` / `generation` / `rec_trade_id` / `bank_refund_id` /
   `payload_hash` / `refund_amount` / 所有帳本快照欄 / `created_at` / `refunded_before`(一旦非 NULL)/
   `refunded_target`(一旦非 NULL)/ `tappay_refund_id`(一旦非 NULL)/ `refund_id`(一旦非 NULL)/
   🔴 **`first_refund_call_at`(一旦非 NULL,永久)** / 🔴 **D9 兩個證據欄(一旦非 NULL,永久)**
   —— `refund_call_attempted_at` **不在此列**,它有自己的可變性規則(§3.0)
5. **計數器逐 edge 寫死**:`retry_count` 只在 E5/E5b `+1`;`check_fail_count` 只在 E10 歸 0 或 `+1`、
   只在 E12 `+1` 到 6;**其餘 edge 一律不得改動兩者**(不是「不得減少」,是**不得改動**)
6. 🔴 **`tappay_refund_id` 首寫獨佔**:除 E4 外一律 `IS NOT DISTINCT FROM OLD`(D10)
7. `updated_at := now()`

### 5.3 `BEFORE DELETE` / `BEFORE TRUNCATE`(**兩表都掛**)
**永久阻擋,不留逃生門**(同 A7-t 拍板 Q2=A)。
理由:表級 ACL 擋不住 **owner 與 SECURITY DEFINER RPC** —— 歷史一被清,五道唯一索引就**不再擋重退**。
🔴 驗收必須證明 **owner 身分也失敗**(用 service_role 測 = 測了個寂寞)。
🔴 **本擋是 BEFORE trigger 無條件 `RAISE`、不讀任何快照** ⇒ 與隔離級無關
(R3 已驗:`a7t-concurrency-probe.sh` 那條 RR 雙刪實測**對本擋無殺傷力**)。
子表另加 `BEFORE UPDATE` 一律阻擋。

### 5.4 能力邊界(明文,不得在任何地方宣稱超出)
trigger **看得到**:狀態圖、本地欄位、同表其他列(可鎖)、其他表的**已提交**內容。
trigger **看不到**(⇒ 全部是**第 3 批 worker 的 DoD 硬前置**,本片不得代為宣稱):
- TapPay Refund 是否真的成功、Record 的累計是 `< / = / >` target、baseline 是不是真的來自 Record API
- 呼叫者以為自己持有哪一把 token ⇒ **token CAS 是 worker 的 `WHERE claim_token = $1` 的責任**
- 🔴 worker 有沒有遵守「**先 commit E2b 戳記、再發 HTTP**」
- 🔴🔴 worker 有沒有遵守「**逾時 / 無回應時不得寫任何東西**」——
  **這一條是 D7 失效的唯一入口**(§3.5 的反例);D9 只把後果收斂成可偵測,**不能取代這條紀律**
- 🔴 **TapPay 對同一 `bank_refund_id` 重送的實際行為**(自動重試完全依賴它,**PCM 從未實測**)
- 🔴 跨表 bank id 的併發、C2 的併發(§4.3 兩條合約債)

### 5.5 `RAISE` 的形狀
普通 `RAISE EXCEPTION` 的 `CONSTRAINT_NAME` 是空的(2026-07-30 實測)⇒
「負測一律斷言 SQLSTATE + `CONSTRAINT_NAME`」這條紀律在 trigger 上**會失效**。
⇒ 所有 trigger 的 `RAISE` 一律帶 **`USING ERRCODE = '<自訂>'`, `CONSTRAINT = '<具名 ID>'`**,
ID 命名 = `a7bt_<edge 或規則>`。

### 5.6 兩支 `DEFERRED CONSTRAINT TRIGGER`

**(a) 主從一致(C1-C4)+ 後代 item set 相等**:parent `AFTER INSERT` + child `AFTER INSERT OR DELETE`,
皆 `DEFERRABLE INITIALLY DEFERRED`。
🔴 **為何是兩支**:只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件**
(`20260725130100:180-186` 的同一個教訓,已實證)。

**(b) job ↔ ledger 等值**:parent 🔴 **`AFTER INSERT OR UPDATE`**(只掛 UPDATE 的話,
INSERT 守門日後一弱化,`INSERT` 直達 `completed` 可完全繞過帳本等值)、deferred。
`NEW.status = 'completed'` 時斷言:
- `order_refunds` 存在該 `refund_id` 且 `status='confirmed'` 且 `confirmed_at IS NOT NULL`
- **逐欄相等**:`order_id` / `bank_refund_id` / `tappay_refund_id` / `refund_amount` / `items_amount` /
  三個運費欄 / `reason` / `actor` / `request_id`
  🔴🔴 **一律 `IS NOT DISTINCT FROM`,禁用 `=`**:`tappay_refund_id` 兩邊皆 nullable(`20260725130100:88`),
  天真 `=` 遇 NULL 整式為 NULL ⇒ 「不等才 RAISE」**靜默放行**。
- **item set 完全相等**:`(order_item_id, quantity, unit_price, line_amount)` 集合**雙向無差集**

🔴 U5 只防「兩個 job 共用一張帳本」,**完全不證明**上面任何一格。

---

## §6 R9-R19 關閉矩陣(誠實版)

| 規格 | 狀態 | 由誰關閉 | 驗收落點 |
|---|---|---|---|
| R9 baseline + job↔ledger 等值 | ✅ 關閉 | A7b-T(E2/E4)+ §5.6(b) | T-E2/T-E4;等值 = §7.4-16 |
| R10 `reconciling` 獨立相位 | ✅ 關閉 | A7b-T(E8/E11/E3b) | 「`reconciling → processing` 必拒」 |
| R11 `failed` 不在 `submitted` 之後 | ✅ 關閉 | 轉移表無此 edge | 「`submitted → failed` 必拒」 |
| R12 reclaim 寫死 + `check_fail_count` 入 schema | ✅ 關閉 | A7b-M + A7b-T(E11) | T-E11;CHECK 0-6 |
| R13 成功歸零 / 異常 +1 / CAS | 🟡 半關閉 | 歸零與 +1 = E10/E12;**CAS 未關閉** | 未關閉:`reconcileRefundJob()` 的 `UPDATE … WHERE id=$1 AND claim_token=$2` rowcount 必為 1 ⇒ `W-R13-CAS-1/2` |
| R14 Record 三路寫死 | 🔴 **未關閉** | 第 3 批 | **hard release gate**,ID `W-R14-LT/EQ/GT` |
| R15 durable 告警 + LINE 重發 | 🔴 **未關閉** | 第 3 批 | **hard release gate**。🔴 **掃描條件三段**:①`dead AND manual_review_required AND reviewed_at IS NULL` ②`status IN ('processing','reconciling') AND claim_expires_at < now() - interval '30 minutes'` ③`status IN ('queued','failed') AND coalesce(next_retry_at, created_at) < now() - interval '2 hours'`。🔴 只掃 ① 的話,**錢卡住的那天沒有人被叫醒**。ID `W-R15-RESEND` / `-STUCK-LEASE` / `-STUCK-RETRY` |
| R16 結案 RPC 鎖 + 稽核 | 🟡 半關閉 | CAS = §5.2-3;RPC 本體 = 第 3 批 | **具名** `public.admin_resolve_dead_refund_job(p_job_id, p_resolution, p_reviewed_by, p_note, p_recorded_refunded, p_checked_at)`;service_role only、SECURITY DEFINER、鎖列後重驗;`UPDATE … WHERE id=$1 AND reviewed_at IS NULL` **rowcount 必為 1**,否則 `ERRCODE='PCM09'`;同交易寫 `order_notes` **恰一筆**。ID `W-R16-1`~`-4`、🔴 `W-R16-5`(`dead_reason<>'retry_exhausted'` 選 retry_authorized 必被 D7 拒)、🔴 `W-R16-6`(**當天就按重試必被 D9b 拒**) |
| R17 世代式 + one-current partial unique | ✅ 關閉 | U1/U2 + §5.1 | §7.4-1~6 |
| R18 `resolution` 三值分流 | ✅ 關閉 | CHECK + **D7/D9** + §5.1-3 | §7.4-3/4/5 + §7.4-25/27 |
| R19 原子消耗授權 | ✅ 關閉,**機制已換**(D1) | U1 + §5.1-3 | §3.3 命題 + §7.4-2~6 |

---

## §7 驗收

沿用 A1 骨架 —— 🔴 **精確措辭:`scripts/a1-verify.sh` 在本機 PG17.10 已 61/0;A1 本身尚未 apply 到正式站**。
承接:外層 oracle 存 shell 側 / `snapshot()` fail-closed(`a1-verify.sh:50-57`)/
harness 自我測試(故意弄壞快照 SQL 必須當場中止,`:138-144`)/ 結構與行為突變分開跑 /
每個 mutant 指定唯一預期第一失敗 ID / 對照組必跑。

### 7.1 承接 A7-t 已實證的假綠路徑
`tgenabled` / `tgqual` / `tgrelid` / **`tgtype`(事件 bitmap)** / `tgfoid` vs `regprocedure` /
**函式本體 `md5(prosrc)` 指紋** / owner / **完整 ACL allowlist**。

### 7.2 一對一矩陣(逐格填,六欄固定)

| 約束/守門 ID | 正向前提 | 負向資料(只動一格) | 預期 SQLSTATE | 預期 CONSTRAINT_NAME | 對應 mutant |
|---|---|---|---|---|---|

🔴 **truth table 覆蓋 = 全格,不取樣**:整條 CASE CHECK 約 **90 格**,
v4 寫的「每態至少一格 R 與一格 N = 最少 14 格」地板下,單格 mutant **存活**。
⇒ **每一個 R 格與 N 格各一條負測**;確實無法獨立構造的格必須**逐格列出理由**(比照 §4.1 `actor` 的處理)。

🔴 **被嚴格支配的約束要標出來,不假裝它被驗過(R4 F7)**:
D7 的「`dead_reason` 為 NULL 而 `resolution='retry_authorized'`」這一格 **不是有效行為測試** ——
truth table 已先禁止 `dead` 的 `dead_reason` 為 NULL ⇒ **刪掉 D7 之後那條測試仍然會紅** = 假覆蓋。
⇒ 該格改為**結構字面驗證**(斷言 `pg_constraint` 裡 D7 的 `consrc` 逐字符合);
D7 的**行為**突變改用兩個合法 dead reason(`over_refunded` / `reconcile_exhausted`)證明。

**其餘必覆蓋**:`generation` / `retry_count` / `check_fail_count` 上下界 ×6;
`bank_refund_id` / `rec_trade_id` 長度上下界 ×4、控制碼 ×2、前後空白 ×2;`payload_hash` 形狀 ×3;
baseline 成對 ×3;金額三條 ×3;**D9a 成對 ×2 + D9a 必填 ×2 + D9b 隔日閘 ×2**;
五道唯一性 ×5;兩道複合 FK ×2;兩支 staff FK ×2;**15 條 edge** × 每條至少一格額外條件;
§5.6(a) C1-C4 ×4;§5.6(b) 逐欄 ×11(**含 `tappay_refund_id` 兩邊皆 NULL 的 NULL-safe 格**)+ item set ×2;
ACL 八格 × 四角色 = 32 格(**PUBLIC 排最前**);§7.1 八條指紋。

### 7.3 探針設計紀律
- **U2 與 U3 必須分開構造**,否則兩者先紅在同一個索引,**刪掉另一個索引仍全綠**。
- **轉移探針先建出「除了那條 edge 之外全部合法」的列形狀**,再斷言指定 trigger ID。
  同理套用於 INSERT 守門:`INSERT status='completed'` 的 fixture **必須除了 status 之外全部合法**。
- 🔴 **所有 fixture 必須經合法 edge 構造,不得直接 UPDATE 造中間態** ——
  v3 的負測 fixture 在當時的合約下**根本構造不出來**,而沒有人發現。
- **不可變欄位與計數器的突變要夾在合法 edge 裡測**。
- 🔴 **刪掉 v1 那條「直接 INSERT `generation+1` 應成功」的正向驗收** —— 它**替重退破口背書**。
- 🔴 **併發斷言不得只寫「不超過一個成功」**(兩個都失敗也會過)⇒ 必須斷言
  **恰一成功、另一筆精確失敗於指定 constraint、gen2 恰一列**。

### 7.4 必做測試

🔴🔴 **正向鏈先寫、先跑**:v3 有 24 條負測 + 2 條正向,而 E6 / E3b / E2b 三處靜態死鎖在那 26 條下**全綠**;
v4 補了兩條正向鏈,但 `next_retry_at` / `next_check_at` 兩處死鎖**又全綠**(R4 抓)。
**負測證明「壞的被擋住」,證明不了「好的走得通」。**

**正向鏈(六條,全部必跑)**
- **A** `queued→E1→processing→E2→E2b→E4→submitted→E8→reconciling→E9→completed`
- **B** `…→E5b dead→E13 結案 retry_authorized→INSERT gen2`
- **C 重試迴圈**:`E1→E2→E2b→E5 failed→E6 queued→E1→…` 連走 **6 輪**,第 6 輪 `E5b → dead`。
  斷言 `retry_count` 逐輪 1→6、`next_retry_at` 每輪符合 `5min × 2^(n-1)` 且**在 E1 後為 NULL**、
  `failed_reason` 在每次 E6 後為 NULL、`refund_call_attempted_at` 在每次 E5 後為 NULL、
  🔴 **`first_refund_call_at` 全程不變**
- **D 不確定送出鏈**:`E1→E2→E2b→`(lease 過期)`→E3b→reconciling→E10 順延→E8→E11 重領→E9 completed`,
  全程 `tappay_refund_id` 為 NULL,斷言 §5.6(b) 的 NULL-safe 等值放行
- 🔴 **E 超退鏈(新)**:`…→reconciling→E12(over_refunded)→dead`,斷言 `next_check_at` 為 NULL
- 🔴 **F 對帳耗盡鏈(新)**:`…→reconciling→E10 異常 ×5→E12(reconcile_exhausted)→dead`,同上斷言
  (E/F 兩條是 R4 F3 的回歸測試 —— v4 的四條正向鏈**都不經過 E12**)

**負測**
1. `INSERT status='completed'`(其餘全合法)→ 拒
2-5. `generation=2` 前代不是 dead / `external_refund_confirmed` / `over_refund_writeoff` / **舊授權隔代重用開 gen3** → 拒
6. **兩 session 併發重開 gen2**(A 取得 gen1 的 FOR UPDATE → B 阻塞 → A COMMIT)→ B **必紅於 U1 的 `23505`**;
   斷言恰一成功、gen2 恰一列
7. `generation=2` 而該 cancellation 零列 → 拒(`NOT FOUND` fail-closed)
8. `INSERT` 一個已存在於 `order_refunds.bank_refund_id` 的值 → 拒
9. 後代 payload 逐欄不同 → 拒;後代子表 item set 不同 → 拒(deferred)
10-11. `submitted→processing` / `reconciling→processing` / `submitted→failed` / `submitted→dead` /
    `completed` 轉出 / `dead→queued` → 皆拒
12. 單獨寫 `reviewed_at` → 拒;已結案的 dead 再結一次 → 拒
13. 未持久化 baseline 就 E2b → 拒;未戳記就 `processing→submitted` → 拒
14. `attempted_at` 非 NULL 的 lease 過期列走 E3 → 拒
15. `retry_count=5` 的 `processing` 走 E5 → 拒
16. **job↔ledger 等值**:逐欄各改一格 ×11、item set 多/少/數量不符 → 皆拒;
    🔴 **NULL-safe 專測**:job 側 `tappay_refund_id` NULL、ledger 側非 NULL → **必須拒**
17. 子表:零明細 / `Σ ≠ items_amount` / `quantity >` / `unit_price ≠` → 皆拒;子表 UPDATE / DELETE → 拒
18. **E5 的 backoff 基準**:用 `created_at` 或 `OLD.updated_at` 而非 `now()` 算 → 拒
19. **DELETE / TRUNCATE 一律拒,含 owner 身分**(兩表)
20. 未複核的 dead 仍擋得住同 cancellation / 同 rec_trade_id 的新 job(U2/U3 分開構造)
21. 兩個 job 指向同一 `refund_id` → 拒(U5)
22. **dormant gate 雙向**
23. E6 不清 `failed_reason` → 拒;🔴 **E6 重算 `next_retry_at`** → 拒
24. E5 不清 `refund_call_attempted_at` → 拒
25. **D7**:`over_refunded` / `reconcile_exhausted` 結成 `retry_authorized` → 皆拒
    (🔴 `dead_reason` 為 NULL 那格**不做行為測試**,改結構字面驗證 —— §7.2)
26. E2b 之外的任何 edge 想改 `refund_call_attempted_at` → 拒
27. 🔴 **D9 三條(新)**:`retry_authorized` 不填證據 → 拒;證據只填一欄 → 拒;
    **`retry_auth_checked_at` 早於 `first_refund_call_at` 的隔日** → 拒(D9b);
    **gen2 的 E2 baseline ≠ 前代 `retry_auth_recorded_refunded`** → 拒(D9c)
28. 🔴 **E1 的 lease 錨點(新)**:`claimed_at` 給未來時間 → 拒;給過去時間 → 拒;
    **`next_retry_at` 未到期就 claim** → 拒;**E1 不清 `next_retry_at`** → 拒
29. 🔴 **`tappay_refund_id` 首寫獨佔(新)**:E8 / E10 / E11 / E9 把 NULL 改成假 ID → 皆拒
30. 🔴 **E12 不清 `next_check_at`** → 拒
31. 🔴 **`first_refund_call_at` 被清空或改值** → 拒

### 7.5 🔴🔴 靜態可達性矩陣(**新增;強制交付物,寫 SQL 之前必須先填完**)

**這一節是為了讓「第五次同一種復發」不要有第六次。**
R1→R2 有 8/18、R2→R3 有 4/11、R3→R4 有 5/7 的 finding,都是**修上一輪時自己開的洞**,
而且**同一類**:改了 truth table 或 edge 條件之後,某條 edge 的起點形狀與終點形狀對不上,
於是那條 edge **靜態不可能成立** ⇒ 合法路徑死掉 ⇒ 錢卡住 ⇒ **而所有負測照樣全綠**。

**機制優先律**:不再寫「請小心」這種規則,而是把 R4 用來抓它的方法**做成必填的表**:

| Edge | 起點狀態的 truth table 要求 | 終點狀態的要求 | 本 edge 明文改動的欄位 | 差集是否為空 | 判定 |
|---|---|---|---|---|---|
| (15 條逐列填) | | | | | ✓ / ✗ |

**規則**:
1. 「差集」= 終點要求與起點形狀不同、而本 edge **沒有明文規定怎麼改**的欄位。**差集非空 = ✗ = 不准寫 SQL。**
2. 另填**反向兩問**:每個狀態**進得去嗎**(至少一條 ✓ 的入邊)、**出得來嗎**(至少一條 ✓ 的出邊,終態除外)。
3. 這張表**與 §3.0 的欄位生命週期表互為驗算** —— 生命週期表少寫一個 owner,這張表就會出現差集。
4. 🔴 **A7b-T 的 harness 必須把這張表機器化**:從 §3.1 與 §4.4 產生實際的列形狀,
   對每條 edge 實跑一次合法轉移。**跑不過的 edge = 靜態死鎖,當場中止**,不等人用眼睛看。

---

## §8 誠實邊界(先寫,不等審查逼)
- 本機 PG17.10 非 Supabase;`auth.uid()` 是 shim
- **trigger 不保證 fencing**;token CAS 屬 worker,第 3 批才被證明
- 🔴🔴 **D7 不是安全證明,是必要條件**(§3.5)。它擋不住「worker 逾時誤寫 E5」。
  **D9 把後果收斂成可偵測,但 D9 也不是證明** —— 它擋不住「第一次退款尚未入帳、Record 還看不到」,
  而 D9b 的隔日閘是否**足以**保證 Record 已反映,**PCM 沒有實測**
- 🔴🔴 **自動重試(最多 6 次)完全依賴 TapPay 對同一 `bank_refund_id` 的冪等性,而 PCM 從未實測**
  —— 官方只寫「不可重複」。⇒ **第 3 批 sandbox hard release gate**;
  v4 曾寫「沒有任何路徑會重送同一筆 Refund」,**那句話是錯的,已更正**(§3.4)
- **TapPay 參考文件只寫 `status=0` 是成功,沒有依據支持「非 0 回應必然零副作用」**
  ⇒ 連「明確失敗」都不等於「零金額移動」
- **D2 的一半正確性在 worker 手上**(先 commit 再發 HTTP + 逾時不得寫任何東西)
- **兩條併發合約債**(§4.3)—— 現行規劃內不可觸發,**但那是推論不是防護**
- **本片零 TapPay 接觸**:「隔日生效」「Record 三路」全是合約文字
- `reviewed_by` 在 E8-B 上線前**只是操作者自陳,不是已驗證身分**
- **第 20 代之後無出口**(§4.1),機率極低,明文認列

## §9 27 項綠燈宣稱
**兩片皆不宣稱任何項變綠**(原則 4)。第 19 項的退款面在第 3 批。

## §10 Migration 骨架 / rollback / rollout
- 兩支皆:顯式 `BEGIN;` + `SET LOCAL lock_timeout='5s'` + `statement_timeout='60s'` + `COMMIT;`(D0-1 拍板)
- 結尾各自 fail-closed 結構驗收 DO block,斷言帶機器可辨識 ID
- 🔴 **rollback 順序寫死**(先 DROP parent 會被 child FK 擋):
  ①停 writer ②驗兩表為空,非空則**備份後停下 raise Sean**(不得靜默續行)
  ③`DROP TRIGGER` 子表四支 → `DROP TABLE order_refund_job_items`(**不加 CASCADE**)
  ④`DROP TRIGGER` parent 六支 → `DROP TABLE order_refund_jobs`(**不加 CASCADE**)
  ⑤`DROP FUNCTION` 全部函式(逐一具名)⑥前置 `pg_depend` 依賴 preflight,非空即 abort
  🔴 只允許在第一個 writer 之前;之後只能 forward repair,**列為第 3 批 worker 片的 DoD 硬前置**
- **rollout**:A7-t 單獨 apply → read-back → A1 → read-back → 本兩片**接續**;
  `db push` 前先 `--dry-run`;失敗時做 **ledger / schema / 資料三方狀態矩陣**,
  `schema 有 + ledger 無` ⇒ 修 ledger、**不得重跑**;
  🔴 **A7b-M 成功但 A7b-T 失敗 = 已知可能狀態**,由 dormant gate 承接

## §11 索引具名落點

| 索引 | 定義 | 服務的查詢 |
|---|---|---|
| `orj_due_queued_idx` | `(next_retry_at) WHERE status='queued'` | claim 掃描 |
| `orj_due_failed_idx` | `(next_retry_at) WHERE status='failed'` | backoff 到期掃描 |
| `orj_due_submitted_idx` | `(next_check_at) WHERE status='submitted'` | 隔日對帳掃描 |
| `orj_stale_lease_idx` | `(claim_expires_at) WHERE status IN ('processing','reconciling')` | lease 回收 + R15 卡住告警 |
| `orj_unreviewed_dead_idx` | `(created_at) WHERE status='dead' AND reviewed_at IS NULL` | dead-review 清單 + R15 重發 |
| `orji_order_item_idx` | 子表 `(order_item_id)` | 跨 job 聚合剩餘可退量 |

## §12 開工前仍待 Sean 的

### 12.1 break-glass 更正程序(D8;R3 F6)
結案是**一次性**的。若人選錯 `resolution`(例如把該重試的結成 `external_refund_confirmed`),
已複核 dead 永久凍結 + DELETE 永擋 + 開新世代要求前代 `retry_authorized`
⇒ **那位客人的退款在合約內永遠退不出來**。

v3 對此隻字未提。這與 D1 線的前科同型(**回滾守門在唯一需要它的那天擋死自己**)⇒ **必須帶明文 escape**。
**現況唯一出路**:owner 手動 `ALTER TABLE … DISABLE TRIGGER` 後改列、再 ENABLE。
⇒ 寫進 migration COMMENT 與第 3 批 runbook,要求 ①Sean 明確批准 ②同交易寫 audit
③事後 read-back 證明 trigger 已重新啟用且僅該列被改。
**但那是繞過守門,不是防護** ⇒ 是否改成 DB 內的正式更正 RPC = §14 Q2。

### 12.2 其他
- **§0b 的 D1-D10 需 Sean 知情**(D1-D8 已拍 A;**D9 待答**;D10 屬修 bug)—— **擋 apply、不擋寫 code**
- 第 3 批「退款線兩題」是**第 3 批開批閘**,本片不受阻;若答案與本合約衝突,需回頭改

## §13 折入紀錄

| 輪 | 模型 | 角度 | 結果 | 其中「修上一輪自捅」 |
|---|---|---|---|---|
| R1 | codex `gpt-5.6-sol` xhigh | 逐條條文稽核 | FAIL 35+5 | — |
| R2 | codex `gpt-5.6-sol` xhigh | 逐條條文稽核 | FAIL 18+4 | **8 / 18** |
| R3 | **Fable(換模型)** | 假設審查 / 災難日可用性 / 修法回歸 / 測試假綠 | FAIL 11+3 | **4 / 11** |
| R4 | codex `gpt-5.6-sol` xhigh | **只打 v3→v4 diff 的靜態可達性與宣稱稽核** | FAIL 7 | **5 / 7** |

- **駁回 0**。**改採不同修法 1**:R2 #2 不採 codex 的「AFTER INSERT 之後才戳前代」,改為 D1 刪除欄位(§3.3);
  **R3 已對該證明的三個前提逐一攻擊,兩個擊破失敗、第三個已補齊。**
- 🔴 **R3 的 F5 與 R4 的 F5 是同一個病的兩層**:先是「證明成立但問題選錯」,
  再是「為了修它而寫的承重論證,把 worker 紀律講成了 DB 證明」。
  ⇒ 本檔所有「⇒ 所以安全」的句子已重新逐句檢查;§8 是唯一權威的宣稱清單。
- 🔴 **§7.5 是對「第五次復發」的機制性回應**,不是又一條規則。
- **master plan 每輪逐字重寫**;**CURRENT.md 每輪同步**。

## §14 給 Sean 的決策題(**apply 前必答,不擋繼續寫 code**)

Q1(D1-D8)已於 2026-07-31 下午拍 **A = 全部採用**。Q2 / Q3 已用白話重問、待答。

```
Q4(新;R4 打掉了 D7 的承重論證之後才出現的題):

系統自動退款失敗六次之後會停手叫人看。人如果判斷「這可以再試」,
問題是:那筆錢有沒有可能其實「已經退出去了,只是我們這邊沒收到回覆」?
真的發生的話,系統再退一次 = 客人被退兩次,而 TapPay 擋不住(第二次用的是新單號)。

你要哪一種?

A: A(D9:要按重試,必須①最快隔天才能按 ②按的時候把當下 TapPay 查到的
      已退金額填進去 ③系統開下一張卡時會再查一次,對不上就自己停住)
      —— 擋得住「錢已經入帳」的情況;擋不住「錢在路上、還查不到」。多三個欄位。

   | B(最保守:只要退款請求「已經送出去過」,系統就永遠不再自動重退,
      一律人工去 TapPay 後台處理)—— 可證明零重退,代價是 TapPay 當機那種
      「六次都明確失敗、隔天恢復」的情境也要人工做。

   | C(維持現況只有 D7,承認擋不住 worker 逾時誤判,寫進文件、靠第 3 批的
      worker 測試把關)—— 不加欄位,但那道防護的名字大於它的實力。

我的推薦:A。理由 = B 會把「TapPay 全站故障、隔天恢復」這個最常見的真實情境
推去人工,而那正是重試機制存在的意義;C 則是我這兩輪剛被抓到的同一個毛病
(防護被命名成超出它的實際能力)。
```
