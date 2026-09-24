'use server';

// 儲存經銷品牌折扣(B2B 計畫 §10.4 片 E3)。只限管理者(authorizeManagerMutation:員工身分 + Origin + 管理者)。
// 表格所有員工都看得到;按下儲存才驗管理者。整批一個交易, 舊值不符整批不存(資料庫 STALE)。
import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation, authorizeManagerMutation } from '../session/authorize';
import { isActiveManager } from '../staff';
import { getRequestId } from '../audit/context';
import { loadBrandPreview, loadCostedVariants, loadPercents, saveBrandDiscounts } from './brand-discount-repository';
import { findBelowCost } from './brand-discount-pricing';
import { DEALER_DISCOUNT_SOFT_CAP_PERCENT, type CurrentDiscount, type DiscountChange } from './brand-discount-form';

export type SaveBrandDiscountsResult =
  | {
      kind:
        | 'saved' | 'no_change' | 'stale' | 'not_found' | 'not_dealer' | 'need_cap_confirm'
        | 'cost_check_failed' | 'invalid' | 'denied' | 'unknown';
    }
  | { kind: 'below_cost_reason_required'; brands: string[] };

// 🔴 只收小寫(資料庫回傳的形式):大寫會讓「低於成本」那一步以字串比對時對不上而漏判(Codex E4 R1)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validPercent(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && v > 0 && v < 100 && Math.round(v * 10) === v * 10);
}

export async function saveBrandDiscountsAction(input: {
  customerId: string;
  changes: DiscountChange[];
  expected: Record<string, CurrentDiscount | null>;
  overCapConfirmed: boolean;
}): Promise<SaveBrandDiscountsResult> {
  const auth = await authorizeManagerMutation();
  if (!auth) return { kind: 'denied' };

  const { customerId, changes, expected } = input;
  const ok =
    UUID_RE.test(customerId) &&
    Array.isArray(changes) &&
    changes.length > 0 &&
    changes.length <= 2000 &&
    expected !== null &&
    typeof expected === 'object' &&
    changes.every(
      (c) =>
        c !== null &&
        typeof c === 'object' &&
        UUID_RE.test(c.brand_id) &&
        'percent' in c &&
        validPercent(c.percent) &&
        typeof c.below_cost_reason === 'string' &&
        Object.hasOwn(expected, c.brand_id),
    );
  if (!ok) return { kind: 'invalid' };
  // 🔴 軟性上限在 server 也驗一次:畫面上那個勾選框可以被繞過
  if (!input.overCapConfirmed && changes.some((c) => c.percent !== null && c.percent > DEALER_DISCOUNT_SOFT_CAP_PERCENT)) {
    return { kind: 'need_cap_confirm' };
  }

  // 🔴 片 E4:低於成本在 server 重算一次(畫面上那一格可以被繞過);讀不到成本 ⇒ 不存(不能當成沒有低於成本)
  const percents = Object.fromEntries(changes.filter((c) => c.percent !== null).map((c) => [c.brand_id, c.percent]));
  if (Object.keys(percents).length > 0) {
    const costed = await loadCostedVariants();
    if (costed === null) return { kind: 'cost_check_failed' };
    const below = findBelowCost(costed.variants, costed.unitCost, percents);
    const missing = below.filter((b) => (changes.find((c) => c.brand_id === b)?.below_cost_reason.trim() ?? '') === '');
    if (missing.length > 0) return { kind: 'below_cost_reason_required', brands: missing };
  }

  const requestId = await getRequestId();
  let result: string;
  try {
    result = await saveBrandDiscounts({ customerId, changes, expected, actor: auth.actorId, requestId });
  } catch (err) {
    console.error('[brand-discounts] 儲存沒有確認成功', { request_id: requestId, code: (err as { code?: unknown })?.code });
    return { kind: 'unknown' };
  }
  revalidatePath(`/customers/${customerId}/brand-discounts`);
  switch (result) {
    case 'SAVED':
      return { kind: 'saved' };
    case 'NO_CHANGE':
      return { kind: 'no_change' };
    case 'STALE':
      return { kind: 'stale' };
    case 'NOT_FOUND':
      return { kind: 'not_found' };
    case 'NOT_DEALER':
      return { kind: 'not_dealer' };
    default:
      console.error('[brand-discounts] 不認得的結果', { request_id: requestId, result });
      return { kind: 'unknown' };
  }
}

/** 從另一位經銷會員複製設定(片 E4):只回 %, 填進表格當成待儲存的修改;儲存仍限管理者。 */
export async function loadCopyDiscountsAction(input: {
  sourceCustomerId: string;
}): Promise<{ kind: 'ok'; percents: Record<string, number> } | { kind: 'denied' | 'invalid' | 'failed' }> {
  if (!(await authorizeAdminMutation())) return { kind: 'denied' };
  if (!UUID_RE.test(input.sourceCustomerId)) return { kind: 'invalid' };
  const percents = await loadPercents(input.sourceCustomerId);
  return percents === null ? { kind: 'failed' } : { kind: 'ok', percents };
}

export type PreviewResultItem = { title: string; generalPrice: number; dealerPrice: number; unitCost?: number | null };

/**
 * 預覽某品牌三件商品(片 E4)。員工都看得到價格;
 * 🔴 成本只有管理者拿得到(在 server 決定要不要讀、要不要回), 非管理者的回應裡沒有 unitCost 這一欄。
 */
export async function previewBrandAction(input: {
  brandId: string;
}): Promise<{ kind: 'ok'; items: PreviewResultItem[]; costReadFailed?: boolean } | { kind: 'denied' | 'invalid' | 'failed' }> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { kind: 'denied' };
  if (!UUID_RE.test(input.brandId)) return { kind: 'invalid' };
  const items = await loadBrandPreview(input.brandId);
  if (items === null) return { kind: 'failed' };
  const manager = await isActiveManager(auth.actorId).catch(() => false);
  if (!manager) {
    return { kind: 'ok', items: items.map((i) => ({ title: i.title, generalPrice: i.generalPrice, dealerPrice: i.dealerPrice })) };
  }
  const costed = await loadCostedVariants();
  return {
    kind: 'ok',
    items: items.map((i) => ({
      title: i.title,
      generalPrice: i.generalPrice,
      dealerPrice: i.dealerPrice,
      unitCost: costed && i.basisVariantId ? (costed.unitCost.get(i.basisVariantId) ?? null) : null,
    })),
    ...(costed === null ? { costReadFailed: true } : {}),
  };
}

/** 儲存前確認:哪些品牌折扣後會低於成本(片 E4)。🔴 只限管理者;讀不到成本 ⇒ failed。 */
export async function checkBelowCostAction(input: {
  percents: Record<string, number | null>;
}): Promise<{ kind: 'ok'; belowCost: string[] } | { kind: 'denied' | 'invalid' | 'failed' }> {
  if (!(await authorizeManagerMutation())) return { kind: 'denied' };
  const entries = Object.entries(input.percents ?? {});
  if (entries.length === 0 || entries.length > 2000 || !entries.every(([b, p]) => UUID_RE.test(b) && validPercent(p))) {
    return { kind: 'invalid' };
  }
  const costed = await loadCostedVariants();
  if (costed === null) return { kind: 'failed' };
  return { kind: 'ok', belowCost: findBelowCost(costed.variants, costed.unitCost, input.percents) };
}
