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

## 2. 影響 —— **今天 0,而我第一次用錯了判準**

### 🔴 我原本查 `attempt.status='charged' AND order.payment_status='unpaid'` ⇒ 0 —— **那個判準抓錯形狀**
codex R1 must-fix ⑤ 指出來,而它是對的:**本案在 `markCharged` 【之前】就被金額閘擋住** ⇒ attempt **停在 `pending`**,不會走到 `charged`。
**卡住的單在資料上長這樣**(codex 列的,我照收):
```
orders.total = 900 · payment_status = 'unpaid'
attempt.status = 'pending'(不是 charged)· 保留銀行交易識別鍵
無對應的 order_payments 列
sweeper 寫入後可能有 last_settle_error='record_unverified';達上限後 needs_manual_review=true
銀行 Record 顯示成功、原始金額 1000;而既有的改價稽核記著 1000 → 900
```

### ✅ 用正確的形狀重量
```
attempt.status='pending' AND order.payment_status='unpaid'
  AND NOT EXISTS(該單的 order_payments)                    ⇒ 0
放寬:有 last_settle_error 的 ⇒ 0 · needs_manual_review=t 的 ⇒ 1
全表逐列(只有 1 筆):
  status=charged · settle_attempt_count=0 · last_settle_error=(空)
  · needs_manual_review=t · released=f · order.payment_status=refunded · total=4
  ⇒ 那一筆是【已退款】的單,不是本案的形狀
⚪ 分母:attempts 1 · orders 6 · admin_audit_log 126 列 · 負對照現造值 ⇒ 0
```
⇒ ✅ **正確判準下仍然是 0。**
⇒ 🛑 **而 codex 那句限定要寫死**:這**最多支持「當下未見此類未結案單」** —— **排除不了「曾經發生、後來被人工處理掉」**。
⇒ 📌 **要答歷史那一半,得從上面那個形狀去交叉核對銀行紀錄與改價稽核** —— **而我沒做。**

### 🔵 而有一格順帶量到,它讓「還沒發生」更硬
```
admin_audit_log 全表 126 列,而 action ILIKE '%amount%' 或 '%item%' ⇒
  order_item.workflow.update  8 筆
  ⇒ 【沒有】任何一筆 order.item.amount.update
```
⇒ 📌 **改價這個功能在,而【還沒有人用過】** ⇒ 那解釋了為什麼一次都沒發生。
⇒ 🔴 **而它同時說明:上線後第一次有人改價,就是第一次開那個窗口。**

### 🔴 而發生的情境比「隨機撞上」真實得多
**客人打電話說「我卡在付款頁」⇒ 客服去看那張單、順手調價** —— **那正好就是那個窗口。**
⇒ 而它**不是外部攻擊**:第 2 步要員工去改價。⇒ **內部操作 × 時序**的意外。
⇒ 🛑 **而分母極小**(全站 6 張單、1 筆 attempt)—— **這個站還沒有真實流量**,推不出機率。

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
🔴 **而我把 `pcm-capture-recheck` 的用途寫錯了**(codex R1 ②):它呼叫的是 `recheckCaptureState`,候選條件是 **`capture_state='authorized'`**,**只重查並寫回請款狀態** —— **不釋放 attempt,也不負責未付款認列重試**(`20260820050000:80` · `recheck-capture-state.ts:134`)。⇒ 📌 **我混淆了兩條排程。**
✅ **而結論不變**:codex 複核 `20260624120002:53` 的**完整本體** —— **沒有年齡條件**,只依會員 / 購物車 / 未付款 / pending 做 `released` 更新,而實際 caller 在**重新結帳**時才呼叫(`preflight-release-sibling.ts:123`)。
🔵 真正的 settle-sweep / 孤兒再確認**可以**在銀行**明確失敗**且通過金額等檢查後把 pending 收斂成 `failed` —— 🛑 **而「持續待付款」或「金額不符」那兩種,不會只因時間到就解鎖。** ⇒ **方向甲的長期鎖死風險仍然存在。**
⇒ 🔴 **所以:客人放棄不再結帳 ⇒ 那筆 pending attempt 會一直留著。**

### ⇒ 方向甲「有 active attempt 就不准改價」—— 🔴 **不建議,它會鎖死**
**理由是上面那一格**:pending 沒有逾時回收 ⇒ 客人放棄之後那張單的價格**永遠改不了**,而員工看到的是一個他無法解決的錯誤。
⇒ 🛑 **除非同時做「pending attempt 逾時自動釋放」** —— 而那是**動金流狀態機**,爆炸半徑大得多。
⇒ ⚠️ **除非 Sean 要,否則不建議。**

### ✅ 方向乙「不擋,而把改價這件事記下來」—— **建議**
🔴 **而我原本的理由寫錯了一半,codex R1 must-fix ③ 抓到,我開檔核過:**
⛔ ~~「對帳失敗時沒有任何地方寫著有人改過價」~~ ⇒ **不成立。**
**線上基底 `:168` 逐字**:
```sql
INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
```
⇒ 📌 **改價【已經】在同一個交易裡寫稽核了**,含 actor / request_id / order_id / 改價前後的單價、小計、總額。
⇒ ✅ **所以乙的價值不是「從無到有」,是【補上那筆改價與那筆 attempt 的關聯證據】** —— 今天的稽核記著「誰把 1000 改成 900」,**而沒有記「當下有一筆 pending attempt」**。
⇒ 🎯 **對帳失敗時,人要自己把兩邊兜起來;而乙讓那一步不必靠猜。**

**改什麼**:那支 RPC 在放行改價時,**若該單有 active attempt,把 attempt 的 id 與 status 併進【既有那一筆稽核】的 `after`(或另寫一筆關聯列)**。
✅ **技術上可行,而我補量了 codex 說「基底裡看不到」的那三格**:
```
admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)
  owner = postgres · prosecdef = t · proconfig = {"search_path=\"\""}
  proacl = {postgres=X/postgres, service_role=X/postgres}
admin_audit_log 的 before/after 是 JSONB · action 非空文字 · request_id 無唯一限制
  · service_role 有 INSERT(20260712210000:43)
```
⇒ ✅ **`SECURITY DEFINER` + owner `postgres` ⇒ 寫得進去;而新增的 SQL 必須用 `public.admin_audit_log`**(`search_path` 是空字串)。
**影響**:**對現行行為零改變**(改價照樣成功)。
🛑 **而那句限定要一起端**:**乙【不防止】問題,它讓問題查得出來 —— 錢仍然會卡那一次。**

### ⚠️ 方向丙「改價時同步作廢那筆 attempt」—— 🔴 **我原本判「不可行」,而那個理由不夠;已收窄**
**codex R1 must-fix ④**:我把「作廢」直接等同「attempt 沒了、停止對帳」,**而沒有定義具體的狀態轉移**。逐種分開:
| 轉移 | 後果 |
|---|---|
| **刪除** / 標 `failed` | 退出 `get_active` ⇒ 對帳不再去比 ⇒ 🔴 **確實比現況更糟**(錢扣了而連紀錄都沒了),而且沒有任何銀行取消呼叫 |
| **`released`** | 🔵 **並不退出對帳** —— 讀取 RPC 明確納入它;而 `superseded_at IS NULL` 的 `released` **還允許晚到的成功轉 `charged`** 並建立異常紀錄(`20260906700000:197`) |
| **`superseded`** | 未查 |
⇒ 🛑 **所以「整個方向丙不可行」是我講太滿。** ✅ **正確講法:【刪除 / failed】那個版本不可行,而【released】那條路我沒有評估完。**
🛑 **而「TapPay 那端能不能取消」我確實沒查** —— ⚠️ 我原本寫「不必查」,**那也講太滿**。能寫的是:**即使能取消,在員工改價這條路上自動觸發一個對外不可回收的動作,爆炸半徑要另外評估** —— 而**那個評估我沒做。**

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
   丙 改價時把那筆 attempt 轉狀態 ⇒ 【刪除/failed】那個版本不可行(比現況更糟);
      而【released】那條路我沒有評估完(它並不退出對帳)⇒ 要選丙的話我得再查一輪
```
🔵 **我建議乙**,而**兩句限定要一起端**:
1. **乙【不防止】問題,它讓問題查得出來** —— 錢仍然會卡那一次。
2. **而它補的不是「有沒有改價紀錄」**(那個今天就有了)**,是「那筆改價當下有沒有付款正在進行」** —— 對帳失敗時,人不必自己把兩邊兜起來。

## 7. 窗 C 接下來
- **等 Sean 批。** 批了之後 **SQL 由主視窗代貼**,窗 C 不 apply。
- 🛑 **而動之前要先把 §5 第 6 條量死**(pending 到底有沒有逾時回收)—— **那一格決定甲可不可行。**


---

## 8. codex R1 —— 3 個 must-fix + 1 nit,逐條怎麼修

| codex 意見 | 怎麼修 |
|---|---|
| ①**無問題** · 那條鏈成立 | 四步都複核過,鏈沒有斷 |
| ②**nit** · 「pending 沒有單靠逾時釋放」**成立**,而我把 `capture-recheck` 的用途寫錯 | §3 訂正:它跑的是 `recheckCaptureState`(候選 `capture_state='authorized'`),**只重查請款狀態、不釋放 attempt**。而 codex 複核 `20260624120002:53` 完整本體**沒有年齡條件** ⇒ **結論不變,方向甲仍會鎖死** |
| ③**must-fix** · 乙的推薦理由漏掉「現行已經記改價稽核」 | 🔴 **我開檔核過,codex 對** —— 線上基底 `:168` 已 `INSERT INTO public.admin_audit_log(actor, action, target, before, after, request_id, source_app)`。⇒ **乙的價值改寫成「補上改價與 attempt 的關聯證據」,不是「從無到有」**;並**補量**了 owner(`postgres`)· `prosecdef=t` · `proacl` · 稽核表 schema |
| ④**must-fix** · 丙不能只憑目前理由整個排除 | ✅ **收窄**:分成 刪除/`failed`(確實不可行)· `released`(**並不退出對帳**,`superseded_at IS NULL` 還允許晚到成功轉 `charged`)· `superseded`(未查)。並撤回「不必查 TapPay」那句 —— **那也講太滿** |
| ⑤**must-fix** · 影響的量測判準抓不到主述情境 | 🔴 **重量了**:本案在 `markCharged` **之前**就被擋 ⇒ attempt 停在 **`pending`** 不是 `charged`。用正確形狀查 ⇒ **仍是 0**;並照收 codex 的限定:**這最多支持「當下未見」,排除不了「曾發生後來被人工處理」**。🔵 順帶量到 `admin_audit_log` 126 列而 **零筆 `order.item.amount.update`** ⇒ **改價功能在而還沒有人用過** |

🛑 **codex 結論是「不可交給 Sean 做決定」。本稿把三條 must-fix 都修了**,而其中兩條**改變了內容**:乙的價值(不是從無到有)、丙的判定(不能整個排除)。
🛑 主視窗 2026-09-09 定:**碰錢的 codex R1 一輪,沒 must-fix 就收。**

---

## 9. 🔵 順帶交付:跨流程時間競態的候選組合(主視窗要的「丙」,只列不掃)

**判準**(主視窗給的):**兩個功能會不會同時碰同一列資料,而中間有一段【等外部系統】的時間?**

| # | 兩端 | 中間等什麼 | 同一列 |
|---|---|---|---|
| 1 | 結帳 3DS × 員工改價 | **等銀行驗證**(幾十秒) | `orders` 那一列 | ✅ **本片已證成立** |
| 2 | 退款 × 取消 | 等 TapPay 退款回應 | `orders` + `order_refunds` |
| 3 | 出貨 × 作廢 | **等新竹物流回應**(而板上記著「送出去之後沒有 API 可以作廢」) | `shipments` |
| 4 | cron 掃描 × 人工操作 | cron 那一輪自己的執行時間 | 被掃到的那些列 |
| 5 | 🆕 **寄信 × 改收件資料** | **等 Resend 回應** | `email_outbox` + `customers` |

🔵 **第 5 組是主視窗加的,而我今天正好量過它的一半**:`sweep-email-outbox.ts:2103-2116` **有**一道收件人新鮮度比對,而 **比對的時點在「寄出去之前」** ⇒ 📌 **那道比對之後、`sender.send` 之前(`:2135`)還有一段** —— **那一段沒有人比。**
🛑 **只列不掃**(主視窗定)。⇒ **這是下一輪的清單。**

### 🆕 第 6 類(主視窗加,而它**不是**上面那五組的形狀)

| # | 兩端 | 中間等什麼 | 同一列 |
|---|---|---|---|
| 6 | 🆕 **兩個功能對同一個狀態的定義不一樣**(窗 B 的混合退款) | **不需要等** | 同一列,兩邊各讀各的 |

🔴 **為什麼要單獨列一格:前五組的病都是【時間窗】—— 把窗關掉就沒事了。第 6 類把時間窗關掉也還在。**
病灶是 **A 認為「已退款」= 這個欄位、B 認為「已退款」= 那個欄位**,兩邊各自都對得起自己那份規格,**而它們合起來對不上**。⇒ 📌 **前五組是「同時發生」,第 6 類是「從來就不一樣」。**

🛑 **出處**:窗 B 經主視窗轉述的混合退款案例。**我沒有親自讀過窗 B 那條線的碼,也沒有量過** ⇒ 這一格是**候選、未證實**,寫在這裡是為了讓下一輪掃得到,不是結論。
🔵 **下一輪要問的第一句**:混合退款那件事裡,「已退多少」這個數字有幾個地方各自算過一次?
