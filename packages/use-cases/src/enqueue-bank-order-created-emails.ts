/**
 * enqueueBankOrderCreatedEmails —— ⟦b4-BANKNOEMAIL⟧ 匯款單成立信的排入列。
 *
 * 🔵 **鏡像 `enqueue-order-created-emails.ts`**, 而**差別只有兩處**, 兩處都寫在下面:
 *    ① 多帶三個快照欄(`createdAt` / `total` / `balanceDue`)
 *    ② 掃描面不同(`pcm_bank_order_created_email_pending`)
 *
 * 🔴🔴 **這封信會印公司帳號叫客人匯錢 ⇒ 它是這一族裡後果最重的一封。**
 *    ⇒ 📌 本檔每一格「拿不到就不排」都不是防禦性程式碼, 是那條規則的一部分。
 *
 * 🛑 **本檔【不】判斷「還要不要匯正數」** —— 那條規則住在 view 的三條述詞裡
 *    (`balance_due` 非 NULL / > 0 / <= total)。
 *    ⇒ 在這裡再判一次 = **同一條錢的規則兩份**, 而兩份會漂。
 *    ⇒ 而**寄送當下**還有一道重驗(claim 之後、send 之前), 那一道管的是「快照過期了沒」,
 *      與這裡是**兩個不同的問題**, 不是重複。
 */
// 🔴 **本檔【不】import 'server-only'** —— 這一層是純函式(deps 由呼叫端注入),
//    而 `packages/use-cases` 的姊妹五支**一支都沒有**(當場數過:全目錄 1 支, 而那支不是這一族)。
//    ⛔ 我第一版加了它 ⇒ route 的測試**整支載不起來**(`Cannot find package 'server-only'`)
//    ⇒ 🛑 而那個症狀是「**兩支測試檔 FAIL 而 Tests 84 passed**」——
//      📌 **整支載不起來時, 它的測項【一個都不算進總數】** ⇒ 只看 `Tests` 那一行會以為全綠。
//      (鐵則 11 第一個數就是為了這個:看 `Test Files` 那一行。)
//    ✅ server-only 的邊界由 adapter 與 composition 那兩層守, 不在這一層。
import type { IEmailOutbox, IBankOrderCreatedScanner } from '@pcm/ports';
import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { EnqueueBankOrderCreatedEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

export type EnqueueBankOrderCreatedEmailsDeps = {
  scanner: IBankOrderCreatedScanner;
  outbox: IEmailOutbox;
};

export type EnqueueBankOrderCreatedEmailsOptions = {
  /**
   * 🔴 **這是 cutoff, 不是開關**(R3-MF6)。布林 flag 翻 true 的那一秒會掃到
   *    **所有歷史未付款匯款單** ⇒ 一次寄出一疊, 而信收不回來。
   */
  cutoff: string;
  limit: number;
};

export type EnqueueBankOrderCreatedEmailsResult = {
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  errors: number;
};

export async function enqueueBankOrderCreatedEmails(
  deps: EnqueueBankOrderCreatedEmailsDeps,
  options: EnqueueBankOrderCreatedEmailsOptions,
): Promise<EnqueueBankOrderCreatedEmailsResult> {
  const scan = await deps.scanner.listBankOrderCreatedWithoutEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;


  const result: EnqueueBankOrderCreatedEmailsResult = {
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
  const inputs: EnqueueBankOrderCreatedEmailInput[] = [];
  /**
   * ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— 「手動單留白 = 不寄」那一種,**要留痕**。
   * 🔴 **刻意與 `inputs` 分開兩個陣列**:這些列一封都不會寄,
   *    算進 `countNewEvents()` 的分母 ⇒ 20 筆不寄 + 1 筆正常 = 21 > 上限
   *    ⇒ use-case 在呼叫任何 enqueue 之前就 throw ⇒ **痕跡留不下、正常信也排不進去**
   *    ⇒ 📌 **本片要修的病, 換一個地方發作**(codex 2026-09-10 R1 should-fix ②)。
   */
  const suppressedInputs: EnqueueBankOrderCreatedEmailInput[] = [];
  for (const row of rows) {
    // 🛑 判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **七支共用一份**。
    //    在這裡重寫一份判斷, 七份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    // ⚠️ **而今天這一支【走不到】被抑制那一邊** —— view 已經只收 `order_source = 'web'`
    //    ⇒ 那個分支恆為 false。📌 **留著它不是保險, 是【射程若哪天放寬】時的預設方向**:
    //      放寬 view 的人不必記得回來改這裡, 而**忘了改的後果是漏寄一封, 不是誤寄一封**。
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
      // 🔴 view 那一側已經要求「兩個信箱至少一個非空」⇒ 走到這裡通常代表**只有空白字元**
      //    (SQL 的 `btrim` 與 JS 的 `trim` 對 U+202F / U+205F 給不同答案 —— `⟦b4-JSWSNARROWER⟧`)。
      //    ⇒ 計 `noRecipient`, **不計 errors** —— 它不是故障, 而它要看得見。
      result.noRecipient += 1;
      continue;
    }
    const input: EnqueueBankOrderCreatedEmailInput = {
        eventType: 'bank_order_created',
        orderId: row.orderId,
        displayId: row.displayId,
        createdAt: row.createdAt,
        total: row.total,
        balanceDue: row.balanceDue,
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

  assertEnqueueBatchWithinCap('bank_order_created', await deps.outbox.countNewEvents(inputs), {
    // 🔵 撞閘就 throw ⇒ 呼叫端拿不到 result ⇒ 這兩個數只剩錯誤物件裡有。
    //    少了它們, 那一輪的 log 上「沒有讀數」與「讀數是 0」長得一樣。
    scanned: result.scanned,
    noRecipient: result.noRecipient,
  });

  // ── 第三段:排 ────────────────────────────────────────────────────────
  for (const input of inputs) {
    try {
      // 🔴 **合成域不在這裡判**:那道閘在 adapter 內(單一常數來源), 判了之後會落一列
      //    `skipped_no_real_email` ⇒ 查得到痕跡。
      //    ⚠️ **而那一列會讓 anti-join 從此擋住這張單**(R1-⑨ / R3-MF5)——
      //      LINE 登入而沒填通知信箱的客人, 之後補上真信箱也不會再排進來。
      //      🛑 **那不是本片造成的, 而本片會多一族列踩它** ⇒ 已在 plan §8 留著。
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
