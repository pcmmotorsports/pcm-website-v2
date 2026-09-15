# 2026-09-15 · 非刷卡收款「狀態重算吞錯」讓人看得見 —— plan

> 設計窗。來源:`~/pcm-mailbox/稽核-ecommerce-cia-20260915.md` **P1-6**;Sean 逐字「依照建議」= 先寫計畫。主視窗 pcm-website-v2-b7 派工。
> **本檔只是 plan,零碼、零 migration。** 碰函式定義 + 事故種類 CHECK(schema)+ 錢(收款狀態)⇒ 鐵則 8 + 12,等批。
> 事實全部由設計窗 2026-09-15 親讀 repo 核對;正式庫只唯讀。

## 1. 白話

- 客人用**匯款或現金**付錢,員工登記收款的那一刻,系統會重算這張單「付清了沒」,把狀態改成已付款。
- 那一次重算**如果出錯,系統刻意把錯吞掉**:錢照收(不能因為算錯就把收款退回去),**但狀態停在「未付款」,而且只寫一行 server log,沒有任何人會知道。**
- 客人那一端:訂單頁一直顯示「請匯款」+ 銀行帳號 ⇒ **他可能再匯一次。**
- 今天已經有一支排程(每 10 分鐘)會回頭再算,**但它只救匯款單、不救現金單;試 5 次還是壞的單,也只記在它自己的表裡,沒有人看。**
- 本 plan 要做三件事:①吞錯時寫一筆事故紀錄 ②試到放棄的單也寫事故紀錄 ③每天兩次的異常告警多數一種單:「**錢已經收足,狀態還是未付款**」(匯款 + 現金都算)。

## 2. 查到的事實

| # | 事實 | 出處 |
|---|---|---|
| 1 | 重算函式 `public.pcm_noncard_settle_recompute(uuid)`,掛在 `order_payments` 的 AFTER INSERT。**最新一代**是第 3 代 | `bash scripts/latest-definition-of.sh pcm_noncard_settle_recompute` ⇒ `20260905290000_m4b_pending_refund_open_failure_incident.sql:227` |
| 2 | 外層整段包在 `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE LOG '… 重算失敗(%), 收款事實保留、狀態不動' END`,**只寫 log** | 同檔 `:441-444` |
| 3 | 同一支函式**內層**已有「寫事故 + 再包一層防護」的現成寫法:補開待退款失敗 ⇒ `pcm_incident_log('pending_refund_open_failed', …)`,外面再包 `BEGIN/EXCEPTION`,讓寫事故本身失敗也不拖垮外層 | 同檔 `:395-424` |
| 4 | 事故表 `public.pcm_incident(id, kind, subject_id, detail, created_at, resolved_at)`;寫入走 `pcm_incident_log(kind, subject_id, detail)`(SECURITY DEFINER,detail 截 2000 字) | 同檔 `:116-122`、`:165-183` |
| 5 | `kind` 是**封閉集 CHECK**,最新定義 6 種:`pending_refund_open_failed / refund_over_total / auto_cancel_skipped / auto_cancel_failed / line_forward_failed / auto_cancel_live_shipment`。**沒有「重算失敗」這一種** ⇒ 新增要改 CHECK | `20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql:67`(帳本 `supabase/APPLIED.tsv:672` 已貼) |
| 6 | 重試排程 `public.pcm_settle_retry_sweep()`(`pcm-settle-retry`,每 10 分):撈 **`payment_channel = 'bank_transfer'`**、`unpaid/partiallyPaid`、已收 > 0、OP6a 判 `settled/underpaid` 的單,再呼叫重算;**最多 5 次**,放棄時只寫 `pcm_settle_retry_attempts.gave_up_at` | `20260905220000_m4b_settle_retry_sweep.sql:72-200`(只有 1 代;`APPLIED.tsv:493`) |
| 7 | 該檔自己寫明:「**它不通知任何人,而今天沒有人會接** …… 一張試到上限仍然壞的單,今天會安靜地留在那裡」 | 同檔檔頭 `:20-27` |
| 8 | 匯款卡單健康檢查 `public.get_stuck_bank_orders_health()`:**只看 `bank_transfer`**;只數 OP6a 判 `overpaid / needs_human` 的單(A 世界 unpaid 且已收 > 0;B 世界已付款且已收 > total)。**OP6a 判 `settled` 而狀態還是 unpaid 的單,被刻意濾掉** | `20260905060000_m4b_stuck_bank_orders_health.sql:120-182`(只有 1 代;`APPLIED.tsv:482`) |
| 9 | 該檔檔頭自己記著這個缺口:「一張錢收了、重算當時失敗、狀態停在 unpaid 的單…… 它的 verdict 是 settled ⇒ 本片看不到它」 | 同檔 `:45-52` |
| 10 | 健康檢查的出口:`PgAnomalyAlertReaderAdapter.getStuckBankOrdersHealth()` ⇒ `check-anomaly-alerts.ts` 寫進異常告警信(`:1999-2038`)+ `owner-line-digest.ts` 推 LINE;`/api/cron/anomaly-alert` 每天 09:00 / 21:00(台北) | `packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:1123-1140`、`packages/use-cases/src/check-anomaly-alerts.ts:2470`、`packages/use-cases/src/owner-line-digest.ts:42-43` |
| 11 | 付款管道 CHECK 值域:`tappay / bank_transfer / cash / none` | `20260712203000_m4a_orders_admin_columns.sql:51` |
| 12 | 事故數量的出口 `get_pcm_incident_health()` 只回各 kind 未解決筆數 ⇒ 新 kind **自動**進告警信(不必改 TS 就數得到;要不要有專屬文案另議) | `20260905290000:192-214` |

🔴 **發生過幾次:答不出來。** `pcm_incident` 與 `pcm_settle_retry_attempts` 對唯讀角色都沒有 SELECT(2026-09-15 唯讀實查 `has_table_privilege = f`),而吞錯本身只在 server log。**「沒量到」不等於「零次」。**

## 3. 缺口(本 plan 要關的)

| 缺口 | 現況 | 後果 |
|---|---|---|
| G1 外層吞錯只寫 log | 事實 #2 | 第一次重算失敗,沒有人知道 |
| G2 重試排程只救匯款單 | 事實 #6 | **現金單**重算失敗,永遠停在未付款 |
| G3 試到放棄沒人看 | 事實 #6-7 | 5 次都失敗的單安靜留著 |
| G4 健康檢查看不到「錢收足、狀態未付」 | 事實 #8-9 | 就算 G1-G3 都漏了,每天兩次的告警也不會提這張單 |

## 4. 做法(一支 migration + TS 文案一片)

### 4-A 事故種類 CHECK 加兩種(schema)
- `noncard_settle_recompute_failed`:外層吞錯那一刻寫。`subject_id` = 訂單 id,`detail` = `SQLERRM`。
- `settle_retry_gave_up`:重試排程蓋上放棄章那一刻寫。`subject_id` = 訂單 id,`detail` = 最後一次錯誤。
- 寫法照 `20260916010000:47-67` 那段:DROP + ADD `pcm_incident_kind_check`,前置閘先驗現況是那 6 種(不是就停)。

### 4-B 外層吞錯寫事故(G1)
- `CREATE OR REPLACE` `pcm_noncard_settle_recompute`,**從 `20260905290000:227` 抄**,只改外層 handler:
  ```
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG …(原句保留);
    DECLARE v_err text := SQLERRM;      -- 先接住, 進巢狀 handler 後 SQLERRM 會變
    BEGIN
      PERFORM public.pcm_incident_log('noncard_settle_recompute_failed', p_order_id, v_err);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[pcm_incident] 連留痕都失敗 …';
    END;
  ```
- 🔴 形狀抄同一支函式內層 `:395-424`,不發明新的。`query_canceled` 照舊不吞(與 repo 慣例一致)。
- 🔴 外層 handler 是 savepoint:錯誤回捲到 BEGIN 之前,**handler 內寫的事故列會留下**(與內層那筆同一個機制)。
- ⚠️ 前置閘:驗正式庫這支函式的定義 md5 = `20260905290000` 那一代,不是就停(防別窗在中間改過)。

### 4-C 重試排程救現金單 + 放棄寫事故(G2、G3)
- `CREATE OR REPLACE` `pcm_settle_retry_sweep`(從 `20260905220000:72` 抄):
  - `payment_channel = 'bank_transfer'` ⇒ `IN ('bank_transfer', 'cash')`。
  - 兩處 `gave_up_at = CASE WHEN … >= c_max_attempts` 蓋章時,同一個 BEGIN 內呼叫 `pcm_incident_log('settle_retry_gave_up', r.id, last_error)`(一樣包巢狀防護)。只在**第一次蓋章**寫,24 小時後重新開放再放棄才再寫一次(避免每 10 分鐘刷一筆)。
- ⚠️ 現金單會不會被 OP6a 判對?開工第一步在拋棄式 PG 造一張現金單跑 `admin_compute_order_settlement`,**判不出 settled 就停回報**,不硬擴。

### 4-D 健康檢查加一個世界(G4)
- 改 `get_stuck_bank_orders_health()`(從 `20260905060000:78` 抄):
  - 候選管道 `bank_transfer` ⇒ `IN ('bank_transfer', 'cash')`(A、B 世界一起擴)。
  - 新增 **C 世界**:`payment_status IN ('unpaid','partiallyPaid')` 且已收淨額 `>= total`,再以 OP6a 判 `verdict = 'settled'` 才算。
  - 回傳 jsonb 加 `unpaid_settled_count`、`unpaid_settled_oldest`,既有鍵一個不改。
- 🔴 用 OP6a 判,不用純算術:有退款的單 `total` 不變而應收會變,純 `>=` 會誤報(同檔 `:62-68` 已記過這個代價)。
- TS 側(另一片):`PgAnomalyAlertReaderAdapter` 讀新鍵;`check-anomaly-alerts.ts` 加一段信件文案;`owner-line-digest.ts` 加一個旗標。**缺鍵要當「讀不到」不是 0**(同既有 `stuckBankUnknown` 做法)。

## 5. 影響

- 客人:無直接變化;間接的好處是「錢收足而頁面還在叫他匯款」會在 12 小時內被員工看到。
- 員工 / Sean:異常告警信與 LINE 可能多出一段;事故數也會多兩種 kind。
- 效能:C 世界沿用「先純算術預篩、再逐列呼叫 OP6a」;預篩條件是 `received >= total`,分母比 A 世界更小。**沒量過真實資料的耗時**(正式庫今天分母近 0),寫在驗收裡。
- 現金單進重試排程後,每 10 分鐘最多多 50 張的 OP6a 呼叫(同既有上限)。

## 6. Rollback

- 三支函式各自 `CREATE OR REPLACE` 回到本 plan 之前那一代(`20260905290000:227` / `20260905220000:72` / `20260905060000:78`),rollback 檔前置閘釘本代 md5。
- CHECK 退回 6 種:**先確認沒有新 kind 的列**(有的話 rollback 會失敗 ⇒ 先把那些列 `resolved_at` 蓋掉或保留 CHECK 只退函式)。rollback 檔寫明這一步。
- TS 片 revert 一顆 commit;讀新鍵缺值時已是「讀不到」路徑,DB 先退、TS 後退也不會誤報 0。

## 7. 驗收

拋棄式 PG(照 `scripts/admin-probe` 的造法),至少這些世界:
1. 匯款單,重算時故意讓 OP6a 丟錯 ⇒ 收款列還在、狀態 unpaid、**`pcm_incident` 多一列 `noncard_settle_recompute_failed`**。
2. 同 1,但把 `pcm_incident` 改名藏起來 ⇒ 收款列還在、狀態 unpaid、只有 `RAISE LOG`,**不回捲**。
3. 現金單同 1 ⇒ 重試排程下一輪把它修成 paid。
4. 讓重算一直失敗 5 次 ⇒ `gave_up_at` 有值 + 事故恰 1 列;再跑一輪不再多寫。
5. 健康檢查:C 世界匯款單 1 張 + 現金單 1 張 ⇒ `unpaid_settled_count = 2`;有退款讓 OP6a 判 underpaid 的單不算。
6. 既有 A / B 世界數字不變(拿現有 after-check 再跑一次)。
7. ACL:三支函式的 EXECUTE 權限與改之前逐角色相同。
- TS:`check-anomaly-alerts.test.ts` 加 C 世界文案 + 缺鍵 = 讀不到;三綠;codex 一輪(錢 + schema)。
- 上線後:下一輪異常告警信實際看一眼新段落在不在(正式庫分母近 0,多半印 0 張)。

## 8. 要批的

```
Q1:這份照做嗎?
A:  甲 照做(推薦):一支 migration(CHECK + 三支函式)+ 一片 TS 文案, codex 審完才貼
  | 乙 只做 4-A + 4-B(吞錯寫事故), 現金單與健康檢查之後再說

Q2:現金單要一起進重試排程與健康檢查嗎?
A:  甲 要(推薦):現金也走同一支重算, 壞了一樣卡住;開工先驗 OP6a 判得對現金單, 判不對就停
  | 乙 不要:現金是當面收錢, 員工當場就看得到狀態, 只做匯款
```

## 9. 估時

前置驗證 + migration + 拋棄式 PG 七個世界 ~90 分;TS 文案 ~40 分;codex 一輪另計。拆兩片。
