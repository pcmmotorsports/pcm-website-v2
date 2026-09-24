// 經銷品牌折扣的預覽與「低於成本」判斷(B2B 計畫 §10.4–10.5 片 E4)。純函式, server action 與畫面共用。
// 🔴 成本相關的一切只給管理者:本檔只算, 誰拿得到結果由 action 決定(非管理者拿不到任何成本推算出來的值)。
import { computeUnitCostTwd } from '../orders/item-costs-view';

/**
 * 折扣後價格。與資料庫 dealer_discount_apply(20260925040000)同一個算法:
 * round(金額 × (100 − 折扣%) ÷ 100), 四捨五入到元(正數 .5 進位)。用整數算, 避免浮點誤差。
 */
export function applyDealerDiscount(amount: number | null, percent: number | null): number | null {
  if (amount === null || percent === null) return amount;
  const tenths = Math.round(percent * 10);
  return Math.round((amount * (1000 - tenths)) / 1000);
}

export type CostRow = {
  variantId: string | null;
  quantity: number;
  /** 這筆成本最後一次登記的時間(order_item_costs.updated_at)。 */
  recordedAt: string;
  /** 同一時間時的固定排序(order_item_id), 不靠資料回來的順序(Codex E4 R1)。 */
  tieBreak: string;
  costPrice: string;
  costShipping: string;
  costTax: string;
  fxRate: string;
};

/**
 * 每個變體取「最近一次登記」的單件台幣成本。算不出來的那一筆略過。
 * 🔵 計畫 §10.5 寫「依 order_items.created_at」—— 那一欄不存在(2026-09-25 正式庫結構實查), 改用成本自己的登記時間:
 *    員工最近一次填的成本就是最接近現在的進貨成本;同時間再用 order_item_id 由大到小固定順序。
 */
export function latestUnitCostByVariant(rows: readonly CostRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const at = (r: CostRow) => epochMicros(r.recordedAt);
  const sorted = [...rows].sort((a, b) => {
    const d = at(b) - at(a);
    if (d !== 0n) return d > 0n ? 1 : -1;
    return a.tieBreak < b.tieBreak ? 1 : a.tieBreak > b.tieBreak ? -1 : 0;
  });
  for (const r of sorted) {
    if (r.variantId === null || out.has(r.variantId)) continue;
    const unit = computeUnitCostTwd(r, r.quantity);
    if (unit !== null) out.set(r.variantId, unit);
  }
  return out;
}

/**
 * 時間轉成微秒(資料庫 timestamptz 精度是微秒;Date.parse 只到毫秒, 同一毫秒內先後登記的會被當成同時, Codex E4 R3)。
 * 讀不懂的時間 ⇒ 最舊(排到最後), 不會被當成最新。
 */
function epochMicros(s: string): bigint {
  const frac = (s.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(0, 6);
  const base = Date.parse(s.replace(/\.\d+/, ''));
  if (Number.isNaN(base)) return -(2n ** 62n);
  return BigInt(base) * 1000n + BigInt(frac);
}

export type PricedVariant = { variantId: string; brandId: string; dealerPrice: number };

/**
 * 折扣後會低於成本的品牌(整個品牌的所有有成本資料的上架變體都查)。
 * percents:品牌 → 新的 %(null = 不打折, 不查)。回傳品牌 id, 順序照 percents。
 */
export function findBelowCost(
  variants: readonly PricedVariant[],
  costByVariant: ReadonlyMap<string, number>,
  percents: Readonly<Record<string, number | null>>,
): string[] {
  const hit = new Set<string>();
  for (const v of variants) {
    const p = percents[v.brandId];
    if (p === undefined || p === null) continue;
    const unitCost = costByVariant.get(v.variantId);
    if (unitCost === undefined) continue;
    const after = applyDealerDiscount(v.dealerPrice, p);
    if (after !== null && after < unitCost) hit.add(v.brandId);
  }
  return Object.keys(percents).filter((b) => hit.has(b));
}

/** 已依一般價由低到高排好的清單 ⇒ 最低、中間、最高三件(不足三件就全列)。 */
export function pickPreviewTrio<T>(sorted: readonly T[]): T[] {
  if (sorted.length <= 3) return [...sorted];
  return [sorted[0]!, sorted[Math.floor((sorted.length - 1) / 2)]!, sorted[sorted.length - 1]!];
}
