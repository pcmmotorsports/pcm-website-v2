// 後台「最近 7 天新上架」清單(地圖 M-5-03;主視窗 2026-09-29 派, 提案 ~/pcm-mailbox/提案-新商品審核-20260929.md 甲)。只讀。
// 新商品照舊自動上架;這裡把價格可疑、沒圖、沒中文、未分類的排在最前面, 員工看完有問題就到商品頁下架。
// 入口在商品列表工具列, 與「查看價格變動」並排(側欄維持 Sean 09-13 的 6 項)。
import Link from 'next/link';
import { formatOrderAmount } from '../../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import {
  NEW_LISTING_DAYS,
  NEW_LISTING_FLAG_LABEL,
  NEW_LISTING_LIMIT,
  listNewListings,
  type NewListingRow,
} from '../../../lib/products/new-listing-repository';

export const dynamic = 'force-dynamic';

const TH = 'border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground';
const TD = 'border-b px-3 py-2 text-sm align-top';

export default async function NewListingsPage() {
  let rows: NewListingRow[] = [];
  let truncated = false;
  let loadFailed = false;
  try {
    ({ rows, truncated } = await listNewListings());
  } catch (err) {
    console.error('[admin/products/new-listings] 新上架清單載入失敗', err);
    loadFailed = true;
  }
  const flagged = rows.filter((r) => r.flags.length > 0).length;

  return (
    <div className='pcm-plist space-y-3'>
      <div className='pcm-head'>
        <h1>{`最近 ${NEW_LISTING_DAYS} 天新上架`}</h1>
        <span className='pcm-count'>
          這些商品已經上架，客人看得到。需要注意的排在最前面；有問題請到商品頁下架。
        </span>
      </div>

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          新上架清單載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </div>
      ) : rows.length === 0 ? (
        <div className='bg-card text-muted-foreground rounded-lg border p-6 text-sm'>{`最近 ${NEW_LISTING_DAYS} 天沒有新上架的商品。`}</div>
      ) : (
        <>
          <p className='text-muted-foreground text-xs'>
            {`共 ${rows.length.toLocaleString('zh-TW')} 件，其中 ${flagged.toLocaleString('zh-TW')} 件需要注意。`}
            {truncated && `只讀取最近建立的 ${NEW_LISTING_LIMIT.toLocaleString('zh-TW')} 件，更早的沒有列出。`}
          </p>
          <div className='bg-card overflow-x-auto rounded-lg border'>
            <table className='w-full border-collapse'>
              <thead>
                <tr>
                  <th className={TH}>上架時間</th>
                  <th className={TH}>品牌</th>
                  <th className={TH}>商品</th>
                  <th className={TH}>分類</th>
                  <th className={`${TH} text-right`}>一般價</th>
                  <th className={TH}>需要注意</th>
                  <th className={TH}>處理</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-new-listing-row>
                    <td className={`${TD} whitespace-nowrap`}>{formatOrderDateTime(r.createdAt)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{r.brandName ?? '—'}</td>
                    <td className={TD}>
                      <Link href={`/products/${r.id}`} className='text-primary underline underline-offset-2'>
                        {r.title}
                      </Link>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{r.categoryName ?? '—'}</td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                      {r.priceGeneral === null ? '沒有價格' : `NT$ ${formatOrderAmount(r.priceGeneral)}`}
                    </td>
                    <td className={TD}>
                      {r.flags.length === 0 ? (
                        <span className='text-muted-foreground'>—</span>
                      ) : (
                        <span className='flex flex-wrap gap-1'>
                          {r.flags.map((f) => (
                            <span key={f} className='bg-destructive/10 text-destructive rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap'>
                              {NEW_LISTING_FLAG_LABEL[f]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link href={`/products/${r.id}`} className='text-primary text-sm underline underline-offset-2'>
                        到商品頁下架
                      </Link>
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
