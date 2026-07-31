# E10 第 1 批 · A7b「退款工作表 + 狀態機合約」片級 plan **v7**

> 🔴 **關卡1 六輪皆 FAIL,全部已折入本檔**:
> **R1** codex 35+5 · **R2** codex 18+4 · **R3** Fable 11+3 · **R4** codex 7 · **R5** Fable 11+2 · **R6** codex 11
> 逐字 = `docs/reviews/2026-07-31-e10-a7b-k1{,r2,r3-fable,r4,r5-fable,r6-codex}.md`
> 合計 **93 must-fix + 14 nit**,折入 **91/93**、駁回 0、改採不同修法 1、
> **2 條(R6 F3/F6)= 精確層,由 migration 本身關閉 ⇒ §14 Q5 待 Sean 決定流程**(§13)。
> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 25(每輪逐字重寫)。
> 決策全文 = memory `project_m4b-a7b-refund-jobs-decisions`。
> 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構)。

## 🔴🔴 本檔的核心病灶(已連三輪命中同一個):`feedback_control-named-beyond-its-actual-power`

| 輪 | 被抓到的那句話 | 實際能力 |
|---|---|---|
| R3 | v3 的形式證明「一代最多一個後繼」 | 成立,但**問題選錯** —— 要保證的是「同一筆錢只退一次」 |
| R4 | v4「`retry_exhausted` 蘊含零金額移動」 | **把 worker 紀律講成 DB 證明**;worker 逾時誤寫 E5 即破 |
| R5 | v5「D9 讓錢已入帳的情況**必定被擋下**」 | **當時沒有任何 CHECK 做那件比對**;真正的擋點是「人看到數字變大要自己起疑」 |

⇒ **v6 的紀律**:每一句「⇒ 所以安全」都必須指得出**具名的 constraint 或 edge 條件**;
指不出來的一律改寫成「這是稽核 / 這是人的責任」並進 §8。**§8 是唯一權威的宣稱清單。**

---

## §0 Sean 拍板

| 題 | 拍板 | 連動 |
|---|---|---|
| Q1(早) | **A**:A7-t 先單獨 apply + read-back,再套 A1 | A1 plan §3.4 |
| Q2(早) | **A**:拆 `A7b-M` + `A7b-T` | master row 25 + §5.0 DAG |
| Q3(早) | **B**:結案併發 = 鎖列 + `reviewed_at IS NULL` CAS | 「token CAS」字面作廢 |
| Q4(早) | **B**:帳本快照另開子表 | 不採「隔日重算」 |
| Q1(下午) | **A**:§0b 的 D1-D8 全部採用 | §0b |
| **Q2(下午)** | **B**:結案選錯 = **DB 內正式更正 RPC + 兩人簽核** | **D11**(§3.6)。🔴 推翻理由見下 |
| **Q3(下午)** | **A**:`generation` 上限維持 **20** | §4.1 |
| **Q4(下午)** | **A**:採用 D9 | 🔴🔴 **但 A 的描述已被 R5 證明誇大 ⇒ §14 需重新確認** |
| **Q1(T2 後)** | **D**:退款工作表的寫入**一律走 owner 的 SECURITY DEFINER RPC**;「service_role 直寫」**明文作廢** | 🔴 **改寫 §4.5 與 T1 表 COMMENT 的字面**;§6 R9/R16/R16b 三支 RPC 之外,**worker 機械步驟(E1/E2/E2b/E3/E3b/E4/E5/E5b/E6/E8/E10/E11)也要有對應 RPC = 第 3 批新增工作**;**收回 service_role 對 `order_refund_jobs` 的 INSERT/UPDATE GRANT = 第 3 批前置**(本片不動) |
| **Q2(T2 後)** | **A**:T1 的修補**不補跑 codex**、併入 T4 一起審,現在先 commit | T1 未 apply、要等 T4 審完才上正式站 ⇒ 無未經審查的東西碰到真資料 |

🔴🔴 **Q1(T2 後)的觸發事實(T2 實跑,非推論)**:plan §4.5 給了 service_role `INSERT, UPDATE`,
但**直寫在物理上本來就走不通** —— ①`BEFORE UPDATE` 守門內對 `pcm_a7bt_allowed_delta` 是**巢狀函式呼叫**、
以 `current_user` 檢查 EXECUTE,而 T1 已把它從 service_role 收回 ⇒ **每一筆 UPDATE 都 42501**;
②開新世代的 INSERT 守門與 E14 的 `PERFORM … FOR UPDATE` 需要 `order_cancellations` 的 **UPDATE 權限**,
service_role 只有 SELECT ⇒ 42501。
⇒ 原設計是**一半直寫、一半 RPC 的混合**,而混合的那一半根本不成立;D 只是把 §6 已經指定的做法做完。
⇒ **`scripts/a7bt-verify.sh` 第 7 段已把這兩條翻成合約斷言**(直寫必 42501;哪天又通了會轉紅)。

🔴🔴 **一個被推翻的前提(必須記住)**:我對 Q2 推薦 C(「先手動處理」),依據是「訂單量一年 1-300 筆」。
**Sean 逐字更正:「訂單一個月 100-300 筆,一年下來數量驚人」** ⇒ 年量 **1200-3600**。
⇒ 「例外情境交給工程師手動改資料庫」在這個量級**不是方案**。
⇒ **教訓**:營運面判斷(「這種情況很少、人工處理就好」)**與技術判斷一樣受三來源律約束** ——
量級是可查證的事實,不是可以憑印象代入的參數。

---

## §0b 設計改動總表(推翻 master row 25 既有字面;擋 apply、不擋寫 code)

| # | 改動 | 出處 | 狀態 |
|---|---|---|---|
| D1 | 刪除 `retry_consumed_at`(它是「後繼列存在」的抄本,零額外防護,且與「已複核 dead 凍結」互斥) | R2 | ✅ Sean 拍 A |
| D2 | 新增 `refund_call_attempted_at`(分辨「還沒打」與「打了沒寫回」) | R2 | ✅ |
| D3 | 刪 E7、新增 E5b、E12 吃下第六次(第六次失敗必須**原子**進 dead) | R2 | ✅ |
| D4 | dormant `CHECK (false)` gate(兩支各自 COMMIT ⇒ 「同批 apply 風險窗為零」已證偽) | R2 | ✅ |
| D5 | 新增 `dead_reason` 值域 CHECK | R2 | ✅ |
| D6 | 新增 E2b「退款呼叫戳記」edge | R3 | ✅ |
| D7 | `retry_authorized` 鎖死在 `dead_reason='retry_exhausted'`(**必要條件,非安全證明**) | R3 | ✅ |
| D8 | ~~明文 break-glass 更正程序~~ **已被 D11 取代**(Sean 拍 Q2=B) | R3 | 🔄 |
| **D9** | 重試授權的證據**四條**(D9a 證據成對 / **D9b 隔日閘,已改錨最後一次呼叫 + 台北日界 + fail-closed** / D9c 下一代 baseline 吻合 / **D9d 結案當下 Record 必須等於本代 baseline**) | R4 + **R5 F1/F2/F3/F4/F5** | ⚠️ **§14 待重新確認** |
| **D10** | 四條欄位生命週期寫死 + `tappay_refund_id` 首寫獨佔 + lease 錨點 | R4 | ✅(修 bug) |
| **D11** | 🔴 **新增:E14 正式更正結案 edge + 兩人簽核**(Sean 拍 Q2=B) | Sean | ✅ |
| **D12** | 🔴 **新增:E5/E5b 必須 `OLD.refund_call_attempted_at IS NOT NULL`** —— 沒呼叫過不得記「明確失敗」 | **R5 F5** | ✅(修 bug) |

🔴 **自捅復發統計**:R1→R2 **8/18**、R2→R3 **4/11**、R3→R4 **5/7**、R4→R5 **3/11**(F6/F7/F8)。
比例在下降,而 R5 確認 **v5 的 truth-table 級差集已全部歸零**(15 條 edge 逐條驗過)。

---

## §1 片界(Q2=A;鐵則 4)

| 片 | 型 | 交付 | 版本號 |
|---|---|---|---|
| **A7b-M** | M | 兩表、所有 CHECK、五道唯一性、索引、完整 ACL、COMMENT 合約、**dormant gate** | `20260731120000` |
| **A7b-T** | T | **移除 dormant gate** + **十支**守門 trigger(manifest 見 §5.0)+ 行為探針 + 突變 harness | `20260731120100` |

### 1.1 dormant gate(D4)

🔴 **施工時本機實跑更正(2026-07-31;本節原寫 `ALTER TABLE … NOT VALID`)**:
**`NOT VALID` 在 `CREATE TABLE` 的 table constraint 上不生效** —— PostgreSQL 只在
`ALTER TABLE … ADD CONSTRAINT` 認它,建出來的約束 `convalidated = true`;
我原本那條「必須是 NOT VALID」的結構斷言**當場轉紅**(那正是它該做的事)。
**修法 = 拿掉 `NOT VALID`,不是改成 `ALTER TABLE`**:表與約束**同生** ⇒ 恆為空表
⇒ `NOT VALID` 唯一的作用(略過既有列全表掃描)在這裡**沒有任何行為差異**;
留著等於宣稱一個不存在的效果 = 本片六輪一直在抓的那個病。

```sql
-- 隨 CREATE TABLE 一起宣告(**不是** ALTER TABLE):
CONSTRAINT order_refund_jobs_dormant_until_triggers CHECK (false)
```
🔴 **驗收不得只驗「約束存在」** —— 改成 `CHECK (true)` 仍然存在、而 gate 當場失效
⇒ 必須**逐字比對 `pg_get_constraintdef` = `CHECK (false)`**
(已實作於 `20260731120000` §5.7,且 `scripts/a7bm-verify.sh` 有突變證明它會轉紅)。
A7b-T 在**所有守門安裝並通過結構驗收之後、同一交易的最後一步** `DROP CONSTRAINT`。
T 失敗 ⇒ 整支回滾 ⇒ **表存在但寫不進去**。驗收:**兩個方向都要測**。

---

## §2 這片在做什麼

`order_refund_jobs` = **卡片退款的工作表**:一次要退的錢 = 一列 job。
**交付的是規則,不是行為。** worker(第 3 批)照這份合約寫,不得另立。

TapPay 退款**隔日才生效**(`docs/reference/tappay-reference.md` **§2.3**,親驗 = 第 107 行):
Refund API 回 status 0 只代表「已送出」。
🔴 **「隔日」的精確定義(日曆日 / 營業日 / 幾點結算)官方無逐字說明** ——
本檔一律以 **`Asia/Taipei` 日曆日界**實作,並**明文列為推斷**(§8)。

**不做**:worker / 排程 / TapPay 呼叫 / enqueue RPC / 人工結案 RPC(全在第 3 批);
不碰既有結構(**實查**:`order_cancellations` 已自帶 `UNIQUE (id, order_id)`,`20260730130000:125-126`);
**不加 enum type** ⇒ 一律 `text` + 具名 CHECK。

---

## §3 狀態機

### 3.0 欄位生命週期(D10;每個跨狀態存活的欄位都必須有唯一 owner)

| 欄位 | 誰設 | 誰保留 | 誰清 |
|---|---|---|---|
| lease 三欄 | E1 / E3 / E3b / E8 / E11(**一律 `NEW.claimed_at = now()`** 且 `claim_expires_at = claimed_at + 5min`) | E2 / E2b | E4 / E5 / E5b / E9 / E10 / E12 |
| `next_retry_at` | **E5** | E6 | **E1** |
| `next_check_at` | E3b / E4 / E10 | E8 / E11 | E9 / **E12** |
| `failed_reason` | E5 / E5b | — | **E6** |
| `refund_call_attempted_at` | **E2b**(NULL→now()) | E3b / E4 / E8-E12 | **E5 / E5b** |
| 🔴 `last_refund_call_at`(**R5 F2 改**) | **E2b**(每次都更新為 now(),單調不減) | **全部** | **無人可清**(永久) |
| `tappay_refund_id` | **只有 E4** 能首寫 | 全部(`IS NOT DISTINCT FROM OLD`) | 無人可清 |
| review 三欄 | E13 | — | 無人可清 |
| D9 兩個證據欄 | E13 / E14 | — | 無人可清 |
| `corrected_*` 三欄(D11) | E14 | — | 無人可清 |

🔴 **`first_refund_call_at` 已刪除,改為 `last_refund_call_at`(R5 F2)**:
D9b 要擋的風險錨在「**最後一次**呼叫」,不是第一次。
反例(只用已承認的威脅、零新假設):第 1 輪 day0 明確失敗;第 4 輪 day3 逾時但 TapPay **已受理**、
worker 誤寫 E5;day3 進 dead ⇒ 錨第一次的閘門只要求 `checked_at ≥ day1`、**早已滿足**
⇒ 當天結案、當天 Record 還查不到 day3 那筆 ⇒ gen2 當天再退 ⇒ **雙退,而 D9 三條全綠**。
(旁證:E3b/E4 的 `next_check_at` 用的就是**最後一次**,兩處不一致本身就是線索。)

### 3.1 逐條轉移(**16 條**;A7b-T 逐條擋,**表外的組合一律拒絕**)

| # | 從 → 到 | trigger 必驗條件 |
|---|---|---|
| E1 | `queued → processing` | `OLD.claim_token IS NULL` 且 `NEW.claim_token IS NOT NULL`;**lease 錨點**;`OLD.next_retry_at IS NULL OR OLD.next_retry_at <= now()`;**`NEW.next_retry_at IS NULL`**;`refund_call_attempted_at IS NULL`;其餘不得改 |
| E2 | `processing → processing`(baseline 初始化)| `claim_token` 與 lease 三欄不變;`refunded_before`/`refunded_target` 由 NULL 變非 NULL(成對);`refund_call_attempted_at` 仍 NULL;🔴 **後代另受 D9c 約束**(§3.5);不得改其他欄 |
| E2b | `processing → processing`(退款呼叫戳記,D6)| `claim_token` 與 lease 三欄不變;baseline 已非 NULL;`OLD.refund_call_attempted_at IS NULL` 且 `NEW.refund_call_attempted_at = now()`;🔴 **`NEW.last_refund_call_at = now()`**(每次更新、且必須 `>= OLD`);其餘一律不得改 |
| E3 | `processing → processing`(lease 重領,確定未打款)| `OLD.claim_expires_at <= now()`;**lease 錨點** + token 換新;`OLD.refund_call_attempted_at IS NULL`;不得改其他欄 |
| E3b | `processing → reconciling`(不確定送出,D2)| `OLD.claim_expires_at <= now()`;`OLD.refund_call_attempted_at IS NOT NULL`;**lease 錨點** + token 換新;🔴 **`(NEW.next_check_at AT TIME ZONE 'Asia/Taipei')::date > (OLD.refund_call_attempted_at AT TIME ZONE 'Asia/Taipei')::date`**;兩個計數器不變 |
| E4 | `processing → submitted` | baseline 已非 NULL;`OLD.refund_call_attempted_at IS NOT NULL`;🔴 **`OLD.tappay_refund_id IS NULL` 且 `NEW.tappay_refund_id IS NOT NULL`**(**唯一可首寫該欄的 edge**);清空 lease 三欄;`next_check_at` 同 E3b 的台北日界規則 |
| E5 | `processing → failed`(**明確失敗**)| 🔴 **`OLD.refund_call_attempted_at IS NOT NULL`(D12)** —— 沒呼叫過不得記明確失敗;`btrim(NEW.failed_reason) <> ''`;`NEW.retry_count = OLD + 1` 且 **`<= 5`**;清空 lease 三欄;`NEW.refund_call_attempted_at IS NULL`;**`NEW.next_retry_at = now() + (interval '5 minutes' * power(2, NEW.retry_count - 1))`** |
| E5b | `processing → dead`(第六次明確失敗,D3)| 🔴 **`OLD.refund_call_attempted_at IS NOT NULL`(D12)**;`NEW.retry_count = OLD + 1 = 6`;`NEW.manual_review_required = true`;`NEW.dead_reason = 'retry_exhausted'`;`btrim(NEW.failed_reason) <> ''`;清空 lease 三欄;`NEW.refund_call_attempted_at IS NULL`;`NEW.next_retry_at IS NULL` |
| E6 | `failed → queued` | `retry_count` 不變且 `<= 5`;**`NEW.failed_reason IS NULL`**;**`NEW.next_retry_at IS NOT DISTINCT FROM OLD`**(只保留、不重算);lease 三欄仍 NULL;不得改其他欄 |
| E8 | `submitted → reconciling` | **lease 錨點** + token 與 OLD 不同;`OLD.next_check_at <= now()` |
| E9 | `reconciling → completed` | `refund_id` 由 NULL 變非 NULL;清空 lease 三欄;**`NEW.next_check_at IS NULL`**;另由 §5.6(b) 逐欄比對帳本 |
| E10 | `reconciling → submitted` | `NEW.next_check_at > OLD.next_check_at`;清空 lease 三欄;**成功查到未達標 ⇒ `check_fail_count = 0`**;**查詢異常 ⇒ `+1` 且 `<= 5`** |
| E11 | `reconciling → reconciling`(lease 重領)| `OLD.claim_expires_at <= now()`;**lease 錨點** + token 換新;**永不回 `processing`**;計數器不變 |
| E12 | `reconciling → dead` | 二擇一:超退 ⇒ `dead_reason='over_refunded'`、計數器不變;第六次查詢異常 ⇒ `check_fail_count = OLD+1 = 6` 且 `dead_reason='reconcile_exhausted'`。兩路皆 `manual_review_required = true`、清空 lease 三欄、**`NEW.next_check_at IS NULL`** |
| E13 | `dead → dead`(**結案**)| 只准寫 review 三欄 + D9 兩個證據欄;review 三欄同時由 NULL 變非 NULL;`OLD.reviewed_at IS NULL`(Q3=B 的 CAS);🔴 **`NEW.retry_auth_checked_at <= now()`(R5 F4)**;其餘不得改;`resolution='retry_authorized'` 另受 D7 + D9a/b/d 全部約束 |
| **E14** | `dead → dead`(**更正結案**,D11)| `OLD.reviewed_at IS NOT NULL`;🔴 **`OLD.corrected_at IS NULL`(只准更正一次,第二道 CAS)**;🔴 **該世代尚無後繼列**(`NOT EXISTS (generation+1)`);可改 `resolution` + D9 兩證據欄 + `corrected_at`/`corrected_by`/`correction_reason`;**`reviewed_at`/`reviewed_by` 不可改**(原始結案人是稽核痕跡);🔴 **`corrected_by <> reviewed_by`**;`btrim(correction_reason) <> ''`;`NEW.corrected_at <= now()`;更正後仍受 D7 + D9 全部約束 |

🔴 **除 E4 外,所有 edge 皆須 `NEW.tappay_refund_id IS NOT DISTINCT FROM OLD.tappay_refund_id`**(D10)。
🔴 **E7(`failed → dead`)已刪除**:沒有任何路徑能讓 `failed` 帶 `retry_count=6` 存在
⇒ 留著就是一條永遠觸發不到、也無法被獨立負測證明的 edge。
🔴 **`failed` 在 `submitted` 之後永不出現**;**`reconciling` 不與 `processing` 共用**
(兩者該呼叫的 API 不同 ⇒ lease 過期重領無法辨識該做哪件事;**狀態本身就是那個辨識**)。

### 3.2 `updated_at`
由 §5.2-7 統一設為 `now()`。backoff 在 **E5**(失敗當下)以 `now()` 算,基準就是失敗那一刻。

### 3.3 D1:為什麼 `retry_consumed_at` 必須刪掉(R2)

**死結**:可被消耗的前代**必然已結案** ⇒ `reviewed_at IS NOT NULL` ⇒ 而 `dead` 只允許 E13 且
`OLD.reviewed_at IS NULL` ⇒ **任何要戳前代的 UPDATE 都會被自己的守門拒絕**。

> **命題**:給定 ①`U1 = UNIQUE (cancellation_id, generation)` ②後代 INSERT 守門要求最大世代列 `M` 滿足
> `M.generation = NEW.generation - 1` 且 `M.status='dead'` 且 `M.resolution='retry_authorized'`
> ③DELETE / TRUNCATE 永久阻擋 ⇒ **任一世代最多只能開出一個後繼世代。**
> **證明**:由 ②,第 N 代的後繼只可能是第 N+1 代。由 ①,`(cancellation_id, N+1)` 最多一列。
> 由 ③,已存在的列不會消失後再被重建。∎

**R3 對三個前提的攻擊**:①擊破失敗(unique index 物理層強制、與隔離級無關);
③擊破失敗(`a7t-concurrency-probe.sh` 那條 RR 雙刪實測打的是**快照依賴檢查**,
本片的 DELETE 擋是 **BEFORE trigger 無條件 `RAISE`、不讀快照** ⇒ 無殺傷力);②已補 `NOT FOUND ⇒ RAISE`。

🔴🔴 **命題成立,但它答的不是我們要問的問題** ⇒ §3.5。
🔴 **D11(E14)不影響本證明**(已複驗):證明靠 U1 + 直接前代 + DELETE 永擋,
**不靠「已複核 dead 永久凍結」**;且 E14 明文要求「該世代尚無後繼列」。

### 3.4 D2:`refund_call_attempted_at` 的語意

**問題**:`processing` 的 lease 過期時,新 worker 分不出
(a) 上一個 worker 還沒呼 Refund;(b) 呼了、外部成功了,但寫 `submitted` 之前 crash。

**解**:worker 在呼叫 Refund **之前**,以獨立交易走 **E2b** 戳記並 **COMMIT**,之後才發 HTTP。

| 觀察到 | 世界 | edge |
|---|---|---|
| `attempted_at IS NULL` | 一定還沒打過 | **E3** 重領回 `processing`,可安全呼 Refund |
| `attempted_at IS NOT NULL` | **不確定** —— 可能已打款 | **E3b** 進 `reconciling`,不再呼 Refund,由 Record 裁定 |

**欄位語意 = 「有一次呼叫已發出、且結果未知」**:
- **明確失敗** ⇒ 結果已知 ⇒ **E5 / E5b 清為 NULL**(且 **D12 要求它原本必須非 NULL**)
- **逾時 / 無回應** ⇒ 結果未知 ⇒ 🔴 **worker 不得寫任何東西**,讓 lease 自然過期走 E3b
- 成功(E4)⇒ 保留原值,`submitted` 之後不可變

#### 🔴 v4 的一句錯話,已更正(R4 F6)
v4 寫「狀態機**沒有任何路徑會重送同一筆 Refund**」。**那句話是錯的** ——
正向鏈 C(`E1→E2b→E5→E6→E1`)就是拿**同一個不可變的 `bank_refund_id`**最多重送 **6 次**。

| 重試層 | 用哪把鑰匙 | 靠什麼保證不重複扣款 | 已驗證? |
|---|---|---|---|
| **自動重試**(最多 6 次) | **同一個 `bank_refund_id`** | **TapPay 的冪等鍵** | 🔴 **未驗證**,官方只寫「不可重複」⇒ **第 3 批 sandbox hard release gate** |
| **世代重試**(gen N → N+1) | **全新 `bank_refund_id`** | 不能靠冪等鍵 ⇒ 只能靠 D7 + D9 | 見 §3.5 |

### 3.5 🔴🔴 D7 的降級與 D9 四條(本檔最重要的一節;R3 F5 + R4 F5 + R5 F1-F5)

**D7(必要條件,**不是**安全證明)**:
```sql
CONSTRAINT orj_retry_auth_only_from_retry_exhausted
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR dead_reason IS NOT DISTINCT FROM 'retry_exhausted')
```
🔴 **兩邊都用 `IS (NOT) DISTINCT FROM`**:寫成 `dead_reason = 'retry_exhausted'` 在該欄為 NULL 時
整式求值為 NULL ⇒ **CHECK 放行**。

**D7 擋得住**:`over_refunded` / `reconcile_exhausted` 兩種**狀態機自己知道已受理**的死因。
**D7 擋不住**:worker 在逾時情境下誤寫 E5(R4 的反例)。**這句必須寫進 COMMIT 與 COMMENT。**

**D9 四條(R5 把 v5 的三條全部改過)**:

| | 規則 | 形式 | 擋掉什麼 / 擋不掉什麼 |
|---|---|---|---|
| **D9a** | `retry_authorized` **必須**同時填 `retry_auth_recorded_refunded`(結案當下 Record 查到的累計退款額)與 `retry_auth_checked_at` | 同列 CHECK(成對 + 必填,NULL-safe) | 擋「憑印象按重試」= **強制留下可稽核的證據**。**不驗證那個數字是真的** |
| **D9b** | 🔴 **隔日閘(R5 F2/F3/F5 三處全改)**:錨 **`last_refund_call_at`**(不是第一次)、日界明定 **`Asia/Taipei`**、且 **fail-closed**(`last_refund_call_at` 必須非 NULL) | 同列 CHECK | 擋「最後一次呼叫的當天就按重試」。**擋不掉「TapPay 隔日仍未反映」** |
| **D9c** | 後代 **E2 baseline** 必須 `refunded_before IS NOT DISTINCT FROM 前代的 retry_auth_recorded_refunded` | A7b-T 的 E2 守門(查前代) | 擋「結案到重試之間錢動了」,含**別人在 portal 手動退了** |
| **D9d** | 🔴 **新增(R5 F1)**:`retry_authorized` 必須 `retry_auth_recorded_refunded IS NOT DISTINCT FROM refunded_before` | 同列 CHECK | 擋「本代開始到結案之間錢動了」。**v5 沒有這一條 ⇒ 當時「必定被擋下」那句話沒有任何 DB 機制支撐** |

```sql
CONSTRAINT orj_retry_auth_evidence_paired
  CHECK ((retry_auth_recorded_refunded IS NULL) = (retry_auth_checked_at IS NULL))
CONSTRAINT orj_retry_auth_evidence_required
  CHECK ((resolution IS NOT DISTINCT FROM 'retry_authorized') = (retry_auth_checked_at IS NOT NULL))
-- D9b:錨最後一次呼叫、台北日界、fail-closed(無 IS NULL 逃生分支)
CONSTRAINT orj_retry_auth_next_day_gate
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR (last_refund_call_at IS NOT NULL
          AND retry_auth_checked_at IS NOT NULL
          AND (retry_auth_checked_at  AT TIME ZONE 'Asia/Taipei')::date
            > (last_refund_call_at    AT TIME ZONE 'Asia/Taipei')::date))
-- D9d:結案當下的 Record 必須等於本代 baseline
CONSTRAINT orj_retry_auth_recorded_matches_baseline
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR retry_auth_recorded_refunded IS NOT DISTINCT FROM refunded_before)
```

🔴 **D9d 的定義域是完整的**(已複驗):D7 要求 `retry_authorized ⇒ retry_exhausted`;
`retry_exhausted` 只能由 E5b 寫入;E5b 與 E5 都要求 `OLD.refund_call_attempted_at IS NOT NULL`(**D12**);
而 `attempted_at` 只能由 E2b 寫入,E2b 要求 baseline **已非 NULL**
⇒ **任何 `retry_exhausted` 的列,`refunded_before` 必然非 NULL**。

🔴 **D9b 為什麼可以 fail-closed(D12 的功能)**:v5 留了 `OR first_refund_call_at IS NULL` 的逃生分支,
而「NULL ⇒ 沒發過 HTTP」的前提**正是 D9 威脅模型裡不被信任的 worker 紀律**
—— worker 跳過 E2b 直接發 HTTP ⇒ 該欄恆 NULL ⇒ 閘門全程虛設(R5 F5)。
**D12 讓「六次未呼叫的失敗」變成不可能** ⇒ `retry_exhausted` 蘊含 `last_refund_call_at` 非 NULL
⇒ 閘門可以直接 fail-closed、不留分支。

#### 🔴🔴 D9 的誠實邊界(**這一段就是 R5 F1 抓到的那句話的更正版**)
- D9a **不驗證那個數字是真的** —— 它是**稽核要求**,不是防護。
- D9c 與 D9d **兩邊都讀 Record API** ⇒ **共模失效**:Record 本身回錯,兩邊會一起錯、兩條 CHECK 全綠。
- D9b 的隔日閘**建立在「TapPay 隔日後 Record 必定反映」這個未實測的假設上**,
  且「隔日」的精確定義官方無逐字說明 ⇒ 本檔採 `Asia/Taipei` 日曆日界是**推斷**。
- ⇒ **D9 是「偵測 + 收斂 + 稽核」,不是證明。**
  它把「靜默退第二次」變成「**只要 Record 反映了差異就會被擋下,而且擋點是具名的 CHECK**」;
  Record 沒反映的情況**擋不住**。
- ⇒ **v5 寫的「在錢已入帳的情況下必定被擋下」在當時是假的**(沒有任何 CHECK 做那個比對);
  加上 D9d 之後那句話才有具名落點,但**仍以 Record 的正確性為前提**。

### 3.6 D11:E14 正式更正結案(Sean 拍 Q2=B)

**問題**:結案是一次性的。若人選錯 `resolution`,在 v5 的規則下**那位客人的退款永遠退不出來**。
v5 的 D8 給的出路是「owner 手動 `DISABLE TRIGGER` 改列」——
🔴 **在每月 100-300 筆訂單的量級下,那一年會發生幾十次,不是補救方案而是新的風險來源。**

**E14 的設計(§3.1 已列)**:
- **只准更正一次**(`OLD.corrected_at IS NULL` = 第二道 CAS)
- **該世代尚無後繼列** —— 否則會出現「下一張卡已開、授權卻被改掉」的孤兒
- **`reviewed_at`/`reviewed_by` 不可改** —— 原始結案人是稽核痕跡
- 🔴 **`corrected_by <> reviewed_by`** = 「兩人簽核」的 DB 層強制
- 更正後的 `resolution='retry_authorized'` **仍受 D7 + D9a/b/d 全部約束**;下一代仍受 D9c
  ⇒ **更正路徑不繞過任何錢面守門**

⚠️ **誠實邊界(進 §8)**:`corrected_by <> reviewed_by` 強制的是「**兩個不同的 `staff.id`**」,
**不是「兩個不同的人」** —— 同一人若同時擁有兩組帳號仍可繞過。
真正的兩人簽核需要身分驗證(E8-B)與流程控制,**本片做不到,也不得宣稱**。

**RPC 層(第 3 批)**:`public.admin_correct_dead_refund_resolution(p_job_id, p_new_resolution, p_corrected_by, p_reason, p_recorded_refunded, p_checked_at)`;
service_role only、SECURITY DEFINER、鎖列後重驗、rowcount 必為 1、同交易寫 `order_notes` **恰一筆**。

---

## §4 A7b-M:表定義

### 4.1 `order_refund_jobs`

**身分與世代**
- `id` uuid PK / `cancellation_id` uuid NOT NULL / `order_id` uuid NOT NULL
- **複合 FK**:`(cancellation_id, order_id) → order_cancellations (id, order_id) ON DELETE RESTRICT`
  —— 單靠一支 FK,**cancellation A 的 job 可以宣稱屬於 order B**,兩道 child FK 仍全部合法。
- `generation` integer NOT NULL DEFAULT 1 CHECK `BETWEEN 1 AND 20`(Sean 拍 Q3=A)
  🔴 **認列**:第 20 代之後即使合法獲授權也會被拒 = 一條無出口。
  單一取消要走到那裡需**有人按 19 次授權重試**(每次背後 6 次自動重試)⇒ 機率極低,
  **且與總訂單量無關**(是 per-cancellation)。真發生走 §3.6 的 E14 或新開取消單。
- `UNIQUE (id, order_id)` —— 供子表複合 FK 反向引用

**外部識別(全部不可變)**
- `rec_trade_id` text NOT NULL,CHECK `char_length BETWEEN 1 AND 20`
  🔴 **不加字元集 CHECK**:v2 寫的 `[A-Za-z0-9_-]` **沒有 TapPay 官方依據**(官方只寫 String(20)),
  可能拒絕合法外部 ID = 一筆該退的錢永遠進不了系統。只擋控制碼 / 前後空白 / 空字串。
  🔴 **表達式寫死、不留給實作者發揮(R6 F5)**:v6 只寫「控制碼 / 前後空白」四個字,
  一個人會用 `btrim`、另一個人會用 locale-dependent 的 `[[:space:]]`,而 TAB / DEL / 全形空白
  在兩版會得到不同結果,**各自挑兩個測例仍可全綠**。⇒ 逐碼位定死:
  ```sql
  CHECK (rec_trade_id <> ''
     AND rec_trade_id !~ '[\x00-\x1F\x7F]'                      -- ASCII 控制碼 + DEL
     AND left(rec_trade_id,1)  !~ '[ \t\r\n 　]'       -- 前綴空白(含 NBSP / 全形)
     AND right(rec_trade_id,1) !~ '[ \t\r\n 　]')      -- 後綴空白
  ```
  🔴 **刻意不涵蓋的**:U+2000-200A 等其他 Unicode 空白、U+00AD / U+2800 / U+3164 三個
  「渲染全白但不屬空白類」的碼位 —— **明文認列不擋**(對外部 ID 過度嚴格的代價是拒收合法交易)。
  測試向量必須逐碼位列出上述**每一個**字元,不得由實作者自行挑。
  施工前對既有 `payment_charge_attempts.rec_trade_id` 做字元集 read-back,寫進 COMMENT 當**觀察紀錄**,**不升格為 CHECK**。
- `bank_refund_id` text NOT NULL,同上規則
- `payload_hash` text NOT NULL CHECK `~ '^[0123456789abcdef]{64}$'`
  🔴 **逐碼位列舉,不用 `[0-9a-f]`**:POSIX 字元範圍**跟著 locale 走**(backlog **#305**,A7 已實測)。
- `tappay_refund_id` text —— **只有 E4 能首次寫入**(D10);一旦非 NULL 即不可變

**金額與對帳基準**
- `refund_amount` integer NOT NULL CHECK > 0
- `refunded_before` / `refunded_target` integer(enqueue 時 NULL,E2 才持久化)
  🔴 **規範來源寫死**:`refunded_before` **一律以 TapPay Record API 的當下累計退款額為準**,
  **不得讀本地 `order_refunds` 加總**。
- **成對 CHECK**:
  ```sql
  CHECK ( (refunded_before IS NULL AND refunded_target IS NULL)
       OR (refunded_before IS NOT NULL AND refunded_target IS NOT NULL
           AND refunded_before >= 0
           AND refunded_target = refunded_before + refund_amount) )
  ```
  v1 寫成單向蘊含 ⇒ **`before` 為 NULL 時整式求值為 NULL、CHECK 放行**。
- 🔴 **`refunded_target > 0` 已刪除**:被三者嚴格蘊含 ⇒ 沒有獨立負測的守門。

**帳本快照** — `items_amount` / 三個運費欄 / `reason` / `actor`(**FK → `staff(id)` RESTRICT**)/ `request_id`,
全部 **enqueue 當下凍結、不可變**,CHECK 逐條對齊 `order_refunds`(逐字抄 `20260725130100:88-119`)。
🔴 `actor` **刻意不加形狀 CHECK**:形狀已被 FK 對 `staff_id_format`(`20260726120000:21`)傳遞性保證,
加了**原理上無法被獨立突變證明**(A7 已實測,`20260730130000:100-113`)。

**狀態與生命週期**
- `status` text NOT NULL DEFAULT `'queued'` CHECK IN(七值)
- lease **三欄**:`claim_token` uuid / `claimed_at` / `claim_expires_at`
- `refund_call_attempted_at` timestamptz / 🔴 **`last_refund_call_at` timestamptz**(D9;永不可清、單調不減)
- 排程:`retry_count` NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `next_retry_at` /
  `next_check_at` / `check_fail_count` NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `failed_reason`
- 人工:`manual_review_required` boolean NOT NULL DEFAULT false / `reviewed_at` / `reviewed_by`(**FK → `staff(id)`**)/
  `resolution` CHECK IN(三值)/ `dead_reason` CHECK IN(三值)/
  `retry_auth_recorded_refunded` integer / `retry_auth_checked_at` timestamptz(D9a)
- 🔴 **更正(D11)**:`corrected_at` timestamptz / `corrected_by`(**FK → `staff(id)`**)/ `correction_reason` text
- `refund_id` uuid FK → `order_refunds(id)` / `created_at` / `updated_at`

🔴 **所有 FK 的 referential action 一律寫死 `ON DELETE RESTRICT`(R6 F8;v6 有三支沒指定)**:
`reviewed_by` / `corrected_by` / `refund_id` 三支在 v6 未指定 ⇒ 實作者可能寫成 `CASCADE`(**刪 staff 連 job 一起刪掉**)、
`SET NULL`(**清掉稽核人**,而 review 三欄的成對 CHECK 會讓它在別的地方才意外失敗)或預設 `NO ACTION`。
⇒ **七支 FK 全部 `RESTRICT`**:`(cancellation_id, order_id)` / `actor` / `reviewed_by` / `corrected_by` /
`refund_id` / 子表兩支。**`confdeltype` 逐支納入 §7 結構驗收**(只驗「FK 存在」不夠)。

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

| ID | 不變式(CHECK 做不到 ⇒ §5.6(a) 承接) | 承接者 |
|---|---|---|
| C1 | 每個 job **至少一列**明細 | parent AFTER INSERT + child AFTER DELETE(兩支) |
| C2 | `jobs.items_amount = Σ child.line_amount` | 同上 |
| C3 | `child.quantity <= order_items.quantity` | child AFTER INSERT |
| C4 | `child.unit_price = order_items.unit_price` | 同上 |

🔴 **子表 UPDATE / DELETE / TRUNCATE 永久阻擋** —— 沒有這條,「凍結」只擋得住誠實的人。

### 4.3 五道唯一性

| # | 約束 | 擋掉哪一種「退兩次」 |
|---|---|---|
| U1 | `UNIQUE (cancellation_id, generation)` | 同一取消的同一世代重複建 **+ §3.3 命題的 ①** |
| U2 | partial unique `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一取消**同時**兩個未結案 job |
| U3 | partial unique `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一筆 TapPay 交易同時兩個 active job |
| U4 | `UNIQUE (bank_refund_id)` | 🔴 **本地端的 `bank_refund_id` 唯一**(R5 nit:v5 標「TapPay 端的冪等鍵」是名過其實 —— 它是本地唯一索引,TapPay 端行為 §8 自認未實測) |
| U5 | partial unique `refund_id WHERE refund_id IS NOT NULL` | 兩個 job 共用同一張帳本 |

🔴 **U4 擋不住跨表重用** ⇒ §5.1-2 的 INSERT 守門必須另查 `order_refunds`(bank id 的**真相**)。
🔴 **`rec_trade_id NOT NULL` 是 U3 成立的前提**:partial unique **對 NULL 不生效**。
🔴 **U2/U3 用 `reviewed_at IS NULL` 而非「排除 dead」**:未複核的 dead 若不再擋,人還沒看,系統就自己再退一次。
🔴🔴 **這五道只擋「同時」,擋不住「先後」** —— 擋「先後」的是 §5.1 的 INSERT 守門,不是索引。

**兩條併發合約債(是債不是防護)**:
1. **跨表 bank id**:PostgreSQL 無法做成跨表宣告式唯一 ⇒ 「job INSERT 與 ledger INSERT 同時」擋不住。
2. **C2 的併發**:count/sum 型 deferred 檢查 + 子表 INSERT 對 service_role 開放
   ⇒ 兩交易併發各插明細,**各自快照皆平衡、落地後 `Σ > items_amount`** ——
   與 `scripts/a7t-concurrency-probe.sh` 實測的漏法同型。現行 enqueue 單交易一次寫完 ⇒ 不可觸發,
   **但那是推論不是防護**。若第 3 批出現「分批追加明細」,必須先補「trigger 內鎖 parent + 隔離級 fail-closed 閘」
   (**鎖 parent 單獨不足以補**,同一 harness 已實測)。

### 4.4 逐狀態完整 truth table

**R = 必須非 NULL、N = 必須 NULL、− = 不限制**:

| status | lease 三欄 | `attempted_at` | `next_retry_at` | `next_check_at` | `failed_reason` | `retry_count` | `check_fail_count` | review 三欄 | `dead_reason` | `manual_review` | `tappay_refund_id` | `refund_id` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `queued` | N | N | − | N | N | 0-5 | 0 | N | N | false | N | N |
| `processing` | R | − | N | N | N | 0-5 | 0 | N | N | false | **N** | N |
| `submitted` | N | R | N | R | N | 0-5 | 0-5 | N | N | false | − | N |
| `reconciling` | R | R | N | R | N | 0-5 | 0-5 | N | N | false | − | N |
| `completed` | N | R | N | N | N | 0-5 | 0-5 | N | N | false | − | R |
| `failed` | N | N | R | N | R | 1-5 | 0 | N | N | false | N | N |
| `dead` | N | − | N | N | − | 0-6 | 0-6 | **全 N 或全 R** | R | **true** | − | N |

🔴 **`processing.tappay_refund_id` 恢復 `N`(R5 F8;v5 曾放寬成 `−`,理由是錯的)**:
v5 說「與『只有 E4 能首寫』重複且互相遮蔽」—— **在 break-glass 情境不成立**。
§3.6 的 E14 是正常更正路徑,但 owner 仍可 `DISABLE TRIGGER`;**那一刻 D10(trigger)死了、CASE CHECK 還活著**
⇒ 放寬等於把**唯一在 break-glass 期間還活著的那一層**拆掉。
⇒ 恢復 `N`,並在 §7.2 依「被支配約束」紀律標為**結構字面驗證**(同 R4 F7 的處理)。
🔴 **`tappay_refund_id` 在 submitted / reconciling / completed 一律 `−`**:走 E3b 的 job 永遠沒有該值。
**保證改由 E4 這條 edge 承接** ⇒ **狀態不變式做不到的事,不要寫進狀態不變式**。
🔴 **`failed` 的 `attempted_at` = N**(E5 清);**`retry_count` 下界 1**。
🔴 **review 三欄鐵律**:全 NULL 或同時非 NULL,且**只允許在 `dead` 時非 NULL**。
v1 允許單獨寫 `reviewed_at` ⇒ U2/U3 的 `reviewed_at IS NULL` 當場失效 ⇒ **放行第二個 active job**。
🔴 **D9 兩個證據欄、`last_refund_call_at`、`corrected_*` 三欄不列入 truth table** ——
它們跨狀態存活、由 §3.0 的生命週期表與 §3.1 的 edge 條件管;
**但這也是 §7.5 矩陣的視野盲區(§7.5 已明文認列)**。

**具名 CHECK 全集(錢面,逐條可獨立突變)**:D7 / D9a(成對 + 必填)/ D9b / D9d —— 見 §3.5 的 SQL。

### 4.5 ACL 與函式安全

```sql
REVOKE ALL ON public.order_refund_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_refund_jobs TO service_role;
ALTER TABLE public.order_refund_jobs ENABLE ROW LEVEL SECURITY;   -- zero-policy
```
子表同上但**僅 `SELECT, INSERT`**。

🔴🔴 **Sean 2026-07-31 拍 Q1=D 之後,上面那組 GRANT 的意義已經改變(字面必須連帶讀這一段)**:
`UPDATE` 這一項**不代表「後端程式可以直接更新本表」** —— T2 實跑證明直寫必 42501
(守門內對 `pcm_a7bt_allowed_delta` 的巢狀呼叫以 `current_user` 檢查 EXECUTE)。
寫入路徑**一律走 owner 的 `SECURITY DEFINER` RPC**,與 orders / order_cancellations /
order_refunds 三張表一致。**收回這兩個 GRANT** 讓直寫在表層就失敗 = **第 3 批前置**,A7b 三片都不動。

🔴 **驗收必須是完整八格矩陣**(PG17)× `anon / authenticated / service_role / PUBLIC`。
- **PG17 的第八種權限 `MAINTAIN`**:授出去之後 `has_table_privilege(…,'SELECT')` **仍為 false**
  ⇒ 七格矩陣對它**完全無感**(已實測)。正式站同為 PG17。
- 🔴 **`PUBLIC` 那一列必須排在角色矩陣之前**:`GRANT … TO PUBLIC` 會讓 anon/authenticated 因繼承轉紅
  ⇒ PUBLIC 斷言排在後面的話,**把它整條刪掉仍然全綠**。**順序是正確性的一部分。**

**所有 trigger 函式**:`SECURITY INVOKER` + `SET search_path = public, pg_temp`、物件全 schema-qualified;
🔴 只有寫出「INVOKER 下具體缺哪一個權限、在哪一行會炸」才准改 DEFINER;
`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`;一律 `CREATE`(**不用 `OR REPLACE`**);
owner 必須是 `postgres`,列入 §7.1 指紋斷言。

---

## §5 A7b-T:**十支**守門

### 5.0 trigger manifest(**R6 F4**:v6 全檔寫「六支」、rollback 卻列 parent 六 + child 四 = **十支**)

v6 的「六支」是**我自己的字面不一致**,而 §7.1 要斷言 `tgtype`(事件 bitmap)⇒
**沒有這張表就產不出預期值**。逐支具名,施工與驗收都以本表為準:

| # | trigger 名 | 表 | timing | 事件 | ROW/STMT | deferrable | 函式 |
|---|---|---|---|---|---|---|---|
| 1 | `a7bt_jobs_before_insert` | jobs | BEFORE | INSERT | ROW | — | `pcm_a7bt_jobs_before_insert()` |
| 2 | `a7bt_jobs_before_update` | jobs | BEFORE | UPDATE | ROW | — | `pcm_a7bt_jobs_before_update()` |
| 3 | `a7bt_jobs_block_delete` | jobs | BEFORE | DELETE | ROW | — | `pcm_a7bt_block_write()` |
| 4 | `a7bt_jobs_block_truncate` | jobs | BEFORE | TRUNCATE | **STATEMENT** | — | `pcm_a7bt_block_truncate()` |
| 5 | `a7bt_jobs_after_ins_consistency` | jobs | AFTER | INSERT | ROW | **DEFERRABLE INITIALLY DEFERRED** | `pcm_a7bt_assert_job_consistent()` |
| 6 | `a7bt_jobs_after_insupd_ledger` | jobs | AFTER | **INSERT OR UPDATE** | ROW | **DEFERRABLE INITIALLY DEFERRED** | `pcm_a7bt_assert_job_ledger_equal()` |
| 7 | `a7bt_items_block_update` | items | BEFORE | UPDATE | ROW | — | `pcm_a7bt_block_write()` |
| 8 | `a7bt_items_block_delete_guard` | items | BEFORE | DELETE | ROW | — | `pcm_a7bt_block_write()` |
| 9 | `a7bt_items_block_truncate` | items | BEFORE | TRUNCATE | **STATEMENT** | — | `pcm_a7bt_block_truncate()` |
| 10 | `a7bt_items_after_insdel_consistency` | items | AFTER | **INSERT OR UPDATE OR DELETE** | ROW | **DEFERRABLE INITIALLY DEFERRED** | `pcm_a7bt_assert_job_consistent()` |

🔴 **v7 更正(2026-07-31,關卡2 F5;Sean 拍 Q3=A)**:第 10 支原寫 `INSERT OR DELETE`(tgtype 13)。
矛盾在於:保留 DELETE 分支的理由是「破窗期間第 8 支被 DISABLE 時這一支還在」,
而 **UPDATE 的處境完全一樣**(平常被第 7 支 `a7bt_items_block_update` 永久擋住)。
只 DISABLE 第 7 支就能改 `quantity` / `line_amount`,而 **C2/C3/C4 與「後代 item set 相等」
都不會排隊檢查** ⇒ 失衡可提交。⇒ 三個事件一致才是完整的第二層,**tgtype 13 → 29**。
🔴 連帶:`pcm_a7bt_assert_job_consistent()` 對子表 UPDATE 必須驗 **`OLD.job_id` 與 `NEW.job_id` 兩者**
(明細從 job A 改掛到 B 時只驗 B 會讓 A 靜默失衡;`20260730140000:161-162` 的既有教訓)。

🔴 **第 8 支與第 10 支的關係要講清楚,不是重複**:第 8 支是**永久阻擋**(BEFORE DELETE 無條件 `RAISE`);
第 10 支的 DELETE 事件是 constraint trigger 的**必要形狀**(照 `20260725130100:180-186` 的既有教訓 ——
子表那支必須含 DELETE,否則刪明細後合計失衡不會觸發)。
現行設計下第 8 支讓第 10 支的 DELETE 分支**永遠不會被觸發** ⇒ **依「不留無法獨立證明的東西」紀律,
該分支必須在 §7.2 標為結構字面驗證**(它的價值在 break-glass 期間第 8 支被 DISABLE 時)。
🔴 `pcm_a7bt_block_write()` 被三支共用 ⇒ `RAISE` 必須帶**各自不同的 `CONSTRAINT` 具名 ID**
(靠 `TG_ARGV` 或 `TG_TABLE_NAME` + `TG_OP` 分辨),否則負測分不出紅在哪一支。

### 5.1 `BEFORE INSERT`
1. **所有世代一律**:`status` 必須 `'queued'`;lease 三欄、`refund_call_attempted_at`、`last_refund_call_at`、
   review 三欄、D9 兩證據欄、`corrected_*` 三欄、`dead_reason`、`refund_id`、`tappay_refund_id`、
   `refunded_before/target`、`next_retry_at`、`next_check_at`、`failed_reason` **全部必須 NULL**;
   `retry_count = 0`、`check_fail_count = 0`、`manual_review_required = false`。
2. **跨表 bank id 唯一**:`NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE bank_refund_id = NEW.bank_refund_id)`。
3. **後代(`generation > 1`)**:鎖住最大世代列(`SELECT … ORDER BY generation DESC LIMIT 1 FOR UPDATE`)並驗
   `M.generation = NEW.generation - 1`、`M.status='dead'`、`M.resolution='retry_authorized'`。
   🔴 **`NOT FOUND ⇒ RAISE`**(`a7t-concurrency-probe.sh:76` 的 `CONTINUE WHEN NOT FOUND` 是同型漏法)。
   🔴 **不戳任何欄位**(D1)。
4. **後代 payload 逐欄等於直接前代**(除 `id` / `generation` / `bank_refund_id` / `request_id` /
   `created_at` / `updated_at`)。**逐欄比對一律 `IS NOT DISTINCT FROM`。**
5. **子表 item set 相等** ⇒ §5.6(a) 在交易結束時比對。

🔴 **併發正確性的真正來源是 U1,不是那把鎖**:`FOR UPDATE` 讓後者等待,但後者解鎖後**不會重跑 `ORDER BY`**
⇒ 仍以 gen1 為「最大世代」通過守門,最後**紅在 U1 的 `23505`**。
⇒ **拿掉鎖不會產生第二次退款,拿掉 U1 會**;併發負測必須斷言 **U1 的 constraint 名**。

### 5.2 `BEFORE UPDATE`
1. 🔴🔴 **exact-one classifier(R6 F1;v6 只寫「必須命中之一」= 沒有規定怎麼判)**:
   16 條 edge 各自寫成一個**具名 boolean predicate**,先算 `match_count`,
   **`= 1` 才執行;`= 0` 與 `> 1` 各自 `RAISE` 且用不同的具名 ID**。
   🔴 **不得用 `IF / ELSIF` 首條命中** —— E2 / E2b / E3 三條都是 `processing → processing`、
   E13 / E14 都是 `dead → dead`,分支順序會直接改變結果,而且「重疊」與「零命中」會被靜默吞掉。
   (E13/E14 靠 `OLD.reviewed_at IS NULL` vs `IS NOT NULL` 本身互斥;E2/E2b/E3 靠
   「哪些欄產生 delta」互斥 —— 這一點必須由 predicate **明文表達**,不能靠實作者理解。)
   ⇒ 驗收:§7.4 必須有**「同時滿足兩條 edge 的列」**與**「一條都不滿足的列」**兩組負測,
   各自斷言指定的 `a7bt_edge_ambiguous` / `a7bt_edge_unmatched`。
2. **終態不可轉出**:`completed` 之後任何欄位都不准改
3. **`dead` 只允許 E13 / E14**;E13 需 `OLD.reviewed_at IS NULL`、E14 需 `OLD.reviewed_at IS NOT NULL`
   且 `OLD.corrected_at IS NULL` ⇒ **兩者互斥、且各自一次性**
4. **不可變欄位**:`id` / `cancellation_id` / `order_id` / `generation` / `rec_trade_id` / `bank_refund_id` /
   `payload_hash` / `refund_amount` / 所有帳本快照欄 / `created_at` / `refunded_before`(一旦非 NULL)/
   `refunded_target`(一旦非 NULL)/ `tappay_refund_id`(一旦非 NULL)/ `refund_id`(一旦非 NULL)/
   `reviewed_at`/`reviewed_by`(一旦非 NULL,**E14 也不得改**)/ `corrected_*` 三欄(一旦非 NULL)
   —— `refund_call_attempted_at` 與 `last_refund_call_at` 有自己的規則(§3.0);
   D9 兩證據欄由 E13 首寫、E14 可改一次
   🔴🔴 **「其餘欄不得改」必須可機械產生(R6 F2;v6 這句話出現很多次卻沒定義「其餘」)**:
   ⇒ **建立全欄位 canonical manifest**(一份、單一真相),每條 edge 只寫它的 **allowed-delta 白名單**;
   守門實作 = `全欄位 − 該 edge 白名單` 逐欄 `IS NOT DISTINCT FROM OLD`。
   🔴 **deny-by-default**:未列入任何白名單的欄(**含未來新增的欄**)一律禁止改動。
   ⇒ 沒有這條會出現兩種壞法,而且方向相反:一版漏比 `last_refund_call_at`(**放行竄改**)、
   另一版把自動欄 `updated_at` 也列為不可變(**合法 edge 永遠失敗**)。
   ⇒ `status` 與 `updated_at` 是**每條 edge 都在白名單內**的自動欄,必須在 manifest 明列、不得靠慣例。
   ⇒ 驗收:§7.2 加一格「manifest 的欄位集合 = `pg_attribute` 實際欄位集合」,**新增欄卻沒進 manifest 必轉紅**
5. **計數器逐 edge 寫死**:`retry_count` 只在 E5/E5b `+1`;`check_fail_count` 只在 E10 歸 0 或 `+1`、
   只在 E12 `+1` 到 6;**其餘 edge 一律不得改動兩者**
6. 🔴 **`tappay_refund_id` 首寫獨佔**:除 E4 外一律 `IS NOT DISTINCT FROM OLD`(D10)
7. `updated_at := now()`

### 5.3 `BEFORE DELETE` / `BEFORE TRUNCATE`(**兩表都掛**)
**永久阻擋,不留逃生門**(同 A7-t 拍板 Q2=A)。
理由:表級 ACL 擋不住 **owner 與 SECURITY DEFINER RPC** —— 歷史一被清,五道唯一索引就**不再擋重退**。
🔴 驗收必須證明 **owner 身分也失敗**。
🔴 **本擋是 BEFORE trigger 無條件 `RAISE`、不讀任何快照** ⇒ 與隔離級無關(R3 已驗)。
子表另加 `BEFORE UPDATE` 一律阻擋。

### 5.4 能力邊界(明文,不得在任何地方宣稱超出)
trigger **看得到**:狀態圖、本地欄位、同表其他列(可鎖)、其他表的**已提交**內容。
trigger **看不到**(全部是**第 3 批 worker 的 DoD 硬前置**):
- TapPay Refund 是否真的成功、Record 的累計是 `< / = / >` target、**baseline 與 D9 證據是不是真的來自 Record API**
- 呼叫者以為自己持有哪一把 token ⇒ token CAS 是 worker 的責任
- 🔴 worker 有沒有遵守「**先 commit E2b 戳記、再發 HTTP**」
- 🔴🔴 worker 有沒有遵守「**逾時 / 無回應時不得寫任何東西**」——
  **這是 D7 失效的唯一入口**;D9 只把後果收斂成可偵測,**不能取代這條紀律**
- 🔴 **TapPay 對同一 `bank_refund_id` 重送的實際行為**(自動重試完全依賴它,**PCM 從未實測**)
- 🔴 **`corrected_by <> reviewed_by` 只保證兩個帳號,不保證兩個人**(§3.6)
- 🔴 跨表 bank id 的併發、C2 的併發(§4.3)

### 5.5 `RAISE` 的形狀
普通 `RAISE EXCEPTION` 的 `CONSTRAINT_NAME` 是空的(2026-07-30 實測)⇒
所有 trigger 的 `RAISE` 一律帶 **`USING ERRCODE = '<自訂>'`, `CONSTRAINT = '<具名 ID>'`**,
ID 命名 = `a7bt_<edge 或規則>`。

### 5.6 兩支 `DEFERRED CONSTRAINT TRIGGER`

**(a) 主從一致(C1-C4)+ 後代 item set 相等**:parent `AFTER INSERT` + child `AFTER INSERT OR DELETE`,
皆 `DEFERRABLE INITIALLY DEFERRED`。
🔴 **為何兩支**:只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件**
(`20260725130100:180-186` 的同一個教訓,已實證)。

**(b) job ↔ ledger 等值**:parent **`AFTER INSERT OR UPDATE`**、deferred。
`NEW.status='completed'` 時斷言:`order_refunds` 存在該 `refund_id` 且 `status='confirmed'` 且
`confirmed_at IS NOT NULL`;**逐欄相等**(`order_id` / `bank_refund_id` / `tappay_refund_id` /
`refund_amount` / `items_amount` / 三個運費欄 / `reason` / `actor` / `request_id`);
**item set 雙向無差集**。
🔴🔴 **逐欄一律 `IS NOT DISTINCT FROM`,禁用 `=`**:`tappay_refund_id` 兩邊皆 nullable
(`20260725130100:88`),天真 `=` 遇 NULL 整式為 NULL ⇒ 「不等才 RAISE」**靜默放行**。
🔴 U5 只防「兩個 job 共用一張帳本」,**完全不證明**上面任何一格。

---

## §6 R9-R19 關閉矩陣(誠實版)

| 規格 | 狀態 | 驗收落點 |
|---|---|---|
| R9 baseline + job↔ledger 等值 | 🟡 **半關閉(R6 F7 降級)** | 等值斷言本片關閉(T-E2/T-E4 + §7.4-16)。🔴 **但「怎麼原子完成」本片沒有落點**:service_role 對 job 有 UPDATE、對 `order_refunds` **只有 SELECT**(`20260725130100:312-325` 親驗)⇒ worker **不可能**自己直接 INSERT ledger(必吃 `42501`);若拆成兩次 RPC,**兩次交易之間 crash 會留下單邊完成**。⇒ **現在就立第三批的具名合約**:`public.complete_refund_job(p_job_id uuid, p_claim_token uuid, p_tappay_refund_id text)` = **SECURITY DEFINER**、service_role only、**同一交易**內建立 `order_refunds`(`status='confirmed'`、`confirmed_at`)+ `order_refund_items` + 走 E9 回填 `refund_id`;🔴 **不得用「放寬 ledger 表權限」代替**(那會讓 worker 能繞過本合約直接寫帳)。ID `W-R9-COMPLETE-1`(單交易成功)/`-2`(中途 RAISE 後 ledger 與 job 皆無殘留)/`-3`(service_role 直接 INSERT ledger 必 `42501`) |
| R10 `reconciling` 獨立相位 | ✅ 關閉 | 「`reconciling → processing` 必拒」 |
| R11 `failed` 不在 `submitted` 之後 | ✅ 關閉 | 「`submitted → failed` 必拒」 |
| R12 reclaim + `check_fail_count` 入 schema | ✅ 關閉 | T-E11;CHECK 0-6 |
| R13 歸零 / +1 / CAS | 🟡 半關閉 | CAS 未關閉 ⇒ `W-R13-CAS-1/2` |
| R14 Record 三路 | 🔴 **未關閉** | **hard release gate**,`W-R14-LT/EQ/GT` |
| R15 durable 告警 + LINE 重發 | 🔴 **未關閉** | **hard release gate**。🔴 掃描條件**三段**:①`dead AND manual_review_required AND reviewed_at IS NULL` ②`status IN ('processing','reconciling') AND claim_expires_at < now() - interval '30 minutes'` ③`status IN ('queued','failed') AND coalesce(next_retry_at, created_at) < now() - interval '2 hours'`。🔴 只掃 ① 的話**錢卡住的那天沒有人被叫醒**。ID `W-R15-RESEND` / `-STUCK-LEASE` / `-STUCK-RETRY` |
| R16 結案 RPC 鎖 + 稽核 | 🟡 半關閉 | `admin_resolve_dead_refund_job(p_job_id, p_resolution, p_reviewed_by, p_note, p_recorded_refunded, p_checked_at)`;鎖列後重驗;`UPDATE … WHERE id=$1 AND reviewed_at IS NULL` **rowcount 必為 1** 否則 `ERRCODE='PCM09'`;audit **恰一筆**。ID `W-R16-1`~`-4`、`W-R16-5`(D7 拒)、🔴 `W-R16-6`(**最後一次呼叫的當天按重試必被 D9b 拒**)、🔴 `W-R16-7`(**recorded ≠ baseline 必被 D9d 拒**) |
| **R16b 更正 RPC(D11 新增)** | 🟡 半關閉 | CAS + 兩帳號 = §3.1 E14(本片關閉);RPC 本體第 3 批 = `admin_correct_dead_refund_resolution(…)`。ID `W-R16B-1`(單次成功)/`-2`(第二次更正必拒)/`-3`(`corrected_by = reviewed_by` 必拒)/`-4`(已有後繼列必拒)/`-5`(audit 恰一筆) |
| R17 世代式 + one-current partial unique | ✅ 關閉 | §7.4-1~6 |
| R18 `resolution` 三值分流 | ✅ 關閉 | §7.4-3/4/5 + §7.4-25/27 |
| R19 原子消耗授權 | ✅ 關閉,**機制已換**(D1) | §3.3 命題 + §7.4-2~6 |

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

🔴 **truth table 覆蓋 = 全格,不取樣**(約 90 格)⇒ **每一個 R 格與 N 格各一條負測**;
確實無法獨立構造的格必須**逐格列出理由**。

🔴 **被嚴格支配的約束要標出來,不假裝它被驗過**(R4 F7 的紀律,本輪多兩處):
- D7 的「`dead_reason` 為 NULL 而 `resolution='retry_authorized'`」格 ⇒ truth table 已先禁止
  ⇒ **刪掉 D7 測試仍會紅 = 假覆蓋** ⇒ 改**結構字面驗證**(斷言 `pg_constraint.consrc` 逐字),
  行為突變改用兩個合法 dead reason。
- 🔴 `processing.tappay_refund_id = N` 這格在 trigger 全開時被 D10 支配 ⇒ 同樣標**結構字面驗證**,
  並在 COMMENT 註明「它的價值在 break-glass 期間」(§4.4)。

🔴 **R6 新增的結構斷言(v6 全部沒有)**:
- **欄位 manifest**:`pg_attribute` + `pg_attrdef` 逐欄比對 name / type / notnull / default,
  **且 manifest 的欄位集合必須等於實際集合**(多一欄少一欄都轉紅)⇒ 同時關閉 §5.2-4 的 deny-by-default(F2)
- **七支 FK 的 `confdeltype` 逐支斷言 = `'r'`(RESTRICT)**(F8;只驗「FK 存在」不夠)
- **十支 trigger manifest**(§5.0)逐支斷言 name / `tgrelid` / `tgtype`(**含 timing + 事件 bitmap + ROW/STMT**)/
  `tgdeferrable` / `tginitdeferred` / `tgfoid`(F4)
- **鎖探針**:migration 執行期間並行跑 `create_order` INSERT,量交易總時長 = 持鎖窗上限(F9;§10)
- **rollback preflight 實跑**:在隔離 DB 上真的跑一次六步、驗 `pg_depend` filter 不會誤 abort 空表(F10)

**其餘必覆蓋**:三個計數器上下界 ×6;兩個 ID 長度上下界 ×4、**控制碼與空白逐碼位**(§4.1 的向量,不得自行挑);`payload_hash` ×3;
baseline 成對 ×3;金額 ×3;**D9a 成對 ×2 + 必填 ×2 + D9b ×3(當天/隔日/`last` 為 NULL)+ D9d ×2**;
**D11 的 E14 五條**;五道唯一性 ×5;兩道複合 FK ×2;三支 staff FK ×3;
**16 條 edge** × 每條至少一格額外條件;§5.6(a) C1-C4 ×4;
§5.6(b) 逐欄 ×11(**含兩邊皆 NULL 的 NULL-safe 格**)+ item set ×2;
ACL 八格 × 四角色 = 32 格(**PUBLIC 排最前**);§7.1 八條指紋。

### 7.3 探針設計紀律
- **U2 與 U3 必須分開構造**,否則兩者先紅在同一個索引,**刪掉另一個索引仍全綠**。
- **轉移探針先建出「除了那條 edge 之外全部合法」的列形狀**,再斷言指定 trigger ID。
- 🔴 **所有 fixture 必須經合法 edge 構造,不得直接 UPDATE 造中間態** ——
  **唯一例外見 §7.4 的「時間注入例外」**,且必須逐條列名。
- **不可變欄位與計數器的突變要夾在合法 edge 裡測**。
- 🔴 **刪掉 v1 那條「直接 INSERT `generation+1` 應成功」的正向驗收** —— 它**替重退破口背書**。
- 🔴 **併發斷言不得只寫「不超過一個成功」** ⇒ 必須斷言**恰一成功、另一筆精確失敗於指定 constraint、gen2 恰一列**。

### 7.4 必做測試

🔴🔴 **正向鏈先寫、先跑**:v3 的 24 負測 + 2 正向對三處靜態死鎖**全綠**;v4 補兩條後另兩處死鎖**又全綠**;
v5 的正向鏈 C **自己就是靜態不可能的**(R5 F6)。**負測證明「壞的被擋住」,證明不了「好的走得通」。**

**正向鏈(七條,全部必跑)**
- **A** `queued→E1→processing→E2→E2b→E4→submitted→E8→reconciling→E9→completed`
- **B** `…→E5b dead→E13 結案 retry_authorized→INSERT gen2`
  🔴 **時間注入例外(R5 F7)**:D9b 要求 `checked_at` 的台北日期 **>** `last_refund_call_at` 的台北日期,
  而 E13 又要求 `checked_at <= now()` ⇒ **同一個 session 內無法合法構造**。
  ⇒ 本鏈是**唯一允許的 fixture 例外**:harness 得在跑完合法 edge 之後,**只注入 `last_refund_call_at`
  為兩天前**(不得注入其他欄),並在注入前後各跑一次完整結構斷言。
  🔴 **注入後必須額外驗:把注入拿掉,本鏈的 E13 必須轉紅** —— 否則測到的是 fail-open 而不是閘門。
- 🔴 **C 重試迴圈(R5 F6 修正)**:`E1→E2→E2b→E5 failed→E6 queued→`**`E1→E2b→E5`**`→…` 連走 **6 輪**,
  第 6 輪 `E5b → dead`。
  ⚠️ **第 2 輪起不得再走 E2** —— `refunded_before` 一旦非 NULL 即不可變,E2 要求「由 NULL 變非 NULL」
  ⇒ **v5 寫的「連走 6 輪 E1→E2→E2b」照字面靜態不可能**。
  斷言:`retry_count` 逐輪 1→6、`next_retry_at` 每輪符合 `5min × 2^(n-1)` 且在 E1 後為 NULL、
  `failed_reason` 每次 E6 後為 NULL、`attempted_at` 每次 E5 後為 NULL、
  🔴 **`last_refund_call_at` 每輪 E2b 後嚴格遞增**
- **D 不確定送出鏈**:`E1→E2→E2b→`(lease 過期)`→E3b→reconciling→E10 順延→E8→E11→E9 completed`,
  全程 `tappay_refund_id` 為 NULL,斷言 §5.6(b) 的 NULL-safe 等值放行
- **E 超退鏈**:`…→reconciling→E12(over_refunded)→dead`,斷言 `next_check_at` 為 NULL
- **F 對帳耗盡鏈**:`…→reconciling→E10 異常 ×5→E12(reconcile_exhausted)→dead`,同上
- 🔴 **G 更正鏈(D11 新增)**:`…→dead→E13 結案 external_refund_confirmed→E14 更正為 retry_authorized
  (不同 staff)→INSERT gen2`;另斷言**第二次 E14 必拒**
- 🔴 **另補(R5 nit 2)**:正向鏈需**至少一條經過 E3**(lease 過期但未打款的重領);
  E13 的另兩種 resolution(`external_refund_confirmed` / `over_refund_writeoff`)各需一條正向

**負測**(略去與 v5 相同者,以下為全集要點)
1. `INSERT status='completed'`(其餘全合法)→ 拒
2-5. `generation=2` 前代不是 dead / `external_refund_confirmed` / `over_refund_writeoff` / **舊授權隔代重用開 gen3** → 拒
6. **兩 session 併發重開 gen2** → 後者**必紅於 U1 的 `23505`**;斷言恰一成功、gen2 恰一列
7. `generation=2` 而該 cancellation 零列 → 拒(`NOT FOUND` fail-closed)
8. `INSERT` 已存在於 `order_refunds.bank_refund_id` 的值 → 拒
9. 後代 payload 逐欄不同 / 子表 item set 不同 → 拒
10-11. `submitted→processing` / `reconciling→processing` / `submitted→failed` / `submitted→dead` /
    `completed` 轉出 / `dead→queued` → 皆拒
12. 單獨寫 `reviewed_at` → 拒;已結案的 dead 再走 E13 → 拒
13. 未持久化 baseline 就 E2b → 拒;未戳記就 `processing→submitted` → 拒
14. `attempted_at` 非 NULL 的 lease 過期列走 E3 → 拒
15. `retry_count=5` 的 `processing` 走 E5 → 拒
16. **job↔ledger 等值** ×11 + item set ×3 + 🔴 **NULL-safe 專測**(job 側 NULL、ledger 側非 NULL → **必拒**)
17. 子表四條不變式 + 子表 UPDATE / DELETE → 皆拒
18. **E5 的 backoff 基準**用 `created_at` 或 `OLD.updated_at` → 拒
19. **DELETE / TRUNCATE 一律拒,含 owner 身分**(兩表)
20. 未複核的 dead 仍擋得住同 cancellation / 同 rec_trade_id 的新 job(U2/U3 分開構造)
21. 兩個 job 指向同一 `refund_id` → 拒(U5)
22. **dormant gate 雙向**
23. E6 不清 `failed_reason` → 拒;**E6 重算 `next_retry_at`** → 拒
24. E5 不清 `attempted_at` → 拒
25. **D7**:`over_refunded` / `reconcile_exhausted` 結成 `retry_authorized` → 皆拒
26. E2b 之外的任何 edge 想改 `attempted_at` → 拒
27. 🔴 **D9 全套**:不填證據 → 拒;只填一欄 → 拒;
    **`checked_at` 的台北日期 = `last_refund_call_at` 的台北日期** → 拒(D9b);
    **`last_refund_call_at` 為 NULL 而 resolution=retry_authorized** → 拒(D9b fail-closed);
    **`checked_at > now()`** → 拒(E13);
    **`recorded ≠ refunded_before`** → 拒(D9d);
    **gen2 的 E2 baseline ≠ 前代 `recorded`** → 拒(D9c)
28. **E1 的 lease 錨點**:`claimed_at` 給未來 / 給過去 → 拒;`next_retry_at` 未到期就 claim → 拒;
    E1 不清 `next_retry_at` → 拒
29. **`tappay_refund_id` 首寫獨佔**:E8 / E10 / E11 / E9 把 NULL 改成假 ID → 皆拒
30. **E12 不清 `next_check_at`** → 拒
31. **`last_refund_call_at` 被清空或往回改** → 拒
32. 🔴 **D12**:`attempted_at` 為 NULL 的 `processing` 走 E5 或 E5b → 拒
33. 🔴 **D11 / E14**:未結案就走 E14 → 拒;第二次 E14 → 拒;`corrected_by = reviewed_by` → 拒;
    **已有後繼列仍走 E14** → 拒;E14 改 `reviewed_at`/`reviewed_by` → 拒;`correction_reason` 空白 → 拒
34. 🔴 **時區**(R5 F3):把 session `TimeZone` 設成 `UTC` 與 `Asia/Taipei` 各跑一次 D9b 的邊界案例,
    **兩次結果必須相同** —— 若實作用了 `date_trunc('day', ts)` 而非 `AT TIME ZONE 'Asia/Taipei'`,
    這條會轉紅。E3b / E4 的隔日基準同樣各跑兩次
35. 🔴 **exact-one classifier**(R6 F1):**同時滿足兩條 edge 的列** → 拒於 `a7bt_edge_ambiguous`;
    **一條都不滿足的列** → 拒於 `a7bt_edge_unmatched`。
    🔴 兩條都必須是**真的構造得出來**的形狀,不是宣告;構造不出來就明文說明為什麼
36. 🔴 **deny-by-default**(R6 F2):在測試 DB 對 `order_refund_jobs` 加一個不在 manifest 的欄,
    **結構斷言必須轉紅**(這條同時證明 manifest 沒有被繞過)
37. 🔴 **完成介面**(R6 F7)—— 🔴 **v7 更正(2026-07-31):本條原本整條列在 A7b-T 驗收,
    但其中兩項屬第 3 批,本片測不了。已切成兩半:**
    - **本片(A7b-T)必做**:service_role 直接 `INSERT INTO order_refunds` → 必 `42501`。
      純 ACL 斷言,不需要任何新函式 ⇒ 現在就構造得出來。
    - **⛔ 第 3 批 worker 片(不在本片驗收內)**:`complete_refund_job()` 單交易成功(`W-R9-COMPLETE-1`)/
      中途 `RAISE` 後 ledger 與 job 皆無殘留(`W-R9-COMPLETE-2`)。
      🔴 該函式由 §6 R9 列為**第 3 批的具名合約**、本片不建立
      ⇒ 在 A7b-T 的 harness 裡放這兩條等於測一個不存在的函式,只會產生假紅或被靜默跳過。

### 7.5 靜態可達性矩陣(**強制交付物;v6 已填完,R5 F9**)

R5 抓到:v5 宣稱這是強制交付物,**卻沒有對自己跑過**(模板留空)—— 與 R2 #6「要求未來再列」同型。
以下為 v6 的實際結果(「差集」= 終點要求與起點形狀不同、而本 edge 沒有明文規定怎麼改的欄位):

| Edge | 起點 → 終點 | 需要改變的欄位 | 本 edge 明文負責 | 差集 |
|---|---|---|---|---|
| E1 | queued → processing | lease N→R;`next_retry` −→N | 設 lease(錨點)、清 `next_retry` | **空 ✓** |
| E2 | processing → processing | 無(baseline 不在表內) | 設 baseline 成對 | **空 ✓** |
| E2b | processing → processing | 無(`attempted_at` 在 processing 為 −) | 設 `attempted_at` / `last_refund_call_at` | **空 ✓** |
| E3 | processing → processing | 無 | 換 lease 三欄 | **空 ✓** |
| E3b | processing → reconciling | `attempted_at` −→R(前提已要求非 NULL);`next_check` N→R;`tappay` N→−(放寬) | 換 lease、設 `next_check` | **空 ✓** |
| E4 | processing → submitted | lease R→N;`attempted_at` −→R(前提);`next_check` N→R;`tappay` N→−(寫入) | 清 lease、設 `next_check`、首寫 `tappay` | **空 ✓** |
| E5 | processing → failed | lease R→N;`attempted_at` −→N;`next_retry` N→R;`failed_reason` N→R;`rc` 0-5→1-5 | 清 lease、清 `attempted_at`、設 `next_retry`、設 `failed_reason`、`+1` | **空 ✓** |
| E5b | processing → dead | lease R→N;`dead_reason` N→R;`manual_review` false→true | 清 lease、設兩者、清 `attempted_at`/`next_retry` | **空 ✓** |
| E6 | failed → queued | `failed_reason` R→N;`next_retry` R→−(放寬) | 清 `failed_reason`、保留 `next_retry` | **空 ✓** |
| E8 | submitted → reconciling | lease N→R | 設 lease(錨點) | **空 ✓** |
| E9 | reconciling → completed | lease R→N;`next_check` R→N;`refund_id` N→R | 清 lease、清 `next_check`、設 `refund_id` | **空 ✓** |
| E10 | reconciling → submitted | lease R→N | 清 lease、推後 `next_check` | **空 ✓** |
| E11 | reconciling → reconciling | 無 | 換 lease 三欄 | **空 ✓** |
| E12 | reconciling → dead | lease R→N;`next_check` R→N;`dead_reason` N→R;`manual_review` false→true | 全部明文 | **空 ✓** |
| E13 | dead → dead | review 三欄 N→R | 明文只寫 review 三欄 + D9 兩欄 | **空 ✓** |
| E14 | dead → dead | 無(review 三欄已 R) | 改 `resolution` + D9 兩欄 + `corrected_*` | **空 ✓** |

**反向兩問**:
- **進得去**:`queued`←INSERT/E6 · `processing`←E1 · `submitted`←E4/E10 · `reconciling`←E3b/E8 ·
  `failed`←E5 · `dead`←E5b/E12 · `completed`←E9 —— **七態全部有入邊 ✓**
- **出得來**:`queued`→E1 · `processing`→E2/E2b/E3/E3b/E4/E5/E5b · `submitted`→E8 ·
  `reconciling`→E9/E10/E11/E12 · `failed`→E6 · `dead`→E13/E14(自轉,設計上為終態)·
  `completed`=終態 —— **無非預期死角 ✓**

🔴🔴 **本矩陣的能力邊界(R5 F10;不得省略)**:
它**只看得到 truth table 裡的欄位**。`last_refund_call_at`、D9 兩證據欄、`corrected_*` 三欄、
`refunded_before/target` **都不在表內** ⇒ **涉及它們的死鎖這張表看不到**
(實例:正向鏈 B 在 D9b 下無法同 session 構造、正向鏈 C 第 2 輪的 E2 不可能 —— **兩條都是 R5 用別的方法抓到的**)。
語意類、時間類、跨表類的問題(R4 F5、R5 角度 A 全部五條)也在它視野外。
⇒ **§7.5 只擋「truth-table 差集」這一類復發,不擋別的。**
⇒ **rule 4(機器化)**:A7b-T 的 harness 必須從 §3.1 + §4.4 產生列形狀,**對每條 edge 實跑一次合法轉移**,
跑不過**當場中止**。這一條才是真機制;rules 1-3 是計畫期人工檢查,**必須在每一版 plan 本文填完**,
不得留空表(v5 就是留空表被抓)。

---

## §8 誠實邊界(**唯一權威的宣稱清單**)

**環境 / 範圍**
- 本機 PG17.10 非 Supabase;`auth.uid()` 是 shim
- 本片**零 TapPay 接觸**:「隔日生效」「Record 三路」全是合約文字

**已知擋不住的(逐條指名)**
1. **trigger 不保證 fencing**;token CAS 屬 worker,第 3 批才被證明
2. 🔴 **D7 不是安全證明,是必要條件** —— 擋不住「worker 逾時誤寫 E5」
3. 🔴 **D9a 不驗證數字是真的**,它是稽核要求
4. 🔴 **D9c 與 D9d 共模失效**:兩邊都讀 Record API,Record 本身回錯 ⇒ 兩條 CHECK 一起綠
5. 🔴 **D9b 建立在「TapPay 隔日後 Record 必定反映」這個未實測假設上**;
   且「隔日」的精確定義官方無逐字說明 ⇒ 採 `Asia/Taipei` 日曆日界是**推斷**
6. 🔴 **`retry_auth_checked_at` 與 `retry_auth_recorded_refunded` 由呼叫者填**;
   E13 只能驗 `<= now()` 與等值關係,**驗不到它們是否真的來自一次 Record 查詢**
7. 🔴🔴 **自動重試(最多 6 次)完全依賴 TapPay 對同一 `bank_refund_id` 的冪等性,PCM 從未實測**
   ⇒ 第 3 批 **sandbox hard release gate**。(v4 曾寫「沒有任何路徑會重送同一筆 Refund」,**那句是錯的**)
8. **TapPay 文件只寫 `status=0` 是成功,沒有依據支持「非 0 回應必然零副作用」**
   ⇒ 連「明確失敗」都不等於「零金額移動」
9. 🔴 **`corrected_by <> reviewed_by` 只保證兩個 `staff.id`,不保證兩個人**(§3.6)
10. **D2 的一半正確性在 worker 手上**(先 commit 再發 HTTP + 逾時不得寫任何東西)
11. **兩條併發合約債**(§4.3 跨表 bank id、C2 的 Σ)—— 現行規劃內不可觸發,**那是推論不是防護**
12. `reviewed_by` / `corrected_by` 在 E8-B 上線前**只是操作者自陳,不是已驗證身分**
13. **第 20 代之後無出口**(§4.1)
14. 🔴 **§7.5 的矩陣只擋 truth-table 差集這一類**(§7.5 末段)
15. 🔴 **正向鏈 B 需要時間注入例外**(§7.4)⇒ D9b 的**正向**路徑不是純合法 edge 構造

## §9 27 項綠燈宣稱
**兩片皆不宣稱任何項變綠**(原則 4)。第 19 項的退款面在第 3 批。

## §10 Migration 骨架 / rollback / rollout
- 兩支皆:顯式 `BEGIN;` + `SET LOCAL lock_timeout='5s'` + `statement_timeout='60s'` + `COMMIT;`(D0-1 拍板)
- 結尾各自 fail-closed 結構驗收 DO block,斷言帶機器可辨識 ID
- 🔴 **rollback 順序寫死**(先 DROP parent 會被 child FK 擋)。**R6 F10:v6 把 `pg_depend` preflight
  排在第 ⑥ 步 —— 那時東西早就 DROP 完了,等於沒有 preflight。順序已更正:**
  1. **`pg_depend` preflight**(**在任何 DROP 之前**):查兩表與全部函式的**外部**依賴。
     🔴 **必須給 filter,不能「非空即 abort」** —— 空表本來就有一堆 **internal** 依賴
     (PK/UNIQUE 的 index、CHECK constraint、FK、trigger、`pg_type` 的 composite type、DEFAULT 的 sequence),
     不 filter 會**永遠 abort**。判定 = `deptype = 'n'`(normal)且 `refobjid` 不屬於本片建立的物件集合;
     預期 internal 依賴集合**逐項列出**當白名單,出現白名單外的即 abort。
  2. 停 writer(第 3 批之前 = 無 writer)
  3. 驗兩表為空,非空則**備份後停下 raise Sean**(不得靜默續行)
  4. `DROP TRIGGER` 子表四支 → `DROP TABLE order_refund_job_items` **`RESTRICT`**(明寫,不靠預設)
  5. `DROP TRIGGER` parent 六支 → `DROP TABLE order_refund_jobs` **`RESTRICT`**
  6. `DROP FUNCTION` 全部函式(逐一具名,**共 7 支**:6 支 trigger 函式 + 1 支白名單 helper)
     🔴 **v7 二次更正(2026-07-31,關卡2 F9)**:本步原寫「5 支」,我第一次改成「6 支」仍不完整。
     實作另有一支**非 trigger** 的 helper `public.pcm_a7bt_allowed_delta(text)`
     (逐 edge 的 allowed-delta 白名單,單一真相)—— 它不在 §5.0 的 trigger manifest 裡,
     所以照 manifest 列 rollback 會**漏掉它**,重建 M/T 時會先撞「已有同名函式」而失敗。
     ⇒ rollback 的依據改為「**本片建立的所有函式**」,不是「trigger manifest」。
     §5.0 的十支 trigger 去重後是 **6 支** trigger 函式 ——
     `pcm_a7bt_jobs_before_insert` / `pcm_a7bt_jobs_before_update` / `pcm_a7bt_block_write`(三支共用)/
     `pcm_a7bt_block_truncate`(兩支共用)/ `pcm_a7bt_assert_job_consistent`(兩支共用)/
     `pcm_a7bt_assert_job_ledger_equal`;**第 7 支 = `pcm_a7bt_allowed_delta(text)`**。
     **照舊字面寫 rollback 會漏 drop 一到兩支。**
     ⇒ 驗收:§7.2 的函式指紋必須逐支列名且**集合相等 = 7 支**,不得只寫死數字。
     (已實作於 `20260731120100` §9.4:`md5(prosrc)` 逐支比對 + `count = 7` + 完整 ACL allowlist。)
  🔴 只允許在第一個 writer 之前;之後只能 forward repair,**列為第 3 批 worker 片的 DoD 硬前置**

- 🔴🔴 **鎖 manifest 與結帳併發探針(R6 F9;v6 只有 timeout,沒有逐物件鎖清單)**

  | 步驟 | 鎖到哪張表 | lock mode | 會不會擋結帳 |
  |---|---|---|---|
  | `CREATE TABLE` 兩表 | 只有新表 | — | 否 |
  | dormant gate `CHECK (false)`(隨 `CREATE TABLE` 宣告,見 §1.1)| 只有 `order_refund_jobs` | — | **否**(與表同生,無額外鎖) |
  | A7b-T 的 `DROP CONSTRAINT`(移除 gate) | 只有 `order_refund_jobs` | `ACCESS EXCLUSIVE` | **否**(gate 期間表恆空、無 writer) |
  | 🔴 **子表 FK → `order_items (order_id, id)`** | **`order_items`(被引用表)** | **`SHARE ROW EXCLUSIVE`** | 🔴🔴 **會** —— 與 `create_order` 的 `INSERT`(`ROW EXCLUSIVE`)**互相衝突** |
  | `FK → order_cancellations / staff / order_refunds` | 各被引用表 | `SHARE ROW EXCLUSIVE` | 視該表是否在結帳路徑上 |

  🔴 **真正的風險不是 dormant gate,是建 FK 時對 `order_items` 的鎖** ——
  v6 誤以為 timeout 就夠了。**`lock_timeout` 只保護 migration 自己等不到鎖時放棄,
  不保護「結帳交易在等 migration 放鎖」** ⇒ migration 一旦拿到鎖,結帳會卡到它 COMMIT。
  ⇒ **驗收必須沿用 A1 的 barrier lock probe**:migration 執行期間並行跑 `create_order` INSERT,
  量**交易總時長 = 持鎖窗上限**(不是「有沒有觀察到阻塞」——
  memory `feedback_race-test-without-barrier-proves-nothing`:沒觀察到不能反推持鎖多短)。
  ⇒ 挑離峰 apply;超過可接受上限則拆片(先建表、FK 另一支 migration 走 `NOT VALID` + `VALIDATE`)。

- **rollout**:A7-t 單獨 apply → read-back → A1 → read-back → 本兩片**接續**;`db push` 前先 `--dry-run`。

  🔴🔴 **M/T 三方狀態矩陣(R6 F11:v6 只有名字、沒有格子)**。
  三個維度:**①migration ledger**(`supabase_migrations.schema_migrations` 有無該版本)
  **②schema 事實**(物件是否存在 + §7.1 指紋)**③dormant gate 是否還在 + 兩表 row count**。
  🔴 **「ledger」在本檔有兩個意思,不可混用**:此處指 **migration 版本登記表**,
  **不是** `order_refunds` 業務帳本。

  | # | migration ledger | schema 事實 | gate / 資料 | 判定與下一步 |
  |---|---|---|---|---|
  | 1 | M 無 | M 物件無 | — | 乾淨,**可重跑 M** |
  | 2 | 🔴 **M 無** | **M 物件在** | gate 在、兩表空 | **SQL 已 COMMIT 但登記失敗** ⇒ **禁止重跑**(非冪等 `CREATE` 會撞)⇒ **只補登 ledger** |
  | 3 | M 有 | M 物件在 | gate 在、兩表空 | 正常中間態,**可續跑 T** |
  | 4 | M 有 | M 物件在 | 🔴 **gate 在,但表非空** | **不可能狀態** ⇒ 立即停機 raise Sean(gate 在就寫不進去) |
  | 5 | T 無 | T 物件無 | gate 在 | **可重跑 T** |
  | 6 | 🔴 **T 無** | **T 物件在、gate 已移除** | 兩表空 | **最危險**:守門已生效但沒登記 ⇒ **禁止重跑**、**只補登 ledger**;補登前不得放 writer 進來 |
  | 7 | T 有 | T 物件在、gate 已移除 | 兩表空 | **完成** |
  | 8 | 任一 | 指紋與 §7.1 不符 | — | **forward repair**,不得 rollback、不得重跑 |

  🔴 **A7b-M 成功但 A7b-T 失敗 = 情境 3**,由 dormant gate 承接,**不是異常**。

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
- **§0b 的 D1-D12**:D1-D8 已拍 A、D11 = Q2=B 已拍、D10/D12 屬修 bug;
  🔴 **D9 需要重新確認**(§14)—— 因為 Sean 答 Q4=A 時看到的描述**已被 R5 證明誇大**
- 第 3 批「退款線兩題」是**第 3 批開批閘**,本片不受阻;若答案與本合約衝突,需回頭改

## §13 折入紀錄

| 輪 | 模型 | 角度 | 結果 | 其中「修上一輪自捅」 |
|---|---|---|---|---|
| R1 | codex xhigh | 逐條條文稽核 | FAIL 35+5 | — |
| R2 | codex xhigh | 逐條條文稽核 | FAIL 18+4 | **8 / 18** |
| R3 | **Fable** | 假設審查 / 災難日 / 修法回歸 / 測試假綠 | FAIL 11+3 | **4 / 11** |
| R4 | codex xhigh | v3→v4 diff 的靜態可達性與宣稱稽核 | FAIL 7 | **5 / 7** |
| R5 | **Fable** | D9 是不是第三層名過其實 / v5 回歸 / §7.5 是不是真機制 / §8 完整性 | FAIL 11+2 | **3 / 11** |
| R6 | codex xhigh | **實作者視角 + 跨片介面**(沒參與過討論的人寫不寫得出 SQL / 親開五支既有 migration 逐條核 / 鎖與回滾實務) | FAIL 11 | 1 / 11(F4 六支 vs 十支) |

**R6 的正向核對結果(被證實成立的部分,同樣要記錄)**:親開五支既有 migration 後確認 ——
`order_cancellations (id, order_id)` 唯一約束存在且欄序正確 / `order_refunds (id, order_id)` 與
`order_items (order_id, id)` 皆存在 / `staff.id` 是 `text PRIMARY KEY`、三支 job staff FK 型別吻合 /
**job↔ledger 的 11 欄全部存在、型別相容**、無「規格以為存在但帳本沒有」的欄 /
規格引用的既有行號與名稱**未找到錯置** / 最新 `create_order` 不讀寫本片新表、**無 runtime 路徑衝突**。
另兩點 PostgreSQL 語法核可:§4.4 的 truth table **每格都只依同一列 ⇒ 可落成單一 `CASE CHECK`**;
§5.6(a) 的 `AFTER INSERT` / `AFTER INSERT OR DELETE` constraint trigger **語法成立**。

🔴 **R6 的 F3 / F6 未折入,原因寫在下面 §14 Q5**(不是漏掉、不是駁回):
- **F3** 要求 plan 內附**完整 `CREATE TABLE` DDL manifest**(逐欄 name/type/null/default/check)
- **F6** 要求 §7.5 rule 4 的 fixture **生成器輸入**(每條 edge 的 machine-readable old row / patch /
  支援列 / 時鐘策略 / 完整 post-row)
⇒ 兩者都是「把 SQL 用中文再寫一遍」。**它們是真缺口**(兩個人會寫出兩種東西),
但關閉方式有兩條路,**流程層的選擇屬 Sean**。

- **駁回 0**;**改採不同修法 1**(R2 #2 → D1,§3.3;R3 已對該證明的三個前提逐一攻擊,兩個擊破失敗)。
- 🔴 **R3 F5 → R4 F5 → R5 F1 是同一個病的三層**,每一層都是「防護被命名成超出它的實際能力」。
  ⇒ v6 起,每一句「⇒ 所以安全」都必須指得出具名 constraint;指不出來的改寫並進 §8。
- 🔴 **R5 確認 v5 的 truth-table 級差集已全部歸零**(15 條 edge 逐條驗過);自捅比例 8/18 → 4/11 → 5/7 → 3/11。
- **master plan 每輪逐字重寫**;**CURRENT.md 每輪同步**。

## §14 給 Sean 的決策題

Q1(D1-D8)= **A**;Q2(結案更正)= **B ⇒ D11**;Q3(generation 上限)= **A,維持 20**;
Q4(D9,以更正後的描述重問)= **A**。以上四題已落檔。

```
🔴 Q5(新;R6 F3/F6 —— 這是流程題,不是技術題):

第六輪審查說:這份規格「設計已經完整,但精確度還不夠讓一個沒參與過討論的人
直接寫出 SQL」。缺的兩樣東西是:
  ①完整的建表語法(每一欄的名稱、型別、能不能空、預設值)
  ②測試腳本要怎麼自動生出每條路徑的測試資料

問題是:這兩樣東西寫進規格書,等於「先用中文寫一遍 SQL,再用 SQL 寫一遍」。

你要:

A: A(直接進實作:我開始寫 migration,那份 SQL 本身就是規格;
      同時在測試裡加一組結構斷言,把「SQL 有沒有偏離規格」釘死
      —— 少一欄多一欄、FK 行為不對、trigger 數量或事件不對,測試就轉紅)
      ⇒ 不再多一輪紙上作業。省下的時間拿去把測試寫厚。  ← 我推薦

   | B(先把完整建表語法與測試資料規格補進規格書,再審一輪,然後實作等於抄)
      ⇒ 多一輪紙上作業(估 1-2 小時 + 一輪審查),換「實作階段幾乎不可能寫錯」。

   | C(先照 A 走,但實作完 migration 之後、寫測試之前,先讓你看一次建表語法)
```

```
🔴 Q4 需要重新確認 —— 你上次選 A,但我當時給你的描述是誇大的。

我當時寫:「③系統開下一張卡時會再查一次,對不上就自己停住」。
第五輪審查證明:當時的設計裡根本沒有那一步比對,真正的擋點是
「人看到數字變大要自己起疑」—— 那不是系統擋,是人擋。
另外那個「隔天才能按」的閘門,我錨錯了時間點(錨第一次呼叫、
但風險在最後一次),所以第 4 輪失敗後當天就能按,閘門形同虛設。

v6 已經把這兩個洞補起來,現在的 A 是:
  ①要按重試,必須是「最後一次送出的隔天(台灣時間)以後」
  ②按的時候必須填入當下 TapPay 查到的已退金額
  ③那個金額必須跟這張卡開始時查到的金額一樣 —— 不一樣就按不下去
  ④系統開下一張卡時會再查一次,跟②對不上就自己停住
  ⑤①③④都是資料庫層的具名規則,不是靠人自律

它仍然擋不住的:TapPay 那邊「隔天一定看得到」這件事,我們從來沒實測過。
如果 TapPay 隔天還沒反映,以上四道全部會放行。

你要:
A: A(採用上面這個修正版,並把「TapPay 隔天是否一定反映」列為第 3 批上線前
      必須在 sandbox 實測的硬關卡)   ← 我推薦

   | B(最保守:只要退款請求送出去過,系統就永遠不再自動重退,一律人工去
      TapPay 後台處理)—— 可證明零重退,不依賴任何未實測假設;
      代價是「TapPay 當機、六次都明確失敗、隔天恢復」也要人工做。
      以每月 100-300 筆的量,這種情況一年可能十幾次。

   | C(先照 A 做,但把「隔天才能按」改成「三天才能按」,用時間換確定性)
```
