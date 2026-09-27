-- 20260927080000_m4b_return_received_email_pending.sql
-- M-4b · 退貨收回通知客人(A3)—— DB 那半:event_type 加 `order_return_received` + dedup 鍵 + 掃描面 view。
-- Sean 2026-09-27 答 A3 三題全甲(主視窗轉):只寄 email(有真 email 才寄;沒真 email 的 LINE 好友照既有二選一規則)
--   / 員工按「確認收到退貨」後自動排進佇列 / 內容只說已收到您寄回的商品、會盡快處理退款, 不寫狀況與金額。
-- 計畫:~/pcm-mailbox/計畫-退貨通知客人-20260927.md。形狀照 20260915150000(部分取消補寄信), 但沒有金額、沒有讓路。
-- TS 那半:同分支片 1(型別、composeEvent、內容組裝、文案)與片 2(enqueue、寄信排程上膛開關)。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① `email_outbox_event_type_check` 第 9 代:9 值 → 10 值, 加 `order_return_received`(NOT VALID → VALIDATE → 換名, 同 20260915150000)。
-- ② `pcm_return_received_email_dedup_key(uuid,uuid)` = return_id:order_id —— 🔴 綁【那一筆退貨】不綁單 ⇒ 同一張單退兩次各寄一封。
-- ③ view `pcm_return_received_email_pending`:一列 = 一筆已收回(status = 'received')的退貨,
--    帶實收品項 jsonb(只列實收數量 > 0 的品項);
--    WHERE:至少收到一件(實收全是 0 ⇒ 沒有東西可說已收到, 不寄)· 手動單要有通知信箱(20260907230000 那句)
--    · 兩個信箱至少一個非空 · anti-join 同鍵 outbox 列(不看 status:這一筆退貨排過一次就不再排)。
--    🔵 這一型實際會出現的同鍵列(Fable R1 C3 要求寫實話;與 20260915150000 那兩條互讓 anti-join 的 status 條件不是同一件事):
--       pending / sending / sent / failed / dead ⇒ 擋, 對;
--       skipped_no_real_email ⇒ 擋, 對 —— 寄信排程會把它翻成 LINE(好友)或留著(不是好友就沒有可送的對象);
--       skipped_order_ineligible ⇒ 走不到 —— SUPPRESS_WHEN_ORDER_INELIGIBLE 對這一型是 false, 送出前的閘不會擋它;
--       skipped_manual_no_recipient ⇒ 實務上走不到 —— 手動單沒有通知信箱時本 view 根本不列那筆退貨;
--       收件人變了而退休的列 ⇒ writer 換了 dedup_key, 不等於本鍵 ⇒ 不擋, 會用新收件人重排。
-- 🔴 不做「寄出當下重讀」view:退貨收回之後 status 不會再變(admin_void_return 只作廢 registered, 20260927010000),
--    信裡也沒有會漂的金額 ⇒ 排信那一刻的內容就是寄出時的真值。
-- 🔴 零 trigger、零改既有物件;view security_invoker = false(以 owner 讀 orders / customers / order_returns, 同族都這樣)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- `supabase/rollbacks/20260927080000-rollback.sql`:DROP view + DROP dedup 函式 + CHECK 縮回 9 值(表裡有新 event_type 的列 ⇒ 拒退)。

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
  IF v_def LIKE '%order_return_received%' THEN
    RAISE EXCEPTION '前置閘二:order_return_received 已在 CHECK 裡 ⇒ 貼過了, 拒重貼';
  END IF;
  -- 釘上一代 9 值都在(20260915150000 那一代);少一個 = 有人動過, 本檔的 IN(...) 會砍掉它
  IF v_def NOT LIKE '%order_partially_cancelled%' OR v_def NOT LIKE '%bank_order_amount_changed%'
     OR v_def NOT LIKE '%order_partially_refunded%' OR v_def NOT LIKE '%order_unpaid_cancelled%'
     OR v_def NOT LIKE '%shipment_tracking_corrected%' OR v_def NOT LIKE '%bank_order_created%'
     OR v_def NOT LIKE '%order_cancelled%' OR v_def NOT LIKE '%order_shipped%'
     OR v_def NOT LIKE '%order_created%' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:CHECK 不是 20260915150000 那 9 值(實得 ' || v_def || ')⇒ 停下人工對齊';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_return_received_email_pending') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.pcm_return_received_email_dedup_key(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘四:view 或 dedup 函式已在 ⇒ 貼過了, 拒重貼';
  END IF;
  IF pg_catalog.to_regclass('public.order_returns') IS NULL
     OR pg_catalog.to_regclass('public.order_return_items') IS NULL THEN
    RAISE EXCEPTION '前置閘五:order_returns / order_return_items 不在 ⇒ 20260927010000 還沒貼';
  END IF;
  -- view 被 service_role 讀時, view 裡呼的函式以【service_role 身分】查 EXECUTE(patterns §3.1)
  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_js_trim_whitespace()', 'EXECUTE') THEN
    RAISE EXCEPTION '前置閘六:pcm_js_trim_whitespace() 不在或 service_role 沒有 EXECUTE ⇒ 本檔的 view 讀起來會 42501';
  END IF;
END
$pre$;

-- ── ① event_type CHECK 第 9 代(10 值)────────────────────────────
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v9
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed',
    'order_partially_cancelled',
    'order_return_received'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v9;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v9 TO email_outbox_event_type_check;

-- ── ② dedup 鍵(新物件 ⇒ 裸 CREATE)──────────────────────────────
CREATE FUNCTION public.pcm_return_received_email_dedup_key(
  p_return_id uuid,
  p_order_id  uuid
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_return_id::text || ':' || p_order_id::text;
$fn$;
COMMENT ON FUNCTION public.pcm_return_received_email_dedup_key(uuid, uuid) IS
  '退貨收回通知的 dedup_key = return_id:order_id(20260927080000)。🔴 綁那一筆退貨不綁單 ⇒ 同一張單退兩次各寄一封。TS 端 composeEvent 同一個算式, 改一邊要改兩邊。';
REVOKE ALL ON FUNCTION public.pcm_return_received_email_dedup_key(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_return_received_email_dedup_key(uuid, uuid)
  FROM anon, authenticated, payment_confirmer;
-- 🔴 service_role 要 EXECUTE:view 裡呼叫的函式以呼叫者身分查 EXECUTE(20260915150000 ② 那段, 拋棄式 PG 實測)。
GRANT EXECUTE ON FUNCTION public.pcm_return_received_email_dedup_key(uuid, uuid) TO service_role;

-- ── ③ 掃描面 ────────────────────────────────────────────────────
CREATE VIEW public.pcm_return_received_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                  AS order_id,
  r.id                  AS return_id,
  o.display_id,
  r.received_at,
  items.items           AS received_items,
  items.received_count  AS received_count,
  o.notification_email,
  c.email               AS customer_email,
  o.order_source
FROM public.order_returns r
JOIN public.orders o ON o.id = r.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
CROSS JOIN LATERAL (
  SELECT
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'title', NULLIF(pg_catalog.btrim(oi.product_snapshot ->> 'title'), ''),
        'quantity', ri.received_quantity
      ) ORDER BY oi.id
    ) AS items,
    pg_catalog.count(*)::integer AS received_count
  FROM public.order_return_items ri
  JOIN public.order_items oi ON oi.id = ri.order_item_id
  WHERE ri.return_id = r.id
    AND ri.received_quantity > 0
) items
WHERE r.status = 'received'
  AND r.received_at IS NOT NULL
  -- 實收全是 0 件 ⇒ 沒有東西可以說「已收到」⇒ 不寄(員工另外聯絡)
  AND items.received_count > 0
  -- 手動單:通知信箱空 = 不寄(Sean 09-10 拍甲;20260907230000 那句逐字)
  AND (o.order_source IS NULL
       OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
       OR NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL)
  AND (NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
       OR NULLIF(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL)
  -- 🔴 anti-join 帶 dedup_key(不只比 order_id + event_type):同一張單的第二筆退貨是另一把鍵, 要能排進來。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_return_received'
           AND e.dedup_key = public.pcm_return_received_email_dedup_key(r.id, o.id)
      );

COMMENT ON VIEW public.pcm_return_received_email_pending IS
  '退貨收回通知的掃描面(20260927080000;Sean 09-27 A3 甲甲甲)。一列 = 一筆 status = received 的退貨。'
  'received_items = 實收數量 > 0 的品項 [{title, quantity}];實收全是 0 的退貨不列(沒有東西可說已收到)。'
  '排除:手動單無通知信箱 / 兩個信箱都空。anti-join 同鍵 order_return_received 的任何一列(不看 status, 排過一次就不再排;這一型不會被 order_ineligible 標成 skipped)。'
  '不帶金額、不帶商品狀況(Sean Q3 甲)。退貨收回後 status 不再變 ⇒ 沒有寄出當下重讀的 view。';

REVOKE ALL ON public.pcm_return_received_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_return_received_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_return_received_email_pending TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(可授權物件 2 = 1 函式 + 1 view)
  v_functions text[] := ARRAY[
    'public.pcm_return_received_email_dedup_key(uuid,uuid)'
  ]::text[];
  v_relations text[] := ARRAY[
    'public.pcm_return_received_email_pending'
  ]::text[];
  r text; v_def text; v_cols text; v_n integer;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%order_return_received%' OR v_def NOT LIKE '%order_partially_cancelled%' THEN
    RAISE EXCEPTION '後置閘一:CHECK 換名後不含 order_return_received(或掉了上一代的值)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.email_outbox'::regclass AND conname = 'email_outbox_event_type_check_v9') THEN
    RAISE EXCEPTION '後置閘二:v9 暫名還在 ⇒ 換名沒成功';
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
  -- 欄位形狀釘死(TS scanner 逐欄讀)
  SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_return_received_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'order_id,return_id,display_id,received_at,received_items,received_count,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '後置閘八:掃描面欄位形狀不對(實得 %)⇒ scanner 會讀錯', v_cols;
  END IF;
  -- 尺是活的:view 以【service_role 身分】跑得動(0 列也算)—— sweeper 就是這個身分。
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_return_received_email_pending;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE '[20260927080000] 後置閘全過;退貨收回通知掃描面 % 列', v_n;
END
$post$;

COMMIT;
