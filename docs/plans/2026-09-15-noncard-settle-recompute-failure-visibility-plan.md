# 2026-09-15 · 非刷卡收款「狀態重算吞錯」讓人看得見 —— plan(v2)

> 設計窗寫 v1(`779e3a6ef`);**A 窗改 v2**(本檔)。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P1-6**。主視窗 pcm-website-v2-b7 派工。
> Sean 逐字「q1 甲 q2 甲」= 全做(v1 §8 的 Q1 甲、Q2 甲)。
> **本檔只是 plan,零碼、零 migration。** 碰函式定義 + 事故種類 CHECK(schema)+ 錢(收款狀態)⇒ 鐵則 8 + 12,等主視窗回「可以開工」。
> 🔴 **v1 → v2 為什麼改**:專案 adversarial-reviewer(opus、唯讀;codex 額度用完至 09-20,缺 codex 那一路)審 v1 = **R1 FAIL**,must-fix 5 條(M1–M5)、should 6 條、nit 3 條。A 窗逐條開檔複驗過,5 條 must-fix 全部成立。改動對照見 §10。
> 🔴 **有一處偏離 Sean 已拍的甲**(M2:「重試放棄寫事故」)⇒ §8 Q-M2 要主視窗 / Sean 裁;本檔先照推薦寫。

## 1. 白話

- 客人用**匯款或現金**付錢,員工登記收款的那一刻,系統會重算這張單「付清了沒」,把狀態改成已付款(或已付部分)。
- 那一次重算**如果出錯,系統刻意把錯吞掉**:錢照收(不能因為算錯就把收款退回去),**但狀態不動,而且只寫一行 server log,沒有任何人會知道。**
- 匯款客人那一端:訂單頁一直顯示「請匯款」+ 銀行帳號 ⇒ **他可能再匯一次。**
- 今天已經有一支排程(每 10 分鐘)會回頭再算,**但它只救匯款單、不救現金單**。
- 🔴 **v2 查到的新問題(M1)**:那支排程今天就會把**正常收了訂金的單**當成「修不好」—— 試 5 次就蓋放棄章,出現在告警信【匯款單修不好】裡。**這是正式站現有的誤報,不是本片造出來的。**
- 本 plan 要做:①吞錯時寫一筆事故紀錄 ②排程救現金單、並修掉「訂金單被誤判修不好」 ③一張壞單不再拖垮整輪排程與健康檢查 ④每天兩次的異常告警多數一種單:「**錢已經收足,狀態還是未付款**」,匯款與現金**分開數、分開寫文案**。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 重算函式 `public.pcm_noncard_settle_recompute(uuid)`(SECURITY DEFINER、`SET search_path TO ''`),最新一代第 3 代 | `bash scripts/latest-definition-of.sh pcm_noncard_settle_recompute` ⇒ `20260905290000_m4b_pending_refund_open_failure_incident.sql:227` |
| 2 | 外層整段包在 `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE LOG '… 重算失敗(%), 收款事實保留、狀態不動' END`,**只寫 log** | 同檔 `:442-445`(v1 寫 :441-444,N1 訂正) |
| 3 | 同一支函式**內層**已有「寫事故 + 再包一層防護」的現成寫法(補開待退款失敗 ⇒ `DECLARE v_err text := SQLERRM; BEGIN PERFORM pcm_incident_log(...) EXCEPTION WHEN OTHERS THEN RAISE LOG ... END`) | 同檔 `:278-303`(v1 寫 :395-424,N1 訂正;:395-424 是 early-return 與 UPDATE 那段) |
| 4 | 事故表 `public.pcm_incident(id, kind, subject_id, detail, created_at, resolved_at)`;寫入走 `pcm_incident_log(kind, subject_id, detail)`(SECURITY DEFINER,detail 截 2000 字) | `20260905290000:116-122`、`:165-183` |
| 5 | `kind` 是**封閉集 CHECK**,最新定義 6 種:`pending_refund_open_failed / refund_over_total / auto_cancel_skipped / auto_cancel_failed / line_forward_failed / auto_cancel_live_shipment` | `20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql:66-67`(第 183、184 張沒碰) |
| 6 | 重算 trigger `pcm_noncard_settle_after_payment_ai` **沒有 WHEN**:所有收款列(含刷卡)都會跑重算;函式內也**不看付款管道** | `20260904230000:384-386`;`20260905290000:227-445` grep `payment_channel` = 0(S1) |
| 7 | 有**未作廢人工退款**的單,重算直接 `RETURN`(交還退款管線) | `20260905290000:359-367`(S4) |
| 8 | 重試排程 `public.pcm_settle_retry_sweep()`(`pcm-settle-retry`,每 10 分):撈 `payment_channel = 'bank_transfer'`、`unpaid/partiallyPaid`、已收 > 0,**在 FOR 查詢的外層 WHERE** 以 OP6a 判 `settled/underpaid`;迴圈內每張各自 `BEGIN/EXCEPTION` 呼叫重算;最多 5 次 | `20260905220000_m4b_settle_retry_sweep.sql:72-200`(只有 1 代) |
| 9 | 🔴 **排程只把「重算後變 `paid`」算成功**(`IF v_after = 'paid'`),其他一律算失敗;失敗分支 `gave_up_at = CASE WHEN t.attempts + 1 >= c_max_attempts …` | `20260905220000:150-168`(M1) |
| 10 | 🔴 **24 小時重開後 `attempts` 不歸零** ⇒ 重開後第一次失敗就再蓋章(`t.attempts + 1 >= 5` 恆真)⇒「24 小時後再試 5 次」其實只試 1 次 | `20260905220000:118-120`、`:168`(M1) |
| 11 | 🔴 **OP6a 在排程 FOR 查詢外層、每張單的 BEGIN/EXCEPTION 之外** ⇒ 一張單讓 OP6a 丟錯,整個 FOR 中斷,整輪失敗(每 10 分鐘一次),同批其他單也修不到 | `20260905220000:132-133`(M5) |
| 12 | 🔴 **放棄的單今天已經有人看**:`get_settle_retry_gaveup_health()` 數放棄章;告警信【匯款單修不好】段附單號;LINE 摘要有 `settleRetryGaveUpCount` | `20260905250000:34-61`、`packages/use-cases/src/check-anomaly-alerts.ts:1710-1721`、`packages/use-cases/src/owner-line-digest.ts:38`(M2;v1 事實 #7「沒人看」過期) |
| 13 | 匯款卡單健康檢查 `public.get_stuck_bank_orders_health()`:**刻意只看 `bank_transfer`**,理由逐字是信裡文案宣稱「訂單頁仍然顯示【請匯款】+ 銀行帳號」而現金客人看不到那個畫面(codex 當年 must-fix);OP6a 在 `judged` CTE 逐列呼叫(一張丟錯整支 RPC 失敗) | `20260905060000_m4b_stuck_bank_orders_health.sql:105-114`、`:141-145`(M4、M5) |
| 14 | 信件文案寫死「匯款單」「請匯款 + 銀行帳號」 | `check-anomaly-alerts.ts:2002-2004`、`:2028-2030`、`:1713`、`:1716`(M4) |
| 15 | 事故去重的既有寫法:`NOT EXISTS (… kind = X AND subject_id = Y AND resolved_at IS NULL)` 再寫 | `20260907140000:214-216` |
| 16 | 事故數量出口 `get_pcm_incident_health()` 回各 kind 未解決筆數 ⇒ 新 kind 自動進告警信 | `20260905290000:192-214` |
| 17 | 現金收款只走 `admin_record_manual_payment(p_rail='cash')`,正整數、無找零欄;OP6a 不看付款管道;**找不到把現金單錯推成 paid 的世界**(審查 c 項) | `20260915234000:168-172`、`:416-419` |
| 18 | `pcm_settle_retry_sweep` 從沒寫 `ALTER OWNER`;`pcm_incident_log` 零 GRANT ⇒ 呼叫者 owner 不是 postgres 時寫事故會被靜靜吞掉 | `20260905220000:72-76`、`:217-220`;`20260905290000:183-188`(S3) |
| 19 | 0 元 unpaid 單:零收款、零 charged,OP6a 判 `settled` | `20260907170000:236`、`:291`(S2) |

🔴 **發生過幾次:答不出來。** 吞錯只在 server log。v1 寫「對唯讀角色沒有 SELECT」—— 審查指出 `pcm_readonly` 對 `pcm_settle_retry_attempts` 有**欄位** SELECT(`20260906380000:150-151`),`has_table_privilege` 是表層級所以回 f ⇒ **放棄章那張表其實量得到**;開工第一步唯讀量一次今天有幾張放棄章、其中幾張是訂金單(M1 的現有誤報規模)。

## 3. 缺口

| 缺口 | 現況 | 後果 |
|---|---|---|
| G1 外層吞錯只寫 log | 事實 #2 | 第一次重算失敗,沒有人知道 |
| G2 重試排程只救匯款單 | 事實 #8 | **現金單**重算失敗,永遠停在原狀態 |
| G3′ 排程成功判準錯 + 重開只試 1 次 | 事實 #9-10 | 訂金單被誤報「修不好」;真壞的單 24 小時才多試 1 次 |
| G4 一張壞單拖垮整輪 | 事實 #11、#13 | 同批其他單修不到;健康檢查整支讀不到 |
| G5 健康檢查看不到「錢收足、狀態未付」 | 事實 #13 | 就算 G1-G4 都漏了,每天兩次的告警也不會提這張單 |

## 4. 做法(一支 migration + TS 一片)

### 4-0 共用小工具:不會丟錯的 verdict(M5)
- 新增 `public.pcm_settle_verdict_safe(p_order_id uuid) RETURNS text`(plpgsql、SECURITY DEFINER、`SET search_path = ''`、owner postgres、REVOKE ALL FROM PUBLIC,只給排程與健康檢查的呼叫身分):
  `BEGIN RETURN public.admin_compute_order_settlement(p_order_id) ->> 'verdict'; EXCEPTION WHEN OTHERS THEN RAISE LOG …; RETURN 'error'; END`。
- 排程與健康檢查都改呼叫它;`'error'` 各自當一種結果處理(見 4-C、4-D),**不再讓一張壞單中斷整輪**。
- ⚠️ `WHEN OTHERS` 不接 `query_canceled`(與 repo 慣例一致),逾時仍整輪回捲(既有 ⟦b4-NCPCANCELROLLBACK⟧,本片不修)。

### 4-A 事故種類 CHECK 加一種(schema)
- `settle_recompute_failed`:外層吞錯那一刻寫。`subject_id` = 訂單 id,`detail` = `SQLERRM`。
  - 🔴 **不叫 `noncard_…`**(S1):trigger 對刷卡收款列也會跑、函式不看管道 ⇒ 名稱不得暗示只有非刷卡。
- 寫法照 `20260916010000:47-67`:DROP + ADD `pcm_incident_kind_check`。
- 🔴 前置閘**同時接受兩種逐字形狀**(M3):現況 6 種(首次貼)或本片後的 7 種(「保留 CHECK 只退函式」之後重貼)。其他形狀一律停。
- `SET LOCAL lock_timeout = '5s'`(S5);ADD CHECK 不用 NOT VALID(pcm_incident 只在出錯時寫,量小)。**事後閘不在持有 ACCESS EXCLUSIVE 時呼叫排程或健康檢查**。
- ⚠️ 若主視窗 Q-M2 選乙(保留放棄寫事故),此處改加兩種,前置閘形狀改 6 / 8。

### 4-B 外層吞錯寫事故(G1)
- `CREATE OR REPLACE pcm_noncard_settle_recompute`,**從 `20260905290000:227` 逐字抄**,只改外層 handler(`:442-445`):
  ```
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG …(原句保留);
    DECLARE v_err text := SQLERRM;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'settle_recompute_failed' AND i.subject_id = p_order_id
                        AND i.resolved_at IS NULL) THEN
        PERFORM public.pcm_incident_log('settle_recompute_failed', p_order_id, v_err);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[pcm_incident] 連留痕都失敗 …';
    END;
  ```
- 🔴 形狀抄同一支函式內層 `:278-303`(已上線用過),不發明新的。
- 🔴 **去重**(S1,照事實 #15):排程每 24 小時最多重算同一張單數次,每次吞錯都會進這裡 ⇒ 同單同 kind 未解決就不再寫。
- 🔴 `SET search_path TO ''` 必須在 `CREATE OR REPLACE` 裡重寫(`reference_create-or-replace-resets-set-clause`)。
- 前置閘:① 定義 md5 = `20260905290000` 那一代 ② **owner = postgres、prosecdef = t、proconfig 含 search_path=''、ACL 逐角色與現況相同**(S3,照 `20260905290000:95-109`)。任一不符就停。

### 4-C 重試排程(G2、G3′、G4)
- `CREATE OR REPLACE pcm_settle_retry_sweep`(從 `20260905220000:72` 抄),改四件事:
  1. **管道**:`payment_channel = 'bank_transfer'` ⇒ `IN ('bank_transfer', 'cash')`。
  2. **候選只收「狀態真的該變」的單**(M1):FOR 查詢只用純算術預篩 + 排除未作廢人工退款(S4):
     - `unpaid` 且淨額 > 0(OP6a 判 settled ⇒ 該變 paid;判 underpaid ⇒ 該變 partiallyPaid,兩者都該變);
     - `partiallyPaid` 且淨額 `>= total`(可能已補足)。
     - ⇒ **正常訂金單(partiallyPaid 且淨額 < total)根本不進候選**,不會被試、不會蓋章。
     - `NOT EXISTS (order_manual_refunds 未作廢)`(那種單重算會直接 RETURN,不歸排程)。
     - ponytail 註記:預篩用 `orders.total`,有退款的單應收會變 ⇒ 預篩可能多撈(OP6a 在迴圈內會判掉)或漏撈(`total` 偏大);漏撈的那種本片不救,上限寫進檔頭。
  3. **verdict 搬進迴圈內**(M5):每張單在自己的 `BEGIN/EXCEPTION` 裡呼叫 `pcm_settle_verdict_safe`:
     - `'error'` ⇒ 記一次失敗(`last_error` = `'verdict 計算失敗'`),進放棄計數;
     - verdict 不是 `settled / underpaid` ⇒ **跳過,不記次數**(那種單不歸排程修);
     - `settled` ⇒ 期望 `paid`;`underpaid` ⇒ 期望 `partiallyPaid`。
  4. **成功判準改成「重算後狀態 = 期望狀態」**(M1),其他才算失敗;**重開放棄的單時 `attempts` 歸零**(事實 #10):在 upsert 裡若舊列 `gave_up_at < now() - 24h` 就從 1 開始數。
- 🔴 **Q-M2 推薦甲:不新增「放棄寫事故」**(理由見 §8)。放棄的單繼續由既有 `get_settle_retry_gaveup_health()` + 告警信那段呈現;**那段信要依管道分開寫**(見 4-D TS 側)。
- 前置閘:md5 + owner + ACL(S3)。`pcm_settle_retry_sweep` 今天 owner 未知(從沒 ALTER OWNER)⇒ 前置閘**先讀出來印**;不是 postgres 就停回報(否則寫事故 / 呼叫 safe verdict 可能被權限擋)。

### 4-D 健康檢查(G4、G5)
- 改 `get_stuck_bank_orders_health()`(從 `20260905060000:78` 抄):
  - **A / B 世界維持只看 `bank_transfer`,文案一字不改**(M4:那個收窄是 codex 當年的 must-fix)。
  - `judged` CTE 改呼叫 `pcm_settle_verdict_safe`(M5);新增回傳 `judge_error_count`(判不出來的張數)。
  - 新增 **C 世界**,**匯款與現金分開兩組鍵**(M4):
    - `unpaid_settled_bank_count / unpaid_settled_bank_oldest`
    - `unpaid_settled_cash_count / unpaid_settled_cash_oldest`
    - 條件:`payment_status IN ('unpaid','partiallyPaid')` 且**淨額 > 0**(S2:排除 0 元單)且淨額 `>= total` 且無未作廢人工退款,再以**同一個 `judged` CTE** 判 `verdict = 'settled'`(S2:A / C 共用同一次判定,不重複數)。
    - 現金那組的候選管道 `= 'cash'`,**與 A / B 的 bank 候選分開 CTE**,不動 A / B 的分母。
  - 既有鍵一個不改、不改名。
  - 🔴 用 OP6a 判,不用純算術(事實 #13 同檔 :62-68 記過代價)。
- **TS 側(另一片)**:
  - `PgAnomalyAlertReaderAdapter` 讀新鍵;**缺鍵 = 讀不到,不是 0**(同 `stuckBankUnknown`)。
  - `check-anomaly-alerts.ts`:新增兩段文案 ——
    - 【匯款單錢收足、狀態未付】:可沿用「訂單頁仍顯示請匯款 + 銀行帳號 ⇒ 客人可能再匯」的說法;
    - 【現金單錢收足、狀態未付】:**不得**寫「請匯款 / 銀行帳號」;改寫「後台與客人訂單頁都還顯示未付款,出貨 / 開發票可能被擋」(字面開工時照畫面實際條件核)。
    - `judge_error_count > 0` 加一行。
  - 【匯款單修不好】段(`:1710-1721`):現金單進排程後放棄表會混入現金單 ⇒ `get_settle_retry_gaveup_health()` 需回依管道分開的數字,文案分開(否則現金單會被寫成「這些人已經匯了錢」)。⇒ 本片**一併改那支函式**(從 `20260905250000:34` 抄,加 `gave_up_bank_count / gave_up_cash_count`,舊鍵保留)。
  - `owner-line-digest.ts`:加旗標,匯款 / 現金分開。

## 5. 影響

- 客人:無直接變化;間接好處是「錢收足而頁面還在叫他匯款」會在 12 小時內被員工看到。
- 員工 / Sean:異常告警信與 LINE 可能多出段落;事故數多一種 kind。🔴 **M1 修掉之後【匯款單修不好】的數字可能下降**(訂金單不再被誤報)—— 那是修好,不是漏。
- 效能:排程每輪候選變小(訂金單不進)、OP6a 呼叫仍 ≤ 50 次;健康檢查 C 世界預篩 `received >= total AND received > 0`。**沒量過真實資料的耗時**(正式庫分母近 0),寫在驗收。

## 6. Rollback(M3 重寫)

- **同一個交易、先退函式、再退 CHECK**(反過來的話,新函式寫事故會撞舊 CHECK,錯誤被巢狀 handler 吞掉、沒人知道):
  1. `pcm_noncard_settle_recompute` / `pcm_settle_retry_sweep` / `get_stuck_bank_orders_health` / `get_settle_retry_gaveup_health` 各自 `CREATE OR REPLACE` 回本片之前那一代(逐字抄 `20260905290000:227` / `20260905220000:72` / `20260905060000:78` / `20260905250000:34`);前置閘釘本代 md5。
  2. `DROP FUNCTION pcm_settle_verdict_safe`(先確認沒有其他呼叫端)。
  3. CHECK:**若已有 `settle_recompute_failed` 列 ⇒ 不退 CHECK**(保留 7 種,本片前置閘已接受 7 種形狀,之後可重貼);沒有才退回 6 種。
  - ⛔ ~~把新 kind 的列蓋上 resolved_at 再退 CHECK~~ —— CHECK 驗每一列的 kind,不看 resolved_at,那樣 rollback 會失敗(M3)。
  - 不刪事故列(那是證據)。
- TS 片 revert 一顆 commit;讀新鍵缺值時已是「讀不到」路徑,DB 先退、TS 後退也不會誤報 0。

## 7. 驗收

拋棄式 PG:`~/pcm-mailbox/schema-dump-20260915/up.sh`(dump 11:58)⇒ 依序套 **178–183**(`20260915230000 / 233000 / 234000 / 20260916000000 / 010000 / 020000`)+ **184**(`20260828070000`,COMMENT only)⇒ 再套本片。(N3:帳本以主樹 dev 為準,184 的記帳 commit 還沒推。)

世界(v1 的 7 個 + 審查 S6 補的):
1. 匯款單,重算時讓 OP6a 丟錯 ⇒ 收款列還在、狀態不動、**`pcm_incident` 多一列 `settle_recompute_failed`**。
2. 同 1,但把 `pcm_incident_log` 權限拿掉 ⇒ 收款列還在、狀態不動、只有 `RAISE LOG`,**不回捲**。
3. 同 1 再觸發一次 ⇒ 事故**仍是 1 列**(去重)。
4. 現金單同 1 ⇒ 排程下一輪修成 paid。
5. **訂金單**(partiallyPaid、淨額 < total)跑排程 6 輪以上 ⇒ **不進候選、attempts 0、放棄章 0**。
6. **同一輪一張 OP6a 丟錯 + 一張正常** ⇒ 正常那張被修好;壞那張 attempts +1。
7. 讓重算一直失敗 ⇒ 5 次後放棄;**24 小時後重開 ⇒ attempts 從 1 重數、再試 5 次才再放棄**。
8. unpaid 收了一半的匯款單 ⇒ OP6a 判 underpaid ⇒ 排程修成 partiallyPaid、算成功。
9. 有未作廢人工退款的單 ⇒ 不進排程候選、不進 C 世界。
10. 健康檢查:C 世界匯款 1 + 現金 1 ⇒ `unpaid_settled_bank_count = 1`、`unpaid_settled_cash_count = 1`;**0 元 unpaid 匯款單 ⇒ 0**;有退款讓 OP6a 判 underpaid 的不算;OP6a 丟錯那張 ⇒ `judge_error_count = 1`、其他鍵照常。
11. 既有 A / B 世界數字與現金無關、不變(拿現有 after-check 再跑一次)。
12. 放棄健康檢查:匯款 / 現金放棄各 1 ⇒ 分開鍵各 1、舊 `gave_up_count = 2`。
13. **排程函式 owner 不是 postgres 時** ⇒ 前置閘擋下(不靜靜吞)。
14. 刷卡收款列觸發重算失敗 ⇒ 一樣寫 `settle_recompute_failed`(名稱中性)。
15. **有 `settle_recompute_failed` 列時跑 rollback** ⇒ 函式退回、CHECK 保留 7 種、交易成功。
16. ACL:所有動到的函式 EXECUTE 權限與改之前逐角色相同;`pcm_settle_verdict_safe` 只給該給的。
- TS:`check-anomaly-alerts.test.ts` 加 C 世界兩段文案 + 缺鍵 = 讀不到 + 現金段落不得含「匯款 / 銀行帳號」;三綠;adversarial-reviewer 一輪(缺 codex 那一路)。
- 開工第一步(唯讀):量正式庫 `pcm_settle_retry_attempts` 今天有幾張放棄章、幾張是訂金單(M1 現有誤報規模)。
- 上線後:下一輪異常告警信實際看一眼新段落在不在。

## 8. 要主視窗 / Sean 裁的

```
Q-M2:「重試放棄」要不要另外寫事故?(Sean q1 甲原本包含「重試放棄寫事故」)
A:  甲 不寫(推薦):放棄的單今天已有 get_settle_retry_gaveup_health + 告警信【匯款單修不好】段 + LINE 摘要在看(事實 #12)。
       再寫事故 ⇒ 同一張單在信裡出現兩段。本片改成:修掉訂金單誤報(M1)、重開歸零、該段依匯款 / 現金分開。
  | 乙 照原本寫:加 kind settle_retry_gave_up,只在「沒章→有章」那一刻寫 + 同單未解決不重寫;
       並在信裡寫明兩段的分工(事故段 = 事件、修不好段 = 此刻名單)。CHECK 改加兩種。
```

## 9. 估時

前置唯讀量測 + migration(safe verdict + CHECK + 四支函式)+ 拋棄式 PG 16 個世界 ~150 分;TS 文案 ~60 分;adversarial-reviewer 每片一輪另計。拆兩片(DB 一片、TS 一片)。

## 10. v1 → v2 對照(adversarial-reviewer R1)

| 條 | 內容 | v2 處置 |
|---|---|---|
| M1 | 排程只把 paid 算成功 ⇒ 訂金單被誤報放棄;重開 attempts 不歸零 | 4-C ②④、驗收 5 / 7 / 8 |
| M2 | 放棄的單早有健康檢查 + 信件段 | 事實 #12;§8 Q-M2(推薦不另寫事故) |
| M3 | resolved_at 擋不了 CHECK;退函式要先於退 CHECK 同交易;前置閘要接受兩種形狀 | §6 重寫、4-A 前置閘、驗收 15 |
| M4 | A / B 擴現金 = 重開 codex 當年 must-fix、文案錯 | 4-D A / B 維持匯款、C 世界與放棄段依管道分鍵分文案 |
| M5 | OP6a 在迴圈外 / CTE 逐列 ⇒ 一張壞單拖垮整輪 | 4-0 safe verdict、4-C ③、4-D、驗收 6 / 10 |
| S1 | 4-B 要去重;trigger 對刷卡也跑 | 4-B 去重、kind 改名、驗收 3 / 14 |
| S2 | C 世界加淨額 > 0、A / C 共用判定 | 4-D、驗收 10 |
| S3 | 前置閘只比 md5 看不到 owner / ACL | 4-B / 4-C 前置閘、驗收 13 / 16 |
| S4 | 未作廢人工退款的單重算直接 RETURN | 4-C ②、4-D、驗收 9 |
| S5 | lock_timeout、事後閘別持鎖呼叫 | 4-A |
| S6 | 驗收缺 8 個世界 | 驗收 5–16 |
| N1 | 事實 #2 / #3 行號錯 | 已訂正 |
| N2 | 放棄事故 detail 在「沒丟錯但狀態沒變」只會是固定字串 | 隨 Q-M2 甲一併不適用 |
| N3 | 帳本最後 7 列不是 178–184 | §7 列出版本號,184 以主樹 dev 為準 |
