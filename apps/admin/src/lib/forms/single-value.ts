// single-value.ts — M-4b **#365**:單值表單欄位的**唯一**讀法。
//
// 🔴🔴 **為什麼不是 `form.get()`**:`get()` 取的是**第一筆**,而「第一筆」由送出者決定。
//    同名欄位送兩份,瀏覽器 / fetch 都送得出去 ⇒ `get()` **靜默**採前面那個。
//    取消線 2026-08-09 已把這條收緊(`cancel-form.ts` 的 `readSingle`,關卡2 codex 第三輪 #2),
//    本模組把**那個已經被審過的形狀**升成共用的,取代散在各檔的 11 個本地 helper。
//
// 🔴 **口徑要準,別照抄取消線那句**(#365 條目的原始風險描述在 admin 側是誇大的):
//    取消線的後果是「員工看到 2、系統取消 5」;但 admin 這些路徑的送出者**本來就是已登入員工**,
//    重複欄位**不給他任何新權限**(他直接送任意值也行)。真正要防的是另外兩件:
//      ① **表單重構意外**渲染出兩個同名欄位 ⇒ 靜默採第一筆、**零紅燈**;
//      ② 「畫面顯示值 ≠ 送出值」這條路,在未來任何代填 / 分享連結 / 嵌入情境會變成真的洞。
//    ⇒ 這是**可防的正確性 + fail-closed 一致性**,不是「今天有人偷得到錢」。
//
// 🔴 **行為變更(不是純重構)**:改用本模組後,「同名欄位送兩份」由
//    **靜默採第一筆 → 成功** 變成 **解析失敗 → 表單被拒**。
//    ⚠️ **這句成不成立,要看呼叫端有沒有「空值 ⇒ 跳過某個檢查」的欄位**:
//    有的話,只換 `readSingleString` 會把 `invalid` 收斂成 `null`、繞過那族守門
//    ⇒ **同一欄送兩份反而比送一份更容易通過**(關卡2 審查實跑在退款線抓到,見 `anyMalformed`)
//    ⇒ 那種呼叫端**必須兩件都做**:入口擋門 + 把 `null` 當形狀錯處理(逐檔看過,不假設)。
//    ⚠️ **反過來也要記住(片③ 突變量測出來的)**:呼叫端若**每一顆 `null` 都已經直接 `ok:false`**,
//    入口擋門就是**零判別力**——拿掉它「送兩份 ⇒ 被拒」照樣成立,因為擋的是 reader 不是 gate。
//    `supplier-form.ts` 三個 parser 與 `parseStaffActiveForm` 就是這種,**刻意不加擋門**
//    (理由逐字寫在 `supplier-form.ts` 的 `SUPPLIER_*` 段落與 `STAFF_PROFILE_SINGLE_FIELDS`)。
//    ⇒ 判準:**先問「這個欄位的 null 在下游代表放行還是代表拒」**,再決定要不要擋門。
//    (原文把擋門寫成無條件義務,且兩處把它叫成 `anyDuplicated` —— 那是片① 第一版的名字、
//     被 codex 抓到只數 length 的洞之後改名 `anyMalformed`,檔頭當時漏改。片③ 一併修。)
//    ⚠️ **入口擋門的責任範圍(codex 關卡2 收窄)**:負責「**值會影響寫入決策**」的欄位。
//    只影響導頁目的地的欄位(如 `return_to`)刻意留在清單外、走自己的 fallback ——
//    為了導頁壞掉而退掉整筆寫入,代價與風險不成比例(理由逐字寫在那兩個呼叫點)。

/** 只要求 `getAll` —— 真 `FormData` 天生符合;測試的假表單要自己補這一支。 */
export interface SingleValueFormLike {
  getAll(name: string): FormDataEntryValue[];
}

/**
 * 三態分開回,呼叫端才分得出「沒送」與「送壞了」——
 * 選填欄位沒送是合法的、送兩份不是(取消線 `reason_detail` 就靠這個區分)。
 */
export type SingleRead =
  | { kind: 'value'; value: string }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export function readSingle(form: SingleValueFormLike, field: string): SingleRead {
  const all = form.getAll(field);
  if (all.length === 0) return { kind: 'missing' };
  if (all.length > 1) return { kind: 'invalid' };
  const raw = all[0];
  return typeof raw === 'string' ? { kind: 'value', value: raw } : { kind: 'invalid' };
}

/** 單值欄位:非「恰一筆字串」一律回 `null`(呼叫端一律當形狀錯)。 */
export function readSingleString(form: SingleValueFormLike, field: string): string | null {
  const read = readSingle(form, field);
  return read.kind === 'value' ? read.value : null;
}

/**
 * 🔴🔴 **解析器入口的整批擋門 —— 這條是 `readSingleString` 的必要搭配,不是可選的加強。**
 *
 * 為什麼必須有它(關卡2 審查實跑打出來的洞,不是假想):
 * `readSingleString` 把 `missing` 與 `invalid` **都**收斂成 `null`,而解析器裡有一整族守門是
 * **「這一欄是空的 ⇒ 跳過某個互斥檢查」**。兩者相乘 ⇒ **同一欄送兩份反而比送一份更容易通過**。
 * 實測(2026-08-10,`refund-form.ts`):`kind=full` + `amount` 送兩份 ⇒ `amount` 讀成 null
 * ⇒ 跳過「full 不得帶金額」那道矛盾擋 ⇒ `ok:true` **全額退款**;同樣輸入只送一份 amount 是 `ok:false`。
 * ⇒ 那是**我這一輪改動製造出來的 fail-open**,方向與「同名欄位一律拒」正好相反。
 *
 * 修法選在**入口**而不是逐欄:逐欄要求每個 call site 自己記得分辨三態,漏一處就是一個洞,
 * 而「漏一處」在這族守門裡**沒有症狀**。入口擋門讓 `null` 在下游只可能代表「真的沒送」。
 *
 * 🔴 **第二輪修正(codex 關卡2 抓到):擋的是「非恰一筆字串」,不只是「送兩份」。**
 * 第一版只數 `getAll().length > 1` ⇒ **單一 `File` 型別的欄位數量是 1、擋門放行**,
 * 而 `readSingleString` 對它一樣回 `null` ⇒ **同一個 fail-open 換個輸入形狀就復活**
 * (實測:`kind=full` + `amount` 塞單一 File ⇒ `ok:true` 全額退款)。
 * ⇒ 現在直接複用 `readSingle`,`invalid` 一律擋 —— 「我修了一半」那個坑的具體修法。
 *
 * ⚠️ **它的能力邊界**:只擋你列進 `fields` 的那些欄。列表漏欄 = 洞照舊 ⇒
 * 各解析器的測試要拿**測試檔自己手寫的欄位清單**去比對這份常數(不能只 `it.each` 走訪同一顆常數
 * —— 那樣清單少一欄時測項也跟著少一條、全綠,codex 關卡2 抓到的循環論證)。
 */
export function anyMalformed(form: SingleValueFormLike, fields: readonly string[]): boolean {
  return fields.some((field) => readSingle(form, field).kind === 'invalid');
}
