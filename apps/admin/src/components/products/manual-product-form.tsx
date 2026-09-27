'use client';

// 商品頁乙 P6:「新增商品」表單(手動商品)。送出走 createManualProductAction(P5);規則的權威在資料庫。
// 新建的商品一律是已下架,建立後跳到商品頁,頂端寫明要檢查照片和文字後再上架。

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createManualProductAction, type ManualVariantInput } from '../../lib/products/manual-product-actions';

type Row = { sku: string; label: string; priceGeneral: string; priceStore: string; availability: 'in-stock' | 'out-of-stock' };
const EMPTY_ROW: Row = { sku: '', label: '', priceGeneral: '', priceStore: '', availability: 'in-stock' };

const INPUT = 'border-input bg-background h-9 rounded-md border px-2 text-sm';
const BTN = 'border-input hover:bg-accent inline-flex h-9 items-center rounded-md border px-3 text-sm disabled:opacity-50';
const BTN_P = 'bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm disabled:opacity-50';

/** 表單上的數字欄:空字串 ⇒ null;不是 0 以上整數 ⇒ NaN(交給 server action 說明哪一格不對)。 */
function toInt(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

export function ManualProductForm({
  brands,
  categories,
}: {
  brands: readonly { id: string; name: string }[];
  categories: readonly { id: string; label: string }[];
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const missingStore = rows.some((r) => r.priceStore.trim() === '');

  async function submit() {
    // 只打空白字元時 required 會放行 ⇒ 送出前再擋一次(規則:一般價空不能賣)
    if (rows.some((r) => toInt(r.priceGeneral) === null)) {
      setError('每個規格都要填一般價（0 以上的整數）。');
      return;
    }
    setBusy(true);
    setError(null);
    const variants: ManualVariantInput[] = rows.map((r) => ({
      sku: r.sku,
      label: r.label,
      priceGeneral: toInt(r.priceGeneral) ?? Number.NaN,
      priceStore: toInt(r.priceStore),
      availability: r.availability,
    }));
    try {
      const r = await createManualProductAction({ brandId, categoryId, title, subtitle, description, variants });
      if (r.ok) {
        router.push(`/products/${r.productId}?created=1`);
        return;
      }
      setError(r.message);
    } catch {
      setError('無法確認商品是否已建立。請先到商品列表用料號搜尋，確認沒有這件商品再重新建立。');
    }
    setBusy(false);
  }

  return (
    <form
      className='space-y-5'
      data-manual-product-form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section className='grid gap-3 rounded-lg border p-4 sm:grid-cols-2'>
        <label className='flex flex-col gap-1 text-sm'>
          <span className='text-muted-foreground text-xs font-medium'>品牌</span>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={INPUT} required>
            <option value=''>請選擇品牌</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className='flex flex-col gap-1 text-sm'>
          <span className='text-muted-foreground text-xs font-medium'>分類</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={INPUT} required>
            <option value=''>請選擇分類</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className='flex flex-col gap-1 text-sm sm:col-span-2'>
          <span className='text-muted-foreground text-xs font-medium'>標題（客人看到的商品名稱，最多 200 字）</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={INPUT} required />
        </label>
        <label className='flex flex-col gap-1 text-sm sm:col-span-2'>
          <span className='text-muted-foreground text-xs font-medium'>副標（選填，最多 300 字）</span>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={300} className={INPUT} />
        </label>
        <label className='flex flex-col gap-1 text-sm sm:col-span-2'>
          <span className='text-muted-foreground text-xs font-medium'>說明（選填）</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={4} className='border-input bg-background rounded-md border p-2 text-sm' />
        </label>
      </section>

      <section className='space-y-3 rounded-lg border p-4'>
        <h2 className='text-sm font-medium'>規格（至少一個，最多 50 個）</h2>
        <p className='text-muted-foreground text-xs leading-[1.5]'>
          料號只能有英數字、.、_、-，最多 64 字，不能有連續兩個點；建立時會轉成大寫。價格是含稅的整數元。
        </p>
        {rows.map((r, i) => (
          <div key={i} className='grid items-end gap-2 sm:grid-cols-[1.2fr_1.2fr_1fr_1fr_1fr_auto]' data-variant-row>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-muted-foreground text-xs'>料號</span>
              <input value={r.sku} onChange={(e) => setRow(i, { sku: e.target.value })} maxLength={64} className={INPUT} required />
            </label>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-muted-foreground text-xs'>規格名稱</span>
              <input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} maxLength={100} className={INPUT} required />
            </label>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-muted-foreground text-xs'>一般價</span>
              <input value={r.priceGeneral} onChange={(e) => setRow(i, { priceGeneral: e.target.value })} inputMode='numeric' className={INPUT} required />
            </label>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-muted-foreground text-xs'>經銷價（選填）</span>
              <input value={r.priceStore} onChange={(e) => setRow(i, { priceStore: e.target.value })} inputMode='numeric' className={INPUT} />
            </label>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-muted-foreground text-xs'>現貨</span>
              <select value={r.availability} onChange={(e) => setRow(i, { availability: e.target.value as Row['availability'] })} className={INPUT}>
                <option value='in-stock'>有現貨</option>
                <option value='out-of-stock'>缺貨</option>
              </select>
            </label>
            <button type='button' className={BTN} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              移除這個規格
            </button>
          </div>
        ))}
        <button type='button' className={BTN} disabled={rows.length >= 50} onClick={() => setRows([...rows, { ...EMPTY_ROW }])}>
          再加一個規格
        </button>
        {missingStore && (
          <p className='text-muted-foreground text-xs' data-missing-store-hint>
            有規格沒填經銷價：經銷會員無法購買那個規格。
          </p>
        )}
      </section>

      <p className='text-muted-foreground text-sm'>建立後商品是「已下架」，客人看不到。請到商品頁檢查照片和文字，再按上架。</p>
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      <button type='submit' className={BTN_P} disabled={busy}>
        {busy ? '建立中…' : '建立商品'}
      </button>
    </form>
  );
}
