import type { EmailOutboxEventType } from './IEmailOutbox';
/**
 * IIneligibleOrderEmailScanner — 「due 但訂單已不合格」的窄查詢 port(M-4a E2a-2、W3-G 拆出)。
 *
 * 對應 plan `docs/specs/2026-07-16-m4a-email-notify-plan.md:329/362` 的「寄送時 gate」:
 * outbox 掃描器(`SupabasePaidOrderScannerAdapter`)只擋「掃描當下已取消」的單;排進佇列之後、
 * 真正寄出之前才被取消的單,這條擋不住 —— 那個窗口由本 port + `applyOrderIneligibleGate`
 * use-case 擋,跑在 `sweepEmailOutbox` 之前(獨立 cron route,不掛進 email-sweep)。
 *
 * 🔴 **述詞照 plan 拍板原文,不自己判**(:362):`payment_status='refunded' OR
 * cancelled_at IS NOT NULL`。**不含 `partiallyRefunded`**。
 *
 * 🔴 **唯讀、不 claim**:回傳的是「候選」,由呼叫端(use-case)對每一筆各自
 * `outbox.claimById` + `outbox.markSkippedOrderIneligible`(CAS,安全處理race —— candidate 在
 * 讀出來之後、claim 之前被 sweeper 搶先送出/其他人搶先認領都算正常,不是本 port 的責任)。
 *
 * @see docs/specs/2026-07-16-m4a-email-notify-plan.md §4.1(:329)/ E2a-2 表列(:362)
 * @see packages/ports/src/IEmailOutbox.ts markSkippedOrderIneligible
 */
export type DueIneligibleEmailJob = {
  id: string;
  orderId: string;
  /**
   * 🔴 **這一欄是 2026-09-03 加的,而它是【修一個安靜缺陷】必要的一半**(Q10 前置;R1 C2):
   * 這條路(獨立 cron)**比寄送那條更早**把列標成 `skipped_order_ineligible`,
   * 而它原本**看不到 event_type** ⇒ 只修寄送那條 = 修了一半,
   * 而**取消信仍然會被這條路撈走**、標成終態、**而沒有自動告警在看**(逐單查得到, 要有人去查)。
   * ⇒ 📌 **兩條路都要問 `SUPPRESS_WHEN_ORDER_INELIGIBLE`,少一條就等於沒修。**
   */
  eventType: EmailOutboxEventType;
};

export interface IIneligibleOrderEmailScanner {
  /**
   * 讀 due(status IN pending/failed 且到期、attempts < max_attempts)outbox 列裡,
   * 對應訂單現在已不合格的那些。
   * ⛔ ~~**不分 event_type**:任何一種通知信,訂單已退款/取消時~~
   * 🔴🔴 **2026-09-03 訂正 —— 那句話今天為假,而照它做會把缺陷重新引進來**
   *    (codex must-fix 4):**取消信不走這道閘** —— 擋它 = 擋掉我們唯一要說的那句話。
   *    ✅ 判準的單一來源 = `SUPPRESS_WHEN_ORDER_INELIGIBLE`(`IEmailOutbox.ts`,窮舉 `Record`)。
   *    🛑 **實作者注意:那道 filter 要落在 `.slice(limit)` 【之前】** —— 落在之後會讓取消信
   *      吃掉名額再被丟掉 ⇒ **既有兩封信被餓死,而 `scanned: 0` 讀起來像沒事。**
   *    ⚠️ 舊字面留著劃掉:照它做的人要在同一發撞到這一段。
   *
   * 舊句其餘部分(仍成立):任何一種**講「這張單還會發生什麼」**的通知信,訂單已退款/取消時
   * 都不該再寄,故本查詢橫跨 `order_created` 與 `order_shipped`。
   *
   * limit = 單輪掃描上限(route 端常數、零 client 輸入)。
   */
  listDueIneligible(limit: number): Promise<DueIneligibleEmailJob[]>;

  /**
   * 給【已經認領走】的那批 outbox 列用:這些 orderId 裡,現在哪些已不合格?
   *
   * 🔴 **為什麼不能用 `listDueIneligible`**:那支的分母是 `status IN (pending, failed)` 的
   *    **due** 列。而 sweeper 一旦 `claimDue`,那些列就變成 `sending` ⇒ **掉出 due 的分母**
   *    ⇒ 拿它去問「我手上這批合不合格」會恆回空,而那個空與「全部都合格」長得一樣。
   *
   * 🔴 **為什麼放在同一支 port**(Sean 2026-08-30 拍「甲 搬」):述詞
   *    `payment_status='refunded' OR cancelled_at IS NOT NULL` 只准有**一份**。
   *    開第二支 port = 開第二份述詞,而兩份述詞會分岔,分岔時沒有任何一格會紅。
   *    (同族實錘:同一天量到 `admin_cancel_order` 的七值映射表在函式裡有兩份。)
   *
   * 🔴 **唯讀、不 claim、不寫**:回傳「這些之中不合格的 id」。空陣列進 ⇒ 空陣列出
   *    (不打 DB)。呼叫端拿它決定「跳過不寄」,而跳過的標記仍走
   *    `outbox.markSkippedOrderIneligible`(CAS 世代柵欄)。
   *
   * ⚠️ **它把窗口關到【同一個 process 內】,不是關到零**:讀合格性與 `sender.send`
   *    之間仍有毫秒級的間隔,一張在那之間才被取消的單仍會收到信。
   *    ⇒ 這是**真正的下界**(除非把取消與寄信放進同一個交易,而寄信在交易外)。
   *    ⇒ 不得宣稱「這個洞補起來了」,只能說「從兩支排程的分鐘級縮到同 process 的毫秒級」。
   */
  listIneligibleAmong(orderIds: readonly string[]): Promise<string[]>;
}
