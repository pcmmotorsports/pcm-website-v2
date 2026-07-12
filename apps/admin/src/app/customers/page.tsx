import type { AdminCustomerSummary, Paginated } from '@pcm/domain';
import { getAdminCustomerRepository } from '@/lib/customers/customer-repository';
import {
  parseCustomerListSearchParams,
  buildCustomerListHref,
  CUSTOMERS_PAGE_SIZE,
} from '@/lib/customers/customer-list-view';
import { CustomerFilterBar } from '@/components/customers/customer-filter-bar';
import { CustomersTable } from '@/components/customers/customers-table';
import { ListPagination } from '@/components/shared/list-pagination';

// M-4a 客戶管理第一片:後台客戶列表(server component、tier 篩選、server 端分頁)。
// force-dynamic:讀 searchParams + DB 查、不靜態預渲染。
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { filter, page } = parseCustomerListSearchParams(await searchParams);
  const offset = (page - 1) * CUSTOMERS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);server log 留鑑識、DB error 不外洩。
  let result: Paginated<AdminCustomerSummary> | null = null;
  let loadFailed = false;
  try {
    result = await getAdminCustomerRepository().listCustomerSummariesForAdmin(filter, {
      limit: CUSTOMERS_PAGE_SIZE,
      offset,
    });
  } catch (error) {
    console.error('[admin/customers] 客戶列表載入失敗', error);
    loadFailed = true;
  }

  const customers = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>客戶</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 位</p>}
      </div>

      <CustomerFilterBar filter={filter} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          客戶列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          <CustomersTable customers={customers} />
          <ListPagination
            page={page}
            total={total}
            pageSize={CUSTOMERS_PAGE_SIZE}
            shownCount={customers.length}
            buildHref={(p) => buildCustomerListHref(filter, p)}
            unit='位'
          />
        </>
      )}
    </div>
  );
}
