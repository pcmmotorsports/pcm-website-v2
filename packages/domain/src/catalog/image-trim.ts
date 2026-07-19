/**
 * image-trim — 商品卡去白邊 bbox 的共用 runtime parser(單一來源;codex 關卡2 MF-2)。
 *
 * plan 真權威 = docs/specs/2026-07-19-product-image-trim-plan.md v1.1 §5。
 * wire 形狀 = DB `product_image_trim` 經 RPC `card_image_trim` jsonb 鍵 / `products_public.card_image_trim`
 * 欄輸出的 `{l,t,w,h,nw,nh}`(migration 20260719150000 jsonb_build_object 字面)。
 * 兩條卡片資料路(catalogRowToUIProduct / adapter→toUIProduct)都必須經本 parser,
 * 不得各自手寫收斂(防前端吃髒數據放大破版;plan §5 clamp 集)。
 *
 * clamp 規則(任一不過=整包丟棄回 null → 前端走現狀 cover fallback):
 *   l,t ∈ [0,1) / w,h ∈ (0,1] / l+w ≤ 1 / t+h ≤ 1 / nw,nh 為正整數。
 * 縮放倍率上限(3×)屬 UI 樣式層(computeTrimStyle)、不在本 parser。
 */

/** 商品卡片圖去白邊內容框(0..1 比例)+ EXIF rotate 後原圖 px 尺寸 */
export type ImageTrim = {
  /** 內容框左緣 / 圖寬 */
  l: number;
  /** 內容框上緣 / 圖高 */
  t: number;
  /** 內容框寬 / 圖寬 */
  w: number;
  /** 內容框高 / 圖高 */
  h: number;
  /** 原圖寬 px */
  nw: number;
  /** 原圖高 px */
  nh: number;
};

const EPS = 1e-9; // numeric(6,5) 5 位小數經 JSON 往返的浮點容差(l+w ≤ 1 邊界)

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * wire jsonb → ImageTrim;非物件 / 缺鍵 / 型別錯 / 超界一律 null(安全方向=前端照舊 cover)。
 */
export function parseImageTrim(raw: unknown): ImageTrim | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const l = finiteNumber(r.l);
  const t = finiteNumber(r.t);
  const w = finiteNumber(r.w);
  const h = finiteNumber(r.h);
  const nw = finiteNumber(r.nw);
  const nh = finiteNumber(r.nh);
  if (l === null || t === null || w === null || h === null || nw === null || nh === null) {
    return null;
  }
  if (l < 0 || l >= 1 || t < 0 || t >= 1) return null;
  if (w <= 0 || w > 1 || h <= 0 || h > 1) return null;
  if (l + w > 1 + EPS || t + h > 1 + EPS) return null;
  // 正整數:對齊 DB natural_width/height integer 欄型(nit:比 plan 字面「>0」嚴、真數據恆滿足)
  if (!Number.isInteger(nw) || !Number.isInteger(nh) || nw <= 0 || nh <= 0) return null;
  return { l, t, w, h, nw, nh };
}
