import Link from 'next/link';
import type { AdminOrderFilter } from '@pcm/domain';
import {
  buildOrderListHref,
  computePagination,
  type PaginationView,
} from '../../lib/orders/order-list-view';

// M-4a 訂單線第一片:server 端分頁控制(prev/next 為 <Link>、保留當前篩選;page=1 省略 query)。

const NAV = 'flex h-9 items-center rounded-md border px-4 text-sm';
const NAV_ENABLED = 'border-input hover:bg-accent hover:text-accent-foreground';
const NAV_DISABLED = 'border-input text-muted-foreground pointer-events-none opacity-50';

function PageLink({
  href,
  enabled,
  children,
}: {
  href: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return (
      <span className={`${NAV} ${NAV_DISABLED}`} aria-disabled='true'>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={`${NAV} ${NAV_ENABLED}`}>
      {children}
    </Link>
  );
}

export function OrderPagination({
  filter,
  page,
  total,
  pageSize,
  shownCount,
}: {
  filter: AdminOrderFilter;
  page: number;
  total: number;
  pageSize: number;
  /** 本頁實際顯示的列數(用於推導與表格一致的「第 X–Y 筆」;超界頁為 0) */
  shownCount: number;
}) {
  const view: PaginationView = computePagination(total, page, pageSize, shownCount);
  return (
    <div className='flex items-center justify-between gap-4'>
      <p className='text-muted-foreground text-sm'>
        {view.rangeEnd === 0
          ? `共 ${total} 筆`
          : `第 ${view.rangeStart}–${view.rangeEnd} 筆 / 共 ${total} 筆(第 ${view.currentPage}／${view.totalPages} 頁)`}
      </p>
      <div className='flex items-center gap-2'>
        <PageLink href={buildOrderListHref(filter, page - 1)} enabled={view.hasPrev}>
          上一頁
        </PageLink>
        <PageLink href={buildOrderListHref(filter, page + 1)} enabled={view.hasNext}>
          下一頁
        </PageLink>
      </div>
    </div>
  );
}
