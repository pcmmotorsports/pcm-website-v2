import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { IEmailOutbox, IPaidOrderScanner } from '@pcm/ports';
import type { EnqueueOrderCreatedEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

/**
 * enqueueOrderCreatedEmails:把「已付款但還沒排過 `order_created`」的單排進 outbox(M-4a B-5、甲案)。
 *
 * 掛在既有 `api/cron/email-sweep` route 的最前面、`sweepEmailOutbox` **之前**。
 * 🔴 **本片一封信都不會寄** —— 它只把信排進 outbox。寄是 sweeper 的事,而 sweeper 由 pg_cron 控制,
 *    那個 job 今天不存在(plan §7-1)。**這是 PRD §6 gate #1 的原文狀態,不是缺陷。**
 *
 * 🔴 **為什麼不掛在付款當下**(PRD §3.2 字面是「掛兩個匯聚點」,Sean `Q-G4-1`=甲改成掃描):
 *   乙案要把 `service_role` 注進結帳脊椎,而 `settleCharge` 那半走 `payment_confirmer`、
 *   **零 table 權限且由 apply 期斷言強制** ⇒ 沒有便宜的解;且首次 enqueue 失敗零救濟
 *   (`settle-charge.ts` 第二個 `kind:'paid'` 短路 ⇒ 之後每次重入都不會再 enqueue)。
 *   掃描式天然可重入:**這一輪漏掉的,下一輪自己再撈到**(差集是即時算的)。
 *   🔴 **這句話有限定,不是全稱**(codex 關卡2 R2 抓到):它成立的前提是
 *   **「cutoff 之後已排過信的單」還沒多到填滿單輪掃描上限**(= `MAX_PAGES × PAGE_SIZE` = 5,000 筆)。
 *   超過那個數之後,後面的單**永遠讀不到**,而 route 回 200、counts 全 0。
 *   天花板的算式、為什麼本片不修、三條解法,見 plan **§4.3**。**引用這句話請連 §4.3 一起引。**
 *   ⇒ 代價是「信晚一輪(≤5 分)」與一條要申報的 PRD 偏離。
 *
 * 失敗語意(plan §5):
 * - 單筆失敗 ⇒ `errors` +1、**不中斷整輪**;下一輪會再撈到它。
 * - 整輪有失敗 ⇒ 由 route 回 503 + counts(鏡像既有 email-sweep:壞掉的 sweeper 不可吞成 200)。
 * - 🔴 **本片不在付款路徑上** ⇒ 這裡的任何例外都影響不到任何一筆錢。
 * - 🔴 PRD 明文禁用 `fail-closed` 這個詞描述本片(那是相反語意)。
 *
 * PII(PRD §7):result **只有數字**;兩個 email 欄只從 scanner 直接交給 `outbox.enqueue`,
 * 絕不進 log / result / 錯誤訊息。
 *
 * @see docs/specs/2026-08-18-m4a-b5-enqueue-scan-plan.md
 * @see docs/specs/2026-07-18-b0-order-notification-email-prd.md §3.2 / §5 R3 / §7
 */
export type EnqueueOrderCreatedEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: IPaidOrderScanner;
};

/**
 * 參數由 route 顯式注入(鏡像 `sweepEmailOutbox` 慣例、不設預設值)。
 * - `cutoff`:🔴 = **B-4 那一片部署上線的時戳**(Sean 2026-08-18 `Q-G4-5`=甲)。
 *   ~~「flag 實際開啟時戳」~~ 已被推翻:`Q-02` 之下那個開啟事件不會發生,而 B-4 §4.1
 *   已把持久化拿出 flag 之外。**本 use-case 只讀傳進來的值、不代填。**
 * - `limit`:單輪上限(route 端常數、零 client 輸入)。
 */
export type EnqueueOrderCreatedEmailsOptions = {
  cutoff: string;
  limit: number;
};

/** counts-only(零 PII)。五個桶互斥、加總 = `scanned`。 */
export type EnqueueOrderCreatedEmailsResult = {
  scanned: number;
  /** scanner 實際翻了幾頁。 */
  scannedPages: number;
  /**
   * 🔴 true = **這一輪沒有掃完**(收滿 limit 或撞頁數上限)⇒ **後面還有,下一輪會繼續**。
   * 沒有這一欄的話,「剛好只有 3 筆待排」與「還有 3000 筆沒掃到」在回應上長得一模一樣。
   */
  truncated: boolean;
  enqueued: number;
  /** 合成假信箱 ⇒ adapter 落一列 `skipped_no_real_email`(**有痕跡**,不是靜默跳過)。 */
  skippedNoRealEmail: number;
  duplicate: number;
  /** 兩個候選都沒有值 ⇒ 不 enqueue。B-4 之後理論上不該發生(手動建單那條路除外)。 */
  noRecipient: number;
  errors: number;
};

export async function enqueueOrderCreatedEmails(
  deps: EnqueueOrderCreatedEmailsDeps,
  options: EnqueueOrderCreatedEmailsOptions,
): Promise<EnqueueOrderCreatedEmailsResult> {
  const scan = await deps.scanner.listPaidWithoutOrderCreatedEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;


  const result: EnqueueOrderCreatedEmailsResult = {
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
  const inputs: EnqueueOrderCreatedEmailInput[] = [];
  /**
   * ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— 「手動單留白 = 不寄」那一種,**要留痕**。
   * 🔴 **刻意與 `inputs` 分開兩個陣列**:這些列一封都不會寄,
   *    算進 `countNewEvents()` 的分母 ⇒ 20 筆不寄 + 1 筆正常 = 21 > 上限
   *    ⇒ use-case 在呼叫任何 enqueue 之前就 throw ⇒ **痕跡留不下、正常信也排不進去**
   *    ⇒ 📌 **本片要修的病, 換一個地方發作**(codex 2026-09-10 R1 should-fix ②)。
   */
  const suppressedInputs: EnqueueOrderCreatedEmailInput[] = [];
  for (const row of rows) {
    // PRD §3.2:訂單欄 NULL → 取 customers.email。
    // 🔴 空字串也要當成沒有:`enqueue` 對空 recipient 會 throw,而那會被下面吞成 errors ——
    //    一個「本來就沒有信箱」的單不該長期佔著 errors 計數,它是 noRecipient。
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
    const input: EnqueueOrderCreatedEmailInput = {
        eventType: 'order_created',
        orderId: row.orderId,
        displayId: row.displayId,
        paidAt: row.paidAt,
        recipientEmail: effectiveEmail,
        requestId: null, // 掃描補寄路徑無 correlation 來源(port 檔頭明文)
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

  assertEnqueueBatchWithinCap('order_created', await deps.outbox.countNewEvents(inputs), {
    // 🔵 撞閘就 throw ⇒ 呼叫端拿不到 result ⇒ 這兩個數只剩錯誤物件裡有。
    //    少了它們, 那一輪的 log 上「沒有讀數」與「讀數是 0」長得一樣。
    scanned: result.scanned,
    noRecipient: result.noRecipient,
  });

  // ── 第三段:排 ────────────────────────────────────────────────────────
  for (const input of inputs) {
    try {
      // 🔴 **合成域不在這裡判**:那道閘在 adapter 內(單一常數來源),judged 之後會落一列
      //    `skipped_no_real_email` ⇒ 查得到痕跡。本層若自己先判一次,就長出第二套 LINE 判準。
      const enqueued = await deps.outbox.enqueue(input);

      if (enqueued.kind === 'enqueued') {
        result.enqueued += 1;
      } else if (enqueued.kind === 'skipped_no_real_email') {
        result.skippedNoRealEmail += 1;
      } else {
        result.duplicate += 1;
      }
    } catch {
      // 🔴 零 PII:連錯誤物件都不留(它可能帶著 recipient)。下一輪會再撈到這一筆。
      result.errors += 1;
    }
  }

  return result;
}

/** 回第一個「trim 後非空」的候選;全沒有回 null。**不做任何 email 格式判斷**(那是 adapter 的閘)。 */
function firstNonEmpty(...candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate;
    }
  }
  return null;
}
