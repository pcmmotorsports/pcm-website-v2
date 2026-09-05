import type { OrderShipmentGroup } from '../shipping/order-shipments';

// receipt-deletable.ts — 一筆到貨紀錄「現在撤不撤得掉」, 以及【撤不掉時要告訴員工什麼】。
//
// 🔵 backlog `#450`;Sean 2026-08-12 的原始需求逐字:
//    「原本以為這個商品要給這個訂單, 其實要先給另外一個訂單」。
//
// 🔴🔴 **本檔是【提醒】不是【閘】—— 而那是 codex 對抗審查訂正過來的。**
//
// ⛔ ~~我第一版把它做成閘:算出「這個品項撤不撤得掉」, 撤不掉就【不給撤銷鈕】。~~
// 🛑 **而那個前提是錯的。** DB 那道守門有**兩層**, 我只看到第一層:
// ```
// ① 包裹層:si.order_item_id = v_item AND sh.shipped_at IS NULL AND sh.deleted_at IS NULL
// ② 🔴 數量層(:392-418):**刪掉之後**重算 instock, 若 instock < shipped + pending ⇒ 擋
// ```
// ⇒ 📌 **② 與那一筆的【數量】有關** ⇒ 同一個品項底下, 撤掉 1 件的那筆可能過、
//    撤掉 3 件的那筆可能不過 ⇒ **「全中或全不中」是假的。**
//
// 🔴🔴 **而 RPC 自己的註解就寫著不要在前面預測**(`:393-394` 逐字):
//    **「後置而非預測:讀重算後的真值, 不自己算 `instock − N`(自己算 = 複製重算規則 = 第二真相)」**
//    ⇒ 🛑 我在前端算一份, 正是它明文拒絕的那件事。
//
// ✅ **所以改成:算得出來的那一層(包裹)做成【事前提醒】, 而【不拿掉任何一顆鈕】。**
//    ⇒ 拿掉鈕 = 用一個**算不準的預測**去關掉一條**真的可能走得通**的路
//      —— 而那比「多按一次看到失敗」貴得多(它讓一件做得到的事變成沒有人去做)。
//    ⇒ 📌 而事前提醒仍然有價值:它讓員工**在按之前**就知道可能會失敗、以及為什麼。
//    🔵 真正的權威**只有 RPC**, 而它失敗時的訊息本來就寫得很完整(逐箱列出)。

/**
 * 那道守門的條件, 逐字對齊 DB。
 *
 * 🔴🔴 **`shipped_at IS NULL AND deleted_at IS NULL` —— 兩個都要, 而它比直覺窄**:
 * ```
 * 已出貨的箱  ⇒ **不擋**(貨都出去了, 那筆到貨紀錄本身沒有被它綁住)
 * 已作廢的箱  ⇒ **不擋**(它已經被處理過了)
 * 只有「還沒出貨、也沒作廢」的箱才擋
 * ```
 * ⇒ 🛑 **我開工前標的未知就是這一格**, 而量完的答案是:**兩種都要排除**。
 *    若我只排除作廢(直覺上的「無效箱」)⇒ 已出貨的箱會被算進來
 *    ⇒ **多擋一些其實刪得掉的列** ⇒ 而**誤報會被學會忽略**。
 *
 * ⚠️ **前端這一半用 `voidedAt`, 而 DB 那一半用 `deleted_at`** —— 兩者是同一件事的兩個名字
 *    (`order-shipments.ts:11` 逐字「可作廢/可復原由 `voidedAt` 決定」;
 *     同檔 `:120` 也用**同一組條件** `shippedAt === null && voidedAt === null`)。
 *    🛑 **若哪天它們分家, 本檔會靜靜地與 DB 判不一樣** —— 而那個不一致
 *    **只會在「畫面說可以撤而 RPC 拒絕」那一刻顯形**。守門見同檔測試。
 */
function blocksDeletion(group: OrderShipmentGroup): boolean {
  return group.shipment.shippedAt === null && group.shipment.voidedAt === null;
}

/**
 * 一個品項的撤銷狀態。
 *
 * 🔵 `blocked: false` **不宣稱「一定刪得掉」** —— 它只說「包裹那一層我們沒看到擋它的東西」;
 *    數量那一層我們**不算**(見檔頭:那是 RPC 明文拒絕被複製的規則)。
 * 🔵 `blocked: true` **也不宣稱「一定刪不掉」** —— 它是**事前提醒**。真正的權威只有 RPC。
 */
export type ReceiptDeletability =
  | { readonly blocked: false }
  | {
      /**
       * 🔴 **`blocked` 這個名字保留, 而它的意思是「有東西可能擋」不是「一定擋」** ——
       *    消費端**不得**拿它去移除撤銷入口(見檔頭)。
       */
      readonly blocked: true;
      /** 擋住它的那些包裹編號(升冪、去重)。**列出全部, 不只講一個。** */
      readonly shipmentRefs: readonly string[];
      /** 給人看的那句話。 */
      readonly message: string;
    };

/**
 * 那句話 —— **Sean 2026-09-03 親筆**, 不是我擬的暫用字面。
 *
 * 他逐字:「這個品項已經包進出貨單, 要先作廢那個包裹才刪得掉」
 * ⇒ ✅ 所以它是**定稿的起點**, 而不是 TODO。
 *
 * 🔴 而我在它後面**只加了包裹編號**, 沒有改他的字 ——
 *    理由:同一個品項可能在**多個**包裹裡, 而「那個包裹」沒有說是哪一個
 *    ⇒ 員工要去作廢, 得先知道去作廢哪一箱。
 * 🛑 **若哪天發現他這句話對某個狀態不成立(例:包裹已作廢), 回報主視窗, 不要自己改他的字。**
 */
function messageFor(refs: readonly string[]): string {
  const list = refs.join('、');
  // 🔵 Sean 原話是「…才刪得掉」= 斷言;而我們算不準數量那一層 ⇒ 改成「可能」。
  //    🛑 **這不是改他的字的意思, 是我們證不到那個斷言** —— 已回報主視窗。
  return `這個品項已經包進出貨單(${list})——要先作廢那個包裹才刪得掉;可以按按看,擋下來的話畫面會說明原因。`;
}

/**
 * 這個品項底下的到貨紀錄, 現在撤不撤得掉。
 *
 * @param groups 本單的包裹分組。**`null` = 讀不到** ⇒ 見下。
 * @param orderItemId 要問的那個品項。
 *
 * 🔴🔴 **讀不到時回「擋」, 而那與 `cancel-shipment-warning` 同一條紀律**:
 *    量不到 ≠ 沒有包裹。一個讀不到時安靜放行的畫面, 會在最亂的那張單上說「可以撤」,
 *    而員工按下去才被 RPC 拒絕 —— 那時他已經以為這件事做得到了。
 */
export function receiptDeletability(
  groups: readonly OrderShipmentGroup[] | null,
  orderItemId: string,
): ReceiptDeletability {
  if (groups === null) {
    return {
      blocked: true,
      shipmentRefs: [],
      // 🔵 這一句**不是** Sean 那句 —— 它講的是另一件事(我們讀不到), 不要混用。
      message: '目前讀不到這張單的包裹資料,無法判斷能不能撤銷;請重新整理再試。',
    };
  }
  const refs = [
    ...new Set(
      groups
        .filter(
          (g) => blocksDeletion(g) && g.lines.some((l) => l.orderItemId === orderItemId),
        )
        .map((g) => g.shipment.shipmentReference),
    ),
  ].sort();
  if (refs.length === 0) return { blocked: false };
  return { blocked: true, shipmentRefs: refs, message: messageFor(refs) };
}
