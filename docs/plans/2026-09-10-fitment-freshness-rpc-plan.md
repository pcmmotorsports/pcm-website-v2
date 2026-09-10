# 2026-09-10 · `get_fitment_sync_freshness()` —— 讓那道告警【上膛】

> 板列 `⟦b4-FITSYNC1⟧` 的「零告警」那半。
> 🛑 **本 plan 未經批准,一個字都還沒動。** 碰新 DB 物件 + GRANT ⇒ 鐵則 8。

---

## 1. 現況(2026-09-10 量的,不是讀的)

```
✅ 告警的碼已上 main(d962d764f)
✅ cron pcm-anomaly-alert 每天 01:00 跑, 最近 10 次全部 succeeded
🔴 而 apps/storefront/src/app/api/cron/anomaly-alert/route.ts:420 寫死
     fitmentFreshnessRpcName: null
   它在等的 public.get_fitment_sync_freshness() 正式庫【不存在】
   (pg_proc 掃 %fitment% / %freshness% ⇒ 只有 sync_product_fitments)
⇒ 🎯 那一格【從來沒有查過一次】, 而外面看起來一切正常。
```
🔵 **而它自己講了**:`route.ts:612` 逐字「車款同步告警**還沒上膛** —— 在等 SECURITY DEFINER RPC,而這**不是**故障」。
📌 **⇒ 這是一個【留了字條的洞】,不是靜默的洞。** 上膛的成本因此只有「貼一支 RPC + 改一個字面」。

---

## 2. 規格【不用發明 —— 呼叫端已經寫死了】

`PgAnomalyAlertReaderAdapter.ts:873-1005` 逐條讀它回的那個 jsonb:

```
public.get_fitment_sync_freshness() RETURNS jsonb
  { "rows_seen":       <非負整數>,       -- 數字或純數字字串都收, 其餘型別 ⇒ throw
    "last_success_at": <時間戳 or null> } -- Date / ISO 字串;不是日期字面 ⇒ throw
```
🔴 **`hours_since_success` 不要回** —— **呼叫端自己算**(`(Date.now() - lastMs) / 3_600_000`)。
　⇒ 📌 多回一個欄位不會壞,而**它會變成第二個真相來源**,而那正是這一族的病。
🛑 **`last_success_at` 為 null 是【合法】的** —— 呼叫端明寫回 `{hoursSinceSuccess: null, lastSuccessAt: null, rowsSeen}`;
　而 use-case 端把「查不到任何成功紀錄」當成**要叫**的一種。⇒ **不要為了避免 null 而回一個假時間。**

### 資料來源(已存在,不用建)
```
public.product_fitments_effective_sync_log   65 列(2026-09-10 量)
欄位 id · ran_at · status · source_rows · staged_rows · orphan_rows · old_count · new_count · note · run_id
🔬 最後一次 status='success' = 2026-09-09 23:05 · 而 09-07 06:31 有一筆 'abort'
⇒ 🎯 那張表【分得出成功與中止】—— 所以判準寫死 status='success' 是對的, 那道分辨力是真的
```

---

## 3. 改什麼(最小)

```sql
CREATE OR REPLACE FUNCTION public.get_fitment_sync_freshness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'rows_seen',       (SELECT count(*) FROM public.product_fitments_effective_sync_log),
    'last_success_at', (SELECT max(ran_at) FROM public.product_fitments_effective_sync_log
                         WHERE status = 'success')
  );
$$;
```
⚠️ 號段 **`…07xxxx`**(我的);實作時**當場重跑撞號閘**,不沿用本 plan 猜的號碼。

### 🔴🔴 GRANT 給誰 —— **這一格今晚已經有人踩過,而正本寫在 repo 裡**
```
✅ GRANT EXECUTE TO payment_confirmer     ← 告警端【連進來的身分】
⛔ ~~只 GRANT TO service_role~~
```
🔬 **證據不是我推的**:`20260906970000_m4b_anomaly_reader_grants_payment_confirmer.sql:3-22` 整支就在講這件事 ——
　「⛔ 告警端不是 `service_role`,是 `payment_confirmer`」,而上一批三支健康度函式**同一個假設**,
　後果是 **2026-09-06 01:00 那一發 `/api/cron/anomaly-alert` 回 503、路由印四行 `42501`,告警器本人 37 小時沒成功過**。
🛑 **⇒ 所以本片的 GRANT 要對齊那一支,而不是對齊更早的三支。** 兩道 REVOKE 照
　`docs/patterns/revoking-function-execute-in-supabase.md`。

### app 那一側:一個字面
```
route.ts:420   fitmentFreshnessRpcName: null  →  'get_fitment_sync_freshness'
```
🔵 該處註解自己寫著:「RPC 貼上去那天,把 `null` 換成 `'get_fitment_sync_freshness'` 就上膛 —— 碼**一行都不用改**」。

---

## 4. 🔴 上膛之後【第一次會不會立刻叫】—— 量過,不會

```
門檻 FITMENT_STALE_DAYS = 7(Sean 2026-08-29 逐字 `A: 7天`)
而最後一次 success = 2026-09-09 23:05 ⇒ 今天距它【不到一天】
⇒ ✅ 上膛當天【不會叫】
```
🔵 而它**叫得出來**也量得到:那張表 09-07 有一筆 `abort` ⇒ 判準若寫成 `max(ran_at)` 就會把「天天 abort」讀成「天天有更新」。
📌 **⇒ 一個上線就狂叫的告警,三天內會被關掉。而這一支不會。**
⚠️ **而那個 7 天有它的射程**:同步是**每天**跑的 ⇒ 7 天代表「**連續七次都沒成功**」才叫。
　⇒ 🛑 **中間漏一兩天它不叫** —— 那是 Sean 選的,不是漏掉。要改要重問他。

---

## 5. 影響 / rollback

```
影響   只有告警那一條路會多讀一支函式。客人零影響、後台零影響。
       🔵 而 route 在 RPC 讀失敗時走「落 Unknown」那條路(既有), 不會把整發告警打掉。
rollback  supabase/rollbacks/…-down.sql:DROP FUNCTION public.get_fitment_sync_freshness();
          而【app 那一行要先改回 null】—— 順序反了會讓它每天噴一次 42P01/42883。
          🔴 ⇒ 收回的順序與貼的順序【相反】, 寫進 runbook 那一行。
```

---

## 6. 🛑 上膛【不等於】那一聲會到人手上 —— 誰驗、怎麼驗

```
🔬 我今天量到的:cron pcm-anomaly-alert 最近 10 次全部 succeeded
🔴 而那只證明【pg_net 把 HTTP 送出去了】——
   ⛔ 不證明 route 跑完 · ⛔ 不證明信真的寄出去 · ⛔ 不證明有人收得到
📌 而板列自己也記著一格沒關的:「notifier 的實際收件人沒確認」。
```
✅ **所以上膛之後還要有人做這三格,而它們【不是我能做的】**:
```
① route 真的跑完了嗎   ⇒ 讀 Vercel runtime log 找那一輪的 [anomaly-alert] 行
                         (我做得到, 而要等上膛後的第一個 01:00)
② 信真的寄出去了嗎     ⇒ 查 email_outbox 那一輪有沒有列(我做得到, 唯讀)
③ 🧑 【有人收到嗎】     ⇒ 只有 Sean 打開他的信箱看得到。這一格永遠是他的。
```
🎯 **⇒ 而在 ③ 之前,這一列的「零告警」那半【不算關掉】** —— 板列原本就寫著「要等第一次告警真的寄出去才算數」。

---

## 7. 本 plan 答不出什麼

- **那支 RPC 的查詢計畫我沒量** —— 65 列的表,而我沒有跑 `EXPLAIN`(codex 對前一片也提過同一格)。
- **`ran_at` 的型別/索引我沒查** —— 65 列規模下不影響,而**那是理由不是量測**。
- **我沒有在正式庫跑過這支函式** —— 它還不存在;而唯讀身分對這一族函式一律沒有 EXECUTE。
- 所有數字**綁 2026-09-10**;同步每天在跑,實作時重跑。
