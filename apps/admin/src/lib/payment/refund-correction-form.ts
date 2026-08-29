// refund-correction-form.ts — `#890` 片2b:更正表單的純解析器(無 IO)。
//
// plan:`docs/specs/2026-08-29-890-manual-verdict-correction-ui-plan.md` §1c #3 / §1e(v4)。
// 形狀鏡 `refund-recovery-form.ts`,**連它那條入口擋門一起鏡**(見下)。
//
// 🔴🔴 **前端的驗證【不得比 DB 寬】**(plan §1e 逐字)。DB 那一側逐字:
//    ```
//    :69  corrected_to CHECK (corrected_to IN ('money_moved','no_money_moved'))
//    :75  reason       CHECK (btrim(reason, E' \t\r\n') <> '')
//    :76  reason       CHECK (char_length(reason) <= 500)
//    :87-88 request_id  同樣的 btrim 字集 + <= 64
//    ```
//    ⚠️ **`btrim(x)` 單參數只剝一般空格** —— DB 那邊明列了字集,所以只打一個 Tab 會被拒;
//    ⇒ 前端寫寬了 = **繞過它**:員工按下去、被 DB 拒、而他看到的是一個 SQLSTATE。
//    ✅ 寫嚴一點沒事(那只是提早告訴他)。
//
// 🔴 **入口擋門(`anyMalformed`)不是加強,是這份解析器成立的前提**:
//    鏡像檔逐字記著 —— 單靠 `readSingleString` 會把「送兩份」收斂成 `null`,
//    而本檔有「這欄不在席就當成 NULL CAS」那一族分支
//    ⇒ **沒有入口擋門的話,「送兩份」會比「送一份」更寬鬆。**

import { anyMalformed, readSingle, readSingleString as readString } from '../forms/single-value';
import { isUuid } from '../orders/note-action-state';
import {
  CORRECTION_EXPECTED_ID_FIELD,
  CORRECTION_REASON_FIELD,
  CORRECTION_REFUND_ID_FIELD,
  CORRECTION_REQUEST_TOKEN_FIELD,
  CORRECTION_VERDICT_FIELD,
} from './refund-correction-state';

/** DB 那邊 `btrim(x, E' \t\r\n')` 的**同一個字集**(不多不少)。 */
const DB_BLANK_CHARS = [' ', '\t', '\r', '\n'] as const;
const DB_BLANK_RE = /^[ \t\r\n]*$/;

export const CORRECTION_REASON_MAX = 500;
export const CORRECTION_TOKEN_MAX = 64;

/** 🔴 本解析器讀的**全部**單值欄位 —— 入口擋門吃這份清單。漏列一欄 = 那一欄的「送兩份」洞照舊,而且沒有症狀。 */
export const CORRECTION_SINGLE_FIELDS = [
  CORRECTION_REFUND_ID_FIELD,
  CORRECTION_EXPECTED_ID_FIELD,
  CORRECTION_VERDICT_FIELD,
  CORRECTION_REASON_FIELD,
  CORRECTION_REQUEST_TOKEN_FIELD,
] as const;

export type CorrectionParse =
  | {
      ok: true;
      refundId: string;
      /** `null` = 這一欄**不在席** = 「我看到的是尚未被更正過」。 */
      expectedCorrectionId: string | null;
      correctedTo: 'money_moved' | 'no_money_moved';
      reason: string;
      requestToken: string;
    }
  | { ok: false };

/** DB 的 `btrim(reason, E' \t\r\n') <> ''` 在 JS 這一側的**同一個判準**。 */
export function isDbBlank(value: string): boolean {
  return DB_BLANK_RE.test(value);
}

export function parseCorrectionForm(form: {
  getAll(name: string): FormDataEntryValue[];
}): CorrectionParse {
  // 見檔頭:這一行拿掉 ⇒ 下面「不在席」那條分支會變成一個洞。
  if (anyMalformed(form, CORRECTION_SINGLE_FIELDS)) return { ok: false };

  const refundId = readString(form, CORRECTION_REFUND_ID_FIELD);
  if (refundId === null || !isUuid(refundId)) return { ok: false };

  // 🔴 CAS 那一欄是**三態**,不是兩態:
  //    missing = 尚未被更正過（合法，送 NULL）
  //    value   = 必須是 uuid
  //    ⚠️ 而**空字串是 value 不是 missing** ⇒ 它會落進 uuid 檢查而被拒 ⇒ 那是對的:
  //      一個送了這一欄卻送空的表單是壞掉的,不該被讀成「尚未更正過」。
  const expectedRead = readSingle(form, CORRECTION_EXPECTED_ID_FIELD);
  let expectedCorrectionId: string | null;
  if (expectedRead.kind === 'missing') {
    expectedCorrectionId = null;
  } else if (expectedRead.kind === 'value' && isUuid(expectedRead.value)) {
    expectedCorrectionId = expectedRead.value;
  } else {
    return { ok: false };
  }

  const verdict = readString(form, CORRECTION_VERDICT_FIELD);
  if (verdict !== 'money_moved' && verdict !== 'no_money_moved') return { ok: false };

  const reason = readString(form, CORRECTION_REASON_FIELD);
  // 🔴 三條逐一對上 DB:不在席 / 只有空白字集 / 超長。缺任一條就是「前端比 DB 寬」。
  if (reason === null || isDbBlank(reason) || reason.length > CORRECTION_REASON_MAX) {
    return { ok: false };
  }

  const requestToken = readString(form, CORRECTION_REQUEST_TOKEN_FIELD);
  if (
    requestToken === null ||
    isDbBlank(requestToken) ||
    requestToken.length > CORRECTION_TOKEN_MAX
  ) {
    return { ok: false };
  }

  return { ok: true, refundId, expectedCorrectionId, correctedTo: verdict, reason, requestToken };
}

/** 測試用:DB 那個空白字集的**單一權威**(讓測試不必自己再打一次那四個字元)。 */
export const CORRECTION_DB_BLANK_CHARS = DB_BLANK_CHARS;
