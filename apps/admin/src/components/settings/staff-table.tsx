import type { StaffRow } from '../../lib/staff-repository';
import {
  AdminDataTable,
  type AdminColumn,
} from '../shared/admin-data-table';
import { StaffEditRow, type ManagePermission } from './staff-edit-row';

function StaffStatus({ active }: { active: boolean }) {
  return active ? (
    <span className='font-medium'>啟用中</span>
  ) : (
    <span className='text-muted-foreground font-medium'>已停用</span>
  );
}

// COLUMNS 從 const 變成函式:操作欄要把 canManage 傳下去。
// (server component,每次 render 重建一份的成本可忽略。)
const buildColumns = (
  canManage: ManagePermission,
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
    header: '操作',
    cell: (row) => <StaffEditRow staff={row} canManage={canManage} />,
  },
];

export function StaffTable({
  rows,
  canManage,
}: {
  rows: readonly StaffRow[];
  canManage: ManagePermission;
}) {
  return (
    <AdminDataTable
      rows={rows}
      columns={buildColumns(canManage)}
      getRowKey={(row) => row.id}
      emptyText='目前沒有員工。用下方表單新增。'
      renderMobileActions={(row) => (
        <StaffEditRow staff={row} canManage={canManage} />
      )}
    />
  );
}
