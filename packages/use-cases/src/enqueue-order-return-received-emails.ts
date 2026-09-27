import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { EnqueueOrderReturnReceivedEmailInput, IEmailOutbox, IReturnReceivedScanner } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

/**
 * 退貨收回通知 —— 排信(2026-09-27, Sean A3 甲甲甲:只寄 email / 確認收到後自動排 / 只說已收到、會盡快處理退款)。
 * 形狀照 `enqueue-order-partially-cancelled-emails.ts`:掃描面(view)→ 收件人規則 → 內容可用性 → 批次上限 → enqueue。
 * 🔴 收件人規則同族:收件地址的 email 優先(09-19 拍甲), 手動單只看 notification_email(`suppressCustomerEmailFallback`),
 *    空 ⇒ 留痕 skipped_manual_no_recipient。沒有真 email 的 LINE 客人由 outbox 標 skipped_no_real_email, 再由寄信排程轉 LINE。
 */
export type EnqueueOrderReturnReceivedEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: IReturnReceivedScanner;
};

export type EnqueueOrderReturnReceivedEmailsOptions = {
  cutoff: string;
  limit: number;
};

export type EnqueueOrderReturnReceivedEmailsResult = {
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  /** 沒有實收品項或收回時間讀不到 ⇒ 沒有東西可以說「已收到」, 不排。 */
  unusable: number;
  errors: number;
};

function firstNonEmpty(a: string | null, b: string | null): string | null {
  if (a !== null && a.trim() !== '') return a;
  if (b !== null && b.trim() !== '') return b;
  return null;
}

export async function enqueueOrderReturnReceivedEmails(
  deps: EnqueueOrderReturnReceivedEmailsDeps,
  options: EnqueueOrderReturnReceivedEmailsOptions,
): Promise<EnqueueOrderReturnReceivedEmailsResult> {
  const scan = await deps.scanner.listReturnReceivedWithoutEmail({ cutoff: options.cutoff, limit: options.limit });
  const rows = scan.rows;
  const result: EnqueueOrderReturnReceivedEmailsResult = {
    scanned: rows.length,
    scannedPages: scan.scannedPages,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    unusable: 0,
    errors: 0,
  };
  const inputs: EnqueueOrderReturnReceivedEmailInput[] = [];
  const suppressedInputs: EnqueueOrderReturnReceivedEmailInput[] = [];
  for (const row of rows) {
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      ? firstNonEmpty(row.notificationEmail, null)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    const traceEmail =
      recipientEmail === null && suppressCustomerEmailFallback(row.orderSource)
        ? firstNonEmpty(row.customerEmail, null)
        : null;
    const effectiveEmail = recipientEmail ?? traceEmail;
    if (effectiveEmail === null) {
      result.noRecipient += 1;
      continue;
    }
    if (row.receivedAt.trim() === '' || row.receivedItems.length === 0) {
      result.unusable += 1;
      continue;
    }
    const input: EnqueueOrderReturnReceivedEmailInput = {
      eventType: 'order_return_received',
      orderId: row.orderId,
      displayId: row.displayId,
      returnId: row.returnId,
      receivedAt: row.receivedAt,
      receivedItems: row.receivedItems,
      recipientEmail: effectiveEmail,
      requestId: null,
    };
    if (recipientEmail === null) {
      suppressedInputs.push(input);
      result.noRecipient += 1;
      continue;
    }
    inputs.push(input);
  }
  for (const input of suppressedInputs) {
    try {
      await deps.outbox.enqueueManualNoRecipient(input);
    } catch {
      result.errors += 1;
    }
  }
  assertEnqueueBatchWithinCap('order_return_received', await deps.outbox.countNewEvents(inputs), {
    scanned: result.scanned,
    noRecipient: result.noRecipient,
    unusableAmount: result.unusable,
  });
  for (const input of inputs) {
    try {
      const enqueued = await deps.outbox.enqueue(input);
      if (enqueued.kind === 'enqueued') {
        result.enqueued += 1;
      } else if (enqueued.kind === 'skipped_no_real_email') {
        result.skippedNoRealEmail += 1;
      } else {
        result.duplicate += 1;
      }
    } catch {
      result.errors += 1;
    }
  }
  return result;
}
