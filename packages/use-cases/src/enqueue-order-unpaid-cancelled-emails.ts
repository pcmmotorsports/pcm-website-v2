import { suppressCustomerEmailFallback } from '@pcm/domain';
import type {
  IEmailOutbox,
  IUnpaidCancelledOrderScanner,
} from '@pcm/ports';
import type { EnqueueOrderUnpaidCancelledEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

/**
 * enqueueOrderUnpaidCancelledEmails —— 把「未付款被【員工】取消、而還沒排過信」的單排進 outbox。
 *
 * **鏡像 `enqueueOrderCreatedEmails`,刻意逐格對齊** —— 失敗模式、計數欄、PII 紀律都已知。
 *
 * 🔴 **Sean 2026-09-03 拍甲**,理由逐字:「**那是客人唯一一封信**」——
 *    這條線的客人**從頭到尾沒有付過錢**,所以在被取消之前一封信都沒收過。
 *
 * 🛑 **射程:不含逾時自動取消**(那是題 2,他**未拍板**)。
 *    判準與那個字面的來源座標寫在 `IUnpaidCancelledOrderScanner` 檔頭 —— **不在這裡重寫一份**。
 *
 * 🔴 **PII**:`notificationEmail` / `customerEmail` **只從 scanner 直接交給 `outbox.enqueue`**,
 *    **不進 `result`、不進 log、不進錯誤訊息**(result 只有數字)。
 */
export type EnqueueOrderUnpaidCancelledEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: IUnpaidCancelledOrderScanner;
};

export type EnqueueOrderUnpaidCancelledEmailsOptions = {
  cutoff: string;
  limit: number;
};

export type EnqueueOrderUnpaidCancelledEmailsResult = {
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

export async function enqueueOrderUnpaidCancelledEmails(
  deps: EnqueueOrderUnpaidCancelledEmailsDeps,
  options: EnqueueOrderUnpaidCancelledEmailsOptions,
): Promise<EnqueueOrderUnpaidCancelledEmailsResult> {
  const scan = await deps.scanner.listUnpaidCancelledWithoutEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;


  const result: EnqueueOrderUnpaidCancelledEmailsResult = {
    scanned: rows.length,
    scannedPages: scan.scannedPages,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    errors: 0,
  };

  // ── 第一段:先把「要排的」全部建好(純函式, 一次 DB 都不打)────────────
  // 🔴 ⟦b4-EMAILTRIAGE⟧ 甲-3:閘的分母必須是「**會變成新的一列**的數量」,
  //    而那要問過 outbox 才知道 ⇒ 所以要先有 inputs, 才問得出來。
  const inputs: EnqueueOrderUnpaidCancelledEmailInput[] = [];
  /**
   * ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— 「手動單留白 = 不寄」那一種,**要留痕**。
   * 🔴 **刻意與 `inputs` 分開兩個陣列**:這些列一封都不會寄,
   *    算進 `countNewEvents()` 的分母 ⇒ 20 筆不寄 + 1 筆正常 = 21 > 上限
   *    ⇒ use-case 在呼叫任何 enqueue 之前就 throw ⇒ **痕跡留不下、正常信也排不進去**
   *    ⇒ 📌 **本片要修的病, 換一個地方發作**(codex 2026-09-10 R1 should-fix ②)。
   */
  const suppressedInputs: EnqueueOrderUnpaidCancelledEmailInput[] = [];
  for (const row of rows) {
    // 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;板列 ⟦f3-MAILFALLBACKVSRULING⟧)。
    //    判準是【兩個條件】—— `manual_*` **而且** `notification_email` 為空,
    //    而後者是 `firstNonEmpty` 回 null 那一格。**兩個條件都在這一行裡。**
    // 🛑 判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **七支共用一份**。
    //    在這裡重寫一份判斷, 七份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      // 🔵 這一支的 `firstNonEmpty` 是【兩參固定】(另三支是可變參數)⇒ 明寫 null。
      //    📌 四支看起來一樣的呼叫, 其實簽章不同 —— typecheck 抓到的, 不是我讀出來的。
      ? firstNonEmpty(row.notificationEmail, null)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    // 🔴 **判準是【兩個條件】,不是一個**(`notification-fallback.ts` 檔頭逐字)——
    //    ① `order_source` 是 `manual_*`(那支 domain 函式判的)
    //    ② **而且**通知信箱為空 = 走完 fallback 之後 `recipientEmail` 仍是 `null`(就是這一格)
    // 🛑 **只看①會把「手動單【有填】通知信箱」也抑制掉 —— 那是真的漏寄**,
    //    而本片修的正是「該有的東西沒有」⇒ **用錯判準會做出另一種同型的病。**
    const traceEmail =
      recipientEmail === null && suppressCustomerEmailFallback(row.orderSource)
        ? firstNonEmpty(row.customerEmail, null)
        : null;
    // 🔵 連借來落痕的信箱都沒有 ⇒ 那是 `⟦b4-NORECIPIENTWINDOW⟧` 那一族(兩個信箱都空), 不是本片。
    const effectiveEmail = recipientEmail ?? traceEmail;
    if (effectiveEmail === null) {
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
    const input: EnqueueOrderUnpaidCancelledEmailInput = {
        eventType: 'order_unpaid_cancelled',
        orderId: row.orderId,
        displayId: row.displayId,
        cancelledAt: row.cancelledAt,
        cancelledReason: row.cancelledReason,
        recipientEmail: effectiveEmail,
        // 掃描補寄路徑無 correlation 來源(與另外兩支同形)
        requestId: null,
    };
    if (recipientEmail === null) {
      // ⟦auth-MANUALORDERLIMITBURN⟧:看過了、刻意不寄 ⇒ **落一列終態**,而**不進 `inputs`**。
      suppressedInputs.push(input);
      result.noRecipient += 1;
      continue;
    }
    inputs.push(input);
  }

  // ── 第二段:問一次「這批裡有幾個是真的新的」+ 閘 ──────────────────────
  // 🛑 **不是 `rows.length`** —— 掃描面會放回「我們自己 skip 過」而 `enqueue()` 會回
  //    `duplicate` 的舊列(⟦mail-SKIPKEYNORETIRE⟧)⇒ 拿掃描列數當分母, 20 張撞鍵的舊單
  //    會把 1 封真的該寄的信一起擋掉 ⇒ 📌 **防止多寄的閘變成永久少寄**
  //    (codex `gpt-6-astra` 2026-09-07 12⑤ must-fix)。
  // 🔵 `countNewEvents` 的鍵走 `enqueue()` 用的同一支組裝 ⇒ 兩邊不會漂。
  // ── ⟦auth-MANUALORDERLIMITBURN⟧:先把「刻意不寄」的痕跡落下去 ──────────────
  // 🔴 **排在 cap 閘【之前】是承重的** —— 那道閘會 `throw`,而 throw 在寫痕跡之前
  //    正是本片要修的病(下一輪再撈到同一張單, 永遠)。
  // 🔵 而它們不影響那道閘的分母:它們從來沒進 `inputs`。
  for (const input of suppressedInputs) {
    try {
      await deps.outbox.enqueueManualNoRecipient(input);
    } catch {
      // 🛑 與寄信路徑同款:一筆壞掉不倒整批。它已經計進 `noRecipient`,這裡只計故障。
      result.errors += 1;
    }
  }

  assertEnqueueBatchWithinCap('order_unpaid_cancelled', await deps.outbox.countNewEvents(inputs), {
    // 🔵 撞閘就 throw ⇒ 呼叫端拿不到 result ⇒ 這兩個數只剩錯誤物件裡有。
    //    少了它們, 那一輪的 log 上「沒有讀數」與「讀數是 0」長得一樣。
    scanned: result.scanned,
    noRecipient: result.noRecipient,
  });

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
