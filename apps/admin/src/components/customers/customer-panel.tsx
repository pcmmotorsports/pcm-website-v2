import Link from 'next/link';
import type { CustomerDetailData } from '../../lib/customers/load-customer-detail';
import { CustomerDetail } from './customer-detail';

// customer-panel.tsx — 訂單面板裡的**客人卡**(OD 片 3b;需求檔 §0-J J-4)。
//
// 🔴 **它不是另一張卡,是同一個 `<CustomerDetail>`**:J-4 逐字「刻意不複製一份 markup 過來,
//    不然兩邊遲早會長不一樣」。OD 在靜態 HTML 環境用 iframe 達成那件事;真站用
//    「同一個元件 + 同一份取數(`loadCustomerDetail`)」達成 —— 比 iframe 更硬
//    (iframe 是兩份 DOM 樹,這裡是同一個元件)。
//
// 🔴 **唯讀**(主視窗 2026-08-13 裁 A):`readOnly` 讓等級變更與儲值金調整兩支表單不出現。
//    理由見 `customer-detail.tsx` 的 `readOnly` docstring(那兩支的 action 會把員工
//    redirect 去 `/customers`、弄丟他手上的訂單面板)。
//
// 🔴 **零 `notFound()`**:在平行路由槽裡呼叫它炸掉的是**整個頁面**
//    (`app/@panel/orders/page.tsx:47-49` 逐字「員工手上的列表會整片消失」)⇒ 查無與失敗都在卡內顯示。

export function CustomerPanel({
  data,
  backHref,
  fullPageHref,
  orderHref,
}: {
  data: CustomerDetailData;
  /** 「回訂單」= 拿掉 `customer` param 的同一個面板網址(`panel` 還在 ⇒ 必然回到原本那張單)。 */
  backHref: string;
  /**
   * 「開整頁 ↗」。
   * 🔴 **這個出口是 OD 定的、不是我加的**:`customer-card-summary.html:338` 有這顆按鈕,
   *    同檔 `:310` 逐字說明「**整頁出口只有一個** —— 標頭右上角常駐的『開整頁 ↗』。
   *    面板已經回答八成問題,整頁是逃生門,所以**不重複放第二個**」。
   *    ⇒ 唯讀模式下要調儲值金/等級的人走這裡,而**卡內不另外加第二個入口**。
   */
  fullPageHref: string;
  /** 訂單歷史的單號連到哪(面板版 = 換成那張訂單的面板)。 */
  orderHref: (orderId: string) => string;
}) {
  return (
    <div className='space-y-4'>
      {/* 🔴 標頭只放「回去」與「開整頁」兩顆。客人名字**不在這裡重複** ——
          `<CustomerDetail>` 自己的 `<h1>` 已經有了,兩層都印一次就是 OD 第六輪
          在手機上抓到的雙標題列病(`overview-desktop.html:627-628` 逐字記過)。 */}
      <div className='flex flex-wrap items-center gap-2 border-b pb-3'>
        <Link
          href={backHref}
          className='border-border bg-card hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm'
        >
          ← 回訂單
        </Link>
        <span className='ml-auto' />
        <Link
          href={fullPageHref}
          className='border-border bg-card hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm'
        >
          開整頁 ↗
        </Link>
      </div>

      {/* 🔴 「讀取失敗」與「查無此人」是兩件事,顯示成同一句就是把一次讀取失敗
          說成「這個客人不存在」(判準與理由在 `load-customer-detail.ts` 的
          `CustomerDetailData.customer` docstring;那裡的兩個成因對應這裡兩個分支)。 */}
      {data.customerFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm'>
          客人資料載入失敗(這<strong>不是</strong>「查無此人」,是「沒讀到」)。
          請重新整理;若仍相同,請通知系統維護。
        </div>
      ) : data.customer === null ? (
        <div className='text-muted-foreground rounded-lg border p-4 text-sm'>
          查無這位客人 —— 這張單的客人可能已被刪除。
        </div>
      ) : (
        <CustomerDetail
          customer={data.customer}
          walletEntries={data.walletEntries}
          walletLoadFailed={data.walletLoadFailed}
          orders={data.orders}
          ordersLoadFailed={data.ordersLoadFailed}
          addresses={data.addresses}
          addressesLoadFailed={data.addressesLoadFailed}
          vehicles={data.vehicles}
          vehiclesLoadFailed={data.vehiclesLoadFailed}
          readOnly
          orderHref={orderHref}
        />
      )}
    </div>
  );
}
