import Link from 'next/link';
import type { SupabaseAdminCouponRow } from '@pcm/adapters';

import { AdminDataTable, type AdminColumn } from '../shared/admin-data-table';
import {
  buildCouponListHref,
  couponBlocksPlaceholder,
  couponDiscountDisplay,
  couponEndsOnDisplay,
  couponUsageDisplay,
  nextSortDir,
  sortKeyToUrl,
  type CouponSort,
  type CouponSortKey,
  type CouponStatusParam,
} from '../../lib/coupons/coupon-list-view';

/**
 * 券列表(桌機表格 / 手機卡片,由 `AdminDataTable` 決定)。
 *
 * 形狀逐支對齊 `customers/customers-table.tsx`。
 * 🔴 **本表唯讀** —— 沒有任何會寫入的東西(建券 / 停用是之後那幾片)。
 */

function ariaSortFor(
  sort: CouponSort | undefined,
  key: CouponSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.ascending ? 'ascending' : 'descending';
}

function SortableHeader({
  label,
  sortKey,
  statusParam,
  sort,
}: {
  label: string;
  sortKey: CouponSortKey;
  statusParam: CouponStatusParam;
  sort: CouponSort | undefined;
}) {
  const active = sort?.key === sortKey;
  // 🔴 欄頭連結一律 `page=1` —— 排序換了還停在第 3 頁, 看到的是新排序的第 3 頁。
  const dir = nextSortDir(sort, sortKey);
  const href = buildCouponListHref(statusParam, 1, {
    key: sortKey,
    ascending: dir === 'asc',
  });
  return (
    <Link href={href} className={active ? 'underline' : 'hover:underline'}>
      {label}
      {/* 🔴 只有**正在排這一欄**時才有箭頭 —— 每一欄都掛一個灰箭頭的話,
          「目前照哪一欄排」就從畫面上消失了(而那正是員工要看的那一件事)。 */}
      {active ? (sort.ascending ? ' ↑' : ' ↓') : ''}
    </Link>
  );
}

const columns = (
  statusParam: CouponStatusParam,
  sort: CouponSort | undefined,
): ReadonlyArray<AdminColumn<SupabaseAdminCouponRow>> => [
  {
    key: 'code',
    header: '優惠碼',
    mobile: 'title',
    cell: (c) => <span className='font-mono'>{c.code}</span>,
  },
  {
    key: 'description',
    header: '說明',
    mobile: 'sub',
    className: 'text-muted-foreground',
    cell: (c) => c.description,
  },
  {
    key: 'discount',
    header: '折抵',
    mobile: 'meta',
    className: 'text-right tabular-nums',
    // 🔴 **不能一律用金額格式** —— 券有 fixed 與 percent 兩種, `10%` 會被印成 `NT$10`
    //    (關卡2 must-fix, 2026-08-29)。
    cell: (c) => couponDiscountDisplay(c.discount_type, c.discount_value),
  },
  {
    key: 'ends_on',
    ariaSort: ariaSortFor(sort, 'endsOn'),
    header: (
      <SortableHeader label='結束日' sortKey='endsOn' statusParam={statusParam} sort={sort} />
    ),
    className: 'text-muted-foreground',
    mobile: 'meta',
    // 🔴 NULL = 不設結束日 ⇒ 顯示「不限期」,**不得留白** ——
    //    留白在畫面上與【載入失敗】長得一模一樣(`customers-table.tsx:157-159` 逐字)。
    cell: (c) => couponEndsOnDisplay(c.ends_on),
  },
  {
    key: 'usage',
    ariaSort: ariaSortFor(sort, 'usedCount'),
    header: (
      <SortableHeader label='已用/總量' sortKey='usedCount' statusParam={statusParam} sort={sort} />
    ),
    className: 'text-right tabular-nums',
    mobile: 'meta',
    // 🔴 總量 NULL = 不限 ⇒ 同樣不得留白。
    cell: (c) => couponUsageDisplay(c.used_count, c.max_redemptions),
  },
  {
    key: 'blocks',
    header: '狀態',
    mobile: 'trailing',
    /**
     * ⏸️🛑 **這一格是【刻意做醜的佔位】, 不是定案。**
     *
     * Sean 2026-08-29 `Q1 = 甲`:狀態要顯示【自己算出來的】(可用/已過期/已用完/已停用)。
     * 資料層已經回一組原因(`coupon_level_blocks`)——
     * 🔴 **而畫面上那一組長什麼樣(三顆標籤? 「已停用 +2」? hover 看全部?)他沒有拍過(`#963`)。**
     * 📌 **一個好看的佔位會被當成定案** ⇒ 所以這裡是純文字、頓號串起來、沒有 badge 樣式。
     * ⇒ `#963` 要**給他看實體版本**(視覺 demo 由 Design session 產), 而不是文字選項。
     */
    cell: (c) => (
      <span className='text-muted-foreground text-xs'>
        {couponBlocksPlaceholder(c.coupon_level_blocks)}
      </span>
    ),
  },
  {
    key: 'creator',
    header: '建立者',
    mobile: 'meta',
    className: 'text-muted-foreground',
    // 🔴 顯示 `creator_label` 不是 `created_by` —— 後者是 slug(`^[a-z0-9_]{1,64}$`),
    //    直接印會在畫面上出現 `g_probe` 這種東西(關卡2 nit, `staff` 表 `:13-14`)。
    // ⚠️ 而 view 那顆是純量子查詢 ⇒ staff 查不到時是 NULL ⇒ 同樣不留白。
    cell: (c) => c.creator_label ?? '—',
  },
];

export function CouponsTable({
  coupons,
  statusParam,
  sort,
}: {
  coupons: readonly SupabaseAdminCouponRow[];
  statusParam: CouponStatusParam;
  sort: CouponSort | undefined;
}) {
  return (
    <AdminDataTable
      rows={coupons}
      columns={columns(statusParam, sort)}
      getRowKey={(c) => c.id}
      /**
       * 🔴 **空狀態要說得出原因** —— 而這一頁上線時表是空的
       *    ⇒ **這是 Sean 第一次打開會看到的唯一畫面**, 不是邊角情況。
       * ⚠️ 而「沒有符合條件」在【沒有套任何篩選】時是錯的:
       *    它會讓人以為是篩選擋掉了, 而其實是一張券都還沒建。
       */
      emptyText={
        statusParam === 'all'
          ? '尚未建立任何優惠券。'
          : '目前沒有符合條件的優惠券。'
      }
    />
  );
}
