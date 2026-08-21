// refund-error-class.ts — 把 unknown-state 那條路上抓到的 error,收斂成一個**封閉**的分類碼。
//
// ── 為什麼有這支 ───────────────────────────────────────────────────────────
// `refund-actions.ts` 的 unknown-state 分支**刻意不 finalize**(RPC 端沒有對應 outcome,
// `refund-actions.ts:62-65` 逐字「刻意不可表達」)⇒ 失敗原因從來沒進過 DB,只 `console.error` 一次。
// 實測後果:2026-08-19 那筆卡住的退款(`8X3N5Q`),**Vercel runtime log 已因保存期限拿不回來**
// (`get_runtime_logs` 回 `400 ExceedsBillingLimitError`;負對照 `since=24h` 回 `200|30`
//  ⇒ 量具會動,不是查無)⇒ **那句話永久消失。**
//
// ── 🔴 措辭紀律(主視窗 2026-08-21 `Q9=甲`,不得自行放寬)──────────────────
// **分類碼只描述「我們觀察到什麼」,不描述「對方怎麼了」。**
//   ✅ `network_or_type`(我們這邊拋了 TypeError)
//   ❌ `tappay_no_answer`(TapPay 不回話)—— 那是**推論**,不是量到的
// 理由:這一列會被下一個人當**起點**。寫「對方不回」會把他導去等 TapPay,
// 而該查的是**我們自己的呼叫**。
// ⚠️ 實錘:2026-08-21 有人把「3DS 沒跳完、TapPay 永遠停在待付款」
//    (成立於 `2SQH2P`/`GVRDMH` —— 兩張 **unpaid、無 rec_trade_id、零筆退款列**)
//    套到 `8X3N5Q`(**paid、有 rec_trade_id、1 列 processing**)。
//    **兩種病,而句子換了主詞。** 本檔的命名紀律就是為了不讓那件事寫進 DB。
//
// ── 🔴 為什麼是 allow-list、而且**零 import** ──────────────────────────────
// **絕不讓 error 身上的字串原樣穿透。** `error.name` 是一般可寫欄位:
//   `const e = new Error('safe'); e.name = 'SECRET_IN_NAME'`
// ⇒ 任何「讀 name 當分類」的做法等於讓外部字串進稽核表。
// 本函式**只回傳下面那張表裡的字面**,分不出來一律落 `'other'` ⇒ 穿透面 = 0。
//
// 🔴 **本檔刻意不 import 任何自家錯誤型別**,兩個理由(缺一都會有人來「補」):
//   ① **它們走不到這裡** —— `TapPayConfigError` 在 `refund-actions.ts:199`(adapter 建構)
//      就被攔掉;`TapPayRefundNotSentError` 在 `:355` 有自己的分支;
//      `RefundCallerBugError` 只可能出現在「finalize 後」那一格,而**那一格由呼叫點自己帶站點碼**。
//      ⇒ 加進來會產生**永遠不會被選中的分類**(恆綠格)。
//   ② `composition.ts` 與 `refund-repository.ts` 都 `import 'server-only'`
//      ⇒ 一 import 進來,本檔的單元測試整支解析失敗(實測:
//      `This module cannot be imported from a Client Component module`)。
//      同一個坑 `refund-ui-flag.ts` 檔頭也記過。
// ⚠️ 誠實邊界:allow-list 擋得住**穿透**,擋不住**誤分類**(跨 realm 的 TypeError 可能歸錯格)。
//    誤分類的代價是「下一個人方向被誤導」,不是「祕密外洩」—— 兩者嚴重度不同,不要混講。

/** 🔴 封閉字集。新增一格要同時改這裡,測試釘住「回傳值恆在字集內」。 */
export const REFUND_ERROR_CLASSES = [
  'aborted_or_timeout',
  'network_or_type',
  'malformed_response',
  'error_unclassified',
  'other',
] as const;

export type RefundErrorClass = (typeof REFUND_ERROR_CLASSES)[number];

/** 逾時/中止:`AbortError` 走 DOMException,`name` 在其 prototype 上、非實例可寫欄位。 */
function isAbortLike(error: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

/**
 * 把任意 throw 出來的東西收斂成一個封閉分類碼。
 * 🔴 回傳值恆為 `REFUND_ERROR_CLASSES` 之一 —— 這是本函式**唯一**的對外承諾。
 */
export function classifyRefundError(error: unknown): RefundErrorClass {
  // 🔴 整支包 try/catch(codex R1 F4):`instanceof` **會 throw** ——
  //    revoked Proxy、或帶拋錯 `getPrototypeOf` trap 的物件都做得到。
  //    而本函式在 `recordRefundUnknownStateAudit` 的 **catch 裡**也會被呼叫
  //    ⇒ 它一 throw,「永不 throw」就破了,呼叫端的 `await` 會把例外往上丟,
  //      **員工連原本那句 unknown-state 訊息都看不到**(比沒留痕更糟)。
  try {
    if (isAbortLike(error)) return 'aborted_or_timeout';
    // fetch 層連不上 / 參數壞掉,在 Node 一律是 TypeError。
    if (error instanceof TypeError) return 'network_or_type';
    // 回應不是預期格式時的解析失敗。
    if (error instanceof SyntaxError) return 'malformed_response';
    // 是個 Error,但不在上面任何一格 —— 仍然只回固定字面,不碰它身上的字串。
    if (error instanceof Error) return 'error_unclassified';
    // 連 Error 都不是(throw 了字串 / 物件 / null)。
    return 'other';
  } catch {
    // 連「判斷它是什麼」都失敗 ⇒ 仍然只回字集裡的字面。
    return 'other';
  }
}

/** `typeof` 的封閉值域。不含任何來自外部的字元。 */
export const UNKNOWN_VALUE_TYPES = [
  'string',
  'number',
  'bigint',
  'boolean',
  'symbol',
  'undefined',
  'object',
  'function',
  'null',
  'indeterminate',
] as const;

export type UnknownValueType = (typeof UNKNOWN_VALUE_TYPES)[number];

/** 對一個來路不明的值的**封閉描述**:只有型別與長度,**沒有一個字元來自那個值**。 */
export interface UnknownValueShape {
  readonly type: UnknownValueType;
  /** 只有 `type === 'string'` 時有值;其餘為 null。 */
  readonly length: number | null;
}

/**
 * 把一個來路不明的值描述成封閉形狀。
 *
 * 🔴 **為什麼不用 `String(value)`**(codex R1 F1/F2):
 *   ① `String()` 會執行外部物件的 `toString` / `Symbol.toPrimitive` ⇒ **它會 throw**,
 *      而那個 throw 會打斷整條失敗路徑(稽核沒寫、訊息也沒回)。
 *   ② 就算不 throw,拿到的是**外部自由字串** —— 截長度不是收斂內容,
 *      64 個字元裡塞得下 token 與個資,而 `admin_audit_log.after` 是原樣寫入的。
 * ⇒ 本函式**只用 `typeof`**(不呼叫值身上的任何方法),字串才多量一個 `.length`。
 */
export function describeUnknownValue(value: unknown): UnknownValueShape {
  try {
    if (value === null) return { type: 'null', length: null };
    const t = typeof value;
    if (t === 'string') return { type: 'string', length: (value as string).length };
    // `typeof` 的回傳本來就是封閉集合;仍然過一次表,不讓未來的新型別直接穿透。
    return {
      type: (UNKNOWN_VALUE_TYPES as readonly string[]).includes(t)
        ? (t as UnknownValueType)
        : 'indeterminate',
      length: null,
    };
  } catch {
    return { type: 'indeterminate', length: null };
  }
}
