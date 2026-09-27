'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  GALLERY_ACCEPT,
  GalleryUserError,
  galleryOrderChanged,
  moveGalleryPhoto,
  splitGallery,
  uploadRejection,
  type GalleryPhoto,
} from '../../lib/products/product-gallery';

// product-gallery-editor.tsx — 共用圖庫 G5:後台商品頁的「照片」(Sean 2026-09-27 C3:網站與報價單共用、可拖曳排序)。
// 設計稿:~/pcm-mailbox/設計稿-商品圖庫-20260927.html。表結構:報價單 20260927160000_product_gallery.sql。
// 🔴 還沒接報價單 API(等 G1 貼板與 G2)。存檔動作全由呼叫端傳入的函式負責;本元件只管畫面狀態。
//
// 拖曳用 pointer 事件,不用 HTML5 drag & drop:後者在手機觸控上不會觸發。
// 只有「拖曳」把手擋掉觸控捲動(touch-action: none),手指按在照片其他地方仍然可以捲頁。
// 每張另有「往前 / 往後移一張」按鈕:鍵盤與不方便拖曳的人也能排順序。

// 🔴 以網址認照片(G2 6f44e9ff:尚未整理的照片沒有 id;隱藏與排序用網址)。刪除只給我們上傳的,那些一定有 id。
export interface ProductGalleryEditorProps {
  readonly photos: readonly GalleryPhoto[];
  /** 顯示中照片的新順序(網址);已隱藏的由呼叫端接在後面。 */
  readonly onSaveOrder: (urls: string[]) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onHide: (url: string) => Promise<void>;
  readonly onUnhide: (url: string) => Promise<void>;
  readonly onUpload: (files: File[]) => Promise<void>;
  /** 照片區上方的說明(例如尚未整理)。 */
  readonly notice?: string;
  /** 照片區底下的說明;沒給 ⇒ 同步商品的說明(我們上傳 / 供應商)。 */
  readonly footnote?: string;
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; message: string };
const IDLE: Status = { kind: 'idle', message: '' };

const BTN = 'min-h-9 rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-40';

export function ProductGalleryEditor({ photos, onSaveOrder, onDelete, onHide, onUnhide, onUpload, notice, footnote }: ProductGalleryEditorProps) {
  const { shown, hidden } = splitGallery(photos);
  const byUrl = new Map(photos.map((p) => [p.url, p]));
  const initial = shown.map((p) => p.url);
  const initialKey = initial.join('\n');

  const [original, setOriginal] = useState<string[]>(initial);
  const [order, setOrder] = useState<string[]>(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(IDLE);
  const [rejected, setRejected] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);

  // 呼叫端重新讀圖庫(上傳、刪除之後)⇒ 以新資料為準
  useEffect(() => {
    const next = initialKey === '' ? [] : initialKey.split('\n');
    setOriginal(next);
    setOrder(next);
  }, [initialKey]);

  const dirty = galleryOrderChanged(original, order);
  const busy = status.kind === 'busy';
  const locked = dirty || busy;

  function move(from: number, to: number) {
    setOrder((o) => moveGalleryPhoto(o, from, to));
    setStatus(IDLE);
  }

  function onHandleDown(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (busy) return;
    e.preventDefault();
    dragId.current = id;
    setDragging(id);
  }

  // 🔴 拖曳中的移動 / 放開聽在 window,不聽在把手上:排序時 React 會搬動格子的 DOM,
  //    被搬動的元素會失去 pointer capture ⇒ 把手收不到之後的 pointermove,拖一格就停
  //    (2026-09-27 真瀏覽器實測:滑鼠從第 1 張拖到第 4 張,只移了一格)。
  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => {
      const id = dragId.current;
      if (id === null) return;
      const tile = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-gallery-tile]');
      const overId = tile?.dataset.galleryTile;
      if (!overId || overId === id) return;
      setOrder((o) => moveGalleryPhoto(o, o.indexOf(id), o.indexOf(overId)));
      setStatus(IDLE);
    };
    const onUp = () => {
      dragId.current = null;
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  async function run(action: () => Promise<void>, ok: string, fail: string) {
    setStatus({ kind: 'busy', message: '處理中…' });
    try {
      await action();
      setStatus({ kind: 'ok', message: ok });
    } catch (error) {
      // 呼叫端已經寫好給員工看的話(例如排序 409「供應商剛更新了照片」)⇒ 用它;其他錯誤用這個動作的預設說法
      if (error instanceof GalleryUserError) {
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      console.error('[admin/products/gallery]', error);
      setStatus({ kind: 'error', message: fail });
    }
  }

  async function save() {
    const next = [...order];
    await run(
      async () => {
        await onSaveOrder(next);
        setOriginal(next);
      },
      '順序已儲存。',
      '順序儲存失敗，請再按一次「儲存順序」。若仍失敗，請聯絡系統管理員。',
    );
  }

  async function upload(list: FileList | null, input: HTMLInputElement) {
    const files = [...(list ?? [])];
    input.value = '';
    const reasons = files.map(uploadRejection).filter((r): r is string => r !== null);
    const ok = files.filter((f) => uploadRejection(f) === null);
    setRejected(reasons);
    if (ok.length === 0) return;
    await run(
      () => onUpload(ok),
      `已上傳 ${ok.length} 張照片。`,
      '照片上傳沒有完成，請重新整理頁面，確認哪些照片已經上傳。',
    );
  }

  return (
    <section data-od-pe='card' data-product-gallery className='rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
        <h3 className='text-sm font-medium'>{`照片（${order.length} 張）`}</h3>
        <div className='flex flex-wrap items-center gap-2'>
          {dirty && <span className='text-sm font-semibold text-amber-700'>順序已變更，尚未儲存</span>}
          {dirty && (
            <button type='button' className={BTN} disabled={busy} onClick={() => { setOrder(original); setStatus(IDLE); }}>
              取消變更
            </button>
          )}
          <button
            type='button'
            className='bg-primary text-primary-foreground min-h-9 rounded-md px-4 text-sm font-semibold disabled:opacity-45'
            disabled={!dirty || busy}
            onClick={save}
          >
            儲存順序
          </button>
        </div>
      </div>

      {notice && (
        <p data-gallery-notice className='mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
          {notice}
        </p>
      )}

      <p className='text-muted-foreground mb-3 text-xs'>
        網站和報價單都照這個順序顯示，第 1 張是封面。按住「拖曳」移到想要的位置，或用「往前」「往後」調整，調完按「儲存順序」。
      </p>

      <p role='status' aria-live='polite' className={status.kind === 'error' ? 'text-destructive mb-2 text-sm' : 'text-muted-foreground mb-2 text-sm'}>
        {status.message}
      </p>

      {order.length === 0 && <p className='text-muted-foreground mb-3 text-sm'>這件商品還沒有照片。可以從下面上傳。</p>}

      <ol className='grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]'>
        {order.map((url, i) => {
          const p = byUrl.get(url);
          if (!p) return null;
          const staff = p.source === 'staff';
          const photoId = p.id;
          return (
            <li
              key={url}
              data-gallery-tile={url}
              className={`bg-background overflow-hidden rounded-md border ${dragging === url ? 'opacity-40' : ''}`}
            >
              <div className='bg-muted relative aspect-square'>
                <img src={p.url} alt={`第 ${i + 1} 張照片`} loading='lazy' className='h-full w-full object-contain' draggable={false} />
                <span data-gallery-n className='absolute top-1.5 left-1.5 rounded-sm bg-black/60 px-1.5 text-xs text-white'>
                  {i + 1}
                </span>
                {i === 0 && (
                  <span
                    data-gallery-cover
                    className='bg-primary text-primary-foreground absolute top-1.5 right-1.5 rounded-sm px-1.5 text-xs font-semibold'
                  >
                    封面
                  </span>
                )}
              </div>
              <div className='flex flex-wrap items-center gap-1.5 p-2'>
                {/* 同商品列表「上架中 / 已下架」那組標籤(globals.css .pcm-cap) */}
                <span className={staff ? 'pcm-cap pcm-cap--on' : 'pcm-cap'}>
                  {staff ? '我們上傳' : '供應商'}
                </span>
                <button
                  type='button'
                  data-gallery-handle
                  aria-label='拖曳調整順序'
                  className={`${BTN} cursor-grab active:cursor-grabbing`}
                  style={{ touchAction: 'none' }}
                  disabled={busy}
                  onPointerDown={(e) => onHandleDown(e, url)}
                >
                  ⠿ 拖曳
                </button>
                <button type='button' aria-label='往前移一張' className={BTN} disabled={busy || i === 0} onClick={() => move(i, i - 1)}>
                  ←
                </button>
                <button
                  type='button'
                  aria-label='往後移一張'
                  className={BTN}
                  disabled={busy || i === order.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  →
                </button>
                {i > 0 && (
                  <button type='button' className={BTN} disabled={busy} onClick={() => move(i, 0)}>
                    設為封面
                  </button>
                )}
                {staff ? (
                  <button
                    type='button'
                    className={`${BTN} text-destructive`}
                    disabled={locked || photoId === null}
                    onClick={() => setConfirmDelete(url)}
                  >
                    刪除
                  </button>
                ) : (
                  <button
                    type='button'
                    className={BTN}
                    disabled={locked}
                    onClick={() => run(() => onHide(url), '已隱藏，網站和報價單都不再顯示這張。', '隱藏沒有完成，請重新整理後再試。')}
                  >
                    隱藏
                  </button>
                )}
              </div>
              {confirmDelete === url && photoId !== null && (
                <div className='border-t p-2 text-xs'>
                  <p className='mb-1.5'>確定刪除這張照片？刪除後無法復原。</p>
                  <div className='flex gap-1.5'>
                    <button
                      type='button'
                      className={`${BTN} text-destructive`}
                      disabled={busy}
                      onClick={() => {
                        setConfirmDelete(null);
                        void run(() => onDelete(photoId), '照片已刪除。', '刪除沒有完成，請重新整理頁面，確認這張照片是否還在。');
                      }}
                    >
                      確定刪除
                    </button>
                    <button type='button' className={BTN} onClick={() => setConfirmDelete(null)}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        <li>
          <label
            className={`border-input text-primary flex aspect-square flex-col items-center justify-center rounded-md border-2 border-dashed p-3 text-center text-sm font-semibold ${locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            ＋ 上傳照片
            <span className='text-muted-foreground mt-1 block text-xs font-normal'>可一次選多張，手機可直接拍照。只收 JPG、PNG、WebP。</span>
            <input
              type='file'
              accept={GALLERY_ACCEPT}
              multiple
              disabled={locked}
              className='sr-only'
              onChange={(e) => void upload(e.currentTarget.files, e.currentTarget)}
            />
          </label>
        </li>
      </ol>

      {dirty && <p className='text-muted-foreground mt-2 text-xs'>請先儲存或取消順序變更，才能刪除、隱藏或上傳照片。</p>}
      {rejected.length > 0 && (
        <ul className='text-destructive mt-2 space-y-1 text-sm'>
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {hidden.length > 0 && (
        <details data-gallery-hidden className='mt-4'>
          <summary className='text-muted-foreground cursor-pointer text-sm'>{`已隱藏的供應商照片（${hidden.length} 張）`}</summary>
          <ul className='mt-2 space-y-2'>
            {hidden.map((p) => (
              <li key={p.url} className='flex items-center gap-3'>
                <img src={p.url} alt='已隱藏的供應商照片' loading='lazy' className='bg-muted h-16 w-16 rounded-md object-contain' />
                <span className='text-muted-foreground flex-1 text-xs'>隱藏後網站和報價單都不顯示；每天的同步不會把它加回來。</span>
                <button
                  type='button'
                  className={BTN}
                  disabled={locked}
                  onClick={() => run(() => onUnhide(p.url), '已取消隱藏，這張會排在最後面。', '取消隱藏沒有完成，請重新整理後再試。')}
                >
                  取消隱藏
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className='text-muted-foreground mt-3 text-xs'>
        {footnote ??
          '「我們上傳」的照片可以刪除。「供應商」的照片是每天同步帶進來的，不能刪除，只能隱藏；供應商之後新增的照片會自動排在最後面。每次上傳、刪除、隱藏、調整順序都會記進變更紀錄。'}
      </p>
    </section>
  );
}
