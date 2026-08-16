// #10:出貨單那張紙上的**數量算式**。
//
// 🔴 **從 `components/print/shipping-doc.tsx` 抽出來的理由有兩個,第二個才是重點**:
//    ① 元件檔到 411 行、越過鐵則 6 的 400 行線。
//    🔴 ② **這兩支是「印在客人手上那張紙的數字」,它們該有【不需要渲染就跑得動】的測試** ——
//       留在元件裡的話,每一格都要先 render 一次頁面才問得到一個算術問題,
//       而那會讓「算式對不對」與「畫面有沒有印出來」兩件事混在同一格裡紅。
//    ⚠️ 兩件都要測,但**不該是同一格**:算式在這裡測,畫面在 page.test.tsx 測。

import type { AdminOrderDetailItem } from '@pcm/domain';

/**
 * 這一列**還欠客人幾件**(= 這張紙印在「尚未出貨」區的那個數)。`null` = 不知道(不是 0)。
 *
 * 🔴🔴 **算式 = 買的 − 取消的 − 已出貨的 − 【這一箱要寄的】**(四項)。
 *    **Sean 2026-08-16 拍板 `Q-C4`,逐字**:
 *    > 「分批出貨時…**會算錯就不印,只計算本次出貨**,然後第二或這第三批出到沒貨時
 *    >  **尚未出貨那邊就空了就好,代表出完了。**」
 *
 * 🔴 **他那句話本身就是這條算式的證明,而它排除了三項版本** ——
 *    訂購 5、分三批出 2/2/1(前面幾批印單時都已標記出貨):
 *    ```
 *              三項（不扣這一箱）   四項（扣這一箱）
 *      批1            3                  3
 *      批2            3                  1
 *      批3            4  🔴              0  ✅「空了，代表出完了」
 *    ```
 *    ⇒ **「不印」指的是【那一格不顯示】,不是【那一項不計算】。** 紙面三格、算式四項。
 *
 * 🔴🔴 **【其他還沒出貨的箱】刻意【不扣】—— 這是本函式最容易被「修好」成錯的一行。**
 *    我在 codex 第一輪之後真的把它改成「扣掉整張訂單所有待出貨的箱」,**而那是過度修正**:
 *    ```
 *    訂購 5：A 箱裝 2（正在寄，就是這張紙）／ B 箱裝 3（還是草稿，可能延後、可能作廢）
 *      扣全部待出貨 ⇒ 5−0−0−5 = 0 ⇒ A 的紙印「沒有還欠客人的品項」  🔴 少報
 *      只扣這一箱   ⇒ 5−0−0−2 = 3 ⇒ A 的紙印「還欠 3」              ✅ 多報
 *    ```
 *    ⚠️ **兩害相權要選【多報】** ——
 *    多報 ⇒ 客人打電話來問,我們解釋;**少報 ⇒ 客人以為收齊了,而那 3 件沒有人會再提起。**
 *    📎 這與本檔「`null` 絕不補 0」是同一條原則的兩個面:**寧可讓人來問,不可讓人放心。**
 *    ⇒ **代價照實寫**:同一張訂單有兩個待出貨的箱時,**兩張紙會各自把對方箱裡的貨算成還欠客人**。
 *      那是**刻意接受的**(codex 第一輪把它報成缺陷,而消掉它會換來上面那個少報)。
 *
 * 🔴🔴 **`thisShipmentShipped` 不是可有可無的參數,少了它【補印】那張紙會重複扣**:
 *    `shippedQuantity` 只算**已標記出貨**的箱
 *    (`20260806180000_…shipped_recompute_wire.sql:228` 逐字「未寄出的草稿箱不算」)
 *    ⇒ 這一箱還沒標出貨時它不在裡面(要自己扣)、**已經標了就已經在裡面(不能再扣一次)**。
 *    ```
 *    訂購 5 / 取消 0 / 這一箱 2
 *      箱還沒標出貨    shipped 0  ⇒ 5−0−0−2 = 3   ✅
 *      箱已出貨後補印  shipped 2  ⇒ 無條件扣 ⇒ 1  🔴 把 3 印成 1
 *                                  正解不扣 ⇒ 3   ✅
 *    ```
 *    ⚠️ **補印是真的會發生的路徑**(單子印壞、客訴要重出一張)⇒ 不是理論邊界。
 *
 * ⚠️⚠️ **「已出貨」是【員工按了按鈕】,不是【貨運真的收走了】**(codex 指出,我接受):
 *    `shipped_at` 由 `mark_shipped` 寫入,兩個方向都可能偏 —— 先按再交貨、或交了貨還沒按。
 *    **本函式沿用系統既有語意,不自己另立一套**(另立就會多出第二個真相源),
 *    **但不要把它讀成「貨運收據」。**
 *
 * 🔴 **`null` 一律回 `null`、絕不補 0**:契約 `packages/domain/src/order/types.ts:739-762`
 *    逐字「`null` 的意思是「不知道」,不是「都是 0」」。
 *
 * ⚠️ **與 `picking-doc.tsx` 的 `pickableQuantity()` 是不同的問題,不要合併**:
 *    那個問「倉庫現在有幾件可以揀」= `instock − shipped`;這個問「還欠客人幾件」(沒到貨的照樣欠)。
 */
export function outstandingQuantity(args: {
  item: AdminOrderDetailItem;
  /** **這一箱**裡屬於這一列的量。 */
  thisShipmentQuantity: number;
  /** 這一箱是否**已標記出貨**(`shipments.shipped_at !== null`)。 */
  thisShipmentShipped: boolean;
}): number | null {
  const s = args.item.quantitySummary;
  if (s === null) return null;
  // 已標記出貨 ⇒ 這一箱已經算在 shippedQuantity 裡,不能再扣一次(見 docstring 那張表)。
  const notYetCounted = args.thisShipmentShipped ? 0 : args.thisShipmentQuantity;
  // 夾 0:前三項有 CHECK,第四項來自另一張表 ⇒ 不想在紙上印負數。
  return Math.max(0, s.quantity - s.cancelledQuantity - s.shippedQuantity - notYetCounted);
}

/**
 * 這一列**被取消了幾件**。`null` = 不知道。
 *
 * 🔴 獨立成一區是 **Sean 2026-08-16 逐字**:「我們應該就分成三個欄位
 *    **本次出貨** / **尚未出貨** / **訂單取消** 分隔起來就好」。
 *    ⚠️ **區名「訂單取消」照抄他的字,不要正規化成「已取消品項」之類。**
 */
export function cancelledQuantityOf(item: AdminOrderDetailItem): number | null {
  return item.quantitySummary?.cancelledQuantity ?? null;
}
