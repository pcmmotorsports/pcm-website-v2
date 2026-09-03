-- 20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql
-- ⟦b4-CANCELKINDBYCONTENT⟧ · 員工原文不得撞上機器碼 `payment_expired`
--
-- 🔴 **病**:`orders.cancelled_reason` 那一欄裝的是**中文散文**(七值映射),
--    而 `p_reason_code = 'other'` 那條路裝的是**員工當場打的原文**;
--    同一欄裡混著**一個機器碼** `payment_expired`(L3 自動失效寫的)。
--    而讀的那一端(`packages/domain/src/order/order-cancel-reason.ts:82`)拿那個字面**判身分**
--    ⇒ 🎯 **員工打 `payment_expired` ⇒ 客人的訂單頁對他陳述一個錯的取消原因。**
--    📌 **⇒ 那一欄「中文散文混一個機器碼」的形狀本身就是病灶。**
--
-- 🛑 **為什麼不從讀端修(改成看「有沒有取消帳本列」)—— 那條路被一發實驗否決**:
--    `20260730130000_m4b_e10_a7_order_cancellations.sql:202-203` 逐字
--    `REVOKE ALL ON TABLE public.order_cancellations FROM PUBLIC, anon, authenticated, service_role;`
--    而 storefront 走 **authenticated client**(`SupabaseOrderAdapter.ts:729`)
--    ⇒ 把帳本嵌進客人那兩條 SELECT **一律回空** ⇒ `expired` 整個消失,不是修好。
--    ⇒ 而要開權限 = 把一張模型【客服內部作業】的表(actor / reason_code / 逐品項數量)開給客人
--      ⇒ **用擴大授權換取得資訊,那個交換在安全上永遠是虧的。**
--    🧪 否決它的是實驗不是意見:先改判準 ⇒ 既有測試紅**恰好 1 格**
--       (分母 311 檔 / 6,582 測項)⇒ 那一格紅就是阻擋本身的證據。已 revert。
--
-- 🔴 **本檔改的【只有一段】** —— `p_reason_code = 'other'` 分支裡、`v_reason_txt := v_detail;` 之前,
--    加一道**拒絕**。⚠️ 而**同一道要加兩次** —— 見下面第 3 節(第二條寫入路)。
--    ⛔ ~~「其餘 475 行逐字照抄 `…cancel_reason_neutral.sql:115-589`」~~ —— **那個範圍是錯的, 而錯法有後果**:
--       `115-589` **多框進了檔尾那段契約副本**(欄位 COMMENT + 函式 COMMENT 附加),
--       而我把它一起抄了 ⇒ 🔴 **那段裡有一道釘著 `20260830020000` 的防重跑閘, 本檔必然撞死。**
--       ✅ 正確範圍 = **`115-559`(函式本體 445 行)**;檔尾那段**不抄**。
--    ✅ **兩支都是機械驗過的**(抽出兩份比 `diff`):
--       · `admin_cancel_order`         原 445 行 ⇒ **刪 0 / 增 22**
--       · `admin_mark_order_cancelled` 原 239 行 ⇒ **刪 1 / 增 13**(刪的那 1 行 = `CREATE` 改 `CREATE OR REPLACE`)
--
-- 🛑 **只拒絕,不改寫** —— 理由是機制不是禮貌:
--    `…cancel_reason_neutral.sql:31-32` 逐字記著冪等回放端拿 `orders.cancelled_reason`
--    跟**重算的映射**比,`IS DISTINCT FROM` 就 `RAISE`
--    ⇒ **改寫 ⇒ 冪等重放會爆。那不是權衡,那是壞掉。**
--
-- ⚠️ **本檔【不動舊資料】** —— 它防的是未來的碰撞。
--    已經寫進去的舊單(若有)不會自己變好 ⇒ 那要另外一支資料訂正,而它是 Sean 的板。
--
-- ✅ **驗收訊號**:`scripts/cancel-reason-reserved-literal-guard.test.ts`。
--    ⛔ ~~「那格 `it.fails` 會在本檔進 repo 之後**變紅**」~~ —— **R2 抓到:那句話今天是假的。**
--       它**曾經**是 `it.fails`(洞還在 ⇒ 綠 ⇒ 不把 CI 弄紅), 而本 commit **已經把它翻成正常的 `it`**
--       ⇒ 🔴 **本檔進 repo 之後那格是【綠】的。照這句去找紅的人, 永遠找不到。**
--       📌 教訓:**「它會變紅」是一句只在轉正之前為真的話, 而轉正就寫在同一個 commit 裡。**
--    ⛔ ~~「而那正是『這幾百行有沒有被抄壞』的訊號」~~ —— **過度宣稱**(R1 ⑦ / R2 F2)。
--       🔴 那支測試**從來沒有比對過那幾百行** —— 它只看那道拒絕在不在、排不排在賦值之前。
--       ✅ 「有沒有抄壞」有它自己的兩層, 都不在那支測試裡:
--          ① 動手當下的機械 `diff`(數字見上面)② apply 當下的事後閘(讀 `pg_get_functiondef`)
--    ✅ **現在的驗收訊號 = 那支測試【綠】, 而它在下列任一世界會紅**:
--       拒絕被拿掉 / 被搬到賦值之後 / 字面大小寫被改 / 只剩註解裡的擋 / 兩支只改了一支。
--
-- 🔴🔴 **語法眉角(2026-09-04 Sean 貼下去當場 42601, 而答案 8 月就寫在本 repo 裡)**:
--    ⛔ ~~`pg_catalog.position('X' in v_def)`~~ ⇒ ✅ **`pg_catalog.strpos(v_def, 'X')`**
--    成因:`position(A in B)` 是**語法**不是函式呼叫 ⇒ 加了 `pg_catalog.` 之後 Postgres
--    改用函式呼叫文法去 parse ⇒ `'X' in v_def` 變成一個 `IN` 運算式而 `IN` 後面要括號
--    ⇒ 🎯 `ERROR: 42601: syntax error at or near "v_old"`。
--    🛑 **不要改成兩參 `position(a, b)`** —— 那個的**參數順序是相反的**。
--    📎 逐字出處 `20260809020000_m4b_e10_b2_w7d3_recompute_structural_anchors.sql:55-57`
--       (W7d-1 踩過、寫下來了)⇒ 🔴 **而它沒有接到需要它的那一步, 成本轉嫁給 Sean。**
--       📌 ⇒ 教訓不是「有人沒查」, 是**一個寫在別支 migration 註解裡的語法警告,
--          沒有任何機制會在寫同一種碼的人面前出現**。⇒ 所以它現在也寫在這裡一份。
--
-- 🔴🔴 **本檔是 codex 關卡2 R1 的【FAIL】修完之後的版本** —— R1 抓到 8 條 must-fix。
--    其中兩條是**真的會壞掉**(①防重跑閘撞死、②只擋了兩支裡的一支),
--    三條是**閘不夠緊**(⑤overload/形狀、⑧ACL 沒重驗、⑥測試 regex 太鬆),
--    兩條是**過度涵蓋而刻意保留**(③冪等回放、④未關單 partial cancel ⇒ 見第 2 節 COMMENT 的射程句),
--    一條是**註解宣稱大於實際**(⑦)。逐條處置寫在各自落點旁邊, 不集中在這裡。

BEGIN;

-- ── 0. 前置閘:兩支函式都必須【已經存在】 ───────────────────────────────
-- 🔴 本檔兩段都是 `CREATE OR REPLACE`, 而它在函式不存在時會**安靜地建一支新的**。
--    ⇒ 若貼的順序倒過來(本檔先於 `20260902140000`), 那支會被本檔建出來,
--      而 `20260902140000` 的 `CREATE FUNCTION`(無 REPLACE)之後會撞 42723。
--    ⇒ 🎯 **把「順序貼錯」從一個安靜的錯換成一個會叫的錯。**
DO $pre$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)',
    'public.admin_mark_order_cancelled(uuid,uuid,text,text,text)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '前置閘:% 還不存在 ⇒ 先貼它自己那一支 migration, 再貼本檔', r;
    END IF;
  END LOOP;
END
$pre$;

-- ── 1. admin_cancel_order ──────────────────────────────────────────────
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

-- ── 2. 函式 COMMENT:**附加**不重寫 ────────────────────────────────────
-- 🔴🔴 **codex 關卡2 R1 must-fix(1/8)—— 而它是一發【會讓整支 migration 套不上去】的**:
--    本檔第一版把 `20260830020000` 檔尾那整段契約副本(欄位 COMMENT + 函式 COMMENT 附加)
--    **一起照抄了**。而那段裡有一道防重跑閘逐字寫著
--      `IF position('20260830020000' in v_old) > 0 THEN RAISE`
--    ⇒ 🎯 **而 20260830020000 在正式庫【已經套過】**(`supabase/APPLIED.tsv:333` 逐字
--      「g6 admin_cancel_order 的 obj_description 含 '20260830020000' ⇒ 已套過」)
--    ⇒ 🛑 **那個字串必然在,所以本檔必然 RAISE,永遠到不了下面的事後閘。**
--    📌 **⇒ 教訓不是「抄錯段落」,是【抄一段防重跑閘等於抄它的前提】** ——
--       那道閘的前提是「我是 20260830020000」,而我不是。**閘會跟著它的落點編號走,不跟著字面走。**
--    ⇒ ✅ 已刪掉那整段;欄位 COMMENT 不重貼(`CREATE OR REPLACE` 本來就保留 COMMENT 與 ACL)。
DO $$
DECLARE v_old text;
BEGIN
  v_old := pg_catalog.obj_description('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:讀不到既有 COMMENT ⇒ 停下(不要用一句新的蓋掉三代契約)';
  END IF;
  IF pg_catalog.strpos(v_old, '20260903093000') > 0 THEN
    RAISE EXCEPTION 'COMMENT 附加:看起來已經附加過 ⇒ forward-only,拒重跑';
  END IF;
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.admin_cancel_order(uuid,uuid,text,text,text,jsonb) IS %L',
    v_old || ' 🔴 2026-09-03(⟦b4-CANCELKINDBYCONTENT⟧):p_reason_code=''other'' 那條路的員工原文'
          || '**不得逐字等於 `payment_expired`** —— 那是 L3 自動失效寫進同一欄的機器碼,'
          || '而讀端(order-cancel-reason.ts:82)拿那個字面判身分 ⇒ 撞到就對客人陳述錯的取消原因。'
          || '拒絕而不改寫:改寫會讓冪等回放端的 IS DISTINCT FROM 比對爆掉。'
          || '🛑 射程=精確、大小寫敏感、不正規化(對齊讀端 JS ===);'
          || '而**未關單的 partial cancel 也一樣擋** —— 它不寫對客欄,擋它是刻意的過度涵蓋,'
          || '理由是那個字對員工從來就不是一個合法的說明。落點 20260903093000。');
END
$$;

-- ── 3. 第二條寫入路:admin_mark_order_cancelled ────────────────────────
-- 🔴🔴 **codex 關卡2 R1 must-fix(2/8)** —— 本片第一版**只擋了一支**。
--    而 `admin_mark_order_cancelled`(`20260902140000:384`)是**另一條**把員工原文
--    寫進 `orders.cancelled_reason` 的路 ⇒ 只擋一支 = 修法沒有涵蓋那個病。
--    📌 **我當時說「只有一條路」的分母是【一支檔】** —— 而那支檔內的每一句都對。
--       ⇒ 錯的不是那些觀察, 是【誰會寫這一欄】那張清單我沒有去列。
--       ✅ 補列法(當場跑, 兩個世界會印不同的東西):
--          `grep -rn "cancelled_reason *=" supabase/migrations/*.sql` ⇒ 命中 10 列、開檔看
--          ⇒ 寫入型 5 支:a8a1 / a8a2 / a8a3 / cancel_reason_neutral(= 本檔取代的那一代)
--                        / mark_order_cancelled;另 2 支是 L3 自動失效(它【本來】就該寫這個碼)。
-- ⚠️ **本段是 `CREATE OR REPLACE`, 而 `20260902140000` 是 `CREATE FUNCTION`(無 REPLACE)**
--    ⇒ 🛑 **順序倒過來貼會壞**:先貼本檔 ⇒ 函式被建出來 ⇒ 之後貼 20260902140000 會 42723。
--    ⇒ ✅ 所以檔頭那道前置閘要求它**必須已經存在** —— 讓「順序貼錯」變成一個**會叫的錯**。
CREATE OR REPLACE FUNCTION public.admin_mark_order_cancelled(
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
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_order       record;
  v_audit       record;
  v_detail      text;
  v_reason_txt  text;
  v_bad         bigint;
  v_q0          text;   -- 🔴 是【摘要】不是筆數(列數 + 每列 id:數量 的 md5)
  v_q1          text;
  v_generic_msg constant text := 'admin_mark_order_cancelled: 標記失敗';
BEGIN
  -- 步1 隔離閘(A8c 家族同款;RR 等鎖醒來舊快照會漏看真相表)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(七值映射逐字同 admin_cancel_order;輸入類=具體訊息)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 冪等鍵缺失';
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
    RAISE EXCEPTION 'admin_mark_order_cancelled: 未知取消原因碼';
  END IF;
  v_detail := pg_catalog.btrim(p_reason_detail);
  IF v_detail = '' THEN v_detail := NULL; END IF;
  IF p_reason_code = 'other' THEN
    IF v_detail IS NULL THEN
      RAISE EXCEPTION 'admin_mark_order_cancelled: other 需填取消說明';
    END IF;
    -- 🔴🔴 **員工原文不得撞上【機器碼】**(⟦b4-CANCELKINDBYCONTENT⟧, 2026-09-03)。
    --    與 `admin_cancel_order` 同一片、同一道、逐字同一個字面 —— 而**兩支都要有**:
    --    🔴 codex 關卡2 R1 must-fix(2/8)抓到本片第一版**只擋了 admin_cancel_order**,
    --       而 `admin_mark_order_cancelled` 是**第二條寫入路**(本檔 :384 逐字
    --       `cancelled_reason = v_reason_txt`)⇒ 員工從「標記為已取消」那個入口照樣打得進去。
    --    📌 **⇒ 我當時的分母是【一支檔】, 而那一支檔內的結論完全正確。**
    --       量錯的不是那道閘, 是【誰會寫這一欄】那張清單。
    IF v_detail = 'payment_expired' THEN
      RAISE EXCEPTION 'admin_mark_order_cancelled: 取消說明不可使用系統保留字「payment_expired」——'
        ' 那是系統給【未付款自動失效】用的代號, 填它會讓客人在訂單頁看到錯的取消原因。'
        ' 請改用其他說明, 或選擇對應的取消原因碼。';
    END IF;
    v_reason_txt := v_detail;
  ELSIF v_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 非 other 不得填說明';
  END IF;

  -- 步3 鎖單(第一觸表)
  SELECT o.id, o.payment_status, o.payment_method, o.cancelled_at,
         o.cancelled_reason, o.cancel_items_untouched
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步4 冪等格(同 (order_id, key) 且同 action)
  -- 🔴🔴 **`request_id` 是 `text` 不是 `uuid`**(真表 `20260712210000` 檔內
  --    `request_id  text        NOT NULL`)⇒ **一定要 `::text`**。
  --    實測(拋棄式 PG 17.10):`text = uuid` ⇒ `ERROR: operator does not exist: text = uuid`
  --    ⇒ 少了那個 cast,**每一發合法呼叫都會在這一行炸**。
  --    (而 `INSERT` 那一側 uuid → text 有 assignment cast、**不會**炸 ⇒ 兩側行為不同,
  --     所以只看 INSERT 過了不能推論 SELECT 也過。)
  --    🔵 既有的 `admin_cancel_order` 就是這樣寫的(錨:`g.request_id = p_idempotency_key::text`)
  --      —— 我第一版沒照它,而 harness 的 fixture 把欄型別手寫成 uuid ⇒ **它把這個 bug 蓋住了**。
  -- 🔴 **`request_id` 沒有 UNIQUE ⇒ 必須【數恰 1】,不能 `SELECT INTO` 隨便撈一列**
  --    (同一個理由寫在 `20260830020000` 檔內,錨:「request_id 非 UNIQUE ⇒ 必數恰 1」)。
  --    否則兩列互相矛盾的歷史,會被任取一列而認成合法重放。
  SELECT count(*) INTO v_bad
    FROM public.admin_audit_log g
   WHERE g.target = 'order:' || p_order_id::text
     AND g.action = 'order.mark_cancelled'
     AND g.request_id = p_idempotency_key::text;
  IF v_bad > 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_bad = 1 THEN
    SELECT g.actor, g.source_app, g.reason INTO v_audit
      FROM public.admin_audit_log g
     WHERE g.target = 'order:' || p_order_id::text
       AND g.action = 'order.mark_cancelled'
       AND g.request_id = p_idempotency_key::text;
    -- 🔴 fail-loud:只要有一格對不上就炸,不回 idempotent:true。
    --    「同一把鑰匙、不同的手、或不同的結果」= 那不是重放,是別的東西。
    -- 🔴 **`reason` 與最終對客文字也要比**(codex R1 抓):
    --    少了它,第一次送 `customer_request`、第二次改送 `other + 另一段理由`,
    --    **照樣回 `idempotent:true`** ⇒ 呼叫端會以為第二次那個理由生效了,而它一個字都沒寫進去。
    IF v_audit.actor IS DISTINCT FROM p_actor
       OR v_audit.source_app IS DISTINCT FROM 'admin'
       OR v_audit.reason IS DISTINCT FROM p_reason_code
       OR v_order.cancelled_reason IS DISTINCT FROM v_reason_txt
       OR v_order.cancelled_at IS NULL
       OR v_order.cancel_items_untouched IS DISTINCT FROM true THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('marked', true, 'idempotent', true);
  END IF;

  -- 步5 🔴🔴 三道業務閘(Sean 2026-09-02 拍甲:只開刷卡且已全額退款)
  --    **它們住在函式裡, 不只住在 UI** —— UI 只是不顯示, 函式才是閘。
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單已經取消過了';
  END IF;
  IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這期只開放刷卡的單, 其他付款方式的取消還沒開通';
  END IF;
  -- 🔴 **只認 refunded(全額)** —— partiallyRefunded 不算。
  --    Sean 拍甲逐字「只開刷卡且已全額退款」;部分退款是另一題, 沒有人拍過。
  IF v_order.payment_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單還沒有全額退款, 只標記取消還沒開通(部分退款不涵蓋)';
  END IF;
  -- 🔴🔴 **第四道閘(2026-09-02 R3 抓、主視窗判甲 —— 不是 Sean 拍板)**:
  --    先前被【部分取消過】的單, 這條路不收。
  --    理由見檔頭「與 admin_cancel_order 的硬不變式」那一節。一句話:
  --    那類單有舊的 `order.cancel` 稽核列 ⇒ 舊冪等鍵重放會撞上對方的等價斷言而炸,
  --    而 `20260830020000` 步5 的「已取消 ⇒ 拒」會讓**剩下那幾個品項永遠再也取消不了**
  --    (不會有取消 header、不會釋庫存)。
  --    ⇒ 拒掉它 = 傷害歸零;而那類單本來就還有既有的 `admin_cancel_order` 可以走完。
  -- ⚠️ **這道閘與步7/步10 的「前後相等」斷言【不是同一件事】**:
  --    **閘擋的是「進來之前就有」,斷言擋的是「我這一發交易中途有東西插進來」。**
  IF EXISTS (SELECT 1
               FROM public.order_cancellation_items ci
               JOIN public.order_items oi ON oi.id = ci.order_item_id
              WHERE oi.order_id = p_order_id) THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 這張單先前被部分取消過, 只標記那條路不收(請走既有的整單取消)';
  END IF;

  -- 步6 actor 存在且在職
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步7 🔴 量【動之前】的品項取消筆數。
  --    這一格與步10 成對, 它們一起把「我沒有動數量」變成一個**會炸的斷言**, 而不是一句話。
  -- 🔴 **只比【列數】不夠**(codex R1 抓):一個 trigger 可以把既有的 `cancelled_quantity`
  --    由 1 改成 2、或「刪一列再補一列」⇒ **列數前後相等而數量真的變了**
  --    ⇒ 函式會成功,而 `cancel_items_untouched` 會說一句假話。
  --    ⇒ 改成比一個**摘要**:列數 + 每一列的 (id, 數量) 依 id 排序之後的 md5。
  --    🔵 帶 `count(*)` 是為了讓「零列」與「NULL」分得開(`string_agg` 對空集合回 NULL)。
  --    ⚠️ `coalesce` **不加 `pg_catalog.` 前綴** —— 它是 SQL 語法構造(像 CASE),不是 catalog 裡的函式;
  --      加了會炸 `function pg_catalog.coalesce(text, unknown) does not exist`(2026-09-02 實測)。
  --      而它在 `search_path = ''` 底下照樣可用。
  -- 🔴 R2 must-fix:摘要**只含 `ci.id:數量` 還是不夠** ——
  --    ①副作用改 `order_items.quantity` ②把取消量搬到【同一張單的另一個 order_item_id】
  --    ⇒ 兩種摘要都完全相同, 而數量真的變了。
  --    ⇒ 分母改成【從 order_items 出發 LEFT JOIN】, 並把 `oi.id` / `oi.quantity` 放進摘要。
  --      LEFT JOIN 是為了讓「品項存在而沒有取消列」也留下形狀 —— 少了它, 一張**沒有任何取消列**
  --      的單, 摘要前後都是 `0|-` ⇒ 改 `oi.quantity` 完全看不見(逐點突變實測:世界⑰ 由紅轉綠)。
  -- 🔵 **而我原本還把 `ci.order_item_id` 放進摘要, 量完之後拿掉了** ——
  --    逐點突變(**2026-09-02 R2 修完當下、那時的世界集是 23 個**;R3 之後 ⑯⑱ 被宣告不可達而移除,
  --    今天是 21 個)⇒ 只拿掉它 ⇒ **當時那 23 個世界仍然全綠** ⇒ **沒有任何一格需要它**
  --    🔴 **數字帶時點是因為本檔 apply 之後連註解都改不了** —— 一個沒有時點的數字,
  --    下一個人重跑會複現不出來, 而他分不出「我做錯了」與「那個數字本來就是別的世界集量的」。
  --    (「搬到同單另一個品項」那一格是靠 `ORDER BY oi.id` 讓聚合順序變了而抓到的, 不是靠它)。
  --    📌 **一段沒有世界殺得死的保護, 與沒有寫它, 在行為上相同 —— 而它會讓下一個人以為那裡有防護。**
  SELECT count(*)::text || '|' || coalesce(pg_catalog.md5(
           pg_catalog.string_agg(
             oi.id::text || '#' || oi.quantity::text || '#' ||
             coalesce(ci.id::text, '-') || ':' || coalesce(ci.cancelled_quantity::text, '-'),
             ',' ORDER BY oi.id, ci.id NULLS FIRST)), '-')
    INTO v_q0
    FROM public.order_items oi
    LEFT JOIN public.order_cancellation_items ci ON ci.order_item_id = oi.id
   WHERE oi.order_id = p_order_id;

  -- 步8 寫對客欄 + 訊號欄
  UPDATE public.orders
     SET cancelled_at            = pg_catalog.now(),
         cancelled_reason        = v_reason_txt,
         cancel_items_untouched  = true,
         updated_at              = pg_catalog.now()
   WHERE id = p_order_id;
  -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步9 稽核。🔴 action 用 'order.mark_cancelled' **刻意不是 'order.cancel'** ——
  --    既有的冪等格與守門是用 `g.action = 'order.cancel'` 去撈的
  --    (`20260830020000` 檔內,錨字串 `g.action = 'order.cancel'`)
  --    ⇒ 兩支共用同一個 action ⇒ **它們會互相認成對方的冪等紀錄**;
  --    而稽核上也要分得出「有動數量的取消」與「只標記」。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.mark_cancelled', 'order:' || p_order_id::text, p_idempotency_key::text,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', NULL, 'cancel_items_untouched', false),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', pg_catalog.now(), 'cancel_items_untouched', true),
          p_reason_code, 'admin');
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步10 🔴🔴 **【不寫數量】要寫成一道會炸的斷言, 不是一句「我們不寫」。**
  --    ⚠️ 比的是【前後相等】不是【等於 0】——
  --      一張被部分取消過而沒關單的單, 它的 cancellation_items 本來就不是 0
  --      (`20260805100000` 檔內, 錨 `v_closed` —— 部分取消只有關單時才寫 cancelled_at)。
  --    📌 **斷言要證的是【我的非動作】, 不是【世界的狀態】。**
  -- 🔴 R2 must-fix:摘要**只含 `ci.id:數量` 還是不夠** ——
  --    ①副作用改 `order_items.quantity` ②把取消量搬到【同一張單的另一個 order_item_id】
  --    ⇒ 兩種摘要都完全相同, 而數量真的變了。
  --    ⇒ 分母改成【從 order_items 出發 LEFT JOIN】, 並把 `oi.id` / `oi.quantity` 放進摘要。
  --      LEFT JOIN 是為了讓「品項存在而沒有取消列」也留下形狀 —— 少了它, 一張**沒有任何取消列**
  --      的單, 摘要前後都是 `0|-` ⇒ 改 `oi.quantity` 完全看不見(逐點突變實測:世界⑰ 由紅轉綠)。
  -- 🔵 **而我原本還把 `ci.order_item_id` 放進摘要, 量完之後拿掉了** ——
  --    逐點突變(**2026-09-02 R2 修完當下、那時的世界集是 23 個**;R3 之後 ⑯⑱ 被宣告不可達而移除,
  --    今天是 21 個)⇒ 只拿掉它 ⇒ **當時那 23 個世界仍然全綠** ⇒ **沒有任何一格需要它**
  --    🔴 **數字帶時點是因為本檔 apply 之後連註解都改不了** —— 一個沒有時點的數字,
  --    下一個人重跑會複現不出來, 而他分不出「我做錯了」與「那個數字本來就是別的世界集量的」。
  --    (「搬到同單另一個品項」那一格是靠 `ORDER BY oi.id` 讓聚合順序變了而抓到的, 不是靠它)。
  --    📌 **一段沒有世界殺得死的保護, 與沒有寫它, 在行為上相同 —— 而它會讓下一個人以為那裡有防護。**
  SELECT count(*)::text || '|' || coalesce(pg_catalog.md5(
           pg_catalog.string_agg(
             oi.id::text || '#' || oi.quantity::text || '#' ||
             coalesce(ci.id::text, '-') || ':' || coalesce(ci.cancelled_quantity::text, '-'),
             ',' ORDER BY oi.id, ci.id NULLS FIRST)), '-')
    INTO v_q1
    FROM public.order_items oi
    LEFT JOIN public.order_cancellation_items ci ON ci.order_item_id = oi.id
   WHERE oi.order_id = p_order_id;
  IF v_q1 IS DISTINCT FROM v_q0 THEN
    RAISE EXCEPTION 'admin_mark_order_cancelled: 只標記那條路動到了品項數量(前 % 後 %)⇒ 契約被破壞, 全回滾', v_q0, v_q1;
  END IF;

  RETURN pg_catalog.jsonb_build_object('marked', true, 'idempotent', false);
END;
$fn$;
DO $$
DECLARE v_old text;
BEGIN
  v_old := pg_catalog.obj_description('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:admin_mark_order_cancelled 讀不到既有 COMMENT ⇒ 停下';
  END IF;
  IF pg_catalog.strpos(v_old, '20260903093000') > 0 THEN
    RAISE EXCEPTION 'COMMENT 附加:看起來已經附加過 ⇒ forward-only,拒重跑';
  END IF;
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.admin_mark_order_cancelled(uuid,uuid,text,text,text) IS %L',
    v_old || ' 🔴 2026-09-03(⟦b4-CANCELKINDBYCONTENT⟧):p_reason_code=''other'' 的員工原文'
          || '不得逐字等於 `payment_expired`(理由與射程同 admin_cancel_order 同日那段)。'
          || '🛑 兩支函式的這道拒絕**必須同字面** —— 只改一支等於沒改。落點 20260903093000。');
END
$$;

-- ── 4. 收權(縱深;`CREATE OR REPLACE` 本來就保留 ACL,這幾行是再做一次)─────
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_cancelled(uuid, uuid, text, text, text) TO service_role;

-- ── 5. 事後閘 ───────────────────────────────────────────────────────────
-- 🔴 **它讀的是【資料庫裡那兩支函式的定義】, 不是本檔的字面** ——
--    本檔的字面必然含那道 IF(我剛寫的), 拿它自己驗自己是恆真。
-- 🔴 **codex R1 must-fix(5/8 · 8/8)兩格已修**:
--    ① ~~`WHERE proname = 'admin_cancel_order' LIMIT 1`~~ ⇒ **overload 會被隨機挑一支**
--       ⇒ 改用 `regprocedure` 釘死完整簽章。
--    ② ~~只找三段文字~~ ⇒ 那三段在「guard 被搬到賦值【之後】」的世界裡**照樣全在**
--       ⇒ 改成釘**順序**:那道 IF 必須出現在 `v_reason_txt := v_detail;` **之前**。
--    ③ 補上**全稱 ACL 閘**(照 20260830020000:652-683 同款)—— `has_*_privilege` 逐個角色問,
--       答不出「有沒有第三個角色」也答不出 `WITH GRANT OPTION`。
DO $gate$
DECLARE
  v_sigs text[] := ARRAY[
    'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)',
    'public.admin_mark_order_cancelled(uuid,uuid,text,text,text)'
  ]::text[];
  v_sig   text;
  v_oid   oid;
  v_def   text;
  v_owner oid;
  v_acl   aclitem[];
  v_bad   text;
  v_p_if  int;
  v_p_asg int;
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    v_oid := pg_catalog.to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:找不到 % ⇒ 本閘沒有接上', v_sig;
    END IF;
    v_def := pg_catalog.pg_get_functiondef(v_oid);

    -- 正對照:那道拒絕在不在(訊息字面)
    IF pg_catalog.strpos(v_def, '取消說明不可使用系統保留字') = 0 THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:% 的定義裡找不到那道拒絕 ⇒ 沒裝上', v_sig;
    END IF;
    -- 🔴 **形狀 + 順序**:判斷式本身要在, 而且要在賦值【之前】——
    --    只驗訊息字面的話,「IF 被搬到賦值之後」與「IF 還在原位」印同一個通過。
    -- 🔴🔴 **R2 F3:錨是【整句 `IF … THEN`】, 不是裸條件** —— 而那是一發突變逼出來的:
    --    `IF NOT (v_detail = 'payment_expired') THEN` ⇒ **語意整個反過來**(只有這個字放行, 其他全擋),
    --    而裸條件那把尺對它印**綠**。同族還有 `… AND false THEN` / `… AND p_actor = '__never__' THEN`。
    --    📌 **那三發都是「看起來還在、實際不生效」** —— 與本片其他五發同一類, 而它們沒被涵蓋。
    --    ⚠️ **天花板要寫明**:把真閘包進一個到不了的分支(`IF FALSE THEN … END IF;`, 或 `ELSIF` 接在恆真分支之後)**這把尺仍然綠** ——
    --       「這段碼到得了嗎」不是文字尺答得出來的問題。那一格今天沒有守門。
    v_p_if  := pg_catalog.strpos(v_def, 'IF v_detail = ''payment_expired'' THEN');
    v_p_asg := pg_catalog.strpos(v_def, 'v_reason_txt := v_detail;');
    IF v_p_if = 0 THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:% 找不到整句 `IF v_detail = ''payment_expired'' THEN` ⇒ 條件被改寫過(NOT / AND false / 只剩訊息)', v_sig;
    END IF;
    IF v_p_asg = 0 THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:% 找不到 v_reason_txt := v_detail; ⇒ 那幾百行被抄壞了', v_sig;
    END IF;
    IF v_p_if > v_p_asg THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:% 那道 IF 排在賦值【之後】⇒ 員工原文已經進去了才擋, 等於沒擋', v_sig;
    END IF;
    -- 🔴 **R2 F4:中間那個必須是 `RAISE EXCEPTION`, 不是別的** ——
    --    把它換成 `RAISE NOTICE`(訊息一個字不動)⇒ 員工照樣打得進去, 而本閘原本【照樣通過】。
    --    🎯 而本閘是**唯一讀「真的被貼進去的那份」**的尺(TS 那把讀的是 repo 檔,
    --       而 apply 是人手貼 SQL Editor ⇒ 兩者可以不同)⇒ 這一格漏掉, 就沒有第二個人會發現。
    IF pg_catalog.strpos(
         pg_catalog.substr(v_def, v_p_if, v_p_asg - v_p_if), 'RAISE EXCEPTION') = 0 THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:% 判斷式與賦值之間沒有 RAISE EXCEPTION(被換成 NOTICE / WARNING?)⇒ 那不是一道拒絕', v_sig;
    END IF;

    -- 🔵 負對照:既有行為字面還在(證明沒把整支抄掉一半)
    IF pg_catalog.strpos(v_def, '未知取消原因碼') = 0
       OR pg_catalog.strpos(v_def, '非 other 不得填說明') = 0 THEN
      RAISE EXCEPTION 'b4cancelkind 事後閘:% 既有的驗證句不見了 ⇒ 抄壞了', v_sig;
    END IF;

    -- 全稱 ACL 閘
    SELECT proowner, proacl INTO v_owner, v_acl FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION 'ACL 閘:% 的 proacl 是 NULL ⇒ PUBLIC 預設可執行,而上面幾行應該已經寫過它 ⇒ 停下', v_sig;
    END IF;
    SELECT pg_catalog.string_agg(pg_catalog.format('%s:%s%s',
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
             a.privilege_type, CASE WHEN a.is_grantable THEN '(WITH GRANT OPTION)' ELSE '' END), ', ')
      INTO v_bad
      FROM pg_catalog.aclexplode(v_acl) a
     WHERE a.is_grantable
        OR a.grantee = 0
        OR (a.grantee <> v_owner AND a.grantee <> 'service_role'::regrole);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'ACL 閘:%(SECURITY DEFINER、動錢)有不該有的授權 ⇒ %', v_sig, v_bad;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACL 閘正對照:% 的 service_role 呼不到 ⇒ 上面那個乾淨的結論作廢', v_sig;
    END IF;

    RAISE NOTICE 'b4cancelkind 事後閘通過:% —— 拒絕已裝上且排在賦值之前、既有驗證句仍在、ACL 只有 owner + service_role', v_sig;
  END LOOP;
END
$gate$;

COMMIT;
