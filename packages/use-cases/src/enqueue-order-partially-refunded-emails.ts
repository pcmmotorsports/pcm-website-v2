/**
 * enqueueOrderPartiallyRefundedEmails —— 把「該寄部分退款通知的那一筆退款」放進 outbox。
 *
 * 🔴 **形狀與另外五支 enqueue 逐格相同**(掃描式:`cutoff` + `limit`)—— 而那是刻意的:
 *    掃描式**漏掉的有第二次機會**;單筆觸發只有一次, 那一發掛掉信就永遠不會寄。
 * 🔵 **呼叫端不接線**:不論哪條路產生退款, sweep 自己從 view 撈到 ⇒ **同一個出口**。
 *
 * 🔴🔴 **而它與另外五支【差一個粒度】, 那是本檔最容易被讀錯的一格**:
 * ```
 * 另外五支:一列 = 一張單    ⇒ result.scanned 是【單數】
 * 本支    :一列 = 一筆退款  ⇒ result.scanned 是【退款筆數】, 同一張單可能佔好幾列
 * ```
 * ⇒ 📌 拿 `scanned` 去比對「幾張單」會**多算**, 而它與正常世界長得一樣。
 *
 * ⚠️ **與 `enqueueOrderCancelledEmails` 是兩支** —— 那支的射程是
 *    `payment_status='refunded'`(整單全退), 本支是 `'partiallyRefunded'` ⇒ **互斥, 不會雙寄**。
 */
import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { IEmailOutbox, IPartialRefundOrderScanner } from '@pcm/ports';
import type { EnqueueOrderPartiallyRefundedEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

/**
 * 🔴 **Sean 2026-09-08 QB-16 拍甲**,逐字:要寄的是**真正的部分退款**
 *    (退了一部分、單子沒有全退)—— **今天完全沒有信的那一群**。
 *
 * 🛑 **射程逐條在 `pcm_partial_refund_email_pending` 的 COMMENT ON 裡, 不在這裡重寫一份。**
 *
 * 🔴 **PII**:`notificationEmail` / `customerEmail` **只從 scanner 直接交給 `outbox.enqueue`**,
 *    **不進 `result`、不進 log、不進錯誤訊息**(result 只有數字)。
 */
export type EnqueueOrderPartiallyRefundedEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: IPartialRefundOrderScanner;
};

export type EnqueueOrderPartiallyRefundedEmailsOptions = {
  cutoff: string;
  limit: number;
};

export type EnqueueOrderPartiallyRefundedEmailsResult = {
  /** 🔴 **退款【筆數】, 不是單數**(見檔頭粒度那段)。 */
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  /**
   * 🔴 **本支獨有的一格**:金額或時點讀不到 ⇒ 不排。
   * 另外五支沒有這一格, 因為它們的信少了那個欄位仍然是一句完整的話;
   * ⇒ 📌 **本封信存在的唯一理由就是那個金額**(A 2026-09-08 收 plan §④)。
   * ⚠️ 而它與 `noRecipient` 共病:**這條路也不在 outbox 留痕** ⇒ 下一輪會再撈到同一列
   *    ⇒ 這種列會**永久佔住 `limit` 的名額**。已回報主視窗開列(六支共病, 不在本片射程)。
   */
  unusableAmount: number;
  errors: number;
};

/** 兩個候選都沒有值 ⇒ 不 enqueue(空字串也算沒有 —— `enqueue` 對空 recipient 會 throw)。 */
function firstNonEmpty(a: string | null, b: string | null): string | null {
  if (a !== null && a.trim() !== '') return a;
  if (b !== null && b.trim() !== '') return b;
  return null;
}

export async function enqueueOrderPartiallyRefundedEmails(
  deps: EnqueueOrderPartiallyRefundedEmailsDeps,
  options: EnqueueOrderPartiallyRefundedEmailsOptions,
): Promise<EnqueueOrderPartiallyRefundedEmailsResult> {
  const scan = await deps.scanner.listPartialRefundsWithoutEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;

  const result: EnqueueOrderPartiallyRefundedEmailsResult = {
    scanned: rows.length,
    scannedPages: scan.scannedPages,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    unusableAmount: 0,
    errors: 0,
  };

  // ── 第一段:先把「要排的」全部建好(純函式, 一次 DB 都不打)────────────
  const inputs: EnqueueOrderPartiallyRefundedEmailInput[] = [];
  for (const row of rows) {
    // 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;⟦f3-MAILFALLBACKVSRULING⟧)。
    //    判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **六支共用一份**。
    //    在這裡重寫一份判斷, 六份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      ? firstNonEmpty(row.notificationEmail, null)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    if (recipientEmail === null) {
      // 🛑 **已知缺口(六支共病, 繼承自鏡像對象)**:這條路不在 outbox 留任何痕跡
      //    ⇒ 下一輪又會撈到同一列 ⇒ 永久佔住 `limit` 的名額。已開列, 不在本片射程。
      result.noRecipient += 1;
      continue;
    }
    // 🔴🔴 **金額 / 時點讀不到 ⇒ 不排, 而這是【本支獨有】的一格。**
    //    ⛔ 不要「照另外五支的樣子」把它省掉 —— 那五支少了欄位仍然是一句完整的話,
    //    而本封信少了金額就**什麼都沒說**。
    //    🔵 落表邊界(`buildOrderPartiallyRefundedPayload`)也會擋一次, 而**兩道都要**:
    //      那一道會 `throw` ⇒ 計 `errors` ⇒ 讀起來像「系統壞了」;
    //      這一道分開計數 ⇒ 📌 **「資料不完整」與「系統出錯」在報表上分得開。**
    if (!Number.isSafeInteger(row.refundedAmount) || row.refundedAmount <= 0
        || row.refundedAt.trim() === '') {
      result.unusableAmount += 1;
      continue;
    }
    inputs.push({
      eventType: 'order_partially_refunded',
      orderId: row.orderId,
      displayId: row.displayId,
      // 🔴 **這一格就是「每次都寄」** —— 落表邊界拿它當 `dedup_key`。
      refundId: row.refundId,
      // 🔴 金額原樣從 view 帶下來 —— 這一層不重算(重算 = 第二個來源 ⇒ 兩份會漂)。
      refundedAmount: row.refundedAmount,
      refundedAt: row.refundedAt,
      recipientEmail,
      // 掃描補寄路徑無 correlation 來源(與另外五支同形)
      requestId: null,
    });
  }

  // ── 第二段:問一次「這批裡有幾個是真的新的」+ 閘 ──────────────────────
  // 🛑 **不是 `rows.length`** —— 掃描面會放回「我們自己 skip 過」而 `enqueue()` 會回
  //    `duplicate` 的舊列 ⇒ 拿掃描列數當分母, 撞鍵的舊列會把真的該寄的信一起擋掉
  //    ⇒ 📌 **防止多寄的閘變成永久少寄**。
  assertEnqueueBatchWithinCap(
    'order_partially_refunded',
    await deps.outbox.countNewEvents(inputs),
    {
      // 🔵 撞閘就 throw ⇒ 呼叫端拿不到 result ⇒ 這幾個數只剩錯誤物件裡有。
      //    少了它們, 那一輪的 log 上「沒有讀數」與「讀數是 0」長得一樣。
      scanned: result.scanned,
      noRecipient: result.noRecipient,
      unusableAmount: result.unusableAmount,
    },
  );

  // ── 第三段:排 ────────────────────────────────────────────────────────
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
      // 🔴 **單筆失敗不擋整批** —— 下一輪 cron 會再看到它(掃描式的整個理由)。
      //    🛑 而**不把錯誤訊息放進 result** —— 那條路會把 recipientEmail 帶出去。
      result.errors += 1;
    }
  }

  return result;
}
