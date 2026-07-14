import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminOrderDetail, OrderStatusOption } from '@pcm/domain';
import {
  getAdminOrderRepository,
  getAdminOrderStatusOptionsRepository,
} from '@/lib/orders/order-repository';
import { isOrderId } from '@/lib/orders/order-detail-view';
import { OrderDetail } from '@/components/orders/order-detail';

// M-4a Slice B:後台訂單明細頁(server component、唯讀)。
// 🔴 PII:客人姓名/電話/email+收件快照只在本頁(明細專用白名單、service_role、登入閘後);列表不帶。
export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // id 形狀守門:非 UUID 直接 404、不打 DB(路由參數不透傳查詢)。
  if (!isOrderId(id)) {
    notFound();
  }

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 404。
  // 明細與狀態詞彙分開容錯(詞彙壞 → badge 降級中性灰,明細仍可看;同列表頁慣例)。
  let detail: AdminOrderDetail | null = null;
  let statusOptions: OrderStatusOption[] = [];
  let loadFailed = false;
  const [detailSettled, optionsSettled] = await Promise.allSettled([
    (async () => getAdminOrderRepository().findAdminOrderDetail(id))(),
    (async () => getAdminOrderStatusOptionsRepository().listOrderStatusOptions())(),
  ]);
  if (detailSettled.status === 'fulfilled') {
    detail = detailSettled.value;
  } else {
    console.error('[admin/orders/:id] 訂單明細載入失敗', detailSettled.reason);
    loadFailed = true;
  }
  if (optionsSettled.status === 'fulfilled') {
    statusOptions = optionsSettled.value;
  } else {
    console.error('[admin/orders/:id] 訂單狀態詞彙載入失敗(badge 降級中性灰)', optionsSettled.reason);
  }

  if (!loadFailed && detail === null) {
    notFound();
  }

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <Link
        href='/orders'
        className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
      >
        ← 返回訂單列表
      </Link>

      {loadFailed || detail === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單明細載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <OrderDetail detail={detail} statusOptions={statusOptions} />
      )}
    </div>
  );
}
