# E10 第 1 批 · A7b「退款工作表 + 狀態機合約」片級 plan **v2**

> 🔴 **v1 經 codex 關卡1 判 FAIL(約 35 must-fix + 5 nit)、已作廢**。
> findings 逐字 = `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`(不摘要、不裁定,裁定寫在本檔 §12)。
> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 25(**已依本次拍板改寫**)。
> 決策全文 = memory `project_m4b-a7b-refund-jobs-decisions`。
> 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構)⇒ 兩關 codex 皆跑,不降級。

---

## §0 Sean 2026-07-31 四拍板(v2 的前提)

| 題 | 拍板 | 連動 |
|---|---|---|
| Q1 | **A**:A7-t 先單獨 apply + read-back,再套 A1 | 寫進 A1 plan §3.4;本片排在其後 |
| Q2 | **A**:**拆成 `A7b-M` + `A7b-T` 兩片** | master plan row 25 與 §5.0 DAG 已改 |
| Q3 | **B**:結案併發 = **鎖列 + `reviewed_at IS NULL` 當 CAS 條件** | 🔴 master plan「結案 RPC 走 token CAS」字面**已作廢** |
| Q4 | **B**:帳本快照 **另開子表 `order_refund_job_items`** | 不採「隔日重算」 |

🔴 **Q3 為什麼非拍不可**:master plan 原本要求結案 RPC 走 token CAS,
但本片同時要求 `dead` 狀態的 `claim_token` **必須為 NULL**(避免舊 token 殘留被誤用)——
**兩者無法同時成立**。不拍板就會在施工時被迫亂猜(codex K1 抓)。

---

## §1 片界(Q2=A;鐵則 4)

| 片 | 型 | 交付 | 版本號 |
|---|---|---|---|
| **A7b-M** | M | `order_refund_jobs` + `order_refund_job_items` 兩表、所有 CHECK、四道唯一性、索引、ACL、COMMENT 合約 | `20260731120000` |
| **A7b-T** | T | **四支守門 trigger**(INSERT / UPDATE / DELETE / TRUNCATE)+ 行為探針 + 突變 harness | `20260731120100` |

🔴 **A7b-M 單獨存在的期間,這張表是「可以被亂寫的」** —— 這是拆片的已知代價。
緩解:**兩片必須同批 apply**(寫進兩支 migration 的 COMMENT 與 rollout runbook);
且在 A7b-T 之前**沒有任何 writer**(worker 在第 3 批)⇒ 風險窗實際為零。
此結論與 A7 / A7-t 的處理方式一致。

---

## §2 這片在做什麼

`order_refund_jobs` = **卡片退款的工作表**:一次要退的錢 = 一列 job,
由第 3 批的 worker 拿去打 TapPay、隔日對帳、最後同交易寫進既有的 `order_refunds` 帳本。

**交付的是規則,不是行為。** worker 照這份合約寫,不得另立。

### 2.1 為什麼需要工作表
TapPay 退款**隔日才生效**(`docs/reference/tappay-reference.md` §2.3):Refund API 回 status 0
只代表「已送出」。⇒ 送出與確認之間必須有**可持久化、可重入、可對帳**的中間狀態,
否則 crash 或重試 = **退兩次錢**。

### 2.2 範圍界線
**不做**:worker / 排程 / 任何 TapPay 呼叫 / enqueue RPC / 人工結案 RPC(全在第 3 批);
不碰 `order_refunds`、`order_cancellations`、`orders` 既有結構;
**不加 enum type**(`ALTER TYPE … ADD VALUE` 不可逆、新值不能同交易用)⇒ 一律 `text` + 具名 CHECK。

---

## §3 狀態機

```
                  ┌─ baseline 初始化(自轉移,同 token)
                  ▼
queued ──claim──▶ processing ──送出成功──▶ submitted ──claim──▶ reconciling
   ▲                   │  ▲                                          │  ▲
   │                   │  └─ lease 過期重領(新 token)                │  └─ lease 過期重領(新 token)
   │                   └──送出失敗──▶ failed                          │
   └────── backoff ────────────────────┘                             │
                         retry 第 6 次 ─▶ dead ◀── 超退 / 連續 6 次查詢異常 ─┤
                                                累計 = target ─▶ completed(終態)
                                                累計 < target ─▶ submitted(順延)
```

### 3.1 逐條轉移(A7b-T 逐條擋;**表外的組合一律拒絕**)

| # | 從 → 到 | 額外必要條件(trigger 可驗的部分) |
|---|---|---|
| E1 | `queued → processing` | 產新 `claim_token`;`next_retry_at` 為 NULL 或已到期 |
| E2 | `processing → processing`(**baseline 初始化**)| `claim_token` **不變**;`refunded_before`/`refunded_target` 由 NULL 變非 NULL;不得改其他欄 |
| E3 | `processing → processing`(**lease 重領**)| `claim_token` **必須改變**;`OLD.claim_expires_at <= now()` |
| E4 | `processing → submitted` | 🔴 `refunded_before` 與 `refunded_target` **必須已非 NULL**(未持久化 baseline 不准送款) |
| E5 | `processing → failed` | `failed_reason` 非空白;`retry_count` = OLD+1 |
| E6 | `failed → queued` | `retry_count` 不變;`next_retry_at` 非 NULL 且 > OLD 的值 |
| E7 | `failed → dead` | `retry_count = 6`;`manual_review_required = true` |
| E8 | `submitted → reconciling` | 產新 `claim_token`;`next_check_at` 已到期 |
| E9 | `reconciling → completed` | `refund_id` 非 NULL(同交易寫帳本);清空 lease 三欄 |
| E10 | `reconciling → submitted` | `next_check_at` 往後延;`check_fail_count` **成功查到但未達標 ⇒ 歸 0**;**查詢異常 ⇒ +1** |
| E11 | `reconciling → reconciling` | lease 重領,`claim_token` 必須改變;**永不回 `processing`** |
| E12 | `reconciling → dead` | 超退,或 `check_fail_count = 6`;`manual_review_required = true` |
| E13 | `dead → dead`(**結案**)| 只准寫 review 三欄 + `retry_consumed_at`;`OLD.reviewed_at IS NULL`(Q3=B 的 CAS) |

🔴 **`failed` 在 `submitted` 之後永不出現**:走 `failed → queued` 會繞回送款相、重呼 Refund =
**退第二次錢**。送出後的所有異常只能走 `submitted ⇄ reconciling` 或 `dead`。

🔴 **為什麼 `reconciling` 不能與 `processing` 共用**:兩者都是「被 worker 持有中」,
但**該呼叫的 API 不同**(Refund vs Record)。共用的話,lease 過期重領時**無法辨識該做哪件事**
⇒ 可能重送退款。**狀態本身就是那個辨識**。

🔴 **E2 與 E3 都是 `processing → processing`,靠 `claim_token` 有沒有變來區分**(K1 M11)。
沒有 E2 的話,「baseline 必須先持久化才能送款」這條規則**在狀態圖上無路可走**。

---

## §4 A7b-M:表定義

### 4.1 `order_refund_jobs`

欄位分四組,**逐組寫明它為什麼在**:

**身分與世代**
- `id` uuid PK
- `cancellation_id` uuid NOT NULL **FK → `order_cancellations(id)` `ON DELETE RESTRICT`**(K1 nit:對齊 A7 的財務事實留存慣例)
- `generation` integer NOT NULL DEFAULT 1 CHECK ≥ 1

**外部識別(全部不可變)**
- `rec_trade_id` text NOT NULL —— 🔴 官方 String(20)(`tappay-reference.md` §2.2)⇒
  CHECK `char_length BETWEEN 1 AND 20` **且** `~ '^[A-Za-z0-9_-]+$'`(K1 M21:v1 只驗 `btrim<>''`,tab 可過)
- `bank_refund_id` text NOT NULL CHECK `char_length BETWEEN 1 AND 20`
- `payload_hash` **text** NOT NULL CHECK `~ '^[0-9a-f]{64}$'` —— 🔴 K1 M20:v1 只驗長度 ⇒
  64 個任意字元可過;且必須列入**不可變欄位**,否則可事後改寫
- `tappay_refund_id` text —— 🔴 K1 M22:Refund API 回的外部識別在 v1 **沒有落點**,
  送出後 crash 或隔日建帳本時會遺失。`submitted` 之後持久化、之後不可變

**金額與對帳基準**
- `refund_amount` integer NOT NULL CHECK > 0
- `refunded_before` / `refunded_target` integer(enqueue 時 NULL,E2 才持久化)
- 🔴 **成對 CHECK(K1 M12,v1 這條是恆真的)**:
  ```sql
  CHECK ( (refunded_before IS NULL AND refunded_target IS NULL)
       OR (refunded_before IS NOT NULL AND refunded_target IS NOT NULL
           AND refunded_before >= 0
           AND refunded_target = refunded_before + refund_amount) )
  ```
  v1 寫成 `refunded_target IS NOT NULL ⇒ target = before + amount`,
  **`before` 為 NULL 時整式求值為 NULL、PostgreSQL CHECK 放行**。
- 🔴 **`refunded_target > 0` 已刪除(K1 M13)**:它被 `before >= 0`、`amount > 0`、等式三者**嚴格蘊含**,
  行為層無法單獨觸發。留著就是宣稱一條沒有獨立負測的守門。

**帳本快照(Q4=B 的 header 側;子表在 §4.2)**
`items_amount` / `shipping_fee_before` / `shipping_fee_after` / `shipping_delta` /
`reason` / `actor`(**FK → `staff(id)` `ON DELETE RESTRICT`**)/ `request_id` ——
全部 **enqueue 當下凍結、不可變**,CHECK 逐條對齊 `order_refunds` 的同名欄
(含 `refund_amount = items_amount - shipping_delta`、`shipping_delta = after - before`)。
🔴 **為什麼要凍結**:隔日寫帳本時,運費規則與品項金額可能已經變了(Q4 的 C 案就是敗在這裡)。

**狀態與生命週期**
- `status` text NOT NULL DEFAULT `'queued'` CHECK IN(七值)
- lease:`claim_token` uuid / `claimed_at` / `claim_expires_at`
- 排程:`retry_count`(0-6)/ `next_retry_at` / `next_check_at` / `check_fail_count`(0-6)/ `failed_reason`
- 人工:`manual_review_required` boolean NOT NULL DEFAULT false / `reviewed_at` / `reviewed_by`(**FK → `staff(id)`**,K1 M23)/ `resolution`(三值 CHECK)/ `retry_consumed_at`
- `refund_id` uuid FK → `order_refunds(id)`
- `created_at` / `updated_at` —— 🔴 `updated_at` **由 A7b-T 的 trigger 統一設值**(K1 nit:v1 只有 DEFAULT、永遠不會更新 = 會說謊的欄位)

### 4.2 `order_refund_job_items`(Q4=B)

形狀**逐欄對齊 `order_refund_items`**(`20260725130100:143-166`),讓隔日寫帳本是「搬」不是「算」:

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
⇒ `order_refund_jobs` 需**加 `order_id` 欄 + `UNIQUE (id, order_id)`**(供上面第一道複合 FK 用),
與 `order_refunds` 的 `order_refunds_id_order_id_key` 同一手法。
🔴 **跨單防護**:兩道複合 FK 夾住「明細品項 ∈ 本 job 的訂單」——
單靠兩個獨立 FK 做不到(job A 可以掛 order B 的品項,兩個 FK 各自都合法)。

### 4.3 **四**道唯一性(v1 少算一道,K1 M3)

| # | 約束 | 擋掉哪一種「退兩次」 |
|---|---|---|
| U1 | `UNIQUE (cancellation_id, generation)` | 同一取消的同一世代重複建 |
| U2 | partial unique `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一取消**同時**兩個未結案 job |
| U3 | partial unique `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一筆 TapPay 交易同時兩個 active job |
| **U4** | **`UNIQUE (bank_refund_id)`** | 🔴 master plan 明訂、**v1 整個漏掉**;這是 TapPay 端的冪等鍵 |
| U5 | partial unique `refund_id WHERE refund_id IS NOT NULL` | 🔴 K1 M10:兩個 job 共用同一張帳本 |

🔴 **`rec_trade_id NOT NULL` 是 U3 成立的前提**:partial unique **對 NULL 不生效**
⇒ 多筆 NULL 可並存 ⇒ U3 形同虛設。沒有 `rec_trade_id` 的單本來就進不了卡片退款線。
🔴 **U2/U3 用 `reviewed_at IS NULL` 而非「排除 dead」**:未複核的 dead 若不再擋,人還沒看,
系統就自己再退一次。
🔴🔴 **但這四道只擋「同時」,擋不住「先後」**(K1 M6)—— 見 §5 的 INSERT 守門。

### 4.4 逐狀態完整 CASE(K1 M19:v1 全是單向蘊含)

不寫成一堆 `A ⇒ B`,改寫成**一條 `CASE status WHEN … END` 的完整 CHECK**,
對每個狀態明列**允許與禁止**的欄位集合:lease 三欄 / 排程兩欄 / `failed_reason` /
review 四欄 / `refund_id` / `tappay_refund_id`。
🔴 v1 允許「非 failed 卻留著 `failed_reason`」「非 dead 卻標人工複核」「`reviewed_by` 單獨存在」。

🔴 **review 四欄的鐵律(K1 M5)**:`reviewed_at` / `reviewed_by` / `resolution` **必須全 NULL 或同時非 NULL**,
且**只允許在 `status = 'dead'` 時非 NULL**。
v1 允許單獨寫 `reviewed_at`(甚至夾在自轉移裡)⇒ U2/U3 的 `reviewed_at IS NULL` 當場失效
⇒ **放行第二個 active job**。
`retry_consumed_at` 非 NULL ⇒ `resolution = 'retry_authorized'`。

---

## §5 A7b-T:四支守門 trigger

### 5.1 `BEFORE INSERT`(🔴 v1 完全沒有,K1 M4/M6)
沒有這支,前面所有努力等於零 —— 可以直接 `INSERT status='completed'`。

1. **初代(`generation = 1`)**:`status` 必須是 `'queued'`、lease 四欄與 review 四欄與
   `refund_id`/`tappay_refund_id`/`refunded_*` 全部必須 NULL、兩個計數器必須 0
2. **後代(`generation > 1`)**:🔴 **必須鎖住同一 `cancellation_id` 的最大世代列**
   (`SELECT … FOR UPDATE`)並驗:它是 `generation = NEW.generation - 1`(**直接前代**)、
   `status = 'dead'`、`resolution = 'retry_authorized'`、`retry_consumed_at IS NULL`;
   **同交易戳 `retry_consumed_at`**(原子消耗)。否則 `RAISE`。
   ⇒ 這才是擋住「先後兩次退款」的那道門;四道唯一性只擋同時。

### 5.2 `BEFORE UPDATE`
1. `OLD.status → NEW.status` 必須命中 §3.1 的 E1-E13 之一,**含該列的額外條件**
2. **終態不可轉出**:`completed` 之後任何欄位都不准改
3. **`dead` 只允許 E13**(結案),且 `OLD.reviewed_at IS NULL`(**Q3=B 的 CAS 條件**)
4. **不可變欄位**:`cancellation_id` / `order_id` / `generation` / `rec_trade_id` /
   `bank_refund_id` / `payload_hash` / `refund_amount` / 所有帳本快照欄 /
   `refunded_before`(一旦非 NULL)/ `tappay_refund_id`(一旦非 NULL)—— 改了就是換一筆退款
5. **計數器逐 edge 寫死**(K1 M16):`retry_count` 只在 E5 +1、只在 E7 驗 = 6;
   `check_fail_count` 只在 E10 歸 0 或 +1、只在 E12 驗 = 6;**其餘 edge 不得改動兩者**
6. `updated_at := now()`

### 5.3 `BEFORE DELETE` / `BEFORE TRUNCATE`(🔴 K1 M8)
**永久阻擋,不留逃生門**(同 A7-t 拍板 Q2=A 的處理)。
理由:表級 ACL 擋不住 **owner 與 SECURITY DEFINER RPC** ——
歷史一被清,四道唯一索引就**不再擋重退**。驗收必須證明 **owner 路徑也失敗**。

### 5.4 🔴 能力邊界(明文,不得在任何地方宣稱超出;K1 M14)
trigger **看得到**:狀態圖、本地欄位、同表其他列(可鎖)。
trigger **看不到**:TapPay Refund 是否真的成功、Record 的累計是 `< / = / >` target、
baseline 是不是真的來自 API、呼叫者以為自己持有哪一把 token。
⇒ **token CAS 是 worker 的 `WHERE claim_token = $1` 的責任**,不是 trigger 的。
⇒ 這些必須在**第 3 批 worker 的驗收**裡被證明,本片不得代為宣稱。

### 5.5 `RAISE` 的形狀(🔴 K1 M32)
「負測一律斷言 SQLSTATE + `CONSTRAINT_NAME`」這條紀律在 trigger 上**會失效** ——
普通 `RAISE EXCEPTION` 的 `CONSTRAINT_NAME` 是空的。
⇒ 本片所有 trigger 的 `RAISE` 一律帶 **`USING ERRCODE = '<自訂>'`, `CONSTRAINT = '<具名>'`**,
探針才驗得到「紅在指定的那一條」。

---

## §6 R9-R19 關閉矩陣(K1 M2:v1 把它們寫成文字就算數)

| 規格 | 內容 | 由誰關閉 | 驗收落點 |
|---|---|---|---|
| R9 | baseline 初始化 + job↔ledger 等值 | A7b-T(E2/E4)+ 第 3 批 worker | 探針 E2/E4;等值由 §5.2-4 不可變 + U5 |
| R10 | `reconciling` 獨立相位 | A7b-T(E8/E11) | 探針「`reconciling → processing` 必拒」 |
| R11 | `failed` 不在 `submitted` 之後 | A7b-T(轉移表無此 edge) | 探針「`submitted → failed` 必拒」 |
| R12 | reclaim 轉移寫死 + `check_fail_count` 入 schema | A7b-M + A7b-T(E11) | 探針 E11;CHECK 0-6 |
| R13 | 成功歸零 / 異常 +1 / 帶 CAS 寫入 | A7b-T(E10)+ worker | 探針 E10 兩向;CAS 屬 worker |
| R14 | Record 三路寫死 | **第 3 批 worker** | 🔴 本片只提供 `refunded_target` 與三個出口 edge |
| R15 | durable 告警 + LINE 失敗重發 | **第 3 批**(release gate) | 🔴 本片只在 COMMENT 記契約債 |
| R16 | 結案 RPC 鎖 + 稽核 | **Q3=B 改為鎖列 + `reviewed_at IS NULL` CAS** | A7b-T §5.2-3;RPC 在第 3 批 |
| R17 | 世代式 + one-current partial unique | A7b-M(U1/U2)+ A7b-T §5.1 | INSERT 守門探針 |
| R18 | `resolution` 三值分流 | A7b-M(CHECK)+ A7b-T §5.1 | 三條負測(見 §7) |
| R19 | 原子消耗授權 | **A7b-T §5.1**(不是「RPC 之後再說」) | 三條負測 + 兩 session 併發重開 |

---

## §7 驗收

沿用 A1 已證明有效的骨架,並**繼承 A1 與 A7-t 踩過的每一個坑**:
外層 oracle 存 shell 側 / `snapshot()` fail-closed(驗 psql 退出碼 + stderr + sentinel)/
harness 自我測試(故意弄壞快照 SQL 必須當場中止)/ 結構與行為突變分開跑 /
每個 mutant 指定唯一預期第一失敗 ID / 對照組必跑。

### 7.1 承接 A7-t 已實證的七條假綠路徑(K1 M31,本片核心是 trigger ⇒ 必做)
`tgenabled`(DISABLE / ENABLE REPLICA)、`tgqual`(`WHEN (false)`)、`tgrelid`(綁錯表)、
`tgfoid` vs `regprocedure`(同名異 schema no-op)、**函式本體 `md5(prosrc)` 指紋**
(擋「保留關鍵字但邏輯反了」)、owner、**完整 ACL allowlist**;
函式一律 `CREATE`(不用 `OR REPLACE`,避免保留舊 owner/ACL)。

### 7.2 一對一矩陣(K1 M30:不得只說「每條 CHECK 都有突變」)
逐條列 **constraint ID → 正向前提 → 負向資料 → 指定 SQLSTATE/CONSTRAINT_NAME → 對應 mutant**,
覆蓋 `generation`、`bank_refund_id` 長度、`payload_hash` 形狀、baseline 成對、
`failed`/`dead`/review 的逐狀態 CASE、兩個計數器上下界、四道唯一性、兩道複合 FK。

### 7.3 探針設計紀律(K1 M26/M27/M28/M29)
- **U2 與 U3 必須分開構造**:U2 用「同 cancellation、**不同** rec_trade_id」,
  U3 用「**不同** cancellation、同 rec_trade_id」。否則兩者會先紅在同一個索引,
  **刪掉另一個索引仍全綠**
- **轉移探針先建出「除了那條 edge 之外全部合法」的列形狀**,再斷言指定 trigger ID。
  否則移除 `submitted→processing` 守門後,會因為缺 lease 欄而紅在 CHECK = 紅在錯的地方
- **不可變欄位與計數器的突變要夾在合法 edge 裡測**(例如 `processing→failed` 同時跳 count),
  否則會先被「該狀態不准自轉」擋掉
- 🔴 **刪掉 v1 那條「直接 INSERT `generation+1` 應成功」的正向驗收** ——
  它只證明 partial unique 放行,**反而替重退破口背書**。改由 §5.1 的 INSERT 守門驗收

### 7.4 必做負測(每條都是一種「退第二次錢」)
1. `INSERT status='completed'` 直接建 → 拒(§5.1)
2. `INSERT generation=2` 而前代不是 dead → 拒
3. 前代 `resolution='external_refund_confirmed'` 仍開新世代 → 拒
4. 前代 `resolution='over_refund_writeoff'` 仍開新世代 → 拒
5. **舊授權隔代重用開 gen3** → 拒
6. **兩 session 併發重開**,只准一個成功
7. `submitted → processing` / `reconciling → processing` / `submitted → failed` → 拒
8. `completed` 轉出 → 拒
9. `dead → queued` → 拒
10. **單獨寫 `reviewed_at`** → 拒;**已結案的 dead 再結一次**(`OLD.reviewed_at` 非 NULL)→ 拒
11. **未持久化 baseline 就 `processing → submitted`** → 拒
12. 未複核的 dead 仍擋得住同 cancellation / 同 rec_trade_id 的新 job(兩個獨立案例)
13. **DELETE / TRUNCATE 一律拒,含 owner 身分**
14. 兩個 job 指向同一 `refund_id` → 拒(U5)
15. **正向**:`queued→processing→(baseline)→submitted→reconciling→completed` 全鏈可走

---

## §8 誠實邊界(先寫,不等審查逼)
- 本機 PG17.10 非 Supabase;`auth.uid()` 是 shim
- **trigger 不保證 fencing**(§5.4 明文);token CAS 屬 worker,第 3 批才被證明
- **本片零 TapPay 接觸**:「隔日生效」「Record 三路」全是合約文字,正確性要等第 3 批對真 API 驗
- **A7b-M 單獨存在時該表可被亂寫**(§1)—— 靠「兩片同批 apply + 此前無 writer」緩解,不是靠防護
- `reviewed_by` 在 E8-B 上線前**只是操作者自陳,不是已驗證身分**(K1 M23)

## §9 27 項綠燈宣稱
**兩片皆不宣稱任何項變綠**(原則 4)。第 19 項的退款面在第 3 批。

## §10 Migration 骨架 / rollback / rollout(K1 M25)
- 兩支皆:顯式 `BEGIN;` + `SET LOCAL lock_timeout='5s'` + `statement_timeout='60s'` + `COMMIT;`
  (D0-1 拍板:照舊寫法,不得順手改)
- 結尾各自 fail-closed 結構驗收 DO block,斷言帶機器可辨識 ID
- **rollback**:兩表皆 `DROP TABLE`(**不加 CASCADE**)+ 依賴 preflight(`pg_depend`);
  🔴 **只允許在第一個 writer(第 3 批 worker)之前**;之後只能 forward repair,
  且該程序**列為第 3 批 worker 片的 DoD 硬前置**(同 A1 對 A4a 的處理)
- **rollout**:承 Q1=A —— A7-t 單獨 apply → read-back → A1 → read-back → 本兩片**同批**;
  每次 `db push` 前先 `--dry-run` 對 pending 清單;
  失敗時做 **ledger / schema / 資料三方狀態矩陣**,`schema 有 + ledger 無` ⇒ 修 ledger、**不得重跑**

## §11 開工前仍待 Sean 的(不擋寫 code,擋 apply)
- 無。§0 四題已拍完。第 3 批的「退款線兩題」(混合收款退款分軌 / partiallyPaid 應退額語意)
  是**第 3 批開批閘**,本片不受阻;但若那兩題的答案與本合約衝突,需回頭改。

## §12 折入紀錄
- **K1(codex 關卡1,2026-07-31)= FAIL,約 35 must-fix + 5 nit** —— 逐字 `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`。
  **本 v2 已依 Sean 四拍板 + 全部 findings 重寫**;駁回 0。
  最重的四條(會直接退第二次錢)分別由 §5.1(INSERT 守門)、§4.4(review 四欄鐵律)、
  §5.1-2(原子消耗)、§5.3(DELETE/TRUNCATE 阻擋)關閉。
