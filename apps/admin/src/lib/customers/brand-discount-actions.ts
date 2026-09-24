'use server';

// 儲存經銷品牌折扣(B2B 計畫 §10.4 片 E3)。只限管理者(authorizeManagerMutation:員工身分 + Origin + 管理者)。
// 表格所有員工都看得到;按下儲存才驗管理者。整批一個交易, 舊值不符整批不存(資料庫 STALE)。
import { revalidatePath } from 'next/cache';
import { authorizeManagerMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { saveBrandDiscounts } from './brand-discount-repository';
import { DEALER_DISCOUNT_SOFT_CAP_PERCENT, type CurrentDiscount, type DiscountChange } from './brand-discount-form';

export type SaveBrandDiscountsResult = {
  kind: 'saved' | 'no_change' | 'stale' | 'not_found' | 'not_dealer' | 'need_cap_confirm' | 'invalid' | 'denied' | 'unknown';
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
