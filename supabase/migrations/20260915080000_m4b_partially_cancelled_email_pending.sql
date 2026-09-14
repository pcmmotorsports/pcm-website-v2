-- 20260915080000_m4b_partially_cancelled_email_pending.sql
-- M-4b · 部分取消補寄信 —— DB 那半:event_type 加 `order_partially_cancelled` + 掃描面 view。
-- Sean 2026-09-14 拍甲甲甲(主視窗轉):每一次取消各寄一封 / 券金額變高照寄、信裡寫清楚新金額 / 文案先給他看。
-- 文案草稿 `~/pcm-mailbox/0914-部分取消信-文案草稿.md`;TS 那半同顆 commit(enqueue use-case + composeEvent + 文案模板)。
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- 員工在後台取消【部分】品項(admin_cancel_order p_items, 第 9 代 20260914050000:295)之後, 今天只有一種客人會收到信:
-- 「匯款 + 未付款 + 網站單」走 20260913010000 的 bank_order_amount_changed。其餘(已付 / 部分付 / 刷卡 / 手動單有信箱)
-- 一封都收不到 ⇒ 客人手上那封付款信的金額是取消前的;多付的要不要退、還差多少, 他不知道。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① `email_outbox_event_type_check` 第 8 代:8 值 → 9 值, 加 `order_partially_cancelled`(NOT VALID → VALIDATE → 換名, 同 20260913010000 形狀)。
-- ④ view `pcm_partially_cancelled_email_current_v`:寄出當下重讀金額(信裡印這一刻的真值, 不印排信時的舊值)。
-- ② `pcm_partially_cancelled_email_dedup_key(uuid,uuid)`:cancellation_id:order_id —— 🔴 鍵綁【那一次取消】不綁單 ⇒ 每次取消各寄一封(Q1 甲)。
-- ③ view `pcm_partially_cancelled_email_pending`:每一列 = 一次部分取消(order_cancellations 有 items 的那些)——
--    帶取消品項 jsonb、取消後剩餘應收(`pcm_order_remaining_receivable`, 稅算不出 ⇒ NULL ⇒ TS 端 unusableAmount 不寄, 不猜)、
--    已收(`order_paid_totals_v.paid_total`)、payment_status / payment_channel;
--    WHERE:單還沒整單取消(整單走既有取消信)· 排除 bank_order_amount_changed 那族(匯款 + 未付款 + web + 非手動)· 手動單要有通知信箱(20260907230000 那句)
--    · anti-join 同鍵 outbox 列。
-- 🔴 零 trigger、零改既有物件的行為;view security_invoker = false(以 owner 讀 orders / customers, 同族七張都這樣)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- `supabase/rollbacks/20260915080000-rollback.sql`:DROP view + DROP dedup 函式 + CHECK 縮回 8 值(表裡有新 event_type 的列 ⇒ 拒退)。

-- ══ 🔴🔴 共享邊界:本檔算「錢已經真的出去多少」那兩處, 與 `pcm_order_money_moved` 是【同一份邏輯的第二份抄本】
--    (2026-09-14 A 窗在改退款那條線時比對出來的, 轉給我;我逐段核過, 逐字吻合)═══════════
-- 本檔兩處(`pcm_partially_cancelled_email_pending` 的 `paid_total`、與送信面 `…_current_v` 的同一格)寫的是:
--   `pcm_order_card_refunded(o.id)` + `SUM(order_manual_refunds WHERE voided_at IS NULL)`
-- 而 `pcm_order_money_moved(uuid)`(`20260911170000:109-124`)寫的是三段相加:
--   ① order_refunds status='confirmed'  ② order_manual_refunds voided_at IS NULL
--   ③ failed/manual_failed 而被 order_refund_effective_verdict 更正成 money_moved
-- 而 `pcm_order_card_refunded`(`20260905310000:108-127`)本體逐字 = ① + ③
-- ⇒ 📌 **本檔那兩處 = ①+③+② = `pcm_order_money_moved` 的逐段等價物。**
--
-- 🛑 **為什麼沒有直接呼它(而這不是偷懶)**:`pcm_order_money_moved` 的 EXECUTE 被收起來了 ——
--    它的 COMMENT 逐字「**只給 owner 的兩支 SECURITY DEFINER 呼, 不開成 RPC**」,
--    而本檔是 view, service_role 讀它時**以查詢者身分檢查函式 EXECUTE**
--    (那不是理論:`docs/patterns/revoking-function-execute-in-supabase.md` §3.1, 2026-09-13/14 連撞兩支)
--    ⇒ 直接呼會當場 42501。
--
-- 🔴 **⇒ 所以這是一條【沒有機器在守】的線**:`pcm_order_money_moved` 那三段哪天改了
--    (多一段帳本、或某一段的述詞變了), **本檔這兩處不會跟著變, 也不會有任何東西叫。**
--    ⇒ **動那支函式的人要同時動這裡**;A 窗已把同一句話寫進 refund allowlist 的 why, 兩邊互指。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘一:email_outbox_event_type_check 不在';
  END IF;
  IF v_def LIKE '%order_partially_cancelled%' THEN
    RAISE EXCEPTION '前置閘二:order_partially_cancelled 已在 CHECK 裡 ⇒ 貼過了, 拒重貼';
  END IF;
  -- 釘上一代 8 值都在(20260913010000 那一代);少一個 = 有人動過, 本檔的 IN(...) 會砍掉它
  IF v_def NOT LIKE '%bank_order_amount_changed%' OR v_def NOT LIKE '%order_partially_refunded%'
     OR v_def NOT LIKE '%order_unpaid_cancelled%' OR v_def NOT LIKE '%shipment_tracking_corrected%'
     OR v_def NOT LIKE '%bank_order_created%' OR v_def NOT LIKE '%order_cancelled%'
     OR v_def NOT LIKE '%order_shipped%' OR v_def NOT LIKE '%order_created%' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:CHECK 不是 20260913010000 那 8 值(實得 ' || v_def || ')⇒ 停下人工對齊';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_partially_cancelled_email_pending') IS NOT NULL
     OR pg_catalog.to_regclass('public.pcm_partially_cancelled_email_current_v') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.pcm_partially_cancelled_email_dedup_key(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘四:view 或 dedup 函式已在 ⇒ 貼過了, 拒重貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_order_card_refunded(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘五b:pcm_order_card_refunded / pcm_bank_amount_changed_email_dedup_key 不在 ⇒ 20260912020000 或 20260913010000 還沒貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_order_remaining_receivable(uuid)') IS NULL
     OR pg_catalog.to_regclass('public.order_paid_totals_v') IS NULL
     OR pg_catalog.to_regclass('public.order_cancellation_items') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘五:pcm_order_remaining_receivable / order_paid_totals_v / order_cancellation_items / pcm_js_trim_whitespace 不齊 ⇒ 20260914070000 還沒貼';
  END IF;
END
$pre$;

-- ── ① event_type CHECK 第 8 代(9 值)────────────────────────────
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v8
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed',
    'order_partially_cancelled'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v8;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v8 TO email_outbox_event_type_check;

-- ── ② dedup 鍵(新物件 ⇒ 裸 CREATE)──────────────────────────────
CREATE FUNCTION public.pcm_partially_cancelled_email_dedup_key(
  p_cancellation_id uuid,
  p_order_id        uuid
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_cancellation_id::text || ':' || p_order_id::text;
$fn$;
COMMENT ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid) IS
  '部分取消信的 dedup_key = cancellation_id:order_id(20260915080000)。🔴 綁那一次取消不綁單 ⇒ 同一張單取消兩次各寄一封(Sean 09-14 甲)。TS 端 composeEvent 同一個算式, 改一邊要改兩邊。';
REVOKE ALL ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid)
  FROM anon, authenticated, payment_confirmer;
-- 🔴 service_role 要 EXECUTE:security_invoker = false 只讓【表】以 owner 身分讀, view 裡呼叫的【函式】仍以呼叫者身分查 EXECUTE
--    (PostgreSQL 語意;拋棄式 PG 2026-09-14 實測:不給就 42501 permission denied for function)。
--    ⇒ 20260913010000:271 那句「以 owner 身分呼、不需要 GRANT」在 PG 上不成立 —— 那支在正式庫能跑是因為 service_role 對它的函式實際有 EXECUTE。
GRANT EXECUTE ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid) TO service_role;

-- ── ③ 掃描面 ────────────────────────────────────────────────────
CREATE VIEW public.pcm_partially_cancelled_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                       AS order_id,
  oc.id                      AS cancellation_id,
  o.display_id,
  oc.created_at              AS cancelled_at,
  items.items                AS cancelled_items,
  items.cancelled_count      AS cancelled_count,
  eff.effective_subtotal,
  eff.effective_shipping_fee,
  public.pcm_order_remaining_receivable(o.id) AS remaining_receivable,
  -- 🔴 codex R1 must-fix ②:已【收】不等於已收未退 —— 收 10,000 退 2,000 而剩餘應收 8,000 時,
  --    用毛額會算出「多付 2,000 再退你」⇒ 退兩次。這裡逐字用退款信那張 view 的同一組來源
  --    (`pcm_order_card_refunded` + `order_manual_refunds` 未作廢加總, 20260912020000:100-104)。
  -- 🔴 **共享邊界**:這兩項相加 = `pcm_order_money_moved` 的三段(見檔頭那段);那支改了, 這裡要一起改, 而沒有閘會叫。
  GREATEST(COALESCE(p.paid_total, 0) - refunded.card_refunded - refunded.manual_refunded, 0)::bigint AS paid_total,
  o.payment_status::text     AS payment_status,
  o.payment_channel,
  o.notification_email,
  c.email                    AS customer_email,
  o.order_source
FROM public.order_cancellations oc
JOIN public.orders o ON o.id = oc.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
LEFT JOIN public.pcm_order_effective_amounts_v eff ON eff.order_id = o.id
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id
CROSS JOIN LATERAL (
  SELECT
    public.pcm_order_card_refunded(o.id) AS card_refunded,
    COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
               WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)::bigint AS manual_refunded
) refunded
CROSS JOIN LATERAL (
  SELECT
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'title', NULLIF(pg_catalog.btrim(oi.product_snapshot ->> 'title'), ''),
        'quantity', ci.cancelled_quantity
      ) ORDER BY oi.id
    ) AS items,
    pg_catalog.count(*)::integer AS cancelled_count
  FROM public.order_cancellation_items ci
  JOIN public.order_items oi ON oi.id = ci.order_item_id
  WHERE ci.cancellation_id = oc.id
) items
WHERE items.cancelled_count > 0                       -- 沒有品項明細的取消(p_items NULL)零列;🔵 整單取消【也會】寫明細, 擋它的是下一行(codex R1 nit)
  AND o.cancelled_at IS NULL                          -- 整單取消走既有取消信 / 未付款取消信
  -- 🔴 排除 bank_order_amount_changed 那族(20260913010000):匯款 + 未付款 + 網站單 + 非手動 ⇒ 那封信講同一件事, 不雙寄
  AND NOT (o.payment_channel = 'bank_transfer' AND o.payment_status = 'unpaid'::public.payment_status
           AND o.order_source = 'web' AND o.manual_request_id IS NULL)
  -- 手動單:通知信箱空 = 不寄(Sean 09-10 拍甲;20260907230000 那句逐字)
  AND (o.order_source IS NULL
       OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
       OR NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL)
  AND (NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
       OR NULLIF(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_partially_cancelled'
           AND e.dedup_key = public.pcm_partially_cancelled_email_dedup_key(oc.id, o.id)
      )
  -- 🔴 codex R1 must-fix ③:上面那條互斥只成立於【當下】—— 未付款時已寄過 bank_order_amount_changed,
  --    客人付款後這張單就不再落在那個 NOT(...) 裡 ⇒ 同一次取消會再寄一封講同一件事的信。
  --    ⇒ 同一次取消只要【任一封】講過金額改了, 本信就不寄(兩支 dedup 函式的鍵同形 cancellation:order)。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'bank_order_amount_changed'
           AND e.dedup_key = public.pcm_bank_amount_changed_email_dedup_key(oc.id, o.id)
           -- 🔴 codex R2 must-fix ①:那一列若是【終態跳過而且從沒交給 provider】(客人付清後銀行信
           --    走 not_mailable 跳過)⇒ 那封信其實【沒寄】⇒ 再擋本信 = 兩封都沒寄、永久漏。
           --    ⇒ 只有「寄過 / 還可能會寄」的列才擋。`handed_to_provider_at IS NULL` 是「確定沒交出去」的那一半。
           AND NOT (e.status LIKE 'skipped\_%' AND e.handed_to_provider_at IS NULL)
      );

COMMENT ON VIEW public.pcm_partially_cancelled_email_pending IS
  '部分取消補寄信的掃描面(20260915080000;Sean 09-14 甲甲甲)。一列 = 一次部分取消(order_cancellations 有 items)。'
  'remaining_receivable = pcm_order_remaining_receivable(含稅單稅算不出 ⇒ NULL ⇒ TS 端不寄, 不猜);paid_total = order_paid_totals_v。'
  '排除:已整單取消(走取消信)/ 匯款未付款網站單(走 bank_order_amount_changed)/ 手動單無通知信箱。'
  'anti-join 兩支:同鍵的 order_partially_cancelled 與 bank_order_amount_changed(同一次取消只講一次金額);不分 status(同族既有語意)。'
  'paid_total 是【已收未退】(毛額扣 pcm_order_card_refunded 與未作廢人工退款)—— 用毛額會承諾退第二次。';

REVOKE ALL ON public.pcm_partially_cancelled_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_partially_cancelled_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partially_cancelled_email_pending TO service_role;

-- ── ④ 寄出當下的現值(codex R1 must-fix ④)────────────────────────────────
-- 🔴 排信與寄出之間會過幾秒到幾小時(重試):客人這中間付清了、或我們退了款 ⇒ 信裡那幾個數字就變成假的
--    (「請補付」給一個已經付清的人、「會退你 X」而 X 已經退過)。既有的 order_ineligible 閘只擋【整單取消 / 全退】。
-- ✅ 修法不是「比對後放棄」而是【寄出當下重讀】—— 信裡印的永遠是這一刻的真值, 陳舊在構造上不可能發生。
-- 🔵 一列一張單;`still_partial` = 這張單仍是「部分取消而沒整單取消」的狀態(整單取消了 ⇒ 該走取消信, 本信不寄)。
CREATE VIEW public.pcm_partially_cancelled_email_current_v
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id AS order_id,
  (o.cancelled_at IS NULL) AS still_partial,
  eff.effective_subtotal,
  eff.effective_shipping_fee,
  public.pcm_order_remaining_receivable(o.id) AS remaining_receivable,
  -- 🔴 **共享邊界**(同檔頭):下面兩項相加 = `pcm_order_money_moved` 的三段。那支改了這裡要一起改, 沒有閘會叫。
  GREATEST(COALESCE(p.paid_total, 0)
           - public.pcm_order_card_refunded(o.id)
           - COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
                        WHERE m.order_id = o.id AND m.voided_at IS NULL), 0), 0)::bigint AS paid_total
FROM public.orders o
LEFT JOIN public.pcm_order_effective_amounts_v eff ON eff.order_id = o.id
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id;

COMMENT ON VIEW public.pcm_partially_cancelled_email_current_v IS
  '部分取消信【寄出當下】重讀的現值(20260915080000;codex R1 must-fix ④)。'
  '金額口徑與掃描面那張逐字相同(remaining_receivable 含稅、paid_total 是已收未退);'
  'still_partial = false ⇒ 這張單已整單取消, 本信不該寄(走取消信)。零寫入、零 trigger。';

REVOKE ALL ON public.pcm_partially_cancelled_email_current_v FROM PUBLIC;
REVOKE ALL ON public.pcm_partially_cancelled_email_current_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partially_cancelled_email_current_v TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數這兩個陣列;可授權物件 2 = 1 函式 + 1 view)
  v_functions text[] := ARRAY[
    'public.pcm_partially_cancelled_email_dedup_key(uuid,uuid)'
  ]::text[];
  v_relations text[] := ARRAY[
    'public.pcm_partially_cancelled_email_pending',
    'public.pcm_partially_cancelled_email_current_v'
  ]::text[];
  r text; v_def text; v_n integer;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%order_partially_cancelled%' THEN
    RAISE EXCEPTION '後置閘一:CHECK 換名後不含 order_partially_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.email_outbox'::regclass AND conname = 'email_outbox_event_type_check_v8') THEN
    RAISE EXCEPTION '後置閘二:v8 暫名還在 ⇒ 換名沒成功';
  END IF;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN RAISE EXCEPTION '後置閘三:% 不存在', r; END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四b:% service_role 不能 EXECUTE ⇒ view 對 service_role 會 42501', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(r) IS NULL THEN RAISE EXCEPTION '後置閘五:% 不存在', r; END IF;
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT') OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT') THEN
      RAISE EXCEPTION '後置閘六:% 對 anon/authenticated 開著 SELECT', r;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      RAISE EXCEPTION '後置閘七:% service_role 讀不到 ⇒ sweeper 掃不到', r;
    END IF;
  END LOOP;
  -- 尺是活的:view 以【service_role 身分】跑得動(0 列也算;抓得到 42501 / 42703 / 42883 那種)—— sweeper 就是這個身分。
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_partially_cancelled_email_pending;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE '[20260915080000] 後置閘全過;掃描面現在 % 列待寄', v_n;
END
$post$;

COMMIT;
