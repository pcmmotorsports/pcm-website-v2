/**
 * IIneligibleOrderEmailScanner — 「due 但訂單已不合格」的窄查詢 port(M-4a E2a-2、W3-G 拆出)。
 *
 * 對應 plan `docs/specs/2026-07-16-m4a-email-notify-plan.md:329/362` 的「寄送時 gate」:
 * outbox 掃描器(`SupabasePaidOrderScannerAdapter`)只擋「掃描當下已取消」的單;排進佇列之後、
 * 真正寄出之前才被取消的單,這條擋不住 —— 那個窗口由本 port + `applyOrderIneligibleGate`
 * use-case 擋,跑在 `sweepEmailOutbox` 之前(獨立 cron route,不掛進 email-sweep)。
 *
 * 🔴 **述詞照 plan 拍板原文,不自己判**(:362):`payment_status='refunded' OR
 * cancelled_at IS NOT NULL`。**不含 `partiallyRefunded`**。
 *
 * 🔴 **唯讀、不 claim**:回傳的是「候選」,由呼叫端(use-case)對每一筆各自
 * `outbox.claimById` + `outbox.markSkippedOrderIneligible`(CAS,安全處理race —— candidate 在
 * 讀出來之後、claim 之前被 sweeper 搶先送出/其他人搶先認領都算正常,不是本 port 的責任)。
 *
 * @see docs/specs/2026-07-16-m4a-email-notify-plan.md §4.1(:329)/ E2a-2 表列(:362)
 * @see packages/ports/src/IEmailOutbox.ts markSkippedOrderIneligible
 */
export type DueIneligibleEmailJob = {
  id: string;
  orderId: string;
};

export interface IIneligibleOrderEmailScanner {
  /**
   * 讀 due(status IN pending/failed 且到期、attempts < max_attempts)outbox 列裡,
   * 對應訂單現在已不合格的那些。**不分 event_type**:任何一種通知信,訂單已退款/取消時
   * 都不該再寄,故本查詢橫跨 `order_created` 與 `order_shipped`。
   *
   * limit = 單輪掃描上限(route 端常數、零 client 輸入)。
   */
  listDueIneligible(limit: number): Promise<DueIneligibleEmailJob[]>;
}
