-- 退回 20260914050000(⟦b4-PARTPAIDNOCANCEL1⟧ partiallyPaid 整單取消放行 v2)
-- 做三件事:① admin_cancel_order 逐字貼回第 8 代 20260903093000:90-556(prosrc md5 bd7c79ba2ccc792d3dab5f3b54335582)
--          ② 收權三行重跑 ③ 把 20260914050000 附加在函式 COMMENT 上的那一段砍掉(否則函式退回而契約仍宣稱支援)。
-- 🔴 資料不回滾:期間真的被取消的 partiallyPaid 單、與它們開出的 order_pending_refunds 列【留著】
--    (主視窗 A 2026-09-08 拍甲:那些單是真的被取消了, 抹掉比留著糟)。⇒ 退回之後不是乾淨狀態。
-- 前置閘:線上函式體必須是 v2(md5 90d6420f86e6039819c8e1ec168bb6f7), 不是就停 —— 不退一個我不認得的版本。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)');
  IF v_src IS NULL OR pg_catalog.md5(v_src) <> '90d6420f86e6039819c8e1ec168bb6f7' THEN
    RAISE EXCEPTION USING MESSAGE = '退回前置閘:admin_cancel_order 本體不是 20260914050000 那一版 90d6420f86e6039819c8e1ec168bb6f7(實得 ' || COALESCE(pg_catalog.md5(v_src), '<null>') || ')⇒ 不是本檔知道怎麼退的版本';
  END IF;
  -- codex R1 must-fix:md5 看不到 ALTER FUNCTION … SET 改過的設定, 而下面 CREATE OR REPLACE 會整組蓋掉 ⇒ 先確認 proconfig 沒被動過
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'))
     IS DISTINCT FROM ARRAY['search_path=""', 'lock_timeout=5s']::text[] THEN
    RAISE EXCEPTION '退回前置閘:admin_cancel_order 的 proconfig 不是 {search_path="", lock_timeout=5s} ⇒ 有人 ALTER 過, 本檔不知道怎麼退';
  END IF;
END
$pre$;

-- ① 第 8 代函式體(20260903093000:90-556 逐字)
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
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
    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
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
    -- 🔴🔴 **員工原文不得撞上【機器碼】**(⟦b4-CANCELKINDBYCONTENT⟧, 2026-09-03)。
    --    病:`orders.cancelled_reason` 這一欄裝的是**中文散文**(上面那張七值映射),
    --    而 `other` 這條路裝的是**員工當場打的原文**;同一欄裡混著**一個機器碼**
    --    `payment_expired`(L3 自動失效寫的,`…l3a_expire_unpaid_orders_fn.sql:174`)。
    --    而讀的那一端拿那個字面**判身分**(`order-cancel-reason.ts:82`)
    --    ⇒ 🎯 **員工打 `payment_expired` ⇒ 客人的訂單頁對他陳述一個錯的取消原因。**
    --
    -- 🛑 **為什麼是【拒絕】而不是【靜靜改寫】—— 理由是機制不是禮貌**:
    --    本檔上面那段(`:31-32`)記著:冪等回放端拿 `orders.cancelled_reason`
    --    跟**重算的映射**比,`IS DISTINCT FROM` 就 `RAISE`。
    --    ⇒ **改寫 ⇒ 冪等重放會爆。那不是權衡,那是壞掉。**
    --
    -- ⚠️ **射程:精確、大小寫敏感、不做正規化** —— 而那是【對齊讀的那一端】不是偷懶:
    --    · 讀端兩處都是 JS `===`(`order-cancel-reason.ts:82` / `cancel-view.ts:686`)
    --      ⇒ `Payment_Expired` **不會**被讀成機器碼 ⇒ 擋它就是**誤擋**員工一個合法的字。
    --    · 前後空白已由上面 `pg_catalog.btrim` 處理掉 ⇒ 這裡看到的就是入庫值。
    --    ⇒ 📌 **擋的形狀 = 讀的形狀。多擋一格是假指控, 少擋一格是漏。**
    IF v_detail = 'payment_expired' THEN
      RAISE EXCEPTION 'admin_cancel_order: 取消說明不可使用系統保留字「payment_expired」——'
        ' 那是系統給【未付款自動失效】用的代號, 填它會讓客人在訂單頁看到錯的取消原因。'
        ' 請改用其他說明, 或選擇對應的取消原因碼。';
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
                    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
                    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
                    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
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
    -- ⑤payment 允許集合(A8a3:與步7 **同一條述詞**)+ 零在途 attempts
    -- 🔴 這裡不同步改的話:現金單第一次取消得了,而重送同一顆冪等鍵會在這裡被擋
    --    ⇒ 外觀是「隨機失敗」。三處述詞(步7 / 本處 / audit 快照)必須一起改。
    IF (v_order.payment_status <> 'unpaid'::public.payment_status
         AND NOT (v_order.payment_status = 'paid'::public.payment_status
                  AND EXISTS (SELECT 1 FROM public.order_payments op
                               WHERE op.order_id = p_order_id)
                  AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                   WHERE op.order_id = p_order_id AND op.rail = 'card')))
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
       -- 快照比對(A8a1/a8a2 原為「before 整顆等值 + after 恆 unpaid」)。
       -- 🔴 **A8a3 把上面那句換掉,因為它已經不成立**:payment_status 的值域從單值 'unpaid'
       --    放寬成 {'unpaid','paid'} ⇒ 「整顆等值」寫不出來了。改成五道:鍵在 + 鍵數 + 型別 + 值域 + 前後一致。
       -- 🔴 **鍵在**與**型別**缺一不可:`->>` 對【缺鍵】與【JSON null】都回 NULL
       --    ⇒ 只驗取值的話,把鍵刪掉再塞一個別的鍵會整組穿過去(codex 關卡1 R2 的 C-1)。
       -- 🔴 **本段守的是「鍵形 + 值域 + 前後一致」,不守「值被整組替換」**:
       --    把 before 與 after 同時從 paid 改成 unpaid,本段抓不到 —— 逐字寫在這裡,不藏。
       --    擋它的在別層:admin_audit_log 對 service_role **只有 INSERT**
       --    (20260712210000:110-115 兩道 apply 期 ACL 斷言)且該表零 trigger(:161)
       --    ⇒ 要改那兩個值得有表 owner 權限,已不在本函式的射程內。
       OR NOT (v_audit.before ? 'payment_status')
       OR NOT (v_audit.before ? 'cancelled_at')
       OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.before)) <> 2
       OR pg_catalog.jsonb_typeof(v_audit.before->'cancelled_at') <> 'null'
       OR pg_catalog.jsonb_typeof(v_audit.before->'payment_status') <> 'string'
       OR v_audit.before->>'payment_status' NOT IN ('unpaid', 'paid')
       OR v_audit.after->>'payment_status' IS DISTINCT FROM (v_audit.before->>'payment_status') THEN
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

  -- 步7 允許集合(A8a3 放寬:unpaid **或** 非卡已付款;attempts 那一半逐字不動)
  -- 🔴 判準讀 public.order_payments.rail 的集合,**不讀 orders.payment_channel**
  --    (該欄 DEFAULT 就是 'tappay'、正式庫 19/19 都是它 ⇒ 它是常數不是資料;W2 2026-08-19 實量)。
  -- 🔴 零收款列 ⇒ 不放行(態 C fail-closed):正式庫有一張 refunded 而收款帳本零列的舊單。
  -- 🔴 **刻意不看淨額**(不加 SUM(amount) > 0):那道條件在並行下會翻面 ——
  --    並行插入一筆人工正額會把「不可取消」變「可取消」(codex 關卡1 R2 的 E-1)。
  --    殘餘風險與落地必驗寫在 backlog #764,不留在 commit body。
  -- 🔴 attempts 那一半**一個字不動** ⇒ 20260809160000 L3a COMMENT 的跨檔不變式
  --    「cancelled ⇒ 無 active attempt」不受影響;而刷卡單照樣被它擋住,不必為它另寫一道閘。
  IF (v_order.payment_status <> 'unpaid'::public.payment_status
       AND NOT (v_order.payment_status = 'paid'::public.payment_status
                AND EXISTS (SELECT 1 FROM public.order_payments op
                             WHERE op.order_id = p_order_id)
                AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                 WHERE op.order_id = p_order_id AND op.rail = 'card')))
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

-- ② 收權(同 20260903093000 檔尾三行)
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;

-- ③ 砍掉 20260914050000 附加的那段 COMMENT —— 只砍【那一段逐字】, 之後別人再附加的段落留著(codex R1 nit)
DO $cmt$
DECLARE v_old text;
  v_seg text := ' 🔴 2026-09-14(⟦b4-PARTPAIDNOCANCEL1⟧, 落點 20260914050000;20260908060000 未貼、前置閘寫壞、由本版取代):允許集合再放寬一格 —— '
            || '**partiallyPaid 且【整單取消】且有收款列且無 rail=''card'' 的列** 亦放行。'
            || '成因:20260904230000 讓收到錢的匯款單翻成 paid / partiallyPaid, '
            || '而 partiallyPaid 落在舊允許集外 ⇒ 收了訂金的匯款單按不下取消。'
            || '🛑 **部分取消【刻意仍然擋著】, 不是遺漏**:那個世界裡錢已收、'
            || '部分取消不開待退款(20260901080000:60-62)、結算器 P2 要求無取消痕跡'
            || '(20260901030000:1188-1192)⇒ 訂單永遠停在 partiallyPaid。'
            || '要放行部分取消, 前提是先答「部分取消該退多少」那個口徑題 —— 而那題沒有人答過。'
            || 'audit 快照值域同步放寬成 {unpaid, paid, partiallyPaid}(三處述詞必須一起改)。';
BEGIN
  v_old := pg_catalog.obj_description('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION '退回 COMMENT:讀不到既有 COMMENT ⇒ 停下';
  END IF;
  IF pg_catalog.strpos(v_old, v_seg) = 0 THEN
    RAISE NOTICE '退回 COMMENT:找不到 20260914050000 附加段 ⇒ 略過(可能已退過)';
  ELSE
    EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.admin_cancel_order(uuid,uuid,text,text,text,jsonb) IS %L',
                              pg_catalog.replace(v_old, v_seg, ''));
  END IF;
END
$cmt$;

DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'))
     <> 'bd7c79ba2ccc792d3dab5f3b54335582' THEN
    RAISE EXCEPTION '退回後置閘:admin_cancel_order 本體不是第 8 代 bd7c79ba2ccc792d3dab5f3b54335582';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'))
     IS DISTINCT FROM ARRAY['search_path=""', 'lock_timeout=5s']::text[] THEN
    RAISE EXCEPTION '退回後置閘:proconfig 不是 {search_path="", lock_timeout=5s}';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '退回後置閘:anon / authenticated 叫得動 admin_cancel_order';
  END IF;
  -- codex R2:只查本版附加段的特徵開頭還在不在, 不禁整份 COMMENT 出現版本號(後人可能在別段提到它)
  IF pg_catalog.strpos(pg_catalog.obj_description('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure, 'pg_proc'),
                       ' 🔴 2026-09-14(⟦b4-PARTPAIDNOCANCEL1⟧, 落點 20260914050000;') > 0 THEN
    RAISE EXCEPTION '退回後置閘:COMMENT 仍含 20260914050000 附加段';
  END IF;
END
$post$;

COMMIT;
