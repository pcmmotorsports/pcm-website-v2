import { describe, expect, it, vi } from 'vitest';
import type { IEmailOutbox, IPartialRefundOrderScanner } from '@pcm/ports';
import { enqueueOrderPartiallyRefundedEmails } from './enqueue-order-partially-refunded-emails';

const OPTS = { cutoff: '2026-09-08T00:00:00.000Z', limit: 50 };

function row(over: Partial<Parameters<typeof mkRow>[0]> = {}) {
  return mkRow({
    orderId: 'order-1',
    displayId: 'PCM-2026-0001',
    refundId: 'refund-1',
    refundedAmount: 1200,
    refundedAt: '2026-09-08T10:00:00.000Z',
    notificationEmail: 'a@example.com',
    customerEmail: null,
    orderSource: 'web',
    ...over,
  });
}
function mkRow(r: {
  orderId: string;
  displayId: string;
  refundId: string;
  refundedAmount: number;
  refundedAt: string;
  notificationEmail: string | null;
  customerEmail: string | null;
  orderSource: string | null;
}) {
  return r;
}

function deps(rows: ReturnType<typeof row>[]) {
  const outbox = {
    enqueue: vi.fn(async () => ({ kind: 'enqueued' as const, id: 'outbox-1' })),
    // 🔵 預設「全都是新的」。🛑 少了這一行, `as unknown as` 會讓 typecheck 照樣綠,
    //    而測試在執行期才炸。
    countNewEvents: vi.fn(async (i: readonly unknown[]) => i.length),
  } as unknown as IEmailOutbox;
  const scanner: IPartialRefundOrderScanner = {
    listPartialRefundsWithoutEmail: vi.fn(async () => ({
      rows,
      scannedPages: 1,
      truncated: false,
    })),
  };
  return { outbox, scanner };
}

describe('enqueueOrderPartiallyRefundedEmails(QB-16 真正的部分退款)', () => {
  it('🔴 正常一筆 ⇒ 排一封, 而 input 帶 refundId / 金額 / 時點', async () => {
    const d = deps([row()]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.scanned).toBe(1);
    expect(r.enqueued).toBe(1);
    expect(r.unusableAmount).toBe(0);
    const sent = vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      eventType: 'order_partially_refunded',
      refundId: 'refund-1',
      refundedAmount: 1200,
      refundedAt: '2026-09-08T10:00:00.000Z',
      recipientEmail: 'a@example.com',
    });
  });

  /**
   * 🔴🔴 **本檔最承重的一格 —— 它釘的是「每次都寄」。**
   * 同一張單的**兩筆**退款 ⇒ **兩個 input, 而 `refundId` 必須不同**。
   * 🛑 如果哪天有人把落表邊界的 `dedupKey` 從 `refundId` 改回 `orderId`,
   *    行為會退化成「只寄第一次」而**這一格不會紅**(它看的是 use-case 這一層)
   *    ⇒ 📌 那一層由 `SupabaseEmailOutboxAdapter` 的 dedup 分派與 view 的**事後閘④**守。
   *    **三層各守一段, 而它們守不到彼此。**
   */
  it('🔴 分批退:同一張單兩筆退款 ⇒ 排兩封, 而兩個 refundId 不同', async () => {
    const d = deps([
      row({ refundId: 'refund-1', refundedAmount: 1200 }),
      row({ refundId: 'refund-2', refundedAmount: 800 }),
    ]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.scanned).toBe(2);
    expect(r.enqueued).toBe(2);
    const ids = vi.mocked(d.outbox.enqueue).mock.calls.map((c) => (c[0] as { refundId: string }).refundId);
    expect(ids).toEqual(['refund-1', 'refund-2']);
    // 🔵 而金額也要各自帶自己那一筆 —— 不是和(2000), 也不是同一個值兩次
    const amounts = vi
      .mocked(d.outbox.enqueue)
      .mock.calls.map((c) => (c[0] as { refundedAmount: number }).refundedAmount);
    expect(amounts).toEqual([1200, 800]);
  });

  /**
   * 🔴 **金額讀不到 ⇒ 不排, 而且【不是】計成 error。**
   * A 2026-09-08 收 plan §④:本封信存在的唯一理由就是那個金額
   * ⇒ 說不出金額的信比不寄糟。而分開計數, 是為了讓「資料不完整」與「系統出錯」
   *   在報表上分得開(兩者的處置不同)。
   */
  it.each([
    ['0 元', { refundedAmount: 0 }],
    ['負數', { refundedAmount: -1 }],
    ['小數', { refundedAmount: 12.5 }],
    ['NaN', { refundedAmount: Number.NaN }],
    ['時點空字串', { refundedAt: '' }],
    ['時點只有空白', { refundedAt: '   ' }],
  ])('🔴 %s ⇒ 不排, 計 unusableAmount 而不是 errors', async (_label, over) => {
    const d = deps([row(over)]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.enqueued).toBe(0);
    expect(r.unusableAmount).toBe(1);
    expect(r.errors).toBe(0);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🟢 正對照:壞的那筆不會把好的那筆一起擋掉', async () => {
    const d = deps([row({ refundId: 'bad', refundedAmount: 0 }), row({ refundId: 'good' })]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.unusableAmount).toBe(1);
    expect(r.enqueued).toBe(1);
    const ids = vi.mocked(d.outbox.enqueue).mock.calls.map((c) => (c[0] as { refundId: string }).refundId);
    expect(ids).toEqual(['good']);
  });

  it('🔴 兩個信箱都空 ⇒ 不排, 計 noRecipient', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: null })]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.noRecipient).toBe(1);
    expect(r.enqueued).toBe(0);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🔵 notificationEmail 空 ⇒ 退化用 customerEmail(web 單)', async () => {
    const d = deps([row({ notificationEmail: null, customerEmail: 'b@example.com' })]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.enqueued).toBe(1);
    expect(vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0]).toMatchObject({
      recipientEmail: 'b@example.com',
    });
  });

  /**
   * 🔴 **手動建單留白 = 不寄**(Sean 拍板;⟦f3-MAILFALLBACKVSRULING⟧)。
   * 判準是【兩個條件】:`manual_*` **而且** `notification_email` 為空。
   */
  it('🔴 手動建單 + notificationEmail 空 ⇒ 不退化到 customerEmail ⇒ 不排', async () => {
    const d = deps([
      row({ orderSource: 'manual_phone', notificationEmail: null, customerEmail: 'b@example.com' }),
    ]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.noRecipient).toBe(1);
    expect(d.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('🟢 正對照:手動建單而 notificationEmail 有值 ⇒ 照排', async () => {
    const d = deps([
      row({ orderSource: 'manual_phone', notificationEmail: 'c@example.com', customerEmail: null }),
    ]);
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.enqueued).toBe(1);
    expect(vi.mocked(d.outbox.enqueue).mock.calls[0]?.[0]).toMatchObject({
      recipientEmail: 'c@example.com',
    });
  });

  it('🔴 單筆 enqueue 炸掉 ⇒ 計 errors, 不擋下一筆', async () => {
    const d = deps([row({ refundId: 'r1' }), row({ refundId: 'r2' })]);
    vi.mocked(d.outbox.enqueue)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'x' });
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.errors).toBe(1);
    expect(r.enqueued).toBe(1);
  });

  it('🔵 duplicate / skipped_no_real_email 各自計數', async () => {
    const d = deps([row({ refundId: 'r1' }), row({ refundId: 'r2' })]);
    vi.mocked(d.outbox.enqueue)
      .mockResolvedValueOnce({ kind: 'duplicate' })
      .mockResolvedValueOnce({ kind: 'skipped_no_real_email', id: 'y' });
    const r = await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(r.duplicate).toBe(1);
    expect(r.skippedNoRealEmail).toBe(1);
    expect(r.enqueued).toBe(0);
  });

  /**
   * 🔴 **批次上限的分母是 `countNewEvents`, 不是 `rows.length`。**
   * 掃描面會放回「我們自己 skip 過」而 `enqueue()` 會回 `duplicate` 的舊列
   * ⇒ 拿掃描列數當分母, 撞鍵的舊列會把真的該寄的信一起擋掉
   * ⇒ 📌 **防止多寄的閘變成永久少寄。**
   */
  it('🔴 countNewEvents 回 0 ⇒ 就算掃到很多列也不撞閘', async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ refundId: `r${i}` }));
    const d = deps(many);
    vi.mocked((d.outbox as unknown as { countNewEvents: ReturnType<typeof vi.fn> }).countNewEvents)
      .mockResolvedValueOnce(0);
    await expect(enqueueOrderPartiallyRefundedEmails(d, OPTS)).resolves.toBeDefined();
  });

  it('🔵 cutoff 與 limit 原樣傳給 scanner', async () => {
    const d = deps([]);
    await enqueueOrderPartiallyRefundedEmails(d, OPTS);
    expect(d.scanner.listPartialRefundsWithoutEmail).toHaveBeenCalledWith({
      cutoff: '2026-09-08T00:00:00.000Z',
      limit: 50,
    });
  });
});
