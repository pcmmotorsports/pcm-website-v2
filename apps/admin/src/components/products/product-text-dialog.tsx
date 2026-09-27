'use client';

// 商品頁乙 A10:列表展開摘要的「改文字…」。打開時讀這件商品的標題 / 副標 / 賣點,
// 裡面放的就是商品頁那個 ProductOverridesEditor(三欄一次儲存、逐欄留紀錄),關掉時重新整理列表。

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { loadProductTextAction, type ProductTextLoad } from '../../lib/products/product-text-actions';
import { ProductOverridesEditor } from './product-overrides-editor';

const BTN = 'border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50';

export function ProductTextDialog({ productId, title }: { productId: string; title: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ProductTextLoad | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    setData(null);
    const el = dialog.current;
    if (el && typeof el.showModal === 'function' && !el.open) el.showModal();
    const r = await loadProductTextAction(productId).catch(
      (): ProductTextLoad => ({ ok: false, message: '商品文字讀取失敗，請稍後再試，或打開完整頁修改。' }),
    );
    setData(r);
    setLoading(false);
  }

  function close() {
    dialog.current?.close();
    setData(null);
    router.refresh();
  }

  return (
    <>
      <button type='button' className={BTN} onClick={open} data-product-text-open>
        改文字…
      </button>
      <dialog
        ref={dialog}
        aria-label={`改文字：${title}`}
        className='bg-card text-foreground m-auto w-[min(900px,calc(100vw-2rem))] rounded-xl border-0 p-0 shadow-[var(--elev-modal)] backdrop:bg-[var(--modal-backdrop)]'
        onClose={() => {
          setData(null);
          router.refresh();
        }}
      >
        <div className='max-h-[80vh] space-y-3 overflow-auto px-5 py-[18px] whitespace-normal'>
          <h3 className='text-base leading-[1.4] font-semibold'>改文字：{title}</h3>
          {loading && <p className='text-muted-foreground text-sm'>讀取中…</p>}
          {data && !data.ok && <p className='text-destructive text-sm'>{data.message}</p>}
          {data && data.ok && <ProductOverridesEditor productId={productId} supplier={data.supplier} overrides={data.overrides} />}
          <div className='flex justify-end'>
            <button type='button' className={BTN} onClick={close}>
              關閉
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
