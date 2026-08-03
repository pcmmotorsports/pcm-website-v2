import type { AdminOrderItemProcurement, AdminProcurementReplyStatus } from '@pcm/domain';
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
 * 由「選中的供應商」hydrate 出整份表單值。
 *
 * 🔴 **這是 A5a 全量 payload 契約的承重**(`20260803160000:19-24`:表單必全欄 hydrate 自最新列、
 *    先讀後送)。少填一欄 = 那一欄被送成 NULL = 靜默清掉既有事實。
 *    ⇒ 逐欄對應、不用 spread;新增欄位時型別會逼你來改這裡。
 * 選中的供應商在本品項還沒有採購列(= 新建)→ 回全空 + 該 supplierId。
 */
export function hydrateFormValues(
  procurements: readonly AdminOrderItemProcurement[],
  supplierId: string,
): ProcurementFormValues {
  // 回新物件而非共用常數的同一個參考(關卡2 nit:免掉未來整類就地改寫 bug)
  if (supplierId === '') return { ...EMPTY_PROCUREMENT_VALUES };
  const row = procurements.find((p) => p.supplierId === supplierId);
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
