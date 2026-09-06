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

// 🔴🔴 **車款清單讀不到時對客人講的那一句 —— 全站【單一定義點】。**(2026-09-06 線 `front`)
//   Sean 2026-09-06 拍甲:四處(首頁選車 / 型錄側欄 / 商品頁車款區 / 購物車)都要講,
//   而**用站內已經在線上的那一句**, 不新編一句。
//   🔵 它原本 inline 在 `apps/storefront/src/app/account/vehicle/actions.ts` 裡 ——
//      本片把它抽出來, 那一處改成 import。
//   🛑 **為什麼一定要單一定義點**:`packages/domain/src/catalog/supplier-placeholder.ts`
//      檔頭逐字警告過「複製成兩份 ⇒ 它們會分岔, 而分岔不會紅」。
//      ⇒ 守門在 `products-message-state.test.tsx`:repo 裡這個字面只有這一個定義處。
//   ⚠️ 逗號用全形「,」—— 那是原句的字面, 照抄不改(改了守門會紅, 而那是對的)。
export const VEHICLE_TAXONOMY_UNAVAILABLE = '車款清單暫時無法載入,請稍後再試或改用自行輸入';

// 🔴🔴 **另外兩扇門的同一句話**(2026-09-06 · ⟦search-SILENTDOORS2⟧ · 主視窗裁「同句延伸」)。
//   🛑 **而「同一句」在這裡【不能逐字照抄】, 理由寫下來**:
//      車款那句的尾巴是「**或改用自行輸入**」—— 那是因為帳號那邊**真的有**自由輸入車款那條路
//      (`app/account/vehicle/actions.ts` 的 dict 雙 null 路徑)。
//      而**分類與品牌沒有自行輸入** —— 側欄是一份固定清單。
//   ⇒ 🔴 照抄那個尾巴 = **告訴客人一條不存在的路**。⇒ 只延伸前半, 尾巴去掉。
//   📌 **這一格不是我改了主視窗的裁示, 是那個裁示的字面在這裡有一半不成立** —— 標在這裡, 不藏。
export const CATEGORY_TAXONOMY_UNAVAILABLE = '分類清單暫時無法載入,請稍後再試';
export const BRAND_TAXONOMY_UNAVAILABLE = '品牌清單暫時無法載入,請稍後再試';
/**
 * 🔴 ⟦search-SILENTDOORS2⟧ 2026-09-07:側欄的**件數**取不到時的那一句。
 *   ⚠️ **措辭刻意與上面三句不同** —— 上面三句是「**清單**載不到」(整區沒東西),
 *   而這一句是「**清單在、只是每個項目後面的數字沒了**」⇒ 說成「清單無法載入」會嚇到客人,
 *   而他明明看得到分類與品牌。📌 **兩種故障長得不一樣, 文案就不該一樣。**
 *
 * 🔴🔴 **而它【只講量到的那一件事】, 不承諾別的門 —— 那一半是被砍掉的, 理由寫在這裡。**
 *   ⛔ 第一版寫的是 ~~`'件數暫時無法顯示,分類與品牌仍可正常篩選'`~~。
 *   🛑 **後半那句在【三扇同壞】時是【假的】** —— 同檔上面三句正是那三扇門, 而
 *   `ProductsPage.tsx` 自己逐字寫過「三扇門**共用同一個 Supabase, 很可能一起壞**」
 *   ⇒ 📌 **客人會同時讀到「分類清單暫時無法載入」與「分類仍可正常篩選」。**
 *   ⇒ ⇒ 🔵 **那不是文案品味, 是【一個可以為假的宣稱】** ⇒ 主視窗 `-B` 2026-09-07 05:3x 裁
 *      「**直接拿掉, 只講量到的**」—— **未端 Sean, 因為它不是品味題。**
 *   🎯 **可帶走的形狀**:**一句安慰的話, 只要它宣稱了你沒有量到的東西, 就是一個會說謊的宣稱。**
 */
export const FACET_COUNTS_UNAVAILABLE = '件數暫時無法顯示';

/**
 * **一份清單讀不到時, 對客人講的那一行字。** 受詞由 `message` 決定(車款 / 分類 / 品牌各一句)。
 *
 * 🔴 **`failed === false` 一定回 `null`, 即使清單是空的** —— 這是整件事的全部重點:
 *   「讀不到」與「真的沒有」要畫成兩種東西。
 *   ⇒ 📌 **每一格 smoke 都要配一個「空而沒失敗」的負對照** —— 否則一個無條件顯示的實作會全綠。
 *
 * 🛑 **它是【一個 block 元素】** —— 掛在 `display:grid` 的容器底下會吃掉一個格子。
 *   ⇒ 放進 grid 之前先包一層 `grid-column: 1 / -1`(`ProductsPage.tsx` 那兩顆就是這樣)。
 *   🔬 2026-09-06 code-reviewer R1 Critical 就是這一格:少了那層包裝, **只有一扇失敗時**桌機版面錯位,
 *      而四支既有 jsdom 測試**全綠**(jsdom 不做版面)。
 *   🔴🔴 **守門【是兩把尺, 分工要講清楚】**(2026-09-06 R2 must-fix ——
 *      我原本只寫「守門在 browser 那支」, 而那句是**字面不等於事實**):
 *        · **這個元件有沒有包那層容器** ⇒ `ProductsPage.test.tsx`(jsdom, 斷言 `parentElement.style.gridColumn`)
 *        · **那條 CSS 規則會怎麼排** ⇒ `products-layout-grid-browser.test.tsx`(真 chromium)
 *      🛑 **少了前者**:browser 那支是自己餵字串 DOM、**沒有 import `ProductsPage`**
 *         ⇒ 把真元件那層容器刪掉, **兩邊都照樣綠**(2026-09-06 實測 4 passed / 56 passed)。
 *      📌 **一支測試證明了「那條規則會這樣動」, 不等於證明「這個元件有那樣寫」。**
 *
 * 🔵 **樣式沿用站內既有那組**(`MESSAGE_STATE_STYLE` + `role="alert"`)。
 *   鐵則 1 兩半都查過:`design-reference`(176 檔)**沒有**這一態;
 *   ⛔ ~~而我一度就此寫「稿裡查無此態」~~ ⇒ 🔴 **那句只查了一半** ——
 *   **OD 那半【有】**:`pcm-home-redesign/products-list-page.html` 逐字
 *   `<div id="pp-error" role="alert" style="padding:64px 0;text-align:center;color:var(--c-text-3);font:14px/1.6 system-ui, sans-serif" hidden>載入失敗、請稍後再試</div>`
 *   ⇒ **本檔的 `MESSAGE_STATE_STYLE` 與它逐字相同** ⇒ 不是「不發明」, 是**用的就是稿上那一個**。
 */
export function TaxonomyNotice({ failed, message }: { failed?: boolean; message: string }) {
  if (!failed) return null;
  return (
    <div style={MESSAGE_STATE_STYLE} role="alert">
      {message}
    </div>
  );
}

/**
 * **車款那一扇的既有進入點** —— 四處共用同一顆:首頁選車 / 型錄側欄 / 商品頁車款區 / 購物車。
 *
 * 🔵 **保留它是為了讓那四個呼叫端一個字都不用改** —— 2026-09-06 加另外兩扇時,
 *   把判斷抽成上面那顆通用的, 而**這一層留著當 delegate**:
 *   已經上線並過了兩輪審查的那一扇, 不在「加兩扇」這一片裡重寫。
 * 🔴 **而那句話的尾巴「或改用自行輸入」是【車款專屬】的** —— 帳號那邊真的有自由輸入車款那條路
 *   (`app/account/vehicle/actions.ts`);分類與品牌**沒有**, 所以它們那兩句沒有尾巴。
 *   守門在 `products-message-state.test.tsx`(那兩句不得含「自行輸入」, 而這一句要含它)。
 */
export function VehicleTaxonomyNotice({ failed }: { failed?: boolean }) {
  return <TaxonomyNotice failed={failed} message={VEHICLE_TAXONOMY_UNAVAILABLE} />;
}

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
