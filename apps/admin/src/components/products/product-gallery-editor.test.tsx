// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ProductGalleryEditor } from './product-gallery-editor';
import { GalleryUserError, type GalleryPhoto } from '../../lib/products/product-gallery';

// product-gallery-editor.test.tsx — 共用圖庫 G5 畫面元件(假資料;還沒接報價單 API)。

afterEach(cleanup);

const PHOTOS: GalleryPhoto[] = [
  { id: 'front', url: 'https://img.example/front.webp', source: 'staff', position: 0, hidden: false },
  { id: 'side', url: 'https://img.example/side.webp', source: 'staff', position: 1, hidden: false },
  { id: 'supA', url: 'https://img.example/a.jpg', source: 'supplier', position: 2, hidden: false },
  { id: 'supC', url: 'https://img.example/c.jpg', source: 'supplier', position: 3, hidden: true },
];

function setup(photos = PHOTOS) {
  const h = {
    onSaveOrder: vi.fn(async (_ids: string[]) => {}),
    onDelete: vi.fn(async (_id: string) => {}),
    onHide: vi.fn(async (_id: string) => {}),
    onUnhide: vi.fn(async (_id: string) => {}),
    onUpload: vi.fn(async (_files: File[]) => {}),
  };
  const view = render(<ProductGalleryEditor photos={photos} {...h} />);
  const tiles = () => [...view.container.querySelectorAll<HTMLElement>('[data-gallery-tile]')];
  const order = () => tiles().map((t) => t.dataset.galleryTile);
  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text);
  return { ...h, view, tiles, order, button };
}

describe('顯示', () => {
  it('照順序排、編號、第 1 張標封面;來源標籤;我們上傳的可刪、供應商的可隱藏', () => {
    const { tiles, order, button } = setup();
    expect(order()).toEqual(['front', 'side', 'supA']);
    const [t0, t1, t2] = tiles();
    expect(t0!.querySelector('[data-gallery-n]')!.textContent).toBe('1');
    // 看封面標籤本身, 不看整格文字(「設為封面」按鈕也含「封面」兩字)
    expect(t0!.querySelector('[data-gallery-cover]')!.textContent).toBe('封面');
    expect(t1!.querySelector('[data-gallery-cover]')).toBeNull();
    expect(t0!.textContent).toContain('我們上傳');
    expect(t2!.textContent).toContain('供應商');
    expect(button(t0!, '刪除')).toBeDefined();
    expect(button(t0!, '隱藏')).toBeUndefined();
    expect(button(t2!, '隱藏')).toBeDefined();
    expect(button(t2!, '刪除')).toBeUndefined();
    // 第 1 張已經是封面, 不給「設為封面」
    expect(button(t0!, '設為封面')).toBeUndefined();
    expect(button(t1!, '設為封面')).toBeDefined();
  });

  it('已隱藏的供應商照片在另一區, 可以取消隱藏', async () => {
    const { view, onUnhide, button } = setup();
    const hidden = view.container.querySelector('[data-gallery-hidden]')!;
    expect(hidden.textContent).toContain('已隱藏的供應商照片（1 張）');
    await act(async () => fireEvent.click(button(hidden, '取消隱藏')!));
    expect(onUnhide).toHaveBeenCalledWith('supC');
  });

  it('沒有任何照片 ⇒ 講清楚, 只剩上傳', () => {
    const { view } = setup([]);
    expect(view.container.textContent).toContain('這件商品還沒有照片');
    expect(view.container.querySelector('input[type="file"]')).not.toBeNull();
  });
});

describe('調整順序', () => {
  it('往後移 ⇒ 順序變、出現「尚未儲存」;儲存 ⇒ 送出新順序', async () => {
    const { view, order, tiles, button, onSaveOrder } = setup();
    const save = button(view.container, '儲存順序')!;
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button(tiles()[0]!, '往後移一張')!);
    expect(order()).toEqual(['side', 'front', 'supA']);
    expect(view.container.textContent).toContain('順序已變更，尚未儲存');
    // 封面標籤跟著第 1 張走
    expect(tiles()[0]!.querySelector('[data-gallery-cover]')).not.toBeNull();
    expect(tiles()[1]!.querySelector('[data-gallery-cover]')).toBeNull();
    expect(save.hasAttribute('disabled')).toBe(false);
    await act(async () => fireEvent.click(save));
    expect(onSaveOrder).toHaveBeenCalledWith(['side', 'front', 'supA']);
    expect(view.container.textContent).toContain('順序已儲存');
    expect(view.container.textContent).not.toContain('尚未儲存');
  });

  it('設為封面 ⇒ 移到第 1 張;取消變更 ⇒ 回到原本', () => {
    const { view, order, tiles, button } = setup();
    fireEvent.click(button(tiles()[2]!, '設為封面')!);
    expect(order()).toEqual(['supA', 'front', 'side']);
    fireEvent.click(button(view.container, '取消變更')!);
    expect(order()).toEqual(['front', 'side', 'supA']);
    expect(view.container.textContent).not.toContain('尚未儲存');
  });

  it('第 1 張沒有「往前移」、最後一張沒有「往後移」可按', () => {
    const { tiles, button } = setup();
    expect(button(tiles()[0]!, '往前移一張')!.hasAttribute('disabled')).toBe(true);
    expect(button(tiles()[2]!, '往後移一張')!.hasAttribute('disabled')).toBe(true);
  });

  it('🔴 用手指 / 滑鼠拖曳把手(pointer 事件)⇒ 拖到哪張就排到哪', () => {
    const { tiles, order } = setup();
    const handle = tiles()[0]!.querySelector<HTMLElement>('[data-gallery-handle]')!;
    // 把手要擋掉瀏覽器的觸控捲動, 手指拖曳才不會變成捲頁
    expect(handle.style.touchAction).toBe('none');
    const target = tiles()[2]!;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => target;
    try {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 10 });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400, clientY: 10 });
    } finally {
      document.elementFromPoint = orig;
    }
    expect(order()).toEqual(['side', 'supA', 'front']);
  });

  it('🔴 拖曳途中移動事件不在把手上(格子被搬動後瀏覽器放掉 capture)⇒ 仍然一路跟到放開的位置', () => {
    // 2026-09-27 真瀏覽器實測的病:move 只聽在把手上時, 拖過第一格就停住
    const photos: GalleryPhoto[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id,
      url: `https://img.example/${id}.webp`,
      source: 'staff',
      position: i,
      hidden: false,
    }));
    const { tiles, order } = setup(photos);
    const handle = tiles()[0]!.querySelector<HTMLElement>('[data-gallery-handle]')!;
    const orig = document.elementFromPoint;
    try {
      fireEvent.pointerDown(handle, { pointerId: 1 });
      for (const overId of ['b', 'c', 'd']) {
        const over = tiles().find((t) => t.dataset.galleryTile === overId)!;
        document.elementFromPoint = () => over;
        fireEvent.pointerMove(over, { pointerId: 1 }); // 事件落在格子上, 不在把手上
      }
      fireEvent.pointerUp(document.body, { pointerId: 1 });
    } finally {
      document.elementFromPoint = orig;
    }
    expect(order()).toEqual(['b', 'c', 'd', 'a']);
    // 放開之後再移動不會再動順序
    document.elementFromPoint = () => tiles()[0]!;
    fireEvent.pointerMove(document.body, { pointerId: 1 });
    document.elementFromPoint = orig;
    expect(order()).toEqual(['b', 'c', 'd', 'a']);
  });

  it('儲存失敗 ⇒ 說失敗、順序留著可以再按一次', async () => {
    const { view, tiles, button, onSaveOrder } = setup();
    onSaveOrder.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(button(tiles()[0]!, '往後移一張')!);
    await act(async () => fireEvent.click(button(view.container, '儲存順序')!));
    expect(view.container.textContent).toContain('順序儲存失敗');
    expect(view.container.textContent).toContain('尚未儲存');
  });

  it('🔴 順序還沒存時, 刪除、隱藏、上傳先鎖住(避免存到一半的順序跟著別的動作亂掉)', () => {
    const { view, tiles, button } = setup();
    fireEvent.click(button(tiles()[0]!, '往後移一張')!);
    expect(button(tiles()[0]!, '刪除')!.hasAttribute('disabled')).toBe(true);
    expect(button(tiles()[2]!, '隱藏')!.hasAttribute('disabled')).toBe(true);
    expect(view.container.querySelector('input[type="file"]')!.hasAttribute('disabled')).toBe(true);
    expect(view.container.textContent).toContain('請先儲存或取消順序變更');
  });
});

describe('刪除、隱藏、上傳', () => {
  it('刪除要再確認一次;確認後才送出', async () => {
    const { tiles, button, onDelete } = setup();
    fireEvent.click(button(tiles()[1]!, '刪除')!);
    expect(onDelete).not.toHaveBeenCalled();
    expect(tiles()[1]!.textContent).toContain('確定刪除這張照片？');
    await act(async () => fireEvent.click(button(tiles()[1]!, '確定刪除')!));
    expect(onDelete).toHaveBeenCalledWith('side');
  });

  it('隱藏供應商照片', async () => {
    const { tiles, button, onHide } = setup();
    await act(async () => fireEvent.click(button(tiles()[2]!, '隱藏')!));
    expect(onHide).toHaveBeenCalledWith('supA');
  });

  it('上傳:只送出 JPG / PNG / WebP, 其他的列出原因', async () => {
    const { view, onUpload } = setup();
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
    expect(input.multiple).toBe(true);
    const ok = new File(['x'], '安裝後.jpg', { type: 'image/jpeg' });
    const bad = new File(['x'], '側面-原檔.heic', { type: 'image/heic' });
    await act(async () => fireEvent.change(input, { target: { files: [ok, bad] } }));
    expect(onUpload).toHaveBeenCalledWith([ok]);
    expect(view.container.textContent).toContain('「側面-原檔.heic」沒有上傳');
  });
});

describe('接上報價單之後的錯誤訊息', () => {
  it('呼叫端丟 GalleryUserError ⇒ 畫面顯示它的訊息(例如排序衝突)', async () => {
    const { view, tiles, button, onSaveOrder } = setup();
    onSaveOrder.mockRejectedValueOnce(new GalleryUserError('供應商剛更新了照片，請重新整理再排。'));
    fireEvent.click(button(tiles()[0]!, '往後移一張')!);
    await act(async () => fireEvent.click(button(view.container, '儲存順序')!));
    expect(view.container.querySelector('[role="status"]')!.textContent).toBe('供應商剛更新了照片，請重新整理再排。');
  });
});
