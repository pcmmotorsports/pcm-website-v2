// procurement-form.ts — M-4b E10 A10b:採購表單的純解析器(無 IO / 無 Next 依賴)。
//
// 🔴🔴 **本檔會被 client 端 import**(同 `note-form.ts` / `supplier-form.ts` 的理由)
//    ⇒ 不得引入 `server-only`。
//
// 🔴 **鏡像範圍(不說滿)**:本檔只做「形狀」與「空值收斂」,**刻意不重做** A5a 的值域判定 ——
//    數量上下界(1..100000)、三個文字欄的長度/控制字元/隱形字、時間界與未來判定,
//    **單一真相都在 RPC**(`20260803160000:210-291`)。重做一份就會有兩份會漂移的規格。
//    ⇒ 可主張的是「經由本解析器的欄位不會觸發 RPC 步 1 的 RAISE(actor/request_id)」,
//      **不是**「RPC 的 14 個失敗碼都不可達」—— 它們照樣可達,而且那正是設計。
//
// 🔴 **全量 payload、不是 patch**(`20260803160000:19-24`):選填欄留空 = 送 NULL = 該欄寫成 NULL。
//    (本解析器只服務**明細頁單列表單**,該路徑一律送 `preserveOptionalFields: false` ⇒ 此句成立。
//     A9h 批次走 `true`、那四欄的 NULL 是保留而非清空,但批次不經過本解析器 —— A9h-M `20260806200000`。)
//    ⇒ 表單必須**全欄 hydrate 自最新的那一列**,呼叫端(`item-procurement-form.tsx`)負責;
//    本解析器只保證「空字串一律收斂成 null」,讓「留空」的語意在型別上就是 NULL、不是 ''。

import {
  PROC_ALLOCATED_FIELD,
  PROC_CONTACT_CHANNEL_FIELD,
  PROC_EXCEPTION_REASON_FIELD,
  PROC_EXPECTED_ARRIVAL_FIELD,
  PROC_ORDER_ID_FIELD,
  PROC_ORDER_ITEM_ID_FIELD,
  PROC_REPLY_STATUS_FIELD,
  PROC_SUBMITTED_AT_FIELD,
  PROC_SUPPLIER_ID_FIELD,
  PROC_SUPPLIER_ORDER_NO_FIELD,
  isProcurementUuid,
} from './procurement-action-state';

/** 最小 FormData 介面(同 `note-form.ts` 慣例:測試不必造真 FormData)。 */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
}

/** 五種回覆狀態(鏡像 `order_item_procurement_reply_status_check`、`20260729020000:86-87`)。 */
export const PROCUREMENT_REPLY_STATUSES = [
  'no_reply',
  'confirmed',
  'price_changed',
  'out_of_stock',
  'partial',
] as const;
export type ProcurementReplyStatus = (typeof PROCUREMENT_REPLY_STATUSES)[number];

/**
 * 🔴 `submitted_at` 收的是**無偏移的台北牆上時間**(`YYYY-MM-DDTHH:mm[:ss]`),偏移由 server 補。
 *
 * 依據 = A5a **本片自己的**呼叫端契約(`20260803160000:475-476` 逐字:
 * 「submitted_at 的 offset 由 server 補 Asia/Taipei」)。
 * ⚠️ 備註線 `note-form.ts:48-50` 對 `occurred_at` 的契約**是相反的**(client 產帶偏移的 ISO)——
 * 兩片兩份契約,不要互抄。(關卡2 我抄錯過一次,並且拿錯的那份去反駁審查者。)
 *
 * 🔴 **帶偏移的字面一律拒收**(fail-closed):它代表呼叫端繞過了「server 補偏移」這條契約,
 * 而繞過的後果是靜默寫錯時刻 —— 寧可當場擋掉。
 */
const TAIPEI_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * `expected_arrival_date` 是 `date`(無時間、無時區)⇒ 只驗 `YYYY-MM-DD` 形狀,
 * **不做**上面那套偏移處理(對 date 欄補偏移反而會製造跨日誤差)。
 * 值域(2020-2100)交給 RPC `:288-291`。
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readString(form: FormLike, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw : null;
}

/**
 * 選填文字欄:空字串 → null。
 *
 * 🔴 **不在這裡 trim** —— A5a 自己用 `v_ws || v_zw` 正規化(`:232`/`:243`/`:260`),
 *    而「同值 no-op」比對的是**它正規化後**的結果。這層若用不同的規則先剝一次,
 *    乾淨值重放就可能被判成「有差異」⇒ 回 `UPDATED` 而非 `NO_CHANGE` = A9h 批次重送的冪等靜默破功
 *    (那條因果是 migration `:231` 逐字寫的)。這裡只認「完全沒填」。
 */
function optionalText(form: FormLike, field: string): string | null | undefined {
  const raw = form.get(field);
  // 🔴 **「沒送這個欄位」與「送了空字串」是兩件事**(關卡2 codex R2 MF3):
  //    A5a 是全量 payload ⇒ 沒送 = 被寫成 NULL = 靜默清掉既有值。
  //    畫面上每個欄位一定都會送(即使空白),所以「整個鍵不存在」只可能來自繞過畫面的呼叫
  //    ⇒ 回 `undefined` 讓呼叫端擋掉,不是預設成 null。
  if (raw === null) return undefined;
  if (typeof raw !== 'string') return undefined;
  return raw === '' ? null : raw;
}

export type ProcurementParse =
  | {
      ok: true;
      orderId: string;
      orderItemId: string;
      supplierId: string;
      allocatedQuantity: number;
      replyStatus: ProcurementReplyStatus;
      contactChannel: string | null;
      /** 無偏移的台北牆上時間;偏移由 repository 層補(A5a 契約) */
      submittedAtLocal: string | null;
      supplierOrderNo: string | null;
      exceptionReason: string | null;
      expectedArrivalDate: string | null;
    }
  | { ok: false; orderItemId: string | null };

/**
 * 解析採購表單。任一欄形狀不合 → `{ ok: false }`(呼叫端回 `invalid` state)。
 *
 * 🔴 失敗時仍**盡量**帶出 `orderItemId` —— 一張單有多個品項、每個品項一份表單,
 *    錯誤訊息要顯示在對的那一份上;拿不到就回 null(呼叫端顯示在頁層)。
 *
 * 🔴 誠實邊界:回傳只有單一 `ok: false`,**哪一欄壞掉在 UI 上分不出來**
 *    (同 `note-form.ts` / `supplier-form.ts` 的已知取捨);要分得出來得先擴回傳型別,本片不做。
 */
export function parseProcurementForm(form: FormLike): ProcurementParse {
  const orderItemIdRaw = readString(form, PROC_ORDER_ITEM_ID_FIELD);
  const orderItemId =
    orderItemIdRaw !== null && isProcurementUuid(orderItemIdRaw) ? orderItemIdRaw : null;
  const fail = { ok: false, orderItemId } as const;

  const orderId = readString(form, PROC_ORDER_ID_FIELD);
  if (orderId === null || !isProcurementUuid(orderId)) return fail;
  if (orderItemId === null) return fail;

  const supplierId = readString(form, PROC_SUPPLIER_ID_FIELD);
  if (supplierId === null || !isProcurementUuid(supplierId)) return fail;

  // 數量:只收「純十進位整數字面」。
  // 🔴 不用 `Number()` 也不用 `parseInt()`:前者收 '1e3' / ' 12 ' / '0x10',後者收 '12abc'
  //    ⇒ 兩者都會把員工打錯的東西默默變成一個合法數量寫進採購真相表。
  const allocatedRaw = readString(form, PROC_ALLOCATED_FIELD);
  if (allocatedRaw === null || !/^\d{1,6}$/.test(allocatedRaw)) return fail;
  const allocatedQuantity = Number(allocatedRaw);
  if (!Number.isSafeInteger(allocatedQuantity)) return fail;

  const replyStatusRaw = readString(form, PROC_REPLY_STATUS_FIELD);
  if (
    replyStatusRaw === null ||
    !(PROCUREMENT_REPLY_STATUSES as readonly string[]).includes(replyStatusRaw)
  ) {
    return fail;
  }
  const replyStatus = replyStatusRaw as ProcurementReplyStatus;

  const submittedAtLocal = optionalText(form, PROC_SUBMITTED_AT_FIELD);
  if (submittedAtLocal === undefined) return fail;
  if (submittedAtLocal !== null && !TAIPEI_LOCAL_RE.test(submittedAtLocal)) return fail;

  const expectedArrivalDate = optionalText(form, PROC_EXPECTED_ARRIVAL_FIELD);
  if (expectedArrivalDate === undefined) return fail;
  if (expectedArrivalDate !== null && !DATE_ONLY_RE.test(expectedArrivalDate)) return fail;

  const contactChannel = optionalText(form, PROC_CONTACT_CHANNEL_FIELD);
  const supplierOrderNo = optionalText(form, PROC_SUPPLIER_ORDER_NO_FIELD);
  const exceptionReason = optionalText(form, PROC_EXCEPTION_REASON_FIELD);
  if (contactChannel === undefined || supplierOrderNo === undefined || exceptionReason === undefined) {
    return fail;
  }

  return {
    ok: true,
    orderId,
    orderItemId,
    supplierId,
    allocatedQuantity,
    replyStatus,
    contactChannel,
    submittedAtLocal,
    supplierOrderNo,
    exceptionReason,
    expectedArrivalDate,
  };
}
