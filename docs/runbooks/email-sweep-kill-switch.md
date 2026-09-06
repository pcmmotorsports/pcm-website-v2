# 寄信線的停止開關 —— 怎麼停、怎麼開、停了之後信會怎樣

> 線【信】`-mail` 2026-09-07 開列。**Sean 2026-09-07 01:2x 逐字答 QB-1「甲」**:
> 「寫一頁 runbook, 一句 SQL 拿掉排程」。
> **對象**:Sean / 值班的人。**零程式改動** —— 這一頁講的全是資料庫那一句話。

---

## 🛑 先讀這一段:為什麼原本沒有開關

`apps/storefront/src/app/api/cron/email-sweep/route.ts:8` 逐字寫著「本片**不設** `*_ENABLED` gate」。
那是刻意的:**這條線的開關就是「pg_cron 有沒有在排它」**。
⇒ 📌 **所以停它的方式不是改程式、不是改環境變數,是【把那個排程拿掉】。**

---

## 停(一句)

```sql
SELECT cron.unschedule('pcm-email-sweep');
```
🔬 那個名字**逐字**來自 `supabase/migrations/20260819160000_m4a_e2b_email_sweep_pgcron.sql:213`
(`cron.schedule('pcm-email-sweep', '*/5 * * * *', …)`)。**不要憑印象打**,名字錯了它會回錯而不是停錯。

## 開回來(一句)

```sql
SELECT cron.schedule(
  'pcm-email-sweep',
  '*/5 * * * *',
  $job$SELECT pcm_cron.invoke_cron_route('/api/cron/email-sweep')$job$
);
```
🔬 同樣逐字來自那支 migration 的 `:213-214`。
⚠️ 那支 migration 在排完之後還有一行 `cron.alter_job(job_id => v_id, active => true)`
(`:216`,理由逐字「by-name upsert 不會改 active」)—— **如果曾經有人把它設成 inactive,只跑上面那句不會開回來**。

## 生效多快

排程是 `*/5 * * * *`(每 5 分鐘)⇒ **停:下一輪本來要跑的那一次就不會跑了**(最多等 5 分鐘)。
🛑 **而【已經在跑的那一輪不會被打斷】** —— 它會把手上那批寄完。

---

## 🔴 停了之後,信會怎樣(這一段是開檔核過的,不是推的)

**信會累積,不會丟。**
🔬 依據:sweeper 認領的條件是 `status IN ('pending','failed')` 且 `next_retry_at <= now`
(`SupabaseEmailOutboxAdapter.ts:79` 的 `CLAIMABLE_STATUSES` 與 `:474-475`)。
⇒ 停了之後,新的信照樣被**排進** `email_outbox`(排信與寄信是**兩段**,排信不靠這個排程),
它們只是**沒有人來拿** ⇒ 開回來之後**下一輪就會被拿走**。
🟢 而**沒有任何排程在刪 `email_outbox` 的列** —— 全 repo 唯一的 `DELETE FROM public.email_outbox`
是後台那顆「撤銷人工寄信登錄」的按鈕(一次一列、要有人按)。

### ⚠️ 而有一種列會卡住,要知道

停的那一刻**正在寄**的那些列,狀態是 `sending`,而 `sending` **不可再認領**。
它們要等**回收**,而回收是 sweeper 自己做的第一步 ⇒ 🔴 **排程停著的期間沒有人回收它們**。
⇒ 📌 **開回來之後它們才會被撿回去** —— 那不是壞掉,是這個設計的形狀。
⇒ 🛑 **所以「停很久」的代價不是丟信,是那幾封信會躺得比別人久。**

---

## 誰能跑這一句

🔴 **走貼板流程** —— 這是對正式庫的寫入,**Sean 說「貼」才貼**。
不是任何一個窗自己開 SQL Editor 去跑。
⇒ 要停的時候:把上面那一句寫成貼板檔,端給他,他說貼才貼。

## 🛑 這一頁證不到什麼

- **我沒有實際停過它** —— 上面每一句都是開檔核出來的(migration 逐字 + claim 條件 + 零刪除路徑),
  而**「停了之後真的長那樣」我沒有觀察過**。
- 它答不出**停多久算太久** —— 那要看客人在等什麼信(匯款帳號?出貨通知?),
  而那是業務判斷不是這一頁能回答的。
