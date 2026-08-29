import type { SupabaseAdminCouponRow } from '@pcm/adapters';

import { getAdminCouponRepository } from '../../lib/coupons/coupon-repository';
import {
  parseCouponListSearchParams,
  buildCouponListHref,
  COUPONS_PAGE_SIZE,
} from '../../lib/coupons/coupon-list-view';
import { CouponFilterBar } from '../../components/coupons/coupon-filter-bar';
import { CouponsTable } from '../../components/coupons/coupons-table';
import { ListPagination } from '../../components/shared/list-pagination';

/**
 * M-4b 券片 2b-2:後台券列表(server component、狀態篩選、server 端分頁)。
 *
 * 形狀逐支對齊 `app/customers/page.tsx`。
 * `force-dynamic`:讀 searchParams + DB 查、不靜態預渲染。
 *
 * 🛑 **本頁唯讀** —— 沒有建券 / 停用的入口(那是之後那幾片的 RPC + 畫面)。
 *
 * ⚠️ **那兩支 view 目前還沒 apply**(`20260829170000` 檔頭寫著「現在不要 apply」)
 *    ⇒ 真後台打開會走到下面那個「載入失敗」分支, **而那是預期的, 不是接線錯**。
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearch = await searchParams;
  const { filter, page, sort, statusParam } = parseCouponListSearchParams(rawSearch);
  const offset = (page - 1) * COUPONS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / view 未 apply / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識、DB error 不外洩瀏覽器。
  let items: SupabaseAdminCouponRow[] = [];
  let total = 0;
  let loadFailed = false;
  try {
    const result = await getAdminCouponRepository().listCouponsForAdmin(
      filter,
      { limit: COUPONS_PAGE_SIZE, offset },
      // 🔴 `undefined` = 沒指定 ⇒ adapter 走 `created_at DESC`(最新建的先看)。
      //    **換預設排序是行為改動** ⇒ 不在這一片。
      sort,
    );
    items = result.items;
    total = result.total;
  } catch (error) {
    console.error('[admin/coupons] 券列表載入失敗', error);
    loadFailed = true;
  }

  return (
    <div className='mx-auto space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>優惠券</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 張</p>}
      </div>

      <CouponFilterBar statusParam={statusParam} sort={sort} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          優惠券列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          {/* 🔴 `statusParam` 與 `sort` 傳進去是為了**建欄頭的排序連結**, 不是為了顯示。 */}
          <CouponsTable coupons={items} statusParam={statusParam} sort={sort} />
          <ListPagination
            page={page}
            total={total}
            pageSize={COUPONS_PAGE_SIZE}
            shownCount={items.length}
            buildHref={(p) =>
              // 🔴 翻頁要**帶著排序走** —— 少了它, 翻到第 2 頁會回到預設排序,
              //    而畫面上的箭頭還指在原來那一欄。
              buildCouponListHref(statusParam, p, sort)
            }
            unit='張'
          />
        </>
      )}
    </div>
  );
}
