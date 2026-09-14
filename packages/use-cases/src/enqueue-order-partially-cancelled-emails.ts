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
  /**
   * 🔴🔴 第 22 件 ②:匯款金額變更信那條線上膛了沒(route 讀 `BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED === 'on'`)。
   * 刻意必填 —— 可選的話漏傳 = undefined = 當成沒上膛 = 本信照寄, 而那條線也照寄 ⇒ 看不出來的雙寄。
   */
  bankAmountChangedArmed: boolean;
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
  /** 第 22 件 ②:讓路給匯款金額變更信的次數(那條線已上膛, 而這次取消在它的掃描面上)。 */
  yieldedToBank: number;
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
    yieldToBank: options.bankAmountChangedArmed,
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
    // view 端就讓路的(LIMIT 之前濾掉, codex R1 MF2)先計進來;下面迴圈那一格是第二道。
    yieldedToBank: scan.yieldedInView ?? 0,
    errors: 0,
  };
  const inputs: EnqueueOrderPartiallyCancelledEmailInput[] = [];
  const suppressedInputs: EnqueueOrderPartiallyCancelledEmailInput[] = [];
  for (const row of rows) {
    // 🔴🔴 第 22 件 ②:讓路的判準【兩個一起】—— 只看 view 那一格, 那條線沒上膛時兩封都不寄;
    //    只看 env, 那條線的地板 / 七條述詞不收的取消兩封都不寄。
    //    🔵 讓路的那一次不留痕、下一輪還會掃到它 —— 那條線同一輪就會排它(它在本段之後跑),
    //       排了之後本信的 view anti-join 自己把它拿掉。
    //    🔵 第一道在 scanner(LIMIT 之前濾掉);這裡是第二道, 讓 scanner 漏濾時方向仍然對。
    // ponytail: 兩條線互讓靠「同一請求內序列」+ 兩張 view 對稱 anti-join, 不是交易鎖、不是 DB 唯一索引。
    //    天花板(codex R1/R2 MF1, 主視窗 2026-09-15 端 Sean 裁乙):兩個 email-sweep 請求【重疊】,
    //    而且【一個讀到開關 off、一個讀到 on】⇒ 兩邊各自 INSERT(event_type 不同, UNIQUE 不擋)
    //    ⇒ 同一次取消寄兩封(金額相同, 不是錯的金額;send-time 兩道閘都會放行)。
    //    ⛔ ~~「今天走不到:一個請求活不到下一個 tick」~~ —— codex R2 用 pg_net 原始碼推翻:
    //      timeout 只算 worker 取出之後, 不算排隊;積壓的請求會同批並行送出 ⇒ 重疊是走得到的。
    //    ✅ 而「一個 off 一個 on」只發生在 `BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED` 【切換】的那次部署:
    //      正式站 2026-09-14 已設 `=on`(主視窗 `vercel env ls production` + `~/pcm-mailbox/接手-主視窗-0914.md:24`)
    //      ⇒ 那一次切換已經過去;兩個請求都讀到 on ⇒ 部分取消信兩邊都讓路、匯款信同型別 ⇒ UNIQUE 擋得住。
    //    🛑 會重現的唯一情境:有人把那顆開關【關掉又打開】⇒ 上膛步驟寫了「切換前先暫停 pcm-email-sweep 兩輪」。
    //    升級路:`email_outbox (dedup_key) WHERE event_type IN (兩型) AND NOT (skipped 且沒交出去)` 唯一索引,
    //      enqueue 撞它回讓路 ⇒ DB 原子擋, 不靠人記得(第 22 件甲案, 沒做)。
    if (options.bankAmountChangedArmed && row.bankLineEligible) {
      result.yieldedToBank += 1;
      continue;
    }
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
