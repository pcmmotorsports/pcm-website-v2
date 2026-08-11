import { anyMalformed, readSingleString } from '../forms/single-value';
import {
  RCPT_NOTE_FIELD,
  RCPT_PROCUREMENT_ID_FIELD,
  RCPT_QUANTITY_FIELD,
  RCPT_RECEIVED_AT_LOCAL_FIELD,
  RCPT_REQUEST_ID_FIELD,
  RCPT_SURPLUS_FIELD,
  type ReceiptFormValues,
} from './receipt-action-state';

// receipt-form.ts — M-4b E10 #352-b:到貨登錄小視窗的表單解析。
//
// 🔴 **本層只做「形狀」檢查,不做業務判斷**:件數上下限、日期範圍、備註長度的**權威在 RPC**
//    (`20260811010000:106-136`)。在這裡再寫一份範圍檢查會變成第二真相 ——
//    兩份哪天漂移了,症狀是「畫面說可以、送出被拒」或更糟的反向。
//    ⇒ 這裡只擋「連送進 RPC 都不成形」的東西(缺欄、非數字、送兩份)。

/** 讀單值欄位。非「恰一筆字串」回空字串 —— 但**擋門在 `parseReceiptForm` 入口**,不在這裡。 */
function one(form: FormData, field: string): string {
  return readSingleString(form, field) ?? '';
}

/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄的「非恰一筆字串」洞照舊且**無症狀** ⇒ 測試拿**手寫的清單**比對它。
 */
export const RECEIPT_SINGLE_FIELDS = [
  RCPT_PROCUREMENT_ID_FIELD,
  RCPT_REQUEST_ID_FIELD,
  RCPT_RECEIVED_AT_LOCAL_FIELD,
  RCPT_QUANTITY_FIELD,
  RCPT_SURPLUS_FIELD,
  RCPT_NOTE_FIELD,
] as const;

export type ParsedReceiptForm = {
  procurementId: string;
  quantity: number;
  surplusQuantity: number;
  /** `datetime-local` 原值、**不帶偏移**;偏移由 action 用 `toTaipeiIso` 補 Asia/Taipei。 */
  receivedAtLocal: string;
  note: string | null;
  requestId: string;
};

/**
 * 解析。回 `null` = 形狀不成立(action 回 `invalid`)。
 *
 * 🔴 **`quantity` 允許 0** —— 這是本解析器最容易寫壞的一行。
 *    `quantity=0 / surplus=N` 是「訂單已收滿/已取消,但貨還是到了」的正式登記方式
 *    (a1 `20260810230000:82` 逐字)。照抄 A5a 的 `>= 1` 會讓那條路在表單層就死掉,
 *    而且症狀是**沉默的**:員工只會看到「到貨件數不正確」,不會知道系統其實支援這件事。
 *    兩者加起來至少 1 件的規則由 RPC 擋(`:106-110`),不在這裡複製。
 */
export function parseReceiptForm(form: FormData): ParsedReceiptForm | null {
  // 🔴🔴 **入口擋門 —— 這是 `readSingleString` 的必要搭配,不是可選的加強**
  //    (`single-value.ts:60-96` 逐字,R1 must-fix 2)。
  //    沒有它的話:`quantity` 送兩份 / 塞單一 `File` ⇒ `readSingleString` 回 `null`
  //    ⇒ `one()` 收斂成 `''` ⇒ `toCount('')` 依約回 **0** ⇒ 寫進去的是「到貨 0 件」而**不是拒**。
  //    `quantity` 正是「null 在下游代表放行」那一類 —— 空字串對它是合法輸入(見 `toCount`),
  //    所以形狀錯與真的留空**在下游不可分辨**,只能在入口擋。
  if (anyMalformed(form, RECEIPT_SINGLE_FIELDS)) return null;

  const procurementId = one(form, RCPT_PROCUREMENT_ID_FIELD);
  const requestId = one(form, RCPT_REQUEST_ID_FIELD);
  const receivedAtLocal = one(form, RCPT_RECEIVED_AT_LOCAL_FIELD);
  if (procurementId === '' || requestId === '' || receivedAtLocal === '') return null;

  // 🔴 **冪等鍵在這裡就要是 canonical 形狀**(R1 nit 10)。
  //    RPC `:94` 存進帳本的是 `btrim(p_request_id, v_ws || v_zw)` —— 連**零寬字元**都剝,
  //    而 JS 的 `.trim()` 剝不掉那些 ⇒ 想在 app 層「重現那個 btrim」會是第二真相、遲早漂移。
  //    改成**要求送進來的就是規範形狀**(RPC `:101-103` 同一套:可列印 ASCII、無空白、全小寫、≤200)
  //    ⇒ btrim 對它是 no-op ⇒ 我們查冪等帳用的鍵與 RPC 存進去的鍵**在構造上就相同**,
  //    不需要兩邊各自正規化。不合形狀一律拒(我們自己鑄的鍵本來就永遠合格)。
  if (!/^[!-~]{1,200}$/.test(requestId) || requestId !== requestId.toLowerCase()) return null;

  const quantity = toCount(one(form, RCPT_QUANTITY_FIELD));
  const surplusQuantity = toCount(one(form, RCPT_SURPLUS_FIELD));
  if (quantity === null || surplusQuantity === null) return null;

  const rawNote = one(form, RCPT_NOTE_FIELD);
  return {
    procurementId,
    quantity,
    surplusQuantity,
    receivedAtLocal,
    // 空字串 → null(RPC 那邊全空白備註也會正規化回 NULL,兩層同一個立場)
    note: rawNote.trim() === '' ? null : rawNote,
    requestId,
  };
}

/** 非負整數;其餘一律 null。空字串當 0(溢收欄留空 = 沒有溢收)。 */
function toCount(raw: string): number | null {
  if (raw === '') return 0;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** 失敗時帶回員工打的內容(不帶回 = 「保留輸入」是空宣稱)。 */
export function carryBackReceiptValues(form: FormData): ReceiptFormValues {
  return {
    quantity: one(form, RCPT_QUANTITY_FIELD),
    surplusQuantity: one(form, RCPT_SURPLUS_FIELD),
    receivedAtLocal: one(form, RCPT_RECEIVED_AT_LOCAL_FIELD),
    note: one(form, RCPT_NOTE_FIELD),
  };
}
