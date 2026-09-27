import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IReturnReceivedScanner,
  ListReturnReceivedWithoutEmailInput,
  ListReturnReceivedWithoutEmailResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

// 退貨收回通知的掃描 adapter(2026-09-27, Sean A3 甲甲甲;形狀照 SupabasePartiallyCancelledOrderScannerAdapter, 少了金額與讓路)。
// 讀 view `pcm_return_received_email_pending`(20260927080000, service_role SELECT), 一發、limit+1 探截斷。
// 🔴 只讀不寫;view 已做 anti-join, 這裡不再判「寄過沒」。

export type ReturnReceivedScannerClient = SupabaseClient<Database>;

export const RETURN_RECEIVED_PENDING_VIEW = 'pcm_return_received_email_pending';

export class ReturnReceivedScanQueryError extends Error {
  constructor(public readonly stage: 'returns', public readonly code: string) {
    super(`return-received scan 失敗(${stage}/${code})`);
    this.name = 'ReturnReceivedScanQueryError';
  }
}

const MAX_LIMIT = 200;

type Row = {
  order_id: string;
  return_id: string;
  display_id: string;
  received_at: string | null;
  received_items: unknown;
  notification_email: string | null;
  customer_email: string | null;
  order_source: string | null;
};

/** view 給的 jsonb `[{title, quantity}]`;形狀不對的元素丟掉(品項全丟光 ⇒ 組裝端 throw 不排, 不會印錯東西)。 */
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

export class SupabaseReturnReceivedScannerAdapter implements IReturnReceivedScanner {
  constructor(private readonly client: ReturnReceivedScannerClient) {}

  async listReturnReceivedWithoutEmail(
    input: ListReturnReceivedWithoutEmailInput,
  ): Promise<ListReturnReceivedWithoutEmailResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new ReturnReceivedScanQueryError('returns', 'bad_limit');
    }
    const cols =
      'order_id, return_id, display_id, received_at, received_items, notification_email, customer_email, order_source';
    const probeLimit = input.limit + 1;
    let outcome: { data: unknown[] | null; error: { code?: string; message?: string } | null };
    try {
      outcome = await this.client
        .from(RETURN_RECEIVED_PENDING_VIEW as never)
        .select(cols)
        .gte('received_at', input.cutoff)
        .order('return_id', { ascending: true })
        .limit(probeLimit);
    } catch {
      throw new ReturnReceivedScanQueryError('returns', 'rejected');
    }
    if (outcome.error !== null) {
      throw new ReturnReceivedScanQueryError('returns', outcome.error.code || 'unknown');
    }
    const scanned = (outcome.data ?? []) as Row[];
    const truncated = scanned.length >= probeLimit;
    const rows = truncated ? scanned.slice(0, input.limit) : scanned;
    return {
      rows: rows.map((r) => ({
        orderId: r.order_id,
        returnId: r.return_id,
        displayId: r.display_id,
        receivedAt: r.received_at ?? '',
        receivedItems: readItems(r.received_items),
        notificationEmail: r.notification_email,
        customerEmail: r.customer_email,
        orderSource: r.order_source,
      })),
      scannedPages: 1,
      truncated,
    };
  }
}
