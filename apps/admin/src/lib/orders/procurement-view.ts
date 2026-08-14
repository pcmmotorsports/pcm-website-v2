import type { AdminOrderItemProcurement, AdminProcurementReplyStatus, AdminOrderItemQuantitySummary } from '@pcm/domain';
import type { ProcurementFormValues } from './procurement-action-state';
import { EMPTY_PROCUREMENT_VALUES } from './procurement-action-state';

// procurement-view.ts — M-4b E10 A10b:採購區塊的純顯示邏輯(無 IO / 無 React)。
//
// 🔴 為什麼抽成純函式:hydrate 漏一欄 ⇒ 全量 payload 靜默清空該欄,
//    直接寫在 TSX 裡只能靠渲染測試繞著打,抽出來才測得準。
//
// 🔴🔴 **本檔會被 client 端 import**(表單要用 `hydrateFormValues` / `toOffsetIso`)
//    ⇒ **不得**引入 `lib/supplier.ts`:它 → `supplier-repository.ts` → `import 'server-only'`,
//    拖進 client bundle 會直接建置失敗。**選單合併(要用 S3a 的排序)因此另放**
//    `procurement-suppliers.ts`(只在 server component 用)。施工當場踩到、當場拆的。

/** 回覆狀態顯示字。🔴 中文字面暫定、待 Sean 定稿(結構鎖字不鎖)。 */
export const REPLY_STATUS_LABEL: Record<AdminProcurementReplyStatus, string> = {
  no_reply: '未回覆',
  confirmed: '已確認',
  price_changed: '改價',
  out_of_stock: '缺貨',
  partial: '部分出貨',
};

/** 選單項目:啟用中的供應商 + 「本品項既有採購已指向」的供應商(即使已停用)。 */
export type ProcurementSupplierChoice = {
  id: string;
  label: string;
  /** true = 已停用(仍列出,但要標記;新建與調升數量會被 A5a 擋下) */
  inactive: boolean;
};

/**
 * 🔴 **台灣固定 UTC+8、無日光節約**(1979 年後未再實施)⇒ 偏移是常數,不需要時區資料庫。
 * 兩個方向都用同一個常數,不用 `new Date(local)`(那是**裝置**時區)。
 */
const TAIPEI_OFFSET_MINUTES = 8 * 60;
const TAIPEI_OFFSET_SUFFIX = '+08:00';

/**
 * `YYYY-MM-DDTHH:mm`(台北牆上時間)→ 帶 `+08:00` 的 ISO。
 *
 * 🔴 **偏移由 server 補、而且補 `Asia/Taipei`** —— 這是 A5a **本片自己的**呼叫端契約
 * (`20260803160000:475-476` 逐字:「submitted_at 的 offset 由 server 補 Asia/Taipei」)。
 * ⚠️ **不要拿備註線的契約套過來**:`note-form.ts:48-50` 對 `occurred_at` 寫的是相反的
 * (「絕不自行假設 Asia/Taipei,A10a 負責產帶偏移的 ISO」)。兩片兩份契約,本片以 A5a 為準。
 * 這個錯我在關卡2 犯過:讀了 A5a 的驗證邏輯 `:228-291`,沒讀函式 COMMENT `:475-476`,
 * 然後拿別片的契約去反駁審查者。**契約債寫在註解裡,`information_schema` 查不到。**
 *
 * ⇒ 用**裝置**時區(`new Date(local)`)的話,員工在非台北時區的機器上打 14:30 會存成別的時刻,
 *    而畫面上看起來一模一樣 —— 靜默寫錯一筆採購事實。
 */
export function toTaipeiIso(local: string): string {
  if (local === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return '';
  const [, y, mo, d, h, mi, sec] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${sec ?? '00'}${TAIPEI_OFFSET_SUFFIX}`;
}

/**
 * timestamptz ISO → `<input type="datetime-local">` 吃得下的**台北牆上時間**字面。
 *
 * 🔴 **不是裝置本地時間**(同上,契約是 Asia/Taipei):非台北裝置上顯示裝置時間的話,
 *    員工看到的與實際會存進去的差好幾個小時,而他不會發現。
 * 🔴 也**不是**切 ISO 前 16 字(那是 UTC 牆上時間,少 8 小時)。
 */
export function toTaipeiInputValue(iso: string | null): string {
  if (iso === null) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  // 位移到台北牆上時間後,用 UTC 欄位讀出來 = 台北的年月日時分
  return new Date(ms + TAIPEI_OFFSET_MINUTES * 60_000).toISOString().slice(0, 16);
}

/**
 * 這個品項在這家供應商底下、**還生效中**的那一列;沒有 → `undefined`。
 *
 * 🔴🔴 **`#476` 片2:本函式是「表單挑列」這條線唯一的入口,三個呼叫點全部走它**
 * (`hydrateFormValues` / 表單的 `editing` / 表單的 `originalSubmittedAt`;
 *  數法:`grep -rn "findActiveProcurement" apps --include='*.ts*' | grep -v '\.test\.'`)。
 * 不是在三處各補一個 `&& p.voidedAt == null` —— 那樣下一個新增的呼叫點又會漏掉,
 * 而漏掉的症狀是**靜默資料損壞**(見下),不是報錯。
 * ⚠️ ~~原字面「四個呼叫點」~~ **是錯的**(兩關審查同時抓到):第四處是同一片刪掉的死碼,
 * 刪了行卻沒改數字。
 *
 * ⚠️ **本函式只解「挑列」這一面,`#476` 沒有因此結案**:顯示面(作廢列長得跟生效列一樣)在片3、
 * 到貨選單與取消上限推導在片4。**不要因為這支存在就以為作廢已經到處都認得。**
 *
 * 🔴 **呼叫端契約:`procurements` 必須是【同一個品項】的採購列**(現行呼叫端都是
 * `item.procurements`,天然成立)。混入不同品項的列時,partial unique 管不到跨品項
 * ⇒ 同供應商可以有多筆合法生效列 ⇒ 本函式會**靜默取第一筆**。(codex 關卡2 finding 1)
 *
 * **為什麼非挑不可**(`#476` 的病灶,三個各自無害的成因湊出來的):
 * ① `#452` 起 business key 是 **partial unique**(`WHERE voided_at IS NULL`,
 *    `20260813120000_m4b_e10_452_procurement_void_schema.sql:379-381`)
 * ② Sean `Q-S1=A` 允許對同一家供應商重下單
 * ⇒ **同一個 `(order_item_id, supplier_id)` 可以同時存在「一列作廢 + 一列生效」**
 * ③ 舊的 `find((p) => p.supplierId === supplierId)` 取的是**陣列第一筆**,而 mapper 依
 *    `createdAt` ASC 排序(`mappers/created-at-order.ts`)⇒ **第一筆正是那筆舊的作廢列**。
 * ⇒ 表單 hydrate 出作廢列的舊值 → 員工按儲存 → **舊資料落到生效列上。
 * 零錯誤、零固定碼、稽核看起來完全正常。**
 *
 * 🔴 **「A5a 會跳過作廢列」是【尚未 apply】的字面,不是現況**(關卡 code-reviewer R1 must-fix3):
 * 帶 `AND voided_at IS NULL` 的那版 A5a 在 `20260814100000`(甲片),而
 * `supabase/APPLIED.tsv` 最後一筆是 `20260813120000` ⇒ **甲片不在台帳裡**
 * (數法:`grep -c 20260814100000 supabase/APPLIED.tsv` = 0)。
 * 正式庫此刻跑的仍是 `20260806200000` 那版,存在性查詢**不濾作廢列**
 * (數法:`grep -c "voided_at" supabase/migrations/20260806200000*.sql` = 0)。
 * ⇒ **順序契約**:作廢 RPC(乙)上線前,必須先 apply 甲片 **與** 本片。
 * 今天之所以無害,唯一理由是**正式庫零 voided 列**(甲片 apply preflight P5 釘住的那件事)
 * —— 那是安全網、不是設計。命中 memory `feedback_app-layer-must-not-ship-before-migration-apply`。
 *
 * 🔴 **回傳最多一列是 DB 保證的**,不是本函式的假設:partial unique index 讓
 * 「同一 `(item, supplier)` 的生效列」至多一筆(同上 `:379-381`)。
 * ⇒ 這裡用 `find` 而非 `filter` 是**有依據的**,不是圖方便。
 *
 * ⚠️ **只有作廢列的情況回 `undefined` 是對的**:那代表「這家的採購已經撤了」,
 * 下一步就該是**新建**(`Q-S1=A` 允許),而 partial unique 讓那筆新建不會撞鍵。
 */
export function findActiveProcurement(
  procurements: readonly AdminOrderItemProcurement[],
  supplierId: string,
): AdminOrderItemProcurement | undefined {
  // 🔴🔴 **`== null` 而不是 `=== null`,這一個字元決定壞掉時往哪邊倒**(關卡 code-reviewer R1 must-fix2)。
  //    `voidedAt` 變成 `undefined` 是可能的(投影退版 ⇒ mapper 搬出 `undefined`;或手寫 fixture
  //    繞過型別 —— 本檔 `unsourcedQuantity` 的註解就記著同款實錘)。兩種寫法的後果**不對稱**:
  //    · `=== null`:`undefined !== null` ⇒ **每一列都被判成非生效** ⇒ 全部 `editing=false` + 空白 hydrate
  //      ⇒ 員工填完送出、A5a 命中真正的生效列走 UPDATE ⇒ **全量 payload 把既有採購事實靜默清空**。
  //      = **片2 引入的、比 `#476` 原病更嚴重的新損壞**。
  //    · `== null`:缺欄時每一列都當生效 ⇒ 退化成**片2 之前的行為**(可能挑到作廢列 = 原本的 `#476`)。
  //      不會更糟,而擋住缺欄的是 `SupabaseOrderAdapter.test.ts` 的投影 byte-equal。
  //    ⇒ 選那個「壞掉時只退回原狀、不會新增破壞」的方向。慣例來源 = 本檔 `unsourcedQuantity`
  //      逐字「型別擋不住的東西,執行期要自己站得住」。
  return procurements.find((p) => p.supplierId === supplierId && p.voidedAt == null);
}

/**
 * 由「選中的供應商」hydrate 出整份表單值。
 *
 * 🔴 **這是 A5a 全量 payload 契約的承重**(`20260803160000:19-24`:表單必全欄 hydrate 自最新列、
 *    先讀後送)。少填一欄 = 那一欄被送成 NULL = 靜默清掉既有事實。
 *    🔴 承重成立的前提 = 本路徑送 `preserveOptionalFields: false`(明細頁單列表單一律如此)。
 *    A9h 批次走 `true`、靠 DB 保留那四欄而不靠 hydrate,但它不經過本函式(A9h-M `20260806200000`)。
 *    ⇒ 逐欄對應、不用 spread;新增欄位時型別會逼你來改這裡。
 * 選中的供應商在本品項還沒有採購列(= 新建)→ 回全空 + 該 supplierId。
 */
export function hydrateFormValues(
  procurements: readonly AdminOrderItemProcurement[],
  supplierId: string,
): ProcurementFormValues {
  // 回新物件而非共用常數的同一個參考(關卡2 nit:免掉未來整類就地改寫 bug)
  if (supplierId === '') return { ...EMPTY_PROCUREMENT_VALUES };
  // 🔴 #476 片2:只認**生效中**那一列。~~原本 `find((p) => p.supplierId === supplierId)`~~
  //    會取到同供應商的作廢列(它排在前面)⇒ 舊值覆寫生效列。理由詳 `findActiveProcurement`。
  const row = findActiveProcurement(procurements, supplierId);
  if (!row) return { ...EMPTY_PROCUREMENT_VALUES, supplierId };
  return {
    supplierId,
    allocatedQuantity: String(row.allocatedQuantity),
    replyStatus: row.replyStatus,
    contactChannel: row.contactChannel ?? '',
    submittedAtLocal: toTaipeiInputValue(row.submittedAt),
    supplierOrderNo: row.supplierOrderNo ?? '',
    exceptionReason: row.exceptionReason ?? '',
    expectedArrivalDate: row.expectedArrivalDate ?? '',
  };
}

/**
 * 「還有幾件沒有登記來源」(#352-b-2 衍生指標;plan §5.4)。
 *
 * `未登記件數 = quantity − cancelled_quantity − ordered_quantity`,
 * **三個欄位全部取自 `order_item_quantity_summary` 的同一列**。
 *
 * 🔴 **`ordered_quantity` 就是 `SUM(allocated)`**(`20260730150000:12` 逐字:「已向供應商訂了幾件
 *    ← A2 `order_item_procurement.allocated_quantity` 之和」,由 A4a trigger 維護)
 *    ⇒ **不要自己再寫一個 `SUM(allocated)`**,那會是同一個數字的第二真相。
 *    讀模型本來就帶著這個摘要(A9c 的 nested embed)⇒ **零新查詢**。
 *
 * 🔴 **`summary === null` 回 `null`,不補 0** —— `null` 的意思是「不知道」不是「都是 0」
 *    (`types.ts:638-660` 逐字;摘要列由 A4a **惰性建立**,從未被採購也從未被取消的品項沒有那一列)。
 *    補 0 會讓畫面對員工說「還有 3 件沒登記」這種**它證明不了的話**。
 *    ⚠️ 這裡回 null 不是 fail-closed 守門(本值不擋任何動作),是**誠實**:不知道就說不知道。
 *
 * **非負性有保證**:A2b1 守 `SUM(allocated) ≤ quantity − SUM(cancelled)`(`20260803130000:164`)
 * ⇒ 本式不會是負數,呼叫端不必處理負值分支。⚠️ 仍夾 0 —— 那是給「守門日後被改動」留的餘地,
 * 不是因為現在算得出負數。
 *
 * ⚠️ **語意誠實**:它說的是「還有 N 件沒著落」,**不是**「流程斷在第幾步」——
 * 它分不出「從沒開始採購」與「三步做到一半」,而那兩件事員工的下一步動作本來就一樣。
 * ⇒ 文案不得寫「流程中斷」之類它證明不了的話。
 */
export function unsourcedQuantity(
  summary: AdminOrderItemQuantitySummary | null | undefined,
): number | null {
  // 🔴 `== null` 收 `null` **與** `undefined`,刻意不用 `=== null`:
  //    契約上只會是 `null`,但少一個欄位就讓**整張訂單明細頁白畫面**的代價遠高於多寫一個字元
  //    —— 而「欄位不見了」正好與 `null` 同義(不知道),降級成「算不出來」是誠實且無損的。
  //    實錘:本片加上這個指標時,`item-procurement-section.test.tsx` 的 fixture 用
  //    `as unknown as AdminOrderDetail` 繞過型別、根本沒給這個欄位 ⇒ `=== null` 版當場把
  //    該檔 8 格全炸。型別擋不住的東西,執行期要自己站得住。
  if (summary == null) return null;
  return Math.max(0, summary.quantity - summary.cancelledQuantity - summary.orderedQuantity);
}
