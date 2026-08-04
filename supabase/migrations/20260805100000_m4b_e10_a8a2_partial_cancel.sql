-- ============================================================
-- M-4b E10 第 1 批 · A8a2:admin_cancel_order 品項部分取消擴充(換 6 參數版)
-- ============================================================
-- 真權威:docs/specs/2026-08-05-e10-a8a2-partial-cancel-plan.md(v3;關卡1 四輪+關卡2 折入:R1 15MF
--   →R2 6→R3 1→R4 PASS)+ master plan row 37(:384)+§5.1b/c/d + A8a1(20260804180000)。
-- 鐵則 12①③。依賴=A8a1 全鏈(begin/confirm/兩取消表/A7-t/A4a/audit/A1 CHECK)。
--
-- 🔴 設計(plan §3.2 十步;A8a1 骨架+Δ):p_items NULL=整單(含部分歷史收尾;步 5 只擋
--   cancelled_at+帳本健康閘);p_items=陣列=部分取消,可取消量守門 增量 ≤ quantity−instock
--   −cancelled(Q17=B;真相表重算、摘要只驗在場不讀值=row 37 fail-closed 正解;bigint);
--   多次累積至全量=關單 op 補寫對客欄(§5.1d:未全量不碰 orders);冪等不變式=硬式全集
--   (逐品項 0≤Σci≤quantity/關單等價+closing audit 判形+reason 恰=closing header 映射/
--   本 header 集合等式(收尾=存在性條件化)/audit 恰一列全欄相符/closed 取 audit 權威、
--   缺鍵判形 fallback);輸入具名矩陣(1.0 拒/int 上限/重複品項/canonical 單一產生式)。
-- 🔴 簽名=DROP 5 參+CREATE 6 參(加 default 走 CREATE OR REPLACE 會產生第二 overload=PG
--   事實);proconfig 加 lock_timeout='5s'(A2b1 慣例;NKU 顯式等待逾時 55P03 fail-closed)。
-- 🔴 append-only:對 order_cancellation_items 零 UPDATE/DELETE(A7-t 合約債不觸發)。
-- ⛔ apply 停點+同批鐵律:與 20260804180000 同批 apply(row 36/37;順序強制 180000→本片);
--   中斷態=A8a1-only 非危險態、修本片重套、禁整批重跑(plan §6)。
-- Rollback:a7-rollback v4 步 1;單獨回退本片=重放 20260804180000 函式段(md5 閘可驗)。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:部署鏈三支 + A8a1 現版 pin + A7-t/A4a trigger 面(A8a1 同款)──
DO $$
DECLARE v text; n integer;
BEGIN
  v := md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure));
  IF v <> 'f621a56231e20f7f0b2618b40ac1276d' THEN
    RAISE EXCEPTION 'A8a2 前置閘:begin_charge_attempt 非 A8c1 新版(md5=%)——先 apply 20260804120000', v;
  END IF;
  v := md5(pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure));
  IF v <> '6423848f965176c8a0c02917b8be9f52' THEN
    RAISE EXCEPTION 'A8a2 前置閘:confirm_order_payment 非 A8c2 新版(md5=%)——先 apply 20260804150000', v;
  END IF;
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF n <> 1 THEN
    RAISE EXCEPTION 'A8a2 前置閘:admin_cancel_order overload 數=%(預期恰 1=A8a1 版);停下人工對齊', n;
  END IF;
  -- to_regprocedure 判空(regprocedure 字面 cast 在 6 參態直接 42883、訊息失控;判空=可控 false-stop)
  IF to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'A8a2 前置閘:admin_cancel_order 非 A8a1 版(非 5 參簽名;已套過本片?)——forward-only,拒重跑';
  END IF;
  v := md5(pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text)'::regprocedure));
  IF v <> '39173e33698e282cf7e5b35aae73d009' THEN
    RAISE EXCEPTION 'A8a2 前置閘:admin_cancel_order 非 A8a1 版(md5=%)——部署鏈:先 apply 20260804180000', v;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND (t.tgrelid, t.tgname, p.proname) IN (
       ('public.order_cancellations'::regclass,      'order_cancellations_block_truncate_bt',         'pcm_cancellation_ledger_block_truncate'),
       ('public.order_cancellations'::regclass,      'order_cancellations_items_presence_ac',         'pcm_assert_cancellation_has_items'),
       ('public.order_cancellation_items'::regclass, 'order_cancellation_items_block_truncate_bt',    'pcm_cancellation_ledger_block_truncate'),
       ('public.order_cancellation_items'::regclass, 'order_cancellation_items_presence_ac',          'pcm_assert_cancellation_has_items'),
       ('public.order_cancellation_items'::regclass, 'order_cancellation_items_summary_recompute_ac', 'pcm_a4a_cancellation_summary_recompute'));
  IF n <> 5 THEN
    RAISE EXCEPTION 'A8a2 前置閘:A7-t/A4a trigger 三元組=%/5(缺失/disabled/錯綁);停下人工對齊', n;
  END IF;
  -- helper functiondef md5 pin(A8a1 同款;no-op 替身抓不到綁定、抓得到本體)
  v := md5(pg_get_functiondef('public.pcm_assert_cancellation_has_items()'::regprocedure));
  IF v <> '834f8887a9c496b6a067b36a1b064aa0' THEN
    RAISE EXCEPTION 'A8a2 前置閘:pcm_assert_cancellation_has_items 定義漂移(md5=%);停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.pcm_cancellation_ledger_block_truncate()'::regprocedure));
  IF v <> '883b4cfb51a3813a77e7d4662b94d9e8' THEN
    RAISE EXCEPTION 'A8a2 前置閘:pcm_cancellation_ledger_block_truncate 定義漂移(md5=%);停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.pcm_a4a_cancellation_summary_recompute()'::regprocedure));
  IF v <> '90ced9bedc22ec68cfad770466f03178' THEN
    RAISE EXCEPTION 'A8a2 前置閘:pcm_a4a_cancellation_summary_recompute 定義漂移(md5=%);停下人工對齊', v;
  END IF;
END
$$;

-- ── 1. 換函式:DROP 5 參數版(A8a1)→ CREATE 6 參數版(plan §3.2 十步)──
DROP FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text);

CREATE FUNCTION public.admin_cancel_order(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text,
  p_items           jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_order       record;
  v_existing    record;
  v_audit       record;
  v_detail      text;
  v_hash        text;
  v_reason_txt  text;
  v_canon       text;
  v_cid         uuid;
  v_bad         bigint;
  v_cnt         integer;
  v_expect      integer;
  v_partial     boolean;
  v_closed      boolean;
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
  -- Δ p_items 具名矩陣驗(v2b;jsonb 同 object 重複 key=last-key-wins、收到前已丟失=誠實邊界)
  v_partial := p_items IS NOT NULL;
  IF v_partial THEN
    IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項清單需為非空陣列';
    END IF;
    -- 先判 typeof 再數鍵(兩段式;SQL OR 不保證短路,scalar 元素碰 jsonb_object_keys 會 22023 訊息失控)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el) <> 'object') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (SELECT count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 2
                   OR NOT (el ? 'order_item_id') OR NOT (el ? 'quantity')) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                   OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項識別碼格式錯誤';
    END IF;
    -- 數量:jsonb number 且十進位整數字面(1.0/字串/boolean/null 全拒=canonical 單一產生式)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'quantity') <> 'number'
                   OR (el->>'quantity') !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量需為正整數';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (el->>'quantity')::numeric < 1 OR (el->>'quantity')::numeric > 2147483647) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量超出範圍';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_items) e(el))
       <> (SELECT count(DISTINCT (el->>'order_item_id')::uuid) FROM pg_catalog.jsonb_array_elements(p_items) e(el)) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項重複';
    END IF;
    -- canonical 串:uuid 正規化後文字升冪、qty=驗證後 int 的 ::text(零雙 hash 面——
    -- 生 JSON 文字排序/去重會讓大寫 uuid 變體產生第二 hash 並繞過重複檢查,關卡2 抓)
    SELECT pg_catalog.string_agg(((el->>'order_item_id')::uuid)::text || '=' || ((el->>'quantity')::integer)::text,
                                 ',' ORDER BY ((el->>'order_item_id')::uuid)::text)
      INTO v_canon
      FROM pg_catalog.jsonb_array_elements(p_items) e(el);
  END IF;

  -- 步3 orders FOR UPDATE(第一觸表動作;§5.0 鎖序合約)
  SELECT id, payment_status, cancelled_at, cancelled_reason INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'a8a1:v1:' || p_order_id::text || ':' || p_reason_code || ':' || coalesce(v_detail,'')
      || CASE WHEN v_partial THEN ':partial:' || v_canon ELSE ':full' END,
    'UTF8')), 'hex');

  -- 步4 冪等格(驗全產物集+硬不變式;任一不符=fail-loud;plan v2c §3.2-4)
  SELECT id, payload_hash, actor, reason_code, reason_detail INTO v_existing
    FROM public.order_cancellations
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- hash 欄自身竄改由這裡抓(hash=輸入導出;header 欄位竄改由下方不變式抓)
    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ①header reason 欄位對輸入
    IF v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.reason_detail IS DISTINCT FROM (CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ②逐品項硬不變式 0 ≤ Σci ≤ quantity(bigint)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                 WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ③關單等價 + closing audit 判形 + reason 恰=closing header 映射
    IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (
          SELECT 1 FROM public.order_items oi
           WHERE oi.order_id = p_order_id
             AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                            WHERE ci.order_item_id = oi.id), 0) < oi.quantity::bigint)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    IF v_order.cancelled_at IS NULL THEN
      IF v_order.cancelled_reason IS NOT NULL THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      -- 恰一筆 closing audit(after.closed=true 或 A8a1 三鍵關單形)且對客文字=其 header 映射
      IF (SELECT count(*) FROM public.admin_audit_log g
           WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
             AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                  OR (NOT (g.after ? 'closed')
                      AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                      AND (g.after->>'cancelled_at') IS NOT NULL))) <> 1 THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      IF v_order.cancelled_reason IS DISTINCT FROM (
           SELECT CASE c.reason_code
                    WHEN 'customer_request' THEN '依您要求取消'
                    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
                    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
                    WHEN 'price_change'     THEN '依您要求取消'
                    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
                    WHEN 'internal_error'   THEN '依您要求取消'
                    WHEN 'other'            THEN c.reason_detail
                    ELSE NULL END
             FROM public.admin_audit_log g
             JOIN public.order_cancellations c ON c.id = (g.after->>'cancellation_id')::uuid
            WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
              AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                   OR (NOT (g.after ? 'closed')
                       AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                       AND (g.after->>'cancelled_at') IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ④本 header 集合等式(雙向;整單=存在性條件化)
    IF v_partial THEN
      IF (SELECT count(*) FROM public.order_cancellation_items ci WHERE ci.cancellation_id = v_existing.id)
         <> pg_catalog.jsonb_array_length(p_items)
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                     WHERE NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                        WHERE ci.cancellation_id = v_existing.id
                                          AND ci.order_item_id = (el->>'order_item_id')::uuid
                                          AND ci.cancelled_quantity = (el->>'quantity')::integer)) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        LEFT JOIN public.order_cancellation_items hc
               ON hc.cancellation_id = v_existing.id AND hc.order_item_id = oi.id
        CROSS JOIN LATERAL (SELECT oi.quantity::bigint
                 - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                              WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_existing.id), 0) AS rem) r
        WHERE oi.order_id = p_order_id
          AND ((r.rem > 0 AND hc.cancelled_quantity::bigint IS DISTINCT FROM r.rem)
               OR (r.rem <= 0 AND hc.order_item_id IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ⑤payment unpaid+零在途 attempts
    IF v_order.payment_status <> 'unpaid'::public.payment_status
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts pa
                   WHERE pa.order_id = p_order_id AND pa.status <> 'failed') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ⑥audit 恰一列且全欄相符(request_id 非 UNIQUE ⇒ 必數恰 1;closed 鍵條件比)
    SELECT g.* INTO v_audit FROM public.admin_audit_log g
     WHERE g.request_id = p_idempotency_key::text
       AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text;
    IF (SELECT count(*) FROM public.admin_audit_log g
         WHERE g.request_id = p_idempotency_key::text
           AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text) <> 1
       OR v_audit.actor IS DISTINCT FROM p_actor
       OR v_audit.reason IS DISTINCT FROM p_reason_code
       OR v_audit.source_app IS DISTINCT FROM 'admin'
       OR (v_audit.after->>'cancellation_id')::uuid IS DISTINCT FROM v_existing.id
       -- 快照全比(關卡2 折入):before 整顆等值;after.payment_status 恆 unpaid(⑤ 另擋現況)
       OR v_audit.before IS DISTINCT FROM pg_catalog.jsonb_build_object('payment_status', 'unpaid', 'cancelled_at', NULL)
       OR v_audit.after->>'payment_status' IS DISTINCT FROM 'unpaid' THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 權威值=本 op audit;缺鍵=判形 fallback(v2c:唯 A8a1 三鍵關單形 → true,其餘病理 RAISE)
    IF v_audit.after ? 'closed' THEN
      -- 鍵在:恰 4 鍵+值必 boolean(加鍵/JSON null/字串竄改=病理;codex R2 MF2)
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) <> 4
         OR pg_catalog.jsonb_typeof(v_audit.after->'closed') <> 'boolean' THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      v_closed := (v_audit.after->>'closed')::boolean;
    ELSIF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) = 3
          AND (v_audit.after->>'cancelled_at') IS NOT NULL THEN
      v_closed := true;
    ELSE
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- after.cancelled_at 與 closed 同形(codex R2 MF2:部分 audit 被塞非 NULL cancelled_at=病理)
    IF v_closed <> ((v_audit.after->>'cancelled_at') IS NOT NULL) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 值交叉核對(關卡2 折入):audit 宣稱已關 ⇒ orders 必已關(反向=部分 op 的 false
    -- 在單子後來被關掉=合法,不設反向)
    IF v_closed AND v_order.cancelled_at IS NULL THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('cancelled', true,
      'cancellation_id', v_existing.id, 'idempotent', true, 'closed', v_closed);
  END IF;

  -- 步5 已取消守門+帳本健康閘(v2:新鍵也驗;PS4 的 header-only 病理由③擋)
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_order.cancelled_reason IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_items oi
                 WHERE oi.order_id = p_order_id
                   AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                  WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint)
     OR EXISTS (SELECT 1 FROM public.order_cancellations c
                 WHERE c.order_id = p_order_id
                   AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                    WHERE ci.cancellation_id = c.id)) THEN
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

  -- 步8 品項守門(鎖 items NKU 按 id 序=排序契約;額度只由真相算;摘要只驗在場不讀值)
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
   ORDER BY oi.id
   FOR NO KEY UPDATE;
  SELECT count(*) INTO v_cnt FROM public.order_items x WHERE x.order_id = p_order_id;
  -- 零品項單 fail-closed(row 36「零明細 header」;A7-t presence 是 DEFERRED 且訊息非通用,不倚賴)
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 摘要在場一致閘(row 37 fail-closed 正解):真相非零的品項必有 summary 列,缺列=毀損 RAISE
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                       JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                      WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0
           OR coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0) > 0)
      AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_partial THEN
    -- 請求品項必屬本單
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE NOT EXISTS (SELECT 1 FROM public.order_items oi
                                   WHERE oi.id = (el->>'order_item_id')::uuid AND oi.order_id = p_order_id)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- 可取消量守門:增量 ≤ quantity − instock − cancelled(bigint;Q17=B;shipped 退化式)
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
      JOIN public.order_items oi ON oi.id = (el->>'order_item_id')::uuid
      WHERE (el->>'quantity')::bigint > oi.quantity::bigint
            - coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                          JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                         WHERE p.order_item_id = oi.id AND r.quantity > 0), 0)
            - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    v_expect := pg_catalog.jsonb_array_length(p_items);
  ELSE
    -- 整單(含部分歷史收尾):任一品項有到貨 ⇒ 拒(Q17=B);全增量=0 ⇒ 拒(殘態重呼)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                                  JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                                 WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    SELECT count(*) INTO v_expect FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0);
    IF v_expect = 0 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;

  -- 步9 寫入(同交易;items 按 order_item_id 序=排序契約;append-only)
  INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)
  VALUES (p_order_id, p_actor, p_idempotency_key, p_reason_code,
          CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END, v_hash)
  RETURNING id INTO v_cid;
  IF v_partial THEN
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, (el->>'order_item_id')::uuid, (el->>'quantity')::integer
      FROM pg_catalog.jsonb_array_elements(p_items) e(el)
     ORDER BY ((el->>'order_item_id')::uuid)::text;
  ELSE
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, oi.id,
           (oi.quantity::bigint - coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                              FROM public.order_cancellation_items ci
                                             WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0))::integer
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0)
     ORDER BY oi.id;
  END IF;
  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充請求集;必=預期筆數
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_expect THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 關單判定:寫後全域重算(此值=audit.closed=重放權威)
  v_closed := NOT EXISTS (
    SELECT 1 FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0));
  IF v_closed THEN
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
  END IF;
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', CASE WHEN v_closed THEN pg_catalog.now() ELSE NULL END,
            'cancellation_id', v_cid, 'closed', v_closed),
          p_reason_code, 'admin');
  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('cancelled', true, 'cancellation_id', v_cid,
    'idempotent', false, 'closed', v_closed);
END;
$fn$;

COMMENT ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) IS
  'M-4b E10-A8a1+A8a2 訂單取消(SECURITY DEFINER、search_path=''''、lock_timeout=5s;service_role only)。p_items NULL=整單取消(含部分歷史單收尾:切 remaining、任一品項有到貨拒=Q17-B、全零增量拒);p_items=[{order_item_id,quantity}…]=品項部分取消:可取消量守門 增量 ≤ quantity−instock−cancelled(bigint、真相表重算;摘要只驗在場不讀值、真相非零缺摘要列=fail-closed RAISE);多次累積至全量=關單 op 補寫 orders 對客欄(§5.1d:未全量不碰)。十步:隔離閘 P8C01 → 輸入驗(七值映射逐字;p_items 具名矩陣:非空陣列/恰兩鍵/uuid 格式/正整數字面(1.0 拒)/int 上限/重複品項拒;canonical=uuid 正規化後文字升冪 id=qty 逗號串)→ orders FOR UPDATE 第一觸表 → 冪等格(hash 欄+actor+header 欄位對輸入+逐品項 0≤Σci≤quantity+關單等價(closing audit 判形:after.closed=true 或 A8a1 三鍵關單形;reason 恰=closing header 映射)+本 header 集合等式(部分=恰請求集;收尾=rem>0 恰一列 qty=rem、rem=0 恰無列)+unpaid+零在途 attempts+audit 恰一列全欄相符;closed 取本 op audit 權威、缺鍵判形 fallback、病理 RAISE)→ 已取消守門+帳本健康閘(Σci≤quantity/對客欄配對/零品項 header)→ actor is_active → 允許集合(unpaid+attempts 全 failed 或零筆)→ 品項守門(items NKU 按 id 序;零品項拒;摘要在場閘;路徑守門)→ 寫入(header+items 按 id 序+筆數守;關單才寫對客欄+row_count 守;audit 快照形+closed+source_app+筆數守;append-only)→ 回傳 {cancelled,cancellation_id,idempotent,closed}。hash 域:整單=…:full、部分=…:partial:canonical。零全函式 EXCEPTION handler。業務拒絕=通用訊息;輸入類=具體訊息。零經銷價/cost。';

-- ── 2. ACL:service_role only(新函式重掛)──
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;


-- ── 3. 結構 assert(A8a1 版式+Δ:簽名/proconfig/新碼錨)──
DO $$
DECLARE v_def text; v_n integer; v_cfg text[];
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A8a2 結構 assert:overload 數=%(預期恰 1);拒繼續', v_n;
  END IF;
  SELECT pronargs, pronargdefaults, proconfig INTO v_n, v_def, v_cfg FROM pg_proc
   WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure;
  IF v_n <> 6 OR v_def::integer <> 1 THEN
    RAISE EXCEPTION 'A8a2 結構 assert:pronargs=%/pronargdefaults=%(預期 6/1);拒繼續', v_n, v_def;
  END IF;
  IF NOT ('lock_timeout=5s' = ANY(v_cfg)) OR NOT ('search_path=""' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'A8a2 結構 assert:proconfig=%(需 lock_timeout=5s+search_path="");拒繼續', v_cfg;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'A8a2 結構 assert:prosecdef=false(SECURITY DEFINER 遺失=service_role 呼叫必炸);拒繼續';
  END IF;
  v_def := pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure);
  -- 碼錨(code-exact;完整條件字面防反轉;A8a1 錨全繼承)
  IF position('pg_catalog.current_setting(''transaction_isolation'') <> ''read committed''' in v_def) = 0
     OR position('USING ERRCODE = ''P8C01''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:隔離閘缺失;拒繼續';
  END IF;
  IF position('冪等鍵缺失' in v_def) = 0 OR position('品項重複' in v_def) = 0
     OR position('品項數量需為正整數' in v_def) = 0 OR position('品項數量超出範圍' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:輸入驗矩陣缺失;拒繼續';
  END IF;
  IF position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:orders FOR UPDATE(第一觸表)缺失;拒繼續';
  END IF;
  IF position('''a8a1:v1:''' in v_def) = 0 OR position(''':full''' in v_def) = 0
     OR position(''':partial:'' || v_canon' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:hash 域字面缺失;拒繼續';
  END IF;
  IF position('WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:冪等格查詢缺失;拒繼續';
  END IF;
  IF position('WHERE s.id = p_actor AND s.is_active' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:actor 守門缺失;拒繼續';
  END IF;
  IF position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:允許集合缺失;拒繼續';
  END IF;
  IF position('AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:摘要在場一致閘缺失;拒繼續';
  END IF;
  IF position('IF v_cnt = 0 THEN' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:零品項守門缺失;拒繼續';
  END IF;
  -- 三道守=註解+緊鄰程式碼綁定錨(codex 關卡2:只錨註解 ⇒ 碼被搬走註解留著仍過)
  IF position(E'GET DIAGNOSTICS v_bad = ROW_COUNT;\n  IF v_bad <> v_expect THEN' in v_def) = 0
     OR position(E'-- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾\n    GET DIAGNOSTICS v_bad = ROW_COUNT;\n    IF v_bad <> 1 THEN' in v_def) = 0
     OR position(E'-- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1\n  GET DIAGNOSTICS v_bad = ROW_COUNT;\n  IF v_bad <> 1 THEN' in v_def) = 0
     OR position('-- items 筆數守' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:三道筆數/row_count 守(註解+碼綁定)缺失;拒繼續';
  END IF;
  IF position('OR EXISTS (SELECT 1 FROM public.order_cancellations c' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:帳本健康閘(零品項 header 分句)缺失;拒繼續';
  END IF;
  IF position('INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)' in v_def) = 0
     OR position('''closed'', v_closed' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 碼錨:audit 寫入(closed 快照形)缺失;拒繼續';
  END IF;
  IF position('WHEN OTHERS' in v_def) <> 0 OR position('WHEN unique_violation' in v_def) <> 0 THEN
    RAISE EXCEPTION 'A8a2 結構 assert:出現全函式 EXCEPTION handler;拒繼續';
  END IF;
  -- append-only 斷言(A7-t 合約債字面):RPC 內零 UPDATE/DELETE 取消明細
  IF position('UPDATE public.order_cancellation_items' in v_def) <> 0
     OR position('DELETE FROM public.order_cancellation_items' in v_def) <> 0 THEN
    RAISE EXCEPTION 'A8a2 結構 assert:出現 ci UPDATE/DELETE(append-only 破);拒繼續';
  END IF;
  -- ORDER BY 結構錨 ×3(排序契約:鎖/部分寫/收尾寫)
  IF position(E'ORDER BY oi.id\n   FOR NO KEY UPDATE;' in v_def) = 0
     OR position('ORDER BY ((el->>''order_item_id'')::uuid)::text;' in v_def) = 0
     OR position('ORDER BY oi.id;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a2 結構錨:三處 ORDER BY 任一缺失(排序契約破);拒繼續';
  END IF;
  -- 順序錨(隔離閘<輸入驗<FU<冪等<健康閘<actor<允許集合<摘要閘<寫入)
  IF position('pg_catalog.current_setting(''transaction_isolation'')' in v_def)
       >= position('冪等鍵缺失' in v_def)
     OR position('冪等鍵缺失' in v_def)
       >= position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def)
     OR position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def)
       >= position('WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key' in v_def)
     OR position('WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key' in v_def)
       >= position('OR EXISTS (SELECT 1 FROM public.order_cancellations c' in v_def)
     OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c' in v_def)
       >= position('WHERE s.id = p_actor AND s.is_active' in v_def)
     OR position('WHERE s.id = p_actor AND s.is_active' in v_def)
       >= position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def)
     OR position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def)
       >= position('AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)' in v_def)
     OR position('AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)' in v_def)
       >= position('INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)' in v_def) THEN
    RAISE EXCEPTION 'A8a2 順序錨:十步全序被打亂;拒繼續';
  END IF;
  -- 有效權閘(含 role 繼承)
  IF has_function_privilege('anon',              'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated',    'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a2 有效權閘異常 — 應只 service_role 可呼(含繼承);拒繼續';
  END IF;
  -- ACL 窮舉(含 GRANT OPTION 指紋)
  DECLARE v_grantees text;
  BEGIN
    SELECT string_agg(g, ',' ORDER BY g)
      INTO v_grantees
      FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                   || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
              FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure
               AND a.privilege_type = 'EXECUTE') t;
    IF v_grantees IS DISTINCT FROM 'postgres,service_role' THEN
      RAISE EXCEPTION 'A8a2 ACL 窮舉異常 — EXECUTE grantee 全集=[%];拒繼續', v_grantees;
    END IF;
  END;
  -- SECDEF fail-open 面(八物件 owner 對齊 + FORCE RLS off;A8a1 同款)
  DECLARE v_fn_owner oid; v_bad text;
  BEGIN
    SELECT proowner INTO v_fn_owner FROM pg_proc
     WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure;
    SELECT string_agg(c.relname, ',') INTO v_bad
      FROM pg_class c
     WHERE c.oid IN ('public.orders'::regclass, 'public.order_items'::regclass,
                     'public.order_cancellations'::regclass, 'public.order_cancellation_items'::regclass,
                     'public.order_item_procurement'::regclass, 'public.order_item_procurement_receipts'::regclass,
                     'public.payment_charge_attempts'::regclass, 'public.admin_audit_log'::regclass)
       AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'A8a2 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on;拒繼續', v_bad;
    END IF;
  END;
END
$$;

COMMIT;
