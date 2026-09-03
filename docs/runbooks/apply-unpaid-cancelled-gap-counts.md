# 貼這一支:未付款取消信的「找不到收件人」告警

> **誰需要這份**:有正式庫 apply 權限的人。
> **寫這份的人沒有那個權限** —— Sean 2026-09-01 只批了唯讀。
> 🛑 **唯讀與 apply 是兩個授權**, 這份不繞過那件事, 它只是把該做的寫清楚。

## 要貼的東西(一支)
```
supabase/migrations/20260903070000_m4b_e4_unpaid_cancelled_gap_counts.sql
```
內容:建一支 `public.get_order_unpaid_cancelled_gap_counts(timestamptz)`,
回 `{pending_count, no_recipient_count, orders_total_count}`。
**零 schema 改動、零資料寫入、零既有物件變更** —— 它只 `CREATE FUNCTION` + 兩道 `REVOKE` + 一道 `GRANT`。

## 貼之前先知道三件事

**① 它自帶斷言, 對不上會自己回捲。**
檔內 `DO $assert$` 會檢查:函式建成了 · `proacl` 不是 NULL · EXECUTE 清單**只有** `payment_confirmer`
· 回傳三個鍵都在 · `NULL` 參數會 RAISE。任一不符 ⇒ `RAISE EXCEPTION` ⇒ 整支交易回捲。
⇒ ✅ **所以「貼一半」不是它的失敗模式。**

**② 前置依賴一支既有函式。**
它呼叫 `public.pcm_js_trim_whitespace()`(`20260901070000` 建的)。
🟢 2026-09-03 實查:那支**在正式庫**。⇒ 前置滿足。

**③ 貼完之後這道告警【立刻會生效】。**
它共用 `B4_DEPLOY_CUTOFF`, 而 2026-09-03 實測那顆 env **已設**
(cron 回應 `enqueueStatus = completed`, 72/72 發)。
⇒ 🔴 **不是「貼了先靜置」** —— 下一次每日告警(台北 09:00)就會把它算進去。
⇒ 🔵 而今天算出來會是 **0**(正式庫只有 1 張訂單)⇒ 不會突然多寄一封信給老闆。

## 貼完怎麼驗(三發, 都是唯讀)

```sql
-- ① 函式在不在(用逐字簽名, 不要猜)
SELECT proname || '(' || pg_get_function_identity_arguments(oid) || ')'
  FROM pg_proc WHERE proname = 'get_order_unpaid_cancelled_gap_counts';
-- 期望:get_order_unpaid_cancelled_gap_counts(p_cutoff timestamp with time zone)
-- 🟢 正對照:同一發查 'get_order_created_gap_counts' 應該也回一列 ⇒ 尺會動

-- ② 權限只給了 payment_confirmer(兩道 REVOKE 有沒有生效)
SELECT array_to_string(proacl, ',') FROM pg_proc
 WHERE proname = 'get_order_unpaid_cancelled_gap_counts';
-- 🔴 期望:含 payment_confirmer=X;而【不得】出現 anon 或 authenticated
-- 🛑 若這一欄是 NULL ⇒ 那是「套用預設 = PUBLIC 可執行」⇒ 兩道 REVOKE 沒生效 ⇒ 回報

-- ③ 它真的算得出東西
SELECT public.get_order_unpaid_cancelled_gap_counts(now() - interval '1 day');
-- 期望:三個鍵都在。今天的值預期 pending_count / no_recipient_count 皆為 0
```

## 🔴 而【驗不過】的時候要看哪裡

| 症狀 | 意思 | 下一步 |
|---|---|---|
| apply 時 `RAISE EXCEPTION … 收權斷言失敗` | 兩道 REVOKE 沒照預期生效 | **不要 force**;把 `proacl` 整串貼出來回報 |
| apply 時 `function pcm_js_trim_whitespace() does not exist` | 前置那支不在(與 09-03 實查不符) | 先查那支, 不要自己補一份 —— **手寫第二份正是本片要避免的東西** |
| ① 回 0 列 | 沒建成 | 看 apply 的完整輸出, 不要只看 rc |
| ③ 回的數字很大 | 真的有一批單卡著 | 那不是 bug, 那正是這支要抓的東西 |

## 貼完之後還要做的一件事
`supabase/APPLIED.tsv` 補一行。
🔴 **而那本帳今天量到 279 支 migration 只記了 257 支**(22 支缺席, 其中至少 5 支【是活的】)
⇒ 📌 **缺席答不出「貼了沒」** ⇒ 補這一行是為了不要讓那個洞再大一格,
   **而它不是判別依據** —— 判別永遠是上面那三發查詢。
📎 全文:`~/pcm-mailbox/APPLIED-tsv-缺席不等於沒貼-20260903.md`

## 這支貼了之後, L5 那條線的狀態
```
付款信 ✅ · 出貨信 ✅ · 未付款取消 ✅(貼完就補齊)
已退款取消 ❌ 寫入端還沒做(片④)· 下單信 ❌ 不存在
```
📎 四封信逐封實況:`~/pcm-mailbox/L5-四封信-今天寄得出去嗎-20260903.md`
