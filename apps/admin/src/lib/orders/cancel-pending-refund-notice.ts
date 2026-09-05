import type { PendingRefundRail } from '../payment/pending-refund-repository';

// cancel-pending-refund-notice.ts — 取消前那句「這單收過錢」的**判準單一來源**。
//
// 來源:Sean 2026-09-05 第 1 題拍 **乙** —— 逐字「不擋, 按下去前告訴他」。
// plan:`docs/plans/2026-09-05-cancel-gate-unpaid-asks-payments-plan.md` §9。
//
// 🔴🔴 **三種世界, 而它們在畫面上【必須】長得不一樣**:
//   · `none`   沒收過錢          ⇒ 不畫任何東西
//   · `amounts`收過錢, 逐軌金額  ⇒ 紅框 + 逐軌列出
//   · `unknown`**讀不到**        ⇒ 🔴 紅框 + 一句「自己去看收款紀錄」
// 🛑 **`unknown` 與 `none` 絕不可以合併** —— 它們在員工眼裡都是「沒有紅框」,
//    而它們差一筆**該退給客人而沒有退的錢**。
//    ⇒ 📌 那正是 `pending-refund-repository.ts` 讀失敗時【拋】而不是回 `[]` 的理由;
//      這一層是那個決定的下半 —— **上半拋了, 而下半要把它畫成一句話。**
export type CancelPendingRefundNotice =
  | { readonly kind: 'none' }
  | { readonly kind: 'amounts'; readonly rails: readonly PendingRefundRail[] }
  | { readonly kind: 'unknown' };

/**
 * `null` = 讀不到(呼叫端 catch 之後餵 `null`,形狀抄同檔隔壁 `cancelShipmentWarning`)。
 *
 * 🔵 空陣列 ⇒ `none`:那是**函式算出來的**「這單不欠」,不是讀失敗
 *    (`pcm_pending_refund_amounts` 只回淨額 > 0 的軌)。
 */
export function cancelPendingRefundNotice(
  rails: readonly PendingRefundRail[] | null,
): CancelPendingRefundNotice {
  if (rails === null) return { kind: 'unknown' };
  // 🔴 `amount > 0` 再濾一次:函式那半已經濾過(`20260902030000:90` `WHERE n.net > 0`),
  //    而**這一層不假設上游的性質** —— 一個 0 元的待退款列會變成一筆沒有人要付的待辦。
  const positive = rails.filter((r) => r.amount > 0);

  // 🔴🔴 **而【負數】要走 `unknown`, 不可以靜靜變成 `none`**(code-reviewer N5)。
  //    負數在今天到不了這裡(上游濾過)⇒ 真的看到一個, 代表**上游換了**或我讀錯了函式,
  //    而那兩種都不是「這單不欠錢」。
  //    🛑 靜靜吞掉它 = 畫面上沒有紅框 = 與「沒收過錢」同形 —— 那正是本檔第 12 行禁止的那個合併。
  //    ⇒ 📌 **一個防合併的檔案, 自己在邊界上做了同一個合併。**
  //    ⚠️ 而它走的是 `unknown`, 而 `unknown` 畫的那句是「收款讀不到」—— **那句對負數不實**
  //    (codex nit 6:實際是**讀到了異常值**)。⇒ 文案已改成同時涵蓋兩種
  //    (見 `cancel-order-forms.tsx` 那個 `unknown` 分支)。
  if (rails.some((r) => r.amount < 0)) return { kind: 'unknown' };

  if (positive.length === 0) return { kind: 'none' };
  return { kind: 'amounts', rails: positive };
}

/** 軌的中文名。🔴 卡不會出現在這裡(`pcm_pending_refund_amounts` 只算非卡軌), 而仍給 fallback。 */
export function railLabel(rail: string): string {
  if (rail === 'bank_transfer') return '匯款';
  if (rail === 'cash') return '現金';
  if (rail === 'card') return '刷卡';
  // 🛑 不認得的軌**照原字印出來**, 不吞掉 —— 吞掉會讓「多了一條軌」這件事零訊號。
  return rail;
}


/**
 * 逐軌金額的合計 —— **回字串, 而超界時回一句話而不是一個錯的數字。**
 *
 * 🔴🔴 **為什麼不直接在 JSX 裡 `reduce` 相加**(codex 2026-09-05 finding 3):
 *    每一軌各自被 `Number.isSafeInteger` 守著(`pending-refund-repository.ts`),
 *    而**兩個安全整數相加可以超出安全範圍** ⇒ JS 會安靜地給一個**錯的數字**。
 *    🛑 而它印在一個**要員工照著退錢的框**裡 ⇒ 錯的金額比沒有金額糟。
 * ⚠️ **今天到不了這裡**(台幣訂單金額離 2^53 很遠)—— 這一格防的是
 *    「有人把這支拿去別的地方用」與「上游哪天換了」, 而那兩種都不會出聲。
 */
export function pendingRefundTotalLabel(rails: readonly PendingRefundRail[]): string {
  const total = rails.reduce((sum, r) => sum + r.amount, 0);
  if (!Number.isSafeInteger(total)) return '(金額異常,請看收款紀錄)';
  return total.toLocaleString('en-US');
}
