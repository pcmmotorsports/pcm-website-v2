// products-message-state.tsx — 目錄頁的「訊息態」(載入失敗 / 找不到商品)共用樣式,
// 與「這一頁的 0 是不是篩選造成的」那道判準。
//
// 🔵 **為什麼獨立成檔(與行數無關的理由)**:`hasCatalogFilterParam` 是一支**純函式**,
//    而它原本住在 `ProductsPage.tsx` 裡、沒有 export ⇒ **沒有任何測試直接呼叫得到它**
//    (R1 對抗審查 2026-09-04 標為 nit)。搬出來之後它**可以被單獨餵輸入**。
// 🛑 **本檔是純位移**:下面每一行(含註解)都是從 `ProductsPage.tsx` 原樣搬來的。
//    ⚠️ **唯一的字元改動 = 兩個 `export`** —— 原本兩個都是檔內私有, 搬出來才需要它。
//
// 🔴 **而我試過再往前一刀、然後撤掉了, 記在這裡**:我一度要把空狀態那塊 JSX 也搬成
//    `ProductsEmptyState` —— 而它需要把 `dispatch(clearAll())` / `setExtras(...)` 換成
//    一個 `onClearAll` callback prop, 並把 `router` / `searchParams` 改成傳進來。
//    🛑 **那不是【搬】, 那是【改設計】** —— 而一個拆檔片裡夾一個改動, 審查看不出
//    哪些是位移哪些是修法。⇒ **停在這裡。要做那一刀, 單獨開一片。**
import type { CSSProperties } from 'react';

// 訊息態(載入失敗 / 找不到商品)共用樣式;沿用原空狀態 inline 字面、不新增 CSS 檔。
export const MESSAGE_STATE_STYLE: CSSProperties = {
  padding: '64px 0',
  textAlign: 'center',
  color: 'var(--c-text-3)',
  font: '14px/1.6 system-ui, sans-serif',
};

// ⟦b4-DEADENDMSG1⟧ 實例③:零結果時要不要給「清除所有篩選」這個出路。
// 判準 = 「**這一頁的 0 是篩選造成的嗎**」, 而那要問【server 拿什麼去撈】, 不是問畫面上有幾顆
// chip —— 認不得的 `?category=<改名殘連結>` 會**留在 URL 上**(#315 Sean 2026-08-11 Q1=A,
// `use-catalog-filter-url-sync.tsx` 的 #315 段, 逐字「**認不得**的 pbrand/category 原樣留著」)而**進不了 cascade** ⇒ ActiveChips 的 `chips.length === 0`
// ⇒ 整條 chip 列(連同它那顆既有的「清除全部」)`return null` ⇒ 🔴 **篩選生效、看不見、清不掉。**
//
// 🔴 **這裡刻意用【黑名單】(排掉非篩選參數), 而不是白名單列出篩選參數** —— 與 CLAUDE.md
//    credential 那條相反, 因為**兩邊漏掉一個新參數的後果方向相反**:
//    · 白名單漏掉一個【日後新增的篩選參數】⇒ 出路又消失, 而**沒有東西會叫**(這一列復發)
//    · 黑名單多算一個【不影響結果的雜參數】⇒ 空目錄時多出一顆按不壞的鈕
//    ⇒ 取後者。
const NON_FILTER_PARAMS = new Set(['page', 'per', 'sort', 'pick']);

export function hasCatalogFilterParam(params: { keys(): IterableIterator<string> }): boolean {
  for (const key of params.keys()) if (!NON_FILTER_PARAMS.has(key)) return true;
  return false;
}
