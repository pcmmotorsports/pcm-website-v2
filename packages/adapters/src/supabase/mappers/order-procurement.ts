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
> & {
  /**
   * 🔴 optional + nullable 是**刻意的**(同 `order.ts` 對 `order_notes` 的理由):投影退版或舊 row
   * 會整個沒有這個鍵,mapper 端承接;宣告成必填會讓型別對呼叫端說謊。
   */
  suppliers?: SupabaseProcurementSupplierEmbed;
};

/** 單一品項的採購投影(清單 + 「清單不可信」旗標一起回,避免呼叫端各自重算)。 */
export type AdminOrderItemProcurementProjection = {
  procurements: AdminOrderItemProcurement[];
  /** true = 清單**可能不完整**(觸及請求端上限,或內嵌鍵整個沒回來);見 domain 型別註解 */
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
  //    ⇒ 缺鍵一律當**清單不可信**(`procurementTruncated = true`),語意與「被截斷」同一格:
  //      「你拿到的不是全部」。A10b 看到這個旗標就不得送出表單(見 domain 型別註解)。
  //    ⚠️ 這是 fail-closed 的降級,不是偵測:它讓退版**看得見**,不代表退版不會發生
  //      (真正擋住退版的是 `SupabaseOrderAdapter.test.ts` 的投影 byte-equal + `toContain` 兩道)。
  const missing = rows == null;
  const safeRows = rows ?? [];
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
    };
  });
  return {
    procurements,
    procurementTruncated: missing || safeRows.length >= ORDER_ITEM_PROCUREMENT_EMBED_LIMIT,
  };
}
