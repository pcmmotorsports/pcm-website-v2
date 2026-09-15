-- 20260915210000_m4b_unpaid_cancel_cutoff_by_cancelled_at.sql
-- 未付款取消信:看【取消時間】不看成立時間(Sean 2026-09-15 拍 Q8 甲 · ⟦b4-CUTOFFWRONGCOLUMN⟧)
-- + 逾時自動取消不算員工取消(codex R1 MF1)+ 告警端同步(codex R1 MF2)。
-- pcm:idempotent: yes
--   理由:兩個 CREATE OR REPLACE, 簽章與欄位不變;重跑寫入相同定義。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════
-- ① Sean Q8 甲:未付款取消信的 cutoff 只看 cancelled_at。TS 那一側(scanner)拿掉 `created_at >= cutoff`(同一顆 commit)。
--    🔬 唯讀正式庫(2026-09-15):照 view 述詞符合而沒寄的未付款取消單【總數 0】⇒ 量測當時不會補寄任何舊信。
-- ② codex R1 MF1:view 的身分判準「曾有 order_cancellations」會把「部分取消 → 之後逾時自動取消」當成員工整單取消
--    (部分取消寫那一列而不寫 cancelled_at;逾時排程之後寫 cancelled_reason='payment_expired', `20260906600000:310-311`)
--    ⇒ 誤寄, 違反 Sean「逾時自動取消不寄」。🔴 那是【今天就在】的洞(cutoff 後成立的這種單原本就會寄),
--    拿掉 created_at 只是把射程擴到舊單。正式庫這種單今天 0 張。
--    修:view 加 `cancelled_reason IS DISTINCT FROM 'payment_expired'`(機器碼, 員工打不進去:20260903093000)。
-- ③ codex R1 MF2:告警 `get_order_unpaid_cancelled_gap_counts` 兩處仍帶 `created_at >= p_cutoff`
--    ⇒ 「cutoff 前成立、之後取消、沒信箱」既不寄也不告警。同一批:兩處拿掉 created_at、加同一條逾時排除。
--
-- ④ codex R2 MF2:告警 RPC 的 outbox 子查詢原本不排除 skip 列(view 會排除)⇒ 排信後兩個信箱被清空
--    (那列落 recipient_stale_at_send)⇒ 不寄也不告警。修:兩處抄 view 的同一份 skip 清單。
-- ⑤ codex R2 MF3:前置閘原本只驗「含某幾個字」⇒ 另一代加了新排除也會通過、然後被本檔整份蓋掉。
--    修:改驗完整定義 md5, 只收「改前那一代」與「本檔目標」;rollback 同理。
--
-- ══ 🛑 已知天花板(codex R2 MF1, Sean 2026-09-15 裁甲:記下來, 另開 plan)═══════════════
-- view 的身分判準「曾有 order_cancellations = 員工取消」本身不精確。本檔排掉了一種機器取消(payment_expired),
-- 還有一種沒排掉:**部分取消過的未付款匯款單, 之後被同購物車的刷卡單取代**
-- (`begin_charge_attempt` 寫 `cancelled_reason='superseded_by_card'`, `20260904050000:202`)⇒ 仍會寄未付款取消信。
-- · 不直接再排除 `superseded_by_card`:員工自由文字只禁 `payment_expired`, 員工打那串字會變漏寄。
-- · `order_cancellations` 沒有「這一列關掉整張單」的欄 ⇒ 正解要改用「員工真的整單取消」的證據。
-- · 正式庫 2026-09-15 唯讀:未付款取消 5 張, `superseded_by_card` 0 張 ⇒ 曝險 0。
-- · plan:`docs/plans/2026-09-15-unpaid-cancel-email-staff-full-cancel-evidence-plan.md`。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- · view:逐字照 `20260907230000:327-390`, 只在最後加一條。欄位不變 ⇒ CREATE OR REPLACE 保留 ACL。
-- · function:逐字照 `20260903070000:71-156`, 兩處 created_at 換成逾時排除。簽章不變 ⇒ ACL / SET 子句一起寫(照抄)。
-- · 前後置閘:權限用【改前快照 vs 改後】比, 不寫死角色清單(本檔不准放寬也不准收緊)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260915210000-rollback.sql`:兩個物件退回上面兩處逐字定義。

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _acl_before ON COMMIT DROP AS
SELECT 'view'::text AS kind, c.relacl::text AS acl FROM pg_catalog.pg_class c WHERE c.oid = 'public.pcm_unpaid_cancelled_email_pending'::regclass
UNION ALL
SELECT 'fn', p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;

DO $pre$
DECLARE v_def text; v_src text;
BEGIN
  -- 🔴 codex R2 MF3:只驗「含某幾個字」擋不住另一代 —— 另一代加了新排除也會通過, 然後被本檔整份蓋掉。
  --    ⇒ 改驗【完整定義指紋】, 只收兩個值:改前那一代(= 正式庫 2026-09-15 唯讀量到的)與本檔目標(重跑)。
  --    🔬 正式庫(PG 170006)與拋棄式 PG(170010)對同一份舊定義量出同一組 md5 ⇒ 指紋跨小版本穩定。
  SELECT pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true)) INTO v_def;
  IF v_def NOT IN ('2f728f34a5551441714d7e217f8f55f9', 'fba321f731525877fe90800f9001e099') THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘一:pcm_unpaid_cancelled_email_pending 定義指紋 ' || v_def
      || ' 不是 20260907230000 那一代也不是本檔目標 ⇒ 有人另開一代, 停下合併(聯集規矩)';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure
     AND p.prosecdef;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘二:get_order_unpaid_cancelled_gap_counts(timestamptz) 不在、或不是 SECURITY DEFINER ⇒ 停下';
  END IF;
  IF v_src NOT IN ('0db807b1f0f8864a1d7c6c3793dfa9e6', 'e7c1cc4796e74ef6da08c6142cfa6cb1') THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:gap_counts 函式指紋 ' || v_src
      || ' 不是 20260903070000 那一代也不是本檔目標 ⇒ 停下合併';
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
DECLARE v_def text; v_src text; v_n integer;
BEGIN
  SELECT pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'payment_expired') = 0 THEN
    RAISE EXCEPTION '後置閘一:view 沒有逾時排除 ⇒ 部分取消後逾時的單仍會誤寄';
  END IF;
  IF pg_catalog.strpos(v_def, 'order_cancellations') = 0 OR pg_catalog.strpos(v_def, 'recipient_stale_at_send') = 0 THEN
    RAISE EXCEPTION '後置閘二:view 掉了原本的述詞';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure;
  -- 註解裡的刪除線也含那串字 ⇒ 先剝掉行註解再比
  v_src := pg_catalog.regexp_replace(v_src, '--[^\n]*', '', 'g');
  IF pg_catalog.strpos(v_src, 'created_at >= p_cutoff') <> 0 THEN
    RAISE EXCEPTION '後置閘三:gap_counts 仍帶 created_at >= p_cutoff ⇒ 告警與寄信兩端口徑不一';
  END IF;
  SELECT (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, 'payment_expired', ''))) / pg_catalog.length('payment_expired') INTO v_n;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '後置閘四:gap_counts 的逾時排除應出現 2 次(pending / no_recipient), 實得 %', v_n;
  END IF;
  IF EXISTS (
    SELECT 1 FROM _acl_before b
     WHERE b.acl IS DISTINCT FROM (CASE b.kind
             WHEN 'view' THEN (SELECT c.relacl::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.pcm_unpaid_cancelled_email_pending'::regclass)
             ELSE (SELECT p.proacl::text FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_order_unpaid_cancelled_gap_counts(timestamptz)'::regprocedure)
           END)) THEN
    RAISE EXCEPTION '後置閘五:權限與改前不同 ⇒ 本檔不准放寬也不准收緊';
  END IF;
  -- 🔴 invoker view 用【呼叫者】的權限跑 body 裡的函式(scripts/invoker-view-execute-gate.py 的病例)
  --    ⇒ 查這支 view 的 service_role(scanner)必須 EXECUTE 得到 pcm_js_trim_whitespace()。
  --    斷言是量到的結果, 不是 GRANT(本檔不動它的權限)。🔬 正式庫 2026-09-15 唯讀:t。
  IF NOT pg_catalog.has_function_privilege('service_role',
       'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘六:service_role 不能 EXECUTE pcm_js_trim_whitespace() ⇒ scanner 查 invoker view 會 42501';
  END IF;
  RAISE NOTICE '[20260915210000] 後置閘全過;未付款取消信看取消時間、逾時自動取消不算, 告警端同步';
END
$post$;

COMMIT;
