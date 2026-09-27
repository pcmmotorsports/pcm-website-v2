'use client';

// 商品頁乙 A6 / A8:列表的勾選與批次上下架。
// 勾選框是表格裡的一般 <input>(server 端畫,帶 data-product-select / data-title);這裡讀 DOM 算「已選幾件」,
// 表格本身不用改成 client(共用的 AdminDataTable 不動)。
// 按下批次按鈕 ⇒ 確認視窗(列出件數)⇒ 每 50 件送一次、逐段累積結果 ⇒ 逐件列出。
// 某一段沒有回應:那一段標「結果未確認」、後面標「尚未執行」,旁邊可以「重新讀取目前狀態」(Sean 09-28 Q2 甲)。

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BATCH_LISTING_OUTCOME_LABEL,
  LISTING_BATCH_CHUNK,
  MAX_LISTING_BATCH,
  type BatchListingOutcome,
} from '../../lib/products/product-list-view';
import {
  readProductListingStatesAction,
  setProductListingBatchAction,
} from '../../lib/products/product-listing-batch-actions';
import { setProductCategoryAction } from '../../lib/products/product-category-actions';


const SELECTOR = 'input[data-product-select]';

type Picked = { id: string; title: string };
type Row = { id: string; title: string; outcome: BatchListingOutcome; listedNow?: boolean };

function readPicked(): Picked[] {
  return [...document.querySelectorAll<HTMLInputElement>(`${SELECTOR}:checked`)].map((el) => ({
    id: el.value,
    title: el.dataset.title ?? el.value,
  }));
}

/** 表頭那一格:勾 = 本頁全選,再勾一次 = 全部取消。 */
export function ProductSelectAllOnPage() {
  return (
    <input
      type='checkbox'
      aria-label='本頁全選'
      data-product-select-all
      onChange={(e) => {
        for (const el of document.querySelectorAll<HTMLInputElement>(SELECTOR)) el.checked = e.currentTarget.checked;
        document.dispatchEvent(new Event('product-select-change'));
      }}
    />
  );
}

const BTN = 'border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm disabled:opacity-50';
const BTN_P = 'bg-primary text-primary-foreground inline-flex h-8 items-center rounded-md px-3 text-sm disabled:opacity-50';

/** 商品頁乙 C5:改分類的選項 = 全部分類(包含目前還沒有商品的),顯示完整路徑。 */
export type CategoryChoice = { readonly id: string; readonly label: string };

export function ProductBatchBar({ categories = [] }: { categories?: readonly CategoryChoice[] }) {
  const router = useRouter();
  const query = useSearchParams().toString();
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  // 🔴 按下批次按鈕那一刻從畫面上讀的那一份;送出只用它(A8 Codex 必修 1:換頁後不能送上一頁的商品)
  const [snapshot, setSnapshot] = useState<Picked[]>([]);
  const [target, setTarget] = useState<'delist' | 'list' | 'category' | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [categoryDone, setCategoryDone] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setPicked(readPicked());
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLInputElement && e.target.matches(SELECTOR)) sync();
    };
    document.addEventListener('change', onChange);
    document.addEventListener('product-select-change', sync);
    sync();
    return () => {
      document.removeEventListener('change', onChange);
      document.removeEventListener('product-select-change', sync);
    };
    // 換頁、換篩選(網址參數變了)⇒ 表格換了一批 ⇒ 重新讀一次勾選。依字串比,不依物件(物件每次都可能是新的)
  }, [query]);

  const tooMany = picked.length > MAX_LISTING_BATCH;
  const open = (t: 'delist' | 'list' | 'category') => {
    // 上一批還在送就不能再開一批(視窗被瀏覽器強制關掉時也一樣)
    if (running) return;
    const now = readPicked();
    setPicked(now);
    setSnapshot(now);
    if (now.length === 0 || now.length > MAX_LISTING_BATCH) return;
    setTarget(t);
    setRows(null);
    setError(null);
    setCategoryDone(null);
    setCategoryId('');
    const el = dialog.current;
    if (el && typeof el.showModal === 'function' && !el.open) el.showModal();
  };

  /** 商品頁乙 C5:改分類或改回由同步決定。整批在同一個交易(最多 200 件),所以不用分段。 */
  async function runCategory(unlock: boolean) {
    setRunning(true);
    setError(null);
    try {
      const r = await setProductCategoryAction({ productIds: snapshot.map((p) => p.id), categoryId: unlock ? null : categoryId, unlock });
      if (!r.ok) {
        setError(r.message);
      } else {
        const n = (k: string) => r.results.filter((x) => x.outcome === k).length;
        setCategoryDone(`已更新 ${n('UPDATED')} 件、未變更 ${n('NO_CHANGE')} 件${n('NOT_FOUND') > 0 ? `、找不到 ${n('NOT_FOUND')} 件` : ''}。`);
      }
    } catch {
      setError('沒有收到回應，無法確認分類是否已儲存，請重新整理頁面確認。');
    } finally {
      setRunning(false);
    }
  }

  async function run() {
    if (!target || target === 'category' || running) return;
    setRunning(true);
    const titleOf = new Map(snapshot.map((p) => [p.id, p.title]));
    const ids = snapshot.map((p) => p.id);
    const done: Row[] = [];
    for (let i = 0; i < ids.length; i += LISTING_BATCH_CHUNK) {
      const chunk = ids.slice(i, i + LISTING_BATCH_CHUNK);
      try {
        const r = await setProductListingBatchAction({ productIds: chunk, delisted: target === 'delist' });
        if (!r.ok) {
          setError(r.message);
          for (const id of ids.slice(i)) done.push({ id, title: titleOf.get(id) ?? id, outcome: 'NOT_RUN' });
          break;
        }
        for (const x of r.results) done.push({ id: x.productId, title: titleOf.get(x.productId) ?? x.productId, outcome: x.outcome });
      } catch {
        // 這一段沒有回應:不知道有沒有做到 ⇒ 照實標「結果未確認」,後面的停下不送
        for (const id of chunk) done.push({ id, title: titleOf.get(id) ?? id, outcome: 'UNCONFIRMED' });
        for (const id of ids.slice(i + LISTING_BATCH_CHUNK)) done.push({ id, title: titleOf.get(id) ?? id, outcome: 'NOT_RUN' });
        break;
      }
      setRows([...done]);
    }
    // 🔴 有「結果未確認 / 尚未執行」⇒ 主動讀一次目前狀態並列在旁邊(Sean 09-28 Q2 甲;A8 Codex 必修 4)
    setRows(await withCurrentStates(done));
    setRunning(false);
  }

  /** 讀「結果未確認 / 尚未執行」那幾件目前是上架還是下架;讀不到就明講,結果標記保持原樣。 */
  async function withCurrentStates(list: Row[]): Promise<Row[]> {
    const ids = list.filter((r) => r.outcome === 'UNCONFIRMED' || r.outcome === 'NOT_RUN').map((r) => r.id);
    if (ids.length === 0) return list;
    const r = await readProductListingStatesAction(ids).catch(() => null);
    if (!r || !r.ok) {
      setError(r?.message ?? '目前狀態讀取失敗，請按「重新讀取目前狀態」再試一次。');
      return list;
    }
    const now = new Map(r.states.map((s) => [s.productId, s.listed]));
    return list.map((row) => (now.has(row.id) ? { ...row, listedNow: now.get(row.id) } : row));
  }

  async function reread() {
    if (!rows) return;
    setError(null);
    setRows(await withCurrentStates(rows));
  }

  const close = () => {
    // 🔴 還在送的時候不能關(A8 Codex 必修 2):關掉畫面不會停止後面幾段,員工會以為取消了
    if (running) return;
    dialog.current?.close();
    if (rows || categoryDone) {
      for (const el of document.querySelectorAll<HTMLInputElement>(`${SELECTOR}, input[data-product-select-all]`)) el.checked = false;
      setPicked([]);
      router.refresh();
    }
    setTarget(null);
    setRows(null);
    setSnapshot([]);
    setCategoryDone(null);
  };

  const verb = target === 'list' ? '上架' : '下架';
  const counts = rows
    ? (Object.keys(BATCH_LISTING_OUTCOME_LABEL) as BatchListingOutcome[])
        .map((k) => [k, rows.filter((r) => r.outcome === k).length] as const)
        .filter(([, n]) => n > 0)
    : [];
  // 逐件列出全部結果(A8 Codex 必修 5);要處理的排前面
  const ordered = rows
    ? [...rows.filter((r) => r.outcome !== 'UPDATED' && r.outcome !== 'NO_CHANGE'), ...rows.filter((r) => r.outcome === 'UPDATED' || r.outcome === 'NO_CHANGE')]
    : [];

  return (
    <div className='flex flex-wrap items-center gap-2' data-product-batch-bar>
      <span className='text-muted-foreground text-sm'>已選 {picked.length} 件</span>
      <button type='button' className={BTN} disabled={picked.length === 0 || tooMany} onClick={() => open('delist')}>
        下架已選商品
      </button>
      <button type='button' className={BTN} disabled={picked.length === 0 || tooMany} onClick={() => open('list')}>
        上架已選商品
      </button>
      {categories.length > 0 && (
        <button type='button' className={BTN} disabled={picked.length === 0 || tooMany} onClick={() => open('category')}>
          改分類…
        </button>
      )}
      {tooMany && (
        <span className='text-destructive text-sm'>
          一次最多處理 {MAX_LISTING_BATCH} 件，請縮小篩選範圍，或把每頁改成 {MAX_LISTING_BATCH} 件。
        </span>
      )}

      <dialog
        ref={dialog}
        aria-labelledby='product-batch-title'
        className='bg-card text-foreground m-auto w-[min(560px,calc(100vw-2rem))] rounded-xl border-0 p-0 shadow-[var(--elev-modal)] backdrop:bg-[var(--modal-backdrop)]'
        onCancel={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <div className='space-y-3 px-5 py-[18px]'>
          <h3 id='product-batch-title' className='text-base leading-[1.4] font-semibold'>
            {target === 'category'
              ? `改已選的 ${snapshot.length} 件商品的分類`
              : rows
                ? `${verb}結果`
                : `${verb}已選的 ${snapshot.length} 件商品`}
          </h3>
          {target === 'category' && (
            <div className='space-y-2 text-sm leading-[1.5]' data-product-category-dialog>
              {!categoryDone && (
                <>
                  <label className='flex flex-col gap-1'>
                    <span className='text-muted-foreground text-xs'>新的分類</span>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className='border-input bg-background h-9 rounded-md border px-2'
                    >
                      <option value=''>請選擇分類</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className='text-muted-foreground'>改過的分類，每日同步不會改回去。要讓分類重新跟著報價單，按「改回由同步決定」；之後同步跑到這件商品、而且報價單還有這件時，會換回供應商的分類。</p>
                </>
              )}
              {categoryDone && <p data-product-category-result>{categoryDone}</p>}
            </div>
          )}
          {target !== 'category' && !rows && (
            <p className='text-sm leading-[1.5]'>
              {target === 'list'
                ? '上架後客人就看得到這些商品。規格料號疑似屬於別件商品的，這次不會上架，會列出來請你到商品頁逐件確認。'
                : '下架後客人就看不到這些商品。'}
            </p>
          )}
          {rows && (
            <div className='space-y-2 text-sm leading-[1.5]' data-product-batch-result>
              <p>{counts.map(([k, n]) => `${BATCH_LISTING_OUTCOME_LABEL[k]} ${n} 件`).join('、')}</p>
              {running && <p className='text-muted-foreground'>還在處理中，完成前請不要關閉這個視窗。</p>}
              {ordered.length > 0 && (
                <ul className='max-h-64 space-y-1 overflow-auto'>
                  {ordered.map((r) => (
                    <li key={r.id} data-outcome={r.outcome}>
                      <Link href={`/products/${r.id}`} className='underline'>
                        {r.title}
                      </Link>
                      {` · ${BATCH_LISTING_OUTCOME_LABEL[r.outcome]}`}
                      {r.listedNow !== undefined && ` · 目前${r.listedNow ? '上架中' : '已下架'}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className='text-destructive text-sm'>{error}</p>}
          <div className='flex justify-end gap-2'>
            {target === 'category' && !categoryDone && (
              <>
                <button type='button' className={BTN} disabled={running} onClick={close}>
                  取消
                </button>
                <button type='button' className={BTN} disabled={running} onClick={() => runCategory(true)}>
                  改回由同步決定
                </button>
                <button type='button' className={BTN_P} disabled={running || categoryId === ''} onClick={() => runCategory(false)}>
                  {running ? '儲存中…' : `儲存分類（${snapshot.length} 件）`}
                </button>
              </>
            )}
            {target === 'category' && categoryDone && (
              <button type='button' className={BTN_P} onClick={close}>
                關閉
              </button>
            )}
            {target !== 'category' && !rows && (
              <>
                <button type='button' className={BTN} disabled={running} onClick={close}>
                  取消
                </button>
                <button type='button' className={BTN_P} disabled={running} onClick={run}>
                  {running ? `${verb}中…` : `確定${verb} ${snapshot.length} 件`}
                </button>
              </>
            )}
            {target !== 'category' && rows && !running && (
              <>
                {rows.some((r) => r.outcome === 'UNCONFIRMED' || r.outcome === 'NOT_RUN') && (
                  <button type='button' className={BTN} onClick={reread}>
                    重新讀取目前狀態
                  </button>
                )}
                <button type='button' className={BTN_P} onClick={close}>
                  關閉
                </button>
              </>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
