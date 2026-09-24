// 經銷品牌折扣設定頁的純函式(B2B 計畫 §10.4 片 E3)。client 表格與 server action 共用。
// 資料庫(20260925030000 admin_dealer_brand_discounts_save)是最後一道:0 < % < 100、最多一位小數、整批比對舊值。

/** 單一品牌超過這個 % 時, 差異確認那一列標黃, 要多勾一次才能存(不是擋下)。可以調整的預設值。 */
export const DEALER_DISCOUNT_SOFT_CAP_PERCENT = 20;

export type PercentInput = { ok: true; value: number | null } | { ok: false; error: string };

/** 員工在格子裡打的字 ⇒ %。空白或 0 = 不打折(刪掉那一列)。不自己進位:7.55 直接提示。 */
export function parsePercentInput(raw: string): PercentInput {
  const s = raw.trim();
  if (s === '' || /^0+(\.0*)?$/.test(s)) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: '請填數字，例如 5 或 7.5。' };
  if (/\.\d{2,}$/.test(s)) return { ok: false, error: '折扣最多到小數點後一位。' };
  const n = Number(s);
  if (!(n > 0 && n < 100)) return { ok: false, error: '折扣要大於 0%、小於 100%。' };
  return { ok: true, value: n };
}

/** 「折扣 5%」旁邊的「＝經銷價的 95%」。用整數算, 避免 100 − 7.5 出現浮點尾數。 */
export function priceRatioText(percent: number | null): string {
  if (percent === null) return '';
  return `＝經銷價的 ${(1000 - Math.round(percent * 10)) / 10}%`;
}

export type CurrentDiscount = { percent: number; below_cost_reason: string; updated_at: string };
export type DiscountChange = { brand_id: string; percent: number | null; below_cost_reason: string };

/**
 * 畫面上的新值 ⇒ 送給資料庫的 changes 與 expected。只送真的有變的品牌;
 * expected 是員工這次看到的舊值(沒有設定 = null), 資料庫比對不同就整批不存(STALE)。
 * 原因(below_cost_reason)本片沿用舊值;低於成本的原因由片 E4 填。
 */
export function buildDiscountChanges(
  current: ReadonlyMap<string, CurrentDiscount>,
  next: Readonly<Record<string, number | null>>,
): { changes: DiscountChange[]; expected: Record<string, CurrentDiscount | null>; overCap: string[] } {
  const changes: DiscountChange[] = [];
  const expected: Record<string, CurrentDiscount | null> = {};
  const overCap: string[] = [];
  for (const [brandId, value] of Object.entries(next)) {
    const cur = current.get(brandId) ?? null;
    if ((cur?.percent ?? null) === value) continue;
    changes.push({ brand_id: brandId, percent: value, below_cost_reason: value === null ? '' : (cur?.below_cost_reason ?? '') });
    expected[brandId] = cur;
    if (value !== null && value > DEALER_DISCOUNT_SOFT_CAP_PERCENT) overCap.push(brandId);
  }
  return { changes, expected, overCap };
}
