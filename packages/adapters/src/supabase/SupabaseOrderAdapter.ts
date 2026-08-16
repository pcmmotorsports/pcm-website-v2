import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type {
  CustomerId,
  Money,
  Order,
  OrderListItem,
  PlaceOrderInput,
  PlaceOrderResult,
  AdminOrderDetail,
  AdminOrderFilter,
  AdminOrderListResult,
  AdminOrderSummary,
  AdminOrderWorkflowPatch,
  AdminOrderWorkflowResult,
  AdminOrderItemAmountPatch,
  AdminOrderItemAmountResult,
  Paginated,
  PaginationParams,
} from '@pcm/domain';
// A9w3:`WORKFLOW_STATUS_CODE_RE` 的唯一用途是九碼篩選的字串內插守門,篩選整段已移除
// ⇒ import 一併收掉。🔴 domain 端的 export 暫留(A9w4c 前半未處置,已立案 backlog #332),但**不是**因為還有人在用 ——
//    本片後它全 repo 零 consumer;item writer 驗形狀用的是 workflow-form.ts 自己的 local RE。
import {
  toMoneyAmount,
  normalizeOrderKeywordSearch,
  OrderKeywordSearchShapeError,
} from '@pcm/domain';
import type { Database, Json } from './database.types';
import {
  mapPlaceOrderToCreateOrderArgs,
  mapSupabaseOrderRowToListItem,
  mapSupabaseAdminOrderRowToSummary,
  mapSupabaseAdminOrderDetailRowToDetail,
  type CreateOrderRpcResult,
  type SupabaseAdminOrderRow,
  type SupabaseAdminOrderDetailRow,
  ORDER_ITEMS_EMBED_LIMIT,
  ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT,
  PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT,
} from './mappers/order';
import { ORDER_NOTES_EMBED_LIMIT } from './mappers/order-notes';
import { ORDER_ITEM_PROCUREMENT_EMBED_LIMIT } from './mappers/order-procurement';
import {
  ORDER_CANCELLATIONS_EMBED_LIMIT,
  ORDER_CANCELLATION_ITEMS_EMBED_LIMIT,
} from './mappers/order-cancellations';

/**
 * orders 摘要投影白名單(account OrdersTab / Overview 最近訂單)。
 *
 * 🔴 鐵則 12:**只**摘要欄 + 內嵌 `order_items(quantity)`(只算件數);**禁** unit_price / line_total /
 * product_snapshot / 經銷價 / PII(shipping_address_snapshot / invoice / tappay_rec_trade_id / tier_at_checkout)。
 * module-level `export const` → SupabaseOrderAdapter.test.ts byte-equal + spy 守門(codex C1/N2)。
 */
export const ORDER_LIST_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, total, order_items(quantity)';

/**
 * admin orders 列表投影白名單(M-4a 訂單線;後台 /orders「每商品一列」列表;service_role 全表)。
 *
 * 🔴 鐵則 12:具名白名單、**禁** `select('*')`。
 * - orders 層:客人顯示 `customers(name)` + `tier_at_checkout`(會員等級;M-4a Slice D-1a 起投影)。
 * - 品項層:內嵌 `order_items(variant_sku, quantity, unit_price, line_total, product_snapshot, …)`——
 *   `unit_price`/`line_total` = 該單**成交價**(下單實際賣價、非經銷價表,同明細投影先例);
 *   `product_snapshot` 供品名 title(mapper 防禦容缺)。
 * - brand join:`product_variants(products(brands(name)))`——🔴 穿越帶 `price_store`/`price_by_tier` 的
 *   product_variants/products,但**只取 `brands.name`**;forbidden-token 測試守 price_store/price_by_tier/cost
 *   永不入投影 = 縱深防線。
 * 🔴 tier_at_checkout / 成交價由 forbidden 移 allowed = **有意識鬆綁**(依據 docs/specs/2026-07-15-m4a-
 *   order-list-redesign-slice-d-plan.md §0 經銷價護欄①;admin server-render、SSO 閘後、絕不進非 admin client bundle);
 *   SupabaseOrderAdapter.test.ts 同步改 byte-equal 快照 + 保留真禁 token 斷言。
 * - M-4a D-2:orders 層 workflow_status / version **退出投影**(per-item 真相移 order_items;
 *   orders.workflow_status 停寫停讀、整單狀態=顯示端彙總);order_items 內嵌加 `id, workflow_status,
 *   version`(per-item 改狀態表單 target + 樂觀鎖)。
 * - 🔴 **M-4b E10 A9c(2026-08-06)純加法**,兩件:
 *   ① orders 層加 `invoice_status`(開票紀錄三態 enum;**不加**載具別 —— 那在 `orders.invoice` jsonb,
 *      Sean Q2b=A 明文砍掉,以免破壞下方「列表零 PII、兩白名單刻意分立」那條邊界。`invoice_status`
 *      本身是 CHECK 三值 enum、非 PII);
 *   ② `order_items` 底下加第二個內嵌 `order_item_quantity_summary(…)` —— 三軸(訂貨/到貨/取消)。
 *      🔴 **必須是 nested left embed**(母 plan 計數器摘要列 `:335` 逐字):本常數是 select **字串**、
 *      寫不了 SQL `COALESCE`;該表由 A4a trigger **惰性建列**,沒被採購也沒被取消過的品項**沒有那一列**
 *      ⇒ 缺列回 `null`,正規化成三個 0 是 **mapper 的責任**(見 `mappers/order.ts` 的
 *      `mapListQuantitySummary`)。形狀與明細投影 `:157` 的同一個內嵌一致(A9g-1 先例)。
 *   ⚠️ `order_item_quantity_summary` 是 **service_role-only 表**(母 plan row 26 逐字)。本片零權限面改動:
 *      admin adapter 本來就走 service_role,且明細投影自 A9g-1 起已在讀同一張表。
 * module-level `export const` → 測試 byte-equal + forbidden-token + spy 守門。
 */
// 🔴 `#484a` A2 起本常數是**打在 view `admin_order_list_v` 上**的(不是 `orders`)。
//    view 是建立當下 `SELECT o.*` 的**凍結快照** ⇒ 日後往 `orders` 加新欄、想在這裡投影它,
//    **必須先重建 view**,否則執行期 `42703`(已實測:對 `orders` 打 `goods_axis` 回
//    `{"code":"42703"}`;反過來也一樣)。契約全文見
//    `supabase/migrations/20260814140000_m4b_e10_484a_order_goods_axis_view.sql` 檔頭「寫作契約」。
//    ⚠️ 這一條**沒有守門**,只有這行字(候選修法列在 `#499`)。
export const ADMIN_ORDER_LIST_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, total, order_source, payment_channel, display_position, cancelled_at, tier_at_checkout, invoice_status, customer_user_id, customers(name), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, workflow_status, version, vehicle_snapshot, product_variants(products(brands(name))), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity))';

// M-4b E10 A9w3(九碼契約收縮):`ADMIN_ORDER_LIST_SELECT_ITEM_STATUS_FILTERED`
// (`order_items!inner(...)` 版投影)已移除 —— 它的唯一用途是九碼篩選,而該篩選在 A9w2 下架
// (URL 參數與 UI 皆已不存在)⇒ 留著就是一份沒有呼叫端、卻仍要維護「與主常數逐欄相同」的白名單。
// 🔴 A9b2-A 當時刻意**不把它復活**:供應商單號搜尋改走兩段式查詢、`ADMIN_ORDER_LIST_SELECT`
//    一個字都不動。⚠️ #347-B 之後**連那條兩段式查詢本身都退場了**(Q-347-B1=B)——
//    這段留作紀錄:`!inner` 版投影至今仍沒有呼叫端,誰要復活它都得先讀鐵則 12 的 byte-equal 守門。

/**
 * 用 `.in('id', …)` 帶進第二段查詢的 order id **筆數上限**(#347-2a 抽出的單一來源)。
 *
 * ⚠️ #347-B:原本**供應商單號**與**關鍵字搜尋**兩條路共用這一個數字(前者另有自己的常數
 *    指過來)。供應商那條隨 Sean 拍板 Q-347-B1=B 退場,現在只剩關鍵字一個 consumer。
 *
 * 🔴 **這個值受的是物理限制:PostgREST 的 GET query string 長度。**
 * 量法=量**完整 query string**(含 `select` + `order`),不是只算 `in` 那一項:
 *     0 筆(只有 select + order)→   551 bytes
 *   100 筆                      → 4,461 bytes  ← 本值
 *   200 筆                      → 8,361 bytes  ← 已越過 8KB 常見預設
 * ⚠️ **這張表原本寫在供應商那支常數的 docstring 裡,而那支已隨 #347-B 刪除** ——
 *    表跟著沒了,這裡當時只剩一句「見上方」指向空氣(R1 Imp-5 抓到)。
 *    ⇒ 搬回這裡:量法與它量的那個數字放同一處,才不會再被別處的刪除連帶掏空。
 * ⚠️ 誠實邊界:8KB 是常見的伺服器預設,**未在正式站的 PostgREST 前緣實測過**。
 *
 * 🔴🔴 **釘值那道守門仍然必要**(關卡1 R2-M5):有人把它改成 200 時,
 * **production 與拿它產測資料的測試會一起漂**、8KB URL 的病無聲復活而全部測試仍然綠。
 * ⇒ `SupabaseOrderAdapter.test.ts` 有一格**獨立釘死字面 100**(不從本常數導出),
 * 要改必須先重量 URL 預算、並同步 migration 裡 RPC 的硬夾值。
 *
 * ⚠️ 與 RPC 的關係:`admin_search_orders` 自己也把 `p_limit` 硬夾在 100(migration `:198`)。
 * 這裡仍顯式送出去,是為了讓「呼叫端要多少」寫在呼叫端 —— 不依賴 DB 的預設值。
 */
export const ADMIN_ORDER_ID_IN_CAP = 100;

/**
 * 「什麼都沒查到」的共用回傳(#347-2a)。
 *
 * 🔴 用途只有一種:**正規化階段就判定不可能有結果**的早退(三個搜尋維度任一 `invalid`)。
 * 那些路徑**還沒打過 RPC** ⇒ `keywordMatchCount` 必須是 `null`(「沒搜過」)而不是 `0`(「搜了、零命中」)。
 * ⚠️ **不要**把它用在「搜了但零命中」的早退上 —— 那幾處要帶真實的 `keywordTruncated` /
 * `keywordMatchCount`,混用會把兩種成因抹成同一種,正好抵銷 `keywordMatchCount` 存在的理由。
 *
 * 🔴🔴 **是函式、不是共用常數**(關卡2 R1 抓到):寫成 module-level 的 const 物件時,
 * **每次早退都回同一個實例** —— 任何 consumer 只要 `result.items.push(...)` 或改 `total`,
 * 就會污染**之後所有 request** 的早退結果,而原本的 inline 物件每次都是新的。
 * 那是本片**無意間改掉的既有行為**,而且症狀會出現在別的請求上、幾乎不可能被追回這一行。
 * (`Object.freeze` 不夠:它是淺凍結,`items` 陣列照樣 push 得進去。)
 */
function emptyAdminOrderList(): AdminOrderListResult {
  return {
    items: [],
    total: 0,
    keywordTruncated: false,
    keywordMatchCount: null,
    // #338:根本沒查過 ⇒ `null`(不是 `[]` = 查過但認不出來)。
    supplierOrderNoMatchedSuppliers: null,
  };
}

/**
 * `#347-1` 建的搜尋 RPC 名稱。**全 repo 只有一處呼叫它**,由
 * `admin-search-orders-post-only.test.ts` 的原始碼掃描守著(連同「不得改成 GET/HEAD」那幾條)。
 */
export const ADMIN_SEARCH_ORDERS_FN = 'admin_search_orders';

/**
 * ~~`admin_search_orders` 的最小呼叫面 `AdminSearchOrdersRpcClient`~~
 * 🔴 **2026-08-11 已拆(backlog #415)**:窄介面把生成型別繞過去了,拆掉之後函式名與參數名
 * 改由 `database.types.ts` 的 `admin_search_orders` 區塊直接把關
 * (數法=`grep -n "^      admin_search_orders: {" packages/adapters/src/supabase/database.types.ts`,落筆當下 `:2898`)(同批補了第 ⑩ 組手動校正:`p_from` / `p_to` 的 `| null`,
 * 因為呼叫端刻意送顯式 `null`、不用 spread)。
 * ⚠️ 型別接手的是**函式名與參數名**;`Returns: Json` ⇒ 回傳形狀型別層一個字都保證不了,
 *    仍由下面的 `parseAdminSearchOrdersResult` 四道執行期驗證負責 —— 拆 cast 沒有改變那一層。
 */

/** UUID 形狀(RPC 回的 `ids` 逐顆驗;非 UUID 進 `.in()` 會讓 PostgREST 400 = 整頁錯誤態)。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 把 `admin_search_orders` 的回傳當**外部輸入**驗(#347-2a)。
 *
 * 🔴 **為什麼不硬轉**:RPC 回的是 `jsonb`,PostgREST 原封轉成 JSON ⇒ **型別系統一個字都保證不了**。
 * 硬轉 = 把「DB 到底回了什麼」變成沒人驗的假設,而 mock 餵的一定是對的形狀
 * ⇒ **測試全綠、功能壞掉**。(這個形狀原本記在 `SupplierOrderNoSearchShapeError` 的檔頭,
 * 那支類別已隨 #347-B 刪除 ⇒ 判準搬到這裡,不留指向已刪符號的指標。)
 *
 * 四道,任一不符就擲、且**吵**(關卡1 R2-M5 把後兩道補上):
 * ① `data` 是非陣列物件 ② `ids` 是陣列且**每顆**都是 UUID 形狀
 * ③ `truncated` 是 boolean(不是 truthy 判斷 —— 缺鍵時 `undefined` 會靜默變成「沒截斷」)
 * ④ `ids.length <= ADMIN_ORDER_ID_IN_CAP`(RPC 哪天被改成回 101 筆,`.in()` 的 URL 就爆,
 *    而那個失敗會長得像「整個列表壞了」,不像「搜尋回太多」)。
 *
 * 🔴 擲出的訊息**只含結構描述、不含搜尋詞**:它會進 server log,而搜尋詞是 PII(migration `:50-74`)。
 */
function parseAdminSearchOrdersResult(data: unknown): { ids: string[]; truncated: boolean } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new OrderKeywordSearchShapeError(`回傳不是物件(拿到 ${describeType(data)})`);
  }
  const { ids, truncated } = data as { ids?: unknown; truncated?: unknown };
  if (typeof truncated !== 'boolean') {
    throw new OrderKeywordSearchShapeError(`truncated 不是 boolean(拿到 ${describeType(truncated)})`);
  }
  if (!Array.isArray(ids)) {
    throw new OrderKeywordSearchShapeError(`ids 不是陣列(拿到 ${describeType(ids)})`);
  }
  if (ids.length > ADMIN_ORDER_ID_IN_CAP) {
    throw new OrderKeywordSearchShapeError(
      `ids 有 ${ids.length} 筆、超過上限 ${ADMIN_ORDER_ID_IN_CAP}(RPC 的硬夾值與呼叫端不同步?)`,
    );
  }
  if (!ids.every((id): id is string => typeof id === 'string' && UUID_RE.test(id))) {
    throw new OrderKeywordSearchShapeError('ids 含非 UUID 形狀的元素');
  }
  // 🔴 唯一性(家規:外部輸入每一條假設都要驗)。RPC 端用 `EXISTS` 而不是 JOIN 正是為了不吐重複
  //    (migration `:226-227` 明文),所以重複 = **那個保證破了**。
  //    不擋的話:`keywordMatchCount` 會**比真實訂單數大** ⇒ 2b 對員工說「找到 N 筆」時 N 是錯的。
  //    ⚠️ 誠實修正(code-reviewer):第一版還寫了「URL 會被灌水」——**那是假的**,
  //    `postgrest-js@2.105.3` 的 `.in()` 先跑 `Array.from(new Set(values))`,重複值到不了 URL。
  //    一個真後果 + 一個假後果 = 下一個人照著假的那條去驗會驗不出來。fail-closed 且吵,不靜默去重。
  if (new Set(ids).size !== ids.length) {
    throw new OrderKeywordSearchShapeError('ids 有重複(RPC 的 EXISTS 語意保證不該發生)');
  }
  return { ids, truncated };
}

/** 只回型別名稱,**不回值** —— 值可能是搜尋結果、不該進 log。 */
function describeType(v: unknown): string {
  if (v === null) return 'null';
  return Array.isArray(v) ? 'array' : typeof v;
}

/**
 * admin 訂單「明細」投影白名單(M-4a Slice B、後台 /orders/[id] 明細頁;service_role 全表)。
 *
 * 🔴 PII 邊界(設計檔 2026-07-13):明細**才**攜 customers(name, email, phone)+
 * shipping_address_snapshot(收件姓名/電話/地址)+ invoice(結帳開票需求)——列表投影
 * `ADMIN_ORDER_LIST_SELECT` 維持精簡零 PII、兩白名單**刻意分立**。
 * 🔴 鐵則 12:**仍禁** `select('*')`、零成本欄(price_store / price_by_tier / cost)、
 * **零 tappay_rec_trade_id**(金流對帳識別碼不進顯示層)、零 cart_session_id / address_id /
 * tier_at_checkout。order_items 內嵌成交價欄(unit_price / line_total)=該單實際賣價、非經銷價表;
 * product_snapshot = create_order 寫入的 {sku, spec, title}、無價格欄(mapper 防禦容缺)。
 * module-level `export const` → SupabaseOrderAdapter.test.ts byte-equal + forbidden-token 守門。
 *
 * 🔴 M-4b E10 A9a-1 加 `order_notes(...)` 內嵌(備註時間軸 + U6 告知義務)。這條字串**只列欄位**;
 * 另外三件事分工如下(`mappers/order-notes.ts` 檔頭有完整理由):①U6 的 `NOT EXISTS` 語意在
 * **mapper**(PostgREST 投影不支援子查詢,實測回 400 `PGRST100`)②排序在 **mapper**(內嵌列順序
 * 不保證)③筆數上限與取哪些列在**查詢鏈**(`findAdminOrderDetail` 的 `.limit()` + `.order()`),
 * 截斷偵測則由 mapper 依該上限判定。
 * 🔴 `order_notes` 是**內部資料**(含內部備註),只走 service_role;建表檔
 * `20260729030000_m4b_e10_a3_order_notes.sql:17-19` 明文「一個 byte 都不能放 orders」
 * (orders 對登入客人整表開放 SELECT)⇒ 本欄位組**絕不可**被搬進 storefront 的任何投影。
 *
 * 🔴 M-4b E10 A9a-2 在 `order_items` 底下加兩層內嵌:`order_item_procurement(… suppliers(…))`
 * (採購讀模型;master plan `:385` row 38 的採購那半,下游 = A10b `:404` row 57 的採購表單)。
 * 分工同 A9a-1:這條字串只列欄位,排序與截斷判定在 `mappers/order-procurement.ts`、
 * 筆數上限在查詢鏈。
 * 🔴 **同一條紅線**:採購真相表也是 service_role only —— 建表檔
 * `20260729020000_m4b_e10_a2_order_item_procurement.sql:16-18` 明文供應商名稱 / 單號 / 異常原因
 * 「一個 byte 都不能進 orders / order_items」(對代購生意而言,洩漏上游 = 客人可以繞過 PCM)
 * ⇒ 本欄位組**絕不可**被搬進 storefront 的任何投影;守門測試同時盯三條列表投影。
 * 🔴 `suppliers` 只取 `label` / `is_active`(顯示名 + 停用提示):S1b 起本表不存供應商名稱文字,
 * 顯示名一律 JOIN(`20260801150000_m4b_e10_s1b_procurement_supplier_fk.sql:159-161`)。
 *
 * 🔴 M-4b E10 A9g-1 在 `order_items` 底下加第二個內嵌:`order_item_quantity_summary(…)`
 * (三軸數量**衍生快取**;取消 UI 要靠它算「這個品項還能取消幾件」)。
 * 🔴 **措辭要準**(關卡2 MF4 更正本段原本寫的「真相表」):A1 建表 COMMENT `20260730150000:141`
 * 逐字「衍生值,非真相 —— 真相在 A2 採購表與 A7 取消明細」;A8a2 的守門也是**從真相明細重算**
 * (`20260805100000:395-406`),不讀本表的值、只驗它在不在場。叫它「真相表」會誘導後人拿它當守門
 * 依據,而那正是母 plan `:384` row 37 抓到的坑。本投影讀它**只為了畫面顯示與輸入上限**。
 * 🔴 **同一條紅線**:本表帶的是營運內部數量事實(已訂/已到貨/已取消),
 * **絕不可**被搬進 storefront 的任何投影 —— 客人看得到「已向上游訂了幾件」等於看得到採購節奏。
 * 守門測試用反射盯 `*SELECT*` 匯出、不手寫常數名(見 `SupabaseOrderAdapter.test.ts` 同款);
 * 該處**刻意拆兩條**:storefront 永不放寬 / admin 列表待 A9c(母 plan **row 40**)合法解禁 —— **A9c 已於
 * 2026-08-06 落地**。(原寫的 `:387` 是過期行號,現指到 row 23;母 plan 引用一律用 row 號當主錨。)
 * 🔴 **形狀**:`order_item_id` 雖是 PRIMARY KEY(邏輯 1:1),但 FK 是複合鍵
 * `(order_item_id, quantity)`,generated types 的 `order_item_quantity_summary_item_fk.isOneToOne`
 * 逐字為 `false` ⇒ 指向 to-many = 陣列。**但那是規則推導、不是實測到的 wire 回應**
 * ⇒ mapper 兩種形狀都吃、不賭邊(理由詳 `mapQuantitySummary` docstring)。
 * 0 筆 = A4a 還沒建那一列 = **「不知道」而非「都是 0」**,翻成 `quantitySummary: null`、下游 fail-closed。
 *
 * 🔴 M-4b E10 A9g-2 在 orders 層加扣款嘗試內嵌(**現已帶 FK hint,逐字見常數本體與下一段**)。
 * 🔴 **2026-08-10 熱修:內嵌必須帶 FK hint `!payment_charge_attempts_order_id_fkey`,不是排版**。
 * `20260809230000`(L5a-M)加了 `superseded_by_order_id uuid REFERENCES orders(id)` ⇒ orders 與本表
 * 之間**有兩條 FK**,裸內嵌讓 PostgREST 無從決定走哪條、整條明細查詢回 `PGRST201`
 * (正式站 2026-08-10 全站明細頁壞掉的根因;錯誤原文與影響面在 `E-082-STOP`)。
 * FK 名逐字取自 PostgREST 回應的 `hint` 欄,**不是自己拼的**,不要改寫成別的寫法。
 * 🔴 **配套事實(本機真 PostgREST 實測,12.2.12 與 14.16 兩版同結果)**:加了 hint 之後,
 * 下面 `findAdminOrderDetail` 的三個 `referencedTable` 引數仍要填**原表名**
 * `'payment_charge_attempts'`,回傳 JSON 的鍵也仍是原表名。
 * ⚠️ **填含 hint 的那個字串不會回 query error,而是靜默失效** —— 量到的是「無 error、
 * 且這組 order/limit 完全沒作用」(repro 三筆全回、插入序);至於 PostgREST 內部
 * 是「解不到排序目標就丟棄」還是別的路徑,**是推測、沒量到**。
 * ⇒ 錯法的症狀只出現在**回傳內容**(取到哪 N 筆變未定義、正式站還要疊上伺服器 `max-rows`),
 * 呼叫端拿不到任何錯誤訊號。只有那三個引數維持原表名才是對的,
 * 別拿「頁面不再顯示失敗文案」當它們還活著的證據 —— 它們自己的守門是
 * `SupabaseOrderAdapter.test.ts` 那三條 `toHaveBeenCalledWith` 的表名字面
 * (突變其中**任一個**成 hint 字串即轉紅,2026-08-10 實跑)。
 * (審查更正:本註解初稿寫「會回 42703 硬報錯」是錯的 —— 那是最小 repro 的 `orders`
 *  沒有 `created_at` 才報的錯,補齊該欄後兩版 PostgREST 都改成不報錯。)
 * 用途 = 取消 UI 的**單層**閘:A8a2 只在 `payment_status='unpaid'` **且**該單扣款嘗試全為終態
 * `failed`(或零筆)時才放行(`20260805100000:360-364`,判定字面逐字 `status <> 'failed'`)。
 * 只看 `payment_status` 會漏掉「已扣款但尚未回填」的單 ⇒ 畫面給按、送出必拒。
 * 🔴 **只取 `status` 一欄**:本表帶 `rec_trade_id` / `bank_transaction_id` / `fallback_token_hash`
 * 等金流識別碼,而本投影的既有紅線就寫著「零 tappay_rec_trade_id」——
 * 取消 UI 只需要「有沒有非 failed 的」這一個事實,多取任何一欄都是白給的洩漏面。
 * 🔴 截斷語意與其他內嵌**不同、更嚴**:看到的是子集時不能說「沒有在途扣款」
 * ⇒ 缺鍵或觸及上限一律翻成 `'unknown'`,呼叫端 fail-closed
 * (三態契約詳 `AdminOrderDetail.chargeAttemptGate`)。
 *
 * 🔴 M-4b E10 A9g-3 再加 `order_cancellations(… order_cancellation_items(…))` 取消歷程(兩層內嵌)。
 * 🔴 **A9d2-2b 起加取 `idempotency_key`**(`20260730130000:86`)—— 片 3(A9g-3)當時判定它是
 * A8a1/A8a2 的內部冪等狀態、刻意不取;依 `A-203-STOP` ③ 主視窗裁示 A **改判**:
 * 員工開啟取消表單時手上就握著這顆 token,災難當天它是唯一能把「我送出的那次」與歷程列
 * 一眼對上的鍵(完整理由見 `AdminOrderCancellation.idempotencyKey`)。
 * 🔴 **`payload_hash` 照舊不取**(`:93`)—— 那顆對員工不可讀、也對不了帳;`order_id` 亦不取(父列即該單)。
 * 🔴 `actor` = staff id、`idempotency_key` = 內部冪等機制:兩者都進得了本投影(後台要對帳),
 * 但**永不得**進另外三條投影。⚠️ **兩者的守門強度不同、不要混為一談**(code-reviewer 抓到我
 * 原本把它們綁成同一句):
 * - `idempotency_key`:反射式 token 守門(`SupabaseOrderAdapter.test.ts`,只蓋本檔的**具名**
 *   `*_SELECT` 常數)+ leak-guard 的表名層與欄名層,共三道。
 * - `actor`:**只有** byte-equal 與 leak-guard 的表名層。欄名層與反射式都**刻意不收**它 ——
 *   它是跨稽核表的通用欄名,收了會讓未來合法的 `order_refund_jobs(actor)` 誤紅。
 *   ⇒ 「合法更新某條投影常數 + 同步改它的 byte-equal 期望值」這個情境對 `actor` **零測試轉紅**,
 *   靠的是那張表本身進不了對客投影(表名層)。這個不對稱是選的,不是漏的。
 * ⚠️ **inline `.select()` 的盲區是有方向的**(關卡2 codex R2 提出、R3 收窄):
 * 反射式那道只看得到**具名常數**,對任何 inline select 全盲(本檔 `findTotal` `:254` 就是一例);
 * leak-guard 那道掃的是原始碼**全文**,所以 storefront 裡手寫的 inline select **它看得見**——
 * 它的盲區是掃描根之外(`packages/`)。⇒ 真正沒人看得見的只有「掃描根外的 inline select」。
 */
/**
 * 🔴 **OD 片 2(2026-08-13)加 `customer_user_id`** —— 詳情頁「客人明細入口」要連
 * `/customers/[id]`,而 `AdminOrderDetail` 原本拿不到 id(需求檔 §0-J J-4)。
 * 加的是 **orders 自己的欄、非成本欄**,`ADMIN_ORDER_LIST_SELECT` 的 forbidden 清單
 * (price_store / price_by_tier / price_general / cost / address_id …)逐字比對零碰撞;
 * `AdminOrderSummary` 早有同款先例(`mappers/order.ts:239`)。不動 schema / RLS / RPC。
 * 主視窗 2026-08-13 裁准動下方 byte-equal 守門,並要求本片 commit 前跑 codex 對抗審查。
 */
/**
 * 🔴 **`#476` 片 1(2026-08-14)在採購內嵌加 `voided_at, void_reason`** —— 應用層一直不認得
 * 「已作廢」,而 DB 從 `#452` 片 2a-1 起就只把 `voided_at IS NULL` 的列算進額度
 * (`20260813120000_m4b_e10_452_procurement_void_schema.sql:352-355` COMMENT 逐字)
 * ⇒ 畫面列得出 3 件、`ordered_quantity` 卻說 0 件。
 *
 * 🔴 **本片只把兩欄帶回來,不改任何「判斷邏輯」** —— 沒有任何 `find` / `some` / `length`
 * 因為本片而改變結果(分流在片 2/3/4)。
 * ⚠️ ~~原字面「不改任何**行為**」~~ **過強、已改**(codex 關卡2 must-fix):**payload 那一面不是零**,
 * 見下方「admin 端有一面不是零」。
 *
 * 🔴 **這裡加 filter 是錯的做法,刻意不做**:`WHERE voided_at IS NULL` 一行就能讓下游**絕大多數**
 * 讀者面自動正確(逐面清單見 backlog `#476`;🔴 **本處刻意不寫面數** —— 那個數字已被更正過一次,
 * 抄一份進 code 註解 = 製造第二個會各自漂移的真相),
 * 但員工按下「作廢」之後畫面上會什麼都不留 —— 他無法確認那個動作成功了,
 * 而**動作後沒有回饋**正是讓人重複操作的形狀(Sean 常設準則「操作直覺化」;
 * 樣板 `apps/admin/src/lib/shipping/order-shipments.ts:11` 逐字「否則畫面上會變成貨憑空消失」)。
 * ⇒ 帶回來 + 顯示端標示,**與 shipments 線同形**。主視窗 2026-08-14 裁 B。
 *
 * 🔴 **兩欄成對取**:DB `order_item_procurement_void_pair` 強制同進同出(同檔 `:347-350`),
 * 只取 `voided_at` 會讓顯示端標得出「已作廢」卻說不出原因,而理由 + 稽核是**唯一**事後追溯手段
 * (同檔 `:356`)。
 * 🔴 **紅線不變**:兩欄都是營運內部欄(誰為什麼撤掉一張採購單),與本投影既有的採購紅線同級
 * ⇒ **絕不可**被搬進 storefront 的任何投影。
 * (實查 2026-08-14:本常數的**唯一**消費端是下方 `findAdminOrderDetail`;storefront 對
 *  `IOrderRepository` 呼叫的是 `listSummariesByCustomer` / `findTotal` / `placeOrder` 三支,
 *  都不走本常數。⚠️ 這句只說「今天沒有」、不是機制保證。)
 * ⚠️ **兩道 leak-guard 加起來仍不是密封的**(codex 關卡2 must-fix,收窄我原本寫的「擋住它的是
 *  leak-guard 測試」):①本檔測試那道只反射**同 module 內名稱含 `SELECT` 的字串匯出**,對別檔的
 *  inline `.select()`、不叫 `*SELECT*` 的常數、query builder 動態拼接全盲;
 *  ②`scripts/storefront-projection-leak-guard.test.ts` 掃 storefront **原始碼全文**(本片同步在它的
 *  欄名層加了四個字面),但它自陳的盲區是**掃描根之外**(`packages/`)。
 *  ⇒ 剩下的可構造路徑:`packages/` 裡的 inline select、view 改名欄、admin API 把整包 domain model
 *  轉送出去。**這些今天沒有守門,誠實記在這裡,不宣稱涵蓋。**)
 * 🔴 **admin 端有一面不是零**:`item-procurement-form.tsx` 是 `'use client'` 且吃 `procurements`
 * ⇒ 兩欄(含 `voidReason` 這段營運內部文字)自此進入 admin 的 RSC client payload。
 * admin 是員工專用 app、**不構成對外洩漏**,但「本片不改任何行為」在這一面**不是零**,記在這裡。
 */
export const ADMIN_ORDER_DETAIL_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, order_source, payment_channel, payment_method, paid_at, subtotal, shipping_fee, discount_total, total, shipping_method, shipping_address_snapshot, invoice, invoice_number, invoice_amount, invoice_status, cancelled_at, cancelled_reason, version, customer_user_id, customers(name, email, phone), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, order_item_procurement(id, supplier_id, allocated_quantity, received_quantity, reply_status, contact_channel, submitted_at, supplier_order_no, exception_reason, expected_arrival_date, first_ordered_at, status_changed_at, created_at, voided_at, void_reason, suppliers(label, is_active)), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)), order_notes(id, note_type, body, channel, occurred_at, author, corrects_note_id, created_at), payment_charge_attempts!payment_charge_attempts_order_id_fkey(status), order_cancellations(id, reason_code, reason_detail, actor, idempotency_key, created_at, order_cancellation_items(id, order_item_id, cancelled_quantity))';

/**
 * 兩層深內嵌資源的路徑(PostgREST `order` / `limit` 參數的前綴;A9a-2)。
 *
 * 🔴 **實測過才寫死**(2026-08-03 對 production 唯讀實跑、公開表 + publishable key,可證偽做法):
 * `brands?select=id,products(id,product_variants(id))&limit=1&products.limit=3` 三個 product 的
 * variants 數 = `[1, 8, 1]`;**加上** `&products.product_variants.limit=1` 後變 `[1, 1, 1]`
 * ⇒ 兩層深的路徑確實被套用(不是「剛好都只有一個 variant」)。同法驗 order:
 * `products.product_variants.order=id.asc` vs `.desc` 在那個 8 變體的 product 上回不同 id。
 * supabase-js 端只是字串前綴(`postgrest-js@2.105.3` `src/PostgrestTransformBuilder.ts:336`
 * `${referencedTable}.order` / `:455` `${referencedTable}.limit`)⇒ 傳這個帶點的路徑,
 * 送出的正是上面實測過的 wire 形狀。
 */
const PROCUREMENT_EMBED_PATH = 'order_items.order_item_procurement';

/**
 * 取消歷程的兩層深內嵌路徑(A9g-3;形狀與依據逐字同 `PROCUREMENT_EMBED_PATH`)。
 */
const CANCELLATION_ITEMS_EMBED_PATH = 'order_cancellations.order_cancellation_items';

/**
 * SupabaseOrderAdapter:Supabase 真實 IOrderRepository 實作(M-3-S2-b2-b2)。
 *
 * **client 由 wire-up 層注入、本 adapter 不建 client;建單走 RPC**(M-4a 起雙注入形,docstring
 * 對齊實況=tier 片欠帳修、值班台 verdict N1):
 * - **storefront**:composition `getOrderRepo` 注 cookie-aware request-scoped **authenticated** client
 *   (能讀 session cookie 拿 auth.uid();RLS own-only 生效)。
 * - **admin(M-4a)**:`apps/admin` `order-repository.ts` 注 **service_role** client(BYPASSRLS 看全單
 *   =後台預期;`20260611120000` admin 唯讀保留 SELECT)——「零 service_role」舊字面已不成立。
 *   admin 讀=`listOrderSummariesForAdmin`/`findAdminOrderDetail`/`listSummariesByCustomer`(白名單投影);
 *   admin 寫=`updateAdminOrderWorkflow`(owner RPC+同交易 audit;item 層那支已於 A9w4c 後半移除,
 *   非裸 UPDATE);會員歸屬縱深靠各方法顯式 `.eq()`。
 * - 建單 `placeOrder` 呼 `create_order` SECURITY DEFINER RPC(migration 20260604130000):
 *   authenticated 對 orders/order_items 僅 SELECT、無直接 INSERT → 建單只能走本 RPC;
 *   價 / 運費 / tier / 歸屬全 RPC server 端 `auth.uid()` + product_variants 權威算,
 *   client 永不送價 / tier / userId;return DTO 只 `{order_id, display_id}`(🔴 鐵則 12 零價結構)。
 *
 * **server-only**:從 `@pcm/adapters` root export(來源 client.ts 頂層 `import 'server-only'` 約束整條
 * chain);鏡像 SupabaseAddressAdapter/Customer/Vehicle(root barrel、非 /server 受控小門〔那是
 * Wallet service_role / Auth 專用;admin 的 service client 亦從 /server 取〕)。
 *
 * **讀路徑延 stage ③**:findById / listByCustomer / listByStatus 重建 domain Order 需從 order_items
 * 還原 OrderItem,但 order_items **無 product_id**(只有 variant_id)→ domain OrderItem.productId 必填
 * 無法忠實重建(backlog #217、傾向改 productId optional);故本片讀方法明確 deferred-stub、延 stage ③
 * 訂單查詢(plan §7)。
 *
 * #106:client 注入 `SupabaseClient<Database>` generic、findTotal 欄位 compile 期檢。`.rpc('create_order', args)`
 * 入參走 mapper 白名單；B-3 依 flag 產精確 8 / 9 鍵(database.types.ts 的 9th key 已拍板留 B-4 重 gen)。
 * `data as unknown as CreateOrderRpcResult` **保留**(create_order RPC generated
 * `Returns: Json`、wire 為 narrowed `{order_id, display_id}` DTO、Json→DTO 須 cast;非 type-safety 漏洞、
 * 是 RPC jsonb scalar 邊界的正當投射)。RPC `RETURNS jsonb` scalar → data 即該物件、不需 `.single()`。
 */
export class SupabaseOrderAdapter implements IOrderRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * 建單:呼 create_order RPC(server 權威)。
   * client 只送 lines(variant+qty)+ addressId + shippingMethod + invoice、永不送價/tier/userId;
   * RPC 錯誤(RAISE / 網路)原樣上拋不吞(對齊既有 adapter 裸 throw 慣例);回 `{orderId, displayId}`。
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    // B-3:mapper 以 notificationEmail 屬性是否存在，產精確 8 / 9 鍵；同一 RPC 名稱不變。
    const { data, error } = await this.supabase.rpc(
      'create_order',
      mapPlaceOrderToCreateOrderArgs(input),
    );
    if (error) {
      throw error;
    }
    const result = data as unknown as CreateOrderRpcResult | null;
    if (
      !result ||
      typeof result.order_id !== 'string' ||
      typeof result.display_id !== 'string'
    ) {
      throw new Error('create_order RPC 回傳格式非預期(缺 order_id / display_id)');
    }
    return { orderId: result.order_id, displayId: result.display_id };
  }

  /**
   * 付款編排窄讀(②-③c-1、plan v6 §4):`select total`(單欄;storefront authenticated client
   * 下 RLS own-only;admin 不呼本方法)→ Money。
   * - 查無 / 非本人(RLS 濾掉)→ null(caller fail-closed 拒付款、不 throw)。
   * - DB `total integer` 元位 → `toMoneyAmount` 中央守門(整數/非負;絕不 `as MoneyAmount`)。
   * - 🔴 鐵則 12:此值為 charge 與 confirm p_amount 的單一金額來源(client 永不送價、零浮點)。
   */
  async findTotal(id: string): Promise<Money | null> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('total')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error; // 裸 throw(對齊 placeOrder 慣例);caller(action)吞通用字面
    }
    // #106:typed client → data 為 `{ total: number } | null`,消除舊 `(data as {...}).total` inline cast;
    // typeof number 檢保留(runtime fail-closed 縱深、防 RLS/邊界回非預期)。
    if (!data || typeof data.total !== 'number') {
      return null; // 查無/非本人(RLS)→ fail-closed
    }
    return { amount: toMoneyAmount(data.total), currency: 'TWD' };
  }

  /**
   * 列出某會員訂單摘要(account OrdersTab / Overview 最近訂單;created_at desc 新到舊)。
   *
   * 🔴 鐵則 12 / IDOR 縱深:
   * - 顯式 `.eq('customer_user_id', customerId)` 應用層歸屬縱深(兩種注入 client 下皆為歸屬保證);
   * - storefront(authenticated client):RLS `orders_select_own`(auth.uid() = customer_user_id)
   *   資料層再擋一層(任一層失效另一層仍擋);
   * - admin(M-4a 明細-b 起):注 service_role(BYPASSRLS)、RLS 層不生效,own-scoping 唯一保證
   *   =上述顯式 eq(值班台快掃親驗);
   * - 投影 `ORDER_LIST_SELECT` 白名單 + 內嵌 `order_items(quantity)`(只算件數、零價格/PII 欄)。
   * - **隱藏 unpaid 孤兒單(#249 治標)**:`.neq('payment_status','unpaid')` 濾掉客人放棄付款後停留
   *   unpaid 的孤兒單(對齊 Shopify 客人端:未付成不進訂單列表);orderCount(account/page 同源 `orders.length`)天然跟著對齊。
   *   ⚠️ 前提=絕大多數 unpaid 皆「沒付成的孤兒」(PCM 現僅 TapPay 即時刷卡、無線下待付款單);未來加線下付款方式須重審。
   *   ⚠️ 已知短暫窗:3DS 付成後到 settleCharge 翻 paid 之間,在途單短暫仍 unpaid 會被暫藏、對帳收斂(秒~分鐘)後自然顯示 —— 顯示層治標的可接受延遲、非孤兒、非本改引入的回歸。
   *   治本(reuse / 學 Shopify 付成才建單)見 backlog #249。
   * 繞過 #217(摘要不含 items[])。error → throw(對齊 placeOrder/findTotal 慣例;caller try/catch 退空陣列、頁面不 500)。
   */
  async listSummariesByCustomer(customerId: CustomerId): Promise<OrderListItem[]> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(ORDER_LIST_SELECT)
      .eq('customer_user_id', customerId)
      .neq('payment_status', 'unpaid') // #249 治標:藏放棄付款的 unpaid 孤兒單(前提=無線下待付款單)
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return data.map(mapSupabaseOrderRowToListItem);
  }

  /**
   * admin 訂單列表摘要(M-4a 訂單線第一片;後台營運找單 / 看狀態;service_role 全表、非 RLS own-only)。
   *
   * - 投影 `ADMIN_ORDER_LIST_SELECT` 具名白名單(禁 `select('*')`;內嵌 customers(name) + tier_at_checkout(會員等級)
   *   + order_items 成交價/品名 + brand join〔穿越 product_variants/products 只取 brands(name)、經銷價成本欄零投影,
   *   縱深防線見 const docstring〕;M-4a Slice D-1a「每商品一列」);
   * - 雙軸 + 次要篩選走 **DB where 下推**(payment_status 單值 .eq;goods_axis 多值 .in〔`#484a` A2 起,
   *   取代原本的 fulfillment_status .eq —— 那一欄正式站 13/13 全是 `notOrdered`,
   *   ⇒ 四值裡**只有 `notOrdered` 篩得到(13 筆),其餘三值必定零筆**〕;order_source /
   *   payment_channel D-1b 起多勾選 .in;缺欄 / 空陣列 = 不限;全在 FilterBuilder 階段套用、避免 order/range 後改鏈型別);
   * - **server 端分頁** `.range(offset, offset+limit-1)`(offset 預設 0)+ 排序 `created_at` DESC(新到舊)+
   *   `count: 'exact'` 取符合條件總筆數(供 UI「共 N 筆」+ 分頁控制);
   * - error → 裸 throw(對齊 placeOrder / listSummariesByCustomer 慣例;caller〔admin 頁〕try/catch 退錯誤態、頁面不 500)。
   *
   * 🔴 鐵則 12:service_role 讀 orders 已於 20260611120000「admin 唯讀」保留 SELECT;orders 表無成本欄(天生守)+
   * 白名單投影縱深。data 走 `as unknown as SupabaseAdminOrderRow[]`(customers forward FK = many-to-one 單物件、
   * 生成型別對 embed 推斷不穩,以 runtime 真相 cast、同 SupabaseProductAdapter 慣例)。
   */
  async listOrderSummariesForAdmin(
    filter: AdminOrderFilter,
    pagination: PaginationParams,
  ): Promise<AdminOrderListResult> {
    const offset = pagination.offset ?? 0;

    // ── #347-B:搜尋維度只剩**關鍵字**一個 ─────────────────────────────────────
    // 🔴 **正規化仍排在任何 I/O 之前**:不合法的搜尋詞不可能有結果 ⇒ 零 I/O 早退。
    //    (原本這裡驗三個維度、順序本身是修過的 bug;訂單編號與供應商單號兩個專用維度
    //     已隨 Q-347-B1=B 退場、併入關鍵字的 `admin_search_orders` #1 新單號 / #12 舊單號 / #11 供應商單號分支,
    //     只剩一個維度之後「錯誤優先序依賴查詢先後」那個坑自然消失。)
    const keywordSearch = normalizeOrderKeywordSearch(filter.keyword);

    // 🔴 關鍵字不合法就零 I/O 早退(原本這裡還有訂單編號與供應商單號兩段各自的
    //    正規化與 fail-closed 早退,隨 Q-347-B1=B 一起退場)。
    if (keywordSearch.kind === 'invalid') {
      return emptyAdminOrderList();
    }

    // ── #347-2a 關鍵字搜尋:走 `admin_search_orders` RPC,拿 order id 清單 ──────────
    // ⚠️ **原本這裡有一條「必須排在供應商 probe 之前」的順序規則**(關卡1 R3-F1,Fable 抓到:
    //    供應商先跑會讓它的零命中早退把 RPC 整個跳過 ⇒ `keywordTruncated` 假性為 false)。
    //    供應商 probe 隨 Q-347-B1=B 退場之後**沒有第二個查詢可以排前面了**,那條規則自然失效 ——
    //    留著這段是為了讓下一代知道它是**被移除的**、不是被忘記的。
    //    合約本身沒變:`AdminOrderListResult` 的 docstring 仍要求 truncated 時**含 0 筆**一律提示。
    // 🔴 為什麼是 RPC 而不是把欄位加進投影:命中面含 `shipping_address_snapshot`,
    //    那一欄在鐵則 12 的 forbidden 清單裡 ⇒ 擴投影 = 親手拆守門。走 RPC 之後
    //    **PII 只在 SQL 內比對,一個字都不進讀模型、不進 RSC payload**(migration `:9-17`)。
    // #338:這次搜尋命中了哪幾家供應商。`null` = 這次不是供應商單號搜尋(見 domain docstring)。
    // 🔴 `const` 不是 `let`(R1 m3):#347-B 之後**沒有任何 producer 會改寫它**,
    //    唯一的 producer(供應商兩段式 probe)已退場 ⇒ 恆 `null`,語意見
    //    `IOrderRepository.listOrderSummariesForAdmin` 的 docstring(「本片起恆 null,producer 待片 B-2」)。
    //    寫成 `let` 會讓讀者以為下面某處會賦值,那是假訊號。
    const supplierOrderNoMatchedSuppliers: { id: string; label: string | null }[] | null = null;
    let keywordOrderIds: string[] | null = null;
    let keywordTruncated = false;
    let keywordMatchCount: number | null = null;
    if (keywordSearch.kind === 'ok') {
      // 🔴 `.rpc()` 預設 POST + JSON body ⇒ 搜尋詞不進 URL。**不得**為了快取或好 debug 傳
      //    `{ get: true }` 或 `{ head: true }` —— 那兩個走 postgrest-js 的**同一個分支**
      //    (`PostgrestClient.ts:413-422`),都會把 `p_query` `url.searchParams.append` 進網址,
      //    而網址會落進 access log / CDN log / 瀏覽器歷史 / Referer(migration `:50-74` 的硬要求)。
      //    這條由 `admin-search-orders-post-only.test.ts` 的原始碼掃描守著,不是只寫在這裡。
      // 🔴 參數名逐字對 migration 簽章(`:154-155`):GRANT 綁精確簽章,漂一個字 = 執行期 404/42501,
      //    而 typecheck 抓不到 —— ⚠️ 理由更正(2026-08-11 晚重 gen):**不是**「RPC 不在生成型別裡」
      //    (它在 `database.types.ts` 裡,數法=`grep -n "^      admin_search_orders: {" …`,落筆當下 `:2898`),
      //    是**這裡的窄介面 cast 把生成型別繞過去了**。
      //    ✅ **2026-08-11 #415 已拆 cast**:函式名與參數名這一層現在由生成型別接手
      //    (突變證:把函式名或任一參數名加 `_TYPO` ⇒ tsc 當場紅)。
      //    原始碼掃描那一組**仍然必要**:它守的是「POST-only(不得出現 get/head)」與
      //    「不得用 spread」,那兩件事 typecheck 看不到。
      const { data, error } = await this.supabase.rpc(ADMIN_SEARCH_ORDERS_FN, {
        p_query: keywordSearch.value,
        p_limit: ADMIN_ORDER_ID_IN_CAP,
        // 🔴🔴 **日期一定要下推進 RPC,不能只篩列表**(#347-3b;plan §1 逐字):
        //    #347-1 的取樣順序是「**先**取全域最新 100 筆命中,**才**與其他篩選取交集」
        //    ⇒ 只在列表那邊 `.gte('created_at')` 的話,要找的單可能整張落在那 100 筆之外,
        //    畫面顯示 0 筆而且**看起來像查無此單**。下推之後取樣窗口才會變成「這段期間內最新 100」。
        // 🔴 **一律帶兩個鍵、沒有值就送 `null`,不用 spread**:
        //    ①`admin-search-orders-post-only.test.ts` 明文禁止在這個引數物件用 `...`
        //      —— spread 會讓該檔「參數名逐字對 migration」那組守門與型別檢查同時失效;
        //    ②`null` 與省略在 DB 側等價 —— migration `:134-135` 是
        //      `(p_from IS NULL OR …) AND (p_to IS NULL OR …)`,NULL = 該側不限。
        //      這一點**已對正式站實測**(#347-3b 收工前的 PostgREST smoke,四鍵帶 null 回傳與省略一致)。
        // 🔴 空字串也折成 `null`(與列表那側的 truthy 判斷同語意;R1 nit 6)。
        p_from: filter.createdFrom || null,
        p_to: filter.createdTo || null,
      });
      // 🔴 error 先處理、再碰 data(同本檔既有慣例;先讀 data 會讓錯誤變成形狀錯誤、指錯方向)。
      if (error) {
        throw error;
      }
      const parsed = parseAdminSearchOrdersResult(data);
      keywordTruncated = parsed.truncated;
      keywordMatchCount = parsed.ids.length;
      // 零命中 ⇒ 回零筆、**不打第二段**(同供應商那段的既有處置:不押 `.in('id', [])` 的行為)。
      // 🔴 `keywordTruncated` **照實帶出去、不寫死 false** —— 「零命中且 truncated」在 RPC 的合約下
      //    構造不出來,但不靠「不可能」寫死:靠不可能寫死的值,哪天可能了就是靜默降級。
      if (parsed.ids.length === 0) {
        return { items: [], total: 0, keywordTruncated, keywordMatchCount, supplierOrderNoMatchedSuppliers };
      }
      keywordOrderIds = parsed.ids;
    }

    // ── id 來源:#347-B 之後**只剩關鍵字 RPC 一個** ────────────────────────────────
    // ⚠️ 原本這裡把「關鍵字」與「供應商單號」兩份 id 在 JS 內取交集,只送一次 `.in('id', …)`
    //    (理由=送兩次會產生兩個同名 `id=in.(…)`,而重複同欄 filter 的合併語意未文件化
    //     ⇒ 押錯 = 其中一半靜默失效 = fail-open)。供應商那一份隨 Q-347-B1=B 退場,
    //    交集退化成直接取用 —— **但「只送一次 `.in`」這條規則本身仍然成立**:
    //    片 B-2 把供應商能力接回來時,要接回的是那個交集,不是第二次 `.in`。
    const orderIdFilter = keywordOrderIds;
    // 🔴 **這裡原本還有一條 `orderIdFilter.length === 0` 的早退,R1 Imp-3 指出它恆假、已刪。**
    //    理由:上面 `parsed.ids.length === 0` 已經早退,而 `keywordOrderIds` 只在那之後才被賦值
    //    ⇒ 走到這裡時它要嘛是 `null`(沒搜關鍵字)、要嘛是**非空**陣列,長度不可能為 0。
    //    ⚠️ 我當時給它寫的理由「關鍵字有命中卻被其他篩選砍光」**也是錯的** —— 其他篩選是
    //      在下面 `.eq/.in/.gte` 下推給 PostgREST 的,砍的是 DB 端結果,砍不到這個 JS 陣列。
    //      (兩軸取交集的年代它才可達;交集隨供應商維度一起退場。)
    // ✅ `keywordMatchCount` 本身仍然必要,只是理由在**別處**:關鍵字命中 N 筆、但下推的其他
    //    篩選把最終列表砍成 0 筆時,畫面與「關鍵字零命中」完全同形 —— 那個分辨靠它,不靠這條分支。

    // ── `#484a` 片 A2:列表**改讀 view**(`admin_order_list_v` = orders 全欄 + `goods_axis`)──
    // 🔴 只有這一支換源。**本檔**其餘三處 `.from('orders')`(會員側列表 / 明細 / 單欄查 total)**刻意不動** ——
    //    (repo 內另有三處在別的 repository:退款 / 出貨 / storefront 付款狀態 —— 同樣不需要 `goods_axis`。)
    //    它們不需要 `goods_axis`,而換源會讓它們一起吃到 view 的 GRANT 面(view 只開 service_role)。
    // 🔴 **投影字串一個字都沒改**:view 是 `SELECT o.*` 的純加法投影 ⇒ 既有 15 個頂層欄與四層 embed
    //    全部原樣可用。**這不是推的** —— apply 之後拿 `ADMIN_ORDER_LIST_SELECT` 逐字對正式站打過:
    //    `HTTP=200`,`customers` / `order_items` / `product_variants` / `order_item_quantity_summary`
    //    四層 embed 全回得來(這是 plan §8 列的「本片最大未知」,現已關掉)。
    // ⚠️ `goods_axis` **沒有加進投影** —— 列表顯示用的貨品軸由 `orderGoodsAxis()` 從品項數量算
    //    (狀態膠囊那條路),撈回來就是第二份真相。本片只拿它**下推篩選**。
    //    ⚠️ 「SQL 的判序」與「JS 的判序」**原本沒有任何守門綁著** —— 缺口記在 **`#499`**
    //    (不是 `#488`;`#488` 問的是「誰該寫 `fulfillment_status` 那個欄」,是另一題)。
    //    ✅ **`#522`(2026-08-16)已綁上一半**:兩邊各自對**共用真值表**
    //    `apps/admin/src/lib/orders/goods-axis-cases.json` 比對
    //    (TS 側 `goods-axis-cases.test.ts`、SQL 側 `docs/probes/order-goods-axis-parity-probe.sh`)。
    //    🔴 **另一半仍是缺口**:那份真值表守的是【判定結果】,
    //    `ADMIN_ORDER_LIST_SELECT` 的四值字面與 view 的對應仍是人工比對。`#499` 不得標為已解。
    let query = this.supabase
      .from('admin_order_list_v')
      .select(ADMIN_ORDER_LIST_SELECT, { count: 'exact' })
      // 🔴 **內嵌上限:把邊界從伺服器的 `db-max-rows` 手上拿回來**(2026-08-16,`Q-EMBED-1` Sean 批)。
      //    不設的話,`order_items` 會在伺服器的上限處被切,而**PostgREST 對內嵌截斷不給任何訊號**
      //    (仍回 200、`Content-Range` 不反映)⇒ 偵測不到。
      //    設了之後,`mapAdminOrderSummary` 才算得出 `itemsTruncated`(該處有完整理由)。
      // ⚠️ **`.order()` 與 `.limit()` 要成對** —— 沒有明確排序時「前 N 筆」是哪 N 筆未定義,
      //    而截斷判定只看「筆數是不是剛好 N」、不看是哪幾筆,但**未排序的截斷會讓兩次查詢拿到不同子集**
      //    ⇒ 同一張單的軸可能在兩次重新整理之間跳動。明細那支(`findAdminOrderDetail`)同樣成對。
      .order('id', { referencedTable: 'order_items', ascending: true })
      .limit(ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT, { referencedTable: 'order_items' });
    if (orderIdFilter) query = query.in('id', orderIdFilter);
    if (filter.paymentStatus) query = query.eq('payment_status', filter.paymentStatus);
    // 🔴 `.in()` 不是 `.eq()`:現行 producer(單選下拉)只給 0 或 1 個值,但型別是陣列(片 B 的 chip UI)。
    //    ⚠️ 空陣列 = 不限(`?.length` 擋掉)—— 押 `.in('goods_axis', [])` 的行為在 PostgREST 未文件化,
    //    與上下兩軸的既有處置一致,不另立一套。
    if (filter.goodsAxes?.length) {
      query = query.in('goods_axis', [...filter.goodsAxes]);
      // 🔴🔴 **A1 migration `:171-173` 的硬條款,不是我加的謹慎**(逐字:「A2 下推 `goods_axis` 時
      //    必須同時加 `.is('cancelled_at', null)`,並且要有一格負向測試」)。
      //    理由:view 的 `goods_axis` 對**已取消的單照樣算得出四值之一**,而畫面的
      //    `orderStatusView()`(`order-status-axes.ts:147-156`)對已取消單**先早退**、膠囊寫「已取消」
      //    ⇒ 不加這一條,員工選「已到貨」會撈回一張膠囊寫著「已取消」的單。
      // 🔴 **綁在這個 `if` 裡面、不是全域**:沒有選貨品軸時,已取消的單**照舊要看得到**
      //    (列表本來就要顯示已取消單,把它全域藏掉是另一件事、而且沒有人拍板過)。
      query = query.is('cancelled_at', null);
    }
    // ── `#1` 片1:待處理 =「還沒收錢 **或** 還沒訂貨」──────────────────────────
    //   🔴 **這是本查詢裡唯一一個 OR 語意的篩選**;其餘每一軸疊上去都是 AND。
    //   拍板值域(出處 commit `4ffda20b` / `a01457be`,兩顆都在 `origin/dev` 上、可達):
    //     還沒收錢 = `unpaid` ∪ `partiallyPaid`(**不含 `refunded` / `partiallyRefunded`**
    //     —— 那會讓已退款單跑進待處理,正是 `#494` 剛修掉的病)
    //     還沒訂貨 = `goods_axis = 'none'`
    //
    //   🔴 **寫成三個 `eq` 而不是 `payment_status.in.(…)`,是刻意的**:
    //     片0(`docs/specs/2026-08-15-1-p0-postgrest-or-semantics.md`,commit `b4865c29`)
    //     實測過的是「**兩個 `.or()` 疊起來 = AND、各自括號保住**」與「`.or()` 疊 `.in('id',…)` = AND」,
    //     **沒有測過 `in.(…)` 寫在 `or=(…)` 的括號【裡面】。**
    //     ⚠️ **這裡的理由是【成本】不是【能力】,措辭要準**(E 窗 R1 指出、我更正):
    //     「片0 沒測過那個語法」是事實;「**所以不能用**」不成立 ——
    //     **片0 就是我自己起一座丟棄式 PostgREST 量出來的,要再量一次隨時做得到、分母不是 0。**
    //     ⇒ 正確的說法是:**不值得為這一行再起一次那座環境**,不是「測不到」。
    //     ⚠️ 代價:多一個 term、URL 長一點。換到的是這一行的語意直接落在片0 已量過的形狀上。
    //     🔴 **若哪天真的需要 `in.(…)` 進 `or=()`(例如值變多)—— 那就再起一次環境量,不要憑推論改。**
    //
    //   🔴🔴 **`cancelled_at` 守門必須自己帶** —— 片0 §0 第 3 題實測:`.or()` **不會**自帶它,
    //     不加就會撈回已取消的單(那一列真的跑出來過)。理由同下面 `goodsAxes` 那段:
    //     view 的 `goods_axis` 對已取消單照樣算得出值,而畫面對已取消單早退寫「已取消」
    //     ⇒ 員工按「待處理」會看到一批膠囊寫著「已取消」的單。
    //   ⚠️ **綁在這個 `if` 裡、不是全域**(同 `goodsAxes` 的既有理由:沒篩時已取消單照舊要看得到)。
    if (filter.pendingOnly) {
      query = query.or(
        'payment_status.eq.unpaid,payment_status.eq.partiallyPaid,goods_axis.eq.none',
      );
      query = query.is('cancelled_at', null);
    }
    if (filter.orderSources?.length) {
      query = query.in('order_source', [...filter.orderSources]);
    }
    if (filter.paymentChannels?.length) {
      query = query.in('payment_channel', [...filter.paymentChannels]);
    }
    // ── #347-3b:建立日期範圍(半開區間 `[from, to)`)──────────────────────────
    // 🔴 `lt` 不是 `lte`:`to` 是**下一個台北午夜**(見 domain `date-range.ts`)。
    //    用 `lte` 配「當天 23:59:59」會在微秒級漏單,而那是一年只發生幾次、查不出來的漏單。
    // 🔴 用 truthy 判斷、不是 `!== undefined`(R1 nit 6):型別上合法的空字串會讓
    //    `.gte('created_at', '')` 送出 `created_at=gte.` ⇒ PostgREST 400 ⇒ **整個列表進錯誤態**;
    //    而 RPC 那側的 `?? null` 對空字串是「照送空字串」—— 兩條路徑語意不一致本身就是坑。
    //    truthy 也對齊本檔既有慣例(`filter.orderSources?.length` 那幾條)。
    if (filter.createdFrom) {
      query = query.gte('created_at', filter.createdFrom);
    }
    if (filter.createdTo) {
      query = query.lt('created_at', filter.createdTo);
    }
    // ── M-4b 生命週期 L6:預設隱藏「刷卡未付款」單 ────────────────────────────
    // NOT(tappay AND unpaid) 依 De Morgan = (channel<>tappay) OR (status<>unpaid)。
    //
    // 🔴🔴 **豁免已整條退場(#347-B;Sean 拍板 Q-347-B1=B)—— 這不是遺漏,是決定。**
    //
    // 原本的規則是 D-385-A 裁定的「**豁免綁精準鍵**」:查詢含訂單編號 / 供應商單號等
    // 精準識別鍵 ⇒ 豁免隱藏;純關鍵字不豁免。它的實作就掛在那兩個專用搜尋維度上
    // (`orderNumberSearch.kind !== 'ok' && supplierSearch.kind !== 'ok'`)。
    // 兩個維度隨 Q-347-B1=B 退場之後,**那條規則沒有實作了** —— Sean 拍板逐字:
    //   「收掉兩舊搜尋欄後,**不保留**『打單號自動不藏刷卡未付款單』的豁免能力;
    //     **查無時提示**『可能有未付款的單被隱藏,勾起來再查一次』。」
    //
    // 🔴 **「不默默降級」現在由誰承載**:`apps/admin/src/app/orders/page.tsx` 的
    //    `UNPAID_CARD_HIDDEN_HINT` —— 關鍵字搜尋 + 本規則生效 + 0 筆 ⇒ 明示提示 +
    //    指向篩選列那個勾(唯一逃生口)。**改動本條件式的人必須連那句提示一起看**:
    //    這裡多藏一種情況,那邊就少講一種情況。
    //
    // ⚠️ **RPC 回不出「以哪一支分支命中」**(`admin_search_orders` 只回 `{ids, truncated}`)
    //    ⇒ 就算想恢復「精準鍵豁免」也做不到,除非改 RPC 回傳形狀(而「以哪一欄命中」
    //    本身帶 PII 指向性,要重走 2b 的紅線審查)。這是**能力上的**限制、不是懶。
    //
    // ⚠️ 前提(nit 8):De Morgan 等價只在兩欄皆 NOT NULL 時成立(SQL 三值邏輯:`neq` 遇 NULL
    //    回 NULL、該列被丟掉 = 靜默多藏單)。實查兩欄都安全:`payment_channel` NOT NULL DEFAULT 'tappay'
    //    (`20260712203000_m4a_orders_admin_columns.sql`)、`payment_status` NOT NULL(`20260604120000`)。
    //    誰把任一欄改成 nullable,必須回頭重看這一行。
    //
    // 🔴 關鍵字**本來就不在豁免名單裡**(D-385-A 同一段),理由不因本片改變:關鍵字是
    //    多維度子字串搜尋,搜「王」或一個品牌名會一次撈回大量 tappay×unpaid 單,
    //    正是 Sean 逐字要求藏起來的那批(`types.ts` 的 `includeUnpaidCardOrders` docstring)。
    if (!filter.includeUnpaidCardOrders) {
      query = query.or('payment_channel.neq.tappay,payment_status.neq.unpaid');
    }
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }) // 次鍵防同秒單分頁跨頁重複/漏單(Fable D-2 verdict n1)
      .range(offset, offset + pagination.limit - 1);
    if (error) {
      throw error;
    }
    const items = (data as unknown as SupabaseAdminOrderRow[]).map(
      mapSupabaseAdminOrderRowToSummary,
    );
    return { items, total: count ?? 0, keywordTruncated, keywordMatchCount, supplierOrderNoMatchedSuppliers };
  }

  /**
   * admin 訂單明細(M-4a Slice B;/orders/[id];service_role 全表、讀模型投影繞 #217)。
   *
   * - 投影 `ADMIN_ORDER_DETAIL_SELECT`(明細專用白名單:含 PII、零成本/經銷/rec_trade_id);
   * - `.maybeSingle()`:查無 → null(caller 404、不 throw);error → 裸 throw(caller 退錯誤態);
   * - embed cast 同 list 慣例(customers many-to-one 生成型別不穩、以 runtime 真相 cast + mapper 正規化)。
   * - 🔴 A9a-1:`order_notes` 顯式夾 `ORDER_NOTES_EMBED_LIMIT`(嚴格低於實測的伺服器 `max-rows`)——
   *   讓「截斷邊界」由我們的常數擁有、與專案設定脫鉤;理由與殘餘風險見 `mappers/order-notes.ts`。
   *   🔴 **配一條 `.order()` 是必要的、不是排版**:只給 limit 而不給序,PostgREST 回**哪** 200 筆
   *   未定義、跨請求可能是不同子集(審查 R2 nit4)。取 `created_at` **DESC** = 截斷時保留**最新**那批
   *   (時間軸顯示前由 mapper 重新排成 ASC;未截斷時本序無影響)。
   * - 🔴 A9a-2:採購內嵌列**同樣**自己送 order + limit,理由與 A9a-1 逐字相同(伺服器 `max-rows`
   *   對內嵌列生效、內嵌順序不保證)。差別只在它多一層 —— 路徑常數 `PROCUREMENT_EMBED_PATH`
   *   的 docstring 附「兩層深路徑真的生效」的 production 可證偽實測。
   * - 🔴 **每個內嵌都配 `id` 次鍵**(關卡2 codex MF4;同本檔列表分頁 `.order('id')` 的既有理由):
   *   `created_at` 單鍵在**截斷邊界**有並列時,伺服器回哪一筆未定義 —— mapper 的 tie-break 只能排
   *   已經拿到的列,救不回被切掉的那筆。次鍵讓「切在哪」變成確定的。
   *   🔴 A9a-1 的 `order_notes` 少了這道,本片一併補(同一個根因,只修我這半 = 留一半的洞)。
   * - 🔴 **`order_items` 這層自己也要上限**(關卡2 codex MF2):沒有它,外層被伺服器 `max-rows`
   *   截斷時整個品項連同採購列一起消失,而 per-item 的 `procurementTruncated` **看不到**
   *   (它只看得到自己那層)。⇒ 送 `ORDER_ITEMS_EMBED_LIMIT` + `id` 序,並把觸及上限翻成
   *   `AdminOrderDetail.itemsTruncated`。
   */
  async findAdminOrderDetail(id: string): Promise<AdminOrderDetail | null> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(ADMIN_ORDER_DETAIL_SELECT)
      .eq('id', id)
      .order('created_at', { referencedTable: 'order_notes', ascending: false })
      .order('id', { referencedTable: 'order_notes', ascending: false })
      .limit(ORDER_NOTES_EMBED_LIMIT, { referencedTable: 'order_notes' })
      .order('created_at', { referencedTable: PROCUREMENT_EMBED_PATH, ascending: false })
      .order('id', { referencedTable: PROCUREMENT_EMBED_PATH, ascending: false })
      .limit(ORDER_ITEM_PROCUREMENT_EMBED_LIMIT, { referencedTable: PROCUREMENT_EMBED_PATH })
      .order('id', { referencedTable: 'order_items', ascending: true })
      .limit(ORDER_ITEMS_EMBED_LIMIT, { referencedTable: 'order_items' })
      // 🔴 A9g-2:扣款嘗試同樣要 order + id 次鍵 + limit(理由逐字同 order_notes 那組:
      //    只給 limit 不給序 ⇒ 伺服器回哪 N 筆未定義、跨請求可能是不同子集)。
      .order('created_at', { referencedTable: 'payment_charge_attempts', ascending: false })
      .order('id', { referencedTable: 'payment_charge_attempts', ascending: false })
      .limit(PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT, {
        referencedTable: 'payment_charge_attempts',
      })
      // 🔴 A9g-3 取消歷程:order + id 次鍵 + limit(理由逐字同 order_notes 那組)。
      //    請求端要 **DESC** = 配上限時留下的是最新的 N 筆;顯示序(ASC)由 mapper 自己排,
      //    兩者刻意不同、不是筆誤。
      .order('created_at', { referencedTable: 'order_cancellations', ascending: false })
      .order('id', { referencedTable: 'order_cancellations', ascending: false })
      .limit(ORDER_CANCELLATIONS_EMBED_LIMIT, { referencedTable: 'order_cancellations' })
      // 🔴 兩層深那一層自己也要上限(理由逐字同 order_items × 採購那組):沒有它,
      //    取消列被伺服器 max-rows 截斷時,per-列的 itemsTruncated 會連同該列一起消失。
      .order('id', { referencedTable: CANCELLATION_ITEMS_EMBED_PATH, ascending: true })
      .limit(ORDER_CANCELLATION_ITEMS_EMBED_LIMIT, {
        referencedTable: CANCELLATION_ITEMS_EMBED_PATH,
      })
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return mapSupabaseAdminOrderDetailRowToDetail(data as unknown as SupabaseAdminOrderDetailRow);
  }

  /**
   * 後台改單(M-4a Slice C;走 admin_update_order_workflow owner RPC)。
   *
   * 🔴 patch → jsonb wire:**只放呼叫端明確提供的 key**(未提供 = 省略 = RPC 端「不動該欄」;
   * 明給 null = 清空)。逐欄顯式建構(同 mapPlaceOrderToCreateOrderArgs 白名單縱深),
   * 即使 patch 帶意外欄也不洩到 RPC。金流欄型別層已無,此處 wire 再縱深。
   *
   * RPC 回文字碼 'UPDATED'/'CONFLICT'/'NOOP';error(輸入非法 / DB)→ 裸 throw
   * (caller server action 收斂成固定錯誤碼、不外洩 DB error 到瀏覽器)。
   */
  async updateAdminOrderWorkflow(
    id: string,
    expectedVersion: number,
    patch: AdminOrderWorkflowPatch,
    actor: string,
    requestId: string,
  ): Promise<AdminOrderWorkflowResult> {
    // 逐欄:key 存在且值非 undefined 才進 wire(null=清空、透傳);undefined=視同未提供、不進 wire。
    // 🔴 D-2:workflow_status 不再映射(型別層已無;orders 層停寫、狀態唯一寫入面=item 層 RPC)。
    const p: Record<string, string | number | null> = {};
    if ('shippingMethod' in patch && patch.shippingMethod !== undefined) {
      p.shipping_method = patch.shippingMethod;
    }
    if ('invoiceNumber' in patch && patch.invoiceNumber !== undefined) {
      p.invoice_number = patch.invoiceNumber;
    }
    if ('invoiceAmount' in patch && patch.invoiceAmount !== undefined) {
      p.invoice_amount = patch.invoiceAmount;
    }
    if ('invoiceStatus' in patch && patch.invoiceStatus !== undefined) {
      p.invoice_status = patch.invoiceStatus;
    }

    const { data, error } = await this.supabase.rpc('admin_update_order_workflow', {
      p_order_id: id,
      p_expected_version: expectedVersion,
      p_patch: p as Json,
      p_actor: actor,
      p_request_id: requestId,
    });
    if (error) {
      throw error;
    }
    // RPC RETURNS text scalar → data 即 'UPDATED'/'CONFLICT'/'NOOP';防腐壞收斂。
    if (data === 'UPDATED' || data === 'CONFLICT' || data === 'NOOP') {
      return data;
    }
    throw new Error('admin_update_order_workflow RPC 回傳非預期碼');
  }

  /**
   * 後台改品項金額(M-4b E10 `#13` 片1b)。契約與語意全文見 port docstring。
   *
   * 🔴 **具名參數、逐鍵顯式建構,不用 spread**:七個鍵一律帶齊,
   * 沒有值的那個(`p_zero_price_reason`)送**顯式 null**、不送 undefined。
   *
   * 🔴🔴 **而「忘了帶會變編譯錯誤」這句,靠的是下面那個 `Required<…Args>` 標註,不是靠自律。**
   * 生成型別把 `p_zero_price_reason` 寫成 `?:`(它在 DB 是 `DEFAULT NULL`)⇒
   * **直接傳物件給 `.rpc()` 時漏掉它,TypeScript 會過**,而 RPC 端會拿到預設 NULL、
   * 在 `unitPrice > 0` 時連反向閘都通過 ⇒ **靜默回 `'OK'`**。
   * (2026-08-15 codex 關卡2 **R2 must-fix**:原本這裡只寫「不用 spread ⇒ 忘了帶會編譯錯誤」,
   *  那是**宣稱一道不存在的防線** —— 同一種病的第二次:docstring 說的事情 code 不做。)
   * ⇒ 修法 = 先建一個 `Required<Args>` 的區域常數再傳進去,**少一鍵就編譯不過**。
   * ✅ 實測承知:拿掉 `p_zero_price_reason` 那一行 ⇒ `tsc` 逐字
   * `TS2741: Property 'p_zero_price_reason' is missing in type … but required in type 'Required<…>'`。
   *
   * ⚠️ 已知缺口(本片不修,留給 1c 的表單層):TS 的 `number` **不保證整數**。
   * RPC 只驗 `IS NULL OR < 0`(`:361`),沒有驗整數;非整數值經 PostgREST 送進 `integer` 參數
   * 會被怎麼處理,**本片沒有實測、不宣稱**。⇒ 整數驗證屬 1c 的輸入層責任。
   *
   * 🔴 `zeroPriceReason` 不在本層做任何判斷 —— 0 元必填 / 非 0 元必須為 null 這兩道
   * 是 RPC 的 API 契約閘(`:366` / `:371`),**在 DB 端 fail-closed**。
   * 這一層若自己先擋一次,等於把契約複製成兩份、而只有一份會被測到。
   */
  async updateAdminOrderItemAmount(
    id: string,
    expectedVersion: number,
    patch: AdminOrderItemAmountPatch,
    actor: string,
    requestId: string,
  ): Promise<AdminOrderItemAmountResult> {
    // 🔴 `Required<…Args>`:把生成型別裡那個 `?:` 關掉 ⇒ 七鍵少一個就編譯不過。
    //    這是上面那句「忘了帶會變編譯錯誤」的**載體**;拿掉這個標註,那句話就變成空話。
    const args: Required<
      Database['public']['Functions']['admin_update_order_item_amount']['Args']
    > = {
      p_order_id: id,
      p_order_item_id: patch.orderItemId,
      p_unit_price: patch.unitPrice,
      p_expected_version: expectedVersion,
      p_actor: actor,
      p_request_id: requestId,
      p_zero_price_reason: patch.zeroPriceReason,
    };
    const { data, error } = await this.supabase.rpc('admin_update_order_item_amount', args);
    if (error) {
      throw error;
    }
    // RPC RETURNS text scalar → data 即 'OK'/'CONFLICT'/'NOOP';防腐壞收斂。
    // 🔴 成功碼是 'OK'(migration :482),不是 workflow 那支的 'UPDATED'。
    if (data === 'OK' || data === 'CONFLICT' || data === 'NOOP') {
      return data;
    }
    throw new Error('admin_update_order_item_amount RPC 回傳非預期碼');
  }

  // 🔴 **`updateAdminOrderItemWorkflow` 實作已於 A9w4c 後半(2026-08-06)具名移除**(port 簽章同批拆)。
  //    九碼 writer 鏈退場的最後一段應用層契約:A9w4a 拆了 server action、A11a 列表重建完成 ⇒ 零 consumer。
  //    ⚠️ **正確讀法 = 「應用層與 adapter 都沒有這個寫入介面」,不是「九碼寫不進去」** ——
  //    DB 端 `admin_update_order_item_workflow` RPC 仍在(**REVOKE 非 DROP**);其 EXECUTE 權
  //    由 **A9v `20260807120000`** 撤除、apply 後 service_role 叫不動。

  // ── 讀路徑(完整 Order):延 stage ③ 訂單查詢(deferred-stub、Q6=A 本片不啟用)──
  // order_items 無 product_id → domain OrderItem.productId 無法忠實重建(backlog #217);
  // stage ③ 開工前拍 #217 解法(傾向 domain OrderItem.productId 改 optional)後再實作重建 mapper。
  findById(): Promise<Order | null> {
    return Promise.reject(
      new Error(
        'SupabaseOrderAdapter.findById 未實作:訂單讀路徑延 stage ③ 訂單查詢(backlog #217、order_items 無 product_id)',
      ),
    );
  }

  listByCustomer(): Promise<Order[]> {
    return Promise.reject(
      new Error(
        'SupabaseOrderAdapter.listByCustomer 未實作:訂單讀路徑延 stage ③ 訂單查詢(backlog #217)',
      ),
    );
  }

  listByStatus(): Promise<Order[]> {
    return Promise.reject(
      new Error('SupabaseOrderAdapter.listByStatus 未實作:admin 訂單列表延 M-4a-08'),
    );
  }
}
