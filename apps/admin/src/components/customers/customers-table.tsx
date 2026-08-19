import Link from 'next/link';
import type {
  AdminCustomerSummary,
  AdminCustomerFilter,
  AdminCustomerSort,
  AdminCustomerSortKey,
} from '@pcm/domain';
import {
  TIER_LABEL,
  formatCustomerDate,
  customerEmailDisplay,
  buildCustomerSortHref,
} from '../../lib/customers/customer-list-view';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { AdminDataTable, type AdminColumn } from '../shared/admin-data-table';

// M-4a 客戶管理第一片:輕量客戶列表 table(server-render);明細-a 起姓名連 /customers/[id]。
// 🔴 列表不顯 wallet/儲值(儲值金顯示在明細頁=Sean 07-16 拍板 admin 可顯);tier=會員等級標籤(非價格)。phone 可 null → '—'。
// E11-1:改用共用 <AdminDataTable>(積木第一片的驗證對象)。桌機欄位/樣式/連結行為與改前逐欄等價;
//   新增的是手機版卡片(§4-1 規範,改前手機只能橫捲 5 欄表格)。

/**
 * 可排序欄頭 —— **一個 `<Link>`,零 JS、零 client component**(2026-08-19;主視窗裁「甲」)。
 *
 * 🔴 **為什麼不是「下拉 + `auto-apply-submit`」**:那顆元件解的是「**有一顆送出鈕要按**」,
 *    而欄頭連結**沒有那顆鈕**。主視窗原本的邊界是從篩選那片繼承來的,而它自己認了
 *    「**我把一個解法搬到一個沒有那個病的地方**」。
 * 🔴 **`aria-sort` 掛在 `<th>` 上、不是掛在連結上** —— 它描述的是**這一欄**的狀態,不是那個連結。
 *    ⚠️ 而本表的 `<th>` 由 `AdminDataTable` 產 ⇒ 我沒有辦法在這裡掛它 ⇒ **目前沒有 `aria-sort`**。
 *    🔴🔴 **而它【不是一行】,這半我原本漏了**(W6 `W6-06x` 補正):
 *       `aria-sort` 的值是 `ascending | descending | none`,**它要知道「現在是哪一欄、哪個方向」**
 *       —— 那是 `AdminDataTable` **今天完全不知道的概念**。
 *       ⇒ 補它 = **共用元件要開始認識「排序狀態」這件事**,不是加一個屬性。
 *       ⇒ 這句寫在這裡是為了**不讓下一個人以為順手就能補** —— 估錯之後就又不做了。
 * 📌 箭頭用文字(`↑`/`↓`)不是圖示:**只有圖示的排序狀態,螢幕閱讀器讀不出來**,
 *    而在補上 `aria-sort` 之前,那個字元是唯一講得出方向的東西。
 */
/**
 * 這一欄的 `aria-sort`。**三個可排序的欄都要給** —— 沒排的那兩欄給 `'none'`,
 * 那對讀屏的意思正是「這一欄可以排序,只是現在沒排」,而那是真的。
 */
function ariaSortFor(
  sort: AdminCustomerSort | undefined,
  key: AdminCustomerSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.ascending ? 'ascending' : 'descending';
}

function SortableHeader({
  label,
  sortKey,
  filter,
  sort,
}: {
  label: string;
  sortKey: AdminCustomerSortKey;
  filter: AdminCustomerFilter;
  sort: AdminCustomerSort | undefined;
}) {
  const active = sort?.key === sortKey;
  return (
    <Link
      href={buildCustomerSortHref(filter, sort, sortKey)}
      className={active ? 'underline' : 'hover:underline'}
    >
      {label}
      {/* 🔴 只有**正在排這一欄**時才有箭頭 —— 每一欄都掛一個灰箭頭的話,
          「目前照哪一欄排」就從畫面上消失了(而那正是員工要看的那一件事)。 */}
      {active ? (sort.ascending ? ' ↑' : ' ↓') : ''}
    </Link>
  );
}

const columns = (
  filter: AdminCustomerFilter,
  sort: AdminCustomerSort | undefined,
): ReadonlyArray<AdminColumn<AdminCustomerSummary>> => [
  {
    key: 'name',
    header: '姓名',
    className: 'font-medium',
    mobile: 'title',
    cell: (c) => (
      <Link href={`/customers/${c.id}`} className='hover:underline'>
        {c.name}
      </Link>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    className: 'text-muted-foreground',
    mobile: 'sub',
    cell: (c) => customerEmailDisplay(c.email),
  },
  {
    key: 'phone',
    header: '電話',
    className: 'text-muted-foreground',
    mobile: 'sub',
    // null → 桌機 td 顯「—」(與改前 `phone ?? '—'` 等價)、手機卡片略過該欄。
    cell: (c) => c.phone,
  },
  {
    key: 'tier',
    header: '會員等級',
    mobile: 'trailing',
    cell: (c) => (
      <span className='bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
        {TIER_LABEL[c.tier]}
      </span>
    ),
  },
  // ── 客戶頁三欄(Sean 2026-08-16 指定的標籤字面)────────────────────────────
  //
  // 🔴 三欄共用一條口徑:**已取消的訂單不算**、不扣退款(主視窗 2026-08-16 兩次裁定)。
  //    ⚠️ 標籤旁**沒有**寫「不含已取消」—— 那是文案題,本片沒做;
  //       口徑寫在 view 的 `COMMENT` 與 `AdminCustomerSummary` 的 docstring 裡。
  {
    key: 'activeOrderCount',
    // 🔴 排序中的欄給方向，沒排的給 'none'（= 可排序但現在沒排）；
    //    不可排序的那五欄一律【省略】—— 見 AdminColumn.ariaSort 的檔頭。
    ariaSort: ariaSortFor(sort, 'orders'),
    header: (
      <SortableHeader label='訂單數' sortKey='orders' filter={filter} sort={sort} />
    ),
    className: 'text-right tabular-nums',
    mobile: 'meta',
    cell: (c) => c.activeOrderCount,
  },
  {
    key: 'activeSpendTotal',
    // 🔴 排序中的欄給方向，沒排的給 'none'（= 可排序但現在沒排）；
    //    不可排序的那五欄一律【省略】—— 見 AdminColumn.ariaSort 的檔頭。
    ariaSort: ariaSortFor(sort, 'spend'),
    header: (
      <SortableHeader label='消費金額' sortKey='spend' filter={filter} sort={sort} />
    ),
    className: 'text-right tabular-nums',
    mobile: 'meta',
    // 整數元位(禁浮點)—— 沿用訂單線既有的格式化,不自己拼字串。
    cell: (c) => formatOrderAmount(c.activeSpendTotal),
  },
  {
    key: 'lastActiveOrderedAt',
    // 🔴 排序中的欄給方向，沒排的給 'none'（= 可排序但現在沒排）；
    //    不可排序的那五欄一律【省略】—— 見 AdminColumn.ariaSort 的檔頭。
    ariaSort: ariaSortFor(sort, 'lastOrder'),
    header: (
      <SortableHeader label='最後下單' sortKey='lastOrder' filter={filter} sort={sort} />
    ),
    className: 'text-muted-foreground',
    mobile: 'meta',
    // 🔴 **零訂單是 `null`,必須顯示成「從未下單」,不得留白** ——
    //    留白在畫面上與「載入失敗」長得一模一樣(`AdminCustomerSummary` docstring 逐字)。
    cell: (c) =>
      c.lastActiveOrderedAt === null ? '從未下單' : formatCustomerDate(c.lastActiveOrderedAt),
  },
  {
    key: 'createdAt',
    header: '註冊日期',
    className: 'text-muted-foreground',
    mobile: 'meta',
    cell: (c) => formatCustomerDate(c.createdAt),
  },
];

export function CustomersTable({
  customers,
  filter,
  sort,
}: {
  customers: AdminCustomerSummary[];
  filter: AdminCustomerFilter;
  sort: AdminCustomerSort | undefined;
}) {
  return (
    <AdminDataTable
      rows={customers}
      columns={columns(filter, sort)}
      getRowKey={(c) => c.id}
      emptyText='目前沒有符合條件的客戶。'
    />
  );
}
