import type {
  ITrackingCorrectedScanner,
  ListTrackingCorrectedInput,
  ListTrackingCorrectedResult,
  ShipmentWithCorrectedTracking,
} from '@pcm/ports';

/**
 * ⟦5b-TRACKNUMGAP1⟧ 片 C:更正信掃描器的 Supabase 實作。
 *
 * 🔵 **整支鏡像 `SupabaseShippedOrderScannerAdapter`** —— 同一條線的第二個掃描器。
 *
 * 🔴🔴 **而它與那一支差在【沒有 `.gt(cutoff)` 那一段】, 而那【不是漏了】。**
 *    出貨信需要起始線, 因為它上線第一秒的集合 = 歷史上全部已出貨的箱。
 *    本掃描面的觸發欄 `shipments.tracking_corrected_at` 是**片 C 才新增的**
 *    ⇒ 歷史上每一箱那一欄都是 NULL ⇒ **集合天生從空的開始長。**
 *    ⇒ 📌 起始線由「欄位什麼時候出生」保證, 而那個保證**不會有人忘記設**。
 *    🛑 而差集的另一半在 view 裡:出貨信必須在**更正之前**就已寄出
 *      (`sent_at < tracking_corrected_at`)⇒ 客人沒收過錯號碼的箱不在這個集合裡。
 *
 * 🔴 **本檔【不做】差集** —— 差集在 SQL(`pcm_tracking_corrected_email_pending`)。
 *    理由與那條線同一句:PostgREST 上拼四張表的複合 anti-join,
 *    寫錯了會**回 200 而且看起來完全正常**。
 */

type TrackingScanOrderable = {
  order(column: string, opts: { ascending: boolean }): TrackingScanOrderable;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;
};

export type TrackingCorrectedScannerClient = {
  from(table: string): {
    select(columns: string): TrackingScanOrderable;
  };
};

export const TRACKING_CORRECTED_PENDING_VIEW = 'pcm_tracking_corrected_email_pending';

const SELECT_COLUMNS =
  'shipment_id, shipment_reference, tracking_number, carrier_code, tracking_corrected_at, ' +
  'corrected_at_key, ' +
  'order_id, display_id, notification_email, customer_email';

const MAX_LIMIT = 200;

export class TrackingCorrectedScanQueryError extends Error {
  constructor(readonly code: string) {
    super(`更正信掃描失敗(code=${code})`);
    this.name = 'TrackingCorrectedScanQueryError';
  }
}

function toRow(raw: unknown): ShipmentWithCorrectedTracking {
  const r = raw as Record<string, unknown>;
  const str = (key: string): string => {
    const v = r[key];
    if (typeof v !== 'string' || v === '') {
      throw new TrackingCorrectedScanQueryError(`bad_row_shape:${key}`);
    }
    return v;
  };
  const nullableStr = (key: string): string | null => {
    const v = r[key];
    if (v === undefined) throw new TrackingCorrectedScanQueryError(`missing_column:${key}`);
    if (v === null) return null;
    if (typeof v !== 'string') throw new TrackingCorrectedScanQueryError(`bad_row_shape:${key}`);
    return v.trim() === '' ? null : v;
  };
  return {
    shipmentId: str('shipment_id'),
    shipmentReference: str('shipment_reference'),
    // 🔴 `trackingNumber` 走 `str` 不走 `nullableStr` —— **空的號碼進了信就是一封空信**,
    //    而 view 那側已經濾掉空白 ⇒ 這裡拿到空的代表 view 與本檔對不起來 ⇒ 當場丟。
    trackingNumber: str('tracking_number'),
    carrierCode: str('carrier_code'),
    trackingCorrectedAt: str('tracking_corrected_at'),
    trackingCorrectedKey: str('corrected_at_key'),
    orderId: str('order_id'),
    displayId: str('display_id'),
    notificationEmail: nullableStr('notification_email'),
    customerEmail: nullableStr('customer_email'),
  };
}

export class SupabaseTrackingCorrectedScannerAdapter implements ITrackingCorrectedScanner {
  constructor(private readonly client: TrackingCorrectedScannerClient) {}

  async listTrackingCorrectedWithoutEmail(
    input: ListTrackingCorrectedInput,
  ): Promise<ListTrackingCorrectedResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new Error(
        `更正信掃描 limit 必須是 1..${MAX_LIMIT} 的整數(拿到 ${String(input.limit)})`,
      );
    }

    let outcome: { data: unknown[] | null; error: { code?: string } | null };
    try {
      outcome = await this.client
        .from(TRACKING_CORRECTED_PENDING_VIEW)
        .select(SELECT_COLUMNS)
        // 🔴 最後兩把排序鍵是**唯一**的(箱 uuid + 號碼)——
        //    只按時間排, 同一時刻的多列在翻頁時順序不保證 ⇒ 有列會被跳過或重複。
        .order('tracking_corrected_at', { ascending: true })
        .order('shipment_id', { ascending: true })
        .order('order_id', { ascending: true })
        // 🔵 多撈一列來判 `truncated` —— 與出貨信那支同一招。
        .limit(input.limit + 1);
    } catch {
      throw new TrackingCorrectedScanQueryError('rejected');
    }

    if (outcome.error) {
      throw new TrackingCorrectedScanQueryError(outcome.error.code || 'unknown');
    }

    const raw = outcome.data ?? [];
    const truncated = raw.length > input.limit;
    return { rows: raw.slice(0, input.limit).map(toRow), truncated };
  }
}
