/**
 * IBankOrderMailableCheck —— **寄送當下**重問一次「這張單還該不該收到匯款成立信」。
 *
 * 🔴🔴 **為什麼需要它**(R3-MF2 / MF8):
 * ```
 * 掃描是【快照】, 寄送是【後來】
 *   ⇒ 客人可能已經匯完(payment_status 翻 paid)、已取消、或匯了一半(balance_due 變小)
 *   ⇒ 少了這一道, 一個【剛剛付完錢的客人】會收到一封叫他去匯錢的信
 * ```
 * 🛑 **而現行那道 eligibility 閘擋不住它** —— 它掃的是 refunded / cancelled,
 *    **不含 `paid`**(`IEmailOutbox` 的窮舉表逐字)。
 *
 * ✅ **判準【不列舉狀態】, 而是問那支 view** —— `pcm_bank_order_still_mailable`(`20260906180000`)。
 *    📌 **狀態是列舉(`payment_status` 已經長出第五個值), 而「還該不該寄」是一個問題。**
 *    ⇒ 而那支 view **與排信用的掃描面共用同一份述詞** ⇒ 兩邊不會漂。
 *
 * ⚠️ **它證不到什麼**:它答的是「**我問的那一刻**」, 不是「**信真的送出去那一瞬間**」——
 *    中間仍有一段**不可消除的 race**。📌 **寫出來的用途不是免責, 是讓下一個人不要以為它關死了。**
 */
import 'server-only';

/**
 * 🔴🔴 **它回的是【現況的三個值】, 不是一個布林**(codex R1-#2/#3)——
 *   ⛔ 我第一版只答「那一列還在不在」⇒ 🛑 **入列 12,800 之後後台改成 10,000, view 仍回「還該寄」**
 *     ⇒ 照舊寄出快照裡的 12,800/0/12,800;**收件人被改成 B 也一樣**, 而信仍寄給快照裡的 A
 *     ⇒ 📌 **訂單與金額寄給前一個地址。**
 *   ⇒ 🎯 **我把「還該不該寄」與「我的快照還準不準」當成同一個問題, 而它們是兩個** ——
 *     view 答前者(該不該), **adapter 答後者(準不準)**, 而後者需要值。
 */
export type BankOrderMailableResult =
  /** 還該寄, 而**現況的三個值一起回**(呼叫端要拿它比快照)。 */
  | {
      kind: 'mailable';
      currentRecipientEmail: string | null;
      currentBalanceDue: number;
      currentTotal: number;
    }
  /** 已經不該寄(已付款 / 已取消 / 管道變了 / 餘額不再是可信的正數)⇒ 標終態、不寄。 */
  | { kind: 'not_mailable' }
  /**
   * 🔴 **讀不到** ⇒ 呼叫端要 **fail-closed:不寄、計 error**。
   * 📌 **不得退化成「那就寄吧」** —— 這封信印公司帳號叫客人匯錢,
   *    而「我不知道他還要不要匯」與「他還要匯」不是同一件事。
   */
  | { kind: 'unavailable' };

export interface IBankOrderMailableCheck {
  isBankOrderStillMailable(input: { orderId: string }): Promise<BankOrderMailableResult>;
}
