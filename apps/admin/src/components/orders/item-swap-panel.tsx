'use client';

import { useEffect, useRef, useState } from 'react';
import { searchManualOrderCatalogAction, type ManualOrderCatalogResult } from '@/lib/orders/manual-order-catalog-actions';
import type { ManualOrderCatalogHit } from '@/lib/orders/manual-order-catalog';
import { swapOrderItemAction } from '../../lib/orders/item-swap-actions';
import {
  ITEM_SWAP_ITEM_ID_FIELD,
  ITEM_SWAP_NEW_VARIANT_FIELD,
  ITEM_SWAP_ORDER_ID_FIELD,
  ITEM_SWAP_REQUEST_ID_FIELD,
  ITEM_SWAP_RETURN_TO_FIELD,
  ITEM_SWAP_VERSION_FIELD,
} from '../../lib/orders/item-swap-form';

// item-swap-panel.tsx — 訂單品項卡展開區裡的「換商品」(plan 2026-09-22-admin-order-item-swap-plan.md)。
// 商品搜尋沿用建單那支 server action(searchManualOrderCatalogAction);員工點選一筆、看過並排對照後才送出。
// 能不能換(還沒訂貨、同價、沒退款…)全部由資料庫函式判斷, 結果用頁面上方的提示條顯示。

export type ItemSwapPanelProps = {
  orderId: string;
  orderItemId: string;
  /** 訂單層的 version(函式比對的是 orders.version)。 */
  expectedVersion: number;
  currentSku: string;
  currentTitle: string | null;
  currentUnitPrice: number;
  /** 原商品目前的一般售價(含稅)與經銷價(未稅);資料庫比對的是這組目錄價, 不是成交單價。 */
  sourceCatalogGeneral: number | null;
  sourceCatalogDealerUntaxed: number | null;
  returnTo: string;
  /** 只給測試用 —— 不必真的打 server action。 */
  searchAction?: (keyword: string) => Promise<ManualOrderCatalogResult>;
  /** 只給測試用 —— 送出表單的 action。 */
  submitAction?: (formData: FormData) => void | Promise<void>;
};

/** 金額一律整數元;null = 沒有這個價, 不顯示成 0(0 是合法價格)。 */
function money(v: number | null): string {
  return v === null ? '—' : `NT$ ${v.toLocaleString('en-US')}`;
}

export function ItemSwapPanel({
  orderId,
  orderItemId,
  expectedVersion,
  currentSku,
  currentTitle,
  currentUnitPrice,
  sourceCatalogGeneral,
  sourceCatalogDealerUntaxed,
  returnTo,
  searchAction,
  submitAction,
}: ItemSwapPanelProps) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<ManualOrderCatalogHit[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<ManualOrderCatalogHit | null>(null);
  // 每次打開 / 關閉 / 重查都換一個世代;查詢回來時世代不同 ⇒ 是舊的回應, 丟掉(關掉重開不會混進上一輪結果)。
  const generation = useRef(0);
  const keywordRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  // 焦點:打開後移到料號欄, 關閉後回到「換商品」按鈕(開關時原本那顆按鈕會消失, 焦點會掉到頁面最上面)。
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (open) keywordRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      openRef.current?.focus();
    }
  }, [open]);

  const start = () => {
    // 每次打開產生一個新的操作編號;同一次送出萬一重送, 函式會回上次的結果而不是再換一次。
    setRequestId(crypto.randomUUID());
    setKeyword('');
    setHits(null);
    setProblem(null);
    setPicked(null);
    // 上一輪查詢若還沒回來就被取消, 它的 finally 會因世代不同跳過 setBusy(false) ⇒ 這裡自己歸零。
    setBusy(false);
    generation.current += 1;
    setOpen(true);
  };

  const close = () => {
    generation.current += 1;
    restoreFocus.current = true;
    setOpen(false);
  };

  const search = async () => {
    setBusy(true);
    setProblem(null);
    setHits(null);
    setPicked(null);
    const mine = ++generation.current;
    try {
      const r = await (searchAction ?? searchManualOrderCatalogAction)(keyword);
      if (mine !== generation.current) return;
      if (r.ok) setHits(r.hits);
      else setProblem(r.message);
    } catch {
      if (mine !== generation.current) return;
      setProblem('商品查詢沒有回應，請再查一次。若仍無回應，請聯絡系統管理員。');
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className='mb-3'>
        <button
          ref={openRef}
          type='button'
          onClick={start}
          className='rounded-md border px-3 py-1 text-sm'
          data-testid='item-swap-open'
        >
          換商品
        </button>
      </div>
    );
  }

  return (
    <section className='mb-3 rounded-md border p-3 text-sm' data-testid='item-swap-panel'>
      <p className='font-medium'>換商品</p>
      <p className='text-muted-foreground mt-1 text-xs'>
        只有還沒向廠商訂貨的品項可以換，新商品的目錄價要和原商品相同。數量和單價不會改變，更換會記在操作紀錄。
      </p>

      <div className='mt-2 flex flex-wrap gap-2'>
        <input
          ref={keywordRef}
          aria-label='新商品的料號'
          autoComplete='off'
          placeholder='輸入新商品的料號'
          className='block w-64 rounded-md border px-2 py-1'
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button
          type='button'
          onClick={search}
          disabled={busy || keyword.trim() === ''}
          className='rounded-md border px-3 py-1 disabled:opacity-50'
        >
          {busy ? '查詢中…' : '查詢料號'}
        </button>
        <button type='button' onClick={close} className='rounded-md px-3 py-1'>
          取消換商品
        </button>
      </div>

      {problem !== null && (
        <p className='mt-2 text-red-700' role='alert'>
          {problem}
        </p>
      )}
      {hits !== null && hits.length === 0 && <p className='mt-2'>找不到這個料號，請確認後再查一次。</p>}
      {hits !== null && hits.length > 0 && (
        <ul className='mt-2 space-y-1'>
          {hits.map((h) => (
            <li key={h.variantId}>
              <button
                type='button'
                data-testid='item-swap-hit'
                aria-pressed={picked?.variantId === h.variantId}
                onClick={() => setPicked(h)}
                className='block w-full rounded-md border px-2 py-1 text-left aria-pressed:border-foreground'
              >
                <span className='font-mono'>{h.sku}</span>・{h.title === '' ? '（無品名）' : h.title}・售價{' '}
                {money(h.unitPrice)}（含稅）・經銷 {money(h.dealerPriceUntaxed)}（未稅）
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked !== null && (
        <form action={submitAction ?? swapOrderItemAction} className='mt-3 rounded-md border p-2' data-testid='item-swap-confirm'>
          <dl className='grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1'>
            <dt className='text-muted-foreground'>原商品</dt>
            <dd>
              <span className='font-mono'>{currentSku}</span>・{currentTitle ?? '（無品名）'}・目前售價{' '}
              {money(sourceCatalogGeneral)}（含稅）・經銷 {money(sourceCatalogDealerUntaxed)}（未稅）
              <span className='text-muted-foreground block text-xs'>這張訂單的成交單價 {money(currentUnitPrice)}，換商品後不變。</span>
            </dd>
            <dt className='text-muted-foreground'>換成</dt>
            <dd>
              <span className='font-mono'>{picked.sku}</span>・{picked.title === '' ? '（無品名）' : picked.title}・目前售價{' '}
              {money(picked.unitPrice)}（含稅）・經銷 {money(picked.dealerPriceUntaxed)}（未稅）
            </dd>
          </dl>
          <p className='text-muted-foreground mt-2 text-xs'>
            系統會依這張訂單的會員等級比對兩個商品目前的目錄價，價格不同會擋下，不會更換。
          </p>
          <input type='hidden' name={ITEM_SWAP_ORDER_ID_FIELD} value={orderId} />
          <input type='hidden' name={ITEM_SWAP_ITEM_ID_FIELD} value={orderItemId} />
          <input type='hidden' name={ITEM_SWAP_VERSION_FIELD} value={String(expectedVersion)} />
          <input type='hidden' name={ITEM_SWAP_NEW_VARIANT_FIELD} value={picked.variantId} />
          <input type='hidden' name={ITEM_SWAP_REQUEST_ID_FIELD} value={requestId} />
          <input type='hidden' name={ITEM_SWAP_RETURN_TO_FIELD} value={returnTo} />
          <button type='submit' className='mt-2 rounded-md border px-3 py-1 font-medium' data-testid='item-swap-submit'>
            確認換成這個商品
          </button>
        </form>
      )}
    </section>
  );
}
