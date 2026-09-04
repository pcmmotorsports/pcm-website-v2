-- ROLLBACK for 20260905080000_m4b_pending_views_order_source.sql
--
-- 🔴🔴 **為什麼是一支檔而不是一段說明**(codex 2026-09-05 MF2):
--    原本只寫「照本檔那四段刪掉那一行即可」—— 而 `DROP VIEW` 帶走的**不只 ACL,
--    還有四段 `COMMENT ON VIEW`**, 那裡面住著 Sean 的拍板、⟦b4-JSWSNARROWER⟧ 的已知缺口、
--    以及「這個 view 與 gap_counts 是互補集, 改一支必須改另一支」。
--    🛑 **一份要人手工拼四段註解的回退指示, 在急著回退的那一刻等於沒有。**
--    ⇒ 本檔把四段註解的**原文逐字**放進來, 執行它就回到貼之前那個狀態。
--
-- 🔴 `CREATE OR REPLACE VIEW` **不能減少欄位** ⇒ 必須 DROP 再 CREATE。
-- ⚠️ `DROP VIEW` 不加 CASCADE:2026-09-05 查過沒有其他 view 依賴這四支
--    (三支 gap_counts 是 plpgsql, 不建 catalog 相依)⇒ DROP 不會被擋。
--    📌 **這句話會在有人加 view 那天變假。**
-- ⚠️ 四段註解是**機械抄的**(regex 抓 `COMMENT ON VIEW … ;` 整段), 不是我重打的。
--    來源檔逐段標在下面。

BEGIN;

DROP VIEW public.pcm_order_created_email_pending;
DROP VIEW public.pcm_shipped_email_pending;
DROP VIEW public.pcm_tracking_corrected_email_pending;
DROP VIEW public.pcm_unpaid_cancelled_email_pending;

CREATE VIEW public.pcm_order_created_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.paid_at            AS paid_at,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_created')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

CREATE VIEW public.pcm_shipped_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                 AS shipment_id,
  s.shipment_reference AS shipment_reference,
  s.shipped_at         AS shipped_at,
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.notification_email AS notification_email,
  c.email              AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_shipped'
           AND e.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id));

CREATE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id                  AS shipment_id,
  s.shipment_reference  AS shipment_reference,
  s.tracking_number     AS tracking_number,
  s.carrier_code        AS carrier_code,
  s.tracking_corrected_at AS tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id                  AS order_id,
  o.display_id          AS display_id,
  o.notification_email  AS notification_email,
  c.email               AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items oi ON oi.id = si.order_item_id
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND EXISTS (
        SELECT 1 FROM public.email_outbox e0
         WHERE e0.event_type = 'order_shipped'
           AND e0.dedup_key = public.pcm_shipped_email_dedup_key(s.id, o.id)
           AND e0.status = 'sent'
           AND e0.sent_at IS NOT NULL
           AND e0.sent_at < s.tracking_corrected_at)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at));

CREATE VIEW public.pcm_unpaid_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email
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
           AND e.event_type = 'order_unpaid_cancelled')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );


-- ── ACL(DROP 帶走了, 逐字貼回)──────────────────────────────
REVOKE ALL ON public.pcm_order_created_email_pending FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_shipped_email_pending FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_tracking_corrected_email_pending FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pcm_unpaid_cancelled_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_order_created_email_pending TO service_role;
GRANT SELECT ON public.pcm_shipped_email_pending TO service_role;
GRANT SELECT ON public.pcm_tracking_corrected_email_pending TO service_role;
GRANT SELECT ON public.pcm_unpaid_cancelled_email_pending TO service_role;
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── COMMENT ON VIEW(DROP 帶走了;以下四段是【原文逐字】)────────
-- 原文來源:supabase/migrations/20260905020000_m4b_e4_order_created_pending_view.sql
COMMENT ON VIEW public.pcm_order_created_email_pending IS
$c$「已付款、未取消、還沒排過 order_created 通知信、而且【至少一個信箱非空】」的訂單。一列 = 一封要寄的信。
🔴 最後那個條件是本 view 存在的理由:兩個信箱都空的單不會自己好, 而留在掃描面上會被每一輪重撈,
累積到上限就把名額佔滿, 讓真的要寄的信擠不進來 —— 而它不報錯、不進死信、心跳照綠。
🟢 那些被排除的單【仍然看得見】:get_order_created_gap_counts 的 no_recipient_count 在數它們,
而那個計數 2026-09-03 就接進每日告警的 shouldAlert 了。⇒ 本 view 只負責讓它們離開掃描面。
🛑 本 view 不含 cutoff —— paid_at 與 created_at 兩欄都回出去, 由呼叫端篩。
兩個都要:少了 created_at 那一半, 晚翻 paid 的舊單會被誤寄(PRD §5 R3)。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它解不掉 ⟦b4-JSWSNARROWER⟧:U+202F / U+205F 兩個碼位 SQL 判非空而 JS 判空
⇒ 只有那兩種字元的信箱仍會進來、仍會每輪重撈。$c$;
-- 原文來源:supabase/migrations/20260905040000_m4b_e4_shipped_email_js_whitespace.sql
COMMENT ON VIEW public.pcm_shipped_email_pending IS
$c$「已出貨、未作廢、還沒排過 order_shipped、而且至少一個信箱非空」的 (箱, 單) 配對。一列 = 一封要寄的信。
🔴 空白定義走 public.pcm_js_trim_whitespace() 單一來源(2026-09-05 ⟦b4-SHIPPEDBTRIMNARROW⟧ 從裸 btrim 改過來)
—— 四支寄信掃描 view 從此對同一個信箱給同一個答案。
🔴 pcm_shipped_email_unsendable 是本 view 的補集,兩支的其餘條件逐字相同 —— **改一支必須改另一支**,
而 get_shipped_email_gap_counts 的兩個計數分別從這兩支數 ⇒ 補集破掉那支函式就開始漏報。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它解不掉 ⟦b4-JSWSNARROWER⟧:U+202F / U+205F 兩個碼位 SQL 判非空而 JS 判空。$c$;
-- 原文來源:supabase/migrations/20260904220000_m4b_outbox_shipment_tracking_corrected_event.sql
COMMENT ON VIEW public.pcm_tracking_corrected_email_pending IS
  '「已出貨、未作廢、單號被更正過、而且客人【真的收過那個錯號碼】、還沒排過更正信」的 (箱, 單) 配對。一列 = 一封信。
🔴 最重要的一格是 sent_at 早於 tracking_corrected_at 那個 EXISTS ——
這封信說的是「先前通知您的單號有誤」, 而它的前提是客人真的收過。
出貨信被 cutoff 擋掉、或還在 pending 時號碼就被改了(送信當下讀 live 追蹤碼)⇒ 兩種都不該寄。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它不自帶 cutoff —— 呼叫端要不要加起始線由呼叫端決定;而上面那道 EXISTS 已經
把「功能上線第一秒集合等於歷史全部」那個病擋掉了(歷史上的箱沒有 tracking_corrected_at)。
🔴 部署順序:模板與 enqueue 接線必須同一次 deploy —— 差集不分 status, 一列 failed 就永久排除那個 (箱,號碼)。';
-- 原文來源:supabase/migrations/20260905030000_m4b_e4_unpaid_cancelled_pending_view.sql
COMMENT ON VIEW public.pcm_unpaid_cancelled_email_pending IS
$c$「未付款、被【員工】取消、還沒排過 order_unpaid_cancelled 通知信、而且至少一個信箱非空」的訂單。
🔴 身分判準是 order_cancellations 那一列【存不存在】, 不讀它任何欄位 ——
員工選「其他」時 cancelled_reason 就是他打的字, 拿它當身分 = 讓打字的人決定誰收得到信。
🔴 最後那個信箱條件是本 view 存在的理由:兩個信箱都空的單不會自己好, 留在掃描面上會被每一輪重撈,
累積到上限就把名額佔滿, 讓真的要寄的信擠不進來 —— 而它不報錯、不進死信、心跳照綠。
🟢 被排除的單仍然看得見:get_order_unpaid_cancelled_gap_counts 的 no_recipient_count 在數它們,
而那個計數 2026-09-03 就接進每日告警了。
🛑 本 view 不含 cutoff(參數, 留在 adapter)。⚠️ 而 adapter 那道 created_at >= cutoff
是一個【已知會漏信】的條件(cutoff 之前建立、之後被取消的單收不到信);今天無害,
而它會在有人給這條線一顆新 cutoff 的那天開始靜靜漏 —— 本片沒有改變也沒有解掉它。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它解不掉 ⟦b4-JSWSNARROWER⟧(U+202F / U+205F 兩個碼位 SQL 判非空而 JS 判空)。$c$;

-- ── 回退自證 ───────────────────────────────────────────────────
DO $$
DECLARE v_n integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
   WHERE n.nspname='public' AND c.relkind='v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND a.attname='order_source' AND a.attnum>0 AND NOT a.attisdropped;
  IF v_n <> 0 THEN RAISE EXCEPTION '回退自證①:還有 % 個 view 帶著 order_source', v_n; END IF;

  -- 🔴 而「欄沒了」只答了一半 —— 註解有沒有回來是另一半, 而那正是本檔存在的理由。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relkind='v'
     AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                       'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
     AND pg_catalog.length(coalesce(pg_catalog.obj_description(c.oid,'pg_class'),'')) > 100;
  -- ⚠️ `coalesce` 不加 `pg_catalog.` 前綴 —— 它是 SQL【語法】不是函式(與 `nullif` 同款)。
  --    🔴 我第一版加了 ⇒ 回退腳本 apply 期當場炸。抓到它的是探針格14, 不是我讀它。
  IF v_n <> 4 THEN RAISE EXCEPTION '回退自證②:只有 % 個 view 帶著註解(應為 4)⇒ 有註解沒貼回來', v_n; END IF;
END $$;

COMMIT;
