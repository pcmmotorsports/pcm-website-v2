// @vitest-environment jsdom
//
// SwatchLightbox smoke test — 共用紋路樣品放大 lightbox(Fix B 抽出、ProductSwatchPreview + ProductSwatchWall 共用)。
// 驗 null 不渲染 / 開啟顯正確樣品圖 + caption + counter / 箭頭導覽 + 邊界 disabled / 點空白關。
// controlled(lbIdx + setLbIdx),用 stateful harness 測導覽。

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

  it('left arrow disabled at first; right arrow advances index', () => {
    render(<Harness start={0} />);
    expect(screen.getByLabelText('上一張').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(screen.getByText(`02 / ${total}`)).toBeDefined();
  });

  it('closes when backdrop clicked', () => {
    render(<Harness start={2} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
