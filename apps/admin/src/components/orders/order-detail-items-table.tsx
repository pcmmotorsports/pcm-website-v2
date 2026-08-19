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
 * 🔴 品項表的欄數。**展開列的 `colSpan` 與表頭欄數必須一致** ——
 * 不一致時瀏覽器會靜默把版面畫歪(不會有任何東西紅)⇒ 抽成常數,並由測試釘住它等於表頭 `<th>` 數。
 */
export const ITEMS_TABLE_COLSPAN = 8;

/**
 * `<tfoot>` 那幾列「標籤」要跨幾欄 —— **算出來的,不是寫死的**。
 *
 * 🔴🔴 **片5 加這個常數,是因為原本那裡是四個寫死的 `colSpan={4}` 加一個裸 `<td />`**,
 *    而它們**不受 `ITEMS_TABLE_COLSPAN` 那道測試管**(那道只釘表頭 `<th>` 數與展開列)。
 *    ⇒ 欄數一變,footer 就**靜默畫歪**:金額對不到「小計」那一欄底下,
 *      而**沒有任何東西會紅**(typecheck 綠、測試綠、grep 數不變)。
 *    ⇒ 這一片把欄數 6 → 8,正是會踩爆它的那種改動。
 *
 * 版面約定:footer 每一列 = 【標籤跨滿左邊所有欄】+【金額落在最後一欄】
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
  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            {/* 🔴 片5:欄名改用設計稿的字面(MAIN-057 §1 區塊②表頭逐字)——
                「品項」→「商品名稱」、「SKU」→「料號」。
                ⚠️ **料號不是新欄位**(MAIN-057 §2-2 逐字「設計稿那一行本來就有」),
                   這裡只是把欄名換成員工講的那個詞。 */}
            <th className={TH}>商品名稱</th>
            <th className={TH}>料號</th>
            {/* 🔴🔴 片5 的核心:三軸各自成欄,而「訂 / 到 / 出」三個字**住在這裡**、
                不再跟著每一列重複三次(Sean 選的丙案;MAIN-057 §2-2)。
                ⚠️ 既有註解那句「欄名與 `ItemAxisCell` 印的段數必須對得上」**現在由結構保證**:
                   一個欄頭對一個 `<td>`,對不上會被下面的 `<th>` 數測試抓到。 */}
            <th className={`${TH} text-right`}>訂</th>
            <th className={`${TH} text-right`}>到</th>
            <th className={`${TH} text-right`}>出</th>
            <th className={`${TH} text-right`}>數量</th>
            {/* 🔴🔴 **「單價」欄【留著】,而這一格的來歷值得留** ——
                片5 的派工單原本寫著「拿掉單價欄」,而 W1(線主)去核原始權威之後**自己撤回了**:
                `grep -n "單價" MAIN-057-…-20260819.md` ⇒ **查無**
                ⇒ **設計稿從頭到尾沒有說要拿掉單價**;那是派工單作者從那張七欄表**推**出來的,
                  然後被寫進驗收條件,於是在下游讀起來像規格。
                ⇒ 而這一格是「改金額」的**唯一入口**(`item-amount-row.tsx:79-94` 的 `priceText` slot;
                  數法 `grep -rn "改金額" apps/admin/src --include='*.tsx' | grep -v '\.test\.'`)
                  ⇒ 照那句字面刪 = 刪掉全後台唯一改品項金額的路(鐵則 12① 錢)。
                📌 **裁定(W1)**:單價原地不動、`ItemAmountRow` 一個字不碰 ⇒ 本表 **8 欄**。
                  7 欄 vs 8 欄改成**肉眼題**,等 Sean 在真環境看;他要拿掉再開一片,
                  **那時才需要動錢的對抗審查** —— 不為一個沒有人要求過的目標先付那筆風險。 */}
            <th className={`${TH} text-right`}>單價</th>
            <th className={`${TH} text-right`}>小計</th>
          </tr>
        </thead>
        <ItemAmountRowGroup>
        <tbody>
          {detail.items.map((item) => (
            // 🔴 #13 片1c-2 版面片:改金額的表單**移出單價格、展開成跨欄的一列**。
            //    那幾格的內容仍在**這裡(server)**算好、當 ReactNode 傳進去;
            //    (原字面「六格」是片5 之前的欄數;現值 8 —— before 6 格 + 單價 1 + after 1。)
            //    `ItemAmountRow` 只握「展開誰」那個 client state ⇒ **本檔仍是 server component**。
            <ItemAmountRow
              key={item.id}
              rowClassName='border-t'
              colSpan={ITEMS_TABLE_COLSPAN}
              priceCellClassName={`${TD} text-right tabular-nums whitespace-nowrap`}
              before={
                <>
                  <td className={TD}>
                    {/* ⏳ **Sean `Q3 = 丙`(品名太長顯示「…」)【不在本片】** —— 這是刻意不做,不是漏掉:
                        · `truncate` 要有一個寬度上限才生效,而**那個數字我今天量不到**:
                          面板 720 固定那條規則在 W1 的 `w1-order-panel`(`50020c4f`),**沒進 dev**,
                          且 W1 片1b 還在加「窄視窗下讓步」⇒ **720 不是一個可以寫死的假設**。
                        · 我一度寫了 `max-w-[22rem]` —— **那是我編的數字,沒有任何出處**,已撤。
                        · `docs/design/admin-design-system.md` §0-D 那組寬度(`col-title` 宣告寬 154px)
                          **是【訂單列表】那張 14 欄表的**(`orders-table.tsx` / `.col-*`),
                          **不是本表**;本表用的是 Tailwind 的 `TH`/`TD`,零 `.col-*`
                          ⇒ **拿它來當本表的依據會是一次跨表誤引。**
                        ⇒ 截斷屬「面板實寬定案之後的版面片」,等 W1 片1b 進 dev 再開。 */}
                    <div>{item.title ?? '—'}</div>
                    {item.spec && (
                      <div className='text-muted-foreground mt-0.5 text-xs'>
                        {Object.entries(item.spec)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </div>
                    )}
                    {/* 三軸缺值時,原因講在這裡(只講一次)—— 見 `ItemAxisMissingNote` 檔頭。 */}
                    <ItemAxisMissingNote summary={item.quantitySummary} />
                  </td>
                  <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                    {item.variantSku}
                  </td>
                  {/* 🔴 三軸:一格一軸。`pick` 決定這一格取哪一個數,
                      而**分母永遠是 `summary.quantity`**(在 `ItemAxisValue` 裡),
                      ⇒ 三格的分母不可能各自漂掉。 */}
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.orderedQuantity} />
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.instockQuantity} />
                  </td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.shippedQuantity} />
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>
                    {item.quantity}
                    {/* 「已取消」掛在數量底下 —— 它是例外不是第四軸,見 `ItemCancelledNote` 檔頭。 */}
                    <ItemCancelledNote summary={item.quantitySummary} />
                  </td>
                </>
              }
              priceText={<>NT$ {formatOrderAmount(item.unitPrice.amount)}</>}
              after={
                <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                  NT$ {formatOrderAmount(item.lineTotal.amount)}
                </td>
              }
              // 🔴 版本用**訂單層**的 `detail.version`,不是品項的 —— RPC 的樂觀鎖比 `v_ord.version`,
              //    而 `AdminOrderDetailItem` 自 A9w3 起就沒有 version 欄。
              orderId={detail.id}
              expectedVersion={detail.version}
              orderItemId={item.id}
              currentUnitPrice={item.unitPrice.amount}
              returnTo={`/orders/${detail.id}`}
              // 🔴 **重構時最容易掉的就是這一行** —— 它是 `unreadable` 的 fail-closed 出口。
              blockedReason={amountEditBlock}
            />
          ))}
        </tbody>
        </ItemAmountRowGroup>
        <tfoot className='border-t text-sm'>
          <tr>
            <td colSpan={ITEMS_FOOTER_LABEL_COLSPAN} className='text-muted-foreground px-3 py-1.5 pt-3 text-right'>
              小計
            </td>
            <td className='px-3 py-1.5 pt-3 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.subtotal.amount)}
            </td>
          </tr>
          <tr>
            <td colSpan={ITEMS_FOOTER_LABEL_COLSPAN} className='text-muted-foreground px-3 py-1.5 text-right'>
              運費
            </td>
            <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.shippingFee.amount)}
            </td>
          </tr>
          {detail.discountTotal.amount > 0 && (
            <tr>
              <td colSpan={ITEMS_FOOTER_LABEL_COLSPAN} className='text-muted-foreground px-3 py-1.5 text-right'>
                折扣
              </td>
              <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
                −NT$ {formatOrderAmount(detail.discountTotal.amount)}
              </td>
            </tr>
          )}
          <tr className='border-t font-medium'>
            <td colSpan={ITEMS_FOOTER_LABEL_COLSPAN} className='px-3 py-2 text-right'>
              總計
            </td>
            <td className='px-3 py-2 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.total.amount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

