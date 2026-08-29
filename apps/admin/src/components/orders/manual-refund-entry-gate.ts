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
 * 🔴🔴 **`#787` 臨時硬閘 —— 仍然封著。而封著它的理由,已經不是當初那個。**
 *
 * ── ① 三條解除條件 2026-08-24 全部成立(`#806` 量的)────────────────────────
 * 第③條是**對 DB 量到的**,不是照帳本推的。原始查詢與輸出:
 * ```
 * select p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') as can_exec, p.proacl
 *   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *  where n.nspname = 'public'
 *    and p.proname in ('admin_void_manual_refund','admin_record_manual_refund','mark_charge_attempt_failed');
 *
 *  admin_record_manual_refund | true  | {postgres=X/postgres,service_role=X/postgres}     ← 正對照
 *  admin_void_manual_refund   | true  | {postgres=X/postgres,service_role=X/postgres}     ← 要查的那個
 *  mark_charge_attempt_failed | false | {postgres=X/postgres,payment_confirmer=X/postgres} ← 負對照
 * ⇒ 三個值不全一樣 ⇒ 尺是活的,那個 true 是真的。(Sean 在 SQL Editor 跑)
 * ```
 *
 * ── ② 🔴 而三條件成立【不等於】可以解除 ────────────────────────────────
 * 2026-08-24 照三條件解除之後,codex 對抗審查當場構造出一條路(主視窗與本窗各自複打成立):
 * ```
 * 持有效後台 session ⇒ 直接送 recordManualRefundAction(不經畫面)
 *   ⇒ 一張純刷卡、未付款的單 ⇒ 金額 ≤ 訂單總額
 *   ⇒ 寫進一筆假的人工退款 ⇒ **永久扣低可退餘額**
 * 擋不住它的原因有兩層:
 *   · UI 這道的 rail 條件(下方 `row.rail === 'bank_transfer' || 'cash'`)**server 端沒有重驗**
 *   · RPC 的額度上限(`20260820100000:230-231`)用的是 `o.total`(**訂單總額**),
 *     不是【該軌淨實收】⇒ 沒有收過現金的單也有額度可扣
 * ```
 * ⇒ 缺的是一道**不存在的 server 不變式**:**退款不得超過該軌(現金/匯款)的淨實收**。
 * ⇒ 🔴 **那件事有編號了:`#866`**(動 RPC ⇒ 鐵則 12③ + 12①,另一片、要 Sean 批)。
 *
 * ── ③ 🔴🔴 所以:這道封印現在的理由,與當初立它時【不是同一個】────────────
 * 當初封它是因為「登記錯了改不掉」(沖銷入口沒開);**那件事 2026-08-22 已經解決**。
 * **現在封著它的是 `#866`** —— 一個當初三條解除條件裡**一個字都沒提到**的東西。
 * ⚠️ 沒有這一段,下一個人會看到「三條件全成立而還封著」,然後**以為有人忘了解**。
 *
 * ── 📌 這一片留下來最該被帶走的一句 ──────────────────────────────────
 * > **解除一道封印之前,問的不是「條件到齊了嗎」,是「它現在還擋著什麼」。**
 *
 * 而那兩個問題的**答案來源不同**:
 * · 「條件到齊了嗎」**查得到** —— 條件是寫下來的。
 * · 「它還擋著什麼」**沒有任何檔案列得出來** —— 只能**從消費端反推**:
 *   grep 這顆旗標的每一個讀取點,逐個問「拿掉它之後,這裡還剩什麼閘」。
 * 🔴 2026-08-24 有**四個地方**都沒問那一句:backlog 條目 / 盤點清單 / 派工單 / 施工窗的 plan。
 */

/** 見上方檔頭:`#787` 解除前這裡恆 true。寫成具名常數(不是行內 `true` 字面),
 *  是為了不讓下面保留的真實判斷邏輯被 lint 的 no-unreachable 當死碼砍掉。
 *  🔴 **匯出是為了讓 `manual-refund-787-trigger.test.ts` 讀得到它。**
 *  ⚠️ **要暫時關掉這個入口的人:兩道都要關** —— 只關這裡關不住直接送 server action 的請求
 *     (理由寫在 `lib/payment/manual-refund-actions.ts` 那道的旁邊)。
 *
 *  ── 🔴🔴 **要【開封】的那個人:先讀這一段。它不在 `#866` 裡,它在這裡,因為你會經過這裡。**
 *  ```
 *  這道封印今天擋著的那個東西,線C 2026-08-29 23:2x **開檔複量過**(不是讀註解):
 *    supabase/migrations/20260820100000_*.sql:231 逐字仍是 `SELECT o.total::bigint`
 *    ⇒ 額度上限用的是【訂單總額】,不是【該軌(現金/匯款)的淨實收】
 *    ⇒ ⇒ **一張從來沒有收過現金的單,今天仍然有額度可以被扣。**
 *  ```
 *  🔴 **而它今天【按不到】—— 因為就是這顆旗標擋著。⇒ 它是潛伏的,不是正在流血的。**
 *  🔴🔴 **而那正是它危險的地方:你把這顆旗標翻成 `false` 的那一刻,它會【跟著一起上線】。**
 *  ⇒ 📌 **所以「開封」不是一個動作,是兩個**:翻旗標 **且** `#866` 那道 server 不變式要先存在。
 *  ⚠️ 而 `#866` 命中鐵則 12①③(動 RPC)⇒ **要 Sean 批、要 Sean apply**,不是施工窗自己能收的。
 *
 *  📌 **而這一段為什麼貼在這裡而不是留在 `#866`**:
 *     風險住在檔案上,而指令下在人身上 —— 一個要開封的人**一定會打開這一行**,
 *     而他**不一定會去翻 backlog**。⇒ 把它搬到他會經過的那一格。 */
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
