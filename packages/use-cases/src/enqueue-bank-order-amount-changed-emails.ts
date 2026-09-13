/**
 * enqueueBankOrderAmountChangedEmails —— 部分取消補寄信的排入列。
 *
 * 🔵 **鏡像 `enqueue-bank-order-created-emails.ts`**,而**差別只有三處**,三處都寫在下面:
 *    ① 掃描面不同(`pcm_bank_order_amount_changed_email_pending`)
 *    ② 多帶 `cancellationId`(它是 `dedupKey` 的前半)
 *    ③ **沒有 `cutoff`** —— 理由在 port 檔頭那一大段(對訂單的 `created_at` 下 cutoff 會安靜漏寄)
 *
 * 🔴🔴 **這封信會印公司帳號叫客人匯【一個新的數】, 而他手上已經有一封舊的了。**
 *    ⇒ 📌 本檔每一格「拿不到就不排」都不是防禦性程式碼, 是那條規則的一部分。
 *
 * 🛑 **本檔【不】判斷「還要不要匯正數」** —— 那條規則住在 view 的三條述詞裡
 *    (`balance_due` 非 NULL / > 0 / <= total)。
 *    ⇒ 在這裡再判一次 = **同一條錢的規則兩份**, 而兩份會漂。
 *
 * 🛑🛑 **今天它【沒有呼叫端】, 而那是刻意的** —— cron 接線與寄送端的模板都還沒落地:
 *    · `sweep-email-outbox.ts` 對本型別是 **fail-closed throw**(文案未經 Sean 核可)
 *    · ⚠️ **寄送前那道 `balanceDue` 三值重驗, 本型別今天也走不到**
 *      —— 它整段被 `if (job.eventType === 'bank_order_created')` 包著(`sweep-email-outbox.ts`)
 *      ⇒ 📌 接線那一片要把它對本型別打開, 而打開時它的 skip 出口**必須退休鍵**
 *        (否則同一次取消每輪重撈撞唯一鍵)。姊妹檔頭有這一句, 我鏡像時漏了(Fable F8)。
 *    · cron route 也還沒建這一支的 deps
 *    ⇒ 📌 **就算有人現在呼叫它, 排進去的列也寄不出去。**
 */
// 🔴 **本檔【不】import 'server-only'** —— 這一層是純函式(deps 由呼叫端注入),
//    而 `packages/use-cases` 的姊妹幾支一支都沒有。加了它 route 的測試會整支載不起來,
//    而那個症狀是「兩支測試檔 FAIL 而 Tests 84 passed」——
//    📌 **整支載不起來時, 它的測項一個都不算進總數**(鐵則 11 第一個數就是為了這個)。
import type { IEmailOutbox, IBankOrderAmountChangedScanner } from '@pcm/ports';
import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { EnqueueBankOrderAmountChangedEmailInput } from '@pcm/ports';
import { assertEnqueueBatchWithinCap } from './enqueue-batch-cap';

export type EnqueueBankOrderAmountChangedEmailsDeps = {
  scanner: IBankOrderAmountChangedScanner;
  outbox: IEmailOutbox;
};

export type EnqueueBankOrderAmountChangedEmailsOptions = {
  /**
   * 單輪上限。
   * 🔴 **這裡沒有 `cutoff`, 而那不是漏寫** —— 姊妹那支的 `cutoff` 擋的是「旗標翻開那一秒
   * 掃到所有歷史單」,而本型別的等價保護是 **view 裡烤死的時間地板**
   * (`oc.created_at >= pcm_bank_amount_changed_email_floor()`)。
   * 📌 **它是不變式, 不是參數** —— 沒有人可以在呼叫端把它調寬。
   * 🛑 而**不要**拿本 view 的 `created_at`(那是訂單的下單時刻)來湊一個 cutoff:
   * 那會把「很久以前下單、今天才被部分取消」的單濾掉 ⇒ **安靜漏寄**(理由全文在 port 檔頭)。
   */
  limit: number;
};

export type EnqueueBankOrderAmountChangedEmailsResult = {
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  errors: number;
};

export async function enqueueBankOrderAmountChangedEmails(
  deps: EnqueueBankOrderAmountChangedEmailsDeps,
  options: EnqueueBankOrderAmountChangedEmailsOptions,
): Promise<EnqueueBankOrderAmountChangedEmailsResult> {
  const scan = await deps.scanner.listBankOrderAmountChangedWithoutEmail({
    limit: options.limit,
  });
  const rows = scan.rows;

  const result: EnqueueBankOrderAmountChangedEmailsResult = {
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
  const inputs: EnqueueBankOrderAmountChangedEmailInput[] = [];
  /**
   * ⟦auth-MANUALORDERLIMITBURN⟧ 片 2b —— 「手動單留白 = 不寄」那一種,**要留痕**。
   * 🔴 **刻意與 `inputs` 分開兩個陣列**:這些列一封都不會寄,
   *    算進 `countNewEvents()` 的分母 ⇒ 20 筆不寄 + 1 筆正常 = 21 > 上限
   *    ⇒ use-case 在呼叫任何 enqueue 之前就 throw ⇒ **痕跡留不下、正常信也排不進去**。
   */
  const suppressedInputs: EnqueueBankOrderAmountChangedEmailInput[] = [];
  for (const row of rows) {
    // 🛑 判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **共用一份**。
    //    在這裡重寫一份判斷,幾份會各自漂,而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    // ⚠️ **而今天這一支【走不到】被抑制那一邊** —— view 已經只收 `order_source = 'web'`
    //    ⇒ 那個分支恆為 false。📌 **留著它不是保險, 是【射程若哪天放寬】時的預設方向**:
    //      放寬 view 的人不必記得回來改這裡, 而**忘了改的後果是漏寄一封, 不是誤寄一封**。
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      ? firstNonEmpty(row.notificationEmail)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    // 🔴 **判準是【兩個條件】,不是一個**:① `order_source` 是 `manual_*`
    //    ② **而且**通知信箱為空(走完 fallback 之後 `recipientEmail` 仍是 `null`)。
    // 🛑 只看①會把「手動單【有填】通知信箱」也抑制掉 —— 那是真的漏寄。
    const traceEmail =
      recipientEmail === null && suppressCustomerEmailFallback(row.orderSource)
        ? firstNonEmpty(row.customerEmail)
        : null;
    // 🔵 連借來落痕的信箱都沒有 ⇒ 那是 ⟦b4-NORECIPIENTWINDOW⟧ 那一族(兩個信箱都空),不是本片。
    const effectiveEmail = recipientEmail ?? traceEmail;
    if (effectiveEmail === null) {
      // 🔴 view 那一側已經要求「兩個信箱至少一個非空」⇒ 走到這裡通常代表**只有空白字元**
      //    (SQL 的 `btrim` 與 JS 的 `trim` 對 U+202F / U+205F 給不同答案 —— ⟦b4-JSWSNARROWER⟧)。
      //    ⇒ 計 `noRecipient`,**不計 errors** —— 它不是故障,而它要看得見。
      result.noRecipient += 1;
      continue;
    }
    const input: EnqueueBankOrderAmountChangedEmailInput = {
      eventType: 'bank_order_amount_changed',
      orderId: row.orderId,
      displayId: row.displayId,
      // 🔴🔴 **原樣帶, 不做任何轉換(不 trim、不小寫化)** —— 它與 `orderId` 一起組成 `dedupKey`,
      //    而**SQL 那一側的 `pcm_bank_amount_changed_email_dedup_key(uuid, uuid)` 拿到的是
      //    uuid 的正規字面**。這裡動一個字元,兩份就算出不同的鍵
      //    ⇒ 📌 anti-join 永遠對不上 ⇒ **每輪重排撞唯一鍵**, 而三綠不會紅。
      cancellationId: row.cancellationId,
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

  // ── ⟦auth-MANUALORDERLIMITBURN⟧:先把「刻意不寄」的痕跡落下去 ──────────────
  // 🔴 **排在 cap 閘【之前】是承重的** —— 那道閘會 `throw`,而 throw 在寫痕跡之前
  //    正是那一片要修的病(下一輪再撈到同一張單,永遠)。
  // 🔵 而它們不影響那道閘的分母:它們從來沒進 `inputs`。
  for (const input of suppressedInputs) {
    try {
      await deps.outbox.enqueueManualNoRecipient(input);
    } catch {
      // 🛑 與寄信路徑同款:一筆壞掉不倒整批。它已經計進 `noRecipient`,這裡只計故障。
      result.errors += 1;
    }
  }

  // 🛑 **分母不是 `rows.length`** —— 掃描面會放回「我們自己 skip 過」而 `enqueue()` 會回
  //    `duplicate` 的舊列(⟦mail-SKIPKEYNORETIRE⟧)⇒ 拿掃描列數當分母,20 筆撞鍵的舊列
  //    會把 1 封真的該寄的信一起擋掉 ⇒ 📌 **防止多寄的閘變成永久少寄。**
  // 🔵 `countNewEvents` 的鍵走 `enqueue()` 用的同一支組裝 ⇒ 兩邊不會漂。
  assertEnqueueBatchWithinCap(
    'bank_order_amount_changed',
    await deps.outbox.countNewEvents(inputs),
    {
      // 🔵 撞閘就 throw ⇒ 呼叫端拿不到 result ⇒ 這兩個數只剩錯誤物件裡有。
      //    少了它們,那一輪的 log 上「沒有讀數」與「讀數是 0」長得一樣。
      scanned: result.scanned,
      noRecipient: result.noRecipient,
    },
  );

  // ── 第三段:排 ────────────────────────────────────────────────────────
  for (const input of inputs) {
    try {
      // 🔴 **合成域不在這裡判**:那道閘在 adapter 內(單一常數來源),判了之後會落一列
      //    `skipped_no_real_email` ⇒ 查得到痕跡。
      //    ⚠️ **而那一列會讓 anti-join 從此擋住這一次取消** —— LINE 登入而沒填通知信箱的客人,
      //      之後補上真信箱也不會再排進來。🛑 那不是本片造成的,而本片會多一族列踩它。
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
