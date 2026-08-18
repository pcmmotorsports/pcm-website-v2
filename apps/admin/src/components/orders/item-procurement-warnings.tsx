// item-procurement-warnings.tsx — 採購區的三種警告(`#649` 從 `item-procurement-section.tsx` 搬出來)。
//
// 🔴 **搬家,不是重寫**:整段檔頭與兩個元件逐字保留(`#646` 那段論證就住在這裡)。
//    拆檔理由見 backlog `#649`;**本檔零行為改動**。


/**
 * 截斷警告。**三種情況的文案刻意不同,而差別不在語氣,在【我們有沒有證據】。**
 *
 * 🔴🔴 **本段 2026-08-18 傍晚由 `#646` 整段重寫;上一版(`#643` B)的論證已不適用,不要照它改。**
 * 舊字面(更早、`#643` B 之前)~~「請重新整理這張單;在完整載入之前不能編輯採購」~~
 * 已因下面這條紀律被撤:全陣紀律逐字(`apps/storefront/src/lib/account-order-copy.ts:16`)
 * > **「請重新整理」只准出現在【真的重整就會好】的地方。**
 *
 * ## `#646` 之後,這一區有三種情況(兩個欄位、三種說法)
 *
 * ```
 * ① item 讀到了但觸及上限   procurements=[…] + procurementTruncated=true
 *    ⇒ 證據是【品項級】的（mapper 自己算的 length >= 50）⇒ **講死**：固定限制、重整不會改變
 * ② item 一列都沒讀到       procurements=null
 *    ⇒ 🔴 **沒有證據說它是哪一種** ⇒ **不宣稱**，用條件句
 * ③ order 清單沒完整載入    detail.itemsTruncated=true
 *    ⇒ 這一欄併了兩個來源：mapper 的 length>=200（固定）
 *      與 mergeDetailItems 的【筆數對帳不符】（暫時）⇒ **不宣稱**，用條件句
 * ```
 *
 * ## 🔴 為什麼 ②③ 是條件句 —— 這是【證據到此為止】,不是偷懶
 *
 * 關卡2 codex 連兩輪抓到我在同一件事上犯三次:
 * ```
 * 第一版  ②③ 都改成講死「固定限制」        ⇒ ③ 的「筆數對帳不符」那條路重整會好 ⇒ 說謊（MF1）
 * 第二版  ② 的 fixed 吃 detail.itemsTruncated ⇒ 拿【訂單層】事實斷定【品項】 ⇒ 說謊（MF2）
 * 第三版  ② 的 fixed 吃 item.procurementTruncated
 *        ⇒ 而那一欄可能是 mergeDetailItems 拿訂單層事實填的 ⇒ 繞一圈同一個病（codex round2）
 * ```
 * ⇒ 現行版本:**② 完全不宣稱**,`mergeDetailItems` 也不再替品項猜(它填 `procurementTruncated: false`,
 *   意思是「我沒有證據說它固定」)。要讓 ② 也講得死,得先有**品項級**的截斷原因 —— **不在本片**。
 *
 * ## 兩句話都保留的那半句
 *
 * 🔴 「在完整載入之前不能編輯採購」描述的是【真的擋著的行為】:
 *    `item-procurement-form.tsx` 的 `<fieldset disabled={…}>`,而該檔自陳 action 端還有第二道
 *    (hidden `stale=1`)⇒ **兩道,不是文案自嗨。** 把一句描述真實限制的話當廢話刪掉,
 *    會製造一個新的靜默失敗。
 * ⚠️ 而伺服器端那則(`procurement-action-state.ts` 的 `stale`)`#646` 之後**刻意不複述下一步** ——
 *    hidden `stale` 只帶得上來一個 `1`,分不出是 ①②③ 哪一種,複述必然在另外兩種說謊。
 */
export function TruncationWarning({ scope }: { scope: 'item' | 'order' }) {
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      {scope === 'order' ? (
        <>
          這張單的品項清單這次沒有完整載入,下面看到的採購紀錄可能不是全部。
          可以先重新整理看看;
          <strong>如果還是這樣,那是系統的固定限制、不會自己好</strong>,請找負責人處理。
        </>
      ) : (
        <>
          這個品項的採購紀錄太多,超過一次能載入的上限,下面看到的不是全部。
          <strong>這是系統的固定限制,重新整理不會改變</strong>,請找負責人處理。
        </>
      )}
      在完整載入之前不能編輯採購(避免用不完整的內容覆蓋既有紀錄)。
    </div>
  );
}

/**
 * 🔴 `#646` 的另一半:**讀不到**(`item.procurements === null`,內嵌鍵整個沒回來/投影退版)。
 *
 * 這是**另一個世界**,不是上面那個的變體:
 * ```
 * 讀不到（本元件）   → 暫時性 ⇒ **重整真的可能會好** ⇒ 唯一正確的指示就是「請重新整理」
 * 觸及上限（上面）   → 固定的 ⇒ 重整永遠不會好      ⇒ 說「請重新整理」就是叫他做白工
 * ```
 * 舊版兩者共用一顆布林 ⇒ 只能寫成條件句(「可以先重新整理看看;如果還是這樣…」)。
 * `#646` 把它們拆開之後,**兩邊都可以講死**,而這正是這一片全部的價值。
 * 📎 全陣紀律(`apps/storefront/src/lib/account-order-copy.ts:16`)逐字:
 *    **「請重新整理」只准出現在【真的重整就會好】的地方** —— 這裡就是那個地方。
 */
export function UnreadableWarning() {
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      這個品項的採購紀錄這次<strong>沒有讀到</strong>(不是「沒有採購」)。
      可以先重新整理看看;
      <strong>如果還是這樣,那是系統的固定限制、不會自己好</strong>,請找負責人處理。
      在讀到之前不能編輯採購(避免用不完整的內容覆蓋既有紀錄)。
    </div>
  );
}

/**
 * 「還有 N 件沒有登記來源」(#352-b-2 衍生指標;plan §5.4)。
 *
 * 🔴 **它是查出來的、不是記住的** ⇒ 重整、換裝置、隔天再看都還在。
 *    plan v3.2 原本要用「server action 記錄進行到哪一步 → 顯示未完成橫幅」,被 R3 打掉:
 *    那個橫幅**會蒸發**(員工關掉瀏覽器就沒了),而帳面短少**靜默留著**。
 *
 * 🔴 **`null` = 不知道,誠實說不知道** —— 不補 0(補 0 會讓畫面講一句它證明不了的話)。
 *
 * ⚠️ **文案不得寫「流程中斷」**:本值分不出「從沒開始採購」與「三步做到一半」,
 *    而那兩件事員工的下一步動作本來就一樣(都是去下面把來源補上)。
 */
