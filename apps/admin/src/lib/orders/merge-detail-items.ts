import type { AdminOrderDetail, AdminOrderDetailFullItem } from '@pcm/domain';

// merge-detail-items.ts — 把「頂層分頁撈到盡的品項」併回 `AdminOrderDetail`(`D2` C 條,2026-08-18)。
//
// 🔴 **為什麼需要「併」而不是直接換掉** ——
//    `AdminOrderDetail.items` 的型別是 `AdminOrderDetailItem`,它比撈到盡那份**多兩個採購欄**
//    (`procurements` / `procurementTruncated`)。
//    而那兩欄**刻意不在**撈到盡那份裡:它們是**內嵌陣列**、受
//    `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT = 50` 管(`mappers/order-procurement.ts:44`)
//    ⇒ 取進來等於把我們正在拆的那道牆換個位置裝回去,而**新位置比舊的早四倍撞**。
//    📎 完整論證見 `AdminOrderDetailFullItem` 的 docstring 與
//       `docs/specs/2026-08-18-m4b-order-detail-items-exhaustive-plan.md` §3。
//
// 🔴🔴 **所以這支做的事,是把一個【型別上的不對齊】變成一個【畫面上說得出口的狀態】**:
//    ```
//    品項清單     ⇒ 完整（撈到盡）
//    採購紀錄     ⇒ 前 N 項有（內嵌撈到的那些）；第 N+1 項起【沒有】
//                    ⇒ 而那些【不是「沒有採購紀錄」】，是【我們沒去讀】
//    ```
//    ⇒ 後者標成 `procurementTruncated: true` ⇒ UI 會對那些品項:
//       ①顯示琥珀色警語「這個品項的採購紀錄這次沒有完整載入」
//       ②**停用採購編輯**(`item-procurement-section.tsx` 的 `truncated` 那條)
//    **兩者都是我們要的** —— 尤其②:用不完整的內容去覆蓋既有紀錄是真的會弄壞資料。
//
// ⚠️ **這是「明說不全」,不是「做完了」。** 而明說不全是一個合格的終點 ——
//    判準同 Sean `Q-C16` 甲:**「少印沒人會發現,多印客人會打電話」** ⇒ 先讓它會叫。
//    採購區真正的治本(改成「按下去才抓」)是另一片,已寫進 plan §4 乙案。

/**
 * 把撈到盡的品項清單併回 detail。
 *
 * @param detail 原本的 detail(它的 `items` 是**內嵌撈的、可能被 200 夾過**)
 * @param fullItems 頂層分頁**撈到盡**的那份
 *
 * 🔴 **回傳的 `itemsTruncated` 恆為 `false`** —— 因為品項清單現在真的完整了。
 * 而**這正是本支最危險的一行**:它會讓
 * `item-procurement-section.tsx` 那句 `item.procurementTruncated || detail.itemsTruncated`
 * 的**後半永遠是 false** ⇒ 🔴 **採購那一面就【完全靠前半】撐住**。
 * ⇒ 所以下面那個 `procurementTruncated: true` 不是保守起見,**它是唯一還在的那道**。
 */
export function mergeDetailItems(
  detail: AdminOrderDetail,
  fullItems: readonly AdminOrderDetailFullItem[],
  reportedTotal: number | null,
): AdminOrderDetail {
  // 🔴🔴 **對帳:撈到的筆數與伺服器說的對不上 ⇒ 這份【不是完整的】**(codex 2026-08-18 MF-1)。
  //    `reportedTotal` 取自第一頁的 `count: 'exact'`。
  //    ⚠️ **第一版沒有這道,而它是本片最嚴重的洞**:撈到盡那支若少撈了,
  //    下面那個 `itemsTruncated: false` 會讓摘要卡、出貨狀態、取消複核
  //    **開始相信一份殘缺的清單** ⇒ 🔴 **從 fail-closed 變成 fail-open**,
  //    而那正是本片要修的病、換一個位置發作。
  //
  // 🔴 **這裡【不 throw】,與建箱候選那條刻意不同** ——
  //    建箱候選沒有「顯示不完整」這個 UI,只能整區失敗;
  //    而明細頁**本來就有那一套**(`itemsTruncated` ⇒ 摘要印「未知」、取消區 fail-closed)。
  //    ⇒ **讓那一套接手,比丟掉整頁好** —— 員工至少還看得到單號、收款、退款。
  //
  // ⚠️ **`reportedTotal === null` 不算對不上** —— 那是「伺服器沒給 count」,不是「數字不符」。
  //    把它當成截斷會讓一個【正常但沒 count 的回應】把整頁降級。
  const incomplete = reportedTotal !== null && fullItems.length !== reportedTotal;

  // 內嵌那份按 id 索引 —— 它帶著採購資料,而撈到盡那份沒有。
  const embedded = new Map(detail.items.map((it) => [it.id, it]));

  return {
    ...detail,
    items: fullItems.map((full) => {
      const withProcurement = embedded.get(full.id);
      if (withProcurement !== undefined) {
        // 🔴 **以撈到盡那份的值為準,採購欄從內嵌那份取** ——
        //    兩份的共同欄理論上相同(同一列、同一時刻附近),而**理論上相同不是相同**:
        //    兩次查詢之間可以有寫入。取新的那份(`full`)是因為它是**這一頁真正要顯示的**清單。
        return {
          ...full,
          procurements: withProcurement.procurements,
          procurementTruncated: withProcurement.procurementTruncated,
        };
      }
      // 🔴 內嵌那份沒有這一項 ⇒ 它落在 `ORDER_ITEMS_EMBED_LIMIT` 之外
      //    ⇒ 我們**沒有去讀**它的採購紀錄。
      //    ⚠️ **不可以填 `procurementTruncated: false`** —— 那會讓畫面說
      //       「這個品項沒有採購紀錄」,而事實是「我們沒看」。**兩者對員工的下一步完全不同。**
      return {
        ...full,
        procurements: [],
        procurementTruncated: true,
      };
    }),
    // 🔴 品項清單完整時翻成 false —— 否則畫面會對一份**真的完整**的清單說「沒有列完」,
    //    而那會讓取消複核區**永遠** fail-closed(那張單永遠取消不了)。
    // 🔴🔴 **而對帳不過時它必須留著 `true`** —— 見上方 `incomplete` 那段。
    //    ⚠️ **這一行是本片 fail-open / fail-closed 的分界**:
    //    寫死 `false` 的版本在「撈到盡少撈了」時會讓整頁相信殘缺的清單。
    itemsTruncated: incomplete,
  };
}
