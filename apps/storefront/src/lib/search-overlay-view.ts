// search-overlay-view.ts — 疊層「這一刻該畫什麼」的純判斷(從 `SearchOverlay.tsx` 搬出)。
//
// 🔴 **為什麼搬**:主檔接上品牌/分類兩區之後過了鐵則 6 的 400 硬線,而鐵則 6 逐字
//    **不得以壓縮/刪減註解作為降行手段** ⇒ 只能拆。而這一段本來就該住在 lib:
//    它是**純函式、零 React**,而它已經被 `SearchOverlay.test.tsx` 當純函式在測(`viewFor(...)` 直呼)。
// 🛑 **`viewFor` 本體逐字搬移、零行為改動。**
// ⛔ ~~原句「下面**每一行**(含註解)都與搬移前相同,只補了 import type」~~
//    **2026-09-03 R1 must-fix 3 訂正:那是假的**,實際有三處不同 ——
//    ① `SearchResultState` 新增了 `facets?: SearchFacets` 欄位(本片要用)
//    ② 新增了那個欄位上方的註解
//    ③ 🔴 **原本掛在 `SearchResultState` 上的 JSDoc 沒有跟過來**(那是 R1 must-fix 4,已補在下面)
//    ⇒ 📌 **「本體逐字」是真的,而「每一行都相同」是我多寫的一個全稱句。**

import type { SearchOverlayItem } from '@/lib/search-shape';
import type { SearchFacets } from '@/lib/search-facets';

/**
 * 這一次查詢的結果。`items === null` = **這一次失敗了**(不是「零筆」)。
 *
 * 🔴 **這段 JSDoc 是 2026-09-03 從 `SearchOverlay.tsx` 補搬過來的**(R1 must-fix 4)——
 *    拆檔時它被留在原處、懸在一句 `export … from` 的上方,而它描述的型別在這裡。
 *    ⇒ 📌 **`items === null ≠ 零筆` 是這支型別唯一的不變式**(`SearchOverlay.test.tsx` 的 G2
 *      整格就是為它寫的)⇒ 讀這支檔的人必須讀得到它。
 *    ⇒ 鐵則 6 逐字:**註解必須跟著它解釋的那段碼搬。**
 */
export type SearchResultState = {
  q: string;
  items: SearchOverlayItem[] | null;
  /** 🔴 與 `items` **同一顆 state** —— 兩顆分開的 state 表達不了「同一次量測」,
   *  而那正是 `codex R2 must-fix 1` 修過的病(狀態脫離查詢字)。 */
  facets?: SearchFacets;
};

/**
 * 現在這個查詢該畫什麼。**render 只吃這一個函式的回傳。**
 *
 * 🔴 **為什麼把 `status` 從 render 判斷裡整個拿掉**(codex 2026-09-02 R2 must-fix 1):
 *   `status` 是一顆**不帶查詢字**的 state ⇒ 它答得出「上一次成功還是失敗」,
 *   答不出「上一次是**哪一個查詢**的成功或失敗」。
 *   R1 的修法只把【成功】那一半綁上查詢,而**失敗那一半漏了** ⇒
 *   搜尋失敗之後改字或清空,effect 跑之前那一次 render 仍然畫著舊的錯誤訊息;
 *   清空時甚至「熱門搜尋」與「搜尋暫時無法使用」**同時出現**。
 * 📌 **⇒ 同一個病修了一半,而修好的那一半讓它更難被看見** ——
 *    R1 之後成功那條路不再出錯了,於是沒有人會再懷疑失敗那條路。
 *
 * 🔴 **抽成具名函式的理由**(2026-09-02 突變實測逼出來的):
 *   這個判斷守的是 **render 與 effect 之間**那一次 render —— React 先 render 再跑 effect,
 *   而 testing-library 看到的永遠是 effect 跑完之後的 DOM ⇒ **那一幀在 DOM 那一端沒有形狀**。
 *   寫在 render 裡的話,拿掉它**測試照樣全綠**。抽出來,測試才有一個【不經過 DOM 的入口】。
 */
export function viewFor(
  result: SearchResultState | null,
  q: string,
): { kind: 'pending' } | { kind: 'failed' } | { kind: 'ok'; items: SearchOverlayItem[] } {
  // 沒有結果,或結果屬於別的查詢 ⇒ 一律當「還在路上」,不畫任何舊東西。
  if (result === null || result.q !== q) return { kind: 'pending' };
  if (result.items === null) return { kind: 'failed' };
  return { kind: 'ok', items: result.items };
}
