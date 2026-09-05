import { describe, expect, it, vi } from 'vitest';
import type { IEmailOutbox, IUnpaidCancelledOrderScanner } from '@pcm/ports';
import { enqueueOrderUnpaidCancelledEmails } from './enqueue-order-unpaid-cancelled-emails';

const OPTS = { cutoff: '2026-09-03T00:00:00.000Z', limit: 50 };

function row(over: Partial<Parameters<typeof mkRow>[0]> = {}) {
  return mkRow({
    orderId: 'order-1',
    displayId: 'PCM-2026-0001',
    cancelledAt: '2026-09-03T10:00:00.000Z',
    cancelledReason: 'out_of_stock',
    notificationEmail: 'a@example.com',
    customerEmail: null,
    // 🔴 片 B(⟦f3-MAILFALLBACKVSRULING⟧):型別要求它, 而【本片沒有任何行為讀它】
    //    ⇒ 這裡給 'web' 只是讓 fixture 通過型別;片 C 才會有人問它。
    orderSource: 'web',
    ...over,
  });
}
function mkRow(r: {
  orderId: string;
  displayId: string;
  cancelledAt: string;
  cancelledReason: string | null;
  notificationEmail: string | null;
  customerEmail: string | null;
  orderSource: string | null;
}) {
  return r;
}

function deps(rows: ReturnType<typeof row>[]) {
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, id: 'outbox-1' })),
  } as unknown as IEmailOutbox;
  const scanner: IUnpaidCancelledOrderScanner = {
    listUnpaidCancelledWithoutEmail: vi.fn(async () => ({
      rows,
      scannedPages: 1,
      truncated: false,
    })),
  };
  return { outbox, scanner };
}

describe('enqueueOrderUnpaidCancelledEmails', () => {
  it('🔴 正常一筆 ⇒ 排一封, 而 payload 帶取消時刻與理由', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(r.enqueued).toBe(1);
    expect(d.outbox.enqueue).toHaveBeenCalledExactlyOnceWith({
      eventType: 'order_unpaid_cancelled',
      orderId: 'order-1',
      displayId: 'PCM-2026-0001',
      cancelledAt: '2026-09-03T10:00:00.000Z',
      cancelledReason: 'out_of_stock',
      recipientEmail: 'a@example.com',
      requestId: null,
    });
  });

  it('🔴 兩個信箱都空 ⇒ 不 enqueue, 計 noRecipient(空字串也算空)', async () => {
    const d = deps([row({ notificationEmail: '   ', customerEmail: null })]);
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(r.noRecipient).toBe(1);
    expect(r.enqueued).toBe(0);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 notification 空 ⇒ 退化到 customerEmail', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: 'b@example.com' })]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    const arg = (d.outbox.enqueue as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as {
      recipientEmail: string;
    };
    expect(arg.recipientEmail).toBe('b@example.com');
  });

  it('🔴 單筆 enqueue 炸掉 ⇒ 不擋整批, 計 errors', async () => {
    const d = deps([row({ orderId: 'a' }), row({ orderId: 'b' })]);
    (d.outbox.enqueue as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error('boom'),
    );
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(r.errors).toBe(1);
    expect(r.enqueued).toBe(1);
  });

  it('🔴 result 只有數字 —— 沒有任何一欄帶得出 email(PII)', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(JSON.stringify(r)).not.toContain('@');
  });
});
