import type { AdminOrderSummary } from '@pcm/domain';
import {
  ORDER_EXPORT_COLUMNS,
  buildOrderExportRows,
  orderExportFilename,
  toCsv,
} from './order-export';

// order-export-page.ts — `#24` 片B 的**接線層**:把片A 的零件組成「這一頁的那份檔」。
//
// 🔴🔴 **為什麼這一段住在這裡, 而不是塞進 `order-export.ts`** ——
//    片B 的 plan §1 逐字寫著「**不改 `order-export.ts`**」(Sean 批的),
//    而 §4 要求「檔名帶頁碼」與「CSV 第一列加自述」。
//    我第一版判「§1 必須是錯的」、直接改了片A 那支檔。
//    ⇒ **codex 對抗審查指出:那不是被迫的。** `toCsv` 本來就是公開的
//      (片A `c57235e9` 就 export 了), 而它內部已經處理逃脫
//      ⇒ **接線層自己組得出來, 片A 一行都不用動。**
//    🔴 而更重的是治理那一半:**我發現一份【已批准的 plan】內部矛盾, 然後自己挑了一邊。**
//      正確動作是停下來把 plan 修好、重新取得批准。
//      我當時把它寫進 commit body 當「誠實揭露」——**而揭露不等於授權。**
//    ⇒ 主視窗 2026-08-26 裁「還原」, 理由不是技術:
//      **兩者的產出對員工完全一樣 ⇒ 那麼唯一的差別就是【誰授權了這個範圍變更】。**
//
// 📌 形狀:**「不改那支檔」這個限制, 逼出來的位置反而更對** ——
//    「這一頁的那份檔長什麼樣」本來就是**頁面的事**, 不是那支純函式的事。

/** 這一份檔的脈絡 —— 🔴 它進**檔案內容**, 不只進檔名(檔名會被改, 內容不會)。 */
export type OrderExportContext = {
  page: number;
  /**
   * 這一頁套了什麼篩選。
   *
   * 🔴🔴 **這一版一律傳空字串, 而那是刻意的**(code-reviewer `C1` 抓到的真 bug):
   *    上一版寫 `Object.keys(filter).length === 0 ? '' : '已套用篩選'`,
   *    而 `filter`(`order-list-view.ts:405-434`)是**固定 9 鍵的物件字面量** ——
   *    值可以是 `undefined` 而**鍵永遠在** ⇒ 那個判斷**恆為 false**
   *    ⇒ 連裸 `/orders` 也會寫「已套用篩選」。
   * 🔴 **而它通過了我的真瀏覽器實跑** —— 那一發拿到的檔名逐字就是「…-已套用篩選.csv」,
   *    而我沒有問「我剛剛有套篩選嗎」。**一個恆定值印出來的東西看起來完全合理。**
   * ⇒ 要算真值必須排掉 `undefined` / `false` / 日期預設 —— 那是**下一片**的事。
   *   **這一版寧可不講, 不要講一句恆真的話。**
   * ⚠️ 而下一片接真值時:**keyword 不得進來** ——
   *   `app/orders/page.tsx` 記著「搜尋詞是 PII」(所以它走 httpOnly cookie、不進 URL),
   *   而本欄會進**檔名**與**檔案第一列**。
   */
  filterNote: string;
  /**
   * 🔴 **叫 `dataAsOf` 不叫 `exportedAt`, 而那不是命名偏好**(code-reviewer `C2`):
   *    第一版在**點擊當下**取時間, 而資料是**頁面 render 當下**查的。
   *    員工 11:30 開頁、14:30 才按 ⇒ 檔案寫「匯出於 14:30」而每一格都是 11:30 的
   *    ⇒ **一個舊資料蓋上新時間**。對一份對帳檔, 那是關於【資料新鮮度】的假宣稱。
   *    ⇒ 現在它由 **server 端在 render 時**填 ⇒ 值與資料同一時刻, 名字也講的是那件事。
   */
  dataAsOf: string;
};

/**
 * CSV 的第一列不是表頭, 是**這個檔對自己的說明**(Sean 2026-08-26 批 `Q4=甲`)。
 *
 * **為什麼**:這份檔會被拿去對帳, 而它裡面有一欄(狀態)是**給人看的文字, 不是系統對出來的判斷**。
 * 那句限制原本只寫在 code 註解 —— 而**拿去對帳的人手上只有那個檔**, 他永遠讀不到註解。
 * ⚠️ **代價**:用 Excel 開要多按一次「跳過第一列」。端給 Sean 時寫在叫他決定的那一行。
 */
function selfDescription(ctx: OrderExportContext): string[] {
  const filterPart = ctx.filterNote === '' ? '' : ` · 篩選:${ctx.filterNote}`;
  return [
    `本檔 = 後台訂單列表 第 ${ctx.page} 頁${filterPart} · 資料截至 ${ctx.dataAsOf}` +
      ' · ⚠️ 「狀態」欄是給人看的文字,不是系統對出來的判斷;要判斷收款/退款狀態請回後台看。',
  ];
}

/**
 * 這一頁的那份 CSV。
 *
 * 🔴 **走片A 的 `toCsv`, 不自己組一份** —— 抄一份的話, BOM / CRLF / 逃脫會有兩個實作,
 *    而片A 檔頭自己寫著「重寫一份的話, 兩邊會各自為真地漂走, 而漂走的那天沒有任何訊號」。
 *    📌 而抄一份**不會讓測試變紅** —— 它會讓片A 那些逃脫測試**失去對象**。
 */
export function buildOrderPageCsv(
  orders: AdminOrderSummary[],
  ctx: OrderExportContext,
): string {
  return toCsv(selfDescription(ctx), [
    [...ORDER_EXPORT_COLUMNS],
    ...buildOrderExportRows(orders),
  ]);
}

/**
 * 這一頁的檔名 —— 在片A 的檔名上**加頁碼與篩選**, 不改片A。
 *
 * 🔴 **為什麼要加**:只帶日期的話, 同一天匯第 1 頁與第 3 頁會拿到**同一個檔名**
 *    ⇒ 後者蓋掉前者, 而**瀏覽器多半連問都不問**(或悄悄改成 `(1)`)
 *    ⇒ 員工桌面上兩份檔, 而他分不出哪份是哪一頁。
 * ⚠️ `filterNote` 會進檔名 ⇒ **只留中日英數與破折, 其餘一律換成 `-`**。
 *    那不是美觀, 是**不讓一個篩選字串變成一段路徑**。
 */
export function orderPageExportFilename(now: Date, ctx: OrderExportContext): string {
  const base = orderExportFilename(now).replace(/\.csv$/, '');
  const note = ctx.filterNote.replace(/[^\p{L}\p{N}－-]+/gu, '-').replace(/^-+|-+$/g, '');
  const tail = note === '' ? '' : `-${note}`;
  return `${base}-第${ctx.page}頁${tail}.csv`;
}
