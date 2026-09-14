import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IPartiallyCancelledOrderScanner,
  ListPartiallyCancelledWithoutEmailInput,
  ListPartiallyCancelledWithoutEmailResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

// 部分取消補寄信的掃描 adapter(2026-09-14;形狀照 SupabasePartialRefundOrderScannerAdapter)。
// 讀 view `pcm_partially_cancelled_email_pending`(20260915150000, service_role SELECT), 一發、limit+1 探截斷。
// 🔴 只讀不寫;view 已做 anti-join, 這裡不再判「寄過沒」。

export type PartiallyCancelledOrderScannerClient = SupabaseClient<Database>;

export class PartiallyCancelledScanQueryError extends Error {
  constructor(public readonly stage: 'cancellations', public readonly code: string) {
    super(`partially-cancelled scan 失敗(${stage}/${code})`);
    this.name = 'PartiallyCancelledScanQueryError';
  }
}

async function safeQuery<T>(
  stage: 'cancellations',
  run: () => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let outcome: { data: T | null; error: { code?: string; message: string } | null };
  try {
    outcome = await run();
  } catch {
    throw new PartiallyCancelledScanQueryError(stage, 'rejected');
  }
  if (outcome.error !== null) {
    throw new PartiallyCancelledScanQueryError(stage, outcome.error.code || 'unknown');
  }
  return outcome.data;
}

const MAX_LIMIT = 200;
const PENDING_VIEW = 'pcm_partially_cancelled_email_pending';

type Row = {
  order_id: string;
  cancellation_id: string;
  display_id: string;
  cancelled_at: string | null;
  cancelled_items: unknown;
  effective_subtotal: number | null;
  effective_shipping_fee: number | null;
  remaining_receivable: number | null;
  paid_total: number | null;
  notification_email: string | null;
  customer_email: string | null;
  order_source: string | null;
  bank_line_eligible: boolean | null;
};

/** view 給的 jsonb `[{title, quantity}]`;形狀不對的元素丟掉(寄信端會因品項為空而不寄, 不會印錯東西)。 */
function readItems(raw: unknown): Array<{ title: string | null; quantity: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ title: string | null; quantity: number }> = [];
  for (const el of raw) {
    if (el === null || typeof el !== 'object') continue;
    const t = (el as { title?: unknown }).title;
    const q = (el as { quantity?: unknown }).quantity;
    if (typeof q !== 'number' || !Number.isSafeInteger(q) || q <= 0) continue;
    out.push({ title: typeof t === 'string' && t.trim() !== '' ? t : null, quantity: q });
  }
  return out;
}

export class SupabasePartiallyCancelledOrderScannerAdapter implements IPartiallyCancelledOrderScanner {
  constructor(private readonly client: PartiallyCancelledOrderScannerClient) {}

  async listPartiallyCancelledWithoutEmail(
    input: ListPartiallyCancelledWithoutEmailInput,
  ): Promise<ListPartiallyCancelledWithoutEmailResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new PartiallyCancelledScanQueryError('cancellations', 'bad_limit');
    }
    // 🔴🔴 codex R1 must-fix ⑤:`remaining_receivable IS NULL`(含稅單稅算不出)那些列**永遠留在掃描面**
    //    —— 它們不排信、不落終態, 而排序是固定的 ⇒ 只要累積 `limit` 筆, 後面【正常的】那些永遠掃不到。
    //    ✅ 修法:查詢層就把它們濾掉(`.not('remaining_receivable','is',null)`), 另外數一次它們有幾列
    //    ⇒ 它們不再佔窗, 而「有幾筆算不出稅」仍看得到(unusableAmount 照樣回報, 不是靜靜消失)。
    const cols =
      'order_id, cancellation_id, display_id, cancelled_at, cancelled_items, effective_subtotal, effective_shipping_fee, remaining_receivable, paid_total, notification_email, customer_email, order_source, bank_line_eligible';
    const probeLimit = input.limit + 1;
    // 🔴🔴 第 22 件 ② codex R1 MF2:讓路的列要在【LIMIT 之前】濾掉 —— 同上面 remaining_receivable 那一格的理由:
    //    只在 use-case 跳過 ⇒ 前 limit 筆全是讓路列時, 後面該寄的那筆永遠掃不到。
    const page = await safeQuery('cancellations', () => {
      let q = this.client
        .from(PENDING_VIEW as never)
        .select(cols)
        .gte('cancelled_at', input.cutoff)
        .not('remaining_receivable', 'is', null);
      if (input.yieldToBank) q = q.eq('bank_line_eligible' as never, false as never);
      return q.order('cancellation_id', { ascending: true }).limit(probeLimit);
    });
    // 讓路了幾列:精確 count(同下面 blockedCount 的規矩 —— 拿不到非負整數就丟掉這一輪, 不把「不知道」報成 0)。
    let yieldedCount = 0;
    if (input.yieldToBank) {
      try {
        const head = await this.client
          .from(PENDING_VIEW as never)
          .select('cancellation_id', { count: 'exact', head: true })
          .gte('cancelled_at', input.cutoff)
          .not('remaining_receivable', 'is', null)
          .eq('bank_line_eligible' as never, true as never);
        if (head.error !== null) throw new PartiallyCancelledScanQueryError('cancellations', head.error.code || 'unknown');
        if (typeof head.count !== 'number' || !Number.isSafeInteger(head.count) || head.count < 0) {
          throw new PartiallyCancelledScanQueryError('cancellations', 'count_missing');
        }
        yieldedCount = head.count;
      } catch (e) {
        if (e instanceof PartiallyCancelledScanQueryError) throw e;
        throw new PartiallyCancelledScanQueryError('cancellations', 'rejected');
      }
    }
    // 🔴 codex R2 must-fix ③:用 `.limit(200).length` 數 ⇒ 201 與 500 都回報 200(無聲少報)。
    //    ⇒ 走 PostgREST 的精確 count(head:true, 不取列)—— 它回的是【全部】幾列, 不受 limit 影響。
    let blockedCount = 0;
    try {
      const head = await this.client
        .from(PENDING_VIEW as never)
        .select('cancellation_id', { count: 'exact', head: true })
        .gte('cancelled_at', input.cutoff)
        .is('remaining_receivable', null);
      if (head.error !== null) throw new PartiallyCancelledScanQueryError('cancellations', head.error.code || 'unknown');
      // 🔴 codex R3 must-fix:`count` 缺席(空本文 404 / 少了 Content-Range 標頭)時 `?? 0` 會把「不知道」
      //    報成「零」—— 而這一格的用途正是「有幾張單今天沒寄」。⇒ 只有真的拿到非負整數才算數, 否則丟掉這一輪。
      if (typeof head.count !== 'number' || !Number.isSafeInteger(head.count) || head.count < 0) {
        throw new PartiallyCancelledScanQueryError('cancellations', 'count_missing');
      }
      blockedCount = head.count;
    } catch (e) {
      if (e instanceof PartiallyCancelledScanQueryError) throw e;
      throw new PartiallyCancelledScanQueryError('cancellations', 'rejected');
    }
    const scanned = page ?? [];
    const truncated = scanned.length >= probeLimit;
    const rows = (truncated ? scanned.slice(0, input.limit) : scanned) as unknown as Row[];
    const unusable = blockedCount;
    if (rows.length === 0) {
      return { rows: [], scannedPages: 1, truncated: false, unusableInView: unusable, yieldedInView: yieldedCount };
    }
    return {
      unusableInView: unusable,
      yieldedInView: yieldedCount,
      rows: rows.map((r) => ({
        orderId: r.order_id,
        displayId: r.display_id,
        cancellationId: r.cancellation_id,
        cancelledAt: r.cancelled_at ?? '',
        cancelledItems: readItems(r.cancelled_items),
        effectiveSubtotal: r.effective_subtotal,
        effectiveShippingFee: r.effective_shipping_fee,
        remainingReceivable: r.remaining_receivable,
        paidTotal: r.paid_total ?? 0,
        notificationEmail: r.notification_email,
        customerEmail: r.customer_email,
        orderSource: r.order_source,
        // 🔵 只有真的 `true` 才讓路。讀不出來 ⇒ 當 false ⇒ 本信照寄 —— 那個方向不會雙寄:
        //    匯款金額變更信的掃描面對本信已排的列有對稱 anti-join(20260915150000 ②b)。
        //    反過來當 true ⇒ 那條線若也沒排, 兩封都不寄(第 22 件 ② 要修的就是那個世界)。
        bankLineEligible: r.bank_line_eligible === true,
      })),
      scannedPages: 1,
      truncated,
    };
  }
}
