import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AdminOrderDetail, OrderStatusOption } from '@pcm/domain';
import type { SupplierOption } from '../../../lib/orders/procurement-suppliers';
import {
  getAdminOrderRepository,
  getAdminOrderStatusOptionsRepository,
} from '../../../lib/orders/order-repository';
import { isOrderId } from '../../../lib/orders/order-detail-view';
import { isUuid } from '../../../lib/orders/note-action-state';
import { listSuppliers } from '../../../lib/supplier';
import { OrderDetail } from '../../../components/orders/order-detail';
import { ResultBanner } from '../../../components/orders/result-banner';

// 相對 import(非 `@/`):root vitest.config 的 `@` alias 指向 storefront ⇒ 用 `@/` 的話這一頁
// **完全沒辦法被單測載入**(A10b 關卡2 codex MF10 要求補頁層接線測試時當場踩到)。
// 同 `lib/session/actor.ts:2` 的既有慣例。
//
// M-4a Slice B:後台訂單明細頁(server component、唯讀)。
// 🔴 PII:客人姓名/電話/email+收件快照只在本頁(明細專用白名單、service_role、登入閘後);列表不帶。
export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawSearch = await searchParams;
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;
  // A10a-3:更正模式目標(uuid 形狀閘;非 uuid 視同沒帶,不透傳)
  const correctNoteId =
    typeof rawSearch.correct === 'string' && isUuid(rawSearch.correct)
      ? rawSearch.correct
      : null;
  // id 形狀守門:非 UUID 直接 404、不打 DB(路由參數不透傳查詢)。
  if (!isOrderId(id)) {
    notFound();
  }

  // 🔴 防禦:讀取失敗 → 錯誤態 200(不 500、DB error 不外洩);查無 → 404。
  // 明細與狀態詞彙分開容錯(詞彙壞 → badge 降級中性灰,明細仍可看;同列表頁慣例)。
  // A10b:供應商選單(S3a)與明細、狀態詞彙三者**各自容錯** —— 供應商壞掉不該讓整頁看不了,
  // 但也**不得靜默**:空選單會讓員工以為「這家不存在」而去建重複的供應商,而供應商不可刪除
  // (`lib/supplier.ts:22-26` 逐字)⇒ 傳 `suppliersFailed` 下去顯示。
  let detail: AdminOrderDetail | null = null;
  let statusOptions: OrderStatusOption[] = [];
  let suppliers: SupplierOption[] = [];
  let suppliersFailed = false;
  let loadFailed = false;
  const [detailSettled, optionsSettled, suppliersSettled] = await Promise.allSettled([
    (async () => getAdminOrderRepository().findAdminOrderDetail(id))(),
    (async () => getAdminOrderStatusOptionsRepository().listOrderStatusOptions())(),
    (async () => listSuppliers())(),
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
  if (suppliersSettled.status === 'fulfilled') {
    suppliers = suppliersSettled.value;
  } else {
    console.error('[admin/orders/:id] 供應商清單載入失敗(採購選單只剩既有供應商)', suppliersSettled.reason);
    suppliersFailed = true;
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

      <ResultBanner code={resultCode} />

      {loadFailed || detail === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單明細載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <OrderDetail
          detail={detail}
          statusOptions={statusOptions}
          correctNoteId={correctNoteId}
          suppliers={suppliers}
          suppliersFailed={suppliersFailed}
        />
      )}
    </div>
  );
}
