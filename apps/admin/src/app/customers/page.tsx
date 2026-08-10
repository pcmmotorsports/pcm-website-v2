import type { AdminCustomerSummary, Paginated } from '@pcm/domain';
// 🔴 import 走**相對路徑**、不用 `@/`:根 `vitest.config.ts` 的 `@` alias 指向 **storefront** 的 src
//    ⇒ admin 檔案用 `@/` 在測試裡 resolve 不到、這頁就測不起來(先例逐字見
//    `app/orders/page.test.tsx` 檔頭;姊妹頁 `orders/refund-exceptions/page.tsx` 本來就是相對路徑)。
import { getAdminCustomerRepository } from '../../lib/customers/customer-repository';
import {
  parseCustomerListSearchParams,
  buildCustomerListHref,
  CUSTOMERS_PAGE_SIZE,
} from '../../lib/customers/customer-list-view';
import { CustomerFilterBar } from '../../components/customers/customer-filter-bar';
import { CustomersTable } from '../../components/customers/customers-table';
import { ListPagination } from '../../components/shared/list-pagination';
import { ResultBanner } from '../../components/orders/result-banner';

// M-4a 客戶管理第一片:後台客戶列表(server component、tier 篩選、server 端分頁)。
// force-dynamic:讀 searchParams + DB 查、不靜態預渲染。
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearch = await searchParams;
  const { filter, page } = parseCustomerListSearchParams(rawSearch);
  // 🔴 #365:儲值金 / 會員等級兩支 action 的失敗出口是**寫死**的 `redirect('/customers?r=…')`
  //    (`lib/customers/wallet-actions.ts:33`/`:39`、`tier-actions.ts:35`/`:41`)——
  //    也就是**所有** `denied` / `invalid` 都落在這一頁。這頁先前沒有橫幅 ⇒ 員工按下去之後
  //    畫面完全沒有交代(明細頁 `[id]/page.tsx:83` 早就有)。本片把重複欄位改成「解析失敗」,
  //    等於讓這條靜默路徑更容易被踩到 ⇒ 一併補上,不留知情不修。
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;
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

      <ResultBanner code={resultCode} />

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
