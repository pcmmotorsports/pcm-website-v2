# L5b-0 · 讓路入帳鐵律:拒絕 superseded attempt 被認列成收款(plan **v6**)

> **狀態**:R1 FAIL(14)→ v2 → v3 片界定案 → v4 折甲 → R2 FAIL(17+1)→ v5 →
> **R3(Fable、換角度)FAIL 7MF+3nit → v6 折完,待 R3 複核**。
> 🔴 **R3 的結論值得記住**:三輪下來,**設計本體(三道閘 + 甲)四個角度都站得住、無新回歸**;
> R3 的 7 條**全部落在 plan 文字層**,其中 5 條是**突變預期向量算錯** ——
> 換模型換角度抓到的正是前兩輪(同一框架)看不見的那一類。
>
> ## ⛔ 檔頭:關於本檔的可信度(v5 撤回 v3/v4 的一句話)
> v3/v4 §1 寫過「**全部本 session 親開計算本體**」——**那句話不成立,已撤回**。
> R2 抓到:甲要改的兩支,我引的都不是活本體(一支落後兩版、一支**已被 DROP 的多載**)。
> 病根是查證方法本身,修法見 **§1.0**。**本檔任何 `檔案:行號` 都要照 §1.0 那條命令複驗才算數。**

> **拍板紀錄**
> - Q1=**A**:`mark_charge_attempt_charged` 原子拒絕 `superseded_at IS NOT NULL`;B(10 呼叫端各自加閘)否決。
> - §1-OPEN=**A**(MAIN-027-A):閘**同時**畫進 `confirm_order_payment`(第二支已上線金流 RPC,鐵則 12 全鏈)。
> - §4 代價=**A 認列**(MAIN-025-A);告警口徑更正見 §4。
> - §3.5=**甲**;範圍**批准動 3 支 RPC**(含唯讀告警聚合)。
> - 正式庫 `superseded_at IS NOT NULL AND status='charged'` count = **0**(Sean 17:5x 親跑;**時點觀察**)。

- **片型**:高風險片(鐵則 12 ①錢 ③DB)。**分級 L1**。**鐵則 8**:本檔即等批文件。

---

## §0a 核心原則

1. **要守的是「錢的歸屬」,不是「麵包屑」。** 被讓路的 attempt 對應**舊訂單**,錢的正確出口是退款。
2. **守門畫在不變量成立的面**(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。
3. **fail-closed**:分不清就讓錢卡著等人看。
4. 🔴 **能力天花板(v5 撤回絕對宣稱)**:本片**不是** DB 全域不變量。
   沒有 trigger、沒有表級 CHECK 能表達它(跨表、且 `superseded_at` 與 `status` 在同一列但判斷要 join orders)。
   ⇒ 本片保證的準確說法是:**「經由這六支 RPC 的路徑不會認列讓路款」**。
   **繞得過的**:owner / postgres 直接 `UPDATE`、未來新增的 SECDEF 函式、psql 手動修資料。
   **失效條件**:出現第七支會寫 `status='charged'` 或 `orders.payment_status='paid'` 的物件 ⇒ 本片守門面即不完整。
5. **本片只關門,不開退款線**;開門的是 L5b-2。

---

## §1 現況

### §1.0 🔴 查證方法(v5 新增;上一版就是死在這裡)
找「活本體」**不能**用 `grep "CREATE OR REPLACE FUNCTION"`,兩個盲點會漏:
① **`CREATE FUNCTION`(無 OR REPLACE)不命中** —— #256 就是這樣新建多載的;
② **多載是不同函式** —— 同名不同簽章並存,「找到一支」≠「就是它」。
```
grep -rn "^CREATE \(OR REPLACE \)\?FUNCTION public\.<fn>(" supabase/migrations/*.sql
grep -rn "DROP FUNCTION .*<fn>" supabase/migrations/*.sql
```
**取檔名時間序最後一支 → 核對簽章 → 核對 app 端呼叫的參數個數 → 檢查有沒有被 DROP。**

### §1.1 六支物件的活本體(用上面那條命令產,v5 全部重驗)
| 物件 | 活本體 | app 端呼叫點 | 備註 |
|---|---|---|---|
| `mark_charge_attempt_charged(uuid,uuid,text)` | `20260624120005:64` | `PgChargeAttemptAdapter.ts:76` | |
| `mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)` | `20260612150000:351` | `SupabaseChargeAttemptFallbackAdapter.ts:33` | |
| `confirm_order_payment(uuid,integer,text)` | `20260810160000:328` | `PaymentConfirmerAdapter.ts:128` | 今日 OP3 才改過 |
| `claim_stuck_unsettled_attempts(integer,integer)` | `20260624120008:80` | sweeper | |
| **`mark_attempt_settle_retry(uuid,integer,text)`** | 🔴 **`20260809140000:89`** | sweeper | v4 引 `20260624120008:126`=**落後兩版**(中間還有 #251 `20260702120000:50`) |
| **`get_payment_anomaly_alert_summary(integer,integer,integer)`** | 🔴 **`20260701130000:43`** | `PgAnomalyAlertReaderAdapter.ts:53`(三參數) | v4 引的**單參數多載已在 `20260701130000:41` 被 `DROP FUNCTION`** |

### §1.2 事實表
| # | 事實 | 計算本體 |
|---|---|---|
| 1 | 主軌現行轉移 `status IN ('pending','released') → 'charged'` | `20260624120005:106-110` |
| 2 | `released` 分支同交易建 open 雙扣 anomaly | `20260624120005:118` + `:128-152` |
| 3 | `superseded_at` 欄(nullable、無 DEFAULT) | `20260809230000:109` |
| 4 | L5a-1 把 attempt `pending → released` 同交易蓋標記;**零等待、無年齡條件** | `20260810010000:261`、`:274`;COMMENT `:295` |
| 5 | 🔴 `confirmPayment` 繞過主軌閘:markCharged 失敗**只 log 續走**,下一步 confirm 標 paid | `confirm-payment.ts:107-130` → `:141` |
| 6 | markCharged throw ⇒ settleCharge 回 `pending/record_unreachable` | `settle-charge.ts:428-432` |
| 7 | settleCharge 的 markCharged 是**主軌-only**(不是雙軌) | `composition.ts:123-129` |
| 8 | 備軌轉移閘 `status='pending'` ⇒ 對 released 恆拒,**對 `pending`+superseded 無守門** | `20260612150000:408` |
| 9 | per-order 鎖 UNIQUE index predicate **含 released** ⇒ 該 attempt 停在 released 時同單不可能有第二顆 | `20260624120000:62-64` |
| 10 | `close_released_attempt`(owner-only)`released → failed` ⇒ **離開** #9 的 predicate | `20260624120010:121-127` |
| 11 | `released` 繞過 ceiling 與 manual;退避 `make_interval(mins => …)` 封頂 16min | claim `20260624120008:97`;**活本體行號(v6 已逐行複抄)**:退避 `20260809140000:104-105`、ceiling→manual `:111-112`、12h marker `:114`、token guard 的 status 集 `:124` |
| 12 | 告警整條鏈由 env 閘控:`ANOMALY_ALERT_ENABLED !== 'true'` ⇒ 認證後直接 no-op、預設 false。**正式站現值 = `"true"` ⇒ 閘是開的**(主視窗 2026-08-10 18:2x `vercel env pull --environment=production` 實查) | `apps/storefront/src/app/api/cron/anomaly-alert/route.ts:105` |
| 12a | 🔴 **但「閘開著」≠「通知真的會送達」**:cron 排程本身有沒有在跑、通知管道密鑰有沒有配,**主視窗明說沒驗**(誠實邊界) | 未驗 —— 見 §8-2 |
| 13 | `bank_transaction_id` 在 charge **之前** durable(3DS 路徑) | `initiate-payment.ts:93` 先於 `:98`/`:108` |
| 14 | B1a `reconfirm-expired-orphans` 的 claim 述詞 = `a.status = 'pending'` | `20260627120000:90` |

✅ **事實 11 的行號已於 v6 從活本體 `20260809140000` 逐行複抄**(v4 誤抄自 `20260624120008`)。
🔴 **複抄時另外看到一件事,寫下來給實作者**:活本體 `:112` 的 ceiling→manual 條件仍是
`a.status IN ('pending','charged')`(與 `20260624120008:150` 逐字相同)——
**兩版在這一行沒有差異**,所以 v4 的錯**不會在改②的 diff 上顯形**;
真正的差異在 `last_settle_error` 的 allowlist(`:107-110`,#251 與 L2 各加了一個碼)。
⇒ **改② 一定要以 `20260809140000` 全文為 pre-image 重寫**,不能只比對「我要改的那一行有沒有變」。

---

## §2 三道閘(錢面片界)

| 閘 | 物件 | 擋什麼 |
|---|---|---|
| 一 | `mark_charge_attempt_charged` | superseded ⇒ 不得轉 charged(拍板逐字) |
| 二 | `mark_charge_attempt_charged_fallback` | 同上;事實 8 那個洞 |
| **三** | `confirm_order_payment` | **錢的歸屬**:該單仍持鎖的 attempt 帶 superseded ⇒ 拒 confirm |

🔴 **閘三才是不變量的面,閘一二是縱深。三道同一支 migration、不可分批 apply**
(分批的中間態 = 事實 5 那個洞原封不動 = 比不做更差)。

---

## §3 實作形狀

### 3.1 閘一(沿用 `20260624120005` 全文,只動三處)
`SELECT … INTO v_row`(`:88`)擴 `superseded_at`(述詞與 `FOR UPDATE` 不動)→
緊接 `IF NOT FOUND` 之後、**charged 冪等分支之前**插 `IF v_row.superseded_at IS NOT NULL THEN RAISE …` → 換 COMMENT。
理由:charged 分支的 `RETURN`(`:100`)對上游是**成功語意** ⇒ settlePaid 會續呼 confirm(`settle-charge.ts:437`)。

### 3.2 閘二(備軌照畫同一道)
「superseded ⇒ 必為 released」是**寫入端自律、schema 沒強制**(L5a-M 五條 CHECK 沒有這條)。

### 3.3 閘三(`confirm_order_payment`;位置=A8c2 取消守門之後、paid 冪等樹之前)
```sql
IF EXISTS (SELECT 1 FROM public.payment_charge_attempts a
            WHERE a.order_id = p_order_id
              AND a.superseded_at IS NOT NULL
              AND a.status IN ('pending','charged','released')) THEN   -- 與 per-order 鎖 index 同一組
  RAISE EXCEPTION '%', v_generic_msg;
END IF;
```
🔴 **`status` 那條不可省**:少了它會把 L5a-2(重付鈕)**永久擋死**(事實 9+10)。
**失效條件**:per-order 鎖 index 的 predicate 一改,本閘精確性即失效。

🔴 **能力天花板(R2-MF1;v5 新增,不宣稱擋得住)**:
閘三判的是「**這張單**現在有沒有被讓路的活 attempt」,**不是**「這次 confirm 的錢來自哪顆 attempt」。
⇒ 舊 attempt 被 close 成 `failed` 之後,若有人拿**舊 rec** 呼 confirm,**閘三放行**。
- 今天走不到:`settleCharge` 的 rec 取自**當前 active attempt**(`settle-charge.ts:214-219` 的 `buildRecordQuery`
  與 `:195` 的 `tr.recTradeId`),`confirmPayment` 用**本次 charge** 的 `transactionId`(`confirm-payment.ts:141`)。
- **失效條件(命中即回頭補 provenance 綁定)**:出現任何「以人工輸入 / 歷史 rec 呼 confirm」的路徑
  (admin 補登、對帳工具、L5b-2 的補償寫入端)。
- ⇒ 驗收配一格把這個天花板**測成已知行為**(§5.1 格 14),不讓它變成「以為擋住了」。

### 3.4 SQLSTATE:用預設 P0001、不加專屬碼
理由:`settle-charge.ts:428-432` 的 catch 整個吞掉、只回 `record_unreachable` ⇒ 專屬碼**觀測不到**。
⇒ 本片為**純 DB 片**(⚠️ 但見 §3.5 改③ 的 R2-MF4:告警語意改變可能連帶要動 domain 文案,實作時複核)。

### 3.5 甲(可終止性 + 觀測性;**四處協調改動**;原文寫三處,實作時補上改④,見本節末)
字面那一刀(claim 只加 `superseded_at IS NULL`)會讓這族**整個落出 claim** ⇒ 永不再被 claim ⇒
`mark_attempt_settle_retry` 永不跑 ⇒ 連 12h marker 都不寫 ⇒ **無聲消失**。正確 = 四處(①②③ 見下、④ 見本節末):

- **改 ① claim 述詞**(`20260624120008:94-98`)拆三支:
  `(pending/charged 受 manual+ceiling)` / `(released AND superseded_at IS NULL)` 維持繞閘 /
  `(released AND superseded_at IS NOT NULL AND 非 manual AND count<8)` ← 讓路那族回到閘內。
- **改 ② ceiling→manual**:條件加 `OR a.superseded_at IS NOT NULL`。
  🔴 **位置寫死**(R3-nit:那句話有三種擺法、語意各異)——加在 **status 集合那半邊**,`count >= 8` 維持共用:
  ```sql
  needs_manual_review = (a.needs_manual_review
                         OR ( (a.status IN ('pending','charged') OR a.superseded_at IS NOT NULL)
                              AND a.settle_attempt_count >= 8 ))
  ```
  🔴 **pre-image 必須取自活本體 `20260809140000:89`**(v4 取自 `20260624120008` = 會把 #251 與 L2 的
  `record_not_found` allowlist 一起倒掉)。
- **改 ③ 告警計數**:標的是**三參數多載 `20260701130000:43`**(單參數那支**已被 DROP** 於 `:41`,改它等於白改)。
  活述詞 = `needs_manual_review = true AND status='pending' AND order unpaid`(`20260701130000:74-79`)。
  🔴 **放寬要帶 terminal 排除**(R3-MF5),否則**第一筆事故處理完之後告警恆亮**:
  `close_released_attempt` 只翻 `failed`、**不清 `needs_manual_review`**(`20260624120010:121-127`),
  而 `superseded_at` durable、舊單永遠 unpaid ⇒ 已結案的列會**永久**留在計數裡
  ⇒ 第二筆事故的增量淹在底噪 ⇒ **下次災難當天等於沒有訊號**。
  目標式樣:
  ```sql
  WHERE a.needs_manual_review = true
    AND ( a.status = 'pending'
          OR (a.superseded_at IS NOT NULL AND a.status IN ('charged','released')) )  -- 🔴 排除 failed
    AND o.payment_status = 'unpaid'::public.payment_status
  ```
  ⇒ 語意與閘三同源:**只算「仍持有這張單付款權」的那顆 attempt**;結案(failed)即離開計數(格 15)。

**為什麼改③ 非做不可**:退避算下來**首輪後約 63 分鐘**(讓路→首輪還有 5 分 lease ⇒ **讓路後約 68 分**)
就打完 8 輪停止 claim ⇒ 12h 的 `released_manual_review_at` **永遠寫不到** ⇒ `released_stuck_count` 不亮;
而 `attempt_manual_review_count` 又要求 `status='pending'` ⇒ **兩個計數都不亮**,比乙(不動)更沉默。

⚠️ **R2-MF4 待實作時複核**:改③ 讓 `attempt_manual_review_count` 混入非 pending 的列,
而 app 端文案/domain 註解把它講成「pending 孤兒」(`packages/domain/src/payment/anomaly-alert.ts` 附近)
⇒ 要嘛同片更新文案與測試,要嘛**另立第八個計數**避免一詞兩義。**兩案都可,實作時選一個並寫理由。**

> **✅ 實作已選(L5b-0-s,2026-08-10 關卡2 R1-MF2):同片更新文案與測試。** 理由:第八個計數要改 RPC 回傳
> jsonb 的鍵集合 ⇒ `PgAnomalyAlertReaderAdapter` 的 `parseCount` 在**新鍵尚未 apply** 時會 throw ⇒ 告警 cron
> 直接 503;那條路要嘛硬綁 apply 序、要嘛加旗標,成本與風險都高於改一行文案。改文案在 apply 前後都不會壞
> (apply 前那一族恆為 0、文案只是先把它列出來)。落點:`packages/use-cases/src/check-anomaly-alerts.ts`
> + `packages/domain/src/payment/anomaly-alert.ts` 註解 + 一格文案不變式測試。
> ⚠️ **誠實邊界**:commit 到 apply 之間,文案講的「被讓路轉人工」在 DB 還算不到 —— 方向是**多列一類**、
> 不是把風險講小,且該族此時恆 0;此偏離寫進 commit body。

#### 改④(關卡2 R1-MF1 補;plan 原文只推導到三處)
- **`expire_stuck_attempts_at_ceiling()`(活本體 `20260615120001:86`)的 status 閘**照改①② 同一條線擴成
  `(status IN ('pending','charged') OR (status='released' AND superseded_at IS NOT NULL))`。
- **為什麼非做不可**:改① 第三支帶 `count < 8`,它把兩種**已經 >= 8** 的列孤兒化 ——
  (a) **既有列**(apply 前 released 繞 ceiling ⇒ count 無界,正式庫上「已讓路且 count>8」是常態不是例外);
  (b) **claim 完在 mark 之前 crash** 的孤兒(這正是這支 expirer 當初存在的理由,`20260615120001:79-84`)。
  兩者都落成:claim 濾掉 ⇒ mark 永不跑 ⇒ 旗標永遠 false ⇒ 改③ 的計數**恆零** ⇒ 本片要治的「無聲消失」原封不動,
  而且更難察覺,因為三道改動看起來都「有做」。
- **這是明文收窄 R1c1〔E〕**(`20260624120008:24-26`「expire 不改本體」):〔E〕的成立條件是
  「released 繞 ceiling、永遠不需要 expire」,而改① 正是把讓路那族送回 ceiling 之內 ⇒ 前提對這族失效。
  收窄後:**未讓路的 released 仍不被 expire 碰**(R1c1 零回歸,格 17 釘住)。
- **不可寫成裸 `superseded_at IS NOT NULL`**:那會把 `close_released_attempt` 翻成 `failed` 的結案列也標人工,
  與改③ 的 terminal 排除自相矛盾。

### 3.6 apply 前置(主視窗跑;P 窗碰不到)
1. `SELECT count(*) … superseded_at IS NOT NULL AND status='charged'`(17:5x = 0;**apply 當下重數**)。
1a. 🔴 **R3-F1 新增(改④ 的規模面,apply 當天才知道)**:改④ 讓 ceiling-expirer 收讓路族,
   **第一輪 sweeper 會一次把積壓的既有列全部翻成 needs_manual_review**,而那個數字目前**沒有人數過**。
   apply 前先數,數字大就先跟 Sean 講預期噪音(告警無去重、每輪重推、見 §4 末):
   ```sql
   SELECT count(*) FROM public.payment_charge_attempts a
     JOIN public.orders o ON o.id = a.order_id
    WHERE a.status = 'released' AND a.superseded_at IS NOT NULL
      AND a.needs_manual_review = false AND a.settle_attempt_count >= 8
      AND o.payment_status = 'unpaid'::public.payment_status;
   ```
2. ~~`ANOMALY_ALERT_ENABLED` 正式站現值~~ **已查:`"true"`**(事實 12)⇒ 本條前置解除。
   ⚠️ 未解的那半留在 §8-2:**cron 是否真的在跑 / 通知管道密鑰是否配妥**(事實 12a)。

---

## §4 知情代價(Sean 拍 A 認列;口徑以本節為準)

- 本片後,被讓路的 attempt 走不到 `20260624120005:128-152` 的 genesis INSERT ⇒ **雙扣 anomaly 列不會建**
  ⇒ `open_count` 對這族不再亮(PG 無 autonomous transaction ⇒ 單交易內做不到「先寫稽核再 RAISE」)。
- 🔴 **更正一(我在 P-330/P-332 講得比事實嚴重)**:不是「沒有任何自動信號」——
  同一支聚合另有 `released_stuck_count`,乙案之下 12h 後會算到它。
- **更正二(R2-MF7)已結案**:R2 質疑「上面兩句預設告警管線是開的」——**實查後前提成立**:
  `ANOMALY_ALERT_ENABLED` 正式站 = `"true"`(事實 12,主視窗 18:2x `vercel env pull` 實查)
  ⇒ 閘是開的、本節可以講通知,§4 整段口徑成立、甲的觀測性理由不用重寫。
- 🔴 **但邊界要跟著寫**(事實 12a):**「env 開著」只證閘過得去,不證通知真的送達** ——
  cron 排程有沒有在跑、通知管道密鑰有沒有配,**都沒驗**。
  ⇒ 本節與甲的措辭一律用「**這族事件會/不會進入告警計數**」;
  只有在 §8-2 那條補驗之後,才可以說「**會有人收到**」。

**資訊沒有永久遺失 —— 🔴 但只對 3DS 那條路成立**(R3-MF6,v6 收窄):
- **3DS**:`bank_transaction_id` 在 charge **前** durable(事實 13,`initiate-payment.ts:93`)⇒ 列上恆有 TapPay 指標。
- 🔴 **非 3DS(`confirmPayment`,正是閘三為它而生的那條路)**:該檔**全檔零 bank_txn 寫入**
  (本 session 實查:`grep -ci "bank" packages/use-cases/src/confirm-payment.ts` = **0**、
  `recordInitiation*` 零命中)。而閘一擋下 markCharged 之後 `rec_trade_id` 也不會落
  ⇒ **值班查到的那一列身上沒有任何 TapPay 指標**。
  **非 3DS 的定位步驟(要寫進交接,不能留給值班自己想)**:
  拿 `orders.id`(= TapPay `order_number`)去 TapPay 後台 / Record API 反查該單交易;
  UI 側對應形狀 = `orphan` + `confirm_rejected` 且帶 `transactionId`(`confirm-payment.ts:164-171`)。

gap 期間值班查詢(Sean 已裁,**不加 status 條件**;事實 10 是理由;R3-nit:join orders 才答得出「退多少」):
```sql
-- 查詢 A:讓路那族(Sean 已裁「不加 status 條件」——維持;只補欄位,不動 WHERE)
SELECT a.id, a.order_id, a.status, a.superseded_at, a.rec_trade_id, a.bank_transaction_id,
       a.last_settle_error, a.needs_manual_review, a.settle_attempt_count,   -- 🔴 R3-F3 補這兩欄
       a.released_manual_review_at,                                          -- 🔴 R3-F3:辨別它是否也被算進 released_stuck_count
       o.display_id, o.total, o.payment_status
  FROM public.payment_charge_attempts a
  JOIN public.orders o ON o.id = a.order_id
 WHERE a.superseded_at IS NOT NULL;
```
🔴 **R3-F3:少了那兩欄,這條查詢答不出告警在講誰。** 告警的 `attempt_manual_review_count` 只數
`needs_manual_review = true` 且 order unpaid 的列;而查詢 A 回的是**整個讓路族**(含已 `close` 成 failed 的、
含 `count<8` 還沒轉人工的)⇒ 回列集 ⊋ 計數集,值班無法把「N 筆」對回是哪幾列。補欄之後的對法:
**計數集 = 查詢 A 之中 `needs_manual_review = true` 且 `status IN ('charged','released')` 且 `payment_status='unpaid'` 的那幾列。**

🔴 **R3-F3 的另一半:這條查詢查不到 `attempt_manual_review_count` 的另一族。**
該計數自 L5b-0-s 起是**兩族聯集**,而查詢 A 的 `WHERE a.superseded_at IS NOT NULL` 把
**pending 孤兒那一族整個排除**(它們 `superseded_at IS NULL`)⇒ 只給查詢 A 的話,值班會少看見一整類。
配套查詢:
```sql
-- 查詢 B:pending 孤兒那族(sweeper 放棄、非讓路)
SELECT a.id, a.order_id, a.status, a.settle_attempt_count, a.last_settle_error,
       a.rec_trade_id, a.bank_transaction_id, o.display_id, o.total
  FROM public.payment_charge_attempts a
  JOIN public.orders o ON o.id = a.order_id
 WHERE a.needs_manual_review = true
   AND a.status = 'pending'
   AND a.superseded_at IS NULL
   AND o.payment_status = 'unpaid'::public.payment_status;
```
**兩族的處置完全不同**:查詢 B(pending 孤兒)= 走 Record 對帳補結算;
查詢 A 命中的讓路列 = 錢屬於**舊單**、出口是退款(L5b-2),**不要**去補結算。
⚠️ 告警文案指的就是本節這兩條 —— 文案改了、本節沒改的話,值班會照著一條查不全的查詢做事(R3-F3 原病)。
⚠️ **`last_settle_error` 會顯示 `record_unreachable`,那不是連線層故障**(R3-nit):
閘一的 RAISE 在 `settle-charge.ts:428-432` 被吞成同一個碼(§3.4)⇒ 這一族與基礎設施故障**同碼不同因**,勿誤判。

---

## §5 驗收

### 5.0 🔴 驗收載體(R2-MF14:v4 的寫法照字面 apply 會自爆)
v4 寫「migration 內 BEGIN→DO 模擬→ROLLBACK」——**外層 ROLLBACK 會把六支函式定義一起撤掉**。
⇒ 改成**獨立 harness `scripts/l5b0-verify.sh`**(照既有 `a8c1-verify.sh` / `a8c2-verify.sh` 形制:
本機 shadow DB、`-v ON_ERROR_STOP=1`、`-v VERBOSITY=verbose` 走 SQLSTATE 路徑分派、跑完 residue 複查)。
migration 檔內只留**不可回滾的斷言**(catalog 存在性 / ACL / fail-closed)。

🔴 **setup 驅動方式(harness 硬紀律;Fable 複核 nit 4,這條會直接改變突變向量)**:
> **每一格只有「格」欄點名的那支 RPC 走守門;該格其餘的前置 state 一律 owner 直寫 seed。**

**為什麼**:格 4 的前置需要「同單新 attempt 合法收款」。若那個前置**去驅動 `markCharged`**(受守門的 RPC),
則在 M1(閘一述詞 flip)之下**前置自己會被擋** ⇒ 格 4 跟著紅 ⇒ M1 的觀察向量變成 `{1,4,5,6,7,9a}`、
與 §5.2 釘的 `{1,5,6,7,9a}` 不符 ⇒ 觸發仲裁。格 8(confirm 冪等)同理。
⇒ 前置用 `INSERT/UPDATE` 直接把 attempt 造成需要的狀態,**不經三道閘**;只有該格要驗的那一發呼 RPC。

⚠️ **若實作時發現前置非走守門 RPC 不可**:那就是**向量要改**,不是「量到什麼寫什麼」——
先在 §5.2 改向量並寫理由,再改 harness。**就地把向量對齊觀察值 = 橡皮圖章 = 本片轉 FAIL**(審查者原話)。

### 5.1 行為格(harness)
| # | 格 | 期望(**寫死 yes/no**) |
|---|---|---|
| 1 | 閘一:superseded+released → markCharged | RAISE;attempt 狀態不動;anomaly 零列 |
| 2 | 閘二:superseded+**pending** → 備軌 | RAISE |
| 3 | 閘三:該單有活的 superseded attempt → confirm | RAISE;**order 維持 unpaid** |
| 4 | 🔴 閘三不誤擋 L5a-2:舊 attempt 已 close 成 `failed`、同單新 attempt 合法收款 | confirm **成立**、order 轉 paid |
| 5 | 正:`superseded_at IS NULL` 的 pending → charged | 成立、無 anomaly |
| 6 | 正:`superseded_at IS NULL` 的 released → charged | 成立 **且 genesis anomaly 照建** |
| 7 | 正:未 superseded 的 charged 同 rec 冪等 | no-op、`RETURN`(不 RAISE) |
| 8 | 正:未 superseded 的 confirm 同 rec 同額重放 | 回 `idempotent:true` |
| **9a** | legacy `charged`+`superseded` → **走 markCharged 腿**(正式庫實數 0) | 🔴 **RAISE;attempt 不動** |
| **9b** | legacy `charged`+`superseded` → **走 confirm 腿** | 🔴 **RAISE;order 維持 unpaid** |
| 10 | 甲:被讓路 attempt **逐輪** claim 八次 | 前八次**每次都成功 claim**、第九次 claim 不到(🔴 **禁止直接 seed `count=8`**) |
| 11 | 甲:第八輪 markSettleRetry 之後 | `needs_manual_review = true` |
| 12 | 甲:查三參數 `get_payment_anomaly_alert_summary` | `attempt_manual_review_count` **有算到它** |
| 13 | 甲:`superseded_at IS NULL` 的 released | 仍繞 ceiling/manual、仍被 claim(R1c1 不回歸) |
| 14 | 天花板(§3.3):舊 attempt close 成 failed 後、拿**舊 rec** 呼 confirm | **放行**(已知天花板、非缺陷);此格存在是為了讓它變成**被記錄的行為** |
| **15** | 🔴 甲:格 11 之後把該 attempt `close_released_attempt` 成 `failed`,再查告警 | `attempt_manual_review_count` **不再算它**(結案後計數回落;R3-MF5) |
| **16** | 🔴 甲改④:**既有列** —— seed 一顆「released + superseded + `count=12` + 非 manual + lease 到期 + order unpaid」(模擬 apply 前就繞著 ceiling 跑的列),呼 `expire_stuck_attempts_at_ceiling()` | 回 **>=1**、該列 `needs_manual_review=true`。🔴 這格是 MF1 的直接證據:沒有改④ 時它**紅**,因為 claim 也永遠碰不到它(count>=8)。⚠️ **刻意不接告警計數斷言**——那條由格 12 負責;接了會讓 M8 連帶染紅本格(多紅)|
| **17** | 🔴 甲改④ 的負向對照:同樣 seed 但 **`superseded_at IS NULL`**(未讓路的 released、`count=12`) | expire **不碰它**(`needs_manual_review` 維持 false)⇒ R1c1 行為零回歸(= 收窄版的 SWEEP-6) |

### 5.2 突變(🔴 每發列**完整預期向量**,harness 精確比對「多紅/少紅」皆算失敗)
🔴 **v6 全表重算**(R3-MF1~4:v5 五條向量算錯。**病根 = 格 9 沒指明驅動哪支 RPC**
—— 它同時寫「attempt 不動 + order unpaid」= 兩條腿,而突變是按單一 RPC 算的
⇒ v6 把它拆成 **9a(markCharged 腿)/ 9b(confirm 腿)**,向量才對得起來)。

| # | 突變 | 預期紅(**完整向量**) |
|---|---|---|
| M1 | 閘一述詞 `IS NOT NULL` → `IS NULL` | **1、5、6、7、9a** |
| M2 | 閘一整條拿掉 | **1、9a** |
| M3 | 閘二整條拿掉 | 2 |
| M4 | 閘三整條拿掉 | **3、9b** |
| M5 | 閘三的 `status IN (...)` 拿掉 | **4、14** |
| M6 | 改① 第三支拿掉(= 字面那版) | **10**(v6 寫 10、11、12;**-s 實作改設計後改成 10**,理由見下方「-s 實作時的向量修正」)|
| M7 | 改② 的 `OR …` 拿掉 | **11、12** |
| M8 | 改③ status 半邊放寬拿掉 | **12、15**(v6 寫 12;**-s 實作改成 12、15**,理由見下方)|
| M9 | 改③ 的 **terminal 排除**拿掉 | 15 |
| **M10** | 改④ 的讓路分支拿掉(= expire 回到只收 pending/charged) | **16** |
| **M11** | 改④ 寫成「收整族 released」(丟掉 superseded 條件) | **17**(證明格 17 這個負向對照**不是恆綠**)|
| **M12** | 改① 的**第二支**(未讓路 released 繞閘)拿掉 | **13**(證明格 13 這個負向對照**不是恆綠**)|

**幾條向量為什麼是這樣(避免下一個人又算錯)**:
- **M1 含 9a**:charged 冪等分支(`20260624120005:98-101`)在閘**之後** ⇒ 閘 flip 後 `charged+superseded` 同 rec
  會走到那個分支 `RETURN` 成功,而 9a 期望 RAISE。
- **M2 含 9a**:同理,閘拿掉後 9a 直接走冪等成功。
- **M5 含 14**:述詞拿掉後 `failed`+superseded 也命中 EXISTS ⇒ 格 14 期望的「放行」變成擋下。
- **M6 含 10**:字面版讓這族**整個落出 claim** ⇒ 格 10 的「前八次每次成功 claim」**第一輪就紅**
  (v5 寫「格 10 仍綠」與本檔 §3.5 自相矛盾)。
- **M7 含 12**:`attempt_manual_review_count` 的 `needs_manual_review = true` 是述詞前提
  (活本體 `20260701130000:74-79`)⇒ 改② 拿掉 ⇒ 旗標不設 ⇒ 計數為 0。

#### 🔴 -s 實作時的向量修正(2026-08-10,關卡2 R1-MF5 折完後實跑得到;**先改向量再改 harness、非就地對齊觀察值**)
兩條 v6 向量在 -s 的 harness 上不成立,病根是 **v6 的 M6/M8 是照「格 11/12/15 的前置鏈過 claim」算的**,
而 §5.0 的硬紀律是「每一格只有點名的那支 RPC 走守門、其餘前置 owner 直寫」。兩者互斥 ⇒ 依 §5.0 改 harness、
連帶改向量:
- **M6:{10,11,12} → {10}**。格 11/12 的點名 RPC 是 `mark_attempt_settle_retry` 與告警聚合,
  `settle_attempt_count=8` 由 owner 直寫 seed(格 10 那條「禁止直接 seed count=8」只約束格 10 自己,
  因為格 10 驗的正是 claim 的 ceiling)⇒ 改① 被拿掉時它們照樣綠。**好處**:M6 紅在哪一格 = 壞在哪一處改動,
  一一對應、不再一發突變染紅三格。
- **M8:{12} → {12,15}**。格 15 的前提是「結案**前**這列算得到」,而 M8 拿掉的正是讓它算得到的那半邊
  ⇒ 格 15 的前提被打穿。**若不讓格 15 紅**,它在 M8 之下會變成「計數從 0 到 0」的**恆綠**(= 沒有判別力的負測,
  memory `feedback_negative-test-observation-supplied-by-another-mechanism`)⇒ 選擇讓前提失敗**明確報紅**。
- 新增 **M11 / M12**:專門用來證明兩個負向對照格(17 / 13)不是恆綠 —— 它們在 M6-M10 全綠,
  若不另外構造能讓它們紅的突變,「R1c1 零回歸」這句話就只是**沒被測過的斷言**。

**-s 實跑實得(每格獨立 psql + 各自 BEGIN/ROLLBACK,一格紅不擋其他格;7 格 × 8 組 DB clone)**:
對照組 `[]`(全綠)/ M6 `[10]` / M7 `[11 12]` / M8 `[12 15]` / M9 `[15]` / M10 `[16]` / M11 `[17]` / M12 `[13]`
—— **與上表逐格相符,無多紅無少紅**。另外每一發突變的**全檔** apply 都被本檔自己的 post-image prosrc 指紋 assert
擋下(= 指紋守門對這 7 種述詞改動都有判別力,不是只有位置錨)。

⚠️ **harness 紀律**:比對「多紅 / 少紅」**皆判失敗**。
🔴 **禁止就地把向量改成觀察值** —— 那是橡皮圖章。向量與實作不符時,先判「哪一邊錯」再改。

🔴 錨點用**守門自己那條命令**去數(memory `feedback_verify-anchor-with-the-guards-own-command`)。

### 5.3 呼叫面(證明合法情境沒被誤擋)
- **閘一/二(attempt 面)= 11 個座標,不是 10**(R2-MF8):附錄 A 的 A1 六入口 + A2 的 8/9 + A3 兩處
  **＋ `reconfirm-expired-orphans.ts:96`**。🔴 附錄 A 當初排除它的理由是「superseded ⇒ released ⇒ 碰不到」,
  而**本片閘二的存在理由正是「schema 不保證那件事」** ⇒ 那個排除與我自己的論證互斥,不能兩者都留。
  B1a 的 claim 是 `status='pending'`(事實 14)⇒ `pending`+superseded 就進得去。
- **閘三(confirm 面)= 2 處**:`settle-charge.ts:437`、`confirm-payment.ts:141`;
  唯一 app 出口 `PaymentConfirmerAdapter.ts:128`。
- 🔴 至少一條**跨 use-case→adapter→真 DB** 端到端格(不得只在 mock 掉 settleCharge 的層測)。
- 做法:先逐入口開檔判有無**正向覆蓋**、列「已覆蓋/缺」附行號,只補缺的。
- ~~已知**查無專屬測試檔**:`callback/page.tsx`、`tappay-notify`、`payment-status`。~~
  🔴 **這句是過期字面,2026-08-10 -t3 實查推翻**(三個檔都在,且都有正向覆蓋;路徑我逐一 `find` 對過,
  盤點 agent 最初給的路徑有兩個是錯的):
  | 原句所指 | 實際檔案 | 佐證 |
  |---|---|---|
  | `callback/page.tsx` | `apps/storefront/src/app/checkout/callback/page.test.tsx`(11 個 `it`) | `it('⑤ 歸屬通過 + paid → CheckoutSuccess…')` |
  | `tappay-notify` | `apps/storefront/src/app/api/**checkout/**tappay-notify/[secret]/route.test.ts` | `it('合法首見 + 本機單存在 → recordEvent…settleCharge 排程')`;檔內 `settleCharge` 14 處 |
  | `payment-status` | `apps/storefront/src/app/api/**orders/[orderId]/**payment-status/route.test.ts` | `it('unpaid + throttle 放行 → 呼 settleCharge…')`;檔內 `settleCharge` 7 處 |
- ✅ **-t3 盤點結論:14 個座標(11 attempt + 2 confirm + 1 app 出口)正向覆蓋 = 14/14、缺口 0。**
  ⚠️ **「14/14」只代表「每個呼叫端都有一條正向測試」,不代表「這條線已被充分驗證」** —— 見下一行的層級限制。
  ⚠️ 但那 14 個**全部是 mock 掉 `settleCharge` / `confirmer.confirm` 的呼叫端測試** ——
  它們證得了「呼叫端把參數傳對」,證不了「這串參數餵得進真 RPC、且 RPC 的 RAISE 被 adapter 分類對」。
  ⇒ 本節那條**跨層端到端格**由 `scripts/l5b0t3-adapter-e2e.ts` 補(由 `l5b0t2-verify.sh` 帶起)。
  🔴 **但它只補到一半,範圍要講清楚(code-reviewer 抓;不講就會被讀成「原始要求已閉環」)**:
  本節原文要求的是「跨 **use-case** → adapter → 真 DB」,而該檔是**直接 import `PaymentConfirmerAdapter`**、
  從 **adapter → 真 DB**,**沒有經過 `settleCharge` / `confirmPayment` 這一層**。
  ⇒ **仍然缺**:「use-case → adapter」那一跳的真連線覆蓋(現況仍只有 mock 掉 confirmer 的呼叫端測試)。
  補它要把 use-case 的整組 deps(charge port 等)在 harness 裡湊出來,體積另一片級 ⇒ **本片不做、認列在此**。
  該格的誠實邊界寫在檔頭:adapter 預設 client factory 把 host 釘死在 Supabase pooler 網域 + verify-full,
  **結構上連不到 127.0.0.1** ⇒ 用 constructor 的 `clientFactory` 注入本機 client;
  **TLS/CA/host 釘死那一段沒被驗到**,不在該格宣稱。

### 5.4 既有 verify 腳本(R2-MF12:不能當本片驗收)
`a8c1-verify.sh` / `a8c2-verify.sh` 走**自己的 replay 鏈與黃金 diff / md5 pin**,標的是它們各自那片。
⇒ 本片**不預先改它們任何 pin**;動作 = **實跑一次**,把結果(綠/紅、紅在哪一行)記進 commit body;
若紅在「本片改了它們 pin 的物件」那一行 ⇒ 開**相容性債條目**,不在本片就地改別片的黃金值。

---

## §6 Rollback(R2-MF13:v4 只還原三道閘、漏了甲的三支;-s 實作後甲是**四支**,見第 7 列)

forward-only ⇒ **七支**全部要有 pre-image,且 `CREATE OR REPLACE` **不還原 COMMENT** ⇒ 每支都要配 `COMMENT ON`:

| # | 物件 | pre-image |
|---|---|---|
| 1 | `mark_charge_attempt_charged` | `20260624120005:64-161` + COMMENT `20260804120000:212` |
| 2 | `..._fallback` | `20260612150000:351-419` + COMMENT `:421` |
| 3 | `confirm_order_payment` | `20260810160000:328-…` + 該檔 COMMENT |
| 4 | `claim_stuck_unsettled_attempts` | `20260624120008:80-113` + COMMENT `:115` |
| 5 | `mark_attempt_settle_retry` | 🔴 **`20260809140000:89-…`**(**不是** `20260624120008`) |
| 6 | `get_payment_anomaly_alert_summary` | 🔴 **三參數 `20260701130000:43-112`** |
| 7 | `expire_stuck_attempts_at_ceiling`(改④;關卡2 R1-MF1 補) | `20260615120001:86-105` + COMMENT `:107` |

🔴 rollback 會讓 superseded 列恢復「可入帳」⇒ **必須連 §4 的值班查詢一起恢復**。
🔴 rollback 後要跑一次 §5.1 的**反向 read-back**(證明舊行為真的回來了,不是只換了函式本文)。

---

## §7 拆片與 apply 序

### 7.1 拆片(R2-MF15:v4 把「三道閘」與「甲」綁在一起的理由不成立)
- **三道閘之間**不可分批 —— 中間態 = 事實 5 那個洞原封不動。
- **甲與三道閘之間可以分** —— 甲是**終止/觀測政策**,不是錢的歸屬;
  甲不上線的中間態 = 今天就已經存在的那個 16 分鐘迴圈(L5a-1 既有債)。v4 沒證明它不可分,**撤回那個說法**。

| 片 | 內容 | 估時 |
|---|---|---|
| **L5b-0-m** | 一支 migration:三道閘 + COMMENT + catalog/ACL 斷言 | ~40 分 |
| **L5b-0-s** | 甲**四處**改動(pre-image 取活本體)+ §3.5 的文案/計數複核(文案案已選:同片改文案+測試)| ~35 分 |
| **L5b-0-t** | `scripts/l5b0-verify.sh`(**17 格 + 12 發突變**;格 16/17 與 M10-M12 為 -s 關卡2 R1-MF1/MF5 新增)+ 呼叫面 13 發正向 + 既有腳本實跑 | ~60 分 |

🔴 **-t 線的硬收工條件(主視窗 2026-08-10 裁 C 的配套①,不得漏)**:
`scripts/l5b0-verify.sh` **尚未收編 w7 覆蓋帳**(`scripts/w7-coverage.sh`)。裁定是「-t2/-t3 收齊後一次收編」
(凍結值只動一次、且形狀含兩種隔離模型比較完整)。
⇒ **-t3 的 STOP 信必須含這一行**:「l5b0-verify 已收編 w7(CELL-ACCOUNT / CELL-KEYSET 新凍結值
+ `record all` 秒數 + 37→N/0)」。**沒有那一行 = -t 線不算完** —— 這條配套的存在理由就是防止
「等收齊再收編」變成「永遠沒收編」。在那之前的空窗 = 知情缺口、記在主視窗帳上。

⚠️ **-t 仍超鐵則 4** ⇒ 依鐵則 6 慣例在 commit body 寫不拆的理由,或再按「行為格 / 呼叫面」切兩次。

### 7.2 序(⛔ 停點)
1. §3.6-1 前置:**apply 當下重數** `superseded_at IS NOT NULL AND status='charged'`(17:5x=0 是時點觀察)。
   (§3.6-2 的 `ANOMALY_ALERT_ENABLED` 已查得 `"true"`、前置解除;未解的那半在 §8-2。)
2. commit(**index 凍結、審綠 + marker 才 commit**)。
3. ⛔ apply 由主視窗執行、Sean 批。
4. apply → **read-back 驗** → 才動任何應用層(memory `feedback_app-layer-must-not-ship-before-migration-apply`)。

---

## §8 未確認 / 失效條件

1. **事實 11 的行號待從活本體 `20260809140000` 逐行複抄**(§1.2 註記)。
2. 🔴 **告警鏈只驗到 env 那一格**:`ANOMALY_ALERT_ENABLED = "true"` 已實查(事實 12),
   但 **cron 排程是否真的在跑、通知管道密鑰是否配妥,兩者都沒驗**(事實 12a)。
   ⇒ 在補驗之前,全檔一律講「**進入告警計數**」、不講「**有人收到**」。
   補驗方法(給實作者,不要用推論代替):查 Vercel cron 最近一次 `/api/cron/anomaly-alert` 的執行紀錄與回應碼,
   而不是只看 `vercel.json` 裡有排程宣告 —— **宣告存在 ≠ 它在跑**。
3. **`a8c1/a8c2-verify.sh` 實跑結果**(§5.4)。
4. **閘三的 provenance 天花板**(§3.3)—— 出現人工/歷史 rec 呼 confirm 的路徑即失效。
5. **閘三精確性綁 per-order 鎖 index predicate**(`20260624120000:62-64`)。
5a. 🔴 **閘三防併發靠兩個地基假設,兩個都不在本片控制下**(R3-MF7;與 5 同級,v5 漏列):
   (a) **閘三位在 `confirm_order_payment` 的 PF-B `orders … FOR UPDATE` 之後**(`20260810160000:355-359`);
   (b) **L5a-1 依 id 升序鎖齊「舊單 + successor」的 orders 列**(`20260810010000` COMMENT `:295` 逐字)。
   兩者共同保證「supersede 與 confirm 不會交錯提交」。
   **失效情境(命中即回頭補 provenance 綁定或改鎖)**:未來把閘三**上移到 FOR UPDATE 之前**,
   或 L5a-1 改成不鎖 orders ⇒ supersede 可能在閘三的 `EXISTS` 快照**之後**提交
   ⇒ 那筆讓路款被 confirm 成 paid **且列上同時帶著讓路標記** ⇒ L5b-2 會把它當補償對象再退一次 = **雙損**。
6. **§0a-4 的能力天花板**:owner / 直接 SQL / 未來第七支 SECDEF 物件都繞得過。
7. **附錄 A 的 11 座標**:新增 `settleCharge(` 呼叫或 `settle` port 第二個消費者 ⇒ 過期,引用前重跑 grep。
8. **既有測試盤點只證檔案存在**,不證正向覆蓋。
9. 🔴 **B1a `claim_expired_pending_attempts` 對 `superseded` 完全不設防(R3-F6;-s 實作時實查 `20260627120000:88-93`)**:
   它的述詞是 `status='pending'` + age≥12h + 6h throttle,**明文不濾 `needs_manual_review`、不濾 ceiling、不濾 `superseded_at`**
   (`:72-74` 逐字寫著這三個「不濾」是刻意的)。
   ⇒ 若真的出現 `superseded` + `pending` 的列(schema 沒禁,正是閘二存在的理由、plan §3.2),
   它會**每 6 小時被 B1a 重領一次、永遠不停**:錢真的來了會撞 -m 閘一 → `settleCharge` 吞成
   `record_unreachable` → B1a 不 ++ count、不動旗標 ⇒ 這條路上**沒有任何 terminal**。
   **本片四處改動都治不到它**(改①④ 是 sweeper 的 claim_stuck / expire 那條線,B1a 是另一支 claimer)。
   ⚠️ **誠實邊界(修正 R3 審查者的措辭)**:這一族**不會無聲消失** —— 它 `status='pending'`,
   走基線那支 ceiling 閘照樣會被標人工、也照樣進 `attempt_manual_review_count`(改③ 的 pending 那半);
   殘餘傷害是**白打的 TapPay Record 呼叫**,不是看不見。
   ⇒ 不在本片治(動 B1a = 第五支 RPC、超片界);修法選項=B1a 述詞加 `a.superseded_at IS NULL`,
   隨 L5b-2 或另立 backlog 條目處理。
10. 🔴 **告警噪音沒有自動出場(R3-F5,已修正審查者的事實錯誤)**:本 use-case **無 per-anomaly 去重**
   (`check-anomaly-alerts.ts:22` 明文刻意)⇒ 讓路那族被標人工之後,**每一輪 cron 都會把同一個數字再推一次**,
   直到有人把它處理掉。
   ⚠️ 審查者說「唯一出口 `close_released_attempt` 尚未建」**不成立**:那支 owner-only RPC 早就在
   `20260624120010:62`,-s 的驗收格 15 就是實際呼它跑的。
   **正確說法**:出口存在但**只有人工**(owner 執行、逐筆),自動化的出口才是 L5b-2。
   ⇒ apply 當天先跑 §3.6-1a 數積壓量;量大 ⇒ 值班要知道這個數字會**恆駐並每輪重推**,
   而**雙扣 open_count 的 +1 增量會淹在裡面**(這正是改③ 在計數層治掉的底噪問題、在人的注意力層重生)。

— P 窗三代,2026-08-10(**v6:折 R3 七條 + 三 nit;Fable 複核 PASS、零 must-fix,4 nit 已清**)
