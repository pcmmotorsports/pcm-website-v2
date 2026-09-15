import Link from 'next/link';
import { AdminDataTable, type AdminColumn } from '../../../components/shared/admin-data-table';
import { listRecentIncidents, type IncidentRow } from '../../../lib/incidents/incident-repository';
import { incidentKindLabel, incidentSubjectIsOrder } from '../../../lib/incidents/incident-kind-label';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';

export const dynamic = 'force-dynamic';

// page.tsx — 後台「事故紀錄」(稽核 P2-7;plan docs/plans/2026-09-15-admin-incident-list-plan.md §4-C)
//
// 🔴 **誰看得到:能登入後台的員工都看得到列表與錯誤全文**(Sean 2026-09-15「都可以看」)⇒ 本頁不查管理者身分,
//    登入閘由 `proxy.ts` 守(同「操作紀錄」頁)。錯誤訊息逐寫入點抽核過:沒有客人姓名 / email / 電話 / token。
// 🔴 **不做「標記已處理」**:寫 `resolved_at` 會讓每天兩次的告警數字跟著變少(告警只數未處理),要另外拍板。
// ⚠️ OD `pcm-524f` 稿 2026-09-15 四次都連不上 ⇒ 版面照「操作紀錄」頁(Sean Q2 甲:沒有稿就照它)。

/** 同「操作紀錄」頁的上限:一頁看得完、又不會讓人以為只有幾筆。 */
const LIMIT = 50;

type Props = { searchParams: Promise<{ all?: string | string[] }> };

function IncidentSubjectCell({ row }: { row: IncidentRow }) {
  if (!incidentSubjectIsOrder(row.kind, row.subjectId)) return <span>—</span>;
  return (
    <Link href={`/orders/${row.subjectId}`} className='underline underline-offset-2'>
      查看訂單
    </Link>
  );
}

function IncidentDetailCell({ row }: { row: IncidentRow }) {
  return (
    <details>
      <summary className='cursor-pointer text-sm'>展開錯誤訊息</summary>
      <p className='text-muted-foreground mt-1 text-xs break-all whitespace-pre-wrap'>{row.detail}</p>
    </details>
  );
}

const COLUMNS: ReadonlyArray<AdminColumn<IncidentRow>> = [
  { key: 'at', header: '時間', cell: (row) => formatOrderDateTime(row.createdAt), mobile: 'meta' },
  { key: 'kind', header: '種類', cell: (row) => incidentKindLabel(row.kind), mobile: 'title' },
  { key: 'status', header: '狀態', cell: (row) => (row.resolvedAt ? '已處理' : '未處理'), mobile: 'trailing' },
  { key: 'subject', header: '訂單', cell: (row) => <IncidentSubjectCell row={row} />, mobile: 'sub' },
  { key: 'detail', header: '錯誤訊息', cell: (row) => <IncidentDetailCell row={row} />, mobile: 'meta' },
];

export default async function IncidentsPage({ searchParams }: Props) {
  const { all } = await searchParams;
  const showAll = all === '1';

  // 🔴 「讀取失敗」與「沒有事故」必須走兩條路(同「操作紀錄」頁的理由):repository 出錯是 throw,這裡不准 catch 成 []。
  let rows: IncidentRow[] = [];
  let loadFailed = false;
  try {
    rows = await listRecentIncidents(LIMIT, !showAll);
  } catch (error) {
    console.error('[admin/settings/incidents] 事故紀錄載入失敗', error);
    loadFailed = true;
  }

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>事故紀錄</h1>
        <p className='text-muted-foreground text-sm'>
          系統把某個失敗吞下來、沒有讓訂單流程中斷的時候,會在這裡留一筆。每一筆都需要有人看過、處理。
          這裡只顯示最近 {LIMIT} 筆。
        </p>
      </div>

      <nav className='flex gap-3 text-sm' aria-label='事故範圍'>
        <Link
          href='/settings/incidents'
          aria-current={showAll ? undefined : 'page'}
          className={showAll ? 'text-muted-foreground' : 'font-semibold underline underline-offset-2'}
        >
          未處理
        </Link>
        <Link
          href='/settings/incidents?all=1'
          aria-current={showAll ? 'page' : undefined}
          className={showAll ? 'font-semibold underline underline-offset-2' : 'text-muted-foreground'}
        >
          全部
        </Link>
      </nav>

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          事故紀錄載入失敗,請稍後再試或聯絡系統維護。這不代表沒有事故。
        </div>
      ) : (
        <AdminDataTable
          rows={rows}
          columns={COLUMNS}
          getRowKey={(row) => row.id}
          emptyText={
            showAll
              ? '目前沒有任何事故紀錄。'
              : '目前沒有未處理的事故。系統吞下失敗時,這裡就會出現一筆。'
          }
        />
      )}
    </div>
  );
}
