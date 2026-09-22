-- 20260922110000_m4b_webhook_manual_review_health.sql —— 付款通知轉人工:讓後台首頁與每日提醒看得到
--
-- ⟦db-WEBHOOKMANUALBACKLOG⟧ plan `docs/plans/2026-09-22-webhook-manual-backlog-alert-plan.md` 第 3.1 節(Sean 2026-09-22 批准)。
-- 🛑 未貼(寫好不貼;貼板由 Sean 處理)。
-- pcm:idempotent: no
--   理由:裸 CREATE FUNCTION(新物件)⇒ 重跑會撞「已存在」;前置閘先擋, 訊息講清楚。
--
-- ══ 為什麼 ═════════════════════════════════════════════════════════════
-- 付款通知連續查 8 次查不到結果就標 `needs_manual_review = true` 停止自動處理,
-- 而現有的付款異常提醒只看 `payment_charge_attempts`, 不看這張表 ⇒ 沒有任何人會知道。
-- 告警器用 `payment_confirmer` 連線, 而這張表對它表層全零權限(20260613120000 的 ACL 斷言)
-- ⇒ 不開表, 用一支 definer 函式把投影釘死(照 `get_settle_retry_gaveup_health` 20260905250000 的形狀)。
--
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- 新函式 `public.get_webhook_manual_review_health()` → jsonb, 無參數(改門檻不必改簽章):
--   manual_count        needs_manual_review = true AND processed = false 的筆數(plan 2.4「待人工確認」)
--   oldest_received_at  其中最早的 received_at(門檻計時起點, plan 2.3)
--   sample_display_ids  最多 5 筆, 依 received_at 排序, 對得到訂單就給 display_id, 對不到給 null
--   total_count         全表筆數(分母:分辨「0 筆待處理」與「表是空的或讀錯」)
-- 不回金額(告警契約:可帶單號, 不帶金額 —— packages/domain/src/payment/anomaly-alert.ts 檔頭)。
--
-- ══ 權限 ═══════════════════════════════════════════════════════════════
-- 收乾淨後具名給兩個角色:payment_confirmer(告警器)、service_role(後台首頁)。
-- service_role 本來就能 SELECT 這張表, 多給這支 EXECUTE 不擴大它看得到的資料。
--
-- ══ ROLLBACK ══════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
--   🔴 rollback 是人貼進 psql 跑的, 而 psql 預設沒有 lock_timeout ⇒ 卡鎖時會無限等。
-- supabase/rollbacks/20260922110000-rollback.sql = DROP FUNCTION。函式只讀不寫, 刪除不影響任何資料。
--   🔴 順序:先 revert 程式(告警器那一段 + 後台首頁那一行)再跑 rollback;
--      反過來的話告警器會落 Unknown(不會失敗), 後台那一行會顯示「無法載入」。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.payment_webhook_events') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.payment_webhook_events 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'payment_webhook_events'
                    AND column_name = 'needs_manual_review') THEN
    RAISE EXCEPTION '前置閘②:payment_webhook_events.needs_manual_review 不存在 ⇒ 20260615120000 還沒貼';
  END IF;
  -- 🔴 用 CREATE FUNCTION 不用 CREATE OR REPLACE:同名函式已存在時要停下, 不要靜靜蓋掉(pattern §3.2)。
  IF pg_catalog.to_regprocedure('public.get_webhook_manual_review_health()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:get_webhook_manual_review_health 已存在 ⇒ 本支貼過了, 停下';
  END IF;
  IF pg_catalog.to_regrole('payment_confirmer') IS NULL OR pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 payment_confirmer 或 service_role 角色';
  END IF;
END
$pre$;

-- ── 函式 ────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.get_webhook_manual_review_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 每個 key 獨佔一行、逗號結尾:照同族函式的格式, `anomaly-alert-key-contract.test.ts` 靠這個形狀抽 key。
    'manual_count',
    (SELECT pg_catalog.count(*) FROM public.payment_webhook_events e
      WHERE e.needs_manual_review AND NOT e.processed),
    'oldest_received_at',
    (SELECT pg_catalog.min(e.received_at) FROM public.payment_webhook_events e
      WHERE e.needs_manual_review AND NOT e.processed),
    'sample_display_ids',
    -- 對不到訂單時是 JSON null(上線前的測試資料就對不到), 收信的人才分得出「查無訂單」。
    -- 排序帶主鍵 rec_trade_id:收到時間相同時, 入選的 5 筆與順序才固定。
    -- ponytail: 沒有專用索引(orders.id::text 比對、待人工列依收到時間排序);正式庫 2026-09-22 全表 52 筆。
    --           表長到上萬筆、告警變慢時, 先 EXPLAIN ANALYZE 再補部分索引。
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.display_id ORDER BY x.received_at, x.rec_trade_id), '[]'::jsonb)
       FROM (SELECT o.display_id, e.received_at, e.rec_trade_id
               FROM public.payment_webhook_events e
               LEFT JOIN public.orders o ON o.id::text = e.order_number
              WHERE e.needs_manual_review AND NOT e.processed
              ORDER BY e.received_at, e.rec_trade_id
              LIMIT 5) x),
    'total_count',
    (SELECT pg_catalog.count(*) FROM public.payment_webhook_events)
  );
$fn$;

REVOKE ALL ON FUNCTION public.get_webhook_manual_review_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_webhook_manual_review_health() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_webhook_manual_review_health() FROM service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_webhook_manual_review_health() TO payment_confirmer;  -- 告警器
GRANT EXECUTE ON FUNCTION public.get_webhook_manual_review_health() TO service_role;       -- 後台首頁

COMMENT ON FUNCTION public.get_webhook_manual_review_health() IS
  '⟦db-WEBHOOKMANUALBACKLOG⟧(20260922110000):付款通知「需人工處理且未處理」的筆數、最早收到時間、最多 5 個訂單單號與全表筆數。'
  '「人工結案」= 保留 needs_manual_review = true、把 processed 設為 true ⇒ 不再計入。不回金額。';

-- ── 事後斷言 ────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態檢查 ③ 數這個陣列;可授權物件 1 = 1 新函式)
  v_functions text[] := ARRAY['public.get_webhook_manual_review_health()']::text[];
  r        text := v_functions[1];
  v_leak   text[] := ARRAY[]::text[];
  v_role   text;
  v_owner  oid;
  v_j      jsonb;
BEGIN
  IF pg_catalog.to_regprocedure(r) IS NULL THEN
    RAISE EXCEPTION '斷言a:函式沒建出來';
  END IF;
  IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r)) THEN
    RAISE EXCEPTION '斷言b0:proacl 是 NULL ⇒ 預設 PUBLIC 可執行, REVOKE 沒生效';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    IF pg_catalog.has_function_privilege(v_role, r, 'EXECUTE') THEN
      v_leak := v_leak || v_role;
    END IF;
  END LOOP;
  IF pg_catalog.array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION '斷言b:這些角色不該叫得動 ⇒ %', pg_catalog.array_to_string(v_leak, ', ');
  END IF;
  -- 🟢 正對照:兩個該給的角色必須叫得動(少了這格, 一個恆 false 的判斷會讓上面那格永遠通過)。
  IF NOT pg_catalog.has_function_privilege('payment_confirmer', r, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言c:payment_confirmer 或 service_role 叫不動 ⇒ 告警器 / 後台首頁拿不到訊號';
  END IF;
  -- 角色切換路徑(pattern §3.5):anon / authenticated 能切換成的任何角色都不得有 EXECUTE(含繼承)。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles x
                WHERE pg_catalog.pg_has_role(v_role, x.oid, 'SET')
                  AND pg_catalog.has_function_privilege(x.oid, pg_catalog.to_regprocedure(r), 'EXECUTE')) THEN
      RAISE EXCEPTION '斷言d:% 能切換成一個叫得動本函式的角色', v_role;
    END IF;
  END LOOP;
  -- owner 路徑另查:owner 不是這四個應用角色, 而且 anon / authenticated 切換不到 owner。
  SELECT p.proowner INTO v_owner FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
  IF pg_catalog.pg_get_userbyid(v_owner) IN ('anon', 'authenticated', 'service_role', 'payment_confirmer')
     OR pg_catalog.pg_has_role('anon', v_owner, 'SET') OR pg_catalog.pg_has_role('authenticated', v_owner, 'SET') THEN
    RAISE EXCEPTION '斷言e:函式 owner(%)是應用角色, 或 anon / authenticated 切換得到它', pg_catalog.pg_get_userbyid(v_owner);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r)
                  AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION '斷言f:不是 SECURITY DEFINER 或 search_path 不是空字串';
  END IF;
  -- 真的叫一次, 四個 key 都在
  SELECT public.get_webhook_manual_review_health() INTO v_j;
  IF v_j IS NULL OR NOT (v_j ? 'manual_count' AND v_j ? 'oldest_received_at'
                         AND v_j ? 'sample_display_ids' AND v_j ? 'total_count') THEN
    RAISE EXCEPTION '斷言g:回傳少了 key ⇒ %', coalesce(v_j::text, '(NULL)');
  END IF;
  RAISE NOTICE '20260922110000 貼好了:get_webhook_manual_review_health() ⇒ %', v_j::text;
END
$post$;

COMMIT;
