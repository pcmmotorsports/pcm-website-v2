# L5b-2 補償退款寫入路徑 — 片級 plan **v8**

> P 窗五代 / 2026-08-11。**v8 = 折關卡1 R5(Fable 窄審修法面)的 1 must-fix + 2 consider + 3 nit** ⇒ **審查者明判收斂、不開 R6**;v7 = 折 R4 的 3 條(換角度:advisory 解本身 / 第四方 / 中間態 / 災難當天可用性 / 拍板≠可行性)。
> 演進:v2(FAIL)→ v3(核心點 1 已交付、換骨架)→ v4(折 R1 的 21 條)→ **R2 FAIL 20 判停上決策題**
> → **Sean Q8=A** → v5 → **R3 FAIL 12**(全新、非方向問題)→ v6 → **R4 換模型(Fable)FAIL 3**(F1 打穿一條前四輪都沒看出的紙上做法)→ v7 → **R5 窄 FAIL 1**(MF1:守門在 house 的 rollback 慣例下會被滾過去)→ **v8 = 收斂版**。
>
> **Q8=A 逐字**:同批修那兩支已上線金流 RPC(員工手動退款 `admin_initiate_order_refund`、
> 員工手動結案 `close_released_attempt`),**三方走同一序列化點(advisory lock、不改邏輯述詞)**。
> ⇒ R2 那 4 條卡在「動已上線 RPC」的 finding,**解法選項**因此解封(`:223` / `:236` / `:256` / `:212`)。
> 🔴 **「解封」= 這些做法現在准做,不等於它們可行** —— **Q8 批准的是範圍,不是技術正確性**。
> 可行性**逐條自證**,見 §3a-4 ~ §3a-11。(R3 `:9` 打中本檔 v5 的原句,已改;
> 而那正是我在 R3 prompt 裡親手設的角度④「有沒有把拍板當技術背書」—— 我自己就是那個案例。)
>
> v1/v2/v3/v4 的錯誤記在 §9(不刪除,供追線)。
> 🔴 **v4 的落筆紀律多一條(v3 的教訓)**:每個「**做法**」在寫下之前,要在**現實**裡走一遍 ——
> **PG 允不允許 / 現有 ACL 呼不呼得到 / 與既有鎖序相不相容**。
> v3 只檢查了「引用正不正確」,結構面因此被打穿 21 條,**其中兩條的反證躺在我自己引用過的檔案裡**。
>
> **上游真權威**
> ① 母 plan `2026-08-09-l4-l5-settlement-compensation-plan.md` §3.2/§4/§5(Sean P-251-A 全裁)
> ② L5b 設計 `2026-08-10-l5b-compensation-refund-plan.md`(Sean 四點拍板)
> ③ L5b-1 migration `20260810140000`(**已 apply 正式庫**;兩表上線、空表、**零寫入者**)
> ④ 🆕 L5b-0 全鏈 `20260810170000`(-m 三閘)+ `20260810220000`(-s 四函式)(**已 commit、未 apply**)
>
> 片型=**高風險片**(鐵則 12 ①錢 ③DB 結構)。
>
> ## 🔴 落筆紀律(v1 在這條上犯四次、v2 仍犯一次,維持機械步驟)
> 本檔每一句「X 已經是 Y」必須附 `檔案:行號`,**且那一行要是計算本體** ——
> 不是欄位宣告、不是鄰近註解、不是欄位名。附不出來就寫「未確認」。

---

## 0. 這片做什麼(一句話)

L5b-1 建了兩張表但**零寫入端**。這片補上**唯一的寫入路徑**,並把「什麼時候該自動退錢」做完。

**為什麼現在非做不可(v3 新增,這是 L5b-0 交接給我的)**:
L5b-0-s 的檔頭逐字寫著它的射程 —— `20260810220000:72-73`:
「本片只改「誰會被 claim、誰會被標、誰會被算」,**不動任何錢的狀態**;
它讓事故**被看見**,不讓事故**被修好**——修好是 L5b-2(退款)。」
⇒ L5b-0 上線後,被讓路那族會**準時堆進人工待確認**,而且 `20260810220000:81-82` 逐字認列
「本 use-case 無 per-anomaly 去重(刻意)⇒ 被標人工那族**每輪 cron 重推同一個數字**,
**自動出口要等 L5b-2**」。⇒ **沒有這片,L5b-0 交付的是一個會持續叫、沒人能讓它閉嘴的告警。**

### 0a. 硬約束三條(繼承自實查,不重新發明)

**① writer 一律一次插一列**,不得依賴同 statement 建鏈。
L5b-1 防環守門要求「前手在插入當下看得見」,而 `INSERT … SELECT` 與 data-modifying CTE 的
列處理順序 PG 不保證 ⇒ 合法的鏈可能被誤擋 `P5B02`(fail-closed、不誤退,但會卡住)。
🔴 驗收**不是**「突變成 `INSERT … SELECT` 必紅」(順序不保證 ⇒ 不穩定測試)。
**改成 round-trip 不變量:一次 writer 呼叫只能新增恰一個父列。**
要殺防環守門本身,用**結果確定的互指環**(L5b-1 harness 的 `G-NO-CYCLE` 已在做)。

**② Σ 超退上界一律讀 TapPay Record,不得讀本地加總。**
可退額權威 = `record.amount`,計算本體 `apps/admin/src/lib/payment/refund-baseline.ts:111`
(`recordAmount: record.amount`),語意見 `:32` 逐字「Record `amount` = TapPay **剩餘可退額**(會隨退款遞減)」。

**③ 冪等鍵沿用既有產號式子,不自己發明、不加前綴。**
全 repo 唯一產號處 = `20260803150000:545`
`v_brid := substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', 'ab'), 1, 20);`
(🔴 逐字含 **`extensions.`** schema 限定 —— v2 抄成裸 `gen_random_bytes` ⇒ 照抄會在 `search_path=''` 的 SECDEF 裡直接找不到函式)
= 恰 20 字、熵 ≥90-bit、零前綴。總長 20 是 TapPay 硬限
(形狀 CHECK 已在表上:`20260810140000` `pr_idem_key_shape_chk`,逐字對齊
`TapPayChargeAdapter.ts:68` 的 `/^[A-Za-z0-9_-]{1,20}$/`)⇒ **加前綴等於直接砍熵。**

### 0b. 現況前提(每條附計算本體)
- 讓路標記:`payment_charge_attempts.superseded_at / _reason / _by_order_id`(`20260809230000:109-111`)。
- 🔴 **本片不得寫 `superseded_*`**:L5a-1 harness 斷言「public 函式面恰一個本體含 `superseded_`」。
  **射程有限**(`20260809230000:29-34` 自己寫明):擋不住跨 schema 函式、trigger、動態 SQL、
  owner 或 migration 直接 UPDATE,且**沒掛 CI**。⇒ 正確說法是
  「目前 repo 搜尋只找到一個 writer(L5a-1),且該斷言只涵蓋 public 函式面」。
- `refund()` 已實作:`packages/adapters/src/tappay/TapPayChargeAdapter.ts:241`。
- 🔴 **claim RPC 回傳形狀仍然沒有 `superseded_at`**:`20260810220000:210` 逐字
  `RETURNS TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer)`。
  ⚠️ **L5b-0-s 改了述詞、沒改回傳** —— 這兩件事很容易混講,見 §2 的 2a-1。

---

## 1. 核心點

### 核心點 1 · 補償與「確認收款」如何互斥 —— ✅ **已交付,不再是決策題**

**v2 把這題掛成 ⛔ 阻擋洞。它已經關了。**
Sean 2026-08-10 拍板,逐字記在 `20260810170000:8-9`:
「Q1=A:`mark_charge_attempt_charged` **原子拒絕** superseded ——『被讓路的 attempt 永不准確認成收款、
**唯一出口=退款**』。B 案(10 個呼叫端各自加閘)否決。」
同日 `§1-OPEN=A` 再擴一支(`:10-12`):閘同時畫進 `confirm_order_payment`,
因為閘一擋不住「非 3DS 的 confirmPayment 在 markCharged 失敗時**刻意續走**」那條路。

**已交付內容(commit 完成、**未 apply**)**

| 物件 | 位置 | 角色 |
|---|---|---|
| 閘一 `mark_charge_attempt_charged` | `20260810170000` | 麵包屑(拍板逐字指定) |
| 閘二 `mark_charge_attempt_charged_fallback` | 同上 | 備軌(它只擋 `status='pending'`,對 **pending+superseded** 原本無守門) |
| 閘三 `confirm_order_payment` | 同上 | **錢的歸屬**;閘一擋不住的那條路由它擋 |
| 掃描四支(claim / retry / ceiling / alert) | `20260810220000` | 讓被讓路那族回到 manual/ceiling 閘、進得了告警計數 |

驗收:`scripts/l5b0-verify.sh`(13 格 + 10 突變)+ `scripts/l5b0t2-verify.sh`(5 格 + 2 突變)
+ `scripts/l5b0t3-adapter-e2e.ts`(adapter→真 DB 三格),**已收編 w7 覆蓋帳、全量 39/0**。

🔴 **對本片的三個後果**
1. **不需要在 use-case 層做互斥** —— 守門在 DB、A1+A2 全部入口自動涵蓋(附錄 A)。
2. **「唯一出口=退款」是拍板逐字** ⇒ 本片不是「可選的優化」,是那句話的**兌現端**。
3. 🔴 **能力天花板照抄,不放大**(`20260810170000:29-32`):保證的準確說法是
   「**經由這三支 RPC 的路徑**不會認列讓路款」,**不是 DB 全域不變量**。
   繞得過的:owner/postgres 直接 UPDATE、未來新增的 SECDEF 函式、psql 手動修資料。

### 核心點 2 · 什麼條件才准自動退錢(誤退防線)

母 plan §3.2:「條件必須極嚴,寧可漏退也不可誤退;誤退比雙扣更糟」。
§5-5 指定:「沒有 durable 標記但後來轉 AUTH 的 attempt **不得**被退」= 本片最重要的一條測試。

**照抄既有身分閘,逐條列成合取條件(全部成立才退)**

| # | 條件 | 既有計算本體(照抄,不重寫) |
|---|---|---|
| 1 | `superseded_at IS NOT NULL`(durable 標記;**不能只看 `status='released'`** —— preflight release CAS 也產生 released,母 plan §6 明列未涵蓋) | — |
| 2 | Record 查詢成功:`queryStatus ∈ {0,2}` | `refund-baseline.ts:54` |
| 3 | **恰一筆**:`numberOfTransactions === 1` **且** `records.length === 1` | `refund-baseline.ts:62` |
| 4 | `recTradeId` **等於目標**(送錯 rec = 退到別人的交易) | `refund-baseline.ts:75` |
| 5 | 幣別必須 TWD **且必須有值** | `refund-baseline.ts:84` 🔴 **v4 收緊**:既有本體是「有值才比、缺欄放行」,那是**admin 有人在看**的情境下的寬容。本片是**無人自動退錢** ⇒ 缺 `currency` 還用 TWD 語意送款與 §0/母 plan 的 fail-closed 前提直接衝突。**本片不沿用那個寬容**,差異寫進 2b COMMENT |
| 6 | `record_status ∈ {0,1,2}` | `refund-baseline.ts:92`(allowlist 本體 `:27`) |
| 7 | `refunded_amount` 欄存在(**嚴禁 `?? 0`**) | `refund-baseline.ts:100` |
| 8 | 尚有可退額:`record.amount !== 0` | `refund-baseline.ts:108` |
| 9 | 強識別可得(`strong_key`);弱識別 ⇒ fail-closed 不退 | `20260810140000` `strong_key` NOT NULL |
| 10 | 該 attempt **無未結案 refund**(父列存在、事件表無 terminal)⇒ 有的話先 `reconcile` | 本片新增,見核心點 5 |

#### 🔴 v4 補三條:十條**擋不住「錯綁到別單」**(關卡1 `:102`,親驗成立)

Record DTO **本來就帶**這三個欄,而十條一個都沒用:
`orderNumber`(`TapPayChargeAdapter.ts:74`)/ `bankTransactionId`(`:75`)/ `originalAmount`(`:79`)。

| # | 補的條件 | 為什麼 |
|---|---|---|
| 11 | `record.orderNumber` **等於**本 attempt 的 `order_id` | `order_number` 逐字就是「TapPay 訂單識別欄」(`:106` 的 WebFetch 核實註解、`:109` 送出處)⇒ 不比對 = 允許退到別單 |
| 12 | 有 `bankTransactionId` 時必須**與 attempt 記錄的相符** | 3DS 路徑的 bank_txn 在 charge **前**就 durable ⇒ 這條在主軌上恆可得 |
| 13 | `record.originalAmount` **等於**該單應收 | 授權額對不上 = 這顆 Record 根本不是這張單的。⚠️ 它在 DTO 上是 **optional**(`TapPayChargeAdapter.ts:79` 的 `!== undefined ? … : undefined`)⇒ **缺欄不得放行**:落專屬理由碼 `record_original_amount_missing` 並**配自己的負測**,不得假設恆可得 |

🔴 **為什麼這三條非補不可**:條件 4 只比 `recTradeId`,而 `recTradeId` 是**我們自己存的**。
若本機那顆 rec **一開始就綁錯單**(寫入時綁錯、或人工修資料),條件 1-10 **全部通過**,錢退給別人的交易。
⇒ 這是「用本機資料驗本機資料」的典型盲區:**要有一個欄位是對方(TapPay)告訴我們的、且能反查回我們的單**。

#### 🔴 條件 3 的兩半會塌成一條(關卡1 `:108`,親驗成立)

`numberOfTransactions` **有合成路徑**:`TapPayChargeAdapter.ts:616` 用 `count` 填它,
而是否為對方真的回報由 **`numberOfTransactionsReported`**(`:552`)分辨。
⇒ 若不先驗 `numberOfTransactionsReported === true`,`numberOfTransactions !== 1` 與 `records.length !== 1`
**是同一個數字比兩次** ⇒ 一發突變證不了兩個子守門(它們不是兩道閘,是一道)。
**v4:條件 3 拆成 3a `numberOfTransactionsReported === true` / 3b 兩個計數各自為 1。**

#### 🔴 「拿掉任一條只紅一條」**不可滿足** —— 撤回這個驗收條件(關卡1 `:117`)

v3 寫「拿掉任一條 ⇒ 對應那條負測必紅、**且只紅那一條**」。**做不到,而且我早該看出來**:
- 拿掉條件 **10**(無未結案 refund)會同時打紅 未結案負測、重跑冪等、並發開根 **三格**;
- 拿掉條件 **1**(`superseded_at`)會同時打紅 專屬負測 與 §5-2 的誤退主測。
這不是測試沒寫好,是**這些守門本來就共用同一批觀察點** —— 硬要「只紅一條」只會逼人去砍測試。

**v4 改成可滿足的形狀**:
> 每條守門配一發突變,要求 **①該條的專屬負測必紅**,且 **②存在至少一格在拿掉別條時不紅**
> (= 證明它不是被別條嚴格蘊含)。**紅的總格數不設上限。**

🔴 **條件 4 與條件 9 的蘊含關係無法在本 plan 解決**(關卡1 `:114`):`strong_key` 值域未定
⇒ 若定義成 rec,條件 4 嚴格蘊含條件 9;若定義成 bank key,條件 4 的「目標 rec」又沒有來源。
⇒ **這是 2a-2 定死 `strong_key` 值域的硬前置的一部分**:值域定案後,**必須重跑本節的蘊含檢查**,
不能沿用本表。(§7 只寫「值域未定」是不夠的 —— 它讓人以為那只是文件缺口,實際上它決定兩條守門是不是同一條。)

🔴 **單位對齊(v3 新增,列為 2a-2 驗收條件)**:`payment_refunds.amount` 的註解逐字
「整數**元**(全庫慣例,非分);禁浮點」(`20260810140000` 欄註解),而 `record.amount` 的單位
**本檔未確認** ⇒ 2a-2 開工前必須以 TapPay 參考文件或一筆真 Record 實例定死,**不得靠推論**。
兩邊差 100 倍的 bug 在測試裡看起來只是「數字不一樣」。

### 核心點 3 · 跨線雙退 —— 收斂到「鎖 `orders` 列」,但**鎖型別我 v2 寫錯了**

admin 退款線流程:讀 Record baseline → RPC `initiateOrderRefund`(帳先記)→ 才打 API
(`apps/admin/src/lib/payment/refund-actions.ts:220-224`,`:220` 註解逐字
「⑦ RPC initiate(帳先記、後打 API;G3 凍結額:full=Record 剩餘額 / partial=員工輸入)。」
;`initiateOrderRefund(` 的呼叫本體在 `:224`。全流程摘要另見同檔 `:46`)。
⇒ 兩線**同時**讀到累計退款 0,各用不同 `bank_refund_id` 送出,TapPay 單鍵 at-most-once **完全擋不住**
—— 讀同一個 Record **不會序列化兩個並發讀者**。

**處置(Sean 拍板逐字:「跨線雙退=鎖 orders 列」,memory `project_l5b0-and-op5-five-decisions`)**
⇒ 取 **3-3**:兩邊 writer 都先鎖 `orders` 那一列(兩線都有 `order_id`、零新物件)。

#### 🔴 3a. 鎖型別:撤回 v2 的「只有 NKU 一種寫法」

v2 逐字寫「鎖型別**只有這一種寫法、不要用 `FOR UPDATE`**」= **超稱**,且與 repo 既有契約不一致。
實查後真正的契約分兩層:

| 對象 | 契約 | 計算本體 |
|---|---|---|
| `orders` 那道 | **`FOR UPDATE`** | OP5 `20260810200000:208`;A12 `20260810210000:128`。A12 檔頭 `:34` 逐字「`orders` 那道**沿用 OP5 的 `FOR UPDATE`**(兩支因此互相序列化;鎖在 INSERT **之前**取)」 |
| 被 INSERT 指到的 FK parent | **`FOR NO KEY UPDATE`** | A12 `20260810210000:135` 行末逐字「NKU 不是 FOR UPDATE,見檔頭的 a2b1 契約」;成因 `:30`「各持 `KEY SHARE` 再升 `FOR UPDATE` = 鎖升級死結(40P01 重現)」 |

**真判準**不是「一律 NKU」,是**「造成 KEY SHARE 的那個 INSERT 之前,就把強鎖取好,就不會有升級死結」**。

#### 🔴 3a-2. v3 的鎖序**會製造全庫第一個 `order→attempt`**(關卡1 R1 打中,已親驗為真)

v3 定案寫「① `orders FOR UPDATE` → ② `attempt FOR NO KEY UPDATE` → ③ INSERT」。**那是錯的**,而且錯得比「型別選錯」嚴重:

`20260624120010:25-27`(`close_released_attempt` 檔頭)逐字記著全庫的**無死結論證**:
> 「全庫唯一 `orders FOR UPDATE` 持有者 = `confirm_order_payment`(**orders-only、不鎖 attempt**);
> 其餘動 attempt 者(markCharged / markFailed〔R1b2 同 attempt→order〕/ sweeper SKIP LOCKED / S2b / release R1a3)
> 皆 **attempt-only 鎖或唯讀 orders** → **無 `order→attempt` 反向鎖序** → **無 A-B/B-A 死結**。」

⇒ 這整個論證的前提是「**沒有人同時鎖 orders 又鎖 attempt**」。v3 的鎖序**正好就是那個人** ——
它會與 `close_released_attempt`(`:24` 逐字 `attempt FOR UPDATE → order FOR UPDATE`)、R1b2、genesis
構成真正的 A-B/B-A。本 repo 對這個死結類別**已有案底**:genesis × begin 的 40P01 單方 victim,
`20260804120000:213` 記著 **Sean 2026-08-04 拍板接受、根治掛 backlog #321**。
⇒ 我不能一邊引用那條案底、一邊再開一個同類的新面。

#### ⛔ 3a-3. ~~v4 定案:不鎖 attempt 列;多根改用 partial unique index~~ **已於 R2 撤回,兩根支柱都被打掉**

> **這一整格是錯的,保留供追線。取代方案等 Sean 對 §6a 那題的裁示。**

v4 曾寫:「鎖 attempt **只為了**擋多根 ⇒ 改用 `CREATE UNIQUE INDEX pr_one_root_per_attempt
ON public.payment_refunds (attempt_id) WHERE supersedes_refund_id IS NULL;`,
writer 就只鎖 `orders`、**不製造 `order→attempt`**。」**兩句話各被一條實證打死**(關卡1 R2,我已親驗):

| v4 的話 | 打掉它的事實 | 證據 |
|---|---|---|
| 「不鎖 attempt ⇒ 不製造 `order→attempt`」 | **FK INSERT 仍會對 attempt 取 `KEY SHARE`**。而 `close_released_attempt` 持 attempt `FOR UPDATE` 再要 order ⇒ **`FOR UPDATE` 與 `KEY SHARE` 相衝** ⇒ 兩者互等,**死結原封不動** | PG 列鎖衝突矩陣;close 鎖序 `20260624120010:24` 逐字 `attempt FOR UPDATE → order FOR UPDATE` |
| 「一個 attempt 最多一個根」 | **違反已 apply 的 schema 契約** —— 合法的第二次**部分退款**會吃 `23505` | `20260810140000:59` 逐字「**部分退款多次 = 多條根鏈,各自帶自己的金額**(不是一條鏈上累加)」;母 plan `:186` 同字面 |

🔴 **`pr_one_root_per_attempt` 不得建。** 它不是「還沒驗證的想法」,是**已證為錯**:
建了它,系統就退不了第二次部分退款,而症狀會出現在**客服要退錢給客人的當下**。

🔴 **我怎麼錯的**(記在 §9-12):我把「重試鏈」當成 `payment_refunds` 唯一的多列來源,
於是推出「非根 ⇒ 必有 `supersedes_refund_id`」。**但多列還有第二個合法來源=多次部分退款**,
而那句話**就寫在我引用過的同一個檔案裡**(`:59`)。這是本份 plan 第三次同型錯誤:
**讀了那個檔、引用了那個檔、卻沒讀到旁邊那一行。**

**多根/併發要怎麼擋 ⇒ 等 §6a 的裁示**,本節不預設答案。

#### ✅ 3a-4. **v6 定案:三方共用 advisory 序列化點(v5 的形狀被 R3 打掉三處,已改)**

**拍板(Sean 2026-08-11 Q8=A)**:同批修那兩支已上線金流 RPC,三方走同一序列化點(advisory lock、不改**業務**邏輯與述詞)。
🔴 **Q8=A 解封的是「做法選項」,不是「這個做法可行」** —— 可行性**逐條自證**,本節每一格都要自己站得住(R3 `:9`)。

**三方**:①自動補償 writer(新)②`admin_initiate_order_refund`(已上線)③`close_released_attempt`(已上線)。

**鍵 = 每張單一條隊伍,64-bit**(R3 `:246`:`hashtext` 只有 **32-bit**,碰撞會讓**不相干訂單共用隊伍**、卡單波及無關單)
```sql
-- 由 order_id(uuid)直接取前 64 bit,不經 hashtext
PERFORM pg_catalog.pg_advisory_xact_lock(
  ('x' || pg_catalog.substr(pg_catalog.replace(v_order_id::text,'-',''),1,16))::bit(64)::bigint);
```
✅ **已實跑**(PG17.10):該式子回 `bigint`(例:`1229782938533638963`),`pg_advisory_xact_lock(bigint)` 可用。

#### 🔴 3a-5. 三方各自的取鎖位置 —— **② 與 ③ 不一樣,v5 把它們寫成一樣是錯的**

| 方 | 拿得到 `order_id` 的時機 | v6 取鎖位置 |
|---|---|---|
| ① 補償 writer | claim 回傳就有 | **第一個觸資料動作** |
| ② `admin_initiate_order_refund` | 參數就有 `p_order_id` | **既有冪等查驗之後、動錢之前**(見 §3a-6) |
| ③ `close_released_attempt` | 🔴 **只收 `attempt_id`,必須先讀才知道** | **無鎖 SELECT 讀 `order_id` → 取 advisory → 才走它既有的 `attempt FOR UPDATE`** |

🔴 **R3 `:249` 打掉了 v5 的「三方都取在第一個觸資料動作」** —— 對 ③ **物理上做不到**。
照 v5 字面(沿現況先 `FOR UPDATE` 再取 advisory)會構成
**「close 持 attempt 等 advisory / 補償持 advisory 等 attempt KEY SHARE」= 40P01**,死結原封不動。
**v6 修法**:③ 先做一次**不帶任何鎖的 `SELECT a.order_id`**,取得鍵後立刻取 advisory,**然後才**走它原本的 `FOR UPDATE`。
- **為什麼無鎖讀是安全的**:`payment_charge_attempts.order_id` 是建立時寫入的 FK,**全 repo 無任何 UPDATE 改它**
  ⇒ 讀到的值不會過期。✅ **R4 已實查成立**。
  ⚠️ **但這是「目前沒有人改」,不是「schema 禁止改」** —— 沒有 CHECK、沒有 trigger 擋 UPDATE
  ⇒ **射程 = 時點觀察 + 本片自己加的守門**(§5-6 的斷言與突變),**不是資料庫層的不變量**。
  🔴 失效條件:任何人加一支會 UPDATE 該欄的路徑,本修法當場失效**而且無聲**(無鎖讀會讀到舊單)。
- **它算不算改「邏輯述詞」**:不算 —— 沒有動「誰能結案、什麼條件能結案」,只動**取鎖順序**(實作面)。
  主視窗 2026-08-11 預讀同此;⚠️ **若實作時發現非改述詞不可,停下正式問 Sean,不自行擴。**

#### 🔴 3a-6. **v6 的順序錨只在紙上成立 —— 我又犯了一次 §9-14**(R4-Fable F1)

v6 寫「順序:參數驗證 → **既有冪等樹** → advisory → 否決 → 動錢」,並說用順序錨釘住。
**②(`admin_initiate_order_refund`)的本體根本裝不進這個錨。** 實查 `20260803150000:419-422` 逐字:

> 🔴 檢查順序(順序是合約、G4 必須在 G12 之前…關卡2 codex MF4):
> `1 輸入衛生 → 2 kind/金額互斥 → **3 鎖訂單** → **4 冪等查驗 G4** → 5 業務前置 → 6 凍結額 → 7 產鍵 → 8 INSERT → 9 稽核`

⇒ **鎖訂單在冪等查驗之前**。照 v6 字面把 advisory 放在冪等之後 = 放在**步 3 的列鎖之後**
⇒ **② 持 `orders` 列鎖等 advisory × ③ 持 advisory 等 `orders FOR UPDATE` = AB-BA 40P01 重生**。

🔴 **這與 §9-14 對 ③ 犯的錯同構:寫錨之前沒開本體。** 同一份文件、隔一個修訂版、換一支 RPC,**同一個病**。

#### ✅ 3a-6a. v7 修法:**「取鎖」與「否決」是兩件事,分開放**

v6 把兩者綁成一句,才會撞上本體。它們的約束不同:

| 動作 | 放哪 | 為什麼 |
|---|---|---|
| **取 advisory** | 🔴 **步 3(鎖訂單)之前** | 它**不拒絕任何請求**,只排隊 ⇒ 提前取**不改變任何回傳碼**;而且必須早於步 3,否則就是持列鎖等 advisory |
| **共同否決條件** | **步 4(冪等查驗 G4)之後** | 它**會拒絕** ⇒ 若排在 G4 前,合法的同 `request_id` 重播會從 `DUPLICATE_REQUEST` 變成「被拒」= **改了既有語意** |

⇒ ② 的 v7 順序:`1 輸入衛生 → 2 kind/金額互斥 → 🆕 advisory → 3 鎖訂單 → 4 冪等查驗 G4 → 🆕 共同否決 → 5…9`
**重播仍在步 4 拿到 `DUPLICATE_REQUEST`,述詞不變。**
🔴 **順序錨要釘的是這兩點各自的相對位置**,**不是**一條籠統的「在冪等之後」。
**釘法(R5-N3,寫死)**:比對 **`prosrc` 內的字元位置** ——
`strpos(prosrc,'pg_advisory_xact_lock') < strpos(prosrc,'FOR UPDATE')`(② 的 advisory 早於步 3 鎖訂單)
與否決條件相對於 G4 那段字面的先後,兩條各一發斷言。
⚠️ 用 `prosrc` **不用** `pg_get_functiondef`(前者是檔內字面、跨環境穩定;形制同 `20260810220000` 的 post-image 指紋)。
**寫錨之前先開本體**——這句話本檔已寫過一次,這次要真的做到。

**必配消融(②側,v6 沒有)**:把 ② 的 advisory 移回步 3 之後 ⇒ **必須能構造出 40P01**。
構造不出來 = 這格沒有判別力,不得宣稱死結已解。

#### ✅ 3a-7. 共同否決條件 —— **v5 那句會擋掉合法的第二次部分退款,已重寫**(R3 `:273`)

v5 寫「任一本已有**未結案或已成功**的退款 ⇒ 不開新的」。🔴 **「已成功」那半是錯的**:
第一次部分退款成功之後,它會**永久封死**後續合法的部分退款,**與 §3a-8 那句「合法多次部分退款照樣開多條根鏈」直接矛盾**。

**v6 正確述詞:只擋「在途」,不擋「退過」。**
> 三方在**持有 advisory 之後**、動錢之前檢查:
> 「這張單的這顆 `rec_trade_id`,在 `order_refunds` 或 `payment_refunds` **任一本**,
> 有**在途(未達終局)**的退款」⇒ **不開新的**。

**Σ 超退上界不歸這條管**,但 **v6 說它由「Record 剩餘可退額」擋,那句話在併發下站不住**(R4-Fable F2):
Record 是在**鎖外**讀的,而 write-ahead 之下 **API 呼叫發生在 commit 之後**(§0a-①)
⇒ 「終局事件」與「舊快照」交錯時,**本地讀到的剩餘額可能已經過期**。

**v7 認列(不做鎖下重驗,理由在下面)**:
> **真正擋住超退的最後防線 = TapPay 伺服器端拒絕**,不是我們本地讀到的值。
> 實證(**sandbox 實測**,非正式環境;R5-N2):memory `reference_tappay-refund-api-multiple-partial-and-overrefund` 逐字
> 「**超額退款會被 API 拒絕**,而且**拒絕是原子的**」「被拒那次 `amount`/`refunded_amount` 完全沒動」
> ⚠️ **sandbox 成立不自動等於正式環境成立** —— 這條當「最後防線」用,但**不當作已在正式環境驗過**。
> ⇒ 且該檔明載這是既有拍板「**防超退不由我們做、TapPay 自己擋**」(`project_a7c-full-refund-only-decisions`)的實證背書。

🔴 **為什麼不做「鎖下 delta 重驗」**(Fable 給的另一個選項):那需要**在持有 advisory 的交易內**再打一次 Record API
⇒ **交易跨網路呼叫**、隊伍被外部延遲綁住 —— 正是 §3a-10 剛修掉的 idle-in-transaction 風險。
**兩害相權:寧可依賴一個已實測的伺服器端原子拒絕,也不要把外部呼叫塞進鎖內。**
⚠️ **代價要寫在誠實清單**:超退的偵測時點因此**落在送出之後**(拿到拒絕碼才知道),不是送出之前。

**兩件事分開**:否決條件擋**併發重複**,**TapPay 擋總額超退**。v5 把兩者混在一句裡才會自相矛盾。

**「在途」的精確狀態集合(R3 `:273b`;缺這個定義實作者只能猜)**
| 帳本 | 在途 = | 終局 = |
|---|---|---|
| `payment_refunds` | 父列**存在**且**無**終局事件 | 事件 ∈ `result_confirmed` / `result_failed` / `manual`(**2d 之後 `result_success` 不再是終局**,§4b)|
| `order_refunds` | `status` ∈ **在途集合** | `status` ∈ **終局集合** |

🔴 **`order_refunds` 的兩個集合必須以實查該表 CHECK 的 `status` 值域為準逐字列出**,**本 plan 不憑印象寫**
⇒ **列為 2f 的開工前置**(附 `檔案:行號`),寫進該片 COMMENT。
🔴 **`manual` 不論 `refunded` 真假都算終局**(它是人寫下的結案);`refunded` 只餵 Σ 帳,**不參與否決判定** ——
混用會變成 R3 指出的兩種壞法(漏算 ⇒ 再退一次;全算成功 ⇒ 永遠不能重試)。

#### ✅ 3a-8. 多根問題:**不需要唯一索引**(R2 `:212` 解封)

advisory 互斥之下,**同一筆補償意圖不會開出第二根**;而**合法的多次部分退款照樣開得出多條根鏈**
(`20260810140000:59` 逐字契約)。🔴 **v4 那條 `pr_one_root_per_attempt` 確定不建。**

#### 🔴 3a-9. 「不可能成環」的鎖清單 —— v5 列漏了,補完(R3 `:261`)

v5 寫「補償唯一列鎖是 attempt 的 `KEY SHARE` 且最後取」。**漏了**:writer 還會插 `payment_refund_events`
(FK 指 `payment_refunds`),重試根還有指向既有 refund 列的自我 FK。

**v6 的完整鎖清單與論證**
| # | 補償 writer 取得的鎖 | 強度 |
|---|---|---|
| 1 | advisory(order 鍵) | 不在列鎖等待圖上 |
| 2 | `payment_charge_attempts` 該列 `KEY SHARE`(父表 FK) | 最弱 |
| 3 | 自己剛插入的 `payment_refunds` 列 `KEY SHARE`(事件 FK) | 最弱,且**該列尚未提交、無人可爭** |
| 4 | 重試時:前手 `payment_refunds` 列 `KEY SHARE`(自我 FK) | 最弱;該表**只有本家族會鎖**,而本家族都先排隊 |

**論證改成**:補償 writer **只取 `KEY SHARE`、從不升級、從不取 `FOR UPDATE`/`NKU`**
⇒ 它可能**被**別人擋(別人持 `FOR UPDATE`),但**它不會擋住任何需要它才能前進的人之後又去等對方** ——
**沒有升級 = 沒有它參與的環**。
⚠️ **這句的例外路徑(R5-N1)**:`lock_timeout`(§3a-10)之下,「被擋」會變成**快速失敗**而非無限等待
⇒ 上面那句描述的是**鎖圖形狀**,**不是**「它一定等得到」。兩者不衝突,但別把「不成環」讀成「一定會成功」。
⚠️ **這是比 v5 弱但真實的宣稱**:不是「構造上不可能成環」那種全稱句,而是「**本 writer 不引入新的環**」。

#### 🔴 3a-10. 可用性:advisory **保證交易結束時釋放,不保證交易會結束**(R3 `:250`)

`_xact_` 版沒有「忘記解鎖」,但有 **idle-in-transaction**:某方開了交易、取了鎖、然後卡住/沒提交
⇒ **同一張單的其他操作全部排隊**,嚴重時吃光連線池。

**v6 三道(缺一不可)**
1. **三方都 `SET LOCAL lock_timeout`**(建議 **3s**):等不到就**快速失敗**,不排隊堆積。
   ⇒ 補償方失敗 = 下一輪再來(它本來就有 lease/退避);②③ 失敗 = 員工看到「請稍後再試」,**不是無限轉圈**。
   🔴 **兩個必須揭露的事實(R4-Fable F6;不得只寫在這裡,要在 apply 停點對 Sean 講一句話)**:
   (a) **`lock_timeout` 包住的是那個交易裡的_所有_鎖,不只 advisory** ⇒ 員工原本會「等一下就成功」的
       正常競爭,現在可能**直接失敗**。**這是對員工可見的行為改變**,不是純內部調整。
   (b) **3 秒是我憑判斷選的,沒有量過** ⇒ 太短會把正常等待判成失敗、太長等於沒設。
       ⇒ **上線前要用真實資料量一次**(②③ 的 P95 持鎖時間),或先設寬(如 10s)再依觀測收斂;
       **本 plan 不假裝 3 秒有依據。**
2. **補償方本來就有每輪硬上限 1 筆**(§2c 時間預算)⇒ 它不可能長時間佔著隊伍。
3. **值班看得見**(§3a-11)。

#### ✅ 3a-11. 排隊的可觀測性 —— **v5 完全沒有**(R3 `:664`)

🔴 被 advisory 擋住的請求**走不到既有的自動裁定/退款 log**(它卡在取鎖那一行)⇒ **排隊在觀測上完全隱形**。

**值班診斷查詢(唯讀;✅ 已在 PG17.10 實跑,輸出如下)**
```sql
select w.pid  as waiter_pid,
       pg_catalog.array_to_string(pg_catalog.pg_blocking_pids(w.pid), ',') as blocked_by,
       a.state      as blocker_state,
       pg_catalog.age(pg_catalog.clock_timestamp(), a.xact_start) as blocker_xact_age,
       l.objid      as lock_key_lo
  from pg_catalog.pg_locks l
  join pg_catalog.pg_stat_activity w on w.pid = l.pid
  left join lateral (select s.state, s.xact_start from pg_catalog.pg_stat_activity s
                      where s.pid = (pg_catalog.pg_blocking_pids(w.pid))[1]) a on true
 where l.locktype = 'advisory' and not l.granted;
```
實跑輸出(人為造一個 30 秒的持鎖者):`waiter_pid=644 | blocked_by=616 | blocker_state=active | blocker_xact_age=00:00:03 | …`
🔴 **`blocker_state` 就是 idle-in-transaction 現形的地方**(卡住的那方會顯示 `idle in transaction`)⇒ §3a-10 的殘餘風險**看得見**。

**要落地的三件**(歸 2j / 2l,列為驗收條件):①這條查詢寫進 runbook ②`lock_timeout` 失敗要落一行零 PII log(否則快速失敗也是無聲)③連續失敗即告警。

#### 3b. 做不到的(不宣稱擋住)
**外部 Portal 並發**:有人在 TapPay 後台手動退款,本地任何機制都看不到 ⇒ **無法消除的殘餘風險**。
鎖與共同否決條件都只序列化「我們自己的兩條線」。

### 核心點 4 · adapter 契約(單向推論)

| adapter 行為 | 能推論什麼 | 本片動作 |
|---|---|---|
| `TapPayRefundNotSentError` | **確定未送出**(pre-flight 違規、fetch 零呼叫) | 🔴 `sent` **早就寫了**(write-ahead 的必然,append-only 撤不掉)⇒ 追加 `result_failed` + 告警。**這是唯一能在 `sent` 之後仍安全落 terminal 的情形**,因為 adapter 保證 fetch 零呼叫 |
| 一般 throw | 🔴 **證不出未送出** —— `AbortSignal.timeout/any` 在 `TapPayChargeAdapter.ts:326-330`、**`fetch` 之前**就可能丟 | 一律 `result_unknown`、走對帳。**不宣稱「一定已送出」** |
| status 0 | 已受理(**不等於錢已到帳**,隔日生效) | 🔴 **v4 改**:落 `result_success` **之前**必須先驗**金額**(見下);且 `result_success` **不等於**「這顆可以不用再看」——見 §核心點 4a |
| wire code 10024 / 10051 | **wire code 到得了**,但 `kind='full'` 下 adapter **不回傳** `deferred`/`rejected` domain 態,而是轉一般 throw | `result_unknown` + 告警(前提被推翻,不自行解釋) |

⇒ **對帳路徑是主路徑、不是例外路徑**,工程量照這個估。

#### 🔴 4a. v3 把 `accepted` 當成終點 —— 關卡1 兩條打中,都成立

**① 金額沒守門**(`:168`):TapPay 回 accepted 時帶的 `refundAmount` **若與帳本凍結額不同**,
v3 照樣落 `result_success`。既有 admin 線在 finalize 有金額守門,本片沒有 ⇒ **退出去的錢與帳上記的錢可以不一樣,而系統顯示一切正常。**
⇒ **v4:`accepted` 的金額必須等於本 refund 父列的 `amount`,不等 ⇒ 落 `result_unknown` + 告警,不落 success。**

**② `result_success` 之後就沒人再看了**(`:168` 第二條):`accepted` **只代表受理**(隔日生效)。
v3 把它寫成 terminal 並讓 attempt 離開人工佇列 ⇒ 若 TapPay 受理後**實際沒完成**,
**客人沒拿到錢、而告警已經消失** —— 這是本片最壞的失敗形狀:**安靜地錯**。
⇒ **2d 的對帳掃描範圍不能只有「未結案」**。

#### 🔴 4b. 但「T+N 再確認」與**已 apply 的 schema 直接衝突**(關卡1 R2 `:283`/`:328`/`:430`)

`20260810140000:137-138` 的 `pre_one_terminal_uniq` **已經把 `result_success` 當成 terminal**
(一顆 refund 只能有一個終局事件)⇒ 在現行 schema 下,**「已受理但尚未確認完成」這個狀態根本沒有位置可以表達**。
v4 一邊說它是 terminal、一邊說它待 T+N 確認 —— **那是兩個互相矛盾的宣稱,不是一個計畫。**

連鎖後果(三條都成立):
- **2e 的排除條件**一見 `result_success` 就把 attempt 移出人工佇列與 claim
  ⇒ 隔日真的沒退成時,**訊號已經提前消失**;
- **rollback 的人工佇列**只涵蓋「未結案」⇒ 已 accepted、未確認的那族**完全漏出**;
- 「N 是幾天」「delta 怎麼算才算確認」**v4 一個字都沒定**。

**⇒ 規格定案(Q8-無關,現在就固化)**:`accepted` 與 `confirmed` **必須是兩個不同的事件**。
| 作法 | 內容 | 代價 |
|---|---|---|
| **(甲,推薦)** | `payment_refund_events.event_type` **新增 `result_confirmed`**,並把 `pre_one_terminal_uniq` 的 terminal 集合改成 `result_confirmed / result_failed / manual`(**`result_success` 退出 terminal**) | 動已 apply 的 CHECK 與唯一索引 ⇒ 一支 migration(本片自己的表,**不是別人的 RPC** ⇒ **與 §6a 那題無關**) |
| (乙) | 不動 schema,用 `reconcile` 事件 + 父列查詢表達 | terminal 語意仍錯,且 `reconcile` 已有別的用途 ⇒ **不採** |

**甲案連帶定死三個數字/述詞**(缺一則 2d 無法實作):
1. **N = 3 個日曆日**(TapPay 退款「隔日生效」+ 假日緩衝;`reference_tappay-refund-api-multiple-partial-and-overrefund` 記「隔日生效」);
2. **確認述詞** = 該 rec 的 Record `refunded_amount` **較 `sent` 前持久化的 baseline 增加 ≥ 本 refund 的 `amount`**
   (baseline 已列進 2a-2;**不能用「amount 變 0」** —— 那對部分退款不成立);
3. **逾 N 日未確認** ⇒ 落 `manual` + 告警,**不自動重試**(換鍵重試 = 雙退)。

🔴 **2e 的排除條件同步改成認 `result_confirmed`,不是 `result_success`** —— 否則訊號仍提前消失。

#### ✅ 4c. **被拒的根:完整路徑一次寫完**(R5-C2:v7 把它散在三處,實作者要自己拼)

`kind='full'` 之下,`10024`/`10051` 這類 wire code **到得了 adapter,但不會變成 domain 的 `deferred`/`rejected`**,
而是轉成一般 throw ⇒ 落 `result_unknown`。**從那一刻起到終局的完整路徑**:

| 步 | 發生什麼 | 依據 |
|---|---|---|
| 1 | adapter 一般 throw ⇒ 寫 `result_unknown` + 告警 | §核心點 4;**不宣稱「已送出」也不宣稱「未送出」** |
| 2 | **不得換鍵重試**(2k 的機制面) | 換鍵 = 有機會**真的退第二次** |
| 3 | 2k 對帳:讀 Record,比 `sent` 前持久化的 `refunded_amount` baseline 的 **delta** | delta 是唯一能分辨「到底退了沒」的觀測 |
| 4 | delta 說退了 ⇒ 補 `result_confirmed`;說沒退 ⇒ 可**沿鏈**開新根(帶 `supersedes_refund_id`) | §3a-8 |
| 5 | delta 不可判(例如同期有 Portal 場外退款) ⇒ 落 **`manual`** + 人工佇列 | §3b 的 `manual` 值域 |

🔴 **一個容易被誤用的事實**:memory `reference_tappay-refund-api-multiple-partial-and-overrefund` 記著
**`10024` 拒絕也消耗鍵**,而 **`10051` 不消耗**。
⚠️ **本片不依賴「10051 不消耗鍵」這件事** —— 因為在 `full` 之下我們**分不出**回來的是哪一個碼(都變一般 throw)。
⇒ **一律走上表**:未知 → 對帳 → 由 **delta** 決定,**不由 wire code 決定**。
(R5 另已確認:F2 曾擔心的「鍵被卡死」不成立,但**理由不能寫成「因為 10051 不消耗」**,我們根本不知道是不是它。)

### 核心點 5 · 並發:同一 attempt 開多根 refund

兩個交易可**同時**看見空集合,再各插一條 `supersedes_refund_id IS NULL` 的根;
L5b-1 的 `pr_supersedes_uniq` 是 partial index、`WHERE supersedes_refund_id IS NOT NULL`
(`20260810140000`,建表段落末三行)⇒ **只擋非 NULL 前手分叉,不擋同 attempt 多根**。

**v3 的解(鎖 attempt 列)已撤回**(會製造全庫第一個 `order→attempt`,§3a-2);
**v4 的解(唯一索引)也已撤回**(違反「部分退款多次=多條根鏈」契約,§3a-3)。
**v5 正解 = advisory 互斥**(§3a-7):同張單同一時間只有一方在跑
⇒ **同一筆補償意圖不會開出第二根**,而**合法的多次部分退款照樣開得出多條根鏈**。

🔴 **lease token 的角色要重新定位**(關卡1 `:152`):v3 把「重驗 lease token」當成防線之一,
但 **token 擋不住人工結案** —— `close_released_attempt` 把 attempt 轉 `failed` **不會動
`settle_attempt_count`** ⇒ 舊 worker 醒來時 token 仍然「當前」,照樣插得進帳並退款。
⇒ token 只證「**我還是那個 lease 的持有者**」,**不證「這顆 attempt 還該被退款」**。
後者要靠**鎖下(或插入後)重驗 `status` / `superseded_at` / `orders.payment_status`**,
而那正是 §3a-4 那個未解競態的內容。**兩件事不要合併敘述。**

### 🆕 核心點 6 · L5b-0 交接的兩項義務(v2 沒有這節)

| # | L5b-0 認列的殘留 | 出處 | 本片要做什麼 |
|---|---|---|---|
| ① | **告警無 per-anomaly 去重** ⇒ 被標人工那族每輪 cron 重推同一數字,「自動出口要等 L5b-2」 | `20260810220000:81-82` | 補償成功後把該 attempt 帶離人工佇列(見下)⇒ 數字自然收斂 |
| ② | **B1a `claim_expired_pending_attempts` 仍會每 6h 重領** `superseded`+`pending` 的列(它的述詞明文不濾 manual / 不濾 ceiling / 不濾 superseded) | `20260810220000:76-80`;述詞本體 `20260627120000:88-93` | 🔴 **本片不治**(動 B1a = 第五支 RPC、超片界)。殘餘傷害=白打的 Record 呼叫,已由 L5b-0 plan §8-9 認列 ⇒ 本片**只在 2c 檔頭留指標,不宣稱關掉它** |

#### 🔴 義務① 的 v3 做法已撤回(關卡1 R1 兩條,兩條我都親驗為真)

v3 寫「補償落 `result_success` 後,用既有的 `close_released_attempt` 把 attempt 結案,不新寫 RPC」,
理由是「結案語意已存在,新寫第二支等於讓『什麼叫結案』有兩個定義」。**那個做法有兩個獨立的致命傷**:

| # | 事實 | 出處 |
|---|---|---|
| ① **權限上呼不到** | `REVOKE ALL ON FUNCTION public.close_released_attempt(uuid, text)`,同檔自檢逐字「**應 4 角色零 routine 顯式 grant**;拒繼續」⇒ **owner-only**,自動 sweeper(`payment_confirmer`)無權呼 | `20260624120010:143` / `:165` |
| ② **語意上是另一件事** | 它的契約是**人工取得 TapPay 明確終局(未扣款)後**收尾,同交易寫 `released_closed_at/by/resolution` 三欄成組;`by = session_user` | `20260624120010:13-15` |

⇒ ② 比 ① 更難救:就算開了權,「**已接受退款**」與「**人工確認未扣款**」是**相反的事實**,
寫進同一組 `released_closed_*` 稽核欄 ⇒ 之後任何人查「這顆為什麼結案」都會拿到錯的答案。
🔴 而且它自己還有一道 `payment_status 非 unpaid ⇒ fail-closed 拒 close`(`:115`),與補償情境未必相容。

#### ✅ 義務① 的 v4 做法:**不動 attempt,改動「讀取面」**

**自動出口 = 讓已有成功補償的 attempt 不再被算、也不再被領**,而不是替它發明第二種結案:
1. `get_payment_anomaly_alert_summary` 的人工計數 **排除**「該 attempt 已有 `result_success` 的 refund」;
2. `claim_stuck_unsettled_attempts` 的述詞**同步排除**同一族 —— 否則它仍每輪被領、白打 Record
   (與核心點 6-② 的 B1a 是同一種浪費,只是這一支我治得到)。

🔴 **v4 漏了第三支(關卡1 R2 `:327`)**:`expire_stuck_attempts_at_ceiling` **跑在 claim 之前**,
若補償成功發生在 `settle_attempt_count = 8` 那一刻,**下一輪 expirer 仍會把它標成 `needs_manual_review`**
⇒ 自動出口失效、清單照樣長。**⇒ 2e 是改三支,不是兩支**(pre-image = `-s` 的 post-image `20260810220000:466`)。

🔴 **屬性必須逐支重釘(關卡1 R2 `:332`)**:`CREATE OR REPLACE` **不繼承**你沒寫的東西 ——
`SECURITY DEFINER` / `SET search_path = ''` / owner / ACL / COMMENT **漏抄任何一項**,
該支就變 `INVOKER`(或權限漂移)⇒ **cron 整條啞掉,而且是安靜地啞**。
⇒ 2e 的驗收要含:**四支 post-image prosrc 指紋 + `prosecdef`/`proconfig` 逐支斷言 + ACL allowlist + `has_function_privilege` 正負向**(形制照 L5b-0-s 自己那套,`20260810220000:496-553`)。

**代價要講清楚(不藏)**:這幾支**都是 L5b-0-s 剛改過的已上線函式**
⇒ 又一支 `CREATE OR REPLACE` + **pre-image 指紋閘**的 migration,pre-image 就是 `-s` 的 post-image
(`20260810220000:451` / `:461`)。⇒ **本片新增一片 `L5b-2e`**,且它**硬依賴 `-s` 已 apply**。

**為什麼這樣比新寫結案 RPC 好**:attempt 的狀態機一個字都不用動 ⇒ 不新增 enum、不新增稽核欄、
不與 R1a1 的 `group_chk` / `status_chk` 打架、不需要新的 ACL 邊界。
**代價**:那顆 attempt 會**永遠停在 `released`**(不會變 `failed`)⇒ 「已補償」這件事的唯一真相
在 `payment_refunds`,不在 attempt 上。⚠️ **這條要寫進 2e 的 COMMENT**,否則下一個人查 attempt 會以為它還沒處理完。

⚠️ **值班可見行為改變(批 apply 時一併看)**:人工待確認清單會開始**自己變短**。
值班若習慣「清單只會被人清空」,要先講一聲。

---

## 2. 片級 plan

**v5 片表** —— Q8=A 解封後重切,**每片 ≤45 分、且一片=一個可獨立 apply 且可獨立 rollback 的 migration,或一個純應用層改動,不混**(§2f-6 原則已收進本表)。

| 片 | 內容 | 面 | 估時 | 鐵則 12 |
|---|---|---|---|---|
| **2a** | claim RPC **`DROP`+重建**加 `superseded_at`;ACL 四件(REVOKE PUBLIC / GRANT / owner / COMMENT)+ pre-image 指紋閘 + 正負向 ACL 斷言 | migration | 40 | ①③ |
| **2b** | 型別接線:`domain` / `ports` / `adapters` + 呼叫端測試 | 純應用層 | 30 | ① |
| **2c** | `payment_refunds` 欄與 CHECK:`rec_trade_id`(nullable+形狀)/ `strong_key` 值域 / `manual` verdict(§2f-1~3) | migration | 35 | ③ |
| **2d** | `result_confirmed` 事件:改 `pre_event_type_chk` + 把 `result_success` 移出 `pre_one_terminal_uniq`(§4b) | migration | 35 | ③ |
| 🔴 **2e** | **`close_released_attempt`**:加 advisory lock(第一個觸資料動作)+ 「該 attempt 有未結案退款 ⇒ 拒結案」+ 順序錨守門 | migration(**動已上線金流 RPC**) | 40 | ①②③ |
| 🔴 **2f** | **`admin_initiate_order_refund`**:加 advisory lock + 共同否決條件(跨兩本帳) | migration(**動已上線金流 RPC**) | 40 | ①③ |
| **2g** | **補償寫入 RPC**:advisory lock → 否決條件 → 開父列 + `sent`(一次一列)、鍵沿用既有式子(含 `extensions.`)、`sent` 前持久化 `refunded_amount` baseline、SECDEF 全套 | migration | 45 | ①③ |
| **2h** | harness + 突變矩陣(含**三方並發**格與消融) | 純測試 | 45 | — |
| **2i** | 決策函式:核心點 2 的**十三條**合取 → `compensate`/`reconcile`/`skip(碼)` | 純應用層 | 40 | ① |
| **2j** | 接線:**獨立路由**(不掛 settle-sweep)+ env flag(預設 off)+ **每輪硬上限 1 筆** + 三態落事件 | 純應用層 | 45 | ①④ |
| **2k** | 對帳 RPC:未結案 → Record → 補寫 terminal;禁止換鍵重試的機制面 | migration | 40 | ①③ |
| **2l** | **T+N 確認**(N=3 日曆日)+ 確認述詞 + **人工佇列四件**(查詢/入口/責任人/告警) | 應用層 + docs | 45 | ① |
| **2m** | 自動出口:**三支**讀取面(alert / claim / **ceiling-expirer**)排除已 `result_confirmed` 的 attempt | migration | 45 | ①③ |

**序**:2a → 2b → 2c → 2d → (2e ‖ 2f) → 2g → 2h → 2i → 2j → 2k → 2l → 2m。
🔴 **2e / 2f 與 2g 必須同批 apply**:只上 2g(補償方參加隊伍)而 2e/2f 未上 ⇒ **只有一方排隊 = 沒有互斥**,
比不做更危險(它會讓人以為已經擋住了)。⇒ 三支綁成**同一個 apply 批次**,檢查表照 P-354 形制。

**分級理由(鐵則 9)**:全片只產出固定機器碼(reason code)與低頻值班告警文案,無對客文案、
年更新頻率 0-1 次 ⇒ **L1**,不需後台 CRUD。
🔴 **2e / 2f 是全線最危險的兩片**(動已上線、正在收錢/退錢的 RPC)⇒ **各自單獨過對抗審查,不合併審。**

### 🔴 2a 為什麼是「`DROP`+重建」而不是「另開專用 claimer」

**替代案**:給補償線一支自己的 claimer,不動 `claim_stuck_unsettled_attempts`。
**駁回,理由=兩個 claimer 共用同一組 lease 欄位**:lease 面只有 `settle_attempt_count` + `next_settle_at`
兩欄(`20260810220000:246-247` 的 `SET` 本體),兩支各自 `++` 同一個計數 ⇒ ceiling(`<8`)被兩條線一起吃掉、
退避時間互相覆蓋,症狀是「有時候補償不跑」= 最難查的那種。

⚠️ **`CREATE OR REPLACE` 不能加寬 `RETURNS TABLE`**(PG `42P13`)⇒ 只能 `DROP`+重建,連帶:
**GRANT / owner / COMMENT 全部被帶走**,而新建函式**預設 `PUBLIC` 可 `EXECUTE`**
⇒ 只補 GRANT 會留下一個全世界可呼的金流 RPC(§2f-4 的四件缺一不可)。
🔴 反證一直在手上:L5b-0-s 自己就是 `CREATE OR REPLACE` 且**刻意沒動回傳形狀**(`20260810220000:210`)。

### 🔴 2a-X. **照抄 2a 之前必須逐條重問的七件**(Fable R3 唯一 must-fix,2026-08-11 落檔)

2a 已實作完成(`20260811060000` + `scripts/l5b2-2a-rollback.sql` + `scripts/l5b2-2a-verify.sh`,
codex R1/R2 兩輪 22 must-fix 折完、Fable R3 PASS)。**它會變成後面 2c/2d/2e/2f/2g/2k/2m 的模板** ——
而模板最危險的地方,是**把「在 2a 成立的前提」當成「在每片都成立的事實」照抄過去**。
以下七條是 R3 點名的:**照抄前逐條重問,答不出證據就不准沿用。**

| # | 2a 怎麼做的 | 照抄前必須重問什麼 |
|---|---|---|
| **1** | 前置閘釘 `md5(pg_get_functiondef(…))`,值 `98a064da…`,本機 17.10 與正式庫 17.6 **兩環境量到同一顆** | 指紋**逐函式、逐環境重量**,不得沿用本片的值,也不得只量一個環境就寫死。<br>🔴 **2g 是全新函式、根本沒有 pre-image** ⇒ 它要的不是「指紋相符」閘,而是**「這支必須還不存在」**閘(否則重跑會蓋掉別人的同名函式) |
| **2** | `DROP FUNCTION`(不加 `CASCADE`),賭「零相依物」 | 「零相依」是我**只對 `claim` 這一支實證過**的事實,不是通則。<br>照抄前先查 `pg_depend`(view / 另一支函式 / trigger / default 運算式都算);有相依物時 `DROP` 會紅在那裡=正確,但**片界要重估** |
| **3** | ACL allowlist 期望值寫死 `payment_confirmer:EXECUTE` | **各片自己量**該支函式的 grantee 集合。2e/2f 動的是別支已上線 RPC,它們的 grantee 未必相同;2g 是新建、要自己決定並在片內論證 |
| **4** | 成員白名單放行 `postgres@supabase_admin`,理由=**owner 等價** | 那個理由**整條壓在「該支函式的 owner 就是 postgres」**。照抄前**重新論證一次**:該片那支函式的 owner 是誰?若不是 postgres,白名單就不再是「沒有擴大可達集合」,而是實打實多給一個角色 EXECUTE。2a 已補 fail-closed 前提斷言,**照抄時連那道一起抄** |
| **5** | 檔頭寫「apply 期間 sweeper 照舊用舊定義跑完」(兩連線實測) | 那個結論**只對「每次重送 SQL 文字」的呼叫端成立**。帶**快取計畫**的路徑(prepared statement / plpgsql 內呼叫 / 連線池重用)沒有被驗過。<br>後面的片若動到有 plpgsql 呼叫端的函式,**這條結論不可沿用** |
| **6** | 🔴🔴 rollback = 單一交易 + 三態閘(只接受 2a post-image 或已是 pre-image) | **2e / 2f 的 rollback 還要多一道 2a 沒有的閘**:§2b 已定的「**2g writer 在庫則 abort**」成組回退閘。<br>2a 的 rollback 形狀**沒有這道**(它不在 2e/2f/2g 那個成組批次裡)⇒ 照抄 2a 的 rollback 骨架時,**這道要另外加,不會自己長出來** |
| **7** | 走 `DROP`+重建 | **`DROP`+重建不是預設做法,是被 `42P13` 逼的**(只有「要改回傳型別」才需要)。<br>不改回傳形狀的片一律走 `CREATE OR REPLACE`——它**保留 owner / ACL / COMMENT**,少掉一整組會出錯的還原步驟。照抄 2a 的 DROP 骨架去改一支不需要改簽章的函式 = 自找 ACL 全丟的風險 |

⚠️ **這張表的用法**:它不是提醒,是**開工前的逐條 yes/no**。第 6 條與第 4 條各自對應一個「2a 綠但你會紅」的
真實失效面;第 7 條對應「2a 綠而且你也綠,但你多冒了一整組不必要的風險」。

### 🆕 2f. **Q8-無關的規格固化**(不押 A/B/C 的字面;現在就定死)

以下都不依賴 §6a 的裁示 —— 不論 A/B/C 哪一案,這些規格都一樣要有。

#### 2f-1. `payment_refunds.rec_trade_id`(2a-2 純加法 ALTER)
```sql
ALTER TABLE public.payment_refunds
  ADD COLUMN rec_trade_id text;
ALTER TABLE public.payment_refunds
  ADD CONSTRAINT pr_rec_trade_id_shape_chk
  CHECK (rec_trade_id IS NULL OR pg_catalog.btrim(rec_trade_id) <> '');
```
- **形制照 A7c 的先例**(`20260801120000:190-191` 給 `order_refunds` 加的那支),語意同 `:193-194` 逐字:
  **「INSERT 當下綁定…之後不可變…是快照不是外鍵」**。
- 🔴 **先加 nullable、不加 `NOT NULL`**:表雖是空的,但 `NOT NULL` 會把「舊列回填」這個選項永久關掉,
  而本欄的值來源(attempt 的 rec)在極少數弱識別情境**可能不存在**(§核心點 2 條件 9)。
  ⇒ **NOT NULL 由 2a-2 的 writer 保證**(RPC 必填),schema 留 nullable + 形狀 CHECK。
- **用途有兩個,不要只記得一個**:①§3a-5 跨線共同否決條件的 join 鍵 ②OP6 對帳的 join 鍵。

#### 2f-2. `strong_key` 值域(2a-2 定死 + CHECK)
現況:`20260810140000` 只有 `pr_strong_key_nonblank_chk`(非空白),**值域從未被定義**
⇒ 直接後果是**核心點 2 的條件 4 與條件 9 可能是同一條**(關卡1 R1 `:114`),而那會讓一發突變證不了兩個守門。

**定案**:`strong_key` = **`'rec:' || rec_trade_id`** 或 **`'bank:' || bank_transaction_id`** 二選一,
前綴強制、且與母 plan §5-5 的「強識別 = rec 或 bank_txn 其中之一」逐字對齊。
```sql
ALTER TABLE public.payment_refunds
  ADD CONSTRAINT pr_strong_key_domain_chk
  CHECK (strong_key ~ '^(rec|bank):[A-Za-z0-9_-]{1,64}$');
```
🔴 **定了前綴之後,必須回頭重跑條件 4/9 的蘊含檢查**:
`strong_key` 走 `rec:` 時它**確實**被條件 4 蘊含 ⇒ 那一格要改成
「**條件 9 驗的是「強識別存在且形狀合法」,條件 4 驗的是「它指到的 rec 等於目標」**」——
兩者的負測分別是 **弱識別(兩者皆無)** 與 **強識別存在但指錯單**,**這兩個負測互不蘊含**,判別力成立。

#### 2f-3. `manual` 事件的值域(關卡1 R2 `:464`)

> 🔴🔴 **2026-08-11 更正(片 2c 實作時被打穿兩次,原字面已作廢)**:本節原本給的 DDL 是
> `record_snapshot ? 'refunded' AND jsonb_typeof(...) = 'boolean'` —— **它擋不住本節要擋的第一種情形**。
> PG 的 CHECK **只擋 FALSE、求值為 NULL 一律放行**,而:
> ① `record_snapshot` 為 SQL NULL ⇒ `NULL ? 'refunded'` = **NULL** ⇒ 整條 NULL ⇒ 放行;
> ② 補 `IS NOT NULL` 之後仍被打穿:`record_snapshot = '["refunded"]'`(**陣列**)⇒ `?` 對陣列是
>    「元素存在嗎」= **true**,而 `-> 'refunded'` 對陣列回 **NULL** ⇒ 又是 NULL ⇒ 放行(正式 17.6 已重現)。
> ⇒ 正解**不是再列一個 NULL 來源**(打地鼠),是**由構造保證非 NULL**:整條包 `COALESCE(…, false)`。
> 一併涵蓋:NULL / 陣列 / 純量 / 缺鍵 / 鍵值非 boolean **五種**。下方 DDL 已改。
> ⚠️ **後面的片凡是寫 CHECK,一律先問「這條求值成 NULL 時會怎樣」** —— 這是本線第二次栽在同一個語意上。
`manual` 是人寫的終局,但**它對「已退金額 R」的貢獻從未定義** ⇒ §3b 的表只能寫「不得自行解讀」。
**定案**:`manual` **必須帶 `record_snapshot`**,且其中要能讀出「人當時判定錢**有沒有**退出去」。
```sql
-- 2a-2:manual 事件必須可判讀,否則它是一個沒有語意的終局
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_manual_needs_verdict_chk
  CHECK (event_type <> 'manual'
         OR COALESCE(pg_catalog.jsonb_typeof(record_snapshot -> 'refunded') = 'boolean', false));
```
⇒ 之後 §3b 的表可以把 `manual` 寫成:**`refunded=true` 計入 R、`false` 貢獻 0**,不再是「不得解讀」。

#### 2f-4. **`DROP`+重建的 ACL 不是「補 GRANT」就好**(關卡1 R2 `:352`)
`DROP FUNCTION` 會一起帶走 **owner / ACL / COMMENT**,而**新建的函式預設 `PUBLIC` 可 `EXECUTE`**
⇒ 只「補回 `payment_confirmer` 的 GRANT」**會留下一個全世界可呼的金流 RPC**。
**2a-1 的同一支交易必須完成四件**:
1. `REVOKE ALL ON FUNCTION … FROM PUBLIC`(**顯式**,不能靠預設);
2. `GRANT EXECUTE … TO payment_confirmer`(還原);
3. **owner 對齊**(與 DROP 前一致);
4. `COMMENT ON FUNCTION` 重寫。
**驗收**:ACL allowlist + `has_function_privilege` **正負向**(正=`payment_confirmer` 呼得到;
負=`anon`/`authenticated`/`service_role` 呼不到),形制照 `20260810220000:496-553`。

#### 2f-5. 2d 新增的寫入 RPC 同樣要 SECDEF 全套(關卡1 R2 `:356`)
2d 要寫 `payment_refund_events`(補 terminal)⇒ 那是**零直權表**,`INVOKER` 寫不進去。
⇒ 2d 的 RPC 必須:`SECURITY DEFINER` + `SET search_path = ''` + 全識別子 schema-qualified
+ owner 對齊 + **EXECUTE 白名單** + **負向 ACL 斷言**。**v4 一項都沒列,這裡補齊。**

#### ✅ 2f-6. 片界重切 —— **已在 §2 的 v5 片表定稿**

v4 的估時(60/90/60/70 分)違反鐵則 4(15-45 分),R2 `:350` 打中。
Q8=A 裁下後片表已重切完成:**13 片、每片 ≤45 分**,原則(一片=一個可獨立 apply 且可獨立 rollback 的
migration,或一個純應用層改動,**不混**)已寫進 §2 表頭。本節不再另列,以 §2 為準。

### 2b. 發布序與 **apply / rollback 停點**

**功能啟用的硬前置(v3 更新)**
1. `L5a-1` 已 apply —— 沒有它就**沒有正式的 superseded writer**,補償觸發條件恆假(整條線變安靜死碼、斷言全恆真)。
2. 🆕 **`L5b-0-m`(`20260810170000`)與 `-s`(`20260810220000`)已 apply** ——
   - 沒有 `-m`:「唯一出口=退款」不成立(讓路款仍可能被認列成收款)⇒ 本片在修一個還沒被鎖死的洞。
   - 沒有 `-s`:被讓路那族不會回到 manual/ceiling 閘 ⇒ 補償的觸發來源(人工佇列)不會長出來。
   ⚠️ 這兩支**目前未 apply**(檢查表在主視窗、等 Sean 批)⇒ **本片的應用層不得先上線**
   (memory `feedback_app-layer-must-not-ship-before-migration-apply`:08-07 正式站因此壞 8 小時)。

| 停點 | 內容 |
|---|---|
| ⛔ 每支 migration(**2a / 2c / 2d / 2e / 2f / 2g / 2k / 2m**) | apply → ACL/read-back 驗 → **才**上應用層。🔴 **2m 改三支已上線 SECDEF 函式**,回退時需要它自己的 pre-image 還原點(照 L5b-0-s 檔尾那套逐支座標) |
| 🔴 ⛔ **2e + 2f + 2g 成組** | **「同批」不是原子交易**(R3 `:430`)⇒ 不能只靠人記得。**做成機械前置閘**:**2f** 的 preflight 釘 **2e 的 post-image prosrc 指紋**;**2g** 的 preflight 同時釘 **2e + 2f 兩顆** ⇒ 缺任一支,後面那支**自己整片回滾**(形制=L5b-0-s 釘 L5b-0-m 三顆,`20260810220000:141`)。<br>🔴 **真正的危險不是「2e 上了 2f 沒上」**(那還沒有新 sender),**是 2g 可被呼叫**、或三支之一**被單獨 rollback**。<br>🔴 **v6 把成組回退寫成純 prose,違反本檔自己的 bar**(R4-Fable F3)⇒ **v7 做成斷言**:**2e 與 2f 的 rollback 腳本第一行**先查「**2g 的 writer 是否在庫**」,在就 **abort**(訊息指回本節)。
<br>🔴🔴 **v7 那道斷言在 house 現況下是無效的**(R5-Fable MF1,**我已實跑證實**):本 repo 的 rollback 慣例是
「檔尾座標 + **逆序手動執行**」= `psql -f` 逐句 autocommit、**無 `ON_ERROR_STOP`**
⇒ `DO … RAISE` 之後**後續每一句照跑**,閘等於被滾過去。
**實測(PG17.10)**:同樣兩句,散跑 ⇒ 後句成功(靶表 **1** 列);包成單一交易 ⇒ 後句死於
`current transaction is aborted, commands ignored…`(靶表 **0** 列)。
⇒ **v8 定案**:**2e / 2f 的 rollback 必須是「單一交易可執行腳本」** ——
`BEGIN;` → abort-check `DO`(2g writer 在庫則 `RAISE`)→ 還原函式本體 + `COMMENT` → `COMMIT;`。
🔴 **禁止只抄座標逐句手跑** —— 那條路上這道閘不存在。這句要寫進 2e/2f 的檔尾 rollback 段本身,不是只寫在本節。<br>⇒ 回退順序因此**由機器強制**:非先撤 2g 不可,不靠人記得逆序。<br>另:**flag 轉 on 之後**要有**「三支都在庫」檢查**。
🔴 **v8 定案(R5-C1):掛在 2j 的分派入口、每輪自查,不新增任何排程** ——
補償每輪本來就要跑一次(§2c 每輪硬上限 1 筆),順手查三支在不在庫,缺任一支就**這一輪不分派 + 告警**。
理由:①**零新排程**(避開多視窗重排的雙開火教訓)②它剛好落在「**要真的送錢之前**」那一刻,
比任何定時檢查都準 ③失敗時的行為明確(不分派),不需要人判斷。<br>⛔ **應用層 flag 轉 on 的前置**:三支**全部在庫**(對帳 SQL 逐支確認),缺一不得開 |
| ⛔ 應用層上線 | **停用開關**(env flag):**預設 off**、在**補償分派入口**讀(不是在 adapter 讀)、開啟需 Sean 批准並記錄時間點。它關掉的是「開新 refund」,**不是**「對帳既有未結案 refund」 |
| 🆕 ⛔ **開 flag 的硬前置 = 2d 已部署且可用**(關卡1 `:207`) | 2c 一開就會**真的送錢**,而送錢的**主路徑產物是 `result_unknown`**(核心點 4)。2d 沒上 ⇒ 那些未知態**沒有任何人處理**,而它們正是「錢可能已經出去、帳上不確定」的那一族。⇒ **2c 上線但 flag 保持 off 可以;flag 轉 on 之前 2d 必須在跑。** |

**rollback(逐片,且要面對「錢已經出去了」)**
- 2a-1 / 2a-2 / 2d 的 migration:forward-only。🔴 **各片的 rollback 敘述是該片開工的硬前置** ——
  沒有可執行 rollback 敘述的片不准開工(本 plan 不代寫,但這是驗收條件)。
- 🔴 **應用層 rollback 的不可逆邊界**:已寫 `sent`、或落 `result_unknown` 的 refund,
  **錢可能已經在外面動了** ⇒ rollback 應用層**不等於**回到原狀。
  硬規則:**回退後仍必須有人對帳** —— 開關關掉的是「開新 refund」,不是「對帳既有未結案 refund」;
  後者在回退狀態下改由人工佇列承接。
  🔴 **v4 補(關卡1 `:238`):「人工佇列承接」目前是一句空話,要落成可執行的四件事**,
  否則回退後沒有人知道要看什麼:
  ① **一條可貼 SQL Editor 的查詢**(列出所有未結案 refund + 其 attempt/order + 最後事件);
  ② **一個入口**(後台頁或值班 runbook 段落),不是「去問工程師」;
  ③ **一個責任人**(值班角色,不是「大家」);
  ④ **一個告警**:未結案 refund 存在超過 N 小時就叫,否則回退後它會安靜地躺著。
  **這四件是 2d 的驗收條件**,不是「之後再說」。

---

## 3. 🆕 與 B-419 四項前置的界面(v3 新增;對齊信 = P-353-NOTE)

| B-419 前置 | 關係 | 本片的立場 |
|---|---|---|
| ① 應收 D 金額級重算 | **無交集** | 本片退款額走 `record.amount`(`refund-baseline.ts:111`)= **付款軌的數**,不經品項/折扣/運費重算 ⇒ 前置① 的四個待拍**不擋本片** |
| ② 已退 R 事實權威 | 🔴 **本片是供給者** | 見 §3b(**v3 這格的口徑是錯的,已撤回並更正**)。join 鍵(`payment_refunds.rec_trade_id`)**由 2a-2 補**,OP6 線不要再開第二支 ALTER |
| ③ 取消政策三處耦合 | **無交集** | 本片不讀不寫 `payment_status`、不碰取消資格 |
| ④ writer 鎖與部署契約 | **交集,已對齊** | 本片鎖序見核心點 3a;射程只到「**寫帳**」,不重算、不寫狀態 |

**🔴 本片零 `payment_status` 寫入的證據**:`20260810140000` 全檔 `payment_status` **零命中**(實 grep)。
⇒ **L5b-2 是 OP6 的上游供給者,不是它的下游相依。**

### 🔴 3b. 「已退 R」的正確述詞 —— **v3 這一格是錯的,已對外撤回**(關卡1 `:253`)

**v3 寫**:「terminal 集合 = `result_success / result_failed / manual`;OP6 讀卡軌 R **引用本片述詞**。」
**錯在**:那個集合來自 `20260810140000:137-138` 的 **`pre_one_terminal_uniq`** —— 它是一道**唯一性索引**,
語意是「**一顆 refund 只能有一個終局事件**」,回答「**這次嘗試結案了沒**」,**不是**「**錢有沒有退出去**」。

🔴 **致命處在 `result_failed`**:照本片核心點 4,它專指 `TapPayRefundNotSentError` =
**adapter 保證 fetch 零呼叫 = 錢確定沒動**。⇒ 拿整個 terminal 述詞加總「已退 R」
**會把確定沒退的錢算成已退** ⇒ 判成「已結清」⇒ 錢卡在我們這邊而狀態顯示正常。

| 事件 | 對「已退金額 R」的貢獻 |
|---|---|
| `result_success` | **計入**(TapPay 已受理;⚠️ 仍受 §4a-② 的 T+N 再確認約束) |
| `result_failed` | **0 —— 確定未退**,不是未知 |
| `result_unknown` / `reconcile` | **未知** ⇒ 既不能算 0 也不能算已退 ⇒ **fail-closed:回「需人工」,不給數字** |
| `manual` | 值域**尚未定義** ⇒ 2a-2 定死前,**OP6 不得自行解讀** |

⇒ 一句話:**「結案」與「已退款」是兩個述詞,`pre_one_terminal_uniq` 的 `WHERE` 只給你前者。**
(已於 2026-08-11 撤回原釘、對主視窗與 B 線落新口徑;B 的 OP6 尚未動工,零下游污染。)

### 3a. Sean Q5(OP6 排程 A/B/C)之下的分岔

> **2026-08-11 更新**:Q5 有答案了,但**它是解讀、不是逐字**。
> Sean 原文打的是「**apply**」,主視窗讀成 **C(照推薦=OP6 只偵測不寫入)** 並已留一行否決窗。
> ⇒ 本節**維持分岔表不刪**:C 那列是目前的工作假設,A/B 兩列留著,否決窗一旦被行使就直接切換。
> **重驗結論(照 P-353-NOTE §6 的承諾)**:C 之下 OP6-a 是純算函式、不碰狀態
> ⇒ 「本片零 `payment_status` 寫入」**仍然成立**(證據見本節末)⇒ **片界不動**。

| Q5 | 對本片的影響 | 本片要改什麼 |
|---|---|---|
| **A**(先補四項前置再做 OP6) | 本片成為前置② 的**交付的一部分** | **排序往前**,並在 2a-2 的 COMMENT 明寫「本表 terminal 述詞 = OP6 卡軌 R 的權威來源」 |
| **B**(OP6 整條延後) | 本片**不受影響** | 無 |
| **C**(只偵測不寫入) | 本片**不受影響**(OP6-a 純算函式不碰狀態) | 無 |

🔴 **這張表的失效條件**:上面三格都建立在「本片零 `payment_status` 寫入」這條**時點觀察**上。
若 Q5 的裁示要求「退款成功 ⇒ 順手翻 `orders.payment_status`」,本片就從供給者變成**狀態 writer**,
前置③④ 立刻全部上身、片界要重估。⇒ **Q5 答案到了先重驗這一句,再決定要不要改片界。**

---

## 4. 誠實邊界

### 4a. L5b-1 交辦的五條,在本片變成什麼
| # | L5b-1 說 DB 擋不住 | 本片的機制 | 突變 |
|---|---|---|---|
| ① | 未知態禁重試(開新根 **或**沿鏈接手) | 寫入 RPC 在**鎖下**重驗無未結案 refund(核心點 5);兩種形狀各擋 | 拿掉檢查 ⇒ 兩發負測各自紅;另加**兩連線同時開根**的並發負測 |
| ② | write-ahead 順序 | 父列 + `sent` **同一交易 commit** 後才呼 adapter | 把 adapter 呼叫移到 commit 前 ⇒ crash-after-send 情境必紅 |
| ③ | Σ 超退上界 | 讀 Record(`refund-baseline.ts:111`) | 改讀本地加總 ⇒ 必紅 |
| ④ | 目標限「讓路過的 attempt」 | 核心點 2 條件 1 | 拿掉 ⇒ **母 plan §5-5 那條最重要的測試**必紅 |
| ⑤ | lease token 當前性 | 寫入 RPC 在鎖下比對 attempt 當下 `settle_attempt_count` | 拿掉比對 ⇒ 過期 token 寫得進 ⇒ 必紅 |

### 4b. 本片自己新增的殘餘風險(**沒有機制,不宣稱擋住**)
- **外部 Portal 並發退款**:有人在 TapPay 後台手動退,本地看不到(核心點 3b)。
- **Record 觀察與送出之間的時間差**:無法消除(外部系統),只能縮短。
  🔴 **v4 更正(關卡1 `:293`)**:v3 寫「靠鍵的 at-most-once 兜底」= **超稱**。
  at-most-once 是**綁在同一把 `bank_refund_id`** 上的 —— 它只擋「**同一把鍵重送**」。
  Portal 手動退款、或 admin 線用**它自己的另一把鍵**送出時,**完全不兜底**。
  ⇒ 這裡沒有兜底,只有「不要自己重送同一把鍵」這個較弱的保證。
- 🆕 **admin 側尚未加共同否決條件前,雙退只被單向擋住**(§3a-5):
  本片會檢查 admin 那本帳,但 admin 線不會檢查本片這本 ⇒ **admin 先送、本片後送**會被擋;
  **本片先送、admin 後送**擋不住。要雙向就得動已上線的 `initiate_order_refund`(另批)。
- **`accepted` ≠ 錢已退**(隔日生效)⇒ 本地 `result_success` 只代表「已受理」。
- **L5a-1 harness 的射程**:見 §0b,只涵蓋 public 函式面、沒掛 CI。
- 🆕 **B1a 每 6h 重領**(核心點 6-②)⇒ 白打的 Record 呼叫,本片不治。
- 🆕 **L5b-0 的能力天花板**:三閘只保證「經由那三支 RPC 的路徑」,不是 DB 全域不變量
  (`20260810170000:29-32`)⇒ owner 直接 UPDATE 造出的讓路款,本片的觸發條件一樣看不到。

🔴 **本清單一樣可能不完整**:它是「已知擋不住」的列舉,不是「其餘全部擋得住」的證明。

---

## 5. 測試設計(反恆真;每條守門配自己的突變)

1. 核心點 2 的**十三條**合取各一發突變,驗收形狀照 §核心點 2 的 v4 版:
   **①該條專屬負測必紅 ②存在至少一格在拿掉別條時不紅**(證明非被嚴格蘊含)。**紅的總格數不設上限。**
   🔴 **「每發只紅一條」已於 v4 撤回,不得放回**(它不可滿足,見 §核心點 2)。條件 3 拆 3a/3b、新增 11-13 各自要有突變。
   身分閘那七條(條件 2-8)各一發:queryStatus 異常 / 錯筆數 / 錯 rec / 錯幣別 / 錯 record_status /
   缺 refunded_amount / amount=0。
2. 🔴 **誤退主測**(母 plan §5-5):`superseded_at IS NULL` 但 Record 顯示 AUTH ⇒ **不得退**。
3. 🔴 **冪等**(母 plan §5-6):同一筆補償跑兩次 ⇒ 只退一次;拿掉 durable 帳 ⇒ 退兩次、該條紅。
4. ✅ **並發:同一筆補償意圖不重開**(不是「同 attempt 只能一根」)。
   兩條連線同時對**同一顆 attempt 跑補償** ⇒ **恰一條真的送款**。
   🔴 **正向對照必配**:**合法的第二次部分退款要能成功**(§3a-8)—— 少了它,這格會獎勵「把多根一律擋掉」的錯解。
5. 🔴 **跨線互斥(v6 重寫;v5 那格證不了 advisory)**:一條跑 `admin_initiate_order_refund`、一條跑補償。
   ⚠️ **v5 的舊格模擬與消融的是「`orders` row lock」—— 那條鎖 v6 已經不存在了**
   ⇒ 舊格不只證不了 v6,**還會逼實作者把已撤回的反向鎖加回去**(R3 `:649`)。**整格作廢重寫。**
   **斷言**:醒來的第二條**被否決條件擋下**,且**整場只出現一筆對外送款意圖**(adapter 呼叫計數 = 1)。
   **兩發消融各自要紅**:①拿掉**任一方**的 advisory ②拿掉共同否決條件。
   🔴 **只拿掉補償那一側的 advisory 也必須紅** —— 這格才證得到「兩方都排隊」,而不是「補償自己排」。
6. 🔴 **人工 close 與自動補償並發(§3a-5)**:**兩個方向各跑一次**,結果只能二選一。
   🔴 **必配一發專屬消融**:把 ③ 的 advisory **移回 `FOR UPDATE` 之後**(= v5 的錯誤寫法)
   ⇒ 必須能觀察到 **40P01**。**構造不出 40P01 = 這格沒有判別力**,不得宣稱 v6 修好了死結。
   🔴 另配一格釘 §3a-5 的承重假設:**`payment_charge_attempts.order_id` 不可變**
   (突變:讓某處 UPDATE 它 ⇒ 該斷言必紅)。無鎖讀的正當性整個建立在這條上。
7. 🆕 **凡以 unique 違反當 oracle 的負測,一律驗 constraint name、不只驗 SQLSTATE**(關卡1 R2 `:536`)。
   `23505` 是所有 unique 撞號共用的碼 —— 冪等鍵撞號、任何其他索引撞號都長一樣
   ⇒ 只比 SQLSTATE 會**把別的失敗誤判成守門生效**(恆真的一種)。
8. **adapter 三態分流**:`NotSentError` / 一般 throw / accepted 各一,**各自只紅對應那條**。
   🔴 兩者都「沒成功」,但一個確定未送出、一個必須對帳 —— 混在一起 = 對帳路徑會被誤觸發或漏觸發。
9. **一次插一列**:斷言 **round-trip 不變量**(一次呼叫只新增恰一個父列),
   **不用** `INSERT … SELECT` 突變當 oracle(順序不保證 = 不穩定測試)。
10. **觀測性**(母 plan §5-7):每次自動裁定與每次自動退款各留一行零 PII log。
   沒有它,「補償在跑」與「它死了」在觀測上一樣。
11. 🆕 **義務① 的收斂**:補償成功 ⇒ 人工待確認計數**真的下降**。
12. 🔴 **第四方硬閘(R3 `:698`)**:目前確實沒有 A7b worker / refund cron / refund trigger,
    但**只有文字提醒 = 它一落地就是第四個繞過隊伍的 sender**。
    ⇒ **做成守門**:斷言「public 函式面**寫入 `payment_refunds` 的本體**恰為已知集合」
    (形制照 L5a-1 對 `superseded_` 那道,`20260809230000` 檔頭自陳其射程)。
    新增任何寫入者 ⇒ **該斷言紅**,逼它先回答「有沒有排隊、有沒有查否決條件」。
    ⚠️ **誠實邊界照抄先例**:此類斷言**只涵蓋 public 函式面**,擋不住 trigger / 動態 SQL / owner 直接 INSERT
    ⇒ 它降低機率、不是不變量,**不得寫成「不可能有第四方」**。
   🔴 這格要對著 `get_payment_anomaly_alert_summary` 的**實際回傳**驗,不是對著本片自己的變數
   (memory `feedback_assertion-measures-the-wrong-thing` 第四形狀:中間透傳一跳無人守)。

---

## 6. 決策題

**零題。**
v2 唯一那題(核心點 1 的 A/B/C)**已由 Sean 拍 A 並已交付**(§1);
核心點 3 的跨線互斥跟著同一個拍板走(逐字「跨線雙退=鎖 orders 列」)⇒ 不另立題。

**我自己決、不佔 Sean 停點的**(理由都寫在對應段落):
- 重試出口 = **無短期上限 + 連續失敗即告警**(母 plan 原案 + 觀測性)。
- 2a-1 走 **`DROP`+重建**加寬回傳,而非另開 claimer(§2a-1 v4 重估)。
- 🔴 ~~義務① 用既有 `close_released_attempt` 結案~~ **已於 v4 撤回** —— 它 owner-only 且稽核語意相反,
  改成動**讀取面**(核心點 6 v4 版、片 2e)。**照本段舊字面實作會重走已撤回的死路。**

### ✅ 6a. R2 判停的那題 —— **Sean 2026-08-11 已裁 Q8=A**

**經過**:關卡1 R2 = FAIL(20),其中 **12 條標 `[R1 重複]`** ⇒ 命中 `00-work-rules §5` 判停條件
(「某輪的 finding 開始重複前輪 = 方向問題」)。其中 4 條純屬我沒把改動傳播到全文(已修),
**另 8 條的解全部落在「動兩支已上線金流 RPC」** ⇒ 屬 Sean 的範圍決定(鐵則 8 + R3),不硬折,上決策題。

**裁示 = A(一次做對)**:同批修那兩支,三方走同一序列化點(advisory lock、**不改邏輯述詞**)。
B(只做一半、認列雙退殘餘風險)與 C(改一鍵人工退)**皆否決**。

⇒ **本片自此沒有待 Sean 的決策題。** 落地形狀見 §3a-4 ~ §3a-7、片表見 §2。
⚠️ 仍需 Sean 批的是**流程停點**(不是新題):各 migration 的 apply、以及 env flag 由 off 轉 on。

## 7. 本 plan 尚未涵蓋(誠實列)
- 各片 RPC 的**具體參數與回傳碼集**:留給各片自己定(本 plan 不代寫)。
- A7b 的 worker(母 plan「第 3 批」)**還不存在**(全 repo 只有 `SupabaseOrderAdapter` 讀 `order_refund_jobs`);
  若它之後也退同一筆授權,與本片的互動要另外設計。本片**不預先解**,只在 2a-2 檔頭留指標。
- 對客通知(退款發生要不要通知客人)屬 M-4a Email 線,不在本片。
- 🔴 **`strong_key` 的值域從未被定義**(`20260810140000` 欄宣告與 L5b 設計 plan 兩處都只寫
  「Record 比對用的強鍵」),而母 plan §5-5 的「強識別」是 **rec 或 bank_txn 其中之一**
  ⇒ 本片**不拿它當 join 鍵**(會靜默對不上);值域在 2a-2 定死並配 CHECK,**列為該片驗收條件**。
- 🔴 `record.amount` 的**單位**未確認(核心點 2 末段)⇒ 2a-2 開工硬前置。

---

## 8. 附錄 A · `settleCharge` 完整呼叫面地圖

> **為什麼要這一節**:核心點 1 拍 A(中央守門)⇒ 驗收要證「**合法情境沒有被誤擋**」,
> 而那要對著這張表逐個入口配正向測 —— 只測「superseded 被擋」只證守門會叫,不證它沒誤傷。
>
> **產生方法(可複驗)**:
> `grep -rn "settleCharge(" apps packages --include="*.ts" --include="*.tsx"`
> → 排除 `*.test.*` → 排除行首為 `//` / `*` → 逐筆開檔確認是呼叫而非宣告。
> ⚠️ **不要用 `grep -l`**(命中「檔案裡出現過」,註解與型別引用都算;
> memory `reference_grep-keyword-count-includes-comments`)。
>
> **2026-08-11 重跑結果:11 命中 − 1 定義(`settle-charge.ts:45`)= 10 個呼叫端,與下表一致 ⇒ 未過期。**

### A1. 直接呼叫(生產路徑;**7 處 / 6 檔**)
| # | 位置 | 情境 |
|---|---|---|
| 1 | `apps/storefront/src/app/checkout/reconcile-actions.ts:101` | 客人端對帳 action |
| 2 | `apps/storefront/src/app/checkout/callback/page.tsx:125` | 3DS callback 落地頁 |
| 3 | `apps/storefront/src/app/checkout/charge-actions.ts:391` | 結帳扣款 action(**同檔第一處**) |
| 4 | `apps/storefront/src/app/checkout/charge-actions.ts:538` | 結帳扣款 action(**同檔第二處** —— 以「檔」為單位數會少算) |
| 5 | `apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts:191` | TapPay webhook |
| 6 | `apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts:139` | 前台輪詢付款狀態 |
| 7 | `apps/storefront/src/lib/payment/composition.ts:165` | 🔴 **port 實作、不是終端**:`settle: (input) => settleCharge(getSettleChargeDeps(), input)` |

### A2. use-case 層直接呼叫(**3 處 / 2 檔**)
| # | 位置 | 情境 |
|---|---|---|
| 8 | `packages/use-cases/src/sweep-settlements.ts:173` | 步② inbox |
| 9 | `packages/use-cases/src/sweep-settlements.ts:211` | 步③ stuck |
| 10 | `packages/use-cases/src/reconfirm-expired-orphans.ts:96` | B1a 孤兒重確認 —— **但不在風險面,見 A4** |

### A3. port 扇出的終點(**有界、已窮舉**)
`composition.ts:165` 的 `settle` port **只有一個消費者**:`getPreflightReleaseSiblingDeps()`
(`composition.ts:161`)→ 注入 **`packages/use-cases/src/preflight-release-sibling.ts`** → 該檔內**兩處**呼叫:
`:91`(active 兄弟單)與 `:153`(rowcount=0 重 settle)→ 唯一入口 `charge-actions.ts:215`。
⚠️ **路徑要寫全**:這支住在 `packages/use-cases/`,**不在** `apps/storefront/src/lib/payment/` ——
v2 只寫檔名,而我 2026-08-11 複驗時就照著猜錯了一次。
⇒ **扇出終點就這兩處,沒有第三個。**

### A4. **不在**風險面的(附證據)
| 位置 | 為什麼不算 | 證據 |
|---|---|---|
| `apps/storefront/src/app/api/cron/settle-sweep/route.ts:5` | **是註解**,該檔只呼 `sweepSettlements` | v1/v2 都誤列成呼叫端 |
| `packages/use-cases/src/settle-charge.ts:45` | **是函式定義本體** | `export async function settleCharge(` |
| `reconfirm-expired-orphans.ts:96` | 真呼叫,但其 claim RPC 述詞是 `WHERE a.status = 'pending'`,碰不到 superseded(superseded ⇒ `released`) | `20260627120000:90` 該行註解逐字「隱含排除 released/charged/failed(**released 不進 B1**)」 |
| `packages/ports/*` / `packages/domain/*` / `TapPayChargeAdapter.ts:494` | 全部是註解或型別引用 | 逐行判斷行首 |

### A5. 失效條件
新增任何 `settleCharge(` 呼叫、或給 `settle` port 加第二個消費者,本表即過期。
🔴 **沒有機制擋住它過期**(沒有 CI 守門數呼叫端)⇒ 引用本表前先重跑 A 節開頭那條 grep。

---

## 9. 🔴 v1 / v2 錯在哪(不刪除,供追線)

### v1 的四條(都是我自己造的事實錯誤)
| # | v1 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 1 | 「併進 sweeper 步③ ⇒ 結構上不可能輪流」 | `settleCharge` 有 10 個呼叫端,步② inbox 也直呼 | 看到步③ 有那個實例,就把守門畫在那裡(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`) |
| 2 | 「2c 只動 use-case」 | claim RPC 回傳沒有 `superseded_at` ⇒ 要連動 RPC/型別/port/adapter | 報片界前沒開 RPC 的回傳宣告 |
| 3 | 「兩條線都讀 Record ⇒ 順帶解掉互相看不到」 | 讀同一個 Record 不序列化並發讀者 | 把「同一個資料來源」當成「同一個序列化點」 |
| 4 | 「A7b 已經是以 Record 算剩餘額那形狀」 | A7b 只存 `target = before + amount`(`20260731120000:249-252` CHECK 本體) | 從欄位名推斷計算方式,沒開 CHECK 本體 |

### 🆕 v2 的四條(v3 修掉;**全部是 2026-08-11 落筆前的機械複掃抓到的**)
| # | v2 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 5 | 「鎖型別**只有** `FOR NO KEY UPDATE` 一種寫法、**不要**用 `FOR UPDATE`」 | repo 契約分兩層:`orders` 用 **`FOR UPDATE`**(OP5 `:208` / A12 `:128`,A12 `:34` 逐字「沿用 OP5」),NKU 是給**被 INSERT 指到的 FK parent**(A12 `:135`) | 把一條**有前提的**契約(a2b1 的 FK parent 情境)讀成**無條件的**全域規則,而且沒去開 OP5/A12 看鄰居實際怎麼寫。**引用了規則,沒引用規則的射程** |
| 6 | 產號式子抄成裸 `gen_random_bytes(16)` | 逐字是 **`extensions.gen_random_bytes(16)`**(`20260803150000:545`) | 🔴 **這條會真的壞**:本片的 writer 是 `SET search_path = ''` 的 SECDEF,照 v2 抄進去**找不到函式**。抄「式子」時把 schema 限定當成雜訊濾掉了 |
| 7 | `refund-actions.ts:200-215`,`:200` 註解逐字「帳先記、後打 API」 | 那句在 **`:220`**;`:200` 是 `adapter.recordQuery(` | 行號憑印象,沒開檔對 |
| 8 | 扇出終點只寫檔名 `preflight-release-sibling.ts` | 它住 **`packages/use-cases/src/`**,不在 `apps/storefront/src/lib/payment/` | 不算錯字面,但**不可定位** ⇒ 我自己複驗時就照著猜錯一次。⇒ 本檔規定:路徑一律寫全 |

🔴 **這四條的共同觀察**:v2 已經寫了「每句附計算本體行號」的機械步驟,**而且我當時照做了** ——
錯的是**沒有在落筆後再機械複掃一次**(memory `feedback_knowing-rule-is-not-executing-rule`:知道規則不等於執行規則)。
⇒ v3 新增硬步驟:**送審前跑一次 `sed -n "${n}p"` 逐條複掃所有 `檔案:行號`**。
**本次複掃的戰果**(逐條 `sed -n "${n}p"` 開檔對,不憑印象):
- 從 v2 帶過來的引用:**2 條真錯**(上表 6、7)+ **1 條不可定位**(上表 8);其餘逐條命中。
- **v3 自己新寫的 4 條全錯**(`20260810220000` 的 `:72-73` / `:76-80` / `:81-82` / `:246-247`)——
  病根是把 `awk`(**無行號**)的輸出與 `grep -n`(**有行號**)的輸出記混、把後者的號套到前者的內容上。
  ⇒ 已就地修。🔴 **教訓不是「要小心」,是「抽內容的工具若不吐行號,就不准拿它的內容配行號」。**

### 🆕 v3 的三條(v4 修掉;**都是關卡1 R1 打中、我親驗為真**)
| # | v3 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 9 | 2a-1「claim RPC 回傳加 `superseded_at`」,還特地論證它比另開 claimer 省 | PG **不准**改既有函式回傳型別(`42P13`)⇒ 必須 `DROP`+重建 + GRANT 還原 | 🔴 **反證在我自己手上**:我寫的 L5b-0-s 就是 `CREATE OR REPLACE` 且刻意沒動回傳形狀(`20260810220000:210`)。我讀過、引用過那一行,**卻把它讀成風格而不是限制** |
| 10 | 核心點 6「沿用既有 `close_released_attempt` 結案,不新寫 RPC」 | `20260624120010:143` REVOKE ALL、`:165` 自檢「4 角色零 grant」⇒ **owner-only 呼不到**;且 `:13-15` 的契約是**人工確認未扣款**,與「已接受退款」是**相反的事實** | 只看「有沒有一支現成的做同類事」,**沒看它的權限邊界與稽核語意**。省事的選擇裡藏著兩個獨立的致命傷 |
| 11 | §3a 鎖序 `orders FOR UPDATE → attempt NKU` | `20260624120010:25-27` 逐字:全庫無死結論證的前提是「**沒有人同時鎖 orders 又鎖 attempt**」⇒ v3 正是那個人,會與 close/R1b2/genesis 構成 A-B/B-A | 我在**同一份文件**裡才剛自我修正過「引用規則沒引用射程」(§9-5),然後**又犯一次** —— 這次是引用了 a2b1 的鎖型別契約,沒引用「它在講哪一對鎖」 |

### 🆕 v4 的一條(R2 打中;**本份 plan 第三次同型**)
| # | v4 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 12 | `pr_one_root_per_attempt`:「一個 attempt 最多一條根鏈」,還論證它「恰好對」 | **違反已 apply 的 schema 契約** —— `20260810140000:59` 逐字「**部分退款多次 = 多條根鏈,各自帶自己的金額**」⇒ 合法的第二次部分退款會吃 `23505` | 我把「重試鏈」當成多列的**唯一**來源,推出「非根必有 `supersedes_refund_id`」。**但多列還有第二個合法來源=多次部分退款,而那句話就寫在我引用過的同一個檔案裡**。⇒ **讀了那個檔、引用了那個檔、卻沒讀到旁邊那一行** |

### 🆕 v5 的四條(R3 打中;v6 修掉)
| # | v5 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 13 | 「Q8=A ⇒ 那四條 finding **全部解封**」 | **Q8 批准的是範圍,不是技術正確性** | 🔴 **我在 R3 prompt 裡親手設了角度④「有沒有把拍板當技術背書」,然後自己就是那個案例。** 知道要查、也叫別人查了,**輪到自己落筆時沒套用** —— [[knowing-rule-is-not-executing-rule]] 的最乾淨標本 |
| 14 | 「三方都把 advisory 取在**第一個觸資料動作**」 | `close_released_attempt` **只收 `attempt_id`**,必須先讀才知道 `order_id` ⇒ 對它**物理上做不到**;照 v5 字面反而構成 40P01 | 我把「三方對稱」當成前提,**沒去看第三方拿不拿得到那把鍵**。對稱是我腦中的形狀,不是它們的簽章 |
| 15 | 「唯一列鎖是 attempt `KEY SHARE`、最後取 ⇒ **構造上不可能成環**」 | writer 還要插 `payment_refund_events`(FK)、重試根還有自我 FK ⇒ **鎖清單不完整** | 全稱句(「不可能」)配一份**沒清點完的清單**。改成「本 writer 不引入新的環」這種**可證的弱宣稱** |
| 16 | 否決條件寫「未結案**或已成功**」 | 「已成功」那半會**永久封死合法的第二次部分退款**,且與同檔 §3a-8 **直接矛盾** | 把兩件事(**擋併發重複** vs **擋總額超退**)混進一句話。後者本來就由 Record 剩餘額擋,寫進否決條件是重複且有害 |

### 🆕 v6 的兩條(R4-Fable 打中;v7 修掉)
| # | v6 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 17 | ② 的順序錨=「參數驗證 → **既有冪等樹** → advisory → 否決」 | `20260803150000:419-422` 逐字:**`3 鎖訂單` 在 `4 冪等查驗` 之前** ⇒ 照 v6 放 = 持列鎖等 advisory,**AB-BA 40P01 重生** | 🔴🔴 **與上表 14 同構,而且是同一份文件、隔一版、換一支 RPC**:**寫錨之前沒開本體**。14 是對 ③ 犯的,我把它寫成教訓之後,**對 ② 又犯一次** ⇒ 證明「記下來」不等於「下次會做」;真正缺的是**落筆前的機械步驟**(要寫某支的順序 ⇒ 先 `grep -n` 它的檢查順序註解) |
| 18 | 「Σ 超退由 **Record 剩餘可退額**擋」 | Record 在**鎖外**讀、write-ahead 下 **API 在 commit 後**才打 ⇒ 併發交錯時本地值可能過期;**真正的最後防線是 TapPay 伺服器端原子拒絕**(已實測) | 把「我讀到的數字」當成「當下的事實」。分散式邊界上,**讀值的時點與用值的時點之間**永遠有窗口 —— v6 對這個窗口零著墨 |

### 🆕 v7 的一條(R5-Fable MF1;v8 修掉)
| # | v7 寫的 | 實查事實 | 病根 |
|---|---|---|---|
| 19 | 成組回退做成「rollback 腳本**第一行** abort 斷言」 | 本 repo 的 rollback 慣例是**檔尾座標 + 逐句手動執行**(`psql -f` autocommit、無 `ON_ERROR_STOP`)⇒ `DO … RAISE` **之後每一句照跑**,閘被滾過去。**已實跑**:散跑靶表 **1** 列、包成單一交易 **0** 列 | 🔴 我把 prose 升級成斷言(方向對),**卻沒問那個斷言在「它將被執行的方式」下有沒有效力**。這是 [[guard-checks-existence-not-effect]] 的變形:守門存在、也會 RAISE,但**執行環境讓它的 RAISE 沒有後果**。⇒ 教訓:**寫守門時要連「它會被怎麼跑」一起指定**,否則等於沒寫 |

**共同病根**:憑欄位名、鄰近註解或記憶中的規則斷言機制行為,沒開計算本體。
🔴 **v3 那三條(9/10/11)另有一個更精確的病根**:我的自核只覆蓋「**引用正不正確**」,
**完全沒覆蓋「這個做法在 PG / 在既有 ACL / 在既有鎖序下做不做得到」** ——
**那是兩種不同的檢查**,而我一直只做前者。已寫進檔頭當 v4 的固定步驟。
**機械步驟**(檔頭):每句「X 已經是 Y」附計算本體行號,附不出來就寫未確認。

— P 窗五代,2026-08-11
