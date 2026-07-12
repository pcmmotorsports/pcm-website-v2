import type { AdminOrderSummary, Paginated } from '@pcm/domain';
import { getAdminOrderRepository } from '@/lib/orders/order-repository';
import { parseOrderListSearchParams, ORDERS_PAGE_SIZE } from '@/lib/orders/order-list-view';
import { OrderFilterBar } from '@/components/orders/order-filter-bar';
import { OrdersTable } from '@/components/orders/orders-table';
import { OrderPagination } from '@/components/orders/order-pagination';

// M-4a 訂單線第一片:後台訂單列表(server component、雙軸+次要篩選、server 端分頁)。
// 讀 searchParams → 動態渲染;force-dynamic 確保不被靜態預渲染(避免 build 期執行 DB 查詢)。
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { filter, page } = parseOrderListSearchParams(await searchParams);
  const offset = (page - 1) * ORDERS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯 / 邊界)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識,不把 DB error 原文冒到瀏覽器(避免洩漏)。對齊會員側「caller try/catch、頁面不 500」慣例,
  //    但 admin 顯式區分「載入失敗」與「查無資料」(營運需知道是壞了還是真的沒單)。
  let result: Paginated<AdminOrderSummary> | null = null;
  let loadFailed = false;
  try {
    result = await getAdminOrderRepository().listOrderSummariesForAdmin(filter, {
      limit: ORDERS_PAGE_SIZE,
      offset,
    });
  } catch (error) {
    console.error('[admin/orders] 訂單列表載入失敗', error);
    loadFailed = true;
  }

  const orders = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>訂單</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 筆</p>}
      </div>

      <OrderFilterBar filter={filter} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          <OrdersTable orders={orders} />
          <OrderPagination
            filter={filter}
            page={page}
            total={total}
            pageSize={ORDERS_PAGE_SIZE}
            shownCount={orders.length}
          />
        </>
      )}
    </div>
  );
}
