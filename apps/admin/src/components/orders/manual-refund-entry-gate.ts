import type { PaymentListData } from './payment-list';

// manual-refund-entry-gate.ts — M-4b E10 D3:非卡退款登記入口「該不該渲染」的純判斷。
//
// 🔴 與 `refund-entry-gate.ts`(TapPay 線)刻意不同的兩點:
//    ① **判斷讀 `order_payments.rail`,不讀 `orders.payment_channel`** —— 片A/片B(取消線)
//       已經證明 `payment_channel` 幾乎是常數、不可靠(`cancel-view.ts:209-211,680-681`,
//       commit `0a09359b`:片A 改了 RPC 讀 `rail`,前端仍用舊判準造成兩份規格漂移的教訓)。
//    ② **不比對 `paymentStatus`**(TapPay 線用 `REFUND_ENTRY_STATUSES` 限 `paid`/`partiallyRefunded`)
//       —— `admin_record_manual_refund`(D1)不寫 `orders.payment_status`(無 trigger,D1 header
//       段自陳零寫入 GRANT 之外的行為),那顆欄位只反映 TapPay 退款的狀態機,拿來限制非卡
//       登記入口會產生假陰性(現金已付款單的 `paymentStatus` 不會因登記而改變,用它當閘
//       只會在「這張單根本沒有任何卡片退款」時錯誤地隱藏入口)。
//
// 帳本健康閘與 TapPay 線相同(同一組 `refundUnregisteredAmount`/`refundUnregisteredFailed`
// 輸入):讀不到或負值(對帳異常)時 fail-closed,理由同 refund-entry-gate.ts。

/**
 * 🔴🔴 **臨時硬閘,見 backlog `#787`**(主視窗 2026-08-20 裁丙:等,不做旗標系統也不開新 migration)。
 *
 * `admin_record_manual_refund`(D1)一旦有第一個 app 呼叫端,系統裡就有「登記錯了改不掉、
 * 永久多扣可退餘額」的風險——沖銷 RPC(`admin_void_manual_refund`,W1 乙片)還沒落地。
 * `packages/domain/src/order/manual-refund-caller-gate.test.ts` 是那個風險的觸發器測試
 * (本檔案路徑一旦成為它的呼叫端就會紅,逼人讀 #787)。
 *
 * 🔴 **這不是 #787 要求的「活檢查」**(片A閘二那種 apply 期 `to_regprocedure`/
 * `has_function_privilege` 斷言)——那個檢查方式住在 migration 層,app 層叫不到那兩個
 * catalog 函式,做一支包裝 RPC 只為了回答一個 grep 就答得出來的問題不成比例(主視窗裁定
 * 原文)。這裡改用**最簡單、對稱的手段**:入口先不接線可用,直到乙片落地。
 *
 * **解除條件(誰都可以做,不必是我)—— 🔴 三條,不是兩條**:
 *   ① `admin_void_manual_refund` 的 migration 已 apply
 *      ⚠️ **注意 `grep` 只量得到「檔案在磁碟上」** —— 分不出未追蹤 / 已 commit / 已上 dev / 已 apply。
 *      要真的確認,跑 `grep -c '20260820100000' supabase/APPLIED.tsv`。
 *      📌 2026-08-22 現況:**已 apply**(APPLIED.tsv 命中)⇒ **這一條【已經成立了】。**
 *   ② `manual-refund-caller-gate.test.ts` 的 `CALLER_ALLOWLIST` 已登記本檔路徑 + why
 *      (why 要寫「封印在哪一片、驗的是什麼」,不要寫「已確認」——該測試檔頭原話)
 *   ③ 🔴🔴 **`service_role` 對 `admin_void_manual_refund` 有 EXECUTE**(2026-08-22 線 C 補進本檔)
 *      量法(唯讀,對正式庫):
 *        select has_function_privilege('service_role', p.oid, 'EXECUTE'), p.proacl
 *          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *         where n.nspname = 'public' and p.proname = 'admin_void_manual_refund';
 *      📌 2026-08-22 實測:**false**;`proacl = postgres=X/postgres`(只有 owner)
 *      ⇒ **這一條【還沒成立】,而那是【刻意的】** —— 那支 migration 自己寫了四次「零 GRANT」:
 *        「本檔只建函式,EXECUTE 由『登記畫面那一片』開」(分期開權)。
 *
 * 🔴🔴 **本段第一版只寫了 ①②,而第三條【只住在測試的紅字訊息裡】** ——
 *   `manual-refund-787-trigger.test.ts` 的失敗訊息逐字有「確認『service_role 已 EXECUTE 到』之後才動手」。
 *   ⇒ 而**要改這道閘的人會讀【本檔】,不會去跑那支測試** ⇒ 照 ①② 做就會解除它,
 *      而入口渲染出來之後 **RPC 會在執行期被權限擋掉,同時 typecheck / lint / 測試【全綠】。**
 *   ⇒ ⇒ 🔴 **這正是本檔開頭第 5-9 行在警告的那個病(片A/片B 兩份規格漂移)——**
 *      **一份在警告規格漂移的檔,自己漂移了。** 保留這句,因為下一個人需要知道它會發生在誰身上。
 *   📌 可搬走的那一句:**規矩要放在那個人【會經過的地方】。**
 *
 * 三條都成立後,把下面這行 `return false` 連同本段註解一起刪掉。
 */
/** 見上方函式註解:#787 解除前這裡恆 true。寫成具名常數(不是行內 `true` 字面),
 *  是為了不讓下面保留的真實判斷邏輯被 lint 的 no-unreachable 當死碼砍掉。
 *  🔴 **匯出是為了讓 `manual-refund-787-trigger.test.ts` 讀得到它**——那支測試在
 *  沖銷 RPC migration 落地的那一刻要能對著這個值斷言「還沒解除」,不匯出就只能猜。 */
export const MANUAL_REFUND_ENTRY_BLOCKED_BY_787: boolean = true;

export function shouldShowManualRefundEntry(input: {
  payments: PaymentListData;
  refundUnregisteredFailed: boolean;
  refundUnregisteredAmount: number | null;
}): boolean {
  if (MANUAL_REFUND_ENTRY_BLOCKED_BY_787) return false;
  return (
    !input.refundUnregisteredFailed &&
    !(input.refundUnregisteredAmount !== null && input.refundUnregisteredAmount < 0) &&
    input.payments.status === 'ok' &&
    input.payments.rows.some((row) => row.rail === 'bank_transfer' || row.rail === 'cash')
  );
}
