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
  const view = render(<ProductGalleryPanel productId={PID} initialPhotos={PHOTOS} />);
  const order = () => [...view.container.querySelectorAll<HTMLElement>('[data-gallery-tile]')].map((t) => t.dataset.galleryTile);
  const btn = (text: string, root: ParentNode = view.container) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)!;
  return { view, order, btn };
}

describe('ProductGalleryPanel', () => {
  it('儲存順序 ⇒ 呼叫 action(商品 id + 新順序), 畫面換成回傳的照片', async () => {
    m.reorder.mockResolvedValueOnce({
      ok: true,
      photos: [
        { ...PHOTOS[1]!, position: 0 },
        { ...PHOTOS[0]!, position: 1 },
      ],
    });
    const { view, order, btn } = setup();
    fireEvent.click(btn('往後移一張', view.container.querySelector(`[data-gallery-tile="${A}"]`)!));
    await act(async () => fireEvent.click(btn('儲存順序')));
    expect(m.reorder).toHaveBeenCalledWith(PID, [B, A]);
    expect(order()).toEqual([B, A]);
    expect(view.container.textContent).toContain('順序已儲存');
  });

  it('🔴 排序衝突 ⇒ 顯示 action 回的話, 順序留著沒存', async () => {
    m.reorder.mockResolvedValueOnce({ ok: false, message: '供應商剛更新了照片，請重新整理再排。' });
    const { view, btn } = setup();
    fireEvent.click(btn('往後移一張', view.container.querySelector(`[data-gallery-tile="${A}"]`)!));
    await act(async () => fireEvent.click(btn('儲存順序')));
    expect(view.container.querySelector('[role="status"]')!.textContent).toBe('供應商剛更新了照片，請重新整理再排。');
    expect(view.container.textContent).toContain('尚未儲存');
  });

  it('隱藏供應商照片 ⇒ set_hidden true;刪除我們上傳的 ⇒ remove', async () => {
    m.hidden.mockResolvedValueOnce({ ok: true, photos: [PHOTOS[0]!, { ...PHOTOS[1]!, hidden: true }] });
    m.remove.mockResolvedValueOnce({ ok: true, photos: [{ ...PHOTOS[1]!, hidden: true }] });
    const { view, btn } = setup();
    await act(async () => fireEvent.click(btn('隱藏', view.container.querySelector(`[data-gallery-tile="${B}"]`)!)));
    expect(m.hidden).toHaveBeenCalledWith(PID, B, true);
    expect(view.container.querySelector('[data-gallery-hidden]')).not.toBeNull();
    fireEvent.click(btn('刪除', view.container.querySelector(`[data-gallery-tile="${A}"]`)!));
    await act(async () => fireEvent.click(btn('確定刪除')));
    expect(m.remove).toHaveBeenCalledWith(PID, A);
  });

  it('🔴 上傳:每張先縮小再一張一張送, FormData 帶商品 id', async () => {
    m.upload.mockResolvedValue({ ok: true, photos: PHOTOS });
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
      .mockResolvedValueOnce({ ok: true, photos: PHOTOS })
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
