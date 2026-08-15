import { notFound } from 'next/navigation';
import { getAdminOrderRepository } from '../../../../../lib/orders/order-repository';
import { isOrderId } from '../../../../../lib/orders/order-detail-view';
import { PickingDoc } from '../../../../../components/print/picking-doc';

// 相對 import(非 `@/`):根 `vitest.config.ts` 的 `@` alias 指向 storefront ⇒ 用 `@/` 的話
// 這一頁**完全沒辦法被單測載入**。同 `app/orders/[id]/page.tsx:1` 的既有慣例。
//
// #10 片1:揀貨單列印頁(server component、唯讀)。
//
// 🔴 **登入**:本路由**不需要**自己做任何事 —— `apps/admin/src/proxy.ts:39-50` 是 fail-closed
//    的全站登入閘,matcher(`:64` 逐字 `'/((?!_next/static|_next/image|favicon.ico).*)'`)
//    涵蓋 `/print/...`。⚠️ 這句話是「不必加驗證」的**條件**,不是贈品:
//    本目錄的 `page.test.tsx` 最後一個 describe 讀 `proxy.ts` 原始字面,把 matcher 與
//    SSO 白名單各釘一行,改窄了會當場紅。
//    ⚠️ **那兩格只證設定字面,沒有呼叫過 `proxy()` 本體** —— redirect 的實際行為未驗(誠實揭示)。
//
// 🔴 **PII**:本頁只印客人**姓名**,不印電話與地址(`picking-doc.tsx` 檔頭寫了為什麼)。
//    投影仍是明細專用白名單(含 PII)⇒ 少印不等於少讀,但少印就少一個外洩面。
export const dynamic = 'force-dynamic';

// nit-13:紙頭(瀏覽器列印頁首)預設會印 root layout 的 `PCM 後台` ⇒ 每張揀貨單的頁首都一樣。
// 這一頁的紙常常好幾張散在桌上 ⇒ 頁首帶單號是**分得出是哪張單**最便宜的做法。
// ⚠️ 頁首/頁尾要不要印、印在哪,是**瀏覽器列印設定**決定的,不是我們能保證的 ——
//    這裡只保證「如果印了,上面是對的字」。
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isOrderId(id)) return { title: '揀貨單' };
  // 這支查詢與下面的頁面各查一次(Next 對同一 request 的 dedupe 不涵蓋非 `fetch` 的呼叫)。
  // 代價 = 多一趟唯讀查詢;換到的是紙上有單號。真的想省要自己包 `cache()`,不在本片範圍。
  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  return { title: detail === null ? '揀貨單' : `揀貨單 ${detail.displayId}` };
}

export default async function OrderPickingPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // id 形狀守門:非 UUID 不打 DB(同 `order-detail-route.tsx:106` 的既有立場)。
  if (!isOrderId(id)) notFound();

  // 🔴 這裡**刻意不容錯**、讓它 throw:明細頁那支要容錯是因為它是員工的主要工作面,
  //    掛掉整頁就沒得做事。列印頁不同 —— 讀失敗時唯一正確的行為是**不要印出一張紙**,
  //    印出一張內容可疑的揀貨單比印不出來貴得多。
  const detail = await getAdminOrderRepository().findAdminOrderDetail(id);
  if (detail === null) notFound();

  return <PickingDoc detail={detail} />;
}
