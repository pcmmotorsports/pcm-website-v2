import type { IEmailOutbox, ITrackingCorrectedScanner } from '@pcm/ports';

/**
 * ⟦5b-TRACKNUMGAP1⟧ 片 C:把「單號被更正過而還沒通知客人」的箱排進 outbox。
 *
 * 🔵 **整支鏡像 `enqueueOrderShippedEmails`** —— 掃一頁、逐列 enqueue、把結果分堆數。
 *
 * 🔴🔴 **而它與那一支差在【沒有 cutoff】, 而那是刻意的**(理由在 `ITrackingCorrectedScanner` 檔頭):
 *    觸發欄是本片新增的 ⇒ 歷史上每一箱都是 NULL ⇒ 集合天生從空的開始長。
 *    ⇒ 🛑 **所以本片【沒有】「那顆 env 沒設就整段不跑」的降級** —— 因為沒有那顆 env。
 *      📌 而這件事要寫出來:讀 route 的人看到另外三條線都有 cutoff 而這條沒有,
 *        第一個念頭會是「是不是漏了」。**不是。**
 *
 * 🔴 **本檔【不決定】要不要寄** —— 該不該寄的判斷在 view 裡
 *    (出貨信必須在更正之前就已寄出)。這裡只負責「把 view 給我的每一列送進 outbox」。
 *    ⇒ 📌 那個分界讓本檔零 DB 依賴 ⇒ 每一條路都用假 outbox + 假 scanner 驗得完。
 */
export type EnqueueTrackingCorrectedEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: ITrackingCorrectedScanner;
};

export type EnqueueTrackingCorrectedEmailsOptions = {
  limit: number;
};

export type EnqueueTrackingCorrectedEmailsResult = {
  scanned: number;
  /** true = 這一輪收滿上限就停了,後面可能還有 ⇒ 下一輪會繼續。 */
  truncated: boolean;
  enqueued: number;
  /** 合成假信箱(LINE cohort)⇒ adapter 落一列 `skipped_no_real_email`(**有痕跡**)。 */
  skippedNoRealEmail: number;
  duplicate: number;
  /** 兩個信箱候選都空 ⇒ 本輪跳過。⚠️ view 已濾掉這種列, 所以這個數**平常應該是 0**。 */
  noRecipient: number;
  errors: number;
};

export async function enqueueTrackingCorrectedEmails(
  deps: EnqueueTrackingCorrectedEmailsDeps,
  options: EnqueueTrackingCorrectedEmailsOptions,
): Promise<EnqueueTrackingCorrectedEmailsResult> {
  const scan = await deps.scanner.listTrackingCorrectedWithoutEmail({ limit: options.limit });
  const rows = scan.rows;

  const result: EnqueueTrackingCorrectedEmailsResult = {
    scanned: rows.length,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    errors: 0,
  };

  for (const row of rows) {
    const recipientEmail = firstNonEmpty(row.notificationEmail, row.customerEmail);
    if (recipientEmail === null) {
      result.noRecipient += 1;
      continue;
    }
    try {
      const enqueued = await deps.outbox.enqueue({
        eventType: 'shipment_tracking_corrected',
        orderId: row.orderId,
        displayId: row.displayId,
        shipmentId: row.shipmentId,
        shipmentReference: row.shipmentReference,
        trackingNumber: row.trackingNumber,
        trackingCorrectedKey: row.trackingCorrectedKey,
        recipientEmail,
        requestId: null, // 掃描補寄路徑無 correlation 來源
      });
      if (enqueued.kind === 'enqueued') {
        result.enqueued += 1;
      } else if (enqueued.kind === 'skipped_no_real_email') {
        result.skippedNoRealEmail += 1;
      } else {
        result.duplicate += 1;
      }
    } catch {
      // 🔴 一列失敗不擋其餘 —— 而它被【數起來】, 呼叫端會據此回 503。
      result.errors += 1;
    }
  }

  return result;
}

function firstNonEmpty(...candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
  }
  return null;
}
