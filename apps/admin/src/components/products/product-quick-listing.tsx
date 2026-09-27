'use client';

// 商品頁乙 A9:列表展開摘要裡的「下架這件商品 / 重新上架這件商品」。
// 走批次那支 server action(只送一件),所以上架前的規格料號檢查、權限、稽核都和批次一樣。
// 先按一次會問「確定嗎」,再按一次才送出(上下架是客人看得到的事)。

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BATCH_LISTING_OUTCOME_LABEL } from '../../lib/products/product-list-view';
import { setProductListingBatchAction } from '../../lib/products/product-listing-batch-actions';

const BTN = 'border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50';

export function ProductQuickListing({ productId, listed }: { productId: string; listed: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const verb = listed ? '下架' : '重新上架';

  async function go() {
    setBusy(true);
    try {
      const r = await setProductListingBatchAction({ productIds: [productId], delisted: listed });
      if (!r.ok) {
        setMessage(r.message);
      } else {
        const outcome = r.results[0]?.outcome ?? 'UNCONFIRMED';
        if (outcome === 'NEEDS_REVIEW') {
          setMessage(
            <>
              這件的規格料號需要確認，請到
              <Link href={`/products/${productId}`} className='mx-1 underline'>
                商品頁
              </Link>
              上架。
            </>,
          );
        } else {
          setMessage(BATCH_LISTING_OUTCOME_LABEL[outcome]);
          if (outcome === 'UPDATED') router.refresh();
        }
      }
    } catch {
      setMessage('沒有收到回應，無法確認是否已完成，請重新整理頁面確認。');
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <span className='inline-flex flex-wrap items-center gap-2' data-product-quick-listing>
      {!asking ? (
        <button type='button' className={BTN} disabled={busy} onClick={() => setAsking(true)}>
          {verb}這件商品
        </button>
      ) : (
        <>
          <span className='text-sm'>{listed ? '下架後客人就看不到這件商品。' : '上架後客人就看得到這件商品。'}</span>
          <button type='button' className={BTN} disabled={busy} onClick={go}>
            {busy ? `${verb}中…` : `確定${verb}`}
          </button>
          <button type='button' className={BTN} disabled={busy} onClick={() => setAsking(false)}>
            取消
          </button>
        </>
      )}
      {message && <span className='text-muted-foreground text-sm'>{message}</span>}
    </span>
  );
}
