import type { AdminOrderDetail, AdminOrderDetailItem, AdminOrderPrintItem } from '@pcm/domain';
import type { ShipmentRow } from '../../lib/shipping/shipment-repository';
import type { OrderShipmentGroup } from '../../lib/shipping/order-shipments';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { cancelledQuantityOf, outstandingQuantity } from '../../lib/shipping/shipping-doc-quantities';
import { carrierLabelOf } from '../../lib/shipping/carrier-label';
// 🔴 `Q-C5`=丙(Sean 2026-08-17):**追蹤碼不印在這張紙上** ⇒ `trackingDisplay` 這裡不再 import。
//    那支函式**沒有刪**(目前零消費端、保留給 `Q-C9` 出貨通知信)——
//    理由在 `shipping-doc-dispatch.ts` 的 `trackingDisplay` docstring。
import { shippedDateText } from '../../lib/shipping/shipping-doc-dispatch';
import { PrintButton } from './print-button';

// #10 片2b:出貨單(一個箱 × 一張訂單)。
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
//    ⚠️ 金額區塊目前**仍然留空**,但理由已經換了:`Q-D-4` 已答(乙 = 兩區塊各自合計),
//    ⇒ **卡的不再是規格,是工序** —— 金額橫跨本檔兩個區塊、且 `Q-D-7` 要求每個印出來的數字
//       都要在註解裡寫明「用哪些權威欄、做了什麼運算」。**排下一片單獨做,不夾帶。**
//    ⇒ **這片在金額落地之前不算做完**,不要當成可以交給 Sean 驗收的成品。
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
  if (reportedTotal !== null && items.length !== reportedTotal) {
    // ⚠️ 逐字寫「達到 200 筆」不是「超過 200 筆」:判定是 `>=`
    //    (`packages/adapters/src/supabase/mappers/order.ts:830`)⇒ **剛好 200 項就會走到這裡**。
    //    🔴 而 Sean 2026-08-17 逐字說一張單「可能到 200 個品項」⇒ **正常業務的上緣就是這個值**。
    return `這張訂單的品項清單讀出來對不上(讀到 ${items.length} 項,資料庫說有 ${reportedTotal} 項),出貨明細單可能少印品項。這是系統的問題,不是你操作錯。請聯絡負責人處理,不要拿這張紙出貨。`;
  }
  // 面5:這箱裡沒有任何屬於這張訂單的品項 ⇒ 網址把不相干的箱與單湊在一起。
  if (lines.length === 0) {
    return '這個包裹裡沒有這張訂單的品項。請從訂單頁的出貨卡點進來,不要自己拼網址。';
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
  if (items.length === 0) {
    return '這張訂單讀不到任何品項,出貨明細單不能印。請重新整理;仍然一樣請回報。';
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
  if (r.name.trim() === '' || r.phone.trim() === '' || r.line.trim() === '') {
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
      <td className='px-2 py-3 align-top font-mono text-base font-bold whitespace-nowrap'>{sku}</td>
      <td className='px-2 py-3 align-top text-sm'>
        <div>{title ?? '—'}</div>
        {spec && (
          <div className='text-muted-foreground mt-0.5 text-xs'>
            {Object.entries(spec)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ')}
          </div>
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
  children,
}: {
  title: string;
  note: string;
  qtyHeader: string;
  children: React.ReactNode;
}) {
  return (
    <div className='space-y-1'>
      <div className='flex flex-wrap items-baseline gap-x-3 border-b pb-1'>
        <h2 className='text-base font-semibold'>{title}</h2>
        <span className='text-muted-foreground text-xs'>{note}</span>
      </div>
      <table className='w-full border-collapse'>
        <thead>
          <tr className='border-b'>
            <th className='px-2 py-2 text-left text-xs font-medium'>料號</th>
            <th className='px-2 py-2 text-left text-xs font-medium'>品名 / 規格</th>
            <th className='px-2 py-2 text-right text-xs font-medium'>{qtyHeader}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
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

export function ShippingDoc({
  detail,
  items,
  reportedTotal,
  shipment,
  lines,
}: {
  detail: AdminOrderDetail;
  /** 🔴 完整品項清單(頂層分頁撈到盡)—— **不要改回 `detail.items`**,理由見 `shippingDocBlocker`。 */
  items: readonly AdminOrderPrintItem[];
  reportedTotal: number | null;
  shipment: ShipmentRow;
  lines: OrderShipmentGroup['lines'];
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

  return (
    /* 🔴 `print-sheet` 是 `app/print/print-a4.css` 唯一的掛勾:列印時把 `p-6` 歸零,
       讓紙面邊界**只由** `@page{margin:12mm 12mm 14mm 12mm}` 決定,不然會內縮兩次。
       ⚠️ 改名要同步那支 CSS —— 那裡是「這張紙是不是 A4」的唯一決定點,
       而改名之後的症狀是**紙印出來邊距不對**,三綠與單測都不會紅。 */
    <div className='print-sheet mx-auto max-w-3xl space-y-4 p-6 print:max-w-none'>
      {/* 🔴 **每個號碼各自帶標籤**(plan §4)。設計需求書早就標了這個風險:
          「**兩個碼並排裸印,客人不知道該拿哪個去查**」。
          ⇒ `displayId` 抽出前是**裸印**(沒有「訂單編號」四個字),這次補上。
          ⚠️ **原文寫「現在紙上有三個 —— 訂單編號 / 箱號 / 追蹤碼」,`Q-C5`=丙 之後只剩兩個**
             (追蹤碼那一列已拿掉,見下方貨運資訊區的作廢註解)。 */}
      {/* ── 抬頭七值(#10,2026-08-17 落地)──
          🔴 **真權威是 OD 專案 `pcm-print-docs` / `shipping-picking-doc-a4.html:228-241`**
             (我當場開過,不是轉述;`list_projects` 當場列出該專案)。
             repo 側 `docs/specs/2026-08-15-shipping-doc-content-contract.md:95-101` 七值逐字相同
             ⇒ 兩個獨立來源吻合。
          🔴 **一個字都不准正規化** —— 樣張 `:231-232` 自己的註解逐字:
             「全形半形不動、+886 不改 0、LTD 後面沒有句點」。
             ⚠️ `PCM MOTOR PARTS LTD` **沒有句點**是 Sean 親自推翻自己前一句的結果
             (合約檔 `:315` 逐字「好啦～沒句點,抱歉」)⇒ 看到有句點的版本是過期來源。
          🔴 **分級 = L2,不是 L1**(code-reviewer R1 MF6 更正我第一版):同一組公司登記資料
             在 `apps/storefront/src/lib/site-config.ts:3` 已經標成 **L2(hardcode + TODO +
             backlog `#248`)**,逐字還寫著「**此處為唯一真相,勿在各元件重複硬寫**」。
             **兩個分級不能同時對** ⇒ 以既有那份為準。
          ⚠️ **而這裡仍然重複寫了一份,那是刻意的**:`site-config.ts` 在 **storefront** 這個 app,
             admin 不 import 它(跨 app 依賴 = 另一件事)。⇒ **代價是它們會各自漂**,
             所以兩邊互指:那支檔的電話是 `+886-930-531-867`(連字號),
             **紙上這份是空格版**,因為樣張要求逐字不正規化 —— **不是打錯,是兩個不同的用途**。
             🔴 **而「兩邊互指」目前是【單向】的**(code-reviewer R2 F5 抓到我把它寫成互指):
             **只有這裡指過去,`site-config.ts` 一個字沒動** —— 它 `:4` 仍逐字寫著
             「此處為唯一真相,勿在各元件重複硬寫」,而這裡正是一份重複。
             ⇒ **那一邊要補的那一行歸 storefront**(跨 app、另一片),**本片刻意不動**。
             📌 真正的收斂點是 `#248`(登記資料進後台),不是在這裡再造一個常數。
             📌 **已立案 `#602`**(2026-08-17)—— 在那之前,這條登記**只住在註解裡**,
                而註解**被遺忘時什麼都不會響**。
          ⚠️ 左側欄名(公司名稱/電話/…)是設計端自訂、非拍板值;右側八個字串才是。 */}
      <header className='rounded-md border p-3 text-sm'>
        <div className='text-muted-foreground mb-1 text-xs'>開立單位</div>
        <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5'>
          <dt className='text-muted-foreground'>公司名稱</dt>
          <dd className='font-medium'>派達有限公司</dd>
          <dt className='text-muted-foreground'>電話</dt>
          <dd>+886 930-531-867</dd>
          <dt className='text-muted-foreground'>電子郵件</dt>
          <dd>sean@pcmmotorsports.com</dd>
          <dt className='text-muted-foreground'>統一編號</dt>
          <dd className='tabular-nums'>90003020</dd>
          <dt className='text-muted-foreground'>地址</dt>
          <dd>新北市新莊區化成路736巷18號1樓</dd>
          <dt className='text-muted-foreground'>LINE</dt>
          <dd>@pcmmoto</dd>
          <dt className='text-muted-foreground'>英文名稱</dt>
          <dd>PCM MOTOR PARTS LTD</dd>
        </dl>
      </header>

      <div className='flex flex-wrap items-center gap-3'>
        {/* 🔴 標題改「出貨明細單」+ 英文 + 用途說明,依樣張 `:244-250` 逐字。
            ⚠️ 舊字面是「出貨單」,`page.test.tsx` 兩處 `toContain('出貨單')` 同批更新
               —— `出貨明細單` **不包含** `出貨單` 這個子字串(明細二字插在中間),
               不改那兩格會紅,而它們紅得對。 */}
        <div>
          <h1 className='text-2xl font-semibold'>出貨明細單</h1>
          <div className='text-muted-foreground text-xs'>Shipping / Picking Document</div>
          {/* 🔴🔴 **樣張的用途說明兩行【刻意還不印】**(code-reviewer R2 F4 抓到,我原本照抄了)。
              樣張逐字是「倉庫揀貨核對 · 隨貨交付客戶」+「同一張紙兩用:先在倉庫對箱勾選,
              再隨商品出貨」—— **而這張紙上沒有勾選欄**(本檔 `Section` 的 `<th>` 只有
              料號 / 品名規格 / 數量;勾選欄在 `components/print/picking-doc.tsx` 那張紙上)。
              ⇒ **印出來就是一條員工做不到的指示**,與本片剛清掉的那句假話同一個病。
              🔴 **「逐字照樣張」擋不住這一條** —— 樣張的前提(揀貨單與出貨單已合併成一張)
                 **還沒成立**;字面沒抄錯,是**它描述的那個世界還不存在**。
              ⇒ 合併片落地時把這兩行一起補上,那時它才是真的(登記在
                 `docs/specs/2026-08-16-shipping-doc-sample-vs-impl.md` §4)。 */}
        </div>
        <span className='text-xl font-semibold tabular-nums'>
          <span className='text-muted-foreground text-sm font-normal'>訂單編號 </span>
          {detail.displayId}
        </span>
        <span className='font-mono text-sm'>箱號 {shipment.shipmentReference}</span>
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
        <Alert>🔴 {blocked}</Alert>
      ) : (
        <>
          {/* 收件人。`blocked === null` 已保證 `recipientSnapshot` 非 null 且三欄都有內容。 */}
          <div className='rounded-md border p-3 text-sm'>
            <div className='text-muted-foreground mb-1 text-xs'>收件人</div>
            <div className='font-medium'>{shipment.recipientSnapshot?.name}</div>
            <div>{shipment.recipientSnapshot?.phone}</div>
            <div>{shipment.recipientSnapshot?.line}</div>
          </div>

          {/* ── 貨運資訊(#10 片3)──
              🔴 **這一區在落地之前,紙上關於「誰送的」一個字都沒有。**
              ⚠️ **原文接著寫「設計需求書把追蹤碼列為必須(缺),理由逐字『客人查貨的唯一依據』」**
                 —— 那句**仍然是設計需求書的原文**,但 `Q-C5`=丙 之後**不再由這張紙負責**:
                 Sean 選的是「這件事根本不該由紙做」,追蹤碼走簡訊／Email(`Q-C9`)。
                 ⇒ 需求書那句沒有被推翻,是**載體換了**。
              🔴 資料全在 `ShipmentRow` 裡 ⇒ 零 migration、零新查詢。純粹是「有資料沒印出來」。
              ⚠️ 各欄位的判斷都在 `lib/shipping/shipping-doc-dispatch.ts` 與
                 `carrier-label.ts`,**不在這裡** —— 它們要有不需渲染就跑得動的測試。 */}
          <div className='rounded-md border p-3 text-sm'>
            <div className='text-muted-foreground mb-1 text-xs'>貨運資訊</div>
            <div className='flex flex-wrap gap-x-6 gap-y-1'>
              <span>
                貨運商:{carrierLabelOf(shipment.carrierCode)}
                {shipment.carrierNote !== null && shipment.carrierNote.trim() !== '' &&
                  `(${shipment.carrierNote})`}
              </span>
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
              <span>日期:{shippedDateText(shipment.shippedAt)}</span>
            </div>
            {/* ── 🔴 追蹤碼那一列在這裡,而它被 `Q-C5`=丙 拿掉了(2026-08-17)──
                Sean 逐字 `q3: 丙` ⇒ **出貨明細單不印追蹤碼欄位,追蹤碼只走簡訊／Email 給客人。**
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

          <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm'>
            <span>下單:{formatOrderDateTime(detail.createdAt)}</span>
            <span>本次出貨:{lines.length} 項</span>
          </div>

          {/* ── 區塊一:這箱裡、屬於這張訂單的東西 ── */}
          <Section title='本次出貨' note='這個箱子裡屬於這張訂單的品項' qtyHeader='本次出貨'>
            {lines.map((l) => {
              // `blocked === null` 已保證每一條 line 都對得到品項(面7)。
              const item = itemById.get(l.orderItemId);
              return (
                <tr key={l.orderItemId} className='border-b'>
                  <ItemCells sku={item?.variantSku} title={item?.title} spec={item?.spec} />
                  <td className='px-2 py-3 text-right align-top text-xl font-semibold tabular-nums'>
                    {l.quantity}
                  </td>
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
            >
              {outstandingRows.map(({ item, qty }) => (
                <tr key={item.id} className='border-b'>
                  <ItemCells sku={item.variantSku} title={item.title} spec={item.spec} />
                  <td className='px-2 py-3 text-right align-top'>
                    {qty === null ? (
                      // 🔴 不知道就明說,**不印下單量、不補 0**(契約見 `outstandingQuantity` docstring)。
                      <span className='text-sm font-medium text-amber-800'>
                        數量資料尚未就緒
                        <br />
                        這一項不要當成已出貨
                      </span>
                    ) : (
                      <span className='text-xl font-semibold tabular-nums'>{qty}</span>
                    )}
                  </td>
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
            <Section title='訂單取消' note='這張訂單裡已經取消的品項,不會出貨' qtyHeader='已取消'>
              {cancelledRows.map(({ item, qty }) => (
                <tr key={item.id} className='border-b'>
                  <ItemCells sku={item.variantSku} title={item.title} spec={item.spec} />
                  <td className='px-2 py-3 text-right align-top text-xl font-semibold tabular-nums'>
                    {qty}
                  </td>
                </tr>
              ))}
            </Section>
          )}

          {/* 🔴🔴 **金額區塊:刻意還沒做 —— 但卡的已經不是規格了。**
              `Q-D-3` = B(要印金額)、`Q-D-4` = 乙(兩區塊各自合計)⇒ **規格已經齊了。**
              現在卡的是工序:金額橫跨上面兩個區塊,而 `Q-D-7` 要求每個印在紙上的數字
              都要在註解裡寫明「用哪些權威欄、做了什麼運算」。⇒ **排下一片單獨做,不夾帶進這片。**
              落地時的硬條款(不變):**紙上零金額計算的意思是「不自己發明算法」,不是「不能算」** ——
              `Q-D-7` 已放行 `unitPrice × 本區數量` 後加總,但**禁止**從 `subtotal`/`total` 反推、
              **禁止**浮點,且格式化一律走既有 `formatOrderAmount`(`order-list-view.ts:746`)。 */}

          <div className='text-muted-foreground flex gap-8 pt-6 text-sm'>
            {/* 🔴 **`Q-C7` = 丙(Sean 2026-08-16 逐字「丙,拿掉頁尾手寫日期」)**:
                原本這裡還有一格手寫「日期:________」,而表頭已經印了一個「出貨日」。
                兩個日期在員工實際交寄跨日時會不一致,**而客人不知道該信哪一個**。
                ⚠️ **不要「順手」把它加回來** —— 它看起來像單據的標準欄位,而它是被拍板拿掉的。 */}
            <span>出貨人:________________</span>
          </div>
        </>
      )}
    </div>
  );
}
