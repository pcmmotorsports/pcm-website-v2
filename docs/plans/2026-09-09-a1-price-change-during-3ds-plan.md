# plan · ⟦深掃-A1⟧ 3DS 進行中改價 —— **客人的錢被扣走,而那張單永遠確認不了付款**

> 線【權限/信件】窗 C · 2026-09-09 · **窗 C 沒有寫 migration 檔、沒 apply、沒 push。plan 交主視窗,等 Sean 批,SQL 由主視窗代貼。**
> **來源**:GPT-6 獨立資安審查(主視窗跑)判 must-fix。**而本檔的四格驗證是窗 C 逐格開檔做的** —— 沒有一格是照收。
> 基底 = **2026-09-09 14:5x UTC 從正式庫唯讀取的 `pg_get_functiondef`**,存在 `docs/evidence/2026-09-09-admin_update_order_item_amount-live-baseline.sql`(195 行)。

---

## 0. 一句話

**客人在銀行 3DS 驗證的那幾十秒內,員工把單價改小 ⇒ 銀行照原價扣款成功 ⇒ 對帳拿【改後】的金額去比【原價】的扣款 ⇒ 永遠對不上 ⇒ 錢扣了而單子永遠是未付款。**
🔴 **而兩邊的紀錄都「正常」**:銀行說成功、我們說 pending ⇒ **沒有任何一道尺會叫。**

---

## 1. 為什麼 —— 四步鏈,而每一步我都開檔驗過

### 步 1-2 · 改價那道閘放行
`docs/evidence/…-live-baseline.sql:57`(= 線上現行定義)逐字:
```sql
-- 4d. 🔴 金額閘:這張單有【任何一列】收款 ⇒ 拒(見檔頭 §2;不使用任何金額口徑)。
SELECT count(*) INTO v_payments FROM public.order_payments p WHERE p.order_id = p_order_id;
IF v_payments > 0 THEN RAISE EXCEPTION '這張單已經有收款紀錄…'
```
⇒ 📌 **它問的是「有沒有【收款紀錄】」** —— 而客人還卡在銀行那一段,`order_payments` **還沒有列** ⇒ **改得過去。**
🔵 那道閘上面確實有 `FOR NO KEY UPDATE` 鎖父列 + `version <> p_expected_version ⇒ CONFLICT` —— 🛑 **而那兩道防的是【併發改價】,不是【跨流程】。**

### 步 3-4 · 對帳拿當下金額去比,而不是 attempt 上的快照
🔴 **這一格我原本以為會推翻整條鏈,結果它是最硬的證據。**
```
settle-charge.ts   if (originalAmount !== attempt.orderTotal) return 'original_amount';
   ↑ attempt.orderTotal   ← PgChargeAttemptAdapter.ts:434  orderTotal: o.order_total
   ↑ o.order_total        ← RPC 回的 JSON 欄位(全庫 migration 查無該欄的 DDL 定義)
   ↑ 20260624120007:151-155 逐字:
       -- 訂單對帳欄(total/payment_status/display_id;窄權 server-side)
       SELECT total, payment_status, display_id
         INTO v_order
         FROM public.orders                 ← 🔴 【現撈】
        WHERE id = p_order_id;
   ↑ :180  'order_total', v_order.total     (另一支 20260614120000:92 同形)
```
⇒ 🎯 **`attempt.orderTotal` 是【對帳當下從 `orders` 現撈的 total】,不是 attempt 建立時的快照。**
⇒ 📌 **所以改價之後,那個比較永遠拿 900 去對銀行的 1000** ⇒ **重跑對帳幾次都一樣。**

### 🛑 而第五道不存在 —— 這一格是我加的
```
那支 RPC 全檔 grep 'payment_charge_attempts|charge_attempt' ⇒ 0
  (只有 v_attempt 那個【迴圈變數】,與 charge attempt 無關)
全庫 66 支 migration 提到 payment_charge_attempts,而其中
  跟 orders 改價相扣的 trigger / CHECK / BEFORE UPDATE ⇒ 0
線上現行定義 grep -c 'charge_attempt' ⇒ 0(⇒ 也沒有別人疊過)
```
⇒ **沒有第五道。** 我特地找了 —— 今天我證過好幾次「以為只有一條路而其實有三條」,**這次真的只有那一條。**

### ⚠️ 一格我沒獨立驗完,而它不影響結論
GPT-6 說 `begin()` 是獨立 SQL 呼叫、連線會關 ⇒ 列鎖不持續到銀行驗證結束。
🛑 **我沒實測那個鎖的生命週期。** 而**不影響結論**:即使鎖持續,步 1 的閘也放行(它問的是收款紀錄,不是鎖)。

---

## 2. 影響 —— **今天 0,而 0 只決定急不急**

```
payment_charge_attempts 全表           ⇒ 1 筆(status=charged,2026-09-02)
  其中 pending                          ⇒ 0
🔴 歷史上發生過嗎(order.payment_status='unpaid' 而 attempt.status='charged')⇒ 0
⚪ 分母:attempts 1 · orders 6
⚪ 負對照 現造 status ⇒ 0
```
⇒ ✅ **今天沒有一張單卡在這個狀態,歷史上也沒發生過。**
⇒ 🛑 **而那個 0 的正確讀法**(板上 `⟦auth-MANUALORDERLIMITBURN⟧` 那一列教的):**0 只決定急不急,不決定對不對。**
⇒ 📌 **而分母極小(全站 6 張單、1 筆 attempt)** —— 這個站**還沒有真實流量**。上線後每一筆 3DS 都會開一次那個窗口。

### 🔴 而發生的情境比「隨機撞上」真實得多
**客人打電話說「我卡在付款頁」⇒ 客服去看那張單、順手調價** —— **那正好就是那個窗口。**
⇒ 而它**不是外部攻擊**:第 2 步要員工去改價。⇒ **內部操作 × 時序**的意外。

---

## 3. 🔴 修法 —— **三個方向我查完之後只剩兩個成立**

### 🛑 先答那個前置問題:**pending attempt 有沒有逾時回收?**
```
cron.job jobid 6  pcm-capture-recheck  */10 * * * *  active=t
  command: SELECT pcm_cron.invoke_cron_route('/api/cron/capture-recheck')
  cron.job_run_details ⇒ succeeded 2763 次,最後 2026-09-09 14:40
attempt 表的時間欄:created_at · updated_at · next_settle_at · last_poll_settle_at
                    · released_at · released_manual_review_at · settle_attempt_count
```
🔴 **而 release 的觸發點【不是逾時】**:`20260624120002` 檔頭 `:12` 逐字
> **① 用途:立即重刷 preflight 在 `settleCharge(existingOrderId)` 確認 Record `auth_or_pending(4)` 後,由 server-only CAS…**

⇒ 📌 **`mark_charge_attempt_released_for_user` 是【客人自己再結帳一次】時觸發的**,不是時間到自動釋放。
⇒ 而 `pcm-capture-recheck` 處理的是**已經 charged 而沒對上的**(settle retry),**不是 pending 的回收**。
⇒ 🔴 **所以:客人放棄不再結帳 ⇒ 那筆 pending attempt 會一直留著。**

### ⇒ 方向甲「有 active attempt 就不准改價」—— 🔴 **不建議,它會鎖死**
**理由是上面那一格**:pending 沒有逾時回收 ⇒ 客人放棄之後那張單的價格**永遠改不了**,而員工看到的是一個他無法解決的錯誤。
⇒ 🛑 **除非同時做「pending attempt 逾時自動釋放」** —— 而那是**動金流狀態機**,爆炸半徑大得多。
⇒ ⚠️ **除非 Sean 要,否則不建議。**

### ✅ 方向乙「不擋,而把改價這件事記下來」—— **建議**
**改什麼**:那支 RPC 在放行改價時,**若該單有 active attempt,寫一列稽核**(`admin_audit_log` 已存在,今天 118 列)。
**為什麼**:
- **不會鎖死** —— 員工照樣改得動,不會被一個他無法解決的狀態擋住。
- **而錢卡住那一次仍然會發生** —— 🛑 **這一點要對 Sean 講白**:乙**不防止**問題,它讓問題**查得出來**。
- 📌 **而那正是這件事今天最缺的**:對帳失敗時,**沒有任何地方寫著「因為有人在 3DS 中途改了價」** ⇒ 而 `original_amount` 那個錯誤碼**看起來像 TapPay 的問題**。
**影響**:純加一列稽核 ⇒ **對現行行為零改變**(改價照樣成功)。
**成本**:那支 RPC 加一段 `INSERT INTO admin_audit_log`,約 10 行。

### ⚠️ 方向丙「改價時同步作廢那筆 attempt」—— **查完發現不可行,寫出來免得下一個人再想一次**
**理由**:3DS **進行中**的交易,銀行那一側已經在跑了 —— **我們這邊作廢 attempt,不會讓銀行不扣款。**
⇒ 📌 **它只會讓我們【更確定】收不到那筆錢**(attempt 沒了 ⇒ 連對帳都不會去比)⇒ **比現況更糟。**
🛑 **而「TapPay 那端能不能取消」我沒查** —— 而**不必查**:即使能取消,那也是一個**對外的、不可回收的動作**,在員工改價這條路上自動觸發它,爆炸半徑遠大於問題本身。

---

## 4. ✅ 可執行的反向 SQL(不是散文)
```
docs/evidence/2026-09-09-admin_update_order_item_amount-live-baseline.sql   (195 行)
```
它是 `pg_get_functiondef` 的原樣輸出(開頭就是 `CREATE OR REPLACE FUNCTION …`)。
🛑 **而它【沒有】交易封套與 `lock_timeout`** —— 要當 rollback 跑,**必須**包成:
```sql
BEGIN;
SET LOCAL lock_timeout = '5s';   -- CREATE OR REPLACE FUNCTION 拿 ACCESS EXCLUSIVE LOCK
--  … 貼入 baseline 檔的那一段 …
COMMIT;
```
🛑 **而我沒有實跑驗過它的語法**(今天早上那次 `pg_get_functiondef` 輸出**結尾沒有分號**,害我的 rollback 跑不起來)⇒ ⚠️ **這一份要當 rollback 用之前,先在拋棄式 PG 跑一次。**

---

## 5. 🛑 我證不到什麼
1. **`begin_charge_attempt` 的鎖生命週期** —— 沒實測(§1 末,而不影響結論)。
2. **那個 0 是「還沒發生」不是「不會發生」** —— 全站 6 張單、1 筆 attempt,**分母太小推不出機率**。
3. **方向乙的實際碼我沒寫** —— 本片只到 plan。而「加一列稽核」要看 `admin_audit_log` 的寫入權限與 schema,**我沒查**。
4. **方向丙我沒查 TapPay 那端** —— 而我寫了為什麼不必查。
5. **我沒有在拋棄式 PG 驗過任何一段** —— 本片零實跑。
6. **`released` 那條路我只讀了檔頭的用途說明**,沒有讀那支 RPC 的完整條件 ⇒ 「pending 沒有逾時回收」是從**用途說明**推的,**不是從完整邏輯量到的**。⚠️ **這一格若錯,方向甲就變可行** ⇒ **要動甲之前必須先把它量死。**
7. 讀數是 2026-09-09 14:3x–14:5x UTC 那幾發的。

---

## 6. 🔴 要 Sean 答的一題
```
Q:3DS 進行中改價那件,要怎麼處理?
   (今天 0 筆卡住、歷史 0 次;而上線後每一筆 3DS 都會開一次那個窗口,
    而最真實的觸發是「客人打電話說卡在付款頁 ⇒ 客服去看那張單順手調價」)
A: 甲 擋(有 active attempt 就不准改價)
      🔴 不建議 —— pending 沒有逾時回收(release 要客人自己再結帳一次才觸發)
      ⇒ 客人放棄之後那張單的價格【永遠改不了】,而員工看到一個他解不掉的錯誤
      ⇒ 要走甲,得同時做「pending attempt 逾時自動釋放」——那是動金流狀態機
   乙 不擋而記一筆稽核(建議)
      ⇒ 不會鎖死、對現行行為零改變、約 10 行
      🛑 而它【不防止】問題,它讓問題查得出來 —— 錢仍然會卡那一次
   丙 改價時作廢 attempt ⇒ 查完不可行(我們作廢不會讓銀行不扣款,只會更確定收不到)
```
🔵 **我建議乙**,而**要把那句限定一起端**:**乙不防止,它讓人查得出來。**

## 7. 窗 C 接下來
- **等 Sean 批。** 批了之後 **SQL 由主視窗代貼**,窗 C 不 apply。
- 🛑 **而動之前要先把 §5 第 6 條量死**(pending 到底有沒有逾時回收)—— **那一格決定甲可不可行。**
