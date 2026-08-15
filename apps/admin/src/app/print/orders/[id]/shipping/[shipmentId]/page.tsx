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
  const { id } = await params;
  if (!isOrderId(id)) return { title: '出貨單' };
  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  return { title: detail === null ? '出貨單' : `出貨單 ${detail.displayId}` };
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

  // 🔴 只餵 id 與 title 兩欄下去 —— 不把整包 detail(帶成交價)交給資料層。
  //    慣例與 `components/orders/shipment-section.tsx:26` 逐字相同。
  const titleByItemId = new Map(detail.items.map((it) => [it.id, it.title]));
  const groups = await loadOrderShipments(titleByItemId);
  const group = groups.find((g) => g.shipment.id === shipmentId);
  // 網址把不相干的箱與單湊在一起 ⇒ 這裡就結束,不進版面。
  if (group === undefined) notFound();

  // 料號 / 規格由**本頁**自己從 `detail.items` 對回去(`lines` 只帶 `orderItemId`)。
  // 🔴 刻意不去加寬 `loadOrderShipments` 的簽章:那支是訂單詳情頁出貨卡的既有消費端,
  //    改共用簽章會把風險推到既有畫面上;讓新來的自己多做一點,風險留在新的這一邊。
  return <ShippingDoc detail={detail} shipment={group.shipment} lines={group.lines} />;
}
