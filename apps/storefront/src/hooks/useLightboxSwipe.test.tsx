// @vitest-environment jsdom
//
// useLightboxSwipe 手勢狀態機測(V-2g pinch-zoom + 既有 swipe 回歸)。
// 🔴 誠實邊界:pinch/pan 的「手感」(慣性/門檻/邊界)= Sean 真機驗收點(jsdom 無真實觸控/版面、
//   clampPan 的 getBoundingClientRect=0);此測只鎖「狀態機轉移」= scale 計算 / zoom↔swipe 互斥 /
//   reset / 既有 dismiss·nav 不回歸(=可靠可驗部分,對齊 V-1f/V-2d 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useLightboxSwipe } from './useLightboxSwipe';

function Harness(props: {
  count?: number;
  onDismiss?: () => void;
  goNext?: () => void;
  goPrev?: () => void;
  withImage?: boolean;
}) {
  const s = useLightboxSwipe({
    count: props.count ?? 3,
    goNext: props.goNext ?? (() => {}),
    goPrev: props.goPrev ?? (() => {}),
    onDismiss: props.onDismiss ?? (() => {}),
  });
  return (
    <div ref={s.overlayRef}>
      <div data-testid="stage" ref={s.stageRef} {...s.stageProps}>
        {(props.withImage ?? true) && <img data-testid="img" ref={s.imageRef} alt="" />}
      </div>
      <button data-testid="reset" type="button" onClick={() => s.resetZoom()} />
    </div>
  );
}

const two = (x1: number, x2: number, y = 100) => [{ clientX: x1, clientY: y }, { clientX: x2, clientY: y }];
const one = (x: number, y: number) => [{ clientX: x, clientY: y }];

afterEach(cleanup);

describe('useLightboxSwipe — V-2g pinch-zoom 狀態機', () => {
  it('雙指張開 → scale 增(transform 套 imageRef)', () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId('stage');
    const img = getByTestId('img') as HTMLImageElement;
    fireEvent.touchStart(stage, { touches: two(100, 200) }); // dist 100
    fireEvent.touchMove(stage, { touches: two(50, 250) }); // dist 200 → scale 1*200/100=2
    expect(img.style.transform).toMatch(/scale\(2/);
  });

  it('雙指縮回 ~1 → touchend 貼回 1、transform 清空', () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId('stage');
    const img = getByTestId('img') as HTMLImageElement;
    fireEvent.touchStart(stage, { touches: two(50, 250) }); // dist 200
    fireEvent.touchMove(stage, { touches: two(100, 200) }); // dist 100 → scale ~0.9→夾 0.9
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(150, 100) }); // <1.05 → 貼回 1
    expect(img.style.transform).toBe('');
  });

  it('resetZoom → transform 清空(換圖/關閉呼叫)', () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId('stage');
    const img = getByTestId('img') as HTMLImageElement;
    fireEvent.touchStart(stage, { touches: two(100, 200) });
    fireEvent.touchMove(stage, { touches: two(50, 250) });
    expect(img.style.transform).toMatch(/scale\(2/);
    fireEvent.click(getByTestId('reset'));
    expect(img.style.transform).toBe('');
  });

  it('🔴 互斥:已放大時單指垂直滑=平移、不觸發關閉(dismiss)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />);
    const stage = getByTestId('stage');
    fireEvent.touchStart(stage, { touches: two(100, 200) }); // pinch → 放大
    fireEvent.touchMove(stage, { touches: two(50, 250) }); // scale 2
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(150, 100) }); // 留在放大態(scale 2)
    // 放大態單指垂直大幅滑
    fireEvent.touchStart(stage, { touches: one(150, 100) });
    fireEvent.touchMove(stage, { touches: one(150, 600) });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(150, 600) });
    expect(onDismiss).not.toHaveBeenCalled(); // pan、非關閉
  });
});

describe('useLightboxSwipe — 既有 swipe 回歸(scale===1、不放大)', () => {
  it('單指垂直大幅滑放開 → onDismiss(關閉)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />);
    const stage = getByTestId('stage');
    fireEvent.touchStart(stage, { touches: one(100, 80) });
    fireEvent.touchMove(stage, { touches: one(100, 700) }); // dy 620 → 鎖 y、超門檻
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(100, 700) });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('單指水平滑超門檻 → goNext(左滑)', () => {
    const goNext = vi.fn();
    const { getByTestId } = render(<Harness goNext={goNext} count={3} />);
    const stage = getByTestId('stage');
    fireEvent.touchStart(stage, { touches: one(300, 100) });
    fireEvent.touchMove(stage, { touches: one(200, 100) }); // dx -100 水平 → 鎖 x
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(200, 100) });
    expect(goNext).toHaveBeenCalledTimes(1);
  });

  it('無 imageRef(withImage=false)→ 雙指不進 pinch(舊守門、不 throw)、swipe 照舊可關閉', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness onDismiss={onDismiss} withImage={false} />);
    const stage = getByTestId('stage');
    // 雙指:無 imageRef → onTouchStart 落舊守門(mode idle、不 pinch),整段不 throw、不關閉
    fireEvent.touchStart(stage, { touches: two(100, 200) });
    fireEvent.touchMove(stage, { touches: two(50, 250) });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(150, 100) });
    expect(onDismiss).not.toHaveBeenCalled();
    // 之後單指垂直滑仍可關閉(swipe 回歸=zoom 未污染既有行為)
    fireEvent.touchStart(stage, { touches: one(100, 80) });
    fireEvent.touchMove(stage, { touches: one(100, 700) });
    fireEvent.touchEnd(stage, { touches: [], changedTouches: one(100, 700) });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
