/**
 * IPaidOrderScanner — 「已付款但還沒排過 `order_created` 通知信」的窄查詢 port(M-4a B-5)。
 *
 * 🔴 **為什麼是一支【只讀、只回這五欄】的 port**(plan §2 甲案):
 * 通知信的 enqueue 不掛在付款當下(乙案),而是掛在既有 `email-sweep` cron 前面掃一次。
 * ⇒ `service_role` 只留在 email cron 的 composition 裡(那裡本來就有),
 *   **不進結帳路徑**、也不必動 `settleCharge` 那條「只回非 PII 對帳欄」的窄權契約。
 *
 * 🔴 **這支 port 會回 PII(兩個 email 欄)** ⇒ 實作一律 server-only + service_role;
 *    呼叫端(`enqueueOrderCreatedEmails`)只准把它們交給 `outbox.enqueue`,
 *    **不得進 log / result / 錯誤訊息**(PRD §7)。
 *
 * @see docs/specs/2026-08-18-m4a-b5-enqueue-scan-plan.md §3 / §4
 * @see docs/specs/2026-07-18-b0-order-notification-email-prd.md §3.2 / §5 R3
 */
export type PaidOrderWithoutOrderCreatedEmail = {
  orderId: string;
  displayId: string;
  /** 付款完成時間(ISO 8601;事件時點快照)。 */
  paidAt: string;
  /** `orders.notification_email`(B-4 起建單當下就帶真值;舊單為 null)。 */
  notificationEmail: string | null;
  /** `customers.email` —— PRD §3.2 明文的 fallback。🔴 它是註冊當下的凍結快照,不是 auth 現值。 */
  customerEmail: string | null;
};

export type ListPaidWithoutOrderCreatedEmailInput = {
  /**
   * 只看這個時點之後的單。🔴 **`paid_at` 與 `created_at` 兩邊都要卡**(PRD §5 R3 明文):
   * 只卡 `paid_at` 的話,cutoff 之前建立、cutoff 之後才晚翻 paid 的舊單會被誤納入
   * 「應該有信」的集合 ⇒ 客人收到一封關於幾個月前那張單的通知。
   */
  cutoff: string;
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

/**
 * 🔴 **回的是一個物件、不是裸陣列** —— 因為「這一輪掃到上限就停了」這件事**不得靜默發生**。
 * 裸陣列的話,「剛好只有 3 筆待排」與「掃到頁數上限、後面還有」長得一模一樣。
 */
export type ListPaidWithoutOrderCreatedEmailResult = {
  rows: PaidOrderWithoutOrderCreatedEmail[];
  /** 實際翻了幾頁(可觀測用;非 PII)。 */
  scannedPages: number;
  /** true = 撞到頁數上限或收滿 `limit` 就停了,**後面可能還有** ⇒ 下一輪會繼續。 */
  truncated: boolean;
};

export interface IPaidOrderScanner {
  listPaidWithoutOrderCreatedEmail(
    input: ListPaidWithoutOrderCreatedEmailInput,
  ): Promise<ListPaidWithoutOrderCreatedEmailResult>;
}
