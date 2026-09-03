// M-4a E2a-2(W3-G 拆出)寄送前 ineligible gate 的 use-case 測試。
// 跨片組合的紅綠雙向證明(gate 沒接 vs 接了,sweeper 會不會真的寄出)在
// order-ineligible-gate-integration.test.ts,本檔只驗這支 use-case 自己的邏輯。
import { describe, it, expect, vi } from 'vitest';
import type { ClaimedEmailJob, DueIneligibleEmailJob, IEmailOutbox, IIneligibleOrderEmailScanner } from '@pcm/ports';

import { applyOrderIneligibleGate } from './apply-order-ineligible-gate';

function candidate(over: Partial<DueIneligibleEmailJob> = {}): DueIneligibleEmailJob {
  // 🔴 預設 `order_created` = **該被擋**的那個世界(既有測項跑的全是它)。
  //    ⚠️ 而**那是一個世界, 不是一個中性預設** ⇒ 另一個世界(取消信 ⇒ 不該被擋)
  //    有它專屬的一節, 不靠這個預設代表它。
  return { id: 'outbox-1', orderId: 'order-1', eventType: 'order_created', ...over };
}

function claimedJob(over: Partial<ClaimedEmailJob> = {}): ClaimedEmailJob {
  return {
    id: 'outbox-1',
    eventType: 'order_created',
    orderId: 'order-1',
    dedupKey: 'order-1',
    recipientEmail: 'customer@example.com',
    subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
    payload: { event_version: 1, display_id: 'PCM-2026-0001', paid_at: '2026-08-18T10:00:00.000Z' },
    attempts: 1,
    maxAttempts: 5,
    requestId: null,
    ...over,
  };
}

function deps(candidates: DueIneligibleEmailJob[], overrides: Partial<Record<keyof IEmailOutbox, unknown>> = {}) {
  const scanner = {
    listDueIneligible: vi.fn(async () => candidates),
  } as unknown as IIneligibleOrderEmailScanner;
  const outbox = {
    enqueue: vi.fn().mockRejectedValue(new Error('本片不應呼叫 enqueue')),
    claimDue: vi.fn().mockRejectedValue(new Error('本片不應批次認領 —— 只碰候選,不碰合格的列')),
    markSent: vi.fn().mockRejectedValue(new Error('本片不應呼叫 markSent')),
    markFailed: vi.fn().mockRejectedValue(new Error('本片不應呼叫 markFailed')),
    reclaimStaleLeases: vi.fn().mockRejectedValue(new Error('本片不應呼叫 reclaimStaleLeases')),
    claimById: vi.fn(async () => claimedJob()),
    markSkippedOrderIneligible: vi.fn(async () => true),
    ...(overrides as object),
  } as unknown as IEmailOutbox;
  return { deps: { scanner, outbox }, scanner, outbox };
}

describe('applyOrderIneligibleGate — 寄送前 gate', () => {
  it('候選被 claim + mark 成功 ⇒ markedIneligible=1,scanner limit 原樣傳遞', async () => {
    const { deps: d, scanner, outbox } = deps([candidate()]);
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(scanner.listDueIneligible).toHaveBeenCalledWith(30);
    expect(outbox.claimById).toHaveBeenCalledWith('outbox-1');
    expect(outbox.markSkippedOrderIneligible).toHaveBeenCalledWith('outbox-1', 1); // claimedJob().attempts
    expect(res).toEqual({ scanned: 1, markedIneligible: 1, raceLost: 0, errors: 0 });
  });

  it('零候選 ⇒ 完全不碰 claimById/markSkippedOrderIneligible(不是合格的列也不會被摸到)', async () => {
    const { deps: d, outbox } = deps([]);
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(outbox.claimById).not.toHaveBeenCalled();
    expect(outbox.markSkippedOrderIneligible).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 0, markedIneligible: 0, raceLost: 0, errors: 0 });
  });

  it('🔴 claimById 拿不到(null)⇒ raceLost,不是 errors —— 未知結果(可能已被安全結案,也可能是 sweeper 搶先寄出),不是「安全」', async () => {
    const { deps: d, outbox } = deps([candidate()], { claimById: vi.fn(async () => null) });
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(outbox.markSkippedOrderIneligible).not.toHaveBeenCalled(); // 沒 claim 到就不該再 mark
    expect(res).toEqual({ scanned: 1, markedIneligible: 0, raceLost: 1, errors: 0 });
  });

  it('🔴 markSkippedOrderIneligible 回 false(世代柵欄沒對上)⇒ raceLost,不覆寫別人的在途列', async () => {
    const { deps: d } = deps([candidate()], { markSkippedOrderIneligible: vi.fn(async () => false) });
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(res).toEqual({ scanned: 1, markedIneligible: 0, raceLost: 1, errors: 0 });
  });

  it('claimById 本身 throw ⇒ errors,不中斷其他候選', async () => {
    const two = [candidate({ id: 'a' }), candidate({ id: 'b', orderId: 'order-2' })];
    const claimById = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB 掛了'))
      .mockResolvedValueOnce(claimedJob({ id: 'b', orderId: 'order-2', attempts: 2 }));
    const { deps: d, outbox } = deps(two, { claimById });
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(outbox.markSkippedOrderIneligible).toHaveBeenCalledTimes(1);
    expect(outbox.markSkippedOrderIneligible).toHaveBeenCalledWith('b', 2);
    expect(res).toEqual({ scanned: 2, markedIneligible: 1, raceLost: 0, errors: 1 });
  });

  it('markSkippedOrderIneligible 本身 throw ⇒ errors', async () => {
    const { deps: d } = deps([candidate()], {
      markSkippedOrderIneligible: vi.fn().mockRejectedValue(new Error('DB 掛了')),
    });
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(res).toEqual({ scanned: 1, markedIneligible: 0, raceLost: 0, errors: 1 });
  });

  it('多筆候選各自獨立計數,順序處理', async () => {
    const three = [candidate({ id: 'a' }), candidate({ id: 'b' }), candidate({ id: 'c' })];
    const claimById = vi
      .fn()
      .mockResolvedValueOnce(claimedJob({ id: 'a', attempts: 1 }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(claimedJob({ id: 'c', attempts: 3 }));
    const { deps: d } = deps(three, { claimById });
    const res = await applyOrderIneligibleGate(d, { limit: 30 });

    expect(res).toEqual({ scanned: 3, markedIneligible: 2, raceLost: 1, errors: 0 });
  });
});
describe('取消信不走這道閘(Q10 前置;而【既有兩封信行為必須逐字不變】)', () => {
  // 🔴🔴 這條路**比寄送那條更早**把列標成 `skipped_order_ineligible` ——
  //    只修寄送那條 = 修了一半, 而取消信仍然被這裡先撈走、標成終態、**沒有人在看**。
  it.each([
    ['order_cancelled', 'order_cancelled' as const],
    ['order_unpaid_cancelled', 'order_unpaid_cancelled' as const],
  ])('🔴 %s ⇒ 不被撈進來(scanned = 0, 一列都沒標)', async (_l, eventType) => {
    const outbox = {
      claimById: vi.fn(),
      markSkippedOrderIneligible: vi.fn(),
    } as unknown as IEmailOutbox;
    const scanner: IIneligibleOrderEmailScanner = {
      listDueIneligible: async () => [candidate({ eventType })],
      listIneligibleAmong: async () => ['order-1'],
    };
    const r = await applyOrderIneligibleGate({ outbox, scanner }, { limit: 30 });
    expect(r.scanned).toBe(0);
    expect(r.markedIneligible).toBe(0);
    // 🎯 最重要的一格:**它一次都沒被認領** —— 沒被認領就不會被標成終態
    expect(outbox.claimById).not.toHaveBeenCalled();
  });

  // 🟢 **反向世界非做不可** —— 少了它,「一律不撈」的實作也會通過上面兩格
  it.each([
    ['order_created', 'order_created' as const],
    ['order_shipped', 'order_shipped' as const],
  ])('🟢 %s ⇒ 照舊被撈進來(既有行為逐字不變)', async (_l, eventType) => {
    const outbox = {
      claimById: vi.fn(async () => null),
      markSkippedOrderIneligible: vi.fn(),
    } as unknown as IEmailOutbox;
    const scanner: IIneligibleOrderEmailScanner = {
      listDueIneligible: async () => [candidate({ eventType })],
      listIneligibleAmong: async () => ['order-1'],
    };
    const r = await applyOrderIneligibleGate({ outbox, scanner }, { limit: 30 });
    expect(r.scanned).toBe(1);
    expect(outbox.claimById).toHaveBeenCalledTimes(1);
  });
});

