// #10 片4b:出貨單那張紙上的**金額算式**(`Q-D-3`=B / `Q-D-4`=乙 / `Q-D-7`)。
//
// 🔴 **抽出來的理由與 `shipping-doc-quantities.ts` 逐字相同,而在這裡更重**:
//    這幾支算的是**印在客人手上那張紙的錢**,它們該有【不需要渲染就跑得動】的測試。
//    留在元件裡的話,每一格都要先 render 一次頁面才問得到一個算術問題,
//    而那會讓「算式對不對」與「畫面有沒有印出來」兩件事混在同一格裡紅。
//
// ── 🔴🔴 `Q-D-7` 的硬條款(**這是【驗收條款】不是建議**,spec `:37-41` 逐字)──────────
//    只放行 `unitPrice × 本區數量` 後加總;
//    **禁**從 `subtotal` / `total` 反推;**禁**浮點;
//    格式化一律走既有 `formatOrderAmount`(`lib/orders/order-list-view.ts:979`)——
//    **本檔一個字都不格式化**,只吐整數。格式化是呈現,算術是這裡。
//
// ── 🔴🔴 對外紙本的通則(spec §6.5,三個實例歸納出來的)────────────────────────
//    紙上每加一個數字,當場寫下兩句:①它的值從哪個欄位/運算來 ②**它的標籤向客人宣稱了什麼**。
//    **兩句對不起來就不要印。** ⇒ 出事的三次都是②,不是①。
//    ⇒ 本檔每支函式的 docstring 都要答得出②,答不出的不要加進來。

import type { AdminOrderDetailItem } from '@pcm/domain';

/** 本檔只讀 `unitPrice` 與呼叫端算好的「本區數量」,不碰 `quantitySummary`(那是隔壁那支的事)。 */
type PricedItem = Pick<AdminOrderDetailItem, 'unitPrice'>;

/**
 * 這一列在**這一區**的金額 = `unitPrice.amount × 本區數量`。`null` = 不知道(不是 0)。
 *
 * **它向客人宣稱什麼**:「這一項,在這一區的量,照原單價值多少」。
 * 🔴 **它【不】宣稱**:這是要退你的錢 / 這是你要付的錢 / 這是折扣後的金額。
 *    ⇒ 所以 `Q-C11`=甲 **已取消區不呼叫本函式** —— 客人看到取消品旁邊有金額,
 *      第一直覺是「這是要退我的錢」,而實際退款金額走退款流程、可能是不同的數字
 *      (部分退、運費不退)。**紙印出去收不回來。**
 *
 * 🔴 **`qty === null` 一律回 `null`、絕不補 0** —— 同 `outstandingQuantity` 的立場:
 *    契約 `packages/domain/src/order/types.ts` 錨點「`null` 的意思是「不知道」,不是「都是 0」」。
 *    補 0 的症狀是**紙上印一個看起來正常的金額,而它少算了**。
 *
 * 🔴 **整數 × 整數,零浮點**:`unitPrice.amount` 與數量都有非負整數約束
 *    (codex 2026-08-16 關卡1 明說查無浮點路徑,spec `:274` —— 照抄不重驗)。
 */
export function lineAmount(item: PricedItem, qty: number | null): number | null {
  if (qty === null) return null;
  // 🔴🔴 **型別說 `unitPrice` 一定在,而這一行還是防了它 —— 理由不是不信型別。**
  //    這是**列印路徑**:少一個欄位的後果不該是「整張紙 throw、什麼都印不出來」,
  //    因為這張紙最主要的職責(要出哪幾件、幾件)**根本不需要錢**。
  //    ⇒ 拿不到單價 ⇒ 回 `null` ⇒ 那一格印「金額資料尚未就緒」、那一區不印合計,
  //      **而數量那半照常印出去**。fail-closed 的方向是「不印錢」,不是「不印紙」。
  //    📎 這一格是被 `page.test.tsx` 那個 250 項的負向對照**當場打出來的**
  //       (`TypeError: Cannot read properties of undefined (reading 'amount')`)——
  //       它撞到的是 fixture,而**同一發撞到的是「合約被違反時我們怎麼倒」**,那是真的。
  const unitPrice = item.unitPrice as PricedItem['unitPrice'] | undefined;
  if (unitPrice === undefined || unitPrice === null) return null;
  return unitPrice.amount * qty;
}

/**
 * 一個區塊的小計 = 該區各列金額相加。`null` = **這一區不印小計**。
 *
 * **它向客人宣稱什麼**:「這一區裡的東西,照原單價加起來值多少」。
 * 🔴 **它【不】宣稱**:這是這一區的應付金額,也不宣稱它與訂單金額有任何等式關係。
 *    ⇒ spec §3 逐字:「**兩區小計【不等於】商品小計,而那是對的**」
 *      「紙上**不得出現任何跨區等式**」。母體不同:小計的母體是整張訂單(全下單量),
 *      兩區的母體是「這一箱」與「還欠的」。
 *    ⚠️ 而**紙上要用一句人話講清楚這件事**(spec §9③;文案由 Sean 拍板)——
 *      否則客人會自己相加,然後發現對不起來。
 *
 * 🔴🔴 **fail-closed:只要有一列不知道,整區不印小計**(spec §5 逐字
 *    「`quantitySummary === null` ⇒ …**該區不印小計**」「**絕不把 `null` 當 0**」)。
 *    ⚠️ **這裡最容易被「修好」成錯的一行是 `.filter(v => v !== null)`** ——
 *      過濾掉不知道的那幾列,剩下的仍然加得出一個數,而那個數**看起來完全正常、而且偏低**。
 *      ⇒ 少報,而少報沒有人會打電話來(Sean `Q-C16` 甲:「少印沒人會發現,多印客人會打電話」)。
 *
 * 🔴 **空集合也回 `null`,不回 0** —— 「這一區沒有東西」與「這一區值 0 元」是兩件事,
 *    而回 0 會讓紙上出現一個 `0`,那是一個**它的標籤沒有宣稱過**的數字。
 *    📎 實務上空的區塊根本不會被渲染(元件端 `rows.length > 0` 才畫),
 *      但**守門不能靠呼叫端的自律**:這裡回 `null` 讓它就算被呼叫也印不出東西。
 */
export function sectionSubtotal(amounts: readonly (number | null)[]): number | null {
  if (amounts.length === 0) return null;
  let sum = 0;
  for (const a of amounts) {
    if (a === null) return null;
    sum += a;
  }
  return sum;
}

/**
 * 🔴🔴 **§9⑦ 的 fail-closed 閘:兩次讀不一致 ⇒ 不印金額。**
 *
 * **病灶**(`page.tsx` 錨點 `findAdminOrderDetail` 與 `loadOrderShipments` 兩次讀):
 * 頁層分兩次查 —— 先拿 `quantitySummary`(含 `shippedQuantity`)、再拿 `shipment.shippedAt`。
 * 兩次之間若有人按下「標記出貨」,會拿到**舊的 `shippedQuantity`** 配 **新的 `shippedAt`**。
 * 📎 這條在 `shipping-doc.tsx` 早就登記為「數量會多印」——
 * 🔴 **而金額讓它從「多幾件」變成「多一筆錢」,所以它在這一片必須有處置,不能只登記。**
 *    理由(78 2026-08-24 裁,逐字):「**【多幾件】是可以事後說明的,【多一筆錢】不是** —— 紙寄出去收不回來」。
 *
 * **偵測的是這個競態留下的【簽名】,不是「兩次讀一定一致」**:
 * ```
 * 不變式：shippedAt !== null  ⇒  shippedQuantity >= 本箱該列的量
 *         （shippedQuantity 是跨【全部已出貨箱】的加總 ⇒ 它至少要含本箱）
 * 違反   ⇒ 舊的 quantitySummary 配新的 shippedAt ⇒ 陳舊讀
 * ```
 * ⚠️⚠️ **誠實邊界(不准刪、不准弱化成「已處理」)**:
 * - 它抓得到「`shippedAt` 新、`shippedQuantity` 舊」。
 * - 🔴🔴 **抓不到反方向**(`shippedQuantity` 新、`shippedAt` 舊)。而反方向的後果是
 *   ~~多報~~ **【少報】** —— 2026-08-24 codex 跨模型審查更正,我原本寫反了:
 *   ```
 *   訂 9 / 取消 1 / shippedQuantity 新值 2 / shippedAt 舊值 null / 本箱 2
 *   shippedAt 是 null ⇒ outstandingQuantity 把本箱【再扣一次】
 *     印出 9−1−2−2 = 4      而正值是 9−1−2 = 6      ⇒ 少報
 *   (WOULD-CHANGE 我在真 runner 覆過:`node -e "…9-1-2-2 vs 9-1-2…"` ⇒ 輸出 `少報`)
 *   ```
 *   🔴🔴 **而更正的不只是字面 —— 我原本那句「方向是安全的那一邊」【也是錯的】。**
 *   `outstandingQuantity` 自己的 docstring 逐字寫著相反的判準:
 *   > 「兩害相權要選**多報** —— 多報 ⇒ 客人打電話來問,我們解釋;
 *   >   **少報 ⇒ 客人以為收齊了,而那 3 件沒有人會再提起**」「寧可讓人來問,不可讓人放心」
 *   ⇒ **對「還欠幾件」這一欄,少報是【危險】那一邊,不是安全那一邊。**
 *   ⚠️ codex 的裁決是「行為方向對(倒向少印,符合 `Q-C16`)、字面錯」——
 *   **我只採用它的後半。** `Q-C16` 那句講的是**金額印不印全**,
 *   而這裡問的是**還欠客人幾件**,兩者的安全方向相反。**不要把它讀成已經沒事了。**
 * - 🔴 **⇒ 這是一個【已登記、本片不修】的缺陷,不是一個被止血的缺陷:**
 *   本閘只擋住其中一個方向;反方向會讓紙上少報欠貨與少報金額,而**沒有任何東西會紅**。
 *   真正的修法是頁層一次讀齊(或加版本比對),那是另一片。
 *   **登記不等於處置完畢。**
 *
 * @returns `true` = 兩次讀對得起來,可以印金額。`false` = **不印金額區塊**。
 */
export function shipmentReadsAreConsistent(args: {
  /** 這一箱是否**已標記出貨**(`shipments.shipped_at !== null`)。 */
  thisShipmentShipped: boolean;
  /** 本箱各列:該列在這一箱的量,以及該列的 `shippedQuantity`(`null` = 不知道)。 */
  lines: readonly { thisShipmentQuantity: number; shippedQuantity: number | null }[];
}): boolean {
  // 還沒標記出貨 ⇒ 這個競態的簽名不成立(`shippedQuantity` 本來就不該含本箱)。
  if (!args.thisShipmentShipped) return true;
  for (const l of args.lines) {
    // 🔴 `null` = 不知道 ⇒ **判不一致(fail-closed)**,不是「沒問題所以放行」。
    //    這一行是本函式最容易寫反的地方:`?? Infinity` 之類會讓「不知道」變成「通過」。
    if (l.shippedQuantity === null) return false;
    if (l.shippedQuantity < l.thisShipmentQuantity) return false;
  }
  return true;
}
