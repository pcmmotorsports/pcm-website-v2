import { ManualOrderView, type ManualOrderSearchParams } from '@/components/orders/manual-order-view';

// app/orders/new/page.tsx — M12-A3-b:後台手動建單表單頁(`#858`)的**整頁版容器**。
//
// 🔴 **內容不在本檔** —— 2026-08-28 線A 把它搬進 `components/orders/manual-order-view.tsx`,
//    因為同一份畫面要同時長在整頁與右側面板(`/orders?panel=new`)兩個地方。
//    兩邊各自載一次資料 = 兩個真相源,而改一邊的那天不會有東西紅。
//
// 🔴 它同時是 `createManualOrderAction` 的第一個呼叫端(經由那個元件)。
//    在它落地之前那支 action 是【零呼叫端】,而那個中間態**沒有任何偵測器**:
//    2026-08-24 實測 —— action 把常數寫在 `'use server'` 檔裡,
//    typecheck / lint / build / 4702 格測試**全綠**;一接上這一頁 ⇒ build 當場紅,逐字
//    `Error: Only async functions are allowed to be exported in a "use server" file.`

export const dynamic = 'force-dynamic';

export default async function ManualOrderNewPage({
  searchParams,
}: {
  searchParams: Promise<ManualOrderSearchParams>;
}) {
  return <ManualOrderView raw={await searchParams} />;
}
