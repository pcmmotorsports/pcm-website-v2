// OrderDetailView.tsx — 會員訂單明細頁的版面(`#240`;/account/orders/<displayId>)
//
// 🔴 直接搬 OD 稿 `pcm-home-redesign/order-detail-page.html`(305 行)的字面與 class,不翻譯、不重寫:
//   .od-back / .od-head(.od-status + h1 + .od-head-meta)/ .od-steps / .od-line / .od-sums /
//   .od-info(Shipping | Payment)/ .od-help
//   樣式住在 OD 的 `pcm-account.css:1167` 起「訂單詳情」段(與會員中心共用 .acc-main / .acc-section)。
//
// 🔴 **稿上有、而本片【刻意不做】的東西**(每一個都是「沒有資料來源」,不是漏做):
//   ⛔ ~~· 「下載訂單 PDF」鈕 —— 稿註解要求真站接 /account/orders/<id>/statement.pdf 由後端產;
//     後端不存在 ⇒ **做出來就是第二顆死鈕**,而本片存在的理由正是消滅第一顆。~~
//   ✅ **2026-08-30 片 C:那顆鈕接上了**(板 `:416` ⟦b4-CUSTPDF1⟧;片 A 路由+授權、片 B 紙面已落地)。
//     🔴 ⛔ ~~而它的 URL 是 `/account/orders/<displayId>/statement`,【沒有 `.pdf`】——
//        稿 `:288` 寫的是 `statement.pdf`,而那句話**假設的是伺服器產檔**;
//        Sean 的選型走甲案(客人自己的瀏覽器按列印/儲存成 PDF)⇒ 那條路沒有 `.pdf` 這個網址。~~
//     🔴🔴 **2026-09-06 訂正:那句話【過期了】——`.pdf` 那條路現在存在。**
//        `apps/storefront/src/app/account/orders/[displayId]/statement.pdf/route.ts`
//        (片 C3,主視窗 2026-08-31 批;檔頭 `:1` 逐字「伺服器產檔,零對外請求」)。
//        ⇒ 📌 **而本頁【沒有任何連結指向它】** —— 下面那顆鈕指的是網頁版 `/statement`。
//        ⇒ 🛑 **所以今天客人拿不到那個 PDF,而路由是好的** ——
//           一個做好了而沒有入口的東西,與「沒做」在客人那端**印同一個畫面**。
//     ⚠️ **而補入口這件事【卡在文案】,不卡在技術**:稿 `:288` 逐字
//        「真站:改成 `<a href="/account/orders/<id>/statement.pdf" download>` 由後端產」
//        ⇒ 稿只畫**一顆**鈕、而那顆的字面就是「下載訂單 PDF」——
//        **與下面這顆現有的鈕同名,而現有這顆指向網頁版。**
//        ⇒ 🔴 兩顆同名 / 改現有這顆的去向 / 給網頁版另一個名字 —— **三種都動到 Sean 拍過的字面**
//           (見下方 `:361` 那段:「那個字面是 Sean 的板 ⇒ 我不自己加」)
//        ⇒ ✅ **已開板列 `⟦front-PDFLINKMISSING⟧` 並端主視窗轉 Sean;本片只訂正事實,不動畫面。**
//        ⇒ **照稿抄那一行的話, 這顆鈕會 404** —— 而稿 `:286` 自己逐字警告的正是那件事
//          (「不假裝下載成功、也不給一個會 404 的 href」)。**稿在同一段裡同時給了陷阱與警告。**
//     ⚠️ **一個【我沒有自己決定】的字**:鈕上的字照稿是「下載訂單 PDF」,而**點下去不會下載一個檔**,
//        是打開一頁可以列印的明細(那一頁自己的鈕才寫「列印 / 儲存成 PDF」)。
//        ⇒ 客人的目的達得到, 而「下載」這兩個字比實際多說了一點點。
//        ⇒ **照鐵則 1 先搬稿的字面, 並把這一格交給 Sean 拍**(文案調性是他的板, 不是我的)。
//        🔴 **而稿那個字面本身就是一板**:稿 `:193` 逐字帶著「**(2026-08-07 Sean 拍板)**」
//           ⇒ 動它 = 動一板, 而唯一可以偏離稿字面的理由是**另一板推翻它**。
//        🔴🔴 **落點**:板 `docs/launch-todo.md:416` ⟦b4-CUSTPDF1⟧ 尾端「待 Sean 拍」那一格
//           (第 3 題 `Q-明細鈕文案`)。**寫在那裡而不是只寫在這裡** ——
//           一句「交給 Sean 拍」如果沒有落點, **session 結束它就消失, 而鈕已經上線了**。
//           (code-reviewer 2026-08-30 抓:同檔另兩處待拍都寫了落點, 只有這一處沒有。)
//   · 物流(courier / trackingNo / trackingUrl / 物流歷程)與進度軸後兩階 ——
//     稿 :167-175 自己就寫著「需要第 2 批【包裹真相】」,且逐字警告
//     **「fulfillment_status 是 stale 出貨軸,拿它點亮『已出貨』等於對客人說謊」**。
//     ⇒ 後兩階畫成未完成的空心點,**這是稿指定的誠實狀態**,不是缺工。
//   · etaLabel / discountLabel —— 零資料來源。
//
// 🔴 狀態字面**一律呼叫 orderStatusLabel()**、不照抄稿上那串三元運算:
//   稿是 2026-08-07 的,而 Sean 2026-08-18 拍 Q06=甲 把 partiallyPaid 從「付款確認中」改成
//   「已收訂金」⇒ **逐字搬稿會把一個被推翻的字面搬回線上**。tone 才照稿(spec 附錄 B-5)。

import Link from 'next/link';
import type { MemberOrderDetail, MemberOrderDetailItem, OrderItemVehicleSnapshot, PaymentStatus } from '@pcm/domain';
import { subtotalLabelOf } from '@pcm/domain';
import {
  PCM_REMITTANCE_ACCOUNT_NAME,
  PCM_REMITTANCE_ACCOUNT_NO,
  PCM_REMITTANCE_BANK_NAME,
  PCM_REMITTANCE_BRANCH,
  PCM_REMITTANCE_EXPIRE_DAYS,
  remittanceDeadlineLabel,
  PCM_REMITTANCE_MEMO_INSTRUCTION,
} from '@pcm/domain';
import { ProductImage } from '@/components/ProductImage';
import {
  formatOrderDate,
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
} from '@/lib/orders/order-display';
import {
  ORDER_DETAIL_ITEM_CANCELLED_MARK,
  ORDER_DETAIL_ITEM_SHIPPED_MARK,
  ORDER_DETAIL_ITEMS_TRUNCATED_NOTE,
  ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE,
  ORDER_DETAIL_UNPAID_SHIPPED_NOTE,
} from '@/lib/account-order-copy';

/**
 * 付款軸 → 徽章三檔(spec 附錄 B-5;來源 = OD 稿 `order-detail-page.html:150-156` 的 tone)。
 *
 * 🔴 **稿另有 `已出貨`(progress)/ `已送達`(done)兩檔吃 `order.shipStage`** —— 那需要第 2 批
 * 「包裹真相」,而 `orderStatusLabel()` 現在**完全不讀出貨軸**(A9f:paid 一律固定「處理中」)
 * ⇒ **第 1 批那兩檔永遠不會出現,不要為它們寫分支。**
 */
/**
 * 金額欄的標題字面(codex 關卡2 must-fix,2026-08-23)。
 *
 * 🔴 **原本是 `paid ? '實付金額' : '應付金額'` 的二元式,而它對三個狀態說了假話**:
 *    `refunded` / `partiallyRefunded` / `partiallyPaid` 全都會印成
 *    **「應付金額 + 原始總額」** ⇒ **一個已經退款的客人,會被告知他還欠全額。**
 * ⚠️ 那個二元式是**從 OD 稿逐字搬來的**(稿 `:247` / `:271`)——
 *    **稿是視覺權威,不是金額語意的權威。**
 * 🔴🔴 ~~`unpaid` 在這一頁**到不了**(adapter 端 `.neq('payment_status','unpaid')`、`#249`);
 *    列出來是因為 `Record` 要窮盡,**不是因為它會出現**。~~
 *    **⇒ 2026-08-24 起這句話是假的** —— `#249` 拆掉了那道濾網,`unpaid` **現在天天會出現**
 *    (刷卡卡住的單、等匯款的單、以及所有已取消的單 —— 取消不動 `payment_status`)。
 *    ⇒ 而它的「應付金額」對**取消單**是錯的 ⇒ 元件內另有一道 `cancelled ? '訂單金額' : …` 蓋掉它。
 *    ⚠️ **對「真的還付得了的 unpaid 單」,「應付金額」仍然是對的** ⇒ 這一格不動。
 * 🔴 三個非 `paid` 的可達狀態一律用中性的「訂單金額」—— 它在那三種狀態下都為真。
 *    **而這個字面是我選的,不是稿上的、也不是 Sean 拍過的** ⇒ 已列給主視窗送他過目。
 */
const AMOUNT_LABEL: Record<PaymentStatus, string> = {
  paid: '實付金額',
  unpaid: '應付金額',
  partiallyPaid: '訂單金額',
  refunded: '訂單金額',
  partiallyRefunded: '訂單金額',
};

// 🔴 ~~這裡原本有一份自己的 `STATUS_TONE`~~ ⇒ **2026-08-29 刪除**(codex 對抗審查 must-fix):
//    它與 `OrdersTab` 那份【對 `partiallyPaid` 給出不同答案】⇒ 同一個客人在列表與明細
//    看到同一張單的兩種顏色。⇒ 改吃 `orderStatusTone()` 這個唯一來源。
//    📌 修法不是把兩份對齊 —— 對齊過的兩份下次還會再分岔一次。

/** 金額字面(整數 Money → `NT$ 1,234`);與 OrdersTab 的既有寫法一致。 */
function nt(amount: number): string {
  return `NT$ ${amount.toLocaleString()}`;
}

/**
 * 車款快照 → 稿上 `.od-line-fits` 那一行的字面。
 *
 * ⚠️ **「稿的 `it.fits` 就是 vehicle_snapshot」是【推的】** —— 形狀吻合而稿沒寫來源
 * (見 `MemberOrderDetailItem.vehicle` 的 docstring)。缺 → null ⇒ 那一行不印。
 */
function formatVehicle(v: OrderItemVehicleSnapshot | null): string | null {
  if (!v) return null;
  const year = v.year === undefined ? '' : ` ${v.year}`;
  return v.kind === 'dict' ? `${v.brand} ${v.model}${year}` : `${v.raw}${year}`;
}

function OrderLine({
  item,
  cancelled,
}: {
  item: MemberOrderDetailItem;
  /** ⟦ship-WHICHITEMSSHIPPED⟧ 這張【單】取消了沒(Sean 2026-09-04 Q-C 乙)。
   *  🔴 它是**訂單層**的事實, 而它決定的是**這一列**要說什麼 ⇒ 必須從上面傳下來,
   *     `MemberOrderDetailItem` 裡沒有、也不該有這一欄(那會讓同一個事實有兩份)。 */
  cancelled: boolean;
}) {
  const fits = formatVehicle(item.vehicle);
  return (
    <div className="od-line">
      <div className="od-line-img">
        {/* 🔴 取圖與 fallback 走既有 ProductImage(spec 附錄 B):它自帶
            onError → 站內佔位圖 → 漸層 的三層退化,而 **onError 記在 state、不改 src**
            (改 src 會再觸發 load ⇒ 佔位圖也載不到時變成無限迴圈)。不另發明一條取圖路徑。
            ⚠️ imageUrl 為 null 的兩個成因(商品無圖 / **商品已下架 join 不到**)在這裡
               長得一樣,而兩者都該退到佔位圖 ⇒ 不分流。 */}
        {/* 🔴 2026-09-03 **行為改變, 明寫**:`ProductImage` 現在用 `hasNoRealImage(image)` 判「有沒有真照片」
            ⇒ 本頁那些 `imageUrl` 是「查無圖片」卡的品項, 從【顯示那張卡】改成【顯示站內佔位圖】。
            🔵 兩者都是「沒有照片」的畫面, 而站內佔位圖是我們自己的、講得出「暫無照片」。
            🛑 **而本頁【不傳 brandSlug】⇒ 永遠不會顯示品牌 logo**(卡片那條路會)。
               理由:訂單品項只有 `item.brand`(顯示名), 而由顯示名衍生 slug 對 7 家會對不上
               (`BONAMICI RACING`→`bonamici-racing` 而 key 是 `bonamici`)⇒ 猜一個會 404 的路徑不如不猜。
               ✅ 要讓訂單頁也顯示 logo ⇒ 得先讓訂單品項帶 `brand_slug` 下來, 那是另一片。 */}
        <ProductImage image={item.imageUrl} label={item.title ?? item.variantSku} />
      </div>
      <div>
        {/* 🔴 品牌 null ⇒ **整行不印**(不印「—」)——判準來自 AdminOrderDetailItem.brand 的
            docstring:「缺值本身算不算一個需要被看見的事實」。品牌缺值不是異常。 */}
        {item.brand !== null && <div className="od-line-brand">{item.brand}</div>}
        <div className="od-line-name">{item.title ?? item.variantSku}</div>
        {fits !== null && <div className="od-line-fits">{fits}</div>}
        {/* ⟦ship-WHICHITEMSSHIPPED⟧ 這一件出貨了沒(Sean 2026-09-04 Q5 拍甲:已出貨的那幾列加灰字「已出貨」)。
            🎯 **在此之前, 一張出了 3 件的 5 件單, 五列逐字相同**(真瀏覽器實測)——
               客人被告知「出了一部分」, 而畫面上沒有任何東西說得出【是哪一部分】。
            🔴 **沒出貨的那幾列什麼都不印, 而那是刻意的** —— 他那句話裡沒有「準備中」,
               補一個他沒說的字與改掉他說的字是同一種錯(完整理由在常數的 docstring)。
            🛑 **不印日期也不印數量** —— 數量摘要不給顧客站是既有政策(板 ⟦b9-SHIPUI⟧ ①),
               而那條政策今天沒有任何測試擋著、只有人的拍板擋著 ⇒ 更不能順手加。 */}
        {item.shipped && (
          <div className="od-line-ship" data-od-id="order-line-shipped">
            {ORDER_DETAIL_ITEM_SHIPPED_MARK}
          </div>
        )}
        {/* ⟦ship-WHICHITEMSSHIPPED⟧ **這一件不會來了**(Sean 2026-09-04 拍 Q-C 乙:灰字「已取消」)。
            🔴 **判準是「單取消了 **而且** 這一件沒出」** —— 出過的那幾件仍印「已出貨」,
               因為**它確實出了**;對一件已送到客人手上的東西印「已取消」是**一句假話**, 比空白糟。
            🎯 **它補的縫**:一張 5 件出 3 件之後被取消的單, 原本是 3 列「已出貨」+ 2 列**空白**,
               而那 2 件永遠不會來 —— 而「其餘商品出貨時會再通知您」對取消單是**刻意不印的**
               ⇒ 🛑 **在此之前那兩列沒有任何一句話講它。**
            🔵 兩個標記**互斥**(`shipped` / `cancelled && !shipped`)⇒ 同一列不會同時出現兩句話。 */}
        {cancelled && !item.shipped && (
          <div className="od-line-cancel" data-od-id="order-line-cancelled">
            {ORDER_DETAIL_ITEM_CANCELLED_MARK}
          </div>
        )}
      </div>
      <div className="od-line-r">
        <div className="od-line-unit">
          {nt(item.unitPrice.amount)} × {item.quantity}
        </div>
        <div className="od-line-sum">{nt(item.lineTotal.amount)}</div>
      </div>
    </div>
  );
}

export type OrderDetailViewProps = {
  order: MemberOrderDetail;
};

export function OrderDetailView({ order }: OrderDetailViewProps) {
  /**
   * ⟦ship-REFUNDEDPAIDSTEP⟧ **「付款完成」那一階問的是【他付過沒】, 不是【現在的狀態】。**
   *
   * ⛔ ~~`const paid = order.paymentStatus === 'paid'`~~ ⇒ 🔴 **`refunded` 的單它是 `false`**,
   *    即使 `paidAt` 有值、客人**真的付過** ⇒ 那一階在畫面上是灰的。
   * 🎯 **Sean 2026-09-04 拍甲**(他複誦了理由, 不只回了字母):逐字
   *    「**他確實付過, 那是發生過的事實**」;而端他的理由是 ——
   *    那條軸講的是**發生過什麼**, 不是現在的狀態(「訂單成立」也不會因為取消了就變灰);
   *    而維持灰的代價是:**客人剛收到退款, 而畫面說我們沒收到錢 ⇒ 兩個訊息打架。**
   * 🛑 **丙(打勾 + 多一格「已退款」)他沒選** ⇒ 不做:那是多一個狀態、多一份文案、多一個形狀。
   *
   * 🔵 **而 `partiallyRefunded` 是我加的, 不是他拍的** —— 理由要寫出來讓它可被推翻:
   *    它的定義是「**退了一部分**、訂單仍有保留品項」(`types.ts:34-35`)⇒ **它蘊含之前已全額付款**
   *    ⇒ 對它維持灰, 與 `refunded` 是**同一句錯話**。
   *    🛑 而 `partiallyPaid`(只收了訂金)**不在裡面** —— 那個人**還欠錢**, 打勾會是謊。
   */
  const paymentCompleted =
    order.paymentStatus === 'paid' ||
    order.paymentStatus === 'refunded' ||
    order.paymentStatus === 'partiallyRefunded';
  // 🔴🔴 **`#249`(2026-08-24):這一頁對【已取消 / 已逾期】的單從今天起才走得到。**
  //    在此之前 adapter 的 `.neq('payment_status','unpaid')` 把它們全濾掉了
  //    ⇒ **下面三格是「一段從來沒有人走過的路」被點亮之後才暴露出來的**,不是新做的功能:
  //    ① `tone`:`STATUS_TONE.unpaid = 'action'` = **催客人去付款**的那一檔顏色 ⇒ 取消單一律改 `done`
  //    ② `amountLabel`:`AMOUNT_LABEL.unpaid = '應付金額'` ⇒ **會告訴一個取消單的客人他還欠錢** ⇒ 改中性
  //    ③ 取消原因那一格:自動失效寫進去的是**英文機器碼** `payment_expired` ⇒ 不得原樣印(見下)
  //    📌 形狀:**拆掉一道濾網,等於把它背後所有沒被走過的路一次點亮 —— 而那些路沒有人驗過。**
  const cancelKind = order.cancelKind;
  const cancelled = cancelKind !== 'none';
  const tone = orderStatusTone(order.paymentStatus, order.fulfillmentStatus, cancelKind);
  /**
   * ⟦ship-AXISHOLE⟧ **進度軸中間那個洞**(Sean 2026-09-04 Q7 拍**乙**)。
   *
   * 🔴 **洞的形狀**:`shippedAt` 非空而付款未完成(匯款單先出貨後收款)
   *    ⇒ 第 3 階「已出貨」亮、第 2 階「付款完成」灰 ⇒ **軸中間斷一格而沒有任何解釋**。
   * ✔ 這不是理論世界:上面那段 `⟦b9-SHIPUI⟧` 的註解 2026-09-02 就寫下了它, 
   *    而那時逐字寫的是「**在他拍之前這裡不做特殊處理**」⇒ 🎯 **他今天拍了。**
   *
   * 🔵 **「那格變灰色」不需要程式碼** —— `ok: paymentCompleted` 為 false ⇒ 沒有 `is-done`
   *    ⇒ **它本來就是灰的**。⇒ 📌 這一改動補的是【那句話】, 不是顏色。
   *    🛑 **所以驗收不得用「那格是灰的」** —— 它在改之前也是灰的(零判別力)。
   *
   * 🔴🔴 **`!cancelled` 那一半是承重的, 不是順手加的**:
   *    下面 `happened()` 的判準是 `s.ok || s.d !== ''`, 而 `shownSteps` 對取消單
   *    把留下來的每一階 **一律 `ok: true`**。
   *    ⇒ 🛑 若這句話寫進取消單的 `d`, 那一階會從【不顯示】變成【顯示且打勾】
   *      ⇒ 🎯 **一張從來沒付過錢的單子, 「付款完成」會被打勾** —— 而那句話旁邊
   *      還寫著「尚未收到匯款」⇒ **同一格裡兩句相反的話**。
   *    📌 ⇒ 一個只負責【多印一句話】的修法, 透過一個它沒有讀的判準改掉了【打不打勾】。
   */
  const unpaidButShipped = !cancelled && order.shippedAt !== null && !paymentCompleted;
  // 稿的四階進度軸。前兩階有來源;後兩階在第 1 批一律未完成(見檔頭)。
  const steps = [
    { t: '訂單成立', d: formatOrderDate(order.createdAt), ok: true },
    // 🔴 日期只能用 `paidAt`(codex 關卡2 must-fix):延後付款或重試成功時,下單日與付款日
    //    可以差好幾天 ⇒ 拿 `createdAt` 冒充等於**印一個我們自己編的付款日**,而客人沒有第二個來源可以對。
    //    `paidAt` 為 null ⇒ **那一階不印日期**(狀態仍可標完成),不要退回 createdAt。
    // ⟦ship-AXISHOLE⟧ 洞的世界印他拍的那句話(文案逐字理由在常數的 docstring)。
    // 🔴 `paidAt` 非空時 **日期優先** —— 那是一個事實, 而這句話只是在解釋一個缺口;
    //    而 `unpaidButShipped` 本身已含 `!paymentCompleted`, 兩者不會同時為真的世界很窄
    //    (付款狀態未完成而 `paidAt` 有值, 例如 partiallyPaid 的訂金單)⇒ **排序寫死、不靠互斥**。
    {
      t: '付款完成',
      d:
        order.paidAt !== null
          ? formatOrderDate(order.paidAt)
          : unpaidButShipped
            ? ORDER_DETAIL_UNPAID_SHIPPED_NOTE
            : '',
      ok: paymentCompleted,
    },
    /**
     * ⟦b9-SHIPUI⟧ **這一階從包裹真相點亮**(Sean 2026-09-02 拍丙)。
     *
     * ⛔ ~~原本寫死 `{ d: '', ok: false }`~~ —— 那在**沒有包裹資料**的時候是誠實的
     *    (稿 `:170-172` 逐字「第 3、4 階在第 1 批一律是未完成的空心點, 這是**誠實的**」),
     *    而權限與讀取那半 2026-09-02 落地之後, **那個誠實變成了過期**。
     * 🔴 **來源是 `shippedAt`(包裹), 不是 `fulfillmentStatus`** —— 後者是 stale 出貨軸,
     *    稿同一段逐字「拿它點亮『已出貨』等於**對客人說謊**」。
     *
     * ⚠️ **一個沒有人裁過的組合(code-reviewer 2026-09-02 nit,`-fc` 收下而不自己決定)**:
     *    `shippedAt` 非空**而** `paidAt` 為空(匯款單先出貨後收款)⇒ 第 3 階亮而第 2 階不亮
     *    ⇒ **進度軸中間會出現一個洞**,而 `nowIdx`(下面那行 `steps.reduce` 取**最後一個** ok)
     *       仍指到第 3 階。
     *    ⇒ 🛑 **那是視覺/文案的板, 不是實作的板** —— 已交主視窗端 Sean;
     *       **在他拍之前這裡不做特殊處理**(自己補一條規則等於替他決定)。
     */
    { t: '已出貨', d: order.shippedAt === null ? '' : formatOrderDate(order.shippedAt), ok: order.shippedAt !== null },
    /**
     * 🔵 **「已送達」維持空心點, 而那是【誠實】不是漏做。**
     * `delivered_at` 在全 repo 的 migration 裡是 **0 個檔**
     * (🟢 正對照 `grep -rl shipped_at supabase/migrations | wc -l` ⇒ **19**;
     *  ⛔ ~~18~~ 是原作者寫的、2026-09-02 codex 複量為 19 ⇒ **正對照的數字自己也會過期**,
     *  而它過期的方向是「看起來仍然合理」)
     * ⇒ **我們沒有那個資料來源。** 編一個「已送達」出來, 就是稿警告的同一件事。
     * ⇒ 哪天有了那一欄, 這一行改成與上一行同形即可。
     */
    { t: '已送達', d: '', ok: false },
  ];
  // ⟦ship-CANCELSTEPS⟧ 取消單**沒有「現在這一步」** —— 它沒有下一步了。
  const nowIdx = cancelled ? -1 : steps.reduce((n, s, i) => (s.ok ? i : n), 0);
  /**
   * ⟦ship-CANCELSTEPS⟧ 取消單**只留真的發生過的那幾階**。
   *
   * ⛔ ~~第一版寫的是「取消單整條軸不畫」, 而註解逐字寫著「不畫不會少掉任何事實」~~
   *    🔴 **code-reviewer 2026-09-04 把那句打掉了, 而它是對的**:`paidAt` 與 `shippedAt`
   *    **只住在這條軸上**(:156 / :173), 頁面沒有第二個顯示位置。
   *    ⇒ 而那不是理論 —— `admin_mark_order_cancelled`(`20260902140000:316-330`)的三道閘是
   *      `cancelled_at IS NULL` / `payment_method='tappay'` / `payment_status='refunded'`,
   *      🔴 **零出貨相關的閘** ⇒ **一張部分出貨、全額退款之後被標記取消的單, 構造得出來。**
   *    ⇒ ⇒ 🎯 **對那張單「整條不畫」會默默丟掉「何時付款 / 何時出貨」兩個【真事實】。**
   * 📌 ⇒ 我第一版把「不該說未來式」修成了「什麼都不說」, 而那是**另一個方向的錯**。
   */
  //
  // 🔴🔴 **而「發生過」的判準【不是 `s.ok`】—— 那一格是實跑逼出來的, 不是想出來的**:
  //    `ok: paid` 而 `paid = paymentStatus === 'paid'`(:139)⇒ 🔴 **`refunded` 的單 `paid` 是 false**,
  //    即使 `paidAt` 有值、客人**真的付過**。⇒ 只用 `s.ok` 過濾會**把付款日整格丟掉**,
  //    而那正是 code-reviewer 打掉第一版的同一個理由(丟掉真事實), 換一個位置再犯一次。
  //    ✅ ⇒ 判準改成「**有 `ok` 或有日期**」= 這件事**留下了痕跡**。
  // ✅ **而那個相鄰缺陷已經修掉了**(⟦ship-REFUNDEDPAIDSTEP⟧, Sean 2026-09-04 拍甲):
  //    `ok:` 現在吃 `paymentCompleted`(:139)⇒ `refunded` / `partiallyRefunded` 也算付過。
  //    🔵 ⇒ 所以下面這個 `happened` 判準與它**是同一條規則的兩個射程**, 不是兩套邏輯:
  //       「這件事**發生過**嗎」—— 一個管取消單要不要**顯示**那一階, 一個管那一階要不要**打勾**。
  const happened = (s: (typeof steps)[number]) => s.ok || s.d !== '';
  // 取消單上, 留下來的每一階都是**已經發生的事實** ⇒ 一律 done(它們不會再有進展)。
  const shownSteps = cancelled ? steps.filter(happened).map((s) => ({ ...s, ok: true })) : steps;
  // 🔴 取消單一律走中性字面(見上面 ②)。`'訂單金額'` 是這張表裡既有的中性值,不是新造的字。
  const amountLabel = cancelled ? '訂單金額' : AMOUNT_LABEL[order.paymentStatus];
  // 收件三欄缺值印 `—`:**這裡缺值是異常、要看得出來**(與品牌那格刻意相反)。
  const dash = (v: string | null) => (v === null || v === '' ? '—' : v);

  return (
    <>
      <Link className="od-back" href="/account?tab=orders" data-od-id="order-back">
        <span>訂單記錄</span>
      </Link>

      <div className="od-head" data-od-id="order-head">
        <div>
          <span className={`od-status is-${tone}`}>
            {orderStatusLabel(order.paymentStatus, order.fulfillmentStatus, order.cancelKind)}
          </span>
          <h1>{order.displayId}</h1>
          <div className="od-head-meta">
            {formatOrderDate(order.createdAt)} 成立
            {/* 🔴 itemsTruncated ⇒ 件數不可信。**不印 0、不留空**(逐字沿用 OrderListItem
                :196 的紀律):印「?」= 我們也不確定,而下一步寫在下面看得見的說明裡。 */}
            {order.itemsTruncated ? ' · 共 ? 件商品' : ` · 共 ${order.itemCount} 件商品`}
          </div>
        </div>
        {/* 片 C:稿 `:196-197` 的 `.od-head-actions` > `.acc-btn-ghost`。
            **class 與位置都照稿**,CSS 早就在(`order-detail.css:96`)、不新寫。
            🔴 用 `<Link>` 不是 `<button>`:稿用 button 是因為原型不產檔、要就地換字;
               而我們**真的有一頁可以去** ⇒ 它是一個導覽,不是一個動作。
               (用 button + onClick 導頁會失去中鍵開新分頁、右鍵複製網址與鍵盤可及性。)
            🔴 `encodeURIComponent` 沿用 `components/account/tabs/OrdersTab.tsx:189` 的既有慣例 ——
               而**下游那一頁刻意【不再解一次碼】**(Next 的動態路由段進來就已解碼,
               再解一次遇到 `%` 會拋 `URIError` 而整頁 500)。兩端要對得起來。 */}
        <div className="od-head-actions">
          {/* 🔴 **開新分頁 —— Sean 2026-08-30 在正式站看過之後直接下的。**
              他的原話逐字:「**有但是直接取代整個頁面, 我要可以跳新分頁或者直接下載PDF,
              可以直接下載PDF最好**」。
              ⇒ 「直接下載 PDF」那一半是 `-30` 的 `:412`(伺服器產檔), 不在這一片;
                 而**「跳新分頁」他明確接受, 且今天就做得到** ⇒ 先做這半。
              🔴 `rel="noopener noreferrer"` **不是可選的**:`target="_blank"` 會把
                 `window.opener` 交給新分頁 —— 那一頁是我們自己的沒錯, 而**這條紀律不看目的地**
                 (下一個人改 href 時不會回來補它)。
              ⚠️ **可及性缺口, 照實寫**:鈕上的字沒有講「會開新分頁」——
                 而**那個字面是 Sean 的板**(稿 `:193` 帶著「(2026-08-07 Sean 拍板)」)
                 ⇒ 我不自己加。已與鈕文案那題一起列在板 `:416` 等他。 */}
          {/* 🔴🔴 **2026-09-06:去向從網頁版 `/statement` 改成 `/statement.pdf`(主視窗裁【甲】)。**
              ⛔ ~~`/account/orders/<id>/statement`(網頁版)~~
              📌 **依據是鐵則 1 —— design 是真權威**:稿 `order-detail-page.html:288` 逐字
                 「真站:改成 `<a href="/account/orders/<id>/statement.pdf" download>` 由後端產」
                 ⇒ **稿只畫一顆鈕、而它指的就是 `.pdf`**;網頁版是**後端還不存在時的過渡**。
              🟢 **而「那條路真的產得出檔」是量到的**:Sean 2026-09-06 03:0x 在**正式站**對一張真單
                 手動下載, 主視窗**親讀 PDF 內中文全字** ⇒ 不是「route 檔存在」這種弱證據。
              🔵 **`/statement` 那個路由留著不刪** —— 有人書籤了也不會壞, 只是這一頁不再連它。
              🛑 **文案一個字沒動** —— 「下載訂單 PDF」是 Sean 的板
                 (⛔ ~~見下方 `:361`~~ ⇒ 🔴 **reviewer 2026-09-06 訂正:那個指標指錯了**,
                  `:361` 在**上面**而且講的是 encode 紀律;真正的依據在**本檔頭 `:30-34`**
                  —— 稿 `:193` 那句帶著「2026-08-07 Sean 拍板」),
                 本次只改**去向**;而稿上那顆鈕的名字**本來就是這一句**。
              🔴 **`<a>` 不是 `<Link>`**:目的地是一個**檔案端點(route handler)**不是頁面 ——
                 `Link` 的 client-side 導覽對它沒有意義, 而 `download` 要瀏覽器原生處理。
                 ⚠️ 而既有測試釘著「它是 `<a>` 不是 `<button>`」⇒ 這一改**不會**讓那格紅。
              🔵 `target="_blank"` + `rel` 兩者都保留(Sean 2026-08-30 直接下的, 見既有測試)。
              ⚠️ **一格 reviewer 2026-09-06 提的、我沒想到的**:server 那端**已經**用
                 `content-disposition: attachment` 強制下載(`statement.pdf/route.ts:141`)
                 ⇒ 📌 **`download` 這個屬性其實是冗餘的**(稿字面有它, 所以留著);
                 而 `download` + `target="_blank"` **同時存在時 Safari 曾有留下空白分頁的怪癖**。
                 🛑 **兩者我都不自己拿掉** —— `target` 是 Sean 直接下的、`download` 是稿字面;
                    **跨瀏覽器實測沒做** ⇒ 這一格是【已揭示的未驗】, 不是【驗過沒事】。 */}
          <a
            className="acc-btn-ghost"
            href={`/account/orders/${encodeURIComponent(order.displayId)}/statement.pdf`}
            download
            target="_blank"
            rel="noopener noreferrer"
            data-od-id="order-statement-link"
          >
            下載訂單 PDF
          </a>
        </div>
      </div>

      {/**
        * ⟦ship-CANCELSTEPS⟧ 🔴🔴 **取消單【不畫進度軸】**(2026-09-04)。
        *
        * 🔬 **病灶是量到的, 不是讀碼推的** —— 拿既有的 `CANCELLED` fixture 渲染,
        *    把 `[data-od-id="order-steps"]` 每個子節點的 class 與文字印出來, 實際是:
        *      `od-step is-done is-now │ 訂單成立 2099-04-15`
        *      `od-step               │ 付款完成`   ← 沒有 is-done
        *      `od-step               │ 已出貨`     ← 沒有 is-done
        *      `od-step               │ 已送達`     ← 沒有 is-done
        *    ⇒ 🎯 **一張已經取消的單, 軸上有三格「還沒完成」的待辦, 而 `is-now` 落在第一格**
        *      ⇒ 讀起來是「才剛開始, 下一步等付款」。
        *    ⇒ 🔴 **而同一頁上方的徽章寫著「已取消」·`is-done`** ⇒ **一頁兩句相反的話。**
        *    📌 而客人會信哪一個:**進度軸是圖形, 徽章是文字 —— 圖形贏。**
        *
        * 🔵 **它與 `#249` 是同一族, 而那正是這一格的內容**:`#249`(Sean 2026-08-24 拍甲)
        *    逐字「一張已作廢的單在列表上與還付得了的單**逐欄相同**」。那次修好的是
        *    **標題字**(`orderStatusLabel`)與**顏色**(`orderStatusTone`)—— 兩半都做了,
        *    🛑 **而它正下方這條軸沒有被那次修法涵蓋。**
        *    ⇒ 📌 **修一個被點名的實例不等於修那個類別** —— 而漏掉的那個**就在同一個畫面上**。
        *
        * ✅ **為什麼是【不畫】而不是【畫一條取消態的軸】—— 那是兩件急迫性差一個量級的事**:
        *    · 「這條軸不該顯示成進行中」= **事實正確性**, 不需要任何設計決定 ⇒ 現在就做
        *    · 「取消單**應該**顯示什麼」= 設計題 ⇒ 已端主視窗轉 Sean, **不在這一片**
        *    ⇒ 🎯 **先拿掉錯的, 再問對的長什麼樣。**
        * 🛑 而稿**答不出**這一格:`design-reference` grep(分母 176 檔, 本樹 submodule
        *    原本未初始化 ⇒ init 之後才算數)只撈到 `HANDOFF.md:149` 的狀態字,
        *    **不是進度軸的取消態** ⇒ 🔴 **那是【查無】, 不是【稿說要照印】。**
        *
        * ⛔ ~~「不畫【不會少掉任何事實】—— 軸上唯一為真的那格是『訂單成立 + 日期』,
        *    而 `.od-head-meta` 已經印過」~~ ⇒ 🔴 **那句話是假的**(code-reviewer 2026-09-04):
        *    `paidAt` / `shippedAt` **只住在這條軸上**, 頁面沒有第二個顯示位置。
        *    ⇒ 所以修法從「整條不畫」改成「**只留真的發生過的那幾階、而且沒有 `is-now`**」。
        *    📌 **⇒ 我第一版把「不該說未來式」修成了「什麼都不說」—— 另一個方向的錯。**
        */}
      <div className="od-steps" data-od-id="order-steps">
        {shownSteps.map((s, i) => (
          <div
            key={s.t}
            className={`od-step${s.ok ? ' is-done' : ''}${i === nowIdx ? ' is-now' : ''}`}
          >
            <div className="od-step-t">{s.t}</div>
            <div className="od-step-d">{s.d}</div>
          </div>
        ))}
      </div>
      {/**
        * ⟦b9-SHIPUI⟧ 分批出貨的那句小字(Sean 2026-09-02 拍**丙**:
        * 亮「已出貨 MM-DD」+ 小字「其餘商品出貨時會再通知您」)。
        * ⛔ **而那個 `MM-DD` 字面已被他自己推翻** —— Sean 2026-09-02 Q31 拍甲「跟鄰居一致
        *    (`2026-09-02`)」,落點 `~/pcm-mailbox/拍板-20260902-上午.md:244`;Q31 晚於本題
        *    且專門在答日期格式 ⇒ **用 `formatOrderDate` 的 `YYYY-MM-DD`**(理由見同名 test 檔)。
        *
        * 🔴 **只在【還沒全部出完】時出現** —— 全部出完時那句話對客人是**假的**。
        * 🛑 而 `allItemsShipped` 在 `itemsTruncated` 時一律 `false`(mapper 的保守方向)
        *    ⇒ 品項被截斷時**會印**這一句。⛔ ~~那個方向的錯是多印一句**無害**的話~~
        *       ⇒ **兩個方向都會傷人, 我們選的是比較輕的那一邊**(理由見 domain docstring);
        *    反過來(宣稱全部出完)會讓客人以為東西都到齊了。
        */}
      {/**
        * 🔴🔴 **這一段在 `.od-steps` 之【外】,而它 2026-09-02 是被移出來的。**
        *
        * ⛔ ~~原本這個 `<p>` 寫在 `.od-steps` 裡面(四階的後面)~~ ——
        *    而 `.od-steps` 是 `display: flex` ⇒ **它變成第 5 個 flex item**,
        *    被【排】在「已送達」右邊,不是【放】在進度軸下面。
        * 🔬 真瀏覽器實測(`-fc` 2026-09-02 · localhost:3020 · 拋棄式庫):
        *    · 桌面 1200px:小字 `x=969` = 已送達那格的 `right=969` ⇒ 它就在第 5 格,寬 191px
        *    · 手機 375px:四階被擠成每格 **38px**(桌面 232px)
        *      ⇒ 標題折成「訂單成 / 立」、日期折成「2026- / 09-02」
        *      成因:小字吃掉 375 裡的 **191** —— **超過一半**
        * 🛑 **而 `scrollWidth === 375` ⇒ 不橫向溢出** ⇒ 任何「有沒有溢出」的尺都看不到它。
        * 📌 **而 jsdom 那幾格測試【全部通過】** —— 它們問的是「那句字在不在」,而它在。
        *    ⇒ 這一格只有真瀏覽器量得到(Sean 2026-08-17:「不用再用 artifacts,直接開伺服器做+看」)。
        */}
      {/* 🔴 ⟦ship-CANCELSTEPS⟧ **取消單不印這一句** —— 它與進度軸是同一個病:
          「其餘商品出貨時會再通知您」對一張死掉的單是**假的**。
          🔬 而它構造得出來(code-reviewer 2026-09-04 證的, 不是我猜的):
          `admin_mark_order_cancelled` 零出貨閘 ⇒ 部分出貨 + 全額退款 ⇒ 可標記取消
          ⇒ `shippedAt` 非空 · `allItemsShipped` 為 false · `cancelKind` = cancelled。
          📌 而我第一版**只修了進度軸、指名了這一格卻沒動它** —— 那正是本片自己在講的病。 */}
      {!cancelled && order.shippedAt !== null && !order.allItemsShipped && (
        <p className="acc-order-note" data-od-id="order-partial-shipment-note">
          {ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE}
        </p>
      )}

      <div className="acc-section" data-od-id="order-items">
        <div className="acc-section-head">
          <h2>商品明細</h2>
        </div>
        {order.itemsTruncated && (
          <p className="acc-order-note">{ORDER_DETAIL_ITEMS_TRUNCATED_NOTE}</p>
        )}
        {order.items.map((item) => (
          <OrderLine key={item.id} item={item} cancelled={cancelled} />
        ))}

        <div className="od-sums" data-od-id="order-sums">
          {/* 🔴 有稅時小計是【未稅】的 ⇒ 標籤要說得出來(`⟦b4-TAXSURFACES⟧`, Sean 2026-09-04 拍甲)。
              ⚠️ 這一頁的基底字面是「**商品**小計」不是「小計」—— **刻意不統一**:
                 把它改成「小計」是**改文案**, 而那是 Sean 的事、不是本片的。 */}
          <div className="od-sum">
            <span>{subtotalLabelOf('商品小計', order.taxTotal.amount)}</span>
            <b>{nt(order.subtotal.amount)}</b>
          </div>
          <div className="od-sum">
            <span>運費</span>
            <b>{order.shippingFee.amount === 0 ? '免運' : nt(order.shippingFee.amount)}</b>
          </div>
          {order.discountTotal.amount > 0 && (
            <div className="od-sum od-sum-off">
              <span>折扣</span>
              <b>− {nt(order.discountTotal.amount)}</b>
            </div>
          )}
          {/* 🔴 稅額:**有稅才印**(`⟦b4-TAXSURFACES⟧` 第 7 步)。位置與其餘四面逐字對齊:
              小計 → 運費 → 折扣 → **稅額** → 訂單金額。🔵 稅 0 不印, 理由同上面那一列折扣。 */}
          {order.taxTotal.amount > 0 && (
            <div className="od-sum">
              <span>稅額</span>
              <b>{nt(order.taxTotal.amount)}</b>
            </div>
          )}
          {/* 稿註解逐字:**未付款的訂單不能寫「實付」——那是還沒發生的事。** */}
          <div className="od-sum od-sum-total">
            <span>{amountLabel}</span>
            <b>{nt(order.total.amount)}</b>
          </div>
        </div>
      </div>

      <div className="acc-section" data-od-id="order-info">
        <div className="acc-section-head">
          <h2>收件與付款</h2>
        </div>
        <div className="od-info">
          <div>
            <h3>Shipping</h3>
            <dl>
              <dt>收件人</dt>
              <dd>{dash(order.shippingAddress.name)}</dd>
              <dt>手機</dt>
              <dd>{dash(order.shippingAddress.phone)}</dd>
              <dt>地址</dt>
              <dd>{dash(order.shippingAddress.line)}</dd>
            </dl>
          </div>
          <div>
            <h3>Payment</h3>
            <dl>
              <dt>付款方式</dt>
              {/* paymentMethod 為 null = 尚無成功請款(不是「資料缺失」)⇒ 仍印 `—`,
                  與收件那三格同理:這一格空著是**看得出來比較好**的那種空。
                  🔴 有值時走 `paymentMethodLabel()` 翻成客人看得懂的字 ——
                     在那之前這一格直接印 DB 的原始值,客人看到的是 `tappay`
                     (2026-08-30 本機真瀏覽器實見,不是讀碼推的)。
                     ⚠️ `dash()` 仍在外層:翻譯只處理「有值」那半,空值的語意不變。 */}
              <dd>{dash(order.paymentMethod === null ? null : paymentMethodLabel(order.paymentMethod))}</dd>
              <dt>{amountLabel}</dt>
              <dd>{nt(order.total.amount)}</dd>
            </dl>
          </div>
        </div>
      </div>

      {/* 🔴🔴 **鐵則 1:這一塊的【版面】是自創的, 而稿上查無 —— 附掃過的分母**
          (code-reviewer 2026-09-04 must-fix ⑤;以下每個數字都是我自己重量的, 不是抄它的)
          ```
          design-reference/           命中 3 支 / 分母 **177** 支 —— 而三支全是「ATM 轉帳」那四個字
                                      (CheckoutPage.jsx:432 / :538 · WalletTab.jsx:199 ·
                                       design-handoff/HANDOFF-v2.0.md:268)
                                      ⇒ 🛑 **那是【結帳頁的付款方式選項】, 不是訂單詳情頁的收款資訊區塊。**
          OD 磁碟 12 個專案            grep 匯款 ⇒ 命中 **2 個**(pcm-524f · pcm-admin-order-ui)
                                      —— 而**兩個都是後台**(order-detail-states / overview-desktop-bmw-m)
          顧客站訂單詳情的真權威       `pcm-home-redesign/order-detail-page.html` ⇒ 匯款/轉帳/銀行 **0 命中**
          ```
          🔵 **⇒ 而 reviewer 說「OD 只命中 1 個專案」, 我量到 2 個** —— 我開檔看了第 2 個,
             它是 `pcm-524f/order-detail-states.html`(**後台**訂單狀態頁)⇒ **不影響它的結論。**
          ⚠️ **而我第一發量 `pcm-home-redesign` 得到「14 支命中」** ——
             開檔看才發現那 14 支是 `checkout-page.html` / 資料檔 / `.file-versions/` 舊版 / playwright 快照,
             ⇒ 🔴 **訂單詳情那一支自己是 0。**
             📌 **一個「專案層」的命中數, 答不出「那一頁有沒有」** —— 而它讀起來像答得出。

          🎯 **⇒ 所以這一塊是【自創版面】, 不是照稿搬** —— 而它需要有人知道:
             ⇒ Sean 2026-09-04 Q-B 拍**乙**「授權自畫, 照信用卡那格, 事後補稿」(那題講的是結帳頁,
                而**訂單詳情這一塊他沒被問過**)⇒ 已落板 ⟦design-ATMBACKFILL⟧ 與本片的板列。
             🛑 **不要把它讀成「稿說要這樣做」。**

          🔴🔴 **匯款資訊(M-4b 段 3)—— 它是這條線上唯一【不可回收】的東西。**
          客人照著這一塊把錢匯出去, 而**印錯一碼 = 錢進了別人的帳戶**。
          ⇒ 📌 所以那五個值**一個字都不重打**:全部 import 自
             `packages/domain/src/order/remittance-info.ts`(段 2 落的檔, 記著 Sean 的原話)。
          ⇒ 🔬 而那 12 碼帳號我**對過**(不是眼睛看):`等Sean拍的題-20260903.md:2391` 逐字
             「帳號: 200540278354」· `:2491`「甲 它是對的 ⇒ 帳號確認」;
             ⚪ 負對照:改一碼 ⇒ 在信箱裡找不到 ⇒ **那把尺分得出真假**。

          🔴 **顯示條件是【兩個 AND】, 而少任何一個都會印錯人**:
          ```
          paymentChannel === 'bank_transfer'  ← 只有它答得出「這是匯款單」
                                                (paymentMethod 付款成功才有值 ⇒ 未匯款時是 null)
          paymentStatus  === 'unpaid'(精確)  ← 🛑 不可以用「不等於 paid」
          ```
          🛑 **為什麼是精確 `unpaid`**:`payment_status` 有五個值
             (unpaid / paid / partiallyPaid / refunded / partiallyRefunded)——
             而 `partiallyPaid` 的單**已經收到一部分錢** ⇒ 印 `order.total` 會叫客人**再匯一次全額**。
             ⇒ 📌 **一個否定式條件的射程是【剩下全部】, 而剩下全部會隨 enum 增值而變大。**
             ⇒ ⇒ 而在「印一個可能錯的數」與「不印」之間, 對不可回收的東西**永遠選不印**。

          🔴🔴 **`!cancelled` 那一格是 code-reviewer 2026-09-04 must-fix ①, 而我第一版漏了它**:
             🔬 兩條取消路徑**都保留** `payment_status='unpaid'` + `payment_channel='bank_transfer'`
                (`20260903080000_..._by_payment_channel.sql:185-186`, 該檔 `:244` 逐字「不動 payment_status」;
                 `20260904050000_..._supersede_bank_order_on_card.sql:203-212` 同款)
             ⇒ 🛑 少了它 ⇒ 同一頁同時印「訂單已取消」與「請於 5 天內完成匯款」
             ⇒ ⇒ 🔴 而 `superseded_by_card` 那條的客人**剛剛才刷卡付過一次** —— 我們會叫他再匯一次。
             📌 **一個「還沒付款」的旗標, 在單子死掉之後仍然是 true。**

          🔴🔴 **而【`unpaid` 不等於「還沒匯款」】—— 這一格本片修不掉, 明寫**
             (code-reviewer must-fix ②):
             🔬 板列 ⟦b4-NONCARDPAID1⟧(`docs/launch-todo.md`, 態 `doing`)逐字:
                **「登記匯款/現金收款【不會】把 `payment_status` 翻成 paid」**
             ⇒ 🛑 **一個【已經匯過款】的客人打開這一頁, 仍然看到帳號 + 全額 + 逾期警告** ⇒ 重複匯款。
             ⇒ 📌 **而下面那段「五個值逐一推過」讀起來像窮舉, 它不是** ——
                那個世界是 `unpaid` 的**子集**, 不在那個列舉裡。
             ⇒ ⇒ 🔵 修法在 ⟦b4-NONCARDPAID1⟧ 那一列(讓登記收款翻狀態), **不在本片**;
                而在那之前, 這一塊對「已匯款但沒登記」的客人是錯的。

          🔵 **金額用 `order.total`** —— `types.ts:159` 逐字「訂單總額 = subtotal + shippingFee − discountTotal」
             ⇒ 那就是客人要付的數(而 partiallyPaid 已被上面那個條件擋在外面)。
             ⚠️ **而排掉 partiallyPaid 的代價**:那個客人**看不到尾款要匯去哪**(reviewer nit ⑦)——
                已落板, 不在本片修。

          ⚠️ **兩處字面是我加的, 不是 Sean 的原話**(主視窗 2026-09-04 過, 未端他):
             · 備註那行帶上**單號本身** —— 他的原話只有「匯款備註請填寫訂單編號」
               ⇒ 加它的理由:他要客人填的那個東西就在旁邊, 客人不必回上一頁找
             · 「金額」那一列 —— 他沒提過;而匯款要打金額, 少了它客人得回去翻
          🔵 而「{PCM_REMITTANCE_EXPIRE_DAYS} 天後自動取消」**不是文案是事實** ——
             Sean 2026-09-03 逐字「乙 5天」, 而系統真的會做(`20260903080000` 的 `interval '5 days'`);
             那個常數與那支 migration 由 `remittance-info.test.ts` 比對, 分岔的那一刻會紅。 */}
      {/* ⟦b4-PARTIALPAIDNOWHERE⟧ 顯示條件從「精確 unpaid」換成【白名單 + 金額】。
          🔴🔴 **白名單裡【沒有 `partiallyRefunded`】, 而那是 R3 對抗審查逼出來的**:
             同一支檔 `:203-206` 逐字寫著「它的定義是退了一部分 ⇒ **它蘊含之前已全額付款**」,
             並據此讓 `paymentCompleted` 對它打 ✅(`:211`)。
             ⇒ 🛑 把它放進匯款白名單 ⇒ **同一個畫面會同時印「付款完成 ✅」與「應付餘額 + 銀行帳號」**
             ⇒ 📌 兩者只能有一個對, 而我選了與 Sean 09-05 拍乙同向的那一個:**有退款一律請聯絡我們。**
             (而 view 那一層現在也會對「有任何有效退款」回 `null` ⇒ 兩層同向, 不互相依賴。)
          🔴 **白名單而不是否定式**(`!== 'paid'`)—— codex 關卡1 R2 抓到:否定式把 `refunded` 也放進來,
             而全額退款的單 `total` 沒降 ⇒ 會叫一個已經退完款的客人再匯一次全額。
             📌 **白名單會隨 enum 增值而變保守, 否定式會變寬。**
          🔴 **而真正決定印不印的是【金額】** —— `balanceDue` 為 `null`(算不出來)⇒ 整塊不印。 */}
      {!cancelled &&
        order.paymentChannel === 'bank_transfer' &&
        (order.paymentStatus === 'unpaid' || order.paymentStatus === 'partiallyPaid') &&
        (order.balanceDue === null || order.balanceDue.amount <= 0) && (
          /* 🔴 Sean 2026-09-05 逐字拍乙:「應付餘額算出來是 0 或負的就整格不印、改印『請聯絡我們』;
             其他情況照甲(數字跟著訂單走)」。
             🔴🔴 **而 `null`(算不出來)也走這一支** —— **Sean 2026-09-05 逐字拍乙:
                「Q-退款後的匯款單: 乙」** = 印「請聯絡我們」那一句(與餘額 ≤0 同一句、同一支分支)。
                ⛔ ~~主視窗延伸裁, Sean 可推翻~~ —— **他答了, 不再是延伸裁。**
                ⇒ `null` 今天有兩個成因, 而它們對客人是**同一件事**:
                   ① 有 confirmed 退款(view 判它算不出來)② 那支 view 讀不到(權限/未貼/異常)。
             🎯 **⇒ 這一整塊的規則收斂成一句**:
                **只有在我們手上有一個【可信的正數】時才印帳號與金額;其餘一律叫他聯絡我們。**
             🛑 舊字面留著:~~`null` ⇒ 整塊不印~~ —— 那是 plan MF① 的原始寫法,
                它防的是「補 0 印出全額」, 而**印一句話不印數字**同樣防得住, 又不會讓客人以為頁面壞了。 */
          <div className="acc-section od-info" data-od-id="order-remittance-contact">
            <div className="acc-section-head">
              <h2>匯款資訊</h2>
            </div>
            <p className="acc-order-note">這張訂單的應付金額需要人工確認,請聯絡我們。</p>
          </div>
        )}
      {!cancelled &&
        order.paymentChannel === 'bank_transfer' &&
        (order.paymentStatus === 'unpaid' || order.paymentStatus === 'partiallyPaid') &&
        order.balanceDue !== null &&
        order.balanceDue.amount > 0 && (
        <div className="acc-section od-info" data-od-id="order-remittance">
          {/* 🔴 `od-info` 那個 class 是**樣式的祖先**, 不是裝飾(code-reviewer must-fix ③):
              稿上那組 dl 的規則是**後代選擇器** `.od-info dl / dt / dd`
              (`apps/storefront/src/styles/order-detail.css:289-291`)——
              ⛔ ~~我第一版寫 `<dl className="od-info-dl">`~~ ⇒ 🛑 **全 repo 零條規則命中那個名字**
              ⇒ dd 保留瀏覽器預設的 `margin-inline-start:40px`、dt/dd 各自成行
              ⇒ ⇒ 🔴 **那 12 碼帳號會印在一個沒有樣式的縮排清單裡。**
              📌 **我發明了一個 class 名字, 而發明一個名字不會讓樣式跟著出現。** */}
          <div className="acc-section-head">
            <h2>匯款資訊</h2>
          </div>
          <dl>
            <dt>銀行</dt>
            <dd data-od-id="order-remittance-bank">
              {PCM_REMITTANCE_BANK_NAME}({PCM_REMITTANCE_BRANCH})
            </dd>
            <dt>戶名</dt>
            <dd data-od-id="order-remittance-holder">{PCM_REMITTANCE_ACCOUNT_NAME}</dd>
            <dt>帳號</dt>
            <dd data-od-id="order-remittance-account">{PCM_REMITTANCE_ACCOUNT_NO}</dd>
            {/* 🔴 Sean 2026-09-05 拍乙:印三行(訂單金額 / 已收 / 應付餘額)——
                他選的是「讓客人自己對得起來」那一版, 不是只印一個數。
                🔵 「已收」是**推出來的**(`total − balanceDue`), 不是另一個來源 ——
                   而它推得出來的前提是那兩個數同源(都來自 `orders.total` 與同一支 view)。 */}
            <dt>訂單金額</dt>
            <dd data-od-id="order-remittance-total">{nt(order.total.amount)}</dd>
            <dt>已收</dt>
            <dd data-od-id="order-remittance-paid">
              {nt(order.total.amount - order.balanceDue.amount)}
            </dd>
            <dt>應付餘額</dt>
            <dd data-od-id="order-remittance-amount">{nt(order.balanceDue.amount)}</dd>
            <dt>備註</dt>
            {/* 🔵 `PCM_REMITTANCE_MEMO_INSTRUCTION` 是段 2 落的常數(reviewer nit ②:我第一版手打了它)
                ⇒ 用常數 ⇒ 這一頁與段 4 那封信從第一天起是**同一份字面**。
                ⚠️ 而**單號本身是我們加的**, 不在他的原話裡(主視窗 2026-09-04 過, 未端 Sean)。 */}
            <dd data-od-id="order-remittance-memo">
              {PCM_REMITTANCE_MEMO_INSTRUCTION} {order.displayId}
            </dd>
          </dl>
          {/* 🔴🔴 **Sean 2026-09-05 第 3 題拍【甲】—— 逐字「改成直接寫日期」。**
              ⛔ ~~請於 {N} 天內完成匯款~~ ⇒ 客人要自己拿下單日去加。
              🛑 **而「算錯的日期比不算糟」** —— 客人照著錯日期匯款, 錢到了單子已經被取消。
                 ⇒ ✅ `remittanceDeadlineLabel` 算不出來時回 `null`, **這裡退回舊那句**,
                   而**不是**印一個猜的日期。
              🔵 「(含)」不是贅字:cron 是 `created_at < now() - 5 days`
                 ⇒ **第 5 天當天還沒到期**(`20260904230000:451-455`)。 */}
          <p className="acc-order-note" data-od-id="order-remittance-expiry">
            {remittanceDeadlineLabel(order.createdAt) === null
              ? `請於 ${PCM_REMITTANCE_EXPIRE_DAYS} 天內完成匯款,逾期訂單將自動取消。`
              : `請於 ${remittanceDeadlineLabel(order.createdAt)}(含)之前完成匯款,逾期訂單將自動取消。`}
          </p>
        </div>
      )}

      {cancelled && (
        <div className="acc-section" data-od-id="order-cancelled">
          <div className="acc-section-head">
            {/* 🔴 兩種取消對客人是**兩件事**:一件是我們關的,一件是他自己沒付而過期。
                字面沿用 Sean 2026-08-24 那一板的原字(「已取消」/「已逾期」),不另造詞。 */}
            <h2>{cancelKind === 'expired' ? '訂單已逾期' : '訂單已取消'}</h2>
          </div>
          {/* 🔴🔴 **這一格【不再印 `cancelledReason`】—— codex must-fix,2026-08-24。**
              ~~原本寫「`cancelledReason` = 可對客文案」~~ **那句話是錯的**:
              `p_reason_code = 'other'` 那條路寫進去的是**員工當場打的原文**
              (`20260804180000_..._admin_cancel_order.sql:135-136`)——
              員工打「供應商欠款 / 內部失誤」都會原樣進那一欄,而沒有任何一層把它變成對客文案。
              🔴 **而在 `#249` 之前沒有人看得到它** ⇒ 那不是既有缺陷,是**這一片親手打開的那扇門**。
              ⇒ 紀律:**客人端只渲染枚舉映射出來的固定字串,永遠不渲染自由文字。**
                 現在連原文都**到不了這一層**(mapper 端就收斂掉了)⇒ 這是型別閘,不是自律。
              ⚠️ **代價照實寫**:客人看不到「為什麼被取消」。要接回來的正確做法是從
                 取消原因的**七值枚舉欄**映一張**固定文案表**,而那張表的字要 Sean 定。
                 🔴 **這裡刻意不寫那張表的字面名** —— `scripts/storefront-projection-leak-guard.test.ts`
                    掃 storefront 原始碼時**不剝 `*` 開頭的註解行**(該檔 `:146-148` 逐字寫了理由:
                    剝了會讓 template literal 裡的跨行 raw SQL 隱形)⇒ 寫在這裡會讓那道守門【假紅】。
                    ⚠️ **改的是這句話的寫法, 不是那道守門** —— 它偏保守是刻意的, 不要去鬆它。
                    要查那個欄位:`grep -rn reason_code supabase/migrations/`(枚舉定義在建表 migration)。
              📌 下面兩句是我寫的、不是稿上的、也不是 Sean 拍過的 ⇒ 已列進送他過目的文案清單。 */}
          <div className="acc-empty-sub">
            {cancelKind === 'expired'
              ? '這張訂單超過付款期限,已自動取消。想再買一次的話,重新下單即可。'
              : '這張訂單已經取消,不需要付款。想知道原因或要重新訂購,請與我們聯絡。'}
          </div>
        </div>
      )}

      <div className="od-help" data-od-id="order-help">
        <div>
          <div className="od-help-t">這筆訂單有問題?</div>
          <div className="od-help-d">
            商品若有瑕疵,收到後請直接用 LINE 傳照片給我們,我們會安排換貨。
            非瑕疵的商品恕不接受退換 —— 下單前不確定裝不裝得上,先問我們最快。
          </div>
        </div>
        <a
          className="acc-btn-ghost"
          href="https://lin.ee/R6QZUH2"
          target="_blank"
          rel="noopener noreferrer"
        >
          用 LINE 詢問這筆訂單
        </a>
      </div>
    </>
  );
}
