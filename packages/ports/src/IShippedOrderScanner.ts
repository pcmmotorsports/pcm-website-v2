/**
 * IShippedOrderScanner — 「已出貨但還沒排過 `order_shipped` 通知信」的窄查詢 port(M-4b E4-a)。
 *
 * 🔴 **為什麼掃描,而不是掛在出貨那個動作上**:
 * `20260717020000_m4a_email_outbox.sql:114` 逐字要求「E4 定義『一批』後,`order_shipped`
 * **亦須有對等訊號**(否則同一個洞在出貨線重演)」。掛在動作上的話,員工按完出貨、
 * enqueue 那一步炸掉 ⇒ **那封信永遠不會有人想起來,而且零訊號**。
 * 掃描式天然可重入:這一輪漏掉的,下一輪自己再撈到(差集是即時算的)。
 *
 * 🔴 **一列 = 一封信 = 一個 `(箱, 單)` 配對**,不是一個箱。
 * 一箱可含同一位客人的多張訂單(`shipments` 刻意沒有 `order_id`,`20260805170000:169`),
 * 而 Sean 2026-08-17 拍板「一箱兩單就寄兩封,一封講一張訂單」
 * (逐字 `~/pcm-mailbox/C-219-STOP-20260817.md:181`;決策表
 * `docs/specs/2026-08-17-qc9-tracking-to-customer-plan.md:305-325`)。
 *
 * 🔴 **這支 port 會回 PII(兩個 email 欄)** ⇒ 實作一律 server-only + service_role;
 *    呼叫端(`enqueueOrderShippedEmails`)只准把它們交給 `outbox.enqueue`,
 *    **不得進 log / result / 錯誤訊息**(鏡像 `IPaidOrderScanner` 的同一條)。
 */
export type ShippedOrderWithoutShippedEmail = {
  /**
   * 箱 uuid。`dedup_key` 的前半,**而且也進 payload**
   * (~~原寫「不進 payload」~~,2026-08-22 R1 ④ 之後不成立 —— 寄送時要拿它去主表撈脈絡)。
   */
  shipmentId: string;
  /** 箱號(進 payload;收信人分辨「哪一箱」的唯一依據)。 */
  shipmentReference: string;
  /** 標記出貨的時點(ISO 8601;事件時點快照)。 */
  shippedAt: string;
  orderId: string;
  displayId: string;
  /** `orders.notification_email`(2026-08-18 起建單當下就帶真值;舊單為 null)。 */
  notificationEmail: string | null;
  /** `customers.email` —— 與 `order_created` 同一條 fallback。🔴 註冊當下的凍結快照,不是 auth 現值。 */
  customerEmail: string | null;
};

export type ListShippedWithoutShippedEmailInput = {
  /**
   * 🔴 **起始線。只看 `shipped_at` 嚴格大於這個時點的箱。**
   *
   * 為什麼非有不可:本查詢的語意是「已出貨而沒排過信」——
   * **在功能上線的第一秒,那個集合 = 歷史上全部**。
   * 2026-08-22 唯讀量測:已出貨未作廢的箱 2 個、最舊那個出貨於 2026-08-12
   * ⇒ 沒有起始線就會寄出一封講十天前那批貨的通知,**而信收不回來**(鐵則 12⑤)。
   *
   * ⚠️ 與 `order_created` 那條的差別:那條同時卡 `paid_at` 與 `created_at` 兩個欄
   * (PRD §5 R3:cutoff 前建立、cutoff 後才翻 paid 的舊單會被誤納入)。
   * **出貨這條沒有那個形狀** —— `shipped_at` 就是事件本身發生的時點,
   * 一箱不會「先出貨再被建立」。⇒ 只卡一個欄是對的,不是漏掉。
   */
  cutoff: string;
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

/**
 * 🔴 **回物件、不回裸陣列** —— 「這一輪掃到上限就停了」不得靜默發生。
 * 裸陣列的話,「剛好只有 2 筆待排」與「掃到上限、後面還有」長得一模一樣。
 */
export type ListShippedWithoutShippedEmailResult = {
  rows: ShippedOrderWithoutShippedEmail[];
  /** true = 收滿 `limit` 就停了,**後面可能還有** ⇒ 下一輪會繼續。 */
  truncated: boolean;
};

export interface IShippedOrderScanner {
  listShippedWithoutShippedEmail(
    input: ListShippedWithoutShippedEmailInput,
  ): Promise<ListShippedWithoutShippedEmailResult>;
}
