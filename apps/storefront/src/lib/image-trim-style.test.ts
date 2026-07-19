// computeTrimStyle 單測 — 去白邊置中數學與縮放上限(trim 線 S4b、plan §5)。

import { describe, expect, it } from 'vitest';

import { computeTrimStyle, TRIM_MAX_IMG_WIDTH_PCT } from './image-trim-style';

describe('computeTrimStyle', () => {
  it('方圖置中內容框:內容佔框 92%、左右均分裁掉白邊', () => {
    // 1000×1000、內容框 l=0.1 t=0.1 w=0.5 h=0.5 → hEff=0.5、img 寬=92/0.5=184%
    const s = computeTrimStyle({ l: 0.1, t: 0.1, w: 0.5, h: 0.5, nw: 1000, nh: 1000 })!;
    expect(s.width).toBe('184%');
    // left = (100-92)/2 - 0.1*184 = -14.4
    expect(s.left).toBe('-14.4%');
    expect(s.top).toBe('-14.4%');
  });

  it('寬圖(2:1):寬向主導、內容寬=92% 框', () => {
    // nw=2000 nh=1000、w=0.8 h=0.6 → hEff=0.6*0.5=0.3、max=0.8、img 寬=115%
    const s = computeTrimStyle({ l: 0.1, t: 0.2, w: 0.8, h: 0.6, nw: 2000, nh: 1000 })!;
    expect(s.width).toBe('115%');
    // content width = 0.8*115 = 92 → left = 4 - 0.1*115 = -7.5
    expect(s.left).toBe('-7.5%');
    // content height = 0.3*115 = 34.5 → top = (100-34.5)/2 - 0.2*115*0.5 = 32.75 - 11.5 = 21.25
    expect(s.top).toBe('21.25%');
  });

  it('直圖(1:2):高向主導', () => {
    // nw=1000 nh=2000、w=0.6 h=0.8 → hEff=1.6、img 寬=92/1.6=57.5%
    const s = computeTrimStyle({ l: 0.2, t: 0.05, w: 0.6, h: 0.8, nw: 1000, nh: 2000 })!;
    expect(s.width).toBe('57.5%');
    // content width = 0.6*57.5 = 34.5 → left = 32.75 - 0.2*57.5 = 21.25
    expect(s.left).toBe('21.25%');
    // content height = 1.6*57.5 = 92 → top = 4 - 0.05*57.5*2 = -1.75
    expect(s.top).toBe('-1.75%');
  });

  it('內容過小(縮放超 300% 上限)→ undefined(cover fallback)', () => {
    // w=h=0.2(方圖)→ img 寬=460% > 300 → undefined
    expect(computeTrimStyle({ l: 0.4, t: 0.4, w: 0.2, h: 0.2, nw: 1000, nh: 1000 })).toBeUndefined();
    expect(TRIM_MAX_IMG_WIDTH_PCT).toBe(300);
  });

  it('異常數值(零維度)→ undefined、不 throw', () => {
    expect(computeTrimStyle({ l: 0, t: 0, w: 0, h: 0.5, nw: 1000, nh: 1000 })).toBeUndefined();
    expect(computeTrimStyle({ l: 0, t: 0, w: 0.5, h: 0.5, nw: 0, nh: 1000 })).toBeUndefined();
  });

  it('無白邊全幅內容(w=h=1、方圖)→ 92% 等比縮小置中(白底 letterbox)', () => {
    const s = computeTrimStyle({ l: 0, t: 0, w: 1, h: 1, nw: 800, nh: 800 })!;
    expect(s.width).toBe('92%');
    expect(s.left).toBe('4%');
    expect(s.top).toBe('4%');
    expect(s.transformOrigin).toBe('50% 50%');
  });

  it('偏心 bbox:縮放原點=內容框中心(codex S4b MF-1 極端案例;預設 img 中心會 scale 出框)', () => {
    // codex 構造反例:l=0.8 t=0.9 w=0.2 h=0.1、250×1000 直圖 → 通過 parser 與 300% 上限
    const s = computeTrimStyle({ l: 0.8, t: 0.9, w: 0.2, h: 0.1, nw: 250, nh: 1000 })!;
    // hEff=0.1*4=0.4、max=0.4 → img 寬 230%(≤300 上限內)
    expect(s.width).toBe('230%');
    // 原點=內容框中心 (0.8+0.1, 0.9+0.05) → '90% 95%':scale 以內容為軸、不把內容推出卡框
    expect(s.transformOrigin).toBe('90% 95%');
  });
});
