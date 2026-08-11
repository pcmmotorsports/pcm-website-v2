import type { ShipmentCandidateItem } from '../../lib/shipping/shipment-candidates';

// shipment-dialog-copy.ts — 建箱彈窗的文案判斷(從 `shipment-dialog.tsx` 抽出;鐵則 6)。
//
// 🔴 抽成純函式的附帶好處:文案這種「講對話沒講對話」的東西可以被單獨測,
//    不必先把整個彈窗 render 出來。

/**
 * 出不了的原因 → 給員工看的一句話(#351②)。
 *
 * 🔴 **用 switch 不用查表物件**:`TABLE[reason]` 那種寫法在 `reason` 是非預期字串時會取到
 *    原型鏈上的東西(`constructor` / `toString` 都是 truthy),本 repo 為這個形狀修過 6 頁
 *    (memory `reference_js-index-lookup-hits-prototype-chain`)。switch 沒有這個面。
 * 🔴 `default` 走「數量資料尚未就緒」而不是「未到貨」:漏帶或非預期值代表**我們不知道**,
 *    此時編一個具體的原因給員工 = 把不知道偽裝成事實,他會照著去做錯的下一步。
 */
export function blockedText(reason: ShipmentCandidateItem['blockedReason']): string {
  switch (reason) {
    case 'cancelled':
      return '已取消';
    case 'all_boxed':
      return '已全數配箱';
    case 'not_arrived':
      return '未到貨';
    default:
      return '數量資料尚未就緒';
  }
}

/**
 * 一件都沒選時要說什麼(#352-b-2 F1 要求②)。
 *
 * 🔴 **文案必須與「為什麼開得了這個窗」一致**:2026-08-11 放寬開窗條件之後,
 *    會出現「整箱都還沒到貨」也開得了窗的情況。那時對員工說「至少要選一件才能建箱」
 *    是**假話** —— 他不是忘了選,是**沒得選**;而他真正該做的事(按「貨到了」登記到貨)
 *    就在同一個畫面上。
 *    ⚠️ #351② 當初擋住開窗,要避免的正是這句誤導話;現在改成把**正確的下一步**講出來。
 */
export function emptySelectionMessage(candidates: readonly ShipmentCandidateItem[]): string {
  // 🔴 **「都還沒到貨」對混合箱是假話**(R2 N3):一箱裡可能是「1 件未到貨 + 1 件已取消」,
  //    對已取消那件說「還沒到貨」= 把員工指去等一批**不會來**的貨。
  //    ⇒ 兩個條件都要成立才敢講那句:沒有任何一件出得了 **而且** 真的有在等的貨。
  const nothingShippable = candidates.length > 0 && candidates.every((c) => c.remaining === 0);
  const anyAwaiting = candidates.some((c) => c.blockedReason === 'not_arrived');
  return nothingShippable && anyAwaiting
    ? '這些品項現在都不能出,其中還有在等到貨的。貨到了就按右邊的「貨到了」先登記到貨,登記完這裡就會亮起來。'
    : '這箱還沒有任何品項。至少要選一件才能建箱。';
}
