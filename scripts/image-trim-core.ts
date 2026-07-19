/**
 * image-trim-core — 商品卡去白邊掃描:純邏輯層(worklist 篩選 / bbox 分類 / sharp 量測)
 *
 * plan 真權威 = docs/specs/2026-07-19-product-image-trim-plan.md v1.1 §3。
 * 拆檔理由:entry(image-trim-scan.ts)含網路與 DB 副作用不可單測;本檔函式全部可 vitest
 * 直測(sharp 量測用合成圖 fixture、零網路)。
 *
 * 分類規則(plan §3):
 *   - 裁不動(寬高皆 > NO_TRIM_RATIO)→ 'no_trim'(深底/無白邊圖天然落此;前端照舊 cover)
 *   - bbox 面積 < MIN_AREA_RATIO 或任一維 ≤ 0 → 'failed'(異常、不給前端用)
 *   - 其餘 → 'ok'(附 bbox 0..1 比例 + rotate 後原圖尺寸)
 * sharp 眉角(Fable nit-2/3/4):trimOffsetLeft/Top 回報負值必取絕對值;先 .rotate() 套 EXIF
 * 使 bbox 座標系與瀏覽器顯示一致;background '#ffffff' 指定後深底圖裁不動(非預設左上角色行為)。
 */

import sharp from 'sharp';

/** 增量重試窗:failed 列超過此毫秒數才重試(plan §3=7 天) */
export const FAILED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** 寬高皆大於此比例=裁不動 → no_trim */
export const NO_TRIM_RATIO = 0.97;
/** bbox 面積小於此比例=異常 → failed */
export const MIN_AREA_RATIO = 0.02;
/** trim 背景色與容差(白底商品圖) */
export const TRIM_BACKGROUND = '#ffffff';
export const TRIM_THRESHOLD = 16;

export type TrimStatus = 'ok' | 'no_trim' | 'failed';

export type TrimRow = {
  url: string;
  status: TrimStatus;
  bbox_left: number | null;
  bbox_top: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  natural_width: number | null;
  natural_height: number | null;
};

export type ExistingRow = { url: string; status: TrimStatus; analyzed_at: string };

/** 非 ok 列(DDL bbox_null_unless_ok:bbox 全 NULL) */
export function nonOkRow(url: string, status: 'no_trim' | 'failed'): TrimRow {
  return {
    url,
    status,
    bbox_left: null,
    bbox_top: null,
    bbox_width: null,
    bbox_height: null,
    natural_width: null,
    natural_height: null,
  };
}

/**
 * 增量 worklist:candidate urls(products 首圖、已去重)對照既有列 →
 * 沒掃過的 + failed 超過重試窗的;--full 則全部重掃。空/純空白 url 一律剔除(DDL btrim CHECK)。
 */
export function buildWorklist(
  candidateUrls: readonly string[],
  existing: readonly ExistingRow[],
  opts: { full: boolean; now: number; limit?: number },
): string[] {
  const seen = new Map<string, ExistingRow>();
  for (const row of existing) seen.set(row.url, row);
  const out: string[] = [];
  const dedup = new Set<string>();
  for (const url of candidateUrls) {
    if (!url || url.trim() === '' || dedup.has(url)) continue;
    dedup.add(url);
    if (!opts.full) {
      const prev = seen.get(url);
      if (prev) {
        const retryDue =
          prev.status === 'failed' && opts.now - Date.parse(prev.analyzed_at) > FAILED_RETRY_MS;
        if (!retryDue) continue;
      }
    }
    out.push(url);
    if (opts.limit !== undefined && out.length >= opts.limit) break;
  }
  return out;
}

/** 量測結果 → 分類(純函式、單測鎖邊界) */
export function classifyTrim(m: {
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  trimmedWidth: number;
  trimmedHeight: number;
  offsetLeft: number;
  offsetTop: number;
}): TrimRow {
  const { naturalWidth: nw, naturalHeight: nh } = m;
  if (nw <= 0 || nh <= 0 || m.trimmedWidth <= 0 || m.trimmedHeight <= 0) {
    return nonOkRow(m.url, 'failed');
  }
  // nit-2:sharp trimOffset 回報負值 → 取絕對值
  const left = Math.abs(m.offsetLeft) / nw;
  const top = Math.abs(m.offsetTop) / nh;
  const width = m.trimmedWidth / nw;
  const height = m.trimmedHeight / nh;
  if (width > 1 || height > 1 || left + width > 1 || top + height > 1) {
    return nonOkRow(m.url, 'failed'); // 量測不自洽(理論不應發生)→ 安全方向
  }
  if (width > NO_TRIM_RATIO && height > NO_TRIM_RATIO) return nonOkRow(m.url, 'no_trim');
  if (width * height < MIN_AREA_RATIO) return nonOkRow(m.url, 'failed');
  return {
    url: m.url,
    status: 'ok',
    // numeric(6,5):5 位小數截斷(DDL 上限 <1 / ≤1 由 classify 已保)
    bbox_left: round5(left),
    bbox_top: round5(top),
    bbox_width: round5(width),
    bbox_height: round5(height),
    natural_width: nw,
    natural_height: nh,
  };
}

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

/**
 * 對一張圖的 bytes 做量測(sharp;nit-4 先 .rotate() 套 EXIF)。
 * throw = 呼叫端記 failed(decode 失敗/空圖等)。
 */
export async function analyzeImageBuffer(url: string, buf: Buffer): Promise<TrimRow> {
  const rotated = await sharp(buf).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  if (!meta.width || !meta.height) return nonOkRow(url, 'failed');
  let info;
  try {
    ({ info } = await sharp(rotated)
      .trim({ background: TRIM_BACKGROUND, threshold: TRIM_THRESHOLD })
      .toBuffer({ resolveWithObject: true }));
  } catch {
    // sharp 對「整張都是背景」等情況會 throw → 視為裁不動
    return nonOkRow(url, 'no_trim');
  }
  return classifyTrim({
    url,
    naturalWidth: meta.width,
    naturalHeight: meta.height,
    trimmedWidth: info.width,
    trimmedHeight: info.height,
    offsetLeft: info.trimOffsetLeft ?? 0,
    offsetTop: info.trimOffsetTop ?? 0,
  });
}
