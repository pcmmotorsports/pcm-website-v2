import { describe, expect, it } from 'vitest';

import {
  MIN_CONTENT_WIDTH,
  MIN_PANEL_WIDTH,
  clampPanelWidth,
  defaultPanelWidth,
  parsePanelWidthCookie,
} from './workspace-panel';

// workspace-panel.test.ts — #350b。
//
// 🔴 本檔只測**不需要瀏覽器就能判對錯**的那半(夾範圍 / cookie 解析)。
//    拖曳、`:has()` 切換、重整後寬度真的還在 —— 那些要真瀏覽器,已掛 350c 驗收清單。
//    **不要把本檔全綠讀成「分割視窗可用」。**

describe('clampPanelWidth — 上下限', () => {
  it('一般情況:夾在 [MIN_PANEL_WIDTH, 視窗 - MIN_CONTENT_WIDTH]', () => {
    expect(clampPanelWidth(600, 1600)).toBe(600);
    expect(clampPanelWidth(50, 1600)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(5000, 1600)).toBe(1600 - MIN_CONTENT_WIDTH);
  });

  it('🔴 上限由「內容區至少留多少」反推,不是寫死面板最大 px', () => {
    // 同一個「想要 900」在不同視窗下有不同答案 —— 寫死面板上限的話這格會紅。
    // 1600 視窗:上限 = 1600-480 = 1120 ⇒ 想要 1500 被夾到 1120。
    expect(clampPanelWidth(1500, 1600)).toBe(1600 - MIN_CONTENT_WIDTH);
    // 2400 視窗:上限 = 1920 ⇒ 同一個 1500 不必夾。
    expect(clampPanelWidth(1500, 2400)).toBe(1500);
  });

  it('🔴 視窗太窄、兩個下限打架時 → **下限贏**(面板寧可佔滿也不要縮成不能用的一條)', () => {
    // 視窗 600:上限算出來是 600-480=120 < MIN_PANEL_WIDTH(320)。
    expect(clampPanelWidth(400, 600)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(50, 600)).toBe(MIN_PANEL_WIDTH);
  });

  it('🔴🔴 非有限值(cookie 被手改成 abc / Infinity)→ 回可用寬度,**絕不回 NaN**', () => {
    // NaN 進 CSS 變數會讓整條版面靜默塌掉 —— 那是看不見的壞法。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const w = clampPanelWidth(bad, 1600);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);
      expect(w).toBeLessThanOrEqual(1600 - MIN_CONTENT_WIDTH);
    }
  });

  it('回整數(半像素會讓 CSS 變數帶小數、不同瀏覽器捨入不一致)', () => {
    expect(Number.isInteger(clampPanelWidth(600.4, 1600))).toBe(true);
  });
});

describe('defaultPanelWidth — Sean 逐字「大約是現在視窗的一半」', () => {
  it('是視窗的一半', () => {
    expect(defaultPanelWidth(1600)).toBe(800);
    // 🔴 刪掉了 `expect(DEFAULT_PANEL_RATIO).toBe(0.5)` —— 常數自證自己,零判別力
    //    (上一行已經涵蓋「一半」這個行為)。
  });

  it('🔴 預設值仍會被夾(小視窗下不得吐出一個超過上限的數)', () => {
    expect(clampPanelWidth(defaultPanelWidth(1600), 1600)).toBe(800);
    // 900 視窗:一半 = 450,但上限 = 900-480 = 420 ⇒ 被上限夾成 420(不是下限)。
    expect(clampPanelWidth(defaultPanelWidth(900), 900)).toBe(900 - MIN_CONTENT_WIDTH);
  });
});

describe('parsePanelWidthCookie — 沒有偏好要回 null,不要猜', () => {
  it('正常值', () => {
    expect(parsePanelWidthCookie('742')).toBe(742);
  });

  it.each([
    ['未設定', undefined],
    ['空字串', ''],
    ['非數字', 'abc'],
    ['零', '0'],
    ['負數', '-500'],
  ])('🔴 %s → null(= 沒有偏好,交給 client 依視窗算)', (_name, raw) => {
    expect(parsePanelWidthCookie(raw)).toBeNull();
  });

});
