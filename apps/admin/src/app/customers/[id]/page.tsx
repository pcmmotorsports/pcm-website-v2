import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCustomerDetail } from '@/lib/customers/load-customer-detail';
import { isCustomerId } from '@/lib/customers/customer-detail-view';
import { CustomerDetail } from '@/components/customers/customer-detail';
import { ResultBanner } from '@/components/orders/result-banner';

// M-4a 客戶明細-a+b+儲值金編輯:後台客戶明細頁(server component;儲值金卡含調整表單、其餘唯讀)。
// 🔴 PII:email/電話/生日/地址/引擎號只在本頁(service_role、登入閘後)。
export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawSearch = await searchParams;
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;
  // id 形狀守門:非 UUID 直接 404、不打 DB(路由參數不透傳查詢;鏡像 orders/[id])。
  if (!isCustomerId(id)) {
    notFound();
  }

  // 🔴 防禦:客戶本體讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 404。
  // 儲值金/訂單/地址/車庫各自容錯(單區塊壞 → 該區錯誤列、其他照看;同訂單明細頁慣例)。
  // 🔴 取數本體在 `lib/customers/load-customer-detail.ts`(OD 片 3a 抽出,面板版共用同一份)——
  //    `notFound()` 刻意留在本頁、**不搬進去**:面板裡呼叫它會炸掉整個頁面
  //    (`app/@panel/orders/page.tsx:47-49`「員工手上的列表會整片消失」)。
  const data = await loadCustomerDetail(id);

  if (!data.customerFailed && data.customer === null) {
    notFound();
  }

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <Link
        href='/customers'
        className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
      >
        ← 返回客戶列表
      </Link>

      <ResultBanner code={resultCode} />

      {data.customerFailed || data.customer === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          客戶明細載入失敗,請稍後再試或聯絡系統維護。
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
        />
      )}
    </div>
  );
}
