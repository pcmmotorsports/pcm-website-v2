import type { AdminCustomerListResult } from '@pcm/domain';
// 🔴 import 走**相對路徑**、不用 `@/`:根 `vitest.config.ts` 的 `@` alias 指向 **storefront** 的 src
//    ⇒ admin 檔案用 `@/` 在測試裡 resolve 不到、這頁就測不起來(先例逐字見
//    `app/orders/page.test.tsx` 檔頭;姊妹頁 `orders/refund-exceptions/page.tsx` 本來就是相對路徑)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { getAdminCustomerRepository } from '../../lib/customers/customer-repository';
import {
  parseCustomerListSearchParams,
  buildCustomerListHref,
  CUSTOMERS_PAGE_SIZE,
} from '../../lib/customers/customer-list-view';
import { CustomerFilterBar } from '../../components/customers/customer-filter-bar';
import { CustomerKeywordSearch } from '../../components/customers/customer-keyword-search';
import {
  readCustomerKeywordCookie,
  CUSTOMER_KEYWORD_COOKIE,
} from '../../lib/customers/customer-keyword-cookie';
import { CustomersTable } from '../../components/customers/customers-table';
import { ListPagination } from '../../components/shared/list-pagination';
import { ResultBanner } from '../../components/orders/result-banner';
import { cookies } from 'next/headers';

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
  const { filter, page, sort } = parseCustomerListSearchParams(rawSearch);
  // 🔴 #365:儲值金 / 會員等級兩支 action 的失敗出口是**寫死**的 `redirect('/customers?r=…')`
  //    (`lib/customers/wallet-actions.ts:33`/`:39`、`tier-actions.ts:35`/`:41`)——
  //    也就是**所有** `denied` / `invalid` 都落在這一頁。這頁先前沒有橫幅 ⇒ 員工按下去之後
  //    畫面完全沒有交代(明細頁 `[id]/page.tsx:83` 早就有)。本片把重複欄位改成「解析失敗」,
  //    等於讓這條靜默路徑更容易被踩到 ⇒ 一併補上,不留知情不修。
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;
  const offset = (page - 1) * CUSTOMERS_PAGE_SIZE;

  // 🔴 `#525` 搜尋詞來自 **httpOnly cookie**、不是 URL —— 搜尋詞是客人姓名/Email/電話(PII),
  //    進 URL 就會落進 access log / CDN log / 瀏覽器歷史 / Referer。
  //    ⚠️ 代價寫在明處:**cookie 是跨分頁共用的**(同一瀏覽器所有分頁看到同一個搜尋)。
  //    緩解不是把它變成 URL,是**畫面上一定看得到 chip + ✕**(`CustomerKeywordSearch` 檔頭)。
  //    讀不出來一律 `null`(fail-closed:寧可不搜,不要拿半個值去查)。
  const keyword = readCustomerKeywordCookie(
    (await cookies()).get(CUSTOMER_KEYWORD_COOKIE)?.value,
  );

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);server log 留鑑識、DB error 不外洩。
  let result: AdminCustomerListResult | null = null;
  let loadFailed = false;
  try {
    result = await getAdminCustomerRepository().listCustomerSummariesForAdmin(
      // 🔴 `keyword` 只在**有值時**才放進 filter —— `undefined` 與 `''` 在 adapter 是兩條路
      //    (`undefined` = 不打 RPC;`''` 會打一次必然全空的 RPC)。
      keyword === null ? filter : { ...filter, keyword },
      { limit: CUSTOMERS_PAGE_SIZE, offset },
      // 🔴 `undefined` = 沒指定 ⇒ adapter 走既有的 `created_at DESC`。
      //    **換預設排序是行為改動**(那是 Sean 每天打開先看到誰)⇒ 不在這一片。
      sort,
    );
  } catch (error) {
    console.error('[admin/customers] 客戶列表載入失敗', error);
    loadFailed = true;
  }

  const customers = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='mx-auto space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>客戶</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 位</p>}
      </div>

      <ResultBanner code={resultCode} />

      <CustomerKeywordSearch
        keyword={keyword}
        listHref={buildCustomerListHref(filter, 1)}
        matchCount={result?.keywordMatchCount ?? null}
        // 🔴 載入失敗時 `result` 是 null ⇒ `false`。**這是對的**:
        //    查都沒查成功,不該對員工說「結果太多」(那會讓他以為搜尋有效、只是太寬)。
        truncated={result?.keywordTruncated ?? false}
      />

      <CustomerFilterBar filter={filter} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          客戶列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          {/* 🔴 `filter` 與 `sort` 傳進去是為了**建欄頭的排序連結**,不是為了顯示。
              欄頭連結一律 `page=1`(排序換了還停在第 3 頁 ⇒ 看到的是新排序的第 3 頁)。 */}
          <CustomersTable customers={customers} filter={filter} sort={sort} />
          <ListPagination
            page={page}
            total={total}
            pageSize={CUSTOMERS_PAGE_SIZE}
            shownCount={customers.length}
            buildHref={(p) =>
              // 🔴 翻頁要**帶著排序走** —— 少了它,翻到第 2 頁會回到預設排序,
              //    而畫面上的箭頭還指在原來那一欄。
              buildCustomerListHref(filter, p, sort)
            }
            unit='位'
          />
        </>
      )}
    </div>
  );
}
