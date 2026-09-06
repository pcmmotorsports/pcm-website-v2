// refund-backfill-form.ts — ⟦b4-TAPPAYDIRECT⟧ 片 B · B3a:
// 「在 TapPay 後台已經退過的款, 事後補登進帳本」那張表單的**純解析器**(無 IO / 無 Next 依賴)。
//
// 🔵 **紀律逐字沿用 `manual-refund-form.ts` 檔頭**:本檔只做「形狀」。
//    業務判定(那筆退款在 TapPay 那邊到底成不成功、金額對不對、request_id 是不是重送)
//    **單一真相在 RPC**(`admin_backfill_tappay_console_refund`, plan v3 §片 C `:83-90`)。
//    可主張的是「經過本解析器的欄位不會觸發那支 RPC 形狀類的 RAISE」。
//
// 🛑 **而片 B 沒有那支 RPC** —— 它在片 C。本檔在片 C 之前**沒有任何呼叫端會送出**
//    (主視窗 B 2026-09-07 04:2x 裁 `B3 = 甲`:不接線)。
//    ⇒ 📌 那不表示它可以先隨便寫:**這支解析器就是片 C 那些閘的鏡子**,
//      現在寫錯, 片 C 會拿一個已經綠了的錯規則去對。
//
// ══ 三個值域全部【抄既有的】, 一個都沒有自己發明 ═══════════════════════════
//   · **DR 碼** `^\S{1,64}$` —— 逐字抄 `refund-recovery-form.ts:26`,
//     而那一支自己註明它鏡像 RPC(`20260803150000:660`)。
//     🔬 **我去問過 DB:`order_refunds.tappay_refund_id` 是純 `text`、零格式 CHECK**
//       (唯一相關的是 `order_refunds_deferred_clean`, 講的是 deferred 不得帶碼)
//       ⇒ ⚠️ **所以這個 64 不是 DB 給的, 是既有 UI 層的約定** —— 引用時別說成「DB 限制」。
//   · **金額** `^[1-9]\d{0,9}$` + `MAX_AMOUNT` —— 抄 `manual-refund-form.ts`(同一個 PG integer 上界)。
//   · **原因** 200 字 + 禁控制字元 —— 抄同一支。
//
// 🔴🔴 **本片獨有的那一格:必勾**
//   plan v3 §片 C 的 `G0` 逐字「`p_attested` 必須 true」。而**那是 RPC 的閘**,
//   本解析器擋在它前面的意義是:**沒勾就不該讓表單送得出去**,
//   ⇒ 而 checkbox 沒勾時瀏覽器**根本不送那個欄位**(不是送 `false`)
//   ⇒ 📌 所以「欄位不存在」與「員工沒勾」是同一件事, 本檔把兩者都當 `ok: false`。
//   🛑 **不得接受任何「看起來像 true」的值** —— 只認 `'1'`(與旗標同字面紀律)。

import { anyMalformed, readSingleString as readString } from '../forms/single-value';
import { isUuid } from '../orders/note-action-state';

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export const BACKFILL_ORDER_ID_FIELD = 'order_id';
export const BACKFILL_AMOUNT_FIELD = 'amount';
export const BACKFILL_REASON_FIELD = 'reason';
export const BACKFILL_OCCURRED_AT_FIELD = 'occurred_at';
export const BACKFILL_DR_CODE_FIELD = 'tappay_refund_id';
export const BACKFILL_ATTESTED_FIELD = 'attested';

/** 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門(`anyMalformed`)吃這份清單。 */
export const BACKFILL_SINGLE_FIELDS = [
  BACKFILL_ORDER_ID_FIELD,
  BACKFILL_AMOUNT_FIELD,
  BACKFILL_REASON_FIELD,
  BACKFILL_OCCURRED_AT_FIELD,
  BACKFILL_DR_CODE_FIELD,
  BACKFILL_ATTESTED_FIELD,
] as const;

/** 逐字抄 `refund-recovery-form.ts:26`(它鏡像 RPC `20260803150000:660`)。 */
const DR_CODE_RE = /^\S{1,64}$/;
/** PG integer 上界 —— 抄 `manual-refund-form.ts`(RPC 的金額參數同型)。 */
const MAX_AMOUNT = 2_147_483_647;
const AMOUNT_RE = /^[1-9]\d{0,9}$/;
const MAX_REASON_LENGTH = 200;

/** 鏡像 POSIX cntrl —— 逐碼位掃描而非字元類, 避免在原始碼裡放進不可見控制位元組本身。 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export type BackfillParse =
  | {
      ok: true;
      orderId: string;
      amount: number;
      reason: string;
      /** ISO 字串;由 `<input type="datetime-local">` 的值轉換。 */
      occurredAt: string;
      drCode: string;
    }
  | { ok: false };

/**
 * @param now 判「不得未來」的基準。**注入而不是讀 `Date.now()`** ——
 *   否則這一格在測試裡只能靠真實時鐘, 而那種測試會在某個時區/某一秒變成 flaky。
 */
export function parseRefundBackfillForm(form: FormLike, now: Date = new Date()): BackfillParse {
  // 🔴🔴 **這一行今天【零判別力】—— 而我留著它, 理由寫在這裡, 不假裝它被驗過**。
  //   🧬 2026-09-07 突變實測:把這一行整個拿掉 ⇒ 本檔測試 **32 格全綠**。
  //   成因:本檔**每一欄都是無條件必填**, 而 `readSingleString` 對「同名送兩份」本來就回 `null`
  //     ⇒ 後面每一格自己就擋掉了 ⇒ 這道入口門今天沒有獨佔的責任。
  //   🛑 **那為什麼不刪**:隔壁 `refund-recovery-form.ts` 檔頭記著這條血 ——
  //     它有「這欄是空的就跳過互斥檢查」那族守門, 而**少了這道入口門, 「送兩份」會比「送一份」更寬鬆**
  //     (關卡2 審查實跑抓到)。⇒ 📌 **哪天本檔長出第一個「空的就跳過」分支, 這一行就從冗餘變成唯一的門**,
  //     而那一天不會有東西提醒任何人。⇒ 這是**刻意的縱深**, 不是「以為它有用」。
  //   ⇒ ⚠️ 引用本檔時別把它算成「已驗證的守門」——**它今天沒有一發突變殺得死**。
  if (anyMalformed(form, BACKFILL_SINGLE_FIELDS)) return { ok: false };

  const orderId = readString(form, BACKFILL_ORDER_ID_FIELD);
  if (orderId === null || !isUuid(orderId)) return { ok: false };

  // 🔴 必勾:沒勾時瀏覽器不送這個欄位 ⇒ `null` 與「沒勾」是同一件事。只認 '1'。
  const attested = readString(form, BACKFILL_ATTESTED_FIELD);
  if (attested !== '1') return { ok: false };

  const drCodeRaw = readString(form, BACKFILL_DR_CODE_FIELD);
  if (drCodeRaw === null) return { ok: false };
  const drCode = drCodeRaw.trim(); // 從後台貼過來帶尾隨空白是常態(隔壁那支的原話)
  if (!DR_CODE_RE.test(drCode)) return { ok: false };

  const amountRaw = readString(form, BACKFILL_AMOUNT_FIELD);
  if (amountRaw === null || !AMOUNT_RE.test(amountRaw)) return { ok: false };
  const amount = Number(amountRaw);
  if (amount > MAX_AMOUNT) return { ok: false };

  const reasonRaw = readString(form, BACKFILL_REASON_FIELD);
  if (reasonRaw === null) return { ok: false };
  const reason = reasonRaw.trim();
  if (reason === '' || [...reason].length > MAX_REASON_LENGTH || hasControlChar(reason)) {
    return { ok: false };
  }

  const occurredAtRaw = readString(form, BACKFILL_OCCURRED_AT_FIELD);
  if (occurredAtRaw === null) return { ok: false };
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) return { ok: false };
  // 🔴 plan v3 §片 C `G2`「`p_occurred_at` 不得未來」的鏡子。
  //   🛑 **這裡擋掉不代表 RPC 那一格可以不做** —— 兩者的關係是「UI 先講、DB 說了算」,
  //     而直接 POST 這個 action 的人繞得過本檔。
  if (occurredAt.getTime() > now.getTime()) return { ok: false };

  return { ok: true, orderId, amount, reason, occurredAt: occurredAt.toISOString(), drCode };
}
