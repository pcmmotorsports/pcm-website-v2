-- 20260914020000 · M-4b 訂單列表 view `admin_order_list_v` 尾巴加第 45 欄 `item_count`(Q5 乙「多樣的單」)。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
-- plan:`docs/plans/2026-09-14-order-list-filter-axes-plan.md` §1「migration 20260914020000」, 切片 S1。
-- 版本號:`scripts/migration-version-free.sh 20260914020000` 2026-09-14 掃過(116 ref / 8 worktree 沒人用);貼的當天重掃。
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼要 migration(不能在 TS 側過濾)
-- ══════════════════════════════════════════════════════════════════
-- 稿「只看:多樣的單」= 一張單超過一個品項。PostgREST 做不到 embed 的 HAVING;JS 側過濾會壞分頁與 `count: 'exact'`
-- (卡片數字 = 點進去的筆數 那條紀律靠 total)。⇒ view 多一欄 `item_count`, adapter `.gt('item_count', 1)`。
--
-- 🔴 口徑(ceiling 寫在這裡):數 `order_items` **列數**, **不扣已取消的件**(`order_item_quantity_summary.cancelled_quantity`)。
--    「兩樣、其中一樣整件取消」今天仍算多樣。要改口徑 ⇒ 換成 `count(*) FILTER (WHERE …)`, 而那要再一代 view。
-- 🔴 也不是「件數」:兩件同一料號 = 一列 = 不算多樣。稿寫「多樣的單」, 樣 = 品項列。
--
-- ══════════════════════════════════════════════════════════════════
-- 硬約束:新欄【必須】在最尾(第 45 欄)
-- ══════════════════════════════════════════════════════════════════
-- `CREATE OR REPLACE VIEW` 不能改既有欄的名字與位置, 只能尾巴附加(檔內記過兩次:`20260905230000` 第一版插中間,
-- Sean 貼下去逐字紅 `42P16: cannot change name of view column "goods_axis" to "manual_request_id"`)。
-- 🔬 下面 44 欄的本體是**程式從 `20260905360000_…:833-966` 逐 byte 抽出**的(`python` 切片, 零手抄), 只在尾巴加一欄。
--    ⇒ 前置閘① 釘基線 44 欄 + 第 44 欄名 `price_tax_mode`;事後閘 45 欄 + 第 45 欄名 `item_count`。
--
-- 冪等:無頂層 DML ⇒ 冪等宣告閘不叫。重跑 ⇒ 前置閘①(已是 45 欄 ⇒ RAISE)。forward-only。
-- 同一個 BEGIN…COMMIT ⇒ 任一道炸 ⇒ 整包回滾。
--
-- ══════════════════════════════════════════════════════════════════
-- 回退(plan §3):**不回退**
-- ══════════════════════════════════════════════════════════════════
-- `CREATE OR REPLACE VIEW` 拔不掉欄;真要拔得 `DROP VIEW` 再建 + 補兩道 GRANT(`service_role` `20260814140000:151`、
-- `pcm_readonly` `20260905160000:157`)+ COMMENT + security_invoker。零消費者時多一欄零影響 ⇒ 前向做法是留著那一欄。
-- 若真要 DROP 重建:SET LOCAL lock_timeout = '5s'; 然後貼 `20260905360000:833-967` 那一版 + 上述 GRANT / COMMENT。
--
-- 實測(2026-09-14):① 拋棄式 PG 17.10 整條鏈從零重播(基線 44 欄 / price_tax_mode 對得上)⇒ 套 ⇒ rc=0,
--    45 欄、最後一欄 item_count、COMMENT 在、service_role / pcm_readonly 兩道 SELECT 仍在;再跑一次 ⇒ 前置閘① RAISE。
--    ② admin-probe 鑽機(有真品項):0 品項的單 item_count = 0、2 品項的單 = 2;`item_count > 1` 撈到 7 張兩品項、
--       不含 0 品項那張(ZZQPRB)。⚠️ 1 品項的世界沒種到(種子每張都 2 件, 刪一件會撞 #13 subtotal 跨列不變式)。

BEGIN;

-- CREATE OR REPLACE VIEW 對 view 取 ACCESS EXCLUSIVE(瞬間);列表查詢正在跑會排隊 ⇒ 夾 5s 不卡別人。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_cols int;
  v_last text;
BEGIN
  -- 前置閘①:基線 = 44 欄、第 44 欄是 price_tax_mode(`20260905360000` 貼過、之後沒人再動)
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v';
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v'
   ORDER BY ordinal_position DESC LIMIT 1;
  IF v_cols <> 44 OR v_last IS DISTINCT FROM 'price_tax_mode' THEN
    RAISE EXCEPTION '前置閘①:admin_order_list_v 有 % 欄、最後一欄 %(期望 44 / price_tax_mode)⇒ 基線對不上(已貼過本支?或有人在中間加了一代), 停', v_cols, v_last;
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
  (SELECT count(*) FROM public.order_items oi WHERE oi.order_id = o.id)::int AS item_count
FROM public.orders o;

COMMENT ON COLUMN public.admin_order_list_v.item_count IS
  'Q5 乙(20260914020000):這張單的品項【列數】(order_items 列數, 不扣已取消件、不是件數)。列表「只看:多樣的單」= item_count > 1。';

DO $postcondition$
DECLARE
  v_cols int;
  v_last text;
  v_oid  oid;
BEGIN
  -- 事後閘①:45 欄、最後一欄 item_count
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v';
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_order_list_v'
   ORDER BY ordinal_position DESC LIMIT 1;
  IF v_cols <> 45 OR v_last IS DISTINCT FROM 'item_count' THEN
    RAISE EXCEPTION '事後閘①:view 有 % 欄、最後一欄 %(期望 45 / item_count)', v_cols, v_last;
  END IF;

  -- 事後閘②:security_invoker 與兩道 GRANT 沒漂(CREATE OR REPLACE 應該保留, 這裡證它)
  v_oid := pg_catalog.to_regclass('public.admin_order_list_v');
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = v_oid AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '事後閘②:security_invoker 不見了';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '事後閘②b:service_role 讀不到 admin_order_list_v 了(20260814140000:151 那道 GRANT 掉了)';
  END IF;
  IF NOT pg_catalog.has_table_privilege('pcm_readonly', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '事後閘②c:pcm_readonly 讀不到 admin_order_list_v 了(20260905160000:157 那道 GRANT 掉了)';
  END IF;

  -- 事後閘③:COMMENT 在
  IF pg_catalog.col_description(v_oid, 45) IS NULL THEN
    RAISE EXCEPTION '事後閘③:item_count 的 COMMENT 沒寫進去';
  END IF;
END
$postcondition$;

-- view 加欄 ⇒ PostgREST schema cache 要重載(同 20260905360000 檔尾)。
NOTIFY pgrst, 'reload schema';

COMMIT;
