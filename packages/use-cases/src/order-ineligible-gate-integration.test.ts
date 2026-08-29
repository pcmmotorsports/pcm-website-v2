// M-4a E2a-2(W3-G 拆出)紅綠雙向組合證明。
//
// 主張:「排進 outbox 之後、真正寄出之前才被取消的訂單」——
// 🔴 紅:沒有 applyOrderIneligibleGate 時,sweepEmailOutbox 單獨跑會【真的寄出】那封信。
// ✅ 綠:applyOrderIneligibleGate 先跑完一整輪(happy path、無 interleaving)之後,
//        sweepEmailOutbox 再跑就【找不到那一列】、不會寄。
//
// 用真的狀態機(in-memory,而非逐方法 mock)重現 claim/mark 的實際語意,
// 而不是斷言「呼叫過某個方法」——那證明不了「信真的沒寄出去」。
//
// 🔴🔴 **本檔只證明兩個 use-case【依序、不交錯】執行時的行為 —— 不證明 race 被關閉**
// (2026-08-20 codex 關卡2 R2 must-fix 4):兩支 use-case 是各自獨立的 cron,實際執行時可能
// interleave(gate 的 claimById 與 sweeper 的 claimDue 對同一列競爭)。本檔的 seed 只有一列、
// 全程同步執行,沒有模擬「gate 掃到候選之後、claim 之前,sweeper 先搶到那一列」的時序 ——
// 那個 race 的存在與殘留是 `apply-order-ineligible-gate.ts` 檔頭與本片交件明文承認的已知限制,
// 不是這裡沒測到就代表它不存在。
import { describe, it, expect, vi } from 'vitest';
import type { ClaimedEmailJob, IEmailOutbox, IEmailSender, IIneligibleOrderEmailScanner, SendEmailResult } from '@pcm/ports';

import { applyOrderIneligibleGate } from './apply-order-ineligible-gate';
import { sweepEmailOutbox, type SweepEmailOutboxOptions } from './sweep-email-outbox';

type Status = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped_order_ineligible';

type Row = {
  id: string;
  orderId: string;
  status: Status;
  attempts: number;
  maxAttempts: number;
  claimedAt: string | null;
  nextRetryAt: string;
  lastErrorCode: string | null;
};

/**
 * 真的狀態機(claim=CAS、mark*=世代柵欄比對),不是逐方法 mock —— 這樣才證明得了
 * 「同一列」在兩個 use-case 之間的實際流轉,而不是各自獨立的呼叫斷言。
 * 只實作本次測試會用到的方法;其餘(enqueue/reclaimStaleLeases)不需要就不寫,呼叫到才發現漏了。
 */
class InMemoryOutbox
  implements Pick<IEmailOutbox, 'claimDue' | 'claimById' | 'markSent' | 'markFailed' | 'markSkippedOrderIneligible' | 'reclaimStaleLeases'>
{
  constructor(public rows: Map<string, Row>) {}

  /** 本次測試沒有 stale sending 列 ⇒ 一律 0 筆回收(sweepEmailOutbox 每輪都會呼叫這個)。 */
  async reclaimStaleLeases(): Promise<number> {
    return 0;
  }

  private toJob(row: Row): ClaimedEmailJob {
    return {
      id: row.id,
      eventType: 'order_created',
      orderId: row.orderId,
      dedupKey: row.orderId,
      recipientEmail: 'customer@example.com',
      subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
      payload: { event_version: 1, display_id: 'PCM-2026-0001', paid_at: '2026-08-18T10:00:00.000Z' },
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      requestId: null,
    };
  }

  async claimDue(limit: number): Promise<ClaimedEmailJob[]> {
    const now = new Date().toISOString();
    const claimed: ClaimedEmailJob[] = [];
    for (const row of this.rows.values()) {
      if (claimed.length >= limit) break;
      if ((row.status === 'pending' || row.status === 'failed') && row.nextRetryAt <= now && row.attempts < row.maxAttempts) {
        row.status = 'sending';
        row.claimedAt = now;
        row.attempts += 1;
        claimed.push(this.toJob(row));
      }
    }
    return claimed;
  }

  async claimById(id: string): Promise<ClaimedEmailJob | null> {
    const row = this.rows.get(id);
    const now = new Date().toISOString();
    if (!row) return null;
    if (!(row.status === 'pending' || row.status === 'failed')) return null;
    if (row.nextRetryAt > now) return null;
    if (row.attempts >= row.maxAttempts) return null;
    row.status = 'sending';
    row.claimedAt = now;
    row.attempts += 1;
    return this.toJob(row);
  }

  async markSent(id: string, claimedAttempts: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'sending' || row.attempts !== claimedAttempts) return false;
    row.status = 'sent';
    row.claimedAt = null;
    return true;
  }

  async markFailed(id: string, claimedAttempts: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'sending' || row.attempts !== claimedAttempts) return false;
    row.status = 'failed';
    row.claimedAt = null;
    return true;
  }

  async markSkippedOrderIneligible(id: string, claimedAttempts: number): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== 'sending' || row.attempts !== claimedAttempts) return false;
    row.status = 'skipped_order_ineligible';
    row.claimedAt = null;
    row.lastErrorCode = 'order_ineligible';
    return true;
  }
}

/** 兩列(order-1 / order-2),用來演「寄第 1 封的期間第 2 張單被取消」。 */
function seedTwoRows(): Map<string, Row> {
  const mk = (n: number): [string, Row] => [
    `outbox-${n}`,
    {
      id: `outbox-${n}`,
      orderId: `order-${n}`,
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      claimedAt: null,
      nextRetryAt: '2020-01-01T00:00:00.000Z',
      lastErrorCode: null,
    },
  ];
  return new Map([mk(1), mk(2)]);
}

function seedRow(): Map<string, Row> {
  return new Map([
    [
      'outbox-1',
      {
        id: 'outbox-1',
        orderId: 'order-1',
        status: 'pending',
        attempts: 0,
        maxAttempts: 5,
        claimedAt: null,
        nextRetryAt: '2020-01-01T00:00:00.000Z', // 早就到期
        lastErrorCode: null,
      },
    ],
  ]);
}

const SWEEP_OPTS: SweepEmailOutboxOptions = { claimLimit: 10, maxRunSeconds: 60, leaseSeconds: 3600 };

describe('E2a-2 ineligible gate — 紅綠雙向組合證明', () => {
  /**
   * 🔴 **這一節在 2026-08-30 被改寫過,而【原本那個測項是紅的證人】,所以改寫的理由要留著:**
   *    原本第一格逐字是「🔴 紅:沒有 gate 時,訂單已被取消,sweepEmailOutbox 單獨跑仍會真的
   *    把信寄出去」—— 它證的是**那個洞當時真的在**(它 assert `send` 被呼叫了 1 次)。
   *    Sean 2026-08-30 拍「Q2 取消信縫 = 甲 搬」⇒ 合格性檢查搬進 sweeper 自己 ⇒
   *    **那個世界不存在了**:同樣的輸入現在一封都不會寄。
   *    ⇒ 所以它改成證【現在會擋】,而不是刪掉 —— 刪掉的話,下一個人不會知道這裡曾經漏過。
   */
  it('✅ 綠(取代原本那個紅的證人):訂單已不合格 ⇒ sweeper 自己就不寄,不必靠另一支排程先跑', async () => {
    const store = new InMemoryOutbox(seedRow());
    const send = vi.fn(async (): Promise<SendEmailResult> => ({ kind: 'sent' }));
    const sender: IEmailSender = { send };

    const result = await sweepEmailOutbox(
      {
        outbox: store as unknown as IEmailOutbox,
        sender,
        ineligibleScanner: {
          listDueIneligible: async () => [],
          listIneligibleAmong: async () => ['order-1'],
        },
      },
      SWEEP_OPTS,
    );

    expect(send).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.skippedIneligible).toBe(1);
    expect(store.rows.get('outbox-1')!.status).toBe('skipped_order_ineligible');
  });

  it('🔴 對照:同一份輸入,只把 scanner 換成「都合格」⇒ 信會寄出去(證明擋住它的是那道閘,不是別的)', async () => {
    const store = new InMemoryOutbox(seedRow());
    const send = vi.fn(async (): Promise<SendEmailResult> => ({ kind: 'sent' }));
    const sender: IEmailSender = { send };

    const result = await sweepEmailOutbox(
      {
        outbox: store as unknown as IEmailOutbox,
        sender,
        ineligibleScanner: { listDueIneligible: async () => [], listIneligibleAmong: async () => [] },
      },
      SWEEP_OPTS,
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });

  /**
   * 🔴🔴 **codex 2026-08-30 must-fix 換來的一格:快照老化。**
   *    第一版是在迴圈【前】讀一次批次快照 ⇒ 寄第 50 封時那份快照已經是 49 封之前的
   *    ⇒ 窗口是【單輪的長度】(最多約 60 秒),不是註解宣稱的毫秒級。
   *    ⇒ 改成逐封讀之後,這一格才有辦法紅/綠 —— 而它演的正是那個世界:
   *      **第 2 張單是在第 1 封【正在寄】的時候才被取消的。**
   *    📌 這一格若拿掉逐封讀就會紅 ⇒ 它是那個修法的證人,不是裝飾。
   */
  it('🔴 快照老化:第 2 張單在第 1 封寄送【期間】才被取消 ⇒ 第 2 封必須不寄', async () => {
    const store = new InMemoryOutbox(seedTwoRows());
    const cancelled = new Set<string>();
    const send = vi.fn(async (): Promise<SendEmailResult> => {
      // 第 1 封寄出去的那一刻,order-2 才被取消(這就是那個縫)
      cancelled.add('order-2');
      return { kind: 'sent' };
    });
    const sender: IEmailSender = { send };

    const result = await sweepEmailOutbox(
      {
        outbox: store as unknown as IEmailOutbox,
        sender,
        ineligibleScanner: {
          listDueIneligible: async () => [],
          listIneligibleAmong: async (ids) => ids.filter((id) => cancelled.has(id)),
        },
      },
      SWEEP_OPTS,
    );

    expect(send).toHaveBeenCalledTimes(1); // ✅ 第 1 封照寄(它那時還合格)
    expect(result.sent).toBe(1);
    expect(result.skippedIneligible).toBe(1); // 🔴 第 2 封被攔下
    expect(store.rows.get('outbox-2')!.status).toBe('skipped_order_ineligible');
  });

  it('🛑 fail-closed:合格性讀不到(scanner throw)⇒ 這一輪一封都不寄、列留 sending 給下輪回收', async () => {
    const store = new InMemoryOutbox(seedRow());
    const send = vi.fn(async (): Promise<SendEmailResult> => ({ kind: 'sent' }));
    const sender: IEmailSender = { send };

    const result = await sweepEmailOutbox(
      {
        outbox: store as unknown as IEmailOutbox,
        sender,
        ineligibleScanner: {
          listDueIneligible: async () => [],
          listIneligibleAmong: async () => {
            throw new Error('boom');
          },
        },
      },
      SWEEP_OPTS,
    );

    // 讀不到就不寄 —— 放行才是那道閘在最需要它的那一刻自動消失
    expect(send).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    // 🔴 codex must-fix:不再借用 `deferred`(它的定義是「時間預算耗盡」,借用會讓營運端
    //    去調 claimLimit 而真正的病在 DB)⇒ 獨立一欄。
    expect(result.eligibilityUnknown).toBe(1);
    expect(result.deferred).toBe(0);
    expect(store.rows.get('outbox-1')!.status).toBe('sending');
  });

  it('✅ 綠:gate 先跑一輪標記 ineligible,sweepEmailOutbox 再跑就找不到那一列、不會寄', async () => {
    const store = new InMemoryOutbox(seedRow());
    const scanner: IIneligibleOrderEmailScanner = {
      // 模擬 W5/W3-G 的失敗情境:掃描器看到的是「outbox-1 對應的訂單已不合格」。
      listDueIneligible: vi.fn(async () => [{ id: 'outbox-1', orderId: 'order-1' }]),
      listIneligibleAmong: async () => ['order-1'],
    };

    const gateResult = await applyOrderIneligibleGate({ outbox: store as unknown as IEmailOutbox, scanner }, { limit: 30 });
    expect(gateResult.markedIneligible).toBe(1);
    expect(store.rows.get('outbox-1')!.status).toBe('skipped_order_ineligible');
    expect(store.rows.get('outbox-1')!.lastErrorCode).toBe('order_ineligible');

    const send = vi.fn(async (): Promise<SendEmailResult> => ({ kind: 'sent' }));
    const sender: IEmailSender = { send };
    const sweepResult = await sweepEmailOutbox(
      { outbox: store as unknown as IEmailOutbox, sender, ineligibleScanner: scanner },
      SWEEP_OPTS,
    );

    expect(send).not.toHaveBeenCalled(); // ✅ 那一列已經不是 pending/failed 了,claimDue 撈不到它
    expect(sweepResult.claimed).toBe(0);
    expect(sweepResult.sent).toBe(0);
  });
});
