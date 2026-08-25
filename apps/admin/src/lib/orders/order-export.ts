import type { AdminOrderSummary } from '@pcm/domain';
import {
  INVOICE_STATUS_LABEL,
  MEMBER_TIER_LABEL,
  formatOrderItemVehicle,
  formatOrderListDate,
} from './order-list-view';
import { orderStatusView } from './order-status-axes';

// order-export.ts — `#24` 片A:訂單列表「匯出商品」的**純資料層**。
//
// 🔴🔴 **本檔不碰 DOM、不碰 Blob、不碰下載** —— 它只把 `AdminOrderSummary[]` 變成一份表格。
//    下載那一半是片B(`components/orders/order-export-button.tsx`)。
//    分開的理由不是潔癖:**「匯出的數字對不對」與「瀏覽器存不存得下來」是兩件事**,
//    而前者要能在 node 環境裡被逐格比對,後者不行。
//
// 🔴🔴 **一致性的宣稱是【單向】的,不要讀成雙向:**
//      「**畫面上有的每一格值,都在 CSV 對應欄找得到**」—— 反向不成立。
//    為什麼反向不成立,見下面 `shouldMergeAmount` 那一段:畫面在多品項單上**不顯示每列小計**,
//    而 CSV 每列都填 ⇒ CSV 裡會有畫面上沒出現過的數字。
//    ⚠️ **所以本檔任何地方都不得寫「與畫面一致」** —— 那句話是假的,而它剛好是最好聽的那句。
//
// 🔴 **格式化一律呼叫畫面用的同一批函式**(`formatOrderListDate` / `formatOrderItemVehicle` /
//    `MEMBER_TIER_LABEL` / `INVOICE_STATUS_LABEL` / `orderStatusView`)。
//    重寫一份的話,兩邊會**各自為真**地漂走,而漂走的那天沒有任何訊號。

/**
 * 欄序 = 訂單列表桌機表頭的順序(`orders-table.tsx:761-784`),外加兩欄:
 * · `會員等級` —— 畫面上它是客戶格底下的小字,不是獨立欄
 * · `訂單總額` —— 畫面上它與「小計」**共用同一欄**(見下),CSV 拆成兩欄
 */
export const ORDER_EXPORT_COLUMNS = [
  '單號',
  '日期',
  '車種',
  '廠牌',
  '料號',
  '物品名稱',
  '數量',
  '單價',
  // 🔴🔴 **這兩欄的差別寫在【欄名裡】,不是寫在 commit body。**
  //    理由(主視窗 2026-08-25 逐字):「**拿去對帳的人不會讀 commit body。** 他手上只有那個檔。」
  //    ⇒ 限制要寫在**會被讀到的載體**上;寫在別處對他而言等於不存在。
  '小計(每列都有)',
  '訂單總額(每單只出現一次,可直接加總)',
  '客戶',
  '會員等級',
  '狀態',
  '發票',
] as const;

/**
 * 🔴🔴 **這一片真正的風險在這裡,不在那顆鈕。**
 *
 * 訂單列表的「金額」欄在畫面上**是兩種東西**(`orders-table.tsx:175` `shouldMergeAmount`):
 * ```
 * merge 為真(多品項 / 任一 qty>1 / itemsTruncated) ⇒ 印【訂單總額】,只在該單第一列
 * merge 為假(單品項單數量)                          ⇒ 印【該列小計】,表頭 data-l 變「小計」
 * ```
 * ⇒ 一份天真的 CSV「每列都倒 lineTotal」會產生**畫面上沒出現過的數字**;
 *   而若訂單總額又被每列重複,有人 SUM 下去就是**雙重計算**。
 *   而這份檔的用途逐字是「**會被人拿去對帳**」。
 *
 * ⇒ 本檔的規則,兩欄各自可安全加總:
 * ```
 * 小計欄     = line.lineTotal   【每列都填】
 * 訂單總額欄 = order.total      【只填該單第一列,續列留空】 ⇒ 直接 SUM 不會重複算
 * ```
 * ⚠️ 「續列留空」與畫面的 merge 行為**同構,但不同因**:畫面留空是為了視覺分組,
 *    這裡留空是為了**加總正確**。兩者哪天分家的話,是這裡要跟著對帳走,不是跟著畫面走。
 */
function orderTotalCellFor(order: AdminOrderSummary, isFirstLine: boolean): string {
  return isFirstLine ? String(order.total.amount) : '';
}

/**
 * 錢與數量欄**輸出原始整數**(沒有 `NT$`、沒有千分位),而畫面上是 `NT$ 1,234`。
 *
 * 🔴 **這是刻意與畫面不同的一格,不是漏了 formatter。** 理由:這份檔存在的唯一目的是被拿去
 *    對帳 —— 而 `NT$ 1,234` 進試算表是**文字**,加不起來。值是同一個值,只是不穿衣服。
 * ⚠️ 代價明講:員工把 CSV 跟畫面並排看時,金額欄**長得不一樣**。
 *    ⇒ 片B 的逐格比對測試必須把這一格寫成「經 `formatOrderAmount` 之後相等」,
 *      **不是**「字串相等」—— 否則那發測試會紅在一個刻意的差異上,然後被改成不比金額。
 */
function moneyCell(amount: number): string {
  return String(amount);
}

/**
 * 畫面上空值印 `—`(全形破折號),CSV 照抄。
 *
 * 🔴 **沒有改成空字串**:改了的話,上面那句單向宣稱(畫面有的值 CSV 找得到)就破了,
 *    而破的方式是**安靜的** —— 兩邊都「看起來合理」。要改要連同那句宣稱一起改。
 */
const EMPTY = '—';

/** 把一頁訂單攤平成「每品項一列」,欄序同 `ORDER_EXPORT_COLUMNS`。 */
export function buildOrderExportRows(orders: AdminOrderSummary[]): string[][] {
  const rows: string[][] = [];
  for (const order of orders) {
    const status = order.itemsTruncated ? '未知' : orderStatusView(order).label;
    const date = formatOrderListDate(order.createdAt);
    const customer = order.customerName ?? EMPTY;
    const tier = MEMBER_TIER_LABEL[order.tierAtCheckout];
    const invoice = INVOICE_STATUS_LABEL[order.invoiceStatus];
    order.lines.forEach((line, i) => {
      rows.push([
        // 🔴 訂單層的識別欄**每列都重複**,而畫面只在第一列印。
        //    這是刻意的:CSV 會被排序與篩選,而**排序會把第一列跟它的續列拆開** ——
        //    留空的話,續列會變成一列不知道屬於誰的品項。
        //    ⚠️ 而「訂單總額」**不在**這條規則裡(見 `orderTotalCellFor`)。
        order.displayId,
        date,
        formatOrderItemVehicle(line.vehicle) ?? EMPTY,
        line.brand ?? EMPTY,
        line.variantSku,
        line.title ?? EMPTY,
        String(line.quantity),
        moneyCell(line.unitPrice.amount),
        moneyCell(line.lineTotal.amount),
        orderTotalCellFor(order, i === 0),
        customer,
        tier,
        status,
        invoice,
      ]);
    });
  }
  return rows;
}

/**
 * 🔴🔴 **fail-closed:資料本身是半份的時候,不給匯出。**
 *
 * `itemsTruncated` 的意思是 `order.lines` **本身就是半份的**
 * (`ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT = 500`,見 `orders-table.tsx:154-160`)。
 * ⇒ 此時匯出會產出一份**看起來完整、實際少了品項**的對帳檔,而**檔案上沒有任何地方會說**。
 * ⇒ 這正是本 repo 反覆記到的那個形狀:**錯的那次和對的那次長得一樣**。
 *   所以這裡選擇擋掉、並且把理由講出來,而不是加一欄旗標讓人自己看見。
 *
 * ⚠️ 代價很小:要 `itemsTruncated` 得單筆訂單超過 500 個品項。
 *    ⇒ 這道閘幾乎永遠不會擋到人,而它擋到的那一次正好是最不能出錯的那一次。
 *
 * @returns 不能匯出的理由(要顯示給員工看);可以匯出時回 `null`。
 */
export function orderExportBlockedReason(orders: AdminOrderSummary[]): string | null {
  const truncated = orders.filter((o) => o.itemsTruncated);
  if (truncated.length === 0) return null;
  return `這一頁有 ${truncated.length} 張單的品項沒有全部載入(單號 ${truncated
    .map((o) => o.displayId)
    .join('、')}),匯出會少東西 ⇒ 先點進那幾張單看,不要拿這份檔對帳。`;
}

/**
 * 一格的 CSV 逃脫:含逗號 / 雙引號 / 換行 ⇒ 整格包引號,格內引號**變兩個**。
 *
 * 🔴 為什麼不能只逃逗號:品名裡出現一個 `"` 而沒有逃脫的話,**後面整份檔會被解析器往後吃**,
 *    而它不會報錯 —— 它會給你一份少了很多列、而每一列看起來都正常的表。
 */
function escapeCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** BOM —— 沒有它,Excel 開 UTF-8 的中文會變亂碼(而 Numbers 與試算表軟體不會)。 */
export const CSV_BOM = '﻿';

/**
 * 表頭 + 資料列 ⇒ 一份 CSV 字串。
 *
 * 🔴 換行用 CRLF:RFC 4180 這樣寫,而 Excel 對 LF-only 的多行儲存格會拆錯列。
 */
export function toCsv(header: readonly string[], rows: readonly string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(','));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** 片B 只會呼叫這一支。 */
export function buildOrderExportCsv(orders: AdminOrderSummary[]): string {
  return toCsv(ORDER_EXPORT_COLUMNS, buildOrderExportRows(orders));
}

/** 檔名帶日期,員工一天匯好幾次時不會互相蓋掉。`now` 可注入 ⇒ 測試不吃真時鐘。 */
export function orderExportFilename(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `訂單商品-${y}${m}${d}.csv`;
}
