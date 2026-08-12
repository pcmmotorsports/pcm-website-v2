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

/**
 * **部署換版**(server action id 在新 deployment 上不存在)時要說什麼。
 *
 * 🔴 **為什麼不能沿用斷線那句「再按一次」**:action id 是編進**已載入的那份 bundle** 的,
 *    再按一次送的是同一個 id ⇒ 伺服器照樣不認得 ⇒ 永遠拿到同一顆錯誤。
 *    唯一出路是重新整理,讓瀏覽器換到新 build。
 *
 * 🔴🔴 **`maybeCreatedBox` 決定講哪一句,不能共用一句**(R1 must-fix 1):
 *    「不會多出一箱」只在這個彈窗**確定沒建出過箱**時成立。此時叫他重新整理 = 丟掉這把冪等鍵,
 *    他若原樣再建一次就是**第二箱**。
 * 🔴🔴 **判準是「可能建出過」不是「確定建出過」**(R3 F1,穿透前兩輪的那條):
 *    參數不可以只接 `everCreatedRef` —— 那顆只在**拿到回傳**時才變 true。
 *    災難日內插:①第一次送出撞斷線(server 其實已 commit 箱、瀏覽器沒拿到回應,
 *    這個殘留邊界 `shipment-dialog.tsx` 的 `everCreatedRef` 宣告處早就寫過)②此刻部署換版
 *    ③再按一次 ⇒ 走到這裡。只看 `everCreatedRef` 的話它還是 false ⇒ 講出「不會多出一箱」= **假話**。
 *    ⇒ 呼叫端要把「有沒有一次送出結果不明」也算進來。
 *
 * **「這次什麼都沒送出去」的依據**(2026-08-12 讀 Next 16.3.0 原始碼,不是推論):
 *    `server/app-render/action-handler.js` 送出 `NEXT_ACTION_NOT_FOUND_HEADER` 的地方共五處
 *    (`:415` / `:578` / `:624` / `:687` / `:780`),全部經 `handleUnrecognizedFetchAction`(定義於 `:378`)。
 *    其中 `:578` / `:624` / `:687` / `:780` 是 `getActionModIdOrError()` 拋錯(**模組沒解析出來**);
 *    `:415` 是另一條 —— `!hasServerActions()` 早退,error 由 `getActionNotFoundError()` 直接建構。
 *    ⚠️ **兩條路的成因不同,但結論相同**:都在「找到並呼叫那支 action」之前就回應了。
 *    (`:217` 那條只是把內層回應的同一顆 header 原樣轉發。)
 * ⚠️ **誠實界線**:以上是**讀原始碼**證到的,**沒有實跑兩個 deployment 重現**;結論綁 Next 16.3.0,
 *    升版要重讀。R2 抓過一次:上一版這段寫「每一處的觸發都是 `getActionModIdOrError` 拋錯」=
 *    對 `:415` 不成立的全稱句,而它掛著「逐點讀原始碼」的招牌 ⇒ 後人不會再驗。
 */
export function staleDeploymentMessage(maybeCreatedBox: boolean): string {
  // 🔴 逃生句(R3 F2):client 只知道「伺服器回了不認得這顆按鈕」,**不知道**是不是換版 ——
  //    `action-handler.js:415` 那條(`!hasServerActions()`)是設定面的問題,重整不會好。
  //    沒有這句的話,員工會照文案無限重整、而且沒有升級路徑。
  const escape = '(重新整理之後如果還是這個訊息,請截圖回報,不要一直重試。)';
  return maybeCreatedBox
    ? '這個頁面是舊版本,系統剛更新過。請**重新整理頁面**。' +
        '⚠️ 剛才這一次的送出**沒有到達伺服器**,沒有新增任何東西;' +
        '🔴 但**這個視窗先前有一次送出可能已經建出箱子了**' +
        '(可能是沒拿到回應的那一次,也可能是建了箱、品項或標出貨沒完成)。' +
        '重新整理之後**不要原樣再建一次同一批貨** —— 那會變成第二箱。' +
        // 🔴 兩個地方都要指(R3 F3):有品項的箱在**出貨卡**上;
        //    沒有品項的空箱**只**出現在「未收尾的空箱」區,出貨卡是由品項反查箱畫的、看不到它。
        //    只指其中一邊,員工在另一型的情況下會找不到而卡住。
        '請先到訂單頁確認:先看出貨卡有沒有這批貨的箱子,沒有的話再看下方「未收尾的空箱」區;' +
        '確認之後再決定要作廢它還是接著把品項補上。' +
        escape
    : '這個頁面是舊版本,系統剛更新過。請**重新整理頁面**再操作一次。' +
        '⚠️ 這一次**什麼都沒有送出去** —— 伺服器不認得舊頁面上的這顆按鈕,' +
        '請求在到達建箱程式之前就被擋下了,所以**不會有任何箱子被建立**。' +
        '重新整理會換一把新的冪等鍵,但因為這次沒建成任何東西,**不會多出一箱**。' +
        escape;
}
