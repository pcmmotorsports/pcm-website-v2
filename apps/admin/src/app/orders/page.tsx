import type { AdminOrderSummary, OrderStatusOption, Paginated } from '@pcm/domain';
import {
  getAdminOrderRepository,
  getAdminOrderStatusOptionsRepository,
} from '@/lib/orders/order-repository';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  ORDERS_PAGE_SIZE,
} from '@/lib/orders/order-list-view';
import { OrderFilterBar } from '@/components/orders/order-filter-bar';
import { OrdersTable } from '@/components/orders/orders-table';
import { ResultBanner } from '@/components/orders/result-banner';
import { ListPagination } from '@/components/shared/list-pagination';

// M-4a 後台訂單列表(server component、workflow_status 主狀態+雙軸次要篩選、server 端分頁)。
// 讀 searchParams → 動態渲染;force-dynamic 確保不被靜態預渲染(避免 build 期執行 DB 查詢)。
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const { filter, page } = parseOrderListSearchParams(rawSearchParams);
  const resultCode = typeof rawSearchParams.r === 'string' ? rawSearchParams.r : undefined;
  const offset = (page - 1) * ORDERS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯 / migration 未 apply)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識,不把 DB error 原文冒到瀏覽器(避免洩漏)。
  //    訂單與狀態詞彙**分開容錯**:orders 失敗 = 整頁錯誤態;order_status_options 失敗 = 降級
  //    (badge 兜中性灰顯示 code、篩選下拉只剩「未設定」)、列表仍可用 —— 詞彙表壞不該擋營運看單。
  let result: Paginated<AdminOrderSummary> | null = null;
  let statusOptions: OrderStatusOption[] = [];
  let loadFailed = false;
  // async closure 包住:repo 建構(env 缺 requireEnv)是**同步 throw**,直接放進 allSettled 陣列
  // 會在陣列組建期炸出(繞過 allSettled)→ 500;包成 async IIFE 讓同步 throw 變 rejection 被接住。
  const [ordersSettled, optionsSettled] = await Promise.allSettled([
    (async () =>
      getAdminOrderRepository().listOrderSummariesForAdmin(filter, {
        limit: ORDERS_PAGE_SIZE,
        offset,
      }))(),
    (async () => getAdminOrderStatusOptionsRepository().listOrderStatusOptions())(),
  ]);
  if (ordersSettled.status === 'fulfilled') {
    result = ordersSettled.value;
  } else {
    console.error('[admin/orders] 訂單列表載入失敗', ordersSettled.reason);
    loadFailed = true;
  }
  if (optionsSettled.status === 'fulfilled') {
    statusOptions = optionsSettled.value;
  } else {
    console.error('[admin/orders] 訂單狀態詞彙載入失敗(badge 降級中性灰)', optionsSettled.reason);
  }

  const orders = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>訂單</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 筆</p>}
      </div>

      <ResultBanner code={resultCode} />
      <OrderFilterBar filter={filter} statusOptions={statusOptions} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          <OrdersTable
            orders={orders}
            statusOptions={statusOptions}
            itemStatusFiltered={filter.workflowStatus !== undefined}
            returnTo={buildOrderListHref(filter, page)}
          />
          <ListPagination
            page={page}
            total={total}
            pageSize={ORDERS_PAGE_SIZE}
            shownCount={orders.length}
            buildHref={(p) => buildOrderListHref(filter, p)}
            unit='筆'
          />
        </>
      )}
    </div>
  );
}
