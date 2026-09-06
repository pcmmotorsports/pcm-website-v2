/**
 * @module @pcm/ports/IOrderPlacedAtReader —— ⟦b4-EMAILTRIAGE⟧ 甲-1 + 甲-2:
 * **cutoff 在【送出層】也要擋。**
 *
 * ══ 為什麼需要它 ═══════════════════════════════════════════════════════════
 * cutoff 今天只擋得住 **enqueue** —— 已經排進 `email_outbox` 的列, sweeper 照寄。
 * ⇒ 📌 **改 cutoff、刪 cutoff、或替一張舊單手動插一列, 那些信都會照樣寄出去。**
 *
 * ══ 🔴 為什麼比的是 `orders.created_at` 而不是別的時間 ═════════════════════
 * 三個候選, 而**只有一個不由被檢查者控制**:
 * ```
 * outbox 列的 created_at  ⇒ 手動替舊單插的那一列是【今天】建的 ⇒ 它會過關
 * payload 裡的時間        ⇒ 插列的人自己寫的 ⇒ 可偽造
 * orders.created_at       ⇒ ✅ 不由插列的人控制
 * ```
 * ⇒ 📌 **一個由被檢查者提供的值, 不能拿來檢查他。**
 *
 * ══ 🔵 為什麼這一道【可以批次】而 `IIneligibleOrderEmailScanner` 那道不行 ══
 * 那道閘是**刻意從批次改成逐封**的(`sweep-email-outbox.ts` 那段註解逐字:
 * 「改成逐封…而它把窗口真的收到【這一封的讀取與 send 之間】」)。
 * 🎯 **而差別不在「同一張表」, 在【那個值會不會在讀完之後改變】**:
 * 　 那道閘比 `cancelled_at` / `payment_status` —— **會變** ⇒ 必須逐封;
 * 　 本道比 `created_at` —— **業務流程上沒有改它的路**(掃過 `apps/` `packages/` 零更新路徑)
 * 　 ⇒ 批次讀一次就夠。
 * 　 ⚠️ **而「它不會變」不是一條【已證明的資料庫不變式】**(codex 2026-09-07 nit):
 * 　 　 `scripts/op5-verify.sh:352` 就有在交易內改它的 fixture ⇒ **DB 層沒有東西擋著**。
 * 　 　 📌 那不表示線上有競態, 而**我的措辭原本超出了我的證據**。
 * ⇒ 🛑 **所以不要把這兩道合成一道** —— 合了就得選一個時機, 而它們要的時機相反。
 */

/** 一張單的成立時刻;`null` = 那張單查不到(已刪 / id 不存在)。 */
export type OrderPlacedAt = {
  orderId: string;
  /** ISO 8601;`null` = 查得到那張單而欄位是空的(理論上不該發生, 由呼叫端 fail-closed 處理)。 */
  placedAt: string | null;
};

export interface IOrderPlacedAtReader {
  /**
   * 批次讀一組單的成立時刻。
   *
   * 🔴 **回傳只含【查得到】的那些** —— 呼叫端要把「不在回傳裡」當成**讀不到**,
   *    而**不是**當成「這張單很新」。
   *    ⇒ 📌 **一個缺席的 key 與一個很新的時刻, 在 fail-open 的實作裡長得一樣。**
   * 🔴 **throw = 讀取失敗** —— 呼叫端 fail-closed(不寄、計 error、**不標終態**):
   *    一次讀取失敗不該永久吞掉一封信。
   */
  readPlacedAt(orderIds: readonly string[]): Promise<readonly OrderPlacedAt[]>;
}
