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

/**
 * 🔴🔴 **手動建單留白 = 不寄**(Sean 拍板;板列 `⟦f3-MAILFALLBACKVSRULING⟧` 片 C)。
 *
 * ## 四個世界都要有格 —— 少一個就分不出「修對了」與「全部關掉了」
 * ```
 * ① 手動 + 留白   ⇒ 🔴 不寄(而不是退回 customers.email)
 * ② 手動 + 有值   ⇒ ✅ 寄到那個值   ← 少了它, 一個「手動一律不寄」的實作也全綠
 * ③ 顧客站 + 留白 ⇒ ✅ 寄到 customers.email(現狀不得變)
 * ④ 顧客站 + 有值 ⇒ ✅ 寄到那個值
 * ```
 * 🔵 **負對照:`manual_line` / `manual_other` 各跑一發** ——
 *    只測 `manual_phone` 的話,一個寫死 `=== 'manual_phone'` 的實作**每一格都綠**。
 *
 * ## ⚠️ 這一組【證不到】什麼
 * 它驗的是**這一層的分流**,不驗「view 真的把 `order_source` 帶出來了」(那是 adapter 那層),
 * 也不驗「信真的沒寄出去」(那要真跑)。
 */
describe('片 C:手動建單留白 = 不寄', () => {
  const MANUALS = ['manual_phone', 'manual_line', 'manual_other'] as const;

  for (const src of MANUALS) {
    it(`① ${src} + 留白 ⇒ 不寄、計 noRecipient(不得退回 customers.email)`, async () => {
      const d = deps([
        row({ orderSource: src, notificationEmail: null, customerEmail: 'frozen@example.com' }),
      ]);
      const res = await enqueueOrderUnpaidCancelledEmails(d, OPTS);
      expect(d.outbox.enqueue).not.toHaveBeenCalled();
      expect(res).toMatchObject({ noRecipient: 1, enqueued: 0, errors: 0 });
    });

    it(`② ${src} + 有值 ⇒ 照樣寄到那個值(少了這格,「手動一律不寄」也全綠)`, async () => {
      const d = deps([
        row({ orderSource: src, notificationEmail: 'staff@example.com', customerEmail: 'frozen@example.com' }),
      ]);
      await enqueueOrderUnpaidCancelledEmails(d, OPTS);
      expect(d.outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'staff@example.com' }),
      );
    });
  }

  it('③ 🟢 顧客站 + 留白 ⇒ 仍退回 customers.email(現狀不得變)', async () => {
    const d = deps([
      row({ orderSource: 'web', notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
  });

  it('④ 顧客站 + 有值 ⇒ 寄到那個值', async () => {
    const d = deps([
      row({ orderSource: 'web', notificationEmail: 'buyer@example.com', customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'buyer@example.com' }),
    );
  });

  it('🔴 orderSource 為 null(view 沒給)⇒ 照舊寄 —— 少寄一封看不見', async () => {
    const d = deps([
      row({ orderSource: null, notificationEmail: null, customerEmail: 'frozen@example.com' }),
    ]);
    await enqueueOrderUnpaidCancelledEmails(d, OPTS);
    expect(d.outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'frozen@example.com' }),
    );
  });
});
