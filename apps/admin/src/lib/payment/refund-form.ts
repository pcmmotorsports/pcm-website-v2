// refund-form.ts — M-3 A7c RW2c:退款表單的純解析器(無 IO / 無 Next 依賴;A9d2-1 note-form 慣例)。
//
// 🔴 鏡像範圍(不說滿):本檔只做「形狀」——
//    · kind/金額互斥、reason 長度與控制字元、token 形狀 = 鏡像 RPC 步 1-2 的 RAISE 面
//      (`20260803150000:451-497`),讓表單錯停在友善的 `invalid`,不落成「bug 請停手」。
//    · **不重做**業務判定(refunded 硬擋、白名單、NOTHING_LEFT、冪等)—— 單一真相在 RPC。
//    可主張的是「經由本解析器的欄位不會觸發 RPC 步 1-2 的 RAISE」,不是「RPC 所有碼不可達」。
//
// 🔴 `kind='full'` 時 amount 欄**必須為空**(fail-closed 鏡像 RPC 嚴格互斥):殘值放行再送,
//    RPC 會 RAISE 成 bug 畫面;在這裡擋 = 員工看到的是「表單內容不正確」。RW2d 的表單切到
//    全額退時要清空金額欄(契約債)。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import { isUuid } from '../orders/note-action-state';
import {
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_KIND_FIELD,
  REFUND_ORDER_ID_FIELD,
  REFUND_REASON_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  isRefundRequestToken,
} from './refund-action-state';

/** 最小 FormData 介面(同 note-form 慣例:測試不必造真 FormData)。 */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  /** #365:單值欄位一律走 getAll 恰一筆 —— 真 FormData 天生有這一支。 */
  getAll(name: string): FormDataEntryValue[];
}

export const REFUND_KINDS = ['full', 'partial'] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

/** PG integer 上界(p_amount 由 PG 型別本身承擔 int32;RPC 對 p_record_amount 另有同值守門 `20260803150000:493-495`)。 */
const MAX_AMOUNT = 2_147_483_647;
/** 正整數、禁前導零(前導零多半是貼錯欄位;禁掉比猜寬容安全)。 */
const AMOUNT_RE = /^[1-9]\d{0,9}$/;
/** 確認碼 = 訂單號末 4 碼(新 6 碼制為數字;舊 PCM-YYYY-NNNN 末 4 亦為數字,字母留餘裕)。 */
const CONFIRM_RE = /^[0-9A-Za-z]{4}$/;
/**
 * 鏡像 RPC `~ '[[:cntrl:]]'`(POSIX cntrl = U+0000-U+001F + U+007F)。
 * ⚠️ lc_ctype 差異:本機結論不外推正式站(RW1a G11 同註);兩層都是 fail-closed 方向、
 * 不一致的後果只是「這裡放行、RPC 拒收成 bug 畫面」,不會多放行任何東西。
 */
const CNTRL_RE = /[\u0000-\u001f\u007f]/;

export type RefundParse =
  | ({
      ok: true;
      orderId: string;
      confirmCode: string;
      /** 已 trim(RPC 端 btrim 語意;送 trim 後值,兩層看到同一個字串)。 */
      reason: string;
      requestToken: string;
    } & (
      // 🔴 kind 判別聯合(關卡2 codex must-fix:互斥封進型別層,不能只靠 runtime)——
      //    partial 的 amount 必為正整數、full 必為 null(凍結額由 RPC 取 Record 剩餘額,G3);
      //    下游 InitiateOrderRefundArgs 同構,非法組合直接編譯紅。
      | { kind: 'full'; amount: null }
      | { kind: 'partial'; amount: number }
    ))
  | { ok: false };

// #365:本地 readString 已刪,改用共用的「getAll 恰一筆」讀法(見 lib/forms/single-value.ts)。
//   行為變更:同名欄位送兩份由「靜默採第一筆」改為「解析失敗、表單被拒」。
//   🔴 **這句只有配上入口的 `anyMalformed` 才成立**:單靠 readString 會把 invalid 收斂成 null,
//      而本檔有「這欄是空的就跳過互斥檢查」那族守門 ⇒ 曾經反而讓「送兩份」比「送一份」更寬鬆
//      (關卡2 審查實跑抓到)。擋門在解析器入口,別把它當可有可無的加強。

/** 解析退款表單。任一欄形狀不合 → `{ ok: false }`(呼叫端回 `invalid` state)。 */
/**
 * 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。
 * ⚠️ 漏列一欄 = 那一欄的「送兩份」洞照舊,而且**沒有症狀** ⇒ 測試用表格式逐欄跑一遍,
 *    那條才是這份清單完整性的守門(關卡2 審查實跑打出來的教訓)。
 */
export const REFUND_SINGLE_FIELDS = [
  REFUND_ORDER_ID_FIELD,
  REFUND_REQUEST_TOKEN_FIELD,
  REFUND_KIND_FIELD,
  REFUND_AMOUNT_FIELD,
  REFUND_CONFIRM_FIELD,
  REFUND_REASON_FIELD,
] as const;

export function parseRefundForm(form: FormLike): RefundParse {
  // 🔴 先擋重複欄位,**再**做任何語意判斷:否則 `readString` 把 invalid 收斂成 null 之後,
  //    「這欄是空的就跳過互斥檢查」那族守門會被繞過(kind=full + amount 送兩份 ⇒ 全額退款)。
  if (anyMalformed(form, REFUND_SINGLE_FIELDS)) return { ok: false };
  const orderId = readString(form, REFUND_ORDER_ID_FIELD);
  if (orderId === null || !isUuid(orderId)) return { ok: false };

  const requestToken = readString(form, REFUND_REQUEST_TOKEN_FIELD);
  if (requestToken === null || !isRefundRequestToken(requestToken)) return { ok: false };

  const kindRaw = readString(form, REFUND_KIND_FIELD);
  if (kindRaw === null || !(REFUND_KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false };
  }
  const kind = kindRaw as RefundKind;

  const amountRaw = readString(form, REFUND_AMOUNT_FIELD);
  let amount: number | null = null;
  if (kind === 'partial') {
    if (amountRaw === null || !AMOUNT_RE.test(amountRaw)) return { ok: false };
    amount = Number(amountRaw);
    if (amount > MAX_AMOUNT) return { ok: false };
  } else if (amountRaw !== null && amountRaw.trim() !== '') {
    // full 帶了金額 = 表單狀態矛盾(見檔頭);不猜員工要哪種、直接擋。
    return { ok: false };
  }

  const confirmCode = readString(form, REFUND_CONFIRM_FIELD);
  if (confirmCode === null || !CONFIRM_RE.test(confirmCode)) return { ok: false };

  const reasonRaw = readString(form, REFUND_REASON_FIELD);
  if (reasonRaw === null) return { ok: false };
  const reason = reasonRaw.trim();
  // 🔴 長度用碼位(`[...s].length`)不用 UTF-16 units:RPC 的 char_length 是碼位語意,
  //    emoji(surrogate pair)會讓兩者分岔(A9d2-1 關卡2 抓過同型)。
  if (reason === '' || [...reason].length > 200 || CNTRL_RE.test(reason)) return { ok: false };

  const base = { ok: true as const, orderId, confirmCode, reason, requestToken };
  if (kind === 'partial') {
    if (amount === null) return { ok: false }; // 不可達(上方已守);型別窄化用、不用 cast
    return { ...base, kind: 'partial', amount };
  }
  return { ...base, kind: 'full', amount: null };
}
