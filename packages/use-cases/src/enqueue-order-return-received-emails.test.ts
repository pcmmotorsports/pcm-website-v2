import { describe, expect, it, vi } from 'vitest';
import type { IEmailOutbox, IReturnReceivedScanner, ReturnReceivedWithoutEmail } from '@pcm/ports';
import { enqueueOrderReturnReceivedEmails } from './enqueue-order-return-received-emails';

// 退貨收回通知(2026-09-27, Sean A3 甲甲甲)—— 形狀照 enqueue-order-partially-cancelled-emails.test.ts, 少了金額與讓路。

const OPTS = { cutoff: '2026-09-27T00:00:00.000Z', limit: 50 };

function row(over: Partial<ReturnReceivedWithoutEmail> = {}): ReturnReceivedWithoutEmail {
  return {
    orderId: 'order-1',
    returnId: 'ret-1',
    displayId: 'PCM-2026-0001',
    receivedAt: '2026-09-27T10:00:00.000Z',
    receivedItems: [{ title: '煞車拉桿組', quantity: 1 }],
    notificationEmail: 'a@example.com',
    customerEmail: 'b@example.com',
    orderSource: 'web',
    ...over,
  };
}

function deps(rows: ReturnReceivedWithoutEmail[]) {
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, id: 'outbox-1' })),
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    enqueueManualNoRecipient: vi.fn(async () => ({ kind: 'skipped_manual_no_recipient', id: 'm1' })),
  } as unknown as IEmailOutbox;
  const scanner: IReturnReceivedScanner = {
    listReturnReceivedWithoutEmail: vi.fn(async () => ({ rows, scannedPages: 1, truncated: false })),
  };
  return { outbox, scanner };
}

describe('enqueueOrderReturnReceivedEmails', () => {
  it('🔴 正常一筆 ⇒ 排一封;收件人照 09-19 拍板「收件地址的 email 優先」', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r).toMatchObject({ scanned: 1, enqueued: 1, noRecipient: 0, unusable: 0, errors: 0 });
    expect(d.scanner.listReturnReceivedWithoutEmail).toHaveBeenCalledWith({ cutoff: OPTS.cutoff, limit: 50 });
    expect(d.outbox.enqueue).toHaveBeenCalledWith({
      eventType: 'order_return_received',
      orderId: 'order-1',
      displayId: 'PCM-2026-0001',
      returnId: 'ret-1',
      receivedAt: '2026-09-27T10:00:00.000Z',
      receivedItems: [{ title: '煞車拉桿組', quantity: 1 }],
      recipientEmail: 'a@example.com',
      requestId: null,
    });
  });

  it('沒有通知信箱 ⇒ 用會員信箱', async () => {
    const d = deps([row({ notificationEmail: '  ' })]);
    await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'b@example.com' }));
  });

  it('🔴 手動單沒有通知信箱 ⇒ 不寄給會員信箱, 留痕 skipped_manual_no_recipient', async () => {
    const d = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'b@example.com' })]);
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 0, noRecipient: 1 });
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
    expect(d.outbox.enqueueManualNoRecipient).toHaveBeenCalledTimes(1);
  });

  it('兩個信箱都沒有 ⇒ noRecipient, 不排', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: null })]);
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 0, noRecipient: 1 });
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 沒有實收品項或收回時間空白 ⇒ unusable, 不排(沒有東西可以說已收到)', async () => {
    const d = deps([row({ receivedItems: [] }), row({ returnId: 'ret-2', receivedAt: '' })]);
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r).toMatchObject({ scanned: 2, enqueued: 0, unusable: 2 });
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('同一張單退兩次 ⇒ 排兩封, returnId 不同', async () => {
    const d = deps([row(), row({ returnId: 'ret-2' })]);
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r.enqueued).toBe(2);
    const ids = (d.outbox.enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { returnId: string }).returnId);
    expect(ids).toEqual(['ret-1', 'ret-2']);
  });

  it('沒有真 email(LINE 登入的假信箱)⇒ 計 skippedNoRealEmail(之後由 LINE 那條路接手)', async () => {
    const d = deps([row()]);
    (d.outbox.enqueue as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ kind: 'skipped_no_real_email', id: 'x' });
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 0, skippedNoRealEmail: 1 });
  });

  it('enqueue 丟例外 ⇒ 計 error, 其他照排', async () => {
    const d = deps([row(), row({ returnId: 'ret-2' })]);
    (d.outbox.enqueue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const r = await enqueueOrderReturnReceivedEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 1, errors: 1 });
  });
});
