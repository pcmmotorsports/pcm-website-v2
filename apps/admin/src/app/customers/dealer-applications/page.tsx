// 後台「經銷商申請」列表(B2B 計畫 §9.5,片 D1)。
// 🔴 入口不放側欄:Sean 2026-09-14 拍板側欄維持 6 項(project_0914-sean-five-rulings-sidebar-audit-cost-default-filters),
//    軌上數字只有 W1-077 Q14 定的三格(lib/layout/sidebar-counts.ts 檔頭)⇒ 改放客戶頁上方一行「經銷商申請：N 件待審核」。
import Link from 'next/link';
import { AdminDataTable, type AdminColumn } from '@/components/shared/admin-data-table';
import { formatCustomerDate } from '@/lib/customers/customer-list-view';
import {
  DEALER_APP_FILTERS,
  DEALER_APP_STATUS_LABEL,
  dealerAppListHref,
  parseDealerAppStatusFilter,
  type DealerApplicationRow,
} from '@/lib/customers/dealer-application-view';
import { DEALER_APP_LIST_LIMIT, loadDealerApplications } from '@/lib/customers/dealer-application-repository';

export const dynamic = 'force-dynamic';

const columns: AdminColumn<DealerApplicationRow>[] = [
  {
    key: 'company',
    header: '公司名稱',
    mobile: 'title',
    cell: (r) => (
      <Link href={`/customers/dealer-applications/${r.id}`} className='hover:underline'>
        {r.company_name}
      </Link>
    ),
  },
  { key: 'status', header: '狀態', mobile: 'trailing', cell: (r) => DEALER_APP_STATUS_LABEL[r.status] },
  { key: 'createdAt', header: '申請日期', className: 'text-muted-foreground', mobile: 'meta', cell: (r) => formatCustomerDate(r.created_at) },
  { key: 'taxId', header: '統編', className: 'tabular-nums', mobile: 'sub', cell: (r) => r.tax_id },
  { key: 'region', header: '營業地區', mobile: 'meta', cell: (r) => r.region },
  { key: 'contact', header: '聯絡人', mobile: 'meta', cell: (r) => r.contact_name },
];

export default async function DealerApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = parseDealerAppStatusFilter(sp.status);
  const result = await loadDealerApplications(filter);
  const filterLabel = DEALER_APP_FILTERS.find((f) => f.value === filter)?.label ?? '';

  return (
    <div className='pcm-plist mx-auto space-y-3'>
      <div className='pcm-head'>
        <h1>經銷商申請</h1>
        {result.ok && result.rows.length < DEALER_APP_LIST_LIMIT && <p className='pcm-count'>共 {result.rows.length} 筆</p>}
        <span className='pcm-sp' />
        <Link href='/customers' className='hover:underline'>
          回客戶列表
        </Link>
      </div>

      <nav className='flex flex-wrap gap-2' aria-label='依狀態篩選'>
        {DEALER_APP_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={dealerAppListHref(f.value)}
            aria-current={f.value === filter ? 'page' : undefined}
            className={f.value === filter ? 'rounded-md border px-3 py-1 font-medium' : 'rounded-md px-3 py-1 hover:underline'}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          經銷商申請載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </div>
      ) : (
        <>
          <AdminDataTable
            rows={result.rows}
            columns={columns}
            getRowKey={(r) => r.id}
            emptyText={filter === 'all' ? '目前沒有任何經銷商申請。' : `目前沒有「${filterLabel}」的申請。`}
          />
          {result.rows.length >= DEALER_APP_LIST_LIMIT && (
            <p className='pcm-note2'>只顯示最新的 {DEALER_APP_LIST_LIMIT} 筆。</p>
          )}
        </>
      )}
    </div>
  );
}
