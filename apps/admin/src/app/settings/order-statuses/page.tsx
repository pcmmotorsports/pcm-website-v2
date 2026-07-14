import type { OrderStatusOption } from '@pcm/domain';
import { getAdminOrderStatusOptionsRepository } from '@/lib/orders/order-repository';
import { StatusOptionEditRow } from '@/components/settings/status-option-edit-row';
import { SettingsResultBanner } from '@/components/settings/settings-result-banner';

// M-4a Slice D-3 訂單狀態選項設定頁(server component、force-dynamic;SSO 閘後 admin-only)。
// 編輯既有 order_status_options(標籤/底色/字色/排序/啟用);code 不可改、停用=soft-delete。新增留 D-3b。
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrderStatusesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const resultCode = typeof raw.r === 'string' ? raw.r : undefined;

  // 讀取失敗 → 錯誤態、頁面仍 200(不 500);server log 留鑑識,不把 DB error 冒到瀏覽器。
  let options: OrderStatusOption[] = [];
  let loadFailed = false;
  try {
    options = await getAdminOrderStatusOptionsRepository().listOrderStatusOptions();
  } catch (err) {
    console.error('[admin/settings] 狀態選項載入失敗', err);
    loadFailed = true;
  }

  return (
    <div className='mx-auto max-w-4xl space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>訂單狀態選項</h1>
        <p className='text-muted-foreground text-sm'>
          設定訂單處理狀態的標籤、底色、字色、排序與啟用。代碼(code)為系統識別碼、不可修改;停用不會刪除,既有訂單仍可顯示該狀態。
        </p>
      </div>

      <SettingsResultBanner code={resultCode} />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          狀態選項載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : options.length === 0 ? (
        <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
          目前沒有狀態選項。
        </div>
      ) : (
        <div className='overflow-hidden rounded-lg border bg-card'>
          <div className='text-muted-foreground flex flex-wrap items-center gap-3 border-b px-3 py-2 text-xs font-medium'>
            <span className='w-24 shrink-0'>預覽</span>
            <span className='w-36 shrink-0'>代碼(不可改)</span>
            <span>標籤 · 底色 · 字色 · 排序 · 啟用</span>
          </div>
          {options.map((o) => (
            <StatusOptionEditRow key={o.code} option={o} />
          ))}
        </div>
      )}
    </div>
  );
}
