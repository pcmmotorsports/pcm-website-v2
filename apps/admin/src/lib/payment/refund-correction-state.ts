// refund-correction-state.ts — `#890` 片2b:更正表單的欄位常數與結果碼(無 IO、可在 client 引用)。
//
// plan:`docs/specs/2026-08-29-890-manual-verdict-correction-ui-plan.md` §1c #4 / #8(v4)。
// 形狀鏡 `refund-recovery-state.ts`(欄名常數 + 結果碼住同一支,解析器與 action 各自引用)。
//
// 🔴 **為什麼欄名要當常數而不是字串字面**:表單那一側與解析器那一側各打一次字
//    ⇒ 打錯一個字母 ⇒ **那一欄永遠讀不到** ⇒ 而解析器會把它當成「員工沒填」
//    ⇒ 畫面說「請填寫理由」而他明明填了。⇒ 一個常數讓那兩側**不可能分岔**。

/** 要更正哪一筆退款(uuid)。 */
export const CORRECTION_REFUND_ID_FIELD = 'correction_refund_id';
/**
 * CAS 鏈頭:我送出這一發時**看到的**現行更正 id。
 * 🔴 **這一欄可以不在席** —— 不在席 = 「我看到的是尚未被更正過」⇒ 送 NULL 給 RPC。
 *    ⚠️ 它與「送了一個空字串」**不一樣**:空字串是壞掉的表單,要拒。
 */
export const CORRECTION_EXPECTED_ID_FIELD = 'correction_expected_id';
/** 改判成哪一種(二選一)。 */
export const CORRECTION_VERDICT_FIELD = 'correction_verdict';
/** 為什麼改。必填、≤500,而且**不得比 DB 寬**。 */
export const CORRECTION_REASON_FIELD = 'correction_reason';
/** 冪等鍵(機器產的;員工看不到)。 */
export const CORRECTION_REQUEST_TOKEN_FIELD = 'correction_request_token';

/**
 * 結果碼。
 * 🔴 **接進那一頁既有的 `ResultBanner`**(plan §1c #8 逐字選這條)——
 *    那一頁的成功訊息本來就走它 ⇒ **員工不會看到兩種成功長相**。
 */
export const CORRECTION_RESULT_CODES = [
  /** 改成功。 */
  'correction_done',
  /** 同一把 token 重播 ⇒ RPC 的冪等回應。**要告訴員工「這筆已經處理過」**。 */
  'correction_duplicate',
  /** CAS 對不上 ⇒ 有人在你之前改過 ⇒ **請重看一次現況再決定**(不是「稍後再試」)。 */
  'correction_stale',
  /** 那一列不是 `manual_failed` ⇒ 這個入口不適用它。 */
  'correction_not_applicable',
  /** 送進去的值不合規(理由太長／空白／值域)⇒ 員工改一下就好。 */
  'correction_invalid',
  /** 授權層說不行。 */
  'correction_denied',
  /** 🔴 我們的 bug ⇒ **不得叫員工重試**,要叫他找工程師。 */
  'correction_bug',
] as const;

export type CorrectionResultCode = (typeof CORRECTION_RESULT_CODES)[number];

// 🔴 具名常數(給 `result-banner.tsx` 用)—— **不讓那一側再打一次字串字面**。
//    打錯一個字母 ⇒ 那一則文案永遠不會顯示,而 banner 對未知碼是**靜靜地不顯示**
//    ⇒ 員工按完什麼都沒發生,而畫面看起來很正常。
export const CORRECTION_DONE_RESULT_CODE = 'correction_done' satisfies CorrectionResultCode;
export const CORRECTION_DUPLICATE_RESULT_CODE =
  'correction_duplicate' satisfies CorrectionResultCode;
export const CORRECTION_STALE_RESULT_CODE = 'correction_stale' satisfies CorrectionResultCode;
export const CORRECTION_NOT_APPLICABLE_RESULT_CODE =
  'correction_not_applicable' satisfies CorrectionResultCode;
export const CORRECTION_INVALID_RESULT_CODE = 'correction_invalid' satisfies CorrectionResultCode;
export const CORRECTION_DENIED_RESULT_CODE = 'correction_denied' satisfies CorrectionResultCode;
export const CORRECTION_BUG_RESULT_CODE = 'correction_bug' satisfies CorrectionResultCode;

/**
 * 🔴 **文案的分工**(這一段是規格,不是註解):
 * `correction_stale` 與 `correction_bug` **絕對不能共用一句話** ——
 * 前者員工有下一步(重看一次現況),後者他沒有(再按幾次都一樣)。
 * ⇒ 而它們在型別上都只是一個字串 ⇒ 這裡把它們列成不同的碼,是為了讓**接線那一側分得開**。
 */
export const CORRECTION_RETRYABLE_CODES: readonly CorrectionResultCode[] = [
  'correction_stale',
  'correction_invalid',
];
