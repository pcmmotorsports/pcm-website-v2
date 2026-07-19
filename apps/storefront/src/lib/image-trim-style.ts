/**
 * image-trim-style — 商品卡去白邊縮放的版面計算(trim 線 S4b;純函式、jsdom 可測)。
 *
 * plan 真權威 = docs/specs/2026-07-19-product-image-trim-plan.md v1.1 §5。
 * 輸入 = 已經 domain parseImageTrim 收斂的 UIImageTrim(0..1 比例 + rotate 後原圖 px);
 * 輸出 = 正方形卡框內、讓「內容框」等比縮放至佔框 P=92% 置中的 <img> 絕對定位樣式
 * (width/left/top 皆以框邊長 % 表達、免 JS 量測、SSR 同構)。
 *
 * 縮放上限(plan §5 clamp:3×):img 顯示寬 > 300% 框寬=內容過小、放大到糊 → 回 undefined、
 * 呼叫端 fallback 現狀 cover。除法安全:parseImageTrim 已保 w/h>0,此處仍防 NaN/Infinity。
 */

import type { UIImageTrim } from '@/data/mock-products';

/** 內容框佔卡框比例(F3 白底 letterbox 下的視覺目標) */
export const TRIM_CONTENT_RATIO = 0.92;
/** img 顯示寬上限(% 框寬;超過=內容過小、放大失真 → fallback cover) */
export const TRIM_MAX_IMG_WIDTH_PCT = 300;

export type TrimStyle = {
  /** img 顯示寬(% 框寬) */
  width: string;
  /** img 左緣(% 框寬、可為負=裁掉左白邊) */
  left: string;
  /** img 上緣(% 框高、可為負) */
  top: string;
  /**
   * hover scale 的縮放原點=內容框中心(% 相對 img 自身;codex 關卡2 S4b MF-1:
   * 用預設 img 中心時、偏心 bbox 在 scale(1.04) 下內容會被推出卡框裁切)。
   */
  transformOrigin: string;
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * UIImageTrim → 卡框內去白邊置中樣式;內容過小(縮放超上限)/數值異常 → undefined(cover fallback)。
 */
export function computeTrimStyle(trim: UIImageTrim): TrimStyle | undefined {
  const { l, t, w, h, nw, nh } = trim;
  if (nw <= 0 || nh <= 0 || w <= 0 || h <= 0) return undefined;
  // 內容高換算成「框寬 %」座標系(框為正方形、寬高同基準):hEff = h × 圖片高寬比
  const hEff = h * (nh / nw);
  const maxDim = Math.max(w, hEff);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return undefined;
  const imgWidth = (TRIM_CONTENT_RATIO * 100) / maxDim;
  if (!Number.isFinite(imgWidth) || imgWidth <= 0 || imgWidth > TRIM_MAX_IMG_WIDTH_PCT) {
    return undefined;
  }
  const contentWidth = w * imgWidth;
  const contentHeight = hEff * imgWidth;
  const left = (100 - contentWidth) / 2 - l * imgWidth;
  const top = (100 - contentHeight) / 2 - t * imgWidth * (nh / nw);
  return {
    width: `${round3(imgWidth)}%`,
    left: `${round3(left)}%`,
    top: `${round3(top)}%`,
    transformOrigin: `${round3((l + w / 2) * 100)}% ${round3((t + h / 2) * 100)}%`,
  };
}
