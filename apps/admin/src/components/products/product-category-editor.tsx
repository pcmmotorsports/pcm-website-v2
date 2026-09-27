'use client';

// 商品頁乙 C4:編輯頁的「分類」區。
// 儲存 = 改成選的分類並鎖住(每日同步不改回去);「改回由同步決定」= 解鎖,分類當下不動,
// 之後同步跑到這件、而且報價單還有這件時,才換回供應商的分類。寫入走 C3 的 setProductCategoryAction(已審)。

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setProductCategoryAction } from '../../lib/products/product-category-actions';

const BTN = 'border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50';
const BTN_P = 'bg-primary text-primary-foreground inline-flex h-8 items-center rounded-md px-3 text-sm disabled:opacity-50';

export function ProductCategoryEditor({
  productId,
  currentCategoryId,
  locked,
  categories,
}: {
  productId: string;
  currentCategoryId: string;
  locked: boolean;
  categories: readonly { id: string; label: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentCategoryId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function save(unlock: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await setProductCategoryAction({ productIds: [productId], categoryId: unlock ? null : value, unlock });
      if (!r.ok) {
        setMessage({ tone: 'error', text: r.message });
      } else {
        const outcome = r.results[0]?.outcome;
        if (outcome === 'NOT_FOUND') setMessage({ tone: 'error', text: '找不到這件商品，請重新整理頁面。' });
        else if (outcome === 'NO_CHANGE') setMessage({ tone: 'ok', text: '分類沒有變更。' });
        else {
          setMessage({ tone: 'ok', text: unlock ? '已改回由同步決定。' : '分類已儲存。' });
          router.refresh();
        }
      }
    } catch {
      setMessage({ tone: 'error', text: '沒有收到回應，無法確認分類是否已儲存，請重新整理頁面確認。' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-od-pe='card' data-product-category-editor className='space-y-3 rounded-lg border p-4'>
      <div className='flex items-center gap-2'>
        <h3 className='text-sm font-medium'>分類</h3>
        <span className='bg-muted rounded-md px-2 py-0.5 text-xs'>{locked ? '員工設定' : '跟著報價單同步'}</span>
      </div>
      <label className='flex flex-col gap-1 text-sm'>
        <span className='text-muted-foreground text-xs'>分類</span>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          className='border-input bg-background h-9 rounded-md border px-2'
        >
          {!categories.some((c) => c.id === currentCategoryId) && <option value={currentCategoryId}>目前的分類</option>}
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <p className='text-muted-foreground text-xs leading-[1.5]'>
        儲存後，每日同步不會把這件商品的分類改回去。按「改回由同步決定」，之後同步跑到這件商品、而且報價單還有這件時，會換回供應商的分類。
      </p>
      <div className='flex flex-wrap items-center gap-2'>
        <button type='button' className={BTN_P} disabled={busy || (value === currentCategoryId && locked)} onClick={() => save(false)}>
          {busy ? '儲存中…' : '儲存分類'}
        </button>
        {locked && (
          <button type='button' className={BTN} disabled={busy} onClick={() => save(true)}>
            改回由同步決定
          </button>
        )}
        {message && (
          <span role='status' className={message.tone === 'error' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
