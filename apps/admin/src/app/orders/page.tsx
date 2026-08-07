import type { AdminOrderSummary, Paginated } from '@pcm/domain';
import { getAdminOrderRepository } from '@/lib/orders/order-repository';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  ORDERS_PAGE_SIZE,
} from '@/lib/orders/order-list-view';
import { OrderFilterBar } from '@/components/orders/order-filter-bar';
import { OrdersTable } from '@/components/orders/orders-table';
import { ResultBanner } from '@/components/orders/result-banner';
import { ListPagination } from '@/components/shared/list-pagination';

// M-4a 後台訂單列表(server component、篩選 + server 端分頁)。
// A9w2:原本的主狀態軸 `workflow_status` 已隨九碼退場下架 ⇒ 篩選 = 付款/出貨(單選)+
// 來源/管道(多勾選)+ 單號搜尋(flag)。
// A11a-1(2026-08-06):列表的九碼 cell 與整單彙總 badge 已下架 ⇒ 本頁不再讀狀態詞彙。
// 讀 searchParams → 動態渲染;force-dynamic 確保不被靜態預渲染(避免 build 期執行 DB 查詢)。
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  // M-4b E10 A10c1 單號搜尋:§7.1 逐批啟用閘,U 片一律掛 env flag、預設 off。
  // 🔴 硬前置 = D0 migration 已 apply(orders.legacy_display_id)。未 apply 就開 ⇒
  //    PostgREST 42703 ⇒ 整個訂單列表進錯誤態(不只搜尋壞掉)。
  const orderNumberSearchEnabled = process.env.ADMIN_E10_ORDER_NUMBER_SEARCH === '1';
  const { filter, page } = parseOrderListSearchParams(rawSearchParams, {
    orderNumberSearchEnabled,
  });
  const resultCode = typeof rawSearchParams.r === 'string' ? rawSearchParams.r : undefined;
  const offset = (page - 1) * ORDERS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯 / migration 未 apply)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識,不把 DB error 原文冒到瀏覽器(避免洩漏)。
  //    🔴 **A11a-1(2026-08-06)**:狀態詞彙(`order_status_options`)那一路**整條移除** ——
  //    它在本頁的唯一用途是餵列表的九碼 cell 與整單彙總 badge,兩者已隨本片下架
  //    ⇒ 原本的「訂單與詞彙分開容錯」雙腿 `Promise.allSettled` 收斂成單一 try/catch。
  //    讀取鏈本體(port / adapter / repository getter)的處置見 plan §3.1 裁定:歸 A9w4c 後半。
  let result: Paginated<AdminOrderSummary> | null = null;
  let loadFailed = false;
  try {
    // repo 建構(env 缺 requireEnv)是**同步 throw** ⇒ 必須在 try 內建構,不能先建構再 await。
    result = await getAdminOrderRepository().listOrderSummariesForAdmin(filter, {
      limit: ORDERS_PAGE_SIZE,
      offset,
    });
  } catch (e) {
    console.error('[admin/orders] 訂單列表載入失敗', e);
    loadFailed = true;
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
      <OrderFilterBar filter={filter} orderNumberSearchEnabled={orderNumberSearchEnabled} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          <OrdersTable orders={orders} />
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
