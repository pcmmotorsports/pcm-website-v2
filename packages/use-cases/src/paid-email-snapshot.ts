import { toMoneyAmount } from '@pcm/domain';
import type {
  IPaidEmailContext,
  OrderCreatedEmailPayloadV2,
  PaidEmailContext,
  PaidEmailLine,
} from '@pcm/ports';

/**
 * 付款信金額凍結快照(`docs/plans/plan-paid-amount-frozen.md` 凍-C;Sean 2026-09-11 拍「甲、甲」)。
 *
 * 寫入端(`enqueueOrderCreatedEmails`)與讀取端(`sweepEmailOutbox`)**共用同一支判準**
 * `isFreezablePaidSnapshot` —— 入列時不收的,寄出時也不認,兩邊不會漂。
 */

const isNonNegativeSafeInteger = (n: unknown): boolean =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * 這份脈絡能不能整份凍起來?
 * - 截斷 / 0 項 ⇒ 不行(半份快照比沒有快照糟)
 * - 任一金額或數量不是非負安全整數 ⇒ 不行
 * - 🔴 品項小計加總 ≠ 小計 ⇒ 不行。它**不是**恆為真的斷言:表頭與品項是 `loadPaidContext` 的**兩次讀**,
 *   它守的是兩次讀之間的不一致(plan §10 ①)。五個總額之間的等式由 DB CHECK 保證,這裡不重驗。
 */
export function isFreezablePaidSnapshot(ctx: PaidEmailContext): boolean {
  if (ctx.linesTruncated || ctx.lines.length === 0) return false;
  const totals = [ctx.subtotal, ctx.shippingFee, ctx.discountTotal, ctx.taxTotal, ctx.total];
  if (!totals.every(isNonNegativeSafeInteger)) return false;
  let sum = 0;
  for (const l of ctx.lines) {
    if (!isNonNegativeSafeInteger(l.quantity) || !isNonNegativeSafeInteger(l.lineTotal)) return false;
    sum += l.lineTotal;
  }
  return sum === ctx.subtotal;
}

/**
 * 入列時取快照。**任何讀不到的情況都回 null ⇒ 入列 v1**(寄出當下現查,今天的行為)。
 * 🔵 `cancelled` 也回 null:寄送前的逐封閘會擋(`sweep-email-outbox.ts` 的 `listIneligibleAmong`)。
 * 🔵 throw 也吞成 null:這裡讀不到不該讓信排不進去 —— 寄送端的現查會再試一次,讀不到就 fail-closed。
 */
export async function loadFreezablePaidSnapshot(
  paidContext: IPaidEmailContext | undefined,
  orderId: string,
): Promise<PaidEmailContext | null> {
  if (paidContext === undefined) return null;
  try {
    const loaded = await paidContext.loadPaidContext({ orderId });
    if (loaded.kind !== 'ok') return null;
    return isFreezablePaidSnapshot(loaded.context) ? loaded.context : null;
  } catch {
    return null;
  }
}

export type PaidSnapshotRead =
  /** v1 或沒有 `event_version` ⇒ 走寄出當下現查。 */
  | { kind: 'live' }
  | { kind: 'snapshot'; context: PaidEmailContext }
  /** 🔴 宣稱是 v2 而讀不懂 / 其他版本 ⇒ 當 unavailable(記 error、重試),**不靜默退現查**。 */
  | { kind: 'malformed' };

/** 寄出時讀 payload。v2 ⇒ 物化成**一個** `PaidEmailContext`,HTML 與純文字都吃它。 */
export function readPaidSnapshot(payload: unknown): PaidSnapshotRead {
  if (typeof payload !== 'object' || payload === null) return { kind: 'live' };
  // 🔴 鍵名綁在寫入端的同一個型別上 ⇒ 兩邊拼錯一個鍵, typecheck 當場紅。值一律當 unknown 重驗。
  const p = payload as { [K in keyof OrderCreatedEmailPayloadV2]?: unknown };
  if (p.event_version === undefined || p.event_version === 1) return { kind: 'live' };
  if (p.event_version !== 2) return { kind: 'malformed' };

  const displayId = p.display_id;
  if (typeof displayId !== 'string' || displayId.trim() === '' || !Array.isArray(p.lines)) {
    return { kind: 'malformed' };
  }
  let context: PaidEmailContext;
  try {
    const lines: PaidEmailLine[] = p.lines.map((raw: unknown) => {
      if (typeof raw !== 'object' || raw === null) throw new Error('line');
      const r = raw as { [K in keyof OrderCreatedEmailPayloadV2['lines'][number]]?: unknown };
      const title = r.title;
      const sku = r.variant_sku;
      if (title !== null && typeof title !== 'string') throw new Error('title');
      if (sku !== null && typeof sku !== 'string') throw new Error('sku');
      return {
        title,
        variantSku: sku,
        quantity: r.quantity as number,
        lineTotal: toMoneyAmount(r.line_total as number),
      };
    });
    context = {
      orderDisplayId: displayId,
      lines,
      linesTruncated: false,
      subtotal: toMoneyAmount(p.subtotal as number),
      shippingFee: toMoneyAmount(p.shipping_fee as number),
      discountTotal: toMoneyAmount(p.discount_total as number),
      taxTotal: toMoneyAmount(p.tax_total as number),
      total: toMoneyAmount(p.total as number),
    };
  } catch {
    return { kind: 'malformed' };
  }
  return isFreezablePaidSnapshot(context) ? { kind: 'snapshot', context } : { kind: 'malformed' };
}
