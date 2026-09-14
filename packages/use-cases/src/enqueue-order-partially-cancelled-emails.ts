import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { IEmailOutbox, IPartiallyCancelledOrderScanner } from '@pcm/ports';
import type { EnqueueOrderPartiallyCancelledEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

/**
 * 部分取消補寄信 —— 排信(2026-09-14, Sean 拍甲甲甲:每次取消各寄一封 / 券金額變高照寄 / 文案先看)。
 * 形狀逐字照 `enqueue-order-partially-refunded-emails.ts`:掃描面(view)→ 收件人規則 → 金額可用性 → 批次上限 → enqueue。
 * 🔴 金額三格由 view 算好;`remainingReceivable` null(含稅單稅算不出)⇒ unusableAmount 不寄, 不猜(Sean 09-10 甲)。
 * 🔴 收件人規則同族:手動單只看 notification_email(`suppressCustomerEmailFallback`), 空 ⇒ 留痕 skipped_manual_no_recipient。
 */
export type EnqueueOrderPartiallyCancelledEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: IPartiallyCancelledOrderScanner;
};

export type EnqueueOrderPartiallyCancelledEmailsOptions = {
  cutoff: string;
  limit: number;
};

export type EnqueueOrderPartiallyCancelledEmailsResult = {
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  unusableAmount: number;
  errors: number;
};

function firstNonEmpty(a: string | null, b: string | null): string | null {
  if (a !== null && a.trim() !== '') return a;
  if (b !== null && b.trim() !== '') return b;
  return null;
}

export async function enqueueOrderPartiallyCancelledEmails(
  deps: EnqueueOrderPartiallyCancelledEmailsDeps,
  options: EnqueueOrderPartiallyCancelledEmailsOptions,
): Promise<EnqueueOrderPartiallyCancelledEmailsResult> {
  const scan = await deps.scanner.listPartiallyCancelledWithoutEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;
  const result: EnqueueOrderPartiallyCancelledEmailsResult = {
    scanned: rows.length,
    scannedPages: scan.scannedPages,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    // view 端就擋掉的(稅算不出)先計進來 —— 它們不在 rows 裡, 而它們確實是「今天沒寄出去的單」。
    unusableAmount: scan.unusableInView ?? 0,
    errors: 0,
  };
  const inputs: EnqueueOrderPartiallyCancelledEmailInput[] = [];
  const suppressedInputs: EnqueueOrderPartiallyCancelledEmailInput[] = [];
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
    const nonNeg = (n: number | null): n is number => n !== null && Number.isSafeInteger(n) && n >= 0;
    if (
      !nonNeg(row.remainingReceivable) || !nonNeg(row.effectiveSubtotal) || !nonNeg(row.effectiveShippingFee)
      || !nonNeg(row.paidTotal) || row.cancelledAt.trim() === '' || row.cancelledItems.length === 0
    ) {
      result.unusableAmount += 1;
      continue;
    }
    const input: EnqueueOrderPartiallyCancelledEmailInput = {
      eventType: 'order_partially_cancelled',
      orderId: row.orderId,
      displayId: row.displayId,
      cancellationId: row.cancellationId,
      cancelledAt: row.cancelledAt,
      cancelledItems: row.cancelledItems,
      effectiveSubtotal: row.effectiveSubtotal,
      effectiveShippingFee: row.effectiveShippingFee,
      remainingReceivable: row.remainingReceivable,
      paidTotal: row.paidTotal,
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
  assertEnqueueBatchWithinCap(
    'order_partially_cancelled',
    await deps.outbox.countNewEvents(inputs),
    {
      scanned: result.scanned,
      noRecipient: result.noRecipient,
      unusableAmount: result.unusableAmount,
    },
  );
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
