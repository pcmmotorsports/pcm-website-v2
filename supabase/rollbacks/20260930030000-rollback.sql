-- 20260930030000-rollback.sql · 貼板 255 的回滾:把 `has_arrived_unshipped` 關掉(固定 false)。
--
-- 為什麼不是 DROP 欄位:`CREATE OR REPLACE VIEW` 拔不掉欄, 要拔得 DROP VIEW 重建, 連帶要補 service_role /
--   pcm_readonly 兩道 GRANT、security_invoker 與每一欄的 COMMENT(20260914020000 檔頭「回退」那段同一個理由)。
--   ⇒ 回滾改成「欄位還在、值固定 false」:形狀不變、權限與 COMMENT 原地保留, 讀它的篩選一律撈不到 = 功能關閉。
-- 🔴 先退讀它的程式, 再貼本檔(程式讀一個恆 false 的欄位不會錯, 只是那一格永遠 0;反過來也不會壞)。
-- 其餘 45 欄逐字照抄 20260930030000(= 20260914020000 那一版)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_cols int;
  v_last text;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v';
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v'
   ORDER BY ordinal_position DESC LIMIT 1;
  IF v_cols <> 46 OR v_last IS DISTINCT FROM 'has_arrived_unshipped' THEN
    RAISE EXCEPTION '回滾前置閘:admin_order_list_v 有 % 欄、最後一欄 %(期望 46 / has_arrived_unshipped)⇒ 20260930030000 沒貼過或有人又加了一代, 停', v_cols, v_last;
  END IF;
END
$precondition$;

CREATE OR REPLACE VIEW public.admin_order_list_v
  WITH (security_invoker = true) AS
SELECT
  -- ⛔ ~~契約①:`orders` 全欄原樣帶出。不要改成逐欄列舉再加工。~~ ⇒ `o.*`
  -- 🔴🔴 **改成【逐欄列舉】—— 而那是 `migration-new-file-static-checks` ⑤ 擋下我的。**
  --    那道閘逐字:「底表日後加一欄, 任何人重跑這支就可能炸 —— 而錯誤訊息長得像他自己弄壞的」。
  --    ⇒ 🛑 **而本檔存在的理由就是那件事已經發生過一次**(`tax_total` 加了而 view 看不到)
  --      ⇒ **再寫一次 `o.*` 等於把同一顆地雷重新埋回去。**
  --    ⇒ 📌 **一道閘擋下我的那一刻, 我原本想寫的是【豁免】** —— 而豁免會讓下一個人再踩一次。
  -- 🔬 **這 41 欄是唯讀去正式庫撈的**(`pg_attribute` 依 `attnum` 排序), 不是我照原始 migration 抄的
  --    —— 抄原始碼會漏掉 `20260823030000` 之後加的每一欄(那正是本檔在修的病)。
  -- ⚠️ **代價明寫**:逐欄列舉之後, **下一次 `orders` 加欄, 這支 view 一樣看不到** ——
  --    差別在**那時 static-checks ⑤ 不會再叫**(它只擋 `別名.*`)⇒ 🔴 **這一段留給下一個人**:
  --    加欄時請一起問「`admin_order_list_v` 要不要跟」, 而**沒有機制會提醒你**。
  o.id,
  o.display_id,
  o.customer_user_id,
  o.address_id,
  o.shipping_address_snapshot,
  o.tier_at_checkout,
  o.payment_status,
  o.fulfillment_status,
  o.subtotal,
  o.shipping_fee,
  o.discount_total,
  o.total,
  o.shipping_method,
  o.invoice,
  o.tappay_rec_trade_id,
  o.paid_at,
  o.payment_method,
  o.created_at,
  o.updated_at,
  o.cart_session_id,
  o.display_position,
  o.order_source,
  o.payment_channel,
  o.cancelled_at,
  o.cancelled_reason,
  o.version,
  o.workflow_status,
  o.invoice_number,
  o.invoice_amount,
  o.invoice_status,
  o.notification_email,
  o.shipping_free_threshold,
  o.shipping_home_fee,
  o.shipping_method_at_checkout,
  o.legacy_display_id,
  -- 🔴 契約②:純量子查詢,不 join、不 GROUP BY。CASE 順序逐字對齊 orderGoodsAxis()。
  --    `#522`:分母一律 `GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0)`。
  --    ⚠️ **`GREATEST(…, 0)` 對【回傳值】其實沒有作用**(code-reviewer 2026-08-16 抓的,他是對的):
  --       三條判定都是「非負值 `>=` need」,把 need 從負夾成 0 不改變任何一次比較的真假
  --       (`0 >= -1` 與 `0 >= 0` 同為 true)⇒ **它什麼都沒防**。
  --       留著是為了讓運算式的**意圖**看得出來(need 不會是負數),
  --       **不要以為那裡有一道線** —— 真正擋 `cancelled > quantity` 的是摘要表 CHECK C6
  --       `cancelled <= quantity`(`20260730150000:116`)。
  (
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id) THEN 'none'
      WHEN (
        SELECT bool_and(
          COALESCE(s.shipped_quantity, 0)
            >= GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0))
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'shipped'
      WHEN (
        SELECT bool_and(
          COALESCE(s.instock_quantity, 0)
            >= GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0))
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'instock'
      WHEN (
        SELECT bool_and(
          COALESCE(s.ordered_quantity, 0)
            >= GREATEST(oi.quantity - COALESCE(s.cancelled_quantity, 0), 0))
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'ordered'
      ELSE 'none'
    END
  ) AS goods_axis,
  -- 🔴 契約③(`#841` 新增):**純量子查詢,形狀刻意與 `goods_axis` 同款** —— 不 join。
  --    用 LEFT JOIN 也做得到,而純量子查詢多兩件事:
  --      ① 上游若哪天變成一單多列,`LEFT JOIN` 會**安靜地把訂單複製成多列**(分頁與 count 一起壞),
  --         純量子查詢則直接 `ERROR: more than one row returned by a subquery` ⇒ **吵著死,不是安靜地錯**
  --      ② `FROM` 子句一個字不動 ⇒ `CREATE OR REPLACE` 是純加法,既有 15 欄與四層 embed 的形狀不受影響
  --
  -- 🔴🔴 **這個 COALESCE 是承重的,不是保險絲**:`order_paid_totals_v` 只為【有收款列的單】產生列
  --    ⇒ 沒收過款的單在這裡是 **零列 ⇒ 純量子查詢回 NULL**,而 PostgREST 的 `paid_total.neq.0`
  --    碰到 NULL 回 NULL(不是 true)⇒ 那些單**照樣被藏**。
  --    ⚠️ 於是「規則藏對了」與「NULL 巧合藏對了」在畫面上長得一模一樣,**而三綠與 mock 單測全綠**
  --    (同款警告逐字見 `20260815010000_m4b_e10_16_admin_today_payment_total.sql:24-26`)。
  --    ⇒ 下面 §7 的驗收 ⑦c 就是專門紅這一格的;拿掉 COALESCE 而庫裡有任何一張單 ⇒ **必紅**
--      (NULL `IS DISTINCT FROM` 實際 SUM ⇒ true)。
  --
  -- 🔴 口徑不得自創:「已收 = SUM(amount)」是承重不變式(`20260810100000:197`),
  --    沖銷列帶負值 ⇒ **直接加總、不得過濾負列、不得 ABS、不得只算非沖銷列**
  --    (`20260815010000:18-20` 逐字)。淨額 0 = 收了又沖掉 = 錢不在我們手上 ⇒ 該藏。
  --    ⚠️ **加總看正負是對的;分類看正負是錯的** —— 要認哪列是沖銷只准看 `is_reversal`
  --    (`apps/admin/src/lib/orders/payment-list-view.ts:28-31`)。本欄只加總,不分類。
  -- 🔴🔴 `COALESCE` 必須包在【純量子查詢外面】—— 包在裡面等於沒有:
  --    子查詢命中零列時,回 NULL 的是**子查詢本身**,裡面的 COALESCE 一次都沒執行。
  --    (2026-08-23 我第一版就是寫在裡面,真表實測 `paid_total=NULL`;當時的斷言 ④ 紅了、抓到它。
--     ④ 後來被 ⑦c 取代 —— 理由見那一段。)
  COALESCE((
    SELECT t.paid_total
      FROM public.order_paid_totals_v t
     WHERE t.order_id = o.id
  ), 0) AS paid_total,
  -- 🔴🔴 **這六欄【必須】在最後, 而那不是風格是硬約束**(2026-09-05 正式庫實測撞到):
  --    `CREATE OR REPLACE VIEW` **不能改既有欄的名字與位置**, 只能在**尾巴附加**。
  --    ⛔ 第一版我把它們插在 `legacy_display_id` 之後(照 `orders` 表的欄序)
  --       ⇒ 第 36 位從 `goods_axis` 變成 `manual_request_id`
  --       ⇒ Sean 貼下去逐字紅:
  --         `ERROR: 42P16: cannot change name of view column "goods_axis" to "manual_request_id"`
  --    ⇒ 📌 **「我只是加欄」與「我改了欄序」在 diff 上長得一樣, 而 PG 分得出來。**
  --    🔵 而搬到尾巴之後**不必 DROP VIEW** —— ACL、`COMMENT ON`、`security_invoker` 全部原地保留。
  o.manual_request_id,
  o.manual_request_payload_sha256,
  o.cancel_items_untouched,
  o.coupon_id,
  o.tax_total,
  o.invoice_requested,
  -- ⛔ ~~🔴 **第 44 欄, 而它【必須在最後】**~~(那是 `20260905360000` 的字面, 本支起第 44 欄後面還有一欄)—— `CREATE OR REPLACE VIEW` 只能在尾巴附加。
  --    2026-09-05 我在 `20260905230000` 第一版把新欄插在中間, Sean 貼下去逐字紅:
  --    `ERROR: 42P16: cannot change name of view column "goods_axis" to "manual_request_id"`
  --    📌 **「我只是加欄」與「我改了欄序」在 diff 上長得一樣, 而 PG 分得出來。**
  o.price_tax_mode,
  -- 🔴 **第 45 欄, 而它【必須在最後】**(理由見檔頭)。Q5 乙「多樣的單」:品項【列數】, 不扣已取消的件(ceiling 見檔頭)。
  --    純量子查詢、不 join(契約②③同款:FROM 子句一個字不動, CREATE OR REPLACE 是純加法)。
  (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id)::int AS item_count,
  -- 回滾 20260930030000:欄位留著(CREATE OR REPLACE 拔不掉欄), 值固定 false ⇒ 讀它的篩選一律撈不到, 等同功能關閉。
  false AS has_arrived_unshipped
FROM public.orders o;

DO $postcondition$
DECLARE
  v_oid oid := 'public.admin_order_list_v'::regclass;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admin_order_list_v') <> 46 THEN
    RAISE EXCEPTION '回滾事後閘:欄數不是 46';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_order_list_v WHERE has_arrived_unshipped) THEN
    RAISE EXCEPTION '回滾事後閘:has_arrived_unshipped 還有 true';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = v_oid AND c.reloptions @> ARRAY['security_invoker=true'])
     OR NOT pg_catalog.has_table_privilege('service_role', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '回滾事後閘:security_invoker 或 service_role SELECT 不見了';
  END IF;
  RAISE NOTICE '✅ 20260930030000 回滾:has_arrived_unshipped 固定 false(欄位保留), 權限不變';
END
$postcondition$;

COMMIT;
