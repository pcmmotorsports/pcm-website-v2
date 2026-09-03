import type { AdminOrderLine, AdminOrderSummary } from '@pcm/domain';
import {
  INVOICE_STATUS_LABEL,
  MEMBER_TIER_LABEL,
  formatOrderItemVehicle,
  formatOrderListDate,
  taipeiParts,
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
  /* 🔴 `#24`(2026-08-26 Sean 要求)—— 他自由打的字逐字:
       「按鈕成功匯出，但是少了客人詳細資訊」/「客人的 姓名,電話,地址」/「放在最後一欄」
     ⇒ **放最後**是他指定的位置, 不是我挑的。

     🔴🔴 **欄名【只描述它是什麼, 不描述它可以拿來做什麼】** ——
        `#24` 片B 踩過:上面那個「訂單總額(每單只出現一次, **可直接加總**)」的
        「可直接加總」在會計於 Excel 篩選/隱藏列之後**就不成立了**
        ⇒ **一句比實際成立範圍更大的話, 比不寫更危險**:沒寫他會小心, 寫了他不會。
     ⇒ 所以這三欄只寫「每單只有一個」—— 那是**事實**(一張單一個收件人), 不是用法。

     ⚠️ **而這三欄是【下單當下的快照】, 不是客人現在的地址**(理由與量法見
        `AdminOrderSummary.shippingAddress` 的 docstring)⇒ 對帳要的正是這個。 */
  '收件人姓名(每單只有一個)',
  '收件人電話(每單只有一個)',
  '收件地址(每單只有一個)',
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

/**
 * 一張**沒有任何品項**的單, 在 CSV 裡佔一列, 而那一列的料號欄放這句話。
 *
 * 🔴 **不是 `—`**:`—` 與「這件貨的料號是空的」在同一欄裡長得一樣 ⇒ 佔位列會被讀成一筆真品項。
 * ⚠️ 用**半形**括號(實查 `od -c` ⇒ `(` = 0x28 / `)` = 0x29)。兩件都核過:
 *    · 不以 `= + - @` / tab / CR 開頭 ⇒ `escapeCell` 的公式注入守門不會動它, 試算表也不會當公式跑
 *    · 不含逗號 / 雙引號 / 換行 ⇒ 不會觸發整格包引號, CSV 形狀不變
 */
const NO_LINES_MARK = '(本單無品項)';

/** 把一頁訂單攤平成「每品項一列」,欄序同 `ORDER_EXPORT_COLUMNS`。 */
export function buildOrderExportRows(orders: AdminOrderSummary[]): string[][] {
  const rows: string[][] = [];
  for (const order of orders) {
    // 🔴🔴 **這一欄是【給人看的文字】,不是可以拿去判斷的值。**
    //   `orderStatusView` 內部把「摘要列不存在」當成 0(`order-status-axes.ts:244` 的 house 裁定:
    //   純顯示補 0 可接受、**守門/上限/可否取消的判斷絕不可補 0**)。
    //   ✅ 本檔只取 `.label` 塞進一欄,**不餵任何判斷**;而**金額欄不經過這支**
    //      (單價/小計/總額各自直接取 `amount`)⇒ 那個 `?? 0` 碰不到任何一個錢的數字。
    //   ⚠️ **殘餘風險我自己講**:這份 CSV 的用途是**對帳**,而一個顯示語意的欄位坐在對帳檔裡,
    //      很容易被下一個人當成權威。
    //   🔴 **若哪天有人拿這一欄去做篩選、對帳判斷或自動化 ⇒ 上面那個判斷當場作廢,要重做。**
    //   (同一段話在 `order-status-axes-importers.test.ts` 的白名單旁邊也有一份 ——
    //    兩邊都寫,因為讀的人只會讀到其中一邊。)
    const status = order.itemsTruncated ? '未知' : orderStatusView(order).label;
    const date = formatOrderListDate(order.createdAt);
    const customer = order.customerName ?? EMPTY;
    const tier = MEMBER_TIER_LABEL[order.tierAtCheckout];
    const invoice = INVOICE_STATUS_LABEL[order.invoiceStatus];
    // 🔴🔴 **這三行 2026-08-27 走過一次錯路, 過程留著, 因為那個錯很好看:**
    //    `7489aada` 引進它們時是 `order.shippingAddress.name`, 而全套 admin 有 **6 格** 當場
    //    `TypeError: Cannot read properties of undefined` —— 那顆的 commit body 逐字
    //    「admin 測試連跑兩發…**紅 0 —— 兩發完全相同**」。
    //    📌 **兩發確實相同, 而兩發都只跑了 `126 passed | 1 skipped (127)` 這個分母;全套是 282 支檔。**
    //      ⇒ **「連跑兩發比總數」防的是漏跑, 防不了【分母一開始就選窄】** —— 窄的分母跑兩次還是窄的。
    //
    // ⚠️ **我第一版的修法是加 `?.`, 而 codex 對抗審查判那是錯的, 我同意並改掉了。**
    //    它的理由:`AdminOrderSummary.shippingAddress` 型別是**必填**, 而唯一的 production producer
    //    `mapSupabaseAdminOrderRowToSummary`(`packages/adapters/src/supabase/mappers/order.ts:405`)
    //    走 `pickShippingAddress`, 而它 `:1114-1120` **永遠回一個物件** ⇒ 真資料不可能是 undefined。
    //    ⇒ **`?.` 是永遠不會走到的分支, 而它唯一的作用是讓【違反型別的測試 fixture】安靜地過。**
    //      那正是本 repo 反覆記到的形狀:**把訊號關掉, 而關掉的方式看起來像變得更安全。**
    //    ⇒ 正解是**去修那些 fixture**(`app/orders/page.test.tsx` 與
    //      `app/@panel/order-panel-wiring.test.ts` 各補上這一欄), 不是在生產碼上長一個假的守門。
    // 🔴 `||` 不是 `??`(⟦b4-PICKPHONE1⟧ · code-reviewer 2026-09-03 must-fix)——
    //    ⛔ ~~我原本判「`?? EMPTY` 結果一樣所以不必改」~~ **那個前提是假的**:
    //    同檔 `:111` 逐字 `const EMPTY = '—'`(**不是空字串**)
    //    ⇒ phone 是 `''` 時 `'' ?? EMPTY` 得到 `''` ⇒ **CSV 的電話欄印一片空白**, 而不是 `—`
    //    ⇒ 📌 我把一個沒查過的假設當成了「結果一樣」, 而那正是這一片在修的同一個病。
    const recipientName = order.shippingAddress.name || EMPTY;
    const recipientPhone = order.shippingAddress.phone || EMPTY;
    const recipientLine = order.shippingAddress.line ?? EMPTY;
    // 🔴🔴 **品項是空陣列時, 這張單【整筆從 CSV 消失】—— 2026-08-27 補審抓到的。**
    //    ~~原本直接 `order.lines.forEach(...)`~~ ⇒ `lines: []` 跑零次 ⇒ 這一單一列都不產出,
    //    **連 `訂單總額` 一起消失** ⇒ 對帳的人 SUM 起來少一筆, 而**檔案上零訊號**。
    //    ⚠️ 而 `orderExportBlockedReason` 攔不到它:那道閘只看 `itemsTruncated`
    //       (「品項太多沒載完」), **不看「品項是空的」** ⇒ 兩種都是「資料半份」而只擋了一種。
    //    📌 **這正是本檔自己反覆在講的那個形狀:錯的那次和對的那次長得一樣。**
    //       ⇒ 所以這裡選擇**印一列出來**(品項欄全部 `—`), 不是靜靜跳過:
    //         一列「有單號、有總額、品項是破折號」的列, 員工看得出不對勁;少一列, 沒有人看得出來。
    // ⚠️ **`line` 為 `null` 的那一列不是常態** —— 正常的單一定有品項。
    //    它是**防禦性的**, 而它的存在不代表我們知道怎麼會生出這種單。
    const linesOrPlaceholder: (AdminOrderLine | null)[] =
      order.lines.length > 0 ? order.lines : [null];
    linesOrPlaceholder.forEach((line, i) => {
      rows.push([
        // 🔴 訂單層的識別欄**每列都重複**,而畫面只在第一列印。
        //    這是刻意的:CSV 會被排序與篩選,而**排序會把第一列跟它的續列拆開** ——
        //    留空的話,續列會變成一列不知道屬於誰的品項。
        //    ⚠️ 而「訂單總額」**不在**這條規則裡(見 `orderTotalCellFor`)。
        order.displayId,
        date,
        line ? (formatOrderItemVehicle(line.vehicle) ?? EMPTY) : EMPTY,
        line ? (line.brand ?? EMPTY) : EMPTY,
        // 🔴 佔位列的**料號欄寫一句人話**, 不是 `—`(2026-08-27 codex 對抗審查 must-fix)。
        //    理由:`—` 在這一欄與「這件貨沒有料號」長得一樣 ⇒ 佔位列會被下游當成**一筆真的品項**。
        //    這一欄是唯一不可能有合法空值的品項欄(`variantSku` 型別非 null)⇒ 放在這裡最不會被誤讀,
        //    而且**不必為此多開一個欄位**(多開欄會改 CSV 形狀, 那是另一片)。
        line ? line.variantSku : NO_LINES_MARK,
        line ? (line.title ?? EMPTY) : EMPTY,
        line ? String(line.quantity) : EMPTY,
        line ? moneyCell(line.unitPrice.amount) : EMPTY,
        line ? moneyCell(line.lineTotal.amount) : EMPTY,
        orderTotalCellFor(order, i === 0),
        customer,
        tier,
        status,
        invoice,
        /* 🔴 收件人三格【每一列都重複】, 與單號/日期/客戶同一條規則 ——
           理由同上面那段:CSV 會被排序與篩選, 而排序會把第一列跟它的續列拆開
           ⇒ 留空的話, 續列會變成一列不知道要寄給誰的品項。
           ⚠️ 而它與「訂單總額」那一欄【刻意不同】:那一欄留空是為了 SUM 不重複算,
              而這三欄不是數字, 重複它不會讓任何加總出錯。 */
        recipientName,
        recipientPhone,
        recipientLine,
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
  /* 🔴🔴 **公式注入**(2026-08-26 審查抓到, `#24` 收件人三欄一併修)——
     試算表軟體看到一格以 `= + - @` 或 tab/CR 開頭, 會把它當**公式**跑, 不是當文字顯示。
     ⇒ 地址與電話是**客人自己在結帳時打的**, 而這份檔的用途就是「用 Excel 開起來對帳」。
     ⚠️ 這不是這三欄帶來的病 —— `客戶` / `物品名稱` 早就同病(它們也是客人可控)。
        本片一次修在**共用的 escapeCell**, 而不是只擋新的那三欄:
        只擋新欄的話, 舊欄仍然開著, 而下一個人會以為「已經修過了」。
     修法 = 前綴一個單引號。Excel / Numbers / Google Sheets 都把它當「這格是文字」的逃脫,
     而那個引號**不會顯示在儲存格裡**。⇒ 對帳的人看到的字沒變。 */
  /* 🔴 **第二種病, 而它與公式注入【不是同一件事】**(2026-08-26 codex must-fix)——
     `0912345678` 沒有任何危險字元, 而試算表會把它當**數字**:
     開頭的 `0` 被吃掉 ⇒ 變 `912345678`;更長的會變科學記號。
     ⇒ **對帳的人拿到一份電話全錯的檔, 而檔案本身沒有任何異常。**
     📌 **公式注入是「它做了不該做的事」, 這個是「它安靜地改了值」** —— 後者更難發現,
        因為前者至少會有一格長得很奇怪。
     判準用「以 0 開頭的純數字」而不是「電話欄」:欄位會增加, 而這個病跟著**值的形狀**走,
     不跟著欄名走(訂單編號、統編、郵遞區號都可能長這樣)。 */
  const numericLeadingZero = /^0\d+$/.test(value);
  const guarded = /^[=+\-@\t\r]/.test(value) || numericLeadingZero ? `'${value}` : value;
  if (!/[",\r\n]/.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
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

/**
 * 檔名帶日期,員工一天匯好幾次時不會互相蓋掉。`now` 可注入 ⇒ 測試不吃真時鐘。
 *
 * 🔴 **日期走 Asia/Taipei 曆面, 不走機器本機時區**(2026-08-27 `#24` 補審 must-fix)——
 *    ~~原本用 `getFullYear` / `getMonth` / `getDate`~~ = **跑這支的機器在哪個時區**。
 *    失敗情境:server TZ=UTC(Vercel node 預設),台北 2026-08-27 07:00 按匯出
 *    ⇒ UTC 還是 08-26 ⇒ 檔名 `訂單商品-20260826.csv`,**一份對帳檔標成前一天**。
 *    📌 而它在【開發機上永遠是對的】—— 這台機器的 TZ 就是 `Asia/Taipei`
 *       (`Intl.DateTimeFormat().resolvedOptions().timeZone` ⇒ `Asia/Taipei`, 2026-08-27 量)
 *       ⇒ **本機怎麼測都綠, 只有部署到 UTC 的機器上才會錯**, 而那時沒有人在看檔名。
 *    ⇒ 同模組的日期面(`formatOrderListDate` / 日期篩選)本來就走台北曆面,
 *      只有這一支沒跟上 ⇒ **這不是新規則, 是本檔漏掉的那一格。**
 */
export function orderExportFilename(now: Date): string {
  const { year, month, day } = taipeiParts(now);
  return `訂單商品-${year}${month}${day}.csv`;
}
