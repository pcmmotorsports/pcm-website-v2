import { stripPictographs } from '@/lib/print/strip-pictographs';
import { QR_DATA_URI } from './print-assets';
import type {
  AdminOrderDetail,
  AdminOrderDetailFullItem,
  AdminOrderDetailItem,
  AdminOrderPrintItem,
} from '@pcm/domain';
import type { ShipmentRow } from '../../lib/shipping/shipment-repository';
import type { OrderShipmentGroup } from '../../lib/shipping/order-shipments';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { cancelledQuantityOf, outstandingQuantity } from '../../lib/shipping/shipping-doc-quantities';
import {
  lineAmount,
  sectionSubtotal,
  shipmentReadsAreConsistent,
} from '../../lib/shipping/shipping-doc-amounts';
import { carrierLabelOf } from '../../lib/shipping/carrier-label';
// 🔴 `Q-C5`=丙(Sean 2026-08-17):**追蹤碼不印在這張紙上** ⇒ `trackingDisplay` 這裡不再 import。
//    那支函式**沒有刪**(目前零消費端、保留給 `Q-C9` 出貨通知信)——
//    理由在 `shipping-doc-dispatch.ts` 的 `trackingDisplay` docstring。
import { shippedDateText } from '../../lib/shipping/shipping-doc-dispatch';
import { BlockedSheet } from './blocked-sheet';
import { PrintButton } from './print-button';
import { PrintMasthead } from './print-masthead';

// #10 片2b:出貨單(一個箱 × 一張訂單)。
//
// ── 🔴 鐵則 6(元件檔 >400 行預設拆)· 本次【判斷不拆】,理由寫在這裡 ──────────────
// 🔴 **這裡刻意不寫行數。** R2 N5 抓到:我寫「890 行」而當場量是 906(R1 時 872)——
//    **同一輪內漂了兩次**,而它正是「判斷不拆」的依據數字。
//    ⇒ 要現值就當場跑:`wc -l < <本檔>`;要註解比例:數行首為 `//` `*` `{/*` 或落在 `/* */` 內的行。
//    📎 **寫死在註解裡的數字,在下一個人讀到時就過期了** —— 而過期的當下零機械訊號。
//
// 🔴 **不拆的理由不是「註解很多所以不算」** —— 那句話任何超標的檔都講得出來。真正的理由是:
//    **這支檔被【原始碼字面】守門引用著,拆檔會讓那些守門靜默失效或誤紅。** 實查:
//      · `components/print/print-docs-strip-wiring.test.ts:28`
//        斷言 `SHIPPING` 含 `stripPictographs(shipment.recipientSnapshot?.name)`
//      · `app/print/print-a4-css.test.ts` 斷言 `SHIPPING` 含 `'print-sheet mx-auto`
//      · `app/print/orders/[id]/shipping/[shipmentId]/page.test.tsx` 的圖片守門讀本檔全文
//    ⇒ 把 `ItemCells` / `Section` / `MoneyRow` 搬去兄弟檔 = 上面三處要同批改,
//      而**其中兩支不是本線獨佔的檔**。
// ⇒ **拆檔本身要獨立一片**(連同那三道守門的搬遷),不夾帶進一個正在修 review findings 的片。
// ⚠️ **這是延後,不是免除。** 沒拆的代價是真的:下一個人要在 890 行裡找東西。


//
// 🔴 **單位是 `(箱, 訂單)` 這一對,不是「訂單」也不是「箱」。** Sean 2026-08-15 逐字:
//    「一箱只有一個訂單,或者**這個訂單的其中幾樣商品**,就印出**該訂單的要出貨的商品資訊**;
//     如果是這個箱子有兩個訂單放在同一箱,就是**兩張出貨單(一個訂單一張,不用混在一起,
//     這樣會太複雜)**。」
//    ⇒ 這張紙只列**這箱裡屬於這張訂單**的品項。整箱內容不在這裡。
//
// 🔴 **不印商品縮圖 —— 這是 Sean 2026-08-15 拍的,原話**:
//    「**先出沒有圖的版本,圖之後再補**」
//    ⇒ 代替品 = **料號加粗放大**(料號才是倉庫真正拿來對貨的東西;縮圖在單色雷射印表機上會糊)。
//    ⚠️ **不要「順手」把圖補上去**:訂單快照刻意不含圖
//       (`20260604120000_m3_s2a_orders_order_items.sql` 的 exact-key-set CHECK,與經銷價同一道牆),
//       要圖得改 `ADMIN_ORDER_DETAIL_SELECT` —— 那支查詢有四個消費端、且有 byte-equal 守門
//       ⇒ **動它是鐵則 8,要另外提 plan 給 Sean 批,不屬於這一片。**
//
// 🔴 **紙上零金額計算。** 金額欄位只能來自 `AdminOrderDetail` 既有欄或既有格式化器,
//    **不自己加總、不自己格式化**。紙上算錯錢是對客可見的錯。
//    ✅ **金額區塊已於 2026-08-23 片4 落地**(見本檔 `MoneyRow` 與底部的 `.pd-money`):
//       小計 / 運費 / [折扣] / 訂單金額,**每個數字都是 `AdminOrderDetail` 的欄位原值、零運算**,
//       格式化走既有 `formatOrderAmount`(`lib/orders/order-list-view.ts:979`)。
//    ⚠️ ~~「金額區塊目前仍然留空」「這片在金額落地之前不算做完」~~ **兩句都已過期,原句刪除。**
//       🔴 **不是「文件沒更新」而已** —— 那兩句會讓下一個人**不去看金額**,
//          而金額就印在同一支檔的 30 行之下。**它在關掉別人的查證。**(R3 MF3)
//    🔴 **仍然成立、不准鬆的那一半**:紙上零金額**計算** ——
//       禁止從 `subtotal`/`total` 反推、禁止浮點、禁止自己發明算法。
//    🔴🔴 **口徑:Sean 2026-08-24 已答【甲 = 兩區塊各自合計】,而【碼還沒改】。**
//       逐字「甲 照你原本拍的:本次出貨多少 / 取消多少, 兩區各自合計」
//       canonical:`memory/project_0824-sean-shipping-doc-money-per-section.md`(我開檔核過)
//       ⇒ **現況落地的是【訂單層單一合計】,那是【待改】不是【現行設計】。**
//       ⚠️ 連帶:`page.test.tsx` 現在用**突變驗過的算術斷言**把訂單層口徑釘死了
//          ⇒ 落地甲案會撞上「**要動一條綠的測試**」⇒ **走那四問,不要順手改期望值。**
//       ⚠️ ~~「已端 Sean 重裁,在他答之前不要動算法」~~ **原句刪除**(R4 F3):
//          他答了,而那句留著就是**第二個「把下一個人的查證關掉」的字面** ——
//          **而它就寫在修 MF3 的同一段裡。**
//
// 🔴 版面依據:**既有知識 + 本 repo 既有慣例**(片1 的表格形、`orders/order-detail-items-table.tsx` 的 `ItemsTable`)。
//    Sean 說「可以參考網路上通用的出貨單格式」,**但這台沒有網路** ⇒ 我沒有查,也不宣稱查過。
//    美觀交 OD(他逐字「美觀部分到時候再請 OD 優化」)⇒ 本檔只做結構與正確性。

/**
 * 這張紙**不可以印**的原因;`null` = 可以印。
 *
 * 🔴 **為什麼收成一個函式而不是散在 JSX 裡**:這張紙有**八種**「印出來會害人做錯事」的狀態(原寫「六種」,2026-08-16 重數更正 —— 面8 與面2 是後補的,而那句話沒跟),
 * 散著寫的話少一種不會有任何症狀 —— 紙照印、看起來還很正常。收成一處才數得出來、才測得完。
 *
 * 🔴 **順序有意義**:先擋「這張紙根本不該存在」(取消/作廢),再擋「內容不可信」(截斷/對不上),
 * 最後擋「收件資料不能用」。文案要能讓員工知道**下一步做什麼**,不是只說「錯誤」。
 */
export function shippingDocBlocker(args: {
  detail: AdminOrderDetail;
  /**
   * 🔴 **這張單的品項【完整清單】,來自頂層分頁查詢**(`Q-C18` 甲,2026-08-17)——
   * **不是 `detail.items`**。後者是內嵌撈的、被 `ORDER_ITEMS_EMBED_LIMIT = 200` 夾住,
   * 而 Sean 逐字說一張單「可能到 200 個品項」⇒ 那是正常業務的上緣,不是極端值。
   */
  items: readonly AdminOrderPrintItem[];
  /**
   * `count: 'exact'` 在**第一頁**量到的總筆數;`null` = 沒拿到。
   * ⚠️ **它不是「撈完了」的證明**(量在一個瞬間,而迴圈跨多次查詢)——
   * 它是「**有沒有對不上**」的訊號,見面6。
   */
  reportedTotal: number | null;
  shipment: ShipmentRow;
  lines: OrderShipmentGroup['lines'];
}): string | null {
  const { detail, items, reportedTotal, shipment, lines } = args;

  // 面4:整張訂單已取消。
  if (detail.cancelledAt !== null) {
    return `這張訂單已於 ${formatOrderDateTime(detail.cancelledAt)} 取消,不要出貨。`;
  }
  // 面1:箱已作廢。詳情卡**刻意**仍列出作廢箱(`order-shipments.ts:10-11`:讓員工看得到貨回到可出貨池),
  //      所以這裡一定要自己擋 —— 從詳情卡點進來的路徑是通的。
  if (shipment.voidedAt !== null) {
    return `這個包裹已作廢${shipment.voidReason === null ? '' : `(原因:${shipment.voidReason})`},不要出貨。`;
  }
  // 面6:品項清單**與資料庫說的總筆數對不上** ⇒ 這張紙可能少列品項,而少的那件不會有任何症狀。
  //
  // 🔴🔴 **2026-08-17 換了判準本身,不只是換文案**(`Q-C18` 甲,Sean 已批):
  //    舊判準是 `detail.itemsTruncated` = 「**內嵌撈到的筆數觸及我們自己設的上限 200**」,
  //    而品項現在改走**頂層分頁查詢撈到盡** ⇒ **那個旗標對這張紙已經沒有意義**
  //    (它仍然會在 200 品項的單上為 true,而我們手上的清單是完整的)。
  //    ⇒ 新判準 = **拿到幾列 vs 資料庫說有幾列**。
  // 🔴 **這道守門的定位也降級了**:它現在是**最後一道保險**,不是產品行為。
  //    判別句:**它在正式站上響了一次 = 我們的分頁壞了,不是使用者做錯事。**
  //    ⇒ 文案不准叫他重試、不准寫得像他自己有辦法解決。
  // ⚠️ **`reportedTotal` 量在第一頁那個瞬間,而迴圈跨多次查詢** ⇒ 中途有寫入時它會對不上,
  //    **那在別的路徑上是正常的**;而本路徑實查 `order_items` 建單後不再增刪
  //    (數法寫在 `SupabaseOrderAdapter.listOrderItemsForPrint` 的 docstring)
  //    ⇒ **在這裡對不上就是真的有問題**,fail-closed。
  // 🔴🔴 **面6-b:對帳訊號【缺席】時也要擋**(2026-08-18;T② 提報、V 窗量測、本窗修)。
  //
  //    **落地前的形狀**:判準是 `reportedTotal !== null && …` ⇒ **`null` 短路 ⇒ 不擋、照印**
  //    (`grep -c 'reportedTotal === null'` 本檔 ⇒ **0**,全檔沒有任何 `null` 分支)。
  //    ⇒ **「沒有對帳訊號」與「對帳通過」被印成同一張紙。那是 fail-open,而且零症狀。**
  //
  //    🔴 **修的理由【不是】「`count` 可能是 `null`」** —— 那條今天**構造不出來**:
  //      V 窗對正式站唯讀試了 **9 條路**(不帶 `Prefer` / planned / estimated / embed /
  //      range 超界 / `max-rows` 夾住 / 無 limit / 空結果集 / 完整重現本查詢形狀),
  //      **唯一讓 `count` 消失的是「沒帶 `Prefer: count=exact`」**,
  //      而 `SupabaseOrderAdapter.ts` 的 `page === 0 ? { count: 'exact' } : undefined`
  //      **第 0 頁恆帶** ⇒ 這條路上產不出來。
  //      ⚠️ **口徑:那 9 條路構造不出,【不宣稱不可能】**(網路層截斷 / PostgREST 逾時未涵蓋)。
  //      ⇒ **所以不要拿「null 會發生」當理由** —— 下一個人一驗會判它不成立、然後撤掉這道守門。
  //
  //    ✅ **真正的理由是【失敗方向錯了】,而這個 repo 已經有兩處寫死了相反立場**:
  //      · `SupabaseOrderAdapter.ts:986`(撞 MAX_PAGES)逐字:「**throw,不回部分**…
  //        部分結果會讓紙上少列品項而**紙看起來完全正常**」
  //      · `SupabaseWalletAdapter.listEntries` 逐字:「**本方法以『共 N 筆』為前提,
  //        沒有 N 就不回傳一份看起來完整的一頁**」
  //      ⇒ **adapter 兩處寧可炸,而列印頁在訊號缺席時放行 —— 三處裡只有這裡是相反的。**
  //
  //    🔴 **而 Sean 自己對這個形狀拍過板**(2026-08-17 `Q2`=甲,逐字):
  //      「**撈不全就整區失敗、不顯示任何一列**」,理由「**標了警告的清單,對帳的人還是會照著算**」
  //      ⇒ 本條是那個拍板的**第三個落地面**。
  //
  //    ⚠️ **訊息與下面那一句刻意不同,值班的人要分得出來**:
  //      **這一句 = 沒得對**(讀不到總數)／**下面那句 = 對不上**(讀到的與總數不符)。
  //    🔴 **`NaN` 走同一個出口**(2026-08-18 `#634`):型別是 `number | null`，
  //      而 `NaN` 是 `number` ⇒ 它躲得過 `=== null`，然後 `items.length !== NaN` 恆真
  //      ⇒ 掉到下面那句，印出「資料庫說有 **NaN** 項」。
  //      **擋是擋住了，而值班的人拿到的是一句他看不懂的話。**
  //      🔴 **上游 adapter 那半在哪**(2026-08-18 10:4x 當場量,`merge-base --is-ancestor` 回 YES):
  //        `656cb995`（B 窗，`products` 分支）把 adapter 改成 `Number.isFinite`，
  //        **已於 `8a977401`「收割 products 7 顆」進 dev（10:11）**。
  //        ⚠️ 本分支 base = `3c48e938`，**早於那顆** ⇒ 在這棵樹上 adapter 那半還沒有，合併後才有。
  //        ⚠️⚠️ 我落筆的第一版寫「尚未收割」——**寫的當下為真，送審時已假**（中間隔了一次收割）。
  //        留這句留痕:**關於「某顆進了沒」的句子，保存期是以分鐘計的。**
  //        ⇒ 上游進來之後這一層就再也收不到 `NaN` —— **而這一行仍然要留**:
  //        `reportedTotal` 的型別 `number | null` **表達不出「非 NaN」**，
  //        任何日後的呼叫端都能再把它送進來，而這一層是唯一知道
  //        「這個值要**印給人看**」的地方。上游擋的是「值不對」，這裡擋的是「印出來的字不是人話」。
  if (reportedTotal === null || !Number.isFinite(reportedTotal)) {
    return '讀不到這張訂單的品項總數,無法確認下面的清單是不是完整的。這是系統的問題,不是你操作錯。請聯絡負責人處理,不要拿這張紙出貨。';
  }
  if (items.length !== reportedTotal) {
    // ⚠️ 逐字寫「達到 200 筆」不是「超過 200 筆」:判定是 `>=`
    //    (`packages/adapters/src/supabase/mappers/order.ts:830`)⇒ **剛好 200 項就會走到這裡**。
    //    🔴 而 Sean 2026-08-17 逐字說一張單「可能到 200 個品項」⇒ **正常業務的上緣就是這個值**。
    return `這張訂單的品項清單讀出來對不上(讀到 ${items.length} 項,資料庫說有 ${reportedTotal} 項),出貨明細單可能少印品項。這是系統的問題,不是你操作錯。請聯絡負責人處理,不要拿這張紙出貨。`;
  }
  // 🔴 面8(#10 合併片,2026-08-16 補):**這張【訂單】讀不到任何品項。**
  //    ⚠️ 與面5 是**兩件事**,不要合併:
  //      面5 = 這【箱】裡沒有本單的東西(箱與單湊錯)
  //      面8 = 這【單】本身一個品項都沒有(投影出問題)
  //    ⇒ 面5 過得了不代表面8 過得了 —— `lines` 非空而 `detail.items` 空時,
  //      下面那個 `known` 集合會是空的、每一條 line 都變成孤兒,員工看到的是「對不上」
  //      (面7 的話),而真正的病是**整張單讀不到東西**。訊息指錯方向,他會去找箱子的問題。
  //    🔴 **本條是從揀貨單搬過來的** —— `components/print/picking-doc.tsx:114-115` 早就有,
  //      而出貨單一直沒有(`grep -c 'items.length === 0' shipping-doc.tsx` 落地前 ⇒ 0)。
  //      合併時「以出貨單為本體」聽起來像保留出貨單的東西,**這道會靜默消失**,所以先補上。
  //
  // 🔴🔴 **2026-08-18:面8 移到面5【之前】,而順序本身就是修法**(審查 must-fix)。
  //    **落地前的順序是面5 在前**,而**零品項的單 `lines` 也會是 0**
  //    ⇒ **面5 先發** ⇒ 紙上印的是「**請從訂單頁的出貨卡點進來,不要自己拼網址**」
  //    ⇒ 🔴 **真正的病是「整張單讀不到品項」(系統),而值班看到的是「你自己拼網址」(怪他)。**
  //    ⚠️ **不是安全洞** —— 兩種都擋印,fail-closed 成立。壞的是**診斷方向 + 怪錯人**。
  //    📎 **而這件事本檔【自己的註解】早就講過**(正上方那段:「訊息指錯方向,
  //       他會去找箱子的問題」)—— **只是那句講的是另一種組合(`lines` 非空),沒涵蓋這一種。**
  //    🔴 **順序有語意,不要為了「相關的放一起」把它們調回去**:
  //       這張單本身壞掉(面8)⇒ 比「箱與單湊錯」(面5)更根本,先報根本的那個。
  if (items.length === 0) {
    return '這張訂單讀不到任何品項,出貨明細單不能印。請重新整理;仍然一樣請回報。';
  }
  // 面5:這箱裡沒有任何屬於這張訂單的品項 ⇒ 網址把不相干的箱與單湊在一起。
  //    ⚠️ 走到這裡代表 `items` 非空(面8 已擋)⇒ 這裡的「沒有」真的是**箱與單湊錯**。
  if (lines.length === 0) {
    return '這個包裹裡沒有這張訂單的品項。請從訂單頁的出貨卡點進來,不要自己拼網址。';
  }
  // 面7:箱裡的品項在訂單明細查不到 ⇒ 兩邊對不上,不用 `?? '—'` 蒙混過去。
  const known = new Set(items.map((it) => it.id));
  const orphan = lines.find((l) => !known.has(l.orderItemId));
  if (orphan !== undefined) {
    return '包裹內容與訂單明細對不上(有品項在訂單裡找不到)。請重新整理;仍然不對請回報。';
  }
  // 面3:收件快照讀不出來(jsonb 形狀不符)。
  if (shipment.recipientSnapshot === null) {
    return '這個包裹的收件資料讀不出來(格式不符),不能印出貨明細單。請回報。';
  }
  // 🔴 面2(`#503`):三個鍵可以全是空字串,而且那是**合法寫入**——
  //    寫入鏈四層沒有一層擋空(詳 `shipment-repository.ts` 的 `recipientSnapshot` docstring)。
  //    ⇒ 這裡是**下游擋**,不是把洞補起來;洞在建箱動線,`#503` 另開一片。
  const r = shipment.recipientSnapshot;
  // 🔴 `#240`/Q1-A1 複驗 must-fix:**姓名這一格判的是【濾過之後】的值。**
  //    名字若整串都是 emoji(`'🏍'`)⇒ 原始值 `trim()` 非空 ⇒ 舊寫法**放行** ⇒
  //    而下面渲染時 `stripPictographs` 回 null ⇒ **收件人欄整格空白的標籤就印出去了**。
  //    ⇒ 比補一個 `?? '—'` 正確:**紙上印「收件人:—」一樣寄不出去。**
  if (stripPictographs(r.name) === null || r.phone.trim() === '' || r.line.trim() === '') {
    // ⚠️ 用 `trim()` 判空是**顯示端的判斷**,不是資料層的 —— 資料層刻意原樣保留(見該 docstring)。
    return '這個包裹沒有完整的收件資料(收件人 / 電話 / 地址有缺),不能出貨。請先補齊收件資料。';
  }
  return null;
}

/**
 * 料號 + 品名/規格 兩格。**兩個區塊共用,是為了讓它們永遠長得一樣** ——
 * 各寫一份的話,下一個人只改其中一邊,而紙上兩區的同一個商品會長得不同。
 *
 * 🔴 **料號刻意比品名大、而且加粗**(`text-base font-bold`,品名是 `text-sm`)。
 *    這是 `Q-D-5` 拍「先出沒有圖的版本」之後的代替品:**縮圖的功能是讓人一眼認出貨,
 *    而在單色雷射印表機上料號比縮圖可靠** —— 圖會糊,料號不會,而且掃描槍讀得到。
 *    ⚠️ 之後真的補圖時,**不要把料號縮回去** —— 那時兩者是互補不是替代。
 */
function ItemCells({
  sku,
  title,
  spec,
}: {
  sku: string | undefined;
  title: string | null | undefined;
  spec: Record<string, string> | null | undefined;
}) {
  return (
    <>
      {/* 🔴 **片4-R1 修 F1-F4:改掛稿的 `.pd-sku` / `.pd-name` / `.pd-spec`,拿掉 Tailwind 排版類。**
          **病灶不是「哪個好看」,是【兩套規則在打架而我沒發現】**:
          `print-a4.css` 的 `.pd-*` 沒有 `@layer`,而 Tailwind v4 的 utilities 住在
          `@layer utilities` 裡 ⇒ **無層規則贏過任何 utility,與具體度無關**。
          ⇒ 片3 把 `.pd-items` 掛上 `<section>` 的那一刻,`.pd-items td{font-size:9pt}`
             就開始蓋掉這裡的 `text-base` —— **而畫面上沒有任何東西會紅。**
          🔴 **為什麼選「改掛 `.pd-*`」而不是「把 CSS 包進 @layer」**:
             稿**本來就定義了** `.pd-sku` / `.pd-name` / `.pd-num`(它們在 CSS 裡,只是 OD 的
             markup 沒跟上 —— 他們是**最小幅度地 patch 我們的快照**,不是重寫)。
             ⇒ 用它們是**回到設計的原意**;包 `@layer` 只是讓兩套規則繼續並存、下次再打一次。
          📎 `.pd-sku` = mono 11pt 粗、不換行(料號要一眼認出且掃描槍讀得到,見上方 docstring)。 */}
      <td className='pd-sku'>{sku}</td>
      <td>
        <div className='pd-name'>{title ?? '—'}</div>
        {spec && (
          <span className='pd-spec'>
            {Object.entries(spec)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ')}
          </span>
        )}
      </td>
    </>
  );
}

/**
 * 一個有標題的品項表。
 *
 * 🔴 **跨頁表頭沿用片1 的結論**:真 `table` + 真 `thead` ⇒ 瀏覽器原生重複表頭,
 *    **不加任何 `print:` class**。量測與負向對照見 `picking-doc.tsx` 該段
 *    (那裡記著:加一條 CSS 字面會變成永遠綠的守門,因為它本來就會過)。
 *
 * ⚠️ `note` 是給員工看的一句人話,說明**這一區的母體是什麼** ——
 *    兩區的母體不同(一箱 vs 整張單),不寫清楚就會被讀成同一個東西。
 */
function Section({
  title,
  note,
  qtyHeader,
  orderDisplayId,
  shipmentReference,
  variant,
  tick = false,
  money,
  children,
}: {
  title: string;
  note: string;
  qtyHeader: string;
  /** `.pd-items` 的修飾類(稿:`pd-pending` / `pd-cancelled`)。省略 = 主區。 */
  variant?: 'pending' | 'cancelled';
  /**
   * 🔴 **`data-slot='qty'` 是【量具的分母定義】,不是樣式。**
   *    R3 MF7:量具原本用「每一列的**最後一格**」當數量格 —— 那是**位置假設**,
   *    而片5 只要在數量後面加一個純數字的對帳欄,**分母就整組換人而不會紅**
   *    (新欄全是數字、字級自洽 ⇒ 斷言照樣綠,真正的數量欄靜靜離開分母)。
   *    ⇒ 定義權搬回**元件**:誰是數量格由這裡宣告,而量具守「這個標記還在、每列剛好一個」。
   * ⚠️ 代價是多一個只為量測存在的屬性。**這 repo 既有同款慣例**
   *    (`print-button.tsx` / `picking-checkbox` / `shipping-checkbox` 都是 `data-slot`),
   *    所以不是新發明;而它的價值在於**標記不見時量具會紅**,位置假設不會。
   */

  /**
   * 這一區要不要**勾選欄**。
   *
   * 🔴 **這是 Sean 2026-08-23「揀貨單與出貨單合併」拍板的落地點** ——
   *    本檔舊註解逐字寫著「**而這張紙上沒有勾選欄**」,那句在合併之前是對的。
   *    稿的 `預覽-出貨明細單.html` 的「本次出貨」區有 `<th class="pd-mid">勾</th>`
   *    + 每列 `<td class="pd-tick"><span class="pd-box">`,而「尚未出貨」區**沒有**。
   * ⚠️ 只給「本次出貨」—— 欠貨與已取消**沒有東西可以勾**,給了框就是在問一個沒有答案的問題
   *    (與 `picking-doc.tsx` 那條「不用揀的列不給框」是同一條紀律)。
   */
  tick?: boolean;
  /**
   * 這一區的**金額欄**(片4b,`Q-D-4`=乙 / Sean 2026-08-24 `Q1`=甲)。
   *
   * 🔴 **三態,而三態是刻意的**:
   * ```
   * 省略                 這一區【沒有金額欄】 —— 訂單取消區(Q-C11=甲)
   * { subtotal: 數字 }   有金額欄, 而且印得出小計
   * { subtotal: null }   有金額欄, 而【這一區不印小計】(有列的量不可知, spec §5 fail-closed)
   * ```
   * ⚠️ **`null` 與省略【不可以合併】** —— 前者是「有金額欄但算不出來」,
   *    後者是「這一區本來就不談錢」。合併之後,取消區會長得跟一個算壞的區一樣。
   */
  money?: { subtotal: number | null };
  /** 續頁抬頭要帶的訂單編號(`Q-C20`)。 */
  orderDisplayId: string;
  /** 續頁抬頭要帶的箱號(`Q-C20`)。 */
  shipmentReference: string;
  children: React.ReactNode;
}) {
  // 🔴 `.pd-sech` = **粗上框線 + 一般文字**(`border-top:1.2mm`),不是黑底反白。
  //    FIX-63 的字面寫「實心黑帶+反白標題」,而 FIX-71 之後稿的最終值是這個形狀
  //    (實掃 `.pd-sech` 的 `background` 命中 = 0)。**照 FIX-63 字面搬 = 搬進已修掉的 bug**
  //    —— Sean 2026-08-23 14:08 實印:用 background 畫的四樣全不見。
  return (
    <section className={variant === undefined ? 'pd-items' : `pd-items pd-${variant}`}>
      <h2 className='pd-sech'>
        {title}
        <span>{note}</span>
      </h2>
      <table className='w-full border-collapse'>
        <thead>
          {/* ── `Q-C20` 續頁抬頭(Sean 2026-08-17 拍**甲**:照設計稿做,不要另外發明)──
              🔴 **真權威 = OD 專案 `pcm-print-docs` / `shipping-picking-doc-a4.html:291`**
                 (當場 `search_files` + `get_file` 開的,不是憑記憶),逐字:
                 `<tr class="contbar"><th colspan="7">品項明細　訂單 <b>…</b>　箱號 <b>…</b>…</th></tr>`
                 —— **這一列在 `<thead>` 裡、在欄名那一列的上面**。
              🔴 **它為什麼解得掉跨頁**:`<thead>` 由瀏覽器原生逐頁重複(UA 預設
                 `display:table-header-group`)⇒ 這一列跟著欄名一起出現在第 2、3 頁。
                 **實測到的缺口長什麼樣**:落地前印 12 品項那份,第 2 頁上欄名有、
                 而**整頁沒有訂單編號也沒有箱號** ⇒ 那張紙跟第 1 頁分開就認不出是哪一單
                 (量法與三張 PNG 見 `docs/specs/2026-08-17-qc5-…-list.md` §4b-4)。
              ⚠️ **Sean 選甲 = 區塊標題那一行【留著】** ⇒ 第 1 頁上三個區塊各多一列,
                 那是他看過數字之後選的(乙案 +0 行,他沒選)。**不要「順手」把標題併進來省行。**
              📎 **字級沒有照搬 `8pt`**:樣張是 pt 體系,而這張紙**從來沒有為列印設過字級**
                 (`print-a4.css` 規則層唯一的 `font-size` 是頁碼那個 8pt)⇒ 這裡沒有可乘的對象,
                 用本檔既有的 `text-xs`。`tracking`/字重/大小寫/顏色照樣張。
              🔴 **樣張那一列右側還有 `<i>續頁欄名重複</i>`,而我們【刻意不印】** ——
                 **不是漏做。** 依據:那六個字是**設計端給看樣張的人的自述**,不是單據內容。
                 同一支樣張的 `.caption`(「版面樣張 A ── 正常狀態…」)在 `@media print`
                 裡是 `display:none`(`:46`),⇒ 設計端**有**「這是說明、不要印」這個概念;
                 而這六個字**沒有被藏**(`.contbar th i` 只有 `float:right`,`:137`)。
                 ⇒ 兩種可能:設計端漏了、或它真的要印。**印一句倉庫與客人都看不懂的
                 內部說明,代價比少印它高**(對外可見、且它描述的是排版行為不是貨的事實)。
                 ⇒ **2026-08-17 主視窗裁定:維持不印,不再拿去問 Sean**(成本不對稱 ——
                 少了他看得到會直接講,而問他要為六個字再切換一次注意力)。
                 📎 **要印的話**:加一個右浮的 `<span>` 即可,其餘一個字都不用動。
                 ⚠️ **不要「照樣張補齊」把它加回來而不讀這一段。** 例外清單的正本在
                 `docs/specs/2026-08-17-qc5-tracking-off-paper-decommission-list.md` §4b-3。 */}
          {/* 🔴 **「品項明細」四個字拿掉了**(FIX-63:續頁列不再重複區塊名)——
              稿的最終值逐字是 `訂單 <b>…</b>　箱號 <b>…</b>`,前面沒有「品項明細」。
              ⚠️ 上面那整段「為什麼要有這一列」的依據**一個字都沒變**,變的只有它印什麼。 */}
          {/* 🔴 片4-R1 修 F5:`contbar` → `pd-contbar`。
              CSS 裡是 `.pd-contbar`(3 條規則),而元件寫的是無前綴的 `contbar`
              ⇒ **續頁抬頭的樣式從落地那天起就沒有生效過**,而畫面上它仍然「有東西」
                (只是套的是預設 th 樣式)⇒ 沒有任何人會發現。 */}
          {/* 🔴 `colSpan` **由欄數推導,不是打一個字面數字** —— 打死的話,
              片4b 加金額欄的那一刻它就少一格,而**紙上看得到的症狀是續頁抬頭橫線短了一截**,
              三綠與單測都不會紅。基本三欄(料號/品名/數量)+ 勾 + 金額。 */}
          <tr className='pd-contbar'>
            <th colSpan={3 + (tick ? 1 : 0) + (money === undefined ? 0 : 1)}>
              訂單 <b>{orderDisplayId}</b>　箱號 <b>{shipmentReference}</b>
            </th>
          </tr>
          {/* 🔴 片4-R1 修 F2:欄名列改掛 `.pd-colhead`,數量那欄掛 `.pd-num`。
              改之前 `text-right` 被 `.pd-items thead th{text-align:left}` 蓋掉
              ⇒ **欄名靠左、下方數字靠右,兩者對不齊**,而那是紙上看得到的。 */}
          <tr className='pd-colhead'>
            {tick && <th className='pd-mid'>勾</th>}
            <th>料號</th>
            <th>品名 / 規格</th>
            <th className='pd-num'>{qtyHeader}</th>
            {money !== undefined && <th className='pd-num'>金額</th>}
          </tr>
        </thead>
        <tbody>
          {children}
          {/* ── 🔴 這一區的小計(片4b)───────────────────────────────────────────
              🔴 **放在 `tbody` 的最後一列,不是 `tfoot`** —— `tfoot` 會被瀏覽器
                 **逐頁重複**(與 `thead` 同機制)⇒ 一張 3 頁的紙會印出三個小計,
                 而那三個看起來都像「這一區的總數」。**紙印出去收不回來。**
              🔴 **`subtotal === null` ⇒ 整列不印,不印 `—`、不印 0**(spec §5 fail-closed):
                 印一個佔位符會讓客人以為那一格「本來就沒有錢」,而事實是**我們算不出來**。
              📎 標籤刻意寫「本區合計」不寫「小計」——「小計」在紙的下半部已經是
                 `detail.subtotal` 那一列的名字,兩個同名的數字不相等會讓客人以為我們算錯帳。 */}
          {money !== undefined && money.subtotal !== null && (
            <tr className='pd-subtotal'>
              <td colSpan={2 + (tick ? 1 : 0)} />
              <td className='pd-num'>本區合計</td>
              <td className='pd-num pd-strong'>{formatOrderAmount(money.subtotal)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 勾選格。**空心 `border` 不是底色** —— 單色印表機照樣看得見,而底色不印時會整個消失。
 * 🔴 `data-slot` 是守門的掛勾:沒有它,「這一區有沒有勾選欄」就沒有穩定的選取器,
 *    而那條斷言會變成恆真(選不到 ⇒ 永遠通過)。同型教訓見 `print-button.tsx` 的 docstring。
 */
/**
 * 金額列。
 *
 * 🔴 **每個數字都是【欄位原值】,零運算** —— `Q-D-7` 的硬條款:
 *    禁止從 `subtotal`/`total` 反推、禁止浮點、格式化一律走既有 `formatOrderAmount`
 *    (`lib/orders/order-list-view.ts:979`,`toLocaleString('en-US')` ⇒ 千分位、**不加 NT$**)。
 * 📎 全站不寫 `NT$`;幣別只在區塊抬頭出現一次(「金額 新臺幣」),與訂單信同一條紀律。
 */
function MoneyRow({
  label,
  money,
  cls,
  negative = false,
}: {
  label: string;
  money: { amount: number };
  cls?: string;
  /** 折扣列:印負號。**只影響呈現,不改值**(見呼叫端那段)。 */
  negative?: boolean;
}) {
  return (
    <tr className={cls}>
      <td className='k'>{label}</td>
      <td className='v'>
        {negative && '−'}
        {formatOrderAmount(money.amount)}
      </td>
    </tr>
  );
}

/**
 * 品項列的**金額格**(片4b)。`null` = 不知道 ⇒ **印一句話,不印數字、不印 `—`、不補 0**。
 *
 * 🔴 **為什麼不留白**:空格在紙上與「這一項不用錢」長得一樣,
 *    而事實是**我們算不出來**。同 `.pd-state`(「數量資料尚未就緒」)那一支的立場。
 * 🔴 **`formatOrderAmount` 不加 `NT$`**(`lib/orders/order-list-view.ts:979`,`toLocaleString('en-US')`)
 *    —— 全站不寫幣別符號,幣別只在下方金額區抬頭出現一次(「金額 新臺幣」)。
 */
function MoneyCell({ amount }: { amount: number | null }) {
  return (
    <td className='pd-num'>
      {amount === null ? <span className='pd-state'>金額資料尚未就緒</span> : formatOrderAmount(amount)}
    </td>
  );
}

function TickCell() {
  return (
    <td className='pd-tick'>
      <span data-slot='shipping-checkbox' className='pd-box' />
    </td>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role='alert'
      className='rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium text-amber-800'
    >
      {children}
    </div>
  );
}



/**
 * 🔴🔴 **對外紙本的文案 —— Sean 2026-08-24 親自挑的版本(`Q2` 三選一,他逐字「那題人話: 乙」)。**
 *    canonical:`memory/project_0824-sean-shipping-doc-two-sections-confirmed.md`「追記」節。
 *    **動這個字面要重新問 Sean**,不是 code review 能放行的。
 *
 * **它要解決的問題**:兩區合計的母體是「這一箱」與「還欠的」,而下方訂單金額的母體是整張訂單
 * (含先前已寄出的、含已取消的)⇒ **加起來不會相等,而那是對的**(spec §3)。
 * 不講清楚的話,客人會自己相加,然後發現對不起來、以為我們算錯帳。
 * 落選的兩版與「為什麼是乙」都在 canonical 那條裡(甲=解釋機制 / 丙=只講以哪個為準)。
 *
 * ⚠️⚠️ **這一版是【看文字】挑的,不是【看樣張】挑的** —— 原因是雞生蛋:
 *    樣張要長出這句話,得先有兩區小計這個版面,而那是同一片的工作。
 *    ⇒ **落地之後要產真樣張讓他肉眼驗**,而他那時仍然可以改字。
 *    🔴 **「他挑過了」不等於「他看過它印在紙上的樣子」** —— 不要把前者寫成後者。
 *
 * 🔴🔴 **引號用「」而不是『』,這是我做的決定,不是照抄** ——
 *    canonical 那條裡寫成 `『這箱值多少』`,而那是因為**整句話被 `「」` 包起來引用**
 *    (中文巢狀引號:外「」內『』)。**印在紙上時這句話沒有外層引號** ⇒ 回到單層的「」。
 *    ⚠️ 我把這一格寫出來而不是默默決定,是因為**它是對外紙面的字面** ——
 *      若 Sean 要的就是 `『』`,這裡改一個字即可,而**他要看得到有人做過這個判斷**。
 */
const CROSS_SECTION_NOTICE =
  '上面兩塊回答「這箱值多少」和「還欠您多少」,下面回答「這張訂單總共多少」。前面兩個加起來不會等於下面那個,那是正常的。';

export function ShippingDoc({
  detail,
  items,
  reportedTotal,
  shipment,
  lines,
  printedAt,
}: {
  detail: AdminOrderDetail;
  /**
   * 🔴 完整品項清單(頂層分頁撈到盡)—— **不要改回 `detail.items`**,理由見 `shippingDocBlocker`。
   *
   * 🔴🔴 **片4b:型別從 `AdminOrderPrintItem`(6 欄)加寬成 `AdminOrderDetailFullItem`(+ 單價/行小計)**
   *    —— 紙上要印金額了(Sean 2026-08-24 `Q1`=甲),而 `unitPrice` 只在後者。
   *    ⚠️ **加寬的是【這個元件】,不是 `shippingDocBlocker`** —— 那支只讀六欄、簽章維持窄的,
   *      所以 `lib/shipping/shipment-candidates.ts` 那個消費端一個字都不用動。
   * 🔴🔴 **而 `lineTotal` 【被型別擋在門外】,不是靠守門也不是靠自律。**
   *    它是**下單量**的行小計,而 `Q-D-7` 要的是 `unitPrice × 本區數量` ⇒ 印它會印錯區
   *    (部分出貨時會印出**整筆下單金額**)。
   *    ⇒ 所以這裡是 `Omit<…, 'lineTotal'>`:**本檔任何地方讀 `item.lineTotal` 都是編譯錯誤。**
   * 🔴 **為什麼從「原始碼字面守門」換成「型別」**(codex 跨模型審查 2026-08-24 finding 3):
   *    字面守門只找**單一檔案的連續字串** ⇒ `item['line'+'Total']` / 別名 / 中繼函式全繞得過。
   *    codex 的 WOULD-CHANGE 我在真 runner 覆過:
   *    `node -e "…\"item['line'+'Total']\".includes('lineTotal')…"` ⇒ **`BYPASS`**。
   *    ⚠️ **而修法不是再去列舉那幾種繞法** —— 那又是一個「我列的分母」,
   *       下一種繞法出現時它不會紅。**判準是:新增第 N 種繞法時,它會不會自己紅?**
   *       型別會。字面不會。
   * 📎 呼叫端傳完整的 `AdminOrderDetailFullItem[]` 進來完全合法(結構子型別),
   *    **被擋住的是「本檔讀它」,不是「呼叫端有它」** —— 那正是要擋的那一半。
   */
  items: readonly Omit<AdminOrderDetailFullItem, 'lineTotal'>[];
  reportedTotal: number | null;
  shipment: ShipmentRow;
  lines: OrderShipmentGroup['lines'];
  /**
   * 這張紙**這一次**被列印的時間(ISO timestamptz)。`Q-⑨`=甲(Sean 2026-08-24)。
   *
   * **它向客人宣稱什麼**:「這張紙上的內容,是這個時間點的樣子」。
   * 🔴 **它【不】宣稱**:出貨時間 / 下單時間 / 帳單日期。紙上另有「日期」(出貨日)與「下單」兩格
   *    ⇒ 標籤逐字用「**列印時間**」把它與那兩個分開。
   *
   * 🔴🔴 **為什麼是 prop 而不是在本檔裡呼叫 `new Date()`**:
   *    「現在幾點」是**那一次請求**的性質,不是這個元件的性質。寫在元件裡的話,
   *    **同一份輸入會渲染出不同的輸出** ⇒ 任何斷言紙面的測試都只能斷言「有個像時間的東西」,
   *    而那種斷言**在時間格式寫錯的時候也是綠的**。
   *    收成 prop ⇒ 測試餵一個固定值 ⇒ 斷言得了**字面**。
   *    📎 同 `page.tsx` 既有的立場:資料在頁層取好再餵進來,元件不自己去拿。
   *
   * ⚠️ **它解決的是「哪張紙比較新」,不是「補印會印出不同金額」**(`§9⑨`)。
   *    金額仍可能因改價而在兩次列印之間變動 —— 真正的修法是存金額快照,那是另一片。
   *    🔴 Sean 拍甲時**知道這件事**:那句警語寫在問他的那句話裡,不是附件。
   */
  printedAt: string;
}) {
  // ⚠️ **已登記、本片不修的一條(codex 對抗審查 2026-08-16 指出)**:
  //    頁層分兩次查 —— 先 `findAdminOrderDetail`(拿 `shippedQuantity`)、再 `loadOrderShipments`
  //    (拿 `shippedAt`)。兩次之間若有人按下「標記出貨」,會拿到**舊的 shippedQuantity**
  //    配**新的 shippedAt** ⇒ 這一箱兩項都沒算到 ⇒ 尚未出貨**多印**幾件。
  //    🔴 **方向是「多報欠客人」不是「少報」** —— 前者讓客人打電話來問,後者讓他以為收齊了。
  //       兩害相權,而**我沒有量過它的實際發生率**(需要兩個並發操作者)。
  //    ⇒ 修法要在頁層一次讀齊(或加版本比對),那是另一片;**登記不等於處置完畢。**
  // 這一箱裡每一列的量(「尚未出貨」算式的第四項)。
  const boxQtyByItemId = new Map(lines.map((l) => [l.orderItemId, l.quantity]));

  const blocked = shippingDocBlocker({ detail, items, reportedTotal, shipment, lines });
  const itemById = new Map(items.map((it) => [it.id, it]));


  // 🔴 **哪些品項要列進「尚未出貨」**:還欠客人的(>0),以及**算不出來的(`null`)**。
  //    ⚠️ `null` 一定要留下來 —— 把「不知道」濾掉,紙上就會變成「沒有」,
  //       而那正是 `outstandingQuantity` docstring 講的、這張紙最貴的一種錯。
  //    整數 0 才是真的可以不印:那代表這一項確實已經全部處理完了。
  const outstandingRows = items
    .map((item) => ({
      item,
      qty: outstandingQuantity({
        item,
        thisShipmentQuantity: boxQtyByItemId.get(item.id) ?? 0,
        // 🔴 **只扣這一箱,不扣其他還沒出貨的箱** —— 那是刻意的,方向是「多報」不是「少報」。
        //    理由與反例在 `outstandingQuantity` docstring(我一度改成扣全部,那是過度修正)。
        thisShipmentShipped: shipment.shippedAt !== null,
      }),
    }))
    .filter(({ qty }) => qty === null || qty > 0);

  // 🔴 **第三區「訂單取消」**(Sean 2026-08-16 逐字給的區名)。
  //    ⚠️ `null`(不知道)**不進這一區** —— 不知道有沒有取消,不能說它被取消了。
  //       它會出現在「尚未出貨」區並標「數量資料尚未就緒」,那裡才是誠實的位置。
  const cancelledRows = items
    .map((item) => ({ item, qty: cancelledQuantityOf(item) }))
    .filter((r): r is { item: (typeof r)['item']; qty: number } => r.qty !== null && r.qty > 0);

  // ── 🔴🔴 片4b:金額(`Q-D-3`=B / `Q-D-4`=乙 / Sean 2026-08-24 `Q1`=甲)──────────────
  // 🔴 **`Q-D-7` 硬條款**:每一格都是 `unitPrice × 本區數量` 後加總。
  //    **禁**從 `subtotal`/`total` 反推、**禁**浮點、**禁**自己發明算法。算式全在
  //    `lib/shipping/shipping-doc-amounts.ts`(有不需渲染就跑得動的測試 + 四發突變驗過)。
  //
  // 🔴🔴 **§9⑦ 的 fail-closed 閘 —— 這一段是「多一筆錢」與「多幾件」的分界。**
  //    頁層分兩次讀(`findAdminOrderDetail` / `loadOrderShipments`),中間有人按「標記出貨」
  //    ⇒ 舊的 `shippedQuantity` 配新的 `shippedAt`。數量層的後果是多印幾件(已登記);
  //    **而金額讓它變成多印一筆錢**,所以這裡要有處置,不能只登記。
  //    ⇒ 兩次讀對不起來 ⇒ **整張紙不印任何金額**(不是印一個算錯的)。
  const moneyIsTrustworthy = shipmentReadsAreConsistent({
    thisShipmentShipped: shipment.shippedAt !== null,
    lines: lines.map((l) => ({
      thisShipmentQuantity: l.quantity,
      shippedQuantity: itemById.get(l.orderItemId)?.quantitySummary?.shippedQuantity ?? null,
    })),
  });

  // 本次出貨:量來自 `lines[]`,**永遠算得出來**(不經過 `quantitySummary`)。
  const shippedAmounts = lines.map((l) => {
    const item = itemById.get(l.orderItemId);
    return item === undefined ? null : lineAmount(item, l.quantity);
  });
  // 尚未出貨:量可能是 `null`(不知道)⇒ 那一區整區不印小計(`sectionSubtotal` 自己 fail-closed)。
  const outstandingAmounts = outstandingRows.map(({ item, qty }) => lineAmount(item, qty));

  // 🔴 **不可信 ⇒ `undefined`(整區沒有金額欄),不是 `null`(有欄但算不出來)。**
  //    差別在紙上看得到:`null` 會留一個空的金額欄給客人看,而我們根本不想談這張紙的錢。
  const shippedMoney = moneyIsTrustworthy
    ? { subtotal: sectionSubtotal(shippedAmounts) }
    : undefined;
  const outstandingMoney = moneyIsTrustworthy
    ? { subtotal: sectionSubtotal(outstandingAmounts) }
    : undefined;

  // 🔴 **紙上到底印出了幾個區塊合計** —— 那句跨區人話只在 `> 0` 時印。
  //    ⚠️ 抽成一個名字而不是把條件寫進 JSX:那個條件有三態(沒有金額欄 / 有欄但算不出 / 有值),
  //       寫成一串 `?.` 與 `!==` 之後**沒有人讀得出它到底在問什麼**,而讀不出來的條件就是下一個 bug。
  const sectionSubtotalsShown = [shippedMoney, outstandingMoney].filter(
    (m) => m !== undefined && m.subtotal !== null,
  ).length;

  return (
    /* 🔴 `print-sheet` 是 `app/print/print-a4.css` 唯一的掛勾:列印時把 `p-6` 歸零,
       讓紙面邊界**只由** `@page{margin:12mm 12mm 14mm 12mm}` 決定,不然會內縮兩次。
       ⚠️ 改名要同步那支 CSS —— 那裡是「這張紙是不是 A4」的唯一決定點,
       而改名之後的症狀是**紙印出來邊距不對**,三綠與單測都不會紅。 */
    <div
      data-slot='shipping-doc'
      className='print-sheet mx-auto max-w-3xl p-6 print:max-w-none pd-sheet'
    >
      {/* ── 丁:跨頁頁首與頁尾(Sean 2026-08-30 逐字)────────────────────────────
          🔴 **他要的不是「變回一頁」** —— 逐字:「第七項變成第二張也沒關係, 只要看起來好看就好,
             因為第二頁理論上會有跟第一頁一樣的重複上方欄位…但是有頁尾就好也可以」。
          ⇒ 甲類(壓內容)與乙類(動 `@page`)都不做;做的是**讓第 2 頁自己看起來是一張完整的紙**。

          🔴🔴 **為什麼是 `<table>` 而不是 `position:fixed`** —— 這兩條我都量過, 而不是挑好看的:
          ```
            position:fixed  ⇒ 每頁都重複 ✅（正對照 1/1/1、負對照 static ⇒ 1/0/0）
                            ⇒ 🛑 而它【不佔位】⇒ 第 2 頁的內容從紙頂開始 ⇒ 被它蓋住
            把它塞進 @page 的邊界帶（top:-10mm + margin-top:22mm）
                            ⇒ 🛑 實測 **它就不重複了**：頁首只剩 p1、頁尾只剩 p2/p3
            <table> 的 thead / tfoot ⇒ 每頁都重複 ✅ **而且瀏覽器會自己留位子**
          ```
          ⇒ **「會重複」與「有留位子」是兩個宣稱, 而只有 table 兩個都成立。**

          📎 而這順手答掉本檔 CSS 檔頭那條掛著的未知(`print-a4.css:16-18` 逐字
             「巢狀 table 跨頁時它自己的 `thead` 重不重複, **沒有人量過**」):
             **量了 —— 外層 thead 與內層 thead 同一份 PDF 上兩個都重複**
             (負對照:把外層 thead 強制 `display:table-row-group` ⇒ 它就只剩第 1 頁)。 */}
      <table className='pd-run'>
        <thead className='pd-runhead'>
          <tr>
            <td>
              <span className='pd-rh-title'>出貨明細單</span>
              <span className='pd-rh-meta'>
                訂單編號 {detail.displayId} · 箱號 {shipment.shipmentReference}
              </span>
            </td>
          </tr>
        </thead>
        {/* 🔴 `tfoot` 寫在 `tbody` 之前是 HTML 的既有規矩(瀏覽器仍印在底部),不是筆誤。 */}
        <tfoot className='pd-runfoot'>
          <tr>
            <td>
              {/* 🔴 **這一行是【搬過來的】, 不是新增的** —— 原本在 `.pd-bottom` 裡面,
                  Sean 2026-08-24 `Q-⑨`=甲「頁尾一行淡色小字『列印時間 …』, **不加解釋**」。
                  ⇒ 字面一個字沒動;動的只有它住在哪裡 ⇒ **現在每一頁都有它**。
                  ⚠️ 而 CSS 的選擇器是 `.pd-bottom .pd-printed` ⇒ **搬了就沒有樣式**
                     ⇒ `print-a4.css` 那條同一批改成 `.pd-runfoot .pd-printed`。
                     那個病的形狀:螢幕上看不出來、三綠不會紅、只有紙上不對。 */}
              {/* 🔴 **頁尾列印時間**(`Q-⑨`=甲,Sean 2026-08-24:「頁尾加一行淡色小字
                  『列印時間 2026-08-24 14:32』,**不加解釋**」)。
                  ⇒ **刻意不寫任何解釋句** —— 乙案(加一句「本單金額以本次列印時間為準」)被明確否決,
                    理由是那句會出現在**每一張**紙上,而會改價的單是少數。

                  🔴 **稿上沒有這個東西,而我附掃過的分母**(不是只說查無):
                    分母 稿 570 行 / `contract.md` 171 行 / `brief.md` 133 行
                    字集 列印時間 0 · 列印日期 0 · 印製 0 · 列印於 0 · 時間戳 0
                         printed 0 · print-time 0 · timestamp 0 · 頁尾 0 · footer 0
                    正對照 我【知道】稿檔尾談過頁碼 ⇒ grep `頁碼` ⇒ **3 命中**(`:563` `:565`)
                         ⇒ 證明這把尺掃得到**檔尾註解裡**的字 ⇒ 上面那排 0 是**真的 0**

                  📎 **而設計端想過這個問題的【另一半】** —— 稿檔尾 `:563` 逐字:
                    「頁碼:本檔沒有頁碼…目前『清單沒載完』這個失敗態只能靠**續頁 thead 上的訂單編號**辨識」
                    ⇒ 他們想的是**跨頁**怎麼分辨,而 `Q-⑨` 問的是**重印**怎麼分辨。
                    **同一個問題的兩半 —— 不要以為沒有人想過。**

                  ⛔ ~~🔴 位置在 `.pd-foot` **之外、`.pd-bottom` 之內** ⇒ 它是整張紙的頁尾,
                     不是「聯絡方式 / 金額」那一組的一部分。~~
                  🔴 **2026-08-30 丁:它搬到 `<tfoot>` 了** ⇒ 上面那句描述的位置**已經不成立**,
                     而【它是整張紙的頁尾】這個**意圖**不但沒變, 是**現在才真的做到** ——
                     原本它只印在最後一頁, 現在**每一頁都有**。
                  📌 **⇒ 而上面引的設計端原話, 現在讀起來是另一個意思**:
                     「續頁 **thead** 上的訂單編號」—— 他們早就想好續頁要靠 thead 認,
                     而我今天做的就是那個。**那句話從【他們沒做的事】變成【我們做的事】。** */}
              <p className='pd-printed'>列印時間 {formatOrderDateTime(printedAt)}</p>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              {/* 🔴 `.pd-flow` 接手原本掛在 `.pd-sheet` 上的 flex 直欄與列印時的 `min-height`
                  —— `.pd-bottom{margin-top:auto}` 靠的就是那兩個(見 `print-a4.css` 錨點
                  「`margin-top:auto` 要有東西可以推」)。**少搬一個就不貼底。** */}
              {/* 🔴🔴 **`space-y-4` 從 `.pd-sheet` 搬到這裡, 而它【差點沒被發現】** ——
                  Tailwind 的 `space-y-4` 是 `& > * + * { margin-top:1rem }` ⇒ 它給的是
                  **直接子元素之間**的間距。包一層 table 之後 `.pd-sheet` 只剩一個子元素
                  ⇒ **那些間距整排消失**, 而症狀是「紙變短了」不是「紙壞了」。
                  📌 **實測:沒搬的時候 5/6/7 項【全部變成一頁】** —— 而我要的正是「別再多一頁」
                     ⇒ **那個假的成功長得跟真的一模一樣**, 只有回頭問「憑什麼變短」才問得出來。
                  ⇒ 搬過來之後 6/7 項回到兩頁, **而那才是 Sean 說「沒關係」的那個兩頁**。 */}
              <div className='pd-flow space-y-4'>
      {/* 🔴 **每個號碼各自帶標籤**(plan §4)。設計需求書早就標了這個風險:
          「**兩個碼並排裸印,客人不知道該拿哪個去查**」。
          ⇒ `displayId` 抽出前是**裸印**(沒有「訂單編號」四個字),這次補上。
          ⚠️ **原文寫「現在紙上有三個 —— 訂單編號 / 箱號 / 追蹤碼」,`Q-C5`=丙 之後只剩兩個**
             (追蹤碼那一列已拿掉,見下方貨運資訊區的作廢註解)。 */}
      {/* 🔴 抬頭七值(#10)的完整依據與典故 —— **2026-08-29 A3-1'a 跟著碼一起搬到**
          `components/print/print-masthead.tsx`(鐵則 6:註解要跟著它解釋的那段碼搬)。
          ⚠️ 那段裡住著三個【拍板紀錄】:L2 分級 / `LTD` 後面沒有句點 / `#248` `#602`
          ⇒ **不要在這裡重寫一份** —— 兩份會分岔,而分岔那天沒有東西會紅。 */}
      <PrintMasthead />

      {/* ── 片2:`.pd-doctitle`(FIX-48/63)──
          🔴 英文由 ~~`Shipping / Picking Document`~~ 改為 **`Shipping Document`**,依稿的最終值。
             理由不是省字:**這張紙沒有揀貨欄**(勾選欄在 `picking-doc.tsx`)⇒ 舊字面裡的
             `Picking` 描述的是一個還沒成立的世界,與下方那段「用途說明刻意還不印」同一個病。
             ⚠️ 實查:`page.test.tsx` **沒有任何一格釘英文字串** ⇒ 改它不會紅,
                也就是說**這一改沒有守門在看**,只有這行註解記得。 */}
      <div className='pd-doctitle'>
        {/* 🔴 標題改「出貨明細單」+ 英文 + 用途說明,依樣張 `:244-250` 逐字。
            ⚠️ 舊字面是「出貨單」,`page.test.tsx` 兩處 `toContain('出貨單')` 同批更新
               —— `出貨明細單` **不包含** `出貨單` 這個子字串(明細二字插在中間),
               不改那兩格會紅,而它們紅得對。 */}
        <h1>出貨明細單</h1>
        <div className='pd-en'>Shipping Document</div>
        {/* 🔴 稿的**出貨明細單沒有 `.pd-use`**(FIX-61 拿掉用途標語);訂單明細才有。
            ⇒ 這裡不留空的 `.pd-use` —— 它帶 `margin-left:auto`,空著也會推走 flex 版面。 */}
        {/* 🔴🔴 **樣張的用途說明兩行【刻意還不印】**(code-reviewer R2 F4 抓到,我原本照抄了)。
              樣張逐字是「倉庫揀貨核對 · 隨貨交付客戶」+「同一張紙兩用:先在倉庫對箱勾選,
              再隨商品出貨」—— **而這張紙上沒有勾選欄**(本檔 `Section` 的 `<th>` 只有
              料號 / 品名規格 / 數量;勾選欄在 `components/print/picking-doc.tsx` 那張紙上)。
              ⇒ **印出來就是一條員工做不到的指示**,與本片剛清掉的那句假話同一個病。
              🔴 **「逐字照樣張」擋不住這一條** —— 樣張的前提(揀貨單與出貨單已合併成一張)
                 **還沒成立**;字面沒抄錯,是**它描述的那個世界還不存在**。
              ⇒ 合併片落地時把這兩行一起補上,那時它才是真的(登記在
                 `docs/specs/2026-08-16-shipping-doc-sample-vs-impl.md` §4)。
              📌 片4-R1 修 F13:原本這段包在一個 `<div hidden>` 空殼裡 ——
                 **註解留著就夠了,空節點沒有用途。** */}
        {/* 🔴 **訂單編號與箱號已移到下面的 `.pd-info` 右欄** —— 稿把它們與出貨日/貨運商放同一組。
            ⚠️ 「每個號碼各自帶標籤」那條紀律**沒有被放寬**,是換了位置:
               在 `.pd-info` 裡每個值前面都有 `.k` 欄名 ⇒ 仍然不是裸印。 */}
        {/* 🔴 **擋住內容卻沒擋住列印鈕 = 守門裝在沒有事的那條路上**(2026-08-17 修)。
            改之前這顆鈕在紅字**上面**、不受 `blocked` 影響 ⇒ 員工按得下去,
            **而印出來的紙上只有那一行紅字** —— 一張沒有用的紙照樣被印出來、照樣可能被放進箱子。
            🔴🔴 **而這【不是】一道守門,只是不再主動遞刀**(code-reviewer R1 MF4):
               `print-button.tsx:5-7` 自己就寫著「為什麼要有這顆鈕、而不是叫員工按 Ctrl+P」
               ⇒ **作者早就知道 ⌘P 那條路存在,拿掉鈕擋不住它。**
            🔴 **真正的解法在樣張,而它還沒做**:樣張 `shipping-picking-doc-a4.html` 的
               **樣張 B(`:459-553`)** 是一整幅「本單不得出貨」的阻印版面(28pt 大字 + 訂單號 +
               原因 + 四條「請照這樣做」+ 逐字「本頁不含品項明細。這不是資料漏印,是刻意不印。」),
               設計端對同一件事的答案逐字是 `:551`「**印出來看起來正常的紙,員工就會照做,
               所以警告必須佔滿這個位置**」—— 而現行只有一行 `<Alert>`(下方 `blocked` 分支)。
            ⇒ **已立案 `#601`**(2026-08-17;樣張 §4 清單第 7 項、獨立一片)。
               **登記不等於處置完畢**;在它落地之前,⌘P 印出來的紙仍然只有一行紅字。 */}
        {blocked === null && <PrintButton label='列印' />}
      </div>

      {blocked !== null ? (
        /* 🔴 `#601` 落地(2026-08-17):**一行 `<Alert>` 換成整幅阻印版面**。
            為什麼:上面那顆列印鈕拿掉之後**只是不再遞刀**,⌘P 那條路仍然通,
            而在這之前 ⌘P 印出來的紙**只有一行紅字、其餘看起來像正常單據**。
            設計端的答案逐字在樣張 `:551`:「印出來看起來正常的紙,員工就會照做,
            所以警告必須佔滿這個位置。」細節見 `BlockedSheet` 的 docstring。 */
        <BlockedSheet kind='shipping-blocked' reason={blocked} orderDisplayId={detail.displayId} />
      ) : (
        <>
          {/* ── 片2:收件人 + 單據物流合併成稿的 `.pd-info` 兩欄(FIX-48/63)──
              🔴 **欄名與值改成【兩個 DOM 節點】(`.k` / `.v`),中間沒有冒號。**
                 稿是這樣排的(`預覽-出貨明細單.html` 的 `.pd-field`),而舊版是
                 `貨運商:新竹物流` 一整串。⇒ `textContent` 由 `貨運商:新竹物流`
                 變成 `貨運商新竹物流`,**釘舊字面的兩格會紅,而它們紅得對**(排版真的變了)。
              🔴 **「每個號碼各自帶標籤」那條紀律沒有被放寬** —— 它現在由**結構**保證:
                 每個值都住在一個 `.pd-field` 裡、旁邊就是它的 `.k`。
                 ⇒ 守門改成**驗 `.k`→`.v` 配對**,那比原本的子字串比對更強
                   (子字串比對分不出「值跑到別的標籤底下」)。
              ⚠️ **`日期` 這兩個字不跟稿** —— 稿寫 `出貨日`,而 Sean 2026-08-16 `Q-C6` 逐字
                 「**改成: 日期 這兩個字就好**」。**拍板 > 設計稿**(`docs/ops/AI_CONTRACT.md` 的優先序)。 */}
          <section className='pd-info'>
            <div className='pd-col'>
              <span className='pd-label'>收件人</span>
            {/* 🔴 `#240`/Q1-A1(code-reviewer R1 must-fix 4):收件人姓名同樣是客人自填 /
                LINE 帶入 ⇒ 一樣會帶 emoji, **而【這張紙】才是明確要交給客人的那張**。
                📌 只修被指名的那一條路(揀貨單)而留著姊妹呼叫端, 是本 repo 明文反對的做法。
                ⚠️ 濾掉之後若整串為空 ⇒ `stripPictographs` 回 null ⇒ 這裡印空(維持既有行為,
                   本欄原本就沒有 `?? '—'` 的缺值寫法, 本片不改它的顯示規則)。 */}
              <div className='pd-field'>
                <div className='k'>姓名</div>
                <div className='v big'>{stripPictographs(shipment.recipientSnapshot?.name)}</div>
              </div>
              <div className='pd-field'>
                <div className='k'>電話</div>
                <div className='v code'>{shipment.recipientSnapshot?.phone}</div>
              </div>
              {/* 🔴 `recipientSnapshot.line` 的欄位名叫 `line`,而它是**地址**不是 LINE 帳號 ——
                  來源 `orders.shipping_address_snapshot` jsonb `{name,phone,line}`
                  (`packages/domain/src/order/types.ts:1209`),而本檔上方擋空的訊息也逐字寫
                  「收件人 / 電話 / **地址** 有缺」。⇒ 標成「地址」是對的,不是我改了語意。
                  ⚠️ 名字會騙人的欄位就是這種:標成「LINE」印給客人的話,紙上會出現一個假的帳號欄。 */}
              <div className='pd-field'>
                <div className='k'>地址</div>
                <div className='v addr'>{shipment.recipientSnapshot?.line}</div>
              </div>
            </div>

          {/* ── 貨運資訊(#10 片3)──
              🔴 **這一區在落地之前,紙上關於「誰送的」一個字都沒有。**
              ⚠️ **原文接著寫「設計需求書把追蹤碼列為必須(缺),理由逐字『客人查貨的唯一依據』」**
                 —— 那句**仍然是設計需求書的原文**,但 `Q-C5`=丙 之後**不再由這張紙負責**:
                 Sean 選的是「這件事根本不該由紙做」,追蹤碼走LINE／Email(`Q-C9`)。
                 ⇒ 需求書那句沒有被推翻,是**載體換了**。
              🔴 資料全在 `ShipmentRow` 裡 ⇒ 零 migration、零新查詢。純粹是「有資料沒印出來」。
              ⚠️ 各欄位的判斷都在 `lib/shipping/shipping-doc-dispatch.ts` 與
                 `carrier-label.ts`,**不在這裡** —— 它們要有不需渲染就跑得動的測試。 */}
          <div className='pd-col'>
              <span className='pd-label'>單據與物流</span>
              <div className='pd-field'>
                <div className='k'>訂單編號</div>
                <div className='v big code'>{detail.displayId}</div>
              </div>
              <div className='pd-field'>
                <div className='k'>箱號</div>
                <div className='v big code'>{shipment.shipmentReference}</div>
              </div>
              <div className='pd-field'>
                <div className='k'>貨運商</div>
                <div className='v'>
                  {carrierLabelOf(shipment.carrierCode)}
                  {shipment.carrierNote !== null && shipment.carrierNote.trim() !== '' &&
                    `(${shipment.carrierNote})`}
                </div>
              </div>
              {/* 🔴 這一格(`Q-C6` 之後叫「日期」):未出貨時印**列印當天**(Sean 拍甲,**明知偶爾會與系統差一天**)
                  ⇒ 設計需求書逐字要求**不要**加「以系統為準」之類的但書。照做,不加。

                  ✅ **`Q-C6` 已答,而他給的是第三個答案**:Sean 2026-08-16 逐字
                  「**改成: 日期 這兩個字就好**」⇒ 見下方那一行。 */}
              {/* 🔴 **`Q-C6`:Sean 2026-08-16 逐字「改成: 日期 這兩個字就好」** ——
                  他沒有從我給的兩個選項挑,自己給了第三個。**不要自作聰明加字**
                  (不是「出貨日」也不是「列印日」,就是「日期」)。
                  📎 而它正好解掉原本那個矛盾:「日期」**不宣稱任何事**,所以與同一區的
                     任何狀態都不打架。⚠️ 原本這裡寫「與『尚未出貨,出貨後補』不打架」,
                     而**那句話在同一批被 `Q-C9b` 刪掉了** —— 改前件沒翻後件,已更正。 */}
              <div className='pd-field'>
                <div className='k'>日期</div>
                <div className='v code'>{shippedDateText(shipment.shippedAt)}</div>
              </div>
              {/* 🔴 **這一句是【新增的文案】,repo 之前紙上沒有** —— 取自稿的 `.pd-multi` 逐字。
                  它與本檔 `:19` 那條「一箱兩單 ⇒ 印兩張、不混在一起」是**一致的**:
                  紙仍是一單一張,而箱子裡**可能**有別單的貨 ⇒ 這句在提醒倉庫別照這張紙清箱。 */}
              <div className='pd-multi'>同一箱可能還裝著其他訂單的商品。</div>
            {/* ── 🔴 追蹤碼那一列在這裡,而它被 `Q-C5`=丙 拿掉了(2026-08-17)──
                Sean 逐字 `q3: 丙` ⇒ **出貨明細單不印追蹤碼欄位,追蹤碼只走LINE／Email 給客人。**
                作廢清單:`docs/specs/2026-08-17-qc5-tracking-off-paper-decommission-list.md` §1。
                🔴 **同一區的「貨運商」與「日期」留著**(`Q-C19`=乙 逐字「只拿掉追蹤碼那列」)——
                   「日期」是他自己拍過的(`Q-C6`),整區拿掉會把他拍過的東西一起收掉。
                🔴 **丙沒有說「不用追蹤碼」,說的是「不走這張紙」** ⇒ 這些**仍然成立、不准順手拆**:
                   ① `mark_shipped` 的「非 `other` 且追蹤碼空白 ⇒ 拒絕標記出貨」(寫入守門)
                   ② `Q-C551` 乙 的入口格式守門
                   ③ `trackingDisplay` 的三種 `null` 語意(留給 `Q-C9` 的出貨通知信)
                📎 這一列原本印的東西(`number` / `missing` / `selfService` / `pending` 四支)
                   完整留在 git 歷史與 `trackingDisplay` 的 docstring 裡,沒有跟著失傳。 */}
            </div>
          </section>

          <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm'>
            <span>下單:{formatOrderDateTime(detail.createdAt)}</span>
            <span>本次出貨:{lines.length} 項</span>
          </div>

          {/* ── 區塊一:這箱裡、屬於這張訂單的東西 ── */}
          <Section
            title='本次出貨'
            note='這個箱子裡屬於這張訂單的品項'
            qtyHeader='本次出貨'
            tick
            money={shippedMoney}
            orderDisplayId={detail.displayId}
            shipmentReference={shipment.shipmentReference}
          >
            {lines.map((l, i) => {
              // `blocked === null` 已保證每一條 line 都對得到品項(面7)。
              const item = itemById.get(l.orderItemId);
              return (
                <tr key={l.orderItemId} className='border-b'>
                  {/* 🔴 勾選格只在這一區(見 `Section` 的 `tick` docstring)。
                      ⚠️ 欄名有「勾」而列上沒有框 ⇒ 整張表右移一格、版面歪掉,
                         而**單測若只數框的總數是抓不到的** —— 守門要問「框在不在這一區裡」。
                         (我第一版就是漏掉這一行,是那道新守門當場紅給我看的。) */}
                  <TickCell />
                  <ItemCells sku={item?.variantSku} title={item?.title} spec={item?.spec} />
                  <td data-slot='qty' className='pd-num pd-strong'>
                    {l.quantity}
                  </td>
                  {/* 🔴 金額格**不掛 `pd-strong`** —— 這張紙要員工一眼看到的是【要出幾件】,
                      而金額是給客人核對的。兩個都粗會讓那一眼失去落點。 */}
                  {shippedMoney !== undefined && <MoneyCell amount={shippedAmounts[i] ?? null} />}
                </tr>
              );
            })}
          </Section>

          {/* ── 區塊二:這張單還欠客人什麼 ──
              🔴 **這一區的母體是整張訂單,不是這一箱。** 它回答的是「這張單還沒完」。
              🔴 **算式四項、紙面三格**(Sean `Q-C4`,見 `outstandingQuantity` docstring):
                 「先前已寄走的」**有算進去、但不印出來** ——
                 他要的現象是「最後一批出完之後這一區就空了」,而那只有扣掉先前才會發生。
              ⚠️ **所以本檔【刻意沒有】印一條「訂購 = 本次 + 尚未 + 已取消」的對帳等式** ——
                 那條等式少了「先前已出貨」那一項,**在第二箱就會對不起來**
                 (訂購 5、先前 2、這箱 1 ⇒ 5 ≠ 1 + 2 + 0)。
                 **印一條加不起來的等式,比不印更糟** —— 它會讓客人以為我們算錯了帳。
                 ⇒ 每一區各自報自己的小計,**不跨區宣稱等式**。 */}
          {outstandingRows.length === 0 ? (
            <div className='text-muted-foreground border-t pt-3 text-sm'>
              {/* 🔴 **不可以說「都寄出去了」** —— 這一區空掉有兩個成因:真的都出了,
                  **或者剩下的全被取消了**(codex 抓的,我第一版真的印了那句話)。
                  對客人講「都寄出去了」而其實有幾件是被取消的,那是**紙上直接說謊**。
                  ⇒ 只陳述這一區的事實,成因交給旁邊的「訂單取消」區自己講。 */}
              尚未出貨:無 —— 這張訂單沒有還欠客人的品項。
            </div>
          ) : (
            <Section
              title='尚未出貨'
              note='這張訂單還欠客人的東西(不含這一箱要寄的)'
              qtyHeader='還欠幾件'
              variant='pending'
              money={outstandingMoney}
              orderDisplayId={detail.displayId}
              shipmentReference={shipment.shipmentReference}
            >
              {outstandingRows.map(({ item, qty }, i) => (
                /* 🔴 `pd-wait` 是**稿的列語彙**:`tr.pd-wait .pd-state{font-weight:700;color:var(--pd-ink)}`
                   ⇒ 「數量資料尚未就緒」在紙上是**粗的主色**,不是一行灰字。
                   ⚠️ 改前那句用 `text-amber-800`(琥珀)——**單色雷射印表機上它就是灰的**,
                      而紙面調色盤本來就只有五階灰。⇒ 用「粗 + 主色」表達「這一列要注意」,不靠顏色。 */
                <tr key={item.id} className={qty === null ? 'border-b pd-wait' : 'border-b'}>
                  <ItemCells sku={item.variantSku} title={item.title} spec={item.spec} />
                  {/* 🔴🔴 **R2 MF1+MF2:這一格與另外兩區【必須長得一樣】,而它先前不一樣。**
                      改前:`<td className='pd-num'>` + `<span className='pd-strong'>`,兩個都壞:
                        · 裸 `.pd-num` **(0,1,0)** 輸給 `.pd-items td` **(0,1,1)** ⇒ 它的字級從未生效
                        · **`.pd-strong` 這條規則根本不存在** —— CSS 裡只有 `.pd-num.pd-strong`
                          (要求同一元素帶兩個類)⇒ 那個 `<span>` 一條規則都沒吃到
                      ⇒ **「還欠幾件」印成 9pt 一般字,而「本次出貨」是 10pt 粗 —— 紙上兩區字級相反。**
                      🔴 這與 R1 抓到的 `.pd-sku` 是**同族、同一輪、同一支檔**,而我只修了一個。
                         **我的量具沒看到它,因為量具用 `querySelector` 只取第一個 section。**
                      ⇒ 現在與另外兩區共用同一組類 `pd-num pd-strong`(有真規則、具體度夠)。
                      ⚠️ **只有數字那一支給 `pd-strong`** —— 「數量資料尚未就緒」是**警告不是數字**,
                         給它 10pt 粗會讓一個「不要動這項」的訊息看起來像一個要照做的量。 */}
                  {qty === null ? (
                    <td data-slot='qty' className='pd-num'>
                      {/* 🔴 不知道就明說,**不印下單量、不補 0**(契約見 `outstandingQuantity` docstring)。 */}
                      <span className='pd-state'>
                        數量資料尚未就緒
                        <br />
                        這一項不要當成已出貨
                      </span>
                    </td>
                  ) : (
                    <td data-slot='qty' className='pd-num pd-strong'>{qty}</td>
                  )}
                  {/* 🔴 數量不知道 ⇒ 金額也不知道(`lineAmount` 已經回 `null`)——
                      這一格會印「金額資料尚未就緒」,**不會印 0**。 */}
                  {outstandingMoney !== undefined && (
                    <MoneyCell amount={outstandingAmounts[i] ?? null} />
                  )}
                </tr>
              ))}
            </Section>
          )}

          {/* ── 區塊三:訂單取消(Sean 2026-08-16 逐字給的區名,不要正規化)──
              🔴 **為什麼要獨立一區,而不是把這些列從紙上拿掉**:
                 拿掉的話,客人看到「訂購 5」卻只數得到 3 件,而紙上沒有任何解釋。
              🔴 **也不是掛在區塊一當一列「不出貨」** —— Sean 2026-08-16 逐字
                 「**不揀貨就不需要寫在上方**…不用把不揀貨還要寫在上面**造成誤會**」。
                 ⇒ 「造成誤會」把它定性成**正確性**問題:員工要一眼看出哪些要出、哪些不出。 */}
          {cancelledRows.length > 0 && (
            <Section
              title='訂單取消'
              note='這張訂單裡已經取消的品項,不會出貨'
              qtyHeader='已取消'
              variant='cancelled'
              orderDisplayId={detail.displayId}
              shipmentReference={shipment.shipmentReference}
            >
              {cancelledRows.map(({ item, qty }) => (
                <tr key={item.id} className='border-b'>
                  <ItemCells sku={item.variantSku} title={item.title} spec={item.spec} />
                  <td data-slot='qty' className='pd-num pd-strong'>
                    {qty}
                  </td>
                </tr>
              ))}
            </Section>
          )}

          {/* ── ✅ **金額區塊已落地(2026-08-23 片4)** —— 實體在下方 `.pd-money`,不在這裡 ──
              ⚠️ ~~「金額區塊:刻意還沒做」~~ **原句刪除**(R3 MF3):它在 2026-08-23 之後就是假的,
                 而**下一個人讀完它會認定紙上沒有錢** —— 錢就印在這一段下面。
              🔴 硬條款(不變、不准鬆):**紙上零金額【計算】**。
                 禁止從 `subtotal`/`total` 反推、禁止浮點、禁止自己發明算法;
                 格式化一律走既有 `formatOrderAmount`
                 (**`lib/orders/order-list-view.ts:979`** —— R3 nit:原本寫 `:746`,錯的)。
              ✅ **口徑已落地(片4b,2026-08-24)—— ~~「碼還沒改」~~ 那句原句刪除,它現在是假的。**
                 Sean 2026-08-24 `Q1`=**甲**:兩區 = **本次出貨 + 尚未出貨**,各自合計
                 (canonical `memory/project_0824-sean-shipping-doc-two-sections-confirmed.md`)。
              🔴🔴 **而【兩區合計】與【下面這四行】是「並存」不是「取代」** ——
                 這是最容易被下一個人讀反的一格,所以寫在這裡:
                 ```
                 兩區合計   母體 = 這一箱 / 還欠的      算法 = unitPrice × 本區數量 後加總
                 下面四行   母體 = 整張訂單(全下單量)  算法 = 直接印權威欄, 零運算
                 ⇒ 兩者【本來就不相等】(spec §3 逐字「而那是對的」)
                 ⇒ 紙上不得出現任何跨區等式;差額由 CROSS_SECTION_NOTICE 那句人話交代
                 ```
                 📌 ~~「訂 9 取消 1 ⇒ 訂單金額含被取消那件 ⇒ 兩個數字互相打臉」~~
                    **那個顧慮沒有消失,是【換了處置】** —— 處置不是去改訂單金額
                    (它是權威欄,改了就變成紙上自己算的數字),是**印一句話說明它們為什麼不同**。
                 🔴 **`Q-C11`=甲 仍然成立:訂單取消區【不印金額】,只印件數。**
                    理由要帶著走:客人看到取消品旁邊有金額,第一直覺是「這是要退我的錢」,
                    而實際退款金額走退款流程、可能是不同的數字(部分退、運費不退)。

              ── 🔴 落地前先讀這一段(`#827` 2026-08-21 量測,主視窗裁「甲=先寫成約束」)──
              **列印表格零欄寬控制** ⇒ 金額落地時溢出會**推寬**不是**壓字**,
              `-46` 那片的 `--pcm-money-w` 對它無效;
              ✅ **「驗收必須含真瀏覽器列印預覽 + 七位數」現在構造得出來了**(2026-08-23 片4-R3)。
                 🔴 **而它一度是【從寫下的當下就構造不出來】的**(R3 MF4):
                    `page-measure.test.tsx` 產給人看的每一份 HTML 都是 51,987 / 52,598,
                    **與品項數無關** ⇒ 七位數在自動與人眼兩條路上都長不出來。
                 📌 **一條從出生就無法被滿足的驗收條件,與一條【沒有寫】的,
                    差別在於它看起來已經被涵蓋了。**
                 ⇒ 修法**不是**去改這條驗收,是修那個 fixture:它原本寫死 `subtotal: 51987`,
                    而每列 `lineTotal` 是 222,549 ⇒ **違反 `types.ts:131` 的 `subtotal = Σ lineTotal`**
                    ⇒ 紙上印的是**不可能存在的資料**。改成由品項算出來之後,
                    12 品項那份自然就是 **2,670,588 / 2,671,199**(實查 `/tmp/pcm-print-measure/shipping-12item.html`)。
                 ⚠️ **仍未驗的是【那張紙印出來會不會被推寬】** —— 七位數現在有了,
                    而**沒有人把它印出來看過**。這一格仍然是 Sean 那一關。

              🔴 **同一個病在兩張紙上長成兩個不同的症狀:**
                 後台面板  固定軌 `var(--pcm-money-w)` ⇒ 溢出時**壓字**(還看得出有東西)
                 這張紙    無固定寬、內容自己撐         ⇒ 溢出時**推寬**(撐破 A4)
              ⇒ **不要因為後台那片修好了就以為這裡也修好了。**

              量法(2026-08-21,可重跑):
                `grep -rn "pcm-money-w" apps/admin/src` ⇒ 只在 `globals.css` 與其測試,
                本檔與 `print-a4.css` **零命中**;
                `grep -nE "table-layout|colgroup|<col|w-\[|min-w|max-w|width:"` 打本檔 +
                `picking-doc.tsx` + `print-a4.css` ⇒ 3 命中,**三個都是外層容器的 `max-w-3xl`**,
                表格本身零欄寬(負對照:同一組 pattern 打 `globals.css` ⇒ 51 命中,尺撈得到東西)。
              ⚠️ **誠實邊界**:以上是**字面**。「七位數會不會真的撐破 A4」**沒有量過** ——
                 jsdom 對容器寬度類破版恆綠(`#824`),那把尺對這一題沒有判別力。 */}

          {/* ── 片4:簽名欄整塊拿掉(FIX-61)+ 底部區貼齊紙底(FIX-55/64)────────────
              🔴 **`出貨人:____` 拿掉的依據是【量到的】,不是照抄一句 FIX 標題**:
                 稿 `預覽-出貨明細單.html` 掃 `出貨人` / `簽名` ⇒ **各 0**;
                 掃 `簽收` ⇒ 1,而那 1 筆在**CSS 註解裡**(講 margin-top:auto 的),不是紙上的字。
                 正向對照:同一支 grep 掃「本次出貨」⇒ 2 ⇒ 那些 0 不是分母為 0。
              ⚠️ `Q-C7`=丙(拿掉頁尾手寫日期)那條**沒有被推翻,是被涵蓋了** ——
                 整塊簽名區不在了,手寫日期自然也不在。**但它的守門要留著**:
                 「手寫日期不准回來」在沒有簽名區的世界仍然成立,而且更容易被人「順手」加回來。
              🔴 **`margin-top:auto` 掛在 `.pd-bottom`(整組)不是 `.pd-foot`** ——
                 稿的 CSS 註解逐字記著掛錯的後果:「會把它後面的簽收與頁尾擠出 297mm,
                 實量:紙從 1,122px(A4)長到 1,221px」= 多出 26mm 的空白。 */}
          <div className='pd-bottom'>
            <div className='pd-foot'>
              <section className='pd-contact'>
                {/* ⛔ ~~🔴 同 LOGO 那段:伺服器渲染路上這張 QR 也是 100% 被 303(`proxy.ts:80`)。~~
                    ✅ **2026-08-29 已修(線A):`src` 改成 `QR_DATA_URI`** ⇒ 上面那句不再成立。
                    🔴 **而劃線不刪的是【後果那半】, 它沒有過期**:
                    ⚠️ **QR 缺了比 LOGO 貴:客人掃不到就聯絡不上, 而紙上看起來只是少一塊。**
                    ⇒ 那句話說明的是「為什麼這一格值得裝守門」, 而守門在 `page.test.tsx`。
                    ⚠️ 而原句裡的 `proxy.ts:80` **行號已漂到 `:84`**(該檔 85 行)——
                    ⇒ 這正是「同一支檔裡引別的檔的行號也會漂」的實例, 已交下手窗排 backlog。 */}
                {/* 🔴 `src` 是內嵌常數, 不是 `/print/line-qr.png` —— 那個網址走 `proxy.ts`
                    的登入閘, 沒有 cookie 的請求(伺服器渲染出圖)會被 303, 而症狀是
                    【圖不見了, 不是錯誤】。否決過的三案與理由見 `./print-assets.ts` 檔頭。 */}
                <img className='pd-qr' alt='LINE 官方帳號 QR Code' src={QR_DATA_URI} />
                <div className='pd-ctxt'>
                  <div className='pd-ch'>加入官方 LINE 帳號</div>
                  {/* 🔴 **`lin.ee/egsf1Jy` 是【新增在紙上的字面】**,取自稿逐字。
                      分級 **L2**(與抬頭七值同一族:公司聯絡資料,年 1-3 次會動)——
                      收斂點同樣是 `#248`(登記資料進後台),在那之前它住在這裡。
                      ⚠️ 它與抬頭那行的 `LINE @pcmmoto` **是兩種東西**(邀請連結 vs 帳號 ID),
                         不是重複、也不能互相取代。 */}
                  {/* 🔴 2026-08-29 Sean 逐字回主視窗:**「同一個, 不用改」** ——
                      指的是這張紙上的 LINE 邀請連結與顧客站那顆按鈕**是同一個官方帳號**。
                      ⚠️ **而兩邊的【字面不一樣】, 這一格 `-c8` 當場量過**:
                         紙上 `lin.ee/egsf1Jy` · 顧客站 `apps/storefront/src/components/ComingSoon.tsx:58`
                         `LINE_URL = 'https://lin.ee/R6QZUH2'`(另見 `lib/line-cta.ts:20` 同值)。
                      🔴 **「同一個帳號的兩張邀請卡」是 Sean 說的, 不是我們量到的** ——
                         我們沒有打開任何一個連結去確認它們指向同一個帳號(那要對外請求)。
                      📌 **⇒ 寫在這裡是為了讓下一個人【不要再問第三次】**, 而不是為了宣稱它已驗證。 */}
                  <div className='pd-cu'>lin.ee/egsf1Jy</div>
                  <div className='pd-cp'>
                    收到商品後有任何問題(缺件、外觀損傷、規格不符),請掃描左方 QR Code
                    加入官方 LINE 帳號,並提供本單上的訂單編號。
                  </div>
                </div>
              </section>
              <section className='pd-money'>
                <h2>
                  金額<span>新臺幣</span>
                </h2>
                <table>
                  <tbody>
                    <MoneyRow label='小計' money={detail.subtotal} />
                    {/* 🔴 R3 nit:原本帶 `cls='line'`,而 **`.line` 在我們與稿的 CSS 都是 0 條規則**
                        (實查:兩邊各 0)⇒ 那是一個**只出現在 markup 的死類**。拿掉。 */}
                    <MoneyRow label='運費' money={detail.shippingFee} />
                    {/* 🔴🔴 **這一列稿【沒有】,而我判斷它必須有 —— 理由是算術會對不上。**
                        `packages/domain/src/order/types.ts:133` 逐字:
                        `total = subtotal + shippingFee − discountTotal`。
                        稿只印 小計 / 運費 / 訂單金額 ⇒ **折扣不為 0 時,紙上三個數字加不起來**,
                        而拿到那張紙的是客人。
                        📎 **這不是我推翻設計** —— 稿自己的 `_po_money()` docstring 逐字寫著
                           「**折扣只印一行**(discountTotal 是單一合計值,schema 沒有分項欄)」,
                           而**同一支函式的碼裡沒有那一列**(實查 `patch-orders-ui.py:2264-2277`)。
                           ⇒ 是稿的註解與碼不一致,他們的預覽剛好 discount=0 所以沒人看見。
                        ⚠️ **已回報 OD/線A。** 在他們回覆之前,我採「照 docstring 的意圖補上」。
                        🔴 折扣為 0 時**不印這一列** ⇒ 常見情況下紙面與稿逐字相同。
                        🔴 印負號是**呈現**不是運算:值是欄位原值,負號只是讓那一欄看得懂。 */}
                    {detail.discountTotal.amount > 0 && (
                      <MoneyRow label='折扣' money={detail.discountTotal} negative />
                    )}
                    <MoneyRow label='訂單金額' money={detail.total} cls='grand' />
                  </tbody>
                </table>
                {/* 🔴🔴 **退款小字 —— 逐字搬自稿,一個字未改**(鐵則 1:design 直接搬、不翻譯)。
                    來源:OD `pcm-print-docs/shipping-picking-doc-a4.html` 錨點 `<div class="refund">`
                    (與 `pcm-524f/REF-出貨列印-A4稿-20260816.html` **sha256 相同、diff 0 行**)。
                    🔴 **它不是裝飾** —— 同專案 `contract.md:79` 逐字把它**與金額四項並列**、
                       標為「**必須(缺)**」⇒ 它是合約列舉過而我們一直沒補的欄位。
                    🔴🔴 **那個逗號是【半形】`,`(U+002C),不是全形「,」** —— 這不是筆誤:
                       稿自己的檔尾清單逐字寫著「原始輸入為半形『,』,已逐字照填、未正規化為全形」。
                       ⇒ **誰把它改成全形,就是改了對外紙面的字面,而那是 Sean 的範圍。**
                       字面是從稿的檔案**複製**出來的、不是打出來的(長度 27、`[12]` 是 `0x2c`,當場斷言過)。
                    🔴 **為什麼這句在片4b 之後才變得要緊**:紙上現在**有金額**、且有「訂單取消」區,
                       而 `Q-C11`=甲 明訂**取消區不印金額** ⇒ 客人看到取消品沒有金額、也沒有任何說明。
                       **稿早就替那個拍板配好了這句配套文案,而我們只搬了拍板、沒搬配套。**
                    📎 位置照稿:稿的 `section.money` 裡順序是 **表格 → refund**,本檔照搬。

                    ── 🔴🔴 **條件是我們加的,稿【沒有】這個條件。這一格不是照抄** ──────────
                    第一版我把它印成**無條件**,而 R1(`b0`,2026-08-24)判 must-fix:
                    **一張沒有任何取消品項的出貨單,會印著「取消品項之退款將另行處理」
                      ⇒ 客人以為自己有東西被取消了 ⇒ 而那會產生客服電話。**
                    ⇒ 病與正下方那句 `pd-xnote` **同族**:去解釋一件紙上不存在的事。

                    🔴 **而我去開稿之後,發現稿【回答不了】這個問題,不是回答了「無條件」**:
                    ```
                    稿(shipping-picking-doc-a4.html)只有【一份靜態樣張】, 而它 :391 逐字:
                      「訂購 29 件 ＝ 本次出貨 23 件 ＋ 尚未出貨 4 件 ＋ **已取消 2 件**」
                    ⇒ **稿的那個例子本身就有取消品** ⇒ 它只展示了「有取消品」那一個世界,
                      對「沒有取消品時要不要印」**一個字都沒說**。
                    合約 contract.md:79 也只寫「金額四項 +「訂單金額」+ 退款小字 | 必須(缺)」
                    ⇒ **標了必須, 沒有標條件。**(grep '退款' 全稿 ⇒ 只有 :442 與檔尾談逗號那句)
                    ```
                    ⇒ 📌 **一份靜態樣張展示的是【一個狀態】, 不是【一條規則】。**
                      「樣張上它在」與「它無條件出現」是兩個宣稱, 而樣張對後者沒有判別力。
                    ⇒ 所以這是 R1 的第 ② 條路:**稿的洞, 不是照抄的理由。**

                    ── 🔴🔴 **而這條件現在是【拍板】,不是我們的推測** ────────────────────
                    **Sean 2026-08-24 拍甲**,逐字:「**甲 = 維持我們補的(沒有取消品項就不印)**」。
                    (問法是甲乙兩案:甲=維持 / 乙=無論有沒有取消品項都印。)
                    🔴 **不要把這一段讀成「照稿做的」** —— 稿與合約**都沒有**這個條件,
                       而**稿永遠不會知道我們補過東西**。這段註解是這個決定**唯一的落點**。
                    ⇒ 下一個人若拿稿來對,會看到「碼裡有條件、稿裡沒有」——
                      **那不是漏抄,是這裡拍的板。改它要先回去問 Sean。**

                    🔴 條件**綁到與「訂單取消」區同一個運算式**(`:1002` 錨點 `cancelledRows.length > 0`),
                       不是另寫一個等價判斷 —— 兩個判斷各自漂的話, 會出現
                       **有取消區而沒有這句**(或反過來), 而**兩種都不會紅**。 */}
                {cancelledRows.length > 0 && (
                  <p className='pd-refund'>取消品項之退款將另行處理,實際金額與時間以退款通知為準</p>
                )}
                {/* 🔴 **只有上面真的印了區塊合計時才印這句** —— 沒有區塊合計時,
                    這句話會去解釋一件紙上不存在的事,而那比不解釋更糟。
                    ⇒ 條件與 `Section` 那個 `money.subtotal !== null` 是同一組判斷。 */}
                {/* 🔴🔴 **`=== 2` 不是 `> 0`**(codex 2026-08-24 finding 1;原本寫 `> 0`)。
                    那句話逐字講「**上面兩塊**」「**前面兩個**」⇒ 它**只在真的有兩塊時才是真的**。
                    最後一箱出完 ⇒「尚未出貨」整區不存在 ⇒ 只剩一個本區合計,
                    而那句話還印著 ⇒ **紙上在描述一個不存在的第二個數字**,
                    🔴 而觸發情境是【最常見的那個】,不是邊界。
                    ⚠️ **只剩一塊時【什麼都不印】,而那是一個【已登記的缺口】不是完成品**:
                       客人仍會看到「本區合計 148,366」與下方「訂單金額 52,598」對不起來,
                       而現在沒有一句話解釋。**一塊版的文案是 Sean 的範圍**(同 `Q2`),已端出去。
                       ⇒ **選擇沉默而不是自己寫一句** —— 依據是本檔既有的立場:
                         「**印一條加不起來的等式,比不印更糟**」;說錯話比不說話貴。 */}
                {sectionSubtotalsShown === 2 && <p className='pd-xnote'>{CROSS_SECTION_NOTICE}</p>}
              </section>
            </div>
          </div>
        </>
      )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
