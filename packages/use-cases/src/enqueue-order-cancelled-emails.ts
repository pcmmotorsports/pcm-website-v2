/**
 * enqueueOrderCancelledEmails —— 把「該寄取消信的單」放進 outbox。
 *
 * 🔴 **形狀與另外四支 enqueue 逐格相同**(掃描式:`cutoff` + `limit`)—— 而那是刻意的:
 *    掃描式**漏掉的單有第二次機會**;單筆觸發只有一次, 那一發掛掉信就永遠不會寄。
 *    (線【身分】`-d8` 2026-09-05 逐字:「我這一側【不該】是唯一的觸發點。」)
 * 🔵 **呼叫端不接線**(主視窗 2026-09-05 裁):不論哪條路取消(`admin_mark_order_cancelled` /
 *    `admin_cancel_order` / 未來新增的), sweep 自己從 view 撈到 ⇒ **同一個出口。**
 *
 * ⚠️ **與 `enqueueOrderUnpaidCancelledEmails` 是兩支, 型別同形 ⇒ import 錯不會紅。** 見 port 檔頭。
 */
import { suppressCustomerEmailFallback } from '@pcm/domain';
import type {
  IEmailOutbox,
  ICancelledOrderScanner,
} from '@pcm/ports';

/**
 * enqueueOrderCancelledEmails —— 把「未付款被【員工】取消、而還沒排過信」的單排進 outbox。
 *
 * **鏡像 `enqueueOrderCreatedEmails`,刻意逐格對齊** —— 失敗模式、計數欄、PII 紀律都已知。
 *
 * 🔴 **Sean 2026-09-03 拍甲**,理由逐字:「**那是客人唯一一封信**」——
 *    這條線的客人**從頭到尾沒有付過錢**,所以在被取消之前一封信都沒收過。
 *
 * 🛑 **射程:不含逾時自動取消**(那是題 2,他**未拍板**)。
 *    判準與那個字面的來源座標寫在 `ICancelledOrderScanner` 檔頭 —— **不在這裡重寫一份**。
 *
 * 🔴 **PII**:`notificationEmail` / `customerEmail` **只從 scanner 直接交給 `outbox.enqueue`**,
 *    **不進 `result`、不進 log、不進錯誤訊息**(result 只有數字)。
 */
export type EnqueueOrderCancelledEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: ICancelledOrderScanner;
};

export type EnqueueOrderCancelledEmailsOptions = {
  cutoff: string;
  limit: number;
};

export type EnqueueOrderCancelledEmailsResult = {
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  errors: number;
};

/** 兩個候選都沒有值 ⇒ 不 enqueue(空字串也算沒有 —— `enqueue` 對空 recipient 會 throw)。 */
function firstNonEmpty(a: string | null, b: string | null): string | null {
  if (a !== null && a.trim() !== '') return a;
  if (b !== null && b.trim() !== '') return b;
  return null;
}

export async function enqueueOrderCancelledEmails(
  deps: EnqueueOrderCancelledEmailsDeps,
  options: EnqueueOrderCancelledEmailsOptions,
): Promise<EnqueueOrderCancelledEmailsResult> {
  const scan = await deps.scanner.listCancelledWithoutEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;

  const result: EnqueueOrderCancelledEmailsResult = {
    scanned: rows.length,
    scannedPages: scan.scannedPages,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    errors: 0,
  };

  for (const row of rows) {
    // 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;板列 ⟦f3-MAILFALLBACKVSRULING⟧)。
    //    判準是【兩個條件】—— `manual_*` **而且** `notification_email` 為空,
    //    而後者是 `firstNonEmpty` 回 null 那一格。**兩個條件都在這一行裡。**
    // 🛑 判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **四支共用一份**。
    //    在這裡重寫一份判斷, 四份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      // 🔵 這一支的 `firstNonEmpty` 是【兩參固定】(另三支是可變參數)⇒ 明寫 null。
      //    📌 四支看起來一樣的呼叫, 其實簽章不同 —— typecheck 抓到的, 不是我讀出來的。
      ? firstNonEmpty(row.notificationEmail, null)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    if (recipientEmail === null) {
      // 🛑🛑 **已知缺口(繼承自鏡像對象, 不是本片新造)—— codex 第二輪 must-fix,而我複驗過**:
      //    這條路**不在 outbox 留下任何痕跡** ⇒ 下一輪掃描**又會撈到同一列**
      //    ⇒ 📌 **這種列會永久佔住 `limit` 的名額** ⇒ 累積到 50 筆之後,
      //      後面真正該寄的取消信**安靜地永遠排不進來**。
      // 🔵 **而 `enqueueOrderCreatedEmails` 有一模一樣的形狀**(該檔 `noRecipient` 那一格)
      //    ⇒ 🎯 **兩條線共病** ⇒ 修它要一個「看過了但沒有收件人」的落點,那是設計改動,
      //      **不在本片射程** ⇒ 已回報主視窗開列。
      // ⚠️ **今天的量級**:B-4 之後建單當下就帶 `notification_email`
      //    ⇒ 兩個候選都空的單「理論上不該發生」(姊妹檔 `:64` 逐字)——
      //    🛑 **而「理論上不該發生」不是「不會發生」**,手動建單那條路就造得出來。
      result.noRecipient += 1;
      continue;
    }

    try {
      const enqueued = await deps.outbox.enqueue({
        eventType: 'order_cancelled',
        orderId: row.orderId,
        displayId: row.displayId,
        cancelledAt: row.cancelledAt,
        cancelledReason: row.cancelledReason,
        // 🔴 金額原樣從 view 帶下來 —— 這一層不重算(重算 = 第二個來源 ⇒ 兩份會漂)。
        refundedAmount: row.refundedAmount,
        refundKind: row.refundKind,
        recipientEmail,
        // 掃描補寄路徑無 correlation 來源(與另外兩支同形)
        requestId: null,
      });

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
