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
   * 🔴 **#476 片1:作廢兩欄。這裡手寫、不從 `Database` derive —— 因為生成型別落後 migration 兩支。**
   *
   * 實查(2026-08-14):`database.types.ts` 的 `order_item_procurement.Row` 只有 15 欄、
   * **`voided_at` 與 `void_reason` 都不在**;最後一次重 gen 是 **2026-08-11 晚**(該檔檔頭 `:42` 逐字),
   * 而加這兩欄的 `20260813120000_m4b_e10_452_procurement_void_schema.sql:342-343` 是 **08-13 才 apply**
   * (STATUS「2026-08-13 深夜 98」逐字:兩欄在、`voided_rows=0`)⇒ 生成檔尚未跟上。
   * ⇒ 寫進 `Pick<>` 會直接 typecheck 失敗(`Type '"void_reason"' is not assignable`,實跑)。
   *
   * 🔴 **不手改 `database.types.ts`**:該檔 `:1` 逐字「勿手改」,且它有既定重 gen 流程與 26 處
   * 手動校正要保留(`:2`、合併腳本 `scripts/regen-types-merge.py`)—— 重 gen 會拉進 08-11 之後
   * **所有**表的漂移,那是另一片的範圍,不該夾帶在本片裡。
   *
   * ⚠️ **代價寫清楚**:手寫 = 這兩欄的型別**不再由生成器背書**,DB 改了它們的可空性不會有任何一格紅。
   * 形狀依據 = 建表檔 `:342-343`(`voided_at timestamptz` / `void_reason text`,兩者皆可空)
   * + 生成檔裡 **shipments 樣板已經生成出來的同名欄**(`deleted_at: string | null` /
   * `void_reason: string | null`)⇒ 不是憑感覺挑的。
   * 🔧 **還債動作**:下次重 gen 之後,把這兩欄搬回上面的 `Pick<>` 清單、刪掉本段。
   *
   * ⚠️ **必填、不是 `?` 選填** —— 刻意跟隔壁 `suppliers?` 走不同路:那個選填是因為它是**巢狀 embed**、
   * 生成型別對它的基數推斷不穩;這兩欄是**同表純量欄**,與上面 `Pick<>` 的 13 個兄弟同類,
   * 而那 13 個全是必填。跟最接近的前例走,不為本片發明第三種寫法。
   * 🔴 **殘餘風險(不宣稱涵蓋)**:投影退版把這兩欄拿掉時,執行期會是 `undefined` 而型別說它是
   * `string | null` ⇒ 下游 `voidedAt === null` 判成 false = **生效的採購被當成已作廢**。
   * 擋這件事的不是型別,是 `SupabaseOrderAdapter.test.ts` 的投影 byte-equal
   * (**認字面不認行號**:`expect(ADMIN_ORDER_DETAIL_SELECT).toBe(` 那條;2026-08-14 當下在 `:815`,
   *  🔴 但本片施工過程中我自己的後續編輯已經把這個行號推漂三次 ⇒ 引用一律以字面為準)
   * (立場同本檔下方 `mapSupabaseProcurementRowsToProjection` 內對缺鍵那段逐字
   *  「真正擋住退版的是…投影 byte-equal + `toContain` 兩道」)。
   *
   * 🔴 **正面回應一條反例**(關卡 code-reviewer R1 must-fix3):隔壁 `suppliers?` 那段逐字寫著
   * 「宣告成必填會讓型別對呼叫端說謊」—— 那句**如果適用於這兩欄,就會反對本處的必填**。
   * 它不適用,理由是兩者的「缺」來自不同機制:`suppliers` 是**巢狀 embed**,生成型別對它的
   * 基數推斷本來就不穩、**同一份投影下**都可能回單物件/陣列/null ⇒ 缺是常態、型別必須容它。
   * 這兩欄是**同表純量欄**,只有在「有人改掉 `ADMIN_ORDER_DETAIL_SELECT`」時才會缺,
   * 而那個動作**恰好**是 byte-equal 釘住的唯一事件 ⇒ 缺不是常態、是一次可偵測的改動。
   * ⚠️ **殘餘風險誠實記**:byte-equal 釘的是**投影字串**,「字串 ↔ 本 Row 型別」兩者一致性
   * **全 repo 對所有欄位都沒有守門**(非本片新增的缺口)。⇒ 兩者同時被改成一致但錯的內容時,
   * 沒有任何一格會紅。
   */
  voided_at: string | null;
  void_reason: string | null;
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
    procurementTruncated: missing || safeRows.length >= ORDER_ITEM_PROCUREMENT_EMBED_LIMIT,
  };
}
