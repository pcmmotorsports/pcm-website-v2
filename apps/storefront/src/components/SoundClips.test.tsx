// @vitest-environment jsdom
//
// SoundClips smoke — 排氣聲浪音檔清單(附件線片 3b-UI)。
// fixtures 驅動:片 3a 的 migration **尚未 apply**,真資料進不來,所以這裡用「真實形狀」的假資料
// (多段 / 無標題 / 逗號分號混雜 / null / [])各一,形狀來源 = 合約 v5 與 E 全量盤實測描述。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SoundClips, type SoundClip } from './SoundClips';

afterEach(cleanup);

/** 真實形狀的 fixtures(akrapovic 一群最多 6 段)。 */
const CLIPS: SoundClip[] = [
  { title: 'Stock', url: 'https://cdn.example/a/stock.wav' },
  { title: 'Slip-On Line, with muffler insert', url: 'https://cdn.example/a/slip-on-with.wav' },
  { title: 'Slip-On Line; without db killer', url: 'https://cdn.example/a/slip-on-without.wav' },
  { title: null, url: 'https://cdn.example/a/unnamed.wav' }, // 實測約 4% 無標題
];

const audios = (c: HTMLElement) => [...c.querySelectorAll('audio')];

describe('SoundClips 空狀態(null ≠ [],但畫面上都是「不渲染」)', () => {
  it.each([
    ['null(14 家恆 null)', null],
    ['undefined(整欄缺)', undefined],
    ['空陣列(akrapovic 但該群無音檔)', []],
  ])('🔴 %s → 整區不渲染,不留空面板', (_label, clips) => {
    const { container } = render(<SoundClips clips={clips as SoundClip[] | null | undefined} />);
    expect(container.querySelector('.pd-panel'), '留下了一個空面板 ⇒ 六家零附件的頁面會多一塊空白框').toBeNull();
    expect(container.textContent).toBe('');
  });

  it('🔴 每一筆的 url 都是空字串 → 一樣整區不渲染(不是有陣列就渲染)', () => {
    const { container } = render(<SoundClips clips={[{ title: 'Stock', url: '' }]} />);
    expect(container.querySelector('.pd-panel')).toBeNull();
  });
});

describe('SoundClips 有資料', () => {
  it('渲染面板 + 眉標,每段一個原生 audio', () => {
    const { container } = render(<SoundClips clips={CLIPS} />);
    expect(screen.getByText('排氣聲浪')).toBeTruthy();
    expect(audios(container).length).toBe(4);
  });

  // 🔴🔴 這條守的是合約 v5 的硬要求:WAV 很大,開一頁商品頁不該吃掉幾十 MB 行動網路。
  it('🔴 每個 audio 都是 preload="none" 且**沒有** autoplay(WAV 大;合約 v5 明文)', () => {
    const { container } = render(<SoundClips clips={CLIPS} />);
    for (const a of audios(container)) {
      expect(a.getAttribute('preload'), 'preload 不是 none ⇒ 一進商品頁就開始下載 WAV').toBe('none');
      expect(a.hasAttribute('autoplay'), '掛了 autoplay ⇒ 一進頁面自動播放並下載').toBe(false);
      expect(a.hasAttribute('controls'), '沒有 controls ⇒ 客人沒有播放鈕').toBe(true);
    }
  });

  it('標題走顯示層中文化;沒命中的逐字保留英文', () => {
    render(<SoundClips clips={CLIPS} />);
    expect(screen.getByText('原廠排氣')).toBeTruthy();
    expect(screen.getByText('Slip-On Line・含消音塞')).toBeTruthy();
    expect(screen.getByText('Slip-On Line・不含消音塞')).toBeTruthy();
  });

  it('🔴 無標題 → 用序號標籤,不編一個假名字、也不留空標籤', () => {
    render(<SoundClips clips={CLIPS} />);
    // 第 4 段無標題 ⇒ 「音檔 4」
    expect(screen.getByText('音檔 4')).toBeTruthy();
  });

  it('🔴 url 逐字進 src(不重寫、不加參數)', () => {
    const { container } = render(<SoundClips clips={CLIPS} />);
    expect(audios(container).map((a) => a.getAttribute('src'))).toEqual(CLIPS.map((c) => c.url));
  });
});
