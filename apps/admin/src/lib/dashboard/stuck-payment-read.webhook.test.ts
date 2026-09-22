import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { loadWebhookManualReviewCount, webhookManualReviewLabel } from './stuck-payment-read';

/** `.rpc()` ⇒ thenable;`reject` 走 transport 層 reject;`hang` 演逾時。 */
function rpcResult(r: { data?: unknown; error?: unknown; reject?: unknown; hang?: true }) {
  return {
    then(ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) {
      if (r.hang) return new Promise(() => {});
      if ('reject' in r) return Promise.resolve(err?.(r.reject));
      return Promise.resolve(ok({ data: r.data ?? null, error: r.error ?? null }));
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('⟦db-WEBHOOKMANUALBACKLOG⟧ 首頁「付款通知待人工確認」', () => {
  it('呼叫的是同一支資料庫函式(條件只寫一處)', async () => {
    mocks.rpc.mockReturnValue(rpcResult({ data: { manual_count: 0, oldest_received_at: null, sample_display_ids: [], total_count: 52 } }));
    await loadWebhookManualReviewCount();
    expect(mocks.rpc).toHaveBeenCalledWith('get_webhook_manual_review_health');
  });

  it('有筆數 ⇒ 筆數 + 最早一筆收到日期(台北時間)', async () => {
    mocks.rpc.mockReturnValue(
      rpcResult({ data: { manual_count: 3, oldest_received_at: '2026-07-24T09:07:00+00:00', sample_display_ids: [], total_count: 52 } }),
    );
    const c = await loadWebhookManualReviewCount();
    expect(c.count).toBe(3);
    expect(webhookManualReviewLabel(c)).toBe('付款通知待人工確認：3 筆（最早一筆 2026-07-24 收到）。請通知工程人員處理，客人可能已被扣款。');
  });

  it('🔴 0 筆也要印「0 筆」(分得出「沒有」和「沒在顯示」)', async () => {
    mocks.rpc.mockReturnValue(rpcResult({ data: { manual_count: 0, oldest_received_at: null, sample_display_ids: [], total_count: 52 } }));
    expect(webhookManualReviewLabel(await loadWebhookManualReviewCount())).toBe('付款通知待人工確認：0 筆');
  });

  it('台北跨日:UTC 16:30 是台北隔天', async () => {
    mocks.rpc.mockReturnValue(
      rpcResult({ data: { manual_count: 1, oldest_received_at: '2026-08-10T16:30:00Z', sample_display_ids: [], total_count: 5 } }),
    );
    expect(webhookManualReviewLabel(await loadWebhookManualReviewCount())).toContain('2026-08-11 收到');
  });

  it('🔴 讀不到(錯誤 / 連線失敗 / 逾時 / 形狀不對 / 筆數大於全表 / 有筆數沒時間)⇒ 無法載入, 不印成 0', async () => {
    const cases = [
      rpcResult({ error: { code: '42883' } }),
      rpcResult({ reject: new Error('network') }),
      rpcResult({ data: { manual_count: '3', total_count: 5 } }),
      rpcResult({ data: { manual_count: 9, oldest_received_at: '2026-07-24T09:07:00Z', total_count: 5 } }),
      rpcResult({ data: { manual_count: 2, oldest_received_at: null, total_count: 5 } }),
      rpcResult({ data: null }),
    ];
    for (const r of cases) {
      mocks.rpc.mockReturnValue(r);
      const c = await loadWebhookManualReviewCount();
      expect(c.count).toBeNull();
      expect(webhookManualReviewLabel(c)).toMatch(/^付款通知待人工確認：無法載入（.+）。請重新整理；若仍無法載入，請聯絡系統管理員。$/);
    }
  });

  it('逾時 ⇒ 無法載入(查詢逾時)', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockReturnValue(rpcResult({ hang: true }));
    const p = loadWebhookManualReviewCount();
    await vi.advanceTimersByTimeAsync(5_000);
    const c = await p;
    vi.useRealTimers();
    expect(webhookManualReviewLabel(c)).toBe('付款通知待人工確認：無法載入（查詢逾時 5 秒）。請重新整理；若仍無法載入，請聯絡系統管理員。');
  });
});
