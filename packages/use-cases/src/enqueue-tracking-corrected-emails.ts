import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { IEmailOutbox, ITrackingCorrectedScanner } from '@pcm/ports';
import type { EnqueueShipmentTrackingCorrectedEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

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

  // ── 第一段:先把「要排的」全部建好(純函式, 一次 DB 都不打)────────────
  // 🔴 ⟦b4-EMAILTRIAGE⟧ 甲-3:閘的分母必須是「**會變成新的一列**的數量」,
  //    而那要問過 outbox 才知道 ⇒ 所以要先有 inputs, 才問得出來。
  const inputs: EnqueueShipmentTrackingCorrectedEmailInput[] = [];
  /**
   * ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— 「手動單留白 = 不寄」那一種,**要留痕**。
   * 🔴 **刻意與 `inputs` 分開兩個陣列**:這些列一封都不會寄,
   *    算進 `countNewEvents()` 的分母 ⇒ 20 筆不寄 + 1 筆正常 = 21 > 上限
   *    ⇒ use-case 在呼叫任何 enqueue 之前就 throw ⇒ **痕跡留不下、正常信也排不進去**
   *    ⇒ 📌 **本片要修的病, 換一個地方發作**(codex 2026-09-10 R1 should-fix ②)。
   */
  const suppressedInputs: EnqueueShipmentTrackingCorrectedEmailInput[] = [];
  for (const row of rows) {
    // 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;板列 ⟦f3-MAILFALLBACKVSRULING⟧)。
    //    判準是【兩個條件】—— `manual_*` **而且** `notification_email` 為空,
    //    而後者是 `firstNonEmpty` 回 null 那一格。**兩個條件都在這一行裡。**
    // 🛑 判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **七支共用一份**。
    //    在這裡重寫一份判斷, 七份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      ? firstNonEmpty(row.notificationEmail)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    // 🔴 **判準是【兩個條件】,不是一個**(`notification-fallback.ts` 檔頭逐字)——
    //    ① `order_source` 是 `manual_*`(那支 domain 函式判的)
    //    ② **而且**通知信箱為空 = 走完 fallback 之後 `recipientEmail` 仍是 `null`(就是這一格)
    // 🛑 **只看①會把「手動單【有填】通知信箱」也抑制掉 —— 那是真的漏寄**,
    //    而本片修的正是「該有的東西沒有」⇒ **用錯判準會做出另一種同型的病。**
    const traceEmail =
      recipientEmail === null && suppressCustomerEmailFallback(row.orderSource)
        ? firstNonEmpty(row.customerEmail)
        : null;
    // 🔵 連借來落痕的信箱都沒有 ⇒ 那是 `⟦b4-NORECIPIENTWINDOW⟧` 那一族(兩個信箱都空), 不是本片。
    const effectiveEmail = recipientEmail ?? traceEmail;
    if (effectiveEmail === null) {
      result.noRecipient += 1;
      continue;
    }
    const input: EnqueueShipmentTrackingCorrectedEmailInput = {
        eventType: 'shipment_tracking_corrected',
        orderId: row.orderId,
        displayId: row.displayId,
        shipmentId: row.shipmentId,
        shipmentReference: row.shipmentReference,
        trackingNumber: row.trackingNumber,
        trackingCorrectedKey: row.trackingCorrectedKey,
        recipientEmail: effectiveEmail,
        requestId: null, // 掃描補寄路徑無 correlation 來源
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

  assertEnqueueBatchWithinCap('shipment_tracking_corrected', await deps.outbox.countNewEvents(inputs), {
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
