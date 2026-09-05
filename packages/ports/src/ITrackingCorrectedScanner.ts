/**
 * ⟦5b-TRACKNUMGAP1⟧ 片 C:「單號被更正過、而客人已經收過那個錯號碼、還沒排過更正信」的掃描面。
 *
 * 🔵 **形狀刻意鏡像 `IShippedOrderScanner`** —— 同一條線上的第二個掃描器,
 *    讀懂那一支就讀得懂這一支。
 *
 * 🔴🔴 **而它與那一支有一個【本質差異】, 不要照抄過去**:
 *    `order_shipped` 的差集鍵是 `(箱, 單)` ⇒ 一箱一單一輩子一封。
 *    本掃描面的鍵是 **`(箱, 號碼)`** ⇒ 🎯 **同一箱被改幾次號碼, 就有幾封信。**
 *    ⇒ 📌 那不是漏洞, 那是規格:每一次更正都是一件客人需要知道的新事。
 *
 * 🛑 **本 port 【沒有】 cutoff 參數 —— 而那是刻意的, 不是漏了。**
 *    `order_shipped` 需要 cutoff, 因為它上線第一秒的集合 = 歷史全部的已出貨箱。
 *    而本掃描面的觸發欄 `shipments.tracking_corrected_at` 是**本片才新增的**
 *    ⇒ 🔴 **歷史上每一箱的那一欄都是 NULL** ⇒ 集合天生從空的開始長。
 *    ⇒ 📌 **起始線由「這個欄位什麼時候出生」保證, 不由一顆 env 保證** ——
 *      而一顆沒有人設的 env 與一顆設錯的 env, 在上線那一刻長得一樣。
 */

/** 一列 = 一封要寄的更正信。 */
export type ShipmentWithCorrectedTracking = {
  /** 箱 uuid。`dedup_key` 的前半。 */
  shipmentId: string;
  /** 箱號(進 payload;收信人分辨「哪一箱」的唯一依據)。 */
  shipmentReference: string;
  /**
   * **更正後**的貨運單號 —— `dedup_key` 的後半, 也是這封信的全部內容。
   * 🔴 view 那一側已經濾掉空白(`nullif(btrim(...), '')`)⇒ 這裡拿到的一定非空。
   */
  trackingNumber: string;
  /** 快遞商代碼(進不進信由組裝端決定;放這裡讓組裝端不必再查一次)。 */
  carrierCode: string;
  /** 最後一次更正的時點(ISO 8601;給人看與排序用)。 */
  trackingCorrectedAt: string;
  /**
   * 同一個時點的 **20 位數字串**(UTC、到微秒、零分隔符), 由 SQL 的
   * `pcm_tracking_corrected_at_key()` 算好, view 當一欄回出來。
   * 🔴 **它是 `dedup_key` 的後半, 而 TS 這一側從來不碰時間格式化** —— 理由見
   *    `IEmailOutbox.ts` 的 `trackingCorrectedKey` JSDoc(單一來源, 這裡不重複第二份)。
   */
  trackingCorrectedKey: string;
  orderId: string;
  displayId: string;
  /** `orders.notification_email`(舊單可能為 null)。 */
  notificationEmail: string | null;
  /** `customers.email` —— 與 `order_shipped` 同一條 fallback(註冊當下的凍結快照)。 */
  customerEmail: string | null;
  /**
   * `orders.order_source` —— 訂單來源(⟦f3-MAILFALLBACKVSRULING⟧ 片 B, 2026-09-05)。
   *
   * 🔴 **本片只是把它接出來, 沒有任何人在用它** —— 分流的判斷在片 C。
   * 值域是 `packages/domain` 的 `OrderSource`(`web` / `manual_phone` /
   * `manual_line` / `manual_other`, CHECK 在 `20260712203000`)。
   * 🛑 這裡刻意用 `string` 不用那個 union:**值域寫兩份, 下一個加來源的人只會改到一份。**
   * ⚠️ `null` 的意思是「view 沒給」而不是「這張單沒有來源」——
   *    `orders.order_source` 是 NOT NULL(`20260712203000`), 所以 `null` 只會在【欄位沒撈到】時出現。
   * 🔴🔴 **而 fail 方向現在就釘死(R1-F11)**:片 C 撞到 `null` ⇒ **照舊寄**(走 fallback)。
   *    🛑 反過來寫(`orderSource !== 'web' ⇒ 不寄`)會讓一個 `null` 把
   *    **真的顧客站訂單靜默不寄** —— 而「沒寄」這件事在畫面上沒有形狀。
   *    📌 兩個方向都會錯, 而錯的代價不對稱:多寄一封信看得見, 少寄一封看不見。
   */
  orderSource: string | null;
};

export type ListTrackingCorrectedInput = {
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

export type ListTrackingCorrectedResult = {
  rows: ShipmentWithCorrectedTracking[];
  /** true = 收滿 `limit` 就停了,**後面可能還有** ⇒ 下一輪會繼續。 */
  truncated: boolean;
};

export interface ITrackingCorrectedScanner {
  listTrackingCorrectedWithoutEmail(
    input: ListTrackingCorrectedInput,
  ): Promise<ListTrackingCorrectedResult>;
}
