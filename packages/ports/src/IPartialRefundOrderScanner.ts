/**
 * IPartialRefundOrderScanner —— **真正的部分退款**通知信(`order_partially_refunded`)的掃描 port。
 *
 * 🔴🔴 **它與 `ICancelledOrderScanner` 是【兩支】, 而它們【不同形】—— 那是刻意的。**
 * ```
 * order_cancelled           = 刷卡且【已全額退款】的整單取消   ← ICancelledOrderScanner(一列一張單)
 * order_partially_refunded  = 真正的部分退款(退了一部分)      ← 本支(🔴 一列一【筆退款】)
 * ```
 * 🛑 **兩者的射程互斥**:那支要 `payment_status = 'refunded'`, 本支要 `'partiallyRefunded'`
 *    ⇒ 同一張單不會同時進兩個掃描面 ⇒ **不會雙寄**。
 *
 * 🔵 掃描面 = `public.pcm_partial_refund_email_pending`(`20260908080000` 建)。
 *    **射程逐條寫在那支 view 的 `COMMENT ON`, 這裡不重抄**(抄一份就會漂一份)。
 *
 * ══ 🔴🔴 **本 port 存在的理由 = 一個【被取代的拍板】** ═══════════════════════════
 *    `supabase/migrations/20260905310000_m4b_cancelled_email_pending_view.sql:214` 註明
 *    **Sean 2026-09-02 拍甲**, 而 `:217` 逐字「⇒ 不涵蓋匯款/現金的單, 也**不涵蓋
 *    `partiallyRefunded`(部分退款)**」。
 *    ⛔ ~~「不涵蓋 `partiallyRefunded`」那半~~ 🔴 **2026-09-08 被 Sean 的 QB-16【甲】取代**
 *       —— 逐字「要寄的是**真正的部分退款**(退了一部分、單子沒有全退)—— 今天完全沒有信的那一群」。
 *    ⚠️ **射程**:「不涵蓋匯款/現金」那半 **仍然成立**(本 port 同樣只做 `payment_method='tappay'`)。
 *
 * ══ 🔴🔴 **一列 = 一筆退款(而不是一張單)—— 這是本 port 最容易被改壞的一格** ══════
 *    ✅ 依據是量到的:`supabase/migrations/20260812170000_..._2f_initiate_advisory.sql:598` 逐字
 *       `IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN ... ORDER_NOT_REFUNDABLE`
 *       ⇒ **一張已經 `partiallyRefunded` 的單還可以再退一次**;
 *       🟢 正對照 `:594` 只有 `'refunded'` 才回 `REFUND_LEDGER_FULL` 硬擋
 *       ⇒ 尺分得出兩個世界 ⇒ 📌 **分批退不是假想。**
 *    ⇒ 主視窗 A **2026-09-08 裁【甲 = 每次都寄】**(Sean 那題仍在佇列上;他若改答再改)。
 *    🛑 **把 `dedup_key` 從 `refundId` 改回 `orderId` 會【安靜地】退化成「只寄第一次」** ——
 *       第二筆錢默默進客人帳戶而他零通知, 而 **三綠不紅、測試不紅、畫面上沒有形狀**。
 *       ⇒ view 那支的**事後閘④**擋這件事(實跑驗過);要改它, 先拿 Sean 新的一次拍板。
 *
 * 🔴 **本 port 會回 PII(兩個 email 欄)** ⇒ 實作 server-only + service_role;
 *    呼叫端只准把它們交給 `outbox.enqueue`,**不得進 log / result / 錯誤訊息**。
 */
import 'server-only';

/** 一筆【已確認到帳】的卡片部分退款, 而它還沒排過通知信。 */
export type PartialRefundWithoutEmail = {
  orderId: string;
  displayId: string;
  /**
   * 🔴 **這一筆退款的身分, 也就是 `dedup_key`。**
   * 它是 `order_refunds.id`(uuid)—— 唯一鍵 `(event_type, dedup_key)` 不含 order_id
   * (`20260717020000:377`)⇒ 同一張單的第二筆退款是**另一個** dedup_key ⇒ **會再寄一封**。
   */
  refundId: string;
  /**
   * 🔴 **這一筆**退回原卡的錢(`order_refunds.refund_amount`)。
   * ⛔ **不是任何和** —— 和會在混合軌(卡退 + 現金退)的世界裡說謊, 而那正是姊妹那張
   *    view 要整張不寄的理由。本支講單筆, 所以在混合軌世界仍然逐字為真。
   * ⚠️ 代價明寫:混合軌的單, **現金那筆不會有信**(那條軌沒有掃描面)
   *    ⇒ 客人收到的是**不完整**而不是**錯的**。
   */
  refundedAmount: number;
  /**
   * 🔴 什麼時候退的(`order_refunds.confirmed_at`, ISO 8601)。
   * 掃描面只收 `status = 'confirmed'`, 而建表 CHECK `order_refunds_confirmed_consistency`
   * 逐字 `(status = 'confirmed') = (confirmed_at IS NOT NULL)` ⇒ 它保證非 null。
   * 🛑 **這也是收件範圍那道閘掛的地方** —— 見 `cutoff`。
   */
  refundedAt: string;
  /** `orders.notification_email`(建單當下的真值;舊單可能為 null)。 */
  notificationEmail: string | null;
  /** 退化來源:客戶主檔的 email。 */
  customerEmail: string | null;
  /**
   * `orders.order_source`。**本 port 只是把它接出來, 分流的判斷不在這裡**(與姊妹 port 同形)。
   * ⚠️ `null` 的意思是「view 沒給」而不是「這張單沒有來源」(`orders.order_source` 是 NOT NULL)。
   */
  orderSource: string | null;
};

export type ListPartialRefundsWithoutEmailInput = {
  /**
   * 只看這個時點**之後退的款**。
   * 🔴🔴 **它掛在 `refunded_at`(= `order_refunds.confirmed_at`), 而【不是】`orders.created_at`
   *    也不是 `orders.cancelled_at`** —— 這一格是刻意與姊妹 port 不同的。
   *
   *    姊妹那條線自己的檔頭寫著這是個病(`ICancelledOrderScanner.ts` 逐字:
   *    「**真正在決定收件範圍的是 `created_at`, 而契約寫的是 `cancelled_at`**」)。
   *    🛑 **失敗情境是具體的**:一張上線前建立、上線後才退款的單 ——
   *      用 `created_at` 當閘 ⇒ 它**永遠進不了任何一批** ⇒ 那位客人一輩子收不到信,
   *      而症狀是「掃到 0 筆」⇒ **與「今天沒有款要通知」印同一個東西**(零訊號)。
   *    ✅ 本 port 的契約與實作是同一句:**「這個時點之後退的款」**。
   *
   * 🔵 而它存在的理由與姊妹線相同:上線那一刻之前的舊退款**一律不補寄** ——
   *    否則第一次跑會對一批早就忘了這件事的人寄出一堆不可回收的信。
   */
  cutoff: string;
  /** 單輪上限(route 端常數、零 client 輸入)。 */
  limit: number;
};

export type ListPartialRefundsWithoutEmailResult = {
  rows: PartialRefundWithoutEmail[];
  scannedPages: number;
  truncated: boolean;
};

export interface IPartialRefundOrderScanner {
  listPartialRefundsWithoutEmail(
    input: ListPartialRefundsWithoutEmailInput,
  ): Promise<ListPartialRefundsWithoutEmailResult>;
}
