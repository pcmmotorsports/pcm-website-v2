import { describe, expect, it, vi } from 'vitest';
import type { ClaimedEmailJob, IEmailOutbox, IEmailSender, SendEmailResult } from '@pcm/ports';
import { computeEmailBackoff, LEASE_RECLAIM_RETRY_DELAY_MS } from './email-backoff';
import { sweepEmailOutbox, type SweepEmailOutboxOptions } from './sweep-email-outbox';

const NOW = new Date('2026-07-17T10:00:00.000Z');

const OPTS: SweepEmailOutboxOptions = {
  claimLimit: 20,
  maxRunSeconds: 60,
  leaseSeconds: 3600,
  now: () => NOW,
  random: () => 0,
};

/** 依序回傳指定時點的假時鐘(超出序列後重覆最後一個;鎖「單一快照」類斷言用)。 */
function tickingClock(offsetsMs: number[]): () => Date {
  let i = 0;
  return () => new Date(NOW.getTime() + offsetsMs[Math.min(i++, offsetsMs.length - 1)]!);
}

function job(overrides: Partial<ClaimedEmailJob> = {}): ClaimedEmailJob {
  return {
    id: 'outbox-1',
    eventType: 'order_created',
    orderId: 'order-1',
    dedupKey: 'order-1',
    recipientEmail: 'customer@example.com',
    subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
    payload: { event_version: 1, display_id: 'PCM-2026-0001', paid_at: '2026-07-17T09:00:00.000Z' },
    attempts: 1,
    maxAttempts: 5,
    requestId: null,
    ...overrides,
  };
}

type OutboxFake = IEmailOutbox & {
  reclaimStaleLeases: ReturnType<typeof vi.fn>;
  claimDue: ReturnType<typeof vi.fn>;
  markSent: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
};

function outboxFake(jobs: ClaimedEmailJob[], overrides: Partial<Record<keyof IEmailOutbox, unknown>> = {}): OutboxFake {
  return {
    enqueue: vi.fn().mockRejectedValue(new Error('sweeper 不應呼叫 enqueue')),
    claimById: vi.fn().mockRejectedValue(new Error('sweeper 不應呼叫 claimById')),
    reclaimStaleLeases: vi.fn().mockResolvedValue(0),
    claimDue: vi.fn().mockResolvedValue(jobs),
    markSent: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    markSkippedOrderIneligible: vi.fn().mockRejectedValue(new Error('ineligible gate = E2a-2、本片不呼')),
    ...(overrides as object),
  } as OutboxFake;
}

function senderFake(results: SendEmailResult[]): IEmailSender & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  for (const r of results) send.mockResolvedValueOnce(r);
  return { send };
}

describe('sweepEmailOutbox — lease/maxRunSeconds 物理擋', () => {
  it.each([[3599], [0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'leaseSeconds=%s(< 3600 或非有限)→ throw、零副作用',
    async (leaseSeconds) => {
      const outbox = outboxFake([]);
      await expect(
        sweepEmailOutbox({ outbox, sender: senderFake([]) }, { ...OPTS, leaseSeconds: leaseSeconds as number }),
      ).rejects.toThrow(/leaseSeconds/);
      expect(outbox.reclaimStaleLeases).not.toHaveBeenCalled();
      expect(outbox.claimDue).not.toHaveBeenCalled();
    },
  );

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'maxRunSeconds=%s(非 ≥1 有限數)→ throw、零副作用',
    async (maxRunSeconds) => {
      const outbox = outboxFake([]);
      await expect(
        sweepEmailOutbox({ outbox, sender: senderFake([]) }, { ...OPTS, maxRunSeconds: maxRunSeconds as number }),
      ).rejects.toThrow(/maxRunSeconds/);
      expect(outbox.reclaimStaleLeases).not.toHaveBeenCalled();
    },
  );

  it('lease 必須 ≥ maxRunSeconds + 偏差餘裕 300:maxRunSeconds=3500、lease=3600 → throw(3600 < 3800)', async () => {
    const outbox = outboxFake([]);
    await expect(
      sweepEmailOutbox({ outbox, sender: senderFake([]) }, { ...OPTS, maxRunSeconds: 3500, leaseSeconds: 3600 }),
    ).rejects.toThrow(/leaseSeconds/);
    await expect(
      sweepEmailOutbox({ outbox, sender: senderFake([]) }, { ...OPTS, maxRunSeconds: 3500, leaseSeconds: 3800 }),
    ).resolves.toBeDefined();
  });
});

describe('sweepEmailOutbox — ① lease 回收', () => {
  it('claim 前必呼、staleBefore = now - lease、nextRetryAt = now + 5min(§⑩)', async () => {
    const outbox = outboxFake([]);
    outbox.reclaimStaleLeases.mockResolvedValue(2);
    const res = await sweepEmailOutbox({ outbox, sender: senderFake([]) }, OPTS);
    expect(outbox.reclaimStaleLeases).toHaveBeenCalledExactlyOnceWith(
      new Date(NOW.getTime() - 3600 * 1000),
      new Date(NOW.getTime() + LEASE_RECLAIM_RETRY_DELAY_MS),
    );
    // 回收先於 claim(claim 前必跑的順序合約)
    expect(outbox.reclaimStaleLeases.mock.invocationCallOrder[0]!).toBeLessThan(
      outbox.claimDue.mock.invocationCallOrder[0]!,
    );
    expect(res.reclaimed).toBe(2);
  });

  it('回收 throw → errors+1、不阻斷 claim 與寄送(fail-closed 續跑)', async () => {
    const outbox = outboxFake([job()]);
    outbox.reclaimStaleLeases.mockRejectedValue(new Error('db down'));
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    expect(res.errors).toBe(1);
    expect(res.reclaimed).toBe(0);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(1);
  });
});

describe('sweepEmailOutbox — ② claim', () => {
  it('claimDue 帶 claimLimit;throw → errors+1、本輪零寄送', async () => {
    const outbox = outboxFake([]);
    outbox.claimDue.mockRejectedValue(new Error('db down'));
    const sender = senderFake([]);
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    expect(outbox.claimDue).toHaveBeenCalledExactlyOnceWith(20);
    expect(res.errors).toBe(1);
    expect(res.claimed).toBe(0);
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('sweepEmailOutbox — ③ 寄送與標記', () => {
  it('sent → markSent(id, attempts 世代柵欄原樣帶回);send 入參座標正確、text 含 display_id 零 PII', async () => {
    const j = job({ attempts: 3 });
    const outbox = outboxFake([j]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    expect(sender.send).toHaveBeenCalledExactlyOnceWith({
      to: 'customer@example.com',
      subject: j.subject,
      text: expect.stringContaining('PCM-2026-0001') as string,
      idempotency: { eventType: 'order_created', outboxId: 'outbox-1' },
    });
    // 內文不含收件者 email(PII 不進模板)
    const sentText = (sender.send.mock.calls[0]![0] as { text: string }).text;
    expect(sentText).not.toContain('customer@example.com');
    expect(outbox.markSent).toHaveBeenCalledExactlyOnceWith('outbox-1', 3);
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(res).toEqual({ reclaimed: 0, claimed: 1, sent: 1, failed: 0, deferred: 0, staleMarks: 0, errors: 0 });
  });

  it('failed → markFailed(errorCode + email-backoff 算的 nextRetryAt)', async () => {
    const j = job({ attempts: 2 });
    const outbox = outboxFake([j]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'quota_daily_exceeded' }]);
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    expect(outbox.markFailed).toHaveBeenCalledExactlyOnceWith(
      'outbox-1',
      2,
      'quota_daily_exceeded',
      computeEmailBackoff('quota_daily_exceeded', 2, NOW, () => 0),
    );
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    expect(res.errors).toBe(0);
  });

  it('failed(指數碼)→ nextRetryAt 隨 attempts 翻倍(鎖 attempts→退避 wiring;R1 must-fix 2)', async () => {
    const j = job({ attempts: 3 });
    const outbox = outboxFake([j]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'http_500' }]);
    await sweepEmailOutbox({ outbox, sender }, OPTS);
    // attempts=3 → 5min×2^2 = 20min;sweeper 若寫死 attempts(如恆 1 → 5min)此斷言必紅
    expect(outbox.markFailed).toHaveBeenCalledExactlyOnceWith(
      'outbox-1',
      3,
      'http_500',
      new Date(NOW.getTime() + 20 * 60_000),
    );
  });

  it('markSent 回 false(所有權已失)→ staleMarks+1、非 error、不重標', async () => {
    const outbox = outboxFake([job()]);
    outbox.markSent.mockResolvedValue(false);
    const res = await sweepEmailOutbox({ outbox, sender: senderFake([{ kind: 'sent' }]) }, OPTS);
    expect(res.staleMarks).toBe(1);
    expect(res.sent).toBe(1);
    expect(res.errors).toBe(0);
    expect(outbox.markSent).toHaveBeenCalledTimes(1);
  });

  it('markFailed 回 false → staleMarks+1、非 error', async () => {
    const outbox = outboxFake([job()]);
    outbox.markFailed.mockResolvedValue(false);
    const res = await sweepEmailOutbox(
      { outbox, sender: senderFake([{ kind: 'failed', errorCode: 'http_500' }]) },
      OPTS,
    );
    expect(res.staleMarks).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toBe(0);
  });

  it('sender throw(合約違反)→ errors+1、零 mark(列留 sending 待下輪回收)、不中斷後續封', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2', dedupKey: 'order-2', orderId: 'order-2' });
    const outbox = outboxFake([j1, j2]);
    const sender = { send: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ kind: 'sent' }) };
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    expect(res.errors).toBe(1);
    expect(outbox.markSent).toHaveBeenCalledExactlyOnceWith('outbox-2', 1);
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(res.sent).toBe(1);
  });

  it('mark* throw(DB 錯)→ errors+1、續處理後續封;sent 仍記 provider 裁決數 2(codex R1 must-fix 3)', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2' });
    const outbox = outboxFake([j1, j2]);
    outbox.markSent.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(true);
    const res = await sweepEmailOutbox({ outbox, sender: senderFake([{ kind: 'sent' }, { kind: 'sent' }]) }, OPTS);
    expect(res.errors).toBe(1);
    expect(res.sent).toBe(2);
    expect(outbox.markSent).toHaveBeenCalledTimes(2);
  });

  it('markFailed throw → errors+1、failed 仍記 provider 裁決數(同上、失敗側)', async () => {
    const outbox = outboxFake([job()]);
    outbox.markFailed.mockRejectedValue(new Error('db down'));
    const res = await sweepEmailOutbox(
      { outbox, sender: senderFake([{ kind: 'failed', errorCode: 'http_500' }]) },
      OPTS,
    );
    expect(res.errors).toBe(1);
    expect(res.failed).toBe(1);
  });

  it('order_shipped 列(DB 合法可造)→ 寄送前 fail-closed:sender 零呼叫、errors+1、零 mark(codex R1 must-fix 2)', async () => {
    const outbox = outboxFake([job({ eventType: 'order_shipped', dedupKey: 'order-1/batch-1' })]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    expect(sender.send).not.toHaveBeenCalled();
    expect(outbox.markSent).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(res.errors).toBe(1);
    expect(res.sent).toBe(0);
  });

  it('時間預算耗盡 → 停寄、剩餘列計 deferred(codex R1 must-fix 1 縱深)', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2' });
    const j3 = job({ id: 'outbox-3' });
    const outbox = outboxFake([j1, j2, j3]);
    const sender = senderFake([{ kind: 'sent' }, { kind: 'sent' }, { kind: 'sent' }]);
    // now 呼叫序:①sweepStartedAt t0 ②job1 預算檢查 t0+1s(過)③job2 預算檢查 t0+61s(超 60s 停)
    const res = await sweepEmailOutbox(
      { outbox, sender },
      { ...OPTS, now: tickingClock([0, 1000, 61_000]) },
    );
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(res.deferred).toBe(2);
    expect(res.sent).toBe(1);
    expect(res.claimed).toBe(3);
    expect(res.errors).toBe(0);
  });

  it('回收參數出自單一時鐘快照:前進時鐘下 nextRetryAt-staleBefore 恆 = lease+5min(codex R1 must-fix 4)', async () => {
    const outbox = outboxFake([]);
    await sweepEmailOutbox(
      { outbox, sender: senderFake([]) },
      { ...OPTS, now: tickingClock([0, 1000, 2000, 3000]) },
    );
    const [staleBefore, nextRetryAt] = outbox.reclaimStaleLeases.mock.calls[0]! as [Date, Date];
    expect(nextRetryAt.getTime() - staleBefore.getTime()).toBe(3600 * 1000 + LEASE_RECLAIM_RETRY_DELAY_MS);
  });

  it('省略 now/random(production 預設路徑)→ 正常執行、回收參數與退避皆在真時鐘合理界內', async () => {
    const outbox = outboxFake([job()]);
    const sender = senderFake([{ kind: 'failed', errorCode: 'quota_daily_exceeded' }]);
    const before = Date.now();
    const res = await sweepEmailOutbox({ outbox, sender }, { claimLimit: 20, maxRunSeconds: 60, leaseSeconds: 3600 });
    const after = Date.now();
    const [staleBefore, nextRetryAt] = outbox.reclaimStaleLeases.mock.calls[0]! as [Date, Date];
    expect(nextRetryAt.getTime() - staleBefore.getTime()).toBe(3600 * 1000 + LEASE_RECLAIM_RETRY_DELAY_MS);
    expect(staleBefore.getTime()).toBeGreaterThanOrEqual(before - 3600 * 1000);
    expect(staleBefore.getTime()).toBeLessThanOrEqual(after - 3600 * 1000);
    const retryArg = (outbox.markFailed.mock.calls[0]! as [string, number, string, Date])[3];
    // 真 Math.random:quota 列 = [失敗時點+24h, +24h30m)
    expect(retryArg.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000);
    expect(retryArg.getTime()).toBeLessThan(after + 24 * 3600 * 1000 + 30 * 60_000);
    expect(res.failed).toBe(1);
  });

  it('逐封順序寄送(前一封 mark 完才寄下一封;無並發)', async () => {
    const j1 = job({ id: 'outbox-1' });
    const j2 = job({ id: 'outbox-2' });
    const outbox = outboxFake([j1, j2]);
    const sender = senderFake([{ kind: 'sent' }, { kind: 'sent' }]);
    await sweepEmailOutbox({ outbox, sender }, OPTS);
    const firstMark = outbox.markSent.mock.invocationCallOrder[0]!;
    const secondSend = sender.send.mock.invocationCallOrder[1]!;
    expect(firstMark).toBeLessThan(secondSend);
  });

  it('payload 形狀異常 → 仍寄(通用文案、不含編號)、不因文案缺欄擋信', async () => {
    const outbox = outboxFake([job({ payload: 'not-an-object' })]);
    const sender = senderFake([{ kind: 'sent' }]);
    const res = await sweepEmailOutbox({ outbox, sender }, OPTS);
    const text = (sender.send.mock.calls[0]![0] as { text: string }).text;
    expect(text).toContain('已付款成功');
    expect(res.sent).toBe(1);
  });
});

describe('sweepEmailOutbox — 結果形狀(零 PII 合約)', () => {
  it('result 鍵恰為 counts 七欄(堵日後多塞 recipient/payload 等 PII 欄)', async () => {
    const res = await sweepEmailOutbox({ outbox: outboxFake([]), sender: senderFake([]) }, OPTS);
    expect(Object.keys(res).sort()).toEqual([
      'claimed',
      'deferred',
      'errors',
      'failed',
      'reclaimed',
      'sent',
      'staleMarks',
    ]);
  });

  it('本 use-case 零告警(Q13=A):不呼 enqueue/claimById/markSkippedOrderIneligible、無 notifier 依賴', async () => {
    const outbox = outboxFake([job()]);
    await sweepEmailOutbox({ outbox, sender: senderFake([{ kind: 'sent' }]) }, OPTS);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(outbox.claimById).not.toHaveBeenCalled();
    expect(outbox.markSkippedOrderIneligible).not.toHaveBeenCalled();
  });
});
