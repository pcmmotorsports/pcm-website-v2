-- 20260916030000 · 未付款取消信:「員工取消」的身分判準改看【員工真的整單取消】的稽核列
-- pcm:idempotent: yes
--   理由:兩個 CREATE OR REPLACE, 簽章與欄位不變;前置閘收「改前那一代」與「本檔目標」兩個指紋, 重跑寫入相同定義。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════
-- plan:`docs/plans/2026-09-15-unpaid-cancel-email-staff-full-cancel-evidence-plan.md`(Sean 2026-09-15「依照建議」= 甲)。
-- 舊判準「曾有 order_cancellations = 員工取消」:部分取消也寫那一列 ⇒ 「員工先部分取消、之後整張被【系統】取消」
-- 會被當成員工取消 ⇒ 誤寄未付款取消信。20260915210000 排掉了逾時(payment_expired)那一種;
-- 還剩「被同購物車的刷卡單取代」(`cancelled_reason='superseded_by_card'`, 20260904050000 / 20260906700000)。
-- 不再補排除字:員工自由文字只禁 `payment_expired`(20260903093000)⇒ 員工打出 superseded_by_card 會變漏寄。
--
-- ══ 證據甲:admin_audit_log 的整單取消列(開工前唯讀核過)═══════════════════
-- · 寫的人:只有 `admin_cancel_order`(repo 全 migrations 對 order_cancellations 的真 INSERT 全是它的歷代)。
--   每一代都在【同一個交易】寫 action='order.cancel'、target='order:<id>', 並以 ROW_COUNT 守恰 1 列(寫不進去整筆回滾)。
--   a8a2(20260805100000)起 after 帶 `closed`(整張關掉 = true, 部分取消 = false);第一代 a8a1 沒有這個鍵。
-- · 不寫的人:逾時自動取消、被刷卡取代、刷卡全退自動取消(20260914060000 / 20260916010000)都不寫這張表;
--   `admin_mark_order_cancelled` 寫的是 'order.mark_cancelled', 而且只收已全額退款的單(碰不到 unpaid)。
-- · 🔬 正式庫 2026-09-15 唯讀(~/pcm-mailbox/unpaid-cancel-evidence/01-audit-format-readonly.out):
--   order.cancel 4 列全部 closed=true;沒有缺 closed 鍵的列;unpaid 且已取消的單 5 張 ——
--   員工取消 4 張新舊判準同為「寄」, 逾時 1 張新舊同為「不寄」⇒ 本檔上線當下【零張】改變結果。
-- · 🔬 拋棄式 PG(正式 schema dump + 178–183):現行 admin_cancel_order 1 支, 帶 'order.cancel' / 'closed', v_closed / ROW_COUNT 守。
-- · 比 `after ->> 'closed' = 'true'` 字面:沒有 closed 鍵(a8a1)⇒ 不算(正式庫這種列 0 筆)。
-- · 逾時排除那一條(20260915210000)留著當第二道網。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- · view 與告警 RPC 逐字照 20260915210000, 只把三處 `EXISTS (… order_cancellations …)` 換成整單取消稽核列(同一句)。
-- · TS scanner 不動(它只讀 view)。
-- · invoker view 以呼叫者(service_role)讀 admin_audit_log ⇒ 後置閘斷言 service_role 有 SELECT 且繞得過 RLS。
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260916030000-rollback.sql`:兩個物件退回 20260915210000 的逐字定義。

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
SELECT 'view'::text AS kind, c.relacl::text AS acl FROM pg_catalog.pg_class c WHERE c.oid = 'public.pcm_unpaid_cancelled_email_pending'::regclass
UNION ALL
SELECT 'fn', p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;

DO $pre$
DECLARE v_def text; v_src text; v_cancel text; v_n integer;
BEGIN
  -- 只收兩個完整定義指紋:改前那一代(20260915210000)與本檔目標(重跑)。其他 ⇒ 有人另開一代, 停下合併(聯集規矩)。
  SELECT pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true)) INTO v_def;
  IF v_def NOT IN ('fba321f731525877fe90800f9001e099', 'bc74e696b28afbb91bd7078545e9b0a5') THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘一:pcm_unpaid_cancelled_email_pending 定義指紋 ' || v_def
      || ' 不是 20260915210000 那一代也不是本檔目標 ⇒ 停下合併';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure
     AND p.prosecdef;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘二:get_order_unpaid_cancelled_gap_counts(timestamptz) 不在、或不是 SECURITY DEFINER ⇒ 停下';
  END IF;
  IF v_src NOT IN ('e7c1cc4796e74ef6da08c6142cfa6cb1', '1a4042834023367339e5cb656b5a3238') THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:gap_counts 函式指紋 ' || v_src
      || ' 不是 20260915210000 那一代也不是本檔目標 ⇒ 停下合併';
  END IF;
  -- 證據的前提:員工整單取消那支 RPC 仍然只有一支, 而且仍在同交易寫 order.cancel + closed + 筆數守。
  --   任一不成立 ⇒ 換判準會讓員工取消的客人收不到信 ⇒ 停下。
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
   WHERE p.proname = 'admin_cancel_order' AND p.pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘四:admin_cancel_order 有 % 支(期望 1)⇒ 證據甲的前提要重核', v_n;
  END IF;
  SELECT p.prosrc INTO v_cancel FROM pg_catalog.pg_proc p
   WHERE p.proname = 'admin_cancel_order' AND p.pronamespace = 'public'::regnamespace;
  IF pg_catalog.strpos(v_cancel, '''order.cancel''') = 0
     OR pg_catalog.strpos(v_cancel, '''closed'', v_closed') = 0
     OR pg_catalog.strpos(v_cancel, '''order:'' || p_order_id::text') = 0
     OR pg_catalog.strpos(v_cancel, 'GET DIAGNOSTICS v_bad = ROW_COUNT') = 0 THEN
    RAISE EXCEPTION '前置閘五:admin_cancel_order 不再寫 order.cancel / closed / target / 筆數守其中之一 ⇒ 證據甲的前提不成立, 停下';
  END IF;
END
$pre$;

-- ── ① view ──
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
  -- 🔴🔴 20260916030000(plan 2026-09-15 未付款取消信「員工真的整單取消」證據, Sean 甲):
  --    身分判準改看稽核列:admin_cancel_order 在同一個交易寫 action='order.cancel'、after.closed
  --    (整單關掉 = true;部分取消 = false;稽核寫不進去整筆回滾)。
  --    逾時自動取消 / 被刷卡取代(superseded_by_card)/ 刷卡全退自動取消【都不寫】這張表。
  --    ⛔ ~~曾有 order_cancellations~~:部分取消也寫那一列 ⇒ 之後被系統取消的單會被當成員工取消 ⇒ 誤寄。
  --    ⚠️ 比 'true' 字面:第一代 a8a1 的 after 沒有 closed 鍵, 正式庫 2026-09-15 唯讀這種列 0 筆;沒有鍵 ⇒ 不算。
  AND EXISTS (
        SELECT 1 FROM public.admin_audit_log a
         WHERE a.action = 'order.cancel'
           AND a.target = 'order:' || o.id::text
           AND a.after ->> 'closed' = 'true')
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
  --    (20260916030000 起身分判準已改看整單取消稽核列 ⇒ 這條留作第二道網;下面是 20260915210000 當時的理由)
  --    當時的身分判準只問「曾有 order_cancellations」, 而【部分取消】也會寫那一列(不寫 cancelled_at)
  --    ⇒ 「部分取消 → 之後逾時自動取消(cancelled_reason='payment_expired')」會被當成員工整單取消 ⇒ 誤寄。
  --    ✅ `payment_expired` 是機器碼, 員工打不進去(20260903093000 保留字閘)⇒ 用它排除是安全的。
  --    ⚠️ 原本 TS 那一側的 `created_at >= cutoff` 只替「cutoff 前成立」的這種單擋住;cutoff 後成立的同一種單原本就會誤寄。
  AND o.cancelled_reason IS DISTINCT FROM 'payment_expired';

-- ── ② function ──
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
DECLARE v_def text; v_src text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true)) INTO v_def;
  IF v_def <> 'bc74e696b28afbb91bd7078545e9b0a5' THEN
    RAISE EXCEPTION '後置閘一:view 定義指紋 % 不是本檔目標', v_def;
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;
  IF v_src <> '1a4042834023367339e5cb656b5a3238' THEN
    RAISE EXCEPTION '後置閘二:gap_counts 函式指紋 % 不是本檔目標', v_src;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure
                    AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '後置閘三:gap_counts 不是 SECURITY DEFINER + search_path=空字串';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _acl_before b
     WHERE b.acl IS DISTINCT FROM (CASE b.kind
             WHEN 'view' THEN (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.pcm_unpaid_cancelled_email_pending'::regclass)
             ELSE (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure)
           END)) THEN
    RAISE EXCEPTION '%', '後置閘四:權限與改前不同 ⇒ 本檔不准放寬也不准收緊';
  END IF;
  -- invoker view 用【呼叫者】的權限跑:scanner(service_role)要讀得到 admin_audit_log、EXECUTE 得到 pcm_js_trim_whitespace()。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.admin_audit_log', 'SELECT') THEN
    RAISE EXCEPTION '後置閘五:service_role 不能 SELECT admin_audit_log ⇒ scanner 查 view 會 42501';
  END IF;
  -- admin_audit_log 開著 RLS ⇒ service_role 要嘛 BYPASSRLS, 要嘛有一條給它的 SELECT policy;都沒有 ⇒ 讀到 0 列 ⇒ 靜默不寄
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role' AND r.rolbypassrls)
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy pol
                      WHERE pol.polrelid = 'public.admin_audit_log'::regclass
                        AND pol.polcmd IN ('r', '*')
                        AND ((SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role') = ANY (pol.polroles)
                             OR 0::oid = ANY (pol.polroles))) THEN  -- TO PUBLIC 的 policy 存成 polroles={0}
    RAISE EXCEPTION '後置閘六:service_role 既不 BYPASSRLS 也沒有 admin_audit_log 的 SELECT policy ⇒ view 會讀到 0 列 ⇒ 靜默不寄';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘七:service_role 不能 EXECUTE pcm_js_trim_whitespace() ⇒ scanner 查 invoker view 會 42501';
  END IF;
  RAISE NOTICE '[20260916030000] 後置閘全過;未付款取消信與告警都改看員工整單取消稽核列';
END
$post$;

COMMIT;
