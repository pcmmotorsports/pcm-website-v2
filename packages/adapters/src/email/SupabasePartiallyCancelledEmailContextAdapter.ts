import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IPartiallyCancelledEmailContext,
  LoadPartiallyCancelledCurrentResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

// 部分取消信寄出當下的金額(2026-09-14;codex R1 must-fix ④)。只讀 `pcm_partially_cancelled_email_current_v`。
// 🔴 任何讀不到 ⇒ `unavailable`(呼叫端釋放認領、下一輪再試)—— 不退回 payload 的舊數字, 那正是本片要修的事。

export type PartiallyCancelledEmailContextClient = SupabaseClient<Database>;

const CURRENT_VIEW = 'pcm_partially_cancelled_email_current_v';

type Row = {
  still_partial: boolean | null;
  effective_subtotal: number | null;
  effective_shipping_fee: number | null;
  remaining_receivable: number | null;
  paid_total: number | null;
};

export class SupabasePartiallyCancelledEmailContextAdapter implements IPartiallyCancelledEmailContext {
  constructor(private readonly client: PartiallyCancelledEmailContextClient) {}

  async loadCurrent(input: { orderId: string }): Promise<LoadPartiallyCancelledCurrentResult> {
    let outcome: { data: unknown; error: unknown };
    try {
      outcome = await this.client
        .from(CURRENT_VIEW as never)
        .select('still_partial, effective_subtotal, effective_shipping_fee, remaining_receivable, paid_total')
        .eq('order_id' as never, input.orderId as never)
        .limit(1);
    } catch {
      return { kind: 'unavailable' };
    }
    if (outcome.error !== null && outcome.error !== undefined) return { kind: 'unavailable' };
    const row = ((outcome.data ?? []) as Row[])[0];
    if (row === undefined) return { kind: 'unavailable' };
    const int = (v: number | null): number | null =>
      typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
    const subtotal = int(row.effective_subtotal);
    const shipping = int(row.effective_shipping_fee);
    const paid = int(row.paid_total);
    if (subtotal === null || shipping === null || paid === null || typeof row.still_partial !== 'boolean') {
      return { kind: 'unavailable' };
    }
    return {
      kind: 'ok',
      current: {
        stillPartial: row.still_partial,
        effectiveSubtotal: subtotal,
        effectiveShippingFee: shipping,
        remainingReceivable: int(row.remaining_receivable),
        paidTotal: paid,
      },
    };
  }
}
