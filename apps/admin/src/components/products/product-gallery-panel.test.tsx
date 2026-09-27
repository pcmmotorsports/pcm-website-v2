// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { GalleryPhoto } from '../../lib/products/product-gallery';

// product-gallery-panel.test.tsx — 商品頁「照片」把畫面接到 server action(假的 action,不打報價單)。

const m = vi.hoisted(() => ({
  reorder: vi.fn(),
  remove: vi.fn(),
  hidden: vi.fn(),
  upload: vi.fn(),
  shrink: vi.fn(async (f: File) => new File(['small'], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
}));
vi.mock('../../lib/products/gallery-actions', () => ({
  reorderGalleryAction: m.reorder,
  removeGalleryPhotoAction: m.remove,
  setGalleryHiddenAction: m.hidden,
  uploadGalleryPhotoAction: m.upload,
}));
vi.mock('../../lib/products/gallery-shrink', () => ({ shrinkForUpload: m.shrink }));

import { ProductGalleryPanel } from './product-gallery-panel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PID = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHOTOS: GalleryPhoto[] = [
  { id: A, url: 'https://img/a.webp', source: 'staff', position: 0, hidden: false },
  { id: B, url: 'https://img/b.jpg', source: 'supplier', position: 1, hidden: false },
];

function setup() {
  const view = render(<ProductGalleryPanel productId={PID} initialPhotos={PHOTOS} initialCurated />);
  const idOf = new Map(PHOTOS.map((p) => [p.url, p.id]));
  const order = () => [...view.container.querySelectorAll<HTMLElement>('[data-gallery-tile]')].map((t) => idOf.get(t.dataset.galleryTile!));
  const btn = (text: string, root: ParentNode = view.container) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)!;
  return { view, order, btn };
}

describe('ProductGalleryPanel', () => {
  it('儲存順序 ⇒ 呼叫 action(商品 id + 新順序), 畫面換成回傳的照片', async () => {
    m.reorder.mockResolvedValueOnce({
      ok: true,
      curated: true,
      photos: [
        { ...PHOTOS[1]!, position: 0 },
        { ...PHOTOS[0]!, position: 1 },
      ],
    });
    const { view, order, btn } = setup();
    fireEvent.click(btn('往後移一張', view.container.querySelector(`[data-gallery-tile="${PHOTOS[0]!.url}"]`)!));
    await act(async () => fireEvent.click(btn('儲存順序')));
    expect(m.reorder).toHaveBeenCalledWith(PID, [PHOTOS[1]!.url, PHOTOS[0]!.url]);
    expect(order()).toEqual([B, A]);
    expect(view.container.textContent).toContain('順序已儲存');
  });

  it('🔴 排序衝突 ⇒ 顯示 action 回的話, 順序留著沒存', async () => {
    m.reorder.mockResolvedValueOnce({ ok: false, message: '供應商剛更新了照片，請重新整理再排。' });
    const { view, btn } = setup();
    fireEvent.click(btn('往後移一張', view.container.querySelector(`[data-gallery-tile="${PHOTOS[0]!.url}"]`)!));
    await act(async () => fireEvent.click(btn('儲存順序')));
    expect(view.container.querySelector('[role="status"]')!.textContent).toBe('供應商剛更新了照片，請重新整理再排。');
    expect(view.container.textContent).toContain('尚未儲存');
  });

  it('隱藏供應商照片 ⇒ set_hidden true;刪除我們上傳的 ⇒ remove', async () => {
    m.hidden.mockResolvedValueOnce({ ok: true, curated: true, photos: [PHOTOS[0]!, { ...PHOTOS[1]!, hidden: true }] });
    m.remove.mockResolvedValueOnce({ ok: true, curated: true, photos: [{ ...PHOTOS[1]!, hidden: true }] });
    const { view, btn } = setup();
    await act(async () => fireEvent.click(btn('隱藏', view.container.querySelector(`[data-gallery-tile="${PHOTOS[1]!.url}"]`)!)));
    expect(m.hidden).toHaveBeenCalledWith(PID, PHOTOS[1]!.url, true);
    expect(view.container.querySelector('[data-gallery-hidden]')).not.toBeNull();
    fireEvent.click(btn('刪除', view.container.querySelector(`[data-gallery-tile="${PHOTOS[0]!.url}"]`)!));
    await act(async () => fireEvent.click(btn('確定刪除')));
    expect(m.remove).toHaveBeenCalledWith(PID, A);
  });

  it('🔴 上傳:每張先縮小再一張一張送, FormData 帶商品 id', async () => {
    m.upload.mockResolvedValue({ ok: true, curated: true, photos: PHOTOS });
    const { view } = setup();
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const f1 = new File(['1'], '正面.png', { type: 'image/png' });
    const f2 = new File(['2'], '側面.jpg', { type: 'image/jpeg' });
    await act(async () => fireEvent.change(input, { target: { files: [f1, f2] } }));
    expect(m.shrink).toHaveBeenCalledTimes(2);
    expect(m.upload).toHaveBeenCalledTimes(2);
    const sent = m.upload.mock.calls[0]![0] as FormData;
    expect(sent.get('product_id')).toBe(PID);
    expect((sent.get('file') as File).name).toBe('正面.jpg');
  });

  it('上傳到第二張失敗 ⇒ 停下並顯示原因(第一張已經上傳)', async () => {
    m.upload
      .mockResolvedValueOnce({ ok: true, curated: true, photos: PHOTOS })
      .mockResolvedValueOnce({ ok: false, message: '照片空間尚未設定，暫時無法上傳。' });
    const { view } = setup();
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () =>
      fireEvent.change(input, {
        target: { files: [new File(['1'], 'a.jpg', { type: 'image/jpeg' }), new File(['2'], 'b.jpg', { type: 'image/jpeg' })] },
      }),
    );
    expect(view.container.querySelector('[role="status"]')!.textContent).toBe('照片空間尚未設定，暫時無法上傳。');
  });
});

describe('尚未整理(G2 6f44e9ff)', () => {
  const RAW: GalleryPhoto[] = [
    { id: null, url: 'https://cdn.sup/1.jpg', source: 'supplier', position: 0, hidden: false },
    { id: null, url: 'https://cdn.sup/2.jpg', source: 'supplier', position: 1, hidden: false },
  ];

  it('🔴 尚未整理 ⇒ 顯示說明;第一次存好之後(已整理)說明消失', async () => {
    m.reorder.mockResolvedValueOnce({ ok: true, curated: true, photos: [
      { ...RAW[1]!, id: 'x1', position: 0 }, { ...RAW[0]!, id: 'x2', position: 1 },
    ] });
    const view = render(<ProductGalleryPanel productId={PID} initialPhotos={RAW} initialCurated={false} />);
    expect(view.container.querySelector('[data-gallery-notice]')!.textContent).toContain('尚未整理，這是目前網站顯示的供應商照片');
    const tile = view.container.querySelector('[data-gallery-tile="https://cdn.sup/2.jpg"]')!;
    fireEvent.click([...tile.querySelectorAll('button')].find((b) => b.textContent === '設為封面')!);
    await act(async () => fireEvent.click([...view.container.querySelectorAll('button')].find((b) => b.textContent === '儲存順序')!));
    expect(m.reorder).toHaveBeenCalledWith(PID, ['https://cdn.sup/2.jpg', 'https://cdn.sup/1.jpg']);
    expect(view.container.querySelector('[data-gallery-notice]')).toBeNull();
  });

  it('🔴 排序送出的是全部照片:已隱藏的照原順序接在後面', async () => {
    m.reorder.mockResolvedValueOnce({ ok: true, curated: true, photos: PHOTOS });
    const withHidden: GalleryPhoto[] = [...PHOTOS, { id: 'h', url: 'https://img/h.jpg', source: 'supplier', position: 2, hidden: true }];
    const view = render(<ProductGalleryPanel productId={PID} initialPhotos={withHidden} initialCurated />);
    const tile = view.container.querySelector(`[data-gallery-tile="${PHOTOS[0]!.url}"]`)!;
    fireEvent.click([...tile.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '往後移一張')!);
    await act(async () => fireEvent.click([...view.container.querySelectorAll('button')].find((b) => b.textContent === '儲存順序')!));
    expect(m.reorder).toHaveBeenCalledWith(PID, [PHOTOS[1]!.url, PHOTOS[0]!.url, 'https://img/h.jpg']);
  });
});

describe('商品頁乙 P7:網站新增的手動商品(pcm)', () => {
  it('還沒有照片 ⇒ 說「還沒有照片」,不說供應商照片;底下說明也沒有供應商那段', () => {
    const { container } = render(<ProductGalleryPanel productId={PID} initialPhotos={[]} initialCurated={false} manual />);
    const text = container.textContent ?? '';
    expect(text).toContain('還沒有照片。上傳之後可以在這裡刪除和調整順序。');
    expect(text).toContain('這件是網站新增的商品，沒有供應商照片。');
    expect(text).not.toContain('供應商的照片是每天同步');
    expect(text).not.toContain('尚未整理，這是目前網站顯示的供應商照片');
  });

  it('同步商品照舊:尚未整理時說供應商照片', () => {
    const { container } = render(<ProductGalleryPanel productId={PID} initialPhotos={PHOTOS} initialCurated={false} />);
    expect(container.textContent).toContain('尚未整理，這是目前網站顯示的供應商照片');
  });
});
