import { notFound } from 'next/navigation';
import { getAdminOrderRepository } from '../../../../../../lib/orders/order-repository';
import { isOrderId } from '../../../../../../lib/orders/order-detail-view';
import { loadOrderShipments } from '../../../../../../lib/shipping/order-shipments';
import { ShippingDoc } from '../../../../../../components/print/shipping-doc';

// 相對 import(非 `@/`):根 `vitest.config.ts` 的 `@` alias 指向 storefront ⇒ 用 `@/` 這一頁
// 完全沒辦法被單測載入。同 `app/orders/[id]/page.tsx:1` 的既有慣例。
//
// #10 片2b:出貨單列印頁(server component、唯讀)。單位 = **一個箱 × 一張訂單**。
//
// 🔴 **網址帶兩個 id,而沒有任何東西保證那兩個 id 有關係。**
//    `(箱, 訂單)` 這種複合單位天生有這個破口:`/print/orders/<A>/shipping/<B>` 隨便湊都打得開。
//    ⇒ 本頁**不信網址**:先用訂單去查它的包裹,再從結果裡找那個箱號;
//      找不到 = 這箱與這單無關 ⇒ `notFound()`。**絕不拿箱 id 直接去查箱**,那樣就等於信了網址。
//
// 🔴 **登入**:沿用 `proxy.ts:39-50` 的 fail-closed 全站閘(matcher `:64` 涵蓋 `/print/...`),
//    本路由不需自己做;`page.test.tsx` 有一格釘住那條 matcher。
//
// 🔴 **PII**:本頁會印收件人姓名 / 電話 / 地址 —— 那是這張紙的用途(貼在箱子上給客人)。
//    但它在 admin 的登入閘後面,**不得**放到 storefront。
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; shipmentId: string }>;
}) {
  // 🔴 **2026-08-17:標題跟著紙上那個一起改成「出貨明細單」**(code-reviewer R1 MF2)。
  //    紙上寫「出貨明細單」而分頁名寫「出貨單」⇒ 兩個名字,而**瀏覽器列印時分頁名會印在頁首**
  //    ⇒ 同一張紙上出現兩種單據名稱。這正是「只改被指名那一處」的形狀:
  //    我改了 `ShippingDoc` 的 `<h1>`,而**這一支從頭到尾沒被指名過**。
  const { id } = await params;
  if (!isOrderId(id)) return { title: '出貨明細單' };
  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  return { title: detail === null ? '出貨明細單' : `出貨明細單 ${detail.displayId}` };
}

export default async function OrderShippingPrintPage({
  params,
}: {
  params: Promise<{ id: string; shipmentId: string }>;
}) {
  const { id, shipmentId } = await params;
  // 兩個 id 都要驗形狀:非 UUID 不打 DB(同 `order-detail-route.tsx:106` 的既有立場)。
  if (!isOrderId(id) || !isOrderId(shipmentId)) notFound();

  // 🔴 讀失敗**刻意不容錯、讓它 throw**(同片1):明細頁要容錯是因為它是員工的主要工作面;
  //    列印頁不同 —— 讀不到時唯一正確的行為是**不要印出一張紙**。
  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  if (detail === null) notFound();

  // 🔴🔴 **品項改走頂層分頁查詢撈到盡**(`Q-C18` 甲,Sean 2026-08-17 批)。
  //    `detail.items` 是**內嵌**撈的、被 `ORDER_ITEMS_EMBED_LIMIT = 200` 夾住,
  //    而 Sean 逐字說一張單「可能到 200 個品項」⇒ **那是正常業務的上緣,不是極端值**。
  // 🔴 **而這一行同時解掉「A 餵壞 B」那條連鎖** —— 下面 `loadOrderShipments` 吃的 id 集合
  //    以前來自 `detail.items`(**已被 200 夾過**)⇒ 訂單 300 項時,後 100 項所在的箱
  //    **根本不會被查到,而那不算截斷、不會有任何訊號**。現在餵的是完整那份。
  //    ⇒ **只修品項那半等於沒修**,兩半必須同一顆改(plan §1「A 會餵壞 B」)。
  const { items, reportedTotal } = await getAdminOrderRepository().listOrderItemsForPrint(id);

  // 🔴 只餵 id 與 title 兩欄下去 —— 不把整包 detail(帶成交價)交給資料層。
  //    慣例與 `components/orders/shipment-section.tsx:26` 逐字相同。
  const titleByItemId = new Map(items.map((it) => [it.id, it.title]));
  const groups = await loadOrderShipments(titleByItemId);
  // 🔴🔴 `null` = 箱品項清單**可能不完整**(截斷),不是「沒有箱」(2026-08-16 codex 關卡1 ⑧)。
  //    ⇒ **這裡的正確行為與檔頭那句一致:讀不到時不要印出一張紙。**
  //    若照常往下走,`group.lines` 會少幾列 ⇒ 紙上**少列品項**,而**紙看起來完全正常**。
  //    ⚠️ 用 `notFound()` 而不是往下傳一個旗標:這條路徑上員工要的不是「印一張有警告的紙」,
  //       是**不要印**。(⚠️ **與 `shippingDocBlocker` 那八面【不完全不同】** —— 其中**面6 就是「品項清單沒載完」**,
  //       同一類,而它的處置是印一張只有 `<Alert>` 的紙。
  //       ⇒ 這裡選 `notFound()` 的真理由不是「類別不同」,是**拿不到 `group` 就組不出 `ShippingDoc`**
  //         —— 沒有 `shipment` 可傳,連那張 Alert 紙都畫不出來。(code-reviewer R1 MF5 更正)
  //       而這一種是**我們連內容有沒有齊都不知道**。)
  if (groups === null) notFound();
  const group = groups.find((g) => g.shipment.id === shipmentId);
  // 網址把不相干的箱與單湊在一起 ⇒ 這裡就結束,不進版面。
  if (group === undefined) notFound();

  // 料號 / 規格由**本頁**自己從 `detail.items` 對回去(`lines` 只帶 `orderItemId`)。
  // 🔴 刻意不去加寬 `loadOrderShipments` 的簽章:那支是訂單詳情頁出貨卡的既有消費端,
  //    改共用簽章會把風險推到既有畫面上;讓新來的自己多做一點,風險留在新的這一邊。
  return (
    <ShippingDoc
      detail={detail}
      items={items}
      reportedTotal={reportedTotal}
      shipment={group.shipment}
      lines={group.lines}
    />
  );
}
