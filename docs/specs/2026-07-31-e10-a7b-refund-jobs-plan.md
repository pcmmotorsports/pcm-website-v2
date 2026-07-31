# E10 第 1 批 · A7b「退款工作表 + 狀態機合約」片級 plan **v4**

> 🔴 **關卡1 三輪皆 FAIL,全部已折入本檔**:
> **R1** codex `gpt-5.6-sol` xhigh — 35 must-fix + 5 nit(`docs/reviews/2026-07-31-e10-a7b-k1-codex.md`)
> **R2** codex `gpt-5.6-sol` xhigh — 18 must-fix + 4 nit(`docs/reviews/2026-07-31-e10-a7b-k1r2-codex.md`)
> **R3** **Fable(換模型)** — 11 must-fix + 3 nit(`docs/reviews/2026-07-31-e10-a7b-k1r3-fable.md`)
> 三輪合計 **64 must-fix + 12 nit**,折入 64/64、駁回 0、改採不同修法 1(§13)。
> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 25(已逐字重寫,不靠段首覆蓋)。
> 決策全文 = memory `project_m4b-a7b-refund-jobs-decisions`。
> 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構)⇒ 兩關對抗審查皆跑,不降級。
>
> 🔴🔴 **本檔最重要的一課(R3 抓,寫在最前面)**:
> v3 §3.3 寫了一個形式證明,主張「一代最多一個後繼」。**那個證明機械上是對的,但它答錯了問題** ——
> 我們要保證的是「**同一筆錢只退一次**」,不是「一代一後繼」。
> 兩者之間差了一整條路徑:一個**已經被 TapPay 受理**的退款進了 `dead`,若被人結成「授權重試」,
> 下一代會帶**全新的 `bank_refund_id`** 再打一次 —— TapPay 的冪等鍵**不會擋**,錢真的出去兩次。
> ⇒ **證明的結論正確 ≠ 命題選對**。這條由 §4.4 的 `orj_retry_auth_only_from_retry_exhausted` 關閉。

---

## §0 Sean 2026-07-31 四拍板(前提,未變)

| 題 | 拍板 | 連動 |
|---|---|---|
| Q1 | **A**:A7-t 先單獨 apply + read-back,再套 A1 | 寫進 A1 plan §3.4;本片排在其後 |
| Q2 | **A**:拆成 `A7b-M` + `A7b-T` 兩片 | master plan row 25 與 §5.0 DAG 已改 |
| Q3 | **B**:結案併發 = 鎖列 + `reviewed_at IS NULL` 當 CAS 條件 | master plan「結案 RPC 走 token CAS」字面已作廢 |
| Q4 | **B**:帳本快照另開子表 `order_refund_job_items` | 不採「隔日重算」 |

---

## §0b 八個設計改動(**推翻 master row 25 既有字面,需 Sean 知情;擋 apply、不擋寫 code**)

| # | 改動 | 為什麼(一句話) | 出處 | 落點 |
|---|---|---|---|---|
| **D1** | 🔴 **刪除 `retry_consumed_at` 欄** | 它是「後繼列存在」的抄本,零額外防護;而戳它必須 UPDATE 一列已複核的 dead ⇒ 與「已複核 dead 永久凍結」互斥 | R2 #2 | §3.3 |
| **D2** | 新增 `refund_call_attempted_at` | 沒有它,lease 過期**分不出「還沒打 TapPay」與「打了但沒寫回」** | R2 #13 | §3.4 |
| **D3** | 刪 E7、新增 E5b、E12 吃下第六次 | 第六次失敗必須**原子**進 dead | R2 #3 | §3.1 |
| **D4** | A7b-M 加 dormant `CHECK (false)`,A7b-T 同交易移除 | 「兩片同批 apply ⇒ 風險窗為零」已被證偽(兩支各自 COMMIT) | R2 #14 | §1.1 |
| **D5** | 新增 `dead_reason` 值域 CHECK | v2 的 dead 沒有可顯示的死因 | R2 #4 | §4.4 |
| **D6** | 🔴 **新增 E2b「退款呼叫戳記」edge** | D2 要 worker 先 commit 戳記再發 HTTP,**但 v3 沒有任何 edge 允許那個 UPDATE** ⇒ 整條正向鏈走不通 | **R3 F4** | §3.1 |
| **D7** | 🔴🔴 **`retry_authorized` 鎖死在 `dead_reason='retry_exhausted'`** | 沒有它,**已被 TapPay 受理**的退款可被結成「授權重試」⇒ 全合法路徑退第二次錢 | **R3 F5(本輪最重)** | §4.4 |
| **D8** | 明文 break-glass 更正程序 | 結錯 `resolution` = 合約內**永久死局**,唯一實際出路(owner DISABLE TRIGGER)v3 隻字未提 | **R3 F6** | §12.1 |

🔴 **D6-D8 全部出自「修 R2 時自己開的新洞」** —— 與 R1→R2 的 8/18 同一復發模式。本檔 §7.4 已補上專門抓這類洞的正向鏈。

---

## §1 片界(Q2=A;鐵則 4)

| 片 | 型 | 交付 | 版本號 |
|---|---|---|---|
| **A7b-M** | M | 兩表、所有 CHECK、**五道**唯一性、索引、完整 ACL、COMMENT 合約、**dormant gate** | `20260731120000` |
| **A7b-T** | T | **移除 dormant gate** + 六支守門 trigger + 行為探針 + 突變 harness | `20260731120100` |

### 1.1 dormant gate(D4)

「兩片必須同批 apply ⇒ 風險窗實際為零」**是錯的** —— 兩支 migration **各自 COMMIT**;
A7b-T 失敗時 A7b-M 會單獨留在正式站,而 plan 自己的三方狀態矩陣就承認半批可能。

```sql
ALTER TABLE public.order_refund_jobs
  ADD CONSTRAINT order_refund_jobs_dormant_until_triggers CHECK (false) NOT VALID;
```
- `NOT VALID` 只影響既有列(表是空的、無差別),**新 INSERT 一律被擋**。
- A7b-T 在**所有守門安裝並通過結構驗收之後、同一交易的最後一步** `DROP CONSTRAINT`。
- T 失敗 ⇒ 整支回滾 ⇒ gate 留在原地 ⇒ **表存在但寫不進去**。
- 驗收:**兩個方向都要測**(M 之後合法 INSERT 必拒 / T 之後同一筆必過),否則等於沒證明 gate 被移除過。

---

## §2 這片在做什麼

`order_refund_jobs` = **卡片退款的工作表**:一次要退的錢 = 一列 job,
由第 3 批的 worker 拿去打 TapPay、隔日對帳、最後同交易寫進既有的 `order_refunds` 帳本。
**交付的是規則,不是行為。** worker 照這份合約寫,不得另立。

### 2.1 為什麼需要工作表
TapPay 退款**隔日才生效**(`docs/reference/tappay-reference.md` **§2.3**,親驗 = 該檔第 107 行):
Refund API 回 status 0 只代表「已送出」。⇒ 送出與確認之間必須有**可持久化、可重入、可對帳**的中間狀態,
否則 crash 或重試 = **退兩次錢**。

### 2.2 範圍界線
**不做**:worker / 排程 / 任何 TapPay 呼叫 / enqueue RPC / 人工結案 RPC(全在第 3 批);
不碰 `order_refunds`、`order_cancellations`、`orders`、`order_items` 既有結構
(🔴 **實查**:`order_cancellations` 已自帶 `UNIQUE (id, order_id)`,`20260730130000:125-126`
⇒ 本片要的複合 FK **不需要 ALTER 任何既有表**);
**不加 enum type**(`ALTER TYPE … ADD VALUE` 不可逆、新值不能同交易用)⇒ 一律 `text` + 具名 CHECK。

---

## §3 狀態機

```
queued ─E1─▶ processing ─E2 baseline─▶ ─E2b 戳記─▶ ─E4─▶ submitted ─E8─▶ reconciling
   ▲            │ ▲                                                          │ ▲
   │            │ └─E3 lease 重領(戳記為 NULL = 確定沒打過)                  │ └─E11 重領
   │            ├─E3b lease 重領(戳記非 NULL = 不確定)──────────────────────▶┘
   │            ├─E5 明確失敗─▶ failed ─E6 backoff─┘                          │
   │            └─E5b 第六次明確失敗─▶ dead ◀─E12 超退 / 第六次查詢異常───────┤
   └────────────────────────────────────┘        ▲              E10 累計<target ─▶ submitted
                                    E13 結案(dead→dead,一次性)  E9 累計=target ─▶ completed
```

### 3.1 逐條轉移(**15 條**;A7b-T 逐條擋,**表外的組合一律拒絕**)

🔴 時間與計數器一律寫死公式(R2 #4)。下表全部是 **trigger 當場可驗**的;驗不到的一律進 §5.4。

| # | 從 → 到 | trigger 必驗條件(逐條可測) |
|---|---|---|
| E1 | `queued → processing` | `NEW.claim_token IS NOT NULL` 且 `OLD.claim_token IS NULL`;`NEW.claim_expires_at = NEW.claimed_at + interval '5 minutes'`;`OLD.next_retry_at IS NULL OR OLD.next_retry_at <= NEW.claimed_at`;`refund_call_attempted_at IS NULL`;其餘欄不得改 |
| E2 | `processing → processing`(**baseline 初始化**)| `claim_token` **不變**;`refunded_before`/`refunded_target` 由 NULL 變非 NULL(成對);lease 三欄不變;`refund_call_attempted_at` 仍 NULL;不得改其他欄 |
| **E2b** | `processing → processing`(**退款呼叫戳記,D6/R3 F4**)| `claim_token` **不變**;lease 三欄不變;`refunded_before`/`refunded_target` **已非 NULL**;`OLD.refund_call_attempted_at IS NULL` 且 `NEW.refund_call_attempted_at = now()`;**其餘欄一律不得改** |
| E3 | `processing → processing`(**lease 重領,確定未打款**)| `OLD.claim_expires_at <= now()`;lease **三欄全換新**(`NEW.claim_token <> OLD.claim_token`、`NEW.claim_expires_at = NEW.claimed_at + interval '5 minutes'`);🔴 `OLD.refund_call_attempted_at IS NULL`;不得改其他欄 |
| E3b | `processing → reconciling`(**不確定送出,D2**)| `OLD.claim_expires_at <= now()`;🔴 `OLD.refund_call_attempted_at IS NOT NULL`;lease 三欄全換新;`NEW.next_check_at >= date_trunc('day', OLD.refund_call_attempted_at) + interval '1 day'`;兩個計數器不變 |
| E4 | `processing → submitted` | 🔴 `refunded_before`/`refunded_target` **必須已非 NULL**(未持久化 baseline 不准送款);🔴 `OLD.refund_call_attempted_at IS NOT NULL`(沒戳記就不可能有成功回應);`NEW.tappay_refund_id IS NOT NULL`;**清空 lease 三欄**;`NEW.next_check_at >= date_trunc('day', OLD.refund_call_attempted_at) + interval '1 day'` |
| E5 | `processing → failed`(**明確失敗**)| `btrim(NEW.failed_reason) <> ''`;`NEW.retry_count = OLD.retry_count + 1` 且 🔴 **`<= 5`**;清空 lease 三欄;🔴 **`NEW.refund_call_attempted_at IS NULL`**(結果已知 ⇒ 戳記必須清掉,否則重試迴圈永遠開不了,R3 F2) |
| E5b | `processing → dead`(**第六次明確失敗**,D3)| `NEW.retry_count = OLD.retry_count + 1 = 6`;`NEW.manual_review_required = true`;`NEW.dead_reason = 'retry_exhausted'`;`btrim(NEW.failed_reason) <> ''`;清空 lease 三欄;🔴 **`NEW.refund_call_attempted_at IS NULL`** |
| E6 | `failed → queued` | `retry_count` 不變且 `<= 5`;🔴 **`NEW.failed_reason IS NULL`**(不清就違反 `queued` 的 truth table ⇒ 整條重試迴圈靜態不可能,R3 F1);`NEW.next_retry_at = OLD.updated_at + (interval '5 minutes' * power(2, OLD.retry_count - 1))`;lease 三欄仍為 NULL;`refund_call_attempted_at` 已由 E5 清為 NULL、不得改;不得改其他欄 |
| E8 | `submitted → reconciling` | `NEW.claim_token IS NOT NULL` 且與 `OLD` 不同;lease 三欄全換新;`OLD.next_check_at <= now()` |
| E9 | `reconciling → completed` | `refund_id` 由 NULL 變非 NULL;清空 lease 三欄;`NEW.next_check_at IS NULL`;**另由 §5.6(b) 逐欄比對帳本** |
| E10 | `reconciling → submitted` | `NEW.next_check_at > OLD.next_check_at`;清空 lease 三欄;**成功查到但未達標 ⇒ `NEW.check_fail_count = 0`**;**查詢異常 ⇒ `NEW.check_fail_count = OLD + 1` 且 🔴 `<= 5`** |
| E11 | `reconciling → reconciling`(lease 重領)| `OLD.claim_expires_at <= now()`;lease 三欄全換新;**永不回 `processing`**;計數器不變 |
| E12 | `reconciling → dead` | 二擇一:**超退** ⇒ `NEW.dead_reason = 'over_refunded'`、計數器不變;**第六次查詢異常** ⇒ `NEW.check_fail_count = OLD + 1 = 6` 且 `NEW.dead_reason = 'reconcile_exhausted'`。兩路皆 `NEW.manual_review_required = true`、清空 lease 三欄 |
| E13 | `dead → dead`(**結案**)| **只准寫 review 三欄**,三欄必須同時由 NULL 變非 NULL;`OLD.reviewed_at IS NULL`(Q3=B 的 CAS);其餘欄一律不得改。🔴 **`resolution='retry_authorized'` 另受 §4.4 的 `orj_retry_auth_only_from_retry_exhausted` CHECK 約束**(D7) |

🔴 **E7(`failed → dead`)已刪除**(D3):沒有任何路徑能讓 `failed` 帶 `retry_count = 6` 存在
⇒ 留著就是一條**永遠觸發不到、也無法被獨立負測證明**的 edge。
同理 `submitted → dead` 刻意不存在:第六次查詢異常由 E12 在 `reconciling` 相位原子完成。

🔴 **`failed` 在 `submitted` 之後永不出現**:走 `failed → queued` 會繞回送款相、重呼 Refund = **退第二次錢**。
🔴 **為什麼 `reconciling` 不能與 `processing` 共用**:兩者都是「被 worker 持有中」,但**該呼叫的 API 不同**
(Refund vs Record)⇒ 共用時 lease 過期重領**無法辨識該做哪件事**。**狀態本身就是那個辨識**。

### 3.2 `updated_at` 的定位(E6 公式的前提)
由 §5.2-6 統一設為 `now()`,**每一筆合法 UPDATE 都會動它**。
E6 的 backoff 以 `OLD.updated_at`(上一次失敗落地的時刻)為基準,不是 `now()`
⇒ 重試間隔不會因排程延遲被吃掉。有獨立負測(§7.4-18)。

### 3.3 D1:為什麼 `retry_consumed_at` 必須刪掉(R2 #2 的解)

**R2 抓到的死結(事實)**:可被消耗的前代**必然已結案**(`resolution` 只能由 E13 寫入,而 E13 同時寫 `reviewed_at`)
⇒ `reviewed_at IS NOT NULL` ⇒ 而 §5.2-3 規定 `dead` 只允許 E13 且 `OLD.reviewed_at IS NULL`
⇒ **任何要戳前代的 UPDATE 都會被自己的守門拒絕** ⇒ 合法的第二次退款開不了。

**codex 的修法**(AFTER INSERT 之後才戳前代)可以繞開死結,但它**打破「已複核的 dead 列永久凍結」** ——
而那條不變式正是 Q3=B 的 CAS 之所以成立的基礎。用一條新的可寫路徑,換一個本來就不需要的欄位,是**負收益**。

> **命題**:給定 ①`U1 = UNIQUE (cancellation_id, generation)` ②後代 INSERT 守門要求「該 cancellation 的**最大世代列** `M`
> 滿足 `M.generation = NEW.generation - 1` 且 `M.status='dead'` 且 `M.resolution='retry_authorized'`」
> ③DELETE / TRUNCATE 永久阻擋 ⇒ **任一世代最多只能開出一個後繼世代。**
>
> **證明**:由 ②,第 N 代的後繼只可能是第 N+1 代。由 ①,`(cancellation_id, N+1)` 最多存在一列。
> 由 ③,已存在的列不會消失後再被重建。⇒ 第 N 代的後繼**存在唯一或不存在**。∎

**R3 對三個前提的攻擊結果(逐字保存在 review 檔)**:
- 前提① — unique index 在**物理層**強制、與隔離級無關 ⇒ **擊破失敗**。
- 前提③ — `a7t-concurrency-probe.sh` 實測的「RR 下兩交易各刪一列雙雙放行」是**快照依賴檢查**的漏法;
  本片的 DELETE 擋是 **BEFORE trigger 無條件 RAISE**,不讀快照 ⇒ **那條實測對本前提無殺傷力**、擊破失敗。
- 前提② — 缺 `NOT FOUND ⇒ RAISE`(已於 §5.1-3 補上)。

🔴🔴 **但 R3 同時指出:命題成立、問題選錯。** 見下方 §3.5。

⇒ 「舊授權隔代重用」由 ② 直接擋掉,不需要標記;「授權何時被用掉」的答案是**後繼列的 `created_at`** ——
`retry_consumed_at` 本來就只會是它的抄本。**多存一份 = 多一個可以與真相不一致的地方**
(memory `feedback_guard-reads-non-authoritative-cache` 的同一種錯)。

### 3.4 D2:`refund_call_attempted_at` —— 「意圖已持久化」而非「已成功」

**問題**:`processing` 的 lease 過期時,新 worker 分不出兩種世界:
(a) 上一個 worker 還沒呼 Refund;(b) 呼了、外部成功了,但寫 `submitted` 之前 crash。
把 (b) 當 (a) 處理 = **退第二次錢**;把 (a) 當 (b) 處理 = 一筆該退的錢卡進人工。

**解**:worker 在呼叫 Refund **之前**,以獨立交易走 **E2b** 戳 `refund_call_attempted_at = now()` 並 **COMMIT**,
之後才發 HTTP。

| 觀察到 | 世界 | edge |
|---|---|---|
| `refund_call_attempted_at IS NULL` | 一定還沒打過 TapPay(戳沒 commit ⇒ HTTP 沒發) | **E3** 重領回 `processing`,可安全呼 Refund |
| `refund_call_attempted_at IS NOT NULL` | **不確定** —— 可能已打款 | **E3b** 直接進 `reconciling`,**永不再呼 Refund**,由 Record 對帳裁定 |

🔴 **這個欄位的語意是「有一次呼叫已發出、且結果未知」**(R3 F2 的修正):
- **明確失敗**(收到 TapPay 的非成功回應)⇒ 結果已知 ⇒ **E5 / E5b 必須把它清為 NULL**,重試才開得了。
- **逾時 / 無回應** ⇒ 結果未知 ⇒ **worker 不得寫任何東西**,讓 lease 自然過期走 E3b。
  🔴 這條是 worker 紀律,trigger 驗不到 ⇒ §5.4 明文 + 第 3 批 DoD 硬前置。
- 成功(E4)⇒ 保留原值(`next_check_at` 的隔日基準要用它),`submitted` 之後不可變。

🔴 **duplicate 回應的收斂**:v4 的狀態機**沒有任何路徑會重送同一筆 Refund**,
所以不依賴 TapPay duplicate 回應的行為(那件事只有官方文字、沒有實測)。

### 3.5 🔴🔴 D7:證明成立,但問題選錯(R3 F5,本輪最重)

§3.3 保證的是「**一代最多一個後繼**」。它**不保證**「同一筆錢只退一次」。

**漏掉的路徑(全部合法,零違規)**:
1. job 走到 `reconciling`(意味著 Refund **已被 TapPay 受理**,`tappay_refund_id` 可能已存在)
2. 連續 6 次 Record 查詢異常 ⇒ E12 ⇒ `dead` + `dead_reason='reconcile_exhausted'`
3. 人工結案時選了 `resolution='retry_authorized'`
4. 開 gen2 —— gen2 帶 **全新的 `bank_refund_id`**(U4 要求唯一)
5. worker 對同一筆 `rec_trade_id` 再打一次 Refund ⇒ **TapPay 的冪等鍵是 `bank_refund_id`,不會擋**
6. ⇒ **錢真的出去兩次**,而 §3.3 的命題**從頭到尾都成立**

**修法(D7)** —— `resolution='retry_authorized'` 鎖死在 `dead_reason='retry_exhausted'`:

```sql
CONSTRAINT orj_retry_auth_only_from_retry_exhausted
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR dead_reason IS NOT DISTINCT FROM 'retry_exhausted')
```
🔴 **兩邊都用 `IS (NOT) DISTINCT FROM`,不用 `=`**:若寫成 `dead_reason = 'retry_exhausted'`,
在 `dead_reason` 為 NULL 時整式求值為 NULL ⇒ **CHECK 放行**(本 repo 已燒過的同一族)。

**為什麼 `retry_exhausted` 是安全的(承重論證,必須成立)**:
`retry_exhausted` 只能由 **E5b** 寫入,而 E5b 只能從 `processing` 出發,且 E5 / E5b 都要求**明確失敗**
(收到 TapPay 的非成功回應)。而**任何一次「不確定」都會走 E3b 離開 `processing` 且永不回來**
(狀態機無 `reconciling → processing`)。
⇒ `dead_reason='retry_exhausted'` **蘊含「六次嘗試全部收到明確失敗回應」⇒ 沒有任何一分錢出去過**
⇒ 這是唯一可以安全授權重試的死因。

⇒ `over_refunded` / `reconcile_exhausted` 的 dead **一律不得重試**,只能走
`external_refund_confirmed`(人工在 TapPay portal 確認已退)或 `over_refund_writeoff`(認賠銷帳)。

---

## §4 A7b-M:表定義

### 4.1 `order_refund_jobs`

**身分與世代**
- `id` uuid PK / `cancellation_id` uuid NOT NULL / `order_id` uuid NOT NULL
- 🔴 **複合 FK(R2 #9)**:`FOREIGN KEY (cancellation_id, order_id) REFERENCES public.order_cancellations (id, order_id) ON DELETE RESTRICT`
  —— 單靠一支 `cancellation_id` FK,**cancellation A 的 job 可以宣稱自己屬於 order B**,兩道 child FK 仍全部合法。
  欄序對齊 `order_cancellations_id_order_id_key`(`20260730130000:125-126` 親驗,**不需 ALTER A7**)。
- `generation` integer NOT NULL DEFAULT 1 CHECK `BETWEEN 1 AND 20`
  🔴 **認列(R3 nit 12)**:第 20 代之後即使合法獲授權也會被 CHECK 拒 = 一條無出口。
  機率極低(等於同一筆退款失敗 19 輪 × 每輪 6 次),**明文認列、不假裝沒有**;真發生走 §12.1 break-glass。
- `UNIQUE (id, order_id)` —— 供 §4.2 子表複合 FK 反向引用

**外部識別(全部不可變)**
- `rec_trade_id` text NOT NULL,CHECK `char_length BETWEEN 1 AND 20`
  🔴 **不加字元集 CHECK(R2 #17)**:v2 寫的 `[A-Za-z0-9_-]` **沒有 TapPay 官方依據**(官方只寫 String(20)),
  可能拒絕合法的外部 ID = 一筆該退的錢永遠進不了系統。改為僅擋**明確不可能合法**的:
  `rec_trade_id !~ '[\x00-\x1F\x7F]'`(控制碼)且 `btrim(rec_trade_id) = rec_trade_id` 且 `<> ''`。
  施工前對正式站既有 `payment_charge_attempts.rec_trade_id` 做字元集 read-back,結果寫進 COMMENT 當**觀察紀錄**,**不升格為 CHECK**。
- `bank_refund_id` text NOT NULL,同上長度 + 控制碼 + 空白規則
- `payload_hash` text NOT NULL CHECK `~ '^[0123456789abcdef]{64}$'`
  🔴 **逐碼位列舉,不用 `[0-9a-f]`**:POSIX 字元範圍**跟著 locale 走**,A7 已實測同一條 CHECK 在
  C locale 與 UTF-8 locale 行為不同(backlog **#305**)⇒ harness 綠、正式站未知。
- `tappay_refund_id` text —— Refund API 回的外部識別;一旦非 NULL 即不可變
  🔴 **它不是「到達某狀態就一定有」**(R3 F3):走 E3b 的 job 從未收到成功回應 ⇒ 永遠是 NULL,
  但它可能一路走到 `completed`。⇒ **狀態層不得要求它非 NULL**,只有 **E4 這條 edge** 要求(§3.1)。

**金額與對帳基準**
- `refund_amount` integer NOT NULL CHECK > 0
- `refunded_before` / `refunded_target` integer(enqueue 時 NULL,E2 才持久化)
  🔴 **規範來源寫死(R3 nit 14)**:`refunded_before` **一律以 TapPay Record API 的當下累計退款額為準**,
  **不得讀本地 `order_refunds` 加總** —— 否則 `external_refund_confirmed` 的 dead 會讓本地值低於 TapPay 事實,
  後續 job 的對帳必然 `> target` ⇒ 連環進 dead。
- 🔴 **成對 CHECK**(v1 這條是恆真的):
  ```sql
  CHECK ( (refunded_before IS NULL AND refunded_target IS NULL)
       OR (refunded_before IS NOT NULL AND refunded_target IS NOT NULL
           AND refunded_before >= 0
           AND refunded_target = refunded_before + refund_amount) )
  ```
  v1 寫成 `refunded_target IS NOT NULL ⇒ target = before + amount`,
  **`before` 為 NULL 時整式求值為 NULL、PostgreSQL CHECK 放行**。
- 🔴 **`refunded_target > 0` 已刪除**:被三者嚴格蘊含,行為層無法單獨觸發 = 沒有獨立負測的守門。

**帳本快照(Q4=B 的 header 側;子表在 §4.2)**
`items_amount` / `shipping_fee_before` / `shipping_fee_after` / `shipping_delta` /
`reason` / `actor`(**FK → `staff(id)` ON DELETE RESTRICT**)/ `request_id` —— 全部 **enqueue 當下凍結、不可變**,
CHECK 逐條對齊 `order_refunds` 同名欄(逐字抄 `20260725130100:88-119`)。
🔴 `actor` **刻意不加形狀 CHECK**:`staff` 自帶 `staff_id_format`(`20260726120000:21`)⇒ 形狀已被 FK 傳遞性保證,
加了也**原理上無法被獨立突變證明**(A7 已實測,`20260730130000:100-113`)。

**狀態與生命週期**
- `status` text NOT NULL DEFAULT `'queued'` CHECK IN(七值)
- lease **三欄**:`claim_token` uuid / `claimed_at` / `claim_expires_at`
- 🔴 `refund_call_attempted_at` timestamptz(D2)—— **可變性規則(R3 F2 修正)**:
  只允許 `NULL → now()`(**E2b**)與 `非 NULL → NULL`(**E5 / E5b**,結果已知);
  `submitted` 之後不可變。**不是「一旦非 NULL 即永久不可變」** —— 那條讓重試迴圈靜態不可能。
- 排程:`retry_count` integer NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `next_retry_at` /
  `next_check_at` / `check_fail_count` integer NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `failed_reason`
- 人工:`manual_review_required` boolean NOT NULL DEFAULT false / `reviewed_at` / `reviewed_by`(**FK → `staff(id)`**)/
  `resolution` text CHECK IN(三值)/ `dead_reason` text CHECK IN(`retry_exhausted` / `over_refunded` / `reconcile_exhausted`)
- `refund_id` uuid FK → `order_refunds(id)` / `created_at` / `updated_at`(由 A7b-T 統一設值)

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

**四條核心不變式**(前兩條跨列 / 跨表 ⇒ CHECK 做不到,由 §5.6(a) 的 DEFERRED CONSTRAINT TRIGGER 承接):

| ID | 不變式 | 承接者 |
|---|---|---|
| C1 | 每個 job **至少一列**明細 | §5.6(a) 兩支 deferred(parent AFTER INSERT + child AFTER DELETE) |
| C2 | `jobs.items_amount = Σ child.line_amount` | 同上 |
| C3 | `child.quantity <= order_items.quantity` | §5.6(a) child AFTER INSERT |
| C4 | `child.unit_price = order_items.unit_price`(訂單當下快照) | 同上 |

🔴 **子表 UPDATE / DELETE / TRUNCATE 永久阻擋**(§5.3)—— 沒有這條,「凍結」只擋得住誠實的人。

### 4.3 五道唯一性(R2 #12:v2 字面仍寫「四道」但實列五道)

| # | 約束 | 擋掉哪一種「退兩次」 |
|---|---|---|
| U1 | `UNIQUE (cancellation_id, generation)` | 同一取消的同一世代重複建 **+ §3.3 命題的 ①** |
| U2 | partial unique `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一取消**同時**兩個未結案 job |
| U3 | partial unique `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一筆 TapPay 交易同時兩個 active job |
| U4 | `UNIQUE (bank_refund_id)` | TapPay 端的冪等鍵 |
| U5 | partial unique `refund_id WHERE refund_id IS NOT NULL` | 兩個 job 共用同一張帳本 |

🔴 **U4 擋不住跨表重用**:它只在 job 表 unique,**擋不住新 job 拿一個已存在於 `order_refunds.bank_refund_id` 的值**
⇒ §5.1-2 的 INSERT 守門必須另查 `order_refunds`(它是 bank id 的**真相**,不是快取)。
🔴 **`rec_trade_id NOT NULL` 是 U3 成立的前提**:partial unique **對 NULL 不生效**。
🔴 **U2/U3 用 `reviewed_at IS NULL` 而非「排除 dead」**:未複核的 dead 若不再擋,人還沒看,系統就自己再退一次。
🔴🔴 **這五道只擋「同時」,擋不住「先後」** —— 擋「先後」的是 §5.1 的 INSERT 守門,不是索引。

**兩條併發合約債(誠實揭示,是債不是防護)**:
1. **跨表 bank id**:「job INSERT 與 ledger INSERT 同時發生」在 PostgreSQL 無法做成宣告式唯一 ⇒ 擋不住。
   現行唯一的 ledger writer 是第 3 批完成 RPC,其值必然抄自某個 job(§5.6(b) 強制)⇒ 現行規劃內不可觸發。
2. 🔴 **C2 的併發(R3 F9,v3 漏認列)**:C2 是 count/sum 型 deferred 檢查、子表 INSERT 對 service_role 開放
   ⇒ 兩交易併發對同一 job 各插明細,**各自快照皆平衡、落地後 `Σ > items_amount`** ——
   **與 `scripts/a7t-concurrency-probe.sh` 實測的漏法同型**。
   現行 enqueue 是單交易一次寫完 ⇒ 不可觸發,**但那是推論不是防護**。
   若第 3 批出現「分批追加明細」的寫法,必須先補「trigger 內鎖 parent + 隔離級 fail-closed 閘」
   (承接 A7-t 2026-07-30 立的合約債;**鎖 parent 單獨不足以補**,同一 harness 已實測)。

### 4.4 逐狀態完整 truth table(R2 #5)

一條 `CASE status WHEN … END` 的完整 CHECK。**R = 必須非 NULL、N = 必須 NULL、− = 不限制**:

| status | lease 三欄 | `attempted_at` | `next_retry_at` | `next_check_at` | `failed_reason` | `retry_count` | `check_fail_count` | review 三欄 | `dead_reason` | `manual_review` | `tappay_refund_id` | `refund_id` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `queued` | N | **N** | − | N | **N** | 0-5 | 0 | N | N | false | N | N |
| `processing` | R | − | N | N | N | 0-5 | 0 | N | N | false | N | N |
| `submitted` | N | R | N | R | N | 0-5 | 0-5 | N | N | false | **−** | N |
| `reconciling` | R | R | N | R | N | 0-5 | 0-5 | N | N | false | **−** | N |
| `completed` | N | R | N | N | N | 0-5 | 0-5 | N | N | false | **−** | R |
| `failed` | N | **N** | R | N | R | 1-5 | 0 | N | N | false | N | N |
| `dead` | N | − | N | N | − | 0-6 | 0-6 | **全 N 或全 R** | R | **true** | − | N |

🔴 **`tappay_refund_id` 在 submitted / reconciling / completed 一律 `−`(R3 F3 的修正)**:
走 E3b 的 job 從未收到成功回應 ⇒ 該欄永遠 NULL,但它可能一路走到 `completed`。
v3 在這三格寫 `R` ⇒ **E3b 靜態必拒 ⇒ 「打了沒寫回」的列連 E3 也走不了 ⇒ 永久卡在 `processing`、無人能領、無告警**。
**保證改由 edge 承接**:只有 **E4** 要求 `NEW.tappay_refund_id IS NOT NULL`(§3.1)。
⇒ **狀態不變式做不到的事,不要寫進狀態不變式** —— 寫進去只會讓合法路徑死掉,而且測試抓不到。

🔴 **`failed` 的 `attempted_at` = N**:E5 清掉它,否則重試迴圈靜態不可能(R3 F1/F2)。
🔴 **`failed` 的 `retry_count` 下界是 1**:`retry_count = 0` 的 `failed` 代表「沒失敗過卻是失敗態」。
🔴 **review 三欄的鐵律**:必須全 NULL 或同時非 NULL,且**只允許在 `status = 'dead'` 時非 NULL**。
v1 允許單獨寫 `reviewed_at` ⇒ U2/U3 的 `reviewed_at IS NULL` 當場失效 ⇒ **放行第二個 active job**。
🔴 **`dead_reason` 在非 dead 一律 NULL、在 dead 一律非 NULL**(D5)⇒ dead-review 畫面永遠有東西可顯示。

**🔴🔴 D7 的具名 CHECK(本檔最重要的一條,R3 F5)**:
```sql
CONSTRAINT orj_retry_auth_only_from_retry_exhausted
  CHECK (resolution IS DISTINCT FROM 'retry_authorized'
      OR dead_reason IS NOT DISTINCT FROM 'retry_exhausted')
```
承重論證見 §3.5。**這條若被移除,存在一條全合法、零違規、會真的退第二次錢的路徑。**

### 4.5 ACL 與函式安全(R2 #7)

```sql
REVOKE ALL ON public.order_refund_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_refund_jobs TO service_role;  -- 無 DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
ALTER TABLE public.order_refund_jobs ENABLE ROW LEVEL SECURITY;            -- zero-policy
```
子表同上但**僅 `SELECT, INSERT`**(無 UPDATE)。

🔴 **驗收必須是完整八格矩陣**(PG17):
`SELECT / INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN` × `anon / authenticated / service_role / PUBLIC`。
- **PG17 的第八種權限 `MAINTAIN`**:授出去之後 `has_table_privilege(…,'SELECT')` **仍為 false**
  ⇒ 七格矩陣對它**完全無感**(已實測)。正式站同為 PG17。
- 🔴 **`PUBLIC` 那一列必須排在角色矩陣之前**:`GRANT … TO PUBLIC` 會讓 anon/authenticated 因繼承轉紅
  ⇒ PUBLIC 斷言排在後面的話,**把它整條刪掉仍然全綠**。**順序是正確性的一部分。**

**所有 trigger 函式**:一律 `SECURITY INVOKER` + `SET search_path = public, pg_temp`、物件全 schema-qualified;
🔴 **只有寫出「INVOKER 下具體缺哪一個權限、在哪一行會炸」時才准改 DEFINER**,理由寫進函式 COMMENT;
`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`;一律 `CREATE`(**不用 `OR REPLACE`**,避免沿用舊 owner/ACL);
owner 必須是 `postgres`,列入 §7.1 指紋斷言。

---

## §5 A7b-T:六支守門

### 5.1 `BEFORE INSERT`
1. **所有世代一律**(R2 #1):`status` 必須 `'queued'`;lease 三欄、`refund_call_attempted_at`、review 三欄、
   `dead_reason`、`refund_id`、`tappay_refund_id`、`refunded_before/target`、`next_retry_at`、`next_check_at`、
   `failed_reason` **全部必須 NULL**;`retry_count = 0`、`check_fail_count = 0`、`manual_review_required = false`。
   ⇒ 拿到重試授權之後**也不能**直接 INSERT 成 `completed`。
2. **跨表 bank id 唯一**:`NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE bank_refund_id = NEW.bank_refund_id)`。
3. **後代(`generation > 1`)**:鎖住同一 `cancellation_id` 的**最大世代列**
   (`SELECT … ORDER BY generation DESC LIMIT 1 FOR UPDATE`)並驗
   `M.generation = NEW.generation - 1`、`M.status = 'dead'`、`M.resolution = 'retry_authorized'`。
   🔴 **`NOT FOUND ⇒ RAISE`(R3 F7)**:`generation > 1` 而該 cancellation 零列時**必須 fail-closed**。
   v3 沒寫這條 ⇒ 行為未定義;`a7t-concurrency-probe.sh:76` 的 `CONTINUE WHEN NOT FOUND` 就是同型漏法。
   🔴 **不戳任何欄位**(D1)。
4. **後代 payload 逐欄等於直接前代**(R2 #1):除 `id` / `generation` / `bank_refund_id` / `request_id` /
   `created_at` / `updated_at` 外,業務欄逐欄等於 `M`(`cancellation_id` / `order_id` / `rec_trade_id` /
   `payload_hash` / `refund_amount` / `items_amount` / 三個運費欄 / `reason` / `actor`)。
   ⇒ 沒有這條,「重試授權」可以被拿去**退另一筆錢**。**逐欄比對一律 `IS NOT DISTINCT FROM`。**
5. **子表 item set 相等** ⇒ 由 §5.6(a) 在交易結束時比對(INSERT 當下子表還沒寫)。

🔴 **併發正確性的真正來源是 U1,不是那把鎖**:兩個 session 同時開 gen2 時,`FOR UPDATE` 讓後者等待,
但後者解鎖後**不會重跑 `ORDER BY`** ⇒ 它仍以 gen1 為「最大世代」通過守門,最後**紅在 U1 的 `23505`**。
⇒ 這把鎖只是「減少無謂拒絕」;**拿掉它不會產生第二次退款,拿掉 U1 會**。
⇒ 併發負測必須斷言 **U1 的 constraint 名**(§7.4-6),不是 trigger 的自訂碼。

### 5.2 `BEFORE UPDATE`
1. `OLD.status → NEW.status` 必須命中 §3.1 的 **15 條 edge 之一**,含該列全部額外條件
2. **終態不可轉出**:`completed` 之後任何欄位都不准改
3. **`dead` 只允許 E13**,且 `OLD.reviewed_at IS NULL`(**Q3=B 的 CAS**)⇒ 已複核的 dead 列**永久凍結**
4. **不可變欄位**:`id` / `cancellation_id` / `order_id` / `generation` / `rec_trade_id` / `bank_refund_id` /
   `payload_hash` / `refund_amount` / 所有帳本快照欄 / `created_at` / `refunded_before`(一旦非 NULL)/
   `refunded_target`(一旦非 NULL)/ `tappay_refund_id`(一旦非 NULL)/ `refund_id`(一旦非 NULL)
   —— 🔴 **`refund_call_attempted_at` 不在此列**,它有自己的可變性規則(§4.1)
5. **計數器逐 edge 寫死**:`retry_count` 只在 E5/E5b `+1`;`check_fail_count` 只在 E10 歸 0 或 `+1`、
   只在 E12 `+1` 到 6;**其餘 edge 一律不得改動兩者**(不是「不得減少」,是**不得改動**)
6. `updated_at := now()`

### 5.3 `BEFORE DELETE` / `BEFORE TRUNCATE`(**兩表都掛**)
**永久阻擋,不留逃生門**(同 A7-t 拍板 Q2=A)。
理由:表級 ACL 擋不住 **owner 與 SECURITY DEFINER RPC** —— 歷史一被清,五道唯一索引就**不再擋重退**。
🔴 驗收必須證明 **owner 身分也失敗**(用 service_role 測 = 測了個寂寞)。
🔴 **本擋是 BEFORE trigger 無條件 `RAISE`,不讀任何快照** ⇒ 與隔離級無關
(R3 已驗:`a7t-concurrency-probe.sh` 那條 RR 雙刪實測**對本擋無殺傷力**,它打的是「count 為 0 才 RAISE」的快照依賴檢查)。
子表另加 `BEFORE UPDATE` 一律阻擋(§4.2「凍結」)。

### 5.4 能力邊界(明文,不得在任何地方宣稱超出)
trigger **看得到**:狀態圖、本地欄位、同表其他列(可鎖)、其他表的**已提交**內容。
trigger **看不到**:
- TapPay Refund 是否真的成功、Record 的累計是 `< / = / >` target、baseline 是不是真的來自 Record API
- 呼叫者以為自己持有哪一把 token ⇒ **token CAS 是 worker 的 `WHERE claim_token = $1` 的責任**
- 🔴 worker 有沒有遵守「**先 commit E2b 戳記、再發 HTTP**」(D2 的一半正確性在這裡)
- 🔴 worker 有沒有遵守「**逾時 / 無回應時不得寫任何東西**」(寫了就會被當成明確失敗 ⇒ E5 清掉戳記 ⇒ 重打 ⇒ 退兩次)
- 🔴 跨表 bank id 的併發、C2 的併發(§4.3 兩條合約債)

⇒ 這些必須在**第 3 批 worker 的驗收**裡被證明,本片不得代為宣稱;上列兩條 worker 紀律列為**第 3 批 DoD 硬前置**。

### 5.5 `RAISE` 的形狀
「負測一律斷言 SQLSTATE + `CONSTRAINT_NAME`」這條紀律在 trigger 上**會失效** ——
普通 `RAISE EXCEPTION` 的 `CONSTRAINT_NAME` 是空的(2026-07-30 實測)。
⇒ 所有 trigger 的 `RAISE` 一律帶 **`USING ERRCODE = '<自訂>'`, `CONSTRAINT = '<具名 ID>'`**。
ID 命名 = `a7bt_<edge 或規則>`(例:`a7bt_e13_already_reviewed`)。

### 5.6 兩支 `DEFERRED CONSTRAINT TRIGGER`

**(a) 主從一致(C1-C4)+ 後代 item set 相等**:parent `AFTER INSERT` + child `AFTER INSERT OR DELETE`,
兩支皆 `DEFERRABLE INITIALLY DEFERRED`。
🔴 **為何是兩支**:只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件**
⇒ 空 header 完全擋不住(`20260725130100:180-186` 的同一個教訓,已實證)。

**(b) job ↔ ledger 等值(R2 #10:v2 宣稱「由 immutable + U5 關閉」是錯的)**
parent 🔴 **`AFTER INSERT OR UPDATE`**(R3 nit 13:v3 只掛 UPDATE ⇒ INSERT 守門日後一弱化,
`INSERT` 直達 `completed` 可完全繞過帳本等值;多掛一個事件成本一行)、deferred。
`NEW.status = 'completed'` 時斷言:
- `order_refunds` 存在該 `refund_id` 且 `status = 'confirmed'` 且 `confirmed_at IS NOT NULL`
- **逐欄相等**:`order_id` / `bank_refund_id` / `tappay_refund_id` / `refund_amount` / `items_amount` /
  `shipping_fee_before` / `shipping_fee_after` / `shipping_delta` / `reason` / `actor` / `request_id`
  🔴🔴 **一律 `IS NOT DISTINCT FROM`,禁用 `=`(R3 F8)**:`tappay_refund_id` 兩邊皆 nullable
  (ledger 側 `20260725130100:88`),天真 `=` 遇 NULL 整式為 NULL ⇒ 「不等才 RAISE」**靜默放行**
  —— 與 CHECK-NULL 放行同族,本 repo 已燒過。
- **item set 完全相等**:`(order_item_id, quantity, unit_price, line_amount)` 的集合在兩表之間**雙向無差集**
- 任一格不符 ⇒ `RAISE`(整筆交易回滾)

🔴 U5 只防「兩個 job 共用一張帳本」,**完全不證明**上面任何一格。

---

## §6 R9-R19 關閉矩陣(誠實版)

**「關閉」= 本片有可執行的驗收落點。「未關閉」= 現在就具名,但落點在第 3 批。**

| 規格 | 狀態 | 由誰關閉 | 驗收落點 |
|---|---|---|---|
| R9 baseline + job↔ledger 等值 | ✅ 關閉 | A7b-T(E2/E4)+ §5.6(b) | 探針 T-E2/T-E4;等值 = §7.4-16 |
| R10 `reconciling` 獨立相位 | ✅ 關閉 | A7b-T(E8/E11/E3b) | 探針「`reconciling → processing` 必拒」 |
| R11 `failed` 不在 `submitted` 之後 | ✅ 關閉 | A7b-T(轉移表無此 edge) | 探針「`submitted → failed` 必拒」 |
| R12 reclaim 寫死 + `check_fail_count` 入 schema | ✅ 關閉 | A7b-M + A7b-T(E11) | 探針 T-E11;CHECK 0-6 |
| R13 成功歸零 / 異常 +1 / CAS 寫入 | 🟡 半關閉 | 歸零與 +1 = A7b-T(E10/E12);**CAS 未關閉** | 本片:T-E10 兩向。**未關閉**:`reconcileRefundJob()` 的 `UPDATE … WHERE id=$1 AND claim_token=$2` rowcount 必為 1 ⇒ 測試 ID `W-R13-CAS-1/2` |
| R14 Record 三路寫死 | 🔴 **未關閉** | 第 3 批 `reconcileRefundJob()` | **hard release gate**:三路各一測,ID `W-R14-LT/EQ/GT` |
| R15 durable 告警 + LINE 失敗重發 | 🔴 **未關閉** | 第 3 批 | **hard release gate**。🔴 **掃描條件必須三段(R3 角度 B)**:①`status='dead' AND manual_review_required AND reviewed_at IS NULL` ②**`status IN ('processing','reconciling') AND claim_expires_at < now() - interval '30 minutes'`**(卡住的 lease)③**`status IN ('queued','failed') AND coalesce(next_retry_at, created_at) < now() - interval '2 hours'`**(卡住的重試)。🔴 只掃 ① 的話,**錢卡住的那天沒有人被叫醒**。ID `W-R15-RESEND` / `W-R15-STUCK-LEASE` / `W-R15-STUCK-RETRY` |
| R16 結案 RPC 鎖 + 稽核 | 🟡 半關閉 | CAS 條件 = §5.2-3(本片關閉);RPC 本體 = 第 3 批 | **具名**:`public.admin_resolve_dead_refund_job(p_job_id uuid, p_resolution text, p_reviewed_by text, p_note text)`;service_role only、SECURITY DEFINER、`SELECT … FOR UPDATE` 鎖列後重驗 `status='dead'`;`UPDATE … WHERE id=$1 AND reviewed_at IS NULL` **rowcount 必為 1**,否則 `RAISE … ERRCODE='PCM09'`;同交易寫 `order_notes` **恰一筆**。ID `W-R16-1`(單人成功)/`W-R16-2`(兩 session 一成功一 conflict)/`W-R16-3`(audit 恰一筆)/`W-R16-4`(結案撞 worker)/🔴 `W-R16-5`(**對 `dead_reason<>'retry_exhausted'` 的列選 `retry_authorized` 必被 D7 的 CHECK 拒**) |
| R17 世代式 + one-current partial unique | ✅ 關閉 | A7b-M(U1/U2)+ §5.1 | §7.4-1~6 |
| R18 `resolution` 三值分流 | ✅ 關閉 | A7b-M(CHECK + **D7**)+ §5.1-3 | §7.4-3/4/5 + **§7.4-25** |
| R19 原子消耗授權 | ✅ 關閉,**機制已換**(D1) | A7b-M(U1)+ §5.1-3 | §3.3 命題 + §7.4-2~6;`retry_consumed_at` 已刪 |

---

## §7 驗收

沿用 A1 骨架 —— 🔴 **精確措辭:`scripts/a1-verify.sh` 在本機 PG17.10 已 61/0;A1 本身尚未 apply 到正式站**。
承接:外層 oracle 存 shell 側 / `snapshot()` fail-closed(驗退出碼 + stderr 空 + `SNAPSHOT-OK` sentinel,`a1-verify.sh:50-57`)/
harness 自我測試(故意弄壞快照 SQL 必須當場中止,`:138-144`)/ 結構與行為突變分開跑 /
每個 mutant 指定唯一預期第一失敗 ID / 對照組必跑。

### 7.1 承接 A7-t 已實證的假綠路徑(本片核心是 trigger ⇒ 全部適用)
`tgenabled`(DISABLE / ENABLE REPLICA)、`tgqual`(`WHEN (false)`)、`tgrelid`(綁錯表)、
`tgtype`(**事件 bitmap**;少了它,把 `BEFORE INSERT` 改成 `BEFORE UPDATE` 不會被抓到)、
`tgfoid` vs `regprocedure`(同名異 schema no-op)、**函式本體 `md5(prosrc)` 指紋**、owner、**完整 ACL allowlist**。

### 7.2 一對一矩陣(**本片必須逐格填出來**)

格式固定六欄,一列一格,不合併:

| 約束/守門 ID | 正向前提(合法列形狀) | 負向資料(只動一格) | 預期 SQLSTATE | 預期 CONSTRAINT_NAME | 對應 mutant |
|---|---|---|---|---|---|

🔴 **truth table 覆蓋改為全格,不再取樣(R3 F10)**:v3 寫「七態 × 每態至少一格 R 與一格 N = 最少 14 格」——
整條 CASE CHECK 約 **90 格**,14 格地板下單格 mutant(例如把 `reconciling` 的 `tappay_refund_id` 由 `−` 改回 `R`)**存活**。
⇒ **每一個 R 格與 N 格各一條負測**;確實無法獨立構造的格必須**逐格列出理由**(比照 §4.1 `actor` 的處理),
不得默默略過。

**其餘必覆蓋格數**:
- `generation` 上下界 ×2、`retry_count` 上下界 ×2、`check_fail_count` 上下界 ×2
- `bank_refund_id` / `rec_trade_id` 長度上下界 ×4、控制碼 ×2、前後空白 ×2
- `payload_hash` 形狀 ×3(短 / 長 / 非 hex 碼位)
- baseline 成對 ×3、金額三條 CHECK ×3
- 🔴 **`orj_retry_auth_only_from_retry_exhausted` ×3**(`over_refunded` / `reconcile_exhausted` / **`dead_reason` 為 NULL** —— 第三格專測 NULL 放行陷阱)
- 五道唯一性 ×5、兩道複合 FK ×2(各含跨單負測)、兩支 staff FK ×2
- **15 條 edge** × 每條至少一格額外條件
- §5.6(a) C1-C4 ×4、§5.6(b) 逐欄 ×11(**含 `tappay_refund_id` 兩邊皆 NULL 的 NULL-safe 格**)+ item set 雙向差集 ×2
- ACL 八格 × 四角色 = 32 格(**PUBLIC 排最前**)、§7.1 八條指紋

### 7.3 探針設計紀律
- **U2 與 U3 必須分開構造**:U2 用「同 cancellation、**不同** rec_trade_id」,U3 用「**不同** cancellation、同 rec_trade_id」。
  否則兩者會先紅在同一個索引,**刪掉另一個索引仍全綠**。
- **轉移探針先建出「除了那條 edge 之外全部合法」的列形狀**,再斷言指定 trigger ID。
  🔴 同理套用於 **INSERT 守門**:直接 `INSERT status='completed'` 的 fixture **必須除了 status 之外全部合法**
  (含該狀態 truth table 要求的所有 R 欄),否則移除 INSERT 守門後會**紅在 CASE CHECK** = 紅在錯的地方。
- 🔴 **所有 fixture 必須經合法 edge 構造,不得直接 UPDATE 造出中間態**(R3 F4 的教訓:
  v3 的 §7.4-14 fixture 在當時的合約下**根本構造不出來**,而沒有人發現)。
- **不可變欄位與計數器的突變要夾在合法 edge 裡測**,否則會先被「該狀態不准自轉」擋掉。
- 🔴 **刪掉 v1 那條「直接 INSERT `generation+1` 應成功」的正向驗收** —— 它只證明 partial unique 放行,**反而替重退破口背書**。
- 🔴 **併發斷言不得只寫「不超過一個成功」** —— 兩個都失敗也會通過。必須斷言:**恰一成功、另一筆精確失敗於指定 constraint、gen2 恰一列**。

### 7.4 必做測試

🔴🔴 **正向鏈先寫、先跑(R3 F11 的教訓)**:v3 有 24 條負測 + 2 條正向,
而 **E6 / E3b / E2b 三處靜態死鎖在那 26 條下全綠** —— 因為兩條正向鏈都不經過它們。
**負測證明「壞的被擋住」,證明不了「好的走得通」。**

**正向鏈(四條,全部必跑)**
- **A** `queued→E1→processing→E2 baseline→E2b 戳記→E4→submitted→E8→reconciling→E9→completed`
- **B** `…→E5b dead→E13 結案 retry_authorized→INSERT gen2`(證明 D1 沒把合法路徑鎖死)
- 🔴 **C(新)重試迴圈**:`E1→E2→E2b→E5 failed→E6 queued→E1→…` 連走 **6 輪**,第 6 輪 `E5b → dead`,
  斷言 `retry_count` 逐輪 1→6、`next_retry_at` 逐輪符合 `5min × 2^(n-1)`、`failed_reason` 在每次 E6 後為 NULL、
  `refund_call_attempted_at` 在每次 E5 後為 NULL
- 🔴 **D(新)不確定送出鏈**:`E1→E2→E2b→`(lease 過期)`→E3b→reconciling→E10 順延→E8→E11 重領→E9 completed`,
  全程 `tappay_refund_id` 為 NULL,斷言 §5.6(b) 的 NULL-safe 等值放行

**負測(每條都是一種「退第二次錢」或「錢卡死」)**
1. `INSERT status='completed'` 直接建(**其餘欄全合法**)→ 拒於 `a7bt_insert_must_be_clean_queued`
2. `INSERT generation=2` 而前代不是 dead → 拒
3. 前代 `resolution='external_refund_confirmed'` 仍開新世代 → 拒
4. 前代 `resolution='over_refund_writeoff'` 仍開新世代 → 拒
5. **舊授權隔代重用開 gen3**(gen1 retry_authorized、gen2 queued)→ 拒
6. **兩 session 併發重開 gen2**:A `BEGIN; INSERT`(取得 gen1 的 FOR UPDATE)→ B `BEGIN; INSERT`(阻塞)
   → A `COMMIT` → B **必紅於 U1 的 `23505`**。斷言:恰一成功、gen2 恰一列
7. 🔴 **`generation=2` 而該 cancellation 零列** → 拒(R3 F7 的 `NOT FOUND` fail-closed)
8. `INSERT` 一個已存在於 `order_refunds.bank_refund_id` 的值 → 拒
9. **後代 payload 與前代不同**(逐欄各一條)→ 拒;**後代子表 item set 不同** → 拒(deferred,`COMMIT` 時紅)
10. `submitted → processing` / `reconciling → processing` / `submitted → failed` / `submitted → dead` → 拒
11. `completed` 轉出 → 拒;`dead → queued` → 拒
12. **單獨寫 `reviewed_at`** → 拒;**已結案的 dead 再結一次** → 拒
13. **未持久化 baseline 就 E2b 戳記** → 拒;**未戳記就 `processing → submitted`** → 拒
14. **`refund_call_attempted_at IS NOT NULL` 的 lease 過期列走 E3** → 拒(D2 核心)
15. **`retry_count = 5` 的 `processing` 走 E5** → 拒(D3:第六次必須直接進 dead)
16. **job↔ledger 等值**:逐欄各改一格 ×11、item set 多一列 / 少一列 / 數量不符 → 皆拒(deferred)
    🔴 **另加一條 NULL-safe 專測**:job 側 `tappay_refund_id` 為 NULL、ledger 側非 NULL → **必須拒**
    (用 `=` 寫的實作在這裡會靜默放行)
17. 子表:零明細 job / `Σ line_amount ≠ items_amount` / `quantity > order_items.quantity` /
    `unit_price ≠ order_items.unit_price` → 皆拒;子表 UPDATE / DELETE → 拒
18. **E6 backoff 基準**:`next_retry_at` 用 `now()` 而非 `OLD.updated_at` 算 → 拒
19. **DELETE / TRUNCATE 一律拒,含 owner 身分**(兩表)
20. 未複核的 dead 仍擋得住同 cancellation / 同 rec_trade_id 的新 job(U2/U3 分開構造)
21. 兩個 job 指向同一 `refund_id` → 拒(U5)
22. **dormant gate 雙向**:A7b-M 之後合法 INSERT 必拒;A7b-T 之後同一筆必過
23. 🔴 **E6 不清 `failed_reason`** → 拒(R3 F1 的回歸測試)
24. 🔴 **E5 不清 `refund_call_attempted_at`** → 拒(R3 F2 的回歸測試)
25. 🔴🔴 **D7 三條**:`dead_reason='over_refunded'` 結成 `retry_authorized` → 拒;
    `dead_reason='reconcile_exhausted'` 結成 `retry_authorized` → 拒;
    **`dead_reason` 為 NULL 而 `resolution='retry_authorized'`** → 拒(專測 NULL 放行陷阱)
26. 🔴 **E2b 之外的任何 edge 想改 `refund_call_attempted_at`** → 拒

---

## §8 誠實邊界(先寫,不等審查逼)
- 本機 PG17.10 非 Supabase;`auth.uid()` 是 shim
- **trigger 不保證 fencing**(§5.4);token CAS 屬 worker,第 3 批才被證明
- **D2 的一半正確性在 worker 手上**(「先 commit 再發 HTTP」+「逾時不得寫任何東西」),trigger 驗不到
- **兩條併發合約債**(§4.3:跨表 bank id、C2 的 Σ)—— 現行規劃內不可觸發,**但那是推論不是防護**
- **本片零 TapPay 接觸**:「隔日生效」「Record 三路」全是合約文字,正確性要等第 3 批對真 API 驗
- **TapPay 對「新 `bank_refund_id` 重退同一筆交易」的實際行為沒有實測** —— D7 的殺傷力論證基於官方文件語意。
  🔴 但 D7 的**修法**不依賴那個行為:它擋的是「來源不明的 dead 被授權重試」,即使 TapPay 會擋,擋下來也對
- `reviewed_by` 在 E8-B 上線前**只是操作者自陳,不是已驗證身分**
- **A7b-M 單獨存在時由 dormant gate 擋住** —— 這是防護,不再是「靠沒有 writer」的推論
- **第 20 代之後無出口**(§4.1),機率極低,明文認列

## §9 27 項綠燈宣稱
**兩片皆不宣稱任何項變綠**(原則 4)。第 19 項的退款面在第 3 批。

## §10 Migration 骨架 / rollback / rollout
- 兩支皆:顯式 `BEGIN;` + `SET LOCAL lock_timeout='5s'` + `statement_timeout='60s'` + `COMMIT;`(D0-1 拍板)
- 結尾各自 fail-closed 結構驗收 DO block,斷言帶機器可辨識 ID
- 🔴 **rollback 順序寫死(R2 #18:先 DROP parent 會被 child FK 擋)**:
  1. 停 writer(第 3 批之前 = 無 writer)
  2. 驗兩表為空,非空則**備份後停下 raise Sean**(不得靜默續行)
  3. `DROP TRIGGER` 子表四支 → `DROP TABLE public.order_refund_job_items`(**不加 CASCADE**)
  4. `DROP TRIGGER` parent 六支 → `DROP TABLE public.order_refund_jobs`(**不加 CASCADE**)
  5. `DROP FUNCTION` A7b-T 全部函式(逐一具名,含 §5.6 兩支)
  6. 前置 preflight:`pg_depend` 查兩表與所有函式的外部依賴,非空即 abort
  🔴 只允許在第一個 writer 之前;之後只能 forward repair,該程序**列為第 3 批 worker 片的 DoD 硬前置**
- **rollout**:承 Q1=A —— A7-t 單獨 apply → read-back → A1 → read-back → 本兩片**接續**;
  每次 `db push` 前先 `--dry-run` 對 pending 清單;失敗時做 **ledger / schema / 資料三方狀態矩陣**,
  `schema 有 + ledger 無` ⇒ 修 ledger、**不得重跑**;
  🔴 **A7b-M 成功但 A7b-T 失敗 = 已知可能狀態**,由 dormant gate 承接,不是異常

## §11 索引具名落點

| 索引 | 定義 | 服務的查詢 |
|---|---|---|
| `orj_due_queued_idx` | `(next_retry_at) WHERE status = 'queued'` | claim 掃描 |
| `orj_due_failed_idx` | `(next_retry_at) WHERE status = 'failed'` | backoff 到期掃描 |
| `orj_due_submitted_idx` | `(next_check_at) WHERE status = 'submitted'` | 隔日對帳掃描 |
| `orj_stale_lease_idx` | `(claim_expires_at) WHERE status IN ('processing','reconciling')` | lease 過期回收 **+ R15 卡住告警** |
| `orj_unreviewed_dead_idx` | `(created_at) WHERE status = 'dead' AND reviewed_at IS NULL` | dead-review 清單 + R15 重發 |
| `orji_order_item_idx` | 子表 `(order_item_id)` | 跨 job 聚合剩餘可退量 |

## §12 開工前仍待 Sean 的

### 12.1 🔴 break-glass 更正程序(D8;R3 F6)—— **這是一道決策題,不是我可以自己拍的板**

**問題**:結案是**一次性**的(E13 要求 `OLD.reviewed_at IS NULL`)。若人選錯 `resolution`,
例如把一筆其實該重試的退款結成 `external_refund_confirmed`,則:
已複核 dead 永久凍結 + DELETE 永擋 + 開新世代要求前代 `retry_authorized`
⇒ **那位客人的退款在合約內永遠退不出來**。

v3 對此**隻字未提**。這與 D1 線的前科同型:**回滾守門在唯一需要它的那天擋死自己**
⇒ 依該次教訓,**必須帶明文 escape**。

**v4 先寫下唯一誠實的現況**:唯一實際出路是 owner 手動 `ALTER TABLE … DISABLE TRIGGER` 後改列、再 ENABLE。
⇒ 施工時**必須寫進 migration COMMENT 與第 3 批 runbook**,並要求:
①Sean 明確批准 ②同交易寫 audit ③事後 read-back 證明 trigger 已重新啟用且僅該列被改。

**但「靠 DISABLE TRIGGER」是繞過守門,不是防護** ⇒ 是否要改成 DB 內的正式更正 RPC = **Sean 拍板**(§14 Q2)。

### 12.2 其他
- **§0b 的 D1-D8 需 Sean 知情**(D1 推翻 master row 25 的 `retry_consumed_at` 字面;D7 是新增的錢面守門)
  —— **不擋寫 code、擋 apply**。
- 第 3 批的「退款線兩題」(混合收款退款分軌 / partiallyPaid 應退額語意)是**第 3 批開批閘**,本片不受阻;
  但若那兩題的答案與本合約衝突,需回頭改。

## §13 折入紀錄
- **R1 = FAIL,35 must-fix + 5 nit** —— v2 全折入、駁回 0。
- **R2 = FAIL,18 must-fix + 4 nit** —— v3 折入 18/18,**駁回 0、改採不同修法 1**:
  🔴 R2 #2(原子消耗)不採 codex 建議的「AFTER INSERT 之後才戳前代」,改為 **D1 刪除欄位**(§3.3)。
  理由:codex 的修法要新開一條「可寫已複核 dead」的路徑,而那條路徑本身就是 Q3=B 的 CAS 的反面。
  **R3 已對 §3.3 的三個前提逐一攻擊、兩個擊破失敗、第三個(`NOT FOUND`)已於本檔 §5.1-3 補齊。**
- **R3(Fable,換模型)= FAIL,11 must-fix + 3 nit** —— v4 折入 14/14、駁回 0。
  🔴 **11 條 must-fix 中有 4 條(F1/F2/F3/F4)是 v3 修 R2 時自己開的新洞** ——
  與 R1→R2 的 8/18 同一復發模式。本檔 §7.4 的**正向鏈 C/D** 就是為了讓這類洞下次直接轉紅。
  🔴 **F5 是本輪唯一的設計層 BLOCKER**:§3.3 的證明成立但問題選錯 ⇒ D7 關閉(§3.5)。
- **master plan 同步**:逐字重寫 row 25 的 active 字面 + §5.0 DAG + §5 軸矩陣「退款工作」列,
  不用段首「以下作廢」覆蓋。**本輪另補 D6-D8**。
- **CURRENT.md 同步**:每輪一併更正。

## §14 給 Sean 的決策題(**apply 前必答,不擋繼續寫 code**)

```
Q1:v4 新增的八個設計改動(D1-D8),你要我全部採用,還是有哪幾條想先看白話說明再決定?
A: A(全部採用,你已看過摘要)| B(先給我 D1/D7 兩條的白話說明,其餘照做)| C(逐條說明再決定)

Q2:結案結錯 resolution 的補救,你要哪一種?
A: A(維持現況:唯一出路是我手動關掉守門改資料,每次都要你批准 + 寫紀錄)
   | B(在 DB 裡做一支正式的「更正結案」RPC,要兩個人簽核才能動)
   | C(先照 A 走,等第 3 批真的遇到再說)

Q3:第 20 代上限,你要?
A: A(維持 20,真撞到走 break-glass)| B(拉高到 100)| C(拿掉上限)
```
