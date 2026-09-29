-- 20260930040000 · M-4b 訂單列表 view `admin_order_list_v` 尾巴加第 47 欄 `has_overdue_arrival`(貼板 256)。
--
-- 為什麼:後台首頁「今天要做的事」新格「逾期未到」(plan `~/pcm-mailbox/計畫-後台今天要做的事-20260930.md` §2-2、§3;
--   主視窗 2026-09-30 Q3 甲:可以排, 只準備、不貼, 白天照計畫實測後再貼)。
--   預計到貨日在 `order_item_procurement.expected_arrival_date`(一樣商品可能有好幾筆採購), 列表 view 原本沒有讀它
--   ⇒ view 多一欄布林, 讓篩選能下推成 `has_overdue_arrival`。
--
-- 形狀:整段 view 本體逐字照抄 `20260930030000`(貼板 255;正式庫 09-30 唯讀量:46 欄、最後一欄 has_arrived_unshipped、
--   security_invoker=true、pg_get_viewdef md5 8480585bcbd20cfbe7cebf52e9156c38, 拋棄式 PG 從零重播同值), 只在尾巴附加一欄。
-- 🔴 只改 view, 不動任何表、不動權限。view 是 security_invoker ⇒ 讀的人要能讀 order_item_procurement:
--   正式庫 09-30 唯讀量 service_role / pcm_readonly 都有 SELECT(anon / authenticated 本來就讀不到這支 view)。前置閘③ 再核一次。
-- 🔴 部署順序:新欄位 ⇒ **板先貼, 程式才讀它**(程式先上 ⇒ 列表查詢 42703, 整頁讀取失敗)。
--   本支貼上去之後沒有任何程式讀它, 零行為變化;讀它的那一片另外交。
-- 回滾:supabase/rollbacks/20260930040000-rollback.sql —— 不 DROP, 同形狀、這一欄固定 false(= 功能關閉)。
--   🔴 退的順序反過來:先退讀它的程式, 再貼回滾(程式讀恆 false 的欄位不會錯, 只是那一格永遠 0)。
--   回滾過之後要再開回來, 重貼本檔即可(前置閘① 接受「47 欄 / has_overdue_arrival」這個基線)。
-- 🔴 本支貼上之後, 板 255 的回滾檔(20260930030000-rollback.sql)就過不了它自己的前置閘(它要 46 欄), 本支回滾之後也一樣是 47 欄。
--   ⇒ 之後要關掉 has_arrived_unshipped, 要拿本支的回滾檔改成「兩欄都固定 false」的版本並重算事後閘 md5(R1 建議 C)。

BEGIN;

-- CREATE OR REPLACE VIEW 對 view 取 ACCESS EXCLUSIVE(瞬間);列表查詢正在跑會排隊 ⇒ 夾 5s 不卡別人。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_cols int;
  v_last text;
  v_def  text;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v';
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v'
   ORDER BY ordinal_position DESC LIMIT 1;
  v_def := pg_catalog.md5(pg_catalog.pg_get_viewdef('public.admin_order_list_v'::regclass));
  -- 前置閘①:基線 = 貼板 255 貼後那一版(46 欄 / has_arrived_unshipped / 定義 md5 8480585b…),
  --   或 47 欄 / has_overdue_arrival(貼過本檔的回滾、要再開回來)
  IF NOT ((v_cols = 46 AND v_last = 'has_arrived_unshipped' AND v_def = '8480585bcbd20cfbe7cebf52e9156c38')
          OR (v_cols = 47 AND v_last = 'has_overdue_arrival')) THEN
    RAISE EXCEPTION '前置閘①:admin_order_list_v 有 % 欄、最後一欄 %、定義 md5 %(期望 46 / has_arrived_unshipped / 8480585b…, 或回滾後的 47 / has_overdue_arrival)⇒ 基線對不上(有人在中間加了一代?), 停', v_cols, v_last, v_def;
  END IF;
  -- 前置閘②:採購表與要用的五欄在
  IF (SELECT count(*) FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.order_item_procurement'::regclass
         AND attname IN ('order_item_id', 'voided_at', 'expected_arrival_date', 'received_quantity', 'allocated_quantity')
         AND NOT attisdropped) <> 5 THEN
    RAISE EXCEPTION '前置閘②:order_item_procurement 缺 order_item_id / voided_at / expected_arrival_date / received_quantity / allocated_quantity, 停';
  END IF;
  -- 前置閘③:security_invoker ⇒ 讀這支 view 的角色要讀得到採購表, 否則整支 view 對它失敗(不是只少一欄)
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_item_procurement', 'SELECT') THEN
    RAISE EXCEPTION '前置閘③:service_role 讀不到 order_item_procurement ⇒ 貼上去後台列表整頁讀不到, 停';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
     AND NOT pg_catalog.has_table_privilege('pcm_readonly', 'public.order_item_procurement', 'SELECT') THEN
    RAISE EXCEPTION '前置閘③b:pcm_readonly 讀不到 order_item_procurement ⇒ 唯讀查證會整支 view 失敗, 停';
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
  ) AS has_overdue_arrival
FROM public.orders o;

COMMENT ON COLUMN public.admin_order_list_v.has_overdue_arrival IS
  '20260930040000(貼板 256):這張單有沒有一筆採購「沒作廢、預計到貨日早於台北今天、到貨數 < 訂貨數」(逾期未到)。沒填預計到貨日的不算。';

DO $postcondition$
DECLARE
  v_oid oid := 'public.admin_order_list_v'::regclass;
  v_cols int;
  v_last text;
  v_type text;
  v_def  text;
BEGIN
  -- 事後閘①:47 欄、最後一欄 has_overdue_arrival、型別 boolean、定義 md5 是本檔寫進去的那一版
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v';
  SELECT column_name, data_type INTO v_last, v_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v'
   ORDER BY ordinal_position DESC LIMIT 1;
  v_def := pg_catalog.md5(pg_catalog.pg_get_viewdef(v_oid));
  IF v_cols <> 47 OR v_last IS DISTINCT FROM 'has_overdue_arrival' OR v_type IS DISTINCT FROM 'boolean' OR v_def <> '2e6c7a46c5f4bf92e68d8e4524d851f2' THEN
    RAISE EXCEPTION '事後閘①:view 有 % 欄、最後一欄 % (%)、定義 md5 %(期望 47 / has_overdue_arrival / boolean / 2e6c7a46c5f4bf92e68d8e4524d851f2)', v_cols, v_last, v_type, v_def;
  END IF;
  -- 事後閘②:security_invoker 與 GRANT 沒漂(CREATE OR REPLACE 應該保留, 這裡證它)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = v_oid AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '事後閘②:security_invoker 不見了';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '事後閘②b:service_role 讀不到 admin_order_list_v 了';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
     AND NOT pg_catalog.has_table_privilege('pcm_readonly', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '事後閘②c:pcm_readonly 讀不到 admin_order_list_v 了';
  END IF;
  IF pg_catalog.has_table_privilege('anon', v_oid, 'SELECT') OR pg_catalog.has_table_privilege('authenticated', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '事後閘②d:anon / authenticated 讀得到 admin_order_list_v(不該)';
  END IF;
  -- 事後閘③:三個 COMMENT 都在(前兩代那兩個不能被這一次洗掉)
  IF pg_catalog.col_description(v_oid, 47) IS NULL OR pg_catalog.col_description(v_oid, 46) IS NULL OR pg_catalog.col_description(v_oid, 45) IS NULL THEN
    RAISE EXCEPTION '事後閘③:has_overdue_arrival / has_arrived_unshipped / item_count 的 COMMENT 不在';
  END IF;
  -- 事後閘④:第 47 欄真的算得起來(WHERE 用到它 ⇒ 採購表那段 EXISTS 會被執行;只寫 LIMIT 1 會被優化掉, R1 建議 B)。
  --   ⚠️ 以貼板的人(postgres)身分跑, 證的是「定義查得動」;service_role 讀得到採購表由前置閘③ 的 GRANT 檢查負責。
  PERFORM 1 FROM public.admin_order_list_v WHERE has_overdue_arrival IS NOT NULL LIMIT 1;
  RAISE NOTICE '✅ 20260930040000:admin_order_list_v 第 47 欄 has_overdue_arrival, 權限與 security_invoker 不變';
END
$postcondition$;

-- 與前一代(20260930030000)同:叫 PostgREST 重讀 schema, 不靠 event trigger。
NOTIFY pgrst, 'reload schema';

COMMIT;
