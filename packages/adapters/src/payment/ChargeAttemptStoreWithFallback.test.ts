// node env;mock 'server-only'。雙軌重試次數/退避/早停 = plan v6 §6 釘死、本檔計次鎖死(round4 C)。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ChargeAttemptStoreWithFallback } from './ChargeAttemptStoreWithFallback';
import type { ChargeAttemptFallbackRail } from './SupabaseChargeAttemptFallbackAdapter';
import type { IChargeAttemptStore } from '@pcm/ports';
import type { BeginChargeAttemptResult } from '@pcm/domain';

const ORDER = 'order-uuid-1';
const MARK_INPUT = {
  attemptId: 'attempt-uuid-1',
  orderId: ORDER,
  recTradeId: 'D20260612X1',
  fallbackToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

function pgReject(): Error & { code: string } {
  return Object.assign(new Error('charge 簿記主軌失敗(P0001)'), { code: 'P0001' });
}

function makeStore(opts: {
  primaryMarkCharged?: () => Promise<void>;
  primaryMarkFailed?: () => Promise<void>;
  fallbackMarkCharged?: () => Promise<void>;
}) {
  // events trace:鎖死「呼叫順序」非只計次(codex 關卡2:P1→S100→P2→S300→P3→F1→S100→F2)。
  const events: string[] = [];
  const begin = vi.fn<(orderId: string) => Promise<BeginChargeAttemptResult>>(
    async () => ({ acquired: false, reason: 'order_locked' }),
  );
  const primaryMarkCharged = vi.fn(async () => {
    events.push('P');
    await (opts.primaryMarkCharged ?? (async () => {}))();
  });
  const primaryMarkFailed = vi.fn(async () => {
    events.push('PF');
    await (opts.primaryMarkFailed ?? (async () => {}))();
  });
  const fallbackMarkCharged = vi.fn(async () => {
    events.push('F');
    await (opts.fallbackMarkCharged ?? (async () => {}))();
  });
  // 3DS-4 sweeper 主軌-only port 方法(複合直通 primary、不走 fallback);具名 mock 供委派測。
  const primaryExpireStuck = vi.fn(async () => 0);
  const primaryClaimStuck = vi.fn(async () => [
    { attemptId: 'attempt-uuid-1', orderId: ORDER, settleCount: 2 },
  ]);
  const primaryMarkSettleRetry = vi.fn(async () => 1);
  const primaryFlagNonUnpaid = vi.fn(async () => 3);
  // 3DS-5b initiate 寫入主軌-only port 方法(複合直通 primary、不走 fallback);具名 mock 供委派測。
  const primaryRecordBankTxn = vi.fn(async () => {});
  const primaryRecordRec = vi.fn(async () => {});
  const primary: IChargeAttemptStore = {
    begin,
    markCharged: primaryMarkCharged,
    markFailed: primaryMarkFailed,
    // findActiveByOrderId 為 3DS-1b 新增 port 方法;本複合 markCharged/雙軌測不涉、stub 滿足介面。
    findActiveByOrderId: vi.fn(async () => null),
    expireStuckAtCeiling: primaryExpireStuck,
    claimStuckUnsettled: primaryClaimStuck,
    markSettleRetry: primaryMarkSettleRetry,
    flagNonUnpaidActive: primaryFlagNonUnpaid,
    recordInitiationBankTxn: primaryRecordBankTxn,
    recordInitiationRec: primaryRecordRec,
  };
  const fallback: ChargeAttemptFallbackRail = { markCharged: fallbackMarkCharged };
  // 顯式 call signature:令 sleep.mock.calls 為 [ms] tuple(可讀退避序列、非空 tuple)。
  const sleep = vi.fn<(ms: number) => Promise<void>>(async (ms) => {
    events.push(`S${ms}`);
  });
  const store = new ChargeAttemptStoreWithFallback(primary, fallback, sleep);
  return {
    store,
    begin,
    primaryMarkCharged,
    primaryMarkFailed,
    fallbackMarkCharged,
    primaryExpireStuck,
    primaryClaimStuck,
    primaryMarkSettleRetry,
    primaryFlagNonUnpaid,
    primaryRecordBankTxn,
    primaryRecordRec,
    sleep,
    events,
  };
}

describe('begin — 主軌 passthrough、不重試', () => {
  it('直通主軌、零 sleep', async () => {
    const { store, begin, sleep } = makeStore({});
    const res = await store.begin(ORDER);
    expect(res).toEqual({ acquired: false, reason: 'order_locked' });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('🔴 主軌 throw → 原樣上拋、不重試(called 1 次)、零 sleep 零備軌(失敗=零 charge 安全)', async () => {
    const { store, begin, sleep, fallbackMarkCharged } = makeStore({});
    begin.mockRejectedValueOnce(new Error('charge 簿記主軌失敗(transport)'));
    await expect(store.begin(ORDER)).rejects.toThrow('主軌失敗');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
  });
});

describe('markCharged — 🔴 主軌 ×3(退避 100/300ms)→ 備軌 ×2(退避 100ms)', () => {
  it('主軌首呼成功 → 備軌零觸碰、零 sleep', async () => {
    const { store, primaryMarkCharged, fallbackMarkCharged, sleep } = makeStore({});
    await store.markCharged(MARK_INPUT);
    expect(primaryMarkCharged).toHaveBeenCalledTimes(1);
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('主軌 transport 連敗 3 次 → 切備軌成功;計次 3+1、退避序列 [100,300]', async () => {
    const { store, primaryMarkCharged, fallbackMarkCharged, sleep } = makeStore({
      primaryMarkCharged: async () => {
        throw new Error('charge 簿記主軌失敗(transport)');
      },
    });
    await store.markCharged(MARK_INPUT);
    expect(primaryMarkCharged).toHaveBeenCalledTimes(3);
    expect(fallbackMarkCharged).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 300]);
  });

  it('🔴 主軌敗3切備軌成功:完整順序 P→S100→P→S300→P→F', async () => {
    const { store, events } = makeStore({
      primaryMarkCharged: async () => {
        throw new Error('charge 簿記主軌失敗(transport)');
      },
    });
    await store.markCharged(MARK_INPUT);
    expect(events).toEqual(['P', 'S100', 'P', 'S300', 'P', 'F']);
  });

  it('雙軌全敗 → throw 合併;🔴 完整順序 P→S100→P→S300→P→F→S100→F;髒錯誤(token/pg 原文)不外洩', async () => {
    const { store, events } = makeStore({
      primaryMarkCharged: async () => {
        // 模擬「下層忘了 sanitize」的最壞情況:錯誤訊息含 token + pg 原文(codex 關卡2 防線測)
        throw new Error(`raw pg secret-host-details token=${MARK_INPUT.fallbackToken}`);
      },
      fallbackMarkCharged: async () => {
        throw new Error(`fallback raw ${MARK_INPUT.fallbackToken}`);
      },
    });
    const err = (await store.markCharged(MARK_INPUT).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('雙軌全敗');
    expect(String(err)).not.toContain(MARK_INPUT.fallbackToken); // 🔴 複合層不串 err.message
    expect(String(err)).not.toContain('secret-host-details');
    expect(events).toEqual(['P', 'S100', 'P', 'S300', 'P', 'F', 'S100', 'F']);
  });

  it('🔴 主軌 P0001(業務拒)→ 該軌早停 1 次、不切備軌、原錯誤上拋(deterministic 同狀態機)', async () => {
    const { store, primaryMarkCharged, fallbackMarkCharged } = makeStore({
      primaryMarkCharged: async () => {
        throw pgReject();
      },
    });
    await expect(store.markCharged(MARK_INPUT)).rejects.toMatchObject({ code: 'P0001' });
    expect(primaryMarkCharged).toHaveBeenCalledTimes(1);
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
  });

  it('🔴 P0001 早停後零後續事件(無 sleep/無重試/無備軌)', async () => {
    const { store, events } = makeStore({
      primaryMarkCharged: async () => {
        throw pgReject();
      },
    });
    await store.markCharged(MARK_INPUT).catch(() => undefined);
    expect(events).toEqual(['P']);
  });

  it('主軌 transport 敗 → 備軌 P0001 → 早停 1 次、throw 合併', async () => {
    const { store, fallbackMarkCharged } = makeStore({
      primaryMarkCharged: async () => {
        throw new Error('charge 簿記主軌失敗(transport)');
      },
      fallbackMarkCharged: async () => {
        throw Object.assign(new Error('charge 簿記備軌失敗(P0001)'), { code: 'P0001' });
      },
    });
    const err = (await store.markCharged(MARK_INPUT).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('雙軌全敗');
    expect(fallbackMarkCharged).toHaveBeenCalledTimes(1); // P0001 早停、非 2
  });

  it('主軌第 2 次成功(transient)→ 不切備軌、計次 2', async () => {
    let n = 0;
    const { store, primaryMarkCharged, fallbackMarkCharged } = makeStore({
      primaryMarkCharged: async () => {
        n += 1;
        if (n === 1) {
          throw new Error('charge 簿記主軌失敗(transport)');
        }
      },
    });
    await store.markCharged(MARK_INPUT);
    expect(primaryMarkCharged).toHaveBeenCalledTimes(2);
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
  });
});

describe('markFailed — 🔴 主軌 only ×3、備軌永不參與(不可釋鎖)', () => {
  it('主軌連敗 3 次 → throw、備軌 markCharged 零觸碰', async () => {
    const { store, primaryMarkFailed, fallbackMarkCharged, sleep } = makeStore({
      primaryMarkFailed: async () => {
        throw new Error('charge 簿記主軌失敗(transport)');
      },
    });
    await expect(store.markFailed(MARK_INPUT)).rejects.toThrow('主軌失敗');
    expect(primaryMarkFailed).toHaveBeenCalledTimes(3);
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 300]);
  });

  it('🔴 markFailed 完整順序 PF→S100→PF→S300→PF(零 F 事件)', async () => {
    const { store, events } = makeStore({
      primaryMarkFailed: async () => {
        throw new Error('charge 簿記主軌失敗(transport)');
      },
    });
    await store.markFailed(MARK_INPUT).catch(() => undefined);
    expect(events).toEqual(['PF', 'S100', 'PF', 'S300', 'PF']);
  });

  it('主軌成功 → 零重試零備軌', async () => {
    const { store, primaryMarkFailed, fallbackMarkCharged } = makeStore({});
    await store.markFailed(MARK_INPUT);
    expect(primaryMarkFailed).toHaveBeenCalledTimes(1);
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
  });
});

describe('SupabaseChargeAttemptFallbackAdapter(備軌 RPC 參數/錯誤)', () => {
  it('rpc 參數對齊 fallback RPC 簽名(含 token);error → throw code 通用訊息', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const { SupabaseChargeAttemptFallbackAdapter } = await import(
      './SupabaseChargeAttemptFallbackAdapter'
    );
    const adapter = new SupabaseChargeAttemptFallbackAdapter({ rpc } as never);
    await adapter.markCharged(MARK_INPUT);
    expect(rpc).toHaveBeenCalledWith('mark_charge_attempt_charged_fallback', {
      p_attempt_id: MARK_INPUT.attemptId,
      p_order_id: MARK_INPUT.orderId,
      p_rec_trade_id: MARK_INPUT.recTradeId,
      p_fallback_token: MARK_INPUT.fallbackToken,
    });

    const rpcErr = vi.fn(async () => ({
      error: { code: 'P0001', message: 'mark_charge_attempt_charged_fallback: 付款處理失敗' },
    }));
    const adapter2 = new SupabaseChargeAttemptFallbackAdapter({ rpc: rpcErr } as never);
    const err = (await adapter2.markCharged(MARK_INPUT).catch((e: unknown) => e)) as Error & {
      code?: string;
    };
    expect(err.code).toBe('P0001');
    expect(String(err)).not.toContain(MARK_INPUT.fallbackToken);
  });
});

describe('3DS-4 sweeper 方法 — 主軌-only 直通(無 fallback、對齊 findActiveByOrderId)', () => {
  it('expireStuckAtCeiling 直通 primary + 回轉換筆數、零 sleep', async () => {
    const { store, primaryExpireStuck, sleep } = makeStore({});
    const res = await store.expireStuckAtCeiling();
    expect(primaryExpireStuck).toHaveBeenCalledTimes(1);
    expect(res).toBe(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('claimStuckUnsettled 直通 primary(原參數)+ 回傳 passthrough、零 sleep', async () => {
    const { store, primaryClaimStuck, sleep } = makeStore({});
    const res = await store.claimStuckUnsettled(600, 50);
    expect(primaryClaimStuck).toHaveBeenCalledTimes(1);
    expect(primaryClaimStuck).toHaveBeenCalledWith(600, 50);
    expect(res).toEqual([{ attemptId: 'attempt-uuid-1', orderId: ORDER, settleCount: 2 }]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('markSettleRetry 直通 primary(原參數)+ 回 affected', async () => {
    const { store, primaryMarkSettleRetry } = makeStore({});
    const res = await store.markSettleRetry('attempt-uuid-1', 2, 'record_unreachable');
    expect(primaryMarkSettleRetry).toHaveBeenCalledWith('attempt-uuid-1', 2, 'record_unreachable');
    expect(res).toBe(1);
  });

  it('flagNonUnpaidActive 直通 primary(原參數)+ 回標記筆數', async () => {
    const { store, primaryFlagNonUnpaid } = makeStore({});
    const res = await store.flagNonUnpaidActive(50);
    expect(primaryFlagNonUnpaid).toHaveBeenCalledWith(50);
    expect(res).toBe(3);
  });
});

describe('3DS-5b initiate 寫入方法 — 主軌-only 直通(無 fallback、對齊 findActiveByOrderId)', () => {
  it('recordInitiationBankTxn 直通 primary(原參數)、零 sleep 零備軌', async () => {
    const { store, primaryRecordBankTxn, fallbackMarkCharged, sleep } = makeStore({});
    await store.recordInitiationBankTxn('attempt-uuid-1', ORDER, 'P01234567890ABCDEF');
    expect(primaryRecordBankTxn).toHaveBeenCalledWith('attempt-uuid-1', ORDER, 'P01234567890ABCDEF');
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('🔴 recordInitiationBankTxn 主軌 throw(未 durable)→ 原樣上拋、不切備軌(use-case 映 init_failed)', async () => {
    const { store, primaryRecordBankTxn, fallbackMarkCharged } = makeStore({});
    primaryRecordBankTxn.mockRejectedValueOnce(new Error('record_charge_bank_txn 未 durable'));
    await expect(
      store.recordInitiationBankTxn('attempt-uuid-1', ORDER, 'P01234567890ABCDEF'),
    ).rejects.toThrow('未 durable');
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
  });

  it('recordInitiationRec 直通 primary(原參數)、零 sleep 零備軌', async () => {
    const { store, primaryRecordRec, fallbackMarkCharged, sleep } = makeStore({});
    await store.recordInitiationRec('attempt-uuid-1', ORDER, 'D20260619001234567');
    expect(primaryRecordRec).toHaveBeenCalledWith('attempt-uuid-1', ORDER, 'D20260619001234567');
    expect(fallbackMarkCharged).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});
