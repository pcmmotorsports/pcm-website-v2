import 'server-only';

/**
 * ⟦mail-RECIPIENTNOTRECHECKED⟧ **寄出當下, 這張單現在的收件地址是什麼?**
 *
 * 🔴🔴 **為什麼需要它**(板列 `⟦mail-RECIPIENTNOTRECHECKED⟧`):
 *    收件地址是**排信當下凍住**的(`email_outbox.recipient_email NOT NULL`,
 *    `20260717020000:302`), 而寄的時候用的是列上那個(`sweep-email-outbox.ts:1950`)
 *    ⇒ 客人之後改了 email(或那個信箱換人用了)⇒ **訂單資訊落到別人手上**。
 *    ⇒ 匯款族**已經有**這道比對(`IBankOrderMailableCheck.currentRecipientEmail`),
 *      而**其他族連【現值】都拿不到** —— 這支 port 就是補那一半。
 *
 * 🛑 **它只回【現在的地址】, 不回「該不該寄」** —— 那是兩個問題, 而匯款族那支檔頭
 *    逐字記過把它們混成一個的後果。本 port **刻意不做**該不該寄的判斷。
 *
 * 🔴 **算法必須與【排信當下】那一套逐字相同**, 否則會製造**假的漂移**:
 *    `enqueue-order-created-emails.ts:107-109` 逐字
 *    `suppressCustomerEmailFallback(orderSource) ? firstNonEmpty(notificationEmail)
 *     : firstNonEmpty(notificationEmail, customerEmail)`
 *    ⚠️ **而匯款族那支 adapter 沒有套 `suppressCustomerEmailFallback`**
 *    (`SupabaseBankOrderMailableCheckAdapter.ts` 只判 `notification_email` 非空)
 *    ⇒ 📌 **那是一個【已存在】的不一致**:對「來源會壓制 customer 回退」的單,
 *      它算出來的現值可能與排信當下不同 ⇒ **比出一個不存在的漂移**。
 *      本 port **不重複那個錯**;而匯款那半**不在本片射程**(另記板列, 不順手改)。
 */
export type CurrentRecipientResult =
  /** 讀到了。`email === null` = **這張單現在沒有可用的收件地址**(而不是「讀不到」)。 */
  | { kind: 'known'; email: string | null }
  /**
   * 🔴 **讀不到** ⇒ 呼叫端要 **fail-closed:不寄**。
   * 📌 **不得退化成「那就照舊寄吧」** —— 「我不知道他現在的地址」與「他的地址沒變」
   *    是兩件事, 而只有後者可以照舊寄。
   */
  | { kind: 'unavailable' };

export interface IOrderCurrentRecipient {
  getCurrentRecipient(input: { orderId: string }): Promise<CurrentRecipientResult>;
}
