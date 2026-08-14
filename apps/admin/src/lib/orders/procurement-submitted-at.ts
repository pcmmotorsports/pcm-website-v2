import { toTaipeiInputValue } from './procurement-view';

// procurement-submitted-at.ts — M-4b E10 A10b:採購表單「送出時間」欄的**保秒**計算。
//
// 🔴 **為什麼獨立成檔**(`#476` 拆檔片,2026-08-14):
// ① `item-procurement-form.tsx` 到 410 行、過鐵則 6 的 400 硬線,而**這一段是全檔唯一
//    與 React 無關的計算** —— 抽出來零 hook 依賴,是最乾淨的一刀。
// ② 更重要的是**它原本測不到**:整段埋在 `useActionState` 的 wrapper 裡,只能繞著整張表單打
//    (`item-procurement-form.test.tsx` 的三格保秒測試都要先 render、選供應商、改欄位、submit)。
//    ⇒ 抽出後可以直接餵真值表。**拆檔順便把一個難測的點變好測,不是純為了行數。**
//
// 🔴 **不放進 `procurement-view.ts`**:那支是「採購區塊的純顯示邏輯」,而本檔是**送出前的
//    payload 合成**。混進去會讓那支的職責從「顯示」漂成「顯示 + 寫入」,而它正好是
//    `#476` 片2 挑列邏輯的所在地 —— 那裡的每一行都關係到會不會寫壞資料,不該再長胖。

/**
 * 取台北牆上時間的「秒」兩位(台灣固定 UTC+8、無日光節約 ⇒ 偏移是常數)。
 *
 * 🔴 **本函式是 `#476` 拆檔片的【純搬家】** —— 逐字剪貼自 `item-procurement-form.tsx`,
 * 一個字元都沒有改。與下面 `composeSubmittedAt` 的地位**不同**(那支是新抽出的形狀)。
 */
export function secondsOf(iso: string | null): string {
  if (iso === null) return '00';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '00';
  return new Date(ms + 8 * 60 * 60_000).toISOString().slice(17, 19);
}

/**
 * 決定要送進 RPC 的 `submitted_at` 字面(台北牆上時間,**不帶偏移** —— 偏移由 server 補)。
 *
 * ⚠️ **本函式【不是】純搬家**:原本是 `useActionState` wrapper 裡的一段內嵌三元式,
 * 這裡把它參數化成具名函式。**形狀變了,求值結果必須逐輸入相同** ——
 * 那是拆檔驗收的重點,不能用「純搬家」一語帶過(`V-005-STOP` 有四道證明)。
 *
 * ## 它在解什麼
 * `<input type="datetime-local">` **只到分鐘**:DB 裡的 `14:30:45` 回填成 `14:30`,
 * 原樣送出會把秒改成 `:00` ⇒ **員工沒動那一欄,值卻被改了**。
 * ⇒ 「可見值與原值同一分鐘」= 員工沒動過 ⇒ 把**原值的秒**補回去。
 *
 * ## 三個分支(與原內嵌式逐字對應)
 * - `local === ''`(員工清空了)→ 回 `''`。**這是合法的「清成 NULL」路徑,不要擋。**
 * - 同一分鐘 **且** 原值格式正常(`toTaipeiInputValue` 回 16 字)→ `原分鐘:原秒`
 * - 其餘(真的改了時間 / 原值壞掉或為 null)→ 回 `local`(**不死抱原始 ISO**)
 *
 * 🔴 **這裡不做時區換算**:偏移由 **server** 補 `Asia/Taipei`(A5a 契約
 * `20260803160000:475-476`)。在瀏覽器換算 = 用**裝置**時區 ⇒ 非台北機器靜默存錯時刻。
 *
 * @param local 送出那一刻**從實際 FormData 讀到**的可見欄值(不是 React state ——
 *   瀏覽器自動填 / 表單還原可能沒觸發 `onChange`,靠 state 算會是舊的)
 * @param originalSubmittedAt hydrate 當下那一列的原始 `submitted_at`(ISO;`null` = 沒有原值)
 */
export function composeSubmittedAt(local: string, originalSubmittedAt: string | null): string {
  const originalLocal = originalSubmittedAt === null ? '' : toTaipeiInputValue(originalSubmittedAt);
  return local !== '' && originalLocal === local
    ? toTaipeiInputValue(originalSubmittedAt).length === 16
      ? `${originalLocal}:${secondsOf(originalSubmittedAt)}`
      : local
    : local;
}
