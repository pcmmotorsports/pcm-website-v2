import type { AdminOrderItemProcurement, AdminProcurementReplyStatus } from '@pcm/domain';
import type { Database } from '../database.types';
import { compareByCreatedAtThenId } from './created-at-order';

/**
 * @module @pcm/adapters/supabase/mappers/order-procurement — `order_item_procurement` 內嵌列
 *   → domain 採購讀模型(M-4b E10 A9a-2;master plan row 38 的採購那半、`docs/specs/
 *   2026-07-28-e10-order-closure-master-plan-v2.md:385`)。下游消費端 = A10b(row 57)採購表單。
 *
 * 🔴 **兩件事在這裡做、不在 PostgREST 投影做**(同 A9a-1 的分工):
 * ① **排序**:PostgREST 不保證內嵌列順序 ⇒ 這裡釘死 `createdAt` ASC 全序
 *    (共用比較器 `created-at-order.ts`)。
 * ② **供應商顯示名正規化**:`suppliers` 是 many-to-one 內嵌,生成型別對 embed 推斷不穩
 *    ⇒ 容單物件 / 陣列 / null 三形(同 `order.ts` 對 `customers` 的慣例)。
 *
 * 🔴 **本片不投影逐批到貨明細**(`order_item_procurement_receipts`):A10b(row 57)要的四樣
 * (分配數量 / 到貨數量 / 異常原因 / 供應商)全在 parent 列上,而「哪一批何時到」的批次到貨 UI
 * 排在第 2 批(建表檔 `20260729020000:180-181` 明文「更正機制 = 第 2 批批次到貨 UI 落地時才設計」;
 * `:143` 同批推遲了冪等鍵的形狀)。
 * ⇒ 要顯示逐批時間軸,得再加一層內嵌 + 它自己的 limit/order,不在本片。
 */

/**
 * 內嵌採購列的請求上限(**我們自己指定**,adapter 以
 * `.limit(n, { referencedTable: 'order_items.order_item_procurement' })` 送出)。
 *
 * 🔴 **為什麼要自己指定**:PostgREST 的 `max-rows` 對內嵌列同樣生效(A9a-1 於 2026-08-02 對
 * production 實測 = **1000**),那個值是專案設定的複本、程式裡釘不住;不自己夾的話
 * `rows.length >= 上限` 的截斷判定會恆 false = 靜默失效。⇒ 邊界由本常數擁有、與伺服器設定脫鉤。
 *
 * 值 = 50:一個品項拆給幾家供應商是「人手動建的採購單」,實務上個位數
 * (A9h 批次 coordinator 的併發上限也才 5,master plan `:391`)。50 給了一個數量級的餘裕,
 * 又**嚴格低於**實測的伺服器上限。
 *
 * ⚠️ **殘餘風險(不宣稱涵蓋)**:若專案 `max-rows` 日後被設到低於本值,截斷會發生在那個更低的
 * 數字上而本判定看不見(要治本得多送一支 `count: 'exact'` 查詢 = 每次明細多一次往返,本片未做)。
 * 🔴 觸及本值時無法分辨「剛好這麼多筆」與「被截斷」⇒ 一律當**可能被截斷**(fail-closed)。
 *
 * 🔗 **本旗標的前提在外一層**:`order_items` 自己也有上限(`ORDER_ITEMS_EMBED_LIMIT`,見
 * `mappers/order.ts`)—— 品項被切掉時,它的採購列連同本旗標一起消失 ⇒ 呼叫端要配
 * `AdminOrderDetail.itemsTruncated` 一起讀。
 * (~~原字面「`order_items` 這層沒有自己的上限」~~ 已隨關卡2 MF2 失效,關卡2 R2 nit 抓到未同步、當場更正。)
 */
export const ORDER_ITEM_PROCUREMENT_EMBED_LIMIT = 50;

/** `suppliers` 內嵌形狀(many-to-one;生成型別對 embed 推斷不穩 ⇒ 容三形、mapper 正規化)。 */
type SupabaseProcurementSupplierEmbed =
  | { label: string | null; is_active: boolean | null }
  | { label: string | null; is_active: boolean | null }[]
  | null;

/**
 * `order_item_procurement` 內嵌投影列型別 —— derive 自生成 Database Row
 * (對齊 `SupabaseOrderNoteRow` 慣例)。🔴 投影**不取** `order_item_id`(父列即該品項)。
 */
export type SupabaseOrderItemProcurementRow = Pick<
  Database['public']['Tables']['order_item_procurement']['Row'],
  | 'id'
  | 'supplier_id'
  | 'allocated_quantity'
  | 'received_quantity'
  | 'reply_status'
  | 'contact_channel'
  | 'submitted_at'
  | 'supplier_order_no'
  | 'exception_reason'
  | 'expected_arrival_date'
  | 'first_ordered_at'
  | 'status_changed_at'
  | 'created_at'
  // 🔴 `#484a` A2(2026-08-14 重 gen)起,作廢兩欄**回到生成型別背書**——
  //    `#476` 片1 當時手寫在交集側是還債標記(生成檔落後 migration 兩支),現已結清(`#489`)。
  //    ⇒ DB 改掉這兩欄的可空性,現在**會**有一格轉紅(那正是還債的目的)。
  | 'voided_at'
  | 'void_reason'
> & {
  /**
   * 🔴 optional + nullable 是**刻意的**(同 `order.ts` 對 `order_notes` 的理由):投影退版或舊 row
   * 會整個沒有這個鍵,mapper 端承接;宣告成必填會讓型別對呼叫端說謊。
   */
  suppliers?: SupabaseProcurementSupplierEmbed;
};

/**
 * 單一品項的採購投影(清單 + 「觸及上限」旗標一起回,避免呼叫端各自重算)。
 *
 * 🔴 **`#646`(2026-08-18,Sean 批「現在做」、主視窗裁乙):兩個世界拆成兩個欄位。**
 * 舊形狀是**一顆布林**同時代表「讀不到」與「觸及上限」——
 * 而那兩個世界對員工的指示**相反**(前者重整真的可能會好,後者永遠不會好)
 * ⇒ 消費端拿到 `true` 分不出自己在哪一個,文案只能寫成條件句。
 * 拆法**不是**多一個原因字串(那樣消費端可以繼續只看布林、編譯器不攔),
 * 而是**讓型別逼人回答**:`null` 進不了 `.length` / `.map`。
 */
export type AdminOrderItemProcurementProjection = {
  /**
   * `null` = **讀不到**(內嵌鍵整個沒回來 / 投影退版)⇒ 重整**真的可能會好**。
   * `[]` = 問過了,答案是零筆(這個品項沒訂過貨)。**兩者不可混為一談** ——
   * 混在一起正是 `#646` 在修的病(同 `order-cancellations.ts` 的既有處置)。
   */
  procurements: AdminOrderItemProcurement[] | null;
  /**
   * `true` = **觸及請求端上限**(`ORDER_ITEM_PROCUREMENT_EMBED_LIMIT`)⇒ 固定限制,**重整不會好**。
   * 🔴 `#646` 起它**只**表示這一件事;「讀不到」改由 `procurements === null` 表示。
   */
  procurementTruncated: boolean;
};

/**
 * `order_item_procurement` 內嵌列 → 單一品項的採購清單。
 *
 * `replyStatus` 的 `as` 依據 = DB CHECK 值域(建表檔 `:86-87` 五值),同 `noteType` / `orderSource` 慣例。
 * ⚠️ 代價一致:CHECK 日後加第六個值時型別會說謊,而**沒有任何測試會轉紅** ——
 * 改那條 CHECK 的人必須同步改 domain union(建表檔 CHECK 是唯一權威)。
 */
export function mapSupabaseProcurementRowsToProjection(
  rows: SupabaseOrderItemProcurementRow[] | null | undefined,
): AdminOrderItemProcurementProjection {
  // 🔴 **內嵌鍵整個缺(`undefined`)≠「這個品項沒訂過貨」**(關卡2 codex MF1):
  //    投影退版時 `?? []` 會把「沒問到」翻譯成「問過了,答案是零筆」—— 而下游 A10b 是**寫入端**
  //    (A5a 全量 payload),照著空清單當「新建」送出去 = 用空白覆蓋掉真實的採購事實。
  //    ~~⇒ 缺鍵一律當**清單不可信**(`procurementTruncated = true`),語意與「被截斷」同一格~~
  //    🔴 **上面那句 `#646`(2026-08-18)起作廢**:缺鍵改回 `procurements: null`,
  //      `procurementTruncated` 只表示「觸及上限」。fail-closed 沒有變鬆 ——
  //      A10b 改看 `procurements === null`(型別強迫它先處理),見下方 `#646` 那段與 domain 型別註解。
  //    ⚠️ 這是 fail-closed 的降級,不是偵測:它讓退版**看得見**,不代表退版不會發生
  //      (真正擋住退版的是 `SupabaseOrderAdapter.test.ts` 的投影 byte-equal + `toContain` 兩道)。
  // 🔴 `#646`:缺鍵不再翻成 `truncated=true`,而是**回 `null`** ——
  //    語意從「你拿到的不是全部」精確成「**我沒讀到**」,而型別會逼下游先處理它。
  //    fail-closed 的立場沒有變(下游拿到 `null` 一樣不得送出寫入表單),變的是**它分得出是哪一種**。
  if (rows == null) return { procurements: null, procurementTruncated: false };
  const safeRows = rows;
  const procurements = [...safeRows].sort(compareByCreatedAtThenId).map((row): AdminOrderItemProcurement => {
    const supplier =
      row.suppliers == null ? null : Array.isArray(row.suppliers) ? (row.suppliers[0] ?? null) : row.suppliers;
    return {
      id: row.id,
      supplierId: row.supplier_id,
      supplierLabel: supplier?.label ?? null,
      supplierIsActive: supplier?.is_active ?? null,
      allocatedQuantity: row.allocated_quantity,
      receivedQuantity: row.received_quantity,
      replyStatus: row.reply_status as AdminProcurementReplyStatus,
      contactChannel: row.contact_channel,
      submittedAt: row.submitted_at,
      supplierOrderNo: row.supplier_order_no,
      exceptionReason: row.exception_reason,
      expectedArrivalDate: row.expected_arrival_date,
      firstOrderedAt: row.first_ordered_at,
      statusChangedAt: row.status_changed_at,
      createdAt: row.created_at,
      // 🔴 #476 片1:作廢兩欄逐欄搬(不用 spread —— 同本檔既有慣例:新增欄位時型別會逼人來改這裡)。
      //    ⚠️ **本 mapper 刻意不濾掉作廢列**:語意是邏輯刪除、可 unvoid,濾掉會讓員工按下作廢後
      //    畫面上什麼都沒留下(shipments 樣板 `order-shipments.ts:11` 逐字「貨憑空消失」)。
      //    分流是下游各面自己的責任(#476 片2 挑列 / 片3 顯示 / 片4 選單),不是這裡。
      //    ⚠️ **「不濾」的下游代價,記在做這個決定的地方**:作廢列會吃掉
      //    `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT`(本檔 `:44` = 50)的格子。
      //
      //    🔴 ~~原字面「`Q-S1=A` 下生效列恆為最新 ⇒ 被切掉的是舊的作廢列」~~ **是錯的,已撤**
      //    (codex 關卡2 must-fix)。正確版:
      //    · **同一家供應商內**,重下單產生的生效列確實比它的作廢列新(作廢不動 `created_at`)。
      //    · **但跨供應商不成立**:A 家一列很早建、從未作廢;之後 B..Z 家產生 50 筆更新的作廢列
      //      ⇒ 請求端 `created_at` **DESC** + limit 50 會把**唯一那筆生效列切掉**。
      //      ⚠️ 這個構造**走得到**(不需要 unvoid)。
      //    · codex 原本的構造(先建舊列 → 50 筆新作廢列 → **unvoid** 舊列)**今天走不到**:
      //      採購側沒有 unvoid RPC(`grep -rn "unvoid_procurement" supabase/migrations/` 零命中),
      //      Sean 已拍 `Q-452-換路 = C`「只做作廢,取消作廢不做」
      //      (`docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md:5` 逐字)。
      //      ⇒ **病是真的,但要用走得到的那個構造講,不要用走不到的那個。**
      //
      //    ✅ **後果仍是 fail-closed**:真被切到時 `safeRows.length >= 上限` ⇒ `procurementTruncated`
      //    翻 true ⇒ 表單停手、不送出(見上方缺鍵那段的既有立場)。**不會靜默寫壞資料。**
      //    ⚠️ 但員工會看到「採購清單不完整」而**不知道是被作廢列擠掉的** —— 那是 UX 缺口,
      //    真要治本得在請求端就把作廢列排到後面(`voided_at NULLS FIRST` 之類),**不在本片**。
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
    };
  });
  return {
    procurements,
    procurementTruncated: safeRows.length >= ORDER_ITEM_PROCUREMENT_EMBED_LIMIT,
  };
}
