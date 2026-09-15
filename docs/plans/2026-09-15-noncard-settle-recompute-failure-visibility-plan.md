# 2026-09-15 · 非刷卡收款「狀態重算吞錯」讓人看得見 —— plan(v3)

> 設計窗寫 v1(`779e3a6ef`);A 窗改 v2(`96c5a2e46`)、v3(本檔)。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P1-6**。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼、零 migration。** 碰函式定義 + 權限 + 事故種類 CHECK(schema)+ 錢(收款狀態)⇒ 鐵則 8 + 12,等主視窗逐條核過回「可以開工」。
> 審查:專案 adversarial-reviewer(opus、唯讀;codex 額度用完至 09-20,**缺 codex 那一路**)。R1 審 v1 = FAIL(M1–M5);R2 審 v2 = FAIL(MF1 一條 + S1–S7 + N1–N6),R1 五條經 R2 核實全關。照規矩 R2 仍有必修即停下,由 Sean 裁(§8)。**Sean 拍不跑 R3。**
> Sean 拍板總表在 §8;v1→v2→v3 每條審查意見落在哪一段見 §10。

## 1. 白話

- 客人用**匯款或現金**付錢,員工登記收款的那一刻,系統會重算這張單「付清了沒」,把狀態改成已付款(或已付部分)。
- 那一次重算**如果出錯,系統刻意把錯吞掉**:錢照收(不能因為算錯就把收款退回去),**但狀態不動,而且只寫一行 server log,沒有任何人會知道。**
- 匯款客人那一端:訂單頁一直顯示「請匯款」+ 銀行帳號 ⇒ **他可能再匯一次。**
- 今天已經有一支排程(每 10 分鐘)會回頭再算,**但它只救匯款單、不救現金單**,而且**成功判準寫錯**:正常收了訂金的單會被當成「修不好」蓋放棄章(正式庫今天那張表 0 列,目前沒有實害)。
- 本 plan 要做:
  ①重算吞錯時寫一筆事故紀錄
  ②重試排程救現金單、修掉訂金單誤判、修好或重開時次數歸零、一張壞單不再拖垮整輪
  ③**重試放棄的那一刻也寫一筆事故紀錄**(Sean 第二次拍乙)
  ④每天兩次的異常告警多數一種單:「**錢已經收足,狀態還是未付款**」,匯款與現金**分開數、分開寫文案**;放棄那段也分匯款 / 現金

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 重算函式 `public.pcm_noncard_settle_recompute(uuid)`(SECURITY DEFINER、`SET search_path TO ''`),最新一代第 3 代 | `bash scripts/latest-definition-of.sh pcm_noncard_settle_recompute` ⇒ `20260905290000_m4b_pending_refund_open_failure_incident.sql:227` |
| 2 | 外層整段 `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE LOG '… 重算失敗(%), 收款事實保留、狀態不動' END`,**只寫 log** | 同檔 `:442-445` |
| 3 | 同一支函式**內層**已有「寫事故 + 再包一層防護」的現成寫法(`DECLARE v_err text := SQLERRM; BEGIN PERFORM pcm_incident_log(...) EXCEPTION WHEN OTHERS THEN RAISE LOG ... END`) | 同檔 `:278-303` |
| 4 | 事故表 `public.pcm_incident(id, kind, subject_id, detail, created_at, resolved_at)`;寫入走 `pcm_incident_log(kind, subject_id, detail)`(SECURITY DEFINER、owner postgres、**四道 REVOKE、零 GRANT**) | `20260905290000:116-122`、`:165-188` |
| 5 | 🔴 **房規:新物件出生就自帶 anon 權限** ⇒ 新函式要四道 REVOKE(PUBLIC / anon / authenticated / service_role, payment_confirmer) | `20260905290000:136`(逐字)、`:183-186` |
| 6 | `kind` 封閉集 CHECK 最新定義 6 種:`pending_refund_open_failed / refund_over_total / auto_cancel_skipped / auto_cancel_failed / line_forward_failed / auto_cancel_live_shipment` | `20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql:66-67`(第 183、184、185 張沒碰) |
| 7 | 🔴 TS 側有一份逐字相同的事故種類白名單 `KNOWN_INCIDENT_KINDS`,測試逐字比對 CHECK ⇒ **只改 CHECK 不改白名單,測試會紅** | `packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:1954-1961`、`packages/adapters/src/payment/incident-kind-two-truths.test.ts:83-88` |
| 8 | 重算 trigger `pcm_noncard_settle_after_payment_ai` **沒有 WHEN**:所有收款列(含刷卡)都會跑重算;函式內**不看付款管道** | `20260904230000:384-386`;`20260905290000:227-445` grep `payment_channel` = 0 |
| 9 | 有**未作廢人工退款**的單,重算直接 `RETURN`(交還退款管線) | `20260905290000:359-367` |
| 10 | 重試排程 `public.pcm_settle_retry_sweep()`(每 10 分):撈 `payment_channel = 'bank_transfer'`、`unpaid/partiallyPaid`、已收 > 0,**在 FOR 查詢外層 WHERE** 以 OP6a 判 `settled/underpaid`;迴圈內每張各自 `BEGIN/EXCEPTION` 重算;最多 5 次 | `20260905220000_m4b_settle_retry_sweep.sql:72-200`(只有 1 代) |
| 11 | 排程**只把「重算後變 `paid`」算成功**;成功分支 `attempts = t.attempts + 1`(不歸零);失敗分支 `gave_up_at = CASE WHEN t.attempts + 1 >= c_max_attempts …` | `20260905220000:150-168`、`:155` |
| 12 | 24 小時重開後 `attempts` 不歸零 ⇒ 重開後第一次失敗就再蓋章 | `20260905220000:117-120`、`:168`、`:188` |
| 13 | OP6a 在排程 FOR 查詢外層、每張單的 BEGIN/EXCEPTION 之外 ⇒ 一張單讓 OP6a 丟錯,整輪失敗 | `20260905220000:132-133` |
| 14 | `pcm_settle_retry_attempts(order_id, attempts, last_attempt_at, last_error, gave_up_at)` **沒有管道欄**;`pcm_readonly` 有欄位 SELECT | `20260905220000:47-53`;`20260906380000:150-151` |
| 15 | 放棄的單今天已有人看:`get_settle_retry_gaveup_health()`(`gave_up_count` 等)+ 告警信【匯款單修不好】段(逐字「N 張匯款單…這些人已經匯了錢」,且已寫「這個數字是【此刻】不是【累計】」)+ LINE `settleRetryGaveUpCount` | `20260905250000:34-61`、`check-anomaly-alerts.ts:1710-1721`、`owner-line-digest.ts:38` |
| 16 | 匯款卡單健康檢查 `get_stuck_bank_orders_health()`(plpgsql STABLE):**刻意只看 `bank_transfer`**(codex 當年 must-fix:信裡寫「請匯款 + 銀行帳號」,現金客人看不到);OP6a 在 `judged` CTE 逐列呼叫 | `20260905060000_m4b_stuck_bank_orders_health.sql:80-81`、`:105-114`、`:141-145` |
| 17 | 信件文案寫死「匯款單」「請匯款 + 銀行帳號」 | `check-anomaly-alerts.ts:2002-2004`、`:2028-2030`、`:1713-1716` |
| 18 | adapter 讀健康檢查用 `readPair`:**鍵不對整支丟錯** ⇒ `stuckBankFailed`、route 回 503 | `PgAnomalyAlertReaderAdapter.ts` 約 `:1162-1185` |
| 19 | 事故去重既有寫法 `NOT EXISTS (… kind AND subject_id AND resolved_at IS NULL)`;前置閘 P7 驗 `pcm_incident` owner = postgres 且未 FORCE RLS(否則 definer 去重會安靜讀到 0 列) | `20260907140000:214-216`;同檔前置閘 P7(約 `:98-107`) |
| 20 | 🔴 `pcm_incident.resolved_at` **全 repo 沒有任何寫入端** ⇒ 去重語意「處理完又壞會再寫」正確但今天走不到:一張單同 kind 永遠只有 1 列,修好之後事故仍掛著、告警持續算它 | `20260907140000:2-3`、`:278-284` |
| 21 | 事故數量出口 `get_pcm_incident_health()` 回各 kind 未解決筆數 ⇒ 新 kind 自動進告警信 | `20260905290000:192-214` |
| 22 | OP6a 應收 = `o.total`、已收 = 所有收款列加總、有任何退款跡象判 `needs_human` ⇒「淨額 >= total」恰等於 settled 或 overpaid。🔴 **實作時訂正**:OP6a 的退款跡象只讀 order_refunds / payment_refunds / order_refund_jobs / payment_double_charge_anomalies,**不讀 `order_manual_refunds`** —— 拋棄式 PG 實測有未作廢人工退款的單照判 settled。等價仍成立(只靠 gross / receivable / net),人工退款單在排程候選與 C 世界另外排除 | `20260907170000:106`、`:233`、`:270`;訂正:adversarial-reviewer R1 N1 + 驗收 E.sql |
| 23 | 現金收款只走 `admin_record_manual_payment(p_rail='cash')`;找不到把現金單錯推成 paid 的世界 | `20260915234000:168-172`、`:416-419` |
| 24 | `pcm_settle_retry_sweep` 從沒寫 `ALTER OWNER` ⇒ 正式庫 owner 未知 | `20260905220000:72-76`、`:217-220` |
| 25 | 0 元 unpaid 單:零收款、零 charged,OP6a 判 `settled` | `20260907170000:236`、`:291` |
| 26 | 出貨只擋「已取消」與「刷卡已退款」;發票是手寫紙本(0913 拍板)⇒ 現金單「出貨 / 開發票會被擋」**查無根據** | `apps/admin/src/lib/shipment-candidates.ts:236-241`(R2 N2) |
| 27 | 正式庫唯讀(R2 量):`pcm_settle_retry_attempts` 0 列(tracked=0、gave_up=0);匯款單 unpaid 1 張、refunded 1 張 | R2 審查當場唯讀查詢 |

## 3. 缺口

| 缺口 | 現況 | 後果 |
|---|---|---|
| G1 外層吞錯只寫 log | 事實 #2 | 第一次重算失敗,沒有人知道 |
| G2 排程只救匯款單 | 事實 #10 | 現金單重算失敗,永遠停在原狀態 |
| G3 排程成功判準錯 + 次數不歸零 | 事實 #11-12 | 訂金單誤報;真壞的單重開只試 1 次;修好後再壞永遠不再試 |
| G4 一張壞單拖垮整輪 | 事實 #13、#16 | 同批其他單修不到;健康檢查整支讀不到 |
| G5 放棄只有「此刻」快照 | 事實 #15 | 24 小時重開那段時間章被拿掉,一天兩次的告警可能拍不到(Sean 拍乙的理由) |
| G6 健康檢查看不到「錢收足、狀態未付」 | 事實 #16 | 就算前面都漏了,告警也不會提 |

## 4. 做法(DB 一片 + TS 一片)

### 4-0 共用小工具:不會丟錯的 verdict
- 新增 `public.pcm_settle_verdict_safe(p_order_id uuid) RETURNS text`:plpgsql、**STABLE**、SECURITY DEFINER、`SET search_path = ''`:
  `BEGIN RETURN public.admin_compute_order_settlement(p_order_id) ->> 'verdict'; EXCEPTION WHEN OTHERS THEN RAISE LOG …; RETURN 'error'; END`
- 🔴 **權限(R2 MF1)**,照 `20260905290000:183-188` `pcm_incident_log` 的形狀:
  ```
  ALTER FUNCTION public.pcm_settle_verdict_safe(uuid) OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM anon;
  REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM authenticated;
  REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM service_role, payment_confirmer;
  ```
  **一個 GRANT 都不給**:兩個呼叫端(排程、健康檢查)都是 SECURITY DEFINER、owner postgres,內部呼叫以 owner 身分檢查權限(事實 #4、#16;排程 owner 由 4-C 前置閘保證)。不給的理由:房規新物件出生自帶 anon 權限(事實 #5),照字面只 REVOKE PUBLIC 會讓 anon / authenticated 叫得動一支以 postgres 身分讀訂單的函式(OP6a 查詢口 + DoS 入口;OP6a 本身只授 service_role,`20260907170000:320-323`)。
- plpgsql 的 BEGIN/EXCEPTION 是 savepoint,吞掉的例外只退到那個點,外層交易不會變 aborted(R2 a 項核過)。
- ⚠️ `WHEN OTHERS` 不接 `query_canceled`(與 repo 慣例一致),逾時仍整輪回捲(既有 ⟦b4-NCPCANCELROLLBACK⟧,本片不修)。

### 4-A 事故種類 CHECK 加兩種(schema)+ TS 白名單同一顆
- `settle_recompute_failed`:重算外層吞錯那一刻寫(4-B)。**不叫 `noncard_…`**:trigger 對刷卡收款列也會跑、函式不看管道(事實 #8)。
- `settle_retry_gave_up`:重試排程**第一次蓋上放棄章**那一刻寫(4-C ⑤)。名稱理由:與既有排程函式名 `pcm_settle_retry_sweep`、表名 `pcm_settle_retry_attempts`、健康檢查 `get_settle_retry_gaveup_health` 同一個字根,讀告警的人能直接對到那支排程;`gave_up` 與表欄 `gave_up_at` 同字。
- 寫法照 `20260916010000:47-67`:DROP + ADD `pcm_incident_kind_check`。
- 🔴 前置閘**同時接受兩種逐字形狀**:現況 6 種(首次貼)或本片後的 8 種(「保留 CHECK 只退函式」之後重貼)。其他形狀一律停。
- `SET LOCAL lock_timeout = '5s'`;ADD CHECK 不用 NOT VALID(pcm_incident 量小)。**事後閘不在持有 ACCESS EXCLUSIVE 時呼叫排程或健康檢查**。
- 🔴 **R2 S4**:`PgAnomalyAlertReaderAdapter.ts:1954` 的 `KNOWN_INCIDENT_KINDS` 加這兩個字、**與 migration 同一顆 commit**;`incident-kind-two-truths.test.ts` 當場跑綠(事實 #7)。

### 4-B 重算外層吞錯寫事故(G1)
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
- 形狀抄同一支函式內層 `:278-303`(已上線用過)。
- 去重(照事實 #19):排程會對同一張單重算多次,每次吞錯都會進這裡 ⇒ 同單同 kind 未解決就不再寫。
- 🔴 **R2 S6-b,寫明不修**:`resolved_at` 全 repo 沒有寫入端(事實 #20)⇒ 一張單這個 kind 永遠只有 1 列;**排程後來把它修好,事故仍掛著、`get_pcm_incident_health` 仍算它**。本片不加「修好就蓋 resolved_at」(那是另一條寫入路徑、要另外審),只在告警信那段寫明「事故數是累計、不是此刻還壞的張數」(4-D TS)。
- `SET search_path TO ''` 必須在 `CREATE OR REPLACE` 裡重寫(`reference_create-or-replace-resets-set-clause`)。
- 前置閘:① 定義 md5 = `20260905290000` 那一代 ② 函式 owner = postgres、prosecdef = t、proconfig 含 search_path=''、ACL 逐角色與現況相同 ③ 🔴 **R2 S6-a**:`pcm_incident` owner = postgres 且 `NOT relforcerowsecurity`(照 `20260907140000` 前置閘 P7,事實 #19)。任一不符就停。

### 4-C 重試排程(G2、G3、G4、G5)
- `CREATE OR REPLACE pcm_settle_retry_sweep`(從 `20260905220000:72` 抄),改六件事:
  1. **管道**:`payment_channel = 'bank_transfer'` ⇒ `IN ('bank_transfer', 'cash')`。
  2. **候選只收「狀態真的該變」的單**:FOR 查詢只用純算術預篩 + 排除未作廢人工退款(事實 #9):
     - `unpaid` 且淨額 > 0(OP6a 判 settled ⇒ 該變 paid;判 underpaid ⇒ 該變 partiallyPaid)
     - `partiallyPaid` 且淨額 `>= total`(可能已補足)
     - ⇒ 正常訂金單(partiallyPaid 且淨額 < total)不進候選,不會被試、不會蓋章。
     - 🔴 **R2 N1 訂正註記**:預篩【不會漏】v1 救得到的單 —— OP6a 應收就是 `total`、有任何退款一律判 needs_human(事實 #22)⇒「淨額 >= total」恰等於 settled / overpaid。檔頭註記照這個寫,不寫「可能漏撈」。
     - ponytail 註記(R2 N5,既有問題):一輪 `LIMIT 50` 按建立時間最舊排,判 overpaid / needs_human 的單在迴圈內跳過又不記次數,會一直佔名額;加進現金後佔名額的單會更多。上限:同時卡住 > 50 張跳過單時,後面的單要等前面被人工處理。升級路徑:跳過單記一個 `skipped_until` 冷卻欄。本片不做。
  3. **verdict 搬進迴圈內**:每張單在自己的 `BEGIN/EXCEPTION` 裡呼叫 `pcm_settle_verdict_safe`:
     - `'error'` ⇒ 記一次失敗(`last_error = 'verdict 計算失敗'`),進放棄計數;
     - verdict 不是 `settled / underpaid` ⇒ 跳過,不記次數;
     - `settled` ⇒ 期望 `paid`;`underpaid` ⇒ 期望 `partiallyPaid`。
  4. **成功判準 = 重算後狀態等於期望狀態**,其他才算失敗。
  5. 🔴 **次數怎麼數**(R2 S1、S2),三個 upsert 分支(成功 / 失敗 else / `WHEN OTHERS`,加上新的 verdict `'error'`)全部改:
     - **成功**:`attempts = 0`、`gave_up_at = NULL`、`last_error = NULL`(S1:underpaid 翻 partiallyPaid 不是終態,之後補尾款再壞時要能重新被試)。
     - **失敗**(三條失敗分支同一個寫法):
       ```
       attempts   = CASE WHEN t.gave_up_at IS NOT NULL THEN 1 ELSE t.attempts + 1 END,
       gave_up_at = CASE WHEN (CASE WHEN t.gave_up_at IS NOT NULL THEN 1 ELSE t.attempts + 1 END) >= c_max_attempts
                         THEN pg_catalog.clock_timestamp() ELSE NULL END
       ```
       判準用 `t.gave_up_at IS NOT NULL`(候選條件已保證它 > 24 小時才進得來),**不另比 now()**:候選條件用 `clock_timestamp()`(事實 #12),交易拖得久時兩者會不一致(S2)。ON CONFLICT 的 SET 右邊讀的全是舊列,所以 `attempts` 與 `gave_up_at` 兩個式子都要用同一個「重開歸零」判準,不能只改一個。
  6. 🔴 **放棄寫事故(Sean 拍乙)**:
     - 每張單在 upsert 前先 `SELECT gave_up_at INTO v_prev FROM pcm_settle_retry_attempts WHERE order_id = r.id FOR UPDATE`(沒有列 ⇒ NULL)。
     - upsert 用 `RETURNING gave_up_at INTO v_new`。
     - **只在「沒章 → 有章」那一刻寫**:`v_new IS NOT NULL AND v_new IS DISTINCT FROM v_prev`(= 這一次 upsert 蓋了一個新的章)。
       涵蓋兩種:① `v_prev IS NULL`(第一次蓋章)② 重開後再失敗 5 次重新蓋章(`v_prev` 是 24 小時前那個舊章、`v_new` 是新章,兩者不同)。
       重開後尚未滿 5 次的失敗 ⇒ `v_new` 是 NULL ⇒ 不寫。成功分支 `gave_up_at = NULL` ⇒ 不寫。
     - 再加 `NOT EXISTS (kind = 'settle_retry_gave_up' AND subject_id = r.id AND resolved_at IS NULL)`:**同單未解決不重寫**。因 `resolved_at` 沒有寫入端(事實 #20),實際效果是一張單這個 kind 永遠 1 列 —— 重開後再放棄不會多寫;這與 Sean「同單未解決不重寫」一致。
     - `detail` = `last_error`;R2 N2:在「沒丟錯但狀態沒變」那條路上會是固定字串,不是真錯誤訊息 ⇒ detail 前綴寫明是哪一條路(`verdict 計算失敗` / `重算後狀態仍非期望` / `重算丟錯:SQLERRM`)。
     - 寫事故包巢狀 `BEGIN/EXCEPTION`(同 4-B),寫不進去只 RAISE LOG、不影響排程本身。
- 前置閘:md5 + owner + ACL。`pcm_settle_retry_sweep` 今天 owner 未知(事實 #24)⇒ 前置閘**先讀出來印**;不是 postgres 就停回報。

### 4-D 健康檢查 + 告警文案(G4、G5、G6)
**DB 側(與 4-A/B/C 同一支 migration)**
- 改 `get_stuck_bank_orders_health()`(從 `20260905060000:78` 抄):
  - **A / B 世界維持只看 `bank_transfer`,既有鍵與文案一字不改**。
  - `judged` CTE 改呼叫 `pcm_settle_verdict_safe`;新增 `judge_error_count`。
  - 新增 **C 世界**,匯款與現金**分開兩組鍵**:
    - `unpaid_settled_bank_count / unpaid_settled_bank_oldest`
    - `unpaid_settled_cash_count / unpaid_settled_cash_oldest`
    - 條件:`payment_status IN ('unpaid','partiallyPaid')` 且**淨額 > 0**(排除 0 元單,事實 #25)且淨額 `>= total` 且無未作廢人工退款,以**同一個 `judged` CTE** 判 `verdict = 'settled'`(A / C 共用同一次判定,不重複數)。
    - 現金那組候選管道 `= 'cash'`,與 A / B 的 bank 候選分開 CTE。
- 改 `get_settle_retry_gaveup_health()`(從 `20260905250000:34` 抄):
  - 🔴 **R2 S3**:attempts 表沒有管道欄(事實 #14)⇒ `JOIN public.orders o ON o.id = a.order_id`。
  - **舊鍵 `gave_up_count` / `oldest_gave_up` / `sample_order_ids` 維持只數匯款**(`o.payment_channel = 'bank_transfer'`)⇒ DB 片先上、TS 片還沒上的空窗裡,舊信件段「N 張匯款單…這些人已經匯了錢」仍然正確,**不會把現金單寫成匯款單**。
  - 新鍵 `gave_up_cash_count / oldest_gave_up_cash / sample_cash_order_ids`。
  - `tracked_total` 語意不變(全表列數)。
  - R2 N6:join 不到 orders 的列(訂單被刪)兩邊都不算 ⇒ 匯款 + 現金可能 < 全部放棄列數;驗收不寫「相加相等」。

**TS 側(另一片)**
- `PgAnomalyAlertReaderAdapter`:
  - 🔴 **R2 S5**:新鍵(C 世界兩組、放棄現金一組、`judge_error_count`)**用獨立的選讀,缺鍵 = 讀不到(`unknown`),不丟錯**;A / B 世界與舊放棄鍵仍用既有 `readPair`、行為一字不改 ⇒「DB 先退、TS 後退」或「TS 先上」的空窗裡,A / B 不會跟著讀不到、route 不會 503。
- `check-anomaly-alerts.ts`:
  - 【匯款單錢收足、狀態未付】:可沿用「訂單頁仍顯示請匯款 + 銀行帳號 ⇒ 客人可能再匯」。
  - 【現金單錢收足、狀態未付】:**不得**寫「請匯款 / 銀行帳號」,**也不寫「出貨 / 開發票會被擋」**(R2 N2,事實 #26 查無根據);只寫「後台與客人訂單頁都還顯示未付款,請對一次金額」,字面開工時照畫面實際文字核。
  - `judge_error_count > 0` 加一行。
  - 【匯款單修不好】段:文案不動(已含「此刻不是累計」);新增【現金單修不好】段(不寫「已經匯了錢」)。
  - 🔴 **兩段分工寫進信(Sean 拍乙)**:放棄段 = **此刻**還掛著放棄章的名單(24 小時重開時章會被拿掉,可能拍不到);事故段裡的 `settle_retry_gave_up` = **曾經放棄過**的紀錄(會留下,不會因重開消失)。
  - 事故段對 `settle_recompute_failed` / `settle_retry_gave_up` 寫明「**累計、不是此刻還壞的張數**」(事實 #20)。
- `owner-line-digest.ts`:加旗標,匯款 / 現金分開。

## 5. 影響

- 客人:無直接變化;間接好處是「錢收足而頁面還在叫他匯款」會在 12 小時內被員工看到。
- 員工 / Sean:異常告警信與 LINE 可能多出段落;事故數多兩種 kind。
- ⛔ ~~M1 修掉之後【匯款單修不好】的數字可能下降~~ —— R2 N3:v3 不清已經蓋的章,數字不會自己降;正式庫那張表今天 0 列(事實 #27),目前沒有實害。貼板前再量一次(§7 開工第一步)。
- 效能:排程每輪候選變小(訂金單不進)、OP6a 呼叫仍 ≤ 50 次;健康檢查 C 世界預篩 `received >= total AND received > 0`。**沒量過真實資料的耗時**(正式庫分母近 0)。

## 6. Rollback

同一個交易、依序:
1. 🔴 **R2 N4**:`LOCK TABLE public.pcm_incident IN SHARE ROW EXCLUSIVE MODE`(判斷「有沒有新 kind 列」之前先鎖,避免判斷完到退 CHECK 之間有人寫入)。
2. 退函式(新函式寫事故撞舊 CHECK 會被巢狀 handler 吞掉、沒人知道 ⇒ **函式一定先於 CHECK**):
   `pcm_noncard_settle_recompute` / `pcm_settle_retry_sweep` / `get_stuck_bank_orders_health` / `get_settle_retry_gaveup_health` 各自 `CREATE OR REPLACE` 回本片之前那一代(逐字抄 `20260905290000:227` / `20260905220000:72` / `20260905060000:78` / `20260905250000:34`,含原本的 owner / REVOKE / GRANT);前置閘釘本代 md5。
3. `DROP FUNCTION public.pcm_settle_verdict_safe(uuid)`(先確認已無呼叫端)。
4. CHECK:**若已有 `settle_recompute_failed` 或 `settle_retry_gave_up` 列 ⇒ 不退 CHECK**(保留 8 種;本片前置閘接受 8 種形狀,之後可重貼);兩種都沒有才退回 6 種。
   - ⛔ ~~把新 kind 的列蓋上 resolved_at 再退 CHECK~~ —— CHECK 驗每一列的 kind,不看 resolved_at。
   - 不刪事故列(那是證據)。
- TS:revert TS 那一顆;DB 片那一顆裡的 `KNOWN_INCIDENT_KINDS` 兩個字**跟著 CHECK 的去留走**(CHECK 保留 8 種就不退白名單,否則 `incident-kind-two-truths.test.ts` 會紅)。
- 新鍵缺值時 TS 走「讀不到」路徑(4-D S5),DB 先退、TS 後退不會誤報 0、也不會拖垮 A / B。

## 7. 驗收

**拋棄式 PG**:`bash ~/pcm-mailbox/schema-dump-20260915/up.sh shop`(dump 11:58)⇒ 依序套:
- **178–183**:`20260915230000` / `20260915233000` / `20260915234000` / `20260916000000` / `20260916010000` / `20260916020000`
- **184**:`20260828070000_m4b_b4mgr0_is_manager_comment.sql`(COMMENT only;記帳 commit 在主樹 dev,origin/dev 未必有)
- **185**:`20260916030000_m4b_unpaid_cancel_email_staff_full_cancel_audit_evidence.sql`(未付款取消信判準;A 窗 grep 過沒碰本片函式 / CHECK / order_payments / payment_channel)
- ⇒ 再套本片。

**開工第一步(唯讀,貼板前也再量一次)**:正式庫 `pcm_settle_retry_attempts` 有幾張放棄章、其中幾張是訂金單(partiallyPaid 且淨額 < total)。R2 量到 0 列;**若 > 0,在同一支 migration 清掉那些訂金單的列**(R2 S7)。

世界:
1. 匯款單,重算時讓 OP6a 丟錯 ⇒ 收款列還在、狀態不動、`pcm_incident` 多一列 `settle_recompute_failed`。
2. 同 1,但拿掉 `pcm_incident_log` 權限 ⇒ 收款列還在、狀態不動、只有 RAISE LOG,不回捲。
3. 同 1 再觸發一次 ⇒ 事故仍是 1 列(去重)。
4. 現金單同 1 ⇒ 排程下一輪修成 paid。
5. 訂金單(partiallyPaid、淨額 < total)跑排程 6 輪以上 ⇒ 不進候選、attempts 0、放棄章 0、事故 0。
6. 同一輪一張 OP6a 丟錯 + 一張正常 ⇒ 正常那張被修好;壞那張 attempts +1。
7. 讓重算一直失敗 ⇒ 第 5 次蓋放棄章 + **`settle_retry_gave_up` 恰 1 列**;再跑一輪(未滿 24 小時,不進候選)⇒ 不多寫。
8. 同 7,把 `gave_up_at` 撥到 25 小時前 ⇒ 重開 ⇒ attempts 從 1 重數、要再失敗 5 次才再蓋章;再蓋章時 `settle_retry_gave_up` **仍是 1 列**(同單未解決不重寫)。
9. 🔴 **R2 S7**:重開那一次走 **`WHEN OTHERS` 分支**(重算直接丟錯)⇒ attempts 一樣從 1 起算、不馬上再蓋章。
10. 🔴 **R2 S7 / S1**:失敗 4 次 ⇒ 第 5 次成功(attempts 歸 0、無章)⇒ 之後又壞 ⇒ 排程會再試、要再失敗 5 次才蓋章。
11. unpaid 收了一半的匯款單 ⇒ OP6a 判 underpaid ⇒ 排程修成 partiallyPaid、算成功、attempts 0。
12. 有未作廢人工退款的單 ⇒ 不進排程候選、不進 C 世界。
13. 健康檢查 C 世界:匯款 1 + 現金 1 ⇒ `unpaid_settled_bank_count = 1`、`unpaid_settled_cash_count = 1`;0 元 unpaid 匯款單 ⇒ 0;有退款讓 OP6a 判 needs_human 的不算;OP6a 丟錯那張 ⇒ `judge_error_count = 1`、其他鍵照常。
14. 既有 A / B 世界數字與現金無關、不變(拿現有 after-check 再跑一次)。
15. 放棄健康檢查:匯款 / 現金放棄各 1 ⇒ `gave_up_count = 1`(只數匯款)、`gave_up_cash_count = 1`;訂單被刪的放棄列兩邊都不算。
16. 排程函式 owner 不是 postgres ⇒ 前置閘擋下。
17. `pcm_incident` 被下 FORCE RLS ⇒ 前置閘擋下(R2 S6-a)。
18. 刷卡收款列觸發重算失敗 ⇒ 一樣寫 `settle_recompute_failed`。
19. 有新 kind 列時跑 rollback ⇒ 函式退回、CHECK 保留 8 種、交易成功。
20. 🔴 **R2 MF1**:`pcm_settle_verdict_safe` 以 **PUBLIC(一般登入角色)/ anon / authenticated / service_role / payment_confirmer** 身分呼叫 ⇒ 全部 `permission denied`;排程與健康檢查照常呼叫得到它。
21. ACL:所有動到的既有函式 EXECUTE 權限與改之前逐角色相同。
- TS:
  - 🔴 **R2 S7 / S5**:DB 缺新鍵時,A / B 照常出信、route 不 503,新段落印「讀不到」。
  - `check-anomaly-alerts.test.ts`:C 世界兩段文案 + 現金段不得含「匯款 / 銀行帳號 / 出貨 / 發票」+ 放棄段兩段分工字面 + 事故段「累計」字面。
  - `incident-kind-two-truths.test.ts` 綠(DB 片那顆)。
  - 三綠;adversarial-reviewer 每片一輪(缺 codex 那一路)。
- 上線後:下一輪異常告警信實際看一眼新段落在不在。

## 8. Sean 拍板總表

| 日期 | 題目 | 答 | 備註 |
|---|---|---|---|
| 2026-09-15 | v1 Q1 照做嗎 | 甲(全做) | 逐字「q1 甲」 |
| 2026-09-15 | v1 Q2 現金一起進重試與健康檢查 | 甲 | 逐字「q2 甲」;開工先驗 OP6a 對現金單判得對 |
| 2026-09-15 | Q-M2 重試放棄要不要另寫事故(第一次) | 甲(不寫) | 主視窗先向 Sean 更正:原本「放棄時沒人看」是轉述錯,放棄單已有健康檢查 + 信件段 |
| 2026-09-15 | Q-M2(第二次,推翻第一次) | **乙(要寫)** | 主視窗補告 R2 指出的代價:放棄數是此刻快照,24 小時重開會拿掉章、告警可能拍不到;Sean 知道後改選乙。⇒ 4-A 加 `settle_retry_gave_up`、4-C ⑥、4-D 兩段分工 |
| 2026-09-15 | R2 必修 MF1 + S1–S7 怎麼走 | 甲 | 收進 v3、**不跑 R3**;主視窗逐條核過 v3 才回「可以開工」 |

## 9. 估時

前置唯讀量測 + migration(safe verdict + CHECK + 四支函式 + 白名單)+ 拋棄式 PG 21 個世界 ~180 分;TS 文案與選讀 ~70 分;adversarial-reviewer 每片一輪另計。拆兩片(DB 一片、TS 一片)。

## 10. 審查意見落點

### R1(審 v1)
| 條 | 內容 | 落點 |
|---|---|---|
| M1 | 排程只把 paid 算成功 ⇒ 訂金單誤報;重開不歸零 | 4-C ②④⑤、驗收 5 / 8 / 11 |
| M2 | 放棄的單早有健康檢查 + 信件段 | 事實 #15;§8 Q-M2(最終乙);4-D 兩段分工 |
| M3 | resolved_at 擋不了 CHECK;函式先退;前置閘接受兩種形狀 | §6、4-A、驗收 19 |
| M4 | A / B 擴現金文案錯 | 4-D A / B 維持匯款、C 世界與放棄段分管道 |
| M5 | 一張壞單拖垮整輪 | 4-0、4-C ③、4-D、驗收 6 / 13 |
| S1–S6、N1–N3 | (v2 已收) | v2 §10;本版 4-B / 4-C / 4-D / §6 / §7 保留 |

### R2(審 v2)
| 條 | 內容 | 落點 |
|---|---|---|
| **MF1** | `pcm_settle_verdict_safe` 只 REVOKE PUBLIC ⇒ anon / authenticated 叫得動 | **4-0 權限段**(四道 REVOKE + owner postgres + 零 GRANT)、事實 #5、**驗收 20** |
| S1 | 修好的單 attempts 不歸零 | **4-C ⑤ 成功分支**、事實 #11、驗收 10 |
| S2 | 重開歸零三個 upsert 分支都改、判準 `t.gave_up_at IS NOT NULL`、不用 now() | **4-C ⑤ 失敗分支式子**、驗收 8 / 9 |
| S3 | 放棄健康檢查要 join orders;舊鍵混現金會把現金寫成匯款 | **4-D DB 側 `get_settle_retry_gaveup_health`**(舊鍵只數匯款、新鍵現金)、事實 #14、驗收 15 |
| S4 | `KNOWN_INCIDENT_KINDS` 同一顆改 | **4-A 最後一點**、事實 #7、§6 TS、驗收 TS |
| S5 | 缺鍵 = 讀不到只限新鍵,A / B 不得跟著壞 | **4-D TS 側 adapter**、事實 #18、§6 最後一點、驗收 TS 第一點 |
| S6-a | 去重前置閘驗 pcm_incident owner / 無 FORCE RLS | **4-B 前置閘 ③**、事實 #19、驗收 17 |
| S6-b | resolved_at 沒寫入端 ⇒ 一張單永遠 1 列、修好仍掛著 | **4-B「寫明不修」段**、事實 #20、4-D TS「累計」字面 |
| S7 | 驗收補 5 個世界 | **驗收 9 / 10 / 20、TS 第一點、§7 開工第一步(貼板前再量訂金單章)** |
| N1 | ponytail「會漏撈」其實不會漏 | 4-C ② 訂正註記、事實 #22 |
| N2 | 現金「出貨可能被擋」查無根據;detail 固定字串 | 4-D TS 現金文案、事實 #26;4-C ⑥ detail 前綴 |
| N3 | §5「數字會下降」不成立 | §5 劃掉並訂正、事實 #27 |
| N4 | rollback 判新 kind 列前先 LOCK | §6 第 1 步 |
| N5 | LIMIT 50 被跳過單佔名額(既有) | 4-C ② ponytail 註記 |
| N6 | 驗收「相加相等」不一定成立 | 4-D DB 側 N6 註記、驗收 15 改寫 |
| Q-M2 代價 | 甲少講「此刻快照可能拍不到」 | §8 第四列(Sean 知情後改乙) |
