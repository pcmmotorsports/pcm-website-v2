import Link from 'next/link';
import { AdminDataTable, type AdminColumn } from '../../../components/shared/admin-data-table';
import { SettingsResultBanner } from '../../../components/settings/settings-result-banner';
import { reopenIncidentAction, resolveIncidentAction } from '../../../lib/incidents/incident-actions';
import { listRecentIncidents, type IncidentRow } from '../../../lib/incidents/incident-repository';
import { incidentKindLabel, incidentSubjectIsOrder } from '../../../lib/incidents/incident-kind-label';
import {
  INCIDENT_FIELD,
  INCIDENT_RESULT_MESSAGES,
  INCIDENT_TEXT_MAX,
} from '../../../lib/incidents/incident-result-messages';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import { formatAuditActor } from '../../../lib/audit/audit-list-view';
import { listAllStaff, type StaffActor } from '../../../lib/staff';

export const dynamic = 'force-dynamic';

// page.tsx — 後台「事故紀錄」(稽核 P2-7;plan docs/plans/2026-09-15-admin-incident-list-plan.md §4-C)
//
// 🔴 **誰看得到:能登入後台的員工都看得到列表與錯誤全文**(Sean 2026-09-15「都可以看」)⇒ 本頁不查管理者身分,
//    登入閘由 `proxy.ts` 守(同「操作紀錄」頁)。錯誤訊息逐寫入點抽核過:沒有客人姓名 / email / 電話 / token。
// 🔴 **標記已處理 / 取消已處理**(plan docs/plans/2026-09-15-incident-mark-resolved-plan.md §4-B):
//    所有在職員工都能按(Sean Q1 乙);標記的說明選填(Q2 乙);取消要寫原因、系統已記了新的一筆就不讓取消(Q3 甲)。
//    按了已處理的那筆不再算進告警信與 LINE 早報(那兩邊只數未處理)。
//    ⚠️ 表單不是安全邊界 —— 擋得住的是 action 的 `authorizeAdminMutation` 與 DB 那層的在職閘。
// ⚠️ OD `pcm-524f` 稿 2026-09-15 四次都連不上 ⇒ 版面照「操作紀錄」頁(Sean Q2 甲:沒有稿就照它)。

/** 同「操作紀錄」頁的上限:一頁看得完、又不會讓人以為只有幾筆。 */
const LIMIT = 50;

type Props = { searchParams: Promise<{ all?: string | string[]; r?: string | string[] }> };

function IncidentSubjectCell({ row }: { row: IncidentRow }) {
  if (!incidentSubjectIsOrder(row.kind, row.subjectId)) return <span>—</span>;
  return (
    <Link href={`/orders/${row.subjectId}`} className='underline underline-offset-2'>
      查看訂單
    </Link>
  );
}

// 處理人:staff.id → 名字,沿用操作紀錄頁的 `formatAuditActor`(查無 ⇒ 原樣回 id,不壞頁)。
function IncidentStatusCell({ row, staff }: { row: IncidentRow; staff: readonly StaffActor[] }) {
  if (!row.resolvedAt) return <span>未處理</span>;
  return (
    <span>
      已處理 · {row.resolvedBy ? formatAuditActor(staff, row.resolvedBy) : '—'} · {formatOrderDateTime(row.resolvedAt)}
    </span>
  );
}

const INPUT_CLASS = 'border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-xs';
const BUTTON_CLASS = 'bg-muted text-foreground h-8 rounded-md px-3 text-xs font-medium';

function IncidentDetailCell({ row, showAll }: { row: IncidentRow; showAll: boolean }) {
  return (
    <details>
      <summary className='cursor-pointer text-sm'>{row.resolvedAt ? '展開錯誤訊息與處理紀錄' : '展開錯誤訊息 / 標記已處理'}</summary>
      <p className='text-muted-foreground mt-1 text-xs break-all whitespace-pre-wrap'>{row.detail}</p>
      {row.resolvedAt ? (
        <>
          {row.resolutionNote && (
            <p className='mt-2 text-xs break-all whitespace-pre-wrap'>處理說明:{row.resolutionNote}</p>
          )}
          <form action={reopenIncidentAction} className='mt-2 flex flex-wrap items-center gap-2'>
            <input type='hidden' name={INCIDENT_FIELD.id} value={row.id} />
            {showAll && <input type='hidden' name={INCIDENT_FIELD.view} value='all' />}
            <input
              type='text'
              name={INCIDENT_FIELD.reason}
              aria-label='取消原因'
              required
              maxLength={INCIDENT_TEXT_MAX}
              placeholder='為什麼要取消(必填)'
              className={INPUT_CLASS}
            />
            <button type='submit' className={BUTTON_CLASS}>取消已處理</button>
          </form>
        </>
      ) : (
        <>
          <form action={resolveIncidentAction} className='mt-2 flex flex-wrap items-center gap-2'>
            <input type='hidden' name={INCIDENT_FIELD.id} value={row.id} />
            {showAll && <input type='hidden' name={INCIDENT_FIELD.view} value='all' />}
            {/* 說明選填 ⇒ 不加 required;placeholder 寫明可以不填(同 note-delete-form 的理由) */}
            <input
              type='text'
              name={INCIDENT_FIELD.note}
              aria-label='處理說明'
              maxLength={INCIDENT_TEXT_MAX}
              placeholder='做了什麼(可以不填)'
              className={INPUT_CLASS}
            />
            <button type='submit' className={BUTTON_CLASS}>標記已處理</button>
          </form>
          <p className='text-muted-foreground mt-1 text-xs'>若問題尚未排除，部分類型的事故在再次發生時仍會新增紀錄。</p>
        </>
      )}
    </details>
  );
}

function columnsFor(showAll: boolean, staff: readonly StaffActor[]): ReadonlyArray<AdminColumn<IncidentRow>> {
  return [
    { key: 'at', header: '時間', cell: (row) => formatOrderDateTime(row.createdAt), mobile: 'meta' },
    { key: 'kind', header: '種類', cell: (row) => incidentKindLabel(row.kind), mobile: 'title' },
    { key: 'status', header: '狀態', cell: (row) => <IncidentStatusCell row={row} staff={staff} />, mobile: 'trailing' },
    { key: 'subject', header: '訂單', cell: (row) => <IncidentSubjectCell row={row} />, mobile: 'sub' },
    { key: 'detail', header: '錯誤訊息', cell: (row) => <IncidentDetailCell row={row} showAll={showAll} />, mobile: 'meta' },
  ];
}

function singleParam(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export default async function IncidentsPage({ searchParams }: Props) {
  const { all, r } = await searchParams;
  const showAll = all === '1';

  // 🔴 「讀取失敗」與「沒有事故」必須走兩條路(同「操作紀錄」頁的理由):repository 出錯是 throw,這裡不准 catch 成 []。
  let rows: IncidentRow[] = [];
  let loadFailed = false;
  // 名單含停用員工(處理人可能已離職);讀不到名單不擋頁面,處理人退回顯示 id。
  const [incidents, staff] = await Promise.allSettled([listRecentIncidents(LIMIT, !showAll), listAllStaff()]);
  if (incidents.status === 'fulfilled') {
    rows = incidents.value;
  } else {
    console.error('[admin/settings/incidents] 事故紀錄載入失敗', incidents.reason);
    loadFailed = true;
  }
  if (staff.status === 'rejected') {
    console.error('[admin/settings/incidents] 員工名單載入失敗,處理人改顯示 id', staff.reason);
  }
  const staffList = staff.status === 'fulfilled' ? staff.value : [];

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>事故紀錄</h1>
        <p className='text-muted-foreground text-sm'>
          這裡記錄系統發生異常、但訂單流程仍可繼續的情況。請逐筆確認並處理，完成後按「標記已處理」，該筆就不再計入告警。這裡只顯示最近 {LIMIT} 筆。
        </p>
      </div>

      {/* `?r=` 只用於查表,永不直接渲染成文字 */}
      <SettingsResultBanner code={singleParam(r)} messages={INCIDENT_RESULT_MESSAGES} />

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
          columns={columnsFor(showAll, staffList)}
          getRowKey={(row) => row.id}
          emptyText={
            showAll
              ? '目前沒有任何事故紀錄。'
              : '目前沒有未處理的事故。若系統發生異常但未中斷流程，會在這裡留下紀錄。'
          }
        />
      )}
    </div>
  );
}
