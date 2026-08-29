import Link from 'next/link';
import type { SupabaseAdminCouponRow } from '@pcm/adapters';

import { AdminDataTable, type AdminColumn } from '../shared/admin-data-table';
import {
  buildCouponListHref,
  couponBlocksDisplay,
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
    // 🔴 Sean 2026-08-29 逐字「然後文字都要對齊標題左側,不要一下左一下右」
    //    ⇒ 拿掉 `text-right`。**`tabular-nums` 留著** —— 它管的是【數字等寬】,
    //    與靠哪邊無關;拿掉它會讓上下兩列的數字對不齊,而那不是他要求的。
    // ⚠️ 成因不是共用元件:`admin-data-table.tsx:147` 的表頭只吃 `col.alignRight`,
    //    `:165` 的內容格才吃 `col.className` ⇒ 用 className 給 `text-right`
    //    只會移動【內容】,標題留在原地 ⇒ 一欄之內兩邊不同側。
    //    ⇒ 真要靠右, 正確寫法是 `alignRight: true`(它兩邊一起移)。
    className: 'tabular-nums',
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
    // 🔴 Sean 2026-08-29 逐字「然後文字都要對齊標題左側,不要一下左一下右」
    //    ⇒ 拿掉 `text-right`。**`tabular-nums` 留著** —— 它管的是【數字等寬】,
    //    與靠哪邊無關;拿掉它會讓上下兩列的數字對不齊,而那不是他要求的。
    // ⚠️ 成因不是共用元件:`admin-data-table.tsx:147` 的表頭只吃 `col.alignRight`,
    //    `:165` 的內容格才吃 `col.className` ⇒ 用 className 給 `text-right`
    //    只會移動【內容】,標題留在原地 ⇒ 一欄之內兩邊不同側。
    //    ⇒ 真要靠右, 正確寫法是 `alignRight: true`(它兩邊一起移)。
    className: 'tabular-nums',
    mobile: 'meta',
    // 🔴 總量 NULL = 不限 ⇒ 同樣不得留白。
    cell: (c) => couponUsageDisplay(c.used_count, c.max_redemptions),
  },
  {
    key: 'blocks',
    header: '狀態',
    mobile: 'trailing',
    /**
     * **Sean 2026-08-29 拍【乙】(逐字 `B`):一顆標籤 + 「+N」。**
     * 他是看三張實體截圖挑的(甲 三顆並排 / 乙 一顆 +N / 丙 一句話)⇒ 甲丙作廢。
     *
     * 🔴 **`+N` 那個數字不是裝飾** —— 第一版「單一狀態」被駁倒的理由是
     *    **答不出「還差幾關」**(同時停用+過期的券只顯示「已停用」⇒ 員工按了啟用它還是不能用)。
     *    ⇒ 乙 用 `+N` 答那一格:**數量在, 只是名字不在。**
     *    ⇒ ⚠️ 所以 `+N` **不得省略**, 也不得在只有一個原因時印 `+0`(那會讓 0 看起來像一個原因)。
     *
     * 🔴 標籤樣式沿用本後台既有先例(`customers-table.tsx:110` 的會員等級),
     *    **不自創第二種小標籤**。
     */
    cell: (c) => {
      const b = couponBlocksDisplay(c.coupon_level_blocks);
      // 🔴 沒有擋住的理由 ⇒ `'—'`,**不要寫「可用」** ——
      //    這一頁手上沒有客人與購物車,答不出每人上限 / 最低消費 / 會員價衝突。
      //    ⚠️ 空陣列要顯示什麼字 Sean 這一輪【沒有拍】,不要順手改。
      if (b === null) return <span className='text-muted-foreground text-xs'>—</span>;
      return (
        <span className='inline-flex items-center gap-1'>
          <span className='bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
            {b.label}
          </span>
          {b.more > 0 && (
            <span className='text-muted-foreground text-xs tabular-nums'>+{b.more}</span>
          )}
        </span>
      );
    },
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
