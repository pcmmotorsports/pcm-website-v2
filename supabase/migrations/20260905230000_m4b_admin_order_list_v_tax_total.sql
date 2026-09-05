-- M-4b · ⟦b4-TAXSURFACES⟧ CSV 稅欄的前置:重建 `admin_order_list_v` 讓它看得到 `tax_total`
--
-- Sean 2026-09-05 第 6 題拍甲:後台訂單 CSV 要加稅額欄。
-- 而那條路走的是 **view `admin_order_list_v`**(`SupabaseOrderAdapter.ts:222` 逐字
-- 「`#484a` A2 起本常數是打在 view 上的」)—— 不是 `orders` 表。
--
-- ═══ 🔴🔴 為什麼要這一支(成因是量到的, 不是推的)═══
--
-- 🔬 **唯讀實測正式庫(2026-09-05)**:
--     `orders` 表有 `tax_total`            ⇒ **true**
--     `admin_order_list_v` 有 `tax_total`  ⇒ **false**   ← 🔴
--     🟢 正對照 同尺查 `total`             ⇒ true(尺會動)
--     🔵 負對照 現造一個欄名                ⇒ false
--     view 共 **37** 欄, 而 `orders` 表有 **41** 欄 ⇒ 🔴 **view 落後 4 欄, 不只稅那一欄**
--
-- 🎯 **根因**:那支 view 的原始碼寫的是 `o.*`(`20260823030000:246` 逐字),
--    而 **PostgreSQL 在【建立 view 的那一刻】就把 `o.*` 展開成逐欄存起來**
--    ⇒ 🔬 實測:`pg_get_viewdef` 回來的定義裡**沒有 `o.*` 字面**, 開頭是
--      `SELECT id, display_id, customer_user_id, addre…` —— **它已經是逐欄的了。**
--    ⇒ 🛑 **`tax_total` 是 5 天後(`20260828100000`)才加進 `orders` 的**
--      ⇒ view 永遠看不到它, 而**沒有任何東西會叫**。
--
-- 📌 **⇒ 這一格值得記**:`o.*` 讀起來像「跟著表走」, 而它是**一張快照**。
--    ⇒ **每一次 `ALTER TABLE ... ADD COLUMN`, 都要問一次「有幾支 view 該跟著重建」。**
--
-- 🛑 **不貼這一支就把 CSV 那半上線的後果**:PostgREST 對 view 不存在的欄回 `42703`
--    ⇒ **後台訂單列表整頁 500**。而 TS 那側的測試全綠(它們 mock 掉了 client)。
--
-- ═══ 為什麼是 `CREATE OR REPLACE VIEW` 而不是 DROP + CREATE ═══
-- ⛔ ~~本片**只加欄、不減欄、不改既有欄的順序與型別** ⇒ `CREATE OR REPLACE VIEW` 做得到。~~
--
-- 🔴🔴 **2026-09-05 訂正 —— 上面那句在第一版【是假的】, 而 Sean 貼下去就紅了**:
--   逐字 `ERROR: 42P16: cannot change name of view column "goods_axis" to "manual_request_id"`
--   成因:我把 6 個新欄照 **`orders` 表的欄序**插在 `legacy_display_id` 之後,
--   而這支 view 的第 36、37 欄是**算出來的** `goods_axis` / `paid_total` ——
--   ⇒ 新欄一插進中間, 第 36 位就從 `goods_axis` 變成 `manual_request_id` ⇒ **那是【改欄序】不是【加欄】。**
--   📌 **「我只是加欄」與「我改了欄序」在 diff 上長得一模一樣, 而 PG 分得出來。**
--
-- ✅ **修法:6 個新欄一律接在【最後】(`paid_total` 之後)** ⇒ 純附加 ⇒ `CREATE OR REPLACE` 合法。
-- 🔵 **所以【不必】DROP VIEW** —— ACL(`service_role` / `pcm_readonly`)、`COMMENT ON`、
--    `security_invoker=true` 全部**原地保留**, 不必再裝一次(那三樣 `DROP` 都會帶走)。
--
-- 🔬 **這個修法在拋棄式 PG 17 上兩個世界各表演一發**(2026-09-05, 最小重現):
--    基線 `SELECT o.id, 'x' AS axis` ⇒ 2 欄
--    ⛔ 插中間 `SELECT o.id, o.total, 'x' AS axis`
--       ⇒ `ERROR: cannot change name of view column "axis" to "total"` ← **與 Sean 撞到的同型**
--    ✅ 附加尾巴 `SELECT o.id, 'x' AS axis, o.total` ⇒ **綠, 3 欄**
--    ⇒ 📌 **一發紅一發綠 ⇒ 這把尺會動, 修法不是「看起來對」。**
--
-- 🔬 **而「逐欄列會不會弄壞 PostgREST embed」也量過了**(這支 view 的 `COMMENT` 逐字寫著
--    「orders 欄位必須 `o.*` 原樣帶出」⇒ 我逐欄列等於違反那句話的字面):
--    本機真 PostgREST + 有資料的世界, 打 `?select=id,order_items(id)`:
--      `o.*` 版(現行)      ⇒ embed **有東西**
--      **逐欄列版**          ⇒ embed **有東西** ✅
--      `GROUP BY` 版(契約明文禁的形狀)⇒ embed **空陣列** ⇒ 🔬 **尺會動**
--    ⇒ 📌 **那句契約真正承重的是「不得 GROUP BY / DISTINCT / join order_items」那半;
--       `o.*` 那半是【充分而不必要】。** 逐欄列不壞 embed。
--    ⚠️ **射程**:本機 PostgREST 與正式庫版本未必相同 ⇒ 這證的是機制, 不是正式庫那顆的行為。
-- ✅ 而它**保留 ACL 與 reloptions** ⇒ `security_invoker = true` 與既有 GRANT 不會掉。
-- 🔴 **而 `CREATE OR REPLACE VIEW` 不能【減欄】也不能【改欄序】** —— 下一個要動它的人:
--    若你要拿掉或重排, 那是 DROP + CREATE, 而**那會帶走 ACL**(本檔 §斷言②③ 就是為那天寫的)。
-- ⚠️ **而 `o.*` 這次照樣寫 `o.*`** —— 它會在**這一刻**重新展開一次, 於是含 `tax_total`。
--    🛑 **這不是修好了「以後加欄會自動跟上」** —— 下一次加欄, 這支 view 一樣要再重建一次。

BEGIN;

-- ═══ 前置閘:確認我要改的那支【真的在】, 而且它【還沒有】那一欄 ═══
DO $pre$
DECLARE
  v_oid oid := pg_catalog.to_regclass('public.admin_order_list_v');
  v_has boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 view admin_order_list_v ⇒ 這台庫不是我以為的形狀, 停下人工對齊';
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = v_oid AND a.attname = 'tax_total' AND a.attnum > 0 AND NOT a.attisdropped)
    INTO v_has;
  IF v_has THEN
    RAISE EXCEPTION '前置閘:view 已經有 tax_total ⇒ 本檔貼過了, 或有人先重建過, 停下人工對齊';
  END IF;
  -- 🔴 而 `orders` 表沒有那一欄的話, 重建也拿不到 ⇒ 那是另一個問題, 要分得開。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = 'public.orders'::regclass AND a.attname = 'tax_total'
                    AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '前置閘:orders 表本身沒有 tax_total ⇒ 先貼 20260828100000, 不是貼本檔';
  END IF;
END
$pre$;

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
  o.invoice_requested
FROM public.orders o;

-- ═══ 事後斷言 ═══
DO $post$
DECLARE
  v_oid oid := pg_catalog.to_regclass('public.admin_order_list_v');
  v_n   integer;
BEGIN
  -- ① 那一欄真的在了
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = v_oid AND a.attname = 'tax_total'
                    AND a.attnum > 0 AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '斷言①失敗:重建之後 view 仍然沒有 tax_total';
  END IF;

  -- ② 🔴 **欄數只多一個** —— 重建前實測 37 欄 ⇒ 現在必須是 38。
  --    🛑 少了這一格,「逐欄清單抄漏一欄」會靜靜通過。
  --    🔬 **43 是唯讀量到的**(2026-09-05):重建【前】 view **37 欄**, 而它 = **35 個表欄 + 2 個算出來的**
  --       (`goods_axis` / `paid_total`);`orders` 表 **41 欄** ⇒ **view 缺的是 6 個表欄, 不是 4 個**:
  --       `manual_request_id` · `manual_request_payload_sha256` · `cancel_items_untouched`
  --       · `coupon_id` · `tax_total` · `invoice_requested`。
  --    ⛔ ~~差 4 欄~~ —— **那個 4 是我拿 41−37 減出來的, 而那條減法把 2 個非表欄算成表欄了。**
  --       📌 **兩個都是量到的數, 而中間那一步是推的** ⇒ 37 + 6 = **43**。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_n <> 43 THEN
    RAISE EXCEPTION '斷言②失敗:view 有 % 欄(重建前 37, 加 6 欄 ⇒ 期望 43)—— 多或少都要停下來看', v_n;
  END IF;

  -- ③ 🔴 `security_invoker` 不可以掉 —— 它掉了, 這支 view 就變成用 owner 的權限讀表。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = v_oid AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '斷言③失敗:security_invoker 不見了 ⇒ 這支 view 會用 owner 權限讀表';
  END IF;

  -- ④ 🔴 ACL 不可以掉 —— 重建前實測 `pcm_readonly` 讀得到。
  IF NOT pg_catalog.has_table_privilege('pcm_readonly', v_oid, 'SELECT') THEN
    RAISE EXCEPTION '斷言④失敗:pcm_readonly 對這支 view 沒有 SELECT ⇒ ACL 掉了';
  END IF;
END
$post$;

-- 🔴 view 的欄集合變了 ⇒ PostgREST 的 schema cache 要重載, 否則新欄它不認得。
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══ Rollback ═══
--   把 `20260823030000_m4b_841_order_paid_total_view.sql:242-313` 原樣再貼一次
--   (它也是 `CREATE OR REPLACE VIEW` ⇒ 會把 `o.*` 重新展開成**當下** orders 的欄集合)。
--   🛑 **而那意味著 rollback 之後那支 view【還是會有 tax_total】** —— 因為表上有那一欄。
--   ⇒ 📌 **這一支的 rollback 回不到「view 沒有那一欄」的狀態, 而那【不是缺陷】**:
--     真正要退的是**呼叫端**(`ADMIN_ORDER_LIST_SELECT` 不要選那一欄), 那是 `git revert`。
--   ⇒ ⇒ **view 多一欄不會弄壞任何既有呼叫端**(它們逐欄列出自己要什麼)。
