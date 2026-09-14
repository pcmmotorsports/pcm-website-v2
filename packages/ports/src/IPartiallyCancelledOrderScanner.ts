import 'server-only';

/**
 * 部分取消補寄信的掃描面(2026-09-14;DB view `pcm_partially_cancelled_email_pending`, 20260915080000)。
 * 一列 = 一次部分取消(order_cancellations 有 items 的那些);形狀照 `IPartialRefundOrderScanner`。
 * 🔴 金額三格是 view 算好的現值:`remainingReceivable` 為 null = 含稅單稅算不出(pcm_order_remaining_receivable 回 NULL)
 *    ⇒ use-case 端算 unusableAmount 不寄, 不猜(Sean 09-10 甲「稅算不出來就不回數」)。
 */
export type PartiallyCancelledWithoutEmail = {
  orderId: string;
  displayId: string;
  cancellationId: string;
  cancelledAt: string;
  cancelledItems: ReadonlyArray<{ title: string | null; quantity: number }>;
  effectiveSubtotal: number | null;
  effectiveShippingFee: number | null;
  remainingReceivable: number | null;
  paidTotal: number;
  notificationEmail: string | null;
  customerEmail: string | null;
  orderSource: string | null;
};

export type ListPartiallyCancelledWithoutEmailInput = {
  /** 只掃這個時刻之後的取消(cancelled_at >= cutoff);部署前的取消不補寄(同其他信種的 cutoff 紀律)。 */
  cutoff: string;
  limit: number;
};

export type ListPartiallyCancelledWithoutEmailResult = {
  rows: PartiallyCancelledWithoutEmail[];
  scannedPages: number;
  truncated: boolean;
  /**
   * 🔴 掃描面裡「稅算不出來」(remaining_receivable IS NULL)那幾列的筆數 —— 它們**不進 rows**
   * (否則會永遠佔滿掃描窗, codex R1 must-fix ⑤), 而它們**不是 0 件事** ⇒ 這一格把它們數出來,
   * use-case 加進 `unusableAmount` ⇒ log 看得到「有幾張單因為稅算不出而沒寄」。
   */
  unusableInView?: number;
};

export interface IPartiallyCancelledOrderScanner {
  listPartiallyCancelledWithoutEmail(
    input: ListPartiallyCancelledWithoutEmailInput,
  ): Promise<ListPartiallyCancelledWithoutEmailResult>;
}
