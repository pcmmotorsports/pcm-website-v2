// 後台「價格變動」清單(地圖 M-5-08;主視窗 2026-09-29 派)。只讀。
// 資料 = product_price_changes(規格一般價真的變時由 trigger 記一筆, 20260929020000)。
// 預設最近 7 天、新到舊;可依品牌、漲 / 跌篩選;點品名進商品頁。入口在商品列表工具列(側欄維持 Sean 09-13 的 6 項)。
import Link from 'next/link';
import { formatOrderAmount } from '../../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import {
  PRICE_CHANGE_LIMIT,
  listBrandOptions,
  listPriceChanges,
  parsePriceChangeFilter,
  type PriceChangeListRow,
  type PriceChangeSearchParams,
} from '../../../lib/products/price-change-repository';
import { ADMIN_INPUT_CLASS } from '../../../components/shared/admin-form';

export const dynamic = 'force-dynamic';

const TH = 'border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground';
const TD = 'border-b px-3 py-2 text-sm align-top';
function priceText(p: number | null): string {
  return p === null ? '沒有價格' : `NT$ ${formatOrderAmount(p)}`;
}

function pctText(pct: number | null): string {
  if (pct === null) return '—';
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

export default async function PriceChangesPage({ searchParams }: { searchParams: Promise<PriceChangeSearchParams> }) {
  const filter = parsePriceChangeFilter(await searchParams);
  const filtered = filter.brandId !== undefined || filter.direction !== undefined;
  let rows: PriceChangeListRow[] = [];
  let truncated = false;
  let loadFailed = false;
  let brands: { id: string; name: string }[] = [];
  const [changes, brandOptions] = await Promise.allSettled([listPriceChanges(filter), listBrandOptions()]);
  if (changes.status === 'fulfilled') ({ rows, truncated } = changes.value);
  else {
    console.error('[admin/products/price-changes] 價格變動載入失敗', changes.reason);
    loadFailed = true;
  }
  if (brandOptions.status === 'fulfilled') brands = brandOptions.value;
  else console.error('[admin/products/price-changes] 品牌選項載入失敗', brandOptions.reason);

  return (
    <div className='pcm-plist space-y-3'>
      <div className='pcm-head'>
        <h1>價格變動</h1>
        <span className='pcm-count'>
          供應商同步或員工修改一般價時會記一筆。不含特價與經銷價。
        </span>
      </div>

      <form method='get' className='flex flex-wrap items-end gap-3' data-price-change-filter>
        <label className='flex flex-col gap-1 text-xs'>
          <span className='text-muted-foreground'>時間</span>
          <select name='days' defaultValue={String(filter.days)} className={ADMIN_INPUT_CLASS}>
            <option value='7'>最近 7 天</option>
            <option value='30'>最近 30 天</option>
          </select>
        </label>
        <label className='flex flex-col gap-1 text-xs'>
          <span className='text-muted-foreground'>品牌</span>
          <select name='brand' defaultValue={filter.brandId ?? ''} className={ADMIN_INPUT_CLASS}>
            <option value=''>全部品牌</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className='flex flex-col gap-1 text-xs'>
          <span className='text-muted-foreground'>漲跌</span>
          <select name='dir' defaultValue={filter.direction ?? ''} className={ADMIN_INPUT_CLASS}>
            <option value=''>漲價與降價</option>
            <option value='up'>只看漲價</option>
            <option value='down'>只看降價</option>
          </select>
        </label>
        <button type='submit' className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'>
          套用篩選
        </button>
        {filtered && (
          <Link href={`/products/price-changes?days=${filter.days}`} className='text-primary h-9 text-sm leading-9 underline'>
            清除篩選
          </Link>
        )}
      </form>

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          價格變動載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </div>
      ) : rows.length === 0 ? (
        <div className='bg-card text-muted-foreground rounded-lg border p-6 text-sm'>
          {filtered ? '沒有符合篩選條件的價格變動。' : `最近 ${filter.days} 天沒有價格變動。`}
        </div>
      ) : (
        <>
          <p className='text-muted-foreground text-xs'>
            {`共 ${rows.length.toLocaleString('zh-TW')} 筆，新到舊。`}
            {truncated && `只讀取最近 ${PRICE_CHANGE_LIMIT.toLocaleString('zh-TW')} 筆變動，更早的沒有列出。`}
          </p>
          <div className='bg-card overflow-x-auto rounded-lg border'>
            <table className='w-full border-collapse'>
              <thead>
                <tr>
                  <th className={TH}>時間</th>
                  <th className={TH}>品牌</th>
                  <th className={TH}>商品</th>
                  <th className={TH}>料號</th>
                  <th className={TH}>一般價</th>
                  <th className={`${TH} text-right`}>漲跌</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-price-change-row>
                    <td className={`${TD} whitespace-nowrap`}>{formatOrderDateTime(r.changedAt)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{r.brandName ?? '—'}</td>
                    <td className={TD}>
                      {r.productTitle === null ? (
                        <span className='text-muted-foreground'>（商品已刪除）</span>
                      ) : (
                        <Link href={`/products/${r.productId}`} className='text-primary underline underline-offset-2'>
                          {r.productTitle}
                        </Link>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>{r.sku}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{`${priceText(r.oldPrice)} → ${priceText(r.newPrice)}`}</td>
                    <td
                      className={`${TD} text-right whitespace-nowrap tabular-nums ${
                        r.pct === null ? 'text-muted-foreground' : r.pct > 0 ? 'text-destructive' : 'text-emerald-700'
                      }`}
                    >
                      {pctText(r.pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
