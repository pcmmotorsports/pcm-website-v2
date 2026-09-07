// manual-refund-form.ts — M-4b E10 D3:非卡退款登記表單的純解析器(無 IO / 無 Next 依賴)。
//
// 只做「形狀」(同 refund-form.ts 檔頭紀律):業務判定(actor 是否啟用、金額是否超過
// 帳本未登記額、request_id 是否重送)單一真相在 RPC(admin_record_manual_refund),
// 本檔不重做。可主張的是「經過本解析器的欄位不會觸發 RPC 步 1-2 的形狀類 RAISE」。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import { isUuid } from '../orders/note-action-state';
import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  isManualRefundRequestToken,
} from './manual-refund-action-state';

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

/** 值域對齊 DB CHECK(order_manual_refunds.rail):刻意不含 card。 */
export const MANUAL_REFUND_RAILS = ['bank_transfer', 'cash'] as const;
export type ManualRefundRail = (typeof MANUAL_REFUND_RAILS)[number];

/** PG integer 上界(對齊 refund-form.ts 的 MAX_AMOUNT,RPC 的 p_refund_amount 同型)。 */
const MAX_AMOUNT = 2_147_483_647;
/**
 * 🔵 `<input type="datetime-local">` 的兩種合法形狀:`YYYY-MM-DDTHH:mm` 與帶秒的版本。
 *    🛑 它只驗【形狀】—— 日期存不存在由回寫比對擋(見 `parseManualRefundForm`)。
 */
const OCCURRED_AT_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * 把一個時刻換成【台北】的 `YYYY-MM-DDTHH:mm` —— 拿來與員工打進來的那一串逐字比。
 * 🔴 用 `+08:00` 這個常數偏移, 不讀時區資料庫、不讀裝置時區
 *    —— 同 `lib/orders/payment-form.ts:281` 的立場(台灣固定 UTC+8、無日光節約)。
 */
function toTaipeiLocalString(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

const AMOUNT_RE = /^[1-9]\d{0,9}$/;
/** 原因欄長度上限:DB 端無 CHECK,本欄比照既有退款原因欄(refund-form.ts:121)取 200 —
 *  不是 RPC 要求,是與既有欄位維持一致的 UI 決定。 */
const MAX_REASON_LENGTH = 200;

/** 鏡像 POSIX cntrl(同 refund-form.ts 檔頭紀律的射程)。逐碼位掃描而非正規表達式
 *  字元類 —— 避免在原始碼裡放進不可見控制位元組本身。 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export type ManualRefundParse =
  | {
      ok: true;
      orderId: string;
      rail: ManualRefundRail;
      amount: number;
      reason: string;
      /** ISO 字串;由 <input type="datetime-local"> 值轉換(見呼叫端)。 */
      occurredAt: string;
      requestToken: string;
    }
  | { ok: false };

export const MANUAL_REFUND_SINGLE_FIELDS = [
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
] as const;

export function parseManualRefundForm(form: FormLike): ManualRefundParse {
  if (anyMalformed(form, MANUAL_REFUND_SINGLE_FIELDS)) return { ok: false };

  const orderId = readString(form, MANUAL_REFUND_ORDER_ID_FIELD);
  if (orderId === null || !isUuid(orderId)) return { ok: false };

  const requestToken = readString(form, MANUAL_REFUND_REQUEST_TOKEN_FIELD);
  if (requestToken === null || !isManualRefundRequestToken(requestToken)) return { ok: false };

  const railRaw = readString(form, MANUAL_REFUND_RAIL_FIELD);
  if (railRaw === null || !(MANUAL_REFUND_RAILS as readonly string[]).includes(railRaw)) {
    return { ok: false };
  }
  const rail = railRaw as ManualRefundRail;

  const amountRaw = readString(form, MANUAL_REFUND_AMOUNT_FIELD);
  if (amountRaw === null || !AMOUNT_RE.test(amountRaw)) return { ok: false };
  const amount = Number(amountRaw);
  if (amount > MAX_AMOUNT) return { ok: false };

  const reasonRaw = readString(form, MANUAL_REFUND_REASON_FIELD);
  if (reasonRaw === null) return { ok: false };
  const reason = reasonRaw.trim();
  if (reason === '' || [...reason].length > MAX_REASON_LENGTH || hasControlChar(reason)) {
    return { ok: false };
  }

  const occurredAtRaw = readString(form, MANUAL_REFUND_OCCURRED_AT_FIELD);
  if (occurredAtRaw === null) return { ok: false };
  // 🔴🔴 **時區:顯式 +08:00,不用 `new Date(local)`**(codex `gpt-6-astra` 2026-09-08 R2 must-fix)
  //
  // ⛔ ~~舊註解:「按員工所在時區(瀏覽器本機時區)解讀 —— 與 new Date(string) 的原生解析規則一致」~~
  // 🛑 **那句話是假的,而它假在【一個字】上:這支 parser 跑在【伺服器】,不是瀏覽器。**
  //    `lib/payment/manual-refund-actions.ts:1` 逐字 `'use server';` ⇒ FormData 在 server 解析
  //    ⇒ `new Date('2026-09-08T10:00')` 用的是**伺服器**的時區。
  //    ⇒ 🔴 **Vercel 是 UTC** ⇒ 員工打「10:00」會被記成 `10:00Z` = **台北 18:00** ⇒ **差 8 小時。**
  //    ⚠️ **而正式站的 TZ 我沒有量**(本窗無正式庫/無部署環境存取)—— 但**不論它是什麼**,
  //      「跟著伺服器時區跑」本身就是錯的:同一份表單在不同機器上會存進不同的時刻。
  //
  // ❓ **⇒ 而下一個人一定會問的那一句,先答在這裡**:「那我們把伺服器的 TZ 設成台北不就好了?」
  //    🛑 **不好, 而理由不是麻煩**:那會讓這段碼的正確性掛在【一個沒有人在守的環境變數】上 ——
  //    · 它不在 repo 裡 ⇒ 改了它, 三綠不紅、測試不紅、diff 上什麼都沒有
  //    · 而換一台機器(本機開發 / CI / 別的 region / 有人重建專案)就換一個值
  //    ⇒ 📌 **那不是把 bug 修好, 是把它搬到一個【看不見的地方】。**
  //    ✅ 顯式偏移寫在碼裡 ⇒ 它跟著 diff 走, 而改它要經過 review。
  //
  // ✅ **修法照本 repo 已上線那條路的明文規矩**(`lib/orders/payment-form.ts:281` 逐字):
  //    「台灣固定 UTC+8、無日光節約 ⇒ 偏移是常數…**不准用 `new Date(local)`(那是【裝置】時區)**」
  //    而它自己的做法是 `:284` `` `${parsed.receivedDate}T00:00:00+08:00` `` —— **顯式偏移**。
  // 🎯 ⇒ 本函式照抄那個立場:**不碰任何時鐘、不碰任何裝置/伺服器時區,把 +08:00 寫死。**
  //
  // 🔵 `<input type="datetime-local">` 送出的是無時區的 `YYYY-MM-DDTHH:mm`(有些瀏覽器帶秒)
  //    ⇒ 先驗形狀再組,而**不是**丟給 `Date` 猜。
  //    🛑 形狀對 ≠ 日期存在(`2026-02-31` 兩者都合形)⇒ 下面用**回寫比對**擋掉它。
  if (!OCCURRED_AT_LOCAL_RE.test(occurredAtRaw)) return { ok: false };
  const occurredAtWithOffset = `${occurredAtRaw.length === 16 ? `${occurredAtRaw}:00` : occurredAtRaw}+08:00`;
  const occurredAtDate = new Date(occurredAtWithOffset);
  if (Number.isNaN(occurredAtDate.getTime())) return { ok: false };
  // 🔴 **回寫比對**:`new Date('2026-02-31T10:00:00+08:00')` 不是 NaN(JS 會捲到 3/3)
  //    ⇒ 只驗 NaN 擋不掉一個【不存在的日子】, 而它會安靜地存進一個錯的時刻。
  // 🛑 **而比對的兩邊必須是【同一個時區的曆日】** —— 我第一版拿 `toISOString()`(UTC 曆日)
  //    去比台北曆日 ⇒ 那兩者【本來就常常不同】(台北 00:30 = 前一天的 UTC)
  //    ⇒ 兩格當場紅, 而紅的是【正向】那幾格 ⇒ 📌 一個「一律擋」的守門, 看起來像很嚴格。
  // ✅ 正解:把它換回【台北曆日 + 時分】的字面, 與員工打進來的那一串逐字比。
  if (toTaipeiLocalString(occurredAtDate) !== `${occurredAtRaw.slice(0, 16)}`) {
    return { ok: false };
  }

  return {
    ok: true,
    orderId,
    rail,
    amount,
    reason,
    occurredAt: occurredAtDate.toISOString(),
    requestToken,
  };
}
