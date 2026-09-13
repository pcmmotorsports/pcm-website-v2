import type { StaffRow } from '../../lib/staff-repository';
import {
  AdminDataTable,
  type AdminColumn,
} from '../shared/admin-data-table';
import { StaffEditRow, StaffRowActions, type ManagePermission } from './staff-edit-row';

function StaffStatus({ active }: { active: boolean }) {
  // 稿 v22 `.cap`:方角膠囊;已停用仍是【字】不是只有顏色(既有測試釘著)。
  return active ? (
    <span className='pcm-cap font-medium'>啟用中</span>
  ) : (
    <span className='pcm-cap text-muted-foreground font-medium'>已停用</span>
  );
}

// COLUMNS 從 const 變成函式:操作欄要把 canManage 傳下去。
// (server component,每次 render 重建一份的成本可忽略。)
const buildColumns = (
  canManage: ManagePermission,
  editHref: (id: string) => string,
): ReadonlyArray<AdminColumn<StaffRow>> => [
  {
    key: 'label',
    header: '顯示名',
    mobile: 'title',
    cell: (row) => (
      <span className={row.is_active ? undefined : 'line-through opacity-70'}>
        {row.label}
      </span>
    ),
  },
  {
    key: 'id',
    header: '代碼(id)',
    mobile: 'sub',
    cell: (row) => (
      <code className='text-muted-foreground font-mono text-xs'>{row.id}</code>
    ),
  },
  {
    key: 'role',
    header: '管理者',
    cell: (row) => (row.is_manager ? '是' : '否'),
  },
  {
    key: 'status',
    header: '狀態',
    mobile: 'trailing',
    cell: (row) => <StaffStatus active={row.is_active} />,
  },
  {
    key: 'actions',
    // 稿 v22:欄名「處理」,格子裡是小鈕(改名字 → 彈窗;停用 / 啟用)。整張表單不再塞在格子裡(C8,2026-09-14)。
    header: '處理',
    cell: (row) => <StaffRowActions staff={row} canManage={canManage} editHref={editHref(row.id)} />,
  },
];

export function StaffTable({
  rows,
  canManage,
  editHref = (id) => `/settings/staff?edit=${encodeURIComponent(id)}`,
}: {
  rows: readonly StaffRow[];
  canManage: ManagePermission;
  /** 「改名字」開哪個網址(預設本頁 `?edit=<id>`)。 */
  editHref?: (id: string) => string;
}) {
  return (
    <AdminDataTable
      rows={rows}
      columns={buildColumns(canManage, editHref)}
      getRowKey={(row) => row.id}
      emptyText='目前沒有員工。按右上角「＋ 新增員工」。'
      renderMobileActions={(row) => (
        <StaffEditRow staff={row} canManage={canManage} />
      )}
    />
  );
}
