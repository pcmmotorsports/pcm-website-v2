// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  SupabaseEmailOutboxAdapter,
  isSyntheticEmail,
  type EmailOutboxClient,
  type EmailOutboxQueryBuilder,
} from './SupabaseEmailOutboxAdapter';
import { orderCreatedSubject } from './order-email-assembly';
import type { EnqueueEmailInput, EmailSendErrorCode } from '@pcm/ports';

/** 測試用假域(真值由 composition 從 line.ts 注入;測試不複製正式字面 = 單一來源紀律)。 */
const FAKE_DOMAIN = 'line.example.local';

type Resp = { data: unknown; error: { code?: string; message: string } | null };

/** 鏈式 thenable builder mock:任意鏈方法回自身、await 回注入結果;紀錄呼叫供斷言。 */
function makeBuilder(result: Resp) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = { calls };
  for (const m of ['insert', 'select', 'update', 'eq', 'in', 'lt', 'lte', 'order', 'limit']) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    });
  }
  b.then = (resolve: (v: Resp) => unknown) => Promise.resolve(result).then(resolve);
  return b as unknown as EmailOutboxQueryBuilder & { calls: Array<[string, unknown[]]> };
}

function makeClient(...builders: EmailOutboxQueryBuilder[]): EmailOutboxClient {
  const from = vi.fn();
  for (const b of builders) {
    from.mockReturnValueOnce(b);
  }
  return { from } as unknown as EmailOutboxClient;
}

function argsOf(b: { calls: Array<[string, unknown[]]> }, method: string): unknown[][] {
  return b.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const BASE_INPUT: EnqueueEmailInput = {
  eventType: 'order_created',
  orderId: 'ord-uuid-1',
  displayId: 'PCM-2026-0001',
  paidAt: '2026-07-17T02:00:00Z',
  recipientEmail: 'customer@example.com',
  requestId: 'req-1',
};

const JOB_ROW = {
  id: 'outbox-1',
  event_type: 'order_created',
  order_id: 'ord-uuid-1',
  dedup_key: 'ord-uuid-1',
  recipient_email: 'customer@example.com',
  subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
  payload: { event_version: 1 },
  attempts: 0,
  max_attempts: 5,
  request_id: 'req-1',
};

function adapter(client: EmailOutboxClient) {
  return new SupabaseEmailOutboxAdapter(client, { syntheticEmailDomain: FAKE_DOMAIN });
}

describe('isSyntheticEmail(假信箱 gate 判準)', () => {
  it('命中合成域(含大小寫/前後空白正規化)→ true', () => {
    expect(isSyntheticEmail('line_u1@line.example.local', FAKE_DOMAIN)).toBe(true);
    expect(isSyntheticEmail('  Line_U1@LINE.Example.LOCAL  ', FAKE_DOMAIN)).toBe(true);
    expect(isSyntheticEmail('a@line.example.local', ' LINE.example.local ')).toBe(true);
  });
  it('真實域 / 子字串偽陽性 / 無 @ → false', () => {
    expect(isSyntheticEmail('customer@example.com', FAKE_DOMAIN)).toBe(false);
    // 域名必須整段等值,尾碼相似不算(防 endsWith 誤判族)。
    expect(isSyntheticEmail('a@evil-line.example.local.attacker.com', FAKE_DOMAIN)).toBe(false);
    expect(isSyntheticEmail('not-an-email', FAKE_DOMAIN)).toBe(false);
  });
});

describe('SupabaseEmailOutboxAdapter.enqueue(落表邊界內部重組)', () => {
  it('真實信箱 → 顯式逐欄 insert、status=pending、subject/payload/dedup_key 皆內部重組', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const result = await adapter(makeClient(b)).enqueue(BASE_INPUT);
    expect(result).toEqual({ kind: 'enqueued', id: 'outbox-1' });
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;
    expect(row.status).toBe('pending');
    expect(row.event_type).toBe('order_created');
    // 🔴 三個危險欄呼叫端無法指定:dedup_key=orderId、subject=固定模板、payload=allowlist 三欄。
    expect(row.dedup_key).toBe('ord-uuid-1');
    expect(row.subject).toBe(orderCreatedSubject('PCM-2026-0001'));
    expect(row.payload).toEqual({
      event_version: 1,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-07-17T02:00:00Z',
    });
    // 🔴 REQUIRED-E1b:落表欄位 = 固定 8 欄 allowlist。
    expect(Object.keys(row).sort()).toEqual([
      'dedup_key',
      'event_type',
      'order_id',
      'payload',
      'recipient_email',
      'request_id',
      'status',
      'subject',
    ]);
  });

  it('🔴 直接呼叫 adapter 偷渡 PII(多餘欄位/假 subject/假 payload)→ 不落表(codex R1 迴歸)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const dirty = {
      ...BASE_INPUT,
      customerPhone: '0912345678',
      subject: '偷渡的 subject 含電話 0987654321',
      payload: { email: 'leak@example.com' },
    } as unknown as EnqueueEmailInput;
    await adapter(makeClient(b)).enqueue(dirty);
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;
    const json = JSON.stringify(row);
    expect(json).not.toContain('0912345678');
    expect(json).not.toContain('0987654321');
    expect(json).not.toContain('leak@example.com');
    expect(row.subject).toBe(orderCreatedSubject('PCM-2026-0001'));
    expect(row.payload).toEqual({
      event_version: 1,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-07-17T02:00:00Z',
    });
  });

  it('🔴 合成假信箱 → status=skipped_no_real_email、回 skipped(不進 due、E3 據此不呼 Resend)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-2' }], error: null });
    const result = await adapter(makeClient(b)).enqueue({
      ...BASE_INPUT,
      recipientEmail: 'line_Uabc@LINE.example.local',
    });
    expect(result).toEqual({ kind: 'skipped_no_real_email', id: 'outbox-2' });
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;
    expect(row.status).toBe('skipped_no_real_email');
    // gate 只做判斷、不改寫落表原值。
    expect(row.recipient_email).toBe('line_Uabc@LINE.example.local');
  });

  it('23505 + 查核同事件同訂單 → duplicate 冪等、不 throw(codex R1:不盲回)', async () => {
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({ data: [{ id: 'outbox-1', order_id: 'ord-uuid-1' }], error: null });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(BASE_INPUT)).resolves.toEqual({
      kind: 'duplicate',
    });
    expect(argsOf(verifyB, 'eq')).toEqual([
      ['event_type', 'order_created'],
      ['dedup_key', 'ord-uuid-1'],
    ]);
  });

  it('🔴 23505 但查無同事件列(=PK/其他約束撞鍵)→ throw、不得吞成 duplicate', async () => {
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({ data: [], error: null });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(BASE_INPUT)).rejects.toThrow(
      '查無同事件列',
    );
  });

  it('🔴 23505 且 dedup_key 撞到別張訂單 → throw(跨訂單碰撞=漏信前兆、拒回 duplicate)', async () => {
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({
      data: [{ id: 'outbox-9', order_id: 'ord-uuid-OTHER' }],
      error: null,
    });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(BASE_INPUT)).rejects.toThrow(
      '跨訂單碰撞',
    );
  });

  it('其他 DB 錯誤 → throw,且錯誤訊息不含收件者(PII 不進錯誤)', async () => {
    const b = makeBuilder({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(adapter(makeClient(b)).enqueue(BASE_INPUT)).rejects.toThrow('42501');
    try {
      await adapter(
        makeClient(makeBuilder({ data: null, error: { code: '42501', message: 'x' } })),
      ).enqueue(BASE_INPUT);
    } catch (e) {
      expect((e as Error).message).not.toContain('customer@example.com');
    }
  });
});

describe('SupabaseEmailOutboxAdapter.claimDue / claimById(CAS 認領)', () => {
  it('due 掃描後逐列 CAS:寫 sending+claimed_at+attempts+1,述詞含樂觀鎖與上限 guard', async () => {
    const dueB = makeBuilder({ data: [JOB_ROW], error: null });
    const casB = makeBuilder({ data: [{ ...JOB_ROW, attempts: 1 }], error: null });
    const jobs = await adapter(makeClient(dueB, casB)).claimDue(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe('outbox-1');
    expect(jobs[0]!.attempts).toBe(1);
    // due 述詞:pending|failed + next_retry_at <= now。
    expect(argsOf(dueB, 'in')[0]).toEqual(['status', ['pending', 'failed']]);
    expect(argsOf(dueB, 'lte')[0]![0]).toBe('next_retry_at');
    // CAS:update 值 + WHERE id/status/attempts 樂觀鎖/attempts<max。
    const casUpdate = argsOf(casB, 'update')[0]![0] as Record<string, unknown>;
    expect(casUpdate.status).toBe('sending');
    expect(casUpdate.claimed_at).toEqual(expect.any(String));
    expect(casUpdate.attempts).toBe(1);
    expect(argsOf(casB, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['attempts', 0],
    ]);
    expect(argsOf(casB, 'in')[0]).toEqual(['status', ['pending', 'failed']]);
    expect(argsOf(casB, 'lt')[0]).toEqual(['attempts', 5]);
  });

  it('🔴 死列(attempts >= max_attempts)不進 CAS(REQUIRED-E2a guard 的 app 半段)', async () => {
    const dead = { ...JOB_ROW, id: 'outbox-dead', attempts: 5, max_attempts: 5 };
    const dueB = makeBuilder({ data: [dead], error: null });
    const client = makeClient(dueB);
    const jobs = await adapter(client).claimDue(10);
    expect(jobs).toEqual([]);
    // 只打了 due 掃描那一次,沒有第二次 from()(= 零 CAS 嘗試)。
    expect((client.from as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('🔴 R1 Critical 迴歸:死列佔滿排序最前(恆最老),活信仍被認領、不被 limit 餓死', async () => {
    // 死列 next_retry_at 恆最老 → PostgREST 回列排最前;limit=2 若先裁再過濾 = 全是死列。
    const deadRows = Array.from({ length: 5 }, (_, i) => ({
      ...JOB_ROW,
      id: `outbox-dead-${i}`,
      dedup_key: `dead-${i}`,
      attempts: 5,
      max_attempts: 5,
    }));
    const live = { ...JOB_ROW, id: 'outbox-live', dedup_key: 'live-1' };
    const dueB = makeBuilder({ data: [...deadRows, live], error: null });
    const casB = makeBuilder({ data: [{ ...live, attempts: 1 }], error: null });
    const jobs = await adapter(makeClient(dueB, casB)).claimDue(2);
    expect(jobs.map((j) => j.id)).toEqual(['outbox-live']);
    // 取大窗:DB 端 limit = max(caller limit, DUE_SCAN_CAP=200)、非 caller 的 2。
    expect(argsOf(dueB, 'limit')[0]).toEqual([200]);
  });

  it('limit = 認領上限:湊滿即停、不多打 CAS', async () => {
    const rowB = { ...JOB_ROW, id: 'outbox-b', dedup_key: 'ord-uuid-2' };
    const dueB = makeBuilder({ data: [JOB_ROW, rowB], error: null });
    const casB = makeBuilder({ data: [{ ...JOB_ROW, attempts: 1 }], error: null });
    const client = makeClient(dueB, casB);
    const jobs = await adapter(client).claimDue(1);
    expect(jobs).toHaveLength(1);
    // from() 恰 2 次 = due 掃描 + 1 次 CAS(第二列不再嘗試)。
    expect((client.from as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('CAS 搶輸(0 列)→ 該列靜默略過、其餘照常(搶輸不消耗認領額度)', async () => {
    const rowB = { ...JOB_ROW, id: 'outbox-b', dedup_key: 'ord-uuid-2', order_id: 'ord-uuid-2' };
    const dueB = makeBuilder({ data: [JOB_ROW, rowB], error: null });
    const loseCas = makeBuilder({ data: [], error: null });
    const winCas = makeBuilder({ data: [{ ...rowB, attempts: 1 }], error: null });
    const jobs = await adapter(makeClient(dueB, loseCas, winCas)).claimDue(1);
    expect(jobs.map((j) => j.id)).toEqual(['outbox-b']);
  });

  it('claimById:非 due(查無列)→ null;命中 → CAS 認領', async () => {
    const missB = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(missB)).claimById('outbox-x')).toBeNull();

    const hitB = makeBuilder({ data: [JOB_ROW], error: null });
    const casB = makeBuilder({ data: [{ ...JOB_ROW, attempts: 1 }], error: null });
    const job = await adapter(makeClient(hitB, casB)).claimById('outbox-1');
    expect(job?.id).toBe('outbox-1');
    expect(argsOf(hitB, 'eq')[0]).toEqual(['id', 'outbox-1']);
  });
});

describe('SupabaseEmailOutboxAdapter 離開 sending 三出口(雙向 CHECK + ABA 世代柵欄)', () => {
  it('markSent:status=sent + sent_at + 🔴 claimed_at=NULL,述詞鎖 sending + attempts 世代', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    expect(await adapter(makeClient(b)).markSent('outbox-1', 1)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('sent');
    expect(vals.claimed_at).toBeNull();
    expect(vals.sent_at).toEqual(expect.any(String));
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  it('🔴 ABA 迴歸(codex R1):lease 回收+他人再認領(attempts 已推進)→ 舊世代標記 0 列 → false', async () => {
    // DB 端:列現況 status=sending、attempts=2(B 的認領);A 帶舊世代 1 來標 → eq(attempts,1) 失配。
    const b = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(b)).markSent('outbox-1', 1)).toBe(false);
    // 述詞確實帶了世代柵欄(這就是 0 列的機制,不是碰巧)。
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  it('markFailed:status=failed + 錯誤碼 + next_retry_at + 🔴 claimed_at=NULL;attempts 不遞增', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const retryAt = new Date('2026-07-17T03:00:00Z');
    expect(await adapter(makeClient(b)).markFailed('outbox-1', 1, 'http_429', retryAt)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('failed');
    expect(vals.last_error_code).toBe('http_429');
    expect(vals.next_retry_at).toBe(retryAt.toISOString());
    expect(vals.claimed_at).toBeNull();
    expect(vals).not.toHaveProperty('attempts');
  });

  it('🔴 runtime allowlist 迴歸(codex R1):過 DB regex 但非 allowlist 的碼 → 改寫 provider_error', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    // 'sean_0912345678' 符合 ^[a-z0-9_]{1,64}$ = DB 擋不住的 PII 走私樣本。
    const rogue = 'sean_0912345678' as EmailSendErrorCode;
    await adapter(makeClient(b)).markFailed('outbox-1', 1, rogue, new Date());
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.last_error_code).toBe('provider_error');
  });

  it('markSkippedOrderIneligible:不可翻轉終態 + 🔴 last_error_code=order_ineligible(稽核碼必寫)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    expect(await adapter(makeClient(b)).markSkippedOrderIneligible('outbox-1', 1)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('skipped_order_ineligible');
    expect(vals.last_error_code).toBe('order_ineligible');
    expect(vals.claimed_at).toBeNull();
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  it('所有權已失(lease 被回收、0 列)→ false 不覆寫', async () => {
    const b = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(b)).markSent('outbox-1', 1)).toBe(false);
  });
});
