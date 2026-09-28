-- 20260928235500-rollback.sql —— 未付款取消信告警函式退回 20260916030000 那一代(不排除 manual 留白)
-- 退回之後,手動單兩個信箱都空時會再被 no_recipient_count 誤叫(已知誤報)。函式體逐字還原,後置閘核對 md5。不動資料表。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_order_unpaid_cancelled_gap_counts(
  p_cutoff timestamptz
)
RETURNS jsonb
-- 🔴 `plpgsql` 而不是 `sql`:純 SQL 函式沒辦法 RAISE ⇒ NULL 參數只能被安靜吞掉,
--    而 `>= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**, 而 0 正是「一切正常」的樣子。
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 **單一來源** —— 不在這裡寫第三份空白字集。
  --    `20260901070000` 那片的產出逐字是「解法不是加寬那一份, 是**讓只剩一份**」
  --    ⇒ 我手寫一份 = 製造它剛消滅掉的東西。
  JS_WS constant text := public.pcm_js_trim_whitespace();
  v_result jsonb;
BEGIN
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_order_unpaid_cancelled_gap_counts:p_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **脈絡, 不是告警**:未付款、已被員工取消、在起始線之後, 而取消信那一列還沒被建出來。
    --    🛑 **這個數 > 0 是【正常】的** —— 下一輪 scanner 就會把它們排進去。
    --    它存在的理由是:沒有它, 下面那個 `no_recipient` 的 0 在
    --    「一切正常」與「這裡根本沒有取消單」之間分不出來。
    'pending_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_status = 'unpaid'
          AND o.cancelled_at IS NOT NULL
          AND o.cancelled_at >= p_cutoff
          -- ⛔ ~~AND o.created_at >= p_cutoff~~(20260915210000, Sean Q8 甲:看取消時間, 不看成立時間;與 scanner 一致)
          -- 🔴 逾時自動取消不算(與 pcm_unpaid_cancelled_email_pending 同一條, codex R1 MF1)
          AND o.cancelled_reason IS DISTINCT FROM 'payment_expired'
          -- 🔴 **身分判準不讀 cancelled_reason 的值**(20260916030000 起看整單取消稽核列的 after.closed:RPC 寫的布林, 不是員工打的字)。
          --    理由:員工七值裡的 `other` 後面接的是**員工自己打的一段字**
          --    ⇒ 拿 `cancelled_reason` 當身分 = 讓一個人打什麼字決定另一批客人收不收得到信。
          --    ⚠️ 而這個判準有它自己的脆弱點, 全文在
          --      `packages/ports/src/IUnpaidCancelledOrderScanner.ts` 檔頭。
          -- 🔴 20260916030000:身分判準 = 員工整單取消的稽核列(與 pcm_unpaid_cancelled_email_pending 同一條)
          AND EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.action = 'order.cancel'
                   AND a.target = 'order:' || o.id::text
                   AND a.after ->> 'closed' = 'true')
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_unpaid_cancelled'
                   -- 🔴 codex R2 MF2:與 pcm_unpaid_cancelled_email_pending 的 anti-join 逐字同一份 skip 清單。
                   --    少了它:排信後兩個信箱被清空 ⇒ 那列落 recipient_stale_at_send ⇒ view 放行而這裡不算 ⇒ 不寄也不告警。
                   AND COALESCE(e.last_error_code, '') NOT IN (
                         'shipment_voided',
                         'tracking_superseded',
                         'bank_order_not_mailable_at_send',
                         'bank_order_snapshot_stale',
                         'recipient_stale_at_send'
                       ))),

    -- 🔴🔴 **這一個才是告警的主詞**:上面那一群裡, **兩個信箱都空**的。
    --    ⇒ scanner 撈到它也 enqueue 不了(use-case 落 `noRecipient` 桶)
    --    ⇒ 📌 **它不會自己好** —— 那張單沒有信箱, 下一輪、下下輪都一樣
    --    ⇒ ✅ 所以「有一封就叫」套在這一格上不會變噪音。
    -- ⚠️ 兩個候選信箱的順序與 adapter 一致:`orders.notification_email` 優先,
    --    退回 `customers.email`(LEFT JOIN ⇒ 沒有 customer 也算「空」)。
    -- 🔴 `NULLIF` 不加 `pg_catalog.` 前綴, 而那不是漏寫 —— 它是**SQL 文法構造**不是函式,
    --    不受 `search_path = ''` 影響、也不能加 schema 前綴(`btrim` / `count` 是真函式 ⇒ 要加)。
    --    📌 姊妹那支的作者踩過這一格, 而抓到它的是【真的餵給 psql】不是靜態檢查。
    'no_recipient_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
        WHERE o.payment_status = 'unpaid'
          AND o.cancelled_at IS NOT NULL
          AND o.cancelled_at >= p_cutoff
          -- ⛔ ~~AND o.created_at >= p_cutoff~~(20260915210000, Sean Q8 甲:看取消時間, 不看成立時間;與 scanner 一致)
          -- 🔴 逾時自動取消不算(與 pcm_unpaid_cancelled_email_pending 同一條, codex R1 MF1)
          AND o.cancelled_reason IS DISTINCT FROM 'payment_expired'
          -- 🔴 20260916030000:身分判準 = 員工整單取消的稽核列(與 pcm_unpaid_cancelled_email_pending 同一條)
          AND EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.action = 'order.cancel'
                   AND a.target = 'order:' || o.id::text
                   AND a.after ->> 'closed' = 'true')
          AND NULLIF(pg_catalog.btrim(o.notification_email, JS_WS), '') IS NULL
          AND NULLIF(pg_catalog.btrim(c.email, JS_WS), '') IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_unpaid_cancelled'
                   -- 🔴 codex R2 MF2:與 pcm_unpaid_cancelled_email_pending 的 anti-join 逐字同一份 skip 清單。
                   --    少了它:排信後兩個信箱被清空 ⇒ 那列落 recipient_stale_at_send ⇒ view 放行而這裡不算 ⇒ 不寄也不告警。
                   AND COALESCE(e.last_error_code, '') NOT IN (
                         'shipment_voided',
                         'tracking_superseded',
                         'bank_order_not_mailable_at_send',
                         'bank_order_snapshot_stale',
                         'recipient_stale_at_send'
                       ))),

    -- 🔴 **分母**:沒有它, 上面兩個 0 在「一切正常」與「這裡根本沒有訂單資料 / 讀不到」
    --    之間分不出來。
    -- ⚠️ **用途寫在它旁邊, 免得下一個人拿它去算比率**:它是**全域訂單數**,
    --    含已付款、含起始線以前的。它答的是「**這裡到底有沒有訂單資料**」,
    --    **不是**「這個告警視窗裡有幾筆」。
    'orders_total_count',
      (SELECT pg_catalog.count(*) FROM public.orders)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;
DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.get_order_unpaid_cancelled_gap_counts(timestamptz)'))
     IS DISTINCT FROM '1a4042834023367339e5cb656b5a3238' THEN
    RAISE EXCEPTION '後置閘:get_order_unpaid_cancelled_gap_counts 沒有回到 20260916030000 那一代';
  END IF;
  RAISE NOTICE '✅ 20260928235500 退回完成';
END
$post$;

COMMIT;
