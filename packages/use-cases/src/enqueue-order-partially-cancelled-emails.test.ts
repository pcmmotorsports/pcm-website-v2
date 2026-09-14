import { describe, expect, it, vi } from 'vitest';
import type { IEmailOutbox, IPartiallyCancelledOrderScanner, PartiallyCancelledWithoutEmail } from '@pcm/ports';
import { enqueueOrderPartiallyCancelledEmails } from './enqueue-order-partially-cancelled-emails';

// 部分取消補寄信(2026-09-14, Sean 甲甲甲)—— 形狀照 enqueue-order-partially-refunded-emails.test.ts。

const OPTS = { cutoff: '2026-09-14T00:00:00.000Z', limit: 50 };

function row(over: Partial<PartiallyCancelledWithoutEmail> = {}): PartiallyCancelledWithoutEmail {
  return {
    orderId: 'order-1',
    displayId: 'PCM-2026-0001',
    cancellationId: 'cxl-1',
    cancelledAt: '2026-09-14T10:00:00.000Z',
    cancelledItems: [{ title: '排氣管尾段', quantity: 1 }],
    effectiveSubtotal: 8750,
    effectiveShippingFee: 0,
    remainingReceivable: 8750,
    paidTotal: 13830,
    notificationEmail: 'a@example.com',
    customerEmail: null,
    orderSource: 'web',
    ...over,
  };
}

function deps(rows: PartiallyCancelledWithoutEmail[]) {
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, id: 'outbox-1' })),
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
    enqueueManualNoRecipient: vi.fn(async () => ({ kind: 'skipped_manual_no_recipient', id: 'm1' })),
  } as unknown as IEmailOutbox;
  const scanner: IPartiallyCancelledOrderScanner = {
    listPartiallyCancelledWithoutEmail: vi.fn(async () => ({ rows, scannedPages: 1, truncated: false })),
  };
  return { outbox, scanner };
}

describe('enqueueOrderPartiallyCancelledEmails', () => {
  it('🔴 正常一筆 ⇒ 排一封, input 帶 cancellationId / 品項 / 四個金額', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderPartiallyCancelledEmails(d, OPTS);
    expect(r).toMatchObject({ scanned: 1, enqueued: 1, noRecipient: 0, unusableAmount: 0, errors: 0 });
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'order_partially_cancelled',
        orderId: 'order-1',
        cancellationId: 'cxl-1',
        cancelledItems: [{ title: '排氣管尾段', quantity: 1 }],
        effectiveSubtotal: 8750,
        effectiveShippingFee: 0,
        remainingReceivable: 8750,
        paidTotal: 13830,
        recipientEmail: 'a@example.com',
      }),
    );
  });

  it('🔴 同一張單取消兩次 ⇒ 排兩封, cancellationId 不同(Sean Q1 甲:每次各寄一封)', async () => {
    const d = deps([row({ cancellationId: 'cxl-1' }), row({ cancellationId: 'cxl-2', cancelledItems: [{ title: null, quantity: 2 }] })]);
    const r = await enqueueOrderPartiallyCancelledEmails(d, OPTS);
    expect(r.enqueued).toBe(2);
    const ids = (d.outbox.enqueue as unknown as { mock: { calls: Array<[{ cancellationId: string }]> } }).mock.calls.map((c) => c[0].cancellationId);
    expect(ids).toEqual(['cxl-1', 'cxl-2']);
  });

  it('🔴 remainingReceivable null(含稅單稅算不出)⇒ 不排、計 unusableAmount;好的那筆照排', async () => {
    const d = deps([row({ remainingReceivable: null }), row({ cancellationId: 'cxl-ok' })]);
    const r = await enqueueOrderPartiallyCancelledEmails(d, OPTS);
    expect(r).toMatchObject({ scanned: 2, enqueued: 1, unusableAmount: 1 });
  });

  it('🔴 品項為空 / 取消時刻空 ⇒ unusableAmount', async () => {
    const d = deps([row({ cancelledItems: [] }), row({ cancellationId: 'c2', cancelledAt: '' })]);
    const r = await enqueueOrderPartiallyCancelledEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 0, unusableAmount: 2 });
  });

  it('🔴 兩個信箱都空 ⇒ 不排, 計 noRecipient;web 單 notificationEmail 空 ⇒ 退化用 customerEmail', async () => {
    const d1 = deps([row({ notificationEmail: null, customerEmail: null })]);
    expect(await enqueueOrderPartiallyCancelledEmails(d1, OPTS)).toMatchObject({ enqueued: 0, noRecipient: 1 });
    const d2 = deps([row({ notificationEmail: null, customerEmail: 'c@example.com' })]);
    expect(await enqueueOrderPartiallyCancelledEmails(d2, OPTS)).toMatchObject({ enqueued: 1 });
    expect(d2.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'c@example.com' }));
  });

  it('🔴 手動建單 + notificationEmail 空 ⇒ 不退化到 customerEmail ⇒ enqueueManualNoRecipient 一次、enqueue 零次', async () => {
    const d = deps([row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'm@example.com' })]);
    const r = await enqueueOrderPartiallyCancelledEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 0, noRecipient: 1 });
    expect(d.outbox.enqueueManualNoRecipient).toHaveBeenCalledTimes(1);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔵 duplicate / skipped_no_real_email / 炸掉 各自計數, 不擋下一筆;cutoff 與 limit 原樣傳給 scanner', async () => {
    const d = deps([row({ cancellationId: 'a' }), row({ cancellationId: 'b' }), row({ cancellationId: 'c' })]);
    (d.outbox.enqueue as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ kind: 'duplicate' })
      .mockResolvedValueOnce({ kind: 'skipped_no_real_email', id: 'x' })
      .mockRejectedValueOnce(new Error('boom'));
    const r = await enqueueOrderPartiallyCancelledEmails(d, OPTS);
    expect(r).toMatchObject({ enqueued: 0, duplicate: 1, skippedNoRealEmail: 1, errors: 1 });
    expect(d.scanner.listPartiallyCancelledWithoutEmail).toHaveBeenCalledWith({ cutoff: OPTS.cutoff, limit: 50 });
  });
});
