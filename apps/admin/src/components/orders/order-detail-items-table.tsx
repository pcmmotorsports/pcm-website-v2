// order-detail-items-table.tsx — 訂單明細頁的「品項」表格(M-4b E10 #13 片1c-2 版面片抽出)。
//
// 🔴 **為什麼在這一片抽**(鐵則 6:>400 行預設拆,不拆要寫理由):
//    `order-detail.tsx` **本片開工時 582 行**(`git show <本片前的 HEAD>:…|wc -l`,可驗);
//    接上展開列之後 600 行(**那個 600 沒有進 git**,任何人回頭量都量不到、別拿它當基準);
//    把這一塊抽走之後 **404 行**。
//    ⚠️ **404 仍然 > 400** —— 抽這一塊**沒有讓它達標**,只是把最大的一塊搬到它自己的檔。
//    下一塊(客戶資訊 / 收件與出貨 / 付款 / 發票四張卡 + `Field`)**留給另一片**,
//    前提是先查 `Field` 是不是只有那四張卡在用(**我沒查**)。
//
// 🔴🔴 **這個「寫理由」是【有期限的】,不是永久豁免**(主視窗 2026-08-16 裁):
//    現在 404 行、距 400 只有 **4 行** ⇒ **下一次任何人動 `order-detail.tsx`,
//    先抽下一塊再改,不得再走「寫理由」這條路徑。**
//    理由:那條路徑用第二次就變成慣例,而**慣例不會有人回頭檢查**。
//    ⚠️ 下一塊的前提仍是先查 `Field` 有沒有別的使用者(`grep "<Field"` 別檔 23 處命中,未分類)。
//
// 📎 旁證(主視窗 2026-08-16 量):`apps/admin/src/components` 底下 >400 行的**非測試**檔共 5 支 ——
//    741 `ui/sidebar.tsx` / 538 `orders/orders-table.tsx` / 463 `orders/shipment-dialog.tsx` /
//    404 本檔的來源 `orders/order-detail.tsx` / 403 `orders/item-procurement-form.tsx`。
//    ⇒ 「>400 就必拆」**不是本 repo 的實際共識**(403 那支沒有人管);
//      本片是這一輪**唯一主動減了 178 行**的。
//
// 🔴 **為什麼不是「另開一片專門拆檔」**:那條規矩的理由是「拆檔會蓋掉真正的改動」,
//    而**本片就是在改這一塊** ⇒ 兩者不再混淆,那個理由在這裡不成立。
//    ⇒ commit body 分兩段講(版面改動 / 抽檔),讓 reviewer 分得出哪些行是哪一件。
//
// 🔴 **本檔仍是 server component**(無 `'use client'`)——
//    唯一的 client 島是 `item-amount-row.tsx`,它只握「展開誰」那個狀態。

import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import type { PaymentListData } from './payment-list';
import { ItemAmountRow, ItemAmountRowGroup } from './item-amount-row';
// 🔴 片6a-2:「卡住」的**唯一定義**在 `item-stuck.ts` —— **本檔不得自己再判一次**。
//    兩邊各判各的,症狀是**畫面自洽而互相矛盾**(卡是開的、旁邊卻沒有異常字),而不會有東西紅。
import { describeItemStuck, resolveItemStuck } from '../../lib/orders/item-stuck';

/* ─────────────────────────────────────────────────────────────────────────
 * 🔴🔴 **片 A-1(2026-08-17)那段檔頭的【承接】—— 片5 拆欄時我一度把它整段刪掉了。**
 *
 * 刪掉的原因是那段講的是「三軸擠在**同一格**裡怎麼排」,而那一格已經不存在了。
 * ⚠️ **但那段裡有四件事跟版面無關,刪掉等於把它們一起帶走** —— 而**沒有任何東西會紅**。
 * 逐條交代哪些還活著、哪些真的過期了(過期的也講一句為什麼,不要無聲蒸發):
 *
 * ✅ **仍然成立(片5 原樣繼承)**
 * 1. 🔴 **收工時不准寫「商品導向做完了」** —— 定案版的商品導向是 `.pcard` 商品卡 + 三個收合段
 *    + 到貨登錄移出 9 欄表(OD `overview-desktop.html:1024-1101`),**本片一個字都沒做**。
 *    ⚠️ 原句是「這一格改完之後會**長得很像** `.pcstep`」;**片5 之後更像** ——
 *    三軸各自成欄、欄頭帶字,螢幕上已經很接近定案版那一排。**長得像不等於做到了。**
 *    📌 分母(2026-08-19 實查,**口徑寫在數字旁邊**):
 *       `git grep -c 'pcard' dev -- apps/admin/src` ⇒ **1 命中,而那 1 處是本檔這段
 *       【說它還沒做】的註解本身** ⇒ **實作 0 處**。
 *       `item-procurement-section.tsx:139`(JSX 註解內,非檔頭)逐字記著「片 2/3(商品卡外殼與三段接線)**Sean 沒批**」。
 *    🔴🔴 **而這個數字我第一次量錯了,錯法值得留**:我在**自己的工作樹**上量,得到 **0** ——
 *       而 0 的成因是**我剛剛把唯一那處註解刪掉了**(拆欄時整段檔頭一起換掉)。
 *       ⇒ **那個「0」是真的,它只是描述了一個【我自己剛造出來的世界】。**
 *       ⇒ 我拿它去論證「卡外殼零落地」——**結論恰好對,而證據是我自己製造的**。
 *       ⇒ 判別句:**我量的那棵樹,是不是已經被我改過了?** 要答「有沒有這個東西」,
 *         量 `dev`(或未改的基準)而不是量自己的工作樹。(這一格是 W1 對出來的:
 *         他在 `dev` 上量到 1、我在自己樹上量到 0,**兩個數字都對**。)
 * 2. 🔴 **「已取消」是【例外】不是第四段** —— 見 `ItemCancelledNote`,片5 把它搬到數量格底下,
 *    語意(只在 >0 時出現、`text-destructive`)一個字沒改。
 * 3. 🔴 **`shippedQuantity` 不是新資料** —— `packages/domain/src/order/types.ts` 早就有;
 *    這一直是「資料在、畫面沒顯示」,零 schema、零查詢改動。片5 仍然如此。
 * 4. ⚠️ **不讓這一格自己折行 —— 容器窄時應該讓【整張表橫捲】**(與全表一致的行為)。
 *    原句講的是「不加 `flex-wrap`」,而 flex 容器已不存在;**規則的射程沒變**:
 *    三個新欄都帶 `whitespace-nowrap` ⇒ 窄的時候整張表橫捲,不是某一格自己折兩行。
 *    🔴 **理由要跟著走**:折行會把「**列高不變**」弄丟,而那正是 Sean 選乙的理由(見下)。
 *
 * 🗑 **因為結構改動而真的過期的(留一句訃聞,不要讓人以為我沒看到)**
 * · Sean 的 **甲(直排)/ 乙(橫排)** 二選一與那組高度量測(439px vs 219px):
 *   他**看實體版本**選了乙(橫排、列高不變),而「他在文字階段答過甲、看完圖改成乙,
 *   **以最終那次為準**」這句是決策史,值得留在這裡。
 *   ⇒ 片5 的三欄**仍然是橫的、列高仍然不變** ⇒ **他那個拍板沒有被推翻,是被實作成另一種形狀**。
 * · `gap-x-3` 與「不放 `·` 分隔字元(多吃寬度 + 螢幕閱讀器會念出來)」:
 *   那是**同一格內**分隔三段的做法;拆成三個 `<td>` 之後由表格本身分隔 ⇒ 不再適用。
 *   ⚠️ 但那條**理由**在別處仍然有效:**不要用裝飾字元當分隔**。
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * 三軸(訂 / 到 / 出)其中**一軸**的值 —— 一格一軸,不再三軸擠一格。
 *
 * 🔴🔴 **片5:「訂貨 · 到貨 · 出貨」從【值】搬到【欄頭】(Sean 選的丙案)。**
 *    MAIN-057 `:113` 逐字(**全形標點原樣**,標逐字就要 `grep` 命中得了):
 *    `膠囊只留數字，「訂/到/出」移到欄頭（丙案）`
 *    同檔 `:69` 另有一句:「**膠囊只留數字**(`2/2` `1/1` `0/1`),而「訂/到/出」三個字**移到欄頭**」。
 *    ⇒ 每一格只剩 `2/2` 這種數字,而那三個字在表頭出現**一次**而不是每列重複三次。
 *
 * 🔴 **`summary` 為 `null` 時回「—」而不是 `0/0`** —— 那是**兩件不同的事**:
 *    「數量資料尚未就緒」與「一件都還沒訂」在畫面上必須分得開,
 *    印 `0/0` 會讓員工以為系統說「確定是零」。
 *    (原本三軸擠一格時,這一格印的是整句「數量資料尚未就緒」;拆欄之後那句話塞不進
 *     一個窄欄,所以改成「—」,而**那句話沒有消失** —— 見 `ItemAxisMissingNote`。)
 */
export function ItemAxisValue({
  summary,
  pick,
}: {
  summary: AdminOrderItemQuantitySummary | null;
  pick: (s: AdminOrderItemQuantitySummary) => number;
}) {
  if (!summary) return <span className='text-muted-foreground'>—</span>;
  return (
    <span className='tabular-nums'>
      {pick(summary)}/{summary.quantity}
    </span>
  );
}

/**
 * `summary` 缺值時,在**商品名稱格底下**補一句話。
 *
 * 🔴 **為什麼不是讓三個軸各自印「尚未就緒」**:那會把同一句話印三次,
 *    而且每一格都太窄。⇒ 三軸印「—」,**原因只講一次**,講在那一列讀得到的地方。
 * ⚠️ 這是**片5 的新行為**:拆欄之前那句話出現在三軸那一格裡。
 *    語意沒變(仍然只在 `summary` 缺值時出現),位置變了。
 */
export function ItemAxisMissingNote({ summary }: { summary: AdminOrderItemQuantitySummary | null }) {
  if (summary) return null;
  return <div className='text-muted-foreground mt-0.5 text-xs'>數量資料尚未就緒</div>;
}

/**
 * 「已取消 N」——  🔴 **它不是第四個軸,是【例外】**(本檔既有註解逐字,片5 原樣繼承)。
 *
 * ⇒ 所以它**沒有自己的欄**(設計稿那七欄裡也沒有它),而是掛在**數量**那一格底下:
 *   「這一列共 N 件,其中 M 件已取消」在語意上就屬於數量。
 * 🔴 保留 `text-destructive` 讓它跳出來(既有理由,未改)。
 * ⚠️ **而「放在數量格」是我(片5)的判斷,不是設計稿講的** —— 設計稿那七欄沒有涵蓋這個狀態。
 *    可推翻;推翻時請一起想「那它該出現在哪」,**不要直接刪掉**(0 件取消是常態,
 *    非 0 的那幾列正是員工要看見的)。
 */
export function ItemCancelledNote({ summary }: { summary: AdminOrderItemQuantitySummary | null }) {
  if (!summary || summary.cancelledQuantity <= 0) return null;
  return (
    <div className='text-destructive mt-0.5 text-xs whitespace-nowrap'>
      已取消 <span className='tabular-nums'>{summary.cancelledQuantity}</span>
    </div>
  );
}

/**
 * 🔴 **改金額能不能開放,在這裡先判一次**(R3/fable F2)。
 *
 * **為什麼要在 UI 判**:house 工作流**收款排第一**(Sean 2026-08-12 拍板)
 * ⇒ 員工手上的單**多半已收款** ⇒ 若每張單每個品項都給一個可以按的框,
 * **這個表單最常見的使用結果就是「被拒絕 + 一句模糊文案」**。
 * ⇒ 違反 Sean 2026-08-11 常設驗收「**不用人教能做對**」。
 *
 * 🔴 **disabled + 就地寫明原因,不是隱藏** —— 隱藏會讓員工找不到而懷疑自己。
 *
 * ⚠️ **這是 advisory,不是保證**(同 `cancellationPaymentTrace` 那段的處置):
 * 讀到這個判斷與員工按下去之間,隨時可能多一筆收款。
 * **權威永遠是 RPC 在交易內的重查**(`20260815040000:388`)⇒ **RPC 回拒是正常路徑**,
 * 由 banner 兜底,不是「不該發生」的例外。
 */
export function resolveAmountEditBlock(
  detail: AdminOrderDetail,
  payments: PaymentListData,
): string | null {
  // 🔴 讀不到收款時 **fail-closed**:`'unreadable'` 的語意是「**不知道有沒有**」,不是「沒有」。
  if (payments.status === 'unreadable') {
    return '付款紀錄讀取不完整,暫時不開放改金額。請重新整理;若持續如此請找系統維護。';
  }
  if (payments.status === 'order_not_found') {
    return '讀不到這張訂單的收款紀錄,暫時不開放改金額。';
  }
  if (payments.rows.length > 0) {
    // RPC `:388` 逐字:有**任何一列**收款就拒(不使用任何金額口徑)。
    return '這張單已經有收款紀錄,不開放改金額。需要調整請走退款流程,或告知系統維護。';
  }
  if (detail.discountTotal.amount !== 0) {
    // RPC `:398`:本功能尚未處理折扣單的改價(母 plan 已知限制 L2)。
    return '這張單有折扣,目前還不支援改金額。請告知系統維護。';
  }
  return null;
}

/**
 * 🔴 **這個常數現在【只剩舊的表格殼在吃】,而那個殼在本檔零呼叫端**(片6a-1 起)。
 *
 * ⚠️ **上一版這段 JSDoc 已過期,W3 標出來的**:它寫「展開列的 `colSpan` 與**表頭欄數**必須一致…
 *    由測試釘住它等於表頭 `<th>` 數」—— 而**片6a-1 之後本檔沒有 `<table>` 也沒有 `<th>`**。
 *    ⇒ **那句在新結構下沒有對象了。**
 * 🔴 **而常數本身【不刪】**:`ItemAmountRow` 的 `table-row` 殼仍然吃它,而那個殼還在
 *    (整頁版與日後任何表格情境用得到)。**刪掉它會在刪掉那個殼之前就先紅**,
 *    而「這個殼還要不要」不是本片要回答的問題。
 *    ⇒ W3 刻意**沒有**加一格斷言它消失 —— 那會守到一個還沒被決定的東西。
 */
export const ITEMS_TABLE_COLSPAN = 8;

/**
 * `<tfoot>` 那幾列「標籤」要跨幾欄 —— **算出來的,不是寫死的**。
 *
 * 🔴🔴 **片5 加這個常數,是因為原本那裡是四個寫死的 `colSpan={4}` 加一個裸 `<td />`**,
 *    而它們**不受 `ITEMS_TABLE_COLSPAN` 那道測試管**(那道只釘表頭 `<th>` 數與展開列)。
 *    ⇒ 欄數一變,footer 就**靜默畫歪**:金額對不到「小計」那一欄底下,
 *      而**沒有任何東西會紅**(typecheck 綠、測試綠、grep 數不變)。
 *    ⇒ 片5 把欄數 6 → 8,正是會踩爆它的那種改動。
 *
 * ⚠️ **片6a-1 之後這個常數在本檔【沒有消費端】** —— 總計那一區已改成 flex,不再跨欄。
 *    **不刪的理由同上面那個常數**:它屬於還在的那個表格殼,而那個殼的去留不是本片的題目。
 *    🔴 **而「不變量消失了」與「守門被弄丟了」在 diff 上長得一樣** ⇒ 所以在這裡明寫它消失了,
 *       而不是靜靜把測試刪掉(W3 重寫那七格時照同一條紀律,逐格標了原樣／換定位／真的消失)。
 *
 * 版面約定(**舊表格殼專用**):footer 每一列 = 【標籤跨滿左邊所有欄】+【金額落在最後一欄】
 * ⇒ 標籤跨 `ITEMS_TABLE_COLSPAN - 1`,金額 1 欄,**尾巴不再需要裸 `<td />`**。
 */
const ITEMS_FOOTER_LABEL_COLSPAN = ITEMS_TABLE_COLSPAN - 1;

export function ItemsTable({
  detail,
  payments,
}: {
  detail: AdminOrderDetail;
  payments: PaymentListData;
}) {
  const amountEditBlock = resolveAmountEditBlock(detail, payments);
  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';
  /**
   * 🔴 片6a-1:**表格 → 表頭列 + 每個商品一張可展開的卡**。
   *
   * **依據**:Sean 2026-08-19 看兩張真畫面後逐字選「**甲 = 一個商品一張卡片,沒有表格**」;
   * 而設計稿 08-17「720 側邊欄確認稿」`:280-299` 畫的正是 `.ihead` 表頭列 + 每列一個
   * `<details class="icard">`(**零 `<table>`**)⇒ 他的答案與設計稿同一個東西。
   *
   * **搬的是哪一份**:`~/.claude/projects/…/tool-results/artifact-c3c6cc94-1786959567-bf41.html`
   * (669 行 / **mtime 2026-08-17 18:39**)。⚠️ **不是 Aug-13 那份**(那份 class 叫 `.pcard`,已過期)。
   *
   * 🔴 **三處刻意偏離,都不是漏搬**(逐條理由在 `globals.css` 片6a-1 那段):
   *   ① 膠囊**方角**(設計稿是 `999px` 圓角;Sean 08-16 拍「方角、全站統一沒有例外」)
   *   ② **六軌**(設計稿五軌無單價;Sean 08-19 逐字「要顯示」)
   *   ③ **總計那一區留著** —— 設計稿 `grep '運費|總計'` ⇒ **零命中**,而我方有小計/運費/折扣/總計。
   *      **「設計稿沒畫」不等於「該刪掉」** ——拿掉會刪掉真的資訊。
   */
  return (
    <div className='rounded-lg border bg-card p-4'>
      {/* 🔴 表頭列與每一列**必須共用同一組軌道**(`.ihead` / `.iline` 在 CSS 裡是同一條規則)。
          設計稿 `:119-120` 自己記著:兩個獨立 grid 的 `auto` 欄各自依內容算寬
          (「數量」2 字 vs 「×2」)⇒ **實測整排錯開 8px**。**那是會靜默錯開、沒有東西會紅的東西。** */}
      <div className='ihead'>
        <span>商品名稱</span>
        <span>料號</span>
        {/* 🔴 丙案:「訂 / 到 / 出」三個字**住在欄頭**,不再跟著每一列重複三次
            (Sean 選的;設計稿 `:280` 註解逐字「② 商品:五欄 + 丙案三軸」)。 */}
        <span className='three'>
          <span>訂</span>
          <span>到</span>
          <span>出</span>
        </span>
        <span className='text-right'>數量</span>
        <span className='text-right'>單價</span>
        <span className='text-right'>小計</span>
      </div>

      <ItemAmountRowGroup>
        {detail.items.map((item) => {
          // 🔴 **三個世界,不是兩個**(`item-stuck.ts` 檔頭逐字):`unknown` **不是「不卡」的一種**。
          //    靜靜當成 `not-stuck` ⇒ 卡住的那一項不會自己打開,**而畫面看起來完全正常**。
          //    ⇒ 所以下面兩件都要做:①只有 `stuck` 才自動展開 ②`unknown` 的話**把話講出來**。
          const stuck = resolveItemStuck(item.procurements, item.procurementTruncated);
          const stuckNote = describeItemStuck(stuck);
          return (
          <ItemAmountRow
            key={item.id}
            variant='card-line'
            colSpan={ITEMS_TABLE_COLSPAN}
            /* 🔴🔴 片6a-2:**缺料那一項自己打開**(設計稿 `MAIN-057 §1` 區塊② 逐字
               「這一項【展開】了(卡住的那一項會自己打開)」)。
               判斷來自 `item-stuck.ts` 的**唯一定義**,本檔零判斷邏輯。
               ⚠️ **依據標弱,不得寫成「Sean 已批」**:他選的是「卡片 vs 表格展開列」,
                  而**自動展開在兩張原型裡是常數、不是變數** ⇒ 他**看過而沒有反對**,不是選了它。
                  ⇒ 已列成肉眼題,等他在真環境看。 */
            defaultOpen={stuck.kind === 'stuck'}
            before={
              <>
                {/* 🔴🔴 **codex 關卡2 must-fix 4**:上一版把橫向捲動拿掉(`overflow-x-auto` 隨表格一起沒了)
                    **同時**加了三處 `truncate`,而**沒有給任何看到完整值的路** ——
                    長料號 / 長規格會變成**畫面上讀不出來的資訊**。**那是行為退化,不只是版面改動。**
                    ⇒ 修法三件:
                      ① 品名與料號補 `title`(游標停住看得到完整值)——
                         **這不是我發明的**:Aug-13 設計稿 `:1027` 逐字 `<span class="nm" title="${l[3]}">`。
                         🔴🔴 **而本片其餘每一格都搬 08-17 那版,只有這一格【刻意用舊版】** ——
                            08-17 那版 `grep title=` ⇒ **零命中**,也就是**它沒有逃生門**。
                            ⇒ **不要以為我搬錯版本**;是新版在這一格比舊版差,我取較安全的那一份。
                            (成因值得記:**兩個各自合理的改動 —— 拿掉橫捲 + 加截斷 ——
                             合起來把一條資訊路徑關掉了,而單看任一個 diff 都不會發現。**)
                      ② **規格那一行不截斷,讓它換行** —— 它是次要行,換行零資訊損失。
                      ③ 品名 `title` 用 `?? undefined`:`title=""` 會讓某些瀏覽器顯示一個空 tooltip。
                    ⚠️ **`title` 只在游標停住時看得到** —— 觸控與純鍵盤看不到。
                       Sean `A2` 拍板「員工用電腦」⇒ 這條路成立;**若日後要支援平板,這一格要重做。** */}
                <div className='min-w-0'>
                  <div className='truncate text-[13px]' title={item.title ?? undefined}>
                    {item.title ?? '—'}
                  </div>
                  {item.spec && (
                    <div className='text-muted-foreground mt-0.5 text-xs'>
                      {Object.entries(item.spec)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ')}
                    </div>
                  )}
                  {/* 三軸缺值時,原因講在這裡(只講一次)—— 見 `ItemAxisMissingNote` 檔頭。 */}
                  <ItemAxisMissingNote summary={item.quantitySummary} />
                  {/* 🔴 片6a-2:卡住的原因、以及**判不出來**的兩種原因,都畫在這裡。
                      `describeItemStuck` 對 `not-stuck` 回 `null` ⇒ **只有那一種可以沉默**
                      (我們確定它沒卡住);其餘兩種都必須出聲。 */}
                  {stuckNote !== null && (
                    <div
                      className={
                        stuck.kind === 'stuck'
                          ? 'text-destructive mt-0.5 text-xs'
                          : 'text-muted-foreground mt-0.5 text-xs'
                      }
                    >
                      {stuckNote}
                    </div>
                  )}
                </div>
                <div
                  className='text-muted-foreground truncate font-mono text-xs font-semibold'
                  title={item.variantSku}
                >
                  {item.variantSku}
                </div>
                {/* 🔴 三軸:一格一軸,分母永遠是 `summary.quantity`(在 `ItemAxisValue` 裡)
                    ⇒ 三格的分母不可能各自漂掉。
                    🔴 `pcm-pill` 的寬度來自 `--pcm-pill-w`,**與欄頭那三格同一個變數** ——
                       那是設計稿記的 8px 坑的修法本體,不要改成寫死的數字。 */}
                <div className='pcm-step'>
                  <span className='pcm-pill'>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.orderedQuantity} />
                  </span>
                  <span className='pcm-pill'>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.instockQuantity} />
                  </span>
                  <span className='pcm-pill'>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.shippedQuantity} />
                  </span>
                </div>
                <div className='text-right text-xs tabular-nums'>
                  {item.quantity}
                  {/* 「已取消」掛在數量底下 —— 它是例外不是第四軸,見 `ItemCancelledNote` 檔頭。 */}
                  <ItemCancelledNote summary={item.quantitySummary} />
                </div>
              </>
            }
            priceText={<>NT$ {formatOrderAmount(item.unitPrice.amount)}</>}
            after={
              <div className='text-right text-[13px] font-bold tabular-nums whitespace-nowrap'>
                NT$ {formatOrderAmount(item.lineTotal.amount)}
              </div>
            }
            // 🔴 版本用**訂單層**的 `detail.version`,不是品項的 —— RPC 的樂觀鎖比 `v_ord.version`。
            orderId={detail.id}
            expectedVersion={detail.version}
            orderItemId={item.id}
            currentUnitPrice={item.unitPrice.amount}
            returnTo={`/orders/${detail.id}`}
            // 🔴🔴 **重構時最容易掉的就是這一行** —— 它是 `unreadable` 的 fail-closed 出口,
            //    也是「已收款 ⇒ 不得改金額」那道全站唯一的閘走到畫面上的最後一段。
            //    主視窗 2026-08-19 裁本片中鐵則 12①,用的就是這個理由:
            //    **一道閘在殼被重寫的過程中被漏掉,不會有東西紅。**
            blockedReason={amountEditBlock}
          />
          );
        })}
      </ItemAmountRowGroup>

      {/* 🔴 總計區:**設計稿沒有這一塊**(`grep '運費|總計'` ⇒ 零命中),而我方有。
          **「設計稿沒畫」不等於「該刪掉」** —— 拿掉會刪掉真的資訊(小計/運費/折扣/總計)。
          ⚠️ 這是**刻意保留**、不是漏改成卡片。 */}
      <div className='mt-3 border-t pt-3 text-sm'>
        <div className='flex justify-between py-1'>
          <span className='text-muted-foreground'>小計</span>
          <span className='tabular-nums whitespace-nowrap'>
            NT$ {formatOrderAmount(detail.subtotal.amount)}
          </span>
        </div>
        <div className='flex justify-between py-1'>
          <span className='text-muted-foreground'>運費</span>
          <span className='tabular-nums whitespace-nowrap'>
            NT$ {formatOrderAmount(detail.shippingFee.amount)}
          </span>
        </div>
        {detail.discountTotal.amount > 0 && (
          <div className='flex justify-between py-1'>
            <span className='text-muted-foreground'>折扣</span>
            <span className='tabular-nums whitespace-nowrap'>
              −NT$ {formatOrderAmount(detail.discountTotal.amount)}
            </span>
          </div>
        )}
        <div className='mt-1 flex justify-between border-t pt-2 font-medium'>
          <span>總計</span>
          <span className='tabular-nums whitespace-nowrap'>
            NT$ {formatOrderAmount(detail.total.amount)}
          </span>
        </div>
      </div>
    </div>
  );
}
