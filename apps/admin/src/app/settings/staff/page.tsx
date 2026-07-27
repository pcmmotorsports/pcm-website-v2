import { StaffCreateForm } from '@/components/settings/staff-create-form';
import { StaffTable } from '@/components/settings/staff-table';
import {
  SettingsResultBanner,
} from '@/components/settings/settings-result-banner';
import {
  listStaffRows,
  type StaffRow,
} from '@/lib/staff-repository';
import { STAFF_RESULT_MESSAGES } from '@/lib/staff-result-messages';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StaffSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const resultCode = typeof raw.r === 'string' ? raw.r : undefined;

  let rows: StaffRow[] = [];
  let loadFailed = false;
  try {
    rows = await listStaffRows();
  } catch (error) {
    console.error('[admin/settings/staff] 員工名單載入失敗', error);
    loadFailed = true;
  }

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>員工管理</h1>
        <p className='text-muted-foreground text-sm'>
          新增員工、調整顯示名與管理者標記,或停用不再使用的員工。代碼建立後不可修改。
        </p>
      </div>

      <SettingsResultBanner
        code={resultCode}
        messages={STAFF_RESULT_MESSAGES}
      />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          員工名單載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <StaffTable rows={rows} />
      )}

      <StaffCreateForm />
    </div>
  );
}
