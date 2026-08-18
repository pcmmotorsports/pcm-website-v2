// M-4a B-5 掃描式 enqueue 的 use-case 測試(plan §6 的 #1/#2/#3/#4/#6;#5 在 adapter、#7/#8 在 route)。
//
// 🔴 `#633` 驗收條款照抄:❌ 不可寫「有列 = 成功」;✅ 斷言 `recipientEmail` **不是 null 且等於某個具體值**。
import { describe, it, expect, vi } from 'vitest';
import type { IEmailOutbox, IPaidOrderScanner, PaidOrderWithoutOrderCreatedEmail } from '@pcm/ports';

import { enqueueOrderCreatedEmails } from './enqueue-order-created-emails';

const CUTOFF = '2026-08-18T00:00:00.000Z';

function row(over: Partial<PaidOrderWithoutOrderCreatedEmail> = {}): PaidOrderWithoutOrderCreatedEmail {
  return {
    orderId: 'order-1',
    displayId: 'ABC123',
    paidAt: '2026-08-18T10:00:00.000Z',
    notificationEmail: 'member@example.com',
    customerEmail: 'frozen@example.com',
    ...over,
  };
}

function deps(
  rows: PaidOrderWithoutOrderCreatedEmail[],
  enqueue: ReturnType<typeof vi.fn> = vi.fn(async () => ({ kind: 'enqueued', id: 'e1' })),
) {
  const scanner = {
    listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({ rows, scannedPages: 1, truncated: false })),
  } as unknown as IPaidOrderScanner;
  const outbox = { enqueue } as unknown as IEmailOutbox;
  return { deps: { scanner, outbox }, enqueue, scanner };
}

describe('enqueueOrderCreatedEmails — 掃描 → 排信', () => {
  it('🔴 #1 掃到的單 ⇒ enqueue 被呼叫,recipientEmail = orders 那個【具體值】(不是「非 null」)', async () => {
    const { deps: d, enqueue } = deps([row()]);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      eventType: 'order_created',
      orderId: 'order-1',
      displayId: 'ABC123',
      paidAt: '2026-08-18T10:00:00.000Z',
      recipientEmail: 'member@example.com',
      requestId: null,
    });
    expect(res).toEqual({
      scanned: 1, scannedPages: 1, truncated: false,
      enqueued: 1, skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 0,
    });
  });

  it('🔴 #2 掃不到的(差集已在 scanner 算掉)⇒ 零呼叫;cutoff/limit 原樣傳進 scanner', async () => {
    // 差集本身在 adapter 的查詢裡(plan §4 ②③),use-case 這一層看到的就已經是「該排的」。
    // 這格釘的是:use-case **不會自己多撈**,而且不吞掉 route 給的兩個參數。
    const { deps: d, enqueue, scanner } = deps([]);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 7 });

    expect(enqueue).not.toHaveBeenCalled();
    expect(scanner.listPaidWithoutOrderCreatedEmail).toHaveBeenCalledWith({ cutoff: CUTOFF, limit: 7 });
    expect(res.scanned).toBe(0);
  });

  it('🔴 #3 notification_email 為 NULL ⇒ 用 customers.email(PRD §3.2 fallback)', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null })]);
    await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'frozen@example.com' }));
  });

  it('🔴 notification_email 是空字串 / 全空白 ⇒ 一樣落到 fallback(不是把空字串送進 enqueue)', async () => {
    for (const empty of ['', '   ']) {
      const { deps: d, enqueue } = deps([row({ notificationEmail: empty })]);
      await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });
      expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'frozen@example.com' }));
    }
  });

  it('🔴 #4 合成假信箱 ⇒ 【照樣呼 enqueue】,由 adapter 落一列 skipped_no_real_email —— 不是靜默跳過', async () => {
    // 前一版寫「不 enqueue + 一行 log」= 對 PRD §3.2 的未申報偏離(V2/F13)。
    // 落一列才有查得到的痕跡;一行沒有人在看的 log 不是痕跡。
    // 🔴 本層**不判合成域**(那會長出第二套 LINE 判準)⇒ 這格同時釘住「有呼叫」與「回值被歸到正確的桶」。
    const enqueue = vi.fn(async () => ({ kind: 'skipped_no_real_email', id: 'e2' }));
    const { deps: d } = deps([row({ notificationEmail: 'line_x@line.pcmmotorsports.local' })], enqueue);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: 'line_x@line.pcmmotorsports.local' }),
    );
    expect(res).toMatchObject({ scanned: 1, enqueued: 0, skippedNoRealEmail: 1 });
  });

  it('兩個候選都沒有 ⇒ 不 enqueue、計 noRecipient(不是 errors)', async () => {
    const { deps: d, enqueue } = deps([row({ notificationEmail: null, customerEmail: null })]);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).not.toHaveBeenCalled();
    expect(res).toMatchObject({ scanned: 1, noRecipient: 1, errors: 0 });
  });

  it('duplicate ⇒ 歸 duplicate 桶(冪等成功,不是錯誤)', async () => {
    const enqueue = vi.fn(async () => ({ kind: 'duplicate' }));
    const { deps: d } = deps([row()], enqueue);
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(res).toMatchObject({ duplicate: 1, enqueued: 0, errors: 0 });
  });

  it('🔴 #6 單筆 throw ⇒ 其餘照跑、errors +1(整輪不中斷;下一輪會再撈到它)', async () => {
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e3' })
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e4' });
    const { deps: d } = deps(
      [row({ orderId: 'o1' }), row({ orderId: 'o2' }), row({ orderId: 'o3' })],
      enqueue,
    );
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    expect(enqueue).toHaveBeenCalledTimes(3); // 沒有在第一筆就停
    expect(res).toEqual({
      scanned: 3, scannedPages: 1, truncated: false,
      enqueued: 2, skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 1,
    });
  });

  it('🔴 MF3:單筆失敗時【一行 log 都不准寫】—— 錯誤物件裡就裝著收件信箱', async () => {
    // codex 關卡2 R1 must-fix 3:把 catch 改成 `catch (e) { console.error(e); errors++ }`
    // 現有測試會全綠,而客人的 email 就進了 log(PRD §7 明文禁止)。⇒ 這格直接盯 console。
    const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const enqueue = vi.fn().mockRejectedValue(new Error('boom member@example.com'));
      const { deps: d } = deps([row()], enqueue);
      const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

      expect(res).toMatchObject({ errors: 1 });
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('🔴 scanner 的 scannedPages / truncated 原樣透出(不得靜默截斷)', async () => {
    const scanner = {
      listPaidWithoutOrderCreatedEmail: vi.fn(async () => ({ rows: [row()], scannedPages: 25, truncated: true })),
    } as unknown as IPaidOrderScanner;
    const outbox = { enqueue: vi.fn(async () => ({ kind: 'enqueued', id: 'e9' })) } as unknown as IEmailOutbox;

    const res = await enqueueOrderCreatedEmails({ scanner, outbox }, { cutoff: CUTOFF, limit: 50 });

    expect(res).toMatchObject({ scannedPages: 25, truncated: true });
  });

  it('🔴 #7 的一半:result 只有數字,零 email 字面(PRD §7)', async () => {
    const enqueue = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'enqueued', id: 'e5' })
      .mockRejectedValueOnce(Object.assign(new Error('leak: member@example.com'), { detail: 'member@example.com' }));
    const { deps: d } = deps(
      [row({ orderId: 'o1' }), row({ orderId: 'o2' })],
      enqueue,
    );
    const res = await enqueueOrderCreatedEmails(d, { cutoff: CUTOFF, limit: 50 });

    // 連「錯誤訊息裡帶著 email」這種情況都不得漏出去 —— 所以 catch 連 error 物件都不留。
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('@');
    // truncated 是 boolean、其餘全是數字 —— 重點是**沒有任何字串欄**(字串才裝得下 email)。
    expect(Object.values(res).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);
    expect(res).toMatchObject({ errors: 1 });
  });
});
