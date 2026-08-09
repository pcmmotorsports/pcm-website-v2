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
  AdminOrderSummary,
  AdminOrderWorkflowPatch,
  AdminOrderWorkflowResult,
  Paginated,
  PaginationParams,
} from '@pcm/domain';
// A9w3:`WORKFLOW_STATUS_CODE_RE` 的唯一用途是九碼篩選的字串內插守門,篩選整段已移除
// ⇒ import 一併收掉。🔴 domain 端的 export 暫留(A9w4c 前半未處置,已立案 backlog #332),但**不是**因為還有人在用 ——
//    本片後它全 repo 零 consumer;item writer 驗形狀用的是 workflow-form.ts 自己的 local RE。
import {
  toMoneyAmount,
  normalizeOrderNumberSearch,
  normalizeSupplierOrderNoSearch,
  SupplierOrderNoSearchTooManyError,
  SupplierOrderNoSearchShapeError,
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
export const ADMIN_ORDER_LIST_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, total, order_source, payment_channel, display_position, cancelled_at, tier_at_checkout, invoice_status, customer_user_id, customers(name), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, workflow_status, version, vehicle_snapshot, product_variants(products(brands(name))), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity))';

// M-4b E10 A9w3(九碼契約收縮):`ADMIN_ORDER_LIST_SELECT_ITEM_STATUS_FILTERED`
// (`order_items!inner(...)` 版投影)已移除 —— 它的唯一用途是九碼篩選,而該篩選在 A9w2 下架
// (URL 參數與 UI 皆已不存在)⇒ 留著就是一份沒有呼叫端、卻仍要維護「與主常數逐欄相同」的白名單。
// 🔴 A9b2-A 刻意**不把它復活**:供應商單號搜尋改走兩段式查詢,
//    `ADMIN_ORDER_LIST_SELECT` 一個字都不動(理由見 `listOrderSummariesForAdmin` 內註解)。

/**
 * 供應商單號搜尋(A9b2-A)**去重後訂單數**的上限。
 *
 * 🔴 **推導自實測的 URL 長度**(同 A9b1 `MAX_ORDER_NUMBER_SEARCH_LENGTH` 的形狀)。
 * 第二段是 `.in('id', ids)`,值會 append 進 GET query string —— 但 query string **不只有它**,
 * 還有整條 `select` 投影。當場量(`URLSearchParams` 編碼後):
 *
 * 量法(可重現):`new URLSearchParams()` 依序 append `select`(本檔的 `ADMIN_ORDER_LIST_SELECT`,
 * 原始 446 字)、`order=created_at.desc`、`id=in.(n 筆 UUID)`,取 `.toString().length`。
 *
 * | n | 完整 query string bytes |
 * |---|---|
 * | 0(只有 `select` + `order`)| 551 |
 * | **100** | **4,461** |
 * | 200 | 8,361 |
 *
 * ⚠️ **原本這裡寫 200、並宣稱「≈7.8KB、低於 8KB 且留兩倍餘裕」——那是錯的**(階段 C must-fix):
 * 我只算了 `in` 這一項、**漏算 `select`**,實際 8,361 bytes 已經越過自己引用的 8KB 線。
 * ⇒ 改成 **100**(4,461 bytes),這才是真的留兩倍餘裕。
 * (🔴 二修:第一版的分項表 550 + 7,802 **自己加不起來** = 8,352 ≠ 8,361,因為漏算了參數名與 `&`
 *  —— Fable F3。改成直接列「完整 query string 長度」,不再拆分項,免得再出現加不起來的字面。)
 *
 * 超過時**擲 {@link SupplierOrderNoSearchTooManyError}、不截斷**(截斷 = 讓使用者以為那就是全部)。
 * ⚠️ 誠實邊界:8KB 是常見的伺服器預設,**未在正式站的 PostgREST 前緣實測過真實上限**。
 */
export const SUPPLIER_ORDER_NO_MATCH_CAP = 100;

/**
 * 第一段查詢的**採購列**取數上限(與 {@link SUPPLIER_ORDER_NO_MATCH_CAP} 是**兩個不同的量**)。
 *
 * 🔴 **為什麼要分兩道**(階段 C must-fix 的根因):`.limit()` 限的是**採購列數**,
 * 而 URL 長度取決於**去重後的訂單數**。原本只有一道 `.limit(CAP+1)` + `ids.length > CAP` 判斷 ——
 * 兩邊量的不是同一件事 ⇒ 「列被截斷、但去重後 ≤ CAP」時**不擲錯、靜默少回訂單**,
 * 正是這個上限本來要防的病。(一張 PO 覆蓋 80 張訂單共 250 列完全正常:
 * A2 的業務鍵是 `(order_item_id, supplier_canonical_key)`,一單多品項就是多列。)
 * ⇒ 現在:**列數觸頂 = 明示擲錯**(不知道真集合)、**去重後訂單數超標 = 明示擲錯**(URL 會爆)。
 *
 * 🔴 **取值必須嚴格低於伺服器 `max-rows`**(2026-08-02 production 實測 **1000**,
 * 見 `mappers/order-cancellations.ts:31`)—— 否則截斷發生在伺服器那一側,
 * `rows.length` 永遠碰不到我的上限,**這道偵測就變成恆假**。500 留一半餘裕。
 * (`max-rows` 日後被調低於本值時本判定同樣看不見 —— 同 backlog **#325** 的漂移問題。)
 */
export const SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT = 500;

/**
 * A9b2-A 第一段查詢的回傳列形狀:`order_item_procurement` → `order_items!inner(order_id)`。
 *
 * 🔴 走 `as unknown as` cast 的理由與本檔其他 embed 一致:forward FK 的 many-to-one embed
 * 在生成型別上推斷不穩(而且 `supplier_order_no_upper` 在 A9b2-M apply 前根本不在型別裡)。
 * 🔴 `order_items` 宣告成**可選**是為了讓「形狀不符」在型別上表達得出來 —— 但 runtime 的處置是
 * **擲 {@link SupplierOrderNoSearchShapeError}、不是靜默濾掉**(Fable F1;理由見查詢處註解)。
 */
type SupplierOrderNoProbeRow = { order_items?: { order_id?: string | null } | null };

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
 * 🔴 M-4b E10 A9g-2 在 orders 層加 `payment_charge_attempts(status)` 內嵌。
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
export const ADMIN_ORDER_DETAIL_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, order_source, payment_channel, payment_method, paid_at, subtotal, shipping_fee, discount_total, total, shipping_method, shipping_address_snapshot, invoice, invoice_number, invoice_amount, invoice_status, cancelled_at, cancelled_reason, version, customers(name, email, phone), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, order_item_procurement(id, supplier_id, allocated_quantity, received_quantity, reply_status, contact_channel, submitted_at, supplier_order_no, exception_reason, expected_arrival_date, first_ordered_at, status_changed_at, created_at, suppliers(label, is_active)), order_item_quantity_summary(quantity, ordered_quantity, instock_quantity, cancelled_quantity)), order_notes(id, note_type, body, channel, occurred_at, author, corrects_note_id, created_at), payment_charge_attempts(status), order_cancellations(id, reason_code, reason_detail, actor, idempotency_key, created_at, order_cancellation_items(id, order_item_id, cancelled_quantity))';

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
   * - 雙軸 + 次要篩選走 **DB where 下推**(payment_status / fulfillment_status 單值 .eq;order_source /
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
  ): Promise<Paginated<AdminOrderSummary>> {
    const offset = pagination.offset ?? 0;

    // 單號搜尋(M-4b E10 A9b1):同時比對 display_id 與 legacy_display_id,
    // 讓 D1 改號之後客人手上的舊單號永遠查得到。
    // 🔴 fail-closed:輸入了但格式不符 ⇒ **直接回零筆**,不得退化成「不篩選」——
    //    退化的話,客服打錯一個字就會看到全部訂單、還以為那就是搜尋結果。
    // 🔴🔴 **runtime 前置:本路徑要求 D0 migration 已 apply**
    //    (`supabase/migrations/20260729010000_m4b_e10_d0_display_id_expand.sql`)。
    //    `legacy_display_id` 目前**不在** database.types.ts(欄位尚未 apply、型別未重生),
    //    typecheck 因此抓不到 —— `.or()` 收的是純字串。
    //    D0 未 apply 時打這條 filter ⇒ PostgREST 42703(欄位不存在)⇒ 本方法裸 throw
    //    ⇒ **整個後台訂單列表**(不只搜尋)進錯誤態。
    //    現況安全靠 **env flag `ADMIN_E10_ORDER_NUMBER_SEARCH` 預設 off**
    //    (`apps/admin/src/app/orders/page.tsx`;A10c1 已接 query param,flag off 時整個不解析)。
    //    ⇒ **D0 apply 之前不得開這個 flag。**
    const orderNumberSearch = normalizeOrderNumberSearch(filter.orderNumber);
    if (orderNumberSearch.kind === 'invalid') {
      return { items: [], total: 0 };
    }

    // 供應商單號搜尋(M-4b E10 A9b2-A)= **兩段式**,不是內嵌欄下推。
    // 🔴 為什麼不下推:本欄的真相在 `order_item_procurement`,而 `ADMIN_ORDER_LIST_SELECT`
    //    **沒有內嵌那張表**(明細投影才有)⇒ 內嵌 filter 這條路要先復活 A9w3 刻意刪掉的
    //    `!inner` 版投影(見上方 :89-91)、動到鐵則 12 的 byte-equal 守門,
    //    而且會押在「不加 !inner 時內嵌欄 filter 是否影響最上層」這個**本專案無法實測**的
    //    PostgREST 行為上(本機叢集是裸 PG、沒有 PostgREST)。
    //    ⇒ 改成先對採購表**自己**做 top-level 查詢拿 order_id,語意無歧義。
    //    路線裁定與完整理由:`docs/specs/2026-08-07-e10-a9b2-a-supplier-order-no-search-plan.md` §1。
    // 🔴🔴 **runtime 前置(與 A9b1 同族)**:本路徑要求 A9b2-M 已 apply
    //    (`supabase/migrations/20260807130000_m4b_e10_a9b2_m_supplier_order_no_upper.sql`)。
    //    `supplier_order_no_upper` 目前**不在** database.types.ts(欄位尚未 apply、型別未重生)
    //    ⇒ 用 `.filter()` 而非 `.eq()`(`.filter` 的 column 收 `string`、不吃生成型別);
    //    兩者序列化**完全相同**(`@supabase/postgrest-js@2.105.3/src/PostgrestFilterBuilder.ts`
    //    `.eq` :172 與 `.filter` 皆為 `searchParams.append(column, \`op.${value}\`)`)。
    //    未 apply 時打這條 ⇒ PostgREST 42703 ⇒ 裸 throw ⇒ 整個列表進錯誤態
    //    ⇒ **A9b2-M apply 之前不得開 A10c2 的 flag**(本片零 producer)。
    // 🔴 值的安全性押在**正規化層**:`normalizeSupplierOrderNoSearch` 已擋掉 `,` `(` `)` `"` `\`
    //    —— 因為 `.eq`/`.filter` **不會**替保留字元加引號:那組字元定義在 `:36`
    //    (字面是 `new RegExp('[,()]')`),而只有 `.in()` `:815` 與 `.notIn()` `:843` 在用它。
    // 🔴 **本搜尋沒有供應商維度**:`supplier_order_no` 在 DB 層無跨供應商唯一性
    //    (A2 `:70` 的業務鍵是 `(order_item_id, supplier_canonical_key)`)⇒ 兩家供應商用同一組
    //    單號時會一起回來。**A10c2 必須在結果列顯示供應商讓人眼消歧**(完整理由與失敗情境見
    //    `packages/domain/src/order/supplier-order-no-search.ts` 檔頭的誠實邊界段)。
    const supplierSearch = normalizeSupplierOrderNoSearch(filter.supplierOrderNo);
    if (supplierSearch.kind === 'invalid') {
      return { items: [], total: 0 };
    }
    let supplierOrderIds: string[] | null = null;
    if (supplierSearch.kind === 'ok') {
      const { data: procRows, error: procError } = await this.supabase
        .from('order_item_procurement')
        .select('order_items!inner(order_id)')
        // 🔴 排序不是排版:沒有 `.order()` 時 PostgREST 在 `limit` 下回**哪些**列未定義。
        //    ⚠️ **誠實界(Fable F4)**:兩道界修完後「凡截斷必擲錯」⇒ 沒擲錯時拿到的必是完整集合,
        //    所以「分頁不同頁拿到不同 id 集合」這個失敗模式**現在已不可達**。本行留作縱深 ——
        //    日後若有人把截斷改回靜默容忍,它是第二道防線。
        //    (同款理由的本檔既有先例:下方列表查詢的 `id` 次鍵排序,Fable D-2 verdict n1。)
        .order('id', { ascending: true })
        // 多取一筆才分辨得出「剛好觸頂」與「超過」(只取上限時兩者長得一樣)。
        .limit(SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT + 1)
        .filter('supplier_order_no_upper', 'eq', supplierSearch.value);
      if (procError) {
        throw procError;
      }
      const rows = (procRows as unknown as SupplierOrderNoProbeRow[] | null) ?? [];
      // 🔴 **第一道:採購列被截斷 ⇒ 明示擲錯**。截斷之後我們**不知道真正的訂單集合**,
      //    此時去重結果可能仍 ≤ CAP ⇒ 看起來一切正常、實際少回訂單(階段 C must-fix 的病灶)。
      if (rows.length > SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT) {
        throw new SupplierOrderNoSearchTooManyError(SUPPLIER_ORDER_NO_PROBE_ROW_LIMIT);
      }
      // 🔴 **萃不出 id ⇒ 擲錯,不是把那列濾掉**(Fable 對抗審查 F1)。
      //    DB 約束保證這不可能發生(`order_item_id` NOT NULL `20260729020000:43` +
      //    `order_items.order_id` NOT NULL `20260604120000:142` + `!inner`)⇒ 萃不出來只代表
      //    **回傳形狀與假設不符**(例如 embed 回陣列而非物件)。濾掉的話會靜默變成「查無此單」,
      //    而且 mock 餵的是符合假設的形狀 ⇒ **測試全綠、功能壞掉**。
      //    🔴 判斷是**逐列**的、不是「全部都萃不出才算」:FK 保證**每一列**都萃得出來,
      //    所以只要少一列就代表假設破了。若只在「全部失敗」時擲,部分失敗仍會靜默少回訂單。
      const extracted = rows
        .map((row) => row.order_items?.order_id)
        .filter((id): id is string => typeof id === 'string' && id !== '');
      if (extracted.length !== rows.length) {
        throw new SupplierOrderNoSearchShapeError(rows.length);
      }
      const ids = Array.from(new Set(extracted));
      // 🔴 **第二道:去重後訂單數超過上限 ⇒ 明示擲錯,不截斷假裝那就是全部**
      //    (Sean 2026-08-07 Q1=A「不默默降級」的同一精神;主視窗 E-142-A 批准)。
      //    這一道守的是**第二段的 URL 長度**,與上一道守的「集合完整性」是兩件事。
      if (ids.length > SUPPLIER_ORDER_NO_MATCH_CAP) {
        throw new SupplierOrderNoSearchTooManyError(SUPPLIER_ORDER_NO_MATCH_CAP);
      }
      // 零命中 ⇒ 直接回零筆、**不打第二段**(省一次往返,且不押 `.in('id', [])` 的行為)。
      if (ids.length === 0) {
        return { items: [], total: 0 };
      }
      supplierOrderIds = ids;
    }

    let query = this.supabase
      .from('orders')
      .select(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    if (supplierOrderIds) query = query.in('id', supplierOrderIds);
    if (filter.paymentStatus) query = query.eq('payment_status', filter.paymentStatus);
    if (filter.fulfillmentStatus) query = query.eq('fulfillment_status', filter.fulfillmentStatus);
    if (orderNumberSearch.kind === 'ok') {
      // 兩欄對稱查:新 6 碼打 legacy 欄那半邊恆 0 命中(D0 的 CHECK 禁新格式進 legacy 欄),
      // 舊號打 display_id 那半邊在改號後也恆 0 —— 刻意保持對稱,呼叫端不必知道這張單改過號沒有。
      query = query.or(
        `display_id.eq.${orderNumberSearch.value},legacy_display_id.eq.${orderNumberSearch.value}`,
      );
    }
    if (filter.orderSources?.length) {
      query = query.in('order_source', [...filter.orderSources]);
    }
    if (filter.paymentChannels?.length) {
      query = query.in('payment_channel', [...filter.paymentChannels]);
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
    return { items, total: count ?? 0 };
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
