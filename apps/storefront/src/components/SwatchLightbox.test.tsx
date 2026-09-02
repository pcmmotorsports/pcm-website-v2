// @vitest-environment jsdom
//
// SwatchLightbox smoke test — 共用紋路樣品放大 lightbox(Fix B 抽出、ProductSwatchPreview + ProductSwatchWall 共用)。
// 驗 null 不渲染 / 開啟顯正確樣品圖 + caption + counter / 箭頭無限輪播 / 上下滑關閉手勢 / 點空白關。
// controlled(lbIdx + setLbIdx),用 stateful harness 測導覽。
// Sean 2026-07-09 手機肉眼驗:箭頭改無限輪播(不再邊界 disabled)+ 上下滑關閉(useLightboxSwipe)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { SwatchLightbox } from './SwatchLightbox';
import { RPM_SWATCHES } from '../data/rpm-swatches';

afterEach(cleanup);

function Harness({ start }: { start: number | null }) {
  const [lbIdx, setLbIdx] = useState<number | null>(start);
  return <SwatchLightbox swatches={RPM_SWATCHES} lbIdx={lbIdx} setLbIdx={setLbIdx} />;
}

const total = String(RPM_SWATCHES.length).padStart(2, '0');

describe('SwatchLightbox', () => {
  it('renders nothing when lbIdx is null', () => {
    render(<Harness start={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog with the swatch image + caption + counter when open', () => {
    render(<Harness start={0} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.pd-lb-stage img')?.getAttribute('src')).toBe(RPM_SWATCHES[0]!.img);
    expect(dialog.querySelector('.pd-lb-caption')?.textContent).toContain(RPM_SWATCHES[0]!.name);
    expect(screen.getByText(`01 / ${total}`)).toBeDefined();
  });

  it('right arrow advances index', () => {
    render(<Harness start={0} />);
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText(`02 / ${total}`)).toBeDefined();
  });

  it('arrows loop infinitely instead of disabling at bounds (Sean 2026-07-09)', () => {
    render(<Harness start={0} />);
    // 左箭頭在第一張不再 disabled → 無限輪播回最後一張
    expect(screen.getByLabelText('上一張').hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByLabelText('上一張'));
    expect(screen.getByText(`${total} / ${total}`)).toBeDefined();
    // 最後一張再按右 → 回第一張
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText(`01 / ${total}`)).toBeDefined();
  });

  // Sean 2026-07-19:鍵盤原本獨走 clamp、與箭頭/滑動不一致 → 改走同一支 lbNext/lbPrev。
  it('鍵盤 ←/→ 與箭頭同語意無限輪播', () => {
    render(<Harness start={0} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText(`${total} / ${total}`)).toBeDefined();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(`01 / ${total}`)).toBeDefined();
  });

  it('dismisses on a large vertical swipe-down (上下滑關閉)', () => {
    render(<Harness start={1} />);
    const stage = document.querySelector('.pd-lb-stage')!;
    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 100 }] });
    // touchMove 鎖軸為垂直(dy 遠大於 dx),再 touchEnd 拖過門檻 → 關閉
    fireEvent.touchMove(stage, { touches: [{ clientX: 205, clientY: 420 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 205, clientY: 420 }] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT dismiss on a small vertical nudge (避免手滑誤關)', () => {
    render(<Harness start={1} />);
    const stage = document.querySelector('.pd-lb-stage')!;
    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 200, clientY: 158 }] }); // dy≈58,未過門檻
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 200, clientY: 158 }] });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('touchcancel resets the drag (系統中斷不留殘影、不誤關 F1)', () => {
    render(<Harness start={1} />);
    const stage = document.querySelector('.pd-lb-stage') as HTMLElement;
    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(stage, { touches: [{ clientX: 205, clientY: 260 }] }); // 垂直拖曳中 → transform 已設
    expect(stage.style.transform).not.toBe('');
    fireEvent.touchCancel(stage); // 系統搶走手勢
    expect(stage.style.transform).toBe(''); // 復位、不留半拖殘影
    expect(screen.queryByRole('dialog')).not.toBeNull(); // 未關閉
  });

  it('closes when backdrop clicked', () => {
    render(<Harness start={2} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * ⟦fc-FOCUSTRAP⟧ 而本支的風險與其餘幾支不同:**它的 keydown 裡已經有 `ArrowLeft/Right` 換圖。**
   *
   * 🔴 循環那段若插在左右鍵**之前**並 return ⇒ 左右鍵失效
   *    ⇒ ⇒ 而那個壞法是「**客人打不開下一張圖**」而測試全綠 —— 因為沒有人問過左右鍵。
   * ✅ 所以下面第一格是**必要守門**,而它守的不是新功能,是【新功能沒有弄壞舊功能】。
   */
  describe('⟦fc-FOCUSTRAP⟧', () => {
    it('🔴 加了 Tab 循環之後, 左右鍵仍然換得了圖(這一格守的是【沒弄壞】)', () => {
      render(<Harness start={0} />);
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByText(`02 / ${total}`), '循環插錯位置 ⇒ 左右鍵失效, 而畫面看起來只是「沒反應」').toBeDefined();
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(screen.getByText(`01 / ${total}`)).toBeDefined();
    });

    it('🔴 焦點在最後一個 → Tab → 回到第一個(不得走出 lightbox)', () => {
      render(<Harness start={0} />);
      const lb = screen.getByRole('dialog');
      const f = [...lb.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])')];
      // 🟢 正對照:少於 2 個 ⇒ 下面那格恆真
      expect(f.length, 'lightbox 內可聚焦少於 2 個 ⇒ 證不到循環').toBeGreaterThan(1);
      const last = f[f.length - 1]!;
      last.focus();
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(document.activeElement, 'Tab 走出了 lightbox ⇒ 客人掉到背後那 51 個元素裡').toBe(f[0]);
    });

    it('🔵 Escape 仍然關得掉(既有行為, 這一片不得弄壞)', () => {
      render(<Harness start={1} />);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
