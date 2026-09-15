-- 20260916030000-rollback.sql —— 退回 20260916030000_m4b_unpaid_cancel_email_staff_full_cancel_audit_evidence.sql
-- 兩個物件退回 20260915210000 的逐字定義(身分判準回到「曾有 order_cancellations」+ 逾時排除)。
-- 🔴 退回的代價:「部分取消過的未付款匯款單, 之後被刷卡單取代(superseded_by_card)」會回到誤寄未付款取消信。
-- TS 不用跟著退(scanner 只讀 view)。

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
SELECT 'view'::text AS kind, c.relacl::text AS acl FROM pg_catalog.pg_class c WHERE c.oid = 'public.pcm_unpaid_cancelled_email_pending'::regclass
UNION ALL
SELECT 'fn', p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;

-- 只退「本檔目標那一代」(或已經退回的 20260915210000 = 重跑);其他指紋 ⇒ 有人又改過, 不准蓋掉
DO $pre$
DECLARE v_view text; v_fn text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true)) INTO v_view;
  SELECT pg_catalog.md5(p.prosrc) INTO v_fn FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;
  IF v_view NOT IN ('bc74e696b28afbb91bd7078545e9b0a5', 'fba321f731525877fe90800f9001e099')
     OR v_fn NOT IN ('1a4042834023367339e5cb656b5a3238', 'e7c1cc4796e74ef6da08c6142cfa6cb1') THEN
    RAISE EXCEPTION USING MESSAGE = '退回前置閘:定義指紋 view=' || coalesce(v_view, 'null') || ' fn=' || coalesce(v_fn, 'null')
      || ' 不是 20260916030000 目標也不是 20260915210000 ⇒ 有人又改過, 停下';
  END IF;
END
$pre$;

CREATE OR REPLACE VIEW public.pcm_unpaid_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'unpaid'
  AND o.cancelled_at IS NOT NULL
  AND EXISTS (
        SELECT 1 FROM public.order_cancellations oc
         WHERE oc.order_id = o.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_unpaid_cancelled'
           -- 🔴🔴 **只擋【不是我們自己跳過的】列**(形狀逐字照 45f `20260906190000` 那一段)。
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --      ⇒ 📌 **每一輪重寄同一封**, 而那與本支的方向【相反】。
           --    🛑 **`failed` 不在清單裡, 而那是刻意的** —— 放行它會被唯一鍵
           --      `(event_type, dedup_key)` 擋著 ⇒ **每一輪重撈而永遠插不進去** ⇒ 擠掉真的要寄的信。
           --      (那是 45f 檔頭量到的病。死信怎麼救是另一件事 ⇒ 板列 ⟦mail-DEADMAILREQUEUE⟧。)
           --    🔴 **新增 skip 碼時要回來加這裡** —— 五張 view 共用同一份清單, 少一張就等於沒修。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 -- ✅ 放行(這四個碼**有機會**在重排時算出新的 dedup_key ⇒ 插得進去)
                 --    🟡 前兩個是【一定】(skip 那一發自己改鍵);後兩個是【多半】
                 --       —— 匯款指紋在三欄全沒變 / 快照 A→B→A 時會回到同一把鍵。
                 --       那是 45f 既有缺口、非本版新增(裁【甲】), 詳檔頭與 ⟦mail-SKIPKEYNORETIRE⟧。
                 -- 🛑 **要不要放行一個新碼, 判準只有一句**:
                 --    「這個碼寫下去之後, 下一輪重排算得出【不同的】 dedup_key 嗎?」
                 --    算得出 ⇒ 可放行;算不出 ⇒ 放回掃描面只會每輪撞唯一鍵、永遠插不進去,
                 --    要先改鍵。(codex 2026-09-07 12③ must-fix, 主視窗當日裁【甲】)
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 -- 🔴 ⟦mail-RECIPIENTNOTRECHECKED⟧ 新增:寄送當下地址已與快照不同 ⇒ 跳過 + 退休鍵。
                 --    放行判準逐字照本清單既有那句:「下一輪重排算得出【不同的】dedup_key 嗎?」
                 --    ⇒ 算得出 —— 因為 `markSkippedRecipientStale` 會把舊鍵改成
                 --      `{舊鍵}:recipientstale:{id}`(`SupabaseEmailOutboxAdapter.ts`)。
                 'recipient_stale_at_send'
                 -- 🛑 不放行(無退休鍵):'order_ineligible' / 'order_ineligible_at_send'
                 --    / 'before_send_cutoff' —— 見板列 ⟦mail-SKIPKEYNORETIRE⟧
               ))
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND (
        -- 🔴🔴 **codex ②:`o.order_source IS NULL` 這一格【非加不可】。**
        --    `NULL NOT IN (…)` 回的是 **NULL**(不是 true)⇒ WHERE 當假 ⇒ 來源不明的單被【排除】,
        --    而 TS 那半對 `null` 是**照舊寄** ⇒ 兩層對同一個世界給相反的答案。
        --    ⇒ ✅ 對齊 TS:**不知道來源 ⇒ 留在掃描面上。**(多寄一封看得見, 少寄一封看不見。)
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴🔴 20260915210000(Sean 2026-09-15 拍 Q8 甲 · codex R1 MF1):逾時自動取消【不算】員工取消。
  --    上面那個身分判準只問「曾有 order_cancellations」, 而【部分取消】也會寫那一列(不寫 cancelled_at)
  --    ⇒ 「部分取消 → 之後逾時自動取消(cancelled_reason='payment_expired')」會被當成員工整單取消 ⇒ 誤寄。
  --    ✅ `payment_expired` 是機器碼, 員工打不進去(20260903093000 保留字閘)⇒ 用它排除是安全的。
  --    ⚠️ 原本 TS 那一側的 `created_at >= cutoff` 只替「cutoff 前成立」的這種單擋住;cutoff 後成立的同一種單原本就會誤寄。
  AND o.cancelled_reason IS DISTINCT FROM 'payment_expired';

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
          -- 🔴 **身分判準 = 那一列存在**, 不讀任何欄位的【值】。
          --    理由:員工七值裡的 `other` 後面接的是**員工自己打的一段字**
          --    ⇒ 拿 `cancelled_reason` 當身分 = 讓一個人打什麼字決定另一批客人收不收得到信。
          --    ⚠️ 而這個判準有它自己的脆弱點, 全文在
          --      `packages/ports/src/IUnpaidCancelledOrderScanner.ts` 檔頭。
          AND EXISTS (
                SELECT 1 FROM public.order_cancellations oc
                 WHERE oc.order_id = o.id)
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
          AND EXISTS (
                SELECT 1 FROM public.order_cancellations oc
                 WHERE oc.order_id = o.id)
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
DECLARE v_view text; v_fn text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true)) INTO v_view;
  SELECT pg_catalog.md5(p.prosrc) INTO v_fn FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;
  IF v_view <> 'fba321f731525877fe90800f9001e099' OR v_fn <> 'e7c1cc4796e74ef6da08c6142cfa6cb1' THEN
    RAISE EXCEPTION '退回後置閘:指紋 view=% fn=% 不是 20260915210000', v_view, v_fn;
  END IF;
  IF EXISTS (
    SELECT 1 FROM _acl_before b
     WHERE b.acl IS DISTINCT FROM (CASE b.kind
             WHEN 'view' THEN (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.pcm_unpaid_cancelled_email_pending'::regclass)
             ELSE (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure)
           END)) THEN
    RAISE EXCEPTION '%', '退回後置閘:權限與退回前不同';
  END IF;
  RAISE NOTICE '[20260916030000-rollback] 已退回 20260915210000 的定義';
END
$post$;

COMMIT;
