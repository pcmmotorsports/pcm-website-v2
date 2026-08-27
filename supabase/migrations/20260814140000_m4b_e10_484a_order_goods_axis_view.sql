-- 20260814140000_m4b_e10_484a_order_goods_axis_view.sql
-- 片 A `#484a`(含 `#488`):訂單貨品軸 view —— 讓「膠囊算的那份軸」變成 DB 篩得動的欄位
--
-- plan = docs/specs/2026-08-14-484a-order-goods-axis-view-plan.md(Sean 2026-08-14 拍 Q-484A=A)
-- 鐵則 12③(DDL)+ 8。**additive:只新增一個 view,不動任何既有表、函式、索引、權限。**
--
-- ══ 1. 這支在修什麼(`#488`,不是只為了新功能)═══════════════════════════════════
--
-- 訂單列表的「出貨狀態」下拉走 `.eq('fulfillment_status', …)`
-- (`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:582`),而 `orders.fulfillment_status`
-- **2026-08-14 正式站實查 13/13 全部是 `notOrdered`** —— 那一側從沒被推進過。
-- ⇒ **員工用那個下拉篩「已到貨」,今天必定回零筆**,而畫面上的狀態膠囊明明寫著別的。
--    它不是沉睡欄位,是**一個正在騙人的篩選器**。
--
-- 同一份資料還要餵新的「未到貨」chip(`#484`)⇒ **一份真相、兩個消費者。**
--
-- 數法(可整段重跑,唯讀):
--   select o.fulfillment_status::text,
--    case when bool_and(coalesce(s.shipped_quantity,0)>=oi.quantity) then 'shipped'
--         when bool_and(coalesce(s.instock_quantity,0)>=oi.quantity) then 'instock'
--         when bool_and(coalesce(s.ordered_quantity,0)>=oi.quantity) then 'ordered'
--         else 'none' end as ui_axis, o.display_id
--   from orders o join order_items oi on oi.order_id=o.id
--   left join order_item_quantity_summary s on s.order_item_id=oi.id
--   group by o.id, o.fulfillment_status, o.display_id;
--
-- ══ 2. 🔴🔴 本 view 的**寫法契約** —— 動它之前先讀完這段 ════════════════════════
--
-- PostgREST 能不能從一個 view 把子資源 embed 出來(`order_items(...)`、`customers(name)`),
-- 靠的是它**把 view 的欄位追回底表欄位**。追不回就整條列表垮掉。
--
-- ⇒ **契約(三條,違反任一條就可能讓 embed 靜默消失)**:
--    ① `orders` 的欄位一律 **`o.*` 原樣帶出**,不得包表達式、不得改名、不得型別轉換 ——
--       尤其 `id` 與 `customer_user_id`(FK 的兩端就靠它們被認出來)。
--    ② **不得 `GROUP BY`、不得 `DISTINCT`、不得 join 到 `order_items`** ——
--       新欄一律用**純量子查詢**算。join + 聚合會讓 `o.id` 不再是「單純的欄位引用」。
--    ③ 新增欄位只能往後加,且必須是**純量**。
--    ④ 🔴 **`o.*` 是建 view 當下就展開凍結的,不會跟著 `orders` 長**:日後 `orders` 加欄、
--       有人把新欄加進 `ADMIN_ORDER_LIST_SELECT` 卻忘了重跑 `CREATE OR REPLACE VIEW`
--       ⇒ 列表噴 PostgREST 錯。**加欄要同批重建這支 view。**
--
-- **驗到哪,一句話說清楚(codex 關卡2 R2:原本這裡寫「量出來的」、plan 寫「推的」,兩句打架)**:
--    **只在「另一支 view」上驗到了機制與一個負向案例;上面那三條契約本身、以及這一支 view,
--    都還沒有逐條實測** —— apply 之後用完整投影確認(§5)。
-- 機制探測(E 窗 2026-08-14 正式站唯讀,零寫入):
--    view → 子表(一對多)`products_public?select=id,product_variants(id)`        → **200**,回真陣列
--    負向對照:view → 不存在的關聯 `products_public?select=id,order_items(id)`     → **400 `PGRST200`**
--      「Searched for a foreign key relationship … no matches were found」
--    ⇒ **失敗會是大聲的 400,不是靜默降級** —— 這就是下面那道 apply 後 smoke 的判讀依據。
-- ⚠️ **誠實邊界**:上面兩發證的是 **PostgREST 的 embed 機制**(用既有的 `products_public` 試的),
--    **不是這支 view 的 embed** —— 那要 apply 之後才問得到,見 §5。
--
-- ══ 2b. 這支 SQL 本身驗到哪(拋棄式庫實跑,`docs/probes/484a-view-probe.sh` 可重跑)═══
--
-- 環境 = 拋棄式 Postgres 17.10(`127.0.0.1:54455`),**不是正式庫、不是 branch、零花費**。
--
--   T1 本檔的 `CREATE VIEW` 原文     → `EXIT=0` `CREATE VIEW`,view 存在
--      緊接著真的跑 `DROP VIEW`      → `EXIT=0`,`information_schema.views` 回 **0**(零留痕)
--   T2 負向對照(讓 T1 有判別力):
--      故意寫錯語法 `SELEKT 1`        → `syntax error at or near "SELEKT"`
--      語法對但表不存在              → `relation "…" does not exist`
--      ⇒ **兩種失敗長得不一樣** ⇒ T1 的成功不是「碰巧沒報錯」。
--      ⚠️ psql 只吐訊息沒吐 SQLSTATE,**我沒有抓到 42601/42P01 這兩個碼本身**,只有訊息字面。
--   T3 四值 oracle(獨立 schema、造 6 張單):
--      none / ordered / instock / shipped **四值全 PASS**;
--      **零品項單 → `none`**(不是 `shipped` —— `bool_and` 對空集合回 true,不擋就會判成出貨完成);
--      ⚠️ **codex 提的 `quantity = 0` 情形(三個 `>= 0` 全成立 ⇒ 判成 `shipped`)在本庫構造不出來**:
--         `order_items` 有 `CHECK ((quantity > 0))`(實查 `pg_constraint`),正式站 `min(quantity)` = **1**。
--         **這是資料庫約束擋掉的,不是這支 SQL 擋掉的** ⇒ 那條 CHECK 若日後被拿掉,這裡會跟著壞。
--      **一件訂滿、一件沒訂 → 退回 `none`**(訂單層要求全部品項到齊)。
--   T4 突變:把 CASE 判序倒過來(先問 `ordered`)⇒ `instock` 與 `shipped` **兩格都紅**(都變成 `ordered`)。
--      ⚠️ `ordered` 那一格**抓不到**這個突變(它本來就該是 `ordered`)—— 誠實寫下來,不宣稱三格全紅。
--
-- 🔴 **正式站那 13 筆不是本片的 oracle**:2026-08-14 唯讀比對雖然 13/13 與膠囊同源全對,
--    但**其中 12 筆是 `none`** ⇒ **那組資料對 `none` 有判別力,對其餘三值幾乎沒有。**
--    其餘三值與零品項單的證據來源是上面 T3/T4,**不是那一組**。
--
-- ══ 3. 判序不可倒(這段是從既有 code 搬過來的,不是新規則)═══════════════════════
--
-- `shipped ⊆ instock ⊆ ordered`(Sean 2026-08-05 拍「出貨必先到貨、無直送」)
-- ⇒ **先問最遠的那個**。倒過來寫的話已出貨的單會被判成「在庫」——
--    那正是 L0 之前真的出過的病(`apps/admin/src/lib/orders/order-status-axes.ts` 的 `orderGoodsAxis()` docstring(`:123-125`)逐字記著)。
-- 🔴 本 view 的 CASE 順序**必須逐字對齊** `orderGoodsAxis()`(同檔 `:133-140`)。
--    ⚠️ **這一片還沒有自動守門** —— 綁住 SQL CASE 與 `orderGoodsAxis()` 的測試**要等 A2**
--       (A1 沒有任何 app code 消費這支 view,測不到)。現階段的證據是 `docs/probes/484a-view-probe.sh` 的 T3/T4。
--
-- ⚠️ **空 `lines` 回 `none`,不是 `shipped`**:`bool_and` 對空集合回 `true`
--    ⇒ 不擋的話一張沒有品項的單會被判成「出貨完成」。同 `orderGoodsAxis()` 的 `lines.length === 0` 早退。
--
-- ══ 4. 權限:只給 service_role ═════════════════════════════════════════════════
--
-- admin 全部走 service_role(`createSupabaseServiceClient`,sb_secret_ 只在 server runtime)。
-- 🔴 **不 GRANT 給 `anon` / `authenticated`** —— 這支帶 `orders` 全欄(含 `customer_user_id`、
--    收件地址快照、發票欄)。`security_invoker = true`:沒有任何需要繞過底表 RLS 的理由,
--    而 definer 版等於開一條繞過 RLS 的訂單查詢路徑。
--    (對照組:`vehicle_taxonomy_public` 用 definer 是因為實測 3,047ms 逾時、且只曝露車款名稱;
--     **本片兩個條件都不成立,不要照抄那支。**)
--
-- ══ 5. 🔴 apply 之後的第一動(給 Sean 看的判讀句)════════════════════════════════
--
--   用**真正的 `ADMIN_ORDER_LIST_SELECT`** 對這支 view 打一次(runbook:
--   `docs/runbooks/484a-view-apply-smoke.md`)。
--   **這個指令要回 200,而且筆數要跟舊路徑一樣。**
--   **如果看到 `PGRST200`,就是失敗 —— 停下來找我,不要繼續。**
--   回退**分兩種情況,以 `scripts/484a-down.sql` 檔頭為準**(A1 當下沒有任何 app code 依賴這支 view
--   ⇒ 直接 DROP 即可;**只有 A2 部署之後**才需要「先 revert app、後 DROP」)。**不要在這裡再寫一份。**

CREATE OR REPLACE VIEW public.admin_order_list_v
  WITH (security_invoker = true) AS
SELECT
  -- 🔴 契約①:`orders` 全欄原樣帶出。不要改成逐欄列舉再加工。
  o.*,
  -- 🔴 契約②:純量子查詢,不 join、不 GROUP BY。CASE 順序逐字對齊 orderGoodsAxis()。
  (
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id) THEN 'none'
      WHEN (
        SELECT bool_and(COALESCE(s.shipped_quantity, 0) >= oi.quantity)
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'shipped'
      WHEN (
        SELECT bool_and(COALESCE(s.instock_quantity, 0) >= oi.quantity)
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'instock'
      WHEN (
        SELECT bool_and(COALESCE(s.ordered_quantity, 0) >= oi.quantity)
        FROM public.order_items oi
        LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = oi.id
        WHERE oi.order_id = o.id
      ) THEN 'ordered'
      ELSE 'none'
    END
  ) AS goods_axis
FROM public.orders o;

-- 🔴🔴 **`FROM PUBLIC` 一條不夠 —— codex 關卡2 抓到,我實查證實了**:
--    本專案的 `pg_default_acl` 對 `public` schema 的 `typ=r`(表**與 view**)有
--    `ALTER DEFAULT PRIVILEGES … anon=arwdDxtm, authenticated=arwdDxtm`
--    ⇒ **新建的 view 一出生就被直接授予給 anon 與 authenticated**,
--    而那是**給具名角色的授權、不是 PUBLIC** ⇒ `REVOKE … FROM PUBLIC` **收不掉**。
--    實查命令:`select defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl;`
--    佐證:`has_table_privilege('anon','public.products_public','SELECT')` = **true**(那支是刻意公開的)。
-- ⇒ 必須**逐角色**收。`security_invoker = true` 讓底表 RLS 以呼叫者身分套(anon 對 `orders` 無 SELECT
--    ⇒ 就算拿到 view 也讀不到列),**但那是第二道** —— 第一道是這裡不要授權給它們。
REVOKE ALL ON public.admin_order_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_order_list_v FROM anon, authenticated;
GRANT SELECT ON public.admin_order_list_v TO service_role;

COMMENT ON VIEW public.admin_order_list_v IS
  '#484a/#488 訂單列表讀取源:orders 全欄 + goods_axis(none/ordered/instock/shipped)。'
  '🔴 寫法契約:orders 欄位必須 o.* 原樣帶出、不得 GROUP BY/DISTINCT/join order_items ——'
  'PostgREST 靠追回底表欄位才 embed 得出 order_items()/customers();違反就整條列表垮掉(見 migration §2)。'
  '🔴 CASE 判序不可倒(shipped ⊆ instock ⊆ ordered),必須逐字對齊 order-status-axes.ts 的 orderGoodsAxis()。'
  '🔴 只給 service_role:本 view 帶 orders 全欄含收件地址快照與客戶關聯,不得 GRANT 給 anon/authenticated。';

COMMENT ON COLUMN public.admin_order_list_v.goods_axis IS
  '訂單層貨品軸。取代 orders.fulfillment_status 當篩選軸(#488:該欄 13/13 未被推進)。'
  '🔴 與列表膠囊同源**有一個例外**:已取消的單在 UI 會短路成「已取消」(orderGoodsAxis 回 null),'
  '本欄卻仍算得出四值之一 ⇒ A2 用它篩選時必須自己處理 cancelled_at,否則會撈出膠囊寫「已取消」的單。';

-- 🔴 **「與膠囊同源」這句話有一個例外,codex 關卡2 抓到,我確認屬實**(`order-status-axes.ts` 的 `orderStatusView()`,`:147-156`):
--    `orderStatusView()` 對 `cancelled_at IS NOT NULL` 的單**先早退**、`goodsAxis` 回 `null`;
--    本 view **沒有那個早退**,照樣算出四值之一。
--    ⇒ **本片不在 SQL 裡加 `cancelled` 分支**(那會讓 view 的語意從「貨走到哪」變成「貨走到哪 + 單還在不在」,
--       兩件事混在一個欄位裡);**改成 A2 的硬條款,而且要寫成可執行的述詞**(codex R2:原本只寫
--       「必須同時處理 `cancelled_at`」= 沒有定義結果,A2 照樣可能把已取消單一起撈出來):
--       🔴 **A2 下推 `goods_axis` 時必須同時加 `.is('cancelled_at', null)`**,
--          並且**要有一格負向測試**:造一張已取消的單,用任一貨品軸值篩,**它不得出現在結果裡**。
--    ⚠️ 在 A2 做到之前,**不要對外宣稱「篩選結果與膠囊一致」** —— 已取消的單會是反例。
