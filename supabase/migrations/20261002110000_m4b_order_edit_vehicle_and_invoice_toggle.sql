-- 20261002110000  訂單「編輯個資」可以改車款年份、可以改要不要開發票(貼板 264)
-- pcm:idempotent: yes
--   (重跑安全的理由:整支包在 BEGIN … COMMIT 單一交易;BEGIN 後第一個動作是前置閘比對函式 md5。
--    已貼過再跑 ⇒ 函式已是新版 ⇒ 前置閘 RAISE ⇒ 整筆回滾;中途失敗 ⇒ 整筆已回滾, 重跑等於第一次跑。)
-- 計畫:~/pcm-mailbox/計畫-訂單車款年份與明細紙-20261002.md
--
-- Sean 2026-10-02:
--   · 車款:建立後要能改車款與年份, 留操作紀錄;Q30 甲 不同步客人的「我的愛車」(customer_vehicles)。
--   · 發票 Q2 甲(知情推翻 09-04 第十六、十八、十九題):沒勾開發票的單之後可以改成要開, 總額自動加 5% 稅、客人補差額,
--     已付款變部分付款;改回不開時稅拿掉、多收的走待退款;已登記發票號碼的不能改回不開。
--
-- 改什麼(兩支, 都是 CREATE OR REPLACE、簽章不變 ⇒ ACL / OWNER 保留):
--   ① admin_update_order_workflow 第 6 代 = 正式庫第 5 代(20260915070000, md5 e263af1a…)+ p_patch 兩個新鍵:
--      vehicle(物件 / null)、invoice_requested(布林)。稅與總額重算後, 沿用既有兩支重算待退款與付款狀態,
--      重算完自己再驗一次結清判定, 對不上整筆回滾。操作紀錄沿用 order.workflow.update, before/after 多五個鍵。
--   ② pcm_invoice_requested_false_is_final:「不開 ⇒ 要開」只在本交易拿到通行證時放行
--      (只有 ① 會發:set_config('pcm.invoice_requested_on_by_rpc','on', true)),其他路徑照舊擋;第二段(在待開票名單上不能改回不開)不動。
--   ③ pcm_order_effective_amounts_v(Sean 2026-10-02 Q3 甲):手動單的「剩下應收」運費照員工建單時填的(orders.shipping_fee),
--      不套網站規則(自取 0 / 滿 5,000 免運 / 否則 100)。修掉既有的錯:已付款的手動單改出貨方式, 系統會多開一筆運費差額的待退款
--      (拋棄式 PG 實測 7900 單改自取 ⇒ 待退款 200)。網站單的規則一個字不動。依賴它的三支信件 view 跟著吃到正確運費。
--   ④ admin_order_list_v 尾巴加一欄 o.vehicle_snapshot(後台訂單列表的車款欄)。回滾不拿掉這一欄(CREATE OR REPLACE VIEW 不能減欄;多一欄無害)。
--   不改:orders_no_invoice_when_not_requested(不開的單不准有發票號碼)、pending_invoices 那道、結清 / 待退款 / 總額三支函式本體。
--
-- 順序:先貼本支, 再推後台程式(簽章不變 ⇒ 舊程式照常;新程式先上的話, 只有「改車 / 改發票」那一次會被擋)。
-- 回滾:supabase/rollbacks/20261002110000-rollback.sql(兩支換回貼前版本;已經改過的資料是正常資料, 不動)。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ═══ 前置閘:要改的兩支是貼前版本、要呼叫的四支是 2026-10-02 唯讀量到的版本 ═══
DO $pre$
DECLARE v_got text;
BEGIN
  SELECT pg_catalog.string_agg(p.proname || '=' || pg_catalog.md5(p.prosrc), ',' ORDER BY p.proname) INTO v_got
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_update_order_workflow', 'pcm_invoice_requested_false_is_final', 'pcm_noncard_settle_recompute',
                       'pcm_partial_cancel_recompute', 'admin_compute_order_settlement', 'pcm_order_total');
  IF v_got IS DISTINCT FROM
     'admin_compute_order_settlement=f134e95d24e768a84fd53d26f29aed70,admin_update_order_workflow=e263af1afb7f0c96d60f881283839204,'
     'pcm_invoice_requested_false_is_final=927668019d2dfc87bcd2427042a33351,pcm_noncard_settle_recompute=b9878df98a4000844024aedfb8b907c1,'
     'pcm_order_total=68fa4a822584a324c65f321ca404c49f,pcm_partial_cancel_recompute=fca021185afc790b48ca8e10e43a0809' THEN
    RAISE EXCEPTION '貼板 264 前置閘:函式與 2026-10-02 正式庫版本不同(有人改過或多了重載)⇒ 停止。實得 %', v_got;
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_viewdef('public.pcm_order_effective_amounts_v'::regclass, true))
     IS DISTINCT FROM '89c088a1f021259dc62916c9ffbb3343' THEN
    RAISE EXCEPTION '貼板 264 前置閘:pcm_order_effective_amounts_v 與 2026-10-02 正式庫版本不同 ⇒ 停止';
  END IF;
  -- 兩個值都收:e782dcb3… = 正式庫 2026-10-02;8db6f25e… = 本支貼過又回滾(回滾不拿掉 vehicle_snapshot 那一欄, 其餘相同)。
  IF pg_catalog.md5(pg_catalog.pg_get_viewdef('public.admin_order_list_v'::regclass, true))
     NOT IN ('e782dcb3f195f41ea6e3eaa700929efa', '8db6f25e5995b68f7a16f1e91292269e') THEN
    RAISE EXCEPTION '貼板 264 前置閘:admin_order_list_v 與 2026-10-02 正式庫版本不同 ⇒ 停止';
  END IF;
END
$pre$;

-- ═══ ③ 剩下應收的運費:手動單照員工填的(Sean 2026-10-02 Q3 甲)═══
--   本體 = 正式庫 2026-10-02 版本(20260909100000:120, pg_get_viewdef md5 89c088a1…), 三個運費 CASE 各加最前面一條:
--   `WHEN o.order_source <> 'web' THEN o.shipping_fee`。欄位名與型別不變 ⇒ 依賴它的 view 不受影響。
CREATE OR REPLACE VIEW public.pcm_order_effective_amounts_v AS
 SELECT o.id AS order_id,
    eff.effective_subtotal,
        CASE
            WHEN o.order_source <> 'web'::text THEN o.shipping_fee
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END AS effective_shipping_fee,
    (eff.effective_subtotal +
        CASE
            WHEN o.order_source <> 'web'::text THEN o.shipping_fee
            WHEN o.shipping_method = 'store'::text THEN 0
            WHEN eff.effective_subtotal >= 5000 THEN 0
            ELSE 100
        END)::integer AS effective_total,
    CASE
        WHEN o.tax_total <> 0 THEN NULL::bigint
        ELSE eff.effective_subtotal +
            CASE
                WHEN o.order_source <> 'web'::text THEN o.shipping_fee
            WHEN o.shipping_method = 'store'::text THEN 0
                WHEN eff.effective_subtotal >= 5000 THEN 0
                ELSE 100
            END - (o.total - bal.balance_due)
    END AS effective_balance_due
   FROM orders o
     JOIN order_balance_base_v bal ON bal.order_id = o.id
     CROSS JOIN LATERAL ( SELECT COALESCE(sum((oi.quantity - COALESCE(( SELECT sum(ci.cancelled_quantity) AS sum
                   FROM order_cancellation_items ci
                  WHERE ci.order_item_id = oi.id), 0::bigint)) * oi.unit_price), 0::numeric)::bigint AS effective_subtotal
           FROM order_items oi
          WHERE oi.order_id = o.id) eff;

-- ═══ ④ 訂單列表 view 多一欄訂單上的車(後台列表的車款欄;本機後台實跑抓到:程式讀這欄而 view 沒有 ⇒ 整個列表載入失敗)═══
--   本體 = 正式庫 2026-10-02 版本(20260930040000:61, pg_get_viewdef md5 e782dcb3…)+ 尾巴一欄 o.vehicle_snapshot。
--   security_invoker 與 GRANT 由 CREATE OR REPLACE 保留(下面事後斷言再核一次)。🔴 先貼本支再推程式, 否則列表會壞。
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
  -- 🆕 20260930030000(貼板 255):第 46 欄, 只能附加在尾巴(同上面 item_count 那段理由)。
  --    這張單有沒有「已經到貨、還沒出完」的品項 = 部分到貨也可以先出。定義與列表的 `arrivedLineCount`
  --    (`apps/admin/src/lib/orders/order-status-axes.ts`)同一條:到貨數 − 出貨數 > 0。沒有摘要列 ⇒ 不算。
  --    形狀照 `goods_axis` / `item_count`:純量子查詢, 外層不 join, 不改列數。
  EXISTS (
    SELECT 1
      FROM public.order_items oi
      JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
     WHERE oi.order_id = o.id
       AND s.instock_quantity - s.shipped_quantity > 0
  ) AS has_arrived_unshipped,
  -- 🆕 20260930040000(貼板 256):第 47 欄, 只能附加在尾巴(同上面兩欄的理由)。
  --    「逾期未到」:這張單有沒有一筆採購 = 沒作廢、預計到貨日早於【台北今天】、到貨數 < 訂貨數。
  --    🔴 「今天」用 `now() AT TIME ZONE 'Asia/Taipei'`, 不用 `current_date`:PostgREST 連線時區是 UTC,
  --       `current_date` 在台北早上 8 點前會差一天(同一筆昨天到期的單, 早上 7 點看不到)。
  --    沒填預計到貨日的採購不算(`NULL < 日期` 是 NULL)。索引:order_item_procurement_business_key(order_item_id, …) WHERE voided_at IS NULL。
  EXISTS (
    SELECT 1
      FROM public.order_items oi
      JOIN public.order_item_procurement p ON p.order_item_id = oi.id
     WHERE oi.order_id = o.id
       AND p.voided_at IS NULL
       AND p.expected_arrival_date < (now() AT TIME ZONE 'Asia/Taipei')::date
       AND p.received_quantity < p.allocated_quantity
  ) AS has_overdue_arrival,
  -- 貼板 264(Sean 2026-10-02):列表的車款欄要看得到手動單【訂單上】的車(年份 品牌 車型)。只加在最後一欄(CREATE OR REPLACE VIEW 只准在尾巴加欄)。
  o.vehicle_snapshot
FROM public.orders o;

-- ═══ ② 09-04 那道觸發器:「不開 ⇒ 要開」只放行本交易拿到通行證的(= ① 那支函式)═══
CREATE OR REPLACE FUNCTION public.pcm_invoice_requested_false_is_final()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- 貼板 264(Sean 2026-10-02 Q2 甲, 知情推翻 09-04 第十六題):改成要開只能走「編輯個資」那支函式 ——
  --   它會同時把 5% 稅加進總額並重算付款狀態;其他路徑直接翻這個旗標, 稅與總額會對不上, 照舊擋。
  IF OLD.invoice_requested IS FALSE AND NEW.invoice_requested IS TRUE
     AND pg_catalog.current_setting('pcm.invoice_requested_on_by_rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION
      '這張單建單時選了不開發票, 要改成要開請在訂單頁「編輯個資」操作。(訂單 %)', OLD.display_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.invoice_requested IS FALSE AND OLD.invoice_requested IS TRUE
     AND EXISTS (SELECT 1 FROM public.pending_invoices pi WHERE pi.order_id = NEW.id) THEN
    RAISE EXCEPTION
      '這張單已經在待開票名單上, 不能改成不開發票。要改請先處理那筆待開票。(訂單 %)', NEW.display_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;  -- AFTER trigger 的回傳值被忽略
END
$fn$;
COMMENT ON FUNCTION public.pcm_invoice_requested_false_is_final() IS
  'orders.invoice_requested 的守門。false ⇒ true:只放行 admin_update_order_workflow(貼板 264 起;本交易 set_config pcm.invoice_requested_on_by_rpc = on, 它同時重算稅、總額與付款狀態), 其他路徑照舊擋(Sean 2026-10-02 Q2 甲推翻 09-04 第十六題「任何改動都擋」)。true ⇒ false:在待開票名單上就擋。🔴 AFTER 不是 BEFORE:BEFORE 依名字順序跑, 排在後面的 trigger 可以在檢查之後改掉那個值。';

-- ═══ ① 編輯個資 RPC 第 6 代 ═══
CREATE OR REPLACE FUNCTION public.admin_update_order_workflow(
  p_order_id         uuid,
  p_expected_version integer,
  p_patch            jsonb,
  p_actor            text,
  p_request_id       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- 🔴 D-2:workflow_status 已自白名單移除(orders 層停寫;狀態唯一寫入面=admin_update_order_item_workflow)。
  -- 🔴 2026-09-13 P2(第 3 代 050000):加 `invoice_issued_at`(第五欄)。
  -- 🔴 2026-09-13 第 4 代(本支):加 `invoice_title` / `invoice_tax_id`(orders.invoice jsonb 的 title / taxId)。
  v_allowed_keys constant text[] := ARRAY[
    'shipping_method', 'invoice_number', 'invoice_amount', 'invoice_status', 'invoice_issued_at',
    'invoice_title', 'invoice_tax_id',
    -- 🔴 第 5 代(20260915070000, Sean 2026-09-14 自己要的):收件人 / 電話 / 地址 —— 三鍵【全送】才換 orders.shipping_address_snapshot 整包。
    'ship_to_name', 'ship_to_phone', 'ship_to_line',
    -- 貼板 264(Sean 2026-10-02):車款 + 年份、要不要開發票。
    'vehicle', 'invoice_requested'
  ];
  v_key   text;
  v_cur   public.orders%ROWTYPE;
  v_shipping_method   text;
  v_invoice_number    text;
  v_invoice_amount    integer;
  v_invoice_status    text;
  v_invoice_issued_at date;
  v_issued_raw        text;
  v_today_tpe         date;
  v_created_tpe       date;
  -- 第 4 代:抬頭 / 統編
  v_invoice           jsonb;
  v_title             text;
  v_tax_id            text;
  v_ship_to           jsonb;
  v_ship_key          text;
  v_ship_val          text;
  -- 零寬字元(同 20260913020000 那支的 v_zw):U+200B/C/D、U+2060、U+FEFF。
  v_zw constant text := pg_catalog.chr(8203) || pg_catalog.chr(8204) || pg_catalog.chr(8205)
                     || pg_catalog.chr(8288) || pg_catalog.chr(65279);
  v_rows  integer;
  -- 貼板 264:車款(形狀與建單函式同一條)、要不要開發票與跟著它走的稅 / 總額。
  v_vehicle           jsonb;
  v_veh_key           text;
  v_veh_brand         text;
  v_veh_model         text;
  v_veh_raw           text;
  v_veh_year          integer;
  v_invoice_requested boolean;
  v_tax               bigint;
  v_total             bigint;
  v_money_changed     boolean := false;
  v_verdict           text;
  v_status_after      public.payment_status;
  v_net_received      bigint;
BEGIN
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 缺 order_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: expected_version 越界';
  END IF;

  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'admin_update_order_workflow: patch 非 object';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: patch 含非白名單欄';
    END IF;
  END LOOP;
  IF p_patch = '{}'::jsonb THEN
    RETURN 'NOOP';
  END IF;

  SELECT * INTO v_cur FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'CONFLICT';
  END IF;
  IF v_cur.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  v_shipping_method   := v_cur.shipping_method;
  v_invoice_number    := v_cur.invoice_number;
  v_invoice_amount    := v_cur.invoice_amount;
  v_invoice_status    := v_cur.invoice_status;
  v_invoice_issued_at := v_cur.invoice_issued_at;
  v_invoice           := v_cur.invoice;
  v_vehicle           := v_cur.vehicle_snapshot;
  v_invoice_requested := v_cur.invoice_requested;
  v_tax               := v_cur.tax_total;
  v_total             := v_cur.total;

  IF p_patch ? 'shipping_method' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'shipping_method') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 不可為空';
    END IF;
    v_shipping_method := pg_catalog.btrim(p_patch ->> 'shipping_method');
    IF v_shipping_method = '' OR pg_catalog.char_length(v_shipping_method) > 64 THEN
      RAISE EXCEPTION 'admin_update_order_workflow: shipping_method 長度不符';
    END IF;
  END IF;

  IF p_patch ? 'invoice_number' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_number') = 'null' THEN
      v_invoice_number := NULL;
    ELSE
      v_invoice_number := pg_catalog.btrim(p_patch ->> 'invoice_number');
      IF v_invoice_number = '' OR pg_catalog.char_length(v_invoice_number) > 64
         OR v_invoice_number ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_number 非法';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_amount' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') = 'null' THEN
      v_invoice_amount := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_amount') <> 'number' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 非數字';
      END IF;
      v_invoice_amount := (p_patch ->> 'invoice_amount')::integer;
      IF v_invoice_amount < 0 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_amount 為負';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'invoice_status' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_status') = 'null' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 不可為空';
    END IF;
    v_invoice_status := p_patch ->> 'invoice_status';
    IF v_invoice_status NOT IN ('not_issued', 'issued', 'voided') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_status 非三值之一';
    END IF;
  END IF;

  -- ── 2026-09-13 P2:invoice_issued_at ──────────────────────────────────────
  -- 🔴 形狀:jsonb 字串 `YYYY-MM-DD`(TS 那側 `<input type="date">` 的原生值);null = 清空。
  --    先用正規式擋形狀, 再 cast —— cast 自己會擋 2026-02-30 這種假日期(22008), 那走一般錯誤。
  IF p_patch ? 'invoice_issued_at' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_issued_at') = 'null' THEN
      v_invoice_issued_at := NULL;
    ELSE
      IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_issued_at') <> 'string' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_issued_at 非字串';
      END IF;
      v_issued_raw := pg_catalog.btrim(p_patch ->> 'invoice_issued_at');
      IF v_issued_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: invoice_issued_at 形狀不是 YYYY-MM-DD';
      END IF;
      v_invoice_issued_at := v_issued_raw::date;
    END IF;
  END IF;

  -- 🔴🔴 **變成 issued 的那一次必須【明確】帶日期**(理由見檔頭)。
  --    判準是「patch 有沒有那個鍵」, 不是「列上有沒有值」—— 列上的舊值正是要防的東西。
  IF v_cur.invoice_status <> 'issued' AND v_invoice_status = 'issued'
     AND NOT (p_patch ? 'invoice_issued_at') THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 變成已開立時必須帶開立日期'
      USING ERRCODE = 'P9I01';
  END IF;
  -- 🔴 最終狀態是 issued ⇒ 一定要有日期(涵蓋:帶了 null、或列上本來就 NULL 而只改別欄)。
  --    📌 後者會【逼著】把 P1b 之前留下的「已開立而無日期」舊列補齊 —— 那是對的方向。
  IF v_invoice_status = 'issued' AND v_invoice_issued_at IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 已開立的單必須有開立日期'
      USING ERRCODE = 'P9I01';
  END IF;
  -- 🔴 範圍檢查(只在有日期時跑;兩端都用台北日)
  IF v_invoice_issued_at IS NOT NULL THEN
    v_today_tpe   := (pg_catalog.now() AT TIME ZONE 'Asia/Taipei')::date;
    v_created_tpe := (v_cur.created_at AT TIME ZONE 'Asia/Taipei')::date;
    IF v_invoice_issued_at > v_today_tpe THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 開立日期不得是未來(台北日 %)', v_today_tpe
        USING ERRCODE = 'P9I03';
    END IF;
    IF v_invoice_issued_at < v_created_tpe THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 開立日期不得早於訂單成立日(台北日 %)', v_created_tpe
        USING ERRCODE = 'P9I02';
    END IF;
  END IF;

  -- ══ 第 4 代:抬頭 / 統編(兩個 key 一起看, 因為 type 是由兩格一起推的)══════════
  --    plan docs/plans/2026-09-13-invoice-title-taxid-editable-plan.md(Sean 答 Q1 甲, 主視窗裁 Q2-Q4 甲)。
  IF (p_patch ? 'invoice_title') OR (p_patch ? 'invoice_tax_id') THEN

    -- 🔴 捐贈發票沒有抬頭統編這回事(Sean 答甲):碰到就拒, 不靜默改 type。
    IF (v_invoice ->> 'type') = 'donate' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 捐贈發票不可改抬頭 / 統編';
    END IF;

    -- 🔴 codex must-fix 3:只准 string / null。`->>` 會把 {} / 12345678 / true 轉成文字,
    --    CHECK 看到的已經全是字串 ⇒ 擋不住「抬頭 = "{}"」。在轉文字之前拒。
    IF p_patch ? 'invoice_title'
       AND pg_catalog.jsonb_typeof(p_patch -> 'invoice_title') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_title 須為字串';
    END IF;
    IF p_patch ? 'invoice_tax_id'
       AND pg_catalog.jsonb_typeof(p_patch -> 'invoice_tax_id') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_tax_id 須為字串';
    END IF;

    -- 沒送的那一格 ⇒ 沿用現值;送了 ⇒ 用送的(null 也算送了)。
    v_title  := CASE WHEN p_patch ? 'invoice_title'  THEN p_patch ->> 'invoice_title'  ELSE v_invoice ->> 'title' END;
    v_tax_id := CASE WHEN p_patch ? 'invoice_tax_id' THEN p_patch ->> 'invoice_tax_id' ELSE v_invoice ->> 'taxId' END;

    -- 🔴 codex must-fix 1 + 2:**合併之後**再正規化, 兩格走同一條, 不管值是送來的還是沿用的。
    --    · MF1:沿用的舊值可能是 "" 或 7 碼(歷史髒資料)—— 只正規化送來的那一格, 半填判斷會漏。
    --    · MF2:全形空白 U+3000 不會被 btrim() 清掉 ⇒ 「　」會被當成有抬頭 ⇒ 變 company。
    --      ⇒ 先去零寬字元(同 138 那支 v_zw 的做法), 再用 [[:space:]] + U+3000 修邊。
    v_title := pg_catalog.regexp_replace(
                 pg_catalog.translate(v_title, v_zw, ''),
                 E'^[[:space:]\u3000]+|[[:space:]\u3000]+$', '', 'g');
    v_tax_id := pg_catalog.regexp_replace(
                 pg_catalog.translate(v_tax_id, v_zw, ''),
                 E'^[[:space:]\u3000]+|[[:space:]\u3000]+$', '', 'g');
    IF v_title  = '' THEN v_title  := NULL; END IF;
    IF v_tax_id = '' THEN v_tax_id := NULL; END IF;

    -- 驗證也是對【合併後】的值:沿用的舊值一樣要過關(歷史 7 碼統編在這裡會被擋下, 而不是被抄走)。
    IF v_title IS NOT NULL
       AND (pg_catalog.char_length(v_title) > 100 OR v_title ~ '[[:cntrl:]]') THEN
      -- 上限 100 碼位:抄 invoice_number 那格的形狀(64), 公司全名比發票號碼長 ⇒ 放寬到 100。
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_title 非法';
    END IF;
    IF v_tax_id IS NOT NULL AND v_tax_id !~ '^[0-9]{8}$' THEN
      -- 同 apps/admin/src/lib/orders/invoice-title-lookup.ts:27 那條 TAX_ID_RE。
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_tax_id 須為 8 碼數字';
    END IF;

    -- 🔴 半填 ⇒ 拒(公司發票兩格缺一不可;fail-closed, 不替他猜另一格)。
    IF (v_title IS NULL) <> (v_tax_id IS NULL) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 抬頭與統編要一起填、或一起清空';
    END IF;

    -- 🔴 type 隨兩格推(Sean 答甲)。carrier / donateCode 原樣不動。
    IF v_title IS NULL THEN
      v_invoice := (v_invoice - 'title' - 'taxId') || pg_catalog.jsonb_build_object('type', 'personal');
    ELSE
      v_invoice := v_invoice || pg_catalog.jsonb_build_object('type', 'company', 'title', v_title, 'taxId', v_tax_id);
    END IF;
  END IF;

  -- ── 第 5 代:收件人 / 電話 / 地址(orders.shipping_address_snapshot, 出貨彈窗與出貨信讀這一包)──
  --   · 三鍵要【一起】送(半套 RAISE):那道 CHECK 要 exact {name,phone,line} 全字串(20260604120000 系), 部分更新會做出半包。
  --   · 三個都必填、去頭尾空白、擋零寬字元(同抬頭那段 v_zw)、長度上限 name 60 / phone 30 / line 200(對齊顧客站 AddressInput)。
  --   · 已建的箱(shipments.recipient_snapshot)【不動】—— 那是出貨當時的快照;彈窗上有一句講這件。
  IF (p_patch ? 'ship_to_name') OR (p_patch ? 'ship_to_phone') OR (p_patch ? 'ship_to_line') THEN
    IF NOT ((p_patch ? 'ship_to_name') AND (p_patch ? 'ship_to_phone') AND (p_patch ? 'ship_to_line')) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 收件人 / 電話 / 地址要一起送(半套會做出半包快照)';
    END IF;
    v_ship_to := '{}'::jsonb;
    FOREACH v_ship_key IN ARRAY ARRAY['ship_to_name', 'ship_to_phone', 'ship_to_line'] LOOP
      IF pg_catalog.jsonb_typeof(p_patch -> v_ship_key) <> 'string' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: % 須為字串', v_ship_key;
      END IF;
      -- codex must-fix ①:零寬字元【一個都不准】(不是去掉再驗 —— 「零寬 + 空格」會混過);再修邊含 U+3000 與 [[:space:]]。
      IF pg_catalog.translate(p_patch ->> v_ship_key, v_zw, '') <> (p_patch ->> v_ship_key) THEN
        RAISE EXCEPTION 'admin_update_order_workflow: % 含看不見的字元, 請重打', v_ship_key;
      END IF;
      v_ship_val := pg_catalog.regexp_replace(p_patch ->> v_ship_key, E'^[[:space:]\u3000]+|[[:space:]\u3000]+$', '', 'g');
      IF v_ship_val = '' THEN
        RAISE EXCEPTION 'admin_update_order_workflow: % 不可為空', v_ship_key;
      END IF;
      IF pg_catalog.length(v_ship_val) > (CASE v_ship_key WHEN 'ship_to_name' THEN 60 WHEN 'ship_to_phone' THEN 30 ELSE 200 END) THEN
        RAISE EXCEPTION 'admin_update_order_workflow: % 太長', v_ship_key;
      END IF;
      v_ship_to := v_ship_to || pg_catalog.jsonb_build_object(pg_catalog.substr(v_ship_key, 9), v_ship_val);
    END LOOP;
  ELSE
    v_ship_to := v_cur.shipping_address_snapshot;
  END IF;

  -- ── 貼板 264 ①:車款 + 年份(Sean 2026-10-02;只有手動單, 顧客站的單車在品項上)──────────────
  --   形狀與檢查逐字沿用 admin_create_manual_order 第 9 代(263:229-275):{kind:'dict', brand, model, year?} / {kind:'free', raw, year?};
  --   source 由本函式寫(manual_dict / manual_text);null ⇒ 清掉。Sean Q30 甲:不同步客人的「我的愛車」。
  IF p_patch ? 'vehicle' THEN
    IF v_cur.order_source = 'web' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 網站訂單的車記在品項上, 這裡不能改' USING ERRCODE = 'P9V01';
    END IF;
    IF pg_catalog.jsonb_typeof(p_patch -> 'vehicle') = 'null' THEN
      v_vehicle := NULL;
    ELSIF pg_catalog.jsonb_typeof(p_patch -> 'vehicle') <> 'object' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 車輛不是物件(%)', pg_catalog.jsonb_typeof(p_patch -> 'vehicle');
    ELSE
      FOR v_veh_key IN SELECT pg_catalog.unnest(ARRAY['brand', 'model', 'raw']) LOOP
        IF (p_patch -> 'vehicle') ? v_veh_key AND pg_catalog.jsonb_typeof(p_patch -> 'vehicle' -> v_veh_key) NOT IN ('string', 'null') THEN
          RAISE EXCEPTION 'admin_update_order_workflow: 車輛 % 要是字串', v_veh_key;
        END IF;
      END LOOP;
      v_veh_brand := NULLIF(pg_catalog.btrim(p_patch -> 'vehicle' ->> 'brand', E' \t\r\n'), '');
      v_veh_model := NULLIF(pg_catalog.btrim(p_patch -> 'vehicle' ->> 'model', E' \t\r\n'), '');
      v_veh_raw   := NULLIF(pg_catalog.btrim(p_patch -> 'vehicle' ->> 'raw',   E' \t\r\n'), '');
      IF pg_catalog.length(COALESCE(v_veh_brand, '')) > 200 OR pg_catalog.length(COALESCE(v_veh_model, '')) > 200
         OR pg_catalog.length(COALESCE(v_veh_raw, '')) > 200 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 車輛欄位超過 200 字';
      END IF;
      v_veh_year := NULL;
      IF (p_patch -> 'vehicle') ? 'year' AND pg_catalog.jsonb_typeof(p_patch -> 'vehicle' -> 'year') <> 'null' THEN
        IF pg_catalog.jsonb_typeof(p_patch -> 'vehicle' -> 'year') <> 'number'
           OR (p_patch -> 'vehicle' ->> 'year') !~ '^[0-9]{4}$'
           OR (p_patch -> 'vehicle' ->> 'year')::integer NOT BETWEEN 1900 AND 2100 THEN
          RAISE EXCEPTION 'admin_update_order_workflow: 車輛年份要是 1900-2100 的整數(收到 %)', p_patch -> 'vehicle' -> 'year'
            USING ERRCODE = 'P9V02';
        END IF;
        v_veh_year := (p_patch -> 'vehicle' ->> 'year')::integer;
      END IF;
      IF COALESCE(p_patch -> 'vehicle' ->> 'kind', '') = 'dict' THEN
        IF v_veh_brand IS NULL OR v_veh_model IS NULL THEN
          RAISE EXCEPTION 'admin_update_order_workflow: 字典車輛缺 brand / model';
        END IF;
        v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'kind', 'dict', 'brand', v_veh_brand, 'model', v_veh_model, 'year', v_veh_year, 'source', 'manual_dict'));
      ELSIF COALESCE(p_patch -> 'vehicle' ->> 'kind', '') = 'free' THEN
        IF v_veh_raw IS NULL THEN
          RAISE EXCEPTION 'admin_update_order_workflow: 照打的車輛缺 raw';
        END IF;
        v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'kind', 'free', 'raw', v_veh_raw, 'year', v_veh_year, 'source', 'manual_text'));
      ELSE
        RAISE EXCEPTION 'admin_update_order_workflow: 車輛 kind 要是 dict 或 free(收到 %)', COALESCE(p_patch -> 'vehicle' ->> 'kind', '(缺)');
      END IF;
    END IF;
  END IF;

  -- ── 貼板 264 ②:要不要開發票(Sean 2026-10-02 Q2 甲, 知情推翻 09-04 第十六、十八、十九題)──────────
  --   不開 ⇒ 要開:稅 = round((小計 + 運費 − 折扣) × 5%)(half-up, 與建單函式、pcm_order_remaining_receivable 同一條), 總額走 pcm_order_total;
  --     客人補差額 ⇒ 結清判定照舊(已付款 ⇒ 部分付款)。
  --   要開 ⇒ 不開:稅歸 0、總額重算;多收的由既有待退款重算(pcm_partial_cancel_recompute)開出來。已登記發票號碼 / 已開立 ⇒ 不准。
  --   🔴 只開放電話 / LINE / 其他三種手動單:蝦皮單金額由蝦皮決定、網站單的稅不走這條式子。
  --   🔴 有取消紀錄、有退款紀錄、整單已取消 ⇒ 不准:那幾個世界的應收與退款由別的管線算, 這裡改稅會讓兩邊對不上。
  IF p_patch ? 'invoice_requested' THEN
    IF pg_catalog.jsonb_typeof(p_patch -> 'invoice_requested') <> 'boolean' THEN
      RAISE EXCEPTION 'admin_update_order_workflow: invoice_requested 要是 true / false';
    END IF;
    v_invoice_requested := (p_patch ->> 'invoice_requested')::boolean;
    IF v_invoice_requested IS DISTINCT FROM v_cur.invoice_requested THEN
      IF v_cur.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other') THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 只有電話 / LINE / 其他來源的手動單可以改要不要開發票' USING ERRCODE = 'P9V03';
      END IF;
      IF v_cur.cancelled_at IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)
         OR EXISTS (SELECT 1 FROM public.order_manual_refunds m WHERE m.order_id = p_order_id AND m.voided_at IS NULL)
         OR EXISTS (SELECT 1 FROM public.order_refunds r WHERE r.order_id = p_order_id)
         OR EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = p_order_id AND p.rail = 'card') THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 這張單有取消或退款紀錄, 不能改要不要開發票' USING ERRCODE = 'P9V04';
      END IF;
      -- Fable R1 建議 2:看【這次修改之前】的號碼與狀態(同一包先清號碼再改回不開也不行, 對齊 Sean「已登記發票號碼的不能改回不開」)。
      -- Fable R2 建議 1:只登記了發票金額(沒號碼)也算登記過 ⇒ 一樣擋(否則撞 orders 那道 CHECK, 員工看到的原因不對)。
      IF NOT v_invoice_requested AND (v_cur.invoice_number IS NOT NULL OR v_cur.invoice_amount IS NOT NULL OR v_cur.invoice_status = 'issued') THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 這張單已經登記發票號碼, 不能改回不開發票' USING ERRCODE = 'P9V05';
      END IF;
      -- Fable R1 建議 3:現在含稅的單, 稅要能用這條式子重現才准改(建單時用含稅價換算的單, 稅另有殘差, 改回去會對不上)。
      IF v_cur.invoice_requested AND v_cur.tax_total IS DISTINCT FROM
         pg_catalog.round(((v_cur.subtotal + v_cur.shipping_fee - v_cur.discount_total)::numeric) * 0.05)::bigint THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 這張單的稅是用含稅價換算的, 系統無法自動調整' USING ERRCODE = 'P9V08';
      END IF;
      IF v_invoice_requested THEN
        v_tax := pg_catalog.round(((v_cur.subtotal + v_cur.shipping_fee - v_cur.discount_total)::numeric) * 0.05)::bigint;
        -- 只給本交易用的通行證:09-04 那道觸發器只在這支函式裡放行「不開 ⇒ 要開」(其他路徑照舊擋)。
        PERFORM pg_catalog.set_config('pcm.invoice_requested_on_by_rpc', 'on', true);
      ELSE
        v_tax := 0;
      END IF;
      IF v_tax > 2147483647 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 稅額超出可記錄的上限';
      END IF;
      v_total := public.pcm_order_total(v_cur.subtotal, v_cur.shipping_fee, v_cur.discount_total, v_tax::integer);
      IF v_total > 2147483647 THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 總額超出可記錄的上限';
      END IF;
      v_money_changed := true;
    END IF;
  END IF;

  IF v_shipping_method     IS NOT DISTINCT FROM v_cur.shipping_method
     AND v_invoice_number    IS NOT DISTINCT FROM v_cur.invoice_number
     AND v_invoice_amount    IS NOT DISTINCT FROM v_cur.invoice_amount
     AND v_invoice_status    IS NOT DISTINCT FROM v_cur.invoice_status
     AND v_invoice_issued_at IS NOT DISTINCT FROM v_cur.invoice_issued_at
     AND v_invoice           IS NOT DISTINCT FROM v_cur.invoice
     AND v_ship_to           IS NOT DISTINCT FROM v_cur.shipping_address_snapshot
     AND v_vehicle           IS NOT DISTINCT FROM v_cur.vehicle_snapshot
     AND v_invoice_requested IS NOT DISTINCT FROM v_cur.invoice_requested THEN
    RETURN 'NOOP';
  END IF;

  -- SET 字面恰 6 業務欄+version+updated_at(🔴 workflow_status 與金流欄一律不在此清單)。
  UPDATE public.orders SET
    shipping_method   = v_shipping_method,
    invoice_number    = v_invoice_number,
    invoice_amount    = v_invoice_amount,
    invoice_status    = v_invoice_status,
    invoice_issued_at = v_invoice_issued_at,
    invoice           = v_invoice,
    shipping_address_snapshot = v_ship_to,
    vehicle_snapshot  = v_vehicle,
    invoice_requested = v_invoice_requested,
    tax_total         = v_tax,
    total             = v_total,
    version           = v_cur.version + 1,
    updated_at        = pg_catalog.now()
  WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_workflow: 更新列數異常(%)', v_rows;
  END IF;

  -- ── 貼板 264 ③:總額變了 ⇒ 沿用既有兩支重算(不另寫一套):待退款(多收 ⇒ 開)、付款狀態(結清判定)──────────
  --   🔴 兩支都會吞例外只留痕(結清那支的設計)⇒ 重算完自己再驗一次, 對不上就整筆回滾(同 263 登記收款的復活路徑)。
  IF v_money_changed THEN
    -- Fable R1 必修 1:改成要開之後, 含稅手動單的待退款重算會回空值(pcm_order_remaining_receivable:稅非 0 且非網站單 ⇒ NULL)
    --   ⇒ 之前「改回不開」開的那列待退款不會被作廢。這裡自己處理:已收(非卡淨額, 本路徑已擋掉退款與卡)≤ 新總額 ⇒ 作廢開著的待退款;
    --   仍然多收 ⇒ 擋下(客人付的比含稅總額還多, 要人工看)。
    IF v_invoice_requested THEN
      SELECT COALESCE(SUM(p.amount), 0)::bigint INTO v_net_received
        FROM public.order_payments p WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer', 'cash');
      IF v_net_received > v_total THEN
        RAISE EXCEPTION 'admin_update_order_workflow: 已收 % 超過含稅總額 %, 請聯絡系統管理員', v_net_received, v_total
          USING ERRCODE = 'P9V07';
      END IF;
      UPDATE public.order_pending_refunds r
         SET voided_at = pg_catalog.now(), void_reason = 'invoice_toggle_on'
       WHERE r.order_id = p_order_id AND r.settled_at IS NULL AND r.voided_at IS NULL;
    END IF;
    PERFORM public.pcm_partial_cancel_recompute(p_order_id);
    PERFORM public.pcm_noncard_settle_recompute(p_order_id);
    v_verdict := public.admin_compute_order_settlement(p_order_id) ->> 'verdict';
    SELECT o.payment_status INTO v_status_after FROM public.orders o WHERE o.id = p_order_id;
    IF NOT COALESCE(
         (v_verdict = 'settled'   AND v_status_after = 'paid'::public.payment_status)
      OR (v_verdict = 'underpaid' AND v_status_after IN ('unpaid'::public.payment_status, 'partiallyPaid'::public.payment_status))
      OR (v_verdict = 'overpaid'  AND EXISTS (SELECT 1 FROM public.order_pending_refunds r
                                               WHERE r.order_id = p_order_id AND r.voided_at IS NULL AND r.settled_at IS NULL)), false) THEN
      RAISE EXCEPTION 'admin_update_order_workflow: 改完發票後付款狀態對不上(結清判定 = %, 付款狀態 = %), 已取消這次修改。請通知系統管理員',
                      COALESCE(v_verdict, '<null>'), v_status_after USING ERRCODE = 'P9V06';
    END IF;
  ELSE
    v_status_after := v_cur.payment_status;
  END IF;

  -- 🔴 稽核 before/after 都帶 `invoice_issued_at` —— 覆蓋之後舊日期只剩這裡有(plan §2-b-ii)。
  -- 🔴 第 4 代:再帶 'invoice' = 【整包】jsonb, 不只 title / taxId(規格 §2「客人原本填的永遠還原得出來」)。
  --    沒碰 invoice 的那一發也照樣寫整包 —— before = after, diff 頁會略過它, 而 audit 列的形狀恆定。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.workflow.update',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'shipping_method',   v_cur.shipping_method,
      'invoice_number',    v_cur.invoice_number,
      'invoice_amount',    v_cur.invoice_amount,
      'invoice_status',    v_cur.invoice_status,
      'invoice_issued_at', v_cur.invoice_issued_at,
      'invoice',           v_cur.invoice,
      'shipping_address_snapshot', v_cur.shipping_address_snapshot,
      'vehicle_snapshot',  v_cur.vehicle_snapshot,
      'invoice_requested', v_cur.invoice_requested,
      'tax_total',         v_cur.tax_total,
      'total',             v_cur.total,
      'payment_status',    v_cur.payment_status
    ),
    pg_catalog.jsonb_build_object(
      'shipping_method',   v_shipping_method,
      'invoice_number',    v_invoice_number,
      'invoice_amount',    v_invoice_amount,
      'invoice_status',    v_invoice_status,
      'invoice_issued_at', v_invoice_issued_at,
      'invoice',           v_invoice,
      'shipping_address_snapshot', v_ship_to,
      'vehicle_snapshot',  v_vehicle,
      'invoice_requested', v_invoice_requested,
      'tax_total',         v_tax,
      'total',             v_total,
      'payment_status',    v_status_after
    ),
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$$;

COMMENT ON FUNCTION public.admin_update_order_workflow(uuid, integer, jsonb, text, text) IS
  'M-4a Slice C 後台改單(訂單頁「編輯個資」)。SECURITY DEFINER、search_path 空字串、樂觀鎖 version、同交易 admin_audit_log(order.workflow.update, before/after)。回 UPDATED/CONFLICT/NOOP。EXECUTE 僅 service_role。p_patch 白名單:shipping_method / invoice_number / invoice_amount / invoice_status / invoice_issued_at(第 3 代)/ invoice_title / invoice_tax_id(第 4 代)/ ship_to_name / ship_to_phone / ship_to_line(第 5 代, 三鍵全送)。第 6 代(貼板 264, Sean 2026-10-02):vehicle(物件 ⇒ 換掉訂單上的車, null ⇒ 清掉;只有手動單;形狀同建單函式;不同步客人的我的愛車)、invoice_requested(只有電話 / LINE / 其他手動單;不開 ⇒ 要開 加 5% 稅、要開 ⇒ 不開 稅歸 0;總額走 pcm_order_total;之後呼叫 pcm_partial_cancel_recompute 與 pcm_noncard_settle_recompute 並自驗結清判定, 對不上回滾 P9V06;有取消 / 退款紀錄 P9V04、已登記發票號碼不能改回 P9V05、改成要開而已收超過含稅總額 P9V07、含稅價換算的單 P9V08;改成要開時已收不超過新總額 ⇒ 作廢開著的待退款(invoice_toggle_on))。before/after 多 vehicle_snapshot / invoice_requested / tax_total / total / payment_status。';

-- ═══ 事後斷言 ═══
DO $acl$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_update_order_workflow(uuid,integer,jsonb,text,text)',
    'public.pcm_invoice_requested_false_is_final()'
  ]::text[];
  v text;
BEGIN
  FOREACH v IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 對 anon / authenticated 仍可 EXECUTE', v;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v::regprocedure AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '收權斷言:% 不是 SECURITY DEFINER 或 search_path 不是空字串', v;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_update_order_workflow(uuid,integer,jsonb,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言:service_role 叫不到 admin_update_order_workflow';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'public.admin_order_list_v'::regclass
                    AND c.reloptions @> ARRAY['security_invoker=true'])
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.admin_order_list_v', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.admin_order_list_v', 'SELECT') THEN
    RAISE EXCEPTION '事後斷言:admin_order_list_v 的 security_invoker 或 GRANT 漂了';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgname = 'zzz_pcm_invoice_requested_false_is_final' AND t.tgenabled = 'A') THEN
    RAISE EXCEPTION '事後斷言:zzz_pcm_invoice_requested_false_is_final 不在或不是 ENABLE ALWAYS';
  END IF;
END
$acl$;

COMMIT;
