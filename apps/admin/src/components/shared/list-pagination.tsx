import Link from 'next/link';
import { computePagination, type PaginationView } from '../../lib/shared/list-params';

// list-pagination.tsx — 後台列表通用 server 端分頁控制(訂單 / 客戶等共用)。
// prev/next 為 <Link>(href 由 caller 的 buildHref(page) 產、保留各自篩選);footer 由真實 shownCount 推導、不謊報。

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

export function ListPagination({
  page,
  total,
  pageSize,
  shownCount,
  buildHref,
  unit = '筆',
}: {
  page: number;
  total: number;
  pageSize: number;
  /** 本頁實際顯示的列數(推導與表格一致的「第 X–Y」;超界頁為 0) */
  shownCount: number;
  /** 給定頁碼 → 該頁連結(caller 帶入各自篩選);prev/next 用 */
  buildHref: (page: number) => string;
  /** 計數單位(「筆」訂單 / 「位」客戶) */
  unit?: string;
}) {
  const view: PaginationView = computePagination(total, page, pageSize, shownCount);
  return (
    <div className='flex items-center justify-between gap-4'>
      <p className='text-muted-foreground text-sm'>
        {view.rangeEnd === 0
          ? `共 ${total} ${unit}`
          : `第 ${view.rangeStart}–${view.rangeEnd} ${unit} / 共 ${total} ${unit}(第 ${view.currentPage}／${view.totalPages} 頁)`}
      </p>
      <div className='flex items-center gap-2'>
        <PageLink href={buildHref(page - 1)} enabled={view.hasPrev}>
          上一頁
        </PageLink>
        <PageLink href={buildHref(page + 1)} enabled={view.hasNext}>
          下一頁
        </PageLink>
      </div>
    </div>
  );
}
