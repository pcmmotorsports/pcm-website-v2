'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveManualProductPricesAction } from '../../lib/products/manual-product-price-actions';

// 商品頁乙 P9:編輯頁「價格」區(只有網站新增的手動商品有)。
// 主管才看得到輸入框與儲存按鈕;其他員工只看價格。存完不跳頁,重新整理這一頁的資料,顯示新價格。
// 特價由 P14 另外設,這裡只顯示。價格規則的權威在資料庫(admin_set_variant_prices)。

export type ManualPriceRow = {
  id: string;
  sku: string;
  label: string;
  priceGeneral: number | null;
  priceStore: number | null;
  salePrice: number | null;
};

const INPUT = 'h-9 w-28 rounded-md border px-2 text-right text-sm';
const money = (v: number | null) => (v === null ? '未設定' : `NT$ ${v.toLocaleString('zh-TW')}`);

/** 輸入框的字 ⇒ 價格:空白 ⇒ null;不是 0 以上整數 ⇒ NaN(送出前擋下)。 */
function toInt(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  return /^\d{1,9}$/.test(t) ? Number(t) : Number.NaN;
}

export function ManualProductPriceEditor({ productId, rows, canEdit }: { productId: string; rows: ManualPriceRow[]; canEdit: boolean }) {
  const router = useRouter();
  const fromRows = (rs: ManualPriceRow[]) =>
    rs.map((r) => ({ general: r.priceGeneral === null ? '' : String(r.priceGeneral), store: r.priceStore === null ? '' : String(r.priceStore) }));
  const [draft, setDraft] = useState(() => fromRows(rows));
  // 「目前資料庫裡的價格」:比對有沒有改、送出時附上的「載入時的價格」都看它。
  //   存成功就立刻換成剛存的值,不等 router.refresh() 回來(本機走查:重新整理還沒回來時再改一次,
  //   會拿舊價比對 ⇒ 誤判「沒有變動」或誤判「別人改過」)。
  const [base, setBase] = useState(() => rows.map((r) => ({ priceGeneral: r.priceGeneral, priceStore: r.priceStore })));
  // 重新整理回來 ⇒ 換成資料庫現在的價格(Codex P9 R1 必修:輸入框不能留著沒存的數字)
  useEffect(() => {
    setDraft(fromRows(rows));
    setBase(rows.map((r) => ({ priceGeneral: r.priceGeneral, priceStore: r.priceStore })));
  }, [rows]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save() {
    setStatus(null);
    const input = [];
    for (const [i, r] of rows.entries()) {
      // 只送真的改了的規格,附上頁面載入時看到的價格(Codex P8 R1 必修:不把別人剛改好的價格蓋回去)
      const b = base[i]!;
      const unchanged = draft[i]!.general.trim() === (b.priceGeneral === null ? '' : String(b.priceGeneral)) &&
        draft[i]!.store.trim() === (b.priceStore === null ? '' : String(b.priceStore));
      if (unchanged) continue;
      const general = toInt(draft[i]!.general);
      const store = toInt(draft[i]!.store);
      if (general === null || Number.isNaN(general)) {
        setStatus({ kind: 'error', text: `「${r.label}」的一般價要填 0 以上的整數。` });
        return;
      }
      if (store !== null && Number.isNaN(store)) {
        setStatus({ kind: 'error', text: `「${r.label}」的經銷價要是 0 以上的整數，或不填。` });
        return;
      }
      input.push({ variantId: r.id, priceGeneral: general, priceStore: store, before: b });
    }
    if (input.length === 0) {
      setStatus({ kind: 'ok', text: '價格沒有變動。' });
      return;
    }
    setBusy(true);
    try {
      const res = await saveManualProductPricesAction(productId, input);
      if (res.ok) {
        const sent = new Map(input.map((c) => [c.variantId, { priceGeneral: c.priceGeneral, priceStore: c.priceStore }]));
        setBase(rows.map((r, i) => sent.get(r.id) ?? base[i]!));
        setStatus({
          kind: 'ok',
          text:
            res.updated === 0
              ? '價格沒有變動。'
              : `價格已儲存（改了 ${res.updated} 個規格）。網站前台最慢約 1 分鐘後更新。`,
        });
        router.refresh();
      } else {
        setStatus({ kind: 'error', text: res.message });
      }
    } catch {
      setStatus({ kind: 'error', text: '無法確認價格是否已儲存。請重新整理頁面，確認目前的價格。' });
    }
    setBusy(false);
  }

  return (
    <section data-od-pe='card' data-manual-price-editor className='rounded-lg border p-4'>
      <h3 className='mb-2 text-sm font-medium'>價格</h3>
      <p className='text-muted-foreground mb-3 text-xs leading-[1.5]'>
        一般價含稅；經銷價未稅，沒填的話經銷會員無法購買。{canEdit ? '' : '只有主管可以改價格。'}
      </p>
      <table className='w-full text-sm'>
        <thead>
          <tr className='text-muted-foreground text-left text-xs'>
            <th className='py-1 font-normal'>規格</th>
            <th className='py-1 text-right font-normal'>一般價（含稅）</th>
            <th className='py-1 text-right font-normal'>經銷價（未稅）</th>
            <th className='py-1 text-right font-normal'>特價</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className='border-t'>
              <td className='py-2'>
                <div>{r.label}</div>
                <div className='text-muted-foreground text-xs'>{r.sku}</div>
              </td>
              <td className='py-2 text-right'>
                {canEdit ? (
                  <input
                    aria-label={`${r.label} 一般價`}
                    inputMode='numeric'
                    disabled={busy}
                    className={INPUT}
                    value={draft[i]!.general}
                    onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, general: e.target.value } : d)))}
                  />
                ) : (
                  money(r.priceGeneral)
                )}
              </td>
              <td className='py-2 text-right'>
                {canEdit ? (
                  <input
                    aria-label={`${r.label} 經銷價`}
                    inputMode='numeric'
                    disabled={busy}
                    className={INPUT}
                    value={draft[i]!.store}
                    onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, store: e.target.value } : d)))}
                  />
                ) : (
                  money(r.priceStore)
                )}
              </td>
              <td className='py-2 text-right'>{r.salePrice === null ? '沒有特價' : money(r.salePrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <div className='mt-3 flex items-center gap-3'>
          <button
            type='button'
            disabled={busy}
            onClick={() => void save()}
            className='bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm disabled:opacity-50'
          >
            {busy ? '儲存中…' : '儲存價格'}
          </button>
        </div>
      )}
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${status.kind === 'error' ? 'text-destructive' : ''}`}>
          {status.text}
        </p>
      )}
    </section>
  );
}
