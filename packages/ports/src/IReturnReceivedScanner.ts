import 'server-only';

/**
 * 退貨收回通知的掃描面(2026-09-27, Sean A3 甲甲甲;DB view `pcm_return_received_email_pending`, 20260927080000)。
 * 一列 = 一筆已收回(status = received)而且至少實收一件的退貨;view 已做 anti-join, 這裡不再判「寄過沒」。
 */
export type ReturnReceivedWithoutEmail = {
  orderId: string;
  returnId: string;
  displayId: string;
  receivedAt: string;
  receivedItems: ReadonlyArray<{ title: string | null; quantity: number }>;
  notificationEmail: string | null;
  customerEmail: string | null;
  orderSource: string | null;
};

export type ListReturnReceivedWithoutEmailInput = {
  /** 只掃這個時刻之後收回的退貨(received_at >= cutoff);上膛前收回的不補寄(同其他信種的 cutoff 紀律)。 */
  cutoff: string;
  limit: number;
};

export type ListReturnReceivedWithoutEmailResult = {
  rows: ReturnReceivedWithoutEmail[];
  scannedPages: number;
  truncated: boolean;
};

export interface IReturnReceivedScanner {
  listReturnReceivedWithoutEmail(
    input: ListReturnReceivedWithoutEmailInput,
  ): Promise<ListReturnReceivedWithoutEmailResult>;
}
