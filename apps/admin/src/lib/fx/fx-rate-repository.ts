import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { FxRateRow } from './fx-rate-view';

// fx-rate-repository.ts — `fx_rates` 的讀 + 唯一寫入口(RPC `admin_fx_rate_set`)。
//
// ⚠️ **`as unknown as` 是同一筆要還的帳**(抄 `staff-repository.ts:193-197` 那段):`Database` 型別
//    還沒有 `fx_rates` 與這支 RPC ⇒ 直接呼叫會型別紅。還法:migration 貼了之後重產型別、拿掉 cast。
//    在那之前守著「表名 / 函式名 / 參數名」的是 `scripts/20260913070000-verify.sh` 與下面的 runtime guard。

type LooseClient = {
  from(table: string): {
    select(cols: string): {
      order(col: string, opts: { ascending: boolean }): {
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<{ data: unknown; error: unknown }>;
};

function client(): LooseClient {
  return createSupabaseServiceClient() as unknown as LooseClient;
}

const HISTORY_LIMIT = 200;

/** 全部匯率列(最新在前,最多 200 列)。numeric 用 `::text` 取回,不過 JSON number。 */
export async function listFxRateRows(): Promise<FxRateRow[]> {
  const { data, error } = await client()
    .from('fx_rates')
    .select('id, currency_code, rate_to_twd::text, effective_from, created_by, created_at')
    .order('effective_from', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => (isFxRateRow(r) ? [r] : []));
}

function isFxRateRow(r: unknown): r is FxRateRow {
  const o = r as Record<string, unknown>;
  return (
    typeof o === 'object' && o !== null &&
    typeof o.id === 'number' && typeof o.currency_code === 'string' &&
    typeof o.rate_to_twd === 'string' && typeof o.effective_from === 'string' &&
    typeof o.created_by === 'string' && typeof o.created_at === 'string'
  );
}

const MANAGER_GATE_MESSAGE = '無權執行此操作';

export type FxWriteOutcome = { kind: 'ok' } | { kind: 'denied' };

/** 老闆設匯率 = 新增一列(RPC 內:身分閘 + 稽核同交易)。`rateToTwd` 是字串,原樣送。 */
export async function setFxRateViaRpc(
  actorId: string,
  input: { currencyCode: string; rateToTwd: string },
  requestId: string,
): Promise<FxWriteOutcome> {
  const { data, error } = await client().rpc('admin_fx_rate_set', {
    p_actor: actorId,
    p_currency_code: input.currencyCode,
    p_rate_to_twd: input.rateToTwd,
    p_effective_from: null,
    p_request_id: requestId,
  });
  if (error) {
    const e = error as { code?: unknown; message?: unknown };
    if (e.code === 'P0001' && typeof e.message === 'string' && e.message.includes(MANAGER_GATE_MESSAGE)) {
      return { kind: 'denied' };
    }
    throw error;
  }
  const result = typeof data === 'object' && data !== null ? (data as { result?: unknown }).result : undefined;
  if (result !== 'ok') throw new Error(`admin_fx_rate_set 回了不認得的 result:${String(result)}`);
  return { kind: 'ok' };
}
