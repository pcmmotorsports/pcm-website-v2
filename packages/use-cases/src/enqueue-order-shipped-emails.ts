import { suppressCustomerEmailFallback } from '@pcm/domain';
import type { IEmailOutbox, IShippedOrderScanner } from '@pcm/ports';

/**
 * enqueueOrderShippedEmails:把「已出貨但還沒排過 `order_shipped`」的 (箱, 單) 配對排進 outbox
 * (M-4b E4-a)。**鏡像 `enqueueOrderCreatedEmails`,刻意逐格對齊。**
 *
 * 🔴 **本 use-case 一封信都不會寄。** 它只把信排進 outbox;寄是 sweeper 的事,
 *    而 sweeper 對 `order_shipped` 目前仍然 **fail-closed**
 *    (`sweep-email-outbox.ts` 的 `buildEmailText` 對這個事件 throw)⇒ **片3 才會拆掉那道。**
 *    ⚠️ 所以**片1 不把本 use-case 掛上 cron route** —— 掛上去的話,列會排進佇列、
 *    每 5 分鐘被認領一次、每次 throw、燒掉 attempts 進死信,**然後每天發告警**。
 *    **模板與掛 route 必須是同一片。**
 *
 * 🔴 **為什麼掃描,不掛在出貨那個動作上**:`20260717020000_m4a_email_outbox.sql:114` 逐字
 *    「E4 定義『一批』後,`order_shipped` **亦須有對等訊號**(否則同一個洞在出貨線重演)」。
 *    掛在動作上 ⇒ 員工按完出貨、enqueue 炸掉 ⇒ **那封信永遠沒有人想起來,零訊號**。
 *
 * 🔴 **一箱兩單 = 兩列 = 兩封信**(Sean 2026-08-17 逐字「一箱兩單就兩封,一封講一張訂單」;
 *    `~/pcm-mailbox/C-219-STOP-20260817.md:181`)。那個拍板**收窄**了更早的
 *    `S2=B`「每出一批寄一封」—— 舊字面還留在四份 spec 與 `20260717020000` 的註解裡,不刪。
 *    ⚠️ **2026-08-22 唯讀量測:裝了超過一張單的箱 = 0** ⇒ 這條路**沒有任何真實流量會走到**
 *    ⇒ 守住它的唯一量具是突變測試(dedup_key 改成只用 order_id ⇒ 兩單那格必須紅)。
 *
 * 失敗語意(鏡像兄弟檔):
 * - 單筆失敗 ⇒ `errors` +1、**不中斷整輪**;下一輪會再撈到它(差集是即時算的)。
 *   ⚠️ **而「下一輪會再撈到它」對【永久性】失敗是一句壞消息**(codex 2026-08-22 R1):
 *   掃描固定取最舊的 limit 筆 ⇒ 一筆**每次都失敗**的列會一直坐在最前面,
 *   累積到 limit 筆就**擋住後面所有有效的信**,而 route 每輪回 503、counts 看起來像「有在做事」。
 *   ⇒ 已知的**永久性**失敗只有一種(兩個信箱都空),它已在 view 層移走。
 *   ⇒ 🔴 **其餘失敗都假設是暫時的,而那個假設沒有東西在守。** `errors` 連續多輪不歸零 = 要有人看。
 *   📌 片3 若依 `truncated` 做迴圈,要先解掉這一格,否則會**反覆掃同一頁**。
 * - 整輪有失敗 ⇒ 由 route 回 503 + counts(壞掉的掃描不可吞成 200)。
 * - 🔴 **本片不在付款路徑上,也不在出貨路徑上** ⇒ 這裡的任何例外影響不到任何一筆錢、
 *   也擋不住任何一次出貨。
 *
 * PII:result **只有數字**;兩個 email 欄只從 scanner 直接交給 `outbox.enqueue`,
 * 絕不進 log / result / 錯誤訊息。
 */
export type EnqueueOrderShippedEmailsDeps = {
  outbox: IEmailOutbox;
  scanner: IShippedOrderScanner;
};

/**
 * 參數由 route 顯式注入(鏡像兄弟檔慣例、**不設預設值**)。
 * - `cutoff`:🔴 **起始線 = 這一片上線的時戳**,由 route 讀 env `SHIPPED_EMAIL_CUTOFF` 給。
 *   本 use-case **只讀傳進來的值、不代填** —— 代填的那一刻它就變成一個會過期的字面。
 *   ⚠️ 少了它 = 把歷史上每一箱都排進去(2026-08-22 量到 2 箱、最舊出貨於 08-12)。
 *
 *   🔴🔴 **Sean 2026-08-30 04:2x 已拍板(逐字):「今天開始後才寄」= 甲。**
 *   出處錨(不寫行號,板子會漂):`~/pcm-mailbox/等Sean決策-20260829.md` 搜
 *   `Q-出貨信起點`,他答的是那一批的第 3 題(批次錨 `2026-08-30 04:2x · Sean 一口氣回十一題`)。
 *   ⇒ **這個 env 一定要設,而它就是那一板本身** —— 不是「上線那天再說」的細節。
 *
 *   ✅ **而「今天」是哪一刻,不必再問他 —— 他選的那個選項裡就寫著:**
 *     甲 = 「**從你設定的那一刻起**(新出貨的才寄;舊單一律不補)」
 *   ⇒ 與本段第一行原本寫的「起始線 = 這一片上線的時戳」**是同一個意思**,兩邊一致。
 *   ⇒ 📌 所以**不要**把它讀成「2026-08-30 零時起」:那一讀會在上線那一刻把 08-30 零時到
 *     上線之間的每一箱一次寄出去,而他那一板逐字是「舊單一律不補」。
 *     (同族坑:引用拍板要抄【他選的那個選項的字面】,不是抄題目那句白話。)
 *
 *   ✅ **時區:Sean 2026-08-30 已答「甲 台北時間(+08:00)」**(~~原本這裡寫「他沒有被問到、仍未確認」~~
 *     —— 已問已答,作廢)。出處:`~/pcm-mailbox/等Sean決策-20260829.md` 檔尾那批。
 *   🔴 **值一定要帶偏移**(例:`2026-09-01T21:30:00+08:00`),**不要寫裸的 `2026-09-01`** ——
 *     `shipped_at` 是 timestamptz,裸日期會被當 UTC 解讀 ⇒ 台北時間當天 08:00 之前出的箱子
 *     會被判成「在起始線之前」而**永遠不寄**,而那個漏是靜默的(沒有任何一格會紅)。
 *
 *   🛑 **【這個值由誰、在什麼時候設】——寫在這裡,免得接線那天被重新發明一次:**
 *     · **不是本 use-case,也不是本片** —— 本 use-case 只讀傳進來的值。
 *     · 設值的人 = **把這條 use-case 掛上 cron route 的那一片**(片3;今天那條 route 還不存在)。
 *     · 設的時機 = **那一片部署上線的當下**,值填**當下那一刻**的台北時戳。
 *     · 落點 = env `SHIPPED_EMAIL_CUTOFF`(Vercel 環境變數;要 Sean 或有權限的人設)。
 *     ⚠️ **設早了** ⇒ 會補寄中間那段的舊箱子(違反他「舊單一律不補」那一板);
 *       **設晚了** ⇒ 中間那段真的該寄的箱子永遠不寄。**兩邊都靜默,沒有一格會紅。**
 *     ⇒ 📌 所以那一片的驗收條裡要有一條:**「env 已設,且值是部署當下的台北時戳」**,
 *       而不是只驗「route 回 200」。
 *
 * - `limit`:單輪上限(route 端常數、零 client 輸入)。
 */
export type EnqueueOrderShippedEmailsOptions = {
  cutoff: string;
  limit: number;
};

/** counts-only(零 PII)。五個桶互斥、加總 = `scanned`。 */
export type EnqueueOrderShippedEmailsResult = {
  scanned: number;
  /**
   * 🔴 true = **這一輪沒有掃完**(收滿 limit)⇒ 後面還有,下一輪會繼續。
   * 沒有這一欄的話,「剛好只有 2 筆待排」與「還有 300 筆沒掃到」在回應上長得一模一樣。
   */
  truncated: boolean;
  enqueued: number;
  /** 合成假信箱 ⇒ adapter 落一列 `skipped_no_real_email`(**有痕跡**,不是靜默跳過)。 */
  skippedNoRealEmail: number;
  duplicate: number;
  /**
   * 兩個候選都沒有值 ⇒ 不 enqueue。
   *
   * 🔴 **2026-08-22 起這個桶【正常情況下恆為 0】,而它仍然留著 —— 兩件事都要知道**:
   * view 已經把「兩個信箱都空」的配對移到 `pcm_shipped_email_unsendable`
   * (codex R1:留在待排清單裡會由最舊那端**永久擋住後面每一封有效的信**,
   *  因為掃描固定取最舊的 limit 筆,而那個狀態永遠不會消失)。
   * ⇒ 所以本桶 >0 代表 **view 與本層對「有沒有信箱」的判準漂掉了** ——
   *   它不再是「有幾個客人沒信箱」,而是**一個不變式被打破的訊號**。
   * ⚠️ 而它**不會自己叫**;要看那些真的沒信箱的客人,查 `pcm_shipped_email_unsendable`。
   */
  noRecipient: number;
  errors: number;
};

export async function enqueueOrderShippedEmails(
  deps: EnqueueOrderShippedEmailsDeps,
  options: EnqueueOrderShippedEmailsOptions,
): Promise<EnqueueOrderShippedEmailsResult> {
  const scan = await deps.scanner.listShippedWithoutShippedEmail({
    cutoff: options.cutoff,
    limit: options.limit,
  });
  const rows = scan.rows;

  const result: EnqueueOrderShippedEmailsResult = {
    scanned: rows.length,
    truncated: scan.truncated,
    enqueued: 0,
    skippedNoRealEmail: 0,
    duplicate: 0,
    noRecipient: 0,
    errors: 0,
  };

  for (const row of rows) {
    // 與 order_created 同一條 fallback:訂單欄 NULL → 取 customers.email。
    // 🔴 空字串也要當成沒有:`enqueue` 對空 recipient 會 throw,而那會被下面吞成 errors ——
    //    一個「本來就沒有信箱」的配對不該長期佔著 errors,它是 noRecipient。
    // 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;板列 ⟦f3-MAILFALLBACKVSRULING⟧)。
    //    判準是【兩個條件】—— `manual_*` **而且** `notification_email` 為空,
    //    而後者是 `firstNonEmpty` 回 null 那一格。**兩個條件都在這一行裡。**
    // 🛑 判準本體在 `@pcm/domain` 的 `suppressCustomerEmailFallback` —— **四支共用一份**。
    //    在這裡重寫一份判斷, 四份會各自漂, 而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
    const recipientEmail = suppressCustomerEmailFallback(row.orderSource)
      ? firstNonEmpty(row.notificationEmail)
      : firstNonEmpty(row.notificationEmail, row.customerEmail);
    if (recipientEmail === null) {
      result.noRecipient += 1;
      continue;
    }

    try {
      // 🔴 **合成域不在這裡判**:那道閘在 adapter 內(單一常數來源),judged 之後會落一列
      //    `skipped_no_real_email` ⇒ 查得到痕跡。本層若自己先判一次,就長出第二套 LINE 判準。
      const enqueued = await deps.outbox.enqueue({
        eventType: 'order_shipped',
        orderId: row.orderId,
        displayId: row.displayId,
        // 🔴 `shipmentId` 進 dedup_key **也進 payload**(~~原寫「只進 dedup_key、不進 payload」~~,
        //    2026-08-22 R1 ④ 之後不成立);`shipmentReference` 只進 payload。
        //    兩者不可互換:uuid 對客人沒有意義(不會印在信上),而箱號不是我們用來去重的那個東西。
        shipmentId: row.shipmentId,
        shipmentReference: row.shipmentReference,
        shippedAt: row.shippedAt,
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
