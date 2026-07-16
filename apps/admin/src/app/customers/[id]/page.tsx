import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Customer, WalletLedgerEntry } from '@pcm/domain';
import {
  getAdminCustomerRepository,
  getAdminWalletRepository,
} from '@/lib/customers/customer-repository';
import { isCustomerId } from '@/lib/customers/customer-detail-view';
import { CustomerDetail } from '@/components/customers/customer-detail';

// M-4a 客戶明細-a:後台客戶明細頁(server component、唯讀;基本資料 + 儲值金餘額/流水)。
// 🔴 PII:email/電話/生日只在本頁(service_role、登入閘後);訂單歷史/地址/車庫 = 明細-b。
export const dynamic = 'force-dynamic';

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

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 404。
  // 基本資料與流水分開容錯(流水壞 → 錯誤列、基本資料仍可看;同訂單明細頁慣例)。
  let customer: Customer | null = null;
  let walletEntries: WalletLedgerEntry[] = [];
  let loadFailed = false;
  let walletLoadFailed = false;
  const [customerSettled, walletSettled] = await Promise.allSettled([
    (async () => getAdminCustomerRepository().findById(id))(),
    (async () => getAdminWalletRepository().listEntries(id))(),
  ]);
  if (customerSettled.status === 'fulfilled') {
    customer = customerSettled.value;
  } else {
    console.error('[admin/customers/:id] 客戶明細載入失敗', customerSettled.reason);
    loadFailed = true;
  }
  if (walletSettled.status === 'fulfilled') {
    walletEntries = walletSettled.value;
  } else {
    console.error('[admin/customers/:id] 儲值金流水載入失敗(基本資料不受影響)', walletSettled.reason);
    walletLoadFailed = true;
  }

  if (!loadFailed && customer === null) {
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

      {loadFailed || customer === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          客戶明細載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <CustomerDetail
          customer={customer}
          walletEntries={walletEntries}
          walletLoadFailed={walletLoadFailed}
        />
      )}
    </div>
  );
}
