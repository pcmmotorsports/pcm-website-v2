# E10 第 1 批 · A7b「退款工作表 + 狀態機合約」片級 plan **v3**

> 🔴 **v1 → codex 關卡1 R1 FAIL(35 must-fix + 5 nit);v2 → 關卡1 R2 FAIL(18 must-fix + 4 nit)、已作廢。**
> findings 逐字:R1 = `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`、
> R2 = `docs/reviews/2026-07-31-e10-a7b-k1r2-codex.md`(不摘要、不裁定,裁定寫在本檔 §13)。
> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 25(**本輪已逐字重寫,不靠段首覆蓋**)。
> 決策全文 = memory `project_m4b-a7b-refund-jobs-decisions`。
> 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構)⇒ 兩關對抗審查皆跑,不降級。
> 🔴 **R2 的 18 條有 8 條是 v2 自己捅的洞或宣稱關了其實沒關** ⇒ 本檔對「已關閉」一律附**可驗的落點**,不用形容詞。

---

## §0 Sean 2026-07-31 四拍板(前提,未變)

| 題 | 拍板 | 連動 |
|---|---|---|
| Q1 | **A**:A7-t 先單獨 apply + read-back,再套 A1 | 寫進 A1 plan §3.4;本片排在其後 |
| Q2 | **A**:拆成 `A7b-M` + `A7b-T` 兩片 | master plan row 25 與 §5.0 DAG 本輪已改 |
| Q3 | **B**:結案併發 = 鎖列 + `reviewed_at IS NULL` 當 CAS 條件 | master plan「結案 RPC 走 token CAS」字面**已作廢** |
| Q4 | **B**:帳本快照另開子表 `order_refund_job_items` | 不採「隔日重算」 |

---

## §0b v3 的五個設計改動(**推翻 master row 25 的既有字面,需 Sean 知情**)

| # | 改動 | 為什麼(一句話) | 落點 |
|---|---|---|---|
| **D1** | 🔴 **刪除 `retry_consumed_at` 欄** | 它是「後繼列存在」的抄本,零額外防護;而戳它必須 UPDATE 一列已複核的 dead ⇒ 與「已複核 dead 永久凍結」互斥 | §3.3 完整證明 |
| **D2** | 🔴 新增 `refund_call_attempted_at` | 沒有它,lease 過期重領**分不出「還沒打 TapPay」與「打了但沒寫回」** ⇒ 只能二選一:要嘛重打(退兩次)要嘛全部進人工 | §3.4 |
| **D3** | 刪除 E7(`failed → dead`)、新增 E5b(`processing → dead`)、E12 吃下第六次 | 第六次失敗必須**原子**進 dead;v2 會先落地成 `failed` 且 count=6,中間仍可 `failed → queued` | §3.1 |
| **D4** | A7b-M 加具名 dormant `CHECK (false)`,A7b-T 同交易移除 | 「兩片同批 apply ⇒ 風險窗為零」**已被 R2 證偽**(兩支各自 COMMIT) | §1.1 |
| **D5** | 新增 `dead_reason` 結構化欄(具名值域 CHECK) | v2 的 dead 沒有可顯示的死因 ⇒ 第 3 批 dead-review 畫面無東西可畫 | §4.4 |

---

## §1 片界(Q2=A;鐵則 4)

| 片 | 型 | 交付 | 版本號 |
|---|---|---|---|
| **A7b-M** | M | `order_refund_jobs` + `order_refund_job_items` 兩表、所有 CHECK、**五道**唯一性、索引、完整 ACL、COMMENT 合約、**dormant gate** | `20260731120000` |
| **A7b-T** | T | **移除 dormant gate** + 六支守門 trigger(INSERT / UPDATE / DELETE / TRUNCATE / 主從一致 / job↔ledger 等值)+ 行為探針 + 突變 harness | `20260731120100` |

### 1.1 🔴 dormant gate(D4;R2 #14)

v2 寫「兩片必須同批 apply ⇒ 風險窗實際為零」。**這句話是錯的** ——
兩支 migration **各自 COMMIT**;A7b-T 失敗時 A7b-M 會單獨留在正式站,而 plan 自己的三方狀態矩陣就承認半批可能。

⇒ A7b-M 建表時**同時**建:

```sql
ALTER TABLE public.order_refund_jobs
  ADD CONSTRAINT order_refund_jobs_dormant_until_triggers CHECK (false) NOT VALID;
```

- `NOT VALID` 只影響既有列(表是空的、無差別),**新 INSERT 一律被擋**。
- A7b-T 在**所有守門安裝並通過結構驗收之後、同一交易的最後一步** `DROP CONSTRAINT`。
- T 失敗 ⇒ 整支回滾 ⇒ gate 留在原地 ⇒ **表存在但寫不進去**,而不是「可以被亂寫」。
- 驗收:A7b-M apply 後,`INSERT` 任何合法列必紅在 `order_refund_jobs_dormant_until_triggers`;
  A7b-T apply 後,同一筆 INSERT 必綠。**兩個方向都要測**,否則等於沒證明 gate 被移除過。

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
                  ┌─ baseline 初始化(自轉移,同 token)
                  ▼
queued ──E1──▶ processing ──E4──▶ submitted ──E8──▶ reconciling
   ▲              │ ▲ │                                 │ ▲
   │              │ │ └─E3b(不確定送出)──▶ reconciling  │ └─E11 lease 重領
   │              │ └─E3 lease 重領(未打款)             │
   │              └─E5 送出失敗──▶ failed                │
   └──── E6 backoff ────────────────┘                    │
                  └─E5b 第六次失敗──▶ dead ◀──E12 超退 / 第六次查詢異常─┘
                                     ▲
                                     └─E13 結案(dead → dead,寫 review 三欄,一次性)
                     E9 累計 = target ─▶ completed(終態)
                     E10 累計 < target ─▶ submitted(順延)
```

### 3.1 逐條轉移(A7b-T 逐條擋;**表外的組合一律拒絕**)

🔴 **時間與計數器一律寫死公式**(R2 #4:v2 只寫「lease 五分鐘」四個字,trigger 驗不到任何東西)。
下表的「必要條件」全部是 **trigger 當場可驗**的;驗不到的一律進 §5.4 能力邊界,不寫在這裡。

| # | 從 → 到 | trigger 必驗條件(逐條可測) |
|---|---|---|
| E1 | `queued → processing` | `NEW.claim_token IS NOT NULL` 且 `OLD.claim_token IS NULL`;`NEW.claimed_at = now()` 之當次交易時戳;**`NEW.claim_expires_at = NEW.claimed_at + interval '5 minutes'`**;`OLD.next_retry_at IS NULL OR OLD.next_retry_at <= NEW.claimed_at`;`refund_call_attempted_at IS NULL`;其餘欄不得改 |
| E2 | `processing → processing`(**baseline 初始化**)| `claim_token` **不變**;`refunded_before`/`refunded_target` 由 NULL 變非 NULL(成對);**lease 三欄不變**;`refund_call_attempted_at` 仍 NULL;不得改其他欄 |
| E3 | `processing → processing`(**lease 重領,未打款**)| `OLD.claim_expires_at <= now()`;`NEW.claim_token <> OLD.claim_token`(**三欄全換新**:token / claimed_at / claim_expires_at,且 `NEW.claim_expires_at = NEW.claimed_at + interval '5 minutes'`);🔴 **`OLD.refund_call_attempted_at IS NULL`**;不得改其他欄 |
| **E3b** | `processing → reconciling`(**不確定送出,D2/R2 #13**)| `OLD.claim_expires_at <= now()`;🔴 **`OLD.refund_call_attempted_at IS NOT NULL`**;三欄全換新 lease;**`NEW.next_check_at = (date_trunc('day', OLD.refund_call_attempted_at) + interval '1 day')` 之後**(隔日才查得到);`retry_count` / `check_fail_count` 不變 |
| E4 | `processing → submitted` | 🔴 `refunded_before` 與 `refunded_target` **必須已非 NULL**(未持久化 baseline 不准送款);🔴 `OLD.refund_call_attempted_at IS NOT NULL`(沒有標記意圖就不可能有成功回應);`NEW.tappay_refund_id IS NOT NULL`;**清空 lease 三欄**;`NEW.next_check_at >= date_trunc('day', OLD.refund_call_attempted_at) + interval '1 day'` |
| E5 | `processing → failed` | `btrim(NEW.failed_reason) <> ''`;`NEW.retry_count = OLD.retry_count + 1` 且 🔴 **`NEW.retry_count <= 5`**;清空 lease 三欄;`refund_call_attempted_at` 保留原值不得清 |
| **E5b** | `processing → dead`(**第六次失敗,D3**)| `NEW.retry_count = OLD.retry_count + 1` 且 🔴 **`NEW.retry_count = 6`**;`NEW.manual_review_required = true`;`NEW.dead_reason = 'retry_exhausted'`;`btrim(NEW.failed_reason) <> ''`;清空 lease 三欄 |
| E6 | `failed → queued` | `retry_count` 不變且 `<= 5`;🔴 **`NEW.next_retry_at = OLD.updated_at + (interval '5 minutes' * power(2, OLD.retry_count - 1))`**(master 的 `5min × 2^retry`,以「已失敗次數 − 1」為指數 ⇒ 第 1 次失敗延 5 分、第 5 次延 80 分);lease 三欄仍為 NULL;不得改其他欄 |
| E8 | `submitted → reconciling` | `NEW.claim_token IS NOT NULL` 且與 `OLD` 不同(OLD 為 NULL 亦算不同);三欄全換新 lease;`OLD.next_check_at <= now()` |
| E9 | `reconciling → completed` | `refund_id` 由 NULL 變非 NULL;清空 lease 三欄;`NEW.next_check_at IS NULL`;**另由 §5.6 的 deferred 等值 trigger 逐欄比對帳本**(R2 #10) |
| E10 | `reconciling → submitted` | `NEW.next_check_at > OLD.next_check_at`;清空 lease 三欄;**成功查到但未達標 ⇒ `NEW.check_fail_count = 0`**;**查詢異常 ⇒ `NEW.check_fail_count = OLD.check_fail_count + 1` 且 🔴 `NEW.check_fail_count <= 5`** |
| E11 | `reconciling → reconciling`(lease 重領)| `OLD.claim_expires_at <= now()`;三欄全換新 lease;**永不回 `processing`**;計數器不變 |
| E12 | `reconciling → dead` | 二擇一:**超退** ⇒ `NEW.dead_reason = 'over_refunded'`、計數器不變;**第六次查詢異常** ⇒ `NEW.check_fail_count = OLD.check_fail_count + 1 = 6` 且 `NEW.dead_reason = 'reconcile_exhausted'`。兩路皆 `NEW.manual_review_required = true`、清空 lease 三欄 |
| E13 | `dead → dead`(**結案**)| **只准寫 review 三欄**(`reviewed_at` / `reviewed_by` / `resolution`),三欄必須同時由 NULL 變非 NULL;`OLD.reviewed_at IS NULL`(Q3=B 的 CAS 條件);其餘欄一律不得改 |

🔴 **E7(`failed → dead`)已刪除**(D3):沒有任何路徑能讓 `failed` 帶著 `retry_count = 6` 存在
(E5 上限 5、E5b 直接進 dead)⇒ 留著 E7 就是一條**永遠觸發不到、也無法被獨立負測證明**的 edge。
同理 `submitted → dead` **刻意不存在**:第六次查詢異常由 E12 在 `reconciling` 相位原子完成。

🔴 **`failed` 在 `submitted` 之後永不出現**:走 `failed → queued` 會繞回送款相、重呼 Refund =
**退第二次錢**。送出後的所有異常只能走 `submitted ⇄ reconciling` 或 `dead`。

🔴 **為什麼 `reconciling` 不能與 `processing` 共用**:兩者都是「被 worker 持有中」,
但**該呼叫的 API 不同**(Refund vs Record)。共用的話,lease 過期重領時**無法辨識該做哪件事**
⇒ 可能重送退款。**狀態本身就是那個辨識**。

### 3.2 `updated_at` 的定位(E6 公式的前提)
`updated_at` 由 §5.2-6 統一設為 `now()`,**每一筆合法 UPDATE 都會動它**。
E6 的 backoff 以 `OLD.updated_at`(= 上一次失敗落地的時刻)為基準,不是以 `now()`
⇒ 重試間隔不會因為排程延遲而被吃掉。這條**有獨立負測**(§7.4-18)。

### 3.3 🔴🔴 D1:為什麼 `retry_consumed_at` 必須刪掉(R2 #2 的解)

**R2 抓到的死結(事實,已複驗)**:
可被消耗的前代**必然已結案**(`resolution = 'retry_authorized'` 只能由 E13 寫入,而 E13 同時寫 `reviewed_at`)
⇒ `reviewed_at IS NOT NULL` ⇒ 而 §5.2-3 規定 `dead` 只允許 E13 且 `OLD.reviewed_at IS NULL`
⇒ **任何要戳前代的 UPDATE 都會被自己的守門拒絕** ⇒ 合法的第二次退款開不了。

**codex R2 的修法**(AFTER INSERT 之後才戳前代、UPDATE guard 另開一條精確 edge)可以繞開死結,
但它**打破「已複核的 dead 列永久凍結」這條不變式** —— 而那條不變式正是 Q3=B 的 CAS 之所以成立的基礎。
用一條新的可寫路徑,去換一個本來就不需要的欄位,是**負收益**。

**v3 的解:整個欄位刪掉。它提供的防護是零。**

> **命題**:給定 ①`U1 = UNIQUE (cancellation_id, generation)`
> ②後代 INSERT 守門要求「該 cancellation 的**最大世代列** `M` 滿足 `M.generation = NEW.generation - 1`
> 且 `M.status = 'dead'` 且 `M.resolution = 'retry_authorized'`」
> ③DELETE / TRUNCATE 永久阻擋(§5.3)
> ⇒ **任一世代最多只能開出一個後繼世代。**
>
> **證明**:由 ② ,第 N 代的後繼只可能是第 N+1 代(其他世代號的 INSERT 會因
> `M.generation ≠ NEW.generation - 1` 被拒)。由 ①,`(cancellation_id, N+1)` 最多存在一列。
> 由 ③,已存在的列不會消失後再被重建。⇒ 第 N 代的後繼**存在唯一或不存在**。∎

⇒ 「舊授權隔代重用」由 ② 直接擋掉,不需要標記:
gen1 已 `retry_authorized`、gen2 已存在(任何狀態)時,想開 gen3 會拿 gen2 當直接前代 ——
gen2 若非 `dead + retry_authorized` 就是拒絕,**與 gen1 的授權有沒有被「用過」完全無關**。

⇒ 「授權何時被用掉」這件事若要顯示,答案是**後繼列的 `created_at`** ——
`retry_consumed_at` 本來就只會是它的抄本。**多存一份 = 多一個可以與真相不一致的地方**
(memory `feedback_guard-reads-non-authoritative-cache` 的同一種錯)。

**連動刪除**:§4.4 的 `retry_consumed_at 非 NULL ⇒ resolution = 'retry_authorized'` CHECK;
E13 的「+ `retry_consumed_at`」;master row 25 的該段字面(本輪已改)。

### 3.4 D2:`refund_call_attempted_at` —— E3 的判別子(R2 #13 的解)

**問題**:`processing` 的 lease 過期時,新 worker 分不出兩種世界:
(a) 上一個 worker 還沒呼 TapPay Refund;(b) 呼了、外部成功了,但寫 `submitted` 之前 crash。
把 (b) 當 (a) 處理 = **退第二次錢**;把 (a) 當 (b) 處理 = 一筆該退的錢卡進人工。

**解**:worker 在呼叫 Refund **之前**,以獨立交易戳 `refund_call_attempted_at = now()` 並 **COMMIT**,
之後才發 HTTP。⇒ 這個欄位的語意是「**意圖已持久化**」,不是「已成功」。

| 觀察到 | 世界 | 走哪條 edge |
|---|---|---|
| `refund_call_attempted_at IS NULL` | 一定還沒打過 TapPay(戳沒 commit ⇒ HTTP 沒發) | **E3** 重領回 `processing`,可安全呼 Refund |
| `refund_call_attempted_at IS NOT NULL` | 不確定 —— 可能已打款 | **E3b** 直接進 `reconciling`,**永不再呼 Refund**,由 Record 對帳裁定 |

🔴 **這個判別子的正確性有一半在 worker 手上**(「先 commit 再發 HTTP」),trigger 驗不到 ——
明文寫進 §5.4 能力邊界,並列為**第 3 批 worker 片的 DoD 硬前置**。
🔴 **duplicate 回應的收斂**:E3b 之後只走 Record;`< target` ⇒ 順延、`= target` ⇒ completed、
`> target` ⇒ dead。**本片不定義 TapPay duplicate 回應的映射**(它只會出現在 worker 主動重送的路徑,
而 v3 的狀態機**沒有任何路徑會重送同一筆 Refund**)—— 這是 D2 帶來的直接簡化。

---

## §4 A7b-M:表定義

### 4.1 `order_refund_jobs`

**身分與世代**
- `id` uuid PK
- `cancellation_id` uuid NOT NULL
- `order_id` uuid NOT NULL
- 🔴 **複合 FK(R2 #9)**:`FOREIGN KEY (cancellation_id, order_id) REFERENCES public.order_cancellations (id, order_id) ON DELETE RESTRICT`
  —— 單靠 `cancellation_id → order_cancellations(id)` 一支 FK,**cancellation A 的 job 可以宣稱自己屬於 order B**,
  兩道 child FK 仍全部合法。欄序必須對齊被引用唯一約束 `order_cancellations_id_order_id_key UNIQUE (id, order_id)`
  (`20260730130000:125-126` 親驗,**不需 ALTER A7**)。
- `generation` integer NOT NULL DEFAULT 1 CHECK `BETWEEN 1 AND 20`(🔴 上界:無上界的整數欄沒有任何負測可寫)
- `UNIQUE (id, order_id)` —— 供 §4.2 子表的複合 FK 反向引用(同 `order_refunds_id_order_id_key` 手法)

**外部識別(全部不可變)**
- `rec_trade_id` text NOT NULL —— 官方僅寫 String(20)(`tappay-reference.md` §2.2)
  ⇒ CHECK `char_length BETWEEN 1 AND 20`
  🔴 **不加字元集 CHECK(R2 #17)**:v2 寫的 `[A-Za-z0-9_-]` **沒有 TapPay 官方依據**,
  可能拒絕合法的外部 ID = 一筆該退的錢永遠進不了系統。改為僅擋**明確不可能合法**的東西:
  `rec_trade_id !~ '[\x00-\x1F\x7F]'`(控制碼)且 `btrim(rec_trade_id) = rec_trade_id` 且 `<> ''`。
  施工前另做一次 read-back:對正式站既有 `payment_charge_attempts.rec_trade_id` 非 NULL 值取字元集合,
  結果寫進 migration COMMENT 當**觀察紀錄**,**不升格為 CHECK**。
- `bank_refund_id` text NOT NULL CHECK `char_length BETWEEN 1 AND 20` + 同上控制碼/空白規則
- `payload_hash` text NOT NULL CHECK `~ '^[0123456789abcdef]{64}$'`
  🔴 **逐碼位列舉,不用 `[0-9a-f]`(R2 #17)**:POSIX 字元範圍**跟著 locale 走**,
  A7 已實測過同一條 CHECK 在 C locale 與 UTF-8 locale 行為不同(backlog **#305**)⇒ harness 綠、正式站未知。
- `tappay_refund_id` text —— Refund API 回的外部識別;`submitted` 之後持久化、之後不可變

**金額與對帳基準**
- `refund_amount` integer NOT NULL CHECK > 0
- `refunded_before` / `refunded_target` integer(enqueue 時 NULL,E2 才持久化)
- 🔴 **成對 CHECK**(v1 這條是恆真的):
  ```sql
  CHECK ( (refunded_before IS NULL AND refunded_target IS NULL)
       OR (refunded_before IS NOT NULL AND refunded_target IS NOT NULL
           AND refunded_before >= 0
           AND refunded_target = refunded_before + refund_amount) )
  ```
  v1 寫成 `refunded_target IS NOT NULL ⇒ target = before + amount`,
  **`before` 為 NULL 時整式求值為 NULL、PostgreSQL CHECK 放行**。
- 🔴 **`refunded_target > 0` 已刪除**:被 `before >= 0`、`amount > 0`、等式三者**嚴格蘊含**,
  行為層無法單獨觸發。留著就是宣稱一條沒有獨立負測的守門。

**帳本快照(Q4=B 的 header 側;子表在 §4.2)**
`items_amount` / `shipping_fee_before` / `shipping_fee_after` / `shipping_delta` /
`reason` / `actor`(**FK → `staff(id)` ON DELETE RESTRICT**)/ `request_id` ——
全部 **enqueue 當下凍結、不可變**,CHECK 逐條對齊 `order_refunds` 的同名欄
(`refund_amount = items_amount - shipping_delta`、`shipping_delta = shipping_fee_after - shipping_fee_before`、
三個運費欄與 `items_amount` 的正負與上界,逐字抄 `20260725130100:88-119`)。
🔴 **`actor` 刻意不加形狀 CHECK**:`staff` 自帶 `staff_id_format`(`20260726120000:21`)
⇒ 形狀已被 FK 傳遞性保證,加了也**原理上無法被獨立突變證明**(A7 已實測,`20260730130000:100-113`)。

**狀態與生命週期**
- `status` text NOT NULL DEFAULT `'queued'` CHECK IN(七值)
- lease **三欄**:`claim_token` uuid / `claimed_at` / `claim_expires_at`(v2 寫「四欄」是計數錯誤)
- 🔴 `refund_call_attempted_at` timestamptz(**D2**;一旦非 NULL 即不可變、不可清)
- 排程:`retry_count` integer NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `next_retry_at` /
  `next_check_at` / `check_fail_count` integer NOT NULL DEFAULT 0 CHECK `BETWEEN 0 AND 6` / `failed_reason`
- 人工:`manual_review_required` boolean NOT NULL DEFAULT false / `reviewed_at` / `reviewed_by`(**FK → `staff(id)`**)/
  `resolution` text CHECK IN(`retry_authorized` / `external_refund_confirmed` / `over_refund_writeoff`)/
  🔴 `dead_reason` text CHECK IN(`retry_exhausted` / `over_refunded` / `reconcile_exhausted`)(**D5**)
- `refund_id` uuid FK → `order_refunds(id)`
- `created_at` / `updated_at` —— `updated_at` 由 A7b-T 統一設值(只有 DEFAULT 的話它是**會說謊的欄位**)

### 4.2 `order_refund_job_items`(Q4=B)

形狀逐欄對齊 `order_refund_items`(`20260725130100:143-172`),讓隔日寫帳本是「搬」不是「算」:

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
🔴 **跨單防護**:兩道複合 FK 夾住「明細品項 ∈ 本 job 的訂單」——
單靠兩個獨立 FK 做不到(job A 可以掛 order B 的品項,兩個 FK 各自都合法)。

🔴 **子表的四條核心不變式(R2 #11:v2 只搬欄位、沒搬不變式 ⇒「凍結快照」當時只是文字)**
前兩條是 CHECK 做不到的(跨列 / 跨表)⇒ 由 §5.6 的 **DEFERRED CONSTRAINT TRIGGER** 承接:

| ID | 不變式 | 承接者 |
|---|---|---|
| C1 | 每個 job **至少一列**明細 | §5.6 兩支 deferred(parent AFTER INSERT + child AFTER DELETE,照 `20260725130100:182-186` 形狀) |
| C2 | `jobs.items_amount = Σ child.line_amount` | 同上 |
| C3 | `child.quantity <= order_items.quantity` | §5.6 child AFTER INSERT(跨表 ⇒ 不能用 CHECK) |
| C4 | `child.unit_price = order_items.unit_price`(訂單當下快照) | 同上 |

🔴 **子表 UPDATE / DELETE / TRUNCATE 永久阻擋**(§5.3 同一支守門涵蓋兩表)——
沒有這條,「凍結」只擋得住誠實的人。

### 4.3 **五**道唯一性(R2 #12:v2 字面仍寫「四道」但實列五道)

| # | 約束 | 擋掉哪一種「退兩次」 |
|---|---|---|
| U1 | `UNIQUE (cancellation_id, generation)` | 同一取消的同一世代重複建 **+ §3.3 命題的 ①** |
| U2 | partial unique `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一取消**同時**兩個未結案 job |
| U3 | partial unique `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一筆 TapPay 交易同時兩個 active job |
| U4 | `UNIQUE (bank_refund_id)` | TapPay 端的冪等鍵 |
| U5 | partial unique `refund_id WHERE refund_id IS NOT NULL` | 兩個 job 共用同一張帳本 |

🔴 **U4 擋不住跨表重用(R2 #12)**:U4 只在 job 表 unique,
**擋不住新 job 拿一個已存在於 `order_refunds.bank_refund_id` 的值**。
⇒ §5.1 的 INSERT 守門必須另查 `order_refunds`(它是 bank id 的**真相**,不是快取)。
🔴 **誠實邊界**:跨表檢查在 PostgreSQL 無法做成宣告式唯一 ⇒
「job INSERT 與 ledger INSERT 同時發生」擋不住。
現行唯一的 ledger writer 是第 3 批的完成 RPC,而它的值**必然抄自某個 job**(由 §5.6 等值 trigger 強制)
⇒ 此窗在現行規劃內不可觸發;**但它是合約債、不是防護**,寫進 COMMENT。

🔴 **`rec_trade_id NOT NULL` 是 U3 成立的前提**:partial unique **對 NULL 不生效**
⇒ 多筆 NULL 可並存 ⇒ U3 形同虛設。
🔴 **U2/U3 用 `reviewed_at IS NULL` 而非「排除 dead」**:未複核的 dead 若不再擋,人還沒看,系統就自己再退一次。
🔴🔴 **這五道只擋「同時」,擋不住「先後」** —— 見 §5.1 的 INSERT 守門。

### 4.4 逐狀態完整 truth table(R2 #5:v2 只是「要求未來再列」)

一條 `CASE status WHEN … END` 的完整 CHECK。**R = 必須非 NULL、N = 必須 NULL、−= 不限制**:

| status | lease 三欄 | `refund_call_attempted_at` | `next_retry_at` | `next_check_at` | `failed_reason` | `retry_count` | `check_fail_count` | review 三欄 | `dead_reason` | `manual_review_required` | `tappay_refund_id` | `refund_id` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `queued` | N | N | − | N | N | 0-5 | 0 | N | N | false | N | N |
| `processing` | R | − | N | N | N | 0-5 | 0 | N | N | false | N | N |
| `submitted` | N | R | N | **R** | N | 0-5 | 0-5 | N | N | false | **R** | N |
| `reconciling` | R | R | N | R | N | 0-5 | 0-5 | N | N | false | R | N |
| `completed` | N | R | N | N | N | 0-5 | 0-5 | N | N | false | R | **R** |
| `failed` | N | − | **R** | N | **R** | 1-5 | 0 | N | N | false | N | N |
| `dead` | N | − | N | N | − | 0-6 | 0-6 | **全 N 或全 R** | **R** | **true** | − | N |

🔴 **review 三欄的鐵律**:`reviewed_at` / `reviewed_by` / `resolution` **必須全 NULL 或同時非 NULL**,
且**只允許在 `status = 'dead'` 時非 NULL**。
v1 允許單獨寫 `reviewed_at`(甚至夾在自轉移裡)⇒ U2/U3 的 `reviewed_at IS NULL` 當場失效
⇒ **放行第二個 active job**。
🔴 `dead_reason` 在非 dead 一律 NULL;在 dead 一律非 NULL ⇒ **dead-review 畫面永遠有東西可顯示**(D5)。
🔴 `failed` 的 `retry_count` 下界是 **1**:`retry_count = 0` 的 `failed` 代表「沒失敗過卻是失敗態」。

### 4.5 ACL 與函式安全(R2 #7:v2 把 v1 的精確段刪掉了)

**兩表**(逐字,兩表各一份):
```sql
REVOKE ALL ON public.order_refund_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.order_refund_jobs TO service_role;   -- 無 DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN
ALTER TABLE public.order_refund_jobs ENABLE ROW LEVEL SECURITY;             -- zero-policy
```
子表同上但 **僅 `SELECT, INSERT`**(無 UPDATE)。

🔴 **驗收必須是完整八格矩陣**(PG17):
`SELECT / INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN`
× `anon / authenticated / service_role / PUBLIC`。
- **PG17 的第八種權限 `MAINTAIN`**:授出去之後 `has_table_privilege(…,'SELECT')` **仍為 false**
  ⇒ 七格矩陣對它**完全無感**(memory `feedback_race-test-without-barrier-proves-nothing` 實測)。正式站同為 PG17。
- 🔴 **`PUBLIC` 那一列必須排在角色矩陣之前**:`GRANT … TO PUBLIC` 會讓 anon/authenticated 因繼承轉紅
  ⇒ PUBLIC 斷言排在後面的話,**把它整條刪掉仍然全綠**。**順序是正確性的一部分。**

**所有 trigger 函式**:
- 一律 `SECURITY INVOKER`(預設)+ `SET search_path = public, pg_temp`,物件全 schema-qualified。
  🔴 **只有在寫出「INVOKER 下具體缺哪一個權限、在哪一行會炸」時才准改 DEFINER**,理由寫進函式 COMMENT。
- `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated;`
  (trigger 觸發不檢查 EXECUTE、只在 `CREATE TRIGGER` 當下檢查 ⇒ 事後 REVOKE 安全,且擋掉直接呼叫)
- 一律 `CREATE`(**不用 `OR REPLACE`**,避免沿用舊 owner / ACL)
- owner 必須是 `postgres`,列入 §7.1 指紋斷言

---

## §5 A7b-T:六支守門

### 5.1 `BEFORE INSERT`(v1 完全沒有 ⇒ 可以直接 `INSERT status='completed'`)

1. **所有世代一律**(R2 #1:v2 只約束初代):
   `status` 必須是 `'queued'`;lease 三欄、`refund_call_attempted_at`、review 三欄、`dead_reason`、
   `refund_id`、`tappay_refund_id`、`refunded_before/target`、`next_retry_at`、`next_check_at`、`failed_reason`
   **全部必須 NULL**;`retry_count = 0`、`check_fail_count = 0`、`manual_review_required = false`。
   ⇒ 拿到重試授權之後**也不能**直接 INSERT 成 `completed`。
2. **跨表 bank id 唯一(R2 #12)**:`NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE bank_refund_id = NEW.bank_refund_id)`。
3. **後代(`generation > 1`)**:鎖住同一 `cancellation_id` 的**最大世代列**
   (`SELECT … ORDER BY generation DESC LIMIT 1 FOR UPDATE`)並驗:
   `M.generation = NEW.generation - 1`(**直接前代**)、`M.status = 'dead'`、`M.resolution = 'retry_authorized'`。
   🔴 **不戳任何欄位**(D1:授權消耗由後繼列的存在本身記錄,§3.3 已證明)。
4. **後代的 payload 必須等於直接前代(R2 #1)**:除 `id` / `generation` / `bank_refund_id` /
   `request_id` / `created_at` / `updated_at` 外,**業務欄逐欄等於 `M`**
   (`cancellation_id` / `order_id` / `rec_trade_id` / `payload_hash` / `refund_amount` /
   `items_amount` / 三個運費欄 / `reason` / `actor`)。
   ⇒ 沒有這條,「重試授權」可以被拿去**退另一筆錢**。
5. **子表 item set 也必須相等** ⇒ 由 §5.6 的 deferred trigger 在交易結束時比對(INSERT 當下子表還沒寫)。

🔴 **併發正確性的真正來源是 U1,不是那把鎖**(誠實揭示,R2 #15 的同一要求):
兩個 session 同時開 gen2 時,`FOR UPDATE` 會讓後者等待,但後者解鎖後**不會重跑 `ORDER BY`**
⇒ 它仍以 gen1 為「最大世代」通過守門,最後**紅在 U1 的 `23505`**。
⇒ 這把鎖的價值只是「減少無謂拒絕」;**拿掉它不會產生第二次退款,拿掉 U1 會**。
⇒ 併發負測必須斷言 **U1 的 constraint 名**(§7.4-6),不是 trigger 的自訂碼。

### 5.2 `BEFORE UPDATE`
1. `OLD.status → NEW.status` 必須命中 §3.1 的 E1-E13 之一,**含該列的全部額外條件**
2. **終態不可轉出**:`completed` 之後任何欄位都不准改
3. **`dead` 只允許 E13**,且 `OLD.reviewed_at IS NULL`(**Q3=B 的 CAS 條件**)
   ⇒ 已複核的 dead 列**永久凍結**(D1 保住的就是這條)
4. **不可變欄位**:`id` / `cancellation_id` / `order_id` / `generation` / `rec_trade_id` /
   `bank_refund_id` / `payload_hash` / `refund_amount` / 所有帳本快照欄 / `created_at` /
   `refunded_before`(一旦非 NULL)/ `refunded_target`(一旦非 NULL)/ `tappay_refund_id`(一旦非 NULL)/
   `refund_call_attempted_at`(一旦非 NULL)/ `refund_id`(一旦非 NULL)—— 改了就是換一筆退款
5. **計數器逐 edge 寫死**:`retry_count` 只在 E5/E5b `+1`;`check_fail_count` 只在 E10 歸 0 或 `+1`、
   只在 E12 `+1` 到 6;**其餘 edge 一律不得改動兩者**(不是「不得減少」,是**不得改動**)
6. `updated_at := now()`

### 5.3 `BEFORE DELETE` / `BEFORE TRUNCATE`(**兩表都掛**)
**永久阻擋,不留逃生門**(同 A7-t 拍板 Q2=A)。
理由:表級 ACL 擋不住 **owner 與 SECURITY DEFINER RPC** —— 歷史一被清,五道唯一索引就**不再擋重退**。
🔴 驗收必須證明 **owner 身分也失敗**(用 service_role 測 = 測了個寂寞)。
子表另加 `BEFORE UPDATE` 一律阻擋(§4.2「凍結」)。

### 5.4 🔴 能力邊界(明文,不得在任何地方宣稱超出)
trigger **看得到**:狀態圖、本地欄位、同表其他列(可鎖)、其他表的**已提交**內容。
trigger **看不到**:
- TapPay Refund 是否真的成功、Record 的累計是 `< / = / >` target
- baseline 是不是真的來自 API
- 呼叫者以為自己持有哪一把 token ⇒ **token CAS 是 worker 的 `WHERE claim_token = $1` 的責任**
- 🔴 **worker 有沒有遵守「先 commit `refund_call_attempted_at` 再發 HTTP」**(D2 的一半正確性在這裡)
- 🔴 **跨表 bank id 的併發**(§4.3)

⇒ 這些必須在**第 3 批 worker 的驗收**裡被證明,本片不得代為宣稱。

### 5.5 `RAISE` 的形狀
「負測一律斷言 SQLSTATE + `CONSTRAINT_NAME`」這條紀律在 trigger 上**會失效** ——
普通 `RAISE EXCEPTION` 的 `CONSTRAINT_NAME` 是空的(2026-07-30 實測)。
⇒ 本片所有 trigger 的 `RAISE` 一律帶 **`USING ERRCODE = '<自訂>'`, `CONSTRAINT = '<具名 ID>'`**,
探針才驗得到「紅在指定的那一條」。ID 命名 = `a7bt_<edge 或規則>`(例:`a7bt_e13_already_reviewed`)。

### 5.6 兩支 `DEFERRED CONSTRAINT TRIGGER`(R2 #10 / #11)

**(a) 主從一致(C1-C4)**:parent `AFTER INSERT` + child `AFTER INSERT OR DELETE`,
兩支都 `DEFERRABLE INITIALLY DEFERRED`。
🔴 **為何是兩支**:只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件**
⇒ 空 header 完全擋不住(`20260725130100:180-186` 的同一個教訓,已實證)。

**(b) job ↔ ledger 等值(R2 #10:v2 宣稱「由 immutable + U5 關閉」是錯的)**
parent `AFTER UPDATE` deferred:當 `NEW.status = 'completed'` 時斷言
- `order_refunds` 存在該 `refund_id` 且 `status = 'confirmed'` 且 `confirmed_at IS NOT NULL`
- **逐欄相等**:`order_id` / `bank_refund_id` / `tappay_refund_id` / `refund_amount` /
  `items_amount` / `shipping_fee_before` / `shipping_fee_after` / `shipping_delta` /
  `reason` / `actor` / `request_id`
- **item set 完全相等**:`(order_item_id, quantity, unit_price, line_amount)` 的集合
  在 `order_refund_job_items` 與 `order_refund_items` 之間雙向無差集
- 任一格不符 ⇒ `RAISE`(整筆交易回滾)

🔴 U5 只防「兩個 job 共用一張帳本」,**完全不證明**上面任何一格。

---

## §6 R9-R19 關閉矩陣(誠實版)

**「關閉」= 本片有可執行的驗收落點。「未關閉」= 現在就具名,但落點在第 3 批。**
🔴 R2 #16 抓的就是 v2 把「未關閉」寫成「關閉」。

| 規格 | 狀態 | 由誰關閉 | 驗收落點 |
|---|---|---|---|
| R9 baseline + job↔ledger 等值 | ✅ **關閉** | A7b-T(E2/E4)+ **§5.6(b) 等值 trigger** | 探針 T-E2/T-E4;等值 = §7.4-16 逐欄與 item set 突變 |
| R10 `reconciling` 獨立相位 | ✅ 關閉 | A7b-T(E8/E11) | 探針「`reconciling → processing` 必拒」 |
| R11 `failed` 不在 `submitted` 之後 | ✅ 關閉 | A7b-T(轉移表無此 edge) | 探針「`submitted → failed` 必拒」 |
| R12 reclaim 寫死 + `check_fail_count` 入 schema | ✅ 關閉 | A7b-M + A7b-T(E11) | 探針 T-E11;CHECK 0-6 |
| R13 成功歸零 / 異常 +1 / CAS 寫入 | 🟡 **半關閉** | 歸零與 +1 = A7b-T(E10/E12);**CAS = 未關閉** | 本片:探針 T-E10 兩向。**未關閉部分**:worker `reconcileRefundJob()` 的 `UPDATE … WHERE id=$1 AND claim_token=$2` rowcount 必為 1 ⇒ 第 3 批測試 ID `W-R13-CAS-1/2` |
| R14 Record 三路寫死 | 🔴 **未關閉** | **第 3 批 worker** `reconcileRefundJob()` | **hard release gate**:三路各一測(`<` ⇒ E10 順延 / `=` ⇒ E9 completed / `>` ⇒ E12 dead),測試 ID `W-R14-LT/EQ/GT`。本片只提供 `refunded_target` 與三個出口 edge |
| R15 durable 告警 + LINE 失敗重發 | 🔴 **未關閉** | **第 3 批** | **hard release gate**:掃描條件寫死 `status='dead' AND manual_review_required AND reviewed_at IS NULL`;測試 ID `W-R15-RESEND`(LINE 送失敗後下一輪必重發)。本片只在 COMMENT 記契約債 |
| R16 結案 RPC 鎖 + 稽核 | 🟡 **半關閉** | CAS 條件 = A7b-T §5.2-3(**本片關閉**);RPC 本體 = 第 3 批 | **未關閉部分現在具名**:`public.admin_resolve_dead_refund_job(p_job_id uuid, p_resolution text, p_reviewed_by text, p_note text)`;service_role only、SECURITY DEFINER、`SELECT … FOR UPDATE` 鎖列後重驗 `status='dead'`;`UPDATE … WHERE id=$1 AND reviewed_at IS NULL` **rowcount 必為 1**,否則 `RAISE … ERRCODE='PCM09'`;同交易寫 `order_notes` **恰一筆**。測試 ID `W-R16-1`(單人成功)/`W-R16-2`(兩 session 一成功一 conflict)/`W-R16-3`(audit 恰一筆)/`W-R16-4`(結案撞 worker) |
| R17 世代式 + one-current partial unique | ✅ 關閉 | A7b-M(U1/U2)+ A7b-T §5.1 | INSERT 守門探針 §7.4-1~6 |
| R18 `resolution` 三值分流 | ✅ 關閉 | A7b-M(CHECK)+ A7b-T §5.1-3 | 三條負測 §7.4-3/4/5 |
| R19 原子消耗授權 | ✅ **關閉,但機制已換**(D1) | A7b-M(U1)+ A7b-T §5.1-3 | §3.3 命題 + 負測 §7.4-2~6;🔴 **`retry_consumed_at` 已刪** |

---

## §7 驗收

沿用 A1 已證明有效的骨架 —— 🔴 **精確措辭:`scripts/a1-verify.sh` 在本機 PG17.10 已 61/0;A1 本身尚未 apply 到正式站**。
承接:外層 oracle 存 shell 側 / `snapshot()` fail-closed(驗 psql 退出碼 + stderr 空 + 補 `SNAPSHOT-OK` sentinel,
`scripts/a1-verify.sh:50-57`)/ harness 自我測試(故意弄壞快照 SQL 必須當場中止,`:138-144`)/
結構與行為突變分開跑 / 每個 mutant 指定唯一預期第一失敗 ID / 對照組必跑。

### 7.1 承接 A7-t 已實證的七條假綠路徑(本片核心是 trigger ⇒ 全部適用)
`tgenabled`(DISABLE / ENABLE REPLICA)、`tgqual`(`WHEN (false)`)、`tgrelid`(綁錯表)、
`tgtype`(**事件 bitmap**;R2 #14 補:少了它,把 `BEFORE INSERT` 改成 `BEFORE UPDATE` 不會被抓到)、
`tgfoid` vs `regprocedure`(同名異 schema no-op)、**函式本體 `md5(prosrc)` 指紋**、owner、**完整 ACL allowlist**。

### 7.2 一對一矩陣(**本片必須逐格填出來,不得再寫「未來再列」**)

格式固定六欄,**一列一格,不合併**:

| 約束/守門 ID | 正向前提(合法列形狀) | 負向資料(只動一格) | 預期 SQLSTATE | 預期 CONSTRAINT_NAME | 對應 mutant |
|---|---|---|---|---|---|

**必須覆蓋的格數**(施工時逐格填,缺一格 = 驗收不通過):
- `generation` 上下界 ×2、`retry_count` 上下界 ×2、`check_fail_count` 上下界 ×2
- `bank_refund_id` / `rec_trade_id` 長度上下界 ×4、控制碼 ×2、前後空白 ×2
- `payload_hash` 形狀 ×3(長度短 / 長度長 / 非 hex 碼位)
- baseline 成對 ×3(單獨 before / 單獨 target / 等式不符)
- 金額三條 CHECK ×3
- §4.4 truth table:**七態 × 每態至少一格 R 與一格 N** = 最少 14 格
- 五道唯一性 ×5、兩道複合 FK ×2(各含跨單負測)、兩支 staff FK ×2
- E1-E13 共 **14 條 edge**(含 E3b/E5b)× 每條至少一格額外條件
- §5.6 兩支 deferred:C1-C4 ×4、等值逐欄 ×11、item set 雙向差集 ×2
- ACL 八格 × 四角色 = 32 格(**PUBLIC 排最前**)
- §7.1 八條指紋

### 7.3 探針設計紀律
- **U2 與 U3 必須分開構造**:U2 用「同 cancellation、**不同** rec_trade_id」,
  U3 用「**不同** cancellation、同 rec_trade_id」。否則兩者會先紅在同一個索引,**刪掉另一個索引仍全綠**。
- **轉移探針先建出「除了那條 edge 之外全部合法」的列形狀**,再斷言指定 trigger ID。
  🔴 同理套用於 **INSERT 守門**:直接 `INSERT status='completed'` 的 fixture **必須除了 status 之外全部合法**
  (含該狀態下 truth table 要求的所有 R 欄),否則移除 INSERT 守門後會**紅在 CASE CHECK** = 紅在錯的地方,
  mutant 看起來被抓到、其實沒有(R2 #14)。
- **不可變欄位與計數器的突變要夾在合法 edge 裡測**(例:`processing→failed` 的同時跳 count),
  否則會先被「該狀態不准自轉」擋掉。
- 🔴 **刪掉 v1 那條「直接 INSERT `generation+1` 應成功」的正向驗收** —— 它只證明 partial unique 放行,
  **反而替重退破口背書**。
- 🔴 **併發斷言不得只寫「不超過一個成功」** —— 兩個都失敗也會通過。
  必須斷言:**恰一成功、另一筆精確失敗於指定 constraint、gen2 恰一列**。

### 7.4 必做負測(每條都是一種「退第二次錢」;正向 2 條在最後)
1. `INSERT status='completed'` 直接建(**其餘欄全合法**)→ 拒於 `a7bt_insert_must_be_clean_queued`
2. `INSERT generation=2` 而前代不是 dead → 拒
3. 前代 `resolution='external_refund_confirmed'` 仍開新世代 → 拒
4. 前代 `resolution='over_refund_writeoff'` 仍開新世代 → 拒
5. **舊授權隔代重用開 gen3**(gen1 retry_authorized、gen2 queued)→ 拒(§3.3 的 ②)
6. **兩 session 併發重開 gen2**:A `BEGIN; INSERT`(取得 gen1 的 FOR UPDATE)→ B `BEGIN; INSERT`(阻塞)
   → A `COMMIT` → B 解阻塞後**必紅於 U1 的 `23505`**。斷言:恰一成功、gen2 恰一列
7. `INSERT` 一個已存在於 `order_refunds.bank_refund_id` 的值 → 拒(§5.1-2)
8. **後代 payload 與前代不同**(逐欄各一條:金額 / rec_trade_id / order_id / actor …)→ 拒
9. **後代子表 item set 與前代不同** → 拒(deferred,在 `COMMIT` 時紅)
10. `submitted → processing` / `reconciling → processing` / `submitted → failed` / `submitted → dead` → 拒
11. `completed` 轉出 → 拒;`dead → queued` → 拒
12. **單獨寫 `reviewed_at`** → 拒;**已結案的 dead 再結一次**(`OLD.reviewed_at` 非 NULL)→ 拒
13. **未持久化 baseline 就 `processing → submitted`** → 拒
14. 🔴 **`refund_call_attempted_at IS NOT NULL` 的 lease 過期列走 E3(回 `processing`)** → 拒(D2 的核心)
15. 🔴 **`retry_count = 5` 的 `processing` 走 E5(進 `failed`)** → 拒(D3:第六次必須直接進 dead)
16. **job↔ledger 等值**:逐欄各改一格 ×11、item set 多一列 / 少一列 / 數量不符 → 皆拒(deferred)
17. 子表:零明細 job / `Σ line_amount ≠ items_amount` / `quantity > order_items.quantity` /
    `unit_price ≠ order_items.unit_price` → 皆拒;子表 UPDATE / DELETE → 拒
18. **E6 backoff 基準**:`next_retry_at` 用 `now()` 而非 `OLD.updated_at` 算 → 拒(§3.2)
19. **DELETE / TRUNCATE 一律拒,含 owner 身分**(兩表)
20. 未複核的 dead 仍擋得住同 cancellation / 同 rec_trade_id 的新 job(兩個獨立案例,U2/U3 分開構造)
21. 兩個 job 指向同一 `refund_id` → 拒(U5)
22. **dormant gate 雙向**:A7b-M 之後合法 INSERT 必拒;A7b-T 之後同一筆必過
23. **正向 A**:`queued→processing→(E2 baseline)→submitted→reconciling→completed` 全鏈可走
24. **正向 B**:`…→dead(E5b)→E13 結案 retry_authorized→INSERT gen2` 全鏈可走(**證明 D1 沒有把合法路徑鎖死**)

---

## §8 誠實邊界(先寫,不等審查逼)
- 本機 PG17.10 非 Supabase;`auth.uid()` 是 shim
- **trigger 不保證 fencing**(§5.4);token CAS 屬 worker,第 3 批才被證明
- **D2 的一半正確性在 worker 手上**(「先 commit 再發 HTTP」),trigger 驗不到
- **跨表 bank id 的併發窗擋不住**(§4.3),現行規劃內不可觸發,但那是推論不是防護
- **本片零 TapPay 接觸**:「隔日生效」「Record 三路」全是合約文字,正確性要等第 3 批對真 API 驗
- **TapPay duplicate 回應只有官方文字、沒有實測** —— v3 的狀態機沒有任何重送路徑,所以不依賴它
- `reviewed_by` 在 E8-B 上線前**只是操作者自陳,不是已驗證身分**
- **A7b-M 單獨存在時由 dormant gate 擋住**(§1.1)—— 這是防護,不再是「靠沒有 writer」的推論

## §9 27 項綠燈宣稱
**兩片皆不宣稱任何項變綠**(原則 4)。第 19 項的退款面在第 3 批。

## §10 Migration 骨架 / rollback / rollout
- 兩支皆:顯式 `BEGIN;` + `SET LOCAL lock_timeout='5s'` + `statement_timeout='60s'` + `COMMIT;`
  (D0-1 拍板:照舊寫法,不得順手改)
- 結尾各自 fail-closed 結構驗收 DO block,斷言帶機器可辨識 ID
- 🔴 **rollback(R2 #18:v2 的版本不可執行 —— 先 DROP parent 會被 child FK 擋)**,順序寫死:
  1. 停 writer(第 3 批之前 = 無 writer)
  2. 驗兩表為空,非空則備份後停下 raise Sean(**不得靜默續行**)
  3. `DROP TRIGGER` 子表四支 → `DROP TABLE public.order_refund_job_items`(**不加 CASCADE**)
  4. `DROP TRIGGER` parent 六支 → `DROP TABLE public.order_refund_jobs`(**不加 CASCADE**)
  5. `DROP FUNCTION` A7b-T 的**全部**函式(逐一具名,含 §5.6 兩支 deferred)
  6. 前置 preflight:`pg_depend` 查兩表與所有函式的外部依賴,非空即 abort
  🔴 **只允許在第一個 writer(第 3 批 worker)之前**;之後只能 forward repair,
  且該程序**列為第 3 批 worker 片的 DoD 硬前置**
- **rollout**:承 Q1=A —— A7-t 單獨 apply → read-back → A1 → read-back → 本兩片**接續**;
  每次 `db push` 前先 `--dry-run` 對 pending 清單;
  失敗時做 **ledger / schema / 資料三方狀態矩陣**,`schema 有 + ledger 無` ⇒ 修 ledger、**不得重跑**;
  🔴 **A7b-M 成功但 A7b-T 失敗 = 已知可能狀態**,由 dormant gate 承接(§1.1),不是異常

## §11 索引具名落點(R2 nit 2)
排程查詢形狀 → partial index,逐條具名 + `EXPLAIN` 驗收:

| 索引 | 定義 | 服務的查詢 |
|---|---|---|
| `orj_due_queued_idx` | `(next_retry_at) WHERE status = 'queued'` | claim 掃描 |
| `orj_due_failed_idx` | `(next_retry_at) WHERE status = 'failed'` | backoff 到期掃描 |
| `orj_due_submitted_idx` | `(next_check_at) WHERE status = 'submitted'` | 隔日對帳掃描 |
| `orj_stale_lease_idx` | `(claim_expires_at) WHERE status IN ('processing','reconciling')` | lease 過期回收 |
| `orj_unreviewed_dead_idx` | `(created_at) WHERE status = 'dead' AND reviewed_at IS NULL` | dead-review 清單 + R15 重發 |
| `orji_order_item_idx` | 子表 `(order_item_id)` | 跨 job 聚合剩餘可退量 |

## §12 開工前仍待 Sean 的
- 🔴 **§0b 的 D1-D5 五個設計改動需要 Sean 知情**(D1 推翻 master row 25 的 `retry_consumed_at` 字面)——
  **不擋寫 plan、擋 apply**。
- 第 3 批的「退款線兩題」(混合收款退款分軌 / partiallyPaid 應退額語意)是**第 3 批開批閘**,本片不受阻;
  但若那兩題的答案與本合約衝突,需回頭改。

## §13 折入紀錄
- **R1 = FAIL,35 must-fix + 5 nit** —— 逐字 `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`,v2 全折入、駁回 0。
- **R2 = FAIL,18 must-fix + 4 nit** —— 逐字 `docs/reviews/2026-07-31-e10-a7b-k1r2-codex.md`。
  本 v3 折入 18/18,**駁回 0、改採不同修法 1**:
  🔴 **R2 #2(原子消耗)不採 codex 建議的「AFTER INSERT 之後才戳前代」**,改為 **D1 刪除欄位**
  —— 理由 §3.3:codex 的修法要新開一條「可寫已複核 dead」的路徑,而那條路徑本身就是 Q3=B 的 CAS 的反面;
  刪欄位則同時解掉死結、少一條 edge、少一支 trigger,且防護力由 §3.3 的命題嚴格證明**不減**。
- **master plan 同步**:本輪**逐字重寫** row 25 的 active 字面 + §5.0 DAG + §5 軸矩陣「退款工作」列,
  不用段首「以下作廢」覆蓋(R2 #8:v2 只改碰到的行,是本 repo 第 9 次犯同一個錯)。
- **CURRENT.md 同步**:本輪一併更正(R2 nit 4)。
