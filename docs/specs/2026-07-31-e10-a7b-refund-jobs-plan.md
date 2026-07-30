# E10 第 1 批 · A7b「退款工作表 + 狀態機合約」片級 plan v1

> 🛑🛑 **本版經 codex 關卡1 判定 FAIL、不可施工**(2026-07-31 清晨)。
> findings 逐字保存 = `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`(**約 35 must-fix + 5 nit**)。
> **在 plan v2 寫出來之前,任何人不得依本檔動工。**
>
> **本輪抓到的、會直接造成「退第二次錢」的四條**(不是文件瑕疵,是設計漏洞):
> 1. **trigger 只有 `BEFORE UPDATE`** ⇒ 可以直接 `INSERT status='completed'/'submitted'`,整個七態轉移形同虛設
> 2. **`reviewed_at` 可以單獨寫入**(甚至夾在 `processing→processing` 裡)⇒ U2/U3 的
>    `reviewed_at IS NULL` 當場失效 ⇒ 放行第二個 active job
> 3. **三道唯一性只擋「同時」、擋不住「先後」** ⇒ `completed` 之後直接插 `generation+1` 全部通過
> 4. **表級 ACL 擋不住 owner / SECURITY DEFINER 的 DELETE / TRUNCATE** ⇒ 歷史一被清,唯一索引就不再擋重退
>
> **另有三題必須 Sean 拍板才能寫 v2**(見 §11)。


> 真權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.1 row 25(A7b)+ §5.0 DAG。
> 片型 = **高風險片**(鐵則 12 ①錢 + ③DB 結構)⇒ 關卡1 + 關卡2 皆跑 codex,不降級。
> 鐵則 8:master plan v2 已由 Sean 2026-07-29 最終批准,本片在該授權範圍內。
> Migration 版本號 = `20260731120000`。
> 🔴 **本片是 schema + 合約,worker 在第 3 批**。本片之後這張表**沒有任何 writer**。

---

## §1 這片在做什麼

建 `public.order_refund_jobs` —— **卡片退款的工作表**:一次要退的錢變成一列 job,
由第 3 批的 worker 拿去打 TapPay、隔日對帳、最後寫進既有的 `order_refunds` 帳本。

**本片交付的是「規則」不是「行為」**:欄位、七個狀態、所有合法轉移、三道唯一性、
lease 與 fencing 的欄位基礎、以及**把非法轉移在 DB 層擋死的 trigger**。
worker 照這份合約寫,不得另立。

### 1.1 為什麼需要一張工作表(而不是 worker 直接打 TapPay)
TapPay 的退款**隔日才生效**(`docs/reference/tappay-reference.md:100`):Refund API 回 status 0
只代表「已送出」,不代表錢退了。⇒ 送出與確認之間必須有一個**可持久化、可重入、可對帳**的中間狀態,
否則 crash 或重試會變成「退兩次錢」。

---

## §2 範圍界線

**做**:建表 + 三道唯一性 + 狀態一致性 CHECK + **轉移守門 trigger** + ACL + COMMENT 契約。
**不做**(碰到就是越界):
- ❌ worker、排程、任何 TapPay 呼叫(第 3 批)
- ❌ enqueue RPC(第 3 批 A8b)
- ❌ 人工結案 RPC(第 3 批 R 片)
- ❌ 不碰 `order_refunds` / `order_cancellations` / `orders` 既有結構
- ❌ **不加 enum type**:`ALTER TYPE … ADD VALUE` 不可逆、且新值不能同交易使用
  (memory `project_m3-rf2a2-refund-ledger-decisions` 實錘)⇒ 一律 `text` + `CHECK`,同 `order_refunds` 先例

---

## §3 狀態機(七態)

```
queued ──claim──▶ processing ──送出成功──▶ submitted ──claim──▶ reconciling
   ▲                   │                                            │
   │                   └──送出失敗──▶ failed ──backoff──┐            ├─ 累計 = target ─▶ completed(終態)
   └───────────────────────────────────────────────────┘            ├─ 累計 < target ─▶ submitted(順延)
                                                                    └─ 累計 > target ─▶ dead(終態,人工)
   retry ≥ 6 ─▶ dead                       reconciling crash ─▶(lease 過期)─▶ reconciling(重領)
```

### 3.1 逐條轉移(合約,trigger 逐條擋)
| 從 | 到 | 條件 |
|---|---|---|
| `queued` | `processing` | claim,產新 `claim_token` |
| `processing` | `submitted` | Refund API 回成功;**帶 token CAS** |
| `processing` | `failed` | Refund API 回失敗;**帶 token CAS** |
| `processing` | `processing` | lease 過期重領(產新 token,舊 token 作廢) |
| `failed` | `queued` | backoff `5min × 2^retry` |
| `failed` | `dead` | `retry_count ≥ 6`(原子) |
| `submitted` | `reconciling` | 隔日 reconciler claim(**獨立相位**) |
| `reconciling` | `completed` | 累計 **=** `refunded_target`;同交易寫 `order_refunds` + 回填 `refund_id` |
| `reconciling` | `submitted` | 累計 **<** target,或 Record 查詢異常 ⇒ 順延 `next_check_at` |
| `reconciling` | `dead` | 累計 **>** target(超退),或 `check_fail_count` 達 6 |
| `reconciling` | `reconciling` | lease 過期重領(**永不回 `processing`**) |
| `dead` | — | 終態。重退 = 開 `generation + 1` 的**新列** |
| `completed` | — | 終態 |

🔴 **`failed` 在 `submitted` 之後永不出現**(master plan R11):
走 `failed → queued` 會繞回送款相、重呼 Refund = **退第二次錢**。
⇒ 送出之後的所有異常一律走 `submitted ⇄ reconciling` 或 `dead`,**不得回到 `processing`**。

🔴 **為什麼 `reconciling` 要獨立於 `processing`**(R10):兩者都是「被某個 worker 持有中」,
但**該呼叫的 API 不同**(Refund vs Record)。若共用 `processing`,lease 過期重領時
**無法辨識這一列該做哪件事** ⇒ 可能重送退款。狀態本身就是那個辨識。

---

## §4 表定義

```sql
CREATE TABLE public.order_refund_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  cancellation_id    uuid    NOT NULL REFERENCES public.order_cancellations(id),
  generation         integer NOT NULL DEFAULT 1 CHECK (generation >= 1),

  -- 冪等與外部識別
  rec_trade_id       text    NOT NULL CHECK (btrim(rec_trade_id) <> ''),
  bank_refund_id     text    NOT NULL CHECK (char_length(bank_refund_id) BETWEEN 1 AND 20),
  payload_hash       varchar NOT NULL CHECK (char_length(payload_hash) = 64),

  -- 金額(整數元;禁浮點)
  refund_amount      integer NOT NULL CHECK (refund_amount > 0),
  refunded_before    integer          CHECK (refunded_before >= 0),
  refunded_target    integer          CHECK (refunded_target  >  0),

  status             text    NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','processing','submitted','reconciling',
                                         'completed','failed','dead')),

  -- lease / fencing
  claim_token        uuid,
  claimed_at         timestamptz,
  claim_expires_at   timestamptz,

  -- 重試與對帳排程
  retry_count        integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 6),
  next_retry_at      timestamptz,
  next_check_at      timestamptz,
  check_fail_count   integer NOT NULL DEFAULT 0 CHECK (check_fail_count BETWEEN 0 AND 6),
  failed_reason      text,

  -- 人工結案
  manual_review_required boolean NOT NULL DEFAULT false,
  reviewed_at            timestamptz,
  reviewed_by            text,
  resolution             text CHECK (resolution IN
                           ('retry_authorized','external_refund_confirmed','over_refund_writeoff')),
  retry_consumed_at      timestamptz,

  -- 帳本落點(completed 時回填)
  refund_id          uuid REFERENCES public.order_refunds(id),

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

### 4.1 三道唯一性(每一道都對應一種「退兩次錢」)
| # | 約束 | 擋掉什麼 |
|---|---|---|
| U1 | `UNIQUE (cancellation_id, generation)` | 同一取消的同一世代重複建 job |
| U2 | **partial unique** `cancellation_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一取消**同時**有兩個未結案 job |
| U3 | **partial unique** `rec_trade_id WHERE status <> 'completed' AND reviewed_at IS NULL` | 同一筆 TapPay 交易同時有兩個 active job(兩個 job 讀同一 baseline ⇒ 累計越過兩個 target) |

🔴 **U3 為什麼要 `rec_trade_id NOT NULL`**:Postgres 的 partial unique **對 NULL 不生效**
⇒ 多筆 NULL 可並存 ⇒ U3 形同虛設。而沒有 `rec_trade_id` 的單本來就進不了卡片退款線
(純匯款退款走第 3 批的另一條線,不進本表)。
🔴 **U2/U3 的 `reviewed_at IS NULL`**(R16 修正):若排除條件寫成「排除 `dead`」,
**未複核的 dead 就不再擋同一筆交易的新 job** ⇒ 可能再退一次。
⇒ **`dead` 在人工結案(`reviewed_at` 寫入)前一律視為 active**。

### 4.2 狀態一致性 CHECK(每個狀態該有什麼、不該有什麼)
- `completed` ⟺ `refund_id IS NOT NULL`
- `failed` ⇒ `failed_reason` 非空白
- `dead` ⇒ `manual_review_required = true`
- 持有中(`processing` / `reconciling`)⟺ `claim_token`、`claimed_at`、`claim_expires_at` 三者皆非 NULL
- 非持有中 ⇒ 三者皆 NULL(**避免舊 token 殘留被誤用**)
- `resolution IS NOT NULL` ⇒ `reviewed_at IS NOT NULL`(結案理由不能沒有結案時間)
- `retry_consumed_at IS NOT NULL` ⇒ `resolution = 'retry_authorized'`(只有這個理由能開下一代)
- `refunded_target IS NOT NULL` ⇒ `refunded_target = refunded_before + refund_amount`

### 4.3 世代式重開的原子消耗(R18/R19)
結案必填 `resolution`;**只有 `retry_authorized` 允許開下一代**。
開下一代 = enqueue RPC(第 3 批)**原子消耗**最大世代的授權:
鎖該 cancellation 的最大世代列 → 驗 `dead` + `resolution='retry_authorized'` + **`retry_consumed_at IS NULL`**
→ 同交易建 `generation+1` 並戳 `retry_consumed_at`。
⇒ **舊世代授權不可隔代重用**。本片負責提供欄位與 CHECK,RPC 在第 3 批。

---

## §5 轉移守門 trigger(本片的核心防線)

🔴 **為什麼要 trigger 而不是「worker 自律」**:worker 在第 3 批才寫,而**這張表一旦有資料就是錢**。
把合法轉移寫進 DB,worker 有 bug 時是**寫不進去**,不是「退錯錢之後才發現」。
先例 = `order_refunds` 的「狀態 processing→confirmed/failed 由 trigger 強制、終態不可轉出」
(`20260725130100` COMMENT 逐字)。

`BEFORE UPDATE` trigger:
1. 依 §3.1 表逐條比對 `OLD.status → NEW.status`,不在表內 ⇒ `RAISE`
2. **終態不可轉出**:`OLD.status IN ('completed')` ⇒ 除了 `reviewed_*` 欄位外任何改動 `RAISE`
3. 🔴 **`dead` 只允許往「結案欄位」寫**(`reviewed_at` / `reviewed_by` / `resolution` /
   `retry_consumed_at` / `manual_review_required`),**status 不得離開 `dead`**
4. **不可變欄位**:`cancellation_id` / `generation` / `rec_trade_id` / `bank_refund_id` /
   `refund_amount` / `refunded_before` 一旦非 NULL 就不得再改(改了等於換一筆退款)
5. `retry_count` / `check_fail_count` **只能 +1 或歸 0**,不得任意設值

🔴 **本片刻意不做的**:trigger **不驗 token CAS**(那是 worker 的 `WHERE claim_token = $1`
的責任;trigger 看不到「呼叫者以為自己持有哪一把 token」)。
⇒ 這是**明文的能力邊界**,不得在 COMMENT 或 plan 裡宣稱 trigger 保證了 fencing。

---

## §6 ACL
```sql
ALTER TABLE public.order_refund_jobs ENABLE ROW LEVEL SECURITY;   -- zero policy
REVOKE ALL ON TABLE public.order_refund_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_refund_jobs TO service_role;
```
🔴 **客人零權限**:本表含 `rec_trade_id`、金額、失敗原因 —— 全是不該對客的。
🔴 ACL 驗收必須驗 **PG17 的八種**表級權限(含 `MAINTAIN`),且 **PUBLIC 檢查排在角色矩陣之前**
(A1 關卡2 的兩條實錘,直接沿用)。

---

## §7 驗收(`scripts/a7b-verify.sh` + `scripts/a7b-behavior-probe.sql`)

沿用 A1 已證明有效的骨架,並**繼承 A1 踩過的每一個坑**:
- 外層 oracle(constraint / ACL / trigger / **全 schema pg_proc**)存 shell 側,突變改不到
- **`assert_snapshot`**:任何當基準的查詢輸出先證明它本身有效(非空、不含 `ERROR:`)
- 結構突變逐條命中**指定** ID;行為突變**先剝掉結構驗收**再跑探針
- 負向探針一律斷言 **SQLSTATE + CONSTRAINT_NAME**
- 正向邊界案例(證明合法轉移不被誤擋)
- 探針自身突變

### 7.1 行為探針必含(每條都是一種「退兩次錢」)
1. `submitted → processing` 必須被拒(繞回送款相)
2. `reconciling → processing` 必須被拒
3. `completed` 轉出必須被拒
4. `dead → queued` 必須被拒(重退只能開新世代)
5. 同一 cancellation 兩個未結案 job ⇒ U2 拒
6. 同一 `rec_trade_id` 兩個 active job ⇒ U3 拒
7. **未複核的 `dead` 仍擋得住新 job**(U2/U3 的 `reviewed_at IS NULL` 條件)
8. 持有中狀態缺 `claim_token` ⇒ CHECK 拒
9. 非持有中狀態殘留 `claim_token` ⇒ CHECK 拒
10. `resolution = 'external_refund_confirmed'` 之後戳 `retry_consumed_at` ⇒ CHECK 拒
11. `retry_count` 從 0 直接設 6 ⇒ trigger 拒
12. 不可變欄位被改(`refund_amount`)⇒ trigger 拒
13. **正向**:`queued→processing→submitted→reconciling→completed` 全鏈可走
14. **正向**:`dead` + `retry_authorized` 結案後,`generation+1` 的新列建得起來

### 7.2 必做的突變(對應上面每一條)
每條 CHECK / 每條轉移規則各一條刪除突變,**必須紅在自己那條**。
🔴 另含 A1 學到的三類:①拿掉主鍵 ②非 public schema 偷加函式 ③FK 指向別 schema 同名表。

---

## §8 誠實邊界(先寫在這裡,不等審查逼出來)
- 本機 PG17.10 非 Supabase;`auth.uid()` 是 shim
- **trigger 不保證 fencing**(§5 明文);token CAS 是 worker 的責任,第 3 批才被證明
- **本片零 TapPay 接觸**;所有「隔日生效」「Record 三路」都只是**合約文字**,
  它們是否正確要等第 3 批 worker 對真 API 驗證
- 🔴 **A7-t 的併發債(#307)在本表同樣存在**:若日後有片要 DELETE/UPDATE
  `order_refund_items` 既有列,必須先補「鎖 parent + 隔離級 fail-closed 閘」

## §9 27 項綠燈宣稱
**本片不宣稱任何項變綠**(原則 4)。第 19 項的退款面在第 3 批。

## §10 開工前 Sean 待答(不擋寫 code,擋 apply)
1. 本片 migration 與 A1 / A7-t 的 apply 順序與批次(同 A1 §3.4 的 runbook 問題)
2. §8.6 的「退款線兩題」(混合收款退款分軌 / partiallyPaid 應退額語意)是**第 3 批開批閘**,
   本片不受阻,但合約若與那兩題衝突需回頭改 —— 先記在這裡


---

## §11 🛑 關卡1 之後新增:三題必須 Sean 拍板(不拍不能寫 v2)

### Q1 — A7b 要不要拆成兩片?
codex 指出本片被標 **M 片**(schema),卻把 trigger 當核心交付,**違反 repo 既有的片型慣例**
(M = 零行為;trigger 屬 T 片)。這是切片結構變更 ⇒ 依鐵則 8 需要你批准。
- **A(建議)**:拆成 **A7b-M**(表 + CHECK + 索引 + ACL)與 **A7b-T**(四支守門 trigger + 行為測試)。
  好處:與 A7-1 / A7-2 / A7-t 的既有做法一致,每片可獨立驗收、獨立回滾。
  代價:多一片、多一次審查。
- **B**:維持單片,並在 master plan 明文記「本片是 M+T 合併的例外」。
  好處:省一輪。代價:破壞慣例,之後每個人都會問「為什麼這片可以」。

### Q2 — 人工結案的併發控制怎麼做?
🔴 **兩份合約現在打架**:master plan 要求人工結案 RPC 走 **token CAS**,
但本 plan 要求 `dead` 狀態的 `claim_token` **必須是 NULL**(避免舊 token 殘留被誤用)。
兩者無法同時成立,**這題不拍板就會在施工時被迫亂猜**。
- **A**:新增獨立的 `review_token` / `review_version` 欄,結案走它的 CAS(與 worker 的 lease 完全分開)
- **B**:改成「鎖列 + `reviewed_at IS NULL` 當 CAS 條件」,master plan 的 token CAS 字面改掉

### Q3 — 退款帳本需要的快照放哪?
隔日對帳成功時要**同交易寫進既有的 `order_refunds`**,而那張表有一組必填欄
(品項金額、運費前後、`actor`、`reason`、`request_id`…)。本 plan **整組漏掉了**。
- **A**:job 表加一組快照欄(enqueue 當下凍結,不可變)
- **B**:另開一張 `order_refund_job_items` 子表(對齊 A7 的 header/items 形狀)
- **C**:隔日再重算 —— 🔴 **我不建議**:重算的前提(運費規則、品項金額)可能已經變了,
  等於讓「退多少錢」在兩個時間點各算一次

---

## §12 折入紀錄
- **R1(codex 關卡1,2026-07-31)= FAIL,約 35 must-fix + 5 nit**,逐字 = `docs/reviews/2026-07-31-e10-a7b-k1-codex.md`。
  **尚未折入** —— 需先由 Sean 回答 §11 三題,才能決定 v2 的片型與欄位形狀。
