# 付款通知待人工確認：怎麼處理、什麼時候可以結案

> 對象：工程人員（Sean 批准後照做）。
> 依據：`docs/plans/2026-09-22-webhook-manual-backlog-alert-plan.md` 第 4 節 Q3 甲（Sean 2026-09-22 選）。
> 這份手冊只處理「付款通知」這一筆紀錄要不要結案。**改訂單的付款狀態不在這份手冊裡**，那要另寫計畫、每次請 Sean 授權。

---

## 1. 這個提醒是什麼意思

客人刷卡後，TapPay 會另外送一則「付款通知」到我們的伺服器。系統會拿它去 TapPay 查帳；連續查 8 次都查不到結果，就停止自動處理，把這則通知標成「需人工處理」（`payment_webhook_events.needs_manual_review = true`）。

會看到它的地方：

- 後台首頁「工程數字」：`付款通知待人工確認：N 筆（最早一筆 YYYY-MM-DD 收到）`。有一筆就顯示。
- 每日告警信與 LINE：最早一筆收到超過 48 小時才出現，歸在「錢」那一類。

**客人可能已經被扣款**，但訂單還是未付款、不會出貨。系統查不到不代表沒扣款（`packages/use-cases/src/settle-charge.ts:105-108`）。

## 2. 先做這三件事

1. **不要**自己到 TapPay 退款。
2. **不要**用後台「登記收款」。後台人工收款只接受匯款與現金，改用那兩種登記會記錯收款方式。
3. 用唯讀方式查出這幾筆（在主資料夾執行，連線設定只在那裡）：

```sql
SELECT e.rec_trade_id, e.order_number, o.display_id, o.payment_status, e.received_at, e.last_error
  FROM public.payment_webhook_events e
  LEFT JOIN public.orders o ON o.id::text = e.order_number
 WHERE e.needs_manual_review AND NOT e.processed
 ORDER BY e.received_at, e.rec_trade_id;
```

```bash
bash scripts/readonly-prod-sql.sh <上面那段存成的 .sql 檔>
```

## 3. 判斷：只有下面兩種可以結案

每一筆都要留下證據，記在 `~/pcm-mailbox/付款通知結案紀錄-YYYYMMDD.md`（寫交易編號、訂單單號、判斷依據、證據檔名）。

**可以結案，只有這兩種：**

1. **訂單已經是「已付款」，而且付款紀錄對得上。** 代表已經由其他路徑處理好。
   證據：訂單單號、付款狀態、對應的扣款紀錄（`payment_charge_attempts` 那一列的編號與狀態）。
2. **TapPay 後台同一筆交易的明細，明確顯示最終結果是「失敗」或「已取消」。**
   證據：TapPay 交易明細截圖，存到 `~/pcm-mailbox/`，紀錄裡寫檔名。
   「尚未授權」、「處理中」、PENDING，或任何看不出最終結果的狀態都**不算**（系統本身也把「尚未授權」當成還在處理中，`settle-charge.ts:485`）。

**不能結案，保留待人工，提醒會繼續出現：**

- TapPay 查不到這筆交易、查詢失敗，或結果不明。查不到不能當作「沒扣款」。

**TapPay 顯示扣款成功，但訂單還是未付款：**

- 保留待人工，**立刻通知 Sean**。
- 這份手冊**不提供**「讓系統重新自動確認」的步驟。那條路有已知反例（已被新訂單取代的扣款不能認列；找不到進行中的扣款紀錄時會標成已處理但訂單沒變；只清人工旗標也不會重新處理），要另寫計畫、Sean 批准後才做。

## 4. 結案（正式庫寫入，每次先取得 Sean 授權）

結案 = 保留 `needs_manual_review = true` 與 `last_error`（曾經轉人工的紀錄），把 `processed` 設成 `true`。之後它就不再計入首頁與告警。

一次只結一筆，把 `<交易編號>` 換成要結的那一筆：

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $close$
DECLARE v_rows integer;
BEGIN
  UPDATE public.payment_webhook_events e
     SET processed = true, processed_at = pg_catalog.now()
   WHERE e.rec_trade_id = '<交易編號>'
     AND e.needs_manual_review AND NOT e.processed AND e.processed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '應更新 1 筆, 實際 % ⇒ 中止', v_rows;
  END IF;
END
$close$;
COMMIT;
```

結完之後：

- 重跑第 2 節的唯讀查詢，確認那一筆不見了。
- 後台首頁那一行的筆數少 1。

**改回（結錯了）**：同一個交易編號，條件改成 `needs_manual_review AND processed`，把 `processed` 設回 `false`、`processed_at` 設回 `NULL`，一樣斷言剛好更新 1 筆。這張表沒有 trigger，排程也不會再撈已重試 8 次的列，所以結案與改回都不會觸發扣款或寄信。

## 5. 上線前那 3 筆測試資料

2026-07-24 到 08-10 收到、查不到訂單的 3 筆（101、6、340 元），由一次性資料變更 `supabase/migrations/20260922120000_m4b_webhook_manual_review_close_prelaunch_tests.sql` 標成人工結案（Sean Q1 甲），還原檔在 `supabase/rollbacks/20260922120000-rollback.sql`。它們早於第一張真訂單（2026-09-02），沒有客人受影響。
