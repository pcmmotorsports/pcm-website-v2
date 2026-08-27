-- ============================================================
-- M-4b E10 第 1 批 · A8a1:admin_cancel_order 整單取消核心(首建)
-- ============================================================
-- 真權威:docs/specs/2026-08-04-e10-a8a1-full-cancel-plan.md(v2;關卡1 R1 21MF 全折、R3 PASS)
--   + master plan row 36(:383)+ §5.1b/§5.1d + A7 債①③⑥⑦⑧。鐵則 12①③。
-- 依賴:20260730130000(A7 兩取消表)、20260804120000(A8c1)、20260804150000(A8c2)——
--   前置閘 pin 部署鏈三支;20260712210000(admin_audit_log)、A1 summary CHECK(第二道網)。
--
-- 🔴 設計(plan §3.2 十步):隔離閘 P8C01 → 輸入驗(七值映射=§5.1d 可測合約;other 必填
--   detail、判空白用 A7 明列碼位,入庫/hash/對客=btrim 原文不剝內部字元)→ orders FOR UPDATE
--   (第一觸表;§5.0 鎖序合約)→ 冪等格(驗全產物集+現況不變式:hash 欄+actor+cancelled_at+
--   cancelled_reason+header reason 欄位對輸入+items 全品項全額+payment_status=unpaid+零在途
--   attempts+audit 在場;任一不符=fail-loud RAISE、不回成功;關卡2 折入)→ 已取消守門
--   (異鍵/既有 header;部分取消歷史單的整單收尾=A8a2)→ actor 存在且 is_active(FK 只擋
--   不存在;A7 債⑥)→ 允許集合(unpaid+attempts 全終態 failed 或零筆;row 36)→ 品項守門
--   (items NKU 按 id 序=排序契約;零品項單拒;每品項 Σreceipts=0 且零 cancellation_items;
--   讀真相表、摘要 CHECK=第二道網)→ 寫入(header→items 全額按 id 序+筆數守=v_cnt→
--   orders 對客欄+row_count 守→audit 'order.cancel' 快照形+筆數守)→ 回傳
--   {cancelled, cancellation_id, idempotent}。
-- 🔴 零全函式 EXCEPTION handler:同鍵併發被 FU 序列化 ⇒ 後到走冪等格;(order_id,key) UNIQUE=
--   不可達 backstop、誠實認列不設格;任何 23505=真異常 fail-loud(plan §3.2-10)。
-- 🔴 鎖面:orders FU → order_items NKU(A4a 主序 orders→proc→order_items 相容)→ 讀真相
--   (無鎖)→ 寫入;A4a trigger 同交易重入 NKU=已持有、無自鎖(關卡1 已核可)。
-- 🔴 訊息紀律:業務拒絕=單一通用訊息(不洩存在性/狀態);輸入類=具體訊息(server 端參數)。
--
-- ⛔ apply 停點 + 同批鐵律:與 A8a2 同批 apply(master plan row 37;本片 commit 後不單獨
--   apply、標 ⛔ 等 A8a2 齊)。apply 前置檢查+read-back=plan §6。
-- 動手前模擬:剝殼後拋棄庫單交易通過(harness 常設格)。
-- Rollback:docs/runbooks/2026-07-30-a7-rollback.md v2 §0(本函式=其步 1 DROP、overload 枚舉閘)。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:begin=A8c1 / confirm=A8c2(部署鏈)+ 本函式零 overload(首建)
--       + A7-t/A4a trigger 面 pin(關卡2 折入:presence/truncate/recompute 缺失或 disabled
--       ⇒ 零品項 header 或摘要第二道網靜默失效,本片守門的「不倚賴」前提破)──
DO $$
DECLARE v text; n integer;
BEGIN
  v := md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure));
  IF v <> 'f621a56231e20f7f0b2618b40ac1276d' THEN
    RAISE EXCEPTION 'A8a1 前置閘:begin_charge_attempt 非 A8c1 新版(md5=%)——部署鏈:先 apply 20260804120000', v;
  END IF;
  v := md5(pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure));
  IF v <> '6423848f965176c8a0c02917b8be9f52' THEN
    RAISE EXCEPTION 'A8a1 前置閘:confirm_order_payment 非 A8c2 新版(md5=%)——部署鏈:先 apply 20260804150000', v;
  END IF;
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF n <> 0 THEN
    RAISE EXCEPTION 'A8a1 前置閘:admin_cancel_order 已存在 % 個 overload(預期首建=0);停下人工對齊', n;
  END IF;
  -- (表, trigger 名, 函式名) 三元組枚舉(codex R2:只數名稱抓不到錯綁表/錯綁函式)
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND (t.tgrelid, t.tgname, p.proname) IN (
       ('public.order_cancellations'::regclass,      'order_cancellations_block_truncate_bt',         'pcm_cancellation_ledger_block_truncate'),
       ('public.order_cancellations'::regclass,      'order_cancellations_items_presence_ac',         'pcm_assert_cancellation_has_items'),
       ('public.order_cancellation_items'::regclass, 'order_cancellation_items_block_truncate_bt',    'pcm_cancellation_ledger_block_truncate'),
       ('public.order_cancellation_items'::regclass, 'order_cancellation_items_presence_ac',          'pcm_assert_cancellation_has_items'),
       ('public.order_cancellation_items'::regclass, 'order_cancellation_items_summary_recompute_ac', 'pcm_a4a_cancellation_summary_recompute'));
  IF n <> 5 THEN
    RAISE EXCEPTION 'A8a1 前置閘:A7-t/A4a trigger 三元組=%/5(缺失/disabled/錯綁);停下人工對齊', n;
  END IF;
  -- helper functiondef md5 pin(no-op 替身抓不到綁定、抓得到本體;同 begin/confirm 部署鏈哲學,不符=安全 false-stop)
  v := md5(pg_get_functiondef('public.pcm_assert_cancellation_has_items()'::regprocedure));
  IF v <> '834f8887a9c496b6a067b36a1b064aa0' THEN
    RAISE EXCEPTION 'A8a1 前置閘:pcm_assert_cancellation_has_items 定義漂移(md5=%);停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.pcm_cancellation_ledger_block_truncate()'::regprocedure));
  IF v <> '883b4cfb51a3813a77e7d4662b94d9e8' THEN
    RAISE EXCEPTION 'A8a1 前置閘:pcm_cancellation_ledger_block_truncate 定義漂移(md5=%);停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.pcm_a4a_cancellation_summary_recompute()'::regprocedure));
  IF v <> '90ced9bedc22ec68cfad770466f03178' THEN
    RAISE EXCEPTION 'A8a1 前置閘:pcm_a4a_cancellation_summary_recompute 定義漂移(md5=%);停下人工對齊', v;
  END IF;
END
$$;


-- ── 1. admin_cancel_order 首建(plan §3.2 十步)──
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_existing    record;
  v_detail      text;
  v_hash        text;
  v_reason_txt  text;
  v_cid         uuid;
  v_bad         integer;
  v_cnt         integer;
  v_generic_msg constant text := 'admin_cancel_order: 取消失敗';
BEGIN
  -- 步1 隔離閘(A8c 家族同款;RR 等鎖醒來舊快照會漏看真相表)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_cancel_order: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(輸入類=具體訊息;§5.1d 七值映射=可測合約)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 冪等鍵缺失';
  END IF;
  v_reason_txt := CASE p_reason_code
    WHEN 'customer_request' THEN '依您要求取消'
    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
    WHEN 'price_change'     THEN '依您要求取消'
    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
    WHEN 'internal_error'   THEN '依您要求取消'
    WHEN 'other'            THEN NULL
    ELSE NULL END;
  IF v_reason_txt IS NULL AND p_reason_code IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'admin_cancel_order: 未知取消原因碼';
  END IF;
  v_detail := pg_catalog.btrim(p_reason_detail);
  IF v_detail = '' THEN v_detail := NULL; END IF;
  IF p_reason_code = 'other' THEN
    -- 判空白=A7 CHECK 同款明列碼位(僅判定;入庫/hash/對客=btrim 原文,不剝內部字元)
    IF v_detail IS NULL OR pg_catalog.translate(v_detail,
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\00AD\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\2028\2029\202F\205F\2060\2800\3000\3164\FEFF',
         '') = '' THEN
      RAISE EXCEPTION 'admin_cancel_order: other 需填取消說明';
    END IF;
    v_reason_txt := v_detail;
  ELSIF v_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 非 other 不得填說明';
  END IF;

  -- 步3 orders FOR UPDATE(第一觸表動作;§5.0 鎖序合約)
  SELECT id, payment_status, cancelled_at, cancelled_reason INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'a8a1:v1:' || p_order_id::text || ':' || p_reason_code || ':' || coalesce(v_detail,'') || ':full',
    'UTF8')), 'hex');

  -- 步4 冪等格(驗全產物集+現況不變式;任一不符=fail-loud;memory 冪等查驗鐵律)
  SELECT id, payload_hash, actor, reason_code, reason_detail INTO v_existing
    FROM public.order_cancellations
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- hash 欄自身竄改由這裡抓(hash=輸入導出;header 欄位竄改由下方不變式抓)
    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    SELECT count(*) INTO v_bad FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                        WHERE ci.cancellation_id = v_existing.id
                          AND ci.order_item_id = oi.id
                          AND ci.cancelled_quantity = oi.quantity);
    -- 不變式全集:對客欄/付款態/header 欄位對輸入/items 全額/零在途金流/audit 在場
    IF v_order.cancelled_at IS NULL
       OR v_order.cancelled_reason IS DISTINCT FROM v_reason_txt
       OR v_order.payment_status <> 'unpaid'::public.payment_status
       OR v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.reason_detail IS DISTINCT FROM (CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END)
       OR v_bad <> 0
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts pa
                   WHERE pa.order_id = p_order_id AND pa.status <> 'failed')
       OR NOT EXISTS (SELECT 1 FROM public.admin_audit_log g
                       WHERE g.request_id = p_idempotency_key::text
                         AND g.action = 'order.cancel'
                         AND g.target = 'order:' || p_order_id::text) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('cancelled', true,
      'cancellation_id', v_existing.id, 'idempotent', true);
  END IF;

  -- 步5 已取消守門(異鍵/既有 header;部分取消歷史單的整單收尾=A8a2)
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步6 actor 存在且啟用(FK 只擋不存在;A7 債⑥)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步7 允許集合(unpaid + attempts 全終態 failed 或零筆;row 36)
  IF v_order.payment_status <> 'unpaid'::public.payment_status
     OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                 WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步8 品項守門(鎖 items NKU 按 id 序=排序契約;守門讀真相表,摘要 CHECK=第二道網)
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
   ORDER BY oi.id
   FOR NO KEY UPDATE;
  SELECT count(*) INTO v_cnt FROM public.order_items x WHERE x.order_id = p_order_id;
  -- 零品項單 fail-closed(row 36「零明細 header」;A7-t presence 是 DEFERRED 且訊息非通用,不倚賴)
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  SELECT count(*) INTO v_bad FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND (EXISTS (SELECT 1 FROM public.order_item_procurement p
                   JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                  WHERE p.order_item_id = oi.id AND r.quantity > 0)
          OR EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                      WHERE ci.order_item_id = oi.id));
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步9 寫入(同交易;items 按 order_item_id 序=排序契約)
  INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)
  VALUES (p_order_id, p_actor, p_idempotency_key, p_reason_code,
          CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END, v_hash)
  RETURNING id INTO v_cid;
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  SELECT v_cid, p_order_id, oi.id, oi.quantity
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
   ORDER BY oi.id;
  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充整單;必=v_cnt 全額
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_cnt THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  UPDATE public.orders
     SET cancelled_at = pg_catalog.now(),
         cancelled_reason = v_reason_txt,
         updated_at = pg_catalog.now()
   WHERE id = p_order_id;
  -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', pg_catalog.now(), 'cancellation_id', v_cid),
          p_reason_code, 'admin');
  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('cancelled', true, 'cancellation_id', v_cid, 'idempotent', false);
END;
$fn$;

COMMENT ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text) IS
  'M-4b E10-A8a1 整單取消核心(SECURITY DEFINER、search_path='''';service_role only)。十步:隔離閘(非 READ COMMITTED 一律 P8C01)→ 輸入驗(七值映射 §5.1d 逐字;other 必填說明、非 other 禁填;判空白=A7 明列碼位、入庫/hash/對客=btrim 原文)→ orders FOR UPDATE(第一觸表)→ 冪等格(同 (order_id,key):hash 欄+actor+cancelled_at 非空+cancelled_reason 符+header reason 欄位對輸入+items 全品項全額+payment_status=unpaid+零在途 attempts+audit 在場,全符才回 idempotent:true;任一不符 fail-loud RAISE)→ 已取消守門(cancelled_at 或任一 header ⇒ 拒;部分取消歷史單的整單收尾=A8a2)→ actor 存在且 is_active → 允許集合(unpaid + attempts 全終態 failed 或零筆)→ 品項守門(items FOR NO KEY UPDATE 按 id 序;零品項單拒;每品項 Σreceipts=0 且零 cancellation_items;讀真相表、摘要 CHECK=第二道網)→ 同交易寫 header + items(全額按 order_item_id 序、筆數守=品項數)+ orders 對客欄(row_count 守)+ audit(action=order.cancel、request_id=冪等鍵、before/after=payment_status/cancelled_at 快照+cancellation_id、source_app=admin、筆數守)。零全函式 EXCEPTION handler((order_id,key) UNIQUE=不可達 backstop;23505=真異常 fail-loud)。業務拒絕=通用訊息;輸入類=具體訊息。零經銷價/cost。';

-- ── 2. ACL:service_role only(先拔 PUBLIC 預設 EXECUTE)──
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text) TO service_role;


-- ── 3. 結構 assert:定義唯一+碼錨+順序錨+ORDER BY 結構錨(M6)+ACL 窮舉+有效權閘+SECDEF 面 ──
DO $$
DECLARE v_def text; v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A8a1 結構 assert:overload 數=%(預期恰 1);拒繼續', v_n;
  END IF;
  v_def := pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text)'::regprocedure);

  -- 碼錨(code-exact;完整條件字面防反轉)
  IF position('pg_catalog.current_setting(''transaction_isolation'') <> ''read committed''' in v_def) = 0
     OR position('USING ERRCODE = ''P8C01''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:隔離閘條件字面缺失;拒繼續';
  END IF;
  IF position('冪等鍵缺失' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:key NULL 輸入驗缺失;拒繼續';
  END IF;
  IF position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:orders FOR UPDATE(第一觸表)缺失;拒繼續';
  END IF;
  IF position('''a8a1:v1:''' in v_def) = 0 OR position(''':full''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:hash 域前綴/尾綴字面缺失;拒繼續';
  END IF;
  IF position('WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:冪等格查詢字面缺失;拒繼續';
  END IF;
  IF position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:已取消守門(異鍵 header)字面缺失;拒繼續';
  END IF;
  IF position('WHERE s.id = p_actor AND s.is_active' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:actor is_active 守門字面缺失;拒繼續';
  END IF;
  IF position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:允許集合 attempts 條件字面缺失;拒繼續';
  END IF;
  IF position('WHERE p.order_item_id = oi.id AND r.quantity > 0' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:品項守門 receipts 條件字面缺失;拒繼續';
  END IF;
  IF position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:header 寫入字面缺失;拒繼續';
  END IF;
  IF position('INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)' in v_def) = 0
     OR position('''order.cancel''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:audit 寫入(快照形+source_app)字面缺失;拒繼續';
  END IF;
  IF position('GET DIAGNOSTICS v_bad = ROW_COUNT;' in v_def) = 0
     OR position('-- row_count 守(PF-C 同款)' in v_def) = 0
     OR position('-- audit 筆數守' in v_def) = 0
     OR position('-- items 筆數守' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:三道筆數/row_count 守任一缺失(註解錨逐一驗);拒繼續';
  END IF;
  IF position('IF v_cnt = 0 THEN' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:零品項單守門缺失;拒繼續';
  END IF;
  IF position('IF v_bad <> v_cnt THEN' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 碼錨:items 筆數守缺失;拒繼續';
  END IF;
  -- ORDER BY 結構錨 ×2(M6 承重=結構層;行為無判別力誠實認列)
  IF position(E'ORDER BY oi.id\n   FOR NO KEY UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 結構錨:items 鎖 SELECT 的 ORDER BY 缺失(排序契約破);拒繼續';
  END IF;
  IF position('ORDER BY oi.id;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a1 結構錨:INSERT items SELECT 的 ORDER BY 缺失(排序契約破);拒繼續';
  END IF;
  -- 零全函式 EXCEPTION handler(plan §3.2-10;23505=真異常 fail-loud)
  IF position('WHEN OTHERS' in v_def) <> 0 OR position('WHEN unique_violation' in v_def) <> 0 THEN
    RAISE EXCEPTION 'A8a1 結構 assert:出現全函式 EXCEPTION handler(設計=零 handler);拒繼續';
  END IF;
  -- 順序錨(隔離閘<輸入驗<FU<冪等<已取消<actor<允許集合<品項守門<寫入)
  IF position('pg_catalog.current_setting(''transaction_isolation'')' in v_def)
       >= position('冪等鍵缺失' in v_def)
     OR position('冪等鍵缺失' in v_def)
       >= position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def)
     OR position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def)
       >= position('WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key' in v_def)
     OR position('WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key' in v_def)
       >= position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def)
     OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def)
       >= position('WHERE s.id = p_actor AND s.is_active' in v_def)
     OR position('WHERE s.id = p_actor AND s.is_active' in v_def)
       >= position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def)
     OR position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def)
       >= position('WHERE p.order_item_id = oi.id AND r.quantity > 0' in v_def)
     OR position('WHERE p.order_item_id = oi.id AND r.quantity > 0' in v_def)
       >= position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) THEN
    RAISE EXCEPTION 'A8a1 順序錨:十步全序被打亂;拒繼續';
  END IF;
  -- 有效權閘(含 role 繼承)
  IF has_function_privilege('anon',              'public.admin_cancel_order(uuid,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated',    'public.admin_cancel_order(uuid,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.admin_cancel_order(uuid,uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_cancel_order(uuid,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a1 有效權閘異常 — 應只 service_role 可呼(含繼承);拒繼續';
  END IF;
  -- ACL 窮舉(含 GRANT OPTION 指紋)
  DECLARE v_grantees text;
  BEGIN
    SELECT string_agg(g, ',' ORDER BY g)
      INTO v_grantees
      FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                   || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
              FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'public.admin_cancel_order(uuid,uuid,text,text,text)'::regprocedure
               AND a.privilege_type = 'EXECUTE') t;
    IF v_grantees IS DISTINCT FROM 'postgres,service_role' THEN
      RAISE EXCEPTION 'A8a1 ACL 窮舉異常 — EXECUTE grantee 全集=[%];拒繼續', v_grantees;
    END IF;
  END;
  -- SECDEF fail-open 面(八物件 owner 對齊 + FORCE RLS off;plan §2 七物件 + order_item_procurement
  -- 實作補強:步 8 EXISTS 走 procurement JOIN receipts,任一表被 FORCE RLS 隱列=守門靜默放行)
  DECLARE v_fn_owner oid; v_bad text;
  BEGIN
    SELECT proowner INTO v_fn_owner FROM pg_proc
     WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text)'::regprocedure;
    SELECT string_agg(c.relname, ',') INTO v_bad
      FROM pg_class c
     WHERE c.oid IN ('public.orders'::regclass, 'public.order_items'::regclass,
                     'public.order_cancellations'::regclass, 'public.order_cancellation_items'::regclass,
                     'public.order_item_procurement'::regclass, 'public.order_item_procurement_receipts'::regclass,
                     'public.payment_charge_attempts'::regclass, 'public.admin_audit_log'::regclass)
       AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'A8a1 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on;拒繼續', v_bad;
    END IF;
  END;
END
$$;

COMMIT;
