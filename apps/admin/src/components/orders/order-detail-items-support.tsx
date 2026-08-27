// order-detail-items-support.tsx — 品項表的葉元件與純判斷(2026-08-24 拆檔片,自
// `order-detail-items-table.tsx` 純搬移;該檔 591 行 > 400,鐵則 6)。
//
// 🔴 **本檔只收「不含品項迴圈」的東西**:三個軸/例外小元件、改金額的純判斷、兩個 colSpan
//    常數、總計區。品項卡的 map 與 `.ihead` 表頭**刻意留在原檔** ——
//    `order-detail-items-table-shape.test.tsx` 對原檔掃「每列的格數 / 自己判卡住」,
//    把 map 搬走會讓那些掃描落在空集合上**變成恆綠**,比紅更糟。
// 🔴 搬移片零行為改動;各段註解逐字原樣(它們記的理由與坑仍有效)。

import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import type { PaymentListData } from './payment-list';

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
    return '這張單已經有收款紀錄,不開放改金額。要調整金額請用本頁最下方的「退款」,或告知系統維護。';
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

/**
 * 小計 / 運費 / (折扣) / 總計 —— 品項卡下方的金額結論區。
 * 🔴 拆檔片(2026-08-24)自 `ItemsTable` 的 return 尾段整塊搬出,JSX 逐字未動;
 *    呼叫端仍是 `ItemsTable`(該檔尾行),**兩個視圖(面板/整頁)都經它渲染**。
 */
/* 🔴 總計區:**設計稿沒有這一塊**(`grep '運費|總計'` ⇒ 零命中),而我方有。
   **「設計稿沒畫」不等於「該刪掉」** —— 拿掉會刪掉真的資訊(小計/運費/折扣/總計)。
   ⚠️ 這是**刻意保留**、不是漏改成卡片。 */
/* ═══ FIX-05(OD):小計 / 運費 / 總計 —— 讓「總計」變成看得出來的結論 ═══════════════
   症狀逐字:「三行同為 14px,總計只多一個 `font-medium`,**金額結論不明顯**」。
   改法逐字:小計、運費 → **12px 且金額也轉灰**;總計 → 金額 `text-lg font-semibold`、
   **標籤改小標籤規格**、上方間距 `mt-1` → `mt-2`。
   🔴 **`NT$` 留著** —— Sean 2026-08-16 `Q-A216-F4` 拍**乙「留著」**:頭條是速覽 ⇒ 不帶幣別;
      **明細表底部的總計是正式金額 ⇒ 帶 `NT$`**。完整理由在
      `order-focal-row.tsx` 搜 `Q-A216-F4`。**不要順手統一成沒有幣別。**
      (🔴 2026-08-27 改指向:那段隨焦點列搬到新檔了;舊檔現在 grep 該字面 ⇒ 0。)
   🔴 **外層那一行 `mt-3 border-t pt-3 text-sm` 一個字沒動**:
      `order-detail-items-table-shape.test.tsx` 的「每列恰好兩格」用它當切段錨點,
      而它守的「金額欄對不對得齊」在本片**沒有被推翻** ⇒ 錨點不該被弄丟。
   🔴 **總計那一行的 `flex justify-between` 必須【連在一起】**:同一格用
      `flex justify-between` 分隔每一列;寫成 `flex items-baseline justify-between`
      會讓總計那列被併進上一列 ⇒ 那格紅,**而畫面看起來完全正常**。⇒ `items-baseline` 排後面。 */
export function ItemsTotals({ detail }: { detail: AdminOrderDetail }) {
  return (
      <div className='mt-3 border-t pt-3 text-sm'>
        <div className='flex justify-between py-1 text-xs'>
          <span className='text-muted-foreground'>小計</span>
          <span className='text-muted-foreground tabular-nums whitespace-nowrap'>
            NT$ {formatOrderAmount(detail.subtotal.amount)}
          </span>
        </div>
        <div className='flex justify-between py-1 text-xs'>
          <span className='text-muted-foreground'>運費</span>
          <span className='text-muted-foreground tabular-nums whitespace-nowrap'>
            NT$ {formatOrderAmount(detail.shippingFee.amount)}
          </span>
        </div>
        {/* ⚠️ 折扣**不隨小計/運費一起轉灰**:OD 那條只點名「小計、運費」,而折扣是
            **會改變應付金額的事實**、又只出現在少數單 —— 轉灰等於把它降級成附註。
            (OD 的快照沒有折扣單、他沒有畫這一列;**這是我方的判斷,不是照抄**,已寫進回報。) */}
        {detail.discountTotal.amount > 0 && (
          <div className='flex justify-between py-1 text-xs'>
            <span className='text-muted-foreground'>折扣</span>
            <span className='tabular-nums whitespace-nowrap'>
              −NT$ {formatOrderAmount(detail.discountTotal.amount)}
            </span>
          </div>
        )}
        <div className='mt-2 flex justify-between items-baseline border-t pt-2'>
          <span className='text-muted-foreground text-xs font-bold tracking-[1.5px]'>總計</span>
          <span className='text-lg font-semibold tabular-nums whitespace-nowrap'>
            NT$ {formatOrderAmount(detail.total.amount)}
          </span>
        </div>
      </div>
  );
}
