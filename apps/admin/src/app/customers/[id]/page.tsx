import Link from 'next/link';
import { notFound } from 'next/navigation';
import type {
  Customer,
  CustomerAddress,
  CustomerVehicle,
  OrderListItem,
  WalletLedgerEntry,
} from '@pcm/domain';
import {
  getAdminCustomerRepository,
  getAdminWalletRepository,
  getAdminAddressRepository,
  getAdminVehicleRepository,
} from '@/lib/customers/customer-repository';
import { getAdminOrderRepository } from '@/lib/orders/order-repository';
import { isCustomerId } from '@/lib/customers/customer-detail-view';
import { CustomerDetail } from '@/components/customers/customer-detail';

// M-4a 客戶明細-a+b:後台客戶明細頁(server component、唯讀;基本資料+儲值金+訂單歷史+地址+車庫)。
// 🔴 PII:email/電話/生日/地址/引擎號只在本頁(service_role、登入閘後)。
export const dynamic = 'force-dynamic';

/** allSettled 結果收斂:成功取值、失敗 log + 旗標(各區塊分開容錯、基本資料不連坐)。 */
function settle<T>(
  settled: PromiseSettledResult<T>,
  fallback: T,
  label: string,
): { value: T; failed: boolean } {
  if (settled.status === 'fulfilled') {
    return { value: settled.value, failed: false };
  }
  console.error(`[admin/customers/:id] ${label}載入失敗`, settled.reason);
  return { value: fallback, failed: true };
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // id 形狀守門:非 UUID 直接 404、不打 DB(路由參數不透傳查詢;鏡像 orders/[id])。
  if (!isCustomerId(id)) {
    notFound();
  }

  // 🔴 防禦:客戶本體讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 404。
  // 儲值金/訂單/地址/車庫各自容錯(單區塊壞 → 該區錯誤列、其他照看;同訂單明細頁慣例)。
  const [customerSettled, walletSettled, ordersSettled, addressesSettled, vehiclesSettled] =
    await Promise.allSettled([
      (async () => getAdminCustomerRepository().findById(id))(),
      (async () => getAdminWalletRepository().listEntries(id))(),
      (async () => getAdminOrderRepository().listSummariesByCustomer(id))(),
      (async () => getAdminAddressRepository().listByCustomer(id))(),
      (async () => getAdminVehicleRepository().listByCustomer(id))(),
    ]);

  const customerResult = settle<Customer | null>(customerSettled, null, '客戶明細');
  const wallet = settle<WalletLedgerEntry[]>(walletSettled, [], '儲值金流水');
  const orders = settle<OrderListItem[]>(ordersSettled, [], '訂單歷史');
  const addresses = settle<CustomerAddress[]>(addressesSettled, [], '收件地址');
  const vehicles = settle<CustomerVehicle[]>(vehiclesSettled, [], '車庫');

  if (!customerResult.failed && customerResult.value === null) {
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

      {customerResult.failed || customerResult.value === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          客戶明細載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <CustomerDetail
          customer={customerResult.value}
          walletEntries={wallet.value}
          walletLoadFailed={wallet.failed}
          orders={orders.value}
          ordersLoadFailed={orders.failed}
          addresses={addresses.value}
          addressesLoadFailed={addresses.failed}
          vehicles={vehicles.value}
          vehiclesLoadFailed={vehicles.failed}
        />
      )}
    </div>
  );
}
